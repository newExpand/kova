use crate::errors::AppError;
use crate::models::ssh::SshConnection;
use crate::models::tmux::{TmuxPane, TmuxWindow};
use crate::services::ssh;
use tracing::{error, info, warn};

/// Execute a remote command via SSH (non-interactive, BatchMode=yes).
fn execute_remote_command(
    connection: &SshConnection,
    remote_command: &str,
) -> Result<std::process::Output, AppError> {
    let mut cmd = ssh::build_ssh_probe_cmd(connection)?;
    cmd.arg(remote_command);

    cmd.output().map_err(|e| {
        error!("Failed to execute SSH remote command: {}", e);
        AppError::Internal(format!("SSH remote command failed: {}", e))
    })
}

/// Validate remote session name: alphanumeric, hyphens, underscores, dots only.
fn validate_remote_session(name: &str) -> Result<(), AppError> {
    if name.is_empty() {
        return Err(AppError::InvalidInput(
            "Remote session name cannot be empty".into(),
        ));
    }
    if !name
        .chars()
        .all(|c| c.is_alphanumeric() || c == '-' || c == '_' || c == '.')
    {
        return Err(AppError::InvalidInput(format!(
            "Invalid remote session name '{}': only alphanumeric, '-', '_', and '.' allowed",
            name
        )));
    }
    Ok(())
}

/// Run a simple tmux sub-command (`tmux <tmux_args> -t '<session>'`) on the remote host.
/// Validates the session name, executes the command, checks for failure, and logs success.
fn run_simple_tmux_command(
    connection: &SshConnection,
    remote_session: &str,
    tmux_args: &str,
    description: &str,
) -> Result<(), AppError> {
    validate_remote_session(remote_session)?;
    let remote_cmd = format!("tmux {} -t '{}'", tmux_args, remote_session);
    let output = execute_remote_command(connection, &remote_cmd)?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::TmuxCommand(format!(
            "Remote {} failed: {}",
            tmux_args,
            stderr.trim()
        )));
    }
    info!("Remote: {} in session '{}'", description, remote_session);
    Ok(())
}

/// Check stderr for fatal conditions and return appropriate errors.
/// - "no server running" → always an error (session lost)
/// - "can't find pane/window" → idempotent, log warning and return Ok
/// - Other errors → propagate as TmuxCommand error
fn handle_close_stderr(stderr: &str, entity: &str, remote_session: &str) -> Result<(), AppError> {
    if stderr.contains("no server running") {
        error!(
            "Remote tmux server not running when closing {} in '{}'; session may be lost",
            entity, remote_session
        );
        return Err(AppError::TmuxCommand(
            "Remote tmux server is not running. The remote session may have been lost.".into(),
        ));
    }
    if stderr.contains(&format!("can't find {}", entity)) {
        warn!(
            "Remote {} not found in '{}'; may already be closed",
            entity, remote_session
        );
        return Ok(());
    }
    Err(AppError::TmuxCommand(format!(
        "Remote kill-{} failed: {}",
        entity,
        stderr.trim()
    )))
}

/// Split the active pane vertically (left/right) in the remote tmux session.
/// Uses tmux `split-window -h` (horizontal split line = vertical layout).
pub fn split_pane_vertical(
    connection: &SshConnection,
    remote_session: &str,
) -> Result<(), AppError> {
    run_simple_tmux_command(connection, remote_session, "split-window -h", "split pane vertically")
}

/// Split the active pane horizontally (top/bottom) in the remote tmux session.
/// Uses tmux `split-window -v` (vertical split line = horizontal layout).
pub fn split_pane_horizontal(
    connection: &SshConnection,
    remote_session: &str,
) -> Result<(), AppError> {
    run_simple_tmux_command(
        connection,
        remote_session,
        "split-window -v",
        "split pane horizontally",
    )
}

/// Create a new window in the remote tmux session.
pub fn create_window(
    connection: &SshConnection,
    remote_session: &str,
) -> Result<(), AppError> {
    run_simple_tmux_command(connection, remote_session, "new-window", "created new window")
}

/// Switch to the next window in the remote tmux session.
pub fn next_window(
    connection: &SshConnection,
    remote_session: &str,
) -> Result<(), AppError> {
    run_simple_tmux_command(connection, remote_session, "next-window", "switched to next window")
}

/// Switch to the previous window in the remote tmux session.
pub fn previous_window(
    connection: &SshConnection,
    remote_session: &str,
) -> Result<(), AppError> {
    run_simple_tmux_command(
        connection,
        remote_session,
        "previous-window",
        "switched to previous window",
    )
}

/// Close the active pane in the current window of the remote tmux session.
/// Returns an error if only one pane remains (refuses to close the last pane in the window).
pub fn close_pane(
    connection: &SshConnection,
    remote_session: &str,
) -> Result<(), AppError> {
    validate_remote_session(remote_session)?;
    let panes = list_panes(connection, remote_session)?;
    if panes.len() <= 1 {
        return Err(AppError::InvalidInput(format!(
            "Cannot close the last pane in session '{}'. Close the window instead.",
            remote_session
        )));
    }
    let remote_cmd = format!("tmux kill-pane -t '{}'", remote_session);
    let output = execute_remote_command(connection, &remote_cmd)?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return handle_close_stderr(&stderr, "pane", remote_session);
    }
    info!(
        "Remote: closed active pane in session '{}'",
        remote_session
    );
    Ok(())
}

