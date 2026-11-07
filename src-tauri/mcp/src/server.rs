//! MCP protocol layer: one tool per pure function in `read`, `write` and
//! `money`. Every call resolves its organisation through the guards (the
//! access settings are re-read each time), runs the database work on the
//! blocking pool and answers with pretty JSON text, or with a tool error
//! carrying the guard's exact message. Bad arguments (unknown keys such as
//! `calendar_event_id`, wrong types) are tool errors too: every input denies
//! unknown fields and rmcp reports a failed parse as `isError`.

use crate::guard::{self, AccessConfig, Org};
use crate::orgs::Registry;
use crate::write::{ProjectChanges, SubtaskChanges, TaskChanges};
use crate::upkeep::{ConsumableFields, MachineFields, SubscriptionChanges};
use crate::{money, read, upkeep, write};
use chrono::{Datelike, Local};
use rmcp::handler::server::router::tool::ToolRouter;
use rmcp::handler::server::wrapper::Parameters;
use rmcp::model::{CallToolResult, ContentBlock, Implementation, ServerCapabilities, ServerConfig};
use rmcp::{tool, tool_handler, tool_router, ServerHandler};
use rusqlite::Connection;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

type R<T> = Result<T, String>;

pub const INSTRUCTIONS: &str = "\
StudioManager is the user's studio management app: organisations, clients, projects, tasks, \
project wikis, upkeep (machines, consumables, subscriptions) and, when allowed, invoices, quotes and expenses.
Name the organisation in what you tell the user (every result carries it).
Nothing can be deleted through these tools.
Ask the user before creating a client or a project, and before every upkeep write (say exactly what you will save).
When a name matches more than one record, the candidates come back: use the id.
Dates are YYYY-MM-DD.
Wiki articles link to each other: write [[Title]] or [[Project/Title]] for every related article (see put_wiki_article).";

pub const MONEY_TOOLS: [&str; 5] = [
    "list_invoices",
    "get_invoice",
    "list_quotes",
    "list_expenses",
    "pnl_summary",
];

/// Upkeep tools that write: each one's description tells the agent to ask
/// the user first.
pub const UPKEEP_WRITES: [&str; 10] = [
    "add_service_log",
    "add_machine_link",
    "create_machine",
    "update_machine",
    "add_upkeep_item",
    "mark_upkeep_done",
    "create_consumable",
    "update_consumable",
    "create_subscription",
    "update_subscription",
];

#[derive(Clone)]
pub struct Server {
    /// The data dir, or why it could not be found (every tool returns it).
    dir: Result<PathBuf, String>,
    tool_router: ToolRouter<Server>,
}

// ── Inputs ───────────────────────────────────────────────────

/// Optional organisation, by id or name; the app's active one when omitted.
#[derive(Deserialize, JsonSchema, Default)]
#[serde(deny_unknown_fields)]
pub struct OrgOnly {
    /// Organisation id or name. Default: the active organisation.
    pub org: Option<String>,
}

#[derive(Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct FolderInput {
    /// Organisation id or name. Default: search every allowed organisation.
    pub org: Option<String>,
    /// Absolute folder path; its nearest linked ancestor counts.
    pub path: String,
}

#[derive(Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct LinkFolderInput {
    /// Organisation id or name. Default: the active organisation.
    pub org: Option<String>,
    /// Project name or id.
    pub project: String,
    /// Absolute folder path.
    pub folder: String,
}

#[derive(Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct ListProjectsInput {
    /// Organisation id or name. Default: the active organisation.
    pub org: Option<String>,
    /// active, completed, on_hold or cancelled.
    pub status: Option<String>,
    /// Client name or id.
    pub client: Option<String>,
    /// Text contained in the project or client name.
    pub text: Option<String>,
}

#[derive(Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct ProjectInput {
    /// Organisation id or name. Default: the active organisation.
    pub org: Option<String>,
    /// Project name or id.
    pub project: String,
}

#[derive(Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct CreateProjectInput {
    /// Organisation id or name. Default: the active organisation.
    pub org: Option<String>,
    /// Client name or id.
    pub client: String,
    pub name: String,
    /// active (default), completed, on_hold or cancelled.
    pub status: Option<String>,
    /// YYYY-MM-DD.
    pub deadline: Option<String>,
    pub notes: Option<String>,
}

#[derive(Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct UpdateProjectInput {
    /// Organisation id or name. Default: the active organisation.
    pub org: Option<String>,
    /// Project name or id.
    pub project: String,
    /// active, completed, on_hold or cancelled.
    pub status: Option<String>,
    /// YYYY-MM-DD; empty clears it.
    pub deadline: Option<String>,
    pub notes: Option<String>,
    /// Absolute folder path; empty clears it.
    pub folder_path: Option<String>,
}

#[derive(Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct ListTasksInput {
    /// Organisation id or name. Default: the active organisation.
    pub org: Option<String>,
    /// Project name or id.
    pub project: Option<String>,
    /// todo, in_progress or done.
    pub status: Option<String>,
    /// YYYY-MM-DD, inclusive.
    pub due_before: Option<String>,
}

#[derive(Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct CreateTaskInput {
    /// Organisation id or name. Default: the active organisation.
    pub org: Option<String>,
    /// Project name or id.
    pub project: String,
    pub title: String,
    /// YYYY-MM-DD.
    pub due_date: Option<String>,
    /// low, medium or high.
    pub priority: Option<String>,
    pub notes: Option<String>,
}

