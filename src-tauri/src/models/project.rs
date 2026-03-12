use serde::{Deserialize, Serialize};

use crate::models::agent_type::AgentType;

/// Project entity matching database schema
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub name: String,
    pub path: String,
    pub color_index: i32,
    pub sort_order: i32,
    pub is_active: bool,
    pub agent_type: AgentType,
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
    #[serde(default)]
    pub agent_type: AgentType,
}

/// Input for updating an existing project
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateProjectInput {
    pub name: Option<String>,
    pub color_index: Option<i32>,
    pub agent_type: Option<AgentType>,
}
