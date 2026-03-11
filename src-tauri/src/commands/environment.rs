use crate::errors::AppError;
use serde::Serialize;
use std::process::Command;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvironmentCheck {
    pub tmux_installed: bool,
    pub tmux_version: Option<String>,
    pub claude_code_installed: bool,
    pub claude_code_version: Option<String>,
    pub codex_cli_installed: bool,
    pub codex_cli_version: Option<String>,
    pub gemini_cli_installed: bool,
    pub gemini_cli_version: Option<String>,
    pub shell_type: String,
}

#[tauri::command]
pub fn check_environment() -> Result<EnvironmentCheck, AppError> {
    let tmux_version = get_command_version("tmux", &["-V"]);
    let claude_version = get_command_version("claude", &["--version"]);
    let codex_version = get_command_version("codex", &["--version"]);
    let gemini_version = get_command_version("gemini", &["--version"]);
    let shell_type = std::env::var("SHELL").unwrap_or_else(|_| "unknown".into());

    Ok(EnvironmentCheck {
        tmux_installed: tmux_version.is_some(),
        tmux_version,
        claude_code_installed: claude_version.is_some(),
        claude_code_version: claude_version,
        codex_cli_installed: codex_version.is_some(),
        codex_cli_version: codex_version,
        gemini_cli_installed: gemini_version.is_some(),
        gemini_cli_version: gemini_version,
        shell_type,
    })
}

fn get_command_version(cmd: &str, args: &[&str]) -> Option<String> {
    Command::new(cmd)
        .args(args)
        .stdin(std::process::Stdio::null())
        .output()
        .ok()
        .filter(|o| o.status.success())
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .map(|s| s.trim().to_string())
}
