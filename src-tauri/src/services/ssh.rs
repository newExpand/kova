use crate::errors::AppError;
use crate::models::ssh::{
    CreateSshConnectionInput, SshAuthType, SshConnectResult, SshConnection, SshTestResult,
    UpdateSshConnectionInput,
};
use rusqlite::Connection;
use std::path::Path;
use tracing::{error, info, warn};
use uuid::Uuid;

/// Characters forbidden in SSH host/username fields (shell metacharacters)
const SHELL_METACHAR: &[char] = &[
    ';', '|', '&', '$', '`', '(', ')', '{', '}', '<', '>', '\n', '\r', '\'', '"', '\\', ' ',
];

/// Validate a field against shell metacharacters
fn validate_ssh_field(value: &str, field_name: &str) -> Result<(), AppError> {
    if value.is_empty() {
        return Err(AppError::InvalidInput(format!(
            "{} cannot be empty",
            field_name
        )));
    }
    if value.len() > 253 {
        return Err(AppError::InvalidInput(format!(
            "{} too long (max 253 chars)",
            field_name
        )));
    }
    if let Some(ch) = value.chars().find(|c| SHELL_METACHAR.contains(c)) {
        return Err(AppError::InvalidInput(format!(
            "{} contains forbidden character: '{}'",
            field_name, ch
        )));
    }
    Ok(())
}

/// Validate port range
fn validate_port(port: i32) -> Result<(), AppError> {
    if !(1..=65535).contains(&port) {
        return Err(AppError::InvalidInput(format!(
            "Port must be between 1 and 65535, got {}",
            port
        )));
    }
    Ok(())
}

/// Validate key_path exists if auth_type is Key
fn validate_key_path(auth_type: &SshAuthType, key_path: &Option<String>) -> Result<(), AppError> {
    if *auth_type == SshAuthType::Key {
        match key_path {
            Some(path) if !path.is_empty() => {
                let expanded = expand_tilde(path)?;
                if !Path::new(&expanded).is_file() {
                    return Err(AppError::InvalidInput(format!(
                        "SSH key file not found: {}",
                        path
                    )));
                }
            }
            _ => {
                return Err(AppError::InvalidInput(
                    "key_path is required when auth_type is 'key'".into(),
                ));
            }
        }
    }
    Ok(())
}

/// Expand ~ to home directory
fn expand_tilde(path: &str) -> Result<String, AppError> {
    if path.starts_with('~') {
        let home = std::env::var("HOME")
            .map_err(|_| AppError::Internal("HOME environment variable is not set".into()))?;
        return Ok(path.replacen('~', &home, 1));
    }
    Ok(path.to_string())
}

/// Shell-quote a path for safe use in tmux send-keys
fn shell_quote(path: &str) -> String {
    if path.contains(' ') || path.contains('\'') || path.contains('"') {
        format!("'{}'", path.replace('\'', "'\\''"))
    } else {
        path.to_string()
    }
}

/// Sanitize a name for use as a tmux window name
fn sanitize_for_tmux(name: &str) -> String {
    name.chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '-' || c == '_' || c == '.' {
                c
            } else {
                '-'
            }
        })
        .collect()
}

/// Map a database row to SshConnection
fn row_to_connection(row: &rusqlite::Row) -> rusqlite::Result<SshConnection> {
    let auth_type_str: String = row.get(5)?;
    let auth_type = SshAuthType::from_str_value(&auth_type_str).unwrap_or(SshAuthType::Key);
    Ok(SshConnection {
        id: row.get(0)?,
        name: row.get(1)?,
        host: row.get(2)?,
        port: row.get(3)?,
        username: row.get(4)?,
        auth_type,
        key_path: row.get(6)?,
        project_id: row.get(7)?,
        is_default: row.get::<_, i32>(8)? == 1,
        created_at: row.get(9)?,
        updated_at: row.get(10)?,
    })
}

