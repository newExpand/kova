use crate::db::DbConnection;
use crate::errors::AppError;
use crate::models::agent_activity::AgentActivityRecord;
use crate::services;
use std::sync::Mutex;
use tauri::State;

#[tauri::command]
pub fn list_agent_activities(
    project_id: String,
    limit: Option<i64>,
    state: State<'_, Mutex<DbConnection>>,
) -> Result<Vec<AgentActivityRecord>, AppError> {
    let db = state
        .lock()
        .map_err(|_| AppError::Internal("Lock poisoned".into()))?;
    services::agent_activity::list_activities(&db.conn, &project_id, limit.unwrap_or(100).clamp(0, 10_000))
}