/// Close the active window in the remote tmux session.
/// Returns an error if only one window remains (refuses to close the last window).
pub fn close_window(
    connection: &SshConnection,
    remote_session: &str,
) -> Result<(), AppError> {
    validate_remote_session(remote_session)?;
    let windows = list_windows(connection, remote_session)?;
    if windows.len() <= 1 {
        return Err(AppError::InvalidInput(format!(
            "Cannot close the last window in session '{}'.",
            remote_session
        )));
    }
    let remote_cmd = format!("tmux kill-window -t '{}'", remote_session);
    let output = execute_remote_command(connection, &remote_cmd)?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return handle_close_stderr(&stderr, "window", remote_session);
    }
    info!(
        "Remote: closed active window in session '{}'",
        remote_session
    );
    Ok(())
}

/// List windows in the remote tmux session.
pub fn list_windows(
    connection: &SshConnection,
    remote_session: &str,
) -> Result<Vec<TmuxWindow>, AppError> {
    validate_remote_session(remote_session)?;
    let remote_cmd = format!(
        "tmux list-windows -t '{}' -F '#{{session_name}}|#{{window_index}}|#{{window_name}}|#{{window_active}}|#{{window_panes}}'",
        remote_session
    );
    let output = execute_remote_command(connection, &remote_cmd)?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::TmuxCommand(format!(
            "Remote list-windows failed: {}",
            stderr.trim()
        )));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut windows = Vec::new();
    let mut skipped = 0u32;
    for line in stdout.lines() {
        let parts: Vec<&str> = line.splitn(5, '|').collect();
        if parts.len() < 5 {
            warn!("Skipping malformed tmux list-windows line: {:?}", line);
            skipped += 1;
            continue;
        }
        let window_index = match parts[1].parse() {
            Ok(v) => v,
            Err(_) => {
                warn!("Unparseable window_index {:?}, defaulting to 0", parts[1]);
                0
            }
        };
        let window_panes = match parts[4].trim().parse() {
            Ok(v) => v,
            Err(_) => {
                warn!("Unparseable window_panes {:?}, defaulting to 1", parts[4]);
                1
            }
        };
        windows.push(TmuxWindow {
            session_name: parts[0].to_string(),
            window_index,
            window_name: parts[2].to_string(),
            window_active: parts[3].trim() == "1",
            window_panes,
        });
    }
    if windows.is_empty() && skipped > 0 {
        return Err(AppError::TmuxCommand(format!(
            "Remote list-windows returned {} unparseable line(s); check remote tmux format",
            skipped
        )));
    }
    Ok(windows)
}

/// List panes in the current window of the remote tmux session.
pub fn list_panes(
    connection: &SshConnection,
    remote_session: &str,
) -> Result<Vec<TmuxPane>, AppError> {
    validate_remote_session(remote_session)?;
    let remote_cmd = format!(
        "tmux list-panes -t '{}' -F '#{{session_name}}|#{{window_index}}|#{{pane_index}}|#{{pane_title}}|#{{pane_current_command}}|#{{pane_active}}'",
        remote_session
    );
    let output = execute_remote_command(connection, &remote_cmd)?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::TmuxCommand(format!(
            "Remote list-panes failed: {}",
            stderr.trim()
        )));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut panes = Vec::new();
    let mut skipped = 0u32;
    for line in stdout.lines() {
        let parts: Vec<&str> = line.splitn(6, '|').collect();
        if parts.len() < 6 {
            warn!("Skipping malformed tmux list-panes line: {:?}", line);
            skipped += 1;
            continue;
        }
        let window_index = match parts[1].parse() {
            Ok(v) => v,
            Err(_) => {
                warn!("Unparseable window_index {:?}, defaulting to 0", parts[1]);
                0
            }
        };
        let pane_index = match parts[2].parse() {
            Ok(v) => v,
            Err(_) => {
                warn!("Unparseable pane_index {:?}, defaulting to 0", parts[2]);
                0
            }
        };
        panes.push(TmuxPane {
            session_name: parts[0].to_string(),
            window_index,
            pane_index,
            pane_title: parts[3].to_string(),
            pane_current_command: parts[4].to_string(),
            pane_active: parts[5].trim() == "1",
        });
    }
    if panes.is_empty() && skipped > 0 {
        return Err(AppError::TmuxCommand(format!(
            "Remote list-panes returned {} unparseable line(s); check remote tmux format",
            skipped
        )));
    }
    Ok(panes)
}

/// Send keys (text) to the remote tmux session, followed by an automatic Enter keypress.
/// Maximum key length is 4096 characters.
pub fn send_keys(
    connection: &SshConnection,
    remote_session: &str,
    keys: &str,
) -> Result<(), AppError> {
    validate_remote_session(remote_session)?;
    if keys.is_empty() {
        return Err(AppError::InvalidInput("Keys cannot be empty".into()));
    }
    if keys.len() > 4096 {
        return Err(AppError::InvalidInput(
            "Keys too long (max 4096 chars)".into(),
        ));
    }
    // Shell-escape single quotes for safe remote execution
    let escaped_keys = keys.replace('\'', "'\\''");
    let remote_cmd = format!(
        "tmux send-keys -t '{}' '{}' Enter",
        remote_session, escaped_keys
    );
    let output = execute_remote_command(connection, &remote_cmd)?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::TmuxCommand(format!(
            "Remote send-keys failed: {}",
            stderr.trim()
        )));
    }
    Ok(())
}
