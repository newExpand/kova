use crate::errors::AppError;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::Read;
use std::sync::mpsc;
use std::thread;
use std::time::Instant;
use tauri::{AppHandle, Emitter, Manager};
use tiny_http::{ListenAddr, Method, Response, Server, StatusCode};
use tracing::{error, info, warn};

use crate::db::DbConnection;
use std::sync::Mutex as StdMutex;
use url::Url;

pub struct EventServer {
    shutdown_tx: mpsc::Sender<()>,
    port: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HookEvent {
    pub project_path: String,
    pub event_type: String,
    pub payload: serde_json::Value,
    pub timestamp: String,
}

impl EventServer {
    /// Start the event reception HTTP server on a random available port.
    /// Binds to 127.0.0.1 only (never 0.0.0.0) for security.
    pub fn start(app_handle: AppHandle) -> Result<Self, AppError> {
        let server = Server::http("127.0.0.1:0").map_err(|e| {
            AppError::EventServer(format!("Failed to bind HTTP server: {}", e))
        })?;

        let port = match server.server_addr() {
            ListenAddr::IP(addr) => addr.port(),
            ListenAddr::Unix(_) => {
                return Err(AppError::EventServer(
                    "Unix sockets are not supported".into(),
                ))
            }
        };

        info!("Event server started on 127.0.0.1:{}", port);

        // Write port file atomically
        write_port_file(port)?;

        let (shutdown_tx, shutdown_rx) = mpsc::channel();

        // Spawn request handler thread
        thread::spawn(move || {
            handle_requests(server, shutdown_rx, app_handle);
        });

        Ok(Self { shutdown_tx, port })
    }

    /// Get the port the server is listening on.
    pub fn port(&self) -> u16 {
        self.port
    }

    /// Stop the event server gracefully.
    pub fn stop(&self) -> Result<(), AppError> {
        info!("Stopping event server on port {}", self.port);
        self.shutdown_tx
            .send(())
            .map_err(|e| AppError::EventServer(format!("Failed to send shutdown signal: {}", e)))?;
        cleanup_port_file()?;
        info!("Event server stopped");
        Ok(())
    }
}

/// Per-thread throttle state for rate-limiting native notifications and periodic DB cleanup.
/// Lives entirely within the event server thread — no synchronization needed.
struct ThrottleState {
    /// Last native notification time per "project_path:event_type" key
    last_native: HashMap<String, Instant>,
    /// Last DB prune time
    last_prune: Instant,
}

impl ThrottleState {
    fn new() -> Self {
        Self {
            last_native: HashMap::new(),
            last_prune: Instant::now(),
        }
    }

    /// Returns true if enough time has elapsed since the last native notification for this key.
    fn should_send_native(&mut self, key: &str, cooldown_secs: u64) -> bool {
        let now = Instant::now();
        if let Some(last) = self.last_native.get(key) {
            if now.duration_since(*last).as_secs() < cooldown_secs {
                return false;
            }
        }
        self.last_native.insert(key.to_string(), now);
        true
    }