#[derive(Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct UpdateTaskInput {
    /// Organisation id or name. Default: the active organisation.
    pub org: Option<String>,
    pub task_id: i64,
    pub title: Option<String>,
    /// todo or done.
    pub status: Option<String>,
    /// YYYY-MM-DD; empty clears it.
    pub due_date: Option<String>,
    /// low, medium or high.
    pub priority: Option<String>,
    pub notes: Option<String>,
}

#[derive(Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct CreateSubtaskInput {
    /// Organisation id or name. Default: the active organisation.
    pub org: Option<String>,
    pub task_id: i64,
    pub title: String,
    /// YYYY-MM-DD.
    pub due_date: Option<String>,
}

#[derive(Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct UpdateSubtaskInput {
    /// Organisation id or name. Default: the active organisation.
    pub org: Option<String>,
    pub subtask_id: i64,
    pub title: Option<String>,
    /// todo or done.
    pub status: Option<String>,
    /// YYYY-MM-DD; empty clears it.
    pub due_date: Option<String>,
}

#[derive(Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct ListClientsInput {
    /// Organisation id or name. Default: the active organisation.
    pub org: Option<String>,
    /// Text contained in the client name or email.
    pub text: Option<String>,
    /// Include archived clients, which are left out by default.
    pub include_archived: Option<bool>,
}

#[derive(Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct ClientInput {
    /// Organisation id or name. Default: the active organisation.
    pub org: Option<String>,
    /// Client name or id.
    pub client: String,
}

#[derive(Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct CreateClientInput {
    /// Organisation id or name. Default: the active organisation.
    pub org: Option<String>,
    pub name: String,
    pub email: Option<String>,
    /// Document language, e.g. FR or EN.
    pub language: Option<String>,
}

#[derive(Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct ArticleInput {
    /// Organisation id or name. Default: the active organisation.
    pub org: Option<String>,
    /// Project name or id.
    pub project: String,
    pub title: String,
}

#[derive(Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct PutArticleInput {
    /// Organisation id or name. Default: the active organisation.
    pub org: Option<String>,
    /// Project name or id.
    pub project: String,
    pub title: String,
    /// Markdown; replaces the whole article.
    pub content: String,
}

#[derive(Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct DecisionInput {
    /// Organisation id or name. Default: the active organisation.
    pub org: Option<String>,
    /// Project name or id.
    pub project: String,
    /// The decision, one line.
    pub text: String,
    /// YYYY-MM-DD. Default: today.
    pub date: Option<String>,
}

#[derive(Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct LinkToolInput {
    /// Organisation id or name. Default: the active organisation.
    pub org: Option<String>,
    /// Project name or id.
    pub project: String,
    /// Tool name (software, framework, hardware).
    pub name: String,
    pub url: Option<String>,
}

#[derive(Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct WhatsDueInput {
    /// Organisation id or name. Default: every allowed organisation.
    pub org: Option<String>,
    /// Days ahead to look. Default: 7.
    pub days: Option<i64>,
}

#[derive(Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct StatusYearInput {
    /// Organisation id or name. Default: the active organisation.
    pub org: Option<String>,
    pub status: Option<String>,
    pub year: Option<i32>,
}

#[derive(Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct InvoiceInput {
    /// Organisation id or name. Default: the active organisation.
    pub org: Option<String>,
    /// Invoice reference or id.
    pub invoice: String,
}

#[derive(Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct YearMonthInput {
    /// Organisation id or name. Default: the active organisation.
    pub org: Option<String>,
    /// Default for pnl_summary: the current year.
    pub year: Option<i32>,
    /// 1 to 12.
    pub month: Option<u32>,
}

#[derive(Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct MachineInput {
    /// Organisation id or name. Default: the active organisation.
    pub org: Option<String>,
    /// Machine name or id.
    pub machine: String,
}

#[derive(Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct CreateMachineInput {
    /// Organisation id or name. Default: the active organisation.
    pub org: Option<String>,
    pub name: String,
    /// Free text, e.g. NAS, 3D printer, Laptop. Default: generic.
    pub kind: Option<String>,
    pub maker: Option<String>,
    pub model: Option<String>,
    pub location: Option<String>,
    /// working (default), attention, broken, lent or retired.
    pub status: Option<String>,
    /// YYYY-MM-DD.
    pub purchase_date: Option<String>,
    pub supplier: Option<String>,
    pub price: Option<f64>,
    /// e.g. CHF, EUR.
    pub currency: Option<String>,
    /// YYYY-MM-DD.
    pub warranty_until: Option<String>,
    pub lifespan_years: Option<f64>,
    pub notes: Option<String>,
}

#[derive(Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct UpdateMachineInput {
    /// Organisation id or name. Default: the active organisation.
    pub org: Option<String>,
    /// Machine name or id.
    pub machine: String,
    pub name: Option<String>,
    pub kind: Option<String>,
    /// Empty clears it.
    pub maker: Option<String>,
    /// Empty clears it.
    pub model: Option<String>,
    /// Empty clears it.
    pub location: Option<String>,
    /// working, attention, broken, lent or retired.
    pub status: Option<String>,
    /// Empty clears it.
    pub lent_to: Option<String>,
    /// YYYY-MM-DD; empty clears it.
    pub lent_until: Option<String>,
    /// YYYY-MM-DD; empty clears it.
    pub purchase_date: Option<String>,
    /// Empty clears it.
    pub supplier: Option<String>,
    pub price: Option<f64>,
    pub currency: Option<String>,
    /// YYYY-MM-DD; empty clears it.
    pub warranty_until: Option<String>,
    pub lifespan_years: Option<f64>,
    /// Replaces the notes; read them with get_machine first to keep them.
    pub notes: Option<String>,
}

