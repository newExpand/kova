use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    pub modified: String,
    pub extension: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileContent {
    pub content: String,
    pub language: String,
    pub path: String,
    pub size: u64,
    pub is_binary: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileSearchResult {
    pub path: String,
    pub name: String,
    pub extension: Option<String>,
    pub score: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContentSearchMatch {
    pub line_number: u32,
    pub line_content: String,
    pub match_start: u32,
    pub match_end: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContentSearchFileResult {
    pub path: String,
    pub matches: Vec<ContentSearchMatch>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContentSearchResult {
    pub files: Vec<ContentSearchFileResult>,
    pub total_matches: u32,
    pub total_files: u32,
    pub truncated: bool,
    pub duration_ms: u64,
}

/// Strategy for resolving filename conflicts during external copy.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ConflictStrategy {
    Skip,
    AutoRename,
    Overwrite,
}

/// Result of copying external files/folders into a project.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CopyResult {
    pub entries: Vec<FileEntry>,
    pub skipped: Vec<String>,
    pub total_bytes_copied: u64,
}
