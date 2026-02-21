use thiserror::Error;

#[derive(Error, Debug)]
pub enum AppError {
    #[error("Not found: {0}")]
    NotFound(String),

    #[error("Database error: {0}")]
    Database(#[from] rusqlite::Error),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Invalid JSON: {0}")]
    InvalidJson(#[from] serde_json::Error),

    #[error("Tmux command failed: {0}")]
    TmuxCommand(String),

    #[error("Hook error: {0}")]
    Hook(String),

    #[error("Event server error: {0}")]
    EventServer(String),

    #[error("Git command failed: {0}")]
    Git(String),

    #[error("Internal error: {0}")]
    Internal(String),

    #[error("Invalid input: {0}")]
    InvalidInput(String),

    #[error("Duplicate entry: {0}")]
    Duplicate(String),
}

// Custom Serialize implementation for Tauri IPC
// Converts error to string message for frontend consumption
impl serde::Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(self.to_string().as_ref())
    }
}
