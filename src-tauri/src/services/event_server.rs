use crate::errors::AppError;
use serde::{Deserialize, Serialize};
use std::sync::mpsc;
use std::thread;
use tauri::{AppHandle, Emitter};
use tiny_http::{ListenAddr, Method, Response, Server, StatusCode};
use tracing::{error, info, warn};
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

/// Main request handling loop.
fn handle_requests(server: Server, shutdown_rx: mpsc::Receiver<()>, app_handle: AppHandle) {
    loop {
        // Check for shutdown signal
        if shutdown_rx.try_recv().is_ok() {
            info!("Event server received shutdown signal");
            break;
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

        if let Err(e) = process_request(request, &app_handle) {
            warn!("Error processing request: {}", e);
        }
    }
}

/// Process a single HTTP request.
fn process_request(
    mut request: tiny_http::Request,
    app_handle: &AppHandle,
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

    // Read and parse JSON body
    let mut body = String::new();
    if let Err(e) = request.as_reader().read_to_string(&mut body) {
        let _ = request.respond(
            Response::from_string(format!(r#"{{"error":"Failed to read body: {}"}}"#, e))
                .with_status_code(StatusCode(400)),
        );
        return Ok(());
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
