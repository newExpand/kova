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
    pub git_installed: bool,
    pub git_version: Option<String>,
    pub alerter_installed: bool,
    pub shell_type: String,
}

#[tauri::command]
pub fn check_environment() -> Result<EnvironmentCheck, AppError> {
    let shell_type = std::env::var("SHELL").unwrap_or_else(|_| "unknown".into());

    // Spawn all version checks in parallel — each process can take 50-200ms,
    // so sequential execution totals ~500ms+. With threads: ~max(single) ≈ 100ms.
    let (tmux_version, claude_version, codex_version, gemini_version, git_version, alerter_installed) =
        std::thread::scope(|s| {
            let h_tmux = s.spawn(|| get_command_version("tmux", &["-V"]));
            let h_claude = s.spawn(|| get_command_version("claude", &["--version"]));
            let h_codex = s.spawn(|| get_command_version("codex", &["--version"]));
            let h_gemini = s.spawn(|| get_command_version("gemini", &["--version"]));
            let h_git = s.spawn(|| get_command_version("git", &["--version"]));
            let h_alerter = s.spawn(|| is_command_available("alerter", &["-help"]));

            (
                h_tmux.join().unwrap_or(None),
                h_claude.join().unwrap_or(None),
                h_codex.join().unwrap_or(None),
                h_gemini.join().unwrap_or(None),
                h_git.join().unwrap_or(None),
                h_alerter.join().unwrap_or(false),
            )
        });

    Ok(EnvironmentCheck {
        tmux_installed: tmux_version.is_some(),
        tmux_version,
        claude_code_installed: claude_version.is_some(),
        claude_code_version: claude_version,
        codex_cli_installed: codex_version.is_some(),
        codex_cli_version: codex_version,
        gemini_cli_installed: gemini_version.is_some(),
        gemini_cli_version: gemini_version,
        git_installed: git_version.is_some(),
        git_version,
        alerter_installed,
        shell_type,
    })
}

fn is_command_available(cmd: &str, args: &[&str]) -> bool {
    match Command::new(cmd)
        .args(args)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .output()
    {
        Ok(_) => true,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => false,
        Err(e) => {
            tracing::warn!("Failed to detect {}: {}", cmd, e);
            false
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_get_command_version_with_echo() {
        // echo is always available on macOS/Linux
        let version = get_command_version("echo", &["hello"]);
        assert_eq!(version, Some("hello".to_string()));
    }

    #[test]
    fn test_get_command_version_nonexistent() {
        let version = get_command_version("nonexistent_binary_xyz_42", &["--version"]);
        assert!(version.is_none());
    }

    #[test]
    fn test_is_command_available_true() {
        // echo is always available
        assert!(is_command_available("echo", &["hello"]));
    }

    #[test]
    fn test_is_command_available_false() {
        assert!(!is_command_available("nonexistent_binary_xyz_42", &[]));
    }
}

fn get_command_version(cmd: &str, args: &[&str]) -> Option<String> {
    match Command::new(cmd)
        .args(args)
        .stdin(std::process::Stdio::null())
        .output()
    {
        Ok(o) if o.status.success() => {
            String::from_utf8(o.stdout).ok().map(|s| s.trim().to_string())
        }
        Ok(_) => None,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
        Err(e) => {
            tracing::warn!("Failed to detect {}: {}", cmd, e);
            None
        }
    }
}
