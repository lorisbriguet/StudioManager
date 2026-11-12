-- Agent orchestrator, part 1: captures and briefs.
-- See docs/superpowers/specs/2026-11-12-agent-orchestrator-design.md.
CREATE TABLE IF NOT EXISTS captures (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    text TEXT NOT NULL,
    source TEXT NOT NULL CHECK (source IN ('hotkey', 'menubar', 'agent', 'reminders')),
    status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'filed', 'dismissed')),
    -- The project picked when capturing (Tab), then the one it was filed under.
    project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
    task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
    subtask_id INTEGER REFERENCES subtasks(id) ON DELETE SET NULL,
    outcome TEXT CHECK (outcome IN ('note', 'needs_word', 'ready')),
    -- Set by the brief session when no project fits: the capture stays new
    -- and is not sent to a session again.
    inbox_reason TEXT,
    brief_tries INTEGER NOT NULL DEFAULT 0,
    -- Apple Reminders' id of the reminder it came from: read once only.
    reminder_id TEXT UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_captures_status ON captures(status);
ALTER TABLE tasks ADD COLUMN brief TEXT DEFAULT NULL;
ALTER TABLE tasks ADD COLUMN stage TEXT DEFAULT NULL CHECK (stage IN ('briefed', 'ready', 'running', 'to_check'));
ALTER TABLE subtasks ADD COLUMN brief TEXT DEFAULT NULL;
ALTER TABLE subtasks ADD COLUMN stage TEXT DEFAULT NULL CHECK (stage IN ('briefed', 'ready', 'running', 'to_check'));
