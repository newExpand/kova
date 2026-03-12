use crate::models::agent_type::AgentType;
use crate::services::event_server::HookEvent;
use std::collections::HashSet;
use std::hash::{Hash, Hasher};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};
use tauri::Emitter;
use tracing::{info, warn};

fn hash_string(s: &str) -> u64 {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    s.hash(&mut hasher);
    hasher.finish()
}

const DETECT_POLL_INTERVAL: Duration = Duration::from_secs(2);
const DETECT_TIMEOUT_SECS: u64 = 30;
const MONITOR_POLL_INTERVAL: Duration = Duration::from_secs(3);
const MONITOR_TIMEOUT_SECS: u64 = 7200; // 2 hours max
const IDLE_AFTER_NO_CHANGE: Duration = Duration::from_secs(9);
const MAX_CONSECUTIVE_ERRORS: u32 = 5;
/// Delay after SessionStart to let baseline processes (MCP servers) stabilize
const BASELINE_SETTLE_DELAY: Duration = Duration::from_secs(3);
/// Refresh baseline after this many seconds of sustained idle
const BASELINE_REFRESH_IDLE_SECS: u64 = 30;

/// Scan interval for session-level persistent monitor (idle state)
const SESSION_SCAN_INTERVAL: Duration = Duration::from_secs(5);
/// Maximum lifetime for session-level monitor (24 hours)
const SESSION_MONITOR_MAX_SECS: u64 = 86400;
/// Max consecutive scan errors before session monitor gives up
const SESSION_SCAN_MAX_ERRORS: u32 = 20;

/// Tracks active monitor threads to prevent duplicate spawns for the same pane.
type MonitorSet = Option<HashSet<(String, String)>>;
static ACTIVE_MONITORS: Mutex<MonitorSet> = Mutex::new(None);

fn active_monitors() -> Result<std::sync::MutexGuard<'static, MonitorSet>, ()> {
    ACTIVE_MONITORS.lock().map_err(|e| {
        tracing::error!("active_monitors mutex poisoned: {}", e);
    })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SyntheticStatus {
    Active,
    Idle,
}

#[derive(Debug, Clone)]
struct SyntheticAgentMeta {
    instance_key: String,
    agent_type: AgentType,
    session_name: String,
    window_name: String,
    pane_id: String,
    pane_index: String,
}

impl SyntheticAgentMeta {
    fn new(
        project_path: &str,
        session_name: &str,
        window_name: &str,
        pane_id: &str,
        pane_index: &str,
        agent_type: AgentType,
    ) -> Self {
        Self {
            instance_key: build_instance_key(project_path, agent_type, pane_id),
            agent_type,
            session_name: session_name.to_string(),
            window_name: window_name.to_string(),
            pane_id: pane_id.to_string(),
            pane_index: pane_index.to_string(),
        }
    }

    fn payload(&self, message: Option<&str>) -> serde_json::Value {
        serde_json::json!({
            "instance_key": self.instance_key,
            "agent_type": self.agent_type.to_db_str(),
            "source": "synthetic",
            "session_name": self.session_name,
            "window_name": self.window_name,
            "pane_id": self.pane_id,
            "pane_index": self.pane_index,
            "message": message,
        })
    }
}

fn build_instance_key(project_path: &str, agent_type: AgentType, pane_id: &str) -> String {
    format!(
        "{}::{}::{}",
        project_path.trim_end_matches('/'),
        agent_type.to_db_str(),
        pane_id.trim_start_matches('%')
    )
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
/// 3. Emits `SessionStart`, then transitions between `AgentActive` / `AgentIdle`,
///    and finally emits `Stop` when the pane no longer hosts the agent
///
/// Includes deduplication (skips if a monitor already exists for the same pane)
/// and consecutive-error tracking (stops after 5 consecutive tmux failures).
pub fn watch_agent_pane(
    app_handle: tauri::AppHandle,
    session_name: String,
    window_name: String,
    pane_id: String,
    pane_index: String,
    project_path: String,
    known_agent_type: AgentType,
) {
    let key = (session_name.clone(), pane_id.clone());

    // Deduplication: skip if already monitoring this pane
    {
        let Ok(mut guard) = active_monitors() else {
            warn!("Skipping pane monitor spawn for {}:{} — mutex poisoned", session_name, pane_id);
            return;
        };
        let set = guard.get_or_insert_with(HashSet::new);
        if !set.insert(key.clone()) {
            info!(
                "Pane monitor already active for {}:{}, skipping",
                session_name, pane_id
            );
            return;
        }
    }

    thread::spawn(move || {
        // Panic guard: ensure cleanup and logging on unexpected panic
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            run_monitor(
                &app_handle,
                &session_name,
                &window_name,
                &pane_id,
                &pane_index,
                &project_path,
                known_agent_type,
            );
        }));

        if let Err(panic) = result {
            tracing::error!(
                "Pane monitor panicked for {}:{}: {:?}",
                key.0, key.1, panic
            );
        }

        // Cleanup: remove from active set
        if let Ok(mut guard) = active_monitors() {
            if let Some(set) = guard.as_mut() {
                set.remove(&key);
            }
        }
    });
}

