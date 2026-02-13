use crate::db::DbConnection;
use crate::errors::AppError;
use crate::models::notification::NotificationRecord;
use crate::services;
use std::sync::Mutex;
use tauri::State;

#[tauri::command]
pub fn list_project_notifications(
    project_id: String,
    limit: Option<i64>,
    state: State<'_, Mutex<DbConnection>>,
) -> Result<Vec<NotificationRecord>, AppError> {
    let db = state
        .lock()
        .map_err(|_| AppError::Internal("Database lock poisoned".into()))?;

    services::notification::list_notifications(&db.conn, &project_id, limit.unwrap_or(50))
}
