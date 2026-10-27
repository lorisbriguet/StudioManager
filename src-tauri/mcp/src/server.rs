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
use crate::{money, read, write};
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
project wikis and, when allowed, invoices, quotes and expenses.
Name the organisation in what you tell the user (every result carries it).
Nothing can be deleted through these tools.
Ask the user before creating a client or a project.
When a name matches more than one record, the candidates come back: use the id.
Dates are YYYY-MM-DD.";

pub const MONEY_TOOLS: [&str; 5] = [
    "list_invoices",
    "get_invoice",
    "list_quotes",
    "list_expenses",
    "pnl_summary",
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

fn list_organisations(dir: &Path) -> R<Value> {
    let access = AccessConfig::load(dir);
    let registry = Registry::load(dir)?.ok_or_else(|| guard::NOT_OPENED.to_string())?;
    let orgs: Vec<Value> = registry
        .organisations
        .iter()
        .map(|o| {
            json!({
                "id": o.id,
                "name": o.name,
                "active": o.id == registry.active_id,
                "allowed": access.org_allowed(&o.id),
            })
        })
        .collect();
    Ok(json!({"enabled": access.enabled, "organisations": orgs}))
}

fn find_project_for_folder(dir: &Path, org: Option<&str>, path: &str) -> R<Value> {
    let explicit = org.map(str::trim).filter(|o| !o.is_empty());
    let orgs = match explicit {
        Some(o) => vec![guard::resolve_org(dir, Some(o))?],
        None => allowed_orgs(dir)?,
    };
    let mut matches = Vec::new();
    for o in &orgs {
        // Searching every organisation skips one the app has not opened yet.
        let conn = match guard::open_read(o) {
            Ok(c) => c,
            Err(e) if explicit.is_some() => return Err(e),
            Err(_) => continue,
        };
        if let Some(p) = read::find_project_for_folder(&conn, path) {
            matches.push(json!({"org": o.name, "project": p}));
        }
    }
    Ok(match matches.len() {
        0 => json!({"project": null}),
        1 => matches.remove(0),
        _ => json!({"matches": matches}),
    })
}

fn whats_due(dir: &Path, org: Option<&str>, days: Option<i64>) -> R<Value> {
    let days = days.unwrap_or(7);
    let today = today();
    let orgs = match org.map(str::trim).filter(|o| !o.is_empty()) {
        Some(o) => vec![guard::resolve_org(dir, Some(o))?],
        None => allowed_orgs(dir)?,
    };
    let mut items: Vec<Value> = Vec::new();
    let mut errors: Vec<Value> = Vec::new();
    for o in &orgs {
        let found = guard::open_read(o).and_then(|conn| read::whats_due(&conn, days, today));
        match found {
            Ok(list) => {
                for item in list {
                    items.push(with_org(o, to_json(item)?));
                }
            }
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
    #[tool(
        description = "List the StudioManager organisations with whether agent access allows each."
    )]
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

    #[tool(description = "List clients, optionally by text.")]
    async fn list_clients(&self, Parameters(p): Parameters<ListClientsInput>) -> CallToolResult {
        self.run(move |d| {
            read_in(d, p.org.as_deref(), |c| {
                read::list_clients(c, p.text.as_deref())
            })
        })
        .await
    }

    #[tool(description = "Get a client with contacts and projects.")]
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
        description = "Write a project's wiki article. Content is Markdown and replaces the article with that title (created if missing)."
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
        description = "Late or upcoming tasks, subtasks and project deadlines. Without org, covers every allowed organisation."
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
            21
        );
        crate::test_support::write_access(&dir, r#"{"enabled": true, "allowMoney": true}"#);
        assert_eq!(Server::new(Ok(dir)).tool_router.list_all().len(), 26);
        assert_eq!(
            Server::new(Err("x".into())).tool_router.list_all().len(),
            21
        );
    }

    #[test]
    fn instructions_fit_in_eight_lines() {
        assert!(INSTRUCTIONS.lines().count() <= 8);
    }
}
