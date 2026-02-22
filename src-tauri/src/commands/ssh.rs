use crate::db::DbConnection;
use crate::errors::AppError;
use crate::models::ssh::{
    CreateSshConnectionInput, SshConnectResult, SshConnection, SshTestResult,
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