/// Validate all fields of a create input
fn validate_create_input(input: &CreateSshConnectionInput) -> Result<(), AppError> {
    if input.name.trim().is_empty() {
        return Err(AppError::InvalidInput("name cannot be empty".into()));
    }
    validate_ssh_field(&input.host, "host")?;
    validate_port(input.port)?;
    validate_ssh_field(&input.username, "username")?;
    validate_key_path(&input.auth_type, &input.key_path)?;
    Ok(())
}

/// Create a new SSH connection profile
pub fn create(
    conn: &Connection,
    input: &CreateSshConnectionInput,
) -> Result<SshConnection, AppError> {
    validate_create_input(input)?;

    let id = Uuid::new_v4().to_string();

    conn.execute(
        "INSERT INTO ssh_connections (id, name, host, port, username, auth_type, key_path, project_id, is_default)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        rusqlite::params![
            id,
            input.name.trim(),
            input.host,
            input.port,
            input.username,
            input.auth_type.to_string(),
            input.key_path,
            input.project_id,
            input.is_default as i32,
        ],
    )?;

    info!("Created SSH connection: {} ({})", input.name, id);
    get(conn, &id)
}

/// List all SSH connections
pub fn list(conn: &Connection) -> Result<Vec<SshConnection>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT id, name, host, port, username, auth_type, key_path, project_id, is_default, created_at, updated_at
         FROM ssh_connections ORDER BY created_at DESC",
    )?;

    let connections = stmt
        .query_map([], row_to_connection)?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(connections)
}

/// List SSH connections by project ID
pub fn list_by_project(
    conn: &Connection,
    project_id: &str,
) -> Result<Vec<SshConnection>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT id, name, host, port, username, auth_type, key_path, project_id, is_default, created_at, updated_at
         FROM ssh_connections WHERE project_id = ?1 ORDER BY is_default DESC, created_at DESC",
    )?;

    let connections = stmt
        .query_map([project_id], row_to_connection)?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(connections)
}

/// Get a single SSH connection by ID
pub fn get(conn: &Connection, id: &str) -> Result<SshConnection, AppError> {
    match conn.query_row(
        "SELECT id, name, host, port, username, auth_type, key_path, project_id, is_default, created_at, updated_at
         FROM ssh_connections WHERE id = ?1",
        [id],
        row_to_connection,
    ) {
        Ok(connection) => Ok(connection),
        Err(rusqlite::Error::QueryReturnedNoRows) => {
            Err(AppError::NotFound(format!("SSH connection not found: {}", id)))
        }
        Err(e) => Err(AppError::Database(e)),
    }
}

/// Update an SSH connection
pub fn update(
    conn: &Connection,
    id: &str,
    input: &UpdateSshConnectionInput,
) -> Result<SshConnection, AppError> {
    let existing = get(conn, id)?;

    // Validate changed fields
    if let Some(ref host) = input.host {
        validate_ssh_field(host, "host")?;
    }
    if let Some(port) = input.port {
        validate_port(port)?;
    }
    if let Some(ref username) = input.username {
        validate_ssh_field(username, "username")?;
    }

    // Validate key_path with resolved auth_type
    let effective_auth_type = input.auth_type.as_ref().unwrap_or(&existing.auth_type);
    let effective_key_path = if input.key_path.is_some() {
        &input.key_path
    } else {
        &existing.key_path
    };
    validate_key_path(effective_auth_type, effective_key_path)?;

    // Build dynamic UPDATE
    let mut updates = Vec::new();
    let mut params: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

    if let Some(ref name) = input.name {
        updates.push("name = ?");
        params.push(Box::new(name.trim().to_string()));
    }
    if let Some(ref host) = input.host {
        updates.push("host = ?");
        params.push(Box::new(host.clone()));
    }
    if let Some(port) = input.port {
        updates.push("port = ?");
        params.push(Box::new(port));
    }
    if let Some(ref username) = input.username {
        updates.push("username = ?");
        params.push(Box::new(username.clone()));
    }
    if let Some(ref auth_type) = input.auth_type {
        updates.push("auth_type = ?");
        params.push(Box::new(auth_type.to_string()));
        // Auto-clear key_path when switching to agent
        if *auth_type == SshAuthType::Agent && input.key_path.is_none() {
            updates.push("key_path = ?");
            let null_val: Option<String> = None;
            params.push(Box::new(null_val));
        }
    }
    if input.key_path.is_some() {
        updates.push("key_path = ?");
        params.push(Box::new(input.key_path.clone()));
    }
    if input.project_id.is_some() {
        updates.push("project_id = ?");
        params.push(Box::new(input.project_id.clone()));
    }
    if let Some(is_default) = input.is_default {
        updates.push("is_default = ?");
        params.push(Box::new(is_default as i32));
    }

    if updates.is_empty() {
        return get(conn, id);
    }

    updates.push("updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')");
    params.push(Box::new(id.to_string()));

    let query = format!(
        "UPDATE ssh_connections SET {} WHERE id = ?",
        updates.join(", ")
    );
    conn.execute(&query, rusqlite::params_from_iter(params.iter()))?;

    info!("Updated SSH connection: {}", id);
    get(conn, id)
}

