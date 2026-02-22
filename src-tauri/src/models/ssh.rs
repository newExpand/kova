use serde::{Deserialize, Serialize};

/// SSH authentication type
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SshAuthType {
    Key,
    Agent,
}

impl std::fmt::Display for SshAuthType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SshAuthType::Key => write!(f, "key"),
            SshAuthType::Agent => write!(f, "agent"),
        }
    }
}

impl SshAuthType {
    pub fn from_str_value(s: &str) -> Option<Self> {
        match s {
            "key" => Some(SshAuthType::Key),
            "agent" => Some(SshAuthType::Agent),
            _ => None,
        }
    }
}

/// SSH connection profile matching database schema
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshConnection {
    pub id: String,
    pub name: String,
    pub host: String,
    pub port: i32,
    pub username: String,
    pub auth_type: SshAuthType,
    pub key_path: Option<String>,
    pub project_id: Option<String>,
    pub is_default: bool,
    pub created_at: String,
    pub updated_at: String,
}

/// Input for creating a new SSH connection
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSshConnectionInput {
    pub name: String,
    pub host: String,
    #[serde(default = "default_port")]
    pub port: i32,
    pub username: String,
    #[serde(default = "default_auth_type")]
    pub auth_type: SshAuthType,
    pub key_path: Option<String>,
    pub project_id: Option<String>,
    #[serde(default)]
    pub is_default: bool,
}

/// Input for updating an existing SSH connection
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSshConnectionInput {
    pub name: Option<String>,
    pub host: Option<String>,
    pub port: Option<i32>,
    pub username: Option<String>,
    pub auth_type: Option<SshAuthType>,
    pub key_path: Option<String>,
    pub project_id: Option<String>,
    pub is_default: Option<bool>,
}

/// Result of an SSH connect action
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshConnectResult {
    pub connection_id: String,
    pub connection_name: String,
    pub window_name: String,
    pub session_name: String,
}

/// Result of an SSH connection test
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshTestResult {
    pub success: bool,
    pub message: String,
}

fn default_port() -> i32 {
    22
}

fn default_auth_type() -> SshAuthType {
    SshAuthType::Key
}
