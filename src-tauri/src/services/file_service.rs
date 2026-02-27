use crate::errors::AppError;
use crate::models::files::{FileContent, FileEntry, FileSearchResult};
use ignore::WalkBuilder;
use std::path::Path;
use tracing::warn;

/// Maximum file size for reading (5 MB)
const MAX_FILE_SIZE: u64 = 5 * 1024 * 1024;

/// Directories to skip during listing
const SKIP_DIRS: &[&str] = &[
    "node_modules",
    ".git",
    "target",
    "dist",
    "build",
    "__pycache__",
    ".next",
    ".cache",
    ".turbo",
    ".claude",
];

/// Validate that the requested path is within the project root.
/// Returns the canonicalized absolute path on success.
fn validate_within_project(project_path: &Path, relative_path: &str) -> Result<std::path::PathBuf, AppError> {
    let project_root = project_path.canonicalize().map_err(|e| {
        AppError::InvalidInput(format!("Invalid project path: {}", e))
    })?;

    let requested = project_root.join(relative_path);
    let canonical = requested.canonicalize().map_err(|e| {
        AppError::InvalidInput(format!("Invalid path '{}': {}", relative_path, e))
    })?;

    if !canonical.starts_with(&project_root) {
        return Err(AppError::InvalidInput(
            "Path traversal detected: access denied".to_string(),
        ));
    }

    Ok(canonical)
}

/// Validate path for write operations where the target file may not yet exist.
/// Canonicalizes the parent directory instead.
fn validate_within_project_for_write(project_path: &Path, relative_path: &str) -> Result<std::path::PathBuf, AppError> {
    let project_root = project_path.canonicalize().map_err(|e| {
        AppError::InvalidInput(format!("Invalid project path: {}", e))
    })?;

    let requested = project_root.join(relative_path);
    let parent = requested.parent().ok_or_else(|| {
        AppError::InvalidInput("Cannot determine parent directory".to_string())
    })?;

    let canonical_parent = parent.canonicalize().map_err(|e| {
        AppError::InvalidInput(format!("Parent directory invalid '{}': {}", relative_path, e))
    })?;

    if !canonical_parent.starts_with(&project_root) {
        return Err(AppError::InvalidInput(
            "Path traversal detected: access denied".to_string(),
        ));
    }

    // Return the file path under the canonical parent
    let file_name = requested.file_name().ok_or_else(|| {
        AppError::InvalidInput("Cannot determine file name".to_string())
    })?;

    Ok(canonical_parent.join(file_name))
}

/// List directory entries under the given relative path within a project.
pub fn list_directory(project_path: &str, relative_path: &str) -> Result<Vec<FileEntry>, AppError> {
    let project = Path::new(project_path);
    let dir_path = if relative_path.is_empty() || relative_path == "." {
        project.canonicalize().map_err(|e| {
            AppError::InvalidInput(format!("Invalid project path: {}", e))
        })?
    } else {
        validate_within_project(project, relative_path)?
    };

    if !dir_path.is_dir() {
        return Err(AppError::InvalidInput(format!(
            "Not a directory: {}",
            relative_path
        )));
    }

    let mut entries = Vec::new();
    let read_dir = std::fs::read_dir(&dir_path).map_err(|e| {
        AppError::Io(e)
    })?;

    for entry_result in read_dir {
        let entry = match entry_result {
            Ok(e) => e,
            Err(e) => {
                warn!("Skipping unreadable entry: {}", e);
                continue;
            }
        };

        let name = entry.file_name().to_string_lossy().to_string();

        // Skip hidden files and known heavy directories
        if name.starts_with('.') && name != ".." {
            continue;
        }

        let metadata = match entry.metadata() {
            Ok(m) => m,
            Err(e) => {
                warn!("Skipping entry with unreadable metadata '{}': {}", name, e);
                continue;
            }
        };

        let is_dir = metadata.is_dir();

        // Skip known heavy directories
        if is_dir && SKIP_DIRS.contains(&name.as_str()) {
            continue;
        }

        let modified = metadata
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| {
                chrono::DateTime::from_timestamp(d.as_secs() as i64, 0)
                    .map(|dt| dt.to_rfc3339())
                    .unwrap_or_default()
            })
            .unwrap_or_default();

        let extension = if is_dir {
            None
        } else {
            Path::new(&name)
                .extension()
                .map(|e| e.to_string_lossy().to_string())
        };

        // Build relative path from project root
        let entry_path = entry.path();
        let project_canonical = project.canonicalize().map_err(|e| {
            AppError::InvalidInput(format!("Invalid project path: {}", e))
        })?;
        let rel = entry_path
            .strip_prefix(&project_canonical)
            .unwrap_or(&entry_path)
            .to_string_lossy()
            .to_string();

        entries.push(FileEntry {
            name,
            path: rel,
            is_dir,
            size: if is_dir { 0 } else { metadata.len() },
            modified,
            extension,
        });
    }

    // Sort: directories first, then alphabetical (case-insensitive)
    entries.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    Ok(entries)
}

