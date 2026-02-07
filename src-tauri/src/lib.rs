mod commands;
mod db;
mod errors;
mod models;
mod services;

use db::DbConnection;
use errors::AppError;
use tauri::Manager;
use tracing::{error, info};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let result = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_log::Builder::default()
                .level(log::LevelFilter::Info)
                .build(),
        )
        .setup(|app| {
            let app_data_dir = app
                .path()
                .app_data_dir()
                .map_err(|e| AppError::Internal(format!("Failed to get app data dir: {e}")))?;

            let db_path = app_data_dir.join("data.db");
            let db = DbConnection::new(&db_path)?;
            app.manage(db);

            info!("flow-orche initialized");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::project::health_check,
            commands::project::create_project,
            commands::project::list_projects,
            commands::project::get_project,
            commands::project::update_project,
            commands::project::delete_project,
            commands::project::restore_project,
            commands::project::purge_project,
            commands::environment::check_environment,
            commands::environment::recheck_environment,
        ])
        .run(tauri::generate_context!());

    if let Err(e) = result {
        error!("Fatal: failed to run Tauri application: {e}");
    }
}
