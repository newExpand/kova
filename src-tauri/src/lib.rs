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
        .plugin(tauri_plugin_pty::init())
        .setup(|app| {
            // Initialize database
            let db = DbConnection::initialize(app)?;
            app.manage(Mutex::new(db));

            // Start event server
            let event_server = EventServer::start(app.handle().clone())
                .map_err(|e| Box::new(e) as Box<dyn std::error::Error>)?;
            let port = event_server.port();
            tracing::info!("Event server running on port {}", port);
            app.manage(Mutex::new(event_server));

            // Re-inject hooks for all active projects with the new port
            {
                let db_state = app.state::<Mutex<DbConnection>>();
                let db_guard = db_state.lock();
                if let Ok(db) = db_guard {
                    match services::project::list(&db.conn) {
                        Ok(projects) => {
                            for project in &projects {
                                if let Err(e) = services::hooks::inject_hooks(
                                    std::path::Path::new(&project.path),
                                    port,
                                ) {
                                    tracing::warn!(
                                        "Hook injection failed for '{}': {}",
                                        project.name, e
                                    );
                                }
                            }
                            tracing::info!(
                                "Injected hooks for {} active project(s)",
                                projects.len()
                            );
                        }
                        Err(e) => {
                            tracing::warn!("Failed to list projects for hook injection: {}", e);
                        }
                    }
                }
            }

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
            commands::tmux::create_tmux_session,
            commands::tmux::kill_tmux_session,
            commands::tmux::split_tmux_pane_horizontal,
            commands::tmux::split_tmux_pane_vertical,
            commands::tmux::close_tmux_pane,
            commands::tmux::list_tmux_windows,
            commands::tmux::create_tmux_window,
            commands::tmux::close_tmux_window,
            commands::tmux::next_tmux_window,
            commands::tmux::previous_tmux_window,
            commands::tmux::register_tmux_session,
            commands::tmux::unregister_tmux_session,
            commands::tmux::send_tmux_keys,
            commands::tmux::list_tmux_sessions_with_ownership,
            // Notification commands
            commands::notification::list_project_notifications,
            // Settings commands
            commands::settings::get_setting,
            commands::settings::set_setting,
            commands::settings::list_settings,
            // Environment commands
            commands::environment::check_environment,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
