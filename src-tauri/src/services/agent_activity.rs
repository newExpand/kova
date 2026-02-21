use crate::errors::AppError;
use crate::models::agent_activity::AgentActivityRecord;
use rusqlite::{params, Connection};
use tracing::info;

pub fn store_activity(
    conn: &Connection,
    project_id: &str,
    event_type: &str,
    session_id: Option<&str>,
    worktree_path: Option<&str>,
    summary: Option<&str>,
    payload: Option<&str>,
) -> Result<String, AppError> {
    let id = uuid::Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO agent_activity (id, project_id, event_type, session_id, worktree_path, summary, payload)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![id, project_id, event_type, session_id, worktree_path, summary, payload],
    )?;
    Ok(id)
}

pub fn list_activities(
    conn: &Connection,
    project_id: &str,
    limit: i64,
) -> Result<Vec<AgentActivityRecord>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT id, project_id, event_type, session_id, worktree_path, summary, payload, created_at
         FROM agent_activity
         WHERE project_id = ?1
         ORDER BY created_at DESC
         LIMIT ?2",
    )?;

    let records = stmt
        .query_map(params![project_id, limit], |row| {
            Ok(AgentActivityRecord {
                id: row.get(0)?,
                project_id: row.get(1)?,
                event_type: row.get(2)?,
                session_id: row.get(3)?,
                worktree_path: row.get(4)?,
                summary: row.get(5)?,
                payload: row.get(6)?,
                created_at: row.get(7)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(records)
}

pub fn prune_old_activities(
    conn: &Connection,
    retention_days: i64,
) -> Result<u64, AppError> {
    let deleted = conn.execute(
        "DELETE FROM agent_activity WHERE created_at < datetime('now', ?1)",
        params![format!("-{} days", retention_days)],
    )?;
    if deleted > 0 {
        info!("Pruned {} old agent activity records", deleted);
    }
    Ok(deleted as u64)
}
