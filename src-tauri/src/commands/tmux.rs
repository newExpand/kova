use crate::db::DbConnection;
use crate::errors::AppError;
use crate::models::tmux::{SessionInfo, TmuxPane, TmuxSession, TmuxWindow};
use crate::services;
use std::sync::Mutex;
use tauri::State;

#[tauri::command]
pub fn check_tmux_available() -> Result<bool, AppError> {
    Ok(services::tmux::is_tmux_available())
}

#[tauri::command]
pub fn list_tmux_sessions() -> Result<Vec<TmuxSession>, AppError> {
    services::tmux::list_sessions()
}

#[tauri::command]
pub fn list_tmux_panes(session_name: String) -> Result<Vec<TmuxPane>, AppError> {
    services::tmux::list_panes(&session_name)
}

#[tauri::command]
pub fn create_tmux_session(name: String, cols: u16, rows: u16) -> Result<(), AppError> {
    services::tmux::create_session(&name, cols, rows)
}

#[tauri::command]
pub fn kill_tmux_session(name: String) -> Result<(), AppError> {
    services::tmux::kill_session(&name)
}

#[tauri::command]
pub fn split_tmux_pane_horizontal(session_name: String) -> Result<(), AppError> {
    services::tmux::split_pane_horizontal(&session_name)
}

#[tauri::command]
pub fn split_tmux_pane_vertical(session_name: String) -> Result<(), AppError> {
    services::tmux::split_pane_vertical(&session_name)
}

#[tauri::command]
pub fn close_tmux_pane(session_name: String) -> Result<(), AppError> {
    services::tmux::close_pane(&session_name)
}

#[tauri::command]
pub fn list_tmux_windows(session_name: String) -> Result<Vec<TmuxWindow>, AppError> {
    services::tmux::list_windows(&session_name)
}

#[tauri::command]
pub fn create_tmux_window(session_name: String) -> Result<(), AppError> {
    services::tmux::create_window(&session_name)
}

#[tauri::command]
pub fn close_tmux_window(session_name: String) -> Result<(), AppError> {
    services::tmux::close_window(&session_name)
}

#[tauri::command]
pub fn next_tmux_window(session_name: String) -> Result<(), AppError> {
    services::tmux::next_window(&session_name)
}

#[tauri::command]
pub fn previous_tmux_window(session_name: String) -> Result<(), AppError> {
    services::tmux::previous_window(&session_name)
}

#[tauri::command]
pub fn register_tmux_session(
    project_id: String,
    session_name: String,
    state: State<'_, Mutex<DbConnection>>,
) -> Result<Vec<SessionInfo>, AppError> {
    let conn = state
        .lock()
        .map_err(|_| AppError::Internal("Lock poisoned".into()))?;
    services::tmux::register_session_and_list(&conn.conn, &project_id, &session_name)
}

#[tauri::command]
pub fn unregister_tmux_session(
    session_name: String,
    state: State<'_, Mutex<DbConnection>>,
) -> Result<Vec<SessionInfo>, AppError> {
    let conn = state
        .lock()
        .map_err(|_| AppError::Internal("Lock poisoned".into()))?;
    services::tmux::unregister_session_and_list(&conn.conn, &session_name)
}

#[tauri::command]
pub fn send_tmux_keys(session_name: String, keys: String) -> Result<(), AppError> {
    services::tmux::send_keys(&session_name, &keys)
}

#[tauri::command]
pub fn list_tmux_sessions_with_ownership(
    state: State<'_, Mutex<DbConnection>>,
) -> Result<Vec<SessionInfo>, AppError> {
    let conn = state
        .lock()
        .map_err(|_| AppError::Internal("Lock poisoned".into()))?;
    services::tmux::list_sessions_with_ownership(&conn.conn)
}
