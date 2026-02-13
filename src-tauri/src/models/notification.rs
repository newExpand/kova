use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationRecord {
    pub id: String,
    pub project_id: String,
    pub event_type: String,
    pub title: String,
    pub message: Option<String>,
    pub payload: Option<String>,
    pub created_at: String,
}
