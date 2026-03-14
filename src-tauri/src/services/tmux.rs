use crate::errors::AppError;
use crate::models::tmux::{KillAllResult, KillFailure, ProjectTmuxSession, SessionInfo, TmuxPane, TmuxSession, TmuxWindow};
use rusqlite::{params, Connection};
use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::process::Command;
use std::sync::OnceLock;
use std::thread;
use std::time::Duration;
use tracing::{info, warn};
use uuid::Uuid;

/// Well-known paths where tmux may be installed on macOS.
/// Checked in order: Apple Silicon Homebrew, Intel Homebrew, MacPorts, Nix, system.
const TMUX_SEARCH_PATHS: &[&str] = &[
    "/opt/homebrew/bin/tmux",
    "/usr/local/bin/tmux",
    "/opt/local/bin/tmux",
    "/nix/var/nix/profiles/default/bin/tmux",
    "/usr/bin/tmux",
];

/// Cached absolute path to the tmux binary.
static TMUX_PATH: OnceLock<Option<String>> = OnceLock::new();

/// Resolve the absolute path to the tmux binary.
/// First checks well-known paths, then falls back to `which tmux`.
/// The result is cached for the lifetime of the process.
fn resolve_tmux_path() -> Option<&'static str> {
    TMUX_PATH
        .get_or_init(|| {
            // 1. Check well-known paths (works even when PATH is minimal in .app bundles)
            for candidate in TMUX_SEARCH_PATHS {
                if Path::new(candidate).is_file() {
                    info!("tmux binary found at: {}", candidate);
                    return Some(candidate.to_string());
                }
            }

            // 2. Fallback: try `which tmux` in case PATH includes a custom location
            if let Ok(output) = Command::new("which").arg("tmux").output() {
                if output.status.success() {
                    let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
                    if !path.is_empty() && Path::new(&path).is_file() {
                        info!("tmux binary found via which: {}", path);
                        return Some(path);
                    }
                }
            }

            warn!("tmux binary not found in any known location");
            None
        })
        .as_deref()
}

/// Create a `Command` pre-configured with the resolved tmux absolute path.
/// Falls back to bare "tmux" (relying on PATH) if no known location is found.
fn tmux_cmd() -> Command {
    Command::new(resolve_tmux_path().unwrap_or("tmux"))
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DetectedAgentPane {
    pub window_name: String,
    /// Stable tmux window identifier (e.g. `@7`), immune to automatic-rename.
    pub window_id: String,
    pub pane_id: String,
    pub pane_index: String,
    pub pane_pid: String,
    pub agent_type: crate::models::agent_type::AgentType,
}

fn is_missing_tmux_target(stderr: &str) -> bool {
    stderr.contains("can't find window")
        || stderr.contains("can't find pane")
        || stderr.contains("can't find session")
        || stderr.contains("session not found")
        || stderr.contains("no server running")
}

/// Check if any pane in the target window is running a process matching the given names.
/// Useful for detecting agents that don't support hooks (e.g., Codex CLI, Gemini CLI)
/// where activity must be inferred from process presence.
///
/// Returns `Ok(true)` if a matching process is found, `Ok(false)` if no match,
/// or `Err` if the tmux query itself failed (binary missing, session gone, etc.).
pub fn is_process_running_in_window(
    session_name: &str,
    window_name: &str,
    process_names: &[&str],
) -> Result<bool, crate::errors::AppError> {
    let target = format!("{}:{}", session_name, window_name);
    let output = tmux_cmd()
        .args(["list-panes", "-t", &target, "-F", "#{pane_current_command}"])
        .output()
        .map_err(|e| crate::errors::AppError::TmuxCommand(format!(
            "Failed to execute tmux list-panes for {}: {}", target, e
        )))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        // Window/session not found means the pane is gone — agent exited
        if stderr.contains("can't find window")
            || stderr.contains("can't find session")
            || stderr.contains("session not found")
            || stderr.contains("no server running")
        {
            return Ok(false);
        }
        return Err(crate::errors::AppError::TmuxCommand(format!(
            "tmux list-panes failed for {}: {}", target, stderr.trim()
        )));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    Ok(stdout.lines().any(|cmd| {
        process_names.iter().any(|name| cmd.contains(name))
    }))
}

/// Match an agent type from a process name or executable path.
/// Uses exact-match on the basename (not substring) to avoid false positives
/// like paths containing "codex" (e.g. `/home/user/codex-project/script.sh`).
fn match_agent_from_name(name: &str) -> Option<crate::models::agent_type::AgentType> {
    use crate::models::agent_type::AgentType;
    // Extract basename from possible path (e.g. "/usr/local/bin/claude" → "claude")
    let basename = name.rsplit('/').next().unwrap_or(name);
    let lower = basename.to_lowercase();
    if lower == "claude" || lower.starts_with("claude-") {
        Some(AgentType::ClaudeCode)
    } else if lower == "codex" || lower.starts_with("codex-") {
        Some(AgentType::CodexCli)
    } else if lower == "gemini" || lower.starts_with("gemini-") {
        Some(AgentType::GeminiCli)
    } else {
        None
    }
}

/// Match agent from a pgrep -fl output line.
/// Format: "<pid> <executable> [args...]"
/// Scans all tokens (executable + arguments) to handle Node.js wrappers with
/// intermediate flags like `node --no-warnings=DEP0040 /usr/local/bin/gemini`.
fn match_agent_from_pgrep_line(line: &str) -> Option<crate::models::agent_type::AgentType> {
    let parts: Vec<&str> = line.split_whitespace().collect();
    if parts.len() < 2 {
        return None;
    }
    // Scan all parts after PID: executable, flags, script path, arguments
    for part in &parts[1..] {
        if let Some(agent) = match_agent_from_name(part) {
            return Some(agent);
        }
    }
    None
}

fn detect_agent_for_command_and_pid(
    pane_current_command: &str,
    pane_pid: &str,
) -> Option<crate::models::agent_type::AgentType> {
    if let Some(agent) = match_agent_from_name(pane_current_command) {
        return Some(agent);
    }

    let pgrep_output = Command::new("pgrep")
        .args(["-fl", "-P", pane_pid])
        .output()
        .ok()?;

    if !pgrep_output.status.success() {
        return None;
    }

    let children = String::from_utf8_lossy(&pgrep_output.stdout);
    for child_line in children.lines() {
        if let Some(agent) = match_agent_from_pgrep_line(child_line) {
            return Some(agent);
        }
    }

    None
}

/// Detect which agent (if any) is running in an exact tmux pane.
/// Returns `(AgentType, pane_pid_string)` so callers can use the PID for
/// process-tree inspection without a second tmux query.
///
/// The pane target can be a pane id (e.g. "%12") or a traditional tmux target.
/// Errors from child-process inspection are treated as "not found" so polling can
/// continue without flapping on transient OS/process lookup failures.
pub fn detect_agent_in_pane(
    pane_target: &str,
) -> Result<Option<(crate::models::agent_type::AgentType, String)>, crate::errors::AppError> {
    let output = tmux_cmd()
        .args([
            "list-panes",
            "-t",
            pane_target,
            "-F",
            "#{pane_current_command}|#{pane_pid}",
        ])
        .output()
        .map_err(|e| crate::errors::AppError::TmuxCommand(format!(
            "Failed to execute tmux list-panes for {}: {}", pane_target, e
        )))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        if is_missing_tmux_target(stderr.as_ref()) {
            return Ok(None);
        }
        return Err(crate::errors::AppError::TmuxCommand(format!(
            "tmux list-panes failed for {}: {}",
            pane_target,
            stderr.trim()
        )));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    for line in stdout.lines() {
        let Some((cmd, pid)) = line.split_once('|') else {
            continue;
        };
        if let Some(agent) = detect_agent_for_command_and_pid(cmd, pid) {
            return Ok(Some((agent, pid.to_string())));
        }
    }

    Ok(None)
}

/// Deprecated: terminal-output fingerprinting conflates agent output with user typing.
/// Replaced by `snapshot_agent_activity` which uses process tree inspection.
#[allow(dead_code)]
pub fn capture_pane_fingerprint(
    pane_target: &str,
) -> Result<Option<String>, crate::errors::AppError> {
    let output = tmux_cmd()
        .args([
            "display-message", "-p", "-t", pane_target,
            "#{history_size}|#{pane_dead}",
        ])
        .output()
        .map_err(|e| crate::errors::AppError::TmuxCommand(format!(
            "Failed to execute tmux display-message for {}: {}", pane_target, e
        )))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        if is_missing_tmux_target(stderr.as_ref()) {
            return Ok(None);
        }
        return Err(crate::errors::AppError::TmuxCommand(format!(
            "tmux display-message failed for {}: {}", pane_target, stderr.trim()
        )));
    }
    let meta = String::from_utf8_lossy(&output.stdout);
    Ok(Some(meta.trim().to_string()))
}

