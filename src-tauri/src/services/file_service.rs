use crate::errors::AppError;
use crate::models::files::{
    ConflictStrategy, ContentSearchFileResult, ContentSearchMatch, ContentSearchResult,
    CopyResult, FileContent, FileEntry, FileSearchResult,
};
use ignore::WalkBuilder;
use regex::RegexBuilder;
use std::path::Path;
use tracing::warn;

/// Maximum file size for reading (5 MB)
const MAX_FILE_SIZE: u64 = 5 * 1024 * 1024;

/// Canonicalize a project path, returning a descriptive error on failure.
fn canonicalize_project(project: &Path) -> Result<std::path::PathBuf, AppError> {
    project.canonicalize().map_err(|e| {
        AppError::InvalidInput(format!("Invalid project path: {}", e))
    })
}

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

/// Validate that a relative path does not escape the project root.
/// Rejects absolute paths (Path::join would discard base) and ".." path components.
/// Uses component-level check (not string contains) to allow "foo..bar" filenames.
fn validate_relative_path(relative_path: &str) -> Result<(), AppError> {
    let path = Path::new(relative_path);

    // Reject absolute paths (Path::join would discard base)
    if path.is_absolute() {
        return Err(AppError::InvalidInput(
            "Absolute paths are not allowed".to_string(),
        ));
    }

    // Reject ".." components (component-level, not string contains)
    for component in path.components() {
        if matches!(component, std::path::Component::ParentDir) {
            return Err(AppError::InvalidInput(
                "Path traversal detected: access denied".to_string(),
            ));
        }
    }

    Ok(())
}

/// Validate that the requested path is within the project root.
/// Returns the canonicalized absolute path on success.
fn validate_within_project(project_path: &Path, relative_path: &str) -> Result<std::path::PathBuf, AppError> {
    let project_root = canonicalize_project(project_path)?;

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
    let project_root = canonicalize_project(project_path)?;

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
        canonicalize_project(project)?
    } else {
        validate_within_project(project, relative_path)?
    };

    if !dir_path.is_dir() {
        return Err(AppError::InvalidInput(format!(
            "Not a directory: {}",
            relative_path
        )));
    }

    let project_root = canonicalize_project(project)?;

    let mut entries = Vec::new();
    let read_dir = std::fs::read_dir(&dir_path)?;

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

        // Skip known heavy directories
        if metadata.is_dir() && SKIP_DIRS.contains(&name.as_str()) {
            continue;
        }

        entries.push(build_file_entry(&entry.path(), &project_root, &metadata));
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

// ---------------------------------------------------------------------------
// File Management Operations (create / delete / rename / copy)
// ---------------------------------------------------------------------------

/// Protected directory names that cannot be deleted.
const PROTECTED_DIRS: &[&str] = &[".git"];

/// Maximum file size for external copy (500 MB)
const MAX_COPY_FILE_SIZE: u64 = 500 * 1024 * 1024;

/// Build a `FileEntry` from a canonicalized path and its metadata,
/// using `project_root` to compute the relative path.
fn build_file_entry(
    abs_path: &Path,
    project_root: &Path,
    metadata: &std::fs::Metadata,
) -> FileEntry {
    let name = abs_path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    let rel = abs_path
        .strip_prefix(project_root)
        .unwrap_or(abs_path)
        .to_string_lossy()
        .to_string();
    let is_dir = metadata.is_dir();
    let extension = if is_dir {
        None
    } else {
        abs_path
            .extension()
            .map(|e| e.to_string_lossy().to_string())
    };
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

    FileEntry {
        name,
        path: rel,
        is_dir,
        size: if is_dir { 0 } else { metadata.len() },
        modified,
        extension,
    }
}

/// Create an empty file at the given relative path within a project.
/// Uses atomic write (temp + rename) with 0600 permissions.
pub fn create_file(project_path: &str, relative_path: &str) -> Result<FileEntry, AppError> {
    let project = Path::new(project_path);
    let file_path = validate_within_project_for_write(project, relative_path)?;

    if file_path.exists() {
        return Err(AppError::InvalidInput(format!(
            "File already exists: {}",
            relative_path
        )));
    }

    // Atomic write: create temp file in same directory, then rename
    let parent = file_path.parent().ok_or_else(|| {
        AppError::InvalidInput("Cannot determine parent directory".to_string())
    })?;
    let temp_path = parent.join(format!(
        ".tmp_{}_{}",
        std::process::id(),
        file_path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default()
    ));

    // Create temp file with empty content
    std::fs::write(&temp_path, b"")?;

    // Set permissions to 0600
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let perms = std::fs::Permissions::from_mode(0o600);
        if let Err(e) = std::fs::set_permissions(&temp_path, perms) {
            let _ = std::fs::remove_file(&temp_path);
            return Err(AppError::Io(e));
        }
    }

    // Rename temp to target (atomic on same filesystem)
    if let Err(e) = std::fs::rename(&temp_path, &file_path) {
        let _ = std::fs::remove_file(&temp_path);
        return Err(AppError::Io(e));
    }

    let project_root = canonicalize_project(project)?;
    let metadata = std::fs::metadata(&file_path)?;
    Ok(build_file_entry(&file_path, &project_root, &metadata))
}

/// Create a directory at the given relative path within a project.
/// Parent directory must already exist (does not create intermediate directories).
pub fn create_directory(project_path: &str, relative_path: &str) -> Result<FileEntry, AppError> {
    let project = Path::new(project_path);
    let dir_path = validate_within_project_for_write(project, relative_path)?;

    if dir_path.exists() {
        return Err(AppError::InvalidInput(format!(
            "Directory already exists: {}",
            relative_path
        )));
    }

    std::fs::create_dir(&dir_path)?;

    let project_root = canonicalize_project(project)?;
    let metadata = std::fs::metadata(&dir_path)?;
    Ok(build_file_entry(&dir_path, &project_root, &metadata))
}

