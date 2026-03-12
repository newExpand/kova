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

/// Scan interval for session-level persistent monitor (idle state)
const SESSION_SCAN_INTERVAL: Duration = Duration::from_secs(5);
/// Maximum lifetime for session-level monitor (24 hours)
const SESSION_MONITOR_MAX_SECS: u64 = 86400;
/// Max consecutive scan errors before session monitor gives up
const SESSION_SCAN_MAX_ERRORS: u32 = 20;

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
/// 3. Emits `SessionStart` when detected, `AgentActive` when confirmed, `Stop` when exited
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
    // Phase 1: Wait for agent process to appear (check first, then sleep)
    // Use detect_agent_in_window for improved child process detection
    let mut detected = false;
    let mut detected_type = agent_type;
    for _ in 0..(DETECT_TIMEOUT_SECS / 2) {
        match crate::services::tmux::detect_agent_in_window(session_name, window_name) {
            Ok(Some(agent)) => {
                detected = true;
                detected_type = agent;
                let suffixed_path = agent_suffixed_path(project_path, detected_type);
                emit_synthetic_event(app_handle, &suffixed_path, "SessionStart", None);
                info!(
                    "Pane monitor: {} detected in {}:{}",
                    detected_type.display_name(),
                    session_name,
                    window_name
                );
                break;
            }
            Ok(None) => {}
            Err(e) => {
                warn!("Pane monitor: tmux query error during detection: {}", e);
            }
        }
        thread::sleep(DETECT_POLL_INTERVAL);
    }

    if !detected {
        warn!(
            "Pane monitor: agent not detected in {}:{} after {}s",
            session_name,
            window_name,
            DETECT_TIMEOUT_SECS
        );
        return;
    }

    let suffixed_path = agent_suffixed_path(project_path, detected_type);

    // Phase 2: Poll until agent exits (sleep first to debounce startup transients)
    let mut consecutive_errors: u32 = 0;
    let mut first_poll = true;

    for _ in 0..(MONITOR_TIMEOUT_SECS / 3) {
        thread::sleep(MONITOR_POLL_INTERVAL);

        match crate::services::tmux::detect_agent_in_window(session_name, window_name) {
            Ok(Some(_)) => {
                consecutive_errors = 0;
                // First successful poll after SessionStart → emit AgentActive
                if first_poll {
                    first_poll = false;
                    emit_synthetic_event(app_handle, &suffixed_path, "AgentActive", None);
                }
            }
            Ok(None) => {
                emit_synthetic_event(
                    app_handle,
                    &suffixed_path,
                    "Stop",
                    Some("Agent process exited"),
                );
                info!(
                    "Pane monitor: {} exited in {}:{}",
                    detected_type.display_name(),
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
                        &suffixed_path,
                        "Stop",
                        Some("Monitoring lost contact with tmux"),
                    );
                    return;
                }
            }
        }
    }

    tracing::error!(
        "Pane monitor: timeout reached for {}:{} ({}s) — agent may still be running",
        session_name, window_name, MONITOR_TIMEOUT_SECS
    );
    emit_synthetic_event(app_handle, &suffixed_path, "Stop", Some("Monitor timeout (agent may still be running)"));
}

/// Persistent session-level monitor for detecting non-hook agents (Codex, Gemini).
///
/// Unlike `watch_agent_pane()` which targets a single window with a 30s detect timeout,
/// this monitor scans the entire tmux session continuously, detecting agent start/stop
/// cycles indefinitely until the session is destroyed or the monitor is removed.
///
/// Claude is excluded since it uses the HTTP hook path.
pub fn watch_session_agents(
    app_handle: tauri::AppHandle,
    session_name: String,
    project_path: String,
) {
    let key = (session_name.clone(), "__session__".to_string());

    // Deduplication
    {
        let mut guard = active_monitors();
        let set = guard.get_or_insert_with(HashSet::new);
        if !set.insert(key.clone()) {
            info!(
                "Session monitor already active for {}, skipping",
                session_name
            );
            return;
        }
    }

    thread::spawn(move || {
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            run_session_monitor(&app_handle, &session_name, &project_path);
        }));

        if let Err(panic) = result {
            tracing::error!(
                "Session monitor panicked for {}: {:?}",
                key.0, panic
            );
        }

        // Cleanup
        let mut guard = active_monitors();
        if let Some(set) = guard.as_mut() {
            set.remove(&key);
        }
    });
}