/// Capture the visible content of a tmux pane as a raw string.
///
/// Returns `Ok(Some(content))` on success, `Ok(None)` if the pane no longer exists.
/// Callers can compute hashes or search for patterns in the returned content.
pub fn capture_pane_content(pane_target: &str) -> Result<Option<String>, AppError> {
    let output = tmux_cmd()
        .args(["capture-pane", "-p", "-t", pane_target])
        .output()
        .map_err(|e| AppError::TmuxCommand(format!(
            "Failed to execute tmux capture-pane for {}: {}", pane_target, e
        )))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        if is_missing_tmux_target(stderr.as_ref()) {
            return Ok(None);
        }
        return Err(AppError::TmuxCommand(format!(
            "tmux capture-pane failed for {}: {}", pane_target, stderr.trim()
        )));
    }

    Ok(Some(String::from_utf8_lossy(&output.stdout).to_string()))
}

/// Query the current history_size of a tmux pane.
///
/// Returns `Ok(Some(n))` on success, `Ok(None)` if the pane no longer exists,
/// or an `Err` on tmux command failure.
#[allow(dead_code)]
pub fn get_pane_history_size(pane_target: &str) -> Result<Option<u64>, AppError> {
    let output = tmux_cmd()
        .args([
            "display-message", "-p", "-t", pane_target,
            "#{history_size}",
        ])
        .output()
        .map_err(|e| AppError::TmuxCommand(format!(
            "Failed to execute tmux display-message for {}: {}", pane_target, e
        )))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        if is_missing_tmux_target(stderr.as_ref()) {
            return Ok(None);
        }
        return Err(AppError::TmuxCommand(format!(
            "tmux display-message failed for {}: {}", pane_target, stderr.trim()
        )));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let size = stdout.trim().parse::<u64>().unwrap_or(0);
    Ok(Some(size))
}

// ---------------------------------------------------------------------------
// Process-tree based activity detection (replaces fingerprint)
// ---------------------------------------------------------------------------

/// Agent PID and type, extracted from a pane's child process tree.
pub struct AgentPidInfo {
    pub pid: u32,
    pub agent_type: crate::models::agent_type::AgentType,
}

/// Snapshot of an agent's process tree for working/idle detection.
pub struct AgentActivitySnapshot {
    pub agent_pid: u32,
    pub descendant_count: usize,
}

/// Locate the agent process inside a pane by inspecting child processes.
/// Returns the agent PID and type if found.
pub fn find_agent_pid_in_pane(pane_pid: &str) -> Option<AgentPidInfo> {
    let pgrep_output = Command::new("pgrep")
        .args(["-fl", "-P", pane_pid])
        .output()
        .ok()?;

    if !pgrep_output.status.success() {
        return None;
    }

    let children = String::from_utf8_lossy(&pgrep_output.stdout);
    for child_line in children.lines() {
        let parts: Vec<&str> = child_line.split_whitespace().collect();
        if parts.is_empty() {
            continue;
        }
        let child_pid: u32 = match parts[0].parse() {
            Ok(p) => p,
            Err(_) => continue,
        };

        // Check executable name (parts[1]) and first argument (parts[2])
        if let Some(agent_type) = match_agent_from_pgrep_line(child_line) {
            return Some(AgentPidInfo { pid: child_pid, agent_type });
        }

        // Recurse one level deeper for Node.js wrappers: zsh → node → codex-native
        if let Some(nested) = find_agent_pid_in_pane(&child_pid.to_string()) {
            return Some(nested);
        }
    }

    None
}

/// Kill the agent process running in a tmux pane (if any), then clean up
/// orphaned child processes (e.g. MCP servers).
///
/// Returns `Ok(Some(pid))` with the terminated agent PID on success,
/// `Ok(None)` if no agent was found in the pane.
/// The tmux pane itself is preserved — only processes are terminated.
pub fn kill_agent_in_pane(pane_id: &str) -> Result<Option<u32>, AppError> {
    // 1. Detect agent existence and get the pane's shell PID
    let (_agent_type, pane_pid) = match detect_agent_in_pane(pane_id)? {
        Some(pair) => pair,
        None => return Ok(None),
    };

    // 2. Find the exact agent PID via process tree inspection
    let agent_info = match find_agent_pid_in_pane(&pane_pid) {
        Some(info) => info,
        None => return Ok(None),
    };

    let agent_pid = agent_info.pid;

    // 3. Collect child PIDs (MCP servers) BEFORE killing the agent.
    //    Claude Code does not reliably clean up MCP server children on SIGTERM
    //    (see: github.com/anthropics/claude-code/issues/1935).
    let child_pids = collect_child_pids(agent_pid);

    // 4. Send SIGTERM to the agent — give it a chance to clean up gracefully
    match Command::new("kill")
        .arg("-TERM")
        .arg(agent_pid.to_string())
        .output()
    {
        Ok(output) if output.status.success() => {
            tracing::info!("Sent SIGTERM to idle agent (PID {}) in pane {}", agent_pid, pane_id);
        }
        Ok(_) => {
            tracing::info!("SIGTERM for agent PID {} returned non-zero (likely already exited)", agent_pid);
        }
        Err(e) => {
            tracing::error!("Failed to kill agent PID {}: {}", agent_pid, e);
            return Err(AppError::TmuxCommand(format!(
                "Failed to send SIGTERM to agent PID {}: {}", agent_pid, e
            )));
        }
    }

    // 5. Brief pause to let the agent's own cleanup handlers run
    std::thread::sleep(std::time::Duration::from_millis(200));

    // 6. Kill any remaining child processes (orphaned MCP servers)
    for child_pid in &child_pids {
        let _ = Command::new("kill")
            .arg("-TERM")
            .arg(child_pid.to_string())
            .output();
    }

    if !child_pids.is_empty() {
        tracing::info!(
            "Sent SIGTERM to {} orphaned children of agent PID {}: {:?}",
            child_pids.len(), agent_pid, child_pids
        );
    }

    Ok(Some(agent_pid))
}

/// Collect all direct child PIDs of a process via `pgrep -P`.
fn collect_child_pids(parent_pid: u32) -> Vec<u32> {
    let output = match Command::new("pgrep")
        .args(["-P", &parent_pid.to_string()])
        .output()
    {
        Ok(o) if o.status.success() => o,
        _ => return Vec::new(),
    };

    String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter_map(|line| line.trim().parse::<u32>().ok())
        .collect()
}

