use std::process::Command;
use std::time::Duration;

use tracing::{info, warn};

use crate::models::environment::{DependencyStatus, EnvironmentStatus};

const MAX_RETRIES: u32 = 3;
const RETRY_INTERVAL: Duration = Duration::from_secs(1);

/// Run a CLI command with retry (max 3, 1s interval)
fn run_command_with_retry(program: &str, args: &[&str]) -> Result<String, String> {
    for attempt in 1..=MAX_RETRIES {
        match run_command(program, args) {
            Ok(result) => return Ok(result),
            Err(e) if attempt < MAX_RETRIES => {
                warn!(
                    "Attempt {}/{} failed for `{} {}`: {}. Retrying in 1s...",
                    attempt,
                    MAX_RETRIES,
                    program,
                    args.join(" "),
                    e
                );
                std::thread::sleep(RETRY_INTERVAL);
            }
            Err(e) => return Err(e),
        }
    }
    Err("Max retries exceeded".to_string())
}

/// Run a CLI command and return stdout output
fn run_command(program: &str, args: &[&str]) -> Result<String, String> {
    let output = Command::new(program)
        .args(args)
        .stdin(std::process::Stdio::null())
        .output()
        .map_err(|e| format!("실행 실패: {e}"))?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        Err(stderr)
    }
}

/// Run a CLI command with a timeout, returning combined stdout+stderr
fn run_command_with_timeout(
    program: &str,
    args: &[&str],
    timeout: Duration,
) -> Result<(String, String), String> {
    let mut child = Command::new(program)
        .args(args)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("실행 실패: {e}"))?;

    let start = std::time::Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                let stdout = match child.stdout.take() {
                    Some(mut s) => {
                        let mut buf = String::new();
                        if let Err(e) = std::io::Read::read_to_string(&mut s, &mut buf) {
                            warn!("Failed to read stdout: {e}");
                        }
                        buf.trim().to_string()
                    }
                    None => String::new(),
                };
                let stderr = match child.stderr.take() {
                    Some(mut s) => {
                        let mut buf = String::new();
                        if let Err(e) = std::io::Read::read_to_string(&mut s, &mut buf) {
                            warn!("Failed to read stderr: {e}");
                        }
                        buf.trim().to_string()
                    }
                    None => String::new(),
                };

                if status.success() {
                    return Ok((stdout, stderr));
                }
                return Err(format!("{stdout}\n{stderr}").trim().to_string());
            }
            Ok(None) => {
                if start.elapsed() > timeout {
                    let _ = child.kill();
                    return Err("타임아웃: 명령이 시간 내에 완료되지 않았습니다".to_string());
                }
                std::thread::sleep(Duration::from_millis(100));
            }
            Err(e) => return Err(format!("프로세스 상태 확인 실패: {e}")),
        }
    }
}

/// Check if a dependency is installed via `which`
fn check_dependency_exists(name: &str) -> bool {
    match Command::new("which").arg(name).output() {
        Ok(output) => output.status.success(),
        Err(e) => {
            warn!("Failed to check dependency '{name}': {e}");
            false
        }
    }
}

/// Check Claude Code CLI installation and version
fn check_claude_cli() -> DependencyStatus {
    if !check_dependency_exists("claude") {
        return DependencyStatus {
            installed: false,
            version: None,
            message: "Claude Code CLI가 설치되지 않았습니다".to_string(),
            install_hint: Some("npm install -g @anthropic-ai/claude-code".to_string()),
        };
    }

    match run_command_with_retry("claude", &["--version"]) {
        Ok(version_output) => {
            let version = match version_output.lines().next() {
                Some(line) => line.trim().to_string(),
                None => version_output.trim().to_string(),
            };
            info!("Claude CLI detected: {version}");
            DependencyStatus {
                installed: true,
                version: Some(version),
                message: "Claude Code CLI 설치됨".to_string(),
                install_hint: None,
            }
        }
        Err(e) => {
            warn!("Claude CLI version check failed: {e}");
            DependencyStatus {
                installed: true,
                version: None,
                message: "Claude Code CLI 감지됨 (버전 확인 실패)".to_string(),
                install_hint: None,
            }
        }
    }
}

/// Check tmux installation and version
fn check_tmux() -> DependencyStatus {
    if !check_dependency_exists("tmux") {
        return DependencyStatus {
            installed: false,
            version: None,
            message: "tmux가 설치되지 않았습니다".to_string(),
            install_hint: Some("brew install tmux".to_string()),
        };
    }

    match run_command_with_retry("tmux", &["-V"]) {
        Ok(version_output) => {
            let version = version_output.trim().to_string();
            info!("tmux detected: {version}");
            DependencyStatus {
                installed: true,
                version: Some(version),
                message: "tmux 설치됨".to_string(),
                install_hint: None,
            }
        }
        Err(e) => {
            warn!("tmux version check failed: {e}");
            DependencyStatus {
                installed: true,
                version: None,
                message: "tmux 감지됨 (버전 확인 실패)".to_string(),
                install_hint: None,
            }
        }
    }
}

