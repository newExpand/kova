use crate::db::DbConnection;
use crate::errors::AppError;
use crate::models::settings::AppSetting;
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
        .map_err(|_| AppError::Internal("Lock poisoned".into()))?;
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
        .map_err(|_| AppError::Internal("Lock poisoned".into()))?;
    crate::services::settings::set(&db.conn, &key, &value)
}

#[tauri::command]
pub fn list_settings(
    state: State<'_, Mutex<DbConnection>>,
) -> Result<Vec<AppSetting>, AppError> {
    let db = state
        .lock()
        .map_err(|_| AppError::Internal("Lock poisoned".into()))?;
    crate::services::settings::list(&db.conn)
}