/// Delete a file or directory at the given relative path within a project.
/// Refuses to delete the project root, protected directories (.git),
/// or any path that contains a protected directory as a component.
/// Symlinks are removed as links (the target is NOT deleted).
pub fn delete_path(project_path: &str, relative_path: &str) -> Result<(), AppError> {
    if relative_path.is_empty() || relative_path == "." {
        return Err(AppError::InvalidInput(
            "Cannot delete project root".to_string(),
        ));
    }

    let project = Path::new(project_path);
    let project_root = canonicalize_project(project)?;

    // Block absolute paths and ".." traversal before any filesystem access
    validate_relative_path(relative_path)?;

    // Check symlink BEFORE canonicalize to avoid operating on the target
    let raw_path = project_root.join(relative_path);
    let raw_meta = std::fs::symlink_metadata(&raw_path).map_err(|e| {
        AppError::InvalidInput(format!("Invalid path '{}': {}", relative_path, e))
    })?;
    if raw_meta.file_type().is_symlink() {
        // Remove the symlink itself, not the target
        std::fs::remove_file(&raw_path)?;
        return Ok(());
    }

    let target_path = validate_within_project(project, relative_path)?;

    // Check all path components against protected dirs (not just the leaf)
    let rel_to_root = target_path.strip_prefix(&project_root).unwrap_or(&target_path);
    for component in rel_to_root.components() {
        if let std::path::Component::Normal(name) = component {
            let name_str = name.to_string_lossy();
            if PROTECTED_DIRS.contains(&name_str.as_ref()) {
                return Err(AppError::InvalidInput(format!(
                    "Cannot delete inside protected directory: {}",
                    name_str
                )));
            }
        }
    }

    if target_path.is_dir() {
        std::fs::remove_dir_all(&target_path)?;
    } else {
        std::fs::remove_file(&target_path)?;
    }

    Ok(())
}

/// Rename or move a file/directory within a project.
/// Checks destination does not already exist to prevent silent overwrites.
/// Symlinks are renamed as links (the target is NOT moved).
pub fn rename_path(
    project_path: &str,
    old_relative_path: &str,
    new_relative_path: &str,
) -> Result<FileEntry, AppError> {
    let project = Path::new(project_path);
    let project_root = canonicalize_project(project)?;

    // Block absolute paths and ".." traversal before any filesystem access
    validate_relative_path(old_relative_path)?;
    validate_relative_path(new_relative_path)?;

    // Check symlink BEFORE canonicalize to operate on the link, not the target
    let raw_old = project_root.join(old_relative_path);
    let raw_meta = std::fs::symlink_metadata(&raw_old).map_err(|e| {
        AppError::InvalidInput(format!("Invalid path '{}': {}", old_relative_path, e))
    })?;
    let is_symlink = raw_meta.file_type().is_symlink();

    let new_path = validate_within_project_for_write(project, new_relative_path)?;

    if new_path.exists() {
        return Err(AppError::InvalidInput(format!(
            "Destination already exists: {}",
            new_relative_path
        )));
    }

    if is_symlink {
        // Rename the symlink itself, not the target
        if !raw_old.exists() && !raw_meta.file_type().is_symlink() {
            return Err(AppError::NotFound(format!(
                "Source not found: {}",
                old_relative_path
            )));
        }
        std::fs::rename(&raw_old, &new_path)?;
    } else {
        let old_path = validate_within_project(project, old_relative_path)?;
        if !old_path.exists() {
            return Err(AppError::NotFound(format!(
                "Source not found: {}",
                old_relative_path
            )));
        }
        std::fs::rename(&old_path, &new_path)?;
    }

    let metadata = std::fs::symlink_metadata(&new_path)?;
    Ok(build_file_entry(&new_path, &project_root, &metadata))
}

/// Copy external files into a project directory (files only, no folder support).
/// Prefer `copy_external_entries` which supports folders and conflict strategies.
/// Source paths are absolute (from OS drag-drop). Only regular files are accepted.
pub fn copy_external_files(
    project_path: &str,
    target_relative_dir: &str,
    source_paths: Vec<String>,
) -> Result<Vec<FileEntry>, AppError> {
    let project = Path::new(project_path);
    let project_root = canonicalize_project(project)?;

    // Validate target directory is within project
    let target_dir = if target_relative_dir.is_empty() || target_relative_dir == "." {
        project_root.clone()
    } else {
        validate_within_project(project, target_relative_dir)?
    };

    if !target_dir.is_dir() {
        return Err(AppError::InvalidInput(format!(
            "Target is not a directory: {}",
            target_relative_dir
        )));
    }

    let mut entries = Vec::with_capacity(source_paths.len());

    for source_str in &source_paths {
        let source = Path::new(source_str);

        if !source.exists() {
            tracing::error!("External file not found: {}", source_str);
            return Err(AppError::NotFound(format!(
                "Source file not found: {}",
                source_str
            )));
        }

        let source_meta = std::fs::metadata(source)?;

        // Reject directories (v1: folder drop not supported)
        if source_meta.is_dir() {
            return Err(AppError::InvalidInput(
                "Folder drop is not supported. Please drop individual files.".to_string(),
            ));
        }

        // Reject non-regular files (symlinks to devices, named pipes, etc.)
        if !source_meta.file_type().is_file() {
            return Err(AppError::InvalidInput(format!(
                "Not a regular file: {}",
                source_str
            )));
        }

        // Reject files exceeding size limit
        if source_meta.len() > MAX_COPY_FILE_SIZE {
            return Err(AppError::InvalidInput(format!(
                "File too large: {} ({} bytes, max {} bytes)",
                source_str,
                source_meta.len(),
                MAX_COPY_FILE_SIZE
            )));
        }

        let file_name = source.file_name().ok_or_else(|| {
            AppError::InvalidInput(format!("Cannot determine file name: {}", source_str))
        })?;

        let dest = target_dir.join(file_name);

        if dest.exists() {
            return Err(AppError::InvalidInput(format!(
                "File already exists at destination: {}",
                file_name.to_string_lossy()
            )));
        }

        // Atomic copy: temp file + rename, with 0600 permissions
        let temp_dest = target_dir.join(format!(
            ".tmp_{}_{}",
            std::process::id(),
            file_name.to_string_lossy()
        ));
        if let Err(e) = std::fs::copy(source, &temp_dest) {
            let _ = std::fs::remove_file(&temp_dest);
            return Err(AppError::Io(e));
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let perms = std::fs::Permissions::from_mode(0o600);
            if let Err(e) = std::fs::set_permissions(&temp_dest, perms) {
                let _ = std::fs::remove_file(&temp_dest);
                return Err(AppError::Io(e));
            }
        }
        if let Err(e) = std::fs::rename(&temp_dest, &dest) {
            let _ = std::fs::remove_file(&temp_dest);
            return Err(AppError::Io(e));
        }

        let dest_meta = std::fs::metadata(&dest)?;
        entries.push(build_file_entry(&dest, &project_root, &dest_meta));
    }

    Ok(entries)
}

