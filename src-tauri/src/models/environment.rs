use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DependencyStatus {
    pub installed: bool,
    pub version: Option<String>,
    pub message: String,
    pub install_hint: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvironmentStatus {
    pub claude_cli: DependencyStatus,
    pub tmux: DependencyStatus,
    pub claude_auth: DependencyStatus,
    pub all_ready: bool,
}
