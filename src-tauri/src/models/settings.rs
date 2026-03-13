use crate::models::agent_type::AgentType;

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AppSetting {
    pub key: String,
    pub value: String,
    pub updated_at: String,
}

#[derive(serde::Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AgentCommandInfo {
    pub agent_type: AgentType,
    pub label: String,
    pub command: String,
    pub default_command: String,
}

impl AgentCommandInfo {
    /// Construct with `label` and `default_command` derived from the agent type,
    /// preventing inconsistency with `display_name()` / `base_command()`.
    pub fn new(agent_type: AgentType, command: String) -> Self {
        Self {
            label: agent_type.display_name().to_string(),
            default_command: agent_type.base_command().to_string(),
            agent_type,
            command,
        }
    }
}