/// Delete an SSH connection
pub fn delete(conn: &Connection, id: &str) -> Result<(), AppError> {
    let count = conn.execute("DELETE FROM ssh_connections WHERE id = ?1", [id])?;

    if count == 0 {
        return Err(AppError::NotFound(format!(
            "SSH connection not found: {}",
            id
        )));
    }

    info!("Deleted SSH connection: {}", id);
    Ok(())
}

/// Build SSH arguments as a Vec for direct PTY spawn (exec-style, no shell).
/// Does NOT apply shell_quote — spawn() passes args directly to execvp.
pub fn build_ssh_args(connection: &SshConnection) -> Result<Vec<String>, AppError> {
    validate_ssh_field(&connection.host, "host")?;
    validate_ssh_field(&connection.username, "username")?;

    let mut args: Vec<String> = vec![
        "-o".into(),
        "StrictHostKeyChecking=accept-new".into(),
        "-o".into(),
        "ConnectTimeout=10".into(),
    ];

    if connection.port != 22 {
        args.push("-p".into());
        args.push(connection.port.to_string());
    }

    match connection.auth_type {
        SshAuthType::Key => {
            match &connection.key_path {
                Some(key_path) if !key_path.is_empty() => {
                    let expanded = expand_tilde(key_path)?;
                    args.push("-i".into());
                    args.push(expanded); // No shell_quote for exec-style spawn
                }
                _ => {
                    warn!(
                        "SSH connection '{}' has auth_type=key but no key_path; SSH will try default keys",
                        connection.name
                    );
                }
            }
        }
        SshAuthType::Agent => {}
    }

    args.push(format!("{}@{}", connection.username, connection.host));
    Ok(args)
}

/// Build an SSH command string for tmux send-keys (shell-interpreted).
/// Delegates to build_ssh_args() and applies shell_quote where needed.
pub fn build_ssh_command(connection: &SshConnection) -> Result<String, AppError> {
    let args = build_ssh_args(connection)?;
    let mut parts = vec!["ssh".to_string()];
    // shell_quote is a no-op for args that don't need quoting
    parts.extend(args.into_iter().map(|a| shell_quote(&a)));
    Ok(parts.join(" "))
}

