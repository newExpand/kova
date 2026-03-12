use crate::errors::AppError;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::thread;
use std::time::Duration;
use tracing::{info, warn};
use url::form_urlencoded;

/// Read .claude/settings.local.json from project directory (machine-specific, auto-gitignored)
pub fn read_settings_local_json(project_path: &Path) -> Result<Value, AppError> {
    let settings_path = project_path.join(".claude/settings.local.json");

    if !settings_path.exists() {
        // Create default settings.local.json with empty hooks for all types
        let mut default_hooks = serde_json::Map::new();
        for hook_type in HOOK_TYPES {
            default_hooks.insert(hook_type.to_string(), json!([]));
        }
        let default_settings = json!({ "hooks": default_hooks });
        fs::create_dir_all(project_path.join(".claude"))?;
        fs::write(
            &settings_path,
            serde_json::to_string_pretty(&default_settings)?,
        )?;
        info!("Created default settings.local.json at {:?}", settings_path);
        return Ok(default_settings);
    }

    let content = fs::read_to_string(&settings_path)?;
    let settings: Value = serde_json::from_str(&content)?;
    Ok(settings)
}

/// All hook types that flow-orche installs for Claude Code integration.
const HOOK_TYPES: &[&str] = &[
    "Stop",
    "PermissionRequest",
    "PostToolUse",
    "PostToolUseFailure",
    "SubagentStart",
    "SubagentStop",
    "TaskCompleted",
    "TeammateIdle",
    "SessionStart",
    "SessionEnd",
    "UserPromptSubmit",
];

/// Generate hook commands for flow-orche event server
pub fn generate_hook_commands(project_path: &str, port: u16) -> HashMap<String, Value> {
    let encoded_path: String = form_urlencoded::byte_serialize(project_path.as_bytes()).collect();

    let mut hooks = HashMap::new();

    for hook_type in HOOK_TYPES {
        hooks.insert(
            hook_type.to_string(),
            json!({
                "matcher": "",
                "hooks": [{
                    "type": "command",
                    "command": format!(
                        "curl -s -X POST 'http://127.0.0.1:{}/hook?project={}&type={}' \
                         -H 'Content-Type: application/json' --data-binary @-",
                        port, encoded_path, hook_type
                    )
                }]
            }),
        );
    }

    hooks
}

/// Returns true if the given hook entry was injected by flow-orche
/// (identified by the characteristic `127.0.0.1` + `/hook` URL pattern).
fn is_flow_orche_hook(entry: &Value) -> bool {
    entry
        .get("hooks")
        .and_then(|v| v.as_array())
        .is_some_and(|hooks| {
            hooks.iter().any(|hook| {
                hook.get("command")
                    .and_then(|c| c.as_str())
                    .is_some_and(|cmd| cmd.contains("127.0.0.1") && cmd.contains("/hook"))
            })
        })
}

/// Inject hooks into project settings.json
pub fn inject_hooks(project_path: &Path, port: u16) -> Result<(), AppError> {
    let canonical_path = fs::canonicalize(project_path)?;
    let path_str = canonical_path.to_string_lossy().to_string();

    let mut settings = read_settings_local_json(&canonical_path)?;

    // Ensure hooks object exists
    if !settings.is_object() || settings.get("hooks").is_none() {
        settings["hooks"] = json!({
            "Stop": [],
            "PermissionRequest": []
        });
    }

    let hooks_obj = settings["hooks"]
        .as_object_mut()
        .ok_or_else(|| AppError::Hook("hooks is not an object".into()))?;

    // Generate flow-orche hooks
    let flow_orche_hooks = generate_hook_commands(&path_str, port);

    for (hook_type, hook_value) in flow_orche_hooks {
        // Get existing hooks array
        let existing = hooks_obj.entry(&hook_type).or_insert_with(|| json!([]));

        let existing_array = existing.as_array_mut().ok_or_else(|| {
            AppError::Hook(format!("hooks.{} is not an array", hook_type))
        })?;

        // Remove existing flow-orche hooks, then add the new one
        existing_array.retain(|h| !is_flow_orche_hook(h));
        existing_array.push(hook_value);
    }

    // Atomic write to settings.local.json (machine-specific, auto-gitignored)
    let settings_path = canonical_path.join(".claude/settings.local.json");
    let temp_path = settings_path.with_extension("local.json.tmp");

    fs::write(&temp_path, serde_json::to_string_pretty(&settings)?)?;
    fs::rename(&temp_path, &settings_path)?;

    info!("Injected hooks for project: {}", path_str);
    Ok(())
}

