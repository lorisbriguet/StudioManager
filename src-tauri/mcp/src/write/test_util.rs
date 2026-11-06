//! Shared fixtures for the write tests: a fictional database and small
//! query and log readers.

use crate::guard::{self, Org};
use crate::test_support::ready_dir;
use rusqlite::Connection;
use std::path::{Path, PathBuf};

/// Fictional fixture: two clients, three projects, tasks, subtasks, a
/// wiki folder and article, one tool.
pub(crate) fn fixture() -> (PathBuf, Org, Connection) {
    let dir = ready_dir("org001", "Studio");
    let org = guard::resolve_org(&dir, None).unwrap();
    let conn = Connection::open(&org.db).unwrap();
    conn.execute_batch(
        "
        INSERT INTO clients (id, name, email, language) VALUES
          ('C-001', 'Atelier Lumen', 'hello@lumen.test', 'FR'),
          ('C-009', 'Éditions Boréale', 'info@boreale.test', 'EN');
        INSERT INTO projects (id, client_id, name, status, deadline, notes) VALUES
          (1, 'C-001', 'Identité Visuelle', 'active', '2026-11-05', 'Brand notes'),
          (2, 'C-001', 'Site Web', 'on_hold', NULL, ''),
          (3, 'C-009', 'Catalogue Printemps', 'active', NULL, '');
        INSERT INTO tasks (id, project_id, title, status, priority, due_date, sort_order) VALUES
          (1, 1, 'Logo variants', 'in_progress', 'high', '2026-10-29', 1),
          (2, 1, 'Final files', 'todo', 'low', NULL, 4);
        INSERT INTO subtasks (id, task_id, title, status, due_date, sort_order) VALUES
          (1, 1, 'Monochrome', 'todo', NULL, 2),
          (2, 1, 'Reversed', 'todo', NULL, 7);
        INSERT INTO wiki_folders (id, name, sort_order) VALUES (1, 'Other', 3);
        INSERT INTO resources (id, name, url) VALUES (1, 'Figma', 'https://figma.test');
        ",
    )
    .unwrap();
    (dir, org, conn)
}

/// A folder that exists, inside the test's allowed place (the temp dir).
pub(crate) fn real_folder(dir: &Path, name: &str) -> String {
    let f = dir.join("work").join(name);
    std::fs::create_dir_all(&f).unwrap();
    f.to_string_lossy().into_owned()
}

pub(crate) fn one<T: rusqlite::types::FromSql>(conn: &Connection, sql: &str) -> T {
    conn.query_row(sql, [], |r| r.get(0)).unwrap()
}

pub(crate) fn log_lines(dir: &Path) -> Vec<serde_json::Value> {
    std::fs::read_to_string(dir.join(crate::log::LOG_FILE))
        .unwrap_or_default()
        .lines()
        .map(|l| serde_json::from_str(l).unwrap())
        .collect()
}

