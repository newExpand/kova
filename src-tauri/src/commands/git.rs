use crate::errors::AppError;
use crate::models::git::{GitGraphData, GitStatus};
use crate::services;

#[tauri::command]
pub fn get_git_graph(path: String, limit: Option<u32>) -> Result<GitGraphData, AppError> {
    let repo_path = std::path::Path::new(&path);
    services::git::get_graph_data(repo_path, limit.unwrap_or(200).min(10_000))
}

#[tauri::command]
pub fn get_git_status(path: String) -> Result<GitStatus, AppError> {
    services::git::get_status(std::path::Path::new(&path))
}