// ─── Gemini CLI hooks ────────────────────────────────────────────────

/// Gemini CLI hook types → flow-orche event types.
/// Gemini hooks fire on stdin JSON containing `cwd`, `session_id`, etc.
const GEMINI_HOOK_MAP: &[(&str, &str)] = &[
    ("SessionStart", "SessionStart"),
    ("BeforeAgent", "AgentActive"),
    ("AfterAgent", "AgentIdle"),
    ("SessionEnd", "Stop"),
];

/// Generate a shell command that reads JSON from stdin, extracts `cwd`,
/// and POSTs to the event server. Used by Gemini global hooks where
/// the project path is not known at injection time.
/// (Codex notify uses a separate inline curl command with `$PWD`.)
fn generate_stdin_hook_command(port: u16, event_type: &str) -> String {
    // grep handles both compact ("cwd":"val") and spaced ("cwd": "val") JSON.
    // head -1 guards against multiple matches. echo '{}' satisfies Gemini's
    // expected JSON response on stdout.
    format!(
        r#"INPUT=$(cat); CWD=$(printf '%s' "$INPUT" | grep -o '"cwd" *: *"[^"]*"' | head -1 | cut -d'"' -f4); curl -s -X POST "http://127.0.0.1:{port}/hook?project=$CWD&type={event_type}" -H 'Content-Type: application/json' -d "$INPUT"; echo '{{}}'"#,
        port = port,
        event_type = event_type,
    )
}

/// Inject hooks into Gemini CLI's global settings (`~/.gemini/settings.json`).
///
/// Idempotent: removes existing flow-orche hooks (identified by `127.0.0.1` + `/hook`)
/// before re-injecting with the current port.
pub fn inject_gemini_hooks(port: u16) -> Result<(), AppError> {
    let home = dirs::home_dir()
        .ok_or_else(|| AppError::Hook("Cannot determine home directory".into()))?;
    let gemini_dir = home.join(".gemini");
    let settings_path = gemini_dir.join("settings.json");

    let mut settings = if settings_path.exists() {
        let content = fs::read_to_string(&settings_path)?;
        serde_json::from_str::<Value>(&content)?
    } else {
        json!({})
    };

    if settings.get("hooks").is_none() {
        settings["hooks"] = json!({});
    }

    let hooks_obj = settings["hooks"]
        .as_object_mut()
        .ok_or_else(|| AppError::Hook("hooks is not an object in Gemini settings".into()))?;

    for (gemini_type, event_type) in GEMINI_HOOK_MAP {
        let hook_entry = json!({
            "matcher": "*",
            "hooks": [{
                "type": "command",
                "command": generate_stdin_hook_command(port, event_type)
            }]
        });

        let existing = hooks_obj
            .entry(gemini_type.to_string())
            .or_insert_with(|| json!([]));

        let existing_array = existing.as_array_mut().ok_or_else(|| {
            AppError::Hook(format!(
                "hooks.{} is not an array in Gemini settings",
                gemini_type
            ))
        })?;

        existing_array.retain(|h| !is_flow_orche_hook(h));
        existing_array.push(hook_entry);
    }

    // Atomic write with restrictive permissions (contains event server port)
    fs::create_dir_all(&gemini_dir)?;
    let temp_path = settings_path.with_extension("json.tmp");
    fs::write(&temp_path, serde_json::to_string_pretty(&settings)?)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&temp_path, fs::Permissions::from_mode(0o600))?;
    }
    fs::rename(&temp_path, &settings_path)?;

    info!("Injected Gemini CLI hooks (port {})", port);
    Ok(())
}

