use crate::errors::AppError;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs;
use std::path::Path;
use tracing::info;
use url::form_urlencoded;

/// Read .claude/settings.json from project directory
pub fn read_settings_json(project_path: &Path) -> Result<Value, AppError> {
    let settings_path = project_path.join(".claude/settings.json");

    if !settings_path.exists() {
        // Create default settings.json with empty hooks
        let default_settings = json!({
            "hooks": {
                "Notification": [],
                "Stop": [],
                "PermissionRequest": []
            }
        });
        fs::create_dir_all(project_path.join(".claude"))?;
        fs::write(
            &settings_path,
            serde_json::to_string_pretty(&default_settings)?,
        )?;
        info!("Created default settings.json at {:?}", settings_path);
        return Ok(default_settings);
    }

    let content = fs::read_to_string(&settings_path)?;
    let settings: Value = serde_json::from_str(&content)?;
    Ok(settings)
}

/// Generate hook commands for flow-orche event server
pub fn generate_hook_commands(project_path: &str, port: u16) -> HashMap<String, Value> {
    let encoded_path: String = form_urlencoded::byte_serialize(project_path.as_bytes()).collect();

    let mut hooks = HashMap::new();

    // Notification hook
    hooks.insert(
        "Notification".to_string(),
        json!({
            "matcher": "",
            "hooks": [{
                "type": "command",
                "command": format!(
                    "curl -s -X POST 'http://127.0.0.1:{}/hook?project={}&type=Notification' \
                     -H 'Content-Type: application/json' --data-binary @-",
                    port, encoded_path
                )
            }]
        }),
    );

    // Stop hook
    hooks.insert(
        "Stop".to_string(),
        json!({
            "matcher": "",
            "hooks": [{
                "type": "command",
                "command": format!(
                    "curl -s -X POST 'http://127.0.0.1:{}/hook?project={}&type=Stop' \
                     -H 'Content-Type: application/json' --data-binary @-",
                    port, encoded_path
                )
            }]
        }),
    );

    // PermissionRequest hook
    hooks.insert(
        "PermissionRequest".to_string(),
        json!({
            "matcher": "",
            "hooks": [{
                "type": "command",
                "command": format!(
                    "curl -s -X POST 'http://127.0.0.1:{}/hook?project={}&type=PermissionRequest' \
                     -H 'Content-Type: application/json' --data-binary @-",
                    port, encoded_path
                )
            }]
        }),
    );

    hooks
}

