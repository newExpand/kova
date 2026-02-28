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
}
