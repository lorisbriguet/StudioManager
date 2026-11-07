//! Upkeep tools: machines, their service log and upkeep items, consumables
//! and subscriptions. Writes follow the app's own queries
//! (`src/db/queries/{machines,upkeepItems,consumables,subscriptions}.ts`)
//! and go through `write::write` (guards, backup, one transaction, change
//! log). Calendar columns are never written: the app gives new or moved
//! items their event when it sees the change.
//!
//! Machines, upkeep items and consumables live in the organisation the
//! equipment comes from (Settings > Studio upkeep > Machines & consumables);
//! subscriptions always stay with the organisation itself.

use crate::guard::{self, AccessConfig, Org};
use crate::orgs::{self, Registry};
use crate::read::{is_digits, pick};
use crate::text::fold;
use crate::write::{
    capped, columns, date_value, db, optional_date, parse_date, required, update_row, write,
    NOTHING,
};
use chrono::{Datelike, Duration, NaiveDate};
use rusqlite::types::Value;
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use std::path::Path;

type R<T> = Result<T, String>;

pub const MACHINE_STATUS: &str =
    "Status must be one of: working, attention, broken, lent, retired.";
pub const INTERVAL_UNIT: &str = "Unit must be day, week, month or year.";
pub const PERIOD: &str = "Period must be month or year.";
pub const SUBSCRIPTION_STATUS: &str = "Status must be active or cancelled.";
pub const EQUIPMENT_OFF: &str =
    "This organisation uses another organisation's machines and consumables, and agent access is off for that one.";
pub const STOCK_BOTH: &str = "Pass stock or add_stock, not both.";

// ── Where the equipment lives ────────────────────────────────

/// The organisation holding `org`'s machines, upkeep and consumables: the
/// one named in its `equipmentFrom` preference when that organisation still
/// exists (as the app's `equipmentOrgId`), else `org` itself. A borrowed
/// organisation must be allowed by agent access too.
pub fn equipment_org(dir: &Path, org: &Org) -> R<Org> {
    let Some(registry) = Registry::load(dir)? else {
        return Ok(org.clone());
    };
    let from = registry
        .find(&org.id)
        .and_then(|o| o.prefs.as_ref())
        .and_then(|p| p.equipment_from.clone())
        .filter(|f| *f != org.id);
    let Some(source) = from.and_then(|f| registry.find(&f)) else {
        return Ok(org.clone());
    };
    if !AccessConfig::load(dir).org_allowed(&source.id) {
        return Err(EQUIPMENT_OFF.to_string());
    }
    Ok(Org {
        id: source.id.clone(),
        name: source.name.clone(),
        db: orgs::org_dir(dir, &source.id).join(orgs::DB_FILE),
    })
}

// ── Results ──────────────────────────────────────────────────

#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct UpkeepItemRef {
    pub id: i64,
    pub title: String,
    /// interval or usage.
    pub schedule: String,
    /// "every 6 month", or "every 200 print_hours" for usage items.
    pub repeats: String,
    pub last_done_on: Option<String>,
    /// Effective due date: a later snooze wins over the scheduled date.
    pub next_due: Option<String>,
    pub archived: bool,
    pub notes: Option<String>,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct ServiceEntry {
    pub id: i64,
    pub done_on: String,
    pub description: String,
    pub upkeep_item_id: Option<i64>,
    /// Only when agents may read money.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cost: Option<f64>,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct ConsumableRef {
    pub id: i64,
    pub name: String,
    pub machine_id: Option<i64>,
    pub machine: Option<String>,
    pub unit: String,
    pub stock: f64,
    pub reorder_level: f64,
    pub low: bool,
    pub supplier: Option<String>,
    pub product_url: Option<String>,
    /// Only when agents may read money.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unit_price: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub currency: Option<String>,
}

/// A machine with its upkeep, service log and consumables. No serial,
/// connection, device, readings or files; price only when money is allowed.
#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct MachineDetail {
    pub org: String,
    pub id: i64,
    pub name: String,
    pub kind: String,
    pub maker: Option<String>,
    pub model: Option<String>,
    pub location: Option<String>,
    pub status: String,
    pub lent_to: Option<String>,
    pub lent_until: Option<String>,
    pub purchase_date: Option<String>,
    pub supplier: Option<String>,
    pub warranty_until: Option<String>,
    pub lifespan_years: Option<f64>,
    pub notes: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub price: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub currency: Option<String>,
    pub upkeep_items: Vec<UpkeepItemRef>,
    pub service_log: Vec<ServiceEntry>,
    pub consumables: Vec<ConsumableRef>,
    /// The machine's links (web pages, remote access): what the Network page shows.
    pub links: Vec<MachineLink>,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct MachineLink {
    pub id: i64,
    pub label: String,
    pub url: String,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct UpkeepItemResult {
    pub org: String,
    pub machine_id: i64,
    pub machine: String,
    pub item: UpkeepItemRef,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct ConsumableResult {
    pub org: String,
    pub consumable: ConsumableRef,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct SubscriptionRef {
    pub id: i64,
    pub name: String,
    pub plan: Option<String>,
    pub vendor: Option<String>,
    pub url: Option<String>,
    pub renews_on: String,
    /// month or year.
    pub period: String,
    /// active or cancelled.
    pub status: String,
    pub notes: Option<String>,
    /// Only when agents may read money.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cost: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub currency: Option<String>,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct SubscriptionResult {
    pub org: String,
    pub subscription: SubscriptionRef,
}

// ── Inputs ───────────────────────────────────────────────────

/// Machine fields an agent may set. On update, `None` leaves a field as it
/// is and an empty text or date clears it (name, kind and status can't be
/// cleared).
#[derive(Default, Debug, Clone)]
pub struct MachineFields {
    pub name: Option<String>,
    pub kind: Option<String>,
    pub maker: Option<String>,
    pub model: Option<String>,
    pub location: Option<String>,
    pub status: Option<String>,
    pub lent_to: Option<String>,
    pub lent_until: Option<String>,
    pub purchase_date: Option<String>,
    pub supplier: Option<String>,
    pub price: Option<f64>,
    pub currency: Option<String>,
    pub warranty_until: Option<String>,
    pub lifespan_years: Option<f64>,
    pub notes: Option<String>,
}

#[derive(Default, Debug, Clone)]
pub struct ConsumableFields {
    pub name: Option<String>,
    /// Machine name or id; empty detaches it.
    pub machine: Option<String>,
    pub unit: Option<String>,
    pub stock: Option<f64>,
    /// Update only: stock to add (a restock).
    pub add_stock: Option<f64>,
    pub reorder_level: Option<f64>,
    pub supplier: Option<String>,
    pub product_url: Option<String>,
    pub unit_price: Option<f64>,
    pub currency: Option<String>,
}

/// What `update_subscription` may change. Name, renewal date, period and
/// alert move the Apple Calendar event, which only the app can do.
#[derive(Default, Debug, Clone)]
pub struct SubscriptionChanges {
    pub plan: Option<String>,
    pub vendor: Option<String>,
    pub url: Option<String>,
    pub cost: Option<f64>,
    pub currency: Option<String>,
    pub status: Option<String>,
    pub notes: Option<String>,
}

// ── Validation ───────────────────────────────────────────────

fn machine_status(s: &str) -> R<&'static str> {
    match s.trim() {
        "working" => Ok("working"),
        "attention" => Ok("attention"),
        "broken" => Ok("broken"),
        "lent" => Ok("lent"),
        "retired" => Ok("retired"),
        _ => Err(MACHINE_STATUS.to_string()),
    }
}

fn interval_unit(s: &str) -> R<&'static str> {
    match s.trim() {
        "day" | "days" => Ok("day"),
        "week" | "weeks" => Ok("week"),
        "month" | "months" => Ok("month"),
        "year" | "years" => Ok("year"),
        _ => Err(INTERVAL_UNIT.to_string()),
    }
}

fn period(s: &str) -> R<&'static str> {
    match s.trim() {
        "month" | "monthly" => Ok("month"),
        "year" | "yearly" => Ok("year"),
        _ => Err(PERIOD.to_string()),
    }
}

