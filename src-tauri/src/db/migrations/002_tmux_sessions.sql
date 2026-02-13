-- Project-owned tmux sessions tracking table
CREATE TABLE IF NOT EXISTS project_tmux_sessions (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    session_name TEXT NOT NULL UNIQUE,
    created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- Index for efficient project session lookup
CREATE INDEX IF NOT EXISTS idx_pts_project ON project_tmux_sessions(project_id);

-- Index for fast session name lookup (used in list_sessions_with_ownership)
CREATE INDEX IF NOT EXISTS idx_pts_session ON project_tmux_sessions(session_name);

-- Insert migration version
INSERT INTO _migrations (version) VALUES (2);
