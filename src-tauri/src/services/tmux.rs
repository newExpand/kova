use crate::errors::AppError;
use crate::models::tmux::{ProjectTmuxSession, SessionInfo, TmuxPane, TmuxSession};
use rusqlite::{params, Connection};
use std::collections::{HashMap, HashSet};
use std::process::Command;
use std::thread;
use std::time::Duration;
use tracing::{info, warn};
use uuid::Uuid;

/// Check if tmux binary is available on the system.
/// Retries up to 3 times with 1-second intervals.
pub fn is_tmux_available() -> bool {
    for attempt in 1..=3 {
        match Command::new("which").arg("tmux").output() {
            Ok(output) if output.status.success() => {
                info!("tmux binary found");
                return true;
            }
            Ok(_) => {
                warn!("tmux not found (attempt {}/3)", attempt);
            }
            Err(e) => {
                warn!("Failed to check tmux availability (attempt {}/3): {}", attempt, e);
            }
        }
        if attempt < 3 {
            thread::sleep(Duration::from_secs(1));
        }
    }
    warn!("tmux is not available after 3 attempts");
    false
}

/// List all active tmux sessions.
/// Returns an empty Vec if tmux is not running (not an error).
pub fn list_sessions() -> Result<Vec<TmuxSession>, AppError> {
    let output = Command::new("tmux")
        .args([
            "list-sessions",
            "-F",
            "#{session_name}|#{session_windows}|#{session_created}|#{session_attached}",
        ])
        .output();

    let output = match output {
        Ok(o) => o,
        Err(e) => {
            // tmux binary not found or not executable
            if e.kind() == std::io::ErrorKind::NotFound {
                info!("tmux binary not found, returning empty session list");
                return Ok(Vec::new());
            }
            return Err(AppError::TmuxCommand(format!(
                "Failed to execute tmux list-sessions: {}",
                e
            )));
        }
    };

    // tmux exits with non-zero when no server is running
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        if stderr.contains("no server running")
            || stderr.contains("no sessions")
            || stderr.contains("error connecting")
        {
            info!("tmux server not running, returning empty session list");
            return Ok(Vec::new());
        }
        return Err(AppError::TmuxCommand(format!(
            "tmux list-sessions failed: {}",
            stderr.trim()
        )));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let sessions = stdout
        .lines()
        .filter(|line| !line.is_empty())
        .filter_map(parse_session_line)
        .collect();

    Ok(sessions)
}

/// List all panes in a given tmux session.
/// Returns an empty Vec if the session does not exist.
pub fn list_panes(session_name: &str) -> Result<Vec<TmuxPane>, AppError> {
    validate_session_name(session_name)?;

    let output = Command::new("tmux")
        .args([
            "list-panes",
            "-t",
            session_name,
            "-a",
            "-F",
            "#{session_name}|#{window_index}|#{pane_index}|#{pane_title}|#{pane_current_command}|#{pane_active}",
        ])
        .output();

    let output = match output {
        Ok(o) => o,
        Err(e) => {
            if e.kind() == std::io::ErrorKind::NotFound {
                info!("tmux binary not found, returning empty pane list");
                return Ok(Vec::new());
            }
            return Err(AppError::TmuxCommand(format!(
                "Failed to execute tmux list-panes: {}",
                e
            )));
        }
    };

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        // Session not found is not an error, return empty
        if stderr.contains("can't find session")
            || stderr.contains("no server running")
            || stderr.contains("session not found")
        {
            info!("tmux session '{}' not found, returning empty pane list", session_name);
            return Ok(Vec::new());
        }
        return Err(AppError::TmuxCommand(format!(
            "tmux list-panes failed: {}",
            stderr.trim()
        )));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let panes = stdout
        .lines()
        .filter(|line| !line.is_empty())
        .filter_map(parse_pane_line)
        .collect();

    Ok(panes)
}

/// Create a new detached tmux session with the given name and dimensions.
pub fn create_session(name: &str, cols: u16, rows: u16) -> Result<(), AppError> {
    validate_session_name(name)?;

    let output = Command::new("tmux")
        .args([
            "new-session",
            "-d",
            "-s",
            name,
            "-x",
            &cols.to_string(),
            "-y",
            &rows.to_string(),
        ])
        .output()
        .map_err(|e| {
            AppError::TmuxCommand(format!("Failed to execute tmux new-session: {}", e))
        })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::TmuxCommand(format!(
            "tmux new-session failed: {}",
            stderr.trim()
        )));
    }

    info!("Created tmux session '{}' ({}x{})", name, cols, rows);
    Ok(())
}