fn subscription_status(s: &str) -> R<&'static str> {
    match s.trim() {
        "active" => Ok("active"),
        "cancelled" => Ok("cancelled"),
        _ => Err(SUBSCRIPTION_STATUS.to_string()),
    }
}

/// A finite number, zero or more.
fn amount(n: f64, what: &str) -> R<f64> {
    if n.is_finite() && n >= 0.0 {
        Ok(n)
    } else {
        Err(format!("{what} must be a number, zero or more."))
    }
}

/// Optional text on update: empty clears it.
fn text_value(s: &str, what: &str) -> R<Value> {
    let t = capped(s, what)?.trim();
    Ok(if t.is_empty() {
        Value::Null
    } else {
        Value::Text(t.to_string())
    })
}

/// Optional text on creation: absent or empty is NULL.
fn optional_text(s: Option<&str>, what: &str) -> R<Option<String>> {
    match s {
        None => Ok(None),
        Some(s) => Ok(match text_value(s, what)? {
            Value::Text(t) => Some(t),
            _ => None,
        }),
    }
}

/// Currency codes are stored upper-case, as the app's forms do.
fn currency_value(s: &str) -> R<Value> {
    Ok(match text_value(s, "Currency")? {
        Value::Text(t) => Value::Text(t.to_uppercase()),
        v => v,
    })
}

fn ymd(s: &str) -> NaiveDate {
    NaiveDate::parse_from_str(s, "%Y-%m-%d").expect("validated date")
}

/// `addInterval` from `src/utils/recurringDates.ts`: day and week steps are
/// plain day arithmetic; month and year steps land on
/// `min(anchor_day, days in the target month)`.
pub fn add_interval(date: NaiveDate, n: i64, unit: &str, anchor_day: u32) -> NaiveDate {
    match unit {
        "day" => date + Duration::days(n),
        "week" => date + Duration::days(7 * n),
        _ => {
            let months = if unit == "year" { n * 12 } else { n };
            let total = date.year() as i64 * 12 + date.month0() as i64 + months;
            let (y, m0) = (total.div_euclid(12) as i32, total.rem_euclid(12) as u32);
            let first = NaiveDate::from_ymd_opt(y, m0 + 1, 1).expect("valid month");
            let next_first = if m0 == 11 {
                NaiveDate::from_ymd_opt(y + 1, 1, 1)
            } else {
                NaiveDate::from_ymd_opt(y, m0 + 2, 1)
            }
            .expect("valid month");
            let days_in_month = (next_first - first).num_days() as u32;
            first
                .with_day(anchor_day.clamp(1, days_in_month))
                .expect("day in month")
        }
    }
}

fn iso(d: NaiveDate) -> String {
    d.format("%Y-%m-%d").to_string()
}

// ── Lookups ──────────────────────────────────────────────────

pub(crate) fn resolve_machine(conn: &Connection, key: &str) -> R<i64> {
    let key = key.trim();
    if is_digits(key) {
        let id: i64 = key
            .parse()
            .map_err(|_| format!("No machine matches \"{key}\"."))?;
        let found: Option<i64> = db(conn
            .query_row("SELECT id FROM machines WHERE id = ?1", [id], |r| r.get(0))
            .optional())?;
        return found.ok_or_else(|| format!("No machine matches \"{key}\"."));
    }
    let mut stmt = db(conn.prepare("SELECT id, name FROM machines ORDER BY id"))?;
    let items: Vec<(i64, String, String)> = db(stmt
        .query_map([], |r| {
            let id: i64 = r.get(0)?;
            Ok((id, id.to_string(), r.get::<_, String>(1)?))
        })
        .and_then(|rows| rows.collect()))?;
    pick("machine", key, &items)
}

fn machine_name(conn: &Connection, id: i64) -> R<String> {
    db(
        conn.query_row("SELECT name FROM machines WHERE id = ?1", [id], |r| {
            r.get(0)
        }),
    )
}

const ITEM_SELECT: &str = "SELECT id, title, schedule, interval_n, interval_unit, usage_metric, \
     usage_every, last_done_on, \
     CASE WHEN snooze_until IS NOT NULL AND (next_due_on IS NULL OR snooze_until > next_due_on) \
          THEN snooze_until ELSE next_due_on END, \
     archived, notes, machine_id FROM upkeep_items";

fn item_from_row(r: &rusqlite::Row) -> rusqlite::Result<(UpkeepItemRef, i64)> {
    let schedule: String = r.get(2)?;
    let repeats = if schedule == "interval" {
        let n: Option<i64> = r.get(3)?;
        let unit: Option<String> = r.get(4)?;
        format!(
            "every {} {}",
            n.unwrap_or(1),
            unit.unwrap_or_else(|| "month".into())
        )
    } else {
        let metric: Option<String> = r.get(5)?;
        let every: Option<f64> = r.get(6)?;
        format!(
            "every {} {}",
            every.unwrap_or(0.0),
            metric.unwrap_or_else(|| "use".into())
        )
    };
    let next: Option<String> = r.get(8)?;
    Ok((
        UpkeepItemRef {
            id: r.get(0)?,
            title: r.get(1)?,
            schedule,
            repeats,
            last_done_on: r.get(7)?,
            next_due: next.map(|d| d.chars().take(10).collect()),
            archived: r.get::<_, i64>(9)? != 0,
            notes: r.get(10)?,
        },
        r.get(11)?,
    ))
}

fn upkeep_item(conn: &Connection, id: i64) -> R<(UpkeepItemRef, i64)> {
    db(conn
        .query_row(&format!("{ITEM_SELECT} WHERE id = ?1"), [id], item_from_row)
        .optional())?
    .ok_or_else(|| format!("No upkeep item with id {id}."))
}

const CONSUMABLE_SELECT: &str = "SELECT c.id, c.name, c.machine_id, m.name, c.unit, c.stock, \
     c.reorder_level, c.supplier, c.product_url, c.unit_price, c.currency \
     FROM consumables c LEFT JOIN machines m ON m.id = c.machine_id";

