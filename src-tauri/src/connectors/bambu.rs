//! Bambu Lab cloud connector (spec §8): the printers bound to a Bambu account
//! and their print-task history, read from Bambu's cloud.
//!
//! **Unofficial API.** Bambu Lab doesn't document its cloud; the calls and
//! shapes below follow the well-known open-source clients (the Home Assistant
//! `ha-bambulab` integration and similar). They can change without notice:
//! every unexpected answer is an `Err` with a plain message, and the UI keeps
//! typed-in hours working.
//!
//! Calls (base `https://api.bambulab.com`, or `https://api.bambulab.cn` for
//! the China region), JSON bodies, `Authorization: Bearer <access token>`:
//! - `POST /v1/user-service/user/login` `{account, password}` or
//!   `{account, code}` → `{accessToken, refreshToken, expiresIn, loginType}`;
//!   `loginType: "verifyCode"` means the account signs in with an emailed code;
//! - `POST /v1/user-service/user/sendemail/code` `{email, type: "codeLogin"}`;
//! - `POST /v1/user-service/user/refreshtoken` `{refreshToken}`;
//! - `GET /v1/iot-service/api/user/bind` → `devices[]` (`dev_id`, `name`,
//!   `dev_product_name`);
//! - `GET /v1/user-service/my/tasks?limit=&offset=` → `{total, hits[]}`
//!   (`id`, `status`, `startTime`, `endTime`, `costTime`, `deviceId`).
//!
//! Errors the setup form acts on, verbatim:
//! - `code_required`: Bambu emailed a sign-in code; type it;
//! - `code_invalid`: the code was wrong;
//! - `token_expired`: the sign-in expired and couldn't be refreshed: Reconnect;
//! - `password_invalid`: Bambu refused the email or password;
//! - `tfa_unsupported`: the account signs in with an authenticator app;
//! - `history_too_long`: the print history has more pages than the cap (never
//!   a partial sum).
//!
//! Sync returns no summed metric: each printer's finished prints since the
//! connection was made, as `(start ISO UTC, hours)` in `print_tasks`; the
//! frontend sums those at or after each machine's link time.
//!
//! Secret (Keychain): JSON `{access_token, refresh_token?, expires_at?}`. The
//! form puts `{password}` or `{code}` there for one sign-in; the connector then
//! hands back the secret without them (whatever the outcome), so the password
//! is never kept past that call.

use std::collections::{HashMap, HashSet};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;

use super::{describe, Connector, DeviceInfo, DeviceList, DeviceReading, SyncResult};

/// An HTTP answer: status and JSON body (`Null` when the body isn't JSON).
pub(crate) struct Reply {
    pub status: u16,
    pub body: JsonValue,
}

/// One HTTP round trip to Bambu's cloud (`path` is below the region's base).
pub(crate) trait Transport {
    fn post(&self, path: &str, body: &JsonValue, token: Option<&str>) -> Result<Reply, String>;
    fn get(&self, path: &str, token: &str) -> Result<Reply, String>;
}

const LOGIN: &str = "/v1/user-service/user/login";
const SEND_CODE: &str = "/v1/user-service/user/sendemail/code";
const REFRESH: &str = "/v1/user-service/user/refreshtoken";
const BIND: &str = "/v1/iot-service/api/user/bind";
const TASKS: &str = "/v1/user-service/my/tasks";

/// Tasks per history page, and a ceiling on pages (a server that never ends).
const PAGE_SIZE: usize = 100;
const MAX_PAGES: usize = 200;
/// Refresh a token this many seconds before it expires.
const EXPIRY_MARGIN: i64 = 300;

pub(crate) const CODE_REQUIRED: &str = "code_required";
pub(crate) const CODE_INVALID: &str = "code_invalid";
pub(crate) const TOKEN_EXPIRED: &str = "token_expired";
pub(crate) const PASSWORD_INVALID: &str = "password_invalid";
pub(crate) const TFA_UNSUPPORTED: &str = "tfa_unsupported";
pub(crate) const HISTORY_TOO_LONG: &str = "history_too_long";

const BAD_DEVICES: &str =
    "Bambu Lab sent its printer list in an unexpected format (its unofficial cloud API may have changed)";
const BAD_TASKS: &str =
    "Bambu Lab sent the print history in an unexpected format (its unofficial cloud API may have changed)";
const BAD_LOGIN: &str =
    "Bambu Lab answered the sign-in in an unexpected format (its unofficial cloud API may have changed)";

/// The documented API host of a region.
pub(crate) fn base_url(region: &str) -> Result<&'static str, String> {
    match region.trim() {
        "global" => Ok("https://api.bambulab.com"),
        "china" => Ok("https://api.bambulab.cn"),
        _ => Err("the Bambu Lab connection needs a region: global or China".into()),
    }
}

/// Seconds since the epoch of an RFC 3339 date (Bambu's task times) or of
/// SQLite's `datetime('now')` text (`YYYY-MM-DD HH:MM:SS`, UTC).
pub(crate) fn parse_since(s: &str) -> Result<i64, String> {
    let s = s.trim();
    if let Ok(d) = chrono::DateTime::parse_from_rfc3339(s) {
        return Ok(d.timestamp());
    }
    chrono::NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M:%S")
        .map(|d| d.and_utc().timestamp())
        .map_err(|_| format!("unreadable date: {s}"))
}

