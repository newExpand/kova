use crate::db::DbConnection;
use crate::errors::AppError;
use crate::services::hooks;
use std::fs;
use std::path::Path;
use std::sync::Mutex;
use tauri::State;

/// Read event server port from ~/.flow-orche/event-server.port
fn read_event_server_port() -> Result<u16, AppError> {
    let home_dir = dirs::home_dir().ok_or_else(|| AppError::Internal("Home directory not found".into()))?;
    let port_file = home_dir.join(".flow-orche/event-server.port");

    if !port_file.exists() {
        return Err(AppError::EventServer("Event server port file not found. Event server may not be running.".into()));
    }

    let content = fs::read_to_string(&port_file)?;
    let port: u16 = content.trim().parse()
        .map_err(|_| AppError::EventServer(format!("Invalid port in {}: {}", port_file.display(), content)))?;

    Ok(port)
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
