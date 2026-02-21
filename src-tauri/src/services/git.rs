use crate::errors::AppError;
use crate::models::git::*;
use std::path::Path;
use std::process::Command;
use std::sync::OnceLock;
use tracing::{info, warn};

const GIT_SEARCH_PATHS: &[&str] = &[
    "/opt/homebrew/bin/git",
    "/usr/local/bin/git",
    "/usr/bin/git",
];

static GIT_PATH: OnceLock<String> = OnceLock::new();

fn resolve_git_path() -> Result<&'static str, AppError> {
    let path = GIT_PATH.get_or_init(|| {
        // First try PATH-based lookup
        if let Ok(output) = Command::new("which").arg("git").output() {
            if output.status.success() {
                let p = String::from_utf8_lossy(&output.stdout).trim().to_string();
                if !p.is_empty() {
                    info!("Found git via PATH: {}", p);
                    return p;
                }
            }
        }
        // Fallback to known locations
        for candidate in GIT_SEARCH_PATHS {
            if Path::new(candidate).exists() {
                info!("Found git at: {}", candidate);
                return candidate.to_string();
            }
        }
        String::new()
    });

    if path.is_empty() {
        Err(AppError::Git(
            "git not found. Install git via Homebrew: brew install git".into(),
        ))
    } else {
        Ok(path.as_str())
    }
}

fn run_git(repo_path: &Path, args: &[&str]) -> Result<String, AppError> {
    let git = resolve_git_path()?;
    let output = Command::new(git)
        .args(args)
        .current_dir(repo_path)
        .output()
        .map_err(|e| AppError::Git(format!("Failed to execute git: {}", e)))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::Git(format!(
            "git {} failed: {}",
            args.first().unwrap_or(&"<unknown>"),
            stderr.trim()
        )));
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

/// Detect if a commit body contains a Co-Authored-By line referencing Claude,
/// indicating an agent-authored commit.
fn detect_agent_commit(body: &str) -> bool {
    body.lines().any(|line| {
        let lower = line.to_lowercase();
        lower.contains("co-authored-by:") && lower.contains("claude")
    })
}

/// Parse git log output using NUL-byte separated fields.
/// Format: %H%x00%h%x00%s%x00%an%x00%ae%x00%aI%x00%P%x00%D%x00%b
/// Each commit record is separated by ASCII RS (\x1e).
pub fn get_log(repo_path: &Path, limit: u32) -> Result<Vec<GitCommit>, AppError> {
    let limit_str = limit.to_string();
    let output = run_git(
        repo_path,
        &[
            "log",
            "--format=%H%x00%h%x00%s%x00%an%x00%ae%x00%aI%x00%P%x00%D%x00%b%x1e",
            "--topo-order",
            "-n",
            &limit_str,
            "--all",
        ],
    )?;

    let commits: Vec<GitCommit> = output
        .split('\x1e')
        .map(|record| record.trim())
        .filter(|record| !record.is_empty())
        .filter_map(|record| {
            let fields: Vec<&str> = record.split('\0').collect();
            if fields.len() < 7 {
                warn!("Skipping malformed git log record: {} fields", fields.len());
                return None;
            }

            let parents: Vec<String> = fields[6]
                .split_whitespace()
                .filter(|s| !s.is_empty())
                .map(String::from)
                .collect();

            let refs = if fields.len() > 7 && !fields[7].is_empty() {
                parse_refs(fields[7])
            } else {
                Vec::new()
            };

            let body = if fields.len() > 8 { fields[8].trim() } else { "" };
            let is_agent_commit = detect_agent_commit(body);

            Some(GitCommit {
                hash: fields[0].to_string(),
                short_hash: fields[1].to_string(),
                message: fields[2].to_string(),
                author_name: fields[3].to_string(),
                author_email: fields[4].to_string(),
                date: fields[5].to_string(),
                parents,
                refs,
                is_agent_commit,
            })
        })
        .collect();

    Ok(commits)
}