/// Maximum recursion depth for directory copy (prevents stack overflow from deep nesting).
const MAX_COPY_DEPTH: u32 = 20;

/// Maximum cumulative copy size (2 GB).
const MAX_CUMULATIVE_COPY_SIZE: u64 = 2 * 1024 * 1024 * 1024;

/// Validate file size limits and perform an atomic copy.
/// Checks per-file and cumulative limits, then delegates to `atomic_copy_file`.
fn validate_and_copy_file(
    source: &Path,
    dest: &Path,
    file_size: u64,
    result: &mut CopyResult,
) -> Result<(), AppError> {
    if file_size > MAX_COPY_FILE_SIZE {
        tracing::error!("File too large: {:?} ({} bytes)", source, file_size);
        return Err(AppError::InvalidInput(format!(
            "File too large: {} ({} bytes, max {} bytes)",
            source.display(),
            file_size,
            MAX_COPY_FILE_SIZE
        )));
    }
    if result.total_bytes_copied + file_size > MAX_CUMULATIVE_COPY_SIZE {
        tracing::error!("Cumulative copy size exceeded");
        return Err(AppError::InvalidInput(
            "Total copy size exceeds 2 GB limit".to_string(),
        ));
    }
    atomic_copy_file(source, dest)?;
    result.total_bytes_copied += file_size;
    Ok(())
}

/// Copy external files and directories into a project directory.
/// Source paths are absolute (from OS drag-drop). Both files and folders are accepted.
/// Directories are copied recursively with structure preserved.
/// Symlinks are silently skipped. Individual files capped at 500 MB, total at 2 GB.
/// Maximum directory nesting depth: 20 levels.
pub fn copy_external_entries(
    project_path: &str,
    target_relative_dir: &str,
    source_paths: Vec<String>,
    conflict_strategy: ConflictStrategy,
) -> Result<CopyResult, AppError> {
    let project = Path::new(project_path);
    let project_root = canonicalize_project(project)?;

    let target_dir = if target_relative_dir.is_empty() || target_relative_dir == "." {
        project_root.clone()
    } else {
        validate_within_project(project, target_relative_dir)?
    };

    if !target_dir.is_dir() {
        tracing::error!("Target is not a directory: {}", target_relative_dir);
        return Err(AppError::InvalidInput(format!(
            "Target is not a directory: {}",
            target_relative_dir
        )));
    }

    let mut result = CopyResult {
        entries: Vec::with_capacity(source_paths.len()),
        skipped: Vec::new(),
        total_bytes_copied: 0,
    };

    for source_str in &source_paths {
        let source = Path::new(source_str);

        if !source.exists() {
            tracing::error!("External source not found: {}", source_str);
            return Err(AppError::NotFound(format!(
                "Source not found: {}",
                source_str
            )));
        }

        // Use symlink_metadata to detect symlinks without following them
        let source_meta = std::fs::symlink_metadata(source)?;

        if source_meta.file_type().is_symlink() {
            result.skipped.push(source_str.clone());
            continue;
        }

        let file_name = source.file_name().ok_or_else(|| {
            AppError::InvalidInput(format!("Cannot determine name: {}", source_str))
        })?;

        let dest = resolve_conflict(&target_dir, file_name, &conflict_strategy)?;
        let dest = match dest {
            Some(d) => d,
            None => {
                // Skip strategy: file exists, skip it
                result.skipped.push(source_str.clone());
                continue;
            }
        };

        if source_meta.is_dir() {
            // Overwrite: remove conflicting file so we can create a directory
            if dest.exists() && !dest.is_dir() {
                if matches!(conflict_strategy, ConflictStrategy::Overwrite) {
                    std::fs::remove_file(&dest)?;
                } else {
                    tracing::error!("Cannot copy directory over existing file: {:?}", dest);
                    return Err(AppError::InvalidInput(format!(
                        "Cannot copy directory '{}': a file with that name already exists",
                        file_name.to_string_lossy()
                    )));
                }
            }
            let dest_existed_before = dest.exists();
            if let Err(e) = copy_dir_recursive(
                source,
                &dest,
                &project_root,
                &conflict_strategy,
                &mut result,
                0,
            ) {
                // Best-effort cleanup of partially copied directory
                if !dest_existed_before {
                    if let Err(cleanup_err) = std::fs::remove_dir_all(&dest) {
                        warn!(
                            "Failed to clean up partial copy at {:?}: {}",
                            dest, cleanup_err
                        );
                    }
                }
                return Err(e);
            }
            let dir_meta = std::fs::metadata(&dest)?;
            result.entries.push(build_file_entry(&dest, &project_root, &dir_meta));
        } else if source_meta.is_file() {
            // Overwrite: remove conflicting directory so we can copy a file
            if dest.exists() && dest.is_dir() {
                if matches!(conflict_strategy, ConflictStrategy::Overwrite) {
                    std::fs::remove_dir_all(&dest)?;
                } else {
                    tracing::error!("Cannot copy file over existing directory: {:?}", dest);
                    return Err(AppError::InvalidInput(format!(
                        "Cannot copy file '{}': a directory with that name already exists",
                        file_name.to_string_lossy()
                    )));
                }
            }
            validate_and_copy_file(source, &dest, source_meta.len(), &mut result)?;
            let dest_meta = std::fs::metadata(&dest)?;
            result.entries.push(build_file_entry(&dest, &project_root, &dest_meta));
        } else {
            // Skip non-regular files (named pipes, devices, etc.)
            result.skipped.push(source_str.clone());
        }
    }

    Ok(result)
}

/// Resolve a destination path, handling filename conflicts per strategy.
/// - Skip: returns None when the destination already exists.
/// - Overwrite: returns the existing path (caller handles type mismatch).
/// - AutoRename: tries "name (1)" through "name (99)", returns Err if all taken.
fn resolve_conflict(
    target_dir: &Path,
    file_name: &std::ffi::OsStr,
    strategy: &ConflictStrategy,
) -> Result<Option<std::path::PathBuf>, AppError> {
    let dest = target_dir.join(file_name);
    if !dest.exists() {
        return Ok(Some(dest));
    }

    match strategy {
        ConflictStrategy::Skip => Ok(None),
        ConflictStrategy::Overwrite => Ok(Some(dest)),
        ConflictStrategy::AutoRename => {
            let name = file_name.to_string_lossy();
            let (stem, ext) = match name.rfind('.') {
                Some(dot) if dot > 0 => (&name[..dot], Some(&name[dot..])),
                _ => (name.as_ref(), None),
            };
            for i in 1..=99 {
                let new_name = match ext {
                    Some(e) => format!("{} ({}){}", stem, i, e),
                    None => format!("{} ({})", stem, i),
                };
                let candidate = target_dir.join(&new_name);
                if !candidate.exists() {
                    return Ok(Some(candidate));
                }
            }
            tracing::error!("Cannot auto-rename: all variants exist for {}", name);
            Err(AppError::InvalidInput(format!(
                "Cannot auto-rename: all variants exist for {}",
                name
            )))
        }
    }
}

