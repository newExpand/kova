use crate::errors::AppError;
use crate::models::git::{CommitDetail, CommitResult, GitCommitsPage, GitFetchResult, GitGraphData, GitStatus, WorkingChanges};
use crate::services;

#[tauri::command]
pub async fn get_git_graph(path: String, limit: Option<u32>) -> Result<GitGraphData, AppError> {
    let repo_path = std::path::Path::new(&path);
    services::git::get_graph_data(repo_path, limit.unwrap_or(200).min(10_000))
}

#[tauri::command]
pub async fn get_git_commits_page(
    path: String,
    skip: u32,
    limit: Option<u32>,
) -> Result<GitCommitsPage, AppError> {
    let repo_path = std::path::Path::new(&path);
    services::git::get_log_page(repo_path, skip, limit.unwrap_or(200).min(10_000))
}

#[tauri::command]
pub async fn get_git_status(path: String) -> Result<GitStatus, AppError> {
    services::git::get_status(std::path::Path::new(&path))
}

#[tauri::command]
pub async fn get_commit_detail(path: String, hash: String) -> Result<CommitDetail, AppError> {
    let repo_path = std::path::Path::new(&path);
    services::git::get_commit_detail(repo_path, &hash)
}

#[tauri::command]
pub async fn get_working_changes(worktree_path: String) -> Result<WorkingChanges, AppError> {
    let path = std::path::Path::new(&worktree_path);
    if !path.is_dir() {
        return Err(AppError::NotFound(format!(
            "Worktree path not found: {}",
            worktree_path
        )));
    }
    services::git::get_working_changes(path)
}

#[tauri::command]
pub async fn git_stage_files(worktree_path: String, file_paths: Vec<String>) -> Result<(), AppError> {
    services::git::stage_files(std::path::Path::new(&worktree_path), &file_paths)
}

#[tauri::command]
pub async fn git_stage_all(worktree_path: String) -> Result<(), AppError> {
    services::git::stage_all(std::path::Path::new(&worktree_path))
}

#[tauri::command]
pub async fn git_unstage_files(worktree_path: String, file_paths: Vec<String>) -> Result<(), AppError> {
    services::git::unstage_files(std::path::Path::new(&worktree_path), &file_paths)
}

#[tauri::command]
pub async fn git_unstage_all(worktree_path: String) -> Result<(), AppError> {
    services::git::unstage_all(std::path::Path::new(&worktree_path))
}

#[tauri::command]
pub async fn git_discard_file(worktree_path: String, file_path: String, is_untracked: bool) -> Result<(), AppError> {
    services::git::discard_file(std::path::Path::new(&worktree_path), &file_path, is_untracked)
}

#[tauri::command]
pub async fn git_create_commit(worktree_path: String, message: String) -> Result<CommitResult, AppError> {
    let short_hash = services::git::create_commit(std::path::Path::new(&worktree_path), &message)?;
    Ok(CommitResult { short_hash })
}

#[tauri::command]
pub async fn git_create_branch(
    repo_path: String,
    branch_name: String,
    start_point: String,
) -> Result<(), AppError> {
    services::git::create_branch(
        std::path::Path::new(&repo_path),
        &branch_name,
        &start_point,
    )
}

#[tauri::command]
pub async fn git_delete_branch(
    repo_path: String,
    branch_name: String,
    force: bool,
) -> Result<(), AppError> {
    services::git::delete_branch(
        std::path::Path::new(&repo_path),
        &branch_name,
        force,
    )
}

#[tauri::command]
pub async fn git_switch_branch(
    repo_path: String,
    branch_name: String,
) -> Result<(), AppError> {
    services::git::switch_branch(
        std::path::Path::new(&repo_path),
        &branch_name,
    )
}

#[tauri::command]
pub async fn git_fetch_remote(path: String) -> Result<GitFetchResult, AppError> {
    services::git::fetch_remote(std::path::Path::new(&path))
}