/// Count all descendant processes of `root_pid` using a single `ps` call.
///
/// Fetches the full system (pid, ppid) table, builds a parent→children map,
/// then walks the subtree from `root_pid`. Runs in microseconds on typical
/// macOS systems (~800 processes).
pub fn count_descendant_processes(root_pid: u32) -> Result<usize, AppError> {
    let output = Command::new("ps")
        .args(["-ax", "-o", "pid=,ppid="])
        .output()
        .map_err(|e| AppError::TmuxCommand(format!("Failed to execute ps: {}", e)))?;

    if !output.status.success() {
        return Err(AppError::TmuxCommand("ps -ax failed".to_string()));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut children_map: HashMap<u32, Vec<u32>> = HashMap::new();

    for line in stdout.lines() {
        let trimmed = line.trim();
        let mut parts = trimmed.split_whitespace();
        let pid: u32 = match parts.next().and_then(|s| s.parse().ok()) {
            Some(p) => p,
            None => continue,
        };
        let ppid: u32 = match parts.next().and_then(|s| s.parse().ok()) {
            Some(p) => p,
            None => continue,
        };
        children_map.entry(ppid).or_default().push(pid);
    }

    // BFS from root_pid
    let mut count = 0usize;
    let mut queue = std::collections::VecDeque::new();
    if let Some(kids) = children_map.get(&root_pid) {
        queue.extend(kids);
    }
    while let Some(pid) = queue.pop_front() {
        count += 1;
        if let Some(kids) = children_map.get(&pid) {
            queue.extend(kids);
        }
    }

    Ok(count)
}

/// Snapshot the agent's process tree for working/idle detection.
///
/// Locates the agent process inside the pane via `find_agent_pid_in_pane`,
/// then counts all its descendants via `count_descendant_processes`.
/// Returns `Ok(None)` if the agent process is no longer present.
pub fn snapshot_agent_activity(
    pane_pid: &str,
) -> Result<Option<AgentActivitySnapshot>, AppError> {
    let info = match find_agent_pid_in_pane(pane_pid) {
        Some(i) => i,
        None => return Ok(None),
    };

    let descendant_count = count_descendant_processes(info.pid)?;

    Ok(Some(AgentActivitySnapshot {
        agent_pid: info.pid,
        descendant_count,
    }))
}

/// Resolve the primary pane id for a window.
///
/// This is used for windows spawned by the app itself, where the initial agent
/// always starts in the first pane.
pub fn find_primary_pane_id(
    session_name: &str,
    window_name: &str,
) -> Result<Option<String>, AppError> {
    let target = format!("{}:{}", session_name, window_name);
    let output = tmux_cmd()
        .args([
            "list-panes",
            "-t",
            &target,
            "-F",
            "#{pane_index}|#{pane_id}",
        ])
        .output()
        .map_err(|e| AppError::TmuxCommand(format!(
            "Failed to execute tmux list-panes for {}: {}", target, e
        )))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        if is_missing_tmux_target(stderr.as_ref()) {
            return Ok(None);
        }
        return Err(AppError::TmuxCommand(format!(
            "tmux list-panes failed for {}: {}",
            target,
            stderr.trim()
        )));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut panes: Vec<(u32, String)> = stdout
        .lines()
        .filter_map(|line| {
            let (idx, pane_id) = line.split_once('|')?;
            let idx = idx.parse::<u32>().ok()?;
            Some((idx, pane_id.to_string()))
        })
        .collect();
    panes.sort_by_key(|(idx, _)| *idx);
    Ok(panes.into_iter().next().map(|(_, pane_id)| pane_id))
}

/// Detect agents across ALL panes in a tmux session.
/// Returns one entry per pane so sibling panes no longer mask each other.
/// Only returns non-Claude agents by default (Claude uses hooks).
pub fn detect_agents_in_session(
    session_name: &str,
    include_claude: bool,
) -> Result<Vec<DetectedAgentPane>, crate::errors::AppError> {
    let output = tmux_cmd()
        .args([
            "list-panes",
            "-s",
            "-t",
            session_name,
            "-F",
            "#{window_name}|#{window_id}|#{pane_id}|#{pane_index}|#{pane_current_command}|#{pane_pid}",
        ])
        .output()
        .map_err(|e| crate::errors::AppError::TmuxCommand(format!(
            "Failed to list session panes for {}: {}", session_name, e
        )))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        // Propagate session-not-found as Err so callers (e.g. run_session_monitor)
        // can distinguish "session gone" from "no agents found".
        return Err(crate::errors::AppError::TmuxCommand(format!(
            "tmux list-panes -s failed for {}: {}", session_name, stderr.trim()
        )));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut results: Vec<DetectedAgentPane> = Vec::new();
    for line in stdout.lines() {
        let parts: Vec<&str> = line.splitn(6, '|').collect();
        if parts.len() < 6 {
            continue;
        }
        let window_name = parts[0].to_string();
        let window_id = parts[1].to_string();
        let pane_id = parts[2].to_string();
        let pane_index = parts[3].to_string();
        let cmd = parts[4];
        let pid = parts[5];

        if let Some(agent) = detect_agent_for_command_and_pid(cmd, pid) {
            // Skip agents with complete hook-based detection (Claude, Gemini).
            // Only agents without full hook support (Codex) need pane monitoring.
            if include_claude || !agent.supports_hooks() {
                results.push(DetectedAgentPane {
                    window_name,
                    window_id,
                    pane_id,
                    pane_index,
                    pane_pid: pid.to_string(),
                    agent_type: agent,
                });
            }
        }
    }

    Ok(results)
}

/// Check if tmux binary is available on the system.
/// Retries up to 3 times with 1-second intervals.
pub fn is_tmux_available() -> bool {
    for attempt in 1..=3 {
        if resolve_tmux_path().is_some() {
            info!("tmux binary found");
            return true;
        }
        warn!("tmux not found (attempt {}/3)", attempt);
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
    let output = tmux_cmd()
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

    let output = tmux_cmd()
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

/// Run a non-fatal tmux command: IO errors propagate, but non-zero exit only logs a warning.
/// Used for non-critical session configuration that shouldn't abort session creation.
fn run_tmux_nonfatal(args: &[&str], context: &str, session_name: &str) -> Result<(), AppError> {
    let output = tmux_cmd()
        .args(args)
        .output()
        .map_err(|e| AppError::TmuxCommand(format!("Failed to {}: {}", context, e)))?;

    if !output.status.success() {
        warn!(
            "Failed to {} for session '{}': {}",
            context,
            session_name,
            String::from_utf8_lossy(&output.stderr).trim()
        );
    }
    Ok(())
}

/// Create a new detached tmux session with the given name and dimensions.
pub fn create_session(name: &str, cols: u16, rows: u16) -> Result<(), AppError> {
    validate_session_name(name)?;

    let output = tmux_cmd()
        .args([
            "new-session",
            "-d",
            "-s",
            name,
            "-x",
            &cols.to_string(),
            "-y",
            &rows.to_string(),
        ])
        .output()
        .map_err(|e| {
            AppError::TmuxCommand(format!("Failed to execute tmux new-session: {}", e))
        })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::TmuxCommand(format!(
            "tmux new-session failed: {}",
            stderr.trim()
        )));
    }

    // Enable mouse mode so tmux intercepts mouse events within pane boundaries.
    run_tmux_nonfatal(
        &["set-option", "-t", name, "mouse", "on"],
        "enable mouse mode", name,
    )?;

    // Enable OSC 52 clipboard so tmux sends clipboard data to the terminal.
    // NOTE: set-clipboard must be on for copy commands to emit OSC 52.
    run_tmux_nonfatal(
        &["set-option", "-t", name, "set-clipboard", "on"],
        "enable set-clipboard", name,
    )?;

    // Enable true color (24-bit RGB) passthrough: tmux 3.2+
    run_tmux_nonfatal(
        &["set-option", "-as", "terminal-features", ",xterm-256color:RGB"],
        "set terminal-features RGB", name,
    )?;

    // MouseDown1Pane: focus clicked pane + clear selection (preserve scroll position for drag).
    // NOTE: These copy-mode bindings are also configured in
    // src/features/terminal/hooks/useTerminal.ts and ssh.rs build_remote_tmux_command().
    // Keep all three in sync.
    for table in &["copy-mode", "copy-mode-vi"] {
        run_tmux_nonfatal(
            &["bind-key", "-T", table, "MouseDown1Pane",
              "select-pane", "-t", "=", "\\;", "send-keys", "-X", "clear-selection"],
            &format!("bind MouseDown1Pane ({})", table), name,
        )?;
    }

    // MouseUp1Pane: exit copy mode on simple click (does not fire after drag).
    for table in &["copy-mode", "copy-mode-vi"] {
        run_tmux_nonfatal(
            &["bind-key", "-T", table, "MouseUp1Pane",
              "send-keys", "-X", "cancel"],
            &format!("bind MouseUp1Pane ({})", table), name,
        )?;
    }

    // MouseDragEnd1Pane: copy text to tmux paste buffer, emit OSC 52
    // (because set-clipboard is on), then exit copy mode to clear cursor remnant.
    for table in &["copy-mode", "copy-mode-vi"] {
        run_tmux_nonfatal(
            &["bind-key", "-T", table, "MouseDragEnd1Pane", "send-keys", "-X", "copy-selection-and-cancel"],
            &format!("bind MouseDragEnd1Pane ({})", table), name,
        )?;
    }

    // Cancel copy mode on the previously-active pane when switching panes.
    run_tmux_nonfatal(
        &["set-hook", "-t", name, "window-pane-changed", "send-keys -t '{last}' -X cancel"],
        "set window-pane-changed hook", name,
    )?;

    info!("Created tmux session '{}' ({}x{})", name, cols, rows);
    Ok(())
}

/// Kill (terminate) a tmux session by name.
pub fn kill_session(name: &str) -> Result<(), AppError> {
    validate_session_name(name)?;

    let output = tmux_cmd()
        .args(["kill-session", "-t", name])
        .output()
        .map_err(|e| {
            AppError::TmuxCommand(format!("Failed to execute tmux kill-session: {}", e))
        })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        // Session already gone is not an error
        if stderr.contains("can't find session")
            || stderr.contains("no server running")
            || stderr.contains("session not found")
            || stderr.contains("error connecting")
        {
            info!("tmux session '{}' already terminated", name);
            return Ok(());
        }
        return Err(AppError::TmuxCommand(format!(
            "tmux kill-session failed: {}",
            stderr.trim()
        )));
    }

    info!("Killed tmux session '{}'", name);
    Ok(())
}