#[derive(Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct MachineLinkInput {
    /// Organisation id or name. Default: the active organisation.
    pub org: Option<String>,
    /// Machine name or id.
    pub machine: String,
    /// What the link opens, e.g. "Paperless" or "Screen Sharing".
    pub label: String,
    /// The address: a web page (https://…) or a remote-access link (vnc://…).
    pub url: String,
}

#[derive(Deserialize, JsonSchema)]
pub struct ServiceLogInput {
    /// Organisation id or name. Default: the active organisation.
    pub org: Option<String>,
    /// Machine name or id.
    pub machine: String,
    /// What was done, e.g. "Installed 2 x 16 GB RAM".
    pub description: String,
    /// YYYY-MM-DD. Default: today.
    pub done_on: Option<String>,
    pub cost: Option<f64>,
}

#[derive(Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct UpkeepItemInput {
    /// Organisation id or name. Default: the active organisation.
    pub org: Option<String>,
    /// Machine name or id.
    pub machine: String,
    /// e.g. "Clean the dust filter".
    pub title: String,
    /// Repeat every N units. Default: 1.
    pub every: Option<i64>,
    /// day, week, month or year.
    pub unit: String,
    /// YYYY-MM-DD the schedule counts from when it was never done. Default: today.
    pub start_on: Option<String>,
    /// YYYY-MM-DD it was last done, if known.
    pub last_done_on: Option<String>,
    pub notes: Option<String>,
}

#[derive(Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct UpkeepDoneInput {
    /// Organisation id or name. Default: the active organisation.
    pub org: Option<String>,
    /// From get_machine.
    pub item_id: i64,
    /// YYYY-MM-DD. Default: today.
    pub done_on: Option<String>,
    /// Service log text. Default: the item's title.
    pub note: Option<String>,
}

#[derive(Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct CreateConsumableInput {
    /// Organisation id or name. Default: the active organisation.
    pub org: Option<String>,
    pub name: String,
    /// Machine name or id it is used by.
    pub machine: Option<String>,
    /// Default: pcs.
    pub unit: Option<String>,
    pub stock: Option<f64>,
    /// Low-stock notice below this.
    pub reorder_level: Option<f64>,
    pub supplier: Option<String>,
    pub product_url: Option<String>,
    pub unit_price: Option<f64>,
    pub currency: Option<String>,
}

#[derive(Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct UpdateConsumableInput {
    /// Organisation id or name. Default: the active organisation.
    pub org: Option<String>,
    pub consumable_id: i64,
    pub name: Option<String>,
    /// Machine name or id; empty detaches it.
    pub machine: Option<String>,
    pub unit: Option<String>,
    /// New stock count.
    pub stock: Option<f64>,
    /// Stock to add (a restock). Not with stock.
    pub add_stock: Option<f64>,
    pub reorder_level: Option<f64>,
    /// Empty clears it.
    pub supplier: Option<String>,
    /// Empty clears it.
    pub product_url: Option<String>,
    pub unit_price: Option<f64>,
    pub currency: Option<String>,
}

#[derive(Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct CreateSubscriptionInput {
    /// Organisation id or name. Default: the active organisation.
    pub org: Option<String>,
    pub name: String,
    /// Next renewal, YYYY-MM-DD.
    pub renews_on: String,
    /// month or year.
    pub period: String,
    /// Per period. Default: 0.
    pub cost: Option<f64>,
    pub currency: Option<String>,
    pub plan: Option<String>,
    pub vendor: Option<String>,
    pub url: Option<String>,
    pub notes: Option<String>,
}

#[derive(Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct UpdateSubscriptionInput {
    /// Organisation id or name. Default: the active organisation.
    pub org: Option<String>,
    pub subscription_id: i64,
    /// Empty clears it.
    pub plan: Option<String>,
    /// Empty clears it.
    pub vendor: Option<String>,
    /// Empty clears it.
    pub url: Option<String>,
    pub cost: Option<f64>,
    pub currency: Option<String>,
    /// active or cancelled.
    pub status: Option<String>,
    /// Empty clears it.
    pub notes: Option<String>,
}

// ── Plumbing ─────────────────────────────────────────────────

fn ok(v: Value) -> CallToolResult {
    let text = serde_json::to_string_pretty(&v).unwrap_or_else(|_| v.to_string());
    CallToolResult::success(vec![ContentBlock::text(text)])
}

fn fail(msg: impl Into<String>) -> CallToolResult {
    CallToolResult::error(vec![ContentBlock::text(msg.into())])
}

fn to_json<T: Serialize>(v: T) -> R<Value> {
    serde_json::to_value(v).map_err(|e| format!("Could not encode the result: {e}"))
}

/// Name the organisation in the result: objects get an `org` field, lists
/// become `{org, items}`.
fn with_org(org: &Org, v: Value) -> Value {
    match v {
        Value::Object(mut m) => {
            m.insert("org".into(), json!(org.name));
            Value::Object(m)
        }
        other => json!({"org": org.name, "items": other}),
    }
}

fn read_in<T: Serialize>(
    dir: &Path,
    org: Option<&str>,
    f: impl FnOnce(&Connection) -> R<T>,
) -> R<Value> {
    let org = guard::resolve_org(dir, org)?;
    let conn = guard::open_read(&org)?;
    Ok(with_org(&org, to_json(f(&conn)?)?))
}

fn money_in<T: Serialize>(
    dir: &Path,
    org: Option<&str>,
    f: impl FnOnce(&Connection, &AccessConfig) -> R<T>,
) -> R<Value> {
    let access = AccessConfig::load(dir);
    // Refuse before touching the organisation or the database.
    if !access.allow_money {
        return Err(money::MONEY_OFF.to_string());
    }
    read_in(dir, org, |conn| f(conn, &access))
}

