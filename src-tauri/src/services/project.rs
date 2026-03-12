use crate::errors::AppError;
use crate::models::agent_type::AgentType;
use crate::models::project::{Project, UpdateProjectInput};
use rusqlite::{Connection, OptionalExtension};
use std::path::Path;
use tracing::info;
use uuid::Uuid;

/// Shared column list for all project SELECT queries.
/// Must stay in sync with `row_to_project`.
const PROJECT_COLUMNS: &str = "id, name, path, color_index, sort_order, is_active, agent_type, created_at, updated_at";

/// Map a row (selected with `PROJECT_COLUMNS`) into a `Project`.
fn row_to_project(row: &rusqlite::Row<'_>) -> rusqlite::Result<Project> {
    let agent_type_str: String = row.get(6)?;
    Ok(Project {
        id: row.get(0)?,
        name: row.get(1)?,
        path: row.get(2)?,
        color_index: row.get(3)?,
        sort_order: row.get(4)?,
        is_active: row.get::<_, i32>(5)? == 1,
        agent_type: AgentType::from_db_str(&agent_type_str),
        created_at: row.get(7)?,
        updated_at: row.get(8)?,
    })
}

/// Create a new project
pub fn create(
    conn: &Connection,
    name: &str,
    path: &str,
    color_index: i32,
    agent_type: AgentType,
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

    // Generate UUID
    let id = Uuid::new_v4().to_string();

    // Wrap purge + shift + insert in a transaction to prevent partial corruption
    let tx = conn.unchecked_transaction()?;

    // Purge any soft-deleted project with the same path
    // (so the UNIQUE constraint on path doesn't block re-registration)
    tx.execute(
        "DELETE FROM projects WHERE path = ?1 AND is_active = 0",
        [&path_str],
    )?;

    // Shift existing projects down to make room at top
    tx.execute(
        "UPDATE projects SET sort_order = sort_order + 1 WHERE is_active = 1",
        [],
    )?;

    // Insert project at top (sort_order = 0)
    tx.execute(
        "INSERT INTO projects (id, name, path, color_index, sort_order, agent_type) VALUES (?1, ?2, ?3, ?4, 0, ?5)",
        [&id, name, &path_str, &color_index.to_string(), agent_type.to_db_str()],
    )?;

    tx.commit()?;

    info!("Created project: {} ({}) with agent type: {:?}", name, id, agent_type);

    // Return created project
    get(conn, &id)
}

/// List all active projects
pub fn list(conn: &Connection) -> Result<Vec<Project>, AppError> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {} FROM projects WHERE is_active = 1 ORDER BY sort_order ASC",
        PROJECT_COLUMNS,
    ))?;

    let projects = stmt
        .query_map([], row_to_project)?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(projects)
}

