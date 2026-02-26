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

/// Enrich the process environment for macOS `.app` bundle compatibility.
///
/// macOS `.app` bundles launched via LaunchServices inherit a minimal
/// environment (e.g. PATH = `/usr/bin:/bin:/usr/sbin:/sbin`), missing
/// Homebrew, MacPorts, Nix, and user-local directories. This also means
/// `TERMINFO_DIRS` is unset, so Homebrew-compiled tmux cannot find terminfo
/// entries like `xterm-256color`.
///
/// This function must be called once at startup, before any threads are
/// spawned or child processes created.
fn enrich_env() {
    // ── PATH ──
    const EXTRA_PATHS: &[&str] = &[
        "/opt/homebrew/bin",
        "/opt/homebrew/sbin",
        "/usr/local/bin",
        "/usr/local/sbin",
        "/opt/local/bin",
        "/nix/var/nix/profiles/default/bin",
    ];

    let current_path = std::env::var("PATH").unwrap_or_default();
    let current_entries: std::collections::HashSet<&str> = current_path.split(':').collect();

    let mut enriched: Vec<String> = Vec::new();
    for extra in EXTRA_PATHS {
        if !current_entries.contains(extra) && std::path::Path::new(extra).is_dir() {
            enriched.push(extra.to_string());
        }
    }

    // Also add ~/bin and ~/.local/bin
    let home = std::env::var("HOME").unwrap_or_default();
    if !home.is_empty() {
        for suffix in &["bin", ".local/bin"] {
            let dir = format!("{}/{}", home, suffix);
            if !current_entries.contains(dir.as_str()) && std::path::Path::new(&dir).is_dir() {
                enriched.push(dir);
            }
        }
    }

    if !enriched.is_empty() {
        let new_path = format!("{}:{}", enriched.join(":"), current_path);
        // SAFETY: called once at startup before any threads are spawned
        unsafe { std::env::set_var("PATH", &new_path) };
        tracing::info!("Enriched PATH with: {}", enriched.join(", "));
    }

    // ── TERMINFO_DIRS ──
    // Homebrew tmux links against Homebrew ncurses, which looks for terminfo
    // in its own prefix. Without TERMINFO_DIRS, `xterm-256color` is not found
    // and tmux fails with "terminal does not support clear".
    const TERMINFO_CANDIDATES: &[&str] = &[
        "/opt/homebrew/opt/ncurses/share/terminfo",
        "/opt/homebrew/share/terminfo",
        "/usr/local/opt/ncurses/share/terminfo",
        "/usr/local/share/terminfo",
        "/opt/local/share/terminfo",
        "/usr/share/terminfo",
    ];

    let current_terminfo = std::env::var("TERMINFO_DIRS").unwrap_or_default();
    let existing: std::collections::HashSet<&str> = current_terminfo
        .split(':')
        .filter(|s| !s.is_empty())
        .collect();

    let mut terminfo_dirs: Vec<String> = Vec::new();
    for candidate in TERMINFO_CANDIDATES {
        if !existing.contains(candidate) && std::path::Path::new(candidate).is_dir() {
            terminfo_dirs.push(candidate.to_string());
        }
    }

    if !terminfo_dirs.is_empty() {
        let new_val = if current_terminfo.is_empty() {
            terminfo_dirs.join(":")
        } else {
            format!("{}:{}", terminfo_dirs.join(":"), current_terminfo)
        };
        unsafe { std::env::set_var("TERMINFO_DIRS", &new_val) };
        tracing::info!("Set TERMINFO_DIRS: {}", new_val);
    }

    // ── LANG / LC_ALL ──
    // .app bundles have no locale set → shell defaults to C/POSIX.
    // Unicode block characters (used by Claude Code ASCII art, prompt
    // symbols like ❯ ▸ └) are only rendered when the locale is UTF-8.
    if std::env::var("LANG").unwrap_or_default().is_empty() {
        unsafe { std::env::set_var("LANG", "en_US.UTF-8") };
        tracing::info!("Set LANG=en_US.UTF-8");
    }
}

pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::from_default_env()
                .add_directive("flow_orche=info".parse().unwrap()),
        )
        .init();

    tracing::info!("Starting Clew");

    // Enrich PATH + TERMINFO_DIRS before any child process is spawned
    enrich_env();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_pty::init())
        .setup(|app| {
            // Initialize database
            let db = DbConnection::initialize(app)?;
            app.manage(Mutex::new(db));

            // Prune old notifications on startup
            {
                let db_state = app.state::<Mutex<DbConnection>>();
                if let Ok(db) = db_state.lock() {
                    let retention_days: i64 = services::settings::get_with_default(
                        &db.conn,
                        "notification_retention_days",
                        "7",
                    )
                    .parse()
                    .unwrap_or(7);

                    match services::notification::prune_old_notifications(
                        &db.conn,
                        retention_days,
                    ) {
                        Ok(deleted) => {
                            if deleted > 0 {
                                tracing::info!(
                                    "Startup prune: removed {} old notifications",
                                    deleted
                                );
                            }
                        }
                        Err(e) => {
                            tracing::warn!("Startup notification prune failed: {}", e);
                        }
                    }
                };
            }

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
                                // Also inject hooks for existing worktrees
                                if let Err(e) = services::hooks::inject_hooks_for_worktrees(
                                    std::path::Path::new(&project.path),
                                    port,
                                ) {
                                    tracing::warn!(
                                        "Worktree hook injection failed for '{}': {}",
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
            commands::tmux::kill_all_app_tmux_sessions,
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
            commands::tmux::refresh_tmux_client,
            commands::tmux::send_tmux_keys,
            commands::tmux::list_tmux_sessions_with_ownership,
            commands::tmux::close_tmux_window_by_name,
            // Notification commands
            commands::notification::list_project_notifications,
            commands::notification::prune_notifications,
            // Settings commands
            commands::settings::get_setting,
            commands::settings::set_setting,
            commands::settings::list_settings,
            // Git commands
            commands::git::get_git_graph,
            commands::git::get_git_commits_page,
            commands::git::get_git_status,
            commands::git::get_commit_detail,
            commands::git::get_working_changes,
            commands::git::get_file_diff,
            commands::git::git_stage_files,
            commands::git::git_stage_all,
            commands::git::git_unstage_files,
            commands::git::git_unstage_all,
            commands::git::git_discard_file,
            commands::git::git_create_commit,
            commands::git::git_create_branch,
            commands::git::git_delete_branch,
            commands::git::git_switch_branch,
            commands::git::git_fetch_remote,
            // Agent worktree commands
            commands::agent::start_worktree_task,
            commands::agent::restore_worktree_windows,
            commands::agent::remove_agent_worktree,
            commands::agent::push_git_branch,
            commands::agent::select_tmux_window,
            commands::agent::send_keys_to_tmux_window,
            commands::agent::send_keys_to_tmux_window_delayed,
            // Merge to main commands
            commands::agent::merge_worktree_to_main,
            commands::agent::complete_merge_to_main,
            commands::agent::abort_merge_rebase,
            commands::agent::check_rebase_status,
            commands::agent::prune_stale_worktrees,
            // Agent activity commands
            commands::agent_activity::list_agent_activities,
            // SSH commands
            commands::ssh::create_ssh_connection,
            commands::ssh::list_ssh_connections,
            commands::ssh::list_ssh_connections_by_project,
            commands::ssh::get_ssh_connection,
            commands::ssh::update_ssh_connection,
            commands::ssh::delete_ssh_connection,
            commands::ssh::connect_ssh,
            commands::ssh::connect_ssh_session,
            commands::ssh::check_ssh_remote_tmux,
            commands::ssh::test_ssh_connection,
            commands::ssh::test_ssh_connection_params,
            // File commands
            commands::files::list_directory,
            commands::files::read_file,
            commands::files::write_file,
            commands::files::resolve_import_path,
            // Environment commands
            commands::environment::check_environment,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