/// Read file content from the given relative path within a project.
pub fn read_file(project_path: &str, relative_path: &str) -> Result<FileContent, AppError> {
    let project = Path::new(project_path);
    let file_path = validate_within_project(project, relative_path)?;

    if !file_path.is_file() {
        return Err(AppError::NotFound(format!(
            "File not found: {}",
            relative_path
        )));
    }

    let metadata = std::fs::metadata(&file_path)?;
    let size = metadata.len();

    if size > MAX_FILE_SIZE {
        return Err(AppError::InvalidInput(format!(
            "File too large: {} bytes (max {} bytes)",
            size, MAX_FILE_SIZE
        )));
    }

    // Read raw bytes first to detect binary content
    let raw = std::fs::read(&file_path)?;
    let is_binary = is_binary_content(&raw);

    let content = if is_binary {
        String::new()
    } else {
        String::from_utf8_lossy(&raw).to_string()
    };

    let language = detect_language(relative_path);

    Ok(FileContent {
        content,
        language,
        path: relative_path.to_string(),
        size,
        is_binary,
    })
}

/// Write content to a file at the given relative path within a project.
pub fn write_file(project_path: &str, relative_path: &str, content: &str) -> Result<(), AppError> {
    let project = Path::new(project_path);
    let file_path = validate_within_project_for_write(project, relative_path)?;

    std::fs::write(&file_path, content)?;

    Ok(())
}

/// Detect if content is binary by checking for null bytes in first 8KB.
fn is_binary_content(data: &[u8]) -> bool {
    let check_len = data.len().min(8192);
    data[..check_len].contains(&0)
}

/// Extension candidates for import resolution (order = priority).
const RESOLVE_EXTENSIONS: &[&str] = &[
    ".ts", ".tsx", ".js", ".jsx", ".json", ".css",
    "/index.ts", "/index.tsx", "/index.js", "/index.jsx",
];

