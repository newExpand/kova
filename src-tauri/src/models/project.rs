use serde::{Deserialize, Serialize};

/// Project entity matching database schema
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub name: String,
    pub path: String,
    pub color_index: i32,
    pub is_active: bool,
    pub created_at: String,
    pub updated_at: String,
}

/// Input for creating a new project
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateProjectInput {
    pub name: String,
    pub path: String,
    #[serde(default)]
    pub color_index: i32,
}

/// Input for updating an existing project
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateProjectInput {
    pub name: Option<String>,
    pub color_index: Option<i32>,
}