/// Inject hooks into project settings.json
pub fn inject_hooks(project_path: &Path, port: u16) -> Result<(), AppError> {
    let canonical_path = fs::canonicalize(project_path)?;
    let path_str = canonical_path.to_string_lossy().to_string();

    let mut settings = read_settings_json(&canonical_path)?;

    // Ensure hooks object exists
    if !settings.is_object() || settings.get("hooks").is_none() {
        settings["hooks"] = json!({
            "Notification": [],
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

        // Remove existing flow-orche hooks (based on URL pattern)
        existing_array.retain(|h| {
            if let Some(hooks_arr) = h.get("hooks").and_then(|v| v.as_array()) {
                !hooks_arr.iter().any(|hook| {
                    hook.get("command")
                        .and_then(|c| c.as_str())
                        .map(|cmd| cmd.contains("127.0.0.1") && cmd.contains("/hook"))
                        .unwrap_or(false)
                })
            } else {
                true
            }
        });

        // Add new flow-orche hook
        existing_array.push(hook_value);
    }

    // Atomic write
    let settings_path = canonical_path.join(".claude/settings.json");
    let temp_path = settings_path.with_extension("json.tmp");

    fs::write(&temp_path, serde_json::to_string_pretty(&settings)?)?;
    fs::rename(&temp_path, &settings_path)?;

    info!("Injected hooks for project: {}", path_str);
    Ok(())
}

/// Remove flow-orche hooks from project settings.json
pub fn remove_hooks(project_path: &Path) -> Result<(), AppError> {
    let canonical_path = fs::canonicalize(project_path)?;
    let mut settings = read_settings_json(&canonical_path)?;

    let hooks_obj = settings["hooks"]
        .as_object_mut()
        .ok_or_else(|| AppError::Hook("hooks is not an object".into()))?;

    for hook_type in ["Notification", "Stop", "PermissionRequest"] {
        if let Some(existing) = hooks_obj.get_mut(hook_type) {
            if let Some(existing_array) = existing.as_array_mut() {
                // Remove flow-orche hooks
                existing_array.retain(|h| {
                    if let Some(hooks_arr) = h.get("hooks").and_then(|v| v.as_array()) {
                        !hooks_arr.iter().any(|hook| {
                            hook.get("command")
                                .and_then(|c| c.as_str())
                                .map(|cmd| cmd.contains("127.0.0.1") && cmd.contains("/hook"))
                                .unwrap_or(false)
                        })
                    } else {
                        true
                    }
                });
            }
        }
    }

    // Atomic write
    let settings_path = canonical_path.join(".claude/settings.json");
    let temp_path = settings_path.with_extension("json.tmp");

    fs::write(&temp_path, serde_json::to_string_pretty(&settings)?)?;
    fs::rename(&temp_path, &settings_path)?;

    info!("Removed hooks from project: {}", canonical_path.display());
    Ok(())
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
    fn test_read_settings_json_creates_default() {
        let temp_path = temp_dir();
        let settings = read_settings_json(&temp_path).unwrap();

        assert!(settings["hooks"].is_object());
        assert!(settings["hooks"]["Notification"].is_array());
        assert!(settings["hooks"]["Stop"].is_array());
        assert!(settings["hooks"]["PermissionRequest"].is_array());

        // Cleanup
        fs::remove_dir_all(&temp_path).ok();
    }

    #[test]
    fn test_generate_hook_commands() {
        let hooks = generate_hook_commands("/test/path", 8080);

        assert!(hooks.contains_key("Notification"));
        assert!(hooks.contains_key("Stop"));
        assert!(hooks.contains_key("PermissionRequest"));

        let notification_cmd = hooks["Notification"]["hooks"][0]["command"]
            .as_str()
            .unwrap();
        assert!(notification_cmd.contains("127.0.0.1:8080"));
        assert!(notification_cmd.contains("/hook"));
        assert!(notification_cmd.contains("type=Notification"));

        // Verify URL encoding
        assert!(notification_cmd.contains("%2Ftest%2Fpath"));
    }

    #[test]
    fn test_inject_and_remove_hooks() {
        let temp_path = temp_dir();
        fs::create_dir_all(temp_path.join(".claude")).unwrap();

        // Inject hooks
        inject_hooks(&temp_path, 8080).unwrap();

        let settings_path = temp_path.join(".claude/settings.json");
        assert!(settings_path.exists());

        let content = fs::read_to_string(&settings_path).unwrap();
        let settings: Value = serde_json::from_str(&content).unwrap();

        // Verify hooks injected
        let notification_hooks = settings["hooks"]["Notification"].as_array().unwrap();
        assert!(notification_hooks.len() > 0);

        let first_hook = &notification_hooks[0];
        let command = first_hook["hooks"][0]["command"].as_str().unwrap();
        assert!(command.contains("127.0.0.1:8080"));

        // Remove hooks
        remove_hooks(&temp_path).unwrap();

        let content = fs::read_to_string(&settings_path).unwrap();
        let settings: Value = serde_json::from_str(&content).unwrap();

        // Verify hooks removed
        let notification_hooks = settings["hooks"]["Notification"].as_array().unwrap();
        assert_eq!(notification_hooks.len(), 0);

        // Cleanup
        fs::remove_dir_all(&temp_path).ok();
    }
}
