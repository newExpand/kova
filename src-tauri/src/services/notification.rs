use crate::errors::AppError;
use crate::models::notification::NotificationRecord;
use rusqlite::Connection;
use std::collections::HashMap;
use std::io::Read as _;
use std::sync::{LazyLock, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_notification::NotificationExt;
use tracing::{info, warn};

/// Active alerter PID per group. Keys are formatted as `"flow-orche:{group_id}"`.
/// Prevents alerter process accumulation by killing the previous process before spawning a new one.
static ACTIVE_ALERTER_PIDS: LazyLock<Mutex<HashMap<String, u32>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// Maximum time an alerter process can live before being killed via SIGKILL.
const ALERTER_TIMEOUT: Duration = Duration::from_secs(300); // 5 minutes
/// Polling interval for checking alerter process exit status.
const ALERTER_POLL_INTERVAL: Duration = Duration::from_millis(500);

/// Lock the active alerters map, recovering from mutex poisoning.
/// A poisoned mutex means a thread panicked while holding it, but the data is likely still valid.
fn lock_alerter_pids() -> std::sync::MutexGuard<'static, HashMap<String, u32>> {
    match ACTIVE_ALERTER_PIDS.lock() {
        Ok(guard) => guard,
        Err(poisoned) => {
            warn!("ACTIVE_ALERTER_PIDS mutex was poisoned, recovering");
            poisoned.into_inner()
        }
    }
}

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
    group_id: &str,
    project_id: &str,
) -> Result<(), AppError> {
    if cfg!(target_os = "macos") {
        return match notification_style {
            "banner" => send_via_osascript(title, body),
            _ => send_via_alerter_or_osascript(
                title,
                body,
                group_id,
                app.clone(),
                project_id.to_string(),
            ),
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

/// Kill a previous alerter process for the given group (if any) and remove it from the map.
/// Uses SIGTERM via external kill command (we only store PIDs, not Child handles,
/// since the Child is owned by the reaper thread).
fn kill_previous_alerter(group: &str) {
    let mut map = lock_alerter_pids();
    if let Some(pid) = map.remove(group) {
        match std::process::Command::new("kill")
            .arg("-TERM")
            .arg(pid.to_string())
            .output()
        {
            Ok(output) if output.status.success() => {
                info!("Sent SIGTERM to previous alerter (PID {}) for group: {}", pid, group);
            }
            Ok(_) => {
                info!("SIGTERM for alerter PID {} returned non-zero (likely already exited)", pid);
            }
            Err(e) => {
                warn!("Failed to kill previous alerter (PID {}): {}", pid, e);
            }
        }
    }
}

fn send_via_alerter_or_osascript(
    title: &str,
    body: &str,
    group_id: &str,
    app_handle: AppHandle,
    project_id: String,
) -> Result<(), AppError> {
    // body가 비어있으면 title을 message로 사용 (방어적 폴백)
    let alert_message = if body.is_empty() { title } else { body };
    let alerter_group = format!("flow-orche:{}", group_id);

    // Kill previous alerter for this group to prevent process accumulation
    kill_previous_alerter(&alerter_group);

    match std::process::Command::new("alerter")
        .arg("-title")
        .arg(escape_alerter_arg(title))
        .arg("-message")
        .arg(escape_alerter_arg(alert_message))
        .arg("-sound")
        .arg("default")
        .arg("-group")
        .arg(&alerter_group)
        .stdout(std::process::Stdio::piped())
        .spawn()
    {
        Ok(mut child) => {
            let child_pid = child.id();

            lock_alerter_pids().insert(alerter_group.clone(), child_pid);

            // Reap child with timeout + capture stdout to detect user click
            thread::spawn(move || {
                let start = Instant::now();

                // Poll for process exit with timeout instead of infinite wait_with_output()
                // Only user-initiated exit (exit code 0) counts as "clicked"
                let user_exited = loop {
                    match child.try_wait() {
                        Ok(Some(status)) => break status.success(),
                        Ok(None) => {
                            if start.elapsed() >= ALERTER_TIMEOUT {
                                // SIGKILL as last resort -- process exceeded ALERTER_TIMEOUT
                                if let Err(e) = child.kill() {
                                    info!("Alerter kill error (PID {}, likely already exited): {}", child_pid, e);
                                }
                                if let Err(e) = child.wait() {
                                    warn!("Failed to reap alerter process (PID {}): {}", child_pid, e);
                                }
                                info!("Alerter timed out (PID {}), killed", child_pid);
                                break false;
                            }
                            thread::sleep(ALERTER_POLL_INTERVAL);
                        }
                        Err(e) => {
                            warn!("Alerter try_wait error (PID {}): {}", child_pid, e);
                            break false;
                        }
                    }
                };

                // Read stdout for click detection (only if user dismissed with exit code 0)
                if user_exited {
                    let mut stdout_str = String::new();
                    if let Some(mut stdout) = child.stdout.take() {
                        if let Err(e) = stdout.read_to_string(&mut stdout_str) {
                            warn!("Failed to read alerter stdout (PID {}): {} -- click detection skipped", child_pid, e);
                        }
                    }

                    if stdout_str.contains("@CONTENTCLICKED")
                        || stdout_str.contains("@ACTIONCLICKED")
                    {
                        // Activate the macOS app (bring to foreground from other apps)
                        #[cfg(target_os = "macos")]
                        {
                            use objc2::rc::Retained;
                            use objc2::runtime::{AnyClass, NSObject};
                            use objc2::msg_send;

                            unsafe {
                                if let Some(cls) = AnyClass::get(c"NSRunningApplication") {
                                    let current: Retained<NSObject> =
                                        msg_send![cls, currentApplication];
                                    // NSApplicationActivateAllWindows | NSApplicationActivateIgnoringOtherApps
                                    let _: bool =
                                        msg_send![&*current, activateWithOptions: 3_usize];
                                }
                            }
                        }
                        // Focus the app window
                        if let Some(window) = app_handle.get_webview_window("main") {
                            let _ = window.unminimize();
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                        if let Err(e) = app_handle.emit("notification:clicked", &project_id) {
                            warn!("Failed to emit notification:clicked for project {}: {}", project_id, e);
                        }
                        info!("Notification clicked for project: {}", project_id);
                    }
                }

                // Remove from active alerters map (only if still our PID)
                let mut map = lock_alerter_pids();
                if map.get(&alerter_group).copied() == Some(child_pid) {
                    map.remove(&alerter_group);
                }
            });
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

    match std::process::Command::new("osascript")
        .arg("-e")
        .arg(&script)
        .spawn()
    {
        Ok(mut child) => {
            // Reap child to prevent zombie process accumulation
            thread::spawn(move || {
                let _ = child.wait();
            });
        }
        Err(e) => {
            warn!("osascript notification failed: {}", e);
        }
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

/// Delete notification records older than `retention_days`.
/// Returns the number of deleted rows.
pub fn prune_old_notifications(conn: &Connection, retention_days: i64) -> Result<u64, AppError> {
    let retention_days = retention_days.max(1);
    let cutoff = chrono::Utc::now() - chrono::Duration::days(retention_days);
    let cutoff_str = cutoff.to_rfc3339();

    let deleted = conn.execute(
        "DELETE FROM notification_history WHERE created_at < ?1",
        rusqlite::params![cutoff_str],
    )?;

    if deleted > 0 {
        info!(
            "Pruned {} old notifications (older than {} days)",
            deleted, retention_days
        );
    }

    Ok(deleted as u64)
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

    #[test]
    fn test_prune_old_notifications() {
        let conn = setup_test_db();

        // Insert a notification with an old timestamp (30 days ago)
        let old_time = (chrono::Utc::now() - chrono::Duration::days(30)).to_rfc3339();
        conn.execute(
            "INSERT INTO notification_history (id, project_id, event_type, title, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params!["old-1", "proj1", "type1", "Old Notif", old_time],
        )
        .unwrap();

        // Insert a recent notification
        store_notification(&conn, "proj1", "type1", "Recent Notif", None, None).unwrap();

        // Prune notifications older than 7 days
        let deleted = prune_old_notifications(&conn, 7).unwrap();
        assert_eq!(deleted, 1);

        // Verify only recent notification remains
        let remaining = list_notifications(&conn, "proj1", 10).unwrap();
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].title, "Recent Notif");
    }
}