fn run_session_monitor(
    app_handle: &tauri::AppHandle,
    session_name: &str,
    project_path: &str,
) {
    info!("Session monitor started for {}", session_name);
    let start = std::time::Instant::now();
    let mut consecutive_scan_errors: u32 = 0;

    loop {
        // Max lifetime check (24 hours)
        if start.elapsed().as_secs() > SESSION_MONITOR_MAX_SECS {
            info!(
                "Session monitor for {} reached max lifetime ({}s), exiting",
                session_name, SESSION_MONITOR_MAX_SECS
            );
            return;
        }

        // Check if monitor was removed from active set (cleanup signal)
        {
            let guard = active_monitors();
            if let Some(set) = guard.as_ref() {
                let key = (session_name.to_string(), "__session__".to_string());
                if !set.contains(&key) {
                    info!("Session monitor for {} removed from active set, exiting", session_name);
                    return;
                }
            }
        }

        // Scan session for non-Claude agents
        match crate::services::tmux::detect_agents_in_session(session_name, false) {
            Ok(agents) if agents.is_empty() => {
                consecutive_scan_errors = 0;
                // No agents found — wait and rescan
                thread::sleep(SESSION_SCAN_INTERVAL);
            }
            Ok(agents) => {
                consecutive_scan_errors = 0;
                // Delegate each detected agent to a per-window pane monitor thread.
                // This avoids blocking the scan loop: all agents are tracked in parallel,
                // and watch_agent_pane's dedup (ACTIVE_MONITORS) prevents double-monitoring.
                for (window_name, agent_type) in agents {
                    // Skip if already being monitored (per-window or prior detection)
                    {
                        let guard = active_monitors();
                        if let Some(set) = guard.as_ref() {
                            let window_key = (session_name.to_string(), window_name.clone());
                            if set.contains(&window_key) {
                                continue;
                            }
                        }
                    }

                    info!(
                        "Session monitor: delegating {} in {}:{} to pane monitor",
                        agent_type.display_name(), session_name, window_name
                    );

                    // Spawn a dedicated pane monitor thread for this window.
                    // Pass raw project_path — watch_agent_pane/run_monitor will apply
                    // agent_suffixed_path() internally.
                    watch_agent_pane(
                        app_handle.clone(),
                        session_name.to_string(),
                        window_name,
                        project_path.to_string(),
                        agent_type,
                    );
                }
                // Brief pause before next scan to avoid busy-looping
                thread::sleep(SESSION_SCAN_INTERVAL);
            }
            Err(e) => {
                let err_str = e.to_string();
                // Session gone → exit monitor
                if err_str.contains("can't find session")
                    || err_str.contains("session not found")
                    || err_str.contains("no server running")
                {
                    info!("Session monitor: session {} no longer exists, exiting", session_name);
                    return;
                }
                consecutive_scan_errors += 1;
                warn!(
                    "Session monitor: scan error ({}/{}) for {}: {}",
                    consecutive_scan_errors, SESSION_SCAN_MAX_ERRORS, session_name, e
                );
                if consecutive_scan_errors >= SESSION_SCAN_MAX_ERRORS {
                    tracing::error!(
                        "Session monitor: giving up on {} after {} consecutive scan errors",
                        session_name, consecutive_scan_errors
                    );
                    return;
                }
                thread::sleep(SESSION_SCAN_INTERVAL);
            }
        }
    }
}

/// Build suffixed project_path for pane monitor synthetic events.
/// Claude hook events use the raw project_path; pane monitor events add an agent suffix
/// to avoid key collision in agentActivityStore.
fn agent_suffixed_path(project_path: &str, agent_type: AgentType) -> String {
    if matches!(agent_type, AgentType::ClaudeCode) {
        // Claude uses hook path — no suffix needed
        project_path.to_string()
    } else {
        format!("{}/.agent/{}", project_path, agent_type.to_db_str())
    }
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
