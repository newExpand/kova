use rusqlite::{Connection, OptionalExtension};
use std::path::Path;
use tracing::{info, warn};
use uuid::Uuid;

use crate::errors::AppError;
use crate::models::project::Project;

/// 색상 인덱스 팔레트 크기 (0-7)
const COLOR_PALETTE_SIZE: i32 = 8;

/// 새 프로젝트 생성
///
/// # Arguments
/// * `conn` - 데이터베이스 커넥션
/// * `name` - 프로젝트 이름
/// * `path` - 프로젝트 경로
///
/// # Returns
/// 생성된 프로젝트 ID
///
/// # Errors
/// - 디렉토리가 존재하지 않으면 `AppError::NotFound`
/// - DB 오류 시 `AppError::Database`
pub fn create_project(conn: &Connection, name: String, path: String) -> Result<String, AppError> {
    // 디렉토리 존재 확인
    if !Path::new(&path).exists() {
        return Err(AppError::NotFound(format!("디렉토리를 찾을 수 없습니다: {}", path)));
    }

    let id = Uuid::new_v4().to_string();

    // 현재 프로젝트 수를 조회하여 색상 인덱스 결정 (순환 방식)
    let count: i32 = conn
        .prepare("SELECT COUNT(*) FROM projects WHERE is_active = 1")?
        .query_row([], |row| row.get(0))?;

    let color_index = count % COLOR_PALETTE_SIZE;

    conn.execute(
        "INSERT INTO projects (id, name, path, color_index, is_active, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, 1, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))",
        rusqlite::params![id, name, path, color_index],
    )?;

    info!("Created project: {} ({})", name, id);
    Ok(id)
}

/// 모든 활성 프로젝트 조회 (경로 존재 여부 포함)
///
/// # Arguments
/// * `conn` - 데이터베이스 커넥션
///
/// # Returns
/// 프로젝트 목록 (is_active = 1인 것만)
pub fn list_projects(conn: &Connection) -> Result<Vec<Project>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT id, name, path, color_index, account_id, default_prompt, is_active, created_at, updated_at
         FROM projects
         WHERE is_active = 1
         ORDER BY created_at DESC, rowid DESC",
    )?;

    let projects = stmt
        .query_map([], |row| {
            let path: String = row.get(2)?;
            let path_exists = Path::new(&path).exists();
            Ok(Project {
                id: row.get(0)?,
                name: row.get(1)?,
                path,
                color_index: row.get(3)?,
                account_id: row.get(4)?,
                default_prompt: row.get(5)?,
                is_active: row.get(6)?,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
                path_exists,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    for project in &projects {
        if !project.path_exists {
            warn!("Project path not found: {} ({})", project.path, project.name);
        }
    }

    Ok(projects)
}

/// 특정 프로젝트 조회
///
/// # Arguments
/// * `conn` - 데이터베이스 커넥션
/// * `id` - 프로젝트 ID
///
/// # Returns
/// 프로젝트 정보 또는 None
pub fn get_project(conn: &Connection, id: String) -> Result<Option<Project>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT id, name, path, color_index, account_id, default_prompt, is_active, created_at, updated_at
         FROM projects
         WHERE id = ?1",
    )?;

    let project = stmt
        .query_row(rusqlite::params![id], |row| {
            let path: String = row.get(2)?;
            let path_exists = Path::new(&path).exists();
            Ok(Project {
                id: row.get(0)?,
                name: row.get(1)?,
                path,
                color_index: row.get(3)?,
                account_id: row.get(4)?,
                default_prompt: row.get(5)?,
                is_active: row.get(6)?,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
                path_exists,
            })
        })
        .optional()?;

    Ok(project)
}

/// 프로젝트 업데이트 입력
///
/// 모든 필드는 Option으로, 제공된 필드만 업데이트
#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateProjectInput {
    pub name: Option<String>,
    pub path: Option<String>,
    pub account_id: Option<Option<String>>, // Some(None)으로 NULL 설정 가능
    pub default_prompt: Option<Option<String>>,
}