fn write_in<T: Serialize>(
    dir: &Path,
    org: Option<&str>,
    f: impl FnOnce(&Path, &Org) -> R<T>,
) -> R<Value> {
    let org = guard::resolve_org(dir, org)?;
    to_json(f(dir, &org)?)
}

fn allow_money(dir: &Path) -> bool {
    AccessConfig::load(dir).allow_money
}

/// Read machines, upkeep or consumables where the organisation's equipment
/// lives (it may borrow another organisation's); the result names that one.
fn equipment_in<T: Serialize>(
    dir: &Path,
    org: Option<&str>,
    f: impl FnOnce(&Connection, &Org, bool) -> R<T>,
) -> R<Value> {
    let org = guard::resolve_org(dir, org)?;
    let (eq, conn) = upkeep::open_equipment_read(dir, &org)?;
    Ok(with_org(&eq, to_json(f(&conn, &eq, allow_money(dir))?)?))
}

fn today_iso() -> String {
    today().format("%Y-%m-%d").to_string()
}

fn today() -> chrono::NaiveDate {
    Local::now().date_naive()
}

/// Organisations agent access allows, in registry order.
fn allowed_orgs(dir: &Path) -> R<Vec<Org>> {
    let access = AccessConfig::load(dir);
    if !access.enabled {
        return Err(guard::OFF_OVERALL.to_string());
    }
    let registry = Registry::load(dir)?.ok_or_else(|| guard::NOT_OPENED.to_string())?;
    registry
        .organisations
        .iter()
        .filter(|o| access.org_allowed(&o.id))
        .map(|o| guard::resolve_org(dir, Some(&o.id)))
        .collect()
}

/// Only organisations agent access allows are listed; hidden ones are not
/// mentioned at all.
fn list_organisations(dir: &Path) -> R<Value> {
    let access = AccessConfig::load(dir);
    if !access.enabled {
        return Err(guard::OFF_OVERALL.to_string());
    }
    let registry = Registry::load(dir)?.ok_or_else(|| guard::NOT_OPENED.to_string())?;
    let orgs: Vec<Value> = registry
        .organisations
        .iter()
        .filter(|o| access.org_allowed(&o.id))
        .map(|o| {
            json!({
                "id": o.id,
                "name": o.name,
                "active": o.id == registry.active_id,
            })
        })
        .collect();
    Ok(json!({"organisations": orgs}))
}

/// The organisations a call covers: the named one, or every allowed one.
fn target_orgs(dir: &Path, explicit: Option<&str>) -> R<Vec<Org>> {
    match explicit {
        Some(o) => Ok(vec![guard::resolve_org(dir, Some(o))?]),
        None => allowed_orgs(dir),
    }
}

fn explicit_org(org: Option<&str>) -> Option<&str> {
    org.map(str::trim).filter(|o| !o.is_empty())
}

/// Open each organisation for reading. A named organisation that fails is
/// the call's error; across every organisation, failures are collected as
/// `{org, error}` so the rest still answer.
fn open_each(orgs: &[Org], explicit: bool, errors: &mut Vec<Value>) -> R<Vec<(Org, Connection)>> {
    let mut out = Vec::new();
    for o in orgs {
        match guard::open_read(o) {
            Ok(c) => out.push((o.clone(), c)),
            Err(e) if explicit => return Err(e),
            Err(e) => errors.push(json!({"org": o.name, "error": e})),
        }
    }
    Ok(out)
}

fn find_project_for_folder(dir: &Path, org: Option<&str>, path: &str) -> R<Value> {
    let explicit = explicit_org(org);
    let orgs = target_orgs(dir, explicit)?;
    let mut errors = Vec::new();
    let mut matches = Vec::new();
    for (o, conn) in open_each(&orgs, explicit.is_some(), &mut errors)? {
        if let Some(p) = read::find_project_for_folder(&conn, path) {
            matches.push(json!({"org": o.name, "project": p}));
        }
    }
    let mut out = match matches.len() {
        0 => json!({"project": null}),
        1 => matches.remove(0),
        _ => json!({"matches": matches}),
    };
    if !errors.is_empty() {
        out["errors"] = json!(errors);
    }
    Ok(out)
}

fn whats_due(dir: &Path, org: Option<&str>, days: Option<i64>) -> R<Value> {
    let days = days.unwrap_or(7);
    let today = today();
    let explicit = explicit_org(org);
    let orgs = target_orgs(dir, explicit)?;
    let mut items: Vec<Value> = Vec::new();
    let mut errors: Vec<Value> = Vec::new();
    for (o, conn) in open_each(&orgs, explicit.is_some(), &mut errors)? {
        match read::whats_due(&conn, days, today) {
            Ok(list) => {
                for item in list {
                    items.push(with_org(&o, to_json(item)?));
                }
            }
            Err(e) if explicit.is_some() => return Err(e),
            Err(e) => errors.push(json!({"org": o.name, "error": e})),
        }
    }
    items.sort_by(|a, b| a["date"].as_str().cmp(&b["date"].as_str()));
    let mut out = json!({
        "today": today.format("%Y-%m-%d").to_string(),
        "days": days,
        "items": items,
    });
    if !errors.is_empty() {
        out["errors"] = json!(errors);
    }
    Ok(out)
}

impl Server {
    pub fn new(dir: Result<PathBuf, String>) -> Server {
        let mut tool_router = Self::tool_router();
        let money = dir
            .as_ref()
            .map(|d| AccessConfig::load(d).allow_money)
            .unwrap_or(false);
        if !money {
            for name in MONEY_TOOLS {
                tool_router.remove_route(name);
            }
        }
        Server { dir, tool_router }
    }

