-- Projects table
CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    path TEXT NOT NULL UNIQUE,
    color_index INTEGER DEFAULT 0 CHECK (color_index >= 0 AND color_index <= 7),
    is_active INTEGER DEFAULT 1 CHECK (is_active IN (0, 1)),
    created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- Index for active projects (partial index for WHERE clause optimization)
CREATE INDEX IF NOT EXISTS idx_projects_active ON projects(is_active) WHERE is_active = 1;

-- Notification history table
CREATE TABLE IF NOT EXISTS notification_history (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    title TEXT NOT NULL,
    message TEXT,
    payload TEXT,
    created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- Indexes for notification queries
CREATE INDEX IF NOT EXISTS idx_notifications_project ON notification_history(project_id);
CREATE INDEX IF NOT EXISTS idx_notifications_created ON notification_history(created_at);
