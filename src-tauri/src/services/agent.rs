use crate::errors::AppError;
use crate::models::agent::{RemoveWorktreeResult, RestoreResult, WorktreeTaskResult};
use crate::models::agent_type::AgentType;
use crate::services::{git, tmux};
use std::path::Path;
use tracing::{info, warn};

/// Resolve the primary pane ID for a Codex window and start pane monitoring.
/// Logs a warning if the pane cannot be found or resolved.
fn start_codex_pane_monitor(
    app: &tauri::AppHandle,
    session_name: &str,
    window_name: &str,
    project_path: &str,
) {
    match tmux::find_primary_pane_id(session_name, window_name) {
        Ok(Some(pane_id)) => {
            crate::services::pane_monitor::watch_agent_pane(
                app.clone(),
                session_name.to_string(),
                window_name.to_string(),
                pane_id,
                "0".to_string(),
                project_path.to_string(),
                AgentType::CodexCli,
            );
        }
        Ok(None) => {
            warn!(
                "No pane found for Codex in '{}': pane monitoring skipped",
                window_name
            );
        }
        Err(e) => {
            warn!(
                "Failed to resolve pane for Codex in '{}': {}",
                window_name, e
            );
        }
    }
}

/// Validate a worktree task name: alphanumeric, hyphens, underscores only, max 50 chars.
fn validate_task_name(name: &str) -> Result<(), AppError> {
    if name.is_empty() {
        return Err(AppError::InvalidInput("Task name cannot be empty".into()));
    }
    if name.len() > 50 {
        return Err(AppError::InvalidInput(
            "Task name too long (max 50 chars)".into(),
        ));
    }
    if !name
        .chars()
        .all(|c| c.is_alphanumeric() || c == '-' || c == '_')
    {
        return Err(AppError::InvalidInput(format!(
            "Invalid task name '{}': only alphanumeric, '-', and '_' allowed",
            name
        )));
    }
    Ok(())
}

/// Extract the worktree task name from a `.claude/worktrees/<name>` path.
fn extract_task_name(worktree_path: &str) -> Option<String> {
    let path = Path::new(worktree_path);
    if worktree_path.contains(".claude/worktrees/") {
        path.file_name()
            .map(|n| n.to_string_lossy().to_string())
    } else {
        None
    }
}

/// Start a new worktree agent task by creating a named tmux window
/// and launching the specified agent inside it.
///
/// Only Claude Code supports worktrees (`.claude/worktrees/<name>/`)
/// and branch management (`worktree-<name>`). Other agents launch without
/// worktree support.
pub fn start_worktree_task(
    session_name: &str,
    task_name: &str,
    project_path: &str,
    agent_type: AgentType,
    app_handle: Option<tauri::AppHandle>,
) -> Result<WorktreeTaskResult, AppError> {
    validate_task_name(task_name)?;

    // Create a named window in the project session
    tmux::create_window_named(session_name, task_name, project_path)?;

    // Send agent command (with worktree flag for Claude Code only)
    let agent_cmd = agent_type.worktree_command(task_name);
    if let Err(e) = tmux::send_keys_to_window(session_name, task_name, &agent_cmd) {
        warn!(
            "Failed to send agent command to window '{}': {}",
            task_name, e
        );
        // Window is created but agent didn't start — user can type manually
    }

    // Hook injection / monitoring strategy by agent type:
    //
    // - ClaudeCode: per-project hooks — waits for worktree dir, then injects.
    // - GeminiCli:  global hooks (boot-time) — complete detection, no monitor.
    // - CodexCli:   only has `notify` (turn completion). Needs pane_monitor for
    //               AgentActive/SessionStart/Stop.
    match agent_type {
        AgentType::ClaudeCode => {
            crate::services::hooks::inject_hooks_for_worktree_when_ready(
                project_path.to_string(),
                task_name.to_string(),
                app_handle,
            );
        }
        AgentType::CodexCli => {
            if let Some(ref app) = app_handle {
                start_codex_pane_monitor(app, session_name, task_name, project_path);
            }
        }
        AgentType::GeminiCli => {
            // Global hooks provide complete detection — no action needed here.
        }
    }

    info!(
        "Started worktree task '{}' in session '{}' with agent: {}",
        task_name, session_name, agent_type.display_name()
    );
    Ok(WorktreeTaskResult {
        window_name: task_name.to_string(),
        worktree_name: task_name.to_string(),
    })
}

