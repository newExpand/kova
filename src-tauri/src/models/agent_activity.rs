use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentActivityRecord {
    pub id: String,
    pub project_id: String,
    pub event_type: String,
    pub session_id: Option<String>,
    pub worktree_path: Option<String>,
    pub summary: Option<String>,
    pub payload: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AgentStatus {
    Active,
    Idle,
    Done,
    Error,
}

// TODO: Planned for future get_session_summary IPC command.
// Currently, session state is tracked in the frontend AgentSessionState (agentActivityStore.ts).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSessionSummary {
    pub project_id: String,
    pub session_id: String,
    pub status: AgentStatus,
    pub tool_use_count: u32,
    pub file_edit_count: u32,
    pub commit_count: u32,
    pub subagent_count: u32,
    pub last_activity: String,
    pub last_message: Option<String>,
}
