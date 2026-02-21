CREATE TABLE IF NOT EXISTS agent_activity (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    session_id TEXT,
    worktree_path TEXT,
    summary TEXT,
    payload TEXT,
    created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_agent_activity_project ON agent_activity(project_id);
CREATE INDEX IF NOT EXISTS idx_agent_activity_session ON agent_activity(session_id);
CREATE INDEX IF NOT EXISTS idx_agent_activity_created ON agent_activity(created_at);
