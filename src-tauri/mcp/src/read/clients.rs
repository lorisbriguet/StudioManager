use super::*;

pub fn list_clients(
    conn: &Connection,
    text: Option<&str>,
    include_archived: bool,
) -> R<Vec<ClientRef>> {
    let mut stmt = db(conn.prepare(
        "SELECT id, name, COALESCE(email, ''), archived_at FROM clients \
         WHERE (?1 OR archived_at IS NULL) ORDER BY id",
    ))?;
    let mut rows = db(stmt
        .query_map([include_archived], |r| {
            Ok(ClientRef {
                id: r.get(0)?,
                name: r.get(1)?,
                email: r.get(2)?,
                archived_at: r.get(3)?,
            })
        })
        .and_then(|rows| rows.collect::<rusqlite::Result<Vec<_>>>()))?;
    if let Some(t) = text.map(fold).filter(|t| !t.trim().is_empty()) {
        let t = t.trim();
        rows.retain(|c| fold(&c.name).contains(t) || fold(&c.email).contains(t));
    }
    sort_by_name(&mut rows, |c| &c.name);
    Ok(rows)
}

pub fn get_client(conn: &Connection, client: &str) -> R<ClientDetail> {
    let id = resolve_client(conn, client)?;
    let (name, email, phone, a1, a2, lang, notes, archived_at) = db(conn.query_row(
        "SELECT name, COALESCE(email,''), COALESCE(phone,''), COALESCE(address_line1,''), \
                COALESCE(address_line2,''), language, COALESCE(notes,''), archived_at \
         FROM clients WHERE id = ?1",
        [&id],
        |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, String>(4)?,
                r.get::<_, String>(5)?,
                r.get::<_, String>(6)?,
                r.get::<_, Option<String>>(7)?,
            ))
        },
    ))?;
    let mut cstmt = db(conn.prepare(
        "SELECT first_name, last_name, COALESCE(email,''), COALESCE(phone,''), COALESCE(role,'') \
         FROM client_contacts WHERE client_id = ?1 ORDER BY id",
    ))?;
    let contacts = db(cstmt
        .query_map([&id], |r| {
            Ok(Contact {
                first_name: r.get(0)?,
                last_name: r.get(1)?,
                email: r.get(2)?,
                phone: r.get(3)?,
                role: r.get(4)?,
            })
        })
        .and_then(|rows| rows.collect::<rusqlite::Result<Vec<_>>>()))?;
    let mut projects: Vec<ProjectRef> = all_projects(conn)?
        .into_iter()
        .filter(|p| p.client_id == id)
        .collect();
    sort_by_name(&mut projects, |p| &p.name);
    Ok(ClientDetail {
        id,
        name,
        email,
        phone,
        address_line1: a1,
        address_line2: a2,
        language: lang,
        notes,
        archived_at,
        contacts,
        projects,
    })
}

#[cfg(test)]
mod tests {
    use crate::read::test_util::*;
    use crate::read::*;
    use super::*;

    #[test]
    fn clients() {
        let c = fixture();
        let all = list_clients(&c, None, false).unwrap();
        assert_eq!(
            all.iter().map(|x| x.id.as_str()).collect::<Vec<_>>(),
            ["C-001", "C-002"]
        );
        assert_eq!(list_clients(&c, Some("BOREALE"), false).unwrap().len(), 1);
        let det = get_client(&c, "C-001").unwrap();
        assert_eq!(det.projects.len(), 2);
        assert_eq!(det.contacts[0].last_name, "Moreau");
        assert_eq!(det.language, "FR");
    }

    #[test]
    fn archived_clients_are_hidden_but_reachable_by_id() {
        let c = fixture();
        c.execute(
            "UPDATE clients SET archived_at = '2026-11-06 10:00:00' WHERE id = 'C-002'",
            [],
        )
        .unwrap();
        let ids = |v: Vec<ClientRef>| v.into_iter().map(|x| x.id).collect::<Vec<_>>();
        assert_eq!(ids(list_clients(&c, None, false).unwrap()), ["C-001"]);
        assert!(list_clients(&c, Some("boreale"), false).unwrap().is_empty());
        let all = list_clients(&c, None, true).unwrap();
        assert_eq!(ids(all.clone()), ["C-001", "C-002"]);
        assert_eq!(all[0].archived_at, None);
        assert_eq!(all[1].archived_at.as_deref(), Some("2026-11-06 10:00:00"));
        // Name matching skips it; the error points at the id.
        let e = resolve_client(&c, "editions boreale").unwrap_err();
        assert!(e.starts_with("No client matches"), "{e}");
        assert!(e.contains("archived"), "{e}");
        // Ids still resolve, and get_client says it is archived.
        assert_eq!(resolve_client(&c, "C-002").unwrap(), "C-002");
        let det = get_client(&c, "C-002").unwrap();
        assert_eq!(det.archived_at.as_deref(), Some("2026-11-06 10:00:00"));
        assert_eq!(get_client(&c, "C-001").unwrap().archived_at, None);
        // A project of the archived client still shows it.
        c.execute(
            "UPDATE clients SET archived_at = NULL WHERE id = 'C-001'",
            [],
        )
        .unwrap();
        let p = all_projects(&c).unwrap();
        assert!(p.iter().any(|p| p.client_id == "C-002"));
    }

    #[test]
    fn name_matching_ignores_archived_duplicate() {
        let c = fixture();
        c.execute(
            "INSERT INTO clients (id, name, archived_at) VALUES ('C-003', 'atelier lumen', '2026-11-06')",
            [],
        )
        .unwrap();
        assert_eq!(get_client(&c, "Atelier Lumen").unwrap().id, "C-001");
    }

}
