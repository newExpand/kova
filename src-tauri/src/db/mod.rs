use crate::errors::AppError;
use rusqlite::{Connection, OptionalExtension};
use std::fs;
use tauri::Manager;
use tracing::info;

pub struct DbConnection {
    pub conn: Connection,
}

impl DbConnection {
    pub fn initialize(app: &tauri::App) -> Result<Self, AppError> {
        // 1. Get app data directory (~/.flow-orche/)
        let app_data_dir = app
            .path()
            .app_data_dir()
            .map_err(|e| AppError::Internal(format!("Failed to get app data dir: {}", e)))?;

        // Create directory if it doesn't exist
        fs::create_dir_all(&app_data_dir)?;

        let db_path = app_data_dir.join("flow-orche.db");
        info!("Initializing database at {:?}", db_path);

        // 2. Open SQLite connection and configure security/performance PRAGMAs
        let conn = Connection::open(&db_path)?;
        conn.execute_batch(
            "PRAGMA foreign_keys = ON;
             PRAGMA journal_mode = WAL;
             PRAGMA synchronous = NORMAL;
             PRAGMA temp_store = MEMORY;",
        )?;

        info!("Database PRAGMAs configured (WAL mode, foreign keys ON)");

        // 3. Run migrations
        Self::run_migrations(&conn)?;

        Ok(Self { conn })
    }

    fn run_migrations(conn: &Connection) -> Result<(), AppError> {
        // Create migrations tracking table
        conn.execute(
            "CREATE TABLE IF NOT EXISTS _migrations (
                version INTEGER PRIMARY KEY,
                applied_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
            )",
            [],
        )?;

        // Check if migration 001 has been applied
        let version: Option<i32> = conn
            .query_row(
                "SELECT version FROM _migrations WHERE version = 1",
                [],
                |row| row.get(0),
            )
            .optional()?;

        if version.is_none() {
            info!("Running migration 001_initial.sql");
            let migration_sql = include_str!("migrations/001_initial.sql");
            conn.execute_batch(migration_sql)?;
            conn.execute("INSERT INTO _migrations (version) VALUES (1)", [])?;
            info!("Migration 001 applied successfully");
        } else {
            info!("Migration 001 already applied, skipping");
        }

        // Check if migration 002 has been applied
        let version_2: Option<i32> = conn
            .query_row(
                "SELECT version FROM _migrations WHERE version = 2",
                [],
                |row| row.get(0),
            )
            .optional()?;

        if version_2.is_none() {
            info!("Running migration 002_tmux_sessions.sql");
            let migration_sql = include_str!("migrations/002_tmux_sessions.sql");
            conn.execute_batch(migration_sql)?;
            info!("Migration 002 applied successfully");
        } else {
            info!("Migration 002 already applied, skipping");
        }

        // Check if migration 003 has been applied
        let version_3: Option<i32> = conn
            .query_row(
                "SELECT version FROM _migrations WHERE version = 3",
                [],
                |row| row.get(0),
            )
            .optional()?;

        if version_3.is_none() {
            info!("Running migration 003_app_settings.sql");
            let migration_sql = include_str!("migrations/003_app_settings.sql");
            conn.execute_batch(migration_sql)?;
            conn.execute("INSERT INTO _migrations (version) VALUES (3)", [])?;
            info!("Migration 003 applied successfully");
        } else {
            info!("Migration 003 already applied, skipping");
        }

        // Check if migration 004 has been applied
        let version_4: Option<i32> = conn
            .query_row(
                "SELECT version FROM _migrations WHERE version = 4",
                [],
                |row| row.get(0),
            )
            .optional()?;

        if version_4.is_none() {
            info!("Running migration 004_agent_activity.sql");
            let migration_sql = include_str!("migrations/004_agent_activity.sql");
            conn.execute_batch(migration_sql)?;
            conn.execute("INSERT INTO _migrations (version) VALUES (4)", [])?;
            info!("Migration 004 applied successfully");
        } else {
            info!("Migration 004 already applied, skipping");
        }

        // Check if migration 005 has been applied
        let version_5: Option<i32> = conn
            .query_row(
                "SELECT version FROM _migrations WHERE version = 5",
                [],
                |row| row.get(0),
            )
            .optional()?;

        if version_5.is_none() {
            info!("Running migration 005_ssh_connections.sql");
            let migration_sql = include_str!("migrations/005_ssh_connections.sql");
            conn.execute_batch(migration_sql)?;
            info!("Migration 005 applied successfully");
        } else {
            info!("Migration 005 already applied, skipping");
        }

        // Check if migration 006 has been applied
        let version_6: Option<i32> = conn
            .query_row(
                "SELECT version FROM _migrations WHERE version = 6",
                [],
                |row| row.get(0),
            )
            .optional()?;