fn run_monitor(
    app_handle: &tauri::AppHandle,
    session_name: &str,
    window_name: &str,
    pane_id: &str,
    pane_index: &str,
    project_path: &str,
    known_agent_type: AgentType,
) {
    // Phase 1: Wait for agent process to appear (check first, then sleep)
    // detect_agent_in_pane returns (AgentType, pane_pid) so we can inspect the process tree.
    let mut detected_meta: Option<SyntheticAgentMeta> = None;
    let mut pane_pid_str: Option<String> = None;
    for _ in 0..(DETECT_TIMEOUT_SECS / 2) {
        match crate::services::tmux::detect_agent_in_pane(pane_id) {
            Ok(Some((_detected_agent, pid_str))) => {
                // Use the known_agent_type from the caller (session monitor / start_worktree_task)
                // instead of the re-detected agent type. Re-detection via pgrep can misidentify
                // the agent when multiple agent-related tokens appear in child process command lines.
                let meta = SyntheticAgentMeta::new(
                    project_path,
                    session_name,
                    window_name,
                    pane_id,
                    pane_index,
                    known_agent_type,
                );
                emit_synthetic_event(app_handle, project_path, &meta, "SessionStart", Some("Agent detected"));
                info!(
                    "Pane monitor: {} detected in {}:{} pane {}",
                    known_agent_type.display_name(),
                    session_name,
                    window_name,
                    pane_id
                );
                pane_pid_str = Some(pid_str);
                detected_meta = Some(meta);
                break;
            }
            Ok(None) => {}
            Err(e) => {
                warn!("Pane monitor: tmux query error during detection: {}", e);
            }
        }
        thread::sleep(DETECT_POLL_INTERVAL);
    }

    let Some(meta) = detected_meta else {
        warn!(
            "Pane monitor: agent not detected in {}:{} pane {} after {}s",
            session_name, window_name, pane_id, DETECT_TIMEOUT_SECS
        );
        return;
    };

    // Wait for baseline to stabilize (MCP servers finish spawning)
    thread::sleep(BASELINE_SETTLE_DELAY);

    // Record baseline descendant count (MCP servers + wrappers)
    let current_pane_pid = pane_pid_str.as_deref().unwrap_or("");
    let mut baseline_count = match crate::services::tmux::snapshot_agent_activity(current_pane_pid) {
        Ok(Some(s)) => s.descendant_count,
        Ok(None) => {
            warn!("Pane monitor: agent gone during baseline snapshot for pane {}, using 0", pane_id);
            0
        }
        Err(e) => {
            warn!("Pane monitor: baseline snapshot failed for pane {}: {} — defaulting to 0", pane_id, e);
            0
        }
    };

    info!(
        "Pane monitor: baseline descendant count for pane {}: {}",
        pane_id, baseline_count
    );

    // Capture initial content hash for change-based output detection.
    // Works for both normal buffer and alternate screen (TUI agents like Codex).
    let mut last_content_hash: Option<u64> = match crate::services::tmux::capture_pane_content(pane_id) {
        Ok(Some(c)) => Some(hash_string(&c)),
        Ok(None) => None,
        Err(e) => {
            warn!("Pane monitor: initial content capture failed for pane {}: {}", pane_id, e);
            None
        }
    };

    // Phase 2: Poll until agent exits using hybrid detection.
    // Hybrid detection: process-tree descendants + capture-pane content.
    // For Codex, content hash is unused (replaced by TUI "Working" indicator);
    // for future non-TUI agents, sustained content change serves as a fallback signal.
    // Require 3 consecutive content changes (9s at 3s poll) to reduce false positives
    // from user typing in TUI agents.
    let mut consecutive_errors: u32 = 0;
    let mut last_active_at = Instant::now();
    let mut idle_since = Instant::now();
    let mut last_emitted_status: Option<SyntheticStatus> = None;
    let mut consecutive_content_changes: u32 = 0;
    let mut logged_capture_failure = false;

    for _ in 0..(MONITOR_TIMEOUT_SECS / 3) {
        thread::sleep(MONITOR_POLL_INTERVAL);

        // Check agent alive + refresh pane_pid
        let current_pid = match crate::services::tmux::detect_agent_in_pane(pane_id) {
            Ok(Some((_agent, pid_str))) => {
                consecutive_errors = 0;
                pid_str
            }
            Ok(None) => {
                emit_synthetic_event(
                    app_handle, project_path, &meta, "Stop",
                    Some("Agent process exited"),
                );
                info!(
                    "Pane monitor: {} exited in {}:{} pane {}",
                    meta.agent_type.display_name(), session_name, window_name, pane_id
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
                        session_name, pane_id, consecutive_errors
                    );
                    emit_synthetic_event(
                        app_handle, project_path, &meta, "Stop",
                        Some("Monitoring lost contact with tmux"),
                    );
                    return;
                }
                continue;
            }
        };

        // --- Signal 1: capture pane content (single capture per cycle) ---
        // Raw content is used for both hash-based change detection and
        // Codex TUI "Working" indicator matching.
        let pane_content = match crate::services::tmux::capture_pane_content(pane_id) {
            Ok(c) => c,
            Err(e) => {
                if !logged_capture_failure {
                    warn!("Pane monitor: content capture failing for pane {}: {} (suppressing further)", pane_id, e);
                    logged_capture_failure = true;
                }
                None
            }
        };

        let current_hash = pane_content.as_ref().map(|c| hash_string(c));

        let content_changed = match (current_hash, last_content_hash) {
            (Some(curr), Some(prev)) => curr != prev,
            _ => false, // capture failed → assume no change
        };

        if current_hash.is_some() {
            last_content_hash = current_hash;
        }

        if content_changed {
            consecutive_content_changes += 1;
        } else {
            consecutive_content_changes = 0;
        }
        let sustained_output = consecutive_content_changes >= 3;

        // Codex TUI shows "Working (Xs · esc to interrupt)" when actively processing.
        // This is reliable: only appears when agent is working, never from user typing.
        let codex_tui_working = meta.agent_type == AgentType::CodexCli
            && pane_content.as_ref().is_some_and(|c| {
                c.contains("Working (") && c.contains("esc to interrupt")
            });

        // --- Signal 2: process-tree descendants (existing) ---
        let has_extra_processes = match crate::services::tmux::snapshot_agent_activity(&current_pid) {
            Ok(Some(snapshot)) => {
                let has_extra = snapshot.descendant_count > baseline_count;

                // Adaptive baseline: refresh after sustained idle
                if !has_extra && idle_since.elapsed().as_secs() > BASELINE_REFRESH_IDLE_SECS {
                    if snapshot.descendant_count != baseline_count {
                        info!(
                            "Pane monitor: adaptive baseline refresh {} → {} for pane {}",
                            baseline_count, snapshot.descendant_count, pane_id
                        );
                        baseline_count = snapshot.descendant_count;
                    }
                    idle_since = Instant::now();
                }

                has_extra
            }
            Ok(None) => {
                emit_synthetic_event(
                    app_handle, project_path, &meta, "Stop",
                    Some("Agent process exited"),
                );
                return;
            }
            Err(e) => {
                warn!(
                    "Pane monitor: process snapshot failed for pane {}: {}",
                    pane_id, e
                );
                false // treat snapshot failure as no extra processes
            }
        };

        // --- Activity decision ---
        // Codex: process tree + TUI "Working" indicator. Content hash alone
        // causes false positives from user typing. The TUI indicator is reliable
        // because Codex only shows "Working (...)" when the agent is processing.
        // Process tree catches long-running tool executions; TUI indicator catches
        // short-lived ones (ls, pwd, rg) that complete between poll intervals.
        let is_working = if meta.agent_type == AgentType::CodexCli {
            has_extra_processes || codex_tui_working
        } else {
            has_extra_processes || sustained_output
        };

        if is_working {
            last_active_at = Instant::now();
            idle_since = Instant::now();
            if last_emitted_status != Some(SyntheticStatus::Active) {
                info!(
                    "Pane monitor: {} → AgentActive (agent={:?}, extra_proc={}, sustained={}, baseline={}, pane={})",
                    meta.instance_key, meta.agent_type, has_extra_processes, sustained_output, baseline_count, pane_id
                );
                emit_synthetic_event(
                    app_handle, project_path, &meta,
                    "AgentActive", Some("Working..."),
                );
                last_emitted_status = Some(SyntheticStatus::Active);
            }
        } else if last_active_at.elapsed() >= IDLE_AFTER_NO_CHANGE
            && last_emitted_status != Some(SyntheticStatus::Idle)
        {
            emit_synthetic_event(
                app_handle, project_path, &meta,
                "AgentIdle", Some("Waiting for next prompt"),
            );
            last_emitted_status = Some(SyntheticStatus::Idle);
        }
    }

    tracing::error!(
        "Pane monitor: timeout reached for {}:{} pane {} ({}s) — agent may still be running",
        session_name, window_name, pane_id, MONITOR_TIMEOUT_SECS
    );
    emit_synthetic_event(
        app_handle, project_path, &meta, "Stop",
        Some("Monitor timeout (agent may still be running)"),
    );
}