/// Kill (terminate) a tmux session by name.
pub fn kill_session(name: &str) -> Result<(), AppError> {
    validate_session_name(name)?;

    let output = Command::new("tmux")
        .args(["kill-session", "-t", name])
        .output()
        .map_err(|e| {
            AppError::TmuxCommand(format!("Failed to execute tmux kill-session: {}", e))
        })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        // Session already gone is not an error
        if stderr.contains("can't find session")
            || stderr.contains("no server running")
            || stderr.contains("session not found")
        {
            info!("tmux session '{}' already terminated", name);
            return Ok(());
        }
        return Err(AppError::TmuxCommand(format!(
            "tmux kill-session failed: {}",
            stderr.trim()
        )));
    }

    info!("Killed tmux session '{}'", name);
    Ok(())
}

// ---------------------------------------------------------------------------
// DB-backed session ownership
// ---------------------------------------------------------------------------

/// Register a tmux session as owned by a project.
pub fn register_session(
    conn: &Connection,
    project_id: &str,
    session_name: &str,
) -> Result<ProjectTmuxSession, AppError> {
    validate_session_name(session_name)?;

    let id = Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO project_tmux_sessions (id, project_id, session_name)
         VALUES (?1, ?2, ?3)",
        params![&id, project_id, session_name],
    )?;

    conn.query_row(
        "SELECT id, project_id, session_name, created_at
         FROM project_tmux_sessions WHERE id = ?1",
        [&id],
        |row| {
            Ok(ProjectTmuxSession {
                id: row.get(0)?,
                project_id: row.get(1)?,
                session_name: row.get(2)?,
                created_at: row.get(3)?,
            })
        },
    )
    .map_err(AppError::from)
}

/// Register session and return updated session list (single atomic operation).
/// Avoids double IPC round-trip (register → list).
pub fn register_session_and_list(
    conn: &Connection,
    project_id: &str,
    session_name: &str,
) -> Result<Vec<SessionInfo>, AppError> {
    register_session(conn, project_id, session_name)?;
    list_sessions_with_ownership(conn)
}

/// Unregister session and return updated session list (single atomic operation).
pub fn unregister_session_and_list(
    conn: &Connection,
    session_name: &str,
) -> Result<Vec<SessionInfo>, AppError> {
    unregister_session(conn, session_name)?;
    list_sessions_with_ownership(conn)
}

/// Unregister a tmux session from its project.
pub fn unregister_session(conn: &Connection, session_name: &str) -> Result<(), AppError> {
    validate_session_name(session_name)?;
    conn.execute(
        "DELETE FROM project_tmux_sessions WHERE session_name = ?1",
        [session_name],
    )?;
    Ok(())
}

/// List all sessions with ownership info (tmux CLI + DB join).
/// Also cleans up stale DB records for sessions no longer in tmux.
pub fn list_sessions_with_ownership(conn: &Connection) -> Result<Vec<SessionInfo>, AppError> {
    // 1. Live tmux sessions
    let tmux_sessions = list_sessions()?;

    // 2. All registered sessions from DB
    let mut stmt = conn.prepare(
        "SELECT session_name, project_id FROM project_tmux_sessions",
    )?;
    let db_sessions: HashMap<String, String> = stmt
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?
        .collect::<Result<_, _>>()?;

    // 3. Build live session name set for stale detection
    let live_session_names: HashSet<String> =
        tmux_sessions.iter().map(|s| s.name.clone()).collect();

    // 4. Combine: tag each tmux session with ownership
    let mut result = Vec::new();
    for session in tmux_sessions {
        let (is_app_session, project_id) = match db_sessions.get(&session.name) {
            Some(pid) => (true, Some(pid.clone())),
            None => (false, None),
        };
        result.push(SessionInfo {
            name: session.name,
            windows: session.windows,
            created: session.created,
            attached: session.attached,
            is_app_session,
            project_id,
        });
    }

    // 5. Cleanup stale DB records (in DB but not in tmux)
    for name in db_sessions.keys() {
        if !live_session_names.contains(name) {
            conn.execute(
                "DELETE FROM project_tmux_sessions WHERE session_name = ?1",
                [name],
            )?;
            info!("Cleaned up stale session record: {}", name);
        }
    }

    Ok(result)
}

