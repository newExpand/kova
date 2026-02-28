use crate::db::DbConnection;
use crate::errors::AppError;
use crate::models::tmux::{TmuxPane, TmuxWindow};
use crate::services::{ssh, ssh_tmux};
use std::sync::Mutex;
use tauri::State;

/// Generate a `#[tauri::command]` that looks up an SSH connection by ID,
/// then delegates to `ssh_tmux::$service_fn(&connection, &remote_session_name)`
/// inside a blocking task.
///
/// Covers the 9 commands whose only arguments are (connection_id, remote_session_name).
macro_rules! remote_tmux_command {
    ($fn_name:ident, $service_fn:path, $ret:ty) => {
        #[tauri::command]
        pub async fn $fn_name(
            connection_id: String,
            remote_session_name: String,
            state: State<'_, Mutex<DbConnection>>,
        ) -> Result<$ret, AppError> {
            let connection = {
                let conn = state
                    .lock()
                    .map_err(|_| AppError::Internal("Lock poisoned".into()))?;
                ssh::get(&conn.conn, &connection_id)?
            };
            tauri::async_runtime::spawn_blocking(move || {
                $service_fn(&connection, &remote_session_name)
            })
            .await
            .map_err(|e| AppError::Internal(format!("Task join error: {}", e)))?
        }
    };
}

remote_tmux_command!(remote_tmux_split_pane_vertical, ssh_tmux::split_pane_vertical, ());
remote_tmux_command!(remote_tmux_split_pane_horizontal, ssh_tmux::split_pane_horizontal, ());
remote_tmux_command!(remote_tmux_close_pane, ssh_tmux::close_pane, ());
remote_tmux_command!(remote_tmux_create_window, ssh_tmux::create_window, ());
remote_tmux_command!(remote_tmux_close_window, ssh_tmux::close_window, ());
remote_tmux_command!(remote_tmux_next_window, ssh_tmux::next_window, ());
remote_tmux_command!(remote_tmux_previous_window, ssh_tmux::previous_window, ());
remote_tmux_command!(remote_tmux_list_windows, ssh_tmux::list_windows, Vec<TmuxWindow>);
remote_tmux_command!(remote_tmux_list_panes, ssh_tmux::list_panes, Vec<TmuxPane>);

/// send_keys has an extra `keys` parameter, so it stays manual.
#[tauri::command]
pub async fn remote_tmux_send_keys(
    connection_id: String,
    remote_session_name: String,
    keys: String,
    state: State<'_, Mutex<DbConnection>>,
) -> Result<(), AppError> {
    let connection = {
        let conn = state
            .lock()
            .map_err(|_| AppError::Internal("Lock poisoned".into()))?;
        ssh::get(&conn.conn, &connection_id)?
    };
    tauri::async_runtime::spawn_blocking(move || {
        ssh_tmux::send_keys(&connection, &remote_session_name, &keys)
    })
    .await
    .map_err(|e| AppError::Internal(format!("Task join error: {}", e)))?
}
