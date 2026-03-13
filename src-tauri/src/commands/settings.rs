use crate::db::DbConnection;
use crate::errors::AppError;
use crate::models::agent_type::AgentType;
use crate::models::settings::{AgentCommandInfo, AppSetting};
use std::sync::Mutex;
use tauri::State;

#[tauri::command]
pub fn get_setting(
    key: String,
    default: String,
    state: State<'_, Mutex<DbConnection>>,
) -> Result<String, AppError> {
    let db = state
        .lock()
        .map_err(|_| AppError::Internal("DB lock poisoned in get_setting".into()))?;
    Ok(crate::services::settings::get_with_default(
        &db.conn, &key, &default,
    ))
}

#[tauri::command]
pub fn set_setting(
    key: String,
    value: String,
    state: State<'_, Mutex<DbConnection>>,
) -> Result<(), AppError> {
    let db = state
        .lock()
        .map_err(|_| AppError::Internal("DB lock poisoned in set_setting".into()))?;
    crate::services::settings::set(&db.conn, &key, &value)
}

#[tauri::command]
pub fn list_settings(
    state: State<'_, Mutex<DbConnection>>,
) -> Result<Vec<AppSetting>, AppError> {
    let db = state
        .lock()
        .map_err(|_| AppError::Internal("DB lock poisoned in list_settings".into()))?;
    crate::services::settings::list(&db.conn)
}

#[tauri::command]
pub fn get_agent_commands(
    state: State<'_, Mutex<DbConnection>>,
) -> Result<Vec<AgentCommandInfo>, AppError> {
    let db = state
        .lock()
        .map_err(|_| AppError::Internal("DB lock poisoned in get_agent_commands".into()))?;
    crate::services::settings::get_all_agent_commands(&db.conn)
}

#[tauri::command]
pub fn set_agent_command(
    agent_type: AgentType,
    command: String,
    state: State<'_, Mutex<DbConnection>>,
) -> Result<(), AppError> {
    let db = state
        .lock()
        .map_err(|_| AppError::Internal("DB lock poisoned in set_agent_command".into()))?;
    crate::services::settings::set_agent_command(&db.conn, &agent_type, &command)
}
