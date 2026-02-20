use crate::errors::AppError;
use std::fs;
use std::path::PathBuf;
use std::process::Command;

/// Directory name under ~/.flow-orche/ for temporary clipboard images.
const CLIPBOARD_DIR: &str = "clipboard-images";

/// Max age in seconds before cleanup removes a file (1 hour).
const MAX_AGE_SECS: u64 = 3600;

/// Returns the clipboard images directory path, creating it if necessary.
fn clipboard_dir() -> Result<PathBuf, AppError> {
    let home = dirs::home_dir()
        .ok_or_else(|| AppError::Internal("Cannot determine home directory".into()))?;
    let dir = home.join(".flow-orche").join(CLIPBOARD_DIR);
    if !dir.exists() {
        fs::create_dir_all(&dir)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&dir, fs::Permissions::from_mode(0o700))?;
        }
    }
    Ok(dir)
}

/// Saves the clipboard image to a PNG file using macOS `osascript`.
///
/// The Tauri clipboard plugin's `read_image()` does not reliably read
/// screenshot images from macOS NSPasteboard. This function bypasses
/// the plugin entirely and uses AppleScript to read the clipboard
/// image data as PNG and write it to a temp file.
///
/// The Tauri host app is NOT sandboxed, so `osascript` works here
/// (unlike PTY subprocesses where sandbox-exec blocks XPC access).
pub fn save_clipboard_image(_app: &tauri::AppHandle) -> Result<String, AppError> {
    let dir = clipboard_dir()?;
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let filename = format!("clipboard-{timestamp}.png");
    let final_path = dir.join(&filename);
    let temp_path = dir.join(format!(".tmp-{filename}"));

    let temp_str = temp_path
        .to_str()
        .ok_or_else(|| AppError::Internal("Path contains invalid UTF-8".into()))?;

    // AppleScript: read clipboard as PNG data («class PNGf»), write to file
    let script = format!(
        r#"try
    set imageData to the clipboard as «class PNGf»
    set filePath to POSIX file "{temp_str}"
    set fileRef to open for access filePath with write permission
    write imageData to fileRef
    close access fileRef
on error errMsg
    error "no_image"
end try"#
    );

    let output = Command::new("osascript")
        .arg("-e")
        .arg(&script)
        .output()
        .map_err(|e| AppError::Internal(format!("osascript spawn failed: {e}")))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        // Clean up temp file if it was partially written
        let _ = fs::remove_file(&temp_path);
        if stderr.contains("no_image") {
            return Err(AppError::NotFound(
                "No image in clipboard".into(),
            ));
        }
        return Err(AppError::Internal(format!(
            "osascript failed: {}",
            stderr.trim()
        )));
    }

    // Set file permissions before rename
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(f) = fs::File::open(&temp_path) {
            let _ = f.set_permissions(fs::Permissions::from_mode(0o600));
        }
    }

    // Atomic rename
    fs::rename(&temp_path, &final_path)?;

    tracing::info!("Saved clipboard image to {}", final_path.display());

    final_path
        .to_str()
        .map(|s| s.to_string())
        .ok_or_else(|| AppError::Internal("Path contains invalid UTF-8".into()))
}

/// Removes clipboard image files older than MAX_AGE_SECS.
/// Called once at app startup. Errors are logged but not propagated.
pub fn cleanup_old_images() {
    let dir = match clipboard_dir() {
        Ok(d) => d,
        Err(_) => return,
    };

    let entries = match fs::read_dir(&dir) {
        Ok(e) => e,
        Err(_) => return,
    };

    let now = std::time::SystemTime::now();
    let mut removed = 0u32;

    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("png") {
            continue;
        }

        let metadata = match fs::metadata(&path) {
            Ok(m) => m,
            Err(_) => continue,
        };

        let age = now
            .duration_since(metadata.modified().unwrap_or(now))
            .unwrap_or_default();

        if age.as_secs() > MAX_AGE_SECS && fs::remove_file(&path).is_ok() {
            removed += 1;
        }
    }

    if removed > 0 {
        tracing::info!("Cleaned up {removed} old clipboard image(s)");
    }
}