fn parse_refs(decorations: &str) -> Vec<GitRef> {
    decorations
        .split(", ")
        .filter(|s| !s.is_empty())
        .map(|s| {
            let trimmed = s.trim();
            if trimmed.starts_with("HEAD -> ") {
                GitRef {
                    name: trimmed.strip_prefix("HEAD -> ").unwrap_or(trimmed).to_string(),
                    ref_type: GitRefType::Head,
                }
            } else if trimmed.starts_with("tag: ") {
                GitRef {
                    name: trimmed.strip_prefix("tag: ").unwrap_or(trimmed).to_string(),
                    ref_type: GitRefType::Tag,
                }
            } else if trimmed.contains('/') && !trimmed.starts_with("refs/") {
                // e.g. "origin/main"
                GitRef {
                    name: trimmed.to_string(),
                    ref_type: GitRefType::RemoteBranch,
                }
            } else {
                GitRef {
                    name: trimmed.to_string(),
                    ref_type: GitRefType::LocalBranch,
                }
            }
        })
        .collect()
}

/// Parse git branch output.
/// Format: %(refname:short)\t%(objectname:short)\t%(HEAD)\t%(upstream:short)\t%(refname)
/// The full %(refname) is used to reliably detect remote vs local branches,
/// since %(refname:short) strips the refs/remotes/ prefix making slashed local
/// branches (e.g. feature/foo) indistinguishable from remote branches.
pub fn get_branches(repo_path: &Path) -> Result<Vec<GitBranch>, AppError> {
    let output = run_git(
        repo_path,
        &[
            "branch",
            "-a",
            "--format=%(refname:short)\t%(objectname:short)\t%(HEAD)\t%(upstream:short)\t%(refname)",
        ],
    )?;

    let branches: Vec<GitBranch> = output
        .lines()
        .filter(|line| !line.is_empty())
        .filter_map(|line| {
            let fields: Vec<&str> = line.split('\t').collect();
            if fields.len() < 4 {
                warn!("Skipping malformed git branch line: {:?}", line);
                return None;
            }

            let name = fields[0].to_string();
            // Use full refname (field 4) to reliably detect remote branches
            let full_ref = fields.get(4).unwrap_or(&"");
            let is_remote = full_ref.starts_with("refs/remotes/");
            let is_head = fields[2].trim() == "*";
            let tracking = fields
                .get(3)
                .filter(|s| !s.is_empty())
                .map(|s| s.to_string());

            Some(GitBranch {
                name,
                is_remote,
                is_head,
                commit_hash: fields[1].to_string(),
                tracking_branch: tracking,
            })
        })
        .collect();

    Ok(branches)
}

/// Parse `git worktree list --porcelain` output.
/// Records are separated by blank lines.
pub fn get_worktrees(repo_path: &Path) -> Result<Vec<GitWorktree>, AppError> {
    let output = run_git(repo_path, &["worktree", "list", "--porcelain"])?;

    let mut worktrees = Vec::new();
    let mut current_path = String::new();
    let mut current_hash = String::new();
    let mut current_branch: Option<String> = None;
    let mut is_bare = false;
    let mut is_first = true;

    for line in output.lines() {
        if line.is_empty() {
            if !current_path.is_empty() {
                worktrees.push(GitWorktree {
                    path: current_path.clone(),
                    branch: current_branch.take(),
                    commit_hash: current_hash.clone(),
                    is_bare,
                    is_main: is_first,
                    status: None,
                });
                is_first = false;
            }
            current_path.clear();
            current_hash.clear();
            current_branch = None;
            is_bare = false;
            continue;
        }

        if let Some(path) = line.strip_prefix("worktree ") {
            current_path = path.to_string();
        } else if let Some(hash) = line.strip_prefix("HEAD ") {
            current_hash = hash.to_string();
        } else if let Some(branch) = line.strip_prefix("branch ") {
            // refs/heads/main -> main
            current_branch = Some(
                branch
                    .strip_prefix("refs/heads/")
                    .unwrap_or(branch)
                    .to_string(),
            );
        } else if line == "bare" {
            is_bare = true;
        }
    }

    // Handle last record (no trailing blank line)
    if !current_path.is_empty() {
        worktrees.push(GitWorktree {
            path: current_path,
            branch: current_branch,
            commit_hash: current_hash,
            is_bare,
            is_main: is_first,
            status: None,
        });
    }

    Ok(worktrees)
}