/// 프로젝트 업데이트 (부분 업데이트)
///
/// # Arguments
/// * `conn` - 데이터베이스 커넥션
/// * `id` - 프로젝트 ID
/// * `input` - 업데이트할 필드들 (Option으로 제공된 것만 수정)
///
/// # Returns
/// 업데이트된 프로젝트 정보
///
/// # Errors
/// - 프로젝트가 존재하지 않으면 `AppError::NotFound`
/// - 경로가 제공되었지만 존재하지 않으면 `AppError::NotFound`
pub fn update_project(
    conn: &Connection,
    id: String,
    input: UpdateProjectInput,
) -> Result<Project, AppError> {
    // 프로젝트 존재 확인
    let _existing = get_project(conn, id.clone())?
        .ok_or_else(|| AppError::NotFound(format!("프로젝트를 찾을 수 없습니다: {}", id)))?;

    // 경로 변경 시 존재 확인
    if let Some(ref new_path) = input.path {
        if !Path::new(new_path).exists() {
            return Err(AppError::NotFound(format!("디렉토리를 찾을 수 없습니다: {}", new_path)));
        }
    }

    // 동적 쿼리 빌드 (명시적 파라미터 인덱싱)
    let mut query = String::from("UPDATE projects SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')");
    let mut params: Vec<Box<dyn rusqlite::ToSql>> = vec![];
    let mut idx = 1u32;

    if let Some(name) = input.name {
        query.push_str(&format!(", name = ?{idx}"));
        params.push(Box::new(name));
        idx += 1;
    }

    if let Some(path) = input.path {
        query.push_str(&format!(", path = ?{idx}"));
        params.push(Box::new(path));
        idx += 1;
    }

    if let Some(account_id) = input.account_id {
        query.push_str(&format!(", account_id = ?{idx}"));
        params.push(Box::new(account_id));
        idx += 1;
    }

    if let Some(default_prompt) = input.default_prompt {
        query.push_str(&format!(", default_prompt = ?{idx}"));
        params.push(Box::new(default_prompt));
        idx += 1;
    }

    query.push_str(&format!(" WHERE id = ?{idx}"));
    params.push(Box::new(id.clone()));

    // 파라미터 바인딩을 위한 참조 변환
    let param_refs: Vec<&dyn rusqlite::ToSql> = params.iter().map(|p| p.as_ref()).collect();

    conn.execute(&query, param_refs.as_slice())?;

    info!("Updated project: {}", id);

    // 업데이트된 프로젝트 반환
    get_project(conn, id)?
        .ok_or_else(|| AppError::Internal("Updated project not found".to_string()))
}

/// 프로젝트 삭제 (소프트 삭제: is_active = 0)
///
/// # Arguments
/// * `conn` - 데이터베이스 커넥션
/// * `id` - 프로젝트 ID
///
/// # Errors
/// - 프로젝트가 존재하지 않으면 `AppError::NotFound`
pub fn delete_project(conn: &Connection, id: String) -> Result<(), AppError> {
    let rows_affected = conn.execute(
        "UPDATE projects SET is_active = 0, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?1",
        rusqlite::params![id],
    )?;

    if rows_affected == 0 {
        return Err(AppError::NotFound(format!("프로젝트를 찾을 수 없습니다: {}", id)));
    }

    info!("Soft deleted project: {}", id);
    Ok(())
}

/// 프로젝트 복원 (is_active = 1)
///
/// # Arguments
/// * `conn` - 데이터베이스 커넥션
/// * `id` - 프로젝트 ID
///
/// # Errors
/// - 프로젝트가 존재하지 않으면 `AppError::NotFound`
pub fn restore_project(conn: &Connection, id: String) -> Result<Project, AppError> {
    let rows_affected = conn.execute(
        "UPDATE projects SET is_active = 1, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?1",
        rusqlite::params![id],
    )?;

    if rows_affected == 0 {
        return Err(AppError::NotFound(format!("프로젝트를 찾을 수 없습니다: {}", id)));
    }

    info!("Restored project: {}", id);

    get_project(conn, id)?
        .ok_or_else(|| AppError::Internal("Restored project not found".to_string()))
}

