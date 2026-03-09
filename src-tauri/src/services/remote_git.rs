use crate::errors::AppError;
use crate::models::git::*;
use crate::models::ssh::SshConnection;
use crate::services::{git, ssh};
use tracing::{error, info, warn};

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/// Whitelist-based validation: only safe characters allowed in remote paths.
/// Prevents shell injection when the path is used in a remote SSH command.
/// Also rejects `..` path traversal segments.
pub(crate) fn validate_remote_path(path: &str) -> Result<(), AppError> {
    if path.is_empty() {
        return Err(AppError::InvalidInput(
            "Remote project path cannot be empty".into(),
        ));
    }
    if !path.starts_with('/') {
        return Err(AppError::InvalidInput(
            "Remote project path must be absolute (start with /)".into(),
        ));
    }
    if path.contains("..") {
        return Err(AppError::InvalidInput(
            "Remote project path must not contain '..' segments".into(),
        ));
    }
    if path.len() > 1024 {
        return Err(AppError::InvalidInput(
            "Remote project path too long (max 1024 chars)".into(),
        ));
    }
    if let Some(ch) = path
        .chars()
        .find(|c| !(c.is_ascii_alphanumeric() || matches!(c, '/' | '.' | '_' | '-' | ' ')))
    {
        return Err(AppError::InvalidInput(format!(
            "Remote project path contains forbidden character: '{}'",
            ch
        )));
    }
    Ok(())
}

