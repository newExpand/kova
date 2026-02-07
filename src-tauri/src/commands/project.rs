use tauri::State;

use crate::db::DbConnection;
use crate::errors::AppError;
use crate::models::project::Project;
use crate::services::project as project_service;

#[tauri::command]
pub fn health_check(db: State<DbConnection>) -> Result<String, AppError> {
    let conn = db
        .conn
        .lock()
        .map_err(|e| AppError::Internal(format!("DB lock failed: {e}")))?;

    let count: i32 = conn
        .prepare("SELECT COUNT(*) FROM sqlite_master WHERE type='table'")?
        .query_row([], |row| row.get(0))?;

    Ok(format!("DB connected — {count} tables"))
}

/// 새 프로젝트 생성
#[tauri::command]
pub fn create_project(
    db: State<DbConnection>,
    name: String,
    path: String,
) -> Result<String, AppError> {
    let conn = db
        .conn
        .lock()
        .map_err(|e| AppError::Internal(format!("DB lock failed: {e}")))?;

    project_service::create_project(&conn, name, path)
}

/// 모든 활성 프로젝트 목록 조회
#[tauri::command]
pub fn list_projects(db: State<DbConnection>) -> Result<Vec<Project>, AppError> {
    let conn = db
        .conn
        .lock()
        .map_err(|e| AppError::Internal(format!("DB lock failed: {e}")))?;

    project_service::list_projects(&conn)
}

/// 특정 프로젝트 조회
#[tauri::command]
pub fn get_project(db: State<DbConnection>, id: String) -> Result<Option<Project>, AppError> {
    let conn = db
        .conn
        .lock()
        .map_err(|e| AppError::Internal(format!("DB lock failed: {e}")))?;

    project_service::get_project(&conn, id)
}

/// 프로젝트 업데이트
#[tauri::command]
pub fn update_project(
    db: State<DbConnection>,
    id: String,
    input: project_service::UpdateProjectInput,
) -> Result<Project, AppError> {
    let conn = db
        .conn
        .lock()
        .map_err(|e| AppError::Internal(format!("DB lock failed: {e}")))?;

    project_service::update_project(&conn, id, input)
}

/// 프로젝트 삭제 (소프트 삭제)
#[tauri::command]
pub fn delete_project(db: State<DbConnection>, id: String) -> Result<(), AppError> {
    let conn = db
        .conn
        .lock()
        .map_err(|e| AppError::Internal(format!("DB lock failed: {e}")))?;

    project_service::delete_project(&conn, id)
}

/// 프로젝트 복원
#[tauri::command]
pub fn restore_project(db: State<DbConnection>, id: String) -> Result<Project, AppError> {
    let conn = db
        .conn
        .lock()
        .map_err(|e| AppError::Internal(format!("DB lock failed: {e}")))?;

    project_service::restore_project(&conn, id)
}

/// 프로젝트 영구 삭제
#[tauri::command]
pub fn purge_project(db: State<DbConnection>, id: String) -> Result<(), AppError> {
    let conn = db
        .conn
        .lock()
        .map_err(|e| AppError::Internal(format!("DB lock failed: {e}")))?;

    project_service::purge_project(&conn, id)
}

#[cfg(test)]
mod tests {
    use crate::db::DbConnection;

    #[test]
    fn test_health_check_logic() {
        let dir = tempfile::tempdir().expect("Failed to create temp dir");
        let db_path = dir.path().join("test.db");
        let db = DbConnection::new(&db_path).expect("DB init failed");

        let conn = db
            .conn
            .lock()
            .expect("Lock failed");

        let count: i32 = conn
            .prepare("SELECT COUNT(*) FROM sqlite_master WHERE type='table'")
            .expect("Prepare failed")
            .query_row([], |row| row.get(0))
            .expect("Query failed");

        assert!(count >= 2, "Should have at least projects and team_sessions tables");
    }
}