/// Get a single active project by its canonical path
pub fn get_by_path(conn: &Connection, path: &str) -> Result<Option<Project>, AppError> {
    match conn.query_row(
        &format!(
            "SELECT {} FROM projects WHERE path = ?1 AND is_active = 1",
            PROJECT_COLUMNS,
        ),
        [path],
        row_to_project,
    ) {
        Ok(project) => Ok(Some(project)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(AppError::Database(e)),
    }
}

/// Get a single project by ID
pub fn get(conn: &Connection, id: &str) -> Result<Project, AppError> {
    match conn.query_row(
        &format!("SELECT {} FROM projects WHERE id = ?1", PROJECT_COLUMNS),
        [id],
        row_to_project,
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
    if let Some(agent_type) = input.agent_type {
        updates.push("agent_type = ?");
        params.push(Box::new(agent_type.to_db_str().to_string()));
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

/// Reorder projects by setting sort_order based on the given ID sequence.
/// The input must contain exactly all active project IDs.
pub fn reorder(conn: &Connection, project_ids: &[String]) -> Result<(), AppError> {
    // Validate uniqueness: reject duplicate IDs
    let unique_ids: std::collections::HashSet<&String> = project_ids.iter().collect();
    if unique_ids.len() != project_ids.len() {
        return Err(AppError::InvalidInput(
            "Duplicate project IDs in reorder request".to_string(),
        ));
    }

    // Validate exhaustiveness: input must cover all active projects
    let active_count: i32 = conn.query_row(
        "SELECT COUNT(*) FROM projects WHERE is_active = 1",
        [],
        |row| row.get(0),
    )?;

    if project_ids.len() != active_count as usize {
        return Err(AppError::InvalidInput(format!(
            "Expected {} project IDs, got {}",
            active_count,
            project_ids.len()
        )));
    }

    let tx = conn.unchecked_transaction()?;

    for (index, id) in project_ids.iter().enumerate() {
        let count = tx.execute(
            "UPDATE projects SET sort_order = ?1, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?2 AND is_active = 1",
            rusqlite::params![index as i32, id],
        )?;

        if count == 0 {
            return Err(AppError::NotFound(format!("Project not found: {}", id)));
        }
    }

    tx.commit()?;
    info!("Reordered {} projects", project_ids.len());
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
    use crate::models::agent_type::AgentType;
    use rusqlite::Connection;

    fn setup_test_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute("PRAGMA foreign_keys = ON", []).unwrap();
        conn.execute_batch(include_str!("../db/migrations/001_initial.sql"))
            .unwrap();
        conn.execute_batch(include_str!("../db/migrations/006_project_sort_order.sql"))
            .unwrap();
        conn.execute_batch(include_str!("../db/migrations/008_project_agent_type.sql"))
            .unwrap();
        conn
    }

    #[test]
    fn test_create_project() {
        let conn = setup_test_db();
        let result = create(&conn, "Test Project", "/tmp", 0, AgentType::default());
        assert!(result.is_ok());
        let project = result.unwrap();
        assert_eq!(project.name, "Test Project");
        assert!(project.id.len() > 0); // UUID generated
    }

    #[test]
    fn test_duplicate_path_rejected() {
        let conn = setup_test_db();
        create(&conn, "Project 1", "/tmp", 0, AgentType::default()).unwrap();
        let result = create(&conn, "Project 2", "/tmp", 0, AgentType::default());
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), AppError::Duplicate(_)));
    }

    #[test]
    fn test_soft_delete_and_restore() {
        let conn = setup_test_db();
        let project = create(&conn, "Test", "/tmp", 0, AgentType::default()).unwrap();

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
        let project = create(&conn, "Original", "/tmp", 0, AgentType::default()).unwrap();

        let input = UpdateProjectInput {
            name: Some("Updated".into()),
            color_index: Some(5),
            agent_type: None,
        };

        let updated = update(&conn, &project.id, &input).unwrap();
        assert_eq!(updated.name, "Updated");
        assert_eq!(updated.color_index, 5);
    }

    #[test]
    fn test_soft_delete_then_recreate_same_path() {
        let conn = setup_test_db();
        let project = create(&conn, "Original", "/tmp", 0, AgentType::default()).unwrap();

        // Soft delete
        soft_delete(&conn, &project.id).unwrap();
        let projects = list(&conn).unwrap();
        assert_eq!(projects.len(), 0);

        // Re-create with same path should succeed
        let new_project = create(&conn, "Recreated", "/tmp", 3, AgentType::default()).unwrap();
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
        let project = create(&conn, "ToDelete", "/tmp", 0, AgentType::default()).unwrap();

        purge(&conn, &project.id).unwrap();

        // Try to get deleted project
        let result = get(&conn, &project.id);
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), AppError::NotFound(_)));
    }

    #[test]
    fn test_create_project_sort_order() {
        let conn = setup_test_db();

        // Create 3 projects — each new one should be at top (sort_order=0)
        let p1 = create(&conn, "First", "/tmp", 0, AgentType::default()).unwrap();
        let p2 = create(&conn, "Second", "/var", 1, AgentType::default()).unwrap();
        let p3 = create(&conn, "Third", "/etc", 2, AgentType::default()).unwrap();

        // list() returns ORDER BY sort_order ASC → newest first
        let projects = list(&conn).unwrap();
        assert_eq!(projects.len(), 3);
        assert_eq!(projects[0].id, p3.id); // Third created = sort_order 0
        assert_eq!(projects[1].id, p2.id); // Second = sort_order 1
        assert_eq!(projects[2].id, p1.id); // First = sort_order 2
    }

    #[test]
    fn test_reorder_projects() {
        let conn = setup_test_db();

        let p1 = create(&conn, "A", "/tmp", 0, AgentType::default()).unwrap();
        let p2 = create(&conn, "B", "/var", 1, AgentType::default()).unwrap();
        let p3 = create(&conn, "C", "/etc", 2, AgentType::default()).unwrap();

        // Reorder to: p1, p3, p2
        reorder(&conn, &[p1.id.clone(), p3.id.clone(), p2.id.clone()]).unwrap();

        let projects = list(&conn).unwrap();
        assert_eq!(projects[0].id, p1.id);
        assert_eq!(projects[1].id, p3.id);
        assert_eq!(projects[2].id, p2.id);
    }

    #[test]
    fn test_reorder_invalid_id() {
        let conn = setup_test_db();
        create(&conn, "A", "/tmp", 0, AgentType::default()).unwrap();

        let result = reorder(&conn, &["nonexistent-id".to_string()]);
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), AppError::NotFound(_)));
    }
}
