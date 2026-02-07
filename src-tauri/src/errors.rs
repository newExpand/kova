use serde::Serialize;

#[derive(thiserror::Error, Debug)]
#[allow(dead_code)]
pub enum AppError {
    #[error("프로젝트를 찾을 수 없습니다: {0}")]
    NotFound(String),

    #[error("데이터베이스 오류: {0}")]
    Database(#[from] rusqlite::Error),

    #[error("IO 오류: {0}")]
    Io(#[from] std::io::Error),

    #[error("직렬화 오류: {0}")]
    Serialization(#[from] serde_json::Error),

    #[error("tmux 세션 오류: {0}")]
    Tmux(String),

    #[error("내부 오류: {0}")]
    Internal(String),
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut state = serializer.serialize_struct("AppError", 2)?;
        state.serialize_field("kind", &self.error_kind())?;
        state.serialize_field("message", &self.to_string())?;
        state.end()
    }
}

impl AppError {
    fn error_kind(&self) -> &'static str {
        match self {
            AppError::NotFound(_) => "NOT_FOUND",
            AppError::Database(_) => "DATABASE",
            AppError::Io(_) => "IO",
            AppError::Serialization(_) => "SERIALIZATION",
            AppError::Tmux(_) => "TMUX",
            AppError::Internal(_) => "INTERNAL",
        }
    }
}
