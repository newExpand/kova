use crate::errors::AppError;
use crate::models::files::{FileContent, FileEntry, FileSearchResult};
use crate::services;
use tracing::error;

#[tauri::command]
pub async fn resolve_import_path(
    project_path: String,
    current_file: String,
    import_path: String,
) -> Result<Option<String>, AppError> {
    services::file_service::resolve_import_path(&project_path, &current_file, &import_path)
}

#[tauri::command]
pub async fn list_directory(
    project_path: String,
    relative_path: String,
) -> Result<Vec<FileEntry>, AppError> {
    services::file_service::list_directory(&project_path, &relative_path)
}

#[tauri::command]
pub async fn read_file(
    project_path: String,
    relative_path: String,
) -> Result<FileContent, AppError> {
    services::file_service::read_file(&project_path, &relative_path)
}

#[tauri::command]
pub async fn write_file(
    project_path: String,
    relative_path: String,
    content: String,
) -> Result<(), AppError> {
    services::file_service::write_file(&project_path, &relative_path, &content)
}

#[tauri::command]
pub async fn search_project_files(
    project_path: String,
    query: String,
    limit: Option<usize>,
) -> Result<Vec<FileSearchResult>, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        services::file_service::search_files(&project_path, &query, limit.unwrap_or(50))
    })
    .await
    .map_err(|e| {
        error!("search_project_files task panicked: {}", e);
        AppError::Internal(format!("File search failed unexpectedly: {}", e))
    })?
}