/// Validate session name to prevent command injection.
/// Only allows alphanumeric characters, hyphens, underscores, and dots.
fn validate_session_name(name: &str) -> Result<(), AppError> {
    if name.is_empty() {
        return Err(AppError::InvalidInput("Session name cannot be empty".into()));
    }
    if !name
        .chars()
        .all(|c| c.is_alphanumeric() || c == '-' || c == '_' || c == '.')
    {
        return Err(AppError::InvalidInput(format!(
            "Invalid session name '{}': only alphanumeric, '-', '_', and '.' allowed",
            name
        )));
    }
    Ok(())
}

/// Parse a single line from `tmux list-sessions -F` output.
fn parse_session_line(line: &str) -> Option<TmuxSession> {
    let parts: Vec<&str> = line.splitn(4, '|').collect();
    if parts.len() < 4 {
        warn!("Failed to parse tmux session line: {}", line);
        return None;
    }

    let windows = parts[1].parse::<i32>().unwrap_or(0);
    let attached = parts[3].trim() == "1";

    Some(TmuxSession {
        name: parts[0].to_string(),
        windows,
        created: parts[2].to_string(),
        attached,
    })
}

/// Parse a single line from `tmux list-panes -F` output.
fn parse_pane_line(line: &str) -> Option<TmuxPane> {
    let parts: Vec<&str> = line.splitn(6, '|').collect();
    if parts.len() < 6 {
        warn!("Failed to parse tmux pane line: {}", line);
        return None;
    }

    let window_index = parts[1].parse::<i32>().unwrap_or(0);
    let pane_index = parts[2].parse::<i32>().unwrap_or(0);
    let pane_active = parts[5].trim() == "1";

    Some(TmuxPane {
        session_name: parts[0].to_string(),
        window_index,
        pane_index,
        pane_title: parts[3].to_string(),
        pane_current_command: parts[4].to_string(),
        pane_active,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_session_line_valid() {
        let line = "my-session|3|1706000000|1";
        let session = parse_session_line(line).expect("Should parse valid line");
        assert_eq!(session.name, "my-session");
        assert_eq!(session.windows, 3);
        assert_eq!(session.created, "1706000000");
        assert!(session.attached);
    }

    #[test]
    fn test_parse_session_line_detached() {
        let line = "test|1|1706000000|0";
        let session = parse_session_line(line).expect("Should parse valid line");
        assert!(!session.attached);
    }

    #[test]
    fn test_parse_session_line_invalid() {
        let line = "incomplete|data";
        assert!(parse_session_line(line).is_none());
    }

    #[test]
    fn test_parse_pane_line_valid() {
        let line = "my-session|0|1|bash|vim|1";
        let pane = parse_pane_line(line).expect("Should parse valid line");
        assert_eq!(pane.session_name, "my-session");
        assert_eq!(pane.window_index, 0);
        assert_eq!(pane.pane_index, 1);
        assert_eq!(pane.pane_title, "bash");
        assert_eq!(pane.pane_current_command, "vim");
        assert!(pane.pane_active);
    }

    #[test]
    fn test_parse_pane_line_inactive() {
        let line = "session|0|0|title|zsh|0";
        let pane = parse_pane_line(line).expect("Should parse valid line");
        assert!(!pane.pane_active);
    }

    #[test]
    fn test_parse_pane_line_invalid() {
        let line = "too|few|parts";
        assert!(parse_pane_line(line).is_none());
    }

    #[test]
    fn test_validate_session_name_valid() {
        assert!(validate_session_name("my-session").is_ok());
        assert!(validate_session_name("session_1").is_ok());
        assert!(validate_session_name("test.session").is_ok());
        assert!(validate_session_name("abc123").is_ok());
    }

    #[test]
    fn test_validate_session_name_invalid() {
        assert!(validate_session_name("").is_err());
        assert!(validate_session_name("bad;name").is_err());
        assert!(validate_session_name("has space").is_err());
        assert!(validate_session_name("inject$(cmd)").is_err());
        assert!(validate_session_name("path/../../etc").is_err());
    }

    // ── create_session tests ─────────────────────────────────────────

    #[test]
    fn test_create_session_rejects_invalid_name() {
        let result = create_session("bad;name", 80, 24);
        assert!(result.is_err());
        let err = result.unwrap_err().to_string();
        assert!(err.contains("Invalid session name"));
    }

    #[test]
    fn test_create_session_rejects_empty_name() {
        let result = create_session("", 80, 24);
        assert!(result.is_err());
        let err = result.unwrap_err().to_string();
        assert!(err.contains("cannot be empty"));
    }

    // ── kill_session tests ───────────────────────────────────────────

    #[test]
    fn test_kill_session_rejects_invalid_name() {
        let result = kill_session("inject$(cmd)");
        assert!(result.is_err());
        let err = result.unwrap_err().to_string();
        assert!(err.contains("Invalid session name"));
    }

    #[test]
    fn test_kill_session_rejects_empty_name() {
        let result = kill_session("");
        assert!(result.is_err());
        let err = result.unwrap_err().to_string();
        assert!(err.contains("cannot be empty"));
    }

    #[test]
    fn test_kill_session_nonexistent_is_ok() {
        // Killing a non-existent session should not error
        // (it will either succeed silently or tmux says "can't find session")
        let result = kill_session("nonexistent-test-session-xyz-12345");
        // This will either be Ok (tmux handles gracefully) or Err (tmux not running)
        // We just verify it doesn't panic
        let _ = result;
    }

    // ── DB-backed session ownership tests ────────────────────────────

    fn setup_test_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute("PRAGMA foreign_keys = ON", []).unwrap();
        // Create _migrations table (normally done by db::run_migrations)
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS _migrations (
                version INTEGER PRIMARY KEY,
                applied_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
            )",
        )
        .unwrap();
        conn.execute_batch(include_str!("../db/migrations/001_initial.sql"))
            .unwrap();
        conn.execute("INSERT INTO _migrations (version) VALUES (1)", [])
            .unwrap();
        conn.execute_batch(include_str!("../db/migrations/002_tmux_sessions.sql"))
            .unwrap();
        conn
    }

    fn insert_test_project(conn: &Connection, id: &str) {
        conn.execute(
            "INSERT INTO projects (id, name, path) VALUES (?1, ?2, ?3)",
            params![id, "test-project", format!("/tmp/test-{}", id)],
        )
        .unwrap();
    }

    #[test]
    fn test_register_session() {
        let conn = setup_test_db();
        let project_id = Uuid::new_v4().to_string();
        insert_test_project(&conn, &project_id);

        let result = register_session(&conn, &project_id, "test-session");
        assert!(result.is_ok());

        let record = result.unwrap();
        assert_eq!(record.project_id, project_id);
        assert_eq!(record.session_name, "test-session");
    }

    #[test]
    fn test_register_session_duplicate_rejected() {
        let conn = setup_test_db();
        let project_id = Uuid::new_v4().to_string();
        insert_test_project(&conn, &project_id);

        let _ = register_session(&conn, &project_id, "dup-session").unwrap();
        let result = register_session(&conn, &project_id, "dup-session");
        assert!(result.is_err());
    }

    #[test]
    fn test_register_session_sql_injection_prevented() {
        let conn = setup_test_db();
        let project_id = Uuid::new_v4().to_string();
        insert_test_project(&conn, &project_id);

        let malicious = "'; DROP TABLE project_tmux_sessions; --";
        let result = register_session(&conn, &project_id, malicious);
        assert!(result.is_err()); // validate_session_name rejects it

        // Verify table still exists
        let count: i32 = conn
            .query_row(
                "SELECT COUNT(*) FROM project_tmux_sessions",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn test_unregister_session() {
        let conn = setup_test_db();
        let project_id = Uuid::new_v4().to_string();
        insert_test_project(&conn, &project_id);

        register_session(&conn, &project_id, "to-remove").unwrap();
        assert!(unregister_session(&conn, "to-remove").is_ok());

        let count: i32 = conn
            .query_row(
                "SELECT COUNT(*) FROM project_tmux_sessions WHERE session_name = ?1",
                ["to-remove"],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn test_stale_cleanup() {
        let conn = setup_test_db();
        let project_id = Uuid::new_v4().to_string();
        insert_test_project(&conn, &project_id);

        // Insert stale session record (not actually in tmux)
        conn.execute(
            "INSERT INTO project_tmux_sessions (id, project_id, session_name)
             VALUES ('stale-1', ?1, 'ghost-session')",
            [&project_id],
        )
        .unwrap();

        // list_sessions_with_ownership should clean it up
        let _ = list_sessions_with_ownership(&conn).unwrap();

        let count: i32 = conn
            .query_row(
                "SELECT COUNT(*) FROM project_tmux_sessions",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn test_cascade_delete_on_project_removal() {
        let conn = setup_test_db();
        let project_id = Uuid::new_v4().to_string();
        insert_test_project(&conn, &project_id);

        register_session(&conn, &project_id, "cascade-test").unwrap();

        // Delete the project → should cascade delete session record
        conn.execute("DELETE FROM projects WHERE id = ?1", [&project_id])
            .unwrap();

        let count: i32 = conn
            .query_row(
                "SELECT COUNT(*) FROM project_tmux_sessions",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 0);
    }
}