/// Resolve an import path to a project-relative file path.
///
/// Given a current file and an import specifier (e.g. `"../lib/event-bridge"`),
/// tries various extension suffixes and `/index.*` variants until a matching
/// file is found within the project root.
///
/// Returns `Ok(None)` if no matching file is found.
/// Returns `Err` for IO/validation failures (permission denied, invalid paths).
pub fn resolve_import_path(
    project_path: &str,
    current_file: &str,
    import_path: &str,
) -> Result<Option<String>, AppError> {
    if current_file.is_empty() || current_file.starts_with('/') {
        return Err(AppError::InvalidInput(format!(
            "Invalid current_file: '{}'",
            current_file
        )));
    }

    let project_root = Path::new(project_path).canonicalize().map_err(|e| {
        AppError::InvalidInput(format!("Invalid project path: {}", e))
    })?;

    let current_dir = project_root
        .join(current_file)
        .parent()
        .ok_or_else(|| AppError::InvalidInput("Cannot determine parent directory".into()))?
        .to_path_buf();

    let base = current_dir.join(import_path);

    // Helper: check candidate, validate within project, return relative path.
    // Returns Ok(None) for NotFound (expected during probing), Err for other IO failures.
    let try_candidate = |candidate: &Path| -> Result<Option<String>, AppError> {
        let canonical = match candidate.canonicalize() {
            Ok(c) => c,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(e) => {
                warn!(
                    "resolve_import_path: unexpected error on '{}': {}",
                    candidate.display(),
                    e
                );
                return Ok(None);
            }
        };
        if !canonical.starts_with(&project_root) {
            warn!(
                "Import path escapes project root: {}",
                candidate.display()
            );
            return Ok(None);
        }
        if !canonical.is_file() {
            return Ok(None);
        }
        let rel = canonical
            .strip_prefix(&project_root)
            .map_err(|e| AppError::Internal(format!("strip_prefix failed: {}", e)))?;
        Ok(Some(rel.to_string_lossy().to_string()))
    };

    // 1. Try the path as-is (already has extension)
    if base.extension().is_some() {
        if let Some(rel) = try_candidate(&base)? {
            return Ok(Some(rel));
        }
    }

    // 2. Try each extension candidate
    let base_str = base.to_string_lossy();
    for ext in RESOLVE_EXTENSIONS {
        let candidate_str = format!("{}{}", base_str, ext);
        let candidate = Path::new(&candidate_str);
        if let Some(rel) = try_candidate(candidate)? {
            return Ok(Some(rel));
        }
    }

    Ok(None)
}

/// Map file extension to language string for CodeMirror syntax highlighting.
pub fn detect_language(path: &str) -> String {
    let ext = Path::new(path)
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();

    match ext.as_str() {
        "rs" => "rust",
        "js" | "mjs" | "cjs" => "javascript",
        "ts" | "mts" | "cts" => "typescript",
        "jsx" => "jsx",
        "tsx" => "tsx",
        "py" => "python",
        "rb" => "ruby",
        "go" => "go",
        "java" => "java",
        "kt" | "kts" => "kotlin",
        "swift" => "swift",
        "c" | "h" => "c",
        "cpp" | "cc" | "cxx" | "hpp" | "hxx" => "cpp",
        "cs" => "csharp",
        "html" | "htm" => "html",
        "css" => "css",
        "scss" => "scss",
        "less" => "less",
        "json" => "json",
        "yaml" | "yml" => "yaml",
        "toml" => "toml",
        "xml" => "xml",
        "md" | "mdx" => "markdown",
        "sql" => "sql",
        "sh" | "bash" | "zsh" => "shell",
        "dockerfile" => "dockerfile",
        "lua" => "lua",
        "r" => "r",
        "php" => "php",
        "dart" => "dart",
        "vue" => "vue",
        "svelte" => "svelte",
        "graphql" | "gql" => "graphql",
        "wasm" => "wasm",
        _ => "text",
    }
    .to_string()
}

/// Maximum files to collect during recursive search
const MAX_SEARCH_FILES: usize = 50_000;