/// Atomically copy a single file: write to temp, set permissions, rename.
fn atomic_copy_file(source: &Path, dest: &Path) -> Result<(), AppError> {
    let parent = dest.parent().ok_or_else(|| {
        tracing::error!("Destination has no parent directory: {:?}", dest);
        AppError::InvalidInput("Destination has no parent directory".to_string())
    })?;
    let file_name = dest
        .file_name()
        .unwrap_or_else(|| std::ffi::OsStr::new("file"));
    let temp_dest = parent.join(format!(
        ".tmp_{}_{}",
        std::process::id(),
        file_name.to_string_lossy()
    ));

    let cleanup_temp = |temp: &Path| {
        if let Err(cleanup_err) = std::fs::remove_file(temp) {
            warn!("Failed to clean up temp file {:?}: {}", temp, cleanup_err);
        }
    };

    if let Err(e) = std::fs::copy(source, &temp_dest) {
        tracing::error!("Failed to copy {:?} to {:?}: {}", source, temp_dest, e);
        cleanup_temp(&temp_dest);
        return Err(AppError::Io(e));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let perms = std::fs::Permissions::from_mode(0o600);
        if let Err(e) = std::fs::set_permissions(&temp_dest, perms) {
            tracing::error!("Failed to set permissions on {:?}: {}", temp_dest, e);
            cleanup_temp(&temp_dest);
            return Err(AppError::Io(e));
        }
    }
    if let Err(e) = std::fs::rename(&temp_dest, dest) {
        tracing::error!("Failed to rename {:?} to {:?}: {}", temp_dest, dest, e);
        cleanup_temp(&temp_dest);
        return Err(AppError::Io(e));
    }
    Ok(())
}

