//! Money tools: read-only views of invoices, quotes, expenses and the P&L.
//! Only SELECT is used. Bank and payment identifiers (IBAN, QR reference
//! fields) and the business profile are never selected. Every tool first
//! checks the "allow money" switch.

use crate::guard::AccessConfig;
use crate::read::db;
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::Serialize;

type R<T> = Result<T, String>;

pub const MONEY_OFF: &str =
    "Reading invoices, quotes and expenses is off (Settings > Agent access).";

fn check(access: &AccessConfig) -> R<()> {
    if access.allow_money {
        Ok(())
    } else {
        Err(MONEY_OFF.to_string())
    }
}

fn r2(x: f64) -> f64 {
    (x * 100.0).round() / 100.0
}

/// Amount in CHF as the app's P&L counts it (src/db/queries/finance.ts:16):
/// foreign-currency invoices use `chf_equivalent` when it is positive.
const CHF_AMOUNT: &str =
    "CASE WHEN currency != 'CHF' AND chf_equivalent > 0 THEN chf_equivalent ELSE total END";

/// Invoices that went out (finance.ts:9); drafts and cancelled never count.
const COUNTED: &str = "status IN ('sent', 'paid', 'overdue')";

#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct InvoiceRow {
    pub id: i64,
    pub reference: String,
    pub client: String,
    pub status: String,
    pub invoice_date: String,
    pub due_date: Option<String>,
    pub paid_date: Option<String>,
    pub total: f64,
    pub currency: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub chf_equivalent: Option<f64>,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct LineItem {
    pub designation: String,
    pub rate: Option<f64>,
    pub unit: Option<String>,
    pub quantity: f64,
    pub amount: f64,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct InvoiceDetail {
    #[serde(flatten)]
    pub invoice: InvoiceRow,
    pub project: Option<String>,
    pub activity: String,
    pub assignment: String,
    pub po_number: Option<String>,
    pub subtotal: f64,
    pub discount_rate: Option<f64>,
    pub notes: String,
    pub line_items: Vec<LineItem>,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct QuoteRow {
    pub id: i64,
    pub reference: String,
    pub client: String,
    pub status: String,
    pub quote_date: String,
    pub valid_until: Option<String>,
    pub total: f64,
    pub currency: &'static str,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct ExpenseRow {
    pub id: i64,
    pub reference: String,
    pub supplier: String,
    pub category: String,
    pub invoice_date: String,
    pub due_date: Option<String>,
    pub paid_date: Option<String>,
    pub amount: f64,
    pub currency: &'static str,
    pub notes: String,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct Pnl {
    pub year: i32,
    pub month: Option<u32>,
    pub income: f64,
    pub invoice_income: f64,
    pub other_income: f64,
    pub expenses: f64,
    pub result: f64,
    pub currency: &'static str,
}

fn invoice_row(r: &Row) -> rusqlite::Result<InvoiceRow> {
    let currency: String = r.get(8)?;
    let chf: f64 = r.get(9)?;
    let chf_equivalent = (currency != "CHF" && chf > 0.0).then(|| r2(chf));
    Ok(InvoiceRow {
        id: r.get(0)?,
        reference: r.get(1)?,
        client: r.get(2)?,
        status: r.get(3)?,
        invoice_date: r.get(4)?,
        due_date: r.get(5)?,
        paid_date: r.get(6)?,
        total: r2(r.get(7)?),
        currency,
        chf_equivalent,
    })
}

const INVOICE_SELECT: &str = "SELECT i.id, i.reference, COALESCE(c.name, ''), i.status,
       i.invoice_date, i.due_date, i.paid_date, i.total, i.currency, i.chf_equivalent
     FROM invoices i LEFT JOIN clients c ON c.id = i.client_id";

/// `status` is an exact status, or "unpaid" (sent or overdue: what the app
/// counts as open balance, finance.ts:160). `year` filters on invoice date.
pub fn list_invoices(
    conn: &Connection,
    access: &AccessConfig,
    status: Option<&str>,
    year: Option<i32>,
) -> R<Vec<InvoiceRow>> {
    check(access)?;
    let status = status.map(|s| s.trim().to_lowercase());
    let year = year.map(|y| y.to_string());
    let sql = format!(
        "{INVOICE_SELECT}
         WHERE (?1 IS NULL OR (?1 = 'unpaid' AND i.status IN ('sent','overdue')) OR i.status = ?1)
           AND (?2 IS NULL OR strftime('%Y', i.invoice_date) = ?2)
         ORDER BY i.invoice_date DESC, i.id DESC"
    );
    let mut stmt = db(conn.prepare(&sql))?;
    let rows = db(stmt.query_map(params![status, year], invoice_row))?;
    db(rows.collect())
}

/// By reference (e.g. "2026-001") or numeric id; includes line items.
pub fn get_invoice(
    conn: &Connection,
    access: &AccessConfig,
    reference_or_id: &str,
) -> R<InvoiceDetail> {
    check(access)?;
    let key = reference_or_id.trim();
    let sql = format!(
        "{INVOICE_SELECT} WHERE i.reference = ?1 COLLATE NOCASE OR CAST(i.id AS TEXT) = ?1"
    );
    let invoice = db(conn.query_row(&sql, params![key], invoice_row).optional())?
        .ok_or_else(|| format!("No invoice matches \"{key}\"."))?;
    let (
        project,
        activity,
        assignment,
        po_number,
        subtotal,
        discount_applied,
        discount_rate,
        notes,
    ) = db(conn.query_row(
        "SELECT p.name, COALESCE(i.activity, ''), COALESCE(i.assignment, ''), i.po_number,
                    i.subtotal, i.discount_applied, i.discount_rate, COALESCE(i.notes, '')
             FROM invoices i LEFT JOIN projects p ON p.id = i.project_id WHERE i.id = ?1",
        params![invoice.id],
        |r| {
            Ok((
                r.get::<_, Option<String>>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, Option<String>>(3)?,
                r.get::<_, f64>(4)?,
                r.get::<_, i64>(5)?,
                r.get::<_, f64>(6)?,
                r.get::<_, String>(7)?,
            ))
        },
    ))?;
    let mut stmt = db(conn.prepare(
        "SELECT designation, rate, unit, quantity, amount FROM invoice_line_items
         WHERE invoice_id = ?1 ORDER BY sort_order, id",
    ))?;
    let line_items = db(stmt
        .query_map(params![invoice.id], |r| {
            Ok(LineItem {
                designation: r.get(0)?,
                rate: r.get::<_, Option<f64>>(1)?.map(r2),
                unit: r.get(2)?,
                quantity: r.get(3)?,
                amount: r2(r.get(4)?),
            })
        })
        .and_then(|rows| rows.collect::<rusqlite::Result<Vec<_>>>()))?;
    Ok(InvoiceDetail {
        invoice,
        project,
        activity,
        assignment,
        po_number,
        subtotal: r2(subtotal),
        discount_rate: (discount_applied != 0).then_some(discount_rate),
        notes,
        line_items,
    })
}

/// Quotes have no currency column: the app issues them in CHF.
pub fn list_quotes(
    conn: &Connection,
    access: &AccessConfig,
    status: Option<&str>,
    year: Option<i32>,
) -> R<Vec<QuoteRow>> {
    check(access)?;
    let status = status.map(|s| s.trim().to_lowercase());
    let year = year.map(|y| y.to_string());
    let mut stmt = db(conn.prepare(
        "SELECT q.id, q.reference, COALESCE(c.name, ''), q.status, q.quote_date, q.valid_until, q.total
         FROM quotes q LEFT JOIN clients c ON c.id = q.client_id
         WHERE (?1 IS NULL OR q.status = ?1)
           AND (?2 IS NULL OR strftime('%Y', q.quote_date) = ?2)
         ORDER BY q.quote_date DESC, q.id DESC",
    ))?;
    let rows = db(stmt.query_map(params![status, year], |r| {
        Ok(QuoteRow {
            id: r.get(0)?,
            reference: r.get(1)?,
            client: r.get(2)?,
            status: r.get(3)?,
            quote_date: r.get(4)?,
            valid_until: r.get(5)?,
            total: r2(r.get(6)?),
            currency: "CHF",
        })
    }))?;
    db(rows.collect())
}

fn check_month(month: Option<u32>) -> R<Option<String>> {
    match month {
        None => Ok(None),
        Some(m) if (1..=12).contains(&m) => Ok(Some(format!("{m:02}"))),
        Some(m) => Err(format!("Month must be 1 to 12, got {m}.")),
    }
}

/// Expenses are stored in CHF (no currency column). Dated by `invoice_date`.
pub fn list_expenses(
    conn: &Connection,
    access: &AccessConfig,
    year: Option<i32>,
    month: Option<u32>,
) -> R<Vec<ExpenseRow>> {
    check(access)?;
    let month = check_month(month)?;
    let year = year.map(|y| y.to_string());
    let mut stmt = db(conn.prepare(
        "SELECT e.id, e.reference, e.supplier, COALESCE(ec.name_en, e.category_code),
                e.invoice_date, e.due_date, e.paid_date, e.amount, COALESCE(e.notes, '')
         FROM expenses e LEFT JOIN expense_categories ec ON ec.code = e.category_code
         WHERE (?1 IS NULL OR strftime('%Y', e.invoice_date) = ?1)
           AND (?2 IS NULL OR strftime('%m', e.invoice_date) = ?2)
         ORDER BY e.invoice_date DESC, e.id DESC",
    ))?;
    let rows = db(stmt.query_map(params![year, month], |r| {
        Ok(ExpenseRow {
            id: r.get(0)?,
            reference: r.get(1)?,
            supplier: r.get(2)?,
            category: r.get(3)?,
            invoice_date: r.get(4)?,
            due_date: r.get(5)?,
            paid_date: r.get(6)?,
            amount: r2(r.get(7)?),
            currency: "CHF",
            notes: r.get(8)?,
        })
    }))?;
    db(rows.collect())
}

/// P&L in CHF, mirroring `getPLData` (src/db/queries/finance.ts:11-64):
/// - income = sent/paid/overdue invoices by `invoice_date` (finance.ts:16-19,
///   CHF via `chf_equivalent`) + the `income` table by `date` (finance.ts:22-27);
/// - expenses = every `expenses` row by `invoice_date` whose category exists,
///   operating and social charges together (finance.ts:30-51);
/// - result = income - expenses (`net_result`, finance.ts:62).
///
/// The app reports per year; the optional month narrows all three the same
/// way `getMonthlyData` does (finance.ts:72-117).
pub fn pnl_summary(
    conn: &Connection,
    access: &AccessConfig,
    year: i32,
    month: Option<u32>,
) -> R<Pnl> {
    check(access)?;
    let month_s = check_month(month)?;
    let year_s = year.to_string();
    let sum = |sql: String| -> R<f64> {
        db(conn.query_row(&sql, params![year_s, month_s], |r| r.get::<_, f64>(0)))
    };
    let inv = sum(format!(
        "SELECT COALESCE(SUM({CHF_AMOUNT}), 0) FROM invoices
         WHERE strftime('%Y', invoice_date) = ?1 AND (?2 IS NULL OR strftime('%m', invoice_date) = ?2)
           AND {COUNTED}"
    ))?;
    let other = sum("SELECT COALESCE(SUM(amount), 0) FROM income
         WHERE strftime('%Y', date) = ?1 AND (?2 IS NULL OR strftime('%m', date) = ?2)"
        .to_string())?;
    let exp = sum("SELECT COALESCE(SUM(e.amount), 0) FROM expenses e
         JOIN expense_categories ec ON e.category_code = ec.code
         WHERE strftime('%Y', e.invoice_date) = ?1
           AND (?2 IS NULL OR strftime('%m', e.invoice_date) = ?2)"
        .to_string())?;
    let income = inv + other;
    Ok(Pnl {
        year,
        month,
        income: r2(income),
        invoice_income: r2(inv),
        other_income: r2(other),
        expenses: r2(exp),
        result: r2(income - exp),
        currency: "CHF",
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::{seed_app_db, temp_data_dir};

    fn on() -> AccessConfig {
        AccessConfig {
            enabled: true,
            allow_money: true,
            ..Default::default()
        }
    }

    /// Fictional fixture: CHF and EUR invoices, a draft, a quote, expenses, side income.
    fn fixture() -> Connection {
        let dir = temp_data_dir();
        let conn = Connection::open(seed_app_db(&dir, "org1")).unwrap();
        conn.execute_batch(
            "
            INSERT INTO clients (id, name) VALUES ('C-001', 'Atelier Lumen'), ('C-002', 'Editions Boreale');
            INSERT INTO projects (id, client_id, name) VALUES (1, 'C-001', 'Identity');
            INSERT INTO invoices (id, reference, client_id, project_id, status, invoice_date, due_date, paid_date,
                                  subtotal, total, currency, exchange_rate, chf_equivalent, activity, po_number,
                                  pdf_path, notes) VALUES
              (1, '2026-001', 'C-001', 1, 'paid', '2026-02-10', '2026-03-12', '2026-03-01', 1000, 1000, 'CHF', 1, 1000, 'Branding', 'PO-7', '/x/a.pdf', ''),
              (2, '2026-002', 'C-002', NULL, 'sent', '2026-03-05', '2026-04-04', NULL, 500, 500, 'EUR', 0.95, 475, '', NULL, NULL, 'EUR job'),
              (3, '2026-003', 'C-001', NULL, 'draft', '2026-03-20', NULL, NULL, 9000, 9000, 'CHF', 1, 9000, '', NULL, NULL, ''),
              (4, '2025-009', 'C-001', NULL, 'overdue', '2025-12-01', '2025-12-31', NULL, 200, 200, 'CHF', 1, 200, '', NULL, NULL, '');
            INSERT INTO invoice_line_items (invoice_id, designation, rate, unit, quantity, amount, sort_order) VALUES
              (1, 'Logo', 100, 'h', 6, 600, 2), (1, 'Guidelines', 100, 'h', 4, 400, 1);
            INSERT INTO quotes (id, reference, client_id, status, quote_date, valid_until, total) VALUES
              (1, 'D-2026-001', 'C-001', 'sent', '2026-01-15', '2026-02-15', 2500),
              (2, 'D-2025-004', 'C-002', 'accepted', '2025-11-01', NULL, 800);
            INSERT INTO expense_categories (code, name_fr, name_en, pl_section) VALUES
              ('T-OP', 'Outils', 'Tools', 'operating'), ('T-SC', 'Social', 'Social', 'social_charges');
            INSERT INTO expenses (id, reference, supplier, category_code, invoice_date, amount) VALUES
              (1, 'F-26-001', 'Fonts Co', 'T-OP', '2026-02-02', 120.5),
              (2, 'F-26-002', 'Insurer', 'T-SC', '2026-03-02', 300),
              (3, 'F-25-001', 'Old Co', 'T-OP', '2025-12-02', 50);
            INSERT INTO income (reference, date, amount) VALUES ('R-1', '2026-03-15', 80), ('R-0', '2025-01-01', 10);
            ",
        )
        .unwrap();
        conn
    }

    #[test]
    fn money_off_refused() {
        let c = fixture();
        let off = AccessConfig {
            enabled: true,
            ..Default::default()
        };
        let msg = MONEY_OFF.to_string();
        assert_eq!(list_invoices(&c, &off, None, None).unwrap_err(), msg);
        assert_eq!(get_invoice(&c, &off, "2026-001").unwrap_err(), msg);
        assert_eq!(list_quotes(&c, &off, None, None).unwrap_err(), msg);
        assert_eq!(list_expenses(&c, &off, None, None).unwrap_err(), msg);
        assert_eq!(pnl_summary(&c, &off, 2026, None).unwrap_err(), msg);
    }

    #[test]
    fn invoices_list_and_filters() {
        let c = fixture();
        let all = list_invoices(&c, &on(), None, None).unwrap();
        assert_eq!(all.len(), 4);
        assert_eq!(all[0].reference, "2026-003");
        let y = list_invoices(&c, &on(), None, Some(2026)).unwrap();
        assert_eq!(y.len(), 3);
        let unpaid = list_invoices(&c, &on(), Some("unpaid"), None).unwrap();
        let refs: Vec<_> = unpaid.iter().map(|i| i.reference.as_str()).collect();
        assert_eq!(refs, ["2026-002", "2025-009"]);
        let eur = &unpaid[0];
        assert_eq!(
            (eur.currency.as_str(), eur.chf_equivalent),
            ("EUR", Some(475.0))
        );
        let paid = list_invoices(&c, &on(), Some("PAID"), None).unwrap();
        assert_eq!(paid.len(), 1);
        assert_eq!(paid[0].chf_equivalent, None);
        assert_eq!(paid[0].client, "Atelier Lumen");
    }

    #[test]
    fn get_invoice_with_lines_and_no_bank_fields() {
        let c = fixture();
        let d = get_invoice(&c, &on(), "2026-001").unwrap();
        assert_eq!(d.project.as_deref(), Some("Identity"));
        assert_eq!(d.po_number.as_deref(), Some("PO-7"));
        let names: Vec<_> = d
            .line_items
            .iter()
            .map(|l| l.designation.as_str())
            .collect();
        assert_eq!(names, ["Guidelines", "Logo"]);
        assert_eq!(
            get_invoice(&c, &on(), "2").unwrap().invoice.reference,
            "2026-002"
        );
        let json = serde_json::to_string(&d).unwrap().to_lowercase();
        assert!(!json.contains("iban") && !json.contains("pdf") && !json.contains("/x/a"));
        assert!(get_invoice(&c, &on(), "nope")
            .unwrap_err()
            .contains("No invoice"));
    }

    #[test]
    fn quotes_list() {
        let c = fixture();
        assert_eq!(list_quotes(&c, &on(), None, None).unwrap().len(), 2);
        let q = list_quotes(&c, &on(), Some("accepted"), Some(2025)).unwrap();
        assert_eq!(q.len(), 1);
        assert_eq!((q[0].reference.as_str(), q[0].total), ("D-2025-004", 800.0));
        assert!(list_quotes(&c, &on(), Some("accepted"), Some(2026))
            .unwrap()
            .is_empty());
    }

    #[test]
    fn expenses_list() {
        let c = fixture();
        assert_eq!(list_expenses(&c, &on(), None, None).unwrap().len(), 3);
        let e = list_expenses(&c, &on(), Some(2026), Some(2)).unwrap();
        assert_eq!(e.len(), 1);
        assert_eq!(
            (e[0].supplier.as_str(), e[0].category.as_str(), e[0].amount),
            ("Fonts Co", "Tools", 120.5)
        );
        assert!(list_expenses(&c, &on(), Some(2026), Some(13)).is_err());
    }

    #[test]
    fn pnl_uses_chf_equivalent() {
        let c = fixture();
        let p = pnl_summary(&c, &on(), 2026, None).unwrap();
        // 1000 + 475 (EUR via chf_equivalent, draft excluded) + 80 side income
        assert_eq!(
            (p.invoice_income, p.other_income, p.income),
            (1475.0, 80.0, 1555.0)
        );
        assert_eq!((p.expenses, p.result), (420.5, 1134.5));
        assert_eq!(p.currency, "CHF");
        let m = pnl_summary(&c, &on(), 2026, Some(3)).unwrap();
        assert_eq!((m.income, m.expenses, m.result), (555.0, 300.0, 255.0));
        let empty = pnl_summary(&c, &on(), 2030, None).unwrap();
        assert_eq!(
            (empty.income, empty.expenses, empty.result),
            (0.0, 0.0, 0.0)
        );
    }

    #[test]
    fn read_only_source() {
        // Production code only (the fixture inserts rows); needles are split
        // so this test does not match itself.
        let full = include_str!("money.rs");
        let src = full[..full.find(concat!("#[cfg(", "test)]")).unwrap()].to_uppercase();
        for needle in [
            concat!("INSERT", " "),
            concat!("UPDATE", " "),
            concat!("DELETE", " "),
            concat!("ALTER", " "),
        ] {
            assert!(!src.contains(needle), "{needle}");
        }
    }
}