    /// Returns true if 30 minutes have elapsed since last prune.
    /// Also evicts stale throttle entries (older than 1 hour) to prevent unbounded HashMap growth.
    fn should_prune(&mut self) -> bool {
        let now = Instant::now();
        if now.duration_since(self.last_prune).as_secs() >= 1800 {
            self.last_prune = now;
            // Evict stale throttle entries (older than 1 hour) to prevent unbounded growth
            self.last_native
                .retain(|_, last_time| now.duration_since(*last_time).as_secs() < 3600);
            return true;
        }
        false
    }
}

/// Main request handling loop.
fn handle_requests(server: Server, shutdown_rx: mpsc::Receiver<()>, app_handle: AppHandle) {
    let mut throttle = ThrottleState::new();

    loop {
        // Check for shutdown signal
        if shutdown_rx.try_recv().is_ok() {
            info!("Event server received shutdown signal");
            break;
        }

        // Periodic DB prune (every 30 minutes)
        if throttle.should_prune() {
            let db_state = app_handle.state::<StdMutex<DbConnection>>();
            if let Ok(db) = db_state.lock() {
                let retention_days: i64 = match crate::services::settings::get_with_default(
                    &db.conn,
                    "notification_retention_days",
                    "7",
                )
                .parse()
                {
                    Ok(v) => v,
                    Err(e) => {
                        warn!("Invalid notification_retention_days setting, using default 7: {}", e);
                        7
                    }
                };

                if let Err(e) =
                    crate::services::notification::prune_old_notifications(&db.conn, retention_days)
                {
                    warn!("Periodic notification prune failed: {}", e);
                }
            };
        }

        // Try to receive a request (with timeout)
        let request = match server.recv_timeout(std::time::Duration::from_secs(1)) {
            Ok(Some(req)) => req,
            Ok(None) => continue, // Timeout, check shutdown again
            Err(e) => {
                error!("Error receiving request: {}", e);
                continue;
            }
        };

        if let Err(e) = process_request(request, &app_handle, &mut throttle) {
            warn!("Error processing request: {}", e);
        }
    }
}

/// Process a single HTTP request.
fn process_request(
    mut request: tiny_http::Request,
    app_handle: &AppHandle,
    throttle: &mut ThrottleState,
) -> Result<(), AppError> {
    let url = request.url().to_string();
    let method = request.method().clone();

    // Route: only POST /hook is accepted
    let path = url.split('?').next().unwrap_or(&url);

    if path != "/hook" {
        let _ = request.respond(
            Response::from_string("Not Found")
                .with_status_code(StatusCode(404)),
        );
        return Ok(());
    }

    if method != Method::Post {
        let _ = request.respond(
            Response::from_string("Method Not Allowed")
                .with_status_code(StatusCode(405)),
        );
        return Ok(());
    }

    // Parse query parameters
    let dummy_base = format!("http://localhost{}", url);
    let parsed_url = Url::parse(&dummy_base).map_err(|e| {
        AppError::EventServer(format!("Failed to parse URL: {}", e))
    })?;

    let params: std::collections::HashMap<String, String> =
        parsed_url.query_pairs().map(|(k, v)| (k.into_owned(), v.into_owned())).collect();

    let project_path = match params.get("project") {
        Some(p) => p.clone(),
        None => {
            let _ = request.respond(
                Response::from_string(r#"{"error":"Missing 'project' query parameter"}"#)
                    .with_status_code(StatusCode(400)),
            );
            return Ok(());
        }
    };

    let event_type = match params.get("type") {
        Some(t) => t.clone(),
        None => {
            let _ = request.respond(
                Response::from_string(r#"{"error":"Missing 'type' query parameter"}"#)
                    .with_status_code(StatusCode(400)),
            );
            return Ok(());
        }
    };

    // Guard against oversized payloads (1MB limit)
    const MAX_BODY_SIZE: usize = 1_048_576;
    if request.body_length().is_some_and(|len| len > MAX_BODY_SIZE) {
        let _ = request.respond(
            Response::from_string(r#"{"error":"Request body too large"}"#)
                .with_status_code(StatusCode(413)),
        );
        return Ok(());
    }

    // Read body with enforced size limit via take() — prevents bypass when Content-Length is absent
    let mut body = String::new();
    match request.as_reader().take((MAX_BODY_SIZE + 1) as u64).read_to_string(&mut body) {
        Err(e) => {
            let _ = request.respond(
                Response::from_string(format!(r#"{{"error":"Failed to read body: {}"}}"#, e))
                    .with_status_code(StatusCode(400)),
            );
            return Ok(());
        }
        Ok(_) if body.len() > MAX_BODY_SIZE => {
            let _ = request.respond(
                Response::from_string(r#"{"error":"Request body too large"}"#)
                    .with_status_code(StatusCode(413)),
            );
            return Ok(());
        }
        Ok(_) => {}
    }

    let payload: serde_json::Value = if body.is_empty() {
        serde_json::Value::Object(serde_json::Map::new())
    } else {
        match serde_json::from_str(&body) {
            Ok(v) => v,
            Err(_) => {
                let _ = request.respond(
                    Response::from_string(r#"{"error":"Invalid JSON body"}"#)
                        .with_status_code(StatusCode(400)),
                );
                return Ok(());
            }
        }
    };

    // Create HookEvent
    let hook_event = HookEvent {
        project_path,
        event_type,
        payload,
        timestamp: chrono::Utc::now().to_rfc3339(),
    };

    // Emit Tauri event to frontend
    app_handle
        .emit("notification:hook-received", &hook_event)
        .map_err(|e| AppError::EventServer(format!("Failed to emit event: {}", e)))?;

    info!("Hook event emitted: type={}", hook_event.event_type);

    // DB persistence + Native notification (best-effort)
    // Single project lookup shared by both notification and agent activity logic.
    let db_state = app_handle.state::<StdMutex<DbConnection>>();
    if let Ok(db) = db_state.lock() {
        let project_result = {
            let direct = crate::services::project::get_by_path(&db.conn, &hook_event.project_path);
            match &direct {
                Ok(Some(_)) => direct,
                Ok(None) => {
                    // Fallback: worktree paths won't match DB entries directly.
                    // Extract the parent project path and retry.
                    if let Some(parent) = extract_parent_project_path(&hook_event.project_path) {
                        crate::services::project::get_by_path(&db.conn, &parent)
                    } else {
                        direct
                    }
                }
                Err(e) => {
                    warn!("DB lookup failed for path '{}': {}", hook_event.project_path, e);
                    direct
                }
            }
        };

        match &project_result {
            Ok(Some(project)) => {
                let title = project.name.clone();
                let body = hook_event
                    .payload
                    .get("message")
                    .and_then(|v| v.as_str())
                    .filter(|s| !s.is_empty())
                    .map(|s| s.to_string())
                    .unwrap_or_else(|| hook_event.event_type.clone());

                // DB 저장 (항상 실행)
                if let Err(e) = crate::services::notification::store_notification(
                    &db.conn,
                    &project.id,
                    &hook_event.event_type,
                    &title,
                    if body.is_empty() { None } else { Some(&body) },
                    Some(&hook_event.payload.to_string()),
                ) {
                    warn!("Failed to store notification: {}", e);
                }

                // macOS 네이티브 알림 (throttled)
                let throttle_key =
                    format!("{}:{}", hook_event.project_path, hook_event.event_type);
                let cooldown_secs: u64 = match crate::services::settings::get_with_default(
                    &db.conn,
                    "notification_cooldown_secs",
                    "5",
                )
                .parse()
                {
                    Ok(v) => v,
                    Err(e) => {
                        warn!("Invalid notification_cooldown_secs setting, using default 5: {}", e);
                        5
                    }
                };

                // Only Stop and PermissionRequest trigger native macOS alerts;
                // other hook types (PostToolUse, SubagentStart, etc.) are stored
                // in DB and forwarded to frontend but don't create OS-level popups.
                const NOTIFY_TYPES: &[&str] = &["Stop", "PermissionRequest"];
                if NOTIFY_TYPES.contains(&hook_event.event_type.as_str())
                    && throttle.should_send_native(&throttle_key, cooldown_secs)
                {
                    let notification_style = crate::services::settings::get_with_default(
                        &db.conn,
                        "notification_style",
                        "alert",
                    );

                    if let Err(e) = crate::services::notification::send_native_notification(
                        app_handle,
                        &title,
                        &body,
                        &notification_style,
                        &project.name,
                        &project.id,
                    ) {
                        warn!("Failed to send native notification: {}", e);
                    }
                }

            }
            Ok(None) => warn!("No active project for path: {}", hook_event.project_path),
            Err(e) => warn!("Project lookup failed: {}", e),
        }

    } else {
        warn!("Failed to acquire DB lock for hook processing (notification + agent activity)");
    }

    let _ = request.respond(
        Response::from_string(r#"{"status":"ok"}"#)
            .with_status_code(StatusCode(200)),
    );

    Ok(())
}

/// Write port number to file atomically (temp file + rename).
/// File permissions set to 0600 (owner read/write only).
fn write_port_file(port: u16) -> Result<(), AppError> {
    let port_dir = get_port_dir()?;
    std::fs::create_dir_all(&port_dir)?;

    let port_file = port_dir.join("event-server.port");
    let temp_file = port_dir.join("event-server.port.tmp");

    // Write to temp file
    std::fs::write(&temp_file, port.to_string())?;

    // Set permissions to 0600 (unix only)
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let perms = std::fs::Permissions::from_mode(0o600);
        std::fs::set_permissions(&temp_file, perms)?;
    }

    // Atomic rename
    std::fs::rename(&temp_file, &port_file)?;

    info!("Port file written: {:?} (port {})", port_file, port);
    Ok(())
}

/// Delete the port file. Ignores "not found" errors.
pub fn cleanup_port_file() -> Result<(), AppError> {
    let port_dir = get_port_dir()?;
    let port_file = port_dir.join("event-server.port");

    match std::fs::remove_file(&port_file) {
        Ok(()) => {
            info!("Port file removed: {:?}", port_file);
            Ok(())
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            info!("Port file already removed");
            Ok(())
        }
        Err(e) => Err(AppError::Io(e)),
    }
}

/// Read the event server port from the port file.
/// Useful for hook injection outside of the startup context.
pub fn read_port_from_file() -> Result<u16, AppError> {
    let port_dir = get_port_dir()?;
    let port_file = port_dir.join("event-server.port");
    let content = std::fs::read_to_string(&port_file).map_err(|e| {
        AppError::EventServer(format!("Port file not found or unreadable: {}", e))
    })?;
    content
        .trim()
        .parse::<u16>()
        .map_err(|_| AppError::EventServer(format!("Invalid port in file: {}", content.trim())))
}

/// Extract the main project path from a worktree path.
/// e.g., "/Users/x/project/.claude/worktrees/fix-auth" -> Some("/Users/x/project")
fn extract_parent_project_path(path: &str) -> Option<String> {
    path.find("/.claude/worktrees/")
        .map(|idx| path[..idx].to_string())
}

/// Get the directory for the port file (~/.flow-orche/).
fn get_port_dir() -> Result<std::path::PathBuf, AppError> {
    let home = dirs::home_dir().ok_or_else(|| {
        AppError::EventServer("Could not determine home directory".into())
    })?;
    Ok(home.join(".flow-orche"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_parent_project_path() {
        assert_eq!(
            extract_parent_project_path("/Users/me/project/.claude/worktrees/fix-auth"),
            Some("/Users/me/project".to_string())
        );
        assert_eq!(
            extract_parent_project_path("/Users/me/project/.claude/worktrees/add-ui"),
            Some("/Users/me/project".to_string())
        );
        assert_eq!(extract_parent_project_path("/Users/me/project"), None);
        assert_eq!(extract_parent_project_path("/Users/me/project/src"), None);
    }

    #[test]
    fn test_hook_event_serialization() {
        let event = HookEvent {
            project_path: "/Users/test/project".into(),
            event_type: "Notification".into(),
            payload: serde_json::json!({"message": "test"}),
            timestamp: "2024-01-01T00:00:00Z".into(),
        };

        let json = serde_json::to_string(&event).expect("Should serialize");
        assert!(json.contains("projectPath"));
        assert!(json.contains("eventType"));
        assert!(!json.contains("project_path"));
        assert!(!json.contains("event_type"));
    }

    #[test]
    fn test_port_dir() {
        let dir = get_port_dir();
        assert!(dir.is_ok());
        let path = dir.expect("Should get port dir");
        assert!(path.to_str().expect("Should be valid string").contains(".flow-orche"));
    }
}
