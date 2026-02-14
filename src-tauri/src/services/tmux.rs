use crate::errors::AppError;
use crate::models::tmux::{ProjectTmuxSession, SessionInfo, TmuxPane, TmuxSession, TmuxWindow};
use rusqlite::{params, Connection};
use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::process::Command;
use std::sync::OnceLock;
use std::thread;
use std::time::Duration;
use tracing::{info, warn};
use uuid::Uuid;

/// Well-known paths where tmux may be installed on macOS.
/// Checked in order: Apple Silicon Homebrew, Intel Homebrew, MacPorts, Nix, system.
const TMUX_SEARCH_PATHS: &[&str] = &[
    "/opt/homebrew/bin/tmux",
    "/usr/local/bin/tmux",
    "/opt/local/bin/tmux",
    "/nix/var/nix/profiles/default/bin/tmux",
    "/usr/bin/tmux",
];

/// Cached absolute path to the tmux binary.
static TMUX_PATH: OnceLock<Option<String>> = OnceLock::new();

/// Resolve the absolute path to the tmux binary.
/// First checks well-known paths, then falls back to `which tmux`.
/// The result is cached for the lifetime of the process.
fn resolve_tmux_path() -> Option<&'static str> {
    TMUX_PATH
        .get_or_init(|| {
            // 1. Check well-known paths (works even when PATH is minimal in .app bundles)
            for candidate in TMUX_SEARCH_PATHS {
                if Path::new(candidate).is_file() {
                    info!("tmux binary found at: {}", candidate);
                    return Some(candidate.to_string());
                }
            }

            // 2. Fallback: try `which tmux` in case PATH includes a custom location
            if let Ok(output) = Command::new("which").arg("tmux").output() {
                if output.status.success() {
                    let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
                    if !path.is_empty() && Path::new(&path).is_file() {
                        info!("tmux binary found via which: {}", path);
                        return Some(path);
                    }
                }
            }

            warn!("tmux binary not found in any known location");
            None
        })
        .as_deref()
}

/// Create a `Command` pre-configured with the resolved tmux absolute path.
/// Falls back to bare "tmux" (relying on PATH) if no known location is found.
fn tmux_cmd() -> Command {
    Command::new(resolve_tmux_path().unwrap_or("tmux"))
}

/// Check if tmux binary is available on the system.
/// Retries up to 3 times with 1-second intervals.
pub fn is_tmux_available() -> bool {
    for attempt in 1..=3 {
        if resolve_tmux_path().is_some() {
            info!("tmux binary found");
            return true;
        }
        warn!("tmux not found (attempt {}/3)", attempt);
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
    let output = tmux_cmd()
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

    let output = tmux_cmd()
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

    let output = tmux_cmd()
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

    let output = tmux_cmd()
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

/// Split the active pane horizontally (top/bottom) in the given session.
/// Uses tmux `split-window -v` (vertical split line = horizontal layout).
pub fn split_pane_horizontal(session_name: &str) -> Result<(), AppError> {
    validate_session_name(session_name)?;
    let output = tmux_cmd()
        .args(["split-window", "-v", "-t", session_name])
        .output()
        .map_err(|e| {
            AppError::TmuxCommand(format!("Failed to execute tmux split-window: {}", e))
        })?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::TmuxCommand(format!(
            "tmux split-window -v failed: {}",
            stderr.trim()
        )));
    }
    info!("Split pane horizontally in session '{}'", session_name);
    Ok(())
}

/// Split the active pane vertically (left/right) in the given session.
/// Uses tmux `split-window -h` (horizontal split line = vertical layout).
pub fn split_pane_vertical(session_name: &str) -> Result<(), AppError> {
    validate_session_name(session_name)?;
    let output = tmux_cmd()
        .args(["split-window", "-h", "-t", session_name])
        .output()
        .map_err(|e| {
            AppError::TmuxCommand(format!("Failed to execute tmux split-window: {}", e))
        })?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::TmuxCommand(format!(
            "tmux split-window -h failed: {}",
            stderr.trim()
        )));
    }
    info!("Split pane vertically in session '{}'", session_name);
    Ok(())
}

