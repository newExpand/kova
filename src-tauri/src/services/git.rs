use crate::errors::AppError;
use crate::models::git::*;
use std::path::Path;
use std::process::Command;
use std::sync::OnceLock;
use tracing::{error, info, warn};

/// Resolve a CLI binary path using `which` first, then falling back to known locations.
/// Results are cached in the provided `OnceLock` for the lifetime of the process.
fn resolve_cli_path(
    name: &str,
    search_paths: &[&str],
    cache: &'static OnceLock<String>,
    not_found_msg: &str,
) -> Result<&'static str, AppError> {
    let path = cache.get_or_init(|| {
        match Command::new("which").arg(name).output() {
            Ok(output) if output.status.success() => {
                let p = String::from_utf8_lossy(&output.stdout).trim().to_string();
                if !p.is_empty() {
                    info!("Found {} via PATH: {}", name, p);
                    return p;
                }
                warn!("'which {}' returned empty output", name);
            }
            Ok(output) => {
                warn!("'which {}' exited with status {}", name, output.status);
            }
            Err(e) => {
                warn!("Failed to run 'which {}': {}", name, e);
            }
        }
        for candidate in search_paths {
            if Path::new(candidate).exists() {
                info!("Found {} at: {}", name, candidate);
                return candidate.to_string();
            }
        }
        String::new()
    });

    if path.is_empty() {
        warn!("{} not found in PATH or known locations", name);
        Err(AppError::NotFound(not_found_msg.into()))
    } else {
        Ok(path.as_str())
    }
}

static GIT_PATH: OnceLock<String> = OnceLock::new();
const GIT_SEARCH_PATHS: &[&str] = &[
    "/opt/homebrew/bin/git",
    "/usr/local/bin/git",
    "/usr/bin/git",
];

fn resolve_git_path() -> Result<&'static str, AppError> {
    resolve_cli_path(
        "git",
        GIT_SEARCH_PATHS,
        &GIT_PATH,
        "git not found. Install git via Homebrew: brew install git",
    )
}