/// Restore tmux windows for existing worktrees when a session is recreated.
///
/// Scans for `.claude/worktrees/*` entries and creates a named window + agent
/// for each one. Returns to the first (main) window after restoration.
pub fn restore_worktree_windows(
    session_name: &str,
    project_path: &str,
    agent_type: AgentType,
    app_handle: Option<tauri::AppHandle>,
) -> Result<RestoreResult, AppError> {
    let repo_path = Path::new(project_path);
    let worktrees = git::get_worktrees(repo_path)?;

    let mut restored_names: Vec<String> = Vec::new();

    for wt in &worktrees {
        if let Some(task_name) = extract_task_name(&wt.path) {
            // Create a named window with the worktree cwd
            match tmux::create_window_named(session_name, &task_name, &wt.path) {
                Ok(()) => {
                    // Send agent command to the new window
                    let agent_cmd = agent_type.base_command();
                    if let Err(e) =
                        tmux::send_keys_to_window(session_name, &task_name, agent_cmd)
                    {
                        warn!(
                            "Failed to send agent to restored window '{}': {}",
                            task_name, e
                        );
                    }
                    // Hook injection / monitoring (same strategy as start_worktree_task)
                    match agent_type {
                        AgentType::ClaudeCode => {
                            match crate::services::event_server::read_port_from_file() {
                                Ok(port) => {
                                    let wt_path = Path::new(&wt.path);
                                    if let Err(e) = crate::services::hooks::inject_hooks(wt_path, port) {
                                        warn!(
                                            "Failed to inject hooks for restored worktree '{}': {}",
                                            task_name, e
                                        );
                                    }
                                }
                                Err(e) => {
                                    warn!(
                                        "Skipping hook injection for restored worktree '{}': {}",
                                        task_name, e
                                    );
                                }
                            }
                        }
                        AgentType::CodexCli => {
                            if let Some(ref app) = app_handle {
                                start_codex_pane_monitor(app, session_name, &task_name, project_path);
                            }
                        }
                        AgentType::GeminiCli => {}
                    }
                    restored_names.push(task_name);
                }
                Err(e) => {
                    warn!("Failed to create window for worktree '{}': {}", task_name, e);
                }
            }
        }
    }

    // Switch back to the first (main) window
    if !restored_names.is_empty() {
        if let Err(e) = tmux::select_window(session_name, "0") {
            warn!("Failed to select main window after restore: {}", e);
        }
    }

    let count = restored_names.len() as u32;
    info!(
        "Restored {} worktree windows in session '{}' with agent: {}",
        count, session_name, agent_type.display_name()
    );

    Ok(RestoreResult {
        restored_count: count,
        worktree_names: restored_names,
    })
}

/// Remove a worktree and clean up associated resources:
/// 1. Close the tmux window (non-fatal)
/// 2. git worktree remove
/// 3. git branch delete (non-fatal)
pub fn remove_worktree(
    repo_path: &str,
    worktree_path: &str,
    session_name: Option<&str>,
    branch_name: Option<&str>,
    force: bool,
) -> Result<RemoveWorktreeResult, AppError> {
    let repo = Path::new(repo_path);

    // Close the matching tmux window (non-fatal)
    let mut window_closed = false;
    if let (Some(session), Some(task_name)) =
        (session_name, extract_task_name(worktree_path))
    {
        match tmux::close_window_by_name(session, &task_name) {
            Ok(()) => {
                window_closed = true;
            }
            Err(e) => {
                warn!("Window close failed for '{}': {}", task_name, e);
            }
        }
    }

    // Remove the git worktree
    git::remove_worktree(repo, worktree_path, force)?;

    // Delete the branch (non-fatal)
    let mut branch_deleted = false;
    if let Some(branch) = branch_name {
        match git::delete_branch(repo, branch, force) {
            Ok(()) => {
                branch_deleted = true;
            }
            Err(e) => {
                warn!("Branch '{}' deletion failed: {}", branch, e);
            }
        }
    }

    Ok(RemoveWorktreeResult {
        window_closed,
        branch_deleted,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_validate_task_name_valid() {
        assert!(validate_task_name("fix-auth").is_ok());
        assert!(validate_task_name("add_feature").is_ok());
        assert!(validate_task_name("task123").is_ok());
        assert!(validate_task_name("a").is_ok());
    }

    #[test]
    fn test_validate_task_name_invalid() {
        assert!(validate_task_name("").is_err());
        assert!(validate_task_name("has space").is_err());
        assert!(validate_task_name("has.dot").is_err());
        assert!(validate_task_name("has/slash").is_err());
        let long_name = "a".repeat(51);
        assert!(validate_task_name(&long_name).is_err());
    }

    #[test]
    fn test_extract_task_name() {
        assert_eq!(
            extract_task_name("/Users/me/project/.claude/worktrees/fix-auth"),
            Some("fix-auth".to_string())
        );
        assert_eq!(
            extract_task_name("/Users/me/project/.claude/worktrees/add-ui"),
            Some("add-ui".to_string())
        );
        assert_eq!(extract_task_name("/Users/me/project"), None);
        assert_eq!(extract_task_name("/Users/me/project/src"), None);
    }
}
