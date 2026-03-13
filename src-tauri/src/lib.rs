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

            // Re-inject hooks with the new port.
            //
            // Global hooks (Gemini, Codex) are injected unconditionally because
            // any project's tmux session can run any agent type simultaneously.
            // Per-project hooks (Claude) are injected for each registered project.
            {
                // Gemini global hooks — always inject
                if let Err(e) = services::hooks::inject_gemini_hooks(port) {
                    tracing::warn!("Gemini hook injection failed: {}", e);
                }

                // Codex notify — always inject (only stable Codex integration)
                if let Err(e) = services::hooks::inject_codex_notify(port) {
                    tracing::warn!("Codex notify injection failed: {}", e);
                }

                // Claude per-project hooks for each registered project
                {
                    let db_state = app.state::<Mutex<DbConnection>>();
                    if let Ok(db) = db_state.lock() {
                        match services::project::list(&db.conn) {
                            Ok(projects) => {
                                let mut count = 0u32;
                                for project in &projects {
                                    if let Err(e) = services::hooks::inject_hooks(
                                        std::path::Path::new(&project.path),
                                        port,
                                    ) {
                                        tracing::warn!(
                                            "Claude hook injection failed for '{}': {}",
                                            project.name, e
                                        );
                                    }
                                    if let Err(e) = services::hooks::inject_hooks_for_worktrees(
                                        std::path::Path::new(&project.path),
                                        port,
                                    ) {
                                        tracing::warn!(
                                            "Worktree hook injection failed for '{}': {}",
                                            project.name, e
                                        );
                                    }
                                    count += 1;
                                }
                                tracing::info!(
                                    "Injected hooks: {} Claude project(s) + Gemini global + Codex global",
                                    count
                                );
                            }
                            Err(e) => {
                                tracing::warn!("Failed to list projects for hook injection: {}", e);
                            }
                        }
                    } else {
                        tracing::error!(
                            "Failed to acquire DB lock for Claude hook injection — no per-project hooks installed"
                        );
                    };
                }
            }

            // Start session monitoring for Codex agents in active tmux sessions.
            // Codex only has `notify` (turn completion → AgentIdle), so pane_monitor
            // is needed for AgentActive/SessionStart/Stop detection.
            // Gemini and Claude have complete hook-based detection — no monitor needed.
            {
                let db_state = app.state::<Mutex<DbConnection>>();
                let project_sessions: Vec<(String, String)> = match db_state.lock() {
                    Ok(db) => {
                        let projects = match services::project::list(&db.conn) {
                            Ok(p) => p,
                            Err(e) => {
                                tracing::error!("Session monitoring: failed to list projects: {}", e);
                                Vec::new()
                            }
                        };
                        let mut pairs = Vec::new();
                        for project in &projects {
                            match db.conn.prepare(
                                "SELECT session_name FROM project_tmux_sessions WHERE project_id = ?1"
                            ) {
                                Ok(mut stmt) => {
                                    match stmt.query_map(
                                        rusqlite::params![&project.id],
                                        |row| row.get::<_, String>(0),
                                    ) {
                                        Ok(rows) => {
                                            for name in rows.flatten() {
                                                pairs.push((project.path.clone(), name));
                                            }
                                        }
                                        Err(e) => {
                                            tracing::warn!(
                                                "Session monitoring: failed to query sessions for '{}': {}",
                                                project.name, e
                                            );
                                        }
                                    }
                                }
                                Err(e) => {
                                    tracing::warn!(
                                        "Session monitoring: failed to prepare statement for '{}': {}",
                                        project.name, e
                                    );
                                }
                            }
                        }
                        pairs
                    }
                    Err(e) => {
                        tracing::error!("Session monitoring: failed to acquire DB lock: {}", e);
                        Vec::new()
                    }
                };

                if !project_sessions.is_empty() {
                    let app_handle = app.handle().clone();
                    std::thread::spawn(move || {
                        std::thread::sleep(std::time::Duration::from_secs(2));

                        let live_sessions = match services::tmux::list_sessions() {
                            Ok(s) => s,
                            Err(e) => {
                                tracing::warn!(
                                    "Session monitoring skipped: failed to list tmux sessions: {}", e
                                );
                                return;
                            }
                        };
                        let live_names: std::collections::HashSet<String> =
                            live_sessions.iter().map(|s| s.name.clone()).collect();

                        for (project_path, session_name) in &project_sessions {
                            if live_names.contains(session_name) {
                                services::pane_monitor::watch_session_agents(
                                    app_handle.clone(),
                                    session_name.clone(),
                                    project_path.clone(),
                                );
                            }
                        }
                    });
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
            commands::project::reorder_projects,
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
            commands::settings::get_agent_commands,
            commands::settings::set_agent_command,
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
            commands::agent::start_session_monitoring,
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
            // Remote git commands (via SSH)
            commands::remote_git::get_remote_git_graph,
            commands::remote_git::get_remote_git_commits_page,
            commands::remote_git::get_remote_commit_detail,
            commands::remote_git::detect_remote_git_paths,
            // Remote tmux commands (via SSH)
            commands::ssh_tmux::remote_tmux_split_pane_vertical,
            commands::ssh_tmux::remote_tmux_split_pane_horizontal,
            commands::ssh_tmux::remote_tmux_close_pane,
            commands::ssh_tmux::remote_tmux_create_window,
            commands::ssh_tmux::remote_tmux_close_window,
            commands::ssh_tmux::remote_tmux_next_window,
            commands::ssh_tmux::remote_tmux_previous_window,
            commands::ssh_tmux::remote_tmux_list_windows,
            commands::ssh_tmux::remote_tmux_list_panes,
            commands::ssh_tmux::remote_tmux_send_keys,
            // File commands
            commands::files::list_directory,
            commands::files::read_file,
            commands::files::write_file,
            commands::files::resolve_import_path,
            commands::files::search_project_files,
            commands::files::search_file_contents,
            commands::files::create_file,
            commands::files::create_directory,
            commands::files::delete_path,
            commands::files::rename_path,
            commands::files::copy_external_files,
            commands::files::copy_external_entries,
            // Environment commands
            commands::environment::check_environment,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
