use crate::errors::AppError;
use crate::models::tmux::{TmuxPane, TmuxSession};
use std::process::Command;
use std::thread;
use std::time::Duration;
use tracing::{info, warn};

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
}
