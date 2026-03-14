use crate::db::DbConnection;
use crate::errors::AppError;
use crate::services::hooks;
use std::path::Path;
use std::sync::Mutex;
use tauri::State;

/// Read event server port from ~/.kova/event-server.port
pub(crate) fn read_event_server_port() -> Result<u16, AppError> {
    crate::services::event_server::read_port_from_file()
}

#[tauri::command]
pub fn inject_project_hooks(
    project_path: String,
    _state: State<'_, Mutex<DbConnection>>,
) -> Result<(), AppError> {
    let port = read_event_server_port()?;
    hooks::inject_hooks(Path::new(&project_path), port)
}

#[tauri::command]
pub fn remove_project_hooks(
    project_path: String,
    _state: State<'_, Mutex<DbConnection>>,
) -> Result<(), AppError> {
    hooks::remove_hooks(Path::new(&project_path))
}