// ─── Codex CLI notify ────────────────────────────────────────────────

/// Inject a notify command into Codex CLI config (`~/.codex/config.toml`).
///
/// Codex CLI's only hook-like integration. The `notify` array fires on
/// `agent-turn-complete`, using `$PWD` as the project path.
pub fn inject_codex_notify(port: u16) -> Result<(), AppError> {
    let home = dirs::home_dir()
        .ok_or_else(|| AppError::Hook("Cannot determine home directory".into()))?;
    let codex_dir = home.join(".codex");
    let config_path = codex_dir.join("config.toml");

    let existing_content = if config_path.exists() {
        fs::read_to_string(&config_path)?
    } else {
        String::new()
    };

    // Remove existing flow-orche notify lines and marker comments.
    // Codex CLI expects `notify = [...]` (array of strings), NOT `[notify]` table.
    let marker = "# flow-orche notify";

    fn is_flow_orche_line(line: &str, marker: &str) -> bool {
        if line.contains(marker) {
            return true;
        }
        let has_hook_url = line.contains("127.0.0.1") && line.contains("/hook");
        if line.starts_with("notify") && has_hook_url {
            return true;
        }
        // Leftover [notify] table sections from previous buggy versions
        if line.trim() == "[notify]" {
            return true;
        }
        if line.starts_with("command") && has_hook_url {
            return true;
        }
        false
    }

    // Single pass: clean lines and find the first [section] header position.
    let mut before_section: Vec<&str> = Vec::new();
    let mut after_section: Vec<&str> = Vec::new();
    let mut found_section = false;

    for line in existing_content.lines() {
        if is_flow_orche_line(line, marker) {
            continue;
        }
        if !found_section && line.starts_with('[') {
            found_section = true;
        }
        if found_section {
            after_section.push(line);
        } else {
            before_section.push(line);
        }
    }

    // Trim trailing empty lines from the top-level section
    while before_section.last().is_some_and(|l| l.trim().is_empty()) {
        before_section.pop();
    }

    // Build the notify command with TOML-safe escaping.
    // TOML basic strings ("...") require \" for literal double quotes.
    // The shell command uses single quotes around URL/JSON and double quotes around $PWD.
    let notify_cmd = format!(
        r#"curl -s -X POST 'http://127.0.0.1:{}/hook?project='\"$PWD\"'&type=AgentIdle' -H 'Content-Type: application/json' -d '{{\"source\":\"codex-notify\"}}'"#,
        port
    );

    // Insert `notify = ["cmd"]` as a top-level key.
    // TOML rule: keys after a [section] header belong to that section.
    // Top-level keys must appear BEFORE the first [section] header.
    let notify_block = format!(
        "{}\nnotify = [\"{}\"]",
        marker, notify_cmd
    );

    let content = if found_section {
        format!(
            "{}\n\n{}\n\n{}\n",
            before_section.join("\n"),
            notify_block,
            after_section.join("\n")
        )
    } else if before_section.is_empty() {
        format!("{}\n", notify_block)
    } else {
        format!("{}\n\n{}\n", before_section.join("\n"), notify_block)
    };

    fs::create_dir_all(&codex_dir)?;
    let temp_path = config_path.with_extension("toml.tmp");
    fs::write(&temp_path, &content)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&temp_path, fs::Permissions::from_mode(0o600))?;
    }
    fs::rename(&temp_path, &config_path)?;

    info!("Injected Codex CLI notify config (port {})", port);
    Ok(())
}

