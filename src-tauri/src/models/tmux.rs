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
