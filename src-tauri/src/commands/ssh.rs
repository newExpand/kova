use crate::db::DbConnection;
use crate::errors::AppError;
use crate::models::ssh::{
    CreateSshConnectionInput, SshAuthType, SshConnectResult, SshConnection, SshTestResult,
    UpdateSshConnectionInput,
};
use crate::services::ssh;
use std::sync::Mutex;
use tauri::State;

#[tauri::command]
pub fn create_ssh_connection(
    input: CreateSshConnectionInput,
    state: State<'_, Mutex<DbConnection>>,
) -> Result<SshConnection, AppError> {
    let conn = state
        .lock()
        .map_err(|_| AppError::Internal("Lock poisoned".into()))?;
    ssh::create(&conn.conn, &input)
}

#[tauri::command]
pub fn list_ssh_connections(
    state: State<'_, Mutex<DbConnection>>,
) -> Result<Vec<SshConnection>, AppError> {
    let conn = state
        .lock()
        .map_err(|_| AppError::Internal("Lock poisoned".into()))?;
    ssh::list(&conn.conn)
}

#[tauri::command]
pub fn list_ssh_connections_by_project(
    project_id: String,
    state: State<'_, Mutex<DbConnection>>,
) -> Result<Vec<SshConnection>, AppError> {
    let conn = state
        .lock()
        .map_err(|_| AppError::Internal("Lock poisoned".into()))?;
    ssh::list_by_project(&conn.conn, &project_id)
}

#[tauri::command]
pub fn get_ssh_connection(
    id: String,
    state: State<'_, Mutex<DbConnection>>,
) -> Result<SshConnection, AppError> {
    let conn = state
        .lock()
        .map_err(|_| AppError::Internal("Lock poisoned".into()))?;
    ssh::get(&conn.conn, &id)
}

#[tauri::command]
pub fn update_ssh_connection(
    id: String,
    input: UpdateSshConnectionInput,
    state: State<'_, Mutex<DbConnection>>,
) -> Result<SshConnection, AppError> {
    let conn = state
        .lock()
        .map_err(|_| AppError::Internal("Lock poisoned".into()))?;
    ssh::update(&conn.conn, &id, &input)
}

#[tauri::command]
pub fn delete_ssh_connection(
    id: String,
    state: State<'_, Mutex<DbConnection>>,
) -> Result<(), AppError> {
    let conn = state
        .lock()
        .map_err(|_| AppError::Internal("Lock poisoned".into()))?;
    ssh::delete(&conn.conn, &id)
}

#[tauri::command]
pub fn connect_ssh(
    id: String,
    session_name: String,
    state: State<'_, Mutex<DbConnection>>,
) -> Result<SshConnectResult, AppError> {
    // Fetch profile then release lock before tmux operations
    let connection = {
        let conn = state
            .lock()
            .map_err(|_| AppError::Internal("Lock poisoned".into()))?;
        ssh::get(&conn.conn, &id)?
    };
    ssh::connect_with_profile(&connection, &session_name)
}

#[tauri::command]
pub fn connect_ssh_session(
    id: String,
    state: State<'_, Mutex<DbConnection>>,
) -> Result<SshConnectResult, AppError> {
    let connection = {
        let conn = state
            .lock()
            .map_err(|_| AppError::Internal("Lock poisoned".into()))?;
        ssh::get(&conn.conn, &id)?
    };
    ssh::connect_as_session(&connection)
}

#[tauri::command]
pub async fn check_ssh_remote_tmux(
    id: String,
    state: State<'_, Mutex<DbConnection>>,
) -> Result<Option<bool>, AppError> {
    let connection = {
        let conn = state
            .lock()
            .map_err(|_| AppError::Internal("Lock poisoned".into()))?;
        ssh::get(&conn.conn, &id)?
    };
    tauri::async_runtime::spawn_blocking(move || ssh::check_remote_tmux(&connection))
        .await
        .map_err(|e| AppError::Internal(format!("Task join error: {}", e)))?
}

#[tauri::command]
pub fn test_ssh_connection(
    id: String,
    state: State<'_, Mutex<DbConnection>>,
) -> Result<SshTestResult, AppError> {
    // Fetch profile then release lock before network IO
    let connection = {
        let conn = state
            .lock()
            .map_err(|_| AppError::Internal("Lock poisoned".into()))?;
        ssh::get(&conn.conn, &id)?
    };
    ssh::test_connection_with_profile(&connection)
}

#[tauri::command]
pub fn test_ssh_connection_params(
    host: String,
    port: i32,
    username: String,
    auth_type: SshAuthType,
    key_path: Option<String>,
) -> Result<SshTestResult, AppError> {
    let temp = SshConnection {
        id: String::new(),
        name: String::from("test"),
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
    ssh::test_connection_with_profile(&temp)
}