/// Recursively copy a directory, preserving structure.
/// Validates the destination remains within project_root at each level.
/// Symlinks, oversized files, and non-regular entries are skipped.
fn copy_dir_recursive(
    source: &Path,
    dest: &Path,
    project_root: &Path,
    strategy: &ConflictStrategy,
    result: &mut CopyResult,
    depth: u32,
) -> Result<(), AppError> {
    if depth >= MAX_COPY_DEPTH {
        tracing::error!("Max copy depth ({}) exceeded at {:?}", MAX_COPY_DEPTH, source);
        return Err(AppError::InvalidInput(format!(
            "Directory nesting too deep (max {} levels)",
            MAX_COPY_DEPTH
        )));
    }

    // Validate destination is within project root.
    // For existing paths, canonicalize directly; for new ones, validate the parent.
    if dest.exists() {
        let canonical = dest.canonicalize().map_err(|e| {
            AppError::InvalidInput(format!("Cannot resolve destination: {}", e))
        })?;
        if !canonical.starts_with(project_root) {
            return Err(AppError::InvalidInput(
                "Destination escapes project root".to_string(),
            ));
        }
    } else {
        let parent = dest.parent().ok_or_else(|| {
            AppError::InvalidInput("Destination has no parent".to_string())
        })?;
        let canonical_parent = parent.canonicalize().map_err(|e| {
            AppError::InvalidInput(format!("Cannot resolve parent: {}", e))
        })?;
        if !canonical_parent.starts_with(project_root) {
            return Err(AppError::InvalidInput(
                "Destination escapes project root".to_string(),
            ));
        }
    }

    if !dest.exists() {
        std::fs::create_dir(dest)?;
    }

    let entries = std::fs::read_dir(source).map_err(|e| {
        tracing::error!("Cannot read directory {:?}: {}", source, e);
        AppError::Io(e)
    })?;

    for entry_result in entries {
        let entry = entry_result?;
        let entry_meta = std::fs::symlink_metadata(entry.path())?;

        // Skip symlinks
        if entry_meta.file_type().is_symlink() {
            result.skipped.push(entry.path().to_string_lossy().to_string());
            continue;
        }

        let entry_name = entry.file_name();
        let child_dest = resolve_conflict(dest, &entry_name, strategy)?;
        let child_dest = match child_dest {
            Some(d) => d,
            None => {
                result.skipped.push(entry.path().to_string_lossy().to_string());
                continue;
            }
        };

        if entry_meta.is_dir() {
            // Overwrite: remove conflicting file so we can create a subdirectory
            if child_dest.exists()
                && !child_dest.is_dir()
                && matches!(strategy, ConflictStrategy::Overwrite)
            {
                std::fs::remove_file(&child_dest)?;
            }
            copy_dir_recursive(
                &entry.path(),
                &child_dest,
                project_root,
                strategy,
                result,
                depth + 1,
            )?;
        } else if entry_meta.is_file() {
            // Overwrite: remove conflicting directory so we can copy a file
            if child_dest.exists()
                && child_dest.is_dir()
                && matches!(strategy, ConflictStrategy::Overwrite)
            {
                std::fs::remove_dir_all(&child_dest)?;
            }
            validate_and_copy_file(&entry.path(), &child_dest, entry_meta.len(), result)?;
        } else {
            result.skipped.push(entry.path().to_string_lossy().to_string());
        }
    }

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

    let project_root = canonicalize_project(Path::new(project_path))?;

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

    let project_root = canonicalize_project(Path::new(project_path))?;

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

// ---------------------------------------------------------------------------
// Content Search
// ---------------------------------------------------------------------------

/// Maximum total matches to return
const MAX_CONTENT_MATCHES: u32 = 1000;
/// Maximum files with matches to return
const MAX_CONTENT_FILES: u32 = 100;
/// Maximum characters for a single line display
const MAX_LINE_DISPLAY_LEN: usize = 500;

/// Truncate a line around the match position, returning the truncated content
/// and adjusted match offsets.
fn truncate_line_around_match(
    line: &str,
    match_start: usize,
    match_end: usize,
) -> (String, u32, u32) {
    let char_count = line.chars().count();

    if char_count <= MAX_LINE_DISPLAY_LEN {
        return (line.to_string(), match_start as u32, match_end as u32);
    }

    // Center a window around the match
    let window_start = match_start.saturating_sub(100);
    let window_end = (window_start + MAX_LINE_DISPLAY_LEN).min(char_count);
    let window_start = if window_end == char_count {
        char_count.saturating_sub(MAX_LINE_DISPLAY_LEN)
    } else {
        window_start
    };

    let truncated: String = line
        .chars()
        .skip(window_start)
        .take(window_end - window_start)
        .collect();

    let adj_start = (match_start - window_start) as u32;
    let adj_end = (match_end - window_start).min(window_end - window_start) as u32;

    (truncated, adj_start, adj_end)
}

/// Search for text content across all files in a project directory.
///
/// Supports both literal string and regex modes, with case sensitivity toggle.
/// Respects `.gitignore`, skips binary files and files larger than `MAX_FILE_SIZE`.
pub fn search_file_contents(
    project_path: &str,
    query: &str,
    case_sensitive: bool,
    is_regex: bool,
    max_results: Option<u32>,
) -> Result<ContentSearchResult, AppError> {
    let query = query.trim();
    if query.is_empty() {
        return Err(AppError::InvalidInput(
            "Search query cannot be empty".to_string(),
        ));
    }

    let pattern = if is_regex {
        query.to_string()
    } else {
        regex::escape(query)
    };

    let re = RegexBuilder::new(&pattern)
        .case_insensitive(!case_sensitive)
        .build()
        .map_err(|e| AppError::InvalidInput(format!("Invalid regex: {}", e)))?;

    let project_root = canonicalize_project(Path::new(project_path))?;

    let all_files = collect_all_files(&project_root)?;
    let match_limit = max_results.unwrap_or(MAX_CONTENT_MATCHES);

    let start = std::time::Instant::now();

    let mut files: Vec<ContentSearchFileResult> = Vec::new();
    let mut total_matches: u32 = 0;
    let mut truncated = false;

    for rel_path in &all_files {
        if total_matches >= match_limit || files.len() as u32 >= MAX_CONTENT_FILES {
            truncated = true;
            break;
        }

        let abs_path = project_root.join(rel_path);

        // Skip files that are too large
        let metadata = match std::fs::metadata(&abs_path) {
            Ok(m) => m,
            Err(e) => {
                warn!("Skipping file with unreadable metadata '{}': {}", rel_path, e);
                continue;
            }
        };
        if metadata.len() > MAX_FILE_SIZE || !metadata.is_file() {
            continue;
        }

        // Read raw bytes and skip binary content
        let raw = match std::fs::read(&abs_path) {
            Ok(r) => r,
            Err(e) => {
                warn!("Failed to read file '{}': {}", rel_path, e);
                continue;
            }
        };
        if is_binary_content(&raw) {
            continue;
        }

        let content = String::from_utf8_lossy(&raw);

        let mut file_matches: Vec<ContentSearchMatch> = Vec::new();

        for (line_idx, line) in content.lines().enumerate() {
            for m in re.find_iter(line) {
                if total_matches + file_matches.len() as u32 >= match_limit {
                    truncated = true;
                    break;
                }

                // Use char offsets for proper Unicode handling
                let byte_start = m.start();
                let byte_end = m.end();
                let char_start = line[..byte_start].chars().count();
                let char_end = char_start + line[byte_start..byte_end].chars().count();

                let (display_content, adj_start, adj_end) =
                    truncate_line_around_match(line, char_start, char_end);

                file_matches.push(ContentSearchMatch {
                    line_number: (line_idx + 1) as u32,
                    line_content: display_content,
                    match_start: adj_start,
                    match_end: adj_end,
                });
            }

            if truncated {
                break;
            }
        }

        if !file_matches.is_empty() {
            total_matches += file_matches.len() as u32;
            files.push(ContentSearchFileResult {
                path: rel_path.clone(),
                matches: file_matches,
            });
        }
    }

    let duration_ms = start.elapsed().as_millis() as u64;

    Ok(ContentSearchResult {
        total_matches,
        total_files: files.len() as u32,
        truncated,
        duration_ms,
        files,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::OsStr;

    fn temp_project() -> std::path::PathBuf {
        let tmp = std::env::temp_dir().join(format!(
            "flow-orche-file-test-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&tmp).unwrap();
        tmp
    }

    // -----------------------------------------------------------------------
    // Group A — Path Validation
    // -----------------------------------------------------------------------

    #[test]
    fn test_validate_relative_path_rejects_dotdot() {
        let result = validate_relative_path("../etc/passwd");
        assert!(result.is_err());
        let msg = result.unwrap_err().to_string();
        assert!(msg.contains("Path traversal"), "unexpected error: {}", msg);
    }

    #[test]
    fn test_validate_relative_path_rejects_middle_dotdot() {
        let result = validate_relative_path("subdir/../../etc");
        assert!(result.is_err());
        let msg = result.unwrap_err().to_string();
        assert!(msg.contains("Path traversal"), "unexpected error: {}", msg);
    }

    #[test]
    fn test_validate_relative_path_rejects_absolute() {
        let result = validate_relative_path("/etc/passwd");
        assert!(result.is_err());
        let msg = result.unwrap_err().to_string();
        assert!(
            msg.contains("Absolute paths are not allowed"),
            "unexpected error: {}",
            msg
        );
    }

    #[test]
    fn test_validate_relative_path_allows_double_dot_in_name() {
        let result = validate_relative_path("foo..bar.txt");
        assert!(result.is_ok(), "should allow double dots in filename");
    }

    #[test]
    fn test_validate_relative_path_allows_normal() {
        let result = validate_relative_path("src/main.rs");
        assert!(result.is_ok(), "should allow normal relative paths");
    }

    #[cfg(unix)]
    #[test]
    fn test_validate_within_project_symlink_escape() {
        let tmp = temp_project();
        // Create a symlink inside the project that points outside
        let link = tmp.join("escape_link");
        std::os::unix::fs::symlink("/etc", &link).unwrap();

        let result = validate_within_project(&tmp, "escape_link/passwd");
        assert!(result.is_err(), "symlink escape should be rejected");

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn test_validate_within_project_for_write_parent_escape() {
        let tmp = temp_project();

        let result = validate_within_project_for_write(&tmp, "../outside.txt");
        assert!(result.is_err(), "parent escape should be rejected");
        let msg = result.unwrap_err().to_string();
        assert!(msg.contains("Path traversal"), "unexpected error: {}", msg);

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn test_validate_within_project_for_write_valid_new_file() {
        let tmp = temp_project();

        let result = validate_within_project_for_write(&tmp, "newfile.txt");
        assert!(result.is_ok(), "valid new file should be accepted");
        let path = result.unwrap();
        // The returned path should end with the filename and reside under tmp
        assert!(path.ends_with("newfile.txt"));
        let canonical_tmp = tmp.canonicalize().unwrap();
        assert!(
            path.starts_with(&canonical_tmp),
            "path {:?} should start with {:?}",
            path,
            canonical_tmp
        );

        let _ = std::fs::remove_dir_all(&tmp);
    }

    // -----------------------------------------------------------------------
    // Group B — File CRUD
    // -----------------------------------------------------------------------

    #[test]
    fn test_create_file_success() {
        let tmp = temp_project();
        let tmp_str = tmp.to_string_lossy().to_string();

        let entry = create_file(&tmp_str, "hello.txt").unwrap();
        assert_eq!(entry.name, "hello.txt");
        assert!(!entry.is_dir);
        assert_eq!(entry.size, 0);
        assert_eq!(entry.extension, Some("txt".to_string()));

        let canonical_tmp = tmp.canonicalize().unwrap();
        let file_on_disk = canonical_tmp.join("hello.txt");
        assert!(file_on_disk.exists(), "file should exist on disk");

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn test_create_file_already_exists() {
        let tmp = temp_project();
        let tmp_str = tmp.to_string_lossy().to_string();

        create_file(&tmp_str, "dup.txt").unwrap();
        let result = create_file(&tmp_str, "dup.txt");
        assert!(result.is_err(), "duplicate create should fail");
        let msg = result.unwrap_err().to_string();
        assert!(msg.contains("already exists"), "unexpected error: {}", msg);

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn test_create_file_traversal_blocked() {
        let tmp = temp_project();
        let tmp_str = tmp.to_string_lossy().to_string();

        let result = create_file(&tmp_str, "../escape.txt");
        assert!(result.is_err(), "traversal should be blocked");

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[cfg(unix)]
    #[test]
    fn test_create_file_permissions_0600() {
        use std::os::unix::fs::PermissionsExt;

        let tmp = temp_project();
        let tmp_str = tmp.to_string_lossy().to_string();

        create_file(&tmp_str, "secure.txt").unwrap();
        let canonical_tmp = tmp.canonicalize().unwrap();
        let meta = std::fs::metadata(canonical_tmp.join("secure.txt")).unwrap();
        let mode = meta.permissions().mode() & 0o777;
        assert_eq!(mode, 0o600, "file permissions should be 0600, got {:o}", mode);

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn test_create_directory_success() {
        let tmp = temp_project();
        let tmp_str = tmp.to_string_lossy().to_string();

        let entry = create_directory(&tmp_str, "subdir").unwrap();
        assert_eq!(entry.name, "subdir");
        assert!(entry.is_dir);
        assert_eq!(entry.extension, None);

        let canonical_tmp = tmp.canonicalize().unwrap();
        assert!(canonical_tmp.join("subdir").is_dir(), "directory should exist on disk");

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn test_create_directory_already_exists() {
        let tmp = temp_project();
        let tmp_str = tmp.to_string_lossy().to_string();

        create_directory(&tmp_str, "mydir").unwrap();
        let result = create_directory(&tmp_str, "mydir");
        assert!(result.is_err(), "duplicate directory create should fail");
        let msg = result.unwrap_err().to_string();
        assert!(msg.contains("already exists"), "unexpected error: {}", msg);

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn test_create_directory_traversal_blocked() {
        let tmp = temp_project();
        let tmp_str = tmp.to_string_lossy().to_string();

        let result = create_directory(&tmp_str, "../../escape");
        assert!(result.is_err(), "traversal should be blocked");

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn test_delete_path_file() {
        let tmp = temp_project();
        let tmp_str = tmp.to_string_lossy().to_string();

        create_file(&tmp_str, "to_delete.txt").unwrap();
        let canonical_tmp = tmp.canonicalize().unwrap();
        assert!(canonical_tmp.join("to_delete.txt").exists());

        delete_path(&tmp_str, "to_delete.txt").unwrap();
        assert!(
            !canonical_tmp.join("to_delete.txt").exists(),
            "file should be gone after delete"
        );

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn test_delete_path_directory() {
        let tmp = temp_project();
        let tmp_str = tmp.to_string_lossy().to_string();
        let canonical_tmp = tmp.canonicalize().unwrap();

        create_directory(&tmp_str, "dir_to_del").unwrap();
        // Put a file inside so we test recursive delete
        std::fs::write(canonical_tmp.join("dir_to_del/inner.txt"), "data").unwrap();
        assert!(canonical_tmp.join("dir_to_del").is_dir());

        delete_path(&tmp_str, "dir_to_del").unwrap();
        assert!(
            !canonical_tmp.join("dir_to_del").exists(),
            "directory should be removed"
        );

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn test_delete_path_project_root_blocked() {
        let tmp = temp_project();
        let tmp_str = tmp.to_string_lossy().to_string();

        let result_empty = delete_path(&tmp_str, "");
        assert!(result_empty.is_err());
        let msg = result_empty.unwrap_err().to_string();
        assert!(msg.contains("Cannot delete project root"), "unexpected: {}", msg);

        let result_dot = delete_path(&tmp_str, ".");
        assert!(result_dot.is_err());
        let msg = result_dot.unwrap_err().to_string();
        assert!(msg.contains("Cannot delete project root"), "unexpected: {}", msg);

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn test_delete_path_protected_git_dir() {
        let tmp = temp_project();
        let tmp_str = tmp.to_string_lossy().to_string();
        let canonical_tmp = tmp.canonicalize().unwrap();

        // Create a .git directory
        std::fs::create_dir(canonical_tmp.join(".git")).unwrap();

        let result = delete_path(&tmp_str, ".git");
        assert!(result.is_err(), "deleting .git should be blocked");
        let msg = result.unwrap_err().to_string();
        assert!(
            msg.contains("protected directory"),
            "unexpected error: {}",
            msg
        );

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn test_delete_path_traversal_blocked() {
        let tmp = temp_project();
        let tmp_str = tmp.to_string_lossy().to_string();

        let result = delete_path(&tmp_str, "../sibling");
        assert!(result.is_err(), "traversal delete should be blocked");

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn test_rename_path_success() {
        let tmp = temp_project();
        let tmp_str = tmp.to_string_lossy().to_string();
        let canonical_tmp = tmp.canonicalize().unwrap();

        create_file(&tmp_str, "a.txt").unwrap();
        assert!(canonical_tmp.join("a.txt").exists());

        let entry = rename_path(&tmp_str, "a.txt", "b.txt").unwrap();
        assert_eq!(entry.name, "b.txt");
        assert!(!canonical_tmp.join("a.txt").exists(), "old file should be gone");
        assert!(canonical_tmp.join("b.txt").exists(), "new file should exist");

        let _ = std::fs::remove_dir_all(&tmp);
    }

    // -----------------------------------------------------------------------
    // Group C — Utility Functions
    // -----------------------------------------------------------------------

    #[test]
    fn test_detect_language_rust() {
        assert_eq!(detect_language("src/main.rs"), "rust");
    }

    #[test]
    fn test_detect_language_tsx() {
        assert_eq!(detect_language("components/App.tsx"), "tsx");
    }

    #[test]
    fn test_detect_language_unknown() {
        assert_eq!(detect_language("data.xyz"), "text");
    }

    #[test]
    fn test_detect_language_no_extension() {
        assert_eq!(detect_language("Makefile"), "text");
    }

    #[test]
    fn test_is_binary_content_with_null() {
        assert!(
            is_binary_content(b"hello\x00world"),
            "data with null byte should be binary"
        );
    }

    #[test]
    fn test_is_binary_content_text_only() {
        assert!(
            !is_binary_content(b"hello world"),
            "plain text should not be binary"
        );
    }

    #[test]
    fn test_fuzzy_score_match() {
        let score = fuzzy_score("app", "src/App.tsx");
        assert!(score.is_some(), "should match");
        assert!(
            score.unwrap() > 0,
            "score should be positive, got {}",
            score.unwrap()
        );
    }

    #[test]
    fn test_fuzzy_score_no_match() {
        let score = fuzzy_score("xyz", "App.tsx");
        assert!(score.is_none(), "should not match non-existent subsequence");
    }

    // -----------------------------------------------------------------------
    // Group D — Conflict Resolution
    // -----------------------------------------------------------------------

    #[test]
    fn test_resolve_conflict_no_conflict() {
        let tmp = temp_project();

        let result = resolve_conflict(&tmp, OsStr::new("brand_new.txt"), &ConflictStrategy::Skip).unwrap();
        assert!(result.is_some(), "no conflict should return Some");
        assert!(result.unwrap().ends_with("brand_new.txt"));

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn test_resolve_conflict_skip() {
        let tmp = temp_project();
        std::fs::write(tmp.join("existing.txt"), "data").unwrap();

        let result =
            resolve_conflict(&tmp, OsStr::new("existing.txt"), &ConflictStrategy::Skip).unwrap();
        assert!(result.is_none(), "Skip strategy should return None on conflict");

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn test_resolve_conflict_overwrite() {
        let tmp = temp_project();
        std::fs::write(tmp.join("existing.txt"), "data").unwrap();

        let result =
            resolve_conflict(&tmp, OsStr::new("existing.txt"), &ConflictStrategy::Overwrite)
                .unwrap();
        assert!(result.is_some(), "Overwrite should return Some");
        assert!(
            result.unwrap().ends_with("existing.txt"),
            "Overwrite should return the original path"
        );

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn test_resolve_conflict_auto_rename() {
        let tmp = temp_project();
        std::fs::write(tmp.join("a.txt"), "data").unwrap();

        let result =
            resolve_conflict(&tmp, OsStr::new("a.txt"), &ConflictStrategy::AutoRename).unwrap();
        assert!(result.is_some(), "AutoRename should return Some");
        let path = result.unwrap();
        let name = path.file_name().unwrap().to_string_lossy().to_string();
        assert_eq!(name, "a (1).txt", "should rename to a (1).txt, got {}", name);

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn test_resolve_conflict_auto_rename_no_extension() {
        let tmp = temp_project();
        std::fs::create_dir(tmp.join("docs")).unwrap();

        let result =
            resolve_conflict(&tmp, OsStr::new("docs"), &ConflictStrategy::AutoRename).unwrap();
        assert!(result.is_some(), "AutoRename should return Some");
        let path = result.unwrap();
        let name = path.file_name().unwrap().to_string_lossy().to_string();
        assert_eq!(name, "docs (1)", "should rename to docs (1), got {}", name);

        let _ = std::fs::remove_dir_all(&tmp);
    }

    // -----------------------------------------------------------------------
    // Group E — Read / Write / List
    // -----------------------------------------------------------------------

    #[test]
    fn test_read_file_success() {
        let tmp = temp_project();
        let tmp_str = tmp.to_string_lossy().to_string();

        create_file(&tmp_str, "readme.rs").unwrap();
        write_file(&tmp_str, "readme.rs", "fn main() {}").unwrap();

        let fc = read_file(&tmp_str, "readme.rs").unwrap();
        assert_eq!(fc.content, "fn main() {}");
        assert_eq!(fc.language, "rust");
        assert!(!fc.is_binary);
        assert_eq!(fc.path, "readme.rs");
        assert!(fc.size > 0);

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn test_read_file_binary_detection() {
        let tmp = temp_project();
        let tmp_str = tmp.to_string_lossy().to_string();
        let canonical_tmp = tmp.canonicalize().unwrap();

        create_file(&tmp_str, "image.bin").unwrap();
        std::fs::write(canonical_tmp.join("image.bin"), b"header\x00\x01\x02data").unwrap();

        let fc = read_file(&tmp_str, "image.bin").unwrap();
        assert!(fc.is_binary, "file with null byte should be binary");
        assert!(fc.content.is_empty(), "binary file content should be empty string");

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn test_read_file_traversal_blocked() {
        let tmp = temp_project();
        let tmp_str = tmp.to_string_lossy().to_string();

        let result = read_file(&tmp_str, "../secret.txt");
        assert!(result.is_err(), "traversal read should be blocked");

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn test_write_file_success() {
        let tmp = temp_project();
        let tmp_str = tmp.to_string_lossy().to_string();
        let canonical_tmp = tmp.canonicalize().unwrap();

        create_file(&tmp_str, "output.txt").unwrap();
        write_file(&tmp_str, "output.txt", "hello world").unwrap();

        let on_disk = std::fs::read_to_string(canonical_tmp.join("output.txt")).unwrap();
        assert_eq!(on_disk, "hello world");

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn test_write_file_traversal_blocked() {
        let tmp = temp_project();
        let tmp_str = tmp.to_string_lossy().to_string();

        let result = write_file(&tmp_str, "../escape.txt", "evil");
        assert!(result.is_err(), "traversal write should be blocked");

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn test_list_directory_root() {
        let tmp = temp_project();
        let tmp_str = tmp.to_string_lossy().to_string();

        create_directory(&tmp_str, "alpha_dir").unwrap();
        create_file(&tmp_str, "beta.txt").unwrap();
        create_file(&tmp_str, "gamma.rs").unwrap();

        let entries = list_directory(&tmp_str, "").unwrap();

        // Should have at least 3 entries
        assert!(entries.len() >= 3, "expected at least 3 entries, got {}", entries.len());

        // Directories should come first
        let first_dir_idx = entries.iter().position(|e| e.name == "alpha_dir");
        let first_file_idx = entries.iter().position(|e| e.name == "beta.txt");
        assert!(
            first_dir_idx.is_some() && first_file_idx.is_some(),
            "expected both dir and file entries"
        );
        assert!(
            first_dir_idx.unwrap() < first_file_idx.unwrap(),
            "directories should sort before files"
        );

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn test_list_directory_skips_hidden() {
        let tmp = temp_project();
        let tmp_str = tmp.to_string_lossy().to_string();
        let canonical_tmp = tmp.canonicalize().unwrap();

        create_file(&tmp_str, "visible.txt").unwrap();
        // Create a hidden file directly (bypassing create_file which might reject dotfiles)
        std::fs::write(canonical_tmp.join(".hidden_file"), "secret").unwrap();

        let entries = list_directory(&tmp_str, "").unwrap();
        let hidden = entries.iter().find(|e| e.name == ".hidden_file");
        assert!(
            hidden.is_none(),
            "hidden files should be excluded from listing"
        );

        let visible = entries.iter().find(|e| e.name == "visible.txt");
        assert!(visible.is_some(), "visible file should be in listing");

        let _ = std::fs::remove_dir_all(&tmp);
    }

    // -----------------------------------------------------------------------
    // Group F — External Copy
    // -----------------------------------------------------------------------

    #[test]
    fn test_copy_external_entries_file_success() {
        let tmp = temp_project();
        let tmp_str = tmp.to_string_lossy().to_string();

        // Create an external source directory with a file
        let external = std::env::temp_dir().join(format!(
            "flow-orche-ext-src-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&external).unwrap();
        std::fs::write(external.join("ext_file.txt"), "external content").unwrap();

        let source_path = external.join("ext_file.txt").to_string_lossy().to_string();

        let result = copy_external_entries(
            &tmp_str,
            "",
            vec![source_path],
            ConflictStrategy::Skip,
        )
        .unwrap();

        assert_eq!(result.entries.len(), 1);
        assert_eq!(result.entries[0].name, "ext_file.txt");
        assert!(result.skipped.is_empty());

        let canonical_tmp = tmp.canonicalize().unwrap();
        let copied = std::fs::read_to_string(canonical_tmp.join("ext_file.txt")).unwrap();
        assert_eq!(copied, "external content");

        let _ = std::fs::remove_dir_all(&tmp);
        let _ = std::fs::remove_dir_all(&external);
    }

    #[test]
    fn test_copy_external_entries_skip_strategy() {
        let tmp = temp_project();
        let tmp_str = tmp.to_string_lossy().to_string();

        // Create an existing file in the project
        create_file(&tmp_str, "conflict.txt").unwrap();
        write_file(&tmp_str, "conflict.txt", "original").unwrap();

        // Create an external file with the same name
        let external = std::env::temp_dir().join(format!(
            "flow-orche-ext-skip-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&external).unwrap();
        std::fs::write(external.join("conflict.txt"), "new content").unwrap();

        let source_path = external.join("conflict.txt").to_string_lossy().to_string();

        let result = copy_external_entries(
            &tmp_str,
            "",
            vec![source_path.clone()],
            ConflictStrategy::Skip,
        )
        .unwrap();

        assert!(result.entries.is_empty(), "skipped file should not appear in entries");
        assert_eq!(result.skipped.len(), 1, "should have one skipped entry");
        assert_eq!(result.skipped[0], source_path);

        // Verify original content is preserved
        let fc = read_file(&tmp_str, "conflict.txt").unwrap();
        assert_eq!(fc.content, "original", "original content should be preserved");

        let _ = std::fs::remove_dir_all(&tmp);
        let _ = std::fs::remove_dir_all(&external);
    }

    #[test]
    fn test_copy_external_entries_auto_rename() {
        let tmp = temp_project();
        let tmp_str = tmp.to_string_lossy().to_string();

        // Create an existing file in the project
        create_file(&tmp_str, "doc.txt").unwrap();
        write_file(&tmp_str, "doc.txt", "original").unwrap();

        // Create an external file with the same name
        let external = std::env::temp_dir().join(format!(
            "flow-orche-ext-rename-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&external).unwrap();
        std::fs::write(external.join("doc.txt"), "renamed content").unwrap();

        let source_path = external.join("doc.txt").to_string_lossy().to_string();

        let result = copy_external_entries(
            &tmp_str,
            "",
            vec![source_path],
            ConflictStrategy::AutoRename,
        )
        .unwrap();

        assert_eq!(result.entries.len(), 1, "should have one copied entry");
        assert_eq!(
            result.entries[0].name, "doc (1).txt",
            "auto-renamed file should be doc (1).txt, got {}",
            result.entries[0].name
        );
        assert!(result.skipped.is_empty());

        // Verify original is untouched
        let original = read_file(&tmp_str, "doc.txt").unwrap();
        assert_eq!(original.content, "original");

        // Verify renamed copy exists
        let canonical_tmp = tmp.canonicalize().unwrap();
        let renamed = std::fs::read_to_string(canonical_tmp.join("doc (1).txt")).unwrap();
        assert_eq!(renamed, "renamed content");

        let _ = std::fs::remove_dir_all(&tmp);
        let _ = std::fs::remove_dir_all(&external);
    }
}
