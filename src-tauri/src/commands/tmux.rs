use crate::errors::AppError;
use crate::models::tmux::{TmuxPane, TmuxSession};
use crate::services;

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