/// Parse `git status --porcelain` to count staged/unstaged/untracked files.
pub fn get_status(repo_path: &Path) -> Result<GitStatus, AppError> {
    let output = run_git(repo_path, &["status", "--porcelain"])?;

    let mut staged = 0u32;
    let mut unstaged = 0u32;
    let mut untracked = 0u32;

    for line in output.lines() {
        if line.len() < 2 {
            continue;
        }
        let bytes = line.as_bytes();
        let x = bytes[0];
        let y = bytes[1];

        if x == b'?' && y == b'?' {
            untracked += 1;
        } else {
            // X position: staged changes (not space, not ?)
            if x != b' ' && x != b'?' {
                staged += 1;
            }
            // Y position: unstaged changes (not space, not ?)
            if y != b' ' && y != b'?' {
                unstaged += 1;
            }
        }
    }

    Ok(GitStatus {
        is_dirty: staged > 0 || unstaged > 0 || untracked > 0,
        staged_count: staged,
        unstaged_count: unstaged,
        untracked_count: untracked,
    })
}

/// Combined query that returns all git data in a single IPC call.
/// Each worktree is enriched with its own GitStatus for per-worktree dirty state.
pub fn get_graph_data(repo_path: &Path, limit: u32) -> Result<GitGraphData, AppError> {
    let commits = get_log(repo_path, limit)?;
    let branches = get_branches(repo_path)?;
    let mut worktrees = get_worktrees(repo_path)?;
    let status = get_status(repo_path)?;

    // Enrich each worktree with its own status
    for wt in &mut worktrees {
        if wt.is_bare {
            continue;
        }
        let wt_path = Path::new(&wt.path);
        match get_status(wt_path) {
            Ok(s) => wt.status = Some(s),
            Err(e) => {
                warn!("Failed to get status for worktree {}: {}", wt.path, e);
            }
        }
    }

    Ok(GitGraphData {
        commits,
        branches,
        worktrees,
        status,
    })
}

// ---------------------------------------------------------------------------
// Write operations
// ---------------------------------------------------------------------------

/// Remove a git worktree.
pub fn remove_worktree(repo_path: &Path, worktree_path: &str, force: bool) -> Result<(), AppError> {
    let mut args = vec!["worktree", "remove"];
    if force {
        args.push("--force");
    }
    args.push(worktree_path);
    run_git(repo_path, &args)?;
    info!("Removed worktree: {}", worktree_path);
    Ok(())
}

/// Push a branch to a remote.
pub fn push_branch(repo_path: &Path, branch_name: &str, remote: &str) -> Result<(), AppError> {
    run_git(repo_path, &["push", remote, branch_name])?;
    info!("Pushed branch '{}' to '{}'", branch_name, remote);
    Ok(())
}

/// Delete a local branch.
pub fn delete_branch(repo_path: &Path, branch_name: &str, force: bool) -> Result<(), AppError> {
    let flag = if force { "-D" } else { "-d" };
    run_git(repo_path, &["branch", flag, branch_name])?;
    info!("Deleted branch: {}", branch_name);
    Ok(())
}

// ---------------------------------------------------------------------------
// Working tree changes
// ---------------------------------------------------------------------------