    /// Run `f` against the data dir on the blocking pool.
    async fn run<F>(&self, f: F) -> CallToolResult
    where
        F: FnOnce(&Path) -> R<Value> + Send + 'static,
    {
        let dir = match &self.dir {
            Ok(d) => d.clone(),
            Err(e) => return fail(e.clone()),
        };
        match tokio::task::spawn_blocking(move || f(&dir)).await {
            Ok(Ok(v)) => ok(v),
            Ok(Err(e)) => fail(e),
            Err(e) => fail(format!("Internal error: {e}")),
        }
    }
}

#[tool_router]
impl Server {
    #[tool(description = "List the StudioManager organisations agent access allows.")]
    async fn list_organisations(&self) -> CallToolResult {
        self.run(list_organisations).await
    }

    #[tool(
        description = "Find the project linked to a folder (or its nearest linked parent). Without org, searches every allowed organisation."
    )]
    async fn find_project_for_folder(
        &self,
        Parameters(p): Parameters<FolderInput>,
    ) -> CallToolResult {
        self.run(move |d| find_project_for_folder(d, p.org.as_deref(), &p.path))
            .await
    }

    #[tool(description = "Link a folder to a project.")]
    async fn link_folder(&self, Parameters(p): Parameters<LinkFolderInput>) -> CallToolResult {
        self.run(move |d| {
            write_in(d, p.org.as_deref(), |d, o| {
                write::link_folder(d, o, &p.project, &p.folder)
            })
        })
        .await
    }

    #[tool(description = "List projects, optionally by status, client or text.")]
    async fn list_projects(&self, Parameters(p): Parameters<ListProjectsInput>) -> CallToolResult {
        self.run(move |d| {
            read_in(d, p.org.as_deref(), |c| {
                read::list_projects(
                    c,
                    p.status.as_deref(),
                    p.client.as_deref(),
                    p.text.as_deref(),
                )
            })
        })
        .await
    }

    #[tool(description = "Get a project with its notes, tasks, subtasks, wiki articles and tools.")]
    async fn get_project(&self, Parameters(p): Parameters<ProjectInput>) -> CallToolResult {
        self.run(move |d| read_in(d, p.org.as_deref(), |c| read::get_project(c, &p.project)))
            .await
    }

    #[tool(description = "Ask the user before calling. Create a project for a client.")]
    async fn create_project(
        &self,
        Parameters(p): Parameters<CreateProjectInput>,
    ) -> CallToolResult {
        self.run(move |d| {
            write_in(d, p.org.as_deref(), |d, o| {
                write::create_project(
                    d,
                    o,
                    &p.client,
                    &p.name,
                    p.status.as_deref(),
                    p.deadline.as_deref(),
                    p.notes.as_deref(),
                )
            })
        })
        .await
    }

    #[tool(description = "Change a project's status, deadline, notes or folder.")]
    async fn update_project(
        &self,
        Parameters(p): Parameters<UpdateProjectInput>,
    ) -> CallToolResult {
        self.run(move |d| {
            let changes = ProjectChanges {
                status: p.status,
                deadline: p.deadline,
                notes: p.notes,
                folder_path: p.folder_path,
            };
            write_in(d, p.org.as_deref(), |d, o| {
                write::update_project(d, o, &p.project, &changes)
            })
        })
        .await
    }

    #[tool(description = "List tasks, optionally by project, status or due date.")]
    async fn list_tasks(&self, Parameters(p): Parameters<ListTasksInput>) -> CallToolResult {
        self.run(move |d| {
            read_in(d, p.org.as_deref(), |c| {
                read::list_tasks(
                    c,
                    p.project.as_deref(),
                    p.status.as_deref(),
                    p.due_before.as_deref(),
                )
            })
        })
        .await
    }

    #[tool(description = "Add a task to a project.")]
    async fn create_task(&self, Parameters(p): Parameters<CreateTaskInput>) -> CallToolResult {
        self.run(move |d| {
            write_in(d, p.org.as_deref(), |d, o| {
                write::create_task(
                    d,
                    o,
                    &p.project,
                    &p.title,
                    p.due_date.as_deref(),
                    p.priority.as_deref(),
                    p.notes.as_deref(),
                )
            })
        })
        .await
    }

    #[tool(
        description = "Change a task's title, status (todo or done), due date, priority or notes."
    )]
    async fn update_task(&self, Parameters(p): Parameters<UpdateTaskInput>) -> CallToolResult {
        self.run(move |d| {
            let changes = TaskChanges {
                title: p.title,
                status: p.status,
                due_date: p.due_date,
                priority: p.priority,
                notes: p.notes,
            };
            write_in(d, p.org.as_deref(), |d, o| {
                write::update_task(d, o, p.task_id, &changes)
            })
        })
        .await
    }

    #[tool(description = "Add a subtask to a task.")]
    async fn create_subtask(
        &self,
        Parameters(p): Parameters<CreateSubtaskInput>,
    ) -> CallToolResult {
        self.run(move |d| {
            write_in(d, p.org.as_deref(), |d, o| {
                write::create_subtask(d, o, p.task_id, &p.title, p.due_date.as_deref())
            })
        })
        .await
    }

    #[tool(description = "Change a subtask's title, status (todo or done) or due date.")]
    async fn update_subtask(
        &self,
        Parameters(p): Parameters<UpdateSubtaskInput>,
    ) -> CallToolResult {
        self.run(move |d| {
            let changes = SubtaskChanges {
                title: p.title,
                status: p.status,
                due_date: p.due_date,
            };
            write_in(d, p.org.as_deref(), |d, o| {
                write::update_subtask(d, o, p.subtask_id, &changes)
            })
        })
        .await
    }

    #[tool(description = "List clients, optionally by text. Archived clients are left out unless include_archived is true.")]
    async fn list_clients(&self, Parameters(p): Parameters<ListClientsInput>) -> CallToolResult {
        self.run(move |d| {
            read_in(d, p.org.as_deref(), |c| {
                read::list_clients(c, p.text.as_deref(), p.include_archived.unwrap_or(false))
            })
        })
        .await
    }

    #[tool(
        description = "List the studio's machines and equipment with status, location and next upkeep (title and due date). No readings, no connection details."
    )]
    async fn list_machines(&self, Parameters(p): Parameters<OrgOnly>) -> CallToolResult {
        self.run(move |d| equipment_in(d, p.org.as_deref(), |c, _, _| read::list_machines(c)))
            .await
    }

    #[tool(
        description = "Get a machine with its upkeep items, service log and consumables. No serial, readings or connection; costs only when money reading is allowed."
    )]
    async fn get_machine(&self, Parameters(p): Parameters<MachineInput>) -> CallToolResult {
        self.run(move |d| {
            equipment_in(d, p.org.as_deref(), |c, o, money| {
                upkeep::get_machine(c, o, &p.machine, money)
            })
        })
        .await
    }

    #[tool(description = "List consumables with stock and reorder level, lowest stock first.")]
    async fn list_consumables(&self, Parameters(p): Parameters<OrgOnly>) -> CallToolResult {
        self.run(move |d| {
            equipment_in(d, p.org.as_deref(), |c, _, money| {
                upkeep::list_consumables(c, money)
            })
        })
        .await
    }

    #[tool(description = "List subscriptions with their renewal date and period, active ones first.")]
    async fn list_subscriptions(&self, Parameters(p): Parameters<OrgOnly>) -> CallToolResult {
        self.run(move |d| {
            let money = allow_money(d);
            read_in(d, p.org.as_deref(), |c| upkeep::list_subscriptions(c, money))
        })
        .await
    }

    #[tool(
        description = "Ask the user before calling. Add a dated entry to a machine's service log: a repair, an upgrade (e.g. RAM), a part replaced. For a scheduled upkeep item use mark_upkeep_done."
    )]
    async fn add_service_log(&self, Parameters(p): Parameters<ServiceLogInput>) -> CallToolResult {
        self.run(move |d| {
            let done_on = p.done_on.clone().unwrap_or_else(today_iso);
            let money = allow_money(d);
            write_in(d, p.org.as_deref(), |d, o| {
                upkeep::add_service_log(d, o, &p.machine, &p.description, &done_on, p.cost, money)
            })
        })
        .await
    }

    #[tool(
        description = "Ask the user before calling. Add a link to a machine: a web page of a service it runs (e.g. Paperless on the NAS) or a remote-access link (vnc://…). StudioManager's Network page lists these with their status."
    )]
    async fn add_machine_link(&self, Parameters(p): Parameters<MachineLinkInput>) -> CallToolResult {
        self.run(move |d| {
            write_in(d, p.org.as_deref(), |d, o| upkeep::add_machine_link(d, o, &p.machine, &p.label, &p.url))
        })
        .await
    }

    #[tool(description = "Ask the user before calling. Add a machine or piece of equipment to Upkeep.")]
    async fn create_machine(&self, Parameters(p): Parameters<CreateMachineInput>) -> CallToolResult {
        self.run(move |d| {
            let fields = MachineFields {
                name: Some(p.name),
                kind: p.kind,
                maker: p.maker,
                model: p.model,
                location: p.location,
                status: p.status,
                lent_to: None,
                lent_until: None,
                purchase_date: p.purchase_date,
                supplier: p.supplier,
                price: p.price,
                currency: p.currency,
                warranty_until: p.warranty_until,
                lifespan_years: p.lifespan_years,
                notes: p.notes,
            };
            let money = allow_money(d);
            write_in(d, p.org.as_deref(), |d, o| {
                upkeep::create_machine(d, o, &fields, money)
            })
        })
        .await
    }

    #[tool(
        description = "Ask the user before calling. Change a machine's details, status or notes. Notes are replaced: read them with get_machine first."
    )]
    async fn update_machine(&self, Parameters(p): Parameters<UpdateMachineInput>) -> CallToolResult {
        self.run(move |d| {
            let fields = MachineFields {
                name: p.name,
                kind: p.kind,
                maker: p.maker,
                model: p.model,
                location: p.location,
                status: p.status,
                lent_to: p.lent_to,
                lent_until: p.lent_until,
                purchase_date: p.purchase_date,
                supplier: p.supplier,
                price: p.price,
                currency: p.currency,
                warranty_until: p.warranty_until,
                lifespan_years: p.lifespan_years,
                notes: p.notes,
            };
            let money = allow_money(d);
            write_in(d, p.org.as_deref(), |d, o| {
                upkeep::update_machine(d, o, &p.machine, &fields, money)
            })
        })
        .await
    }

    #[tool(
        description = "Ask the user before calling. Add a repeating upkeep item to a machine (e.g. clean the filter every 6 months). StudioManager adds it to the calendar when it next opens."
    )]
    async fn add_upkeep_item(&self, Parameters(p): Parameters<UpkeepItemInput>) -> CallToolResult {
        self.run(move |d| {
            write_in(d, p.org.as_deref(), |d, o| {
                upkeep::add_upkeep_item(
                    d,
                    o,
                    &p.machine,
                    &p.title,
                    p.every,
                    &p.unit,
                    p.start_on.as_deref(),
                    p.last_done_on.as_deref(),
                    p.notes.as_deref(),
                    today(),
                )
            })
        })
        .await
    }

    #[tool(
        description = "Ask the user before calling. Mark an upkeep item done: logs the service and moves its next due date."
    )]
    async fn mark_upkeep_done(&self, Parameters(p): Parameters<UpkeepDoneInput>) -> CallToolResult {
        self.run(move |d| {
            let done_on = p.done_on.clone().unwrap_or_else(today_iso);
            write_in(d, p.org.as_deref(), |d, o| {
                upkeep::mark_upkeep_done(d, o, p.item_id, &done_on, p.note.as_deref())
            })
        })
        .await
    }

    #[tool(description = "Ask the user before calling. Add a consumable (ink, filament, filters...).")]
    async fn create_consumable(
        &self,
        Parameters(p): Parameters<CreateConsumableInput>,
    ) -> CallToolResult {
        self.run(move |d| {
            let fields = ConsumableFields {
                name: Some(p.name),
                machine: p.machine,
                unit: p.unit,
                stock: p.stock,
                add_stock: None,
                reorder_level: p.reorder_level,
                supplier: p.supplier,
                product_url: p.product_url,
                unit_price: p.unit_price,
                currency: p.currency,
            };
            let money = allow_money(d);
            write_in(d, p.org.as_deref(), |d, o| {
                upkeep::create_consumable(d, o, &fields, money)
            })
        })
        .await
    }

    #[tool(
        description = "Ask the user before calling. Change a consumable: set its stock or add a restock, or edit its details."
    )]
    async fn update_consumable(
        &self,
        Parameters(p): Parameters<UpdateConsumableInput>,
    ) -> CallToolResult {
        self.run(move |d| {
            let fields = ConsumableFields {
                name: p.name,
                machine: p.machine,
                unit: p.unit,
                stock: p.stock,
                add_stock: p.add_stock,
                reorder_level: p.reorder_level,
                supplier: p.supplier,
                product_url: p.product_url,
                unit_price: p.unit_price,
                currency: p.currency,
            };
            let money = allow_money(d);
            write_in(d, p.org.as_deref(), |d, o| {
                upkeep::update_consumable(d, o, p.consumable_id, &fields, money)
            })
        })
        .await
    }

    #[tool(
        description = "Ask the user before calling. Add a subscription (software, hosting, licence) with its next renewal date. StudioManager adds it to the calendar when it next opens."
    )]
    async fn create_subscription(
        &self,
        Parameters(p): Parameters<CreateSubscriptionInput>,
    ) -> CallToolResult {
        self.run(move |d| {
            let money = allow_money(d);
            write_in(d, p.org.as_deref(), |d, o| {
                upkeep::create_subscription(
                    d,
                    o,
                    &p.name,
                    &p.renews_on,
                    &p.period,
                    p.cost,
                    p.currency.as_deref(),
                    p.plan.as_deref(),
                    p.vendor.as_deref(),
                    p.url.as_deref(),
                    p.notes.as_deref(),
                    money,
                )
            })
        })
        .await
    }

    #[tool(
        description = "Ask the user before calling. Change a subscription's plan, vendor, URL, cost, notes, or cancel it. Its name, renewal date and period change in the app."
    )]
    async fn update_subscription(
        &self,
        Parameters(p): Parameters<UpdateSubscriptionInput>,
    ) -> CallToolResult {
        self.run(move |d| {
            let changes = SubscriptionChanges {
                plan: p.plan,
                vendor: p.vendor,
                url: p.url,
                cost: p.cost,
                currency: p.currency,
                status: p.status,
                notes: p.notes,
            };
            let money = allow_money(d);
            write_in(d, p.org.as_deref(), |d, o| {
                upkeep::update_subscription(d, o, p.subscription_id, &changes, money)
            })
        })
        .await
    }

    #[tool(description = "Get a client with contacts and projects. Works by id for an archived client too and reports archived_at.")]
    async fn get_client(&self, Parameters(p): Parameters<ClientInput>) -> CallToolResult {
        self.run(move |d| read_in(d, p.org.as_deref(), |c| read::get_client(c, &p.client)))
            .await
    }

    #[tool(description = "Ask the user before calling. Create a client.")]
    async fn create_client(&self, Parameters(p): Parameters<CreateClientInput>) -> CallToolResult {
        self.run(move |d| {
            write_in(d, p.org.as_deref(), |d, o| {
                write::create_client(d, o, &p.name, p.email.as_deref(), p.language.as_deref())
            })
        })
        .await
    }

    #[tool(description = "List a project's wiki articles.")]
    async fn list_wiki(&self, Parameters(p): Parameters<ProjectInput>) -> CallToolResult {
        self.run(move |d| read_in(d, p.org.as_deref(), |c| read::list_wiki(c, &p.project)))
            .await
    }

    #[tool(description = "Get a project's wiki article by title, as Markdown and HTML.")]
    async fn get_wiki_article(&self, Parameters(p): Parameters<ArticleInput>) -> CallToolResult {
        self.run(move |d| {
            read_in(d, p.org.as_deref(), |c| {
                read::get_wiki_article(c, &p.project, &p.title)
            })
        })
        .await
    }

    #[tool(
        description = "Write a project's wiki article. Content is Markdown and replaces the article with that title (created if missing). \
Link related articles: [[Title]] (this project first, then a title unique in the organisation), [[Project/Title]], or [[Title|other text]]. \
Link the project's own Markdown files the same way ([[DESIGN-SYSTEM.md]], [[docs/usage.md]], [[Project/RELEASING.md]]): the wiki shows the file itself, so never copy a file's content into an article. \
Overview lists every other article of the project; each other article opens with \"Back to [[Overview]].\" and links where a topic is covered elsewhere \
(commands: Run, build & release; folders: Structure; why: Decisions; unfinished: Open items), plus related projects. \
Titles that match nothing come back in unresolved_links and stay as text: write those articles, then this one again."
    )]
    async fn put_wiki_article(&self, Parameters(p): Parameters<PutArticleInput>) -> CallToolResult {
        self.run(move |d| {
            write_in(d, p.org.as_deref(), |d, o| {
                write::put_wiki_article(d, o, &p.project, &p.title, &p.content)
            })
        })
        .await
    }

    #[tool(
        description = "Append a dated line to the project's \"Decisions\" wiki article (created if missing)."
    )]
    async fn add_decision(&self, Parameters(p): Parameters<DecisionInput>) -> CallToolResult {
        self.run(move |d| {
            let date = p
                .date
                .clone()
                .unwrap_or_else(|| today().format("%Y-%m-%d").to_string());
            write_in(d, p.org.as_deref(), |d, o| {
                write::add_decision(d, o, &p.project, &date, &p.text)
            })
        })
        .await
    }

    #[tool(
        description = "Link a tool (software, framework, hardware) to a project. An existing tool with that name keeps its URL."
    )]
    async fn link_tool(&self, Parameters(p): Parameters<LinkToolInput>) -> CallToolResult {
        self.run(move |d| {
            write_in(d, p.org.as_deref(), |d, o| {
                write::link_tool(d, o, &p.project, &p.name, p.url.as_deref())
            })
        })
        .await
    }

    #[tool(
        description = "Late or upcoming tasks, subtasks, project deadlines and machine upkeep. Without org, covers every allowed organisation."
    )]
    async fn whats_due(&self, Parameters(p): Parameters<WhatsDueInput>) -> CallToolResult {
        self.run(move |d| whats_due(d, p.org.as_deref(), p.days))
            .await
    }

    #[tool(description = "List invoices, optionally by status or year. Amounts in their currency.")]
    async fn list_invoices(&self, Parameters(p): Parameters<StatusYearInput>) -> CallToolResult {
        self.run(move |d| {
            money_in(d, p.org.as_deref(), |c, a| {
                money::list_invoices(c, a, p.status.as_deref(), p.year)
            })
        })
        .await
    }

    #[tool(description = "Get an invoice with its line items, by reference or id.")]
    async fn get_invoice(&self, Parameters(p): Parameters<InvoiceInput>) -> CallToolResult {
        self.run(move |d| {
            money_in(d, p.org.as_deref(), |c, a| {
                money::get_invoice(c, a, &p.invoice)
            })
        })
        .await
    }

    #[tool(description = "List quotes, optionally by status or year.")]
    async fn list_quotes(&self, Parameters(p): Parameters<StatusYearInput>) -> CallToolResult {
        self.run(move |d| {
            money_in(d, p.org.as_deref(), |c, a| {
                money::list_quotes(c, a, p.status.as_deref(), p.year)
            })
        })
        .await
    }

    #[tool(description = "List expenses, optionally by year and month.")]
    async fn list_expenses(&self, Parameters(p): Parameters<YearMonthInput>) -> CallToolResult {
        self.run(move |d| {
            money_in(d, p.org.as_deref(), |c, a| {
                money::list_expenses(c, a, p.year, p.month)
            })
        })
        .await
    }

    #[tool(
        description = "Income, expenses and result in CHF for a year (default: this year) or one month."
    )]
    async fn pnl_summary(&self, Parameters(p): Parameters<YearMonthInput>) -> CallToolResult {
        self.run(move |d| {
            let year = p.year.unwrap_or_else(|| today().year());
            money_in(d, p.org.as_deref(), |c, a| {
                money::pnl_summary(c, a, year, p.month)
            })
        })
        .await
    }
}

