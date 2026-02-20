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

#[tauri::command]
pub fn prune_notifications(
    retention_days: Option<i64>,
    state: State<'_, Mutex<DbConnection>>,
) -> Result<u64, AppError> {
    let db = state
        .lock()
        .map_err(|_| AppError::Internal("Database lock poisoned".into()))?;

    let days = retention_days.unwrap_or_else(|| {
        services::settings::get_with_default(&db.conn, "notification_retention_days", "7")
            .parse()
            .unwrap_or(7)
    });

    // Clamp to valid range to prevent accidental mass deletion
    let days = days.clamp(1, 365);

    services::notification::prune_old_notifications(&db.conn, days)
}