/// Split the active pane horizontally (top/bottom) in the given session.
/// Uses tmux `split-window -v` (vertical split line = horizontal layout).
pub fn split_pane_horizontal(session_name: &str) -> Result<(), AppError> {
    validate_session_name(session_name)?;
    let output = tmux_cmd()
        .args(["split-window", "-v", "-t", session_name, "-c", "#{pane_current_path}"])
        .output()
        .map_err(|e| {
            AppError::TmuxCommand(format!("Failed to execute tmux split-window: {}", e))
        })?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::TmuxCommand(format!(
            "tmux split-window -v failed: {}",
            stderr.trim()
        )));
    }
    info!("Split pane horizontally in session '{}'", session_name);
    Ok(())
}

/// Split the active pane vertically (left/right) in the given session.
/// Uses tmux `split-window -h` (horizontal split line = vertical layout).
pub fn split_pane_vertical(session_name: &str) -> Result<(), AppError> {
    validate_session_name(session_name)?;
    let output = tmux_cmd()
        .args(["split-window", "-h", "-t", session_name, "-c", "#{pane_current_path}"])
        .output()
        .map_err(|e| {
            AppError::TmuxCommand(format!("Failed to execute tmux split-window: {}", e))
        })?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::TmuxCommand(format!(
            "tmux split-window -h failed: {}",
            stderr.trim()
        )));
    }
    info!("Split pane vertically in session '{}'", session_name);
    Ok(())
}

/// Close the active pane in the given session.
/// Safety: refuses to close the last remaining pane (returns Ok silently).
pub fn close_pane(session_name: &str) -> Result<(), AppError> {
    validate_session_name(session_name)?;
    let panes = list_panes(session_name)?;
    if panes.len() <= 1 {
        info!(
            "Only {} pane(s) in '{}', skipping close",
            panes.len(),
            session_name
        );
        return Ok(());
    }
    let output = tmux_cmd()
        .args(["kill-pane", "-t", session_name])
        .output()
        .map_err(|e| {
            AppError::TmuxCommand(format!("Failed to execute tmux kill-pane: {}", e))
        })?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        if stderr.contains("can't find pane") || stderr.contains("no server running") {
            return Ok(());
        }
        return Err(AppError::TmuxCommand(format!(
            "tmux kill-pane failed: {}",
            stderr.trim()
        )));
    }
    info!("Closed active pane in session '{}'", session_name);
    Ok(())
}

// ---------------------------------------------------------------------------
// Send keys
// ---------------------------------------------------------------------------

/// Send keys (text) to the active pane of a tmux session.
/// Appends an "Enter" key press automatically.
pub fn send_keys(session_name: &str, keys: &str) -> Result<(), AppError> {
    validate_session_name(session_name)?;
    if keys.is_empty() {
        return Err(AppError::InvalidInput("Keys cannot be empty".into()));
    }
    let output = tmux_cmd()
        .args(["send-keys", "-t", session_name, keys, "Enter"])
        .output()
        .map_err(|e| AppError::TmuxCommand(format!("Failed to execute tmux send-keys: {}", e)))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::TmuxCommand(format!(
            "tmux send-keys failed: {}",
            stderr.trim()
        )));
    }
    info!("Sent keys to session '{}'", session_name);
    Ok(())
}

// ---------------------------------------------------------------------------
// Window management
// ---------------------------------------------------------------------------

/// List all windows in a given tmux session.
pub fn list_windows(session_name: &str) -> Result<Vec<TmuxWindow>, AppError> {
    validate_session_name(session_name)?;

    let output = tmux_cmd()
        .args([
            "list-windows",
            "-t",
            session_name,
            "-F",
            "#{session_name}|#{window_index}|#{window_name}|#{window_active}|#{window_panes}",
        ])
        .output();

    let output = match output {
        Ok(o) => o,
        Err(e) => {
            if e.kind() == std::io::ErrorKind::NotFound {
                info!("tmux binary not found, returning empty window list");
                return Ok(Vec::new());
            }
            return Err(AppError::TmuxCommand(format!(
                "Failed to execute tmux list-windows: {}",
                e
            )));
        }
    };

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        if stderr.contains("can't find session")
            || stderr.contains("no server running")
            || stderr.contains("session not found")
        {
            info!(
                "tmux session '{}' not found, returning empty window list",
                session_name
            );
            return Ok(Vec::new());
        }
        return Err(AppError::TmuxCommand(format!(
            "tmux list-windows failed: {}",
            stderr.trim()
        )));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let windows = stdout
        .lines()
        .filter(|line| !line.is_empty())
        .filter_map(parse_window_line)
        .collect();

    Ok(windows)
}

