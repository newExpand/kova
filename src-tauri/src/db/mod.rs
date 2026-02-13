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