        if version_6.is_none() {
            info!("Running migration 006_project_sort_order.sql");

            // Phase 1: DDL — Add column if not already present (idempotent)
            // SQLite has no IF NOT EXISTS for ADD COLUMN, so check manually
            let has_sort_order = conn
                .prepare("SELECT sort_order FROM projects LIMIT 0")
                .is_ok();

            if !has_sort_order {
                conn.execute_batch(
                    "ALTER TABLE projects ADD COLUMN sort_order INTEGER DEFAULT 0;",
                )?;
            }

            // Phase 2: DML — Backfill sort_order based on created_at DESC
            conn.execute_batch(
                "UPDATE projects SET sort_order = (
                    SELECT COUNT(*) FROM projects AS p2
                    WHERE p2.is_active = 1
                      AND (p2.created_at > projects.created_at
                           OR (p2.created_at = projects.created_at AND p2.id < projects.id))
                ) WHERE is_active = 1;",
            )?;

            conn.execute("INSERT INTO _migrations (version) VALUES (6)", [])?;
            info!("Migration 006 applied successfully");
        } else {
            info!("Migration 006 already applied, skipping");
        }

        // Check if migration 007 has been applied
        let version_7: Option<i32> = conn
            .query_row(
                "SELECT version FROM _migrations WHERE version = 7",
                [],
                |row| row.get(0),
            )
            .optional()?;

        if version_7.is_none() {
            info!("Running migration 007_ssh_remote_path.sql");
            let migration_sql = include_str!("migrations/007_ssh_remote_path.sql");
            conn.execute_batch(migration_sql)?;
            conn.execute("INSERT INTO _migrations (version) VALUES (7)", [])?;
            info!("Migration 007 applied successfully");
        } else {
            info!("Migration 007 already applied, skipping");
        }

        // Check if migration 008 has been applied
        let version_8: Option<i32> = conn
            .query_row(
                "SELECT version FROM _migrations WHERE version = 8",
                [],
                |row| row.get(0),
            )
            .optional()?;

        if version_8.is_none() {
            info!("Running migration 008_project_agent_type.sql");
            let migration_sql = include_str!("migrations/008_project_agent_type.sql");
            conn.execute_batch(migration_sql)?;
            conn.execute("INSERT INTO _migrations (version) VALUES (8)", [])?;
            info!("Migration 008 applied successfully");
        } else {
            info!("Migration 008 already applied, skipping");
        }

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use rusqlite::Connection;

    #[test]
    fn test_sql_injection_prevented() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(include_str!("migrations/001_initial.sql"))
            .unwrap();

        // Attempt SQL injection (should be safely handled by parameterized query)
        let malicious = "'; DROP TABLE projects; --";
        let result = conn.execute(
            "INSERT INTO projects (id, name, path) VALUES (?1, ?2, ?3)",
            ["test-id", malicious, "/tmp/test"],
        );
        assert!(result.is_ok());

        // Verify table still exists
        let count: i32 = conn
            .query_row("SELECT COUNT(*) FROM projects", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn test_foreign_key_cascade() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute("PRAGMA foreign_keys = ON", []).unwrap();
        conn.execute_batch(include_str!("migrations/001_initial.sql"))
            .unwrap();

        // Insert project
        conn.execute(
            "INSERT INTO projects (id, name, path) VALUES (?1, ?2, ?3)",
            ["proj1", "Test Project", "/tmp/test"],
        )
        .unwrap();

        // Insert notification
        conn.execute(
            "INSERT INTO notification_history (id, project_id, event_type, title) VALUES (?1, ?2, ?3, ?4)",
            ["notif1", "proj1", "test", "Test Notification"],
        )
        .unwrap();

        // Delete project (should cascade delete notification)
        conn.execute("DELETE FROM projects WHERE id = ?1", ["proj1"])
            .unwrap();

        // Verify notification was deleted
        let count: i32 = conn
            .query_row(
                "SELECT COUNT(*) FROM notification_history WHERE id = ?1",
                ["notif1"],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn test_check_constraints() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(include_str!("migrations/001_initial.sql"))
            .unwrap();

        // Valid color_index (0-7)
        let result = conn.execute(
            "INSERT INTO projects (id, name, path, color_index) VALUES (?1, ?2, ?3, ?4)",
            ["proj1", "Test", "/tmp/test", "5"],
        );
        assert!(result.is_ok());

        // Invalid color_index (> 7)
        let result = conn.execute(
            "INSERT INTO projects (id, name, path, color_index) VALUES (?1, ?2, ?3, ?4)",
            ["proj2", "Test2", "/tmp/test2", "8"],
        );
        assert!(result.is_err());

        // Invalid is_active (not 0 or 1)
        let result = conn.execute(
            "INSERT INTO projects (id, name, path, is_active) VALUES (?1, ?2, ?3, ?4)",
            ["proj3", "Test3", "/tmp/test3", "2"],
        );
        assert!(result.is_err());
    }
}
