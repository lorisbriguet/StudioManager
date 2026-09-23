//! Copy the settings-type tables from one organisation database into a
//! freshly migrated one ("start from the current organisation's settings").
//! Tables the frontend creates at runtime (templates) may be absent in the
//! destination: their DDL is copied verbatim from the source's sqlite_master
//! so constraints and AUTOINCREMENT survive.

use std::path::Path;

/// Order matters only for readability; none of these reference each other.
pub const SETTINGS_TABLES: &[&str] = &[
    "business_profile",
    "activities",
    "expense_categories",
    "invoice_templates",
    "workload_templates",
];

pub fn copy_settings_tables(src: &Path, dest: &Path) -> Result<Vec<String>, String> {
    let conn = rusqlite::Connection::open(dest).map_err(|e| format!("open destination: {e}"))?;
    conn.execute("ATTACH DATABASE ?1 AS src", [src.to_string_lossy().as_ref()])
        .map_err(|e| format!("attach source: {e}"))?;
    let mut copied = Vec::new();
    conn.execute_batch("BEGIN").map_err(|e| format!("begin: {e}"))?;
    let result = (|| -> Result<(), String> {
        for table in SETTINGS_TABLES {
            let ddl: Option<String> = conn
                .query_row(
                    "SELECT sql FROM src.sqlite_master WHERE type='table' AND name=?1",
                    [table],
                    |r| r.get(0),
                )
                .ok();
            let Some(ddl) = ddl else { continue };
            // The destination is always a freshly created, empty organisation
            // database (migration seed rows only), so it's safe to drop and
            // recreate the table from the source's own DDL: that's the only way
            // to guarantee the column set matches what `SELECT *` below yields,
            // since the source may have runtime-added columns (e.g. the
            // frontend's schema step) that the destination's migration-era
            // shape doesn't have.
            conn.execute(&format!("DROP TABLE IF EXISTS main.\"{table}\""), []).map_err(|e| format!("drop {table}: {e}"))?;
            conn.execute_batch(&ddl).map_err(|e| format!("create {table}: {e}"))?;
            conn.execute(&format!("INSERT INTO main.\"{table}\" SELECT * FROM src.\"{table}\""), [])
                .map_err(|e| format!("copy {table}: {e}"))?;
            copied.push((*table).to_string());
        }
        Ok(())
    })();
    let final_result = match result {
        Ok(()) => conn.execute_batch("COMMIT").map_err(|e| format!("commit: {e}")).map(|()| copied),
        Err(e) => {
            let _ = conn.execute_batch("ROLLBACK");
            Err(e)
        }
    };
    let _ = conn.execute("DETACH DATABASE src", []);
    final_result
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn temp_db(name: &str) -> std::path::PathBuf {
        let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
        std::env::temp_dir().join(format!("sm-seed-{nanos}-{name}.db"))
    }

    #[test]
    fn copies_profile_activities_categories_and_frontend_created_tables() {
        let src = temp_db("src");
        let dest = temp_db("dest");
        crate::migrate::migrate_db(&src).unwrap();
        crate::migrate::migrate_db(&dest).unwrap();
        let s = Connection::open(&src).unwrap();
        s.execute_batch(
            "UPDATE business_profile SET owner_name='Loris' WHERE id=1;
             INSERT INTO activities (name_fr, name_en, sort_order) VALUES ('Graphisme','Graphic Design',0);
             UPDATE expense_categories SET name_en='Rent!' WHERE code='LO';
             CREATE TABLE invoice_templates (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, is_default INTEGER NOT NULL DEFAULT 0);
             INSERT INTO invoice_templates (name, is_default) VALUES ('Default', 1);
             INSERT INTO clients (id, name) VALUES ('C-001', 'Should not copy');",
        )
        .unwrap();
        drop(s);

        let copied = copy_settings_tables(&src, &dest).unwrap();
        // workload_templates is created by migration 005 (not frontend-created like
        // invoice_templates), so it already exists — empty — in both src and dest
        // and is still synced (DELETE+INSERT of zero rows counts as "copied").
        assert_eq!(
            copied,
            vec!["business_profile", "activities", "expense_categories", "invoice_templates", "workload_templates"]
        );

        let d = Connection::open(&dest).unwrap();
        let owner: String = d.query_row("SELECT owner_name FROM business_profile WHERE id=1", [], |r| r.get(0)).unwrap();
        assert_eq!(owner, "Loris");
        let acts: i64 = d.query_row("SELECT COUNT(*) FROM activities", [], |r| r.get(0)).unwrap();
        assert_eq!(acts, 1);
        let rent: String = d.query_row("SELECT name_en FROM expense_categories WHERE code='LO'", [], |r| r.get(0)).unwrap();
        assert_eq!(rent, "Rent!");
        let tpl_sql: String = d
            .query_row("SELECT sql FROM sqlite_master WHERE name='invoice_templates'", [], |r| r.get(0))
            .unwrap();
        assert!(tpl_sql.contains("AUTOINCREMENT"), "DDL copied verbatim");
        let clients: i64 = d.query_row("SELECT COUNT(*) FROM clients", [], |r| r.get(0)).unwrap();
        assert_eq!(clients, 0);
    }

    #[test]
    fn copies_runtime_added_columns_absent_from_destinations_migrated_shape() {
        let src = temp_db("src-runtime-cols");
        let dest = temp_db("dest-runtime-cols");
        crate::migrate::migrate_db(&src).unwrap();
        crate::migrate::migrate_db(&dest).unwrap();
        let s = Connection::open(&src).unwrap();
        s.execute_batch(
            "ALTER TABLE business_profile ADD COLUMN qr_iban TEXT;
             ALTER TABLE expense_categories ADD COLUMN color TEXT;
             UPDATE business_profile SET qr_iban='CH21 3080 8001 2345 6782 7' WHERE id=1;
             UPDATE expense_categories SET color='#ff0000';",
        )
        .unwrap();
        drop(s);

        let copied = copy_settings_tables(&src, &dest).unwrap();
        // invoice_templates is frontend-created (see the other test); this test
        // never creates it in src, so it's absent from both and not copied.
        assert_eq!(copied, vec!["business_profile", "activities", "expense_categories", "workload_templates"]);

        let d = Connection::open(&dest).unwrap();
        let qr_iban: String =
            d.query_row("SELECT qr_iban FROM business_profile WHERE id=1", [], |r| r.get(0)).unwrap();
        assert_eq!(qr_iban, "CH21 3080 8001 2345 6782 7");
        let cats: i64 = d.query_row("SELECT COUNT(*) FROM expense_categories", [], |r| r.get(0)).unwrap();
        assert_eq!(cats, 6);
        let color_count: i64 =
            d.query_row("SELECT COUNT(*) FROM expense_categories WHERE color='#ff0000'", [], |r| r.get(0)).unwrap();
        assert_eq!(color_count, 6);
    }
}