/// Create a new window in the given tmux session.
pub fn create_window(session_name: &str) -> Result<(), AppError> {
    validate_session_name(session_name)?;

    let output = tmux_cmd()
        .args(["new-window", "-t", session_name, "-c", "#{pane_current_path}"])
        .output()
        .map_err(|e| {
            AppError::TmuxCommand(format!("Failed to execute tmux new-window: {}", e))
        })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::TmuxCommand(format!(
            "tmux new-window failed: {}",
            stderr.trim()
        )));
    }

    info!("Created new window in session '{}'", session_name);
    Ok(())
}

/// Close the active window in the given session.
/// Safety: refuses to close the last remaining window (returns Ok silently).
pub fn close_window(session_name: &str) -> Result<(), AppError> {
    validate_session_name(session_name)?;

    let windows = list_windows(session_name)?;
    if windows.len() <= 1 {
        info!(
            "Only {} window(s) in '{}', skipping close",
            windows.len(),
            session_name
        );
        return Ok(());
    }

    let output = tmux_cmd()
        .args(["kill-window", "-t", session_name])
        .output()
        .map_err(|e| {
            AppError::TmuxCommand(format!("Failed to execute tmux kill-window: {}", e))
        })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        if stderr.contains("can't find window") || stderr.contains("no server running") {
            return Ok(());
        }
        return Err(AppError::TmuxCommand(format!(
            "tmux kill-window failed: {}",
            stderr.trim()
        )));
    }

    info!("Closed active window in session '{}'", session_name);
    Ok(())
}

/// Create a new named window with a specific working directory.
pub fn create_window_named(
    session_name: &str,
    window_name: &str,
    cwd: &str,
) -> Result<(), AppError> {
    validate_session_name(session_name)?;
    validate_session_name(window_name)?; // same charset rules

    let target = format!("{}:", session_name);
    let output = tmux_cmd()
        .args(["new-window", "-t", &target, "-n", window_name, "-c", cwd])
        .output()
        .map_err(|e| {
            AppError::TmuxCommand(format!("Failed to execute tmux new-window: {}", e))
        })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::TmuxCommand(format!(
            "tmux new-window (named) failed: {}",
            stderr.trim()
        )));
    }

    info!(
        "Created named window '{}' in session '{}' (cwd={})",
        window_name, session_name, cwd
    );
    Ok(())
}

/// Select (switch to) a specific window by name or index.
pub fn select_window(session_name: &str, window_target: &str) -> Result<(), AppError> {
    validate_session_name(session_name)?;

    let target = format!("{}:{}", session_name, window_target);
    let output = tmux_cmd()
        .args(["select-window", "-t", &target])
        .output()
        .map_err(|e| {
            AppError::TmuxCommand(format!("Failed to execute tmux select-window: {}", e))
        })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::TmuxCommand(format!(
            "tmux select-window failed: {}",
            stderr.trim()
        )));
    }

    info!(
        "Selected window '{}' in session '{}'",
        window_target, session_name
    );
    Ok(())
}

/// Send keys to a specific named window (not the active one).
pub fn send_keys_to_window(
    session_name: &str,
    window_name: &str,
    keys: &str,
) -> Result<(), AppError> {
    validate_session_name(session_name)?;
    validate_session_name(window_name)?;
    if keys.is_empty() {
        return Err(AppError::InvalidInput("Keys cannot be empty".into()));
    }

    let target = format!("{}:{}", session_name, window_name);
    let output = tmux_cmd()
        .args(["send-keys", "-t", &target, keys, "Enter"])
        .output()
        .map_err(|e| {
            AppError::TmuxCommand(format!("Failed to execute tmux send-keys: {}", e))
        })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::TmuxCommand(format!(
            "tmux send-keys (window) failed: {}",
            stderr.trim()
        )));
    }

    info!(
        "Sent keys to window '{}' in session '{}'",
        window_name, session_name
    );
    Ok(())
}

/// Check if a string looks like a semver version (e.g. "2.1.50", "3.0.0").
/// Claude Code's native binary reports its version as `pane_current_command`.
fn is_semver_like(s: &str) -> bool {
    let parts: Vec<&str> = s.split('.').collect();
    parts.len() >= 2 && parts.iter().all(|p| !p.is_empty() && p.chars().all(|c| c.is_ascii_digit()))
}

/// Find the tmux pane target where an AI agent is running in a given window.
///
/// Strategy (triple fallback):
/// 1. Search for a pane whose `pane_current_command` contains agent process name
/// 2. If not found (agent may be executing a tool), target pane 0
///    (agents are always launched in pane 0 by `start_worktree_task`)
/// 3. If pane query fails entirely, fall back to `session:window` (active pane)
fn find_agent_pane_target(session_name: &str, window_name: &str, agent_type: Option<crate::models::agent_type::AgentType>) -> String {
    let base = format!("{}:{}", session_name, window_name);

    let output = tmux_cmd()
        .args([
            "list-panes",
            "-t",
            &base,
            "-F",
            "#{pane_index}|#{pane_current_command}",
        ])
        .output();

    if let Ok(out) = output {
        if out.status.success() {
            let stdout = String::from_utf8_lossy(&out.stdout);
            let lines: Vec<&str> = stdout.lines().filter(|l| !l.is_empty()).collect();
            info!("find_claude_pane_target: base='{}', panes={:?}", base, lines);

            // 1st: find the pane running the agent's process
            for line in &lines {
                if let Some((idx, cmd)) = line.split_once('|') {
                    let is_agent = if let Some(agent) = agent_type {
                        // Match against the specific agent's process names
                        agent.process_names().iter().any(|name| cmd.contains(name))
                            // Claude Code also shows version strings (e.g. "2.1.50")
                            || (agent == crate::models::agent_type::AgentType::ClaudeCode && is_semver_like(cmd))
                    } else {
                        // No agent type specified, match any known agent
                        cmd.contains("claude") || cmd.contains("codex") || cmd.contains("gemini")
                            || is_semver_like(cmd)
                    };
                    if is_agent {
                        let target = format!("{}.{}", base, idx);
                        info!("Found agent pane: target='{}', cmd='{}'", target, cmd);
                        return target;
                    }
                }
            }

            // 2nd: multiple panes but no agent found → target pane 0
            if lines.len() > 1 {
                let target = format!("{}.0", base);
                info!("Agent not detected by command; targeting pane 0: '{}'", target);
                return target;
            }
        } else {
            let stderr = String::from_utf8_lossy(&out.stderr);
            warn!("find_agent_pane_target: list-panes failed for '{}': {}", base, stderr.trim());
        }
    }

    // 3rd: single pane or query failed → active pane
    info!("find_agent_pane_target: using fallback target '{}'", base);
    base
}

