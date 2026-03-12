use serde::{Deserialize, Serialize};

/// AI agent types supported by flow-orche
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AgentType {
    ClaudeCode,
    CodexCli,
    GeminiCli,
}

impl AgentType {
    /// The CLI command (without worktree flags) to launch this agent
    pub fn base_command(&self) -> &'static str {
        match self {
            AgentType::ClaudeCode => "claude --dangerously-skip-permissions",
            AgentType::CodexCli => "codex",
            AgentType::GeminiCli => "gemini --yolo",
        }
    }

    /// Command with worktree flag (only Claude Code supports --worktree)
    pub fn worktree_command(&self, task_name: &str) -> String {
        match self {
            AgentType::ClaudeCode => {
                format!("claude --dangerously-skip-permissions --worktree {}", task_name)
            }
            // Other agents don't have worktree support — just launch base command
            _ => self.base_command().to_string(),
        }
    }

    /// Display name for UI
    pub fn display_name(&self) -> &'static str {
        match self {
            AgentType::ClaudeCode => "Claude Code",
            AgentType::CodexCli => "Codex CLI",
            AgentType::GeminiCli => "Gemini CLI",
        }
    }

    /// Process name patterns for tmux pane detection
    pub fn process_names(&self) -> &'static [&'static str] {
        match self {
            AgentType::ClaudeCode => &["claude"],
            AgentType::CodexCli => &["codex"],
            AgentType::GeminiCli => &["gemini"],
        }
    }

    /// Whether this agent type supports hooks/event integration
    pub fn supports_hooks(&self) -> bool {
        matches!(self, AgentType::ClaudeCode)
    }

    /// Convert from DB string (stored as snake_case).
    /// Unknown values fall back to ClaudeCode for backward compatibility.
    pub fn from_db_str(s: &str) -> Self {
        match s {
            "claude_code" | "" => AgentType::ClaudeCode,
            "codex_cli" => AgentType::CodexCli,
            "gemini_cli" => AgentType::GeminiCli,
            other => {
                tracing::warn!("Unknown agent_type '{}', defaulting to ClaudeCode", other);
                AgentType::ClaudeCode
            }
        }
    }

    /// Convert to DB string
    pub fn to_db_str(&self) -> &'static str {
        match self {
            AgentType::ClaudeCode => "claude_code",
            AgentType::CodexCli => "codex_cli",
            AgentType::GeminiCli => "gemini_cli",
        }
    }
}

#[allow(clippy::derivable_impls)]
impl Default for AgentType {
    fn default() -> Self {
        AgentType::ClaudeCode
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_base_command() {
        assert_eq!(
            AgentType::ClaudeCode.base_command(),
            "claude --dangerously-skip-permissions"
        );
        assert_eq!(AgentType::CodexCli.base_command(), "codex");
        assert_eq!(AgentType::GeminiCli.base_command(), "gemini --yolo");
    }

    #[test]
    fn test_worktree_command() {
        assert_eq!(
            AgentType::ClaudeCode.worktree_command("fix-auth"),
            "claude --dangerously-skip-permissions --worktree fix-auth"
        );
        assert_eq!(AgentType::CodexCli.worktree_command("fix-auth"), "codex");
        assert_eq!(
            AgentType::GeminiCli.worktree_command("fix-auth"),
            "gemini --yolo"
        );
    }

    #[test]
    fn test_supports_hooks() {
        assert!(AgentType::ClaudeCode.supports_hooks());
        assert!(!AgentType::CodexCli.supports_hooks());
        assert!(!AgentType::GeminiCli.supports_hooks());
    }

    #[test]
    fn test_db_str_roundtrip() {
        for agent in &[
            AgentType::ClaudeCode,
            AgentType::CodexCli,
            AgentType::GeminiCli,
        ] {
            let db_str = agent.to_db_str();
            let roundtrip = AgentType::from_db_str(db_str);
            assert_eq!(*agent, roundtrip);
        }
    }

    #[test]
    fn test_from_db_str_unknown_defaults_to_claude() {
        assert_eq!(AgentType::from_db_str("unknown"), AgentType::ClaudeCode);
        assert_eq!(AgentType::from_db_str(""), AgentType::ClaudeCode);
    }

    #[test]
    fn test_process_names() {
        assert_eq!(AgentType::ClaudeCode.process_names(), &["claude"]);
        assert_eq!(AgentType::CodexCli.process_names(), &["codex"]);
        assert_eq!(AgentType::GeminiCli.process_names(), &["gemini"]);
    }
}
