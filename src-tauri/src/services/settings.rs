use crate::errors::AppError;
use crate::models::settings::AppSetting;
use rusqlite::{params, Connection, OptionalExtension};
use tracing::info;

/// Get a setting value by key. Returns None if not found.
pub fn get(conn: &Connection, key: &str) -> Result<Option<String>, AppError> {
    let value: Option<String> = conn
        .query_row(
            "SELECT value FROM app_settings WHERE key = ?1",
            params![key],
            |row| row.get(0),
        )
        .optional()?;

    Ok(value)
}

/// Get a setting value by key, returning a default if not found.
pub fn get_with_default(conn: &Connection, key: &str, default: &str) -> String {
    match get(conn, key) {
        Ok(Some(value)) => value,
        _ => default.to_string(),
    }
}

/// Set (upsert) a setting value.
pub fn set(conn: &Connection, key: &str, value: &str) -> Result<(), AppError> {
    conn.execute(
        "INSERT OR REPLACE INTO app_settings (key, value, updated_at)
         VALUES (?1, ?2, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))",
        params![key, value],
    )?;

    info!("Setting updated: {}", key);
    Ok(())
}

/// List all settings.
pub fn list(conn: &Connection) -> Result<Vec<AppSetting>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT key, value, updated_at FROM app_settings ORDER BY key",
    )?;

    let settings = stmt
        .query_map([], |row| {
            Ok(AppSetting {
                key: row.get(0)?,
                value: row.get(1)?,
                updated_at: row.get(2)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(settings)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn setup_test_db() -> Connection {
        let conn = Connection::open_in_memory().expect("Failed to open in-memory DB");
        conn.execute_batch(include_str!("../db/migrations/003_app_settings.sql"))
            .expect("Failed to create app_settings table");
        conn
    }

    #[test]
    fn test_get_set_round_trip() {
        let conn = setup_test_db();

        set(&conn, "notification_style", "banner").expect("Should set");
        let val = get(&conn, "notification_style").expect("Should get");
        assert_eq!(val, Some("banner".to_string()));
    }

    #[test]
    fn test_default_fallback() {
        let conn = setup_test_db();

        let val = get_with_default(&conn, "nonexistent_key", "fallback_value");
        assert_eq!(val, "fallback_value");
    }

    #[test]
    fn test_upsert_overwrites() {
        let conn = setup_test_db();

        set(&conn, "theme", "dark").expect("Should set");
        set(&conn, "theme", "light").expect("Should overwrite");
        let val = get(&conn, "theme").expect("Should get");
        assert_eq!(val, Some("light".to_string()));
    }

    #[test]
    fn test_list_all_settings() {
        let conn = setup_test_db();

        set(&conn, "alpha_key", "value1").expect("Should set");
        set(&conn, "beta_key", "value2").expect("Should set");

        let settings = list(&conn).expect("Should list");
        assert_eq!(settings.len(), 2);
        assert_eq!(settings[0].key, "alpha_key");
        assert_eq!(settings[1].key, "beta_key");
    }

    #[test]
    fn test_sql_injection_prevented() {
        let conn = setup_test_db();

        let malicious_key = "'; DROP TABLE app_settings; --";
        set(&conn, malicious_key, "evil").expect("Should handle safely");

        // Verify table still exists and value was stored
        let val = get(&conn, malicious_key).expect("Should get");
        assert_eq!(val, Some("evil".to_string()));

        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM app_settings", [], |r| r.get(0))
            .expect("Table should still exist");
        assert_eq!(count, 1);
    }
}
