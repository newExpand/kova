use crate::errors::AppError;
use crate::models::agent::{RemoveWorktreeResult, RestoreResult, WorktreeTaskResult};
use crate::models::git::{MergeToMainResult, RebaseStatusResult};
use crate::services;

#[tauri::command]
pub fn start_worktree_task(
    session_name: String,
    task_name: String,
    project_path: String,
) -> Result<WorktreeTaskResult, AppError> {
    services::agent::start_worktree_task(&session_name, &task_name, &project_path)
}

#[tauri::command]
pub fn restore_worktree_windows(
    session_name: String,
    project_path: String,
) -> Result<RestoreResult, AppError> {
    services::agent::restore_worktree_windows(&session_name, &project_path)
}

#[tauri::command]
pub fn remove_agent_worktree(
    repo_path: String,
    worktree_path: String,
    session_name: Option<String>,
    branch_name: Option<String>,
    force: bool,
) -> Result<RemoveWorktreeResult, AppError> {
    services::agent::remove_worktree(
        &repo_path,
        &worktree_path,
        session_name.as_deref(),
        branch_name.as_deref(),
        force,
    )
}

#[tauri::command]
pub fn push_git_branch(
    repo_path: String,
    branch_name: String,
    remote: Option<String>,
) -> Result<(), AppError> {
    let remote = remote.as_deref().unwrap_or("origin");
    services::git::push_branch(std::path::Path::new(&repo_path), &branch_name, remote)
}

#[tauri::command]
pub fn select_tmux_window(
    session_name: String,
    window_target: String,
) -> Result<(), AppError> {
    services::tmux::select_window(&session_name, &window_target)
}

#[tauri::command]
pub fn send_keys_to_tmux_window(
    session_name: String,
    window_name: String,
    keys: String,
) -> Result<(), AppError> {
    services::tmux::send_keys_to_window(&session_name, &window_name, &keys)
}

#[tauri::command]
pub fn send_keys_to_tmux_window_delayed(
    session_name: String,
    window_name: String,
    keys: String,
) -> Result<(), AppError> {
    services::tmux::send_keys_to_window_with_delay(&session_name, &window_name, &keys)
}

#[tauri::command]
pub fn merge_worktree_to_main(
    repo_path: String,
    worktree_path: String,
    branch_name: String,
    session_name: Option<String>,
) -> Result<MergeToMainResult, AppError> {
    services::git::merge_worktree_to_main(
        std::path::Path::new(&repo_path),
        std::path::Path::new(&worktree_path),
        &branch_name,
        session_name.as_deref(),
    )
}

#[tauri::command]
pub fn complete_merge_to_main(
    repo_path: String,
    worktree_path: String,
    branch_name: String,
    session_name: Option<String>,
) -> Result<MergeToMainResult, AppError> {
    services::git::complete_merge_to_main(
        std::path::Path::new(&repo_path),
        std::path::Path::new(&worktree_path),
        &branch_name,
        session_name.as_deref(),
    )
}

#[tauri::command]
pub fn abort_merge_rebase(worktree_path: String) -> Result<(), AppError> {
    services::git::abort_rebase(std::path::Path::new(&worktree_path))
}

#[tauri::command]
pub fn check_rebase_status(worktree_path: String) -> Result<RebaseStatusResult, AppError> {
    services::git::check_rebase_status(std::path::Path::new(&worktree_path))
}
