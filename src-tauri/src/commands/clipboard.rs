use crate::errors::AppError;
use crate::services;

/// Reads the clipboard image and saves it as a PNG temp file.
/// Must be a sync command — macOS NSPasteboard requires main thread access.
#[tauri::command]
pub fn save_clipboard_image_to_temp(
    app: tauri::AppHandle,
) -> Result<String, AppError> {
    services::clipboard::save_clipboard_image(&app)
}
