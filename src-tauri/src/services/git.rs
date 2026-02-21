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

/// Parse git log output using NUL-byte separated fields.
/// Format: %H%x00%h%x00%s%x00%an%x00%ae%x00%aI%x00%P%x00%D
/// Each commit is separated by a newline.
pub fn get_log(repo_path: &Path, limit: u32) -> Result<Vec<GitCommit>, AppError> {
    let limit_str = limit.to_string();
    let output = run_git(
        repo_path,
        &[
            "log",
            "--format=%H%x00%h%x00%s%x00%an%x00%ae%x00%aI%x00%P%x00%D",
            "--topo-order",
            "-n",
            &limit_str,
            "--all",
        ],
    )?;

    let commits: Vec<GitCommit> = output
        .lines()
        .filter(|line| !line.is_empty())
        .filter_map(|line| {
            let fields: Vec<&str> = line.split('\0').collect();
            if fields.len() < 7 {
                warn!("Skipping malformed git log line: {} fields", fields.len());
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

            Some(GitCommit {
                hash: fields[0].to_string(),
                short_hash: fields[1].to_string(),
                message: fields[2].to_string(),
                author_name: fields[3].to_string(),
                author_email: fields[4].to_string(),
                date: fields[5].to_string(),
                parents,
                refs,
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
pub fn get_graph_data(repo_path: &Path, limit: u32) -> Result<GitGraphData, AppError> {
    let commits = get_log(repo_path, limit)?;
    let branches = get_branches(repo_path)?;
    let worktrees = get_worktrees(repo_path)?;
    let status = get_status(repo_path)?;

    Ok(GitGraphData {
        commits,
        branches,
        worktrees,
        status,
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
}