/// Close the active pane in the given session.
/// Safety: refuses to close the last remaining pane (returns Ok silently).
pub fn close_pane(session_name: &str) -> Result<(), AppError> {
    validate_session_name(session_name)?;
    let panes = list_panes(session_name)?;
    if panes.len() <= 1 {
        info!(
            "Only {} pane(s) in '{}', skipping close",
            panes.len(),
            session_name
        );
        return Ok(());
    }
    let output = tmux_cmd()
        .args(["kill-pane", "-t", session_name])
        .output()
        .map_err(|e| {
            AppError::TmuxCommand(format!("Failed to execute tmux kill-pane: {}", e))
        })?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        if stderr.contains("can't find pane") || stderr.contains("no server running") {
            return Ok(());
        }
        return Err(AppError::TmuxCommand(format!(
            "tmux kill-pane failed: {}",
            stderr.trim()
        )));
    }
    info!("Closed active pane in session '{}'", session_name);
    Ok(())
}

// ---------------------------------------------------------------------------
// Send keys
// ---------------------------------------------------------------------------

/// Send keys (text) to the active pane of a tmux session.
/// Appends an "Enter" key press automatically.
pub fn send_keys(session_name: &str, keys: &str) -> Result<(), AppError> {
    validate_session_name(session_name)?;
    if keys.is_empty() {
        return Err(AppError::InvalidInput("Keys cannot be empty".into()));
    }
    let output = tmux_cmd()
        .args(["send-keys", "-t", session_name, keys, "Enter"])
        .output()
        .map_err(|e| AppError::TmuxCommand(format!("Failed to execute tmux send-keys: {}", e)))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::TmuxCommand(format!(
            "tmux send-keys failed: {}",
            stderr.trim()
        )));
    }
    info!("Sent keys to session '{}'", session_name);
    Ok(())
}

// ---------------------------------------------------------------------------
// Window management
// ---------------------------------------------------------------------------

/// List all windows in a given tmux session.
pub fn list_windows(session_name: &str) -> Result<Vec<TmuxWindow>, AppError> {
    validate_session_name(session_name)?;

    let output = tmux_cmd()
        .args([
            "list-windows",
            "-t",
            session_name,
            "-F",
            "#{session_name}|#{window_index}|#{window_name}|#{window_active}|#{window_panes}",
        ])
        .output();

    let output = match output {
        Ok(o) => o,
        Err(e) => {
            if e.kind() == std::io::ErrorKind::NotFound {
                info!("tmux binary not found, returning empty window list");
                return Ok(Vec::new());
            }
            return Err(AppError::TmuxCommand(format!(
                "Failed to execute tmux list-windows: {}",
                e
            )));
        }
    };

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        if stderr.contains("can't find session")
            || stderr.contains("no server running")
            || stderr.contains("session not found")
        {
            info!(
                "tmux session '{}' not found, returning empty window list",
                session_name
            );
            return Ok(Vec::new());
        }
        return Err(AppError::TmuxCommand(format!(
            "tmux list-windows failed: {}",
            stderr.trim()
        )));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let windows = stdout
        .lines()
        .filter(|line| !line.is_empty())
        .filter_map(parse_window_line)
        .collect();

    Ok(windows)
}

/// Create a new window in the given tmux session.
pub fn create_window(session_name: &str) -> Result<(), AppError> {
    validate_session_name(session_name)?;

    let output = tmux_cmd()
        .args(["new-window", "-t", session_name])
        .output()
        .map_err(|e| {
            AppError::TmuxCommand(format!("Failed to execute tmux new-window: {}", e))
        })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::TmuxCommand(format!(
            "tmux new-window failed: {}",
            stderr.trim()
        )));
    }

    info!("Created new window in session '{}'", session_name);
    Ok(())
}

