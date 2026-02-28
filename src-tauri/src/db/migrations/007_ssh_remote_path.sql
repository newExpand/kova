-- Migration 007: Add remote_project_path to SSH connections
-- Allows SSH connections to reference a remote git repository for the SSH Git Graph feature.
ALTER TABLE ssh_connections ADD COLUMN remote_project_path TEXT;