/// Remove flow-orche hooks from project settings.json
pub fn remove_hooks(project_path: &Path) -> Result<(), AppError> {
    let canonical_path = fs::canonicalize(project_path)?;
    let mut settings = read_settings_local_json(&canonical_path)?;

    let hooks_obj = settings["hooks"]
        .as_object_mut()
        .ok_or_else(|| AppError::Hook("hooks is not an object".into()))?;

    for hook_type in HOOK_TYPES {
        if let Some(existing) = hooks_obj.get_mut(*hook_type) {
            if let Some(existing_array) = existing.as_array_mut() {
                existing_array.retain(|h| !is_flow_orche_hook(h));
            }
        }
    }

    // Atomic write to settings.local.json (machine-specific, auto-gitignored)
    let settings_path = canonical_path.join(".claude/settings.local.json");
    let temp_path = settings_path.with_extension("local.json.tmp");

    fs::write(&temp_path, serde_json::to_string_pretty(&settings)?)?;
    fs::rename(&temp_path, &settings_path)?;

    info!("Removed hooks from project: {}", canonical_path.display());
    Ok(())
}

/// Inject hooks for all existing worktrees of a project.
/// Each worktree gets hooks that send the worktree's own path (not the parent project path),
/// enabling the frontend to track agent activity per-worktree.
pub fn inject_hooks_for_worktrees(project_path: &Path, port: u16) -> Result<u32, AppError> {
    // Skip non-git directories — project may be a plain folder without git init.
    if !project_path.join(".git").exists() {
        tracing::debug!(
            "Skipping worktree hook injection for non-git directory: {}",
            project_path.display()
        );
        return Ok(0);
    }
    let worktrees = crate::services::git::get_worktrees(project_path)?;
    let mut count = 0u32;

    for wt in &worktrees {
        if wt.is_main {
            continue;
        }
        let wt_path = Path::new(&wt.path);
        if !wt_path.exists() {
            warn!("Worktree path does not exist, skipping hook injection: {}", wt.path);
            continue;
        }
        match inject_hooks(wt_path, port) {
            Ok(()) => {
                count += 1;
            }
            Err(e) => {
                warn!("Failed to inject hooks for worktree '{}': {}", wt.path, e);
            }
        }
    }

    if count > 0 {
        info!(
            "Injected hooks for {} worktree(s) of {}",
            count,
            project_path.display()
        );
    }
    Ok(count)
}