/// Close the active window in the given session.
/// Safety: refuses to close the last remaining window (returns Ok silently).
pub fn close_window(session_name: &str) -> Result<(), AppError> {
    validate_session_name(session_name)?;

    let windows = list_windows(session_name)?;
    if windows.len() <= 1 {
        info!(
            "Only {} window(s) in '{}', skipping close",
            windows.len(),
            session_name
        );
        return Ok(());
    }

    let output = tmux_cmd()
        .args(["kill-window", "-t", session_name])
        .output()
        .map_err(|e| {
            AppError::TmuxCommand(format!("Failed to execute tmux kill-window: {}", e))
        })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        if stderr.contains("can't find window") || stderr.contains("no server running") {
            return Ok(());
        }
        return Err(AppError::TmuxCommand(format!(
            "tmux kill-window failed: {}",
            stderr.trim()
        )));
    }

    info!("Closed active window in session '{}'", session_name);
    Ok(())
}

/// Switch to the next window in the given session (wraps around).
pub fn next_window(session_name: &str) -> Result<(), AppError> {
    validate_session_name(session_name)?;

    let output = tmux_cmd()
        .args(["next-window", "-t", session_name])
        .output()
        .map_err(|e| {
            AppError::TmuxCommand(format!("Failed to execute tmux next-window: {}", e))
        })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::TmuxCommand(format!(
            "tmux next-window failed: {}",
            stderr.trim()
        )));
    }

    Ok(())
}

/// Switch to the previous window in the given session (wraps around).
pub fn previous_window(session_name: &str) -> Result<(), AppError> {
    validate_session_name(session_name)?;

    let output = tmux_cmd()
        .args(["previous-window", "-t", session_name])
        .output()
        .map_err(|e| {
            AppError::TmuxCommand(format!("Failed to execute tmux previous-window: {}", e))
        })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::TmuxCommand(format!(
            "tmux previous-window failed: {}",
            stderr.trim()
        )));
    }

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

