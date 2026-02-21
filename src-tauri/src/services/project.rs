use crate::errors::AppError;
use crate::models::project::{Project, UpdateProjectInput};
use rusqlite::{Connection, OptionalExtension};
use std::path::Path;
use tracing::info;
use uuid::Uuid;

/// Create a new project
pub fn create(
    conn: &Connection,
    name: &str,
    path: &str,
    color_index: i32,
) -> Result<Project, AppError> {
    // Validate and canonicalize path
    let canonical_path = std::fs::canonicalize(Path::new(path))
        .map_err(|e| AppError::InvalidInput(format!("Invalid path: {}", e)))?;

    let path_str = canonical_path.to_string_lossy().to_string();

    // Check for duplicate path
    let exists: Option<String> = conn
        .query_row(
            "SELECT id FROM projects WHERE path = ?1 AND is_active = 1",
            [&path_str],
            |row| row.get(0),
        )
        .optional()?;

    if exists.is_some() {
        return Err(AppError::Duplicate(format!(
            "Project at path '{}' already exists",
            path_str
        )));
    }

    // Purge any soft-deleted project with the same path
    // (so the UNIQUE constraint on path doesn't block re-registration)
    conn.execute(
        "DELETE FROM projects WHERE path = ?1 AND is_active = 0",
        [&path_str],
    )?;

    // Generate UUID
    let id = Uuid::new_v4().to_string();

    // Insert project
    conn.execute(
        "INSERT INTO projects (id, name, path, color_index) VALUES (?1, ?2, ?3, ?4)",
        [&id, name, &path_str, &color_index.to_string()],
    )?;

    info!("Created project: {} ({})", name, id);

    // Return created project
    get(conn, &id)
}