/// Get uncommitted changes for a specific worktree.
/// Returns staged, unstaged, and untracked file diffs.
pub fn get_working_changes(worktree_path: &Path) -> Result<WorkingChanges, AppError> {
    // 1. Staged changes (index vs HEAD)
    let staged_raw = run_git(worktree_path, &["diff", "--cached"])?;
    let staged = parse_unified_diff(&staged_raw);

    // 2. Unstaged changes (working tree vs index)
    let unstaged_raw = run_git(worktree_path, &["diff"])?;
    let unstaged = parse_unified_diff(&unstaged_raw);

    // 3. Untracked files — read content to build synthetic diff
    let untracked_raw = run_git(
        worktree_path,
        &["ls-files", "--others", "--exclude-standard"],
    )?;
    const MAX_UNTRACKED_FILE_SIZE: u64 = 1_048_576; // 1MB
    let canonical_root = worktree_path.canonicalize().unwrap_or_else(|_| worktree_path.to_path_buf());

    let untracked: Vec<FileDiff> = untracked_raw
        .lines()
        .filter(|l| !l.is_empty())
        .map(|rel_path| {
            let full_path = worktree_path.join(rel_path);

            // Path traversal guard: ensure resolved path stays within worktree
            if let Ok(canonical) = full_path.canonicalize() {
                if !canonical.starts_with(&canonical_root) {
                    warn!("Skipping suspicious path outside worktree: {}", rel_path);
                    return FileDiff {
                        path: rel_path.to_string(),
                        status: FileStatus::Untracked,
                        insertions: 0,
                        deletions: 0,
                        patch: "Path outside worktree".to_string(),
                    };
                }
            }

            // Size guard: skip files larger than 1MB
            match std::fs::metadata(&full_path) {
                Ok(m) if m.len() > MAX_UNTRACKED_FILE_SIZE => {
                    return FileDiff {
                        path: rel_path.to_string(),
                        status: FileStatus::Untracked,
                        insertions: 0,
                        deletions: 0,
                        patch: format!("File too large to display ({:.1} KB)", m.len() as f64 / 1024.0),
                    };
                }
                _ => {}
            }

            match std::fs::read(&full_path) {
                Ok(bytes) => {
                    // Detect binary: NUL byte in first 8KB
                    let check_len = bytes.len().min(8192);
                    if bytes[..check_len].contains(&0) {
                        return FileDiff {
                            path: rel_path.to_string(),
                            status: FileStatus::Untracked,
                            insertions: 0,
                            deletions: 0,
                            patch: "Binary file".to_string(),
                        };
                    }
                    let content = String::from_utf8_lossy(&bytes);
                    let lines: Vec<&str> = content.lines().collect();
                    let line_count = lines.len() as u32;
                    // Build synthetic unified diff patch
                    let mut patch = format!(
                        "diff --git a/{p} b/{p}\nnew file mode 100644\n--- /dev/null\n+++ b/{p}\n@@ -0,0 +1,{n} @@\n",
                        p = rel_path,
                        n = line_count
                    );
                    for line in &lines {
                        patch.push('+');
                        patch.push_str(line);
                        patch.push('\n');
                    }
                    FileDiff {
                        path: rel_path.to_string(),
                        status: FileStatus::Untracked,
                        insertions: line_count,
                        deletions: 0,
                        patch,
                    }
                }
                Err(e) => {
                    warn!("Failed to read untracked file {}: {}", rel_path, e);
                    FileDiff {
                        path: rel_path.to_string(),
                        status: FileStatus::Untracked,
                        insertions: 0,
                        deletions: 0,
                        patch: format!("Failed to read: {}", e),
                    }
                }
            }
        })
        .collect();

    Ok(WorkingChanges::new(
        worktree_path.to_string_lossy().to_string(),
        staged,
        unstaged,
        untracked,
    ))
}

// ---------------------------------------------------------------------------
// Commit detail
// ---------------------------------------------------------------------------