/// Persistent session-level monitor for agents lacking full hook coverage (currently Codex).
///
/// Unlike `watch_agent_pane()` which targets a single pane with a 30s detect timeout,
/// this monitor scans the entire tmux session continuously, detecting agent start/stop
/// cycles indefinitely until the session is destroyed or the monitor is removed.
///
/// Agents with complete hook coverage (Claude, Gemini) are excluded by
/// `detect_agents_in_session` — only Codex (pane monitor needed) is returned.
pub fn watch_session_agents(
    app_handle: tauri::AppHandle,
    session_name: String,
    project_path: String,
) {
    let key = (session_name.clone(), "__session__".to_string());

    // Deduplication
    {
        let Ok(mut guard) = active_monitors() else {
            warn!("Skipping session monitor spawn for {} — mutex poisoned", session_name);
            return;
        };
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
        if let Ok(mut guard) = active_monitors() {
            if let Some(set) = guard.as_mut() {
                set.remove(&key);
            }
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
            let Ok(guard) = active_monitors() else {
                tracing::error!(
                    "Session monitor for {} exiting: mutex poisoned, cannot check cleanup signal",
                    session_name
                );
                return;
            };
            if let Some(set) = guard.as_ref() {
                let key = (session_name.to_string(), "__session__".to_string());
                if !set.contains(&key) {
                    info!("Session monitor for {} removed from active set, exiting", session_name);
                    return;
                }
            }
        }

        // Scan session for agents lacking full hook coverage (currently Codex only)
        match crate::services::tmux::detect_agents_in_session(session_name, false) {
            Ok(agents) if agents.is_empty() => {
                consecutive_scan_errors = 0;
                // No agents found — wait and rescan
                thread::sleep(SESSION_SCAN_INTERVAL);
            }
            Ok(agents) => {
                consecutive_scan_errors = 0;
                // Delegate each detected agent to a per-pane monitor thread.
                // This avoids blocking the scan loop: all agents are tracked in parallel,
                // and watch_agent_pane's dedup (ACTIVE_MONITORS) prevents double-monitoring.
                for pane in agents {
                    // Skip if already being monitored (per-pane or prior detection)
                    {
                        if let Ok(guard) = active_monitors() {
                            if let Some(set) = guard.as_ref() {
                                let pane_key = (session_name.to_string(), pane.pane_id.clone());
                                if set.contains(&pane_key) {
                                    continue;
                                }
                            }
                        }
                    }

                    info!(
                        "Session monitor: delegating {} in {}:{} pane {} to pane monitor",
                        pane.agent_type.display_name(),
                        session_name,
                        pane.window_name,
                        pane.pane_id
                    );

                    // Spawn a dedicated pane monitor thread for this exact pane.
                    // Pass the known agent_type so run_monitor doesn't re-detect
                    // (re-detection via pgrep can misidentify when multiple agent
                    // tokens appear in child process command lines).
                    watch_agent_pane(
                        app_handle.clone(),
                        session_name.to_string(),
                        pane.window_name,
                        pane.pane_id,
                        pane.pane_index,
                        project_path.to_string(),
                        pane.agent_type,
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

fn emit_synthetic_event(
    app: &tauri::AppHandle,
    project_path: &str,
    meta: &SyntheticAgentMeta,
    event_type: &str,
    message: Option<&str>,
) {
    let hook_event = HookEvent {
        project_path: project_path.to_string(),
        event_type: event_type.to_string(),
        payload: meta.payload(message),
        timestamp: chrono::Utc::now().to_rfc3339(),
    };

    if let Err(e) = app.emit("notification:hook-received", &hook_event) {
        warn!("Failed to emit synthetic {} event: {}", event_type, e);
    }
}
