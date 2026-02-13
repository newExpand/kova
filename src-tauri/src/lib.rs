pub mod commands;
pub mod db;
pub mod errors;
pub mod models;
pub mod services;

use db::DbConnection;
use services::event_server::EventServer;
use std::sync::Mutex;
use tauri::Manager;
use tracing_subscriber::EnvFilter;

pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::from_default_env()
                .add_directive("flow_orche=info".parse().unwrap()),
        )
        .init();

    tracing::info!("Starting Flow Orche");

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            // Initialize database
            let db = DbConnection::initialize(app)?;
            app.manage(Mutex::new(db));

            // Start event server
            let event_server = EventServer::start(app.handle().clone())
                .map_err(|e| Box::new(e) as Box<dyn std::error::Error>)?;
            tracing::info!("Event server running on port {}", event_server.port());
            app.manage(Mutex::new(event_server));

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Project commands
            commands::project::create_project,
            commands::project::list_projects,
            commands::project::get_project,
            commands::project::update_project,
            commands::project::delete_project,
            commands::project::restore_project,
            commands::project::purge_project,
            // Hooks commands
            commands::hooks::inject_project_hooks,
            commands::hooks::remove_project_hooks,
            // tmux commands
            commands::tmux::check_tmux_available,
            commands::tmux::list_tmux_sessions,
            commands::tmux::list_tmux_panes,
            // Notification commands
            commands::notification::list_project_notifications,
            // Environment commands
            commands::environment::check_environment,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
