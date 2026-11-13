-- Agent orchestrator, part 2: the agents that worked on a task, and its result.
-- See docs/superpowers/specs/2026-11-12-agent-orchestrator-design.md.
CREATE TABLE IF NOT EXISTS task_agents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    -- Exactly one of the two.
    task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
    subtask_id INTEGER REFERENCES subtasks(id) ON DELETE CASCADE,
    -- Filled in by the app once the agent list shows it (claude --bg prints only the short id).
    session_id TEXT,
    short_id TEXT NOT NULL,
    name TEXT NOT NULL,
    model TEXT,
    -- Written by report_result.
    branch TEXT,
    pr_url TEXT,
    reported_at TEXT,
    started_at TEXT NOT NULL DEFAULT (datetime('now')),
    ended_at TEXT,
    -- 'result' or 'no_result' in part 2; no CHECK so part 3 can add values.
    outcome TEXT,
    CHECK ((task_id IS NULL) <> (subtask_id IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_task_agents_task ON task_agents(task_id);
CREATE INDEX IF NOT EXISTS idx_task_agents_subtask ON task_agents(subtask_id);
CREATE INDEX IF NOT EXISTS idx_task_agents_open ON task_agents(ended_at);
ALTER TABLE tasks ADD COLUMN result TEXT DEFAULT NULL;
ALTER TABLE subtasks ADD COLUMN result TEXT DEFAULT NULL;
