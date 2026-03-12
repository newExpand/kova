use crate::db::DbConnection;
use crate::errors::AppError;
use crate::models::agent_type::AgentType;
use crate::models::project::{Project, UpdateProjectInput};
use crate::services::{hooks, project};
use std::sync::Mutex;
use tauri::State;
use tracing::warn;

#[tauri::command]
pub fn create_project(
    name: String,
    path: String,
    color_index: Option<i32>,
    agent_type: Option<AgentType>,
    state: State<'_, Mutex<DbConnection>>,
) -> Result<Project, AppError> {
    let conn = state
        .lock()
        .map_err(|_| AppError::Internal("Lock poisoned".into()))?;
    let agent = agent_type.unwrap_or_default();
    let project = project::create(&conn.conn, &name, &path, color_index.unwrap_or(0), agent)?;

    // Hook 자동 주입 (best-effort — supports_hooks가 true인 에이전트만)
    if agent.supports_hooks() {
        match super::hooks::read_event_server_port() {
            Ok(port) => {
                if let Err(e) = hooks::inject_hooks(std::path::Path::new(&project.path), port) {
                    warn!("Hook injection failed for {}: {}", project.path, e);
                }
            }
            Err(e) => {
                warn!("Cannot inject hooks (event server port unavailable): {}", e);
            }
        }
    }

    Ok(project)
}

#[tauri::command]
pub fn list_projects(state: State<'_, Mutex<DbConnection>>) -> Result<Vec<Project>, AppError> {
    let conn = state
        .lock()
        .map_err(|_| AppError::Internal("Lock poisoned".into()))?;
    project::list(&conn.conn)
}

#[tauri::command]
pub fn get_project(
    id: String,
    state: State<'_, Mutex<DbConnection>>,
) -> Result<Project, AppError> {
    let conn = state
        .lock()
        .map_err(|_| AppError::Internal("Lock poisoned".into()))?;
    project::get(&conn.conn, &id)
}

#[tauri::command]
pub fn update_project(
    id: String,
    input: UpdateProjectInput,
    state: State<'_, Mutex<DbConnection>>,
) -> Result<Project, AppError> {
    let conn = state
        .lock()
        .map_err(|_| AppError::Internal("Lock poisoned".into()))?;
    project::update(&conn.conn, &id, &input)
}

#[tauri::command]
pub fn delete_project(
    id: String,
    state: State<'_, Mutex<DbConnection>>,
) -> Result<(), AppError> {
    let conn = state
        .lock()
        .map_err(|_| AppError::Internal("Lock poisoned".into()))?;
    project::soft_delete(&conn.conn, &id)
}

#[tauri::command]
pub fn restore_project(
    id: String,
    state: State<'_, Mutex<DbConnection>>,
) -> Result<(), AppError> {
    let conn = state
        .lock()
        .map_err(|_| AppError::Internal("Lock poisoned".into()))?;
    project::restore(&conn.conn, &id)
}

#[tauri::command]
pub fn purge_project(
    id: String,
    state: State<'_, Mutex<DbConnection>>,
) -> Result<(), AppError> {
    let conn = state
        .lock()
        .map_err(|_| AppError::Internal("Lock poisoned".into()))?;

    // 삭제 전에 project path 조회 (삭제 후에는 조회 불가)
    let project_path = project::get(&conn.conn, &id).ok().map(|p| p.path);

    project::purge(&conn.conn, &id)?;

    // Hook 제거 (best-effort)
    if let Some(path) = project_path {
        if let Err(e) = hooks::remove_hooks(std::path::Path::new(&path)) {
            warn!("Hook removal failed for {}: {}", path, e);
        }
    }

    Ok(())
}

#[tauri::command]
pub fn reorder_projects(
    project_ids: Vec<String>,
    state: State<'_, Mutex<DbConnection>>,
) -> Result<(), AppError> {
    let conn = state
        .lock()
        .map_err(|_| AppError::Internal("Lock poisoned".into()))?;
    project::reorder(&conn.conn, &project_ids).map_err(|e| {
        tracing::error!("Failed to reorder projects: {}", e);
        e
    })
}