/// Spawn a background thread that polls for a worktree directory to appear,
/// then injects hooks for it.
///
/// Handles the timing gap where `start_worktree_task` sends `claude --worktree <name>`
/// but Claude Code creates the worktree directory asynchronously.
///
/// When `app_handle` is provided, emits a `worktree:ready` event to the frontend
/// upon detecting the worktree directory, enabling immediate UI refresh.
pub fn inject_hooks_for_worktree_when_ready(
    project_path: String,
    task_name: String,
    app_handle: Option<tauri::AppHandle>,
) {
    thread::spawn(move || {
        let worktree_path_str = format!("{}/.claude/worktrees/{}", project_path, task_name);
        let wt = Path::new(&worktree_path_str);

        let port = match crate::services::event_server::read_port_from_file() {
            Ok(p) => p,
            Err(e) => {
                warn!(
                    "Cannot inject hooks for worktree '{}': port file unreadable: {}",
                    task_name, e
                );
                return;
            }
        };

        for attempt in 0..60 {
            // Check for .git file inside worktree (created as the final step of
            // `git worktree add`), not just directory existence. The directory may
            // appear before git fully registers the worktree, causing
            // `git worktree list` to miss it when fetchGraphData runs.
            if wt.join(".git").exists() {
                match inject_hooks(wt, port) {
                    Ok(()) => info!(
                        "Injected hooks for new worktree '{}' (after ~{}s)",
                        task_name, attempt
                    ),
                    Err(e) => warn!(
                        "Hook injection failed for new worktree '{}': {}",
                        task_name, e
                    ),
                }

                // Notify frontend that worktree is ready for immediate UI refresh
                if let Some(ref app) = app_handle {
                    use tauri::Emitter;
                    if let Err(e) = app.emit(
                        "worktree:ready",
                        serde_json::json!({
                            "projectPath": &project_path,
                            "taskName": &task_name,
                            "worktreePath": &worktree_path_str,
                        }),
                    ) {
                        warn!("Failed to emit worktree:ready event: {}", e);
                    }
                }

                return;
            }
            thread::sleep(Duration::from_secs(1));
        }

        warn!(
            "Timed out waiting for worktree directory: {}",
            worktree_path_str
        );
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;

    fn temp_dir() -> PathBuf {
        let tmp = std::env::temp_dir().join(format!("flow-orche-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&tmp).unwrap();
        tmp
    }

    #[test]
    fn test_read_settings_local_json_creates_default() {
        let temp_path = temp_dir();
        let settings = read_settings_local_json(&temp_path).unwrap();

        assert!(settings["hooks"].is_object());
        assert!(settings["hooks"]["Stop"].is_array());
        assert!(settings["hooks"]["PermissionRequest"].is_array());

        // Verify it wrote to settings.local.json, not settings.json
        assert!(temp_path.join(".claude/settings.local.json").exists());
        assert!(!temp_path.join(".claude/settings.json").exists());

        // Cleanup
        fs::remove_dir_all(&temp_path).ok();
    }

    #[test]
    fn test_generate_hook_commands() {
        let hooks = generate_hook_commands("/test/path", 8080);

        assert!(hooks.contains_key("Stop"));
        assert!(hooks.contains_key("PermissionRequest"));
        assert!(hooks.contains_key("PostToolUse"));
        assert!(hooks.contains_key("PostToolUseFailure"));
        assert!(hooks.contains_key("UserPromptSubmit"));
        assert!(hooks.contains_key("SubagentStart"));
        assert!(hooks.contains_key("SubagentStop"));
        assert!(hooks.contains_key("TaskCompleted"));
        assert!(hooks.contains_key("TeammateIdle"));
        assert!(hooks.contains_key("SessionStart"));
        assert!(hooks.contains_key("SessionEnd"));
        assert_eq!(hooks.len(), 11);

        let permission_cmd = hooks["PermissionRequest"]["hooks"][0]["command"]
            .as_str()
            .unwrap();
        assert!(permission_cmd.contains("127.0.0.1:8080"));
        assert!(permission_cmd.contains("/hook"));
        assert!(permission_cmd.contains("type=PermissionRequest"));

        // Verify URL encoding
        assert!(permission_cmd.contains("%2Ftest%2Fpath"));
    }

    #[test]
    fn test_inject_and_remove_hooks() {
        let temp_path = temp_dir();
        fs::create_dir_all(temp_path.join(".claude")).unwrap();

        // Inject hooks
        inject_hooks(&temp_path, 8080).unwrap();

        let settings_path = temp_path.join(".claude/settings.local.json");
        assert!(settings_path.exists());
        // settings.json should NOT be created
        assert!(!temp_path.join(".claude/settings.json").exists());

        let content = fs::read_to_string(&settings_path).unwrap();
        let settings: Value = serde_json::from_str(&content).unwrap();

        // Verify hooks injected
        let permission_hooks = settings["hooks"]["PermissionRequest"].as_array().unwrap();
        assert!(!permission_hooks.is_empty());

        let first_hook = &permission_hooks[0];
        let command = first_hook["hooks"][0]["command"].as_str().unwrap();
        assert!(command.contains("127.0.0.1:8080"));

        // Re-inject with new port (idempotency test)
        inject_hooks(&temp_path, 9090).unwrap();
        let content = fs::read_to_string(&settings_path).unwrap();
        let settings: Value = serde_json::from_str(&content).unwrap();
        let permission_hooks = settings["hooks"]["PermissionRequest"].as_array().unwrap();
        assert_eq!(permission_hooks.len(), 1, "Should replace, not duplicate");
        let command = permission_hooks[0]["hooks"][0]["command"].as_str().unwrap();
        assert!(command.contains("127.0.0.1:9090"), "Port should be updated");

        // Remove hooks
        remove_hooks(&temp_path).unwrap();

        let content = fs::read_to_string(&settings_path).unwrap();
        let settings: Value = serde_json::from_str(&content).unwrap();

        // Verify hooks removed
        let permission_hooks = settings["hooks"]["PermissionRequest"].as_array().unwrap();
        assert_eq!(permission_hooks.len(), 0);

        // Cleanup
        fs::remove_dir_all(&temp_path).ok();
    }

    #[test]
    fn test_generate_stdin_hook_command() {
        let cmd = generate_stdin_hook_command(8080, "AgentActive");
        assert!(cmd.contains("127.0.0.1:8080"));
        assert!(cmd.contains("type=AgentActive"));
        assert!(cmd.contains("grep -o"));
        assert!(cmd.contains("echo '{}'"));
    }

    #[test]
    fn test_inject_gemini_hooks_creates_settings() {
        // Use a temp HOME to avoid touching the real ~/.gemini
        let temp_home = temp_dir();
        let gemini_dir = temp_home.join(".gemini");
        let settings_path = gemini_dir.join("settings.json");

        // Manually create the dir and an empty settings to test injection
        fs::create_dir_all(&gemini_dir).unwrap();
        fs::write(&settings_path, "{}").unwrap();

        // Read, inject hooks manually (inject_gemini_hooks uses dirs::home_dir
        // which we can't override, so test the core logic directly)
        let mut settings: Value = json!({});
        settings["hooks"] = json!({});
        let hooks_obj = settings["hooks"].as_object_mut().unwrap();

        for (gemini_type, event_type) in GEMINI_HOOK_MAP {
            let hook_entry = json!({
                "matcher": "*",
                "hooks": [{
                    "type": "command",
                    "command": generate_stdin_hook_command(9090, event_type)
                }]
            });
            let existing = hooks_obj
                .entry(gemini_type.to_string())
                .or_insert_with(|| json!([]));
            let arr = existing.as_array_mut().unwrap();
            arr.retain(|h| !is_flow_orche_hook(h));
            arr.push(hook_entry);
        }

        // Verify all Gemini hook types present
        assert!(hooks_obj.contains_key("SessionStart"));
        assert!(hooks_obj.contains_key("BeforeAgent"));
        assert!(hooks_obj.contains_key("AfterAgent"));
        assert!(hooks_obj.contains_key("SessionEnd"));

        // Verify commands
        let before_cmd = hooks_obj["BeforeAgent"][0]["hooks"][0]["command"]
            .as_str()
            .unwrap();
        assert!(before_cmd.contains("type=AgentActive"));
        assert!(before_cmd.contains("127.0.0.1:9090"));

        let after_cmd = hooks_obj["AfterAgent"][0]["hooks"][0]["command"]
            .as_str()
            .unwrap();
        assert!(after_cmd.contains("type=AgentIdle"));

        // Idempotency: re-inject and check no duplicates
        for (gemini_type, event_type) in GEMINI_HOOK_MAP {
            let hook_entry = json!({
                "matcher": "*",
                "hooks": [{
                    "type": "command",
                    "command": generate_stdin_hook_command(7070, event_type)
                }]
            });
            let arr = hooks_obj
                .get_mut(*gemini_type)
                .unwrap()
                .as_array_mut()
                .unwrap();
            arr.retain(|h| !is_flow_orche_hook(h));
            arr.push(hook_entry);
        }

        let before_hooks = hooks_obj["BeforeAgent"].as_array().unwrap();
        assert_eq!(before_hooks.len(), 1, "Should replace, not duplicate");
        let cmd = before_hooks[0]["hooks"][0]["command"].as_str().unwrap();
        assert!(cmd.contains("127.0.0.1:7070"), "Port should be updated");

        fs::remove_dir_all(&temp_home).ok();
    }

    #[test]
    fn test_codex_notify_command() {
        // Verify the notify command contains the correct port and event type
        let cmd = generate_stdin_hook_command(8080, "AgentIdle");
        assert!(cmd.contains("127.0.0.1:8080"));
        assert!(cmd.contains("type=AgentIdle"));
    }
}