fn run_git(repo_path: &Path, args: &[&str]) -> Result<String, AppError> {
    let git = resolve_git_path()?;
    let output = Command::new(git)
        .args(args)
        .current_dir(repo_path)
        .env("LC_ALL", "C")
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
pub(crate) fn detect_agent_commit(body: &str) -> bool {
    body.lines().any(|line| {
        let lower = line.to_lowercase();
        lower.contains("co-authored-by:") && lower.contains("claude")
    })
}

/// Parse NUL-byte separated git log output into GitCommit structs.
/// Fields: hash, short_hash, subject, author_name, author_email, date, parents, refs,
/// and Co-Authored-By trailer value (valueonly format — no key prefix).
/// See `GIT_LOG_FORMAT` for the exact format string.
/// Shared by `get_log()` and `get_log_page()` to avoid duplication.
pub(crate) fn parse_log_output(output: &str) -> Vec<GitCommit> {
    output
        .lines()
        .filter(|line| !line.is_empty())
        .filter_map(|line| {
            let fields: Vec<&str> = line.split('\0').collect();
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

            let co_authored_by = if fields.len() > 8 { fields[8].trim() } else { "" };
            let is_agent_commit = !co_authored_by.is_empty()
                && co_authored_by.to_lowercase().contains("claude");

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
        .collect()
}

pub(crate) const GIT_LOG_FORMAT: &str = "--format=%H%x00%h%x00%s%x00%an%x00%ae%x00%aI%x00%P%x00%D%x00%(trailers:key=Co-Authored-By,valueonly,separator=%x20)";

pub fn get_log(repo_path: &Path, limit: u32) -> Result<Vec<GitCommit>, AppError> {
    let limit_str = limit.to_string();
    let output = run_git(
        repo_path,
        &["log", GIT_LOG_FORMAT, "--decorate=full", "--topo-order", "-n", &limit_str, "--all"],
    )?;
    Ok(parse_log_output(&output))
}

/// Paginated commit fetching with skip/limit for infinite scroll.
pub fn get_log_page(repo_path: &Path, skip: u32, limit: u32) -> Result<GitCommitsPage, AppError> {
    let skip_str = skip.to_string();
    let fetch_limit = limit + 1; // fetch one extra to detect has_more
    let fetch_str = fetch_limit.to_string();
    let output = run_git(
        repo_path,
        &[
            "log",
            GIT_LOG_FORMAT,
            "--decorate=full",
            "--topo-order",
            "--skip",
            &skip_str,
            "-n",
            &fetch_str,
            "--all",
        ],
    )?;

    let mut commits = parse_log_output(&output);
    let has_more = commits.len() > limit as usize;
    if has_more {
        commits.truncate(limit as usize);
    }

    Ok(GitCommitsPage { commits, has_more })
}

pub(crate) fn parse_refs(decorations: &str) -> Vec<GitRef> {
    decorations
        .split(", ")
        .filter(|s| !s.is_empty())
        .map(|s| {
            let trimmed = s.trim();

            // "HEAD -> refs/heads/branch-name" (attached HEAD)
            if let Some(rest) = trimmed.strip_prefix("HEAD -> ") {
                let name = rest
                    .strip_prefix("refs/heads/")
                    .unwrap_or(rest)
                    .to_string();
                return GitRef {
                    name,
                    ref_type: GitRefType::Head,
                };
            }

            // "HEAD" alone (detached HEAD)
            if trimmed == "HEAD" {
                return GitRef {
                    name: "HEAD".to_string(),
                    ref_type: GitRefType::Head,
                };
            }

            // "tag: refs/tags/v1.0"
            if let Some(rest) = trimmed.strip_prefix("tag: ") {
                let name = rest
                    .strip_prefix("refs/tags/")
                    .unwrap_or(rest)
                    .to_string();
                return GitRef {
                    name,
                    ref_type: GitRefType::Tag,
                };
            }

            // "refs/remotes/origin/main"
            if let Some(name) = trimmed.strip_prefix("refs/remotes/") {
                return GitRef {
                    name: name.to_string(),
                    ref_type: GitRefType::RemoteBranch,
                };
            }

            // "refs/heads/feat/lucky-draw"
            if let Some(name) = trimmed.strip_prefix("refs/heads/") {
                return GitRef {
                    name: name.to_string(),
                    ref_type: GitRefType::LocalBranch,
                };
            }

            // Fallback: treat unknown refs as local branches
            GitRef {
                name: trimmed.to_string(),
                ref_type: GitRefType::LocalBranch,
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
    let mut is_prunable = false;
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
                    is_prunable,
                    status: None,
                });
                is_first = false;
            }
            current_path.clear();
            current_hash.clear();
            current_branch = None;
            is_bare = false;
            is_prunable = false;
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
        } else if line.starts_with("prunable") {
            is_prunable = true;
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
            is_prunable,
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

    // Auto-prune stale worktrees if any are prunable (avoids unnecessary git calls every poll)
    let prunable_count = worktrees.iter().filter(|wt| wt.is_prunable).count();
    if prunable_count > 0 {
        info!("Detected {} stale (prunable) worktree entries, attempting prune", prunable_count);
        match prune_worktrees(repo_path) {
            Ok(()) => {
                // Only re-fetch if prune succeeded
                worktrees = get_worktrees(repo_path)?;
            }
            Err(e) => {
                warn!("Auto-prune failed (continuing): {}", e);
                // Do NOT re-fetch — prune failed, worktrees haven't changed.
                // Prunable entries will be filtered below.
            }
        }
    }
    // Filter out any remaining prunable entries (safety net)
    worktrees.retain(|wt| !wt.is_prunable);

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

/// Prune stale worktree metadata entries whose directories no longer exist.
pub fn prune_worktrees(repo_path: &Path) -> Result<(), AppError> {
    run_git(repo_path, &["worktree", "prune"])?;
    info!("Pruned stale worktrees in {}", repo_path.display());
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
    run_git(repo_path, &["branch", flag, "--", branch_name])?;
    info!("Deleted branch: {}", branch_name);
    Ok(())
}

/// Validate a branch name using git's own rules.
fn validate_branch_name(repo_path: &Path, name: &str) -> Result<(), AppError> {
    if name.is_empty() {
        return Err(AppError::InvalidInput("Branch name cannot be empty".into()));
    }
    let result = run_git_raw(repo_path, &["check-ref-format", "--branch", name])?;
    if !result.success {
        return Err(AppError::InvalidInput(format!(
            "Invalid branch name: '{}'",
            name
        )));
    }
    Ok(())
}

/// Create a new local branch at the given start point (commit hash or branch name).
pub fn create_branch(
    repo_path: &Path,
    branch_name: &str,
    start_point: &str,
) -> Result<(), AppError> {
    validate_branch_name(repo_path, branch_name)?;
    run_git(repo_path, &["branch", branch_name, start_point])?;
    info!(
        "Created branch '{}' at '{}'",
        branch_name, start_point
    );
    Ok(())
}

/// Switch the main worktree to the given branch.
pub fn switch_branch(repo_path: &Path, branch_name: &str) -> Result<(), AppError> {
    run_git(repo_path, &["switch", "--", branch_name])?;
    info!(
        "Switched to branch '{}' in {}",
        branch_name,
        repo_path.display()
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// Merge to Main operations
// ---------------------------------------------------------------------------

/// Output from a git command that may fail without being a hard error.
struct GitCommandOutput {
    success: bool,
    stdout: String,
    stderr: String,
}

/// Run a git command, returning structured output instead of erroring on failure.
fn run_git_raw(repo_path: &Path, args: &[&str]) -> Result<GitCommandOutput, AppError> {
    let git = resolve_git_path()?;
    let output = Command::new(git)
        .args(args)
        .current_dir(repo_path)
        .env("LC_ALL", "C")
        .output()
        .map_err(|e| AppError::Git(format!("Failed to execute git: {}", e)))?;

    Ok(GitCommandOutput {
        success: output.status.success(),
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
    })
}

/// Detect the default branch name (main, master, or HEAD branch of main worktree).
pub fn get_main_branch_name(repo_path: &Path) -> Result<String, AppError> {
    for name in &["main", "master"] {
        let result = run_git_raw(repo_path, &["rev-parse", "--verify", name])?;
        if result.success {
            return Ok(name.to_string());
        }
    }
    let branches = get_branches(repo_path)?;
    branches
        .iter()
        .find(|b| b.is_head && !b.is_remote)
        .map(|b| b.name.clone())
        .ok_or_else(|| AppError::Git("Cannot determine main branch name".into()))
}

/// Extract the worktree task name from a `.claude/worktrees/<name>` path.
fn extract_worktree_task_name(worktree_path: &str) -> Option<String> {
    if worktree_path.contains(".claude/worktrees/") {
        Path::new(worktree_path)
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
    } else {
        None
    }
}

/// Perform the full merge-to-main flow for a worktree branch.
///
/// Steps: fetch → rebase --autostash onto main → FF merge → cleanup.
/// Returns `ConflictsDetected` (not an error) when rebase hits conflicts.
pub fn merge_worktree_to_main(
    repo_path: &Path,
    worktree_path: &Path,
    feature_branch: &str,
    session_name: Option<&str>,
) -> Result<MergeToMainResult, AppError> {
    validate_worktree(worktree_path)?;

    // 0. Block merge if worktree has uncommitted changes
    let wt_status = get_status(worktree_path)?;
    if wt_status.is_dirty {
        let total = wt_status.staged_count + wt_status.unstaged_count + wt_status.untracked_count;
        info!(
            "Merge blocked: worktree '{}' has {} uncommitted changes",
            worktree_path.display(),
            total
        );
        return Ok(MergeToMainResult::dirty_worktree(
            feature_branch.to_string(),
            total,
        ));
    }

    let main_branch = get_main_branch_name(repo_path)?;
    info!(
        "Merge to main: {} -> {} (main: {})",
        feature_branch, main_branch, main_branch
    );

    // 1. Fetch from origin (non-fatal if no remote)
    match run_git_raw(repo_path, &["fetch", "origin"]) {
        Ok(r) if r.success => info!("Fetched from origin"),
        Ok(r) => warn!("git fetch origin failed (continuing): {}", r.stderr.trim()),
        Err(e) => warn!("git fetch failed (continuing): {}", e),
    }

    // 2. Rebase onto main with autostash
    let result = run_git_raw(worktree_path, &["rebase", "--autostash", &main_branch])?;

    if !result.success {
        let lower = result.stderr.to_lowercase();
        if lower.contains("conflict") || lower.contains("could not apply") {
            info!("Rebase conflicts detected for branch '{}'", feature_branch);
            return Ok(MergeToMainResult::conflicts(
                feature_branch.to_string(),
                result.stderr.trim().to_string(),
            ));
        }
        // Not a conflict — abort any partial rebase and return error
        if let Err(abort_err) = run_git_raw(worktree_path, &["rebase", "--abort"]) {
            warn!("Failed to abort partial rebase: {}", abort_err);
            return Err(AppError::Git(format!(
                "Rebase failed: {}. Automatic abort also failed: {}. Manual 'git rebase --abort' may be needed.",
                result.stderr.trim(),
                abort_err
            )));
        }
        return Err(AppError::Git(format!(
            "Rebase failed: {}",
            result.stderr.trim()
        )));
    }

    info!("Rebase successful for '{}'", feature_branch);

    // 3. Ensure main worktree is on the main branch, then FF merge
    run_git(repo_path, &["checkout", &main_branch])?;
    run_git(repo_path, &["merge", "--ff-only", feature_branch])?;
    let hash = run_git(repo_path, &["rev-parse", "--short", "HEAD"])?;
    let merge_hash = hash.trim().to_string();
    info!(
        "FF merged '{}' into '{}' at {}",
        feature_branch, main_branch, merge_hash
    );

    // 4. Cleanup
    let (worktree_removed, branch_deleted) =
        cleanup_worktree(repo_path, worktree_path, feature_branch, session_name);

    Ok(MergeToMainResult::success(
        merge_hash,
        feature_branch.to_string(),
        worktree_removed,
        branch_deleted,
    ))
}

/// Complete the merge after conflicts have been resolved externally.
pub fn complete_merge_to_main(
    repo_path: &Path,
    worktree_path: &Path,
    feature_branch: &str,
    session_name: Option<&str>,
) -> Result<MergeToMainResult, AppError> {
    validate_worktree(repo_path)?;
    let status = check_rebase_status(worktree_path)?;
    if status.in_progress {
        return Err(AppError::Git(
            "Rebase is still in progress. Resolve conflicts and run 'git rebase --continue' first."
                .into(),
        ));
    }

    let main_branch = get_main_branch_name(repo_path)?;
    run_git(repo_path, &["checkout", &main_branch])?;
    run_git(repo_path, &["merge", "--ff-only", feature_branch])?;
    let hash = run_git(repo_path, &["rev-parse", "--short", "HEAD"])?;
    let merge_hash = hash.trim().to_string();
    info!("FF merged '{}' at {}", feature_branch, merge_hash);

    let (worktree_removed, branch_deleted) =
        cleanup_worktree(repo_path, worktree_path, feature_branch, session_name);

    Ok(MergeToMainResult::success(
        merge_hash,
        feature_branch.to_string(),
        worktree_removed,
        branch_deleted,
    ))
}

/// Check if a rebase is in progress in the given worktree.
pub fn check_rebase_status(worktree_path: &Path) -> Result<RebaseStatusResult, AppError> {
    validate_worktree(worktree_path)?;
    let result = run_git_raw(worktree_path, &["status"])?;
    let stdout = &result.stdout;
    let in_progress = stdout.contains("rebase in progress")
        || stdout.contains("interactive rebase in progress")
        || stdout.contains("currently rebasing");
    let has_conflicts = stdout.contains("Unmerged paths") || stdout.contains("both modified");
    Ok(RebaseStatusResult {
        in_progress,
        has_conflicts,
    })
}

/// Abort an in-progress rebase.
pub fn abort_rebase(worktree_path: &Path) -> Result<(), AppError> {
    validate_worktree(worktree_path)?;
    run_git(worktree_path, &["rebase", "--abort"])?;
    info!("Aborted rebase in {}", worktree_path.display());
    Ok(())
}

/// Shared cleanup: close tmux window, remove worktree, delete branch.
fn cleanup_worktree(
    repo_path: &Path,
    worktree_path: &Path,
    branch_name: &str,
    session_name: Option<&str>,
) -> (bool, bool) {
    let mut worktree_removed = false;
    let mut branch_deleted = false;

    // Close tmux window (non-fatal)
    if let Some(session) = session_name {
        if let Some(task_name) =
            extract_worktree_task_name(&worktree_path.to_string_lossy())
        {
            if let Err(e) =
                crate::services::tmux::close_window_by_name(session, &task_name)
            {
                warn!("Failed to close tmux window '{}': {}", task_name, e);
            }
        }
    }

    // Remove worktree (force — merge already succeeded, all commits are on main)
    info!("Force-removing worktree after successful merge: {}", worktree_path.display());
    match remove_worktree(repo_path, &worktree_path.to_string_lossy(), true) {
        Ok(()) => worktree_removed = true,
        Err(e) => {
            warn!("Worktree removal failed: {}. Attempting prune fallback.", e);
            match prune_worktrees(repo_path) {
                Ok(()) => {
                    if !worktree_path.exists() {
                        info!("Prune fallback succeeded for {}", worktree_path.display());
                        worktree_removed = true;
                    } else {
                        warn!(
                            "Prune completed but worktree directory still exists: {}",
                            worktree_path.display()
                        );
                    }
                }
                Err(prune_err) => {
                    warn!("Prune fallback also failed: {}", prune_err);
                }
            }
        }
    }

    // Delete feature branch
    match delete_branch(repo_path, branch_name, false) {
        Ok(()) => branch_deleted = true,
        Err(e) => warn!("Branch deletion failed: {}", e),
    }

    (worktree_removed, branch_deleted)
}

// ---------------------------------------------------------------------------
// Staging & Commit operations
// ---------------------------------------------------------------------------

/// Validate that a path is a directory.
fn validate_worktree(worktree_path: &Path) -> Result<(), AppError> {
    if !worktree_path.is_dir() {
        let err = AppError::NotFound(format!(
            "Worktree path not found: {}",
            worktree_path.display()
        ));
        error!("{}", err);
        return Err(err);
    }
    Ok(())
}

/// Validate a relative file path for path traversal, with optional canonicalize check.
fn validate_file_path(worktree_path: &Path, file_path: &str) -> Result<(), AppError> {
    if file_path.starts_with('/') || file_path.starts_with('\\') || file_path.contains("..") {
        let err = AppError::InvalidInput(format!("Invalid file path: '{}'", file_path));
        error!("{}", err);
        return Err(err);
    }
    // Extra safety: if the file exists, verify it stays within worktree via canonicalize
    let resolved = worktree_path.join(file_path);
    if let Ok(canonical) = resolved.canonicalize() {
        let worktree_canonical = worktree_path.canonicalize()
            .unwrap_or_else(|_| worktree_path.to_path_buf());
        if !canonical.starts_with(&worktree_canonical) {
            let err = AppError::InvalidInput(format!(
                "Path escapes worktree boundary: '{}'", file_path
            ));
            error!("{}", err);
            return Err(err);
        }
    }
    // If canonicalize fails (file doesn't exist yet for staging), string checks above suffice
    Ok(())
}

/// Validate file paths, build a git args vector, run the command, and log.
/// Shared by `stage_files` and `unstage_files` which differ only in their git
/// sub-command prefix (e.g. `["add", "--"]` vs `["restore", "--staged", "--"]`).
fn run_git_with_file_paths(
    worktree_path: &Path,
    prefix_args: &[&str],
    file_paths: &[String],
    action_label: &str,
) -> Result<(), AppError> {
    if file_paths.is_empty() {
        let err = AppError::InvalidInput(format!("No files specified for {}", action_label));
        error!("{}", err);
        return Err(err);
    }
    validate_worktree(worktree_path)?;
    for fp in file_paths {
        validate_file_path(worktree_path, fp)?;
    }
    let mut args: Vec<&str> = prefix_args.to_vec();
    for fp in file_paths {
        args.push(fp.as_str());
    }
    run_git(worktree_path, &args)?;
    info!("{} {} file(s) in {}", action_label, file_paths.len(), worktree_path.display());
    Ok(())
}

/// Stage specific files.
pub fn stage_files(worktree_path: &Path, file_paths: &[String]) -> Result<(), AppError> {
    run_git_with_file_paths(worktree_path, &["add", "--"], file_paths, "Staged")
}

/// Stage all changes (tracked + untracked).
pub fn stage_all(worktree_path: &Path) -> Result<(), AppError> {
    validate_worktree(worktree_path)?;
    run_git(worktree_path, &["add", "-A"])?;
    info!("Staged all changes in {}", worktree_path.display());
    Ok(())
}

/// Unstage specific files (git restore --staged, git 2.23+).
pub fn unstage_files(worktree_path: &Path, file_paths: &[String]) -> Result<(), AppError> {
    run_git_with_file_paths(worktree_path, &["restore", "--staged", "--"], file_paths, "Unstaged")
}

/// Unstage all files (git restore --staged ., git 2.23+).
pub fn unstage_all(worktree_path: &Path) -> Result<(), AppError> {
    validate_worktree(worktree_path)?;
    run_git(worktree_path, &["restore", "--staged", "."])?;
    info!("Unstaged all changes in {}", worktree_path.display());
    Ok(())
}

/// Discard changes in a specific file.
/// For untracked files, removes with `git clean`.
/// For tracked files, restores with `git restore` (git 2.23+).
pub fn discard_file(worktree_path: &Path, file_path: &str, is_untracked: bool) -> Result<(), AppError> {
    validate_worktree(worktree_path)?;
    validate_file_path(worktree_path, file_path)?;
    if is_untracked {
        run_git(worktree_path, &["clean", "-f", "--", file_path])?;
    } else {
        run_git(worktree_path, &["restore", "--", file_path])?;
    }
    info!("Discarded changes to '{}' in {}", file_path, worktree_path.display());
    Ok(())
}

/// Create a commit with the given message. Returns the new commit's short hash.
pub fn create_commit(worktree_path: &Path, message: &str) -> Result<String, AppError> {
    validate_worktree(worktree_path)?;
    if message.trim().is_empty() {
        let err = AppError::InvalidInput("Commit message cannot be empty".into());
        error!("{}", err);
        return Err(err);
    }
    let status = get_status(worktree_path)?;
    if status.staged_count == 0 {
        let err = AppError::InvalidInput("No staged changes to commit".into());
        error!("{}", err);
        return Err(err);
    }
    run_git(worktree_path, &["commit", "-m", message])?;
    let hash = run_git(worktree_path, &["rev-parse", "--short", "HEAD"])?;
    let short_hash = hash.trim().to_string();
    info!("Created commit {} in {}", short_hash, worktree_path.display());
    Ok(short_hash)
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
    let canonical_root = worktree_path.canonicalize().unwrap_or_else(|_| worktree_path.to_path_buf());

    let untracked: Vec<FileDiff> = untracked_raw
        .lines()
        .filter(|l| !l.is_empty())
        .filter_map(|rel_path| {
            let full_path = worktree_path.join(rel_path);

            // Path traversal guard: ensure resolved path stays within worktree
            if let Ok(canonical) = full_path.canonicalize() {
                if !canonical.starts_with(&canonical_root) {
                    warn!("Skipping suspicious path outside worktree: {}", rel_path);
                    return Some(FileDiff {
                        path: rel_path.to_string(),
                        status: FileStatus::Untracked,
                        insertions: 0,
                        deletions: 0,
                        patch: "Path outside worktree".to_string(),
                    });
                }
            }

            build_untracked_diff(rel_path, &full_path)
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
// Untracked file diff builder (shared by get_working_changes & get_file_diff)
// ---------------------------------------------------------------------------

const MAX_UNTRACKED_FILE_SIZE_BYTES: u64 = 1_048_576; // 1MB

/// Build a synthetic unified diff for an untracked file.
/// Returns `None` if the file cannot be read (logged as warning).
/// Caller is responsible for path-traversal validation beforehand.
fn build_untracked_diff(file_path: &str, full_path: &Path) -> Option<FileDiff> {
    // Size guard
    match std::fs::metadata(full_path) {
        Ok(m) if m.len() > MAX_UNTRACKED_FILE_SIZE_BYTES => {
            return Some(FileDiff {
                path: file_path.to_string(),
                status: FileStatus::Untracked,
                insertions: 0,
                deletions: 0,
                patch: format!("File too large to display ({:.1} KB)", m.len() as f64 / 1024.0),
            });
        }
        Ok(_) => {} // Size within limit, proceed
        Err(e) => {
            warn!("Cannot stat untracked file {}: {}", file_path, e);
            // Fall through to read(), which will surface its own error
        }
    }

    match std::fs::read(full_path) {
        Ok(bytes) => {
            // Detect binary: NUL byte in first 8KB
            let check_len = bytes.len().min(8192);
            if bytes[..check_len].contains(&0) {
                return Some(FileDiff {
                    path: file_path.to_string(),
                    status: FileStatus::Untracked,
                    insertions: 0,
                    deletions: 0,
                    patch: "Binary file".to_string(),
                });
            }
            let content = String::from_utf8_lossy(&bytes);
            let lines: Vec<&str> = content.lines().collect();
            let line_count = lines.len() as u32;
            let mut patch = format!(
                "diff --git a/{p} b/{p}\nnew file mode 100644\n--- /dev/null\n+++ b/{p}\n@@ -0,0 +1,{n} @@\n",
                p = file_path,
                n = line_count
            );
            for line in &lines {
                patch.push('+');
                patch.push_str(line);
                patch.push('\n');
            }
            Some(FileDiff {
                path: file_path.to_string(),
                status: FileStatus::Untracked,
                insertions: line_count,
                deletions: 0,
                patch,
            })
        }
        Err(e) => {
            warn!("Failed to read untracked file {}: {}", file_path, e);
            None
        }
    }
}

// ---------------------------------------------------------------------------
// Single-file diff
// ---------------------------------------------------------------------------

/// Get the diff for a single file (working tree vs index, or index vs HEAD).
/// Returns `None` if the file has no uncommitted changes.
pub fn get_file_diff(worktree_path: &Path, file_path: &str) -> Result<Option<FileDiff>, AppError> {
    validate_worktree(worktree_path)?;
    validate_file_path(worktree_path, file_path)?;

    // 1. Check unstaged changes (working tree vs index)
    let unstaged_raw = run_git(worktree_path, &["diff", "--", file_path])?;
    if !unstaged_raw.trim().is_empty() {
        let files = parse_unified_diff(&unstaged_raw);
        return Ok(files.into_iter().next());
    }

    // 2. Check staged changes (index vs HEAD)
    let staged_raw = run_git(worktree_path, &["diff", "--cached", "--", file_path])?;
    if !staged_raw.trim().is_empty() {
        let files = parse_unified_diff(&staged_raw);
        return Ok(files.into_iter().next());
    }

    // 3. Check if untracked
    let ls_result = run_git_raw(worktree_path, &["ls-files", "--error-unmatch", "--", file_path])?;
    if !ls_result.success {
        let full_path = worktree_path.join(file_path);
        if !full_path.exists() {
            return Ok(None);
        }
        Ok(build_untracked_diff(file_path, &full_path))
    } else {
        // Tracked file with no changes
        Ok(None)
    }
}

// ---------------------------------------------------------------------------
// Commit detail
// ---------------------------------------------------------------------------

/// Parse a unified diff output into a list of per-file diffs.
pub(crate) fn parse_unified_diff(raw: &str) -> Vec<FileDiff> {
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

// ---------------------------------------------------------------------------
// Remote fetch
// ---------------------------------------------------------------------------

/// Fetch from all remotes to update remote tracking refs.
/// Returns `Ok(success: false)` on network errors (non-fatal) so the caller
/// can silently skip the failure without crashing the UI.
pub fn fetch_remote(repo_path: &Path) -> Result<GitFetchResult, AppError> {
    let git = resolve_git_path()?;
    let output = Command::new(git)
        .args(["fetch", "--all", "--prune"])
        .current_dir(repo_path)
        .env("LC_ALL", "C")
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_SSH_COMMAND", "ssh -oBatchMode=yes -oConnectTimeout=10")
        .output()
        .map_err(|e| AppError::Git(format!("Failed to execute git fetch: {}", e)))?;

    if output.status.success() {
        info!("git fetch --all --prune succeeded for {}", repo_path.display());
        Ok(GitFetchResult {
            success: true,
            message: String::new(),
        })
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        warn!("git fetch failed for {}: {}", repo_path.display(), stderr);
        Ok(GitFetchResult {
            success: false,
            message: stderr,
        })
    }
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
        // With --decorate=full, git outputs full ref paths
        let refs = parse_refs(
            "HEAD -> refs/heads/main, refs/remotes/origin/main, tag: refs/tags/v1.0",
        );
        assert_eq!(refs.len(), 3);
        assert!(matches!(refs[0].ref_type, GitRefType::Head));
        assert_eq!(refs[0].name, "main");
        assert!(matches!(refs[1].ref_type, GitRefType::RemoteBranch));
        assert_eq!(refs[1].name, "origin/main");
        assert!(matches!(refs[2].ref_type, GitRefType::Tag));
        assert_eq!(refs[2].name, "v1.0");
    }

    #[test]
    fn test_parse_refs_slashed_local_branch() {
        // This was the bug: feat/lucky-draw was misclassified as RemoteBranch
        let refs = parse_refs(
            "HEAD -> refs/heads/develop, refs/remotes/origin/feat/desktop-app, refs/heads/feat/lucky-draw",
        );
        assert_eq!(refs.len(), 3);
        assert!(matches!(refs[0].ref_type, GitRefType::Head));
        assert_eq!(refs[0].name, "develop");
        assert!(matches!(refs[1].ref_type, GitRefType::RemoteBranch));
        assert_eq!(refs[1].name, "origin/feat/desktop-app");
        // The fix: slashed local branch is correctly classified
        assert!(matches!(refs[2].ref_type, GitRefType::LocalBranch));
        assert_eq!(refs[2].name, "feat/lucky-draw");
    }

    #[test]
    fn test_parse_refs_detached_head() {
        let refs = parse_refs("HEAD, refs/heads/feat/lucky-draw");
        assert_eq!(refs.len(), 2);
        assert!(matches!(refs[0].ref_type, GitRefType::Head));
        assert_eq!(refs[0].name, "HEAD");
        assert!(matches!(refs[1].ref_type, GitRefType::LocalBranch));
        assert_eq!(refs[1].name, "feat/lucky-draw");
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
    fn test_parse_log_output_with_trailer() {
        // Simulate GIT_LOG_FORMAT output with Co-Authored-By trailer (field 8)
        let line = "abc123\0abc\0feat: thing\0Dev\0dev@ex.com\02026-01-01T00:00:00Z\0parent1\0HEAD -> refs/heads/main\0Claude <noreply@anthropic.com>";
        let commits = parse_log_output(line);
        assert_eq!(commits.len(), 1);
        assert!(commits[0].is_agent_commit);
    }

    #[test]
    fn test_parse_log_output_without_trailer() {
        // No trailer → empty field 8 → not an agent commit
        let line = "abc123\0abc\0feat: thing\0Dev\0dev@ex.com\02026-01-01T00:00:00Z\0parent1\0HEAD -> refs/heads/main\0";
        let commits = parse_log_output(line);
        assert_eq!(commits.len(), 1);
        assert!(!commits[0].is_agent_commit);
    }

    #[test]
    fn test_parse_log_output_no_trailer_field() {
        // Only 8 fields (no field 8 at all) → not an agent commit
        let line = "abc123\0abc\0feat: thing\0Dev\0dev@ex.com\02026-01-01T00:00:00Z\0parent1\0HEAD -> refs/heads/main";
        let commits = parse_log_output(line);
        assert_eq!(commits.len(), 1);
        assert!(!commits[0].is_agent_commit);
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

    // -----------------------------------------------------------------------
    // Staging & Commit tests
    // -----------------------------------------------------------------------

    #[test]
    fn test_stage_files() {
        let repo = create_test_repo();
        fs::write(repo.join("new.txt"), "hello").unwrap();
        stage_files(&repo, &["new.txt".to_string()]).unwrap();
        let status = get_status(&repo).unwrap();
        assert_eq!(status.staged_count, 1);
        assert_eq!(status.untracked_count, 0);
        fs::remove_dir_all(&repo).ok();
    }

    #[test]
    fn test_stage_all() {
        let repo = create_test_repo();
        fs::write(repo.join("a.txt"), "a").unwrap();
        fs::write(repo.join("b.txt"), "b").unwrap();
        stage_all(&repo).unwrap();
        let status = get_status(&repo).unwrap();
        assert_eq!(status.staged_count, 2);
        fs::remove_dir_all(&repo).ok();
    }

    #[test]
    fn test_unstage_files() {
        let repo = create_test_repo();
        fs::write(repo.join("new.txt"), "hello").unwrap();
        stage_files(&repo, &["new.txt".to_string()]).unwrap();
        unstage_files(&repo, &["new.txt".to_string()]).unwrap();
        let status = get_status(&repo).unwrap();
        assert_eq!(status.staged_count, 0);
        assert_eq!(status.untracked_count, 1);
        fs::remove_dir_all(&repo).ok();
    }

    #[test]
    fn test_unstage_all() {
        let repo = create_test_repo();
        fs::write(repo.join("a.txt"), "a").unwrap();
        fs::write(repo.join("b.txt"), "b").unwrap();
        stage_all(&repo).unwrap();
        unstage_all(&repo).unwrap();
        let status = get_status(&repo).unwrap();
        assert_eq!(status.staged_count, 0);
        fs::remove_dir_all(&repo).ok();
    }

    #[test]
    fn test_create_commit() {
        let repo = create_test_repo();
        fs::write(repo.join("feat.txt"), "feature").unwrap();
        stage_all(&repo).unwrap();
        let hash = create_commit(&repo, "feat: add feature").unwrap();
        assert!(!hash.is_empty());
        let status = get_status(&repo).unwrap();
        assert!(!status.is_dirty);
        fs::remove_dir_all(&repo).ok();
    }

    #[test]
    fn test_create_commit_empty_message() {
        let repo = create_test_repo();
        fs::write(repo.join("x.txt"), "x").unwrap();
        stage_all(&repo).unwrap();
        let result = create_commit(&repo, "  ");
        assert!(result.is_err());
        fs::remove_dir_all(&repo).ok();
    }

    #[test]
    fn test_create_commit_nothing_staged() {
        let repo = create_test_repo();
        let result = create_commit(&repo, "empty commit");
        assert!(result.is_err());
        fs::remove_dir_all(&repo).ok();
    }

    #[test]
    fn test_discard_file_tracked() {
        let repo = create_test_repo();
        fs::write(repo.join("README.md"), "modified").unwrap();
        let status = get_status(&repo).unwrap();
        assert_eq!(status.unstaged_count, 1);
        discard_file(&repo, "README.md", false).unwrap();
        let status = get_status(&repo).unwrap();
        assert!(!status.is_dirty);
        fs::remove_dir_all(&repo).ok();
    }

    #[test]
    fn test_discard_file_untracked() {
        let repo = create_test_repo();
        fs::write(repo.join("temp.txt"), "temp").unwrap();
        let status = get_status(&repo).unwrap();
        assert_eq!(status.untracked_count, 1);
        discard_file(&repo, "temp.txt", true).unwrap();
        let status = get_status(&repo).unwrap();
        assert!(!status.is_dirty);
        fs::remove_dir_all(&repo).ok();
    }

    #[test]
    fn test_stage_files_empty_list() {
        let repo = create_test_repo();
        let result = stage_files(&repo, &[]);
        assert!(result.is_err());
        fs::remove_dir_all(&repo).ok();
    }

    #[test]
    fn test_validate_file_path_traversal() {
        let repo = create_test_repo();
        assert!(validate_file_path(&repo, "../../../etc/passwd").is_err());
        assert!(validate_file_path(&repo, "/absolute/path").is_err());
        assert!(validate_file_path(&repo, "\\windows\\path").is_err());
        assert!(validate_file_path(&repo, "normal/path/file.rs").is_ok());
        assert!(validate_file_path(&repo, "src/main.rs").is_ok());
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