#[tool_handler(router = self.tool_router)]
impl ServerHandler for Server {
    fn get_info(&self) -> ServerConfig {
        ServerConfig::new(ServerCapabilities::builder().enable_tools().build())
            .with_server_info(Implementation::new(
                "studiomanager",
                env!("CARGO_PKG_VERSION"),
            ))
            .with_instructions(INSTRUCTIONS.to_string())
    }
}

/// Serve over stdin/stdout until the client closes the connection.
pub async fn serve_stdio(dir: Result<PathBuf, String>) -> Result<(), String> {
    use rmcp::ServiceExt;
    let service = Server::new(dir)
        .serve(rmcp::transport::stdio())
        .await
        .map_err(|e| format!("MCP start: {e}"))?;
    service
        .waiting()
        .await
        .map_err(|e| format!("MCP stopped: {e}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tool_count_follows_allow_money() {
        let dir = crate::test_support::ready_dir("org-a", "Studio A");
        assert_eq!(
            Server::new(Ok(dir.clone())).tool_router.list_all().len(),
            35
        );
        crate::test_support::allow_listed(&dir, true, &[]);
        assert_eq!(Server::new(Ok(dir)).tool_router.list_all().len(), 40);
        assert_eq!(
            Server::new(Err("x".into())).tool_router.list_all().len(),
            35
        );
    }

    #[test]
    fn upkeep_writes_ask_first() {
        let tools = Server::new(Err("x".into())).tool_router.list_all();
        for name in UPKEEP_WRITES {
            let tool = tools.iter().find(|t| t.name == name).expect(name);
            let desc = tool.description.as_deref().unwrap_or("");
            assert!(desc.starts_with("Ask the user before calling."), "{name}: {desc}");
        }
    }

    #[test]
    fn instructions_fit_in_eight_lines() {
        assert!(INSTRUCTIONS.lines().count() <= 8);
    }
}