/// List all active projects
pub fn list(conn: &Connection) -> Result<Vec<Project>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT id, name, path, color_index, is_active, created_at, updated_at
         FROM projects WHERE is_active = 1 ORDER BY created_at DESC",
    )?;

    let projects = stmt
        .query_map([], |row| {
            Ok(Project {
                id: row.get(0)?,
                name: row.get(1)?,
                path: row.get(2)?,
                color_index: row.get(3)?,
                is_active: row.get::<_, i32>(4)? == 1,
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(projects)
}

/// Get a single active project by its canonical path
pub fn get_by_path(conn: &Connection, path: &str) -> Result<Option<Project>, AppError> {
    match conn.query_row(
        "SELECT id, name, path, color_index, is_active, created_at, updated_at
         FROM projects WHERE path = ?1 AND is_active = 1",
        [path],
        |row| {
            Ok(Project {
                id: row.get(0)?,
                name: row.get(1)?,
                path: row.get(2)?,
                color_index: row.get(3)?,
                is_active: row.get::<_, i32>(4)? == 1,
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
            })
        },
    ) {
        Ok(project) => Ok(Some(project)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(AppError::Database(e)),
    }
}

/// Get a single project by ID
pub fn get(conn: &Connection, id: &str) -> Result<Project, AppError> {
    match conn.query_row(
        "SELECT id, name, path, color_index, is_active, created_at, updated_at
         FROM projects WHERE id = ?1",
        [id],
        |row| {
            Ok(Project {
                id: row.get(0)?,
                name: row.get(1)?,
                path: row.get(2)?,
                color_index: row.get(3)?,
                is_active: row.get::<_, i32>(4)? == 1,
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
            })
        },
    ) {
        Ok(project) => Ok(project),
        Err(rusqlite::Error::QueryReturnedNoRows) => {
            Err(AppError::NotFound(format!("Project not found: {}", id)))
        }
        Err(e) => Err(AppError::Database(e)),
    }
}

/// Update a project
pub fn update(
    conn: &Connection,
    id: &str,
    input: &UpdateProjectInput,
) -> Result<Project, AppError> {
    // Check if project exists
    let _ = get(conn, id)?;

    // Build dynamic UPDATE query
    let mut updates = Vec::new();
    let mut params: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

    if let Some(ref name) = input.name {
        updates.push("name = ?");
        params.push(Box::new(name.clone()));
    }
    if let Some(color_index) = input.color_index {
        updates.push("color_index = ?");
        params.push(Box::new(color_index));
    }

    if updates.is_empty() {
        return get(conn, id); // No updates, return existing
    }

    updates.push("updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')");
    params.push(Box::new(id.to_string()));

    let query = format!("UPDATE projects SET {} WHERE id = ?", updates.join(", "));

    conn.execute(&query, rusqlite::params_from_iter(params.iter()))?;

    info!("Updated project: {}", id);
    get(conn, id)
}

/// Soft delete a project (set is_active = 0)
pub fn soft_delete(conn: &Connection, id: &str) -> Result<(), AppError> {
    let count = conn.execute(
        "UPDATE projects SET is_active = 0, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
         WHERE id = ?1",
        [id],
    )?;

    if count == 0 {
        return Err(AppError::NotFound(format!("Project not found: {}", id)));
    }

    info!("Soft deleted project: {}", id);
    Ok(())
}

/// Restore a soft-deleted project
pub fn restore(conn: &Connection, id: &str) -> Result<(), AppError> {
    let count = conn.execute(
        "UPDATE projects SET is_active = 1, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
         WHERE id = ?1",
        [id],
    )?;

    if count == 0 {
        return Err(AppError::NotFound(format!("Project not found: {}", id)));
    }

    info!("Restored project: {}", id);
    Ok(())
}

/// Permanently delete a project
pub fn purge(conn: &Connection, id: &str) -> Result<(), AppError> {
    let count = conn.execute("DELETE FROM projects WHERE id = ?1", [id])?;

    if count == 0 {
        return Err(AppError::NotFound(format!("Project not found: {}", id)));
    }

    info!("Purged project: {}", id);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn setup_test_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute("PRAGMA foreign_keys = ON", []).unwrap();
        conn.execute_batch(include_str!("../db/migrations/001_initial.sql"))
            .unwrap();
        conn
    }

    #[test]
    fn test_create_project() {
        let conn = setup_test_db();
        let result = create(&conn, "Test Project", "/tmp", 0);
        assert!(result.is_ok());
        let project = result.unwrap();
        assert_eq!(project.name, "Test Project");
        assert!(project.id.len() > 0); // UUID generated
    }

    #[test]
    fn test_duplicate_path_rejected() {
        let conn = setup_test_db();
        create(&conn, "Project 1", "/tmp", 0).unwrap();
        let result = create(&conn, "Project 2", "/tmp", 0);
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), AppError::Duplicate(_)));
    }

    #[test]
    fn test_soft_delete_and_restore() {
        let conn = setup_test_db();
        let project = create(&conn, "Test", "/tmp", 0).unwrap();

        // Soft delete
        soft_delete(&conn, &project.id).unwrap();
        let projects = list(&conn).unwrap();
        assert_eq!(projects.len(), 0); // Soft deleted project not in list

        // Restore
        restore(&conn, &project.id).unwrap();
        let projects = list(&conn).unwrap();
        assert_eq!(projects.len(), 1); // Restored project appears
        assert_eq!(projects[0].id, project.id);
    }

    #[test]
    fn test_update_project() {
        let conn = setup_test_db();
        let project = create(&conn, "Original", "/tmp", 0).unwrap();

        let input = UpdateProjectInput {
            name: Some("Updated".into()),
            color_index: Some(5),
        };

        let updated = update(&conn, &project.id, &input).unwrap();
        assert_eq!(updated.name, "Updated");
        assert_eq!(updated.color_index, 5);
    }

    #[test]
    fn test_soft_delete_then_recreate_same_path() {
        let conn = setup_test_db();
        let project = create(&conn, "Original", "/tmp", 0).unwrap();

        // Soft delete
        soft_delete(&conn, &project.id).unwrap();
        let projects = list(&conn).unwrap();
        assert_eq!(projects.len(), 0);

        // Re-create with same path should succeed
        let new_project = create(&conn, "Recreated", "/tmp", 3).unwrap();
        assert_ne!(new_project.id, project.id); // New UUID
        assert_eq!(new_project.name, "Recreated");
        assert_eq!(new_project.color_index, 3);

        // Old soft-deleted record should be purged
        let result = get(&conn, &project.id);
        assert!(result.is_err());
    }

    #[test]
    fn test_purge_project() {
        let conn = setup_test_db();
        let project = create(&conn, "ToDelete", "/tmp", 0).unwrap();

        purge(&conn, &project.id).unwrap();

        // Try to get deleted project
        let result = get(&conn, &project.id);
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), AppError::NotFound(_)));
    }
}
