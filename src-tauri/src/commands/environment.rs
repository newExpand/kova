use crate::errors::AppError;
use crate::models::environment::EnvironmentStatus;
use crate::services::environment;

#[tauri::command]
pub fn check_environment() -> Result<EnvironmentStatus, AppError> {
    Ok(environment::check_environment())
}

#[tauri::command]
pub fn recheck_environment() -> Result<EnvironmentStatus, AppError> {
    Ok(environment::check_environment())
}