/// Collect all file paths under `project_root` using `ignore` crate.
/// Automatically respects `.gitignore`, skips hidden files, and caps at `MAX_SEARCH_FILES`.
fn collect_all_files(project_root: &Path) -> Result<Vec<String>, AppError> {
    let mut files = Vec::with_capacity(8192);
    let mut error_count: usize = 0;

    let walker = WalkBuilder::new(project_root)
        .hidden(true)       // skip hidden files/dirs
        .git_ignore(true)   // respect .gitignore
        .git_global(true)   // respect global gitignore
        .git_exclude(true)  // respect .git/info/exclude
        .build();

    for entry in walker {
        if files.len() >= MAX_SEARCH_FILES {
            warn!("File search capped at {} files for {:?}", MAX_SEARCH_FILES, project_root);
            break;
        }

        let entry = match entry {
            Ok(e) => e,
            Err(e) => {
                warn!("Skipping unreadable entry during search: {}", e);
                error_count += 1;
                continue;
            }
        };

        // Skip directories — we only want files
        let Some(ft) = entry.file_type() else { continue };
        if ft.is_dir() {
            continue;
        }

        let rel = match entry.path().strip_prefix(project_root) {
            Ok(r) => r.to_string_lossy().to_string(),
            Err(_) => {
                warn!("Path {:?} outside project root; skipping", entry.path());
                continue;
            }
        };

        files.push(rel);
    }

    if files.is_empty() && error_count > 0 {
        return Err(AppError::Io(std::io::Error::new(
            std::io::ErrorKind::PermissionDenied,
            format!("Failed to read project files ({} errors)", error_count),
        )));
    }

    Ok(files)
}

/// Compute a fuzzy match score for `query` against `path`.
/// Returns None if query chars are not a subsequence of path.
fn fuzzy_score(query: &str, path: &str) -> Option<i32> {
    let query_lower_str = query.to_lowercase();
    let query_lower: Vec<char> = query_lower_str.chars().collect();
    let path_chars: Vec<char> = path.chars().collect();
    let path_lower: Vec<char> = path.to_lowercase().chars().collect();

    if query_lower.is_empty() {
        return None;
    }

    let mut score: i32 = 0;
    let mut qi = 0;
    let mut prev_match_idx: Option<usize> = None;

    for (pi, &pc) in path_lower.iter().enumerate() {
        if qi < query_lower.len() && pc == query_lower[qi] {
            score += 1;

            // Bonus: match at start of path segment (after '/')
            if pi == 0 || path_chars[pi - 1] == '/' {
                score += 5;
            }

            // Bonus: consecutive matches
            if let Some(prev) = prev_match_idx {
                if pi == prev + 1 {
                    score += 3;
                }
            }

            // Bonus: CamelCase boundary
            if pi > 0 && path_chars[pi].is_uppercase() && path_chars[pi - 1].is_lowercase() {
                score += 3;
            }

            prev_match_idx = Some(pi);
            qi += 1;
        }
    }

    // All query chars must match
    if qi < query_lower.len() {
        return None;
    }

    // Bonus: filename match
    let basename = path.rsplit('/').next().unwrap_or(path);
    let basename_lower = basename.to_lowercase();
    if basename_lower.starts_with(&query_lower_str) {
        score += 18;
    } else if basename_lower.contains(&query_lower_str) {
        score += 10;
    }

    // Penalty: longer paths rank lower
    score -= (path.len() as i32) / 10;

    Some(score)
}

/// Search for files matching a fuzzy query within a project directory.
pub fn search_files(
    project_path: &str,
    query: &str,
    limit: usize,
) -> Result<Vec<FileSearchResult>, AppError> {
    let query = query.trim();
    if query.is_empty() {
        return Ok(Vec::new());
    }

    let project_root = Path::new(project_path).canonicalize().map_err(|e| {
        AppError::InvalidInput(format!("Invalid project path: {}", e))
    })?;

    let all_files = collect_all_files(&project_root)?;

    let mut scored: Vec<(String, i32)> = all_files
        .into_iter()
        .filter_map(|path| fuzzy_score(query, &path).map(|s| (path, s)))
        .collect();

    scored.sort_by(|a, b| b.1.cmp(&a.1));
    scored.truncate(limit);

    let results = scored
        .into_iter()
        .map(|(path, score)| {
            let name = path.rsplit('/').next().unwrap_or(&path).to_string();
            let extension = Path::new(&name)
                .extension()
                .map(|e| e.to_string_lossy().to_string());
            FileSearchResult {
                path,
                name,
                extension,
                score,
            }
        })
        .collect();

    Ok(results)
}
