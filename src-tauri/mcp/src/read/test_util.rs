//! Shared fixtures for the read tests: a fictional database and a date
//! parser.

use crate::test_support::{seed_app_db, temp_data_dir};
use chrono::NaiveDate;
use rusqlite::Connection;

pub(crate) fn d(s: &str) -> NaiveDate {
    NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap()
}

/// Fictional fixture: two clients, four projects, tasks, wiki, tools.
pub(crate) fn fixture() -> Connection {
    let dir = temp_data_dir();
    let path = seed_app_db(&dir, "org1");
    let conn = Connection::open(path).unwrap();
    conn.execute_batch(
        "
        INSERT INTO clients (id, name, email, phone, language) VALUES
          ('C-001', 'Atelier Lumen', 'hello@lumen.test', '+41 00 000 00 00', 'FR'),
          ('C-002', 'Éditions Boréale', 'info@boreale.test', '', 'EN');
        INSERT INTO client_contacts (client_id, first_name, last_name, email, role)
          VALUES ('C-001', 'Ada', 'Moreau', 'ada@lumen.test', 'Director');
        INSERT INTO projects (id, client_id, name, status, deadline, notes, folder_path) VALUES
          (1, 'C-001', 'Identité Visuelle', 'active', '2026-11-05', 'Brand notes', '/work/lumen/identity/'),
          (2, 'C-001', 'Site Web', 'on_hold', '2026-10-01', '', '/work/lumen/site'),
          (3, 'C-002', 'Catalogue Printemps', 'active', NULL, '', NULL),
          (9, 'C-002', 'Catalogue Automne', 'cancelled', '2026-10-30', '', NULL);
        INSERT INTO tasks (id, project_id, title, status, priority, due_date, sort_order) VALUES
          (1, 1, 'Logo variants', 'in_progress', 'high', '2026-10-29', 1),
          (2, 1, 'Final files', 'done', 'low', '2026-10-20', 2),
          (3, 2, 'Wireframes', 'todo', 'medium', '2026-10-25', 1),
          (4, 3, 'Layout grid', 'todo', 'medium', '2027-01-01', 1),
          (5, 9, 'Cancelled work', 'todo', 'medium', '2026-10-28', 1);
        INSERT INTO subtasks (id, task_id, title, status, due_date, sort_order) VALUES
          (1, 1, 'Monochrome', 'todo', '2026-10-28', 1),
          (2, 1, 'Reversed', 'done', '2026-10-26', 2);
        INSERT INTO resources (id, name, url) VALUES (1, 'Figma', 'https://figma.test'), (2, 'Unused', 'x');
        INSERT INTO resource_projects (resource_id, project_id) VALUES (1, 1);
        INSERT INTO wiki_articles (id, project_id, title, content, sort_order) VALUES
          (1, 1, 'Brief', '<h2>Goals</h2><p>Fresh &amp; clear</p>', 1),
          (2, 1, 'Decisions', '<ul><li><p><strong>2026-10-01</strong> Use blue</p></li><li><p>Keep it &lt;simple&gt;</p></li></ul>', 2);
        ",
    )
    .unwrap();
    conn
}