/// Parse a single line from `tmux list-windows -F` output.
fn parse_window_line(line: &str) -> Option<TmuxWindow> {
    let parts: Vec<&str> = line.splitn(5, '|').collect();
    if parts.len() < 5 {
        warn!("Failed to parse tmux window line: {}", line);
        return None;
    }

    let window_index = parts[1].parse::<i32>().unwrap_or(0);
    let window_active = parts[3].trim() == "1";
    let window_panes = parts[4].trim().parse::<i32>().unwrap_or(0);

    Some(TmuxWindow {
        session_name: parts[0].to_string(),
        window_index,
        window_name: parts[2].to_string(),
        window_active,
        window_panes,
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

    // ── split_pane_horizontal tests ───────────────────────────────────

    #[test]
    fn test_split_pane_horizontal_rejects_invalid_name() {
        let result = split_pane_horizontal("bad;name");
        assert!(result.is_err());
        let err = result.unwrap_err().to_string();
        assert!(err.contains("Invalid session name"));
    }

    #[test]
    fn test_split_pane_horizontal_rejects_empty_name() {
        let result = split_pane_horizontal("");
        assert!(result.is_err());
        let err = result.unwrap_err().to_string();
        assert!(err.contains("cannot be empty"));
    }

    // ── split_pane_vertical tests ────────────────────────────────────

    #[test]
    fn test_split_pane_vertical_rejects_invalid_name() {
        let result = split_pane_vertical("inject$(cmd)");
        assert!(result.is_err());
        let err = result.unwrap_err().to_string();
        assert!(err.contains("Invalid session name"));
    }

    #[test]
    fn test_split_pane_vertical_rejects_empty_name() {
        let result = split_pane_vertical("");
        assert!(result.is_err());
        let err = result.unwrap_err().to_string();
        assert!(err.contains("cannot be empty"));
    }

    // ── close_pane tests ─────────────────────────────────────────────

    #[test]
    fn test_close_pane_rejects_invalid_name() {
        let result = close_pane("path/../../etc");
        assert!(result.is_err());
        let err = result.unwrap_err().to_string();
        assert!(err.contains("Invalid session name"));
    }

    #[test]
    fn test_close_pane_rejects_empty_name() {
        let result = close_pane("");
        assert!(result.is_err());
        let err = result.unwrap_err().to_string();
        assert!(err.contains("cannot be empty"));
    }

    // ── parse_window_line tests ───────────────────────────────────────

    #[test]
    fn test_parse_window_line_valid() {
        let line = "my-session|0|bash|1|2";
        let window = parse_window_line(line).expect("Should parse valid line");
        assert_eq!(window.session_name, "my-session");
        assert_eq!(window.window_index, 0);
        assert_eq!(window.window_name, "bash");
        assert!(window.window_active);
        assert_eq!(window.window_panes, 2);
    }

    #[test]
    fn test_parse_window_line_inactive() {
        let line = "session|1|vim|0|1";
        let window = parse_window_line(line).expect("Should parse valid line");
        assert!(!window.window_active);
        assert_eq!(window.window_index, 1);
    }

    #[test]
    fn test_parse_window_line_invalid() {
        let line = "too|few|parts";
        assert!(parse_window_line(line).is_none());
    }

    // ── create_window tests ─────────────────────────────────────────

    #[test]
    fn test_create_window_rejects_invalid_name() {
        let result = create_window("bad;name");
        assert!(result.is_err());
        let err = result.unwrap_err().to_string();
        assert!(err.contains("Invalid session name"));
    }

    #[test]
    fn test_create_window_rejects_empty_name() {
        let result = create_window("");
        assert!(result.is_err());
        let err = result.unwrap_err().to_string();
        assert!(err.contains("cannot be empty"));
    }

    // ── close_window tests ──────────────────────────────────────────

    #[test]
    fn test_close_window_rejects_invalid_name() {
        let result = close_window("inject$(cmd)");
        assert!(result.is_err());
        let err = result.unwrap_err().to_string();
        assert!(err.contains("Invalid session name"));
    }

    #[test]
    fn test_close_window_rejects_empty_name() {
        let result = close_window("");
        assert!(result.is_err());
        let err = result.unwrap_err().to_string();
        assert!(err.contains("cannot be empty"));
    }

    // ── next_window tests ───────────────────────────────────────────

    #[test]
    fn test_next_window_rejects_invalid_name() {
        let result = next_window("bad;name");
        assert!(result.is_err());
        let err = result.unwrap_err().to_string();
        assert!(err.contains("Invalid session name"));
    }

    #[test]
    fn test_next_window_rejects_empty_name() {
        let result = next_window("");
        assert!(result.is_err());
        let err = result.unwrap_err().to_string();
        assert!(err.contains("cannot be empty"));
    }

    // ── previous_window tests ───────────────────────────────────────

    #[test]
    fn test_previous_window_rejects_invalid_name() {
        let result = previous_window("path/../../etc");
        assert!(result.is_err());
        let err = result.unwrap_err().to_string();
        assert!(err.contains("Invalid session name"));
    }

    #[test]
    fn test_previous_window_rejects_empty_name() {
        let result = previous_window("");
        assert!(result.is_err());
        let err = result.unwrap_err().to_string();
        assert!(err.contains("cannot be empty"));
    }

    // ── list_windows tests ──────────────────────────────────────────

    #[test]
    fn test_list_windows_rejects_invalid_name() {
        let result = list_windows("inject$(cmd)");
        assert!(result.is_err());
        let err = result.unwrap_err().to_string();
        assert!(err.contains("Invalid session name"));
    }

    // ── send_keys tests ──────────────────────────────────────────────

    #[test]
    fn test_send_keys_rejects_invalid_name() {
        let result = send_keys("bad;name", "echo hello");
        assert!(result.is_err());
        let err = result.unwrap_err().to_string();
        assert!(err.contains("Invalid session name"));
    }

    #[test]
    fn test_send_keys_rejects_empty_name() {
        let result = send_keys("", "echo hello");
        assert!(result.is_err());
        let err = result.unwrap_err().to_string();
        assert!(err.contains("cannot be empty"));
    }

    #[test]
    fn test_send_keys_rejects_empty_keys() {
        let result = send_keys("valid-session", "");
        assert!(result.is_err());
        let err = result.unwrap_err().to_string();
        assert!(err.contains("Keys cannot be empty"));
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
