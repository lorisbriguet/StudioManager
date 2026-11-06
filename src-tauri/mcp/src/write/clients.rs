use super::*;

pub fn create_client(
    dir: &Path,
    org: &Org,
    name: &str,
    email: Option<&str>,
    language: Option<&str>,
) -> R<ClientResult> {
    let name = required(name, "Name")?;
    let email = capped(email.unwrap_or(""), "Email")?.trim().to_string();
    let language = match language.unwrap_or("FR").trim().to_uppercase().as_str() {
        "FR" => "FR",
        "EN" => "EN",
        _ => return Err(LANGUAGE.to_string()),
    };
    write(dir, org, "create_client", |tx| {
        let mut stmt = db(tx.prepare("SELECT id, name FROM clients ORDER BY id"))?;
        let existing: Vec<(String, String)> = db(stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
            .and_then(|rows| rows.collect()))?;
        if let Some((id, n)) = existing.iter().find(|(_, n)| fold(n.trim()) == fold(&name)) {
            return Err(format!("A client named \"{n}\" already exists (id {id})."));
        }
        // Same numbering as the app's getNextClientId.
        let max: Option<i64> = db(tx.query_row(
            "SELECT MAX(CAST(SUBSTR(id, 3) AS INTEGER)) FROM clients",
            [],
            |r| r.get(0),
        ))?;
        let id = format!("C-{:03}", max.unwrap_or(0) + 1);
        db(tx.execute(
            "INSERT INTO clients (id, name, billing_name, email, language) \
             VALUES (?1, ?2, ?2, ?3, ?4)",
            params![id, name, email, language],
        ))?;
        let summary = format!("Created client \"{name}\" ({id})");
        Ok((
            ClientResult {
                org: org.name.clone(),
                id,
                name: name.clone(),
                language: language.to_string(),
            },
            Some(summary),
        ))
    })
}


#[cfg(test)]
mod tests {
    use crate::write::test_util::*;
    use super::*;

    #[test]
    fn create_client_happy_path() {
        let (dir, org, conn) = fixture();
        let r = create_client(
            &dir,
            &org,
            "Studio Nord",
            Some("nord@studio.test"),
            Some("en"),
        )
        .unwrap();
        assert_eq!(r.org, "Studio");
        assert_eq!(r.name, "Studio Nord");
        assert_eq!(r.language, "EN");
        let (email, billing): (String, String) = conn
            .query_row(
                "SELECT email, billing_name FROM clients WHERE id = ?1",
                [&r.id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(email, "nord@studio.test");
        assert_eq!(billing, "Studio Nord");
        let r = create_client(&dir, &org, "Studio Sud", None, None).unwrap();
        assert_eq!(r.language, "FR");
        assert_eq!(
            create_client(&dir, &org, "X", None, Some("DE")).unwrap_err(),
            "Language must be FR or EN."
        );
        let err = create_client(&dir, &org, "atelier lumen", None, None).unwrap_err();
        assert!(err.contains("C-001"), "{err}");
    }

    #[test]
    fn client_id_next() {
        let (dir, org, _conn) = fixture();
        let r = create_client(&dir, &org, "Studio Nord", None, None).unwrap();
        assert_eq!(r.id, "C-010");
        let r = create_client(&dir, &org, "Studio Sud", None, None).unwrap();
        assert_eq!(r.id, "C-011");
    }

}