/// 프로젝트 영구 삭제 (하드 삭제)
///
/// # Arguments
/// * `conn` - 데이터베이스 커넥션
/// * `id` - 프로젝트 ID
///
/// # Errors
/// - 프로젝트가 존재하지 않으면 `AppError::NotFound`
pub fn purge_project(conn: &Connection, id: String) -> Result<(), AppError> {
    let rows_affected = conn.execute("DELETE FROM projects WHERE id = ?1", rusqlite::params![id])?;

    if rows_affected == 0 {
        return Err(AppError::NotFound(format!("프로젝트를 찾을 수 없습니다: {}", id)));
    }

    info!("Purged project: {}", id);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;
    use std::fs;
    use tempfile::tempdir;

    fn setup_test_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
        conn.execute_batch(include_str!("../db/migrations/001_initial.sql"))
            .unwrap();
        conn
    }

    #[test]
    fn test_create_project_success() {
        let conn = setup_test_db();
        let temp_dir = tempdir().unwrap();
        let path = temp_dir.path().to_str().unwrap().to_string();

        let id = create_project(&conn, "Test Project".to_string(), path.clone()).unwrap();

        assert!(!id.is_empty());

        let project = get_project(&conn, id).unwrap().unwrap();
        assert_eq!(project.name, "Test Project");
        assert_eq!(project.path, path);
        assert_eq!(project.color_index, 0); // 첫 번째 프로젝트는 색상 인덱스 0
    }

    #[test]
    fn test_create_project_nonexistent_path() {
        let conn = setup_test_db();
        let result = create_project(&conn, "Test".to_string(), "/nonexistent/path".to_string());

        assert!(result.is_err());
        match result {
            Err(AppError::NotFound(msg)) => assert!(msg.contains("디렉토리를 찾을 수 없습니다")),
            _ => panic!("Expected NotFound error"),
        }
    }

    #[test]
    fn test_color_index_cycling() {
        let conn = setup_test_db();
        let temp_dir = tempdir().unwrap();
        let path = temp_dir.path().to_str().unwrap().to_string();

        // 9개 프로젝트 생성 (색상 팔레트 크기 8보다 1 많음)
        for i in 0..9 {
            create_project(&conn, format!("Project {}", i), path.clone()).unwrap();
        }

        let projects = list_projects(&conn).unwrap();
        assert_eq!(projects.len(), 9);

        // 마지막 프로젝트 (9번째)는 색상 인덱스가 0이어야 함 (8 % 8 = 0)
        // 최근 프로젝트가 먼저 오므로, 첫 번째가 마지막 생성된 프로젝트
        assert_eq!(projects[0].color_index, 0);
    }

    #[test]
    fn test_list_projects() {
        let conn = setup_test_db();
        let temp_dir = tempdir().unwrap();

        let path1 = temp_dir.path().join("project1");
        fs::create_dir(&path1).unwrap();
        create_project(&conn, "Project 1".to_string(), path1.to_str().unwrap().to_string()).unwrap();

        let path2 = temp_dir.path().join("project2");
        fs::create_dir(&path2).unwrap();
        create_project(&conn, "Project 2".to_string(), path2.to_str().unwrap().to_string()).unwrap();

        let projects = list_projects(&conn).unwrap();
        assert_eq!(projects.len(), 2);
        // DESC 정렬이므로 최근 생성이 먼저
        assert_eq!(projects[0].name, "Project 2");
        assert_eq!(projects[1].name, "Project 1");
    }

    #[test]
    fn test_get_project_not_found() {
        let conn = setup_test_db();
        let result = get_project(&conn, "nonexistent-id".to_string()).unwrap();
        assert!(result.is_none());
    }

    #[test]
    fn test_update_project_name() {
        let conn = setup_test_db();
        let temp_dir = tempdir().unwrap();
        let path = temp_dir.path().to_str().unwrap().to_string();

        let id = create_project(&conn, "Original".to_string(), path.clone()).unwrap();

        let input = UpdateProjectInput {
            name: Some("Updated".to_string()),
            path: None,
            account_id: None,
            default_prompt: None,
        };

        let updated = update_project(&conn, id.clone(), input).unwrap();
        assert_eq!(updated.name, "Updated");
        assert_eq!(updated.path, path);
    }

    #[test]
    fn test_update_project_nonexistent_path() {
        let conn = setup_test_db();
        let temp_dir = tempdir().unwrap();
        let path = temp_dir.path().to_str().unwrap().to_string();

        let id = create_project(&conn, "Test".to_string(), path).unwrap();

        let input = UpdateProjectInput {
            name: None,
            path: Some("/nonexistent/path".to_string()),
            account_id: None,
            default_prompt: None,
        };

        let result = update_project(&conn, id, input);
        assert!(result.is_err());
    }

    #[test]
    fn test_delete_and_restore() {
        let conn = setup_test_db();
        let temp_dir = tempdir().unwrap();
        let path = temp_dir.path().to_str().unwrap().to_string();

        let id = create_project(&conn, "Test".to_string(), path).unwrap();

        // 삭제
        delete_project(&conn, id.clone()).unwrap();
        let projects = list_projects(&conn).unwrap();
        assert_eq!(projects.len(), 0); // is_active = 1인 것만 조회

        // 복원
        let restored = restore_project(&conn, id.clone()).unwrap();
        assert_eq!(restored.name, "Test");
        assert!(restored.is_active);

        let projects = list_projects(&conn).unwrap();
        assert_eq!(projects.len(), 1);
    }

    #[test]
    fn test_purge_project() {
        let conn = setup_test_db();
        let temp_dir = tempdir().unwrap();
        let path = temp_dir.path().to_str().unwrap().to_string();

        let id = create_project(&conn, "Test".to_string(), path).unwrap();

        // 영구 삭제
        purge_project(&conn, id.clone()).unwrap();

        // DB에서 완전히 제거됨
        let result = get_project(&conn, id).unwrap();
        assert!(result.is_none());
    }

    #[test]
    fn test_update_project_not_found() {
        let conn = setup_test_db();
        let input = UpdateProjectInput {
            name: Some("New".to_string()),
            path: None,
            account_id: None,
            default_prompt: None,
        };

        let result = update_project(&conn, "nonexistent-id".to_string(), input);
        assert!(result.is_err());
        match result {
            Err(AppError::NotFound(msg)) => assert!(msg.contains("프로젝트를 찾을 수 없습니다")),
            _ => panic!("Expected NotFound error"),
        }
    }
}