/// Parse a unified diff output into a list of per-file diffs.
fn parse_unified_diff(raw: &str) -> Vec<FileDiff> {
    // Split on "diff --git " boundaries
    let sections: Vec<&str> = {
        let mut result = Vec::new();
        let mut rest = raw;
        while let Some(pos) = rest.find("diff --git ") {
            // Text before the first "diff --git" (commit metadata) is intentionally skipped
            rest = &rest[pos..];
            // Find the next "diff --git " after the current one
            let next = rest[1..].find("diff --git ").map(|p| p + 1);
            match next {
                Some(next_pos) => {
                    result.push(&rest[..next_pos]);
                    rest = &rest[next_pos..];
                }
                None => {
                    result.push(rest);
                    break;
                }
            }
        }
        result
    };

    sections
        .iter()
        .filter_map(|section| {
            let first_line = match section.lines().next() {
                Some(l) => l,
                None => {
                    warn!("Skipping empty diff section");
                    return None;
                }
            };
            // Extract path from "diff --git a/PATH b/PATH"
            let path = match first_line
                .strip_prefix("diff --git ")
                .and_then(|s| s.rsplit_once(" b/"))
                .map(|(_, p)| p.to_string())
            {
                Some(p) => p,
                None => {
                    warn!("Failed to parse file path from diff header: {:?}", first_line);
                    return None;
                }
            };

            // Check for binary files
            if section.contains("Binary files") {
                return Some(FileDiff {
                    path,
                    status: FileStatus::Modified,
                    insertions: 0,
                    deletions: 0,
                    patch: "Binary file".to_string(),
                });
            }

            // Detect status
            let status = if section.contains("\nnew file mode") {
                FileStatus::Added
            } else if section.contains("\ndeleted file mode") {
                FileStatus::Deleted
            } else if section.contains("\nrename from") {
                FileStatus::Renamed
            } else {
                FileStatus::Modified
            };

            // Count insertions and deletions (lines starting with +/- but not +++/---)
            let mut insertions = 0u32;
            let mut deletions = 0u32;
            for line in section.lines() {
                if line.starts_with('+') && !line.starts_with("+++") {
                    insertions += 1;
                } else if line.starts_with('-') && !line.starts_with("---") {
                    deletions += 1;
                }
            }

            Some(FileDiff {
                path,
                status,
                insertions,
                deletions,
                patch: section.to_string(),
            })
        })
        .collect()
}