fn text(v: &JsonValue, key: &str) -> Option<String> {
    v.get(key).and_then(JsonValue::as_str).map(str::trim).filter(|s| !s.is_empty()).map(String::from)
}

/// The printers of a `bind` answer. The LAN access code (`dev_access_code`)
/// is never read.
pub(crate) fn parse_devices(body: &JsonValue) -> Result<DeviceList, String> {
    let devices = body.get("devices").and_then(JsonValue::as_array).ok_or(BAD_DEVICES)?;
    devices
        .iter()
        .map(|d| {
            Ok(DeviceInfo {
                device_id: text(d, "dev_id").ok_or(BAD_DEVICES)?,
                name: text(d, "name"),
                model: text(d, "dev_product_name").or_else(|| text(d, "dev_model_name")),
            })
        })
        .collect()
}

/// A finished (successful) print. As the open-source clients read it: 1
/// printing, 2 finished, 3 failed, 4 cancelled; only 2 counts.
fn finished(status: Option<&JsonValue>) -> bool {
    match status {
        Some(JsonValue::Number(n)) => n.as_i64() == Some(2),
        Some(JsonValue::String(s)) => {
            matches!(s.trim().to_ascii_lowercase().as_str(), "2" | "finish" | "finished" | "success")
        }
        _ => false,
    }
}

/// Seconds a finished task printed: `costTime`, else end − start.
fn task_seconds(t: &JsonValue, start: i64) -> Option<f64> {
    if let Some(c) = t.get("costTime").and_then(JsonValue::as_f64).filter(|c| *c > 0.0) {
        return Some(c);
    }
    let end = parse_since(&text(t, "endTime")?).ok()?;
    (end >= start).then(|| (end - start) as f64)
}

/// `YYYY-MM-DDTHH:MM:SSZ` of seconds since the epoch.
fn iso_utc(secs: i64) -> Option<String> {
    chrono::DateTime::from_timestamp(secs, 0).map(|d| d.format("%Y-%m-%dT%H:%M:%SZ").to_string())
}

