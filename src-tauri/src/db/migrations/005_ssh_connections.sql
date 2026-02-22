-- Migration 005: SSH connection profiles
CREATE TABLE IF NOT EXISTS ssh_connections (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    host TEXT NOT NULL,
    port INTEGER DEFAULT 22 CHECK (port >= 1 AND port <= 65535),
    username TEXT NOT NULL,
    auth_type TEXT NOT NULL DEFAULT 'key' CHECK (auth_type IN ('key', 'agent')),
    key_path TEXT,
    project_id TEXT,
    is_default INTEGER DEFAULT 0 CHECK (is_default IN (0, 1)),
    created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_ssh_project ON ssh_connections(project_id);

INSERT INTO _migrations (version) VALUES (5);
