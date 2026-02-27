-- Add sort_order column for drag-and-drop reordering
ALTER TABLE projects ADD COLUMN sort_order INTEGER DEFAULT 0;

-- Backfill: assign sort_order matching current display order (created_at DESC)
-- sort_order=0 for newest, 1 for next, etc.
-- Uses id as tiebreaker for projects with identical created_at timestamps.
UPDATE projects SET sort_order = (
    SELECT COUNT(*) FROM projects AS p2
    WHERE p2.is_active = 1
      AND (p2.created_at > projects.created_at
           OR (p2.created_at = projects.created_at AND p2.id < projects.id))
)
WHERE is_active = 1;