/// Validate commit hash: hex characters only, 4-40 length.
fn validate_hash(hash: &str) -> Result<(), AppError> {
    if hash.len() < 4
        || hash.len() > 40
        || !hash.chars().all(|c| c.is_ascii_hexdigit())
    {
        return Err(AppError::InvalidInput(format!(
            "Invalid commit hash: '{}'. Must be 4-40 hex characters.",
            hash
        )));
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Remote command execution
// ---------------------------------------------------------------------------

/// Unconditionally single-quote a string for safe SSH remote shell execution.
/// Unlike `ssh::shell_quote` (conditional, tmux-only), this defends against all
/// shell metacharacters (`()`, `$`, `*`, etc.) by always wrapping in single quotes.
fn shell_quote_for_ssh(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}

/// Execute a remote git command via SSH (BatchMode=yes).
/// Follows the same pattern as `ssh_tmux::execute_remote_command`.
fn run_remote_git(
    connection: &SshConnection,
    remote_path: &str,
    git_args: &[&str],
) -> Result<String, AppError> {
    validate_remote_path(remote_path)?;

    // Build remote command: git -C /path <args>
    // Each argument is single-quoted to prevent the remote shell from
    // interpreting metacharacters such as parentheses in git format strings.
    let mut remote_cmd = format!("git -C {}", shell_quote_for_ssh(remote_path));
    for arg in git_args {
        remote_cmd.push(' ');
        remote_cmd.push_str(&shell_quote_for_ssh(arg));
    }

    let mut cmd = ssh::build_ssh_probe_cmd(connection)?;
    cmd.arg(&remote_cmd);
    cmd.env("LC_ALL", "C");

    let output = cmd.output().map_err(|e| {
        error!("Failed to execute remote git via SSH: {}", e);
        AppError::Internal(format!("SSH remote git command failed: {}", e))
    })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        error!(
            "Remote git command failed for '{}': {}",
            connection.name,
            stderr.trim()
        );
        return Err(AppError::Git(format!(
            "Remote git command failed: {}",
            stderr.trim()
        )));
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/// Detect git repositories on the remote server by searching the home directory.
/// Returns a list of absolute paths to git repository roots (up to 10).
pub fn detect_git_paths(connection: &SshConnection) -> Result<Vec<String>, AppError> {
    let remote_cmd = "find ~ -maxdepth 3 -name .git -type d 2>/dev/null | head -10 | sed 's/\\/.git$//'";

    let mut cmd = ssh::build_ssh_probe_cmd(connection)?;
    cmd.arg(remote_cmd);
    cmd.env("LC_ALL", "C");

    let output = cmd.output().map_err(|e| {
        error!("Failed to detect remote git paths: {}", e);
        AppError::Internal(format!("SSH detect git paths failed: {}", e))
    })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);

        // If we got some stdout lines despite the error, `find` partially succeeded
        // (e.g., permission denied on some subdirectories). Use the partial results.
        if !stdout.trim().is_empty() {
            warn!(
                "Remote find command had partial failure for '{}': {}",
                connection.name,
                stderr.trim()
            );
            // Fall through to parse partial stdout below
        } else {
            // No output at all — this is a real failure
            error!(
                "Remote find command failed for '{}': {}",
                connection.name,
                stderr.trim()
            );
            return Err(AppError::Git(format!(
                "Failed to detect git paths: {}",
                stderr.trim()
            )));
        }
    }

    let paths: Vec<String> = String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter(|line| !line.is_empty())
        .map(|line| line.to_string())
        .collect();

    info!(
        "Detected {} git repositories on '{}'",
        paths.len(),
        connection.name
    );
    Ok(paths)
}

/// Get remote git graph data (commits + branches, no worktrees/status).
pub fn get_remote_graph_data(
    connection: &SshConnection,
    remote_path: &str,
    limit: u32,
) -> Result<GitGraphData, AppError> {
    info!(
        "Fetching remote git graph for '{}' at {}",
        connection.name, remote_path
    );

    let limit_str = limit.to_string();
    let output = run_remote_git(
        connection,
        remote_path,
        &[
            "log",
            git::GIT_LOG_FORMAT,
            "--decorate=full",
            "--topo-order",
            "-n",
            &limit_str,
            "--all",
        ],
    )?;
    let commits = git::parse_log_output(&output);

    // Get branches
    let branch_output = run_remote_git(
        connection,
        remote_path,
        &[
            "branch",
            "-a",
            "--format=%(refname:short)\t%(objectname:short)\t%(HEAD)\t%(upstream:short)\t%(refname)",
        ],
    )?;
    let branches = parse_remote_branches(&branch_output);

    // Remote repos: worktrees and status are unavailable (read-only view).
    // These dummy values mean "unknown", not "clean". The frontend's `readOnly`
    // prop hides the status bar so the zeroed values are never displayed.
    Ok(GitGraphData {
        commits,
        branches,
        worktrees: Vec::new(),
        status: GitStatus {
            is_dirty: false,
            staged_count: 0,
            unstaged_count: 0,
            untracked_count: 0,
            modified_paths: Vec::new(),
        },
    })
}

/// Paginated remote commit fetching.
pub fn get_remote_log_page(
    connection: &SshConnection,
    remote_path: &str,
    skip: u32,
    limit: u32,
) -> Result<GitCommitsPage, AppError> {
    let skip_str = skip.to_string();
    let fetch_limit = limit + 1;
    let fetch_str = fetch_limit.to_string();
    let output = run_remote_git(
        connection,
        remote_path,
        &[
            "log",
            git::GIT_LOG_FORMAT,
            "--decorate=full",
            "--topo-order",
            "--skip",
            &skip_str,
            "-n",
            &fetch_str,
            "--all",
        ],
    )?;

    let mut commits = git::parse_log_output(&output);
    let has_more = commits.len() > limit as usize;
    if has_more {
        commits.truncate(limit as usize);
    }

    Ok(GitCommitsPage { commits, has_more })
}

/// Get remote commit detail (full message + diff).
pub fn get_remote_commit_detail(
    connection: &SshConnection,
    remote_path: &str,
    hash: &str,
) -> Result<CommitDetail, AppError> {
    validate_hash(hash)?;

    // 1. Full commit message
    let full_message = run_remote_git(
        connection,
        remote_path,
        &["log", "-1", "--format=%B", hash],
    )?;
    let full_message = full_message.trim().to_string();

    // 2. Unified diff
    let diff_output = run_remote_git(
        connection,
        remote_path,
        &["show", "--format=", "-p", hash],
    )?;

    // 3. Parse diff
    let files = git::parse_unified_diff(&diff_output);

    // 4. Detect agent commit
    let is_agent_commit = git::detect_agent_commit(&full_message);

    // 5. Compute stats
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
// Helpers
// ---------------------------------------------------------------------------

/// Parse branch listing output (same format as local `get_branches`).
fn parse_remote_branches(output: &str) -> Vec<GitBranch> {
    output
        .lines()
        .filter(|line| !line.is_empty())
        .filter_map(|line| {
            let fields: Vec<&str> = line.split('\t').collect();
            if fields.len() < 4 {
                warn!("Skipping malformed remote branch line: {:?}", line);
                return None;
            }

            let name = fields[0].to_string();
            let full_ref = fields.get(4).unwrap_or(&"");
            let is_remote = full_ref.starts_with("refs/remotes/");
            let is_head = fields[2].trim() == "*";
            let tracking = fields
                .get(3)
                .filter(|s| !s.is_empty())
                .map(|s| s.to_string());

            Some(GitBranch {
                name,
                commit_hash: fields[1].to_string(),
                is_head,
                is_remote,
                tracking_branch: tracking,
            })
        })
        .collect()
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_validate_remote_path_valid() {
        assert!(validate_remote_path("/home/user/project").is_ok());
        assert!(validate_remote_path("/var/repos/my-app").is_ok());
        assert!(validate_remote_path("/home/user/my project").is_ok());
        assert!(validate_remote_path("/opt/data/repo_v2.0").is_ok());
    }

    #[test]
    fn test_validate_remote_path_rejects_metacharacters() {
        assert!(validate_remote_path("; rm -rf /").is_err());
        assert!(validate_remote_path("/home/user$(whoami)").is_err());
        assert!(validate_remote_path("/home/user`id`").is_err());
        assert!(validate_remote_path("/path|cat /etc/passwd").is_err());
        assert!(validate_remote_path("/path&background").is_err());
        assert!(validate_remote_path("/path'inject").is_err());
        assert!(validate_remote_path("/path\"inject").is_err());
    }

    #[test]
    fn test_validate_remote_path_rejects_relative() {
        assert!(validate_remote_path("relative/path").is_err());
        assert!(validate_remote_path("").is_err());
    }

    #[test]
    fn test_validate_remote_path_rejects_too_long() {
        let long_path = format!("/{}", "a".repeat(1024));
        assert!(validate_remote_path(&long_path).is_err());
    }

    #[test]
    fn test_validate_hash_valid() {
        assert!(validate_hash("abcd1234").is_ok());
        assert!(validate_hash("e6c05b4").is_ok());
        assert!(validate_hash("abcdef1234567890abcdef1234567890abcdef12").is_ok());
    }

    #[test]
    fn test_validate_hash_rejects_invalid() {
        assert!(validate_hash("abc").is_err()); // too short
        assert!(validate_hash("xyz12345").is_err()); // non-hex
        assert!(validate_hash(&"a".repeat(41)).is_err()); // too long
        assert!(validate_hash("; rm -rf /").is_err()); // injection
    }
}
