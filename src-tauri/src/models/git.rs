use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum GitRefType {
    LocalBranch,
    RemoteBranch,
    Tag,
    Head,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitRef {
    pub name: String,
    pub ref_type: GitRefType,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommit {
    pub hash: String,
    pub short_hash: String,
    pub message: String,
    pub author_name: String,
    pub author_email: String,
    pub date: String,
    pub parents: Vec<String>,
    pub refs: Vec<GitRef>,
    pub is_agent_commit: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FileStatus {
    Added,
    Modified,
    Deleted,
    Renamed,
    Untracked,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffStats {
    pub files_changed: u32,
    pub insertions: u32,
    pub deletions: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileDiff {
    pub path: String,
    pub status: FileStatus,
    pub insertions: u32,
    pub deletions: u32,
    pub patch: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitDetail {
    pub hash: String,
    pub full_message: String,
    pub is_agent_commit: bool,
    pub stats: DiffStats,
    pub files: Vec<FileDiff>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitBranch {
    pub name: String,
    pub is_remote: bool,
    pub is_head: bool,
    pub commit_hash: String,
    pub tracking_branch: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitWorktree {
    pub path: String,
    pub branch: Option<String>,
    pub commit_hash: String,
    pub is_bare: bool,
    pub is_main: bool,
    pub status: Option<GitStatus>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatus {
    pub is_dirty: bool,
    pub staged_count: u32,
    pub unstaged_count: u32,
    pub untracked_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkingChanges {
    pub worktree_path: String,
    pub staged: Vec<FileDiff>,
    pub unstaged: Vec<FileDiff>,
    pub untracked: Vec<FileDiff>,
    pub stats: DiffStats,
}

impl WorkingChanges {
    /// Construct with auto-computed stats from the three file lists.
    pub fn new(
        worktree_path: String,
        staged: Vec<FileDiff>,
        unstaged: Vec<FileDiff>,
        untracked: Vec<FileDiff>,
    ) -> Self {
        let total = (staged.len() + unstaged.len() + untracked.len()) as u32;
        let ins: u32 = staged.iter().chain(unstaged.iter()).chain(untracked.iter()).map(|f| f.insertions).sum();
        let del: u32 = staged.iter().chain(unstaged.iter()).chain(untracked.iter()).map(|f| f.deletions).sum();
        Self {
            worktree_path,
            staged,
            unstaged,
            untracked,
            stats: DiffStats { files_changed: total, insertions: ins, deletions: del },
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitResult {
    pub short_hash: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitGraphData {
    pub commits: Vec<GitCommit>,
    pub branches: Vec<GitBranch>,
    pub worktrees: Vec<GitWorktree>,
    pub status: GitStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitsPage {
    pub commits: Vec<GitCommit>,
    pub has_more: bool,
}

// ---------------------------------------------------------------------------
// Merge to Main types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum MergeToMainStatus {
    Success,
    ConflictsDetected,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MergeToMainResult {
    pub status: MergeToMainStatus,
    pub merge_hash: Option<String>,
    pub branch_name: String,
    pub conflict_details: Option<String>,
    pub worktree_removed: bool,
    pub branch_deleted: bool,
}

impl MergeToMainResult {
    pub fn success(
        merge_hash: String,
        branch_name: String,
        worktree_removed: bool,
        branch_deleted: bool,
    ) -> Self {
        Self {
            status: MergeToMainStatus::Success,
            merge_hash: Some(merge_hash),
            branch_name,
            conflict_details: None,
            worktree_removed,
            branch_deleted,
        }
    }

    pub fn conflicts(branch_name: String, details: String) -> Self {
        Self {
            status: MergeToMainStatus::ConflictsDetected,
            merge_hash: None,
            branch_name,
            conflict_details: Some(details),
            worktree_removed: false,
            branch_deleted: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RebaseStatusResult {
    pub in_progress: bool,
    pub has_conflicts: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitFetchResult {
    pub success: bool,
    pub message: String,
}