/// Check Claude authentication status using `claude -p` (non-interactive print mode)
///
/// Auth errors from the CLI are returned immediately (< 2 seconds), while
/// successful auth leads to API processing that takes longer. Therefore:
/// - Immediate auth-related error → not authenticated
/// - API response or timeout → authenticated (API is processing the request)
fn check_claude_auth() -> DependencyStatus {
    if !check_dependency_exists("claude") {
        return DependencyStatus {
            installed: false,
            version: None,
            message: "Claude Code CLI가 설치되지 않아 인증을 확인할 수 없습니다".to_string(),
            install_hint: Some("npm install -g @anthropic-ai/claude-code".to_string()),
        };
    }

    match run_command_with_timeout(
        "claude",
        &["-p", "hi", "--output-format", "json"],
        Duration::from_secs(10),
    ) {
        Ok(_) => {
            info!("Claude auth: authenticated (API responded)");
            DependencyStatus {
                installed: true,
                version: None,
                message: "Claude 인증 완료".to_string(),
                install_hint: None,
            }
        }
        Err(e) => {
            let err_lower = e.to_lowercase();

            // Timeout means the API call is in progress → auth succeeded
            if err_lower.contains("타임아웃") {
                info!("Claude auth: authenticated (API processing, timed out as expected)");
                DependencyStatus {
                    installed: true,
                    version: None,
                    message: "Claude 인증 완료".to_string(),
                    install_hint: None,
                }
            }
            // Budget/rate errors also confirm auth works
            else if err_lower.contains("exceeded")
                || err_lower.contains("budget")
                || err_lower.contains("rate")
            {
                info!("Claude auth: authenticated (budget/rate limit confirmed)");
                DependencyStatus {
                    installed: true,
                    version: None,
                    message: "Claude 인증 완료".to_string(),
                    install_hint: None,
                }
            }
            // Auth-specific failures: not logged in
            else if err_lower.contains("auth")
                || err_lower.contains("login")
                || err_lower.contains("credential")
                || err_lower.contains("token")
                || err_lower.contains("unauthorized")
                || err_lower.contains("403")
                || err_lower.contains("401")
            {
                warn!("Claude auth check failed: {e}");
                DependencyStatus {
                    installed: false,
                    version: None,
                    message: "Claude 인증이 필요합니다".to_string(),
                    install_hint: Some(
                        "터미널에서 `claude login` 실행".to_string(),
                    ),
                }
            }
            // Unknown errors — assume authenticated (conservative: don't block user)
            else {
                warn!("Claude auth check: unknown error, assuming OK: {e}");
                DependencyStatus {
                    installed: true,
                    version: None,
                    message: "Claude 인증 확인됨 (일부 경고 있음)".to_string(),
                    install_hint: None,
                }
            }
        }
    }
}

/// Run all environment checks and return aggregated status
pub fn check_environment() -> EnvironmentStatus {
    let claude_cli = check_claude_cli();
    let tmux = check_tmux();
    let claude_auth = check_claude_auth();

    let all_ready = claude_cli.installed && tmux.installed && claude_auth.installed;

    EnvironmentStatus {
        claude_cli,
        tmux,
        claude_auth,
        all_ready,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_check_dependency_exists_known() {
        // `which` itself should always exist
        assert!(check_dependency_exists("which"));
    }

    #[test]
    fn test_check_dependency_exists_unknown() {
        assert!(!check_dependency_exists("nonexistent_binary_xyz_12345"));
    }

    #[test]
    fn test_check_environment_returns_valid_status() {
        let status = check_environment();
        // all_ready should be consistent with individual checks
        assert_eq!(
            status.all_ready,
            status.claude_cli.installed
                && status.tmux.installed
                && status.claude_auth.installed
        );
    }

    #[test]
    fn test_dependency_status_serialization() {
        let status = DependencyStatus {
            installed: true,
            version: Some("1.0.0".to_string()),
            message: "설치됨".to_string(),
            install_hint: None,
        };
        let json = serde_json::to_string(&status).expect("serialize failed");
        assert!(json.contains("\"installed\":true"));
        assert!(json.contains("\"installHint\":null"));
    }

    #[test]
    fn test_environment_status_serialization() {
        let status = EnvironmentStatus {
            claude_cli: DependencyStatus {
                installed: true,
                version: Some("1.0.0".to_string()),
                message: "OK".to_string(),
                install_hint: None,
            },
            tmux: DependencyStatus {
                installed: false,
                version: None,
                message: "미설치".to_string(),
                install_hint: Some("brew install tmux".to_string()),
            },
            claude_auth: DependencyStatus {
                installed: true,
                version: None,
                message: "인증됨".to_string(),
                install_hint: None,
            },
            all_ready: false,
        };
        let json = serde_json::to_string(&status).expect("serialize failed");
        assert!(json.contains("\"claudeCli\""));
        assert!(json.contains("\"claudeAuth\""));
        assert!(json.contains("\"allReady\":false"));
    }
}