/// Finished prints per printer serial, as `(start, hours)` with the start in
/// ISO UTC: the finished tasks that started at or after `since` (seconds
/// since the epoch, the connection's creation). Failed, cancelled and running
/// tasks don't count. The frontend sums them from each machine's link time.
pub(crate) fn finished_tasks(
    tasks: &[JsonValue],
    since: i64,
) -> Result<HashMap<String, Vec<(String, f64)>>, String> {
    let mut out: HashMap<String, Vec<(String, f64)>> = HashMap::new();
    for t in tasks {
        if !t.is_object() {
            return Err(BAD_TASKS.into());
        }
        if !finished(t.get("status")) {
            continue;
        }
        let device = text(t, "deviceId").ok_or(BAD_TASKS)?;
        let start = text(t, "startTime").and_then(|s| parse_since(&s).ok()).ok_or(BAD_TASKS)?;
        if start < since {
            continue;
        }
        let secs = task_seconds(t, start).ok_or(BAD_TASKS)?;
        out.entry(device).or_default().push((iso_utc(start).ok_or(BAD_TASKS)?, secs / 3600.0));
    }
    Ok(out)
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub(crate) struct Secret {
    /// Set by the form for one sign-in; never kept.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub password: Option<String>,
    /// The emailed sign-in code, for one sign-in; never kept.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub access_token: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub refresh_token: Option<String>,
    /// Seconds since the epoch.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<i64>,
}

impl Secret {
    /// The Keychain blob; nothing stored reads as signed out.
    fn parse(s: Option<&str>) -> Result<Self, String> {
        match s.map(str::trim) {
            None | Some("") => Ok(Self::default()),
            // Never echo the blob: it holds tokens.
            Some(s) => serde_json::from_str(s).map_err(|_| TOKEN_EXPIRED.to_string()),
        }
    }
}

struct State {
    secret: Secret,
    /// The secret changed and must be saved.
    changed: bool,
}

pub(crate) struct Bambu {
    account: String,
    /// The connection's creation: prints before it don't count.
    since: Option<i64>,
    now: i64,
    page_size: usize,
    max_pages: usize,
    transport: Box<dyn Transport>,
    state: Mutex<State>,
}

impl Bambu {
    pub(crate) fn new(
        account: String,
        secret: Secret,
        since: Option<i64>,
        now: i64,
        transport: Box<dyn Transport>,
    ) -> Self {
        Self {
            account,
            since,
            now,
            page_size: PAGE_SIZE,
            max_pages: MAX_PAGES,
            transport,
            state: Mutex::new(State { secret, changed: false }),
        }
    }

    #[cfg(test)]
    pub(crate) fn with_page_size(mut self, n: usize) -> Self {
        self.page_size = n.max(1);
        self
    }

    #[cfg(test)]
    pub(crate) fn with_max_pages(mut self, n: usize) -> Self {
        self.max_pages = n;
        self
    }

    fn secret(&self) -> Secret {
        self.state.lock().map(|s| s.secret.clone()).unwrap_or_default()
    }

    fn change(&self, f: impl FnOnce(&mut Secret)) {
        if let Ok(mut s) = self.state.lock() {
            f(&mut s.secret);
            s.changed = true;
        }
    }

    /// Keep the tokens of a login or refresh answer; `None` when it has none.
    fn take_tokens(&self, body: &JsonValue) -> Option<String> {
        let access = text(body, "accessToken")?;
        let refresh = text(body, "refreshToken");
        let expires_at = body.get("expiresIn").and_then(JsonValue::as_i64).filter(|s| *s > 0).map(|s| self.now + s);
        let kept = access.clone();
        self.change(|s| {
            s.access_token = Some(access);
            if refresh.is_some() {
                s.refresh_token = refresh;
            }
            s.expires_at = expires_at;
        });
        Some(kept)
    }

    fn send_code(&self) -> Result<(), String> {
        let body = serde_json::json!({ "email": self.account, "type": "codeLogin" });
        let reply = self.transport.post(SEND_CODE, &body, None)?;
        if !(200..300).contains(&reply.status) {
            return Err(format!("Bambu Lab could not send the sign-in code (HTTP {})", reply.status));
        }
        Ok(())
    }

    /// Sign in with the password or the emailed code the form stored. Both are
    /// dropped from the secret first, whatever the outcome.
    fn sign_in(&self, secret: &Secret) -> Result<(), String> {
        let with_code = secret.code.is_some();
        let body = match (&secret.code, &secret.password) {
            (Some(code), _) => serde_json::json!({ "account": self.account, "code": code.trim() }),
            (None, Some(pw)) => serde_json::json!({ "account": self.account, "password": pw, "apiError": "" }),
            (None, None) => return Ok(()),
        };
        self.change(|s| {
            s.password = None;
            s.code = None;
        });
        let reply = self.transport.post(LOGIN, &body, None)?;
        match reply.status {
            200..=299 => {
                if self.take_tokens(&reply.body).is_some() {
                    return Ok(());
                }
                match text(&reply.body, "loginType").as_deref() {
                    Some("verifyCode") => {
                        self.send_code()?;
                        Err(CODE_REQUIRED.into())
                    }
                    // Authenticator-app sign-in isn't supported.
                    Some("tfa") => Err(TFA_UNSUPPORTED.into()),
                    _ => Err(BAD_LOGIN.into()),
                }
            }
            400 if with_code => {
                // Code 1: the code expired; ask Bambu for a new one.
                if reply.body.get("code").and_then(JsonValue::as_i64) == Some(1) {
                    self.send_code()?;
                    return Err(CODE_REQUIRED.into());
                }
                Err(CODE_INVALID.into())
            }
            400 | 401 => Err(PASSWORD_INVALID.into()),
            s => Err(format!("Bambu Lab sign-in failed (HTTP {s})")),
        }
    }

    /// A new access token from the refresh token, or `token_expired`.
    fn refresh(&self) -> Result<String, String> {
        let Some(rt) = self.secret().refresh_token else { return Err(TOKEN_EXPIRED.into()) };
        let reply = self.transport.post(REFRESH, &serde_json::json!({ "refreshToken": rt }), None)?;
        if !(200..300).contains(&reply.status) {
            return Err(TOKEN_EXPIRED.into());
        }
        self.take_tokens(&reply.body).ok_or_else(|| TOKEN_EXPIRED.to_string())
    }

    /// A usable access token: signing in first when the form left a password
    /// or code, refreshing one about to expire.
    fn token(&self) -> Result<String, String> {
        let secret = self.secret();
        if secret.password.is_some() || secret.code.is_some() {
            self.sign_in(&secret)?;
        }
        let secret = self.secret();
        match secret.access_token {
            Some(t) if secret.expires_at.is_none_or(|e| self.now < e - EXPIRY_MARGIN) => Ok(t),
            Some(_) => self.refresh(),
            None => Err(TOKEN_EXPIRED.into()),
        }
    }

    /// GET with the token; a refused token is refreshed once and the call retried.
    fn get(&self, path: &str) -> Result<JsonValue, String> {
        let token = self.token()?;
        let mut reply = self.transport.get(path, &token)?;
        if reply.status == 401 {
            let token = self.refresh()?;
            reply = self.transport.get(path, &token)?;
            if reply.status == 401 {
                return Err(TOKEN_EXPIRED.into());
            }
        }
        if !(200..300).contains(&reply.status) {
            return Err(format!("Bambu Lab's server answered HTTP {}", reply.status));
        }
        Ok(reply.body)
    }

    /// The whole task history, page by page. Every task must carry an id and
    /// tasks are deduplicated by it, so a server that ignores `offset` is never
    /// counted twice. Past `max_pages` it is an error, never a partial sum.
    fn tasks(&self) -> Result<Vec<JsonValue>, String> {
        let mut out = Vec::new();
        let mut seen: HashSet<String> = HashSet::new();
        let mut offset = 0usize;
        for _ in 0..self.max_pages {
            let body = self.get(&format!("{TASKS}?limit={}&offset={offset}", self.page_size))?;
            let hits = body.get("hits").and_then(JsonValue::as_array).ok_or(BAD_TASKS)?;
            let mut new = 0;
            for h in hits {
                let id = h.get("id").filter(|id| id.is_number() || id.is_string()).ok_or(BAD_TASKS)?;
                if seen.insert(id.to_string()) {
                    out.push(h.clone());
                    new += 1;
                }
            }
            offset += hits.len();
            let total = body.get("total").and_then(JsonValue::as_u64).map(|t| t as usize);
            if hits.len() < self.page_size || new == 0 || total.is_some_and(|t| offset >= t) {
                return Ok(out);
            }
        }
        Err(HISTORY_TOO_LONG.into())
    }
}

impl Connector for Bambu {
    fn test(&self) -> Result<DeviceList, String> {
        parse_devices(&self.get(BIND)?)
    }

    fn sync(&self) -> Result<SyncResult, String> {
        let since = self.since.ok_or("the Bambu Lab connection has no start date")?;
        let printers = parse_devices(&self.get(BIND)?)?;
        let mut prints = finished_tasks(&self.tasks()?, since)?;
        Ok(SyncResult {
            devices: printers
                .into_iter()
                .map(|p| DeviceReading {
                    // No summed metric: the frontend sums `print_tasks` from
                    // each machine's link time.
                    metrics: vec![],
                    print_tasks: Some(prints.remove(&p.device_id).unwrap_or_default()),
                    device_id: p.device_id,
                    model: p.model,
                    disks: vec![],
                })
                .collect(),
        })
    }

    fn updated_secret(&self) -> Option<String> {
        let s = self.state.lock().ok()?;
        if !s.changed {
            return None;
        }
        serde_json::to_string(&s.secret).ok()
    }
}

/// The real transport: HTTPS with JSON bodies.
struct Https {
    client: reqwest::blocking::Client,
    base: &'static str,
}

impl Https {
    fn send(&self, req: reqwest::blocking::RequestBuilder) -> Result<Reply, String> {
        let resp = req
            .send()
            .map_err(|e| format!("cannot reach Bambu Lab's servers: {}", describe(e)))?;
        let status = resp.status().as_u16();
        // A non-JSON body (an HTML error page) reads as Null; its status says enough.
        let body = resp.text().ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or(JsonValue::Null);
        Ok(Reply { status, body })
    }
}

impl Transport for Https {
    fn post(&self, path: &str, body: &JsonValue, token: Option<&str>) -> Result<Reply, String> {
        let mut req = self.client.post(format!("{}{path}", self.base)).json(body);
        if let Some(t) = token {
            req = req.bearer_auth(t);
        }
        self.send(req)
    }

    fn get(&self, path: &str, token: &str) -> Result<Reply, String> {
        self.send(self.client.get(format!("{}{path}", self.base)).bearer_auth(token))
    }
}

#[derive(Deserialize)]
struct Config {
    region: Option<String>,
    account: Option<String>,
    /// `connections.created_at`: prints before it don't count.
    created_at: Option<String>,
}

/// Build from the connection config `{region, account, created_at}` and the
/// Keychain secret. Makes no request.
pub(crate) fn build(config: &JsonValue, secret: Option<String>) -> Result<Box<dyn Connector>, String> {
    let cfg: Config = serde_json::from_value(config.clone())
        .map_err(|_| "the Bambu Lab connection needs a region and an account".to_string())?;
    let base = base_url(cfg.region.as_deref().unwrap_or(""))?;
    let account = cfg.account.as_deref().map(str::trim).unwrap_or("");
    if account.is_empty() {
        return Err("the Bambu Lab connection needs the account's email".into());
    }
    let since = cfg.created_at.as_deref().and_then(|s| parse_since(s).ok());
    let secret = Secret::parse(secret.as_deref())?;
    let client = super::http_client()
        .timeout(std::time::Duration::from_secs(30))
        .connect_timeout(std::time::Duration::from_secs(10))
        // Never follow a redirect with a token.
        .redirect(reqwest::redirect::Policy::none())
        .user_agent("StudioManager")
        .build()
        .map_err(|e| format!("HTTP setup failed: {}", describe(e)))?;
    let now = chrono::Utc::now().timestamp();
    Ok(Box::new(Bambu::new(account.to_string(), secret, since, now, Box::new(Https { client, base }))))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    const LOGIN: &str = include_str!("fixtures/bambu_login.json");
    const LOGIN_VERIFY_CODE: &str = include_str!("fixtures/bambu_login_verify_code.json");
    const LOGIN_CODE_INVALID: &str = include_str!("fixtures/bambu_login_code_invalid.json");
    const BIND: &str = include_str!("fixtures/bambu_bind.json");
    const TASKS: &str = include_str!("fixtures/bambu_tasks.json");

    const P2S: &str = "01P00SCRUBBED01";
    const A1: &str = "03900SCRUBBED02";
    /// 2026-09-01 08:00:00 UTC, the connection's `created_at`.
    const SINCE: &str = "2026-09-01 08:00:00";
    /// 2026-10-28 00:00:00 UTC.
    const NOW: i64 = 1_793_145_600;

    fn json(s: &str) -> JsonValue {
        serde_json::from_str(s).unwrap()
    }

    fn ok(body: JsonValue) -> Reply {
        Reply { status: 200, body }
    }

    /// `(method, path, body, token)` of every request.
    type Calls = Arc<Mutex<Vec<(String, String, JsonValue, Option<String>)>>>;
    type Route = Box<dyn Fn(&str, &str, &JsonValue, Option<&str>) -> Reply>;

    struct Fake {
        route: Route,
        calls: Calls,
    }

    impl Transport for Fake {
        fn post(&self, path: &str, body: &JsonValue, token: Option<&str>) -> Result<Reply, String> {
            self.calls.lock().unwrap().push(("POST".into(), path.into(), body.clone(), token.map(String::from)));
            Ok((self.route)("POST", path, body, token))
        }
        fn get(&self, path: &str, token: &str) -> Result<Reply, String> {
            self.calls.lock().unwrap().push(("GET".into(), path.into(), JsonValue::Null, Some(token.into())));
            Ok((self.route)("GET", path, &JsonValue::Null, Some(token)))
        }
    }

    /// The happy cloud: valid tokens, the bind and task fixtures on one page.
    fn cloud(method: &str, path: &str, body: &JsonValue, _token: Option<&str>) -> Reply {
        match (method, path.split('?').next().unwrap()) {
            ("POST", "/v1/user-service/user/login") => {
                if body.get("code").is_some() {
                    ok(json(LOGIN))
                } else {
                    ok(json(LOGIN_VERIFY_CODE))
                }
            }
            ("POST", "/v1/user-service/user/sendemail/code") => ok(JsonValue::Null),
            ("POST", "/v1/user-service/user/refreshtoken") => ok(serde_json::json!({
                "accessToken": "NEW-ACCESS", "refreshToken": "NEW-REFRESH", "expiresIn": 3600
            })),
            ("GET", "/v1/iot-service/api/user/bind") => ok(json(BIND)),
            ("GET", "/v1/user-service/my/tasks") => {
                if path.contains("offset=0") {
                    ok(json(TASKS))
                } else {
                    ok(serde_json::json!({ "total": 7, "hits": [] }))
                }
            }
            other => panic!("unexpected call {other:?}"),
        }
    }

    fn tokens() -> Secret {
        Secret {
            access_token: Some("ACCESS-1234".into()),
            refresh_token: Some("REFRESH-5678".into()),
            expires_at: Some(NOW + 86_400),
            ..Default::default()
        }
    }

    fn printer(secret: Secret, route: Route) -> (Bambu, Calls) {
        let calls: Calls = Arc::default();
        let since = parse_since(SINCE).ok();
        let fake = Fake { route, calls: calls.clone() };
        (Bambu::new("me@example.com".into(), secret, since, NOW, Box::new(fake)), calls)
    }

    fn kept(c: &Bambu) -> Secret {
        serde_json::from_str(&c.updated_secret().expect("a secret to keep")).unwrap()
    }

    /// The finished prints a sync returned for a printer; no metric is
    /// summed in Rust (the frontend counts from each machine's link time).
    fn prints(r: &SyncResult, id: &str) -> Vec<(String, f64)> {
        let d = r.devices.iter().find(|d| d.device_id == id).unwrap();
        assert!(d.metrics.is_empty(), "{:?}", d.metrics);
        d.print_tasks.clone().expect("Bambu devices carry their prints")
    }

    fn hours(r: &SyncResult, id: &str) -> f64 {
        prints(r, id).iter().map(|(_, h)| h).sum()
    }

    fn sum(v: &[(String, f64)]) -> f64 {
        v.iter().map(|(_, h)| h).sum()
    }

    #[test]
    fn sums_finished_task_durations() {
        let tasks = json(TASKS)["hits"].as_array().unwrap().clone();
        let since = parse_since(SINCE).unwrap();
        let t = finished_tasks(&tasks, since).unwrap();
        // P2S: 1.5 h (end − start, no costTime) and 2 h (costTime). The failed,
        // cancelled and running tasks and the one before the connection are out.
        assert_eq!(
            t[P2S],
            vec![("2026-09-05T09:00:00Z".to_string(), 1.5), ("2026-09-02T10:00:00Z".to_string(), 2.0)]
        );
        assert!((sum(&t[A1]) - 0.5).abs() < 1e-9, "{t:?}");
        // The same through a sync, one reading per bound printer.
        let (c, _) = printer(tokens(), Box::new(cloud));
        let r = c.sync().unwrap();
        assert_eq!(r.devices.len(), 2);
        assert!((hours(&r, P2S) - 3.5).abs() < 1e-9);
        assert!((hours(&r, A1) - 0.5).abs() < 1e-9);
        assert_eq!(r.devices.iter().find(|d| d.device_id == P2S).unwrap().model.as_deref(), Some("P2S"));
        // A later lower bound leaves only the A1 mini's print.
        let t = finished_tasks(&tasks, parse_since("2026-09-08T00:00:00Z").unwrap()).unwrap();
        assert!(!t.contains_key(P2S));
        assert!((sum(&t[A1]) - 0.5).abs() < 1e-9);
        // Start times are plain UTC ISO strings: nothing else (no title, id, token).
        let v = serde_json::to_value(&r).unwrap();
        assert_eq!(v["devices"][1]["print_tasks"][0], serde_json::json!(["2026-09-10T14:00:00Z", 0.5]));
    }

    #[test]
    fn a_printer_without_finished_prints_reads_zero_hours() {
        let route: Route = Box::new(|m, p, b, t| {
            if p.starts_with("/v1/user-service/my/tasks") {
                ok(serde_json::json!({ "total": 0, "hits": [] }))
            } else {
                cloud(m, p, b, t)
            }
        });
        let (c, _) = printer(tokens(), route);
        let r = c.sync().unwrap();
        assert_eq!(prints(&r, P2S), vec![]);
    }

    #[test]
    fn lists_bound_printers() {
        let (c, calls) = printer(tokens(), Box::new(cloud));
        let devices = c.test().unwrap();
        assert_eq!(devices.len(), 2);
        assert_eq!(devices[0].device_id, P2S);
        assert_eq!(devices[0].name.as_deref(), Some("Studio P2S"));
        assert_eq!(devices[0].model.as_deref(), Some("P2S"));
        assert_eq!(devices[1].model.as_deref(), Some("A1 mini"));
        // The LAN access code is never passed on.
        assert!(!serde_json::to_string(&devices).unwrap().contains("SCRUBBED\""));
        let calls = calls.lock().unwrap();
        assert_eq!(calls.len(), 1, "a valid token needs no sign-in");
        assert_eq!(calls[0].1, "/v1/iot-service/api/user/bind");
        assert_eq!(calls[0].3.as_deref(), Some("ACCESS-1234"));
        drop(calls);
        assert_eq!(c.updated_secret(), None, "nothing changed");
    }

    #[test]
    fn unexpected_shape_is_error_not_panic() {
        for body in [
            JsonValue::Null,
            serde_json::json!([]),
            serde_json::json!({ "devices": "nope" }),
            serde_json::json!({ "devices": [{ "name": "no id" }] }),
            serde_json::json!({ "devices": [{ "dev_id": 42 }] }),
            serde_json::json!({ "devices": ["x"] }),
        ] {
            assert!(parse_devices(&body).is_err(), "{body}");
        }
        let since = parse_since(SINCE).unwrap();
        for task in [
            serde_json::json!("x"),
            serde_json::json!({ "status": 2, "deviceId": P2S, "costTime": 60 }),
            serde_json::json!({ "status": 2, "deviceId": P2S, "startTime": "yesterday", "costTime": 60 }),
            serde_json::json!({ "status": 2, "startTime": "2026-09-02T10:00:00Z", "costTime": 60 }),
            serde_json::json!({ "status": 2, "deviceId": P2S, "startTime": "2026-09-02T10:00:00Z" }),
            serde_json::json!({ "status": 2, "deviceId": P2S, "startTime": "2026-09-02T10:00:00Z",
                "endTime": "2026-09-02T09:00:00Z" }),
        ] {
            assert!(finished_tasks(&[task.clone()], since).is_err(), "{task}");
        }
        // Through a sync: a task list that isn't one, or a non-JSON answer.
        for tasks in [serde_json::json!({ "hits": 3 }), serde_json::json!({ "total": 1 }), JsonValue::Null] {
            let route: Route = Box::new(move |m, p, b, t| {
                if p.starts_with("/v1/user-service/my/tasks") {
                    ok(tasks.clone())
                } else {
                    cloud(m, p, b, t)
                }
            });
            let (c, _) = printer(tokens(), route);
            assert!(c.sync().is_err());
        }
        let route: Route = Box::new(|_, _, _, _| Reply { status: 503, body: JsonValue::Null });
        let (c, _) = printer(tokens(), route);
        let e = c.test().unwrap_err();
        assert!(e.contains("503") && !e.contains("ACCESS-1234"), "{e}");
    }

    #[test]
    fn code_required_detected() {
        // Password sign-in on an account that asks for an emailed code.
        let pw = Secret { password: Some("pw-1234".into()), ..Default::default() };
        let (c, calls) = printer(pw, Box::new(cloud));
        assert_eq!(c.test().unwrap_err(), "code_required");
        {
            let calls = calls.lock().unwrap();
            let login = &calls[0];
            assert_eq!(login.1, "/v1/user-service/user/login");
            assert_eq!(login.2["account"], "me@example.com");
            assert_eq!(login.2["password"], "pw-1234");
            // Bambu is asked to email the code.
            let send = calls.iter().find(|c| c.1 == "/v1/user-service/user/sendemail/code").unwrap();
            assert_eq!(send.2["email"], "me@example.com");
            assert_eq!(send.2["type"], "codeLogin");
        }
        // The password is never kept.
        assert_eq!(kept(&c), Secret::default());

        // A wrong code.
        let route: Route = Box::new(|_, p, _, _| {
            assert_eq!(p, "/v1/user-service/user/login");
            Reply { status: 400, body: json(LOGIN_CODE_INVALID) }
        });
        let (c, _) = printer(Secret { code: Some("000000".into()), ..Default::default() }, route);
        assert_eq!(c.test().unwrap_err(), "code_invalid");
        assert_eq!(kept(&c).code, None, "a spent code is not kept");

        // The right code: signed in with the code alone, tokens kept, no code.
        let (c, calls) = printer(Secret { code: Some("123456".into()), ..Default::default() }, Box::new(cloud));
        assert_eq!(c.test().unwrap().len(), 2);
        {
            let calls = calls.lock().unwrap();
            assert_eq!(calls[0].2["code"], "123456");
            assert!(calls[0].2.get("password").is_none());
            assert_eq!(calls[1].3.as_deref(), Some("SCRUBBED-ACCESS-TOKEN"));
        }
        let s = kept(&c);
        assert_eq!(s.access_token.as_deref(), Some("SCRUBBED-ACCESS-TOKEN"));
        assert_eq!(s.refresh_token.as_deref(), Some("SCRUBBED-REFRESH-TOKEN"));
        assert_eq!(s.expires_at, Some(NOW + 7_776_000));
        assert_eq!((s.password, s.code), (None, None));
    }

    #[test]
    fn password_sign_in_without_code_keeps_only_tokens() {
        let route: Route = Box::new(|m, p, b, t| {
            if p == "/v1/user-service/user/login" {
                ok(json(LOGIN))
            } else {
                cloud(m, p, b, t)
            }
        });
        let (c, _) = printer(Secret { password: Some("pw-1234".into()), ..Default::default() }, route);
        c.test().unwrap();
        let s = kept(&c);
        assert_eq!(s.password, None);
        assert_eq!(s.access_token.as_deref(), Some("SCRUBBED-ACCESS-TOKEN"));
    }

    #[test]
    fn wrong_password_is_plain_and_not_kept() {
        let route: Route = Box::new(|_, _, _, _| Reply {
            status: 400,
            body: serde_json::json!({ "code": 3, "error": "Incorrect password" }),
        });
        let (c, _) = printer(Secret { password: Some("pw-1234".into()), ..Default::default() }, route);
        assert_eq!(c.test().unwrap_err(), "password_invalid");
        assert_eq!(kept(&c).password, None);
    }

    #[test]
    fn authenticator_app_accounts_get_a_code() {
        let route: Route = Box::new(|_, _, _, _| ok(serde_json::json!({ "accessToken": "", "loginType": "tfa", "tfaKey": "K" })));
        let (c, _) = printer(Secret { password: Some("pw-1234".into()), ..Default::default() }, route);
        assert_eq!(c.test().unwrap_err(), "tfa_unsupported");
    }

    #[test]
    fn expired_token_is_refreshed() {
        let old = Secret { expires_at: Some(NOW - 10), ..tokens() };
        let (c, calls) = printer(old, Box::new(cloud));
        c.test().unwrap();
        {
            let calls = calls.lock().unwrap();
            assert_eq!(calls[0].1, "/v1/user-service/user/refreshtoken");
            assert_eq!(calls[0].2["refreshToken"], "REFRESH-5678");
            assert_eq!(calls[1].3.as_deref(), Some("NEW-ACCESS"));
        }
        let s = kept(&c);
        assert_eq!(s.access_token.as_deref(), Some("NEW-ACCESS"));
        assert_eq!(s.refresh_token.as_deref(), Some("NEW-REFRESH"));
        assert_eq!(s.expires_at, Some(NOW + 3600));
    }

    #[test]
    fn a_refused_token_is_refreshed_once_then_retried() {
        let route: Route = Box::new(|m, p, b, t| {
            if p == "/v1/iot-service/api/user/bind" && t == Some("ACCESS-1234") {
                Reply { status: 401, body: JsonValue::Null }
            } else {
                cloud(m, p, b, t)
            }
        });
        let (c, _) = printer(tokens(), route);
        assert_eq!(c.test().unwrap().len(), 2);
        assert_eq!(kept(&c).access_token.as_deref(), Some("NEW-ACCESS"));
    }

    #[test]
    fn token_expired_without_refresh_asks_to_reconnect() {
        let no_refresh = Secret { refresh_token: None, expires_at: Some(NOW - 10), ..tokens() };
        let (c, _) = printer(no_refresh, Box::new(cloud));
        assert_eq!(c.test().unwrap_err(), "token_expired");
        // A refused refresh, or nothing stored at all.
        let route: Route = Box::new(|_, _, _, _| Reply { status: 401, body: JsonValue::Null });
        let (c, _) = printer(tokens(), route);
        assert_eq!(c.sync().unwrap_err(), "token_expired");
        let (c, _) = printer(Secret::default(), Box::new(cloud));
        assert_eq!(c.test().unwrap_err(), "token_expired");
    }

    #[test]
    fn paginates_task_history() {
        let route: Route = Box::new(|m, p, b, t| {
            if !p.starts_with("/v1/user-service/my/tasks") {
                return cloud(m, p, b, t);
            }
            let page = |id: i64| serde_json::json!({ "id": id, "status": 2, "deviceId": P2S,
                "startTime": "2026-09-20T10:00:00Z", "costTime": 3600 });
            if p.contains("offset=0") {
                ok(serde_json::json!({ "total": 3, "hits": (1..=2).map(page).collect::<Vec<_>>() }))
            } else if p.contains("offset=2") {
                ok(serde_json::json!({ "total": 3, "hits": [page(3)] }))
            } else {
                panic!("read past the end: {p}")
            }
        });
        let calls: Calls = Arc::default();
        let fake = Fake { route, calls: calls.clone() };
        let c = Bambu::new("me@example.com".into(), tokens(), parse_since(SINCE).ok(), NOW, Box::new(fake))
            .with_page_size(2);
        let r = c.sync().unwrap();
        assert!((hours(&r, P2S) - 3.0).abs() < 1e-9);
        assert_eq!(calls.lock().unwrap().iter().filter(|c| c.1.contains("my/tasks")).count(), 2);
    }

    #[test]
    fn a_server_ignoring_offset_is_not_counted_twice() {
        let route: Route = Box::new(|m, p, b, t| {
            if p.starts_with("/v1/user-service/my/tasks") {
                let task = |id: i64| serde_json::json!({ "id": id, "status": 2, "deviceId": P2S,
                    "startTime": "2026-09-20T10:00:00Z", "costTime": 3600 });
                ok(serde_json::json!({ "total": 50, "hits": [task(1), task(2)] }))
            } else {
                cloud(m, p, b, t)
            }
        });
        let fake = Fake { route, calls: Arc::default() };
        let c = Bambu::new("me@example.com".into(), tokens(), parse_since(SINCE).ok(), NOW, Box::new(fake))
            .with_page_size(2);
        assert!((hours(&c.sync().unwrap(), P2S) - 2.0).abs() < 1e-9);
    }

    #[test]
    fn tasks_without_an_id_are_an_error_never_counted_twice() {
        // A server that ignores `offset` and sends id-less tasks: they can't be
        // told apart, so the sync fails instead of multiplying hours.
        let route: Route = Box::new(|m, p, b, t| {
            if p.starts_with("/v1/user-service/my/tasks") {
                let task = serde_json::json!({ "status": 2, "deviceId": P2S,
                    "startTime": "2026-09-20T10:00:00Z", "costTime": 3600 });
                ok(serde_json::json!({ "total": 50, "hits": [task.clone(), task] }))
            } else {
                cloud(m, p, b, t)
            }
        });
        let fake = Fake { route, calls: Arc::default() };
        let c = Bambu::new("me@example.com".into(), tokens(), parse_since(SINCE).ok(), NOW, Box::new(fake))
            .with_page_size(2);
        assert!(c.sync().is_err());
    }

    #[test]
    fn a_history_past_the_page_cap_is_an_error_not_a_partial_sum() {
        let route: Route = Box::new(|m, p, b, t| {
            if !p.starts_with("/v1/user-service/my/tasks") {
                return cloud(m, p, b, t);
            }
            // Always a full page of new tasks.
            let offset: i64 = p.split("offset=").nth(1).unwrap().parse().unwrap();
            let task = |id: i64| serde_json::json!({ "id": id, "status": 2, "deviceId": P2S,
                "startTime": "2026-09-20T10:00:00Z", "costTime": 3600 });
            ok(serde_json::json!({ "total": 10_000, "hits": [task(offset), task(offset + 1)] }))
        });
        let fake = Fake { route, calls: Arc::default() };
        let c = Bambu::new("me@example.com".into(), tokens(), parse_since(SINCE).ok(), NOW, Box::new(fake))
            .with_page_size(2)
            .with_max_pages(3);
        assert_eq!(c.sync().unwrap_err(), "history_too_long");
    }

    #[test]
    fn sync_needs_the_connection_date() {
        let fake = Fake { route: Box::new(cloud), calls: Arc::default() };
        let c = Bambu::new("me@example.com".into(), tokens(), None, NOW, Box::new(fake));
        assert!(c.sync().is_err());
    }

    #[test]
    fn parses_sqlite_and_rfc3339_dates_as_utc() {
        assert_eq!(parse_since("2026-09-01 08:00:00").unwrap(), 1_788_249_600);
        assert_eq!(parse_since("2026-09-01T08:00:00Z").unwrap(), 1_788_249_600);
        assert_eq!(parse_since("2026-09-01T10:00:00+02:00").unwrap(), 1_788_249_600);
        assert!(parse_since("soon").is_err());
    }

    #[test]
    fn region_picks_the_documented_host() {
        assert_eq!(base_url("global").unwrap(), "https://api.bambulab.com");
        assert_eq!(base_url("china").unwrap(), "https://api.bambulab.cn");
        assert!(base_url("mars").is_err());
    }

    #[test]
    fn build_checks_config_and_secret() {
        let cfg = serde_json::json!({ "region": "global", "account": "me@example.com", "created_at": SINCE });
        assert!(build(&cfg, Some(r#"{"access_token":"a","refresh_token":"r"}"#.into())).is_ok());
        assert!(build(&cfg, Some(r#"{"password":"x"}"#.into())).is_ok());
        assert!(build(&cfg, None).is_ok(), "no secret: the call asks to reconnect");
        let e = build(&cfg, Some("not json".into())).err().unwrap();
        assert!(!e.contains("not json"), "{e}");
        for bad in [
            serde_json::json!({ "region": "mars", "account": "me@example.com" }),
            serde_json::json!({ "region": "global", "account": " " }),
            serde_json::json!({ "account": "me@example.com" }),
        ] {
            assert!(build(&bad, None).is_err(), "{bad}");
        }
    }
}
