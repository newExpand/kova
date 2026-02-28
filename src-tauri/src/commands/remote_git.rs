use crate::db::DbConnection;
use crate::errors::AppError;
use crate::models::git::{CommitDetail, GitCommitsPage, GitGraphData};
use crate::models::ssh::SshConnection;
use crate::services::{remote_git, ssh};
use std::sync::Mutex;
use tauri::State;
use tracing::error;

/// Resolve an SSH connection and its configured remote project path from a connection ID.
/// Shared by all remote git commands to avoid repeating the lock + lookup + validation.
fn resolve_connection_and_path(
    state: &State<'_, Mutex<DbConnection>>,
    connection_id: &str,
) -> Result<(SshConnection, String), AppError> {
    let connection = {
        let conn = state
            .lock()
            .map_err(|e| {
                error!("Database lock poisoned in resolve_connection_and_path: {}", e);
                AppError::Internal("Internal state error. Please restart the application.".into())
            })?;
        ssh::get(&conn.conn, connection_id)?
    };
    let remote_path = connection
        .remote_project_path
        .as_deref()
        .ok_or_else(|| {
            AppError::InvalidInput(
                "SSH connection has no remote_project_path configured".into(),
            )
        })?
        .to_string();
    Ok((connection, remote_path))
}

#[tauri::command]
pub async fn get_remote_git_graph(
    connection_id: String,
    limit: Option<u32>,
    state: State<'_, Mutex<DbConnection>>,
) -> Result<GitGraphData, AppError> {
    let (connection, remote_path) = resolve_connection_and_path(&state, &connection_id)?;
    let lim = limit.unwrap_or(200).min(10_000);
    tauri::async_runtime::spawn_blocking(move || {
        remote_git::get_remote_graph_data(&connection, &remote_path, lim)
    })
    .await
    .map_err(|e| {
        error!("get_remote_git_graph task panicked: {}", e);
        AppError::Internal(format!("Remote git graph failed unexpectedly: {}", e))
    })?
}

#[tauri::command]
pub async fn get_remote_git_commits_page(
    connection_id: String,
    skip: u32,
    limit: Option<u32>,
    state: State<'_, Mutex<DbConnection>>,
) -> Result<GitCommitsPage, AppError> {
    let (connection, remote_path) = resolve_connection_and_path(&state, &connection_id)?;
    let lim = limit.unwrap_or(200).min(10_000);
    tauri::async_runtime::spawn_blocking(move || {
        remote_git::get_remote_log_page(&connection, &remote_path, skip, lim)
    })
    .await
    .map_err(|e| {
        error!("get_remote_git_commits_page task panicked: {}", e);
        AppError::Internal(format!("Remote git commits page failed unexpectedly: {}", e))
    })?
}

#[tauri::command]
pub async fn get_remote_commit_detail(
    connection_id: String,
    hash: String,
    state: State<'_, Mutex<DbConnection>>,
) -> Result<CommitDetail, AppError> {
    let (connection, remote_path) = resolve_connection_and_path(&state, &connection_id)?;
    tauri::async_runtime::spawn_blocking(move || {
        remote_git::get_remote_commit_detail(&connection, &remote_path, &hash)
    })
    .await
    .map_err(|e| {
        error!("get_remote_commit_detail task panicked: {}", e);
        AppError::Internal(format!("Remote commit detail failed unexpectedly: {}", e))
    })?
}

#[tauri::command]
pub async fn detect_remote_git_paths(
    host: String,
    port: i32,
    username: String,
    auth_type: crate::models::ssh::SshAuthType,
    key_path: Option<String>,
) -> Result<Vec<String>, AppError> {
    use crate::models::ssh::SshConnection;

    let connection = SshConnection {
        id: String::new(),
        name: String::from("detect"),
        host,
        port,
        username,
        auth_type,
        key_path,
        project_id: None,
        is_default: false,
        remote_project_path: None,
        created_at: String::new(),
        updated_at: String::new(),
    };

    tauri::async_runtime::spawn_blocking(move || {
        remote_git::detect_git_paths(&connection)
    })
    .await
    .map_err(|e| {
        error!("detect_remote_git_paths task panicked: {}", e);
        AppError::Internal(format!("Detect git paths failed unexpectedly: {}", e))
    })?
}
