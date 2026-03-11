use crate::models::agent_type::AgentType;
use crate::services::event_server::HookEvent;
use std::collections::HashSet;
use std::sync::Mutex;
use std::thread;
use std::time::Duration;
use tauri::Emitter;
use tracing::{info, warn};

const DETECT_POLL_INTERVAL: Duration = Duration::from_secs(2);
const DETECT_TIMEOUT_SECS: u64 = 30;
const MONITOR_POLL_INTERVAL: Duration = Duration::from_secs(3);
const MONITOR_TIMEOUT_SECS: u64 = 7200; // 2 hours max
const MAX_CONSECUTIVE_ERRORS: u32 = 5;

/// Tracks active monitor threads to prevent duplicate spawns for the same pane.
static ACTIVE_MONITORS: Mutex<Option<HashSet<(String, String)>>> = Mutex::new(None);

fn active_monitors() -> std::sync::MutexGuard<'static, Option<HashSet<(String, String)>>> {
    ACTIVE_MONITORS.lock().unwrap_or_else(|e| e.into_inner())
}

/// Watch a non-hook agent's tmux pane and emit synthetic activity events.
///
/// These events mimic the `HookEvent` format normally received via HTTP hooks,
/// allowing the frontend `agentActivityStore` to track non-hook agents through
/// the same pipeline.
///
/// Spawns a background thread that:
/// 1. Waits for the agent process to appear in the pane (max 30s, checks immediately)
/// 2. Polls until the agent process exits (every 3s, sleep-first to debounce)
/// 3. Emits `SessionStart` when detected, `Stop` when exited or on timeout/error
///
/// Includes deduplication (skips if a monitor already exists for the same pane)
/// and consecutive-error tracking (stops after 5 consecutive tmux failures).
pub fn watch_agent_pane(
    app_handle: tauri::AppHandle,
    session_name: String,
    window_name: String,
    project_path: String,
    agent_type: AgentType,
) {
    let key = (session_name.clone(), window_name.clone());

    // Deduplication: skip if already monitoring this pane
    {
        let mut guard = active_monitors();
        let set = guard.get_or_insert_with(HashSet::new);
        if !set.insert(key.clone()) {
            info!(
                "Pane monitor already active for {}:{}, skipping",
                session_name, window_name
            );
            return;
        }
    }

    thread::spawn(move || {
        // Panic guard: ensure cleanup and logging on unexpected panic
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            run_monitor(&app_handle, &session_name, &window_name, &project_path, agent_type);
        }));

        if let Err(panic) = result {
            tracing::error!(
                "Pane monitor panicked for {}:{}: {:?}",
                key.0, key.1, panic
            );
        }

        // Cleanup: remove from active set
        let mut guard = active_monitors();
        if let Some(set) = guard.as_mut() {
            set.remove(&key);
        }
    });
}

fn run_monitor(
    app_handle: &tauri::AppHandle,
    session_name: &str,
    window_name: &str,
    project_path: &str,
    agent_type: AgentType,
) {
    let process_names = agent_type.process_names();

    // Phase 1: Wait for agent process to appear (check first, then sleep)
    let mut detected = false;
    for _ in 0..(DETECT_TIMEOUT_SECS / 2) {
        match crate::services::tmux::is_process_running_in_window(
            session_name,
            window_name,
            process_names,
        ) {
            Ok(true) => {
                detected = true;
                emit_synthetic_event(app_handle, project_path, "SessionStart", None);
                info!(
                    "Pane monitor: {} detected in {}:{}",
                    agent_type.display_name(),
                    session_name,
                    window_name
                );
                break;
            }
            Ok(false) => {}
            Err(e) => {
                warn!("Pane monitor: tmux query error during detection: {}", e);
            }
        }
        thread::sleep(DETECT_POLL_INTERVAL);
    }

    if !detected {
        warn!(
            "Pane monitor: {} not detected in {}:{} after {}s",
            agent_type.display_name(),
            session_name,
            window_name,
            DETECT_TIMEOUT_SECS
        );
        return;
    }

    // Phase 2: Poll until agent exits (sleep first to debounce startup transients)
    let mut consecutive_errors: u32 = 0;

    for _ in 0..(MONITOR_TIMEOUT_SECS / 3) {
        thread::sleep(MONITOR_POLL_INTERVAL);

        match crate::services::tmux::is_process_running_in_window(
            session_name,
            window_name,
            process_names,
        ) {
            Ok(true) => {
                consecutive_errors = 0;
            }
            Ok(false) => {
                emit_synthetic_event(
                    app_handle,
                    project_path,
                    "Stop",
                    Some("Agent process exited"),
                );
                info!(
                    "Pane monitor: {} exited in {}:{}",
                    agent_type.display_name(),
                    session_name,
                    window_name
                );
                return;
            }
            Err(e) => {
                consecutive_errors += 1;
                warn!(
                    "Pane monitor: tmux query error ({}/{}): {}",
                    consecutive_errors, MAX_CONSECUTIVE_ERRORS, e
                );
                if consecutive_errors >= MAX_CONSECUTIVE_ERRORS {
                    tracing::error!(
                        "Pane monitor: lost contact with {}:{} after {} consecutive errors",
                        session_name,
                        window_name,
                        consecutive_errors
                    );
                    emit_synthetic_event(
                        app_handle,
                        project_path,
                        "Stop",
                        Some("Monitoring lost contact with tmux"),
                    );
                    return;
                }
            }
        }
    }

    warn!(
        "Pane monitor: timeout reached for {}:{} ({}s)",
        session_name, window_name, MONITOR_TIMEOUT_SECS
    );
    emit_synthetic_event(app_handle, project_path, "Stop", Some("Monitor timeout"));
}

fn emit_synthetic_event(
    app: &tauri::AppHandle,
    project_path: &str,
    event_type: &str,
    message: Option<&str>,
) {
    let payload = match message {
        Some(msg) => serde_json::json!({"message": msg}),
        None => serde_json::json!({}),
    };

    let hook_event = HookEvent {
        project_path: project_path.to_string(),
        event_type: event_type.to_string(),
        payload,
        timestamp: chrono::Utc::now().to_rfc3339(),
    };

    if let Err(e) = app.emit("notification:hook-received", &hook_event) {
        warn!("Failed to emit synthetic {} event: {}", event_type, e);
    }
}