/// Get detailed information about a single commit, including full message
/// and per-file diffs.
pub fn get_commit_detail(repo_path: &Path, hash: &str) -> Result<CommitDetail, AppError> {
    // 1. Validate hash: hex chars only, 4-40 length
    if hash.len() < 4
        || hash.len() > 40
        || !hash.chars().all(|c| c.is_ascii_hexdigit())
    {
        return Err(AppError::InvalidInput(format!(
            "Invalid commit hash: '{}'. Must be 4-40 hex characters.",
            hash
        )));
    }

    // 2. Get full commit message
    let full_message = run_git(repo_path, &["log", "-1", "--format=%B", hash])?;
    let full_message = full_message.trim().to_string();

    // 3. Get unified diff
    let diff_output = run_git(repo_path, &["show", "--format=", "-p", hash])?;

    // 4. Parse diff into per-file diffs
    let files = parse_unified_diff(&diff_output);

    // 5. Detect agent commit
    let is_agent_commit = detect_agent_commit(&full_message);

    // 6. Compute aggregate stats
    let insertions: u32 = files.iter().map(|f| f.insertions).sum();
    let deletions: u32 = files.iter().map(|f| f.deletions).sum();
    let stats = DiffStats {
        files_changed: files.len() as u32,
        insertions,
        deletions,
    };

    Ok(CommitDetail {
        hash: hash.to_string(),
        full_message,
        is_agent_commit,
        stats,
        files,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn create_test_repo() -> std::path::PathBuf {
        let tmp = std::env::temp_dir().join(format!("flow-orche-git-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&tmp).unwrap();

        // Init repo
        Command::new("git")
            .args(["init"])
            .current_dir(&tmp)
            .output()
            .unwrap();

        Command::new("git")
            .args(["config", "user.email", "test@test.com"])
            .current_dir(&tmp)
            .output()
            .unwrap();

        Command::new("git")
            .args(["config", "user.name", "Test"])
            .current_dir(&tmp)
            .output()
            .unwrap();

        // Create initial commit
        fs::write(tmp.join("README.md"), "# Test").unwrap();
        Command::new("git")
            .args(["add", "."])
            .current_dir(&tmp)
            .output()
            .unwrap();
        Command::new("git")
            .args(["commit", "-m", "initial commit"])
            .current_dir(&tmp)
            .output()
            .unwrap();

        tmp
    }

    #[test]
    fn test_get_log() {
        let repo = create_test_repo();
        let commits = get_log(&repo, 10).unwrap();
        assert_eq!(commits.len(), 1);
        assert_eq!(commits[0].message, "initial commit");
        assert!(!commits[0].hash.is_empty());
        assert!(!commits[0].short_hash.is_empty());
        assert!(!commits[0].is_agent_commit);
        fs::remove_dir_all(&repo).ok();
    }

    #[test]
    fn test_get_branches() {
        let repo = create_test_repo();
        let branches = get_branches(&repo).unwrap();
        assert!(!branches.is_empty());
        // Should have at least one branch (main or master)
        let has_default = branches.iter().any(|b| b.name == "main" || b.name == "master");
        assert!(has_default, "Should have main or master branch");
        fs::remove_dir_all(&repo).ok();
    }

    #[test]
    fn test_get_worktrees() {
        let repo = create_test_repo();
        let worktrees = get_worktrees(&repo).unwrap();
        assert_eq!(worktrees.len(), 1);
        assert!(worktrees[0].is_main);
        assert!(worktrees[0].branch.is_some());
        fs::remove_dir_all(&repo).ok();
    }

    #[test]
    fn test_get_status_clean() {
        let repo = create_test_repo();
        let status = get_status(&repo).unwrap();
        assert!(!status.is_dirty);
        assert_eq!(status.staged_count, 0);
        assert_eq!(status.unstaged_count, 0);
        assert_eq!(status.untracked_count, 0);
        fs::remove_dir_all(&repo).ok();
    }

    #[test]
    fn test_get_status_dirty() {
        let repo = create_test_repo();
        // Create untracked file
        fs::write(repo.join("new_file.txt"), "hello").unwrap();
        let status = get_status(&repo).unwrap();
        assert!(status.is_dirty);
        assert_eq!(status.untracked_count, 1);
        fs::remove_dir_all(&repo).ok();
    }

    #[test]
    fn test_get_graph_data() {
        let repo = create_test_repo();
        let data = get_graph_data(&repo, 10).unwrap();
        assert_eq!(data.commits.len(), 1);
        assert!(!data.branches.is_empty());
        assert!(!data.worktrees.is_empty());
        assert!(!data.status.is_dirty);
        fs::remove_dir_all(&repo).ok();
    }

    #[test]
    fn test_parse_refs() {
        let refs = parse_refs("HEAD -> main, origin/main, tag: v1.0");
        assert_eq!(refs.len(), 3);
        assert!(matches!(refs[0].ref_type, GitRefType::Head));
        assert_eq!(refs[0].name, "main");
        assert!(matches!(refs[1].ref_type, GitRefType::RemoteBranch));
        assert_eq!(refs[1].name, "origin/main");
        assert!(matches!(refs[2].ref_type, GitRefType::Tag));
        assert_eq!(refs[2].name, "v1.0");
    }

    #[test]
    fn test_detect_agent_commit_positive() {
        let body = "feat: add new feature\n\nCo-Authored-By: Claude <noreply@anthropic.com>\n";
        assert!(detect_agent_commit(body));
    }

    #[test]
    fn test_detect_agent_commit_case_insensitive() {
        let body = "fix: something\n\nco-authored-by: claude Opus 4 <noreply@anthropic.com>\n";
        assert!(detect_agent_commit(body));
    }

    #[test]
    fn test_detect_agent_commit_negative() {
        let body = "feat: manual commit\n\nSigned-off-by: Developer <dev@example.com>\n";
        assert!(!detect_agent_commit(body));
    }

    #[test]
    fn test_detect_agent_commit_empty() {
        assert!(!detect_agent_commit(""));
        assert!(!detect_agent_commit("  \n  \n"));
    }

    #[test]
    fn test_parse_unified_diff_added_file() {
        let diff = "diff --git a/new.txt b/new.txt\nnew file mode 100644\nindex 0000000..1234567\n--- /dev/null\n+++ b/new.txt\n@@ -0,0 +1,3 @@\n+line 1\n+line 2\n+line 3\n";
        let files = parse_unified_diff(diff);
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].path, "new.txt");
        assert!(matches!(files[0].status, FileStatus::Added));
        assert_eq!(files[0].insertions, 3);
        assert_eq!(files[0].deletions, 0);
    }

    #[test]
    fn test_parse_unified_diff_modified_file() {
        let diff = "diff --git a/file.rs b/file.rs\nindex abc1234..def5678 100644\n--- a/file.rs\n+++ b/file.rs\n@@ -1,3 +1,4 @@\n line 1\n-old line\n+new line\n+added line\n line 3\n";
        let files = parse_unified_diff(diff);
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].path, "file.rs");
        assert!(matches!(files[0].status, FileStatus::Modified));
        assert_eq!(files[0].insertions, 2);
        assert_eq!(files[0].deletions, 1);
    }

    #[test]
    fn test_parse_unified_diff_deleted_file() {
        let diff = "diff --git a/old.txt b/old.txt\ndeleted file mode 100644\nindex 1234567..0000000\n--- a/old.txt\n+++ /dev/null\n@@ -1,2 +0,0 @@\n-line 1\n-line 2\n";
        let files = parse_unified_diff(diff);
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].path, "old.txt");
        assert!(matches!(files[0].status, FileStatus::Deleted));
        assert_eq!(files[0].insertions, 0);
        assert_eq!(files[0].deletions, 2);
    }

    #[test]
    fn test_parse_unified_diff_multiple_files() {
        let diff = "diff --git a/a.txt b/a.txt\nnew file mode 100644\n--- /dev/null\n+++ b/a.txt\n@@ -0,0 +1 @@\n+hello\ndiff --git a/b.txt b/b.txt\nindex abc..def 100644\n--- a/b.txt\n+++ b/b.txt\n@@ -1 +1 @@\n-old\n+new\n";
        let files = parse_unified_diff(diff);
        assert_eq!(files.len(), 2);
        assert_eq!(files[0].path, "a.txt");
        assert_eq!(files[1].path, "b.txt");
    }

    #[test]
    fn test_parse_unified_diff_binary_file() {
        let diff = "diff --git a/image.png b/image.png\nBinary files /dev/null and b/image.png differ\n";
        let files = parse_unified_diff(diff);
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].path, "image.png");
        assert_eq!(files[0].patch, "Binary file");
        assert_eq!(files[0].insertions, 0);
        assert_eq!(files[0].deletions, 0);
    }

    #[test]
    fn test_parse_unified_diff_renamed_file() {
        let diff = "diff --git a/old_name.txt b/new_name.txt\nsimilarity index 100%\nrename from old_name.txt\nrename to new_name.txt\n";
        let files = parse_unified_diff(diff);
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].path, "new_name.txt");
        assert!(matches!(files[0].status, FileStatus::Renamed));
    }

    #[test]
    fn test_get_commit_detail_invalid_hash() {
        let repo = create_test_repo();
        // Too short
        let result = get_commit_detail(&repo, "abc");
        assert!(result.is_err());
        // Non-hex chars
        let result = get_commit_detail(&repo, "zzzzzzzz");
        assert!(result.is_err());
        // Too long
        let result = get_commit_detail(&repo, &"a".repeat(41));
        assert!(result.is_err());
        fs::remove_dir_all(&repo).ok();
    }

    #[test]
    fn test_get_commit_detail_success() {
        let repo = create_test_repo();
        let commits = get_log(&repo, 1).unwrap();
        let hash = &commits[0].hash;
        let detail = get_commit_detail(&repo, hash).unwrap();
        assert_eq!(detail.hash, *hash);
        assert!(detail.full_message.contains("initial commit"));
        assert!(!detail.is_agent_commit);
        // The initial commit adds README.md
        assert!(detail.stats.files_changed >= 1);
        fs::remove_dir_all(&repo).ok();
    }

    #[test]
    fn test_get_log_agent_commit() {
        let repo = create_test_repo();
        // Create an agent commit
        fs::write(repo.join("agent.txt"), "agent work").unwrap();
        Command::new("git")
            .args(["add", "."])
            .current_dir(&repo)
            .output()
            .unwrap();
        Command::new("git")
            .args([
                "commit",
                "-m",
                "feat: agent work\n\nCo-Authored-By: Claude <noreply@anthropic.com>",
            ])
            .current_dir(&repo)
            .output()
            .unwrap();

        let commits = get_log(&repo, 10).unwrap();
        assert_eq!(commits.len(), 2);
        // Most recent commit (agent) is first
        assert!(commits[0].is_agent_commit);
        assert!(!commits[1].is_agent_commit);
        fs::remove_dir_all(&repo).ok();
    }
}
