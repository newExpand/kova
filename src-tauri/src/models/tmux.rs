use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TmuxSession {
    pub name: String,
    pub windows: i32,
    pub created: String,
    pub attached: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TmuxPane {
    pub session_name: String,
    pub window_index: i32,
    pub pane_index: i32,
    pub pane_title: String,
    pub pane_current_command: String,
    pub pane_active: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TmuxWindow {
    pub session_name: String,
    pub window_index: i32,
    pub window_name: String,
    pub window_active: bool,
    pub window_panes: i32,
}

/// DB record mapping a tmux session to a project
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectTmuxSession {
    pub id: String,
    pub project_id: String,
    pub session_name: String,
    pub created_at: String,
}

/// Combined session info: live tmux data + DB ownership
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionInfo {
    pub name: String,
    pub windows: i32,
    pub created: String,
    pub attached: bool,
    pub is_app_session: bool,
    pub project_id: Option<String>,
}
