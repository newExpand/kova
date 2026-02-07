use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub name: String,
    pub path: String,
    pub color_index: i32,
    pub account_id: Option<String>,
    pub default_prompt: Option<String>,
    pub is_active: bool,
    pub created_at: String,
    pub updated_at: String,
    /// 경로 존재 여부 (DB 미저장, 조회 시 계산)
    #[serde(default = "default_true")]
    pub path_exists: bool,
}

fn default_true() -> bool {
    true
}