fn consumable_from_row(r: &rusqlite::Row, money: bool) -> rusqlite::Result<ConsumableRef> {
    let stock: f64 = r.get(5)?;
    let reorder_level: f64 = r.get(6)?;
    Ok(ConsumableRef {
        id: r.get(0)?,
        name: r.get(1)?,
        machine_id: r.get(2)?,
        machine: r.get(3)?,
        unit: r.get(4)?,
        stock,
        reorder_level,
        low: stock < reorder_level,
        supplier: r.get(7)?,
        product_url: r.get(8)?,
        unit_price: if money { r.get(9)? } else { None },
        currency: if money { r.get(10)? } else { None },
    })
}

fn consumable(conn: &Connection, id: i64, money: bool) -> R<ConsumableRef> {
    db(conn
        .query_row(&format!("{CONSUMABLE_SELECT} WHERE c.id = ?1"), [id], |r| {
            consumable_from_row(r, money)
        })
        .optional())?
    .ok_or_else(|| format!("No consumable with id {id}."))
}

const SUBSCRIPTION_SELECT: &str = "SELECT id, name, plan, vendor, url, renews_on, period, status, \
     notes, cost, currency FROM subscriptions";

fn subscription_from_row(r: &rusqlite::Row, money: bool) -> rusqlite::Result<SubscriptionRef> {
    Ok(SubscriptionRef {
        id: r.get(0)?,
        name: r.get(1)?,
        plan: r.get(2)?,
        vendor: r.get(3)?,
        url: r.get(4)?,
        renews_on: r.get(5)?,
        period: r.get(6)?,
        status: r.get(7)?,
        notes: r.get(8)?,
        cost: if money { r.get(9)? } else { None },
        currency: if money { r.get(10)? } else { None },
    })
}

fn subscription(conn: &Connection, id: i64, money: bool) -> R<SubscriptionRef> {
    db(conn
        .query_row(&format!("{SUBSCRIPTION_SELECT} WHERE id = ?1"), [id], |r| {
            subscription_from_row(r, money)
        })
        .optional())?
    .ok_or_else(|| format!("No subscription with id {id}."))
}

// ── Reads ────────────────────────────────────────────────────

pub fn get_machine(conn: &Connection, org: &Org, key: &str, money: bool) -> R<MachineDetail> {
    let id = resolve_machine(conn, key)?;
    machine_detail(conn, org, id, money)
}

fn machine_detail(conn: &Connection, org: &Org, id: i64, money: bool) -> R<MachineDetail> {
    let mut m = db(conn.query_row(
        "SELECT id, name, kind, maker, model, location, status, lent_to, lent_until, \
                purchase_date, supplier, warranty_until, lifespan_years, notes, price, currency \
         FROM machines WHERE id = ?1",
        [id],
        |r| {
            Ok(MachineDetail {
                org: org.name.clone(),
                id: r.get(0)?,
                name: r.get(1)?,
                kind: r.get(2)?,
                maker: r.get(3)?,
                model: r.get(4)?,
                location: r.get(5)?,
                status: r.get(6)?,
                lent_to: r.get(7)?,
                lent_until: r.get(8)?,
                purchase_date: r.get(9)?,
                supplier: r.get(10)?,
                warranty_until: r.get(11)?,
                lifespan_years: r.get(12)?,
                notes: r.get(13)?,
                price: if money { r.get(14)? } else { None },
                currency: if money { r.get(15)? } else { None },
                upkeep_items: Vec::new(),
                service_log: Vec::new(),
                consumables: Vec::new(),
                links: Vec::new(),
            })
        },
    ))?;
    let mut stmt = db(conn.prepare(
        "SELECT id, label, path_or_url FROM machine_files \
         WHERE machine_id = ?1 AND kind = 'link' ORDER BY id ASC",
    ))?;
    m.links = db(stmt
        .query_map([id], |r| Ok(MachineLink { id: r.get(0)?, label: r.get(1)?, url: r.get(2)? }))
        .and_then(|rows| rows.collect()))?;
    let mut stmt = db(conn.prepare(&format!(
        "{ITEM_SELECT} WHERE machine_id = ?1 \
         ORDER BY archived ASC, next_due_on IS NULL, next_due_on ASC, title ASC"
    )))?;
    m.upkeep_items = db(stmt
        .query_map([id], |r| item_from_row(r).map(|(i, _)| i))
        .and_then(|rows| rows.collect()))?;
    let mut stmt = db(conn.prepare(
        "SELECT id, done_on, description, upkeep_item_id, cost FROM service_log \
         WHERE machine_id = ?1 ORDER BY done_on DESC, id DESC",
    ))?;
    m.service_log = db(stmt
        .query_map([id], |r| {
            Ok(ServiceEntry {
                id: r.get(0)?,
                done_on: r.get(1)?,
                description: r.get(2)?,
                upkeep_item_id: r.get(3)?,
                cost: if money { r.get(4)? } else { None },
            })
        })
        .and_then(|rows| rows.collect()))?;
    let mut stmt = db(conn.prepare(&format!(
        "{CONSUMABLE_SELECT} WHERE c.machine_id = ?1 ORDER BY c.name COLLATE NOCASE"
    )))?;
    m.consumables = db(stmt
        .query_map([id], |r| consumable_from_row(r, money))
        .and_then(|rows| rows.collect()))?;
    Ok(m)
}

/// Every consumable, lowest relative stock first (the app's order).
pub fn list_consumables(conn: &Connection, money: bool) -> R<Vec<ConsumableRef>> {
    let mut stmt = db(conn.prepare(&format!(
        "{CONSUMABLE_SELECT} ORDER BY (c.reorder_level = 0) ASC, \
         c.stock / NULLIF(c.reorder_level, 0) ASC, c.name ASC"
    )))?;
    db(stmt
        .query_map([], |r| consumable_from_row(r, money))
        .and_then(|rows| rows.collect()))
}

/// Every subscription, active ones first, by renewal date (the app's order).
pub fn list_subscriptions(conn: &Connection, money: bool) -> R<Vec<SubscriptionRef>> {
    let mut stmt = db(conn.prepare(&format!(
        "{SUBSCRIPTION_SELECT} ORDER BY (status = 'cancelled') ASC, renews_on ASC, name ASC"
    )))?;
    db(stmt
        .query_map([], |r| subscription_from_row(r, money))
        .and_then(|rows| rows.collect()))
}

// ── Machines ─────────────────────────────────────────────────