/// Connect to an SSH server via tmux window (does not hold DB lock)
pub fn connect_with_profile(
    connection: &SshConnection,
    session_name: &str,
) -> Result<SshConnectResult, AppError> {
    let ssh_cmd = build_ssh_command(connection)?;
    let window_name = format!("ssh-{}", sanitize_for_tmux(&connection.name));

    // Create a named window in the project's tmux session
    crate::services::tmux::create_window_named(session_name, &window_name, "~")?;

    // Send the ssh command; clean up orphaned window on failure
    if let Err(e) =
        crate::services::tmux::send_keys_to_window(session_name, &window_name, &ssh_cmd)
    {
        warn!(
            "send_keys failed, cleaning up orphaned window '{}': {}",
            window_name, e
        );
        let _ = crate::services::tmux::close_window_by_name(session_name, &window_name);
        return Err(e);
    }

    info!(
        "SSH connection '{}' opened in window '{}' of session '{}'",
        connection.name, window_name, session_name
    );

    Ok(SshConnectResult {
        connection_id: connection.id.clone(),
        connection_name: connection.name.clone(),
        window_name: Some(window_name),
        session_name: Some(session_name.to_string()),
        remote_tmux_available: None,
        ssh_args: None,
        remote_session_name: None,
    })
}

/// Build a non-interactive SSH probe command (BatchMode=yes, ConnectTimeout=5).
/// Used by both `check_remote_tmux` and `test_connection_with_profile`.
fn build_ssh_probe_cmd(connection: &SshConnection) -> Result<std::process::Command, AppError> {
    validate_ssh_field(&connection.host, "host")?;
    validate_ssh_field(&connection.username, "username")?;

    let mut cmd = std::process::Command::new("ssh");
    cmd.args([
        "-o",
        "BatchMode=yes",
        "-o",
        "ConnectTimeout=5",
        "-o",
        "StrictHostKeyChecking=accept-new",
    ]);

    if connection.port != 22 {
        cmd.args(["-p", &connection.port.to_string()]);
    }

    match connection.auth_type {
        SshAuthType::Key => {
            match &connection.key_path {
                Some(key_path) if !key_path.is_empty() => {
                    let expanded = expand_tilde(key_path)?;
                    cmd.args(["-i", &expanded]);
                }
                _ => {
                    warn!(
                        "SSH probe for '{}' has auth_type=key but no key_path; SSH will try default keys",
                        connection.name
                    );
                }
            }
        }
        SshAuthType::Agent => {}
    }

    cmd.arg(format!("{}@{}", connection.username, connection.host));
    Ok(cmd)
}

/// Check if tmux is available on the remote SSH server (non-interactive, best-effort).
///
/// Returns:
/// - `Some(true)`: tmux found on remote
/// - `Some(false)`: connected but tmux not found
/// - `None`: could not determine (auth failure with BatchMode, timeout, etc.)
pub fn check_remote_tmux(connection: &SshConnection) -> Result<Option<bool>, AppError> {
    let mut cmd = build_ssh_probe_cmd(connection)?;
    cmd.arg("command -v tmux");

    match cmd.output() {
        Ok(output) if output.status.success() => {
            info!("Remote tmux detected for '{}'", connection.name);
            Ok(Some(true))
        }
        Ok(output) => {
            let stderr = String::from_utf8_lossy(&output.stderr);
            if stderr.contains("Permission denied") || stderr.contains("Host key verification") {
                warn!(
                    "Cannot determine remote tmux for '{}' (auth issue with BatchMode)",
                    connection.name
                );
                Ok(None)
            } else {
                info!("Remote tmux NOT found for '{}'", connection.name);
                Ok(Some(false))
            }
        }
        Err(e) => {
            error!("Remote tmux check failed for '{}': {}", connection.name, e);
            Ok(None)
        }
    }
}

