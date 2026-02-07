use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

use rusqlite::Connection;
use tracing::info;

use crate::errors::AppError;

const MIGRATION_001: &str = include_str!("migrations/001_initial.sql");

pub struct DbConnection {
    pub conn: Mutex<Connection>,
}

impl DbConnection {
    pub fn new(db_path: &PathBuf) -> Result<Self, AppError> {
        if let Some(parent) = db_path.parent() {
            fs::create_dir_all(parent)?;
        }

        let conn = Connection::open(db_path)?;

        conn.execute_batch("PRAGMA journal_mode=WAL;")?;
        conn.execute_batch("PRAGMA foreign_keys=ON;")?;

        let db = Self {
            conn: Mutex::new(conn),
        };

        db.run_migrations()?;

        info!("DB initialized at: {:?}", db_path);

        Ok(db)
    }

    fn run_migrations(&self) -> Result<(), AppError> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| AppError::Internal(format!("DB lock failed: {e}")))?;

        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS _migrations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
            );",
        )?;

        let count: i32 = conn
            .prepare("SELECT COUNT(*) FROM _migrations WHERE name = ?1")?
            .query_row(rusqlite::params!["001_initial"], |row| row.get(0))?;
        let already_applied = count > 0;

        if !already_applied {
            conn.execute_batch(MIGRATION_001)?;
            conn.execute(
                "INSERT INTO _migrations (name) VALUES (?1)",
                rusqlite::params!["001_initial"],
            )?;
            info!("Applied migration: 001_initial");
        }

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_db_initialization() {
        let dir = tempfile::tempdir().expect("Failed to create temp dir");
        let db_path = dir.path().join("test.db");

        let db = DbConnection::new(&db_path).expect("DB init failed");

        let conn = db.conn.lock().expect("Lock failed");

        let table_count: i32 = conn
            .prepare(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ('projects', 'team_sessions')",
            )
            .expect("Prepare failed")
            .query_row([], |row| row.get(0))
            .expect("Query failed");

        assert_eq!(table_count, 2, "projects and team_sessions tables should exist");
    }

    #[test]
    fn test_migration_idempotent() {
        let dir = tempfile::tempdir().expect("Failed to create temp dir");
        let db_path = dir.path().join("test.db");

        let _db1 = DbConnection::new(&db_path).expect("First init failed");
        drop(_db1);

        let db2 = DbConnection::new(&db_path).expect("Second init failed");

        let conn = db2.conn.lock().expect("Lock failed");
        let migration_count: i32 = conn
            .prepare("SELECT COUNT(*) FROM _migrations")
            .expect("Prepare failed")
            .query_row([], |row| row.get(0))
            .expect("Query failed");

        assert_eq!(migration_count, 1, "Migration should only be applied once");
    }
}