/// Send keys to a named window with a delay before Enter to prevent race conditions.
/// This is the recommended pattern for sending prompts to interactive REPLs (e.g. AI agents).
/// Automatically finds the agent pane even when multiple panes exist.
pub fn send_keys_to_window_with_delay(
    session_name: &str,
    window_name: &str,
    keys: &str,
    agent_type: Option<crate::models::agent_type::AgentType>,
) -> Result<(), AppError> {
    info!(
        "send_keys_to_window_with_delay: session='{}', window='{}', keys_len={}",
        session_name, window_name, keys.len()
    );
    validate_session_name(session_name)?;
    validate_session_name(window_name)?;
    if keys.is_empty() {
        return Err(AppError::InvalidInput("Keys cannot be empty".into()));
    }

    let target = find_agent_pane_target(session_name, window_name, agent_type);
    info!("send_keys_to_window_with_delay: final target='{}'", target);

    // Step 1: Send the text (without Enter)
    let output = tmux_cmd()
        .args(["send-keys", "-t", &target, "-l", keys])
        .output()
        .map_err(|e| {
            AppError::TmuxCommand(format!("Failed to execute tmux send-keys: {}", e))
        })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::TmuxCommand(format!(
            "tmux send-keys (text) failed: {}",
            stderr.trim()
        )));
    }

    // Step 2: Brief delay to let the REPL process the input.
    // Safe: this is a sync Tauri command, runs on the IPC threadpool (not main thread).
    std::thread::sleep(std::time::Duration::from_millis(100));

    // Step 3: Send Enter separately
    let output = tmux_cmd()
        .args(["send-keys", "-t", &target, "Enter"])
        .output()
        .map_err(|e| {
            AppError::TmuxCommand(format!("Failed to execute tmux send-keys Enter: {}", e))
        })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::TmuxCommand(format!(
            "tmux send-keys (enter) failed: {}",
            stderr.trim()
        )));
    }

    info!(
        "Sent keys with delay to window '{}' in session '{}'",
        window_name, session_name
    );
    Ok(())
}

/// Close a specific named window. Silently succeeds if window not found.
pub fn close_window_by_name(session_name: &str, window_name: &str) -> Result<(), AppError> {
    validate_session_name(session_name)?;
    validate_session_name(window_name)?;

    let target = format!("{}:{}", session_name, window_name);
    let output = tmux_cmd()
        .args(["kill-window", "-t", &target])
        .output()
        .map_err(|e| {
            AppError::TmuxCommand(format!("Failed to execute tmux kill-window: {}", e))
        })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        if stderr.contains("can't find window") {
            return Ok(());
        }
        if stderr.contains("no server running") {
            warn!(
                "tmux server not running during window close for '{}:{}'",
                session_name, window_name
            );
            return Ok(());
        }
        return Err(AppError::TmuxCommand(format!(
            "tmux kill-window (named) failed: {}",
            stderr.trim()
        )));
    }

    info!(
        "Closed window '{}' in session '{}'",
        window_name, session_name
    );
    Ok(())
}

/// Switch to the next window in the given session (wraps around).
pub fn next_window(session_name: &str) -> Result<(), AppError> {
    validate_session_name(session_name)?;

    let output = tmux_cmd()
        .args(["next-window", "-t", session_name])
        .output()
        .map_err(|e| {
            AppError::TmuxCommand(format!("Failed to execute tmux next-window: {}", e))
        })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::TmuxCommand(format!(
            "tmux next-window failed: {}",
            stderr.trim()
        )));
    }

    Ok(())
}

/// Switch to the previous window in the given session (wraps around).
pub fn previous_window(session_name: &str) -> Result<(), AppError> {
    validate_session_name(session_name)?;

    let output = tmux_cmd()
        .args(["previous-window", "-t", session_name])
        .output()
        .map_err(|e| {
            AppError::TmuxCommand(format!("Failed to execute tmux previous-window: {}", e))
        })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::TmuxCommand(format!(
            "tmux previous-window failed: {}",
            stderr.trim()
        )));
    }

    Ok(())
}

// ---------------------------------------------------------------------------
// DB-backed session ownership
// ---------------------------------------------------------------------------

/// Register a tmux session as owned by a project.
pub fn register_session(
    conn: &Connection,
    project_id: &str,
    session_name: &str,
) -> Result<ProjectTmuxSession, AppError> {
    validate_session_name(session_name)?;

    let id = Uuid::new_v4().to_string();
    conn.execute(
        "INSERT OR REPLACE INTO project_tmux_sessions (id, project_id, session_name)
         VALUES (?1, ?2, ?3)",
        params![&id, project_id, session_name],
    )?;

    conn.query_row(
        "SELECT id, project_id, session_name, created_at
         FROM project_tmux_sessions WHERE id = ?1",
        [&id],
        |row| {
            Ok(ProjectTmuxSession {
                id: row.get(0)?,
                project_id: row.get(1)?,
                session_name: row.get(2)?,
                created_at: row.get(3)?,
            })
        },
    )
    .map_err(AppError::from)
}

/// Register session and return updated session list (single atomic operation).
/// Avoids double IPC round-trip (register → list).
pub fn register_session_and_list(
    conn: &Connection,
    project_id: &str,
    session_name: &str,
) -> Result<Vec<SessionInfo>, AppError> {
    register_session(conn, project_id, session_name)?;
    list_sessions_with_ownership(conn)
}

/// Unregister session and return updated session list (single atomic operation).
pub fn unregister_session_and_list(
    conn: &Connection,
    session_name: &str,
) -> Result<Vec<SessionInfo>, AppError> {
    unregister_session(conn, session_name)?;
    list_sessions_with_ownership(conn)
}

/// Unregister a tmux session from its project.
pub fn unregister_session(conn: &Connection, session_name: &str) -> Result<(), AppError> {
    validate_session_name(session_name)?;
    conn.execute(
        "DELETE FROM project_tmux_sessions WHERE session_name = ?1",
        [session_name],
    )?;
    Ok(())
}

/// List all sessions with ownership info (tmux CLI + DB join).
/// Also cleans up stale DB records for sessions no longer in tmux.
pub fn list_sessions_with_ownership(conn: &Connection) -> Result<Vec<SessionInfo>, AppError> {
    // 1. Live tmux sessions
    let tmux_sessions = list_sessions()?;

    // 2. All registered sessions from DB
    let mut stmt = conn.prepare(
        "SELECT session_name, project_id FROM project_tmux_sessions",
    )?;
    let db_sessions: HashMap<String, String> = stmt
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?
        .collect::<Result<_, _>>()?;

    // 3. Build live session name set for stale detection
    let live_session_names: HashSet<String> =
        tmux_sessions.iter().map(|s| s.name.clone()).collect();

    // 4. Combine: tag each tmux session with ownership
    let mut result = Vec::new();
    for session in tmux_sessions {
        let (is_app_session, project_id) = match db_sessions.get(&session.name) {
            Some(pid) => (true, Some(pid.clone())),
            None => (false, None),
        };
        result.push(SessionInfo {
            name: session.name,
            windows: session.windows,
            created: session.created,
            attached: session.attached,
            is_app_session,
            project_id,
        });
    }

    // 5. Cleanup stale DB records (in DB but not in tmux)
    for name in db_sessions.keys() {
        if !live_session_names.contains(name) {
            conn.execute(
                "DELETE FROM project_tmux_sessions WHERE session_name = ?1",
                [name],
            )?;
            info!("Cleaned up stale session record: {}", name);
        }
    }

    Ok(result)
}

/// Kill all app-managed sessions (registered in DB) in a single operation.
/// Returns the updated session list along with kill/failure counts.
pub fn kill_all_app_sessions(conn: &Connection) -> Result<KillAllResult, AppError> {
    // 1. Query registered session names from DB
    let mut stmt = conn.prepare("SELECT session_name FROM project_tmux_sessions")?;
    let app_session_names: Vec<String> = stmt
        .query_map([], |row| row.get(0))?
        .collect::<Result<_, _>>()?;

    // 2. Kill each session, partitioning results directly
    let mut killed_count: i32 = 0;
    let mut failed: Vec<KillFailure> = Vec::new();

    for name in app_session_names {
        match kill_session(&name) {
            Ok(()) => {
                killed_count += 1;
                if let Err(e) = unregister_session(conn, &name) {
                    warn!(
                        "Killed tmux session '{}' but failed to unregister from DB: {}. \
                         Will be cleaned up on next session list refresh.",
                        name, e
                    );
                }
            }
            Err(err) => {
                warn!("Failed to kill session '{}': {}", name, err);
                failed.push(KillFailure {
                    session_name: name,
                    error: err.to_string(),
                });
            }
        }
    }

    // 4. Return updated session list
    let sessions = list_sessions_with_ownership(conn)?;

    info!(
        "Kill all app sessions: {} killed, {} failed",
        killed_count,
        failed.len()
    );

    Ok(KillAllResult {
        sessions,
        killed_count,
        failed,
    })
}