/// SSH direct connection (no local tmux wrapper).
///
/// Returns SSH args for frontend PTY spawn, plus remote tmux availability info.
/// The frontend will spawn `ssh <args>` directly via tauri-pty.
pub fn connect_as_session(
    connection: &SshConnection,
) -> Result<SshConnectResult, AppError> {
    let ssh_args = build_ssh_args(connection)?;
    let remote_session_name = sanitize_for_tmux(&connection.name);

    // Check remote tmux availability.
    // Validation errors (InvalidInput, Internal) propagate — they indicate
    // malformed connection data that build_ssh_args would also reject.
    // This provides fail-fast behavior for security-relevant issues.
    let remote_tmux = match check_remote_tmux(connection) {
        Ok(result) => result,
        Err(e) => {
            // check_remote_tmux only returns Err for validation/internal failures
            // (from build_ssh_probe_cmd → validate_ssh_field / expand_tilde).
            // IO/process errors are handled internally as Ok(None).
            error!(
                "Remote tmux check failed for '{}': {}",
                connection.name, e
            );
            return Err(e);
        }
    };

    info!(
        "SSH connect prepared for '{}': remote_tmux={:?}",
        connection.name, remote_tmux
    );

    Ok(SshConnectResult {
        connection_id: connection.id.clone(),
        connection_name: connection.name.clone(),
        window_name: None,
        session_name: None,
        remote_tmux_available: remote_tmux,
        ssh_args: Some(ssh_args),
        remote_session_name: Some(remote_session_name),
    })
}

