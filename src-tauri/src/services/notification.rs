use crate::errors::AppError;
use crate::models::notification::NotificationRecord;
use rusqlite::Connection;
use tauri::AppHandle;
use tauri_plugin_notification::NotificationExt;
use tracing::{info, warn};

/// Send a native macOS notification.
/// On macOS, always uses osascript/alerter because tauri-plugin-notification
/// requires a signed/bundled app (Apple Developer certificate) to work.
///
/// `notification_style` controls the notification behavior:
/// - "banner": temporary notification that auto-dismisses (osascript)
/// - "alert" (default): persistent notification that stays until dismissed (alerter)
pub fn send_native_notification(
    app: &AppHandle,
    title: &str,
    body: &str,
    notification_style: &str,
) -> Result<(), AppError> {
    if cfg!(target_os = "macos") {
        return match notification_style {
            "banner" => send_via_osascript(title, body),
            _ => send_via_alerter_or_osascript(title, body),
        };
    }

    app.notification()
        .builder()
        .title(title)
        .body(body)
        .show()
        .map_err(|e| AppError::Internal(format!("Failed to send notification: {}", e)))?;

    info!("Native notification sent: {}", title);
    Ok(())
}

/// Escape a string for use inside an AppleScript double-quoted string.
fn escape_applescript(s: &str) -> String {
    s.replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('\n', " ")
        .replace('\r', "")
}

/// Escape leading `[` for alerter CLI which treats it as special syntax.
fn escape_alerter_arg(s: &str) -> String {
    if s.starts_with('[') {
        format!("\\{}", s)
    } else {
        s.to_string()
    }
}

fn send_via_alerter_or_osascript(title: &str, body: &str) -> Result<(), AppError> {
    // body가 비어있으면 title을 message로 사용 (방어적 폴백)
    let alert_message = if body.is_empty() { title } else { body };

    match std::process::Command::new("alerter")
        .arg("-title")
        .arg(escape_alerter_arg(title))
        .arg("-message")
        .arg(escape_alerter_arg(alert_message))
        .arg("-sound")
        .arg("default")
        .spawn()
    {
        Ok(_child) => {
            info!("Native notification sent (alerter): {}", title);
            return Ok(());
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            warn!("alerter not found, falling back to osascript");
        }
        Err(e) => {
            warn!("alerter failed: {}, falling back to osascript", e);
        }
    }
    send_via_osascript(title, body)
}

fn send_via_osascript(title: &str, body: &str) -> Result<(), AppError> {
    let escaped_title = escape_applescript(title);
    let escaped_body = escape_applescript(body);
    let script = format!(
        r#"display notification "{}" with title "{}""#,
        escaped_body, escaped_title
    );

    let output = std::process::Command::new("osascript")
        .arg("-e")
        .arg(&script)
        .output()
        .map_err(|e| AppError::Internal(format!("osascript failed: {}", e)))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        warn!("osascript notification failed: {}", stderr);
    }

    info!("Native notification sent (osascript): {}", title);
    Ok(())
}

/// Store a notification record in the database.
/// Returns the ID of the newly created notification.
pub fn store_notification(
    conn: &Connection,
    project_id: &str,
    event_type: &str,
    title: &str,
    message: Option<&str>,
    payload: Option<&str>,
) -> Result<String, AppError> {
    let id = uuid::Uuid::new_v4().to_string();
    let created_at = chrono::Utc::now().to_rfc3339();

    conn.execute(
        "INSERT INTO notification_history (id, project_id, event_type, title, message, payload, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        rusqlite::params![id, project_id, event_type, title, message, payload, created_at],
    )?;

    info!(
        "Notification stored: id={}, project_id={}, event_type={}",
        id, project_id, event_type
    );

    Ok(id)
}