/// Force the tmux server to redraw the client attached to this session.
pub fn refresh_tmux_client(session_name: &str) -> Result<(), AppError> {
    validate_session_name(session_name)?;
    let output = tmux_cmd()
        .args(["refresh-client", "-t", &format!("{}:", session_name)])
        .output()
        .map_err(|e| AppError::TmuxCommand(format!("Failed to refresh tmux client: {}", e)))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        warn!("tmux refresh-client for '{}': {}", session_name, stderr.trim());
        return Err(AppError::TmuxCommand(format!(
            "refresh-client failed for '{}': {}", session_name, stderr.trim()
        )));
    }
    Ok(())
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

/// Parse a single line from `tmux list-windows -F` output.
fn parse_window_line(line: &str) -> Option<TmuxWindow> {
    let parts: Vec<&str> = line.splitn(5, '|').collect();
    if parts.len() < 5 {
        warn!("Failed to parse tmux window line: {}", line);
        return None;
    }

    let window_index = parts[1].parse::<i32>().unwrap_or(0);
    let window_active = parts[3].trim() == "1";
    let window_panes = parts[4].trim().parse::<i32>().unwrap_or(0);

    Some(TmuxWindow {
        session_name: parts[0].to_string(),
        window_index,
        window_name: parts[2].to_string(),
        window_active,
        window_panes,
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

    // ── create_session tests ─────────────────────────────────────────

    #[test]
    fn test_create_session_rejects_invalid_name() {
        let result = create_session("bad;name", 80, 24);
        assert!(result.is_err());
        let err = result.unwrap_err().to_string();
        assert!(err.contains("Invalid session name"));
    }

    #[test]
    fn test_create_session_rejects_empty_name() {
        let result = create_session("", 80, 24);
        assert!(result.is_err());
        let err = result.unwrap_err().to_string();
        assert!(err.contains("cannot be empty"));
    }

    // ── kill_session tests ───────────────────────────────────────────

    #[test]
    fn test_kill_session_rejects_invalid_name() {
        let result = kill_session("inject$(cmd)");
        assert!(result.is_err());
        let err = result.unwrap_err().to_string();
        assert!(err.contains("Invalid session name"));
    }

    #[test]
    fn test_kill_session_rejects_empty_name() {
        let result = kill_session("");
        assert!(result.is_err());
        let err = result.unwrap_err().to_string();
        assert!(err.contains("cannot be empty"));
    }

    #[test]
    fn test_kill_session_nonexistent_is_ok() {
        // Killing a non-existent session should not error
        // (it will either succeed silently or tmux says "can't find session")
        let result = kill_session("nonexistent-test-session-xyz-12345");
        // This will either be Ok (tmux handles gracefully) or Err (tmux not running)
        // We just verify it doesn't panic
        let _ = result;
    }

    // ── split_pane_horizontal tests ───────────────────────────────────

    #[test]
    fn test_split_pane_horizontal_rejects_invalid_name() {
        let result = split_pane_horizontal("bad;name");
        assert!(result.is_err());
        let err = result.unwrap_err().to_string();
        assert!(err.contains("Invalid session name"));
    }

    #[test]
    fn test_split_pane_horizontal_rejects_empty_name() {
        let result = split_pane_horizontal("");
        assert!(result.is_err());
        let err = result.unwrap_err().to_string();
        assert!(err.contains("cannot be empty"));
    }

    // ── split_pane_vertical tests ────────────────────────────────────

    #[test]
    fn test_split_pane_vertical_rejects_invalid_name() {
        let result = split_pane_vertical("inject$(cmd)");
        assert!(result.is_err());
        let err = result.unwrap_err().to_string();
        assert!(err.contains("Invalid session name"));
    }

    #[test]
    fn test_split_pane_vertical_rejects_empty_name() {
        let result = split_pane_vertical("");
        assert!(result.is_err());
        let err = result.unwrap_err().to_string();
        assert!(err.contains("cannot be empty"));
    }

    // ── close_pane tests ─────────────────────────────────────────────

    #[test]
    fn test_close_pane_rejects_invalid_name() {
        let result = close_pane("path/../../etc");
        assert!(result.is_err());
        let err = result.unwrap_err().to_string();
        assert!(err.contains("Invalid session name"));
    }

    #[test]
    fn test_close_pane_rejects_empty_name() {
        let result = close_pane("");
        assert!(result.is_err());
        let err = result.unwrap_err().to_string();
        assert!(err.contains("cannot be empty"));
    }

    // ── parse_window_line tests ───────────────────────────────────────

    #[test]
    fn test_parse_window_line_valid() {
        let line = "my-session|0|bash|1|2";
        let window = parse_window_line(line).expect("Should parse valid line");
        assert_eq!(window.session_name, "my-session");
        assert_eq!(window.window_index, 0);
        assert_eq!(window.window_name, "bash");
        assert!(window.window_active);
        assert_eq!(window.window_panes, 2);
    }

    #[test]
    fn test_parse_window_line_inactive() {
        let line = "session|1|vim|0|1";
        let window = parse_window_line(line).expect("Should parse valid line");
        assert!(!window.window_active);
        assert_eq!(window.window_index, 1);
    }

    #[test]
    fn test_parse_window_line_invalid() {
        let line = "too|few|parts";
        assert!(parse_window_line(line).is_none());
    }

    // ── create_window tests ─────────────────────────────────────────

    #[test]
    fn test_create_window_rejects_invalid_name() {
        let result = create_window("bad;name");
        assert!(result.is_err());
        let err = result.unwrap_err().to_string();
        assert!(err.contains("Invalid session name"));
    }

    #[test]
    fn test_create_window_rejects_empty_name() {
        let result = create_window("");
        assert!(result.is_err());
        let err = result.unwrap_err().to_string();
        assert!(err.contains("cannot be empty"));
    }

    // ── close_window tests ──────────────────────────────────────────

    #[test]
    fn test_close_window_rejects_invalid_name() {
        let result = close_window("inject$(cmd)");
        assert!(result.is_err());
        let err = result.unwrap_err().to_string();
        assert!(err.contains("Invalid session name"));
    }

    #[test]
    fn test_close_window_rejects_empty_name() {
        let result = close_window("");
        assert!(result.is_err());
        let err = result.unwrap_err().to_string();
        assert!(err.contains("cannot be empty"));
    }

    // ── next_window tests ───────────────────────────────────────────

    #[test]
    fn test_next_window_rejects_invalid_name() {
        let result = next_window("bad;name");
        assert!(result.is_err());
        let err = result.unwrap_err().to_string();
        assert!(err.contains("Invalid session name"));
    }

    #[test]
    fn test_next_window_rejects_empty_name() {
        let result = next_window("");
        assert!(result.is_err());
        let err = result.unwrap_err().to_string();
        assert!(err.contains("cannot be empty"));
    }

    // ── previous_window tests ───────────────────────────────────────

    #[test]
    fn test_previous_window_rejects_invalid_name() {
        let result = previous_window("path/../../etc");
        assert!(result.is_err());
        let err = result.unwrap_err().to_string();
        assert!(err.contains("Invalid session name"));
    }

    #[test]
    fn test_previous_window_rejects_empty_name() {
        let result = previous_window("");
        assert!(result.is_err());
        let err = result.unwrap_err().to_string();
        assert!(err.contains("cannot be empty"));
    }

    // ── list_windows tests ──────────────────────────────────────────

    #[test]
    fn test_list_windows_rejects_invalid_name() {
        let result = list_windows("inject$(cmd)");
        assert!(result.is_err());
        let err = result.unwrap_err().to_string();
        assert!(err.contains("Invalid session name"));
    }

    // ── send_keys tests ──────────────────────────────────────────────

    #[test]
    fn test_send_keys_rejects_invalid_name() {
        let result = send_keys("bad;name", "echo hello");
        assert!(result.is_err());
        let err = result.unwrap_err().to_string();
        assert!(err.contains("Invalid session name"));
    }

    #[test]
    fn test_send_keys_rejects_empty_name() {
        let result = send_keys("", "echo hello");
        assert!(result.is_err());
        let err = result.unwrap_err().to_string();
        assert!(err.contains("cannot be empty"));
    }

    #[test]
    fn test_send_keys_rejects_empty_keys() {
        let result = send_keys("valid-session", "");
        assert!(result.is_err());
        let err = result.unwrap_err().to_string();
        assert!(err.contains("Keys cannot be empty"));
    }

    // ── refresh_tmux_client tests ─────────────────────────────────────

    #[test]
    fn test_refresh_tmux_client_rejects_invalid_name() {
        let result = refresh_tmux_client("bad;name");
        assert!(result.is_err());
        let err = result.unwrap_err().to_string();
        assert!(err.contains("Invalid session name"));
    }

    #[test]
    fn test_refresh_tmux_client_rejects_empty_name() {
        let result = refresh_tmux_client("");
        assert!(result.is_err());
        let err = result.unwrap_err().to_string();
        assert!(err.contains("cannot be empty"));
    }

    // ── DB-backed session ownership tests ────────────────────────────

    fn setup_test_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute("PRAGMA foreign_keys = ON", []).unwrap();
        // Create _migrations table (normally done by db::run_migrations)
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS _migrations (
                version INTEGER PRIMARY KEY,
                applied_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
            )",
        )
        .unwrap();
        conn.execute_batch(include_str!("../db/migrations/001_initial.sql"))
            .unwrap();
        conn.execute("INSERT INTO _migrations (version) VALUES (1)", [])
            .unwrap();
        conn.execute_batch(include_str!("../db/migrations/002_tmux_sessions.sql"))
            .unwrap();
        conn
    }

    fn insert_test_project(conn: &Connection, id: &str) {
        conn.execute(
            "INSERT INTO projects (id, name, path) VALUES (?1, ?2, ?3)",
            params![id, "test-project", format!("/tmp/test-{}", id)],
        )
        .unwrap();
    }

    #[test]
    fn test_register_session() {
        let conn = setup_test_db();
        let project_id = Uuid::new_v4().to_string();
        insert_test_project(&conn, &project_id);

        let result = register_session(&conn, &project_id, "test-session");
        assert!(result.is_ok());

        let record = result.unwrap();
        assert_eq!(record.project_id, project_id);
        assert_eq!(record.session_name, "test-session");
    }

    #[test]
    fn test_register_session_duplicate_replaces() {
        let conn = setup_test_db();
        let project_id = Uuid::new_v4().to_string();
        insert_test_project(&conn, &project_id);

        let first = register_session(&conn, &project_id, "dup-session").unwrap();
        let second = register_session(&conn, &project_id, "dup-session").unwrap();
        // INSERT OR REPLACE should succeed, creating a new row (new UUID)
        assert_ne!(first.id, second.id);
        assert_eq!(second.session_name, "dup-session");

        // Only one record should exist in DB
        let count: i32 = conn
            .query_row(
                "SELECT COUNT(*) FROM project_tmux_sessions WHERE session_name = ?1",
                ["dup-session"],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn test_register_session_sql_injection_prevented() {
        let conn = setup_test_db();
        let project_id = Uuid::new_v4().to_string();
        insert_test_project(&conn, &project_id);

        let malicious = "'; DROP TABLE project_tmux_sessions; --";
        let result = register_session(&conn, &project_id, malicious);
        assert!(result.is_err()); // validate_session_name rejects it

        // Verify table still exists
        let count: i32 = conn
            .query_row(
                "SELECT COUNT(*) FROM project_tmux_sessions",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn test_unregister_session() {
        let conn = setup_test_db();
        let project_id = Uuid::new_v4().to_string();
        insert_test_project(&conn, &project_id);

        register_session(&conn, &project_id, "to-remove").unwrap();
        assert!(unregister_session(&conn, "to-remove").is_ok());

        let count: i32 = conn
            .query_row(
                "SELECT COUNT(*) FROM project_tmux_sessions WHERE session_name = ?1",
                ["to-remove"],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn test_stale_cleanup() {
        let conn = setup_test_db();
        let project_id = Uuid::new_v4().to_string();
        insert_test_project(&conn, &project_id);

        // Insert stale session record (not actually in tmux)
        conn.execute(
            "INSERT INTO project_tmux_sessions (id, project_id, session_name)
             VALUES ('stale-1', ?1, 'ghost-session')",
            [&project_id],
        )
        .unwrap();

        // list_sessions_with_ownership should clean it up
        let _ = list_sessions_with_ownership(&conn).unwrap();

        let count: i32 = conn
            .query_row(
                "SELECT COUNT(*) FROM project_tmux_sessions",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn test_kill_all_app_sessions_empty() {
        let conn = setup_test_db();
        let result = kill_all_app_sessions(&conn).unwrap();
        assert_eq!(result.killed_count, 0);
        assert!(result.failed.is_empty());
    }

    #[test]
    fn test_kill_all_app_sessions_with_registered() {
        let conn = setup_test_db();
        let project_id = Uuid::new_v4().to_string();
        insert_test_project(&conn, &project_id);

        register_session(&conn, &project_id, "test-bulk-kill").unwrap();

        let result = kill_all_app_sessions(&conn).unwrap();

        // When tmux is installed: kill_session returns Ok (graceful "no server"/"can't find")
        //   → killed_count=1, failed=[], DB record cleaned up
        // When tmux is NOT installed: kill_session returns Err(io::Error)
        //   → killed_count=0, failed=[1], DB record remains
        let tmux_available = std::process::Command::new("tmux")
            .arg("-V")
            .output()
            .is_ok();

        if tmux_available {
            assert_eq!(result.killed_count, 1);
            assert!(result.failed.is_empty());

            let count: i32 = conn
                .query_row(
                    "SELECT COUNT(*) FROM project_tmux_sessions WHERE session_name = ?1",
                    ["test-bulk-kill"],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(count, 0, "DB record should be cleaned up when tmux is available");
        } else {
            assert_eq!(result.killed_count, 0);
            assert_eq!(result.failed.len(), 1);
        }
    }

    #[test]
    fn test_cascade_delete_on_project_removal() {
        let conn = setup_test_db();
        let project_id = Uuid::new_v4().to_string();
        insert_test_project(&conn, &project_id);

        register_session(&conn, &project_id, "cascade-test").unwrap();

        // Delete the project → should cascade delete session record
        conn.execute("DELETE FROM projects WHERE id = ?1", [&project_id])
            .unwrap();

        let count: i32 = conn
            .query_row(
                "SELECT COUNT(*) FROM project_tmux_sessions",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 0);
    }
}