/// Test SSH connectivity (non-interactive, does not hold DB lock)
pub fn test_connection_with_profile(
    connection: &SshConnection,
) -> Result<SshTestResult, AppError> {
    let mut cmd = build_ssh_probe_cmd(connection)?;
    cmd.arg("exit");

    let output = cmd
        .output()
        .map_err(|e| AppError::Internal(format!("Failed to run ssh test: {}", e)))?;

    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();

    if output.status.success() {
        info!("SSH test succeeded for '{}'", connection.name);
        Ok(SshTestResult {
            success: true,
            message: "Connection successful".into(),
        })
    } else {
        let message = if stderr.is_empty() {
            format!(
                "Connection failed (exit code: {})",
                output.status.code().unwrap_or(-1)
            )
        } else {
            stderr
        };
        warn!("SSH test failed for '{}': {}", connection.name, message);
        Ok(SshTestResult {
            success: false,
            message,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection as SqliteConn;

    fn setup_test_db() -> SqliteConn {
        let conn = SqliteConn::open_in_memory().unwrap();
        conn.execute("PRAGMA foreign_keys = ON", []).unwrap();
        conn.execute(
            "CREATE TABLE IF NOT EXISTS _migrations (
                version INTEGER PRIMARY KEY,
                applied_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
            )",
            [],
        )
        .unwrap();
        conn.execute_batch(include_str!("../db/migrations/001_initial.sql"))
            .unwrap();
        conn.execute_batch(include_str!("../db/migrations/005_ssh_connections.sql"))
            .unwrap();
        conn
    }

    #[test]
    fn test_validate_ssh_field_blocks_metachar() {
        assert!(validate_ssh_field("good-host.com", "host").is_ok());
        assert!(validate_ssh_field("192.168.1.1", "host").is_ok());
        assert!(validate_ssh_field("host;rm -rf /", "host").is_err());
        assert!(validate_ssh_field("host|bad", "host").is_err());
        assert!(validate_ssh_field("host&bad", "host").is_err());
        assert!(validate_ssh_field("", "host").is_err());
    }

    #[test]
    fn test_validate_port() {
        assert!(validate_port(22).is_ok());
        assert!(validate_port(1).is_ok());
        assert!(validate_port(65535).is_ok());
        assert!(validate_port(0).is_err());
        assert!(validate_port(65536).is_err());
        assert!(validate_port(-1).is_err());
    }

    #[test]
    fn test_sanitize_for_tmux() {
        assert_eq!(sanitize_for_tmux("my-server"), "my-server");
        assert_eq!(sanitize_for_tmux("my server!"), "my-server-");
        assert_eq!(sanitize_for_tmux("test@host"), "test-host");
    }

    #[test]
    fn test_shell_quote() {
        assert_eq!(shell_quote("/simple/path"), "/simple/path");
        assert_eq!(shell_quote("/path with spaces"), "'/path with spaces'");
        assert_eq!(shell_quote("/it's/path"), "'/it'\\''s/path'");
    }

    #[test]
    fn test_build_ssh_command_default_port() {
        let conn = SshConnection {
            id: "test".into(),
            name: "test".into(),
            host: "example.com".into(),
            port: 22,
            username: "user".into(),
            auth_type: SshAuthType::Agent,
            key_path: None,
            project_id: None,
            is_default: false,
            created_at: String::new(),
            updated_at: String::new(),
        };
        let cmd = build_ssh_command(&conn).unwrap();
        assert_eq!(
            cmd,
            "ssh -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10 user@example.com"
        );
    }

    #[test]
    fn test_build_ssh_command_custom_port() {
        let conn = SshConnection {
            id: "test".into(),
            name: "test".into(),
            host: "example.com".into(),
            port: 2222,
            username: "admin".into(),
            auth_type: SshAuthType::Agent,
            key_path: None,
            project_id: None,
            is_default: false,
            created_at: String::new(),
            updated_at: String::new(),
        };
        let cmd = build_ssh_command(&conn).unwrap();
        assert!(cmd.contains("-p 2222"));
        assert!(cmd.contains("admin@example.com"));
    }

    #[test]
    fn test_build_ssh_command_rejects_metachar() {
        let conn = SshConnection {
            id: "test".into(),
            name: "test".into(),
            host: "host;rm".into(),
            port: 22,
            username: "user".into(),
            auth_type: SshAuthType::Agent,
            key_path: None,
            project_id: None,
            is_default: false,
            created_at: String::new(),
            updated_at: String::new(),
        };
        assert!(build_ssh_command(&conn).is_err());
    }

    #[test]
    fn test_create_and_get_connection() {
        let conn = setup_test_db();
        let input = CreateSshConnectionInput {
            name: "Test Server".into(),
            host: "example.com".into(),
            port: 22,
            username: "testuser".into(),
            auth_type: SshAuthType::Agent,
            key_path: None,
            project_id: None,
            is_default: false,
        };

        let created = create(&conn, &input).unwrap();
        assert_eq!(created.name, "Test Server");
        assert_eq!(created.host, "example.com");
        assert_eq!(created.auth_type, SshAuthType::Agent);

        let fetched = get(&conn, &created.id).unwrap();
        assert_eq!(fetched.id, created.id);
    }

    #[test]
    fn test_list_connections() {
        let conn = setup_test_db();
        let input1 = CreateSshConnectionInput {
            name: "Server A".into(),
            host: "a.example.com".into(),
            port: 22,
            username: "user".into(),
            auth_type: SshAuthType::Agent,
            key_path: None,
            project_id: None,
            is_default: false,
        };
        let input2 = CreateSshConnectionInput {
            name: "Server B".into(),
            host: "b.example.com".into(),
            port: 2222,
            username: "admin".into(),
            auth_type: SshAuthType::Agent,
            key_path: None,
            project_id: None,
            is_default: false,
        };
        create(&conn, &input1).unwrap();
        create(&conn, &input2).unwrap();
        assert_eq!(list(&conn).unwrap().len(), 2);
    }

    #[test]
    fn test_update_connection() {
        let conn = setup_test_db();
        let input = CreateSshConnectionInput {
            name: "Original".into(),
            host: "old.example.com".into(),
            port: 22,
            username: "user".into(),
            auth_type: SshAuthType::Agent,
            key_path: None,
            project_id: None,
            is_default: false,
        };
        let created = create(&conn, &input).unwrap();
        let update_input = UpdateSshConnectionInput {
            name: Some("Updated".into()),
            host: Some("new.example.com".into()),
            port: Some(3333),
            username: None,
            auth_type: None,
            key_path: None,
            project_id: None,
            is_default: None,
        };
        let updated = update(&conn, &created.id, &update_input).unwrap();
        assert_eq!(updated.name, "Updated");
        assert_eq!(updated.host, "new.example.com");
        assert_eq!(updated.port, 3333);
        assert_eq!(updated.username, "user");
    }

    #[test]
    fn test_delete_connection() {
        let conn = setup_test_db();
        let input = CreateSshConnectionInput {
            name: "ToDelete".into(),
            host: "delete.example.com".into(),
            port: 22,
            username: "user".into(),
            auth_type: SshAuthType::Agent,
            key_path: None,
            project_id: None,
            is_default: false,
        };
        let created = create(&conn, &input).unwrap();
        delete(&conn, &created.id).unwrap();
        assert!(get(&conn, &created.id).is_err());
    }

    #[test]
    fn test_delete_nonexistent_returns_not_found() {
        let conn = setup_test_db();
        assert!(matches!(
            delete(&conn, "nonexistent-id").unwrap_err(),
            AppError::NotFound(_)
        ));
    }

    #[test]
    fn test_list_by_project() {
        let conn = setup_test_db();
        conn.execute(
            "INSERT INTO projects (id, name, path) VALUES (?1, ?2, ?3)",
            ["proj1", "Test Project", "/tmp/test"],
        )
        .unwrap();
        let input1 = CreateSshConnectionInput {
            name: "Project SSH".into(),
            host: "proj.example.com".into(),
            port: 22,
            username: "user".into(),
            auth_type: SshAuthType::Agent,
            key_path: None,
            project_id: Some("proj1".into()),
            is_default: false,
        };
        create(&conn, &input1).unwrap();
        create(
            &conn,
            &CreateSshConnectionInput {
                name: "Global SSH".into(),
                host: "global.example.com".into(),
                port: 22,
                username: "user".into(),
                auth_type: SshAuthType::Agent,
                key_path: None,
                project_id: None,
                is_default: false,
            },
        )
        .unwrap();
        let project_conns = list_by_project(&conn, "proj1").unwrap();
        assert_eq!(project_conns.len(), 1);
        assert_eq!(project_conns[0].name, "Project SSH");
    }

    #[test]
    fn test_project_delete_sets_null() {
        let conn = setup_test_db();
        conn.execute(
            "INSERT INTO projects (id, name, path) VALUES (?1, ?2, ?3)",
            ["proj1", "Test Project", "/tmp/test"],
        )
        .unwrap();
        let created = create(
            &conn,
            &CreateSshConnectionInput {
                name: "Linked SSH".into(),
                host: "linked.example.com".into(),
                port: 22,
                username: "user".into(),
                auth_type: SshAuthType::Agent,
                key_path: None,
                project_id: Some("proj1".into()),
                is_default: false,
            },
        )
        .unwrap();
        conn.execute("DELETE FROM projects WHERE id = ?1", ["proj1"])
            .unwrap();
        let fetched = get(&conn, &created.id).unwrap();
        assert!(fetched.project_id.is_none());
    }

    #[test]
    fn test_create_rejects_invalid_input() {
        let conn = setup_test_db();
        // Empty host
        assert!(create(
            &conn,
            &CreateSshConnectionInput {
                name: "Bad".into(),
                host: "".into(),
                port: 22,
                username: "user".into(),
                auth_type: SshAuthType::Agent,
                key_path: None,
                project_id: None,
                is_default: false,
            }
        )
        .is_err());
        // Invalid port
        assert!(create(
            &conn,
            &CreateSshConnectionInput {
                name: "Bad".into(),
                host: "example.com".into(),
                port: 0,
                username: "user".into(),
                auth_type: SshAuthType::Agent,
                key_path: None,
                project_id: None,
                is_default: false,
            }
        )
        .is_err());
    }

    #[test]
    fn test_expand_tilde() {
        let home = std::env::var("HOME").unwrap_or_default();
        if !home.is_empty() {
            assert_eq!(
                expand_tilde("~/.ssh/id_rsa").unwrap(),
                format!("{}/.ssh/id_rsa", home)
            );
        }
        assert_eq!(expand_tilde("/absolute/path").unwrap(), "/absolute/path");
    }
}