/// List notifications for a given project, ordered by most recent first.
/// Limit controls the maximum number of results (default 50 if 0 or negative).
pub fn list_notifications(
    conn: &Connection,
    project_id: &str,
    limit: i64,
) -> Result<Vec<NotificationRecord>, AppError> {
    let effective_limit = if limit <= 0 { 50 } else { limit };

    let mut stmt = conn.prepare(
        "SELECT id, project_id, event_type, title, message, payload, created_at
         FROM notification_history
         WHERE project_id = ?1
         ORDER BY created_at DESC
         LIMIT ?2",
    )?;

    let notifications = stmt
        .query_map(rusqlite::params![project_id, effective_limit], |row| {
            Ok(NotificationRecord {
                id: row.get(0)?,
                project_id: row.get(1)?,
                event_type: row.get(2)?,
                title: row.get(3)?,
                message: row.get(4)?,
                payload: row.get(5)?,
                created_at: row.get(6)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(notifications)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn setup_test_db() -> Connection {
        let conn = Connection::open_in_memory().expect("Failed to open in-memory DB");
        conn.execute_batch(
            "CREATE TABLE notification_history (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL,
                event_type TEXT NOT NULL,
                title TEXT NOT NULL,
                message TEXT,
                payload TEXT,
                created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
            );",
        )
        .expect("Failed to create test table");
        conn
    }

    #[test]
    fn test_store_notification_returns_id() {
        let conn = setup_test_db();
        let id = store_notification(
            &conn,
            "project-123",
            "Notification",
            "Test Title",
            Some("Test message"),
            None,
        )
        .expect("Should store notification");

        assert!(!id.is_empty());
        assert!(uuid::Uuid::parse_str(&id).is_ok());
    }

    #[test]
    fn test_list_notifications_ordered_by_recent() {
        let conn = setup_test_db();

        store_notification(&conn, "proj1", "type1", "First", None, None).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(10));
        store_notification(&conn, "proj1", "type2", "Second", None, None).unwrap();

        let notifications = list_notifications(&conn, "proj1", 10).expect("Should list");
        assert_eq!(notifications.len(), 2);
        assert_eq!(notifications[0].title, "Second"); // Most recent first
        assert_eq!(notifications[1].title, "First");
    }

    #[test]
    fn test_list_notifications_filters_by_project() {
        let conn = setup_test_db();

        store_notification(&conn, "proj1", "type1", "Proj1 Notif", None, None).unwrap();
        store_notification(&conn, "proj2", "type2", "Proj2 Notif", None, None).unwrap();

        let proj1_notifs = list_notifications(&conn, "proj1", 10).expect("Should list");
        assert_eq!(proj1_notifs.len(), 1);
        assert_eq!(proj1_notifs[0].title, "Proj1 Notif");

        let proj2_notifs = list_notifications(&conn, "proj2", 10).expect("Should list");
        assert_eq!(proj2_notifs.len(), 1);
        assert_eq!(proj2_notifs[0].title, "Proj2 Notif");
    }

    #[test]
    fn test_list_notifications_respects_limit() {
        let conn = setup_test_db();

        for i in 0..10 {
            store_notification(&conn, "proj1", "type", &format!("Notif {}", i), None, None)
                .unwrap();
        }

        let limited = list_notifications(&conn, "proj1", 3).expect("Should list");
        assert_eq!(limited.len(), 3);

        let default_limit = list_notifications(&conn, "proj1", 0).expect("Should list");
        assert_eq!(default_limit.len(), 10); // All results (< 50)
    }

    #[test]
    fn test_sql_injection_prevented() {
        let conn = setup_test_db();

        let malicious_project_id = "'; DROP TABLE notification_history; --";
        let id = store_notification(
            &conn,
            malicious_project_id,
            "test",
            "Test",
            None,
            None,
        )
        .expect("Should handle safely");

        assert!(!id.is_empty());

        // Verify table still exists
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM notification_history", [], |r| {
                r.get(0)
            })
            .expect("Table should still exist");
        assert_eq!(count, 1);
    }

    #[test]
    fn test_escape_applescript() {
        assert_eq!(escape_applescript(r#"hello "world""#), r#"hello \"world\""#);
        assert_eq!(escape_applescript("line1\nline2"), "line1 line2");
        assert_eq!(escape_applescript("back\\slash"), "back\\\\slash");
        assert_eq!(escape_applescript("cr\r\ntest"), "cr test");
    }
}
