use crate::errors::AppError;
use crate::models::files::{
    ConflictStrategy, ContentSearchResult, CopyResult, FileContent, FileEntry, FileSearchResult,
};
use crate::services;
use tracing::error;

// ---------------------------------------------------------------------------
// File Management Commands (create / delete / rename / copy)
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn create_file(
    project_path: String,
    relative_path: String,
) -> Result<FileEntry, AppError> {
    services::file_service::create_file(&project_path, &relative_path)
}

#[tauri::command]
pub async fn create_directory(
    project_path: String,
    relative_path: String,
) -> Result<FileEntry, AppError> {
    services::file_service::create_directory(&project_path, &relative_path)
}

#[tauri::command]
pub async fn delete_path(
    project_path: String,
    relative_path: String,
) -> Result<(), AppError> {
    services::file_service::delete_path(&project_path, &relative_path)
}

#[tauri::command]
pub async fn rename_path(
    project_path: String,
    old_relative_path: String,
    new_relative_path: String,
) -> Result<FileEntry, AppError> {
    services::file_service::rename_path(&project_path, &old_relative_path, &new_relative_path)
}

#[tauri::command]
pub async fn copy_external_files(
    project_path: String,
    target_relative_dir: String,
    source_paths: Vec<String>,
) -> Result<Vec<FileEntry>, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        services::file_service::copy_external_files(
            &project_path,
            &target_relative_dir,
            source_paths,
        )
    })
    .await
    .map_err(|e| {
        error!("copy_external_files task panicked: {}", e);
        AppError::Internal(format!("File copy failed unexpectedly: {}", e))
    })?
}

#[tauri::command]
pub async fn copy_external_entries(
    project_path: String,
    target_relative_dir: String,
    source_paths: Vec<String>,
    conflict_strategy: ConflictStrategy,
) -> Result<CopyResult, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        services::file_service::copy_external_entries(
            &project_path,
            &target_relative_dir,
            source_paths,
            conflict_strategy,
        )
    })
    .await
    .map_err(|e| {
        error!("copy_external_entries task panicked: {}", e);
        AppError::Internal(format!("File copy failed unexpectedly: {}", e))
    })?
}

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

#[tauri::command]
pub async fn search_file_contents(
    project_path: String,
    query: String,
    case_sensitive: bool,
    is_regex: bool,
    max_results: Option<u32>,
) -> Result<ContentSearchResult, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        services::file_service::search_file_contents(
            &project_path,
            &query,
            case_sensitive,
            is_regex,
            max_results,
        )
    })
    .await
    .map_err(|e| {
        error!("search_file_contents task panicked: {}", e);
        AppError::Internal(format!("Content search failed unexpectedly: {}", e))
    })?
}