/// Column values for the machine fields given. Name, kind and status can't
/// be empty; other texts and dates are cleared by an empty string.
fn machine_sets(f: &MachineFields) -> R<Vec<(&'static str, Value)>> {
    let mut sets: Vec<(&'static str, Value)> = Vec::new();
    if let Some(n) = &f.name {
        sets.push(("name", Value::Text(required(n, "Name")?)));
    }
    if let Some(k) = &f.kind {
        sets.push(("kind", Value::Text(required(k, "Kind")?)));
    }
    if let Some(s) = &f.status {
        sets.push(("status", Value::Text(machine_status(s)?.to_string())));
    }
    for (col, what, v) in [
        ("maker", "Maker", &f.maker),
        ("model", "Model", &f.model),
        ("location", "Location", &f.location),
        ("lent_to", "Lent to", &f.lent_to),
        ("supplier", "Supplier", &f.supplier),
        ("notes", "Notes", &f.notes),
    ] {
        if let Some(v) = v {
            sets.push((col, text_value(v, what)?));
        }
    }
    for (col, v) in [
        ("lent_until", &f.lent_until),
        ("purchase_date", &f.purchase_date),
        ("warranty_until", &f.warranty_until),
    ] {
        if let Some(v) = v {
            sets.push((col, date_value(v)?));
        }
    }
    if let Some(p) = f.price {
        sets.push(("price", Value::Real(amount(p, "Price")?)));
    }
    if let Some(c) = &f.currency {
        sets.push(("currency", currency_value(c)?));
    }
    if let Some(y) = f.lifespan_years {
        sets.push(("lifespan_years", Value::Real(amount(y, "Lifespan")?)));
    }
    Ok(sets)
}

fn refuse_duplicate_machine(conn: &Connection, name: &str, except: Option<i64>) -> R<()> {
    let mut stmt = db(conn.prepare("SELECT id, name FROM machines ORDER BY id"))?;
    let rows: Vec<(i64, String)> = db(stmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
        .and_then(|rows| rows.collect()))?;
    match rows
        .iter()
        .find(|(id, n)| Some(*id) != except && fold(n.trim()) == fold(name))
    {
        Some((id, n)) => Err(format!("A machine named \"{n}\" already exists (id {id}).")),
        None => Ok(()),
    }
}

pub fn create_machine(
    dir: &Path,
    org: &Org,
    fields: &MachineFields,
    money: bool,
) -> R<MachineDetail> {
    let name = required(fields.name.as_deref().unwrap_or(""), "Name")?;
    let mut sets = machine_sets(fields)?;
    if fields.kind.is_none() {
        sets.push(("kind", Value::Text("generic".into())));
    }
    let org = equipment_org(dir, org)?;
    write(dir, &org, "create_machine", |tx| {
        refuse_duplicate_machine(tx, &name, None)?;
        let placeholders: Vec<String> = (1..=sets.len()).map(|i| format!("?{i}")).collect();
        let sql = format!(
            "INSERT INTO machines ({}) VALUES ({})",
            columns(&sets),
            placeholders.join(", ")
        );
        let values: Vec<Value> = sets.into_iter().map(|(_, v)| v).collect();
        db(tx.execute(&sql, rusqlite::params_from_iter(values)))?;
        let id = tx.last_insert_rowid();
        let summary = format!("Created machine \"{name}\" (id {id})");
        Ok((machine_detail(tx, &org, id, money)?, Some(summary)))
    })
}

pub fn update_machine(
    dir: &Path,
    org: &Org,
    machine: &str,
    fields: &MachineFields,
    money: bool,
) -> R<MachineDetail> {
    let sets = machine_sets(fields)?;
    if sets.is_empty() {
        return Err(NOTHING.to_string());
    }
    let org = equipment_org(dir, org)?;
    write(dir, &org, "update_machine", |tx| {
        let id = resolve_machine(tx, machine)?;
        if let Some(Value::Text(n)) = sets.iter().find(|(c, _)| *c == "name").map(|(_, v)| v) {
            refuse_duplicate_machine(tx, n, Some(id))?;
        }
        let changed = columns(&sets);
        // A new warranty date is a new warranty notice (as the app's updateMachine).
        if let Some(i) = sets.iter().position(|(c, _)| *c == "warranty_until") {
            let new = sets[i].1.clone();
            db(tx.execute(
                "UPDATE machines SET warranty_notified_for = NULL \
                 WHERE id = ?1 AND warranty_until IS NOT ?2",
                params![id, new],
            ))?;
        }
        update_row(tx, "machines", id, sets)?;
        let d = machine_detail(tx, &org, id, money)?;
        let summary = format!("Updated machine \"{}\" (id {id}): {changed}", d.name);
        Ok((d, Some(summary)))
    })
}

pub fn add_service_log(
    dir: &Path,
    org: &Org,
    machine: &str,
    description: &str,
    done_on: &str,
    cost: Option<f64>,
    money: bool,
) -> R<MachineDetail> {
    let description = required(description, "Description")?;
    let done_on = parse_date(done_on)?;
    let cost = cost.map(|c| amount(c, "Cost")).transpose()?;
    let org = equipment_org(dir, org)?;
    write(dir, &org, "add_service_log", |tx| {
        let id = resolve_machine(tx, machine)?;
        db(tx.execute(
            "INSERT INTO service_log (machine_id, upkeep_item_id, done_on, description, cost) \
             VALUES (?1, NULL, ?2, ?3, ?4)",
            params![id, done_on, description, cost],
        ))?;
        let d = machine_detail(tx, &org, id, money)?;
        let summary = format!(
            "Logged service on machine \"{}\" (id {id}) on {done_on}: {description}",
            d.name
        );
        Ok((d, Some(summary)))
    })
}

/// Add a link (a web page or a remote-access address such as `vnc://…`) to a
/// machine, as the app's machine page does. The Network page lists these.
pub fn add_machine_link(dir: &Path, org: &Org, machine: &str, label: &str, url: &str) -> R<MachineDetail> {
    let label = required(label, "Label")?;
    let url = required(url, "Address")?;
    if url.chars().any(|c| c.is_whitespace() || c.is_control()) || url.len() > 2048 {
        return Err("The address can't contain spaces and must be shorter than 2048 characters.".to_string());
    }
    let org = equipment_org(dir, org)?;
    write(dir, &org, "add_machine_link", |tx| {
        let id = resolve_machine(tx, machine)?;
        let exists: i64 = db(tx.query_row(
            "SELECT count(*) FROM machine_files WHERE machine_id = ?1 AND kind = 'link' AND path_or_url = ?2",
            params![id, url],
            |r| r.get(0),
        ))?;
        if exists > 0 {
            return Err(format!("This machine already has a link to {url}."));
        }
        db(tx.execute(
            "INSERT INTO machine_files (machine_id, label, kind, path_or_url) VALUES (?1, ?2, 'link', ?3)",
            params![id, label, url],
        ))?;
        let d = machine_detail(tx, &org, id, false)?;
        let summary = format!("Added link \"{label}\" ({url}) to machine \"{}\" (id {id})", d.name);
        Ok((d, Some(summary)))
    })
}

// ── Upkeep items ─────────────────────────────────────────────

/// A repeating interval item. The first due date counts from the last
/// service, else from `start_on`, else today, on the same day of the month
/// (as the app's `prepareNewItem`).
#[allow(clippy::too_many_arguments)]
pub fn add_upkeep_item(
    dir: &Path,
    org: &Org,
    machine: &str,
    title: &str,
    every: Option<i64>,
    unit: &str,
    start_on: Option<&str>,
    last_done_on: Option<&str>,
    notes: Option<&str>,
    today: NaiveDate,
) -> R<UpkeepItemResult> {
    let title = required(title, "Title")?;
    let n = every.unwrap_or(1);
    if !(1..=1000).contains(&n) {
        return Err("Every must be a whole number from 1 to 1000.".to_string());
    }
    let unit = interval_unit(unit)?;
    let start = optional_date(start_on)?;
    let last = optional_date(last_done_on)?;
    let notes = optional_text(notes, "Notes")?;
    let base = ymd(&last.clone().or(start).unwrap_or_else(|| iso(today)));
    let anchor = base.day();
    let next = iso(add_interval(base, n, unit, anchor));
    let org = equipment_org(dir, org)?;
    write(dir, &org, "add_upkeep_item", |tx| {
        let mid = resolve_machine(tx, machine)?;
        db(tx.execute(
            "INSERT INTO upkeep_items (machine_id, title, notes, schedule, interval_n, \
             interval_unit, anchor_day, last_done_on, next_due_on, in_calendar, alert, archived) \
             VALUES (?1, ?2, ?3, 'interval', ?4, ?5, ?6, ?7, ?8, 1, 'default', 0)",
            params![mid, title, notes, n, unit, anchor, last, next],
        ))?;
        let (item, _) = upkeep_item(tx, tx.last_insert_rowid())?;
        let mname = machine_name(tx, mid)?;
        let summary = format!(
            "Added upkeep \"{title}\" (id {}) to machine \"{mname}\" (id {mid}), every {n} {unit}, next {next}",
            item.id
        );
        Ok((
            UpkeepItemResult {
                org: org.name.clone(),
                machine_id: mid,
                machine: mname,
                item,
            },
            Some(summary),
        ))
    })
}

/// Record a service of an item, as the app's `markUpkeepDone`: a service log
/// entry, the last-done date, the next due date (interval items; usage items
/// wait for readings), snooze and overdue notice cleared.
pub fn mark_upkeep_done(
    dir: &Path,
    org: &Org,
    item_id: i64,
    done_on: &str,
    note: Option<&str>,
) -> R<UpkeepItemResult> {
    let done_on = parse_date(done_on)?;
    let note = optional_text(note, "Note")?;
    let org = equipment_org(dir, org)?;
    write(dir, &org, "mark_upkeep_done", |tx| {
        let (item, mid) = upkeep_item(tx, item_id)?;
        let (schedule, n, unit, anchor): (String, Option<i64>, Option<String>, Option<u32>) =
            db(tx.query_row(
                "SELECT schedule, interval_n, interval_unit, anchor_day FROM upkeep_items WHERE id = ?1",
                [item_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            ))?;
        let next = if schedule == "interval" {
            let done = ymd(&done_on);
            Some(iso(add_interval(
                done,
                n.unwrap_or(1),
                unit.as_deref().unwrap_or("month"),
                anchor.unwrap_or(done.day()),
            )))
        } else {
            None
        };
        let description = note.unwrap_or_else(|| item.title.clone());
        db(tx.execute(
            "INSERT INTO service_log (machine_id, upkeep_item_id, done_on, description, reading) \
             VALUES (?1, ?2, ?3, ?4, NULL)",
            params![mid, item_id, done_on, description],
        ))?;
        db(tx.execute(
            "UPDATE upkeep_items SET last_done_on = ?1, last_done_reading = NULL, next_due_on = ?2, \
             snooze_until = NULL, overdue_notified_for = NULL, updated_at = datetime('now') \
             WHERE id = ?3",
            params![done_on, next, item_id],
        ))?;
        let (item, _) = upkeep_item(tx, item_id)?;
        let mname = machine_name(tx, mid)?;
        let summary = format!(
            "Marked upkeep \"{}\" (id {item_id}) on machine \"{mname}\" done on {done_on}",
            item.title
        );
        Ok((
            UpkeepItemResult {
                org: org.name.clone(),
                machine_id: mid,
                machine: mname,
                item,
            },
            Some(summary),
        ))
    })
}

// ── Consumables ──────────────────────────────────────────────

fn consumable_sets(tx: &Connection, f: &ConsumableFields) -> R<Vec<(&'static str, Value)>> {
    let mut sets: Vec<(&'static str, Value)> = Vec::new();
    if let Some(n) = &f.name {
        sets.push(("name", Value::Text(required(n, "Name")?)));
    }
    if let Some(u) = &f.unit {
        sets.push(("unit", Value::Text(required(u, "Unit")?)));
    }
    if let Some(m) = &f.machine {
        let v = if m.trim().is_empty() {
            Value::Null
        } else {
            Value::Integer(resolve_machine(tx, m)?)
        };
        sets.push(("machine_id", v));
    }
    if let Some(s) = f.stock {
        sets.push(("stock", Value::Real(amount(s, "Stock")?)));
    }
    if let Some(l) = f.reorder_level {
        sets.push(("reorder_level", Value::Real(amount(l, "Reorder level")?)));
    }
    if let Some(s) = &f.supplier {
        sets.push(("supplier", text_value(s, "Supplier")?));
    }
    if let Some(u) = &f.product_url {
        sets.push(("product_url", text_value(u, "URL")?));
    }
    if let Some(p) = f.unit_price {
        sets.push(("unit_price", Value::Real(amount(p, "Unit price")?)));
    }
    if let Some(c) = &f.currency {
        sets.push(("currency", currency_value(c)?));
    }
    Ok(sets)
}

pub fn create_consumable(
    dir: &Path,
    org: &Org,
    fields: &ConsumableFields,
    money: bool,
) -> R<ConsumableResult> {
    let name = required(fields.name.as_deref().unwrap_or(""), "Name")?;
    if fields.add_stock.is_some() {
        return Err("Use stock when creating a consumable.".to_string());
    }
    let org = equipment_org(dir, org)?;
    write(dir, &org, "create_consumable", |tx| {
        let mut sets = consumable_sets(tx, fields)?;
        if fields.unit.is_none() {
            sets.push(("unit", Value::Text("pcs".into())));
        }
        let placeholders: Vec<String> = (1..=sets.len()).map(|i| format!("?{i}")).collect();
        let sql = format!(
            "INSERT INTO consumables ({}) VALUES ({})",
            columns(&sets),
            placeholders.join(", ")
        );
        let values: Vec<Value> = sets.into_iter().map(|(_, v)| v).collect();
        db(tx.execute(&sql, rusqlite::params_from_iter(values)))?;
        let c = consumable(tx, tx.last_insert_rowid(), money)?;
        let summary = format!("Created consumable \"{name}\" (id {})", c.id);
        Ok((
            ConsumableResult {
                org: org.name.clone(),
                consumable: c,
            },
            Some(summary),
        ))
    })
}

pub fn update_consumable(
    dir: &Path,
    org: &Org,
    consumable_id: i64,
    fields: &ConsumableFields,
    money: bool,
) -> R<ConsumableResult> {
    if fields.stock.is_some() && fields.add_stock.is_some() {
        return Err(STOCK_BOTH.to_string());
    }
    let add = match fields.add_stock {
        Some(a) if a.is_finite() && a > 0.0 => Some(a),
        Some(_) => return Err("Add stock must be more than zero.".to_string()),
        None => None,
    };
    let org = equipment_org(dir, org)?;
    write(dir, &org, "update_consumable", |tx| {
        consumable(tx, consumable_id, money)?;
        let sets = consumable_sets(tx, fields)?;
        if sets.is_empty() && add.is_none() {
            return Err(NOTHING.to_string());
        }
        let mut changed: Vec<String> = Vec::new();
        if !sets.is_empty() {
            changed.push(columns(&sets));
            update_row(tx, "consumables", consumable_id, sets)?;
        }
        if let Some(a) = add {
            db(tx.execute(
                "UPDATE consumables SET stock = stock + ?1, updated_at = datetime('now') WHERE id = ?2",
                params![a, consumable_id],
            ))?;
            changed.push(format!("stock +{a}"));
        }
        // Back above the reorder level: the next drop notifies again.
        db(tx.execute(
            "UPDATE consumables SET low_notified = 0 \
             WHERE id = ?1 AND stock > reorder_level AND low_notified != 0",
            [consumable_id],
        ))?;
        let c = consumable(tx, consumable_id, money)?;
        let summary = format!(
            "Updated consumable \"{}\" (id {consumable_id}): {}",
            c.name,
            changed.join(", ")
        );
        Ok((
            ConsumableResult {
                org: org.name.clone(),
                consumable: c,
            },
            Some(summary),
        ))
    })
}

// ── Subscriptions ────────────────────────────────────────────

#[allow(clippy::too_many_arguments)]
pub fn create_subscription(
    dir: &Path,
    org: &Org,
    name: &str,
    renews_on: &str,
    period_s: &str,
    cost: Option<f64>,
    currency: Option<&str>,
    plan: Option<&str>,
    vendor: Option<&str>,
    url: Option<&str>,
    notes: Option<&str>,
    money: bool,
) -> R<SubscriptionResult> {
    let name = required(name, "Name")?;
    let renews_on = parse_date(renews_on)?;
    let anchor = ymd(&renews_on).day();
    let period_v = period(period_s)?;
    let cost = amount(cost.unwrap_or(0.0), "Cost")?;
    let currency = match currency {
        Some(c) => match currency_value(c)? {
            Value::Text(t) => Some(t),
            _ => None,
        },
        None => None,
    };
    let plan = optional_text(plan, "Plan")?;
    let vendor = optional_text(vendor, "Vendor")?;
    let url = optional_text(url, "URL")?;
    let notes = optional_text(notes, "Notes")?;
    // Subscriptions belong to the organisation itself, never borrowed.
    write(dir, org, "create_subscription", |tx| {
        let mut stmt = db(
            tx.prepare("SELECT id, name FROM subscriptions WHERE status = 'active' ORDER BY id")
        )?;
        let rows: Vec<(i64, String)> = db(stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
            .and_then(|rows| rows.collect()))?;
        if let Some((id, n)) = rows.iter().find(|(_, n)| fold(n.trim()) == fold(&name)) {
            return Err(format!(
                "An active subscription named \"{n}\" already exists (id {id})."
            ));
        }
        db(tx.execute(
            "INSERT INTO subscriptions (name, plan, vendor, url, renews_on, anchor_day, period, \
             cost, currency, notes) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![name, plan, vendor, url, renews_on, anchor, period_v, cost, currency, notes],
        ))?;
        let s = subscription(tx, tx.last_insert_rowid(), money)?;
        let summary = format!(
            "Created subscription \"{name}\" (id {}), renews {renews_on} every {period_v}",
            s.id
        );
        Ok((
            SubscriptionResult {
                org: org.name.clone(),
                subscription: s,
            },
            Some(summary),
        ))
    })
}

pub fn update_subscription(
    dir: &Path,
    org: &Org,
    subscription_id: i64,
    changes: &SubscriptionChanges,
    money: bool,
) -> R<SubscriptionResult> {
    let mut sets: Vec<(&'static str, Value)> = Vec::new();
    for (col, what, v) in [
        ("plan", "Plan", &changes.plan),
        ("vendor", "Vendor", &changes.vendor),
        ("url", "URL", &changes.url),
        ("notes", "Notes", &changes.notes),
    ] {
        if let Some(v) = v {
            sets.push((col, text_value(v, what)?));
        }
    }
    if let Some(c) = changes.cost {
        sets.push(("cost", Value::Real(amount(c, "Cost")?)));
    }
    if let Some(c) = &changes.currency {
        sets.push(("currency", currency_value(c)?));
    }
    if let Some(s) = &changes.status {
        sets.push(("status", Value::Text(subscription_status(s)?.to_string())));
    }
    if sets.is_empty() {
        return Err(NOTHING.to_string());
    }
    write(dir, org, "update_subscription", |tx| {
        subscription(tx, subscription_id, money)?;
        let changed = columns(&sets);
        update_row(tx, "subscriptions", subscription_id, sets)?;
        let s = subscription(tx, subscription_id, money)?;
        let summary = format!(
            "Updated subscription \"{}\" (id {subscription_id}): {changed}",
            s.name
        );
        Ok((
            SubscriptionResult {
                org: org.name.clone(),
                subscription: s,
            },
            Some(summary),
        ))
    })
}

/// Read connection on the organisation holding the equipment.
pub fn open_equipment_read(dir: &Path, org: &Org) -> R<(Org, Connection)> {
    let eq = equipment_org(dir, org)?;
    let conn = guard::open_read(&eq)?;
    Ok((eq, conn))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::*;

    fn d(s: &str) -> NaiveDate {
        ymd(s)
    }

    fn fixture() -> (std::path::PathBuf, Org, Connection) {
        let dir = ready_dir("org001", "Studio");
        let org = guard::resolve_org(&dir, None).unwrap();
        let conn = Connection::open(&org.db).unwrap();
        conn.execute_batch(
            "INSERT INTO machines (id, name, kind, status, price, currency, serial, warranty_until, warranty_notified_for) VALUES
               (1, 'NAS', 'Synology', 'working', 600, 'CHF', 'SN-1', '2027-01-01', '2027-01-01'),
               (2, 'Printer', 'generic', 'working', NULL, NULL, NULL, NULL, NULL);
             INSERT INTO upkeep_items (id, machine_id, title, schedule, interval_n, interval_unit, anchor_day, next_due_on, snooze_until, overdue_notified_for) VALUES
               (1, 1, 'Dust filter', 'interval', 6, 'month', 31, '2026-01-31', '2026-02-10', '2026-01-31');
             INSERT INTO consumables (id, name, machine_id, unit, stock, reorder_level, unit_price, currency, low_notified) VALUES
               (1, 'Toner', 2, 'pcs', 0, 1, 80, 'CHF', 1);
             INSERT INTO subscriptions (id, name, renews_on, anchor_day, period, cost, currency, calendar_event_id) VALUES
               (1, 'Font licence', '2027-03-01', 1, 'year', 120, 'CHF', 'EV-1');",
        )
        .unwrap();
        (dir, org, conn)
    }

    fn one<T: rusqlite::types::FromSql>(conn: &Connection, sql: &str) -> T {
        conn.query_row(sql, [], |r| r.get(0)).unwrap()
    }

    #[test]
    fn add_interval_matches_the_app() {
        assert_eq!(
            add_interval(d("2026-01-31"), 1, "month", 31),
            d("2026-02-28")
        );
        assert_eq!(
            add_interval(d("2026-02-28"), 1, "month", 31),
            d("2026-03-31")
        );
        assert_eq!(
            add_interval(d("2026-11-15"), 3, "month", 15),
            d("2027-02-15")
        );
        assert_eq!(
            add_interval(d("2024-02-29"), 1, "year", 29),
            d("2025-02-28")
        );
        assert_eq!(
            add_interval(d("2026-12-30"), 2, "week", 30),
            d("2027-01-13")
        );
        assert_eq!(add_interval(d("2026-12-31"), 1, "day", 31), d("2027-01-01"));
    }

    #[test]
    fn service_log_entry_for_the_ram() {
        let (dir, org, conn) = fixture();
        let m = add_service_log(
            &dir,
            &org,
            "nas",
            "Installed 2 × 16 GB RAM",
            "2026-11-01",
            Some(240.0),
            false,
        )
        .unwrap();
        assert_eq!(m.name, "NAS");
        assert_eq!(m.service_log.len(), 1);
        assert_eq!(m.service_log[0].description, "Installed 2 × 16 GB RAM");
        assert_eq!(
            m.service_log[0].cost, None,
            "cost hidden without money access"
        );
        assert_eq!(m.price, None);
        assert_eq!(one::<f64>(&conn, "SELECT cost FROM service_log"), 240.0);
        let log = std::fs::read_to_string(dir.join(crate::log::LOG_FILE)).unwrap();
        assert!(
            log.contains("add_service_log") && log.contains("NAS"),
            "{log}"
        );
        let with_money = get_machine(&conn, &org, "1", true).unwrap();
        assert_eq!(with_money.service_log[0].cost, Some(240.0));
        assert_eq!(with_money.price, Some(600.0));
        assert!(add_service_log(&dir, &org, "NAS", " ", "2026-11-01", None, false).is_err());
        assert!(add_service_log(&dir, &org, "NAS", "x", "1/11/2026", None, false).is_err());
        assert!(add_service_log(&dir, &org, "NAS", "x", "2026-11-01", Some(-1.0), false).is_err());
        assert!(add_service_log(&dir, &org, "Nope", "x", "2026-11-01", None, false).is_err());
    }

    #[test]
    fn links_on_a_machine_feed_the_network_page() {
        let (dir, org, conn) = fixture();
        conn.execute(
            "INSERT INTO machine_files (machine_id, label, kind, path_or_url) VALUES (1, 'Manual', 'file', '/x/manual.pdf')",
            [],
        )
        .unwrap();
        let m = add_machine_link(&dir, &org, "nas", "Paperless", "https://nas.example:8443").unwrap();
        assert_eq!(m.name, "NAS");
        assert_eq!(m.links.len(), 1, "files are not links: {:?}", m.links);
        assert_eq!(m.links[0].label, "Paperless");
        assert_eq!(m.links[0].url, "https://nas.example:8443");
        let m = add_machine_link(&dir, &org, "1", "Screen Sharing", "vnc://192.0.2.7").unwrap();
        assert_eq!(m.links.iter().map(|l| l.label.as_str()).collect::<Vec<_>>(), ["Paperless", "Screen Sharing"]);
        assert_eq!(one::<i64>(&conn, "SELECT count(*) FROM machine_files WHERE kind = 'link'"), 2);
        let log = std::fs::read_to_string(dir.join(crate::log::LOG_FILE)).unwrap();
        assert!(log.contains("add_machine_link") && log.contains("Paperless"), "{log}");
        assert_eq!(get_machine(&conn, &org, "NAS", false).unwrap().links.len(), 2);

        assert!(add_machine_link(&dir, &org, "NAS", "Again", "https://nas.example:8443").is_err(), "same address twice");
        assert!(add_machine_link(&dir, &org, "NAS", " ", "https://x.example").is_err(), "empty label");
        assert!(add_machine_link(&dir, &org, "NAS", "X", " ").is_err(), "empty address");
        assert!(add_machine_link(&dir, &org, "NAS", "X", "https://a b.example").is_err(), "spaces in address");
        assert!(add_machine_link(&dir, &org, "Nope", "X", "https://x.example").is_err(), "unknown machine");
        assert_eq!(one::<i64>(&conn, "SELECT count(*) FROM machine_files WHERE kind = 'link'"), 2);
    }

    #[test]
    fn create_and_update_machine() {
        let (dir, org, conn) = fixture();
        let fields = MachineFields {
            name: Some("Laptop".into()),
            maker: Some("Apple".into()),
            purchase_date: Some("2026-10-01".into()),
            currency: Some("chf".into()),
            ..Default::default()
        };
        let m = create_machine(&dir, &org, &fields, false).unwrap();
        assert_eq!((m.kind.as_str(), m.status.as_str()), ("generic", "working"));
        assert_eq!(
            one::<String>(&conn, "SELECT currency FROM machines WHERE name = 'Laptop'"),
            "CHF"
        );
        let dup = MachineFields {
            name: Some("laptop".into()),
            ..Default::default()
        };
        assert!(create_machine(&dir, &org, &dup, false)
            .unwrap_err()
            .contains("already exists"));

        let change = MachineFields {
            notes: Some("RAM: 32 GB".into()),
            maker: Some("".into()),
            warranty_until: Some("2028-01-01".into()),
            ..Default::default()
        };
        let m = update_machine(&dir, &org, "NAS", &change, false).unwrap();
        assert_eq!(m.notes.as_deref(), Some("RAM: 32 GB"));
        assert_eq!(m.maker, None);
        assert_eq!(m.warranty_until.as_deref(), Some("2028-01-01"));
        assert_eq!(
            one::<Option<String>>(
                &conn,
                "SELECT warranty_notified_for FROM machines WHERE id = 1"
            ),
            None,
            "a new warranty date is a new notice"
        );
        assert_eq!(
            one::<String>(&conn, "SELECT serial FROM machines WHERE id = 1"),
            "SN-1"
        );
        assert_eq!(
            update_machine(&dir, &org, "NAS", &MachineFields::default(), false).unwrap_err(),
            NOTHING
        );
        let bad = MachineFields {
            status: Some("gone".into()),
            ..Default::default()
        };
        assert_eq!(
            update_machine(&dir, &org, "NAS", &bad, false).unwrap_err(),
            MACHINE_STATUS
        );
        let rename = MachineFields {
            name: Some("Printer".into()),
            ..Default::default()
        };
        assert!(update_machine(&dir, &org, "NAS", &rename, false).is_err());
    }

    #[test]
    fn upkeep_item_added_and_done() {
        let (dir, org, conn) = fixture();
        let r = add_upkeep_item(
            &dir,
            &org,
            "NAS",
            "Check RAID",
            Some(3),
            "months",
            None,
            None,
            None,
            d("2026-11-01"),
        )
        .unwrap();
        assert_eq!(r.item.next_due.as_deref(), Some("2027-02-01"));
        assert_eq!(r.item.repeats, "every 3 month");
        let r2 = add_upkeep_item(
            &dir,
            &org,
            "NAS",
            "Clean",
            None,
            "year",
            None,
            Some("2026-01-31"),
            None,
            d("2026-11-01"),
        )
        .unwrap();
        assert_eq!(r2.item.next_due.as_deref(), Some("2027-01-31"));
        assert_eq!(
            one::<i64>(
                &conn,
                &format!(
                    "SELECT in_calendar FROM upkeep_items WHERE id = {}",
                    r.item.id
                )
            ),
            1
        );
        assert!(add_upkeep_item(
            &dir,
            &org,
            "NAS",
            "x",
            Some(0),
            "day",
            None,
            None,
            None,
            d("2026-11-01")
        )
        .is_err());
        assert!(add_upkeep_item(
            &dir,
            &org,
            "NAS",
            "x",
            None,
            "fortnight",
            None,
            None,
            None,
            d("2026-11-01")
        )
        .is_err());

        // Anchor 31 survives a short month.
        let done = mark_upkeep_done(&dir, &org, 1, "2026-02-28", None).unwrap();
        assert_eq!(done.item.next_due.as_deref(), Some("2026-08-31"));
        assert_eq!(done.item.last_done_on.as_deref(), Some("2026-02-28"));
        assert_eq!(
            one::<Option<String>>(&conn, "SELECT snooze_until FROM upkeep_items WHERE id = 1"),
            None
        );
        assert_eq!(
            one::<Option<String>>(
                &conn,
                "SELECT overdue_notified_for FROM upkeep_items WHERE id = 1"
            ),
            None
        );
        assert_eq!(
            one::<String>(
                &conn,
                "SELECT description FROM service_log WHERE upkeep_item_id = 1"
            ),
            "Dust filter"
        );
        assert!(mark_upkeep_done(&dir, &org, 99, "2026-02-28", None).is_err());
    }

    #[test]
    fn consumables_created_and_restocked() {
        let (dir, org, conn) = fixture();
        let c = create_consumable(
            &dir,
            &org,
            &ConsumableFields {
                name: Some("Paper".into()),
                machine: Some("Printer".into()),
                stock: Some(3.0),
                unit_price: Some(5.0),
                ..Default::default()
            },
            false,
        )
        .unwrap();
        assert_eq!(c.consumable.unit, "pcs");
        assert_eq!(c.consumable.machine.as_deref(), Some("Printer"));
        assert_eq!(c.consumable.unit_price, None, "hidden without money access");

        let r = update_consumable(
            &dir,
            &org,
            1,
            &ConsumableFields {
                add_stock: Some(2.0),
                ..Default::default()
            },
            false,
        )
        .unwrap();
        assert_eq!(r.consumable.stock, 2.0);
        assert!(!r.consumable.low);
        assert_eq!(
            one::<i64>(&conn, "SELECT low_notified FROM consumables WHERE id = 1"),
            0
        );
        let both = ConsumableFields {
            stock: Some(1.0),
            add_stock: Some(1.0),
            ..Default::default()
        };
        assert_eq!(
            update_consumable(&dir, &org, 1, &both, false).unwrap_err(),
            STOCK_BOTH
        );
        assert_eq!(
            update_consumable(&dir, &org, 1, &ConsumableFields::default(), false).unwrap_err(),
            NOTHING
        );
        let detach = ConsumableFields {
            machine: Some("".into()),
            ..Default::default()
        };
        assert_eq!(
            update_consumable(&dir, &org, 1, &detach, false)
                .unwrap()
                .consumable
                .machine_id,
            None
        );
    }

    #[test]
    fn subscriptions_created_and_updated() {
        let (dir, org, conn) = fixture();
        let s = create_subscription(
            &dir,
            &org,
            "Cloud backup",
            "2026-12-31",
            "month",
            Some(9.0),
            Some("eur"),
            None,
            Some("Synology"),
            None,
            None,
            true,
        )
        .unwrap();
        assert_eq!(s.subscription.cost, Some(9.0));
        assert_eq!(s.subscription.currency.as_deref(), Some("EUR"));
        assert_eq!(
            one::<i64>(
                &conn,
                &format!(
                    "SELECT anchor_day FROM subscriptions WHERE id = {}",
                    s.subscription.id
                )
            ),
            31
        );
        assert!(create_subscription(
            &dir,
            &org,
            "font LICENCE",
            "2026-12-31",
            "year",
            None,
            None,
            None,
            None,
            None,
            None,
            false
        )
        .unwrap_err()
        .contains("already exists"));
        assert_eq!(
            create_subscription(
                &dir,
                &org,
                "X",
                "2026-12-31",
                "weekly",
                None,
                None,
                None,
                None,
                None,
                None,
                false
            )
            .unwrap_err(),
            PERIOD
        );

        let u = update_subscription(
            &dir,
            &org,
            1,
            &SubscriptionChanges {
                status: Some("cancelled".into()),
                ..Default::default()
            },
            false,
        )
        .unwrap();
        assert_eq!(u.subscription.status, "cancelled");
        assert_eq!(u.subscription.cost, None);
        assert_eq!(
            one::<String>(
                &conn,
                "SELECT calendar_event_id FROM subscriptions WHERE id = 1"
            ),
            "EV-1",
            "calendar ids are the app's"
        );
        assert_eq!(list_subscriptions(&conn, false).unwrap().len(), 2);
    }

    #[test]
    fn borrowed_equipment_goes_to_the_owner() {
        let dir = temp_data_dir();
        write_registry(&dir, &[("org-b", "Side"), ("org-a", "Main")]);
        seed_app_db(&dir, "org-a");
        seed_app_db(&dir, "org-b");
        let mut reg = Registry::load(&dir).unwrap().unwrap();
        let prefs = crate::orgs::OrgPrefs {
            equipment_from: Some("org-a".into()),
            ..Default::default()
        };
        reg.set_prefs("org-b", prefs).unwrap();
        reg.save(&dir).unwrap();
        allow_listed(&dir, false, &[]);
        let side = guard::resolve_org(&dir, None).unwrap();
        assert_eq!(side.id, "org-b");
        let fields = MachineFields {
            name: Some("Plotter".into()),
            ..Default::default()
        };
        let m = create_machine(&dir, &side, &fields, false).unwrap();
        assert_eq!(m.org, "Main");
        let main_db = Connection::open(db_path(&dir, "org-a")).unwrap();
        assert_eq!(one::<i64>(&main_db, "SELECT COUNT(*) FROM machines"), 1);
        let side_db = Connection::open(db_path(&dir, "org-b")).unwrap();
        assert_eq!(one::<i64>(&side_db, "SELECT COUNT(*) FROM machines"), 0);
        // Subscriptions stay with the organisation itself.
        create_subscription(
            &dir,
            &side,
            "Hosting",
            "2027-01-01",
            "year",
            None,
            None,
            None,
            None,
            None,
            None,
            false,
        )
        .unwrap();
        assert_eq!(
            one::<i64>(&side_db, "SELECT COUNT(*) FROM subscriptions"),
            1
        );

        allow_listed(&dir, false, &["org-a"]);
        assert_eq!(equipment_org(&dir, &side).unwrap_err(), EQUIPMENT_OFF);
    }
}
