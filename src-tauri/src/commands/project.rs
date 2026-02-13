use crate::db::DbConnection;
use crate::errors::AppError;
use crate::models::project::{Project, UpdateProjectInput};
use crate::services::project;
use std::sync::Mutex;
use tauri::State;

#[tauri::command]
pub fn create_project(
    name: String,
    path: String,
    color_index: Option<i32>,
    state: State<'_, Mutex<DbConnection>>,
) -> Result<Project, AppError> {
    let conn = state
        .lock()
        .map_err(|_| AppError::Internal("Lock poisoned".into()))?;
    project::create(&conn.conn, &name, &path, color_index.unwrap_or(0))
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
    project::purge(&conn.conn, &id)
}
