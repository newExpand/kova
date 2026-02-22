use crate::errors::AppError;
use crate::models::git::{CommitDetail, CommitResult, GitGraphData, GitStatus, WorkingChanges};
use crate::services;

#[tauri::command]
pub async fn get_git_graph(path: String, limit: Option<u32>) -> Result<GitGraphData, AppError> {
    let repo_path = std::path::Path::new(&path);
    services::git::get_graph_data(repo_path, limit.unwrap_or(200).min(10_000))
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

