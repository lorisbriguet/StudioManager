-- Agent orchestrator, part 3: what waits on Loris, the watcher's counters, project settings.
-- See docs/superpowers/specs/2026-11-12-agent-orchestrator-design.md.
CREATE TABLE IF NOT EXISTS needs_you (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    -- decide: a question; check: finished work; alone: done by the app or the lead without Loris.
    kind TEXT NOT NULL CHECK (kind IN ('decide', 'check', 'alone')),
    task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
    subtask_id INTEGER REFERENCES subtasks(id) ON DELETE CASCADE,
    link_id INTEGER REFERENCES task_agents(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL DEFAULT '',
    recommendation TEXT,
    options TEXT,                 -- JSON array of strings
    is_decision INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'answered', 'dismissed')),
    answer TEXT,
    decided_by TEXT CHECK (decided_by IN ('user', 'lead', 'app')),
    reason TEXT,
    lead_state TEXT,              -- waiting, running, done, skipped; no CHECK (part 4 may add)
    check_passed INTEGER,         -- null: no check command, or not run
    check_output TEXT,
    change_lines INTEGER,
    touches TEXT,                 -- JSON array of always-asks rules the change touches
    delivered_at TEXT,            -- the answer was typed into the worker
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    answered_at TEXT,
    CHECK ((task_id IS NULL) <> (subtask_id IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_needs_you_status ON needs_you(status, kind);
CREATE INDEX IF NOT EXISTS idx_needs_you_link ON needs_you(link_id);
ALTER TABLE task_agents ADD COLUMN started_by TEXT DEFAULT NULL;   -- 'watcher'; null: by hand
ALTER TABLE task_agents ADD COLUMN worktree TEXT DEFAULT NULL;
ALTER TABLE task_agents ADD COLUMN base_ref TEXT DEFAULT NULL;
ALTER TABLE task_agents ADD COLUMN check_state TEXT DEFAULT NULL;  -- running, passed, failed, none, error
ALTER TABLE task_agents ADD COLUMN resumes INTEGER NOT NULL DEFAULT 0;
ALTER TABLE task_agents ADD COLUMN check_fails INTEGER NOT NULL DEFAULT 0;
ALTER TABLE task_agents ADD COLUMN sent_back INTEGER NOT NULL DEFAULT 0;
ALTER TABLE task_agents ADD COLUMN question_sessions INTEGER NOT NULL DEFAULT 0;
ALTER TABLE task_agents ADD COLUMN check_sessions INTEGER NOT NULL DEFAULT 0;
ALTER TABLE task_agents ADD COLUMN wrap_asked_at TEXT DEFAULT NULL;
ALTER TABLE projects ADD COLUMN check_command TEXT DEFAULT NULL;
ALTER TABLE projects ADD COLUMN merge_alone INTEGER NOT NULL DEFAULT 0;
ALTER TABLE projects ADD COLUMN hub_project INTEGER NOT NULL DEFAULT 0;
