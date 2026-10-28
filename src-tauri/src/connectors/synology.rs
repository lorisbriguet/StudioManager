//! Synology DSM connector (spec §8): model, DSM version and per-disk health
//! through the DSM Web API, over HTTPS only.
//!
//! Calls: `query.cgi` SYNO.API.Info (paths and versions), SYNO.API.Auth
//! `login` / `logout`, SYNO.Core.System `info` (model, serial, DSM version) and
//! SYNO.Storage.CGI.Storage `load_info` (disks). Every request is a POST with a
//! form body, so the password, one-time code, session id and device token
//! never appear in a URL.
//!
//! Errors the setup form acts on, verbatim:
//! - `untrusted_cert:<sha256 hex>`: the system doesn't trust the NAS certificate;
//! - `otp_required`: the account has 2-step verification and no code (or the
//!   remembered device token was refused);
//! - `otp_invalid`: the code was wrong.
//!
//! Secret (Keychain): JSON `{password, device_token?, otp_code?}`. The form
//! puts a one-time code there for one login; the connector then hands back the
//! secret without it and with DSM's device token, so the code isn't asked again.

use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;

use super::tls::SeenCert;
use super::{describe, percent_encode, Connector, DeviceInfo, DeviceList, DeviceReading, DiskReading, SyncResult};

/// One HTTP round trip to `https://<nas>/webapi/<path>`: form body in, JSON out.
pub(crate) trait Transport {
    fn post(&self, path: &str, form: &[(&str, String)]) -> Result<JsonValue, String>;
}

/// The error a failed request becomes: `untrusted_cert:<fingerprint>` when
/// the certificate check refused the NAS certificate, else the (URL-free)
/// transport error.
pub(crate) fn transport_error(seen: &SeenCert, err: String) -> String {
    match seen.lock().ok().and_then(|mut s| s.take()) {
        Some(fp) => format!("untrusted_cert:{fp}"),
        None => err,
    }
}

/// DSM's word for a disk state → `healthy`, `warning` or `failing`. `None`
/// for "no information" values.
pub(crate) fn dsm_health(status: &str) -> Option<&'static str> {
    match status.trim().to_ascii_lowercase().as_str() {
        "" | "not_support" | "not_supported" | "unknown" | "none" => None,
        "normal" | "healthy" | "initialized" | "not_initialized" => Some("healthy"),
        "failing" | "crashed" | "danger" | "critical" | "failed" | "broken" => Some("failing"),
        // warning, degraded, abnormal, attention, system_partition_failed, and
        // anything DSM adds later: worth a look rather than silence.
        _ => Some("warning"),
    }
}

fn rank(h: &str) -> u8 {
    match h {
        "failing" => 2,
        "warning" => 1,
        _ => 0,
    }
}

fn text(v: &JsonValue, key: &str) -> Option<String> {
    v.get(key).and_then(JsonValue::as_str).map(str::trim).filter(|s| !s.is_empty()).map(String::from)
}

/// A number DSM sends as a number or as a string (`size_total` is a string).
fn number(v: &JsonValue, key: &str) -> Option<f64> {
    match v.get(key)? {
        JsonValue::Number(n) => n.as_f64(),
        JsonValue::String(s) => s.trim().parse().ok(),
        _ => None,
    }
}

/// Worst of DSM's disk states (`status`, `smart_status`, `overview_status`);
/// past the bad-sector or remaining-life threshold is at least a warning.
fn disk_health(d: &JsonValue) -> &'static str {
    let mut worst = "healthy";
    let mut bump = |h: &'static str| {
        if rank(h) > rank(worst) {
            worst = h;
        }
    };
    for key in ["status", "smart_status", "overview_status"] {
        if let Some(h) = d.get(key).and_then(JsonValue::as_str).and_then(dsm_health) {
            bump(h);
        }
    }
    for flag in ["exceed_bad_sector_thr", "below_remain_life_thr"] {
        if d.get(flag).and_then(JsonValue::as_bool) == Some(true) {
            bump("warning");
        }
    }
    worst
}

/// The disks of a `load_info` answer (`data`). `load_info` reports neither
/// power-on hours nor a bad-sector count (only the threshold flag, which
/// feeds the health): drive age falls back to the first time the app saw the
/// serial.
pub(crate) fn parse_disks(data: &JsonValue) -> Vec<DiskReading> {
    let Some(disks) = data.get("disks").and_then(JsonValue::as_array) else { return vec![] };
    disks
        .iter()
        .map(|d| DiskReading {
            slot: text(d, "longName").or_else(|| text(d, "name")).or_else(|| text(d, "id")).unwrap_or_default(),
            model: text(d, "model"),
            serial: text(d, "serial").unwrap_or_default(),
            size_bytes: number(d, "size_total").filter(|n| *n > 0.0).map(|n| n as i64),
            power_on_hours: None,
            health: disk_health(d).to_string(),
            bad_sectors: None,
            // DSM reports 0 for a drive whose temperature it can't read.
            temperature: number(d, "temp").filter(|t| *t > 0.0),
        })
        .collect()
}

/// `https://<host>:<port>/webapi/`, IPv6 literals in brackets.
pub(crate) fn base_url(host: &str, port: u16) -> String {
    let host = host.trim();
    if host.contains(':') && !host.starts_with('[') {
        format!("https://[{host}]:{port}/webapi/")
    } else {
        format!("https://{host}:{port}/webapi/")
    }
}

/// A host name, IPv4 or IPv6 address: nothing that could change the URL.
fn valid_host(host: &str) -> bool {
    !host.is_empty()
        && host.len() <= 253
        && host.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_' | ':' | '[' | ']'))
}

/// The error of a failed SYNO.API.Auth login.
pub(crate) fn login_error(code: i64) -> String {
    match code {
        403 => "otp_required".into(),
        404 => "otp_invalid".into(),
        400 => "DSM refused the account name or password".into(),
        401 => "this DSM account is disabled".into(),
        402 => "DSM denied this account (permission denied)".into(),
        406 => "this DSM account must set up 2-step verification in DSM first".into(),
        407 => "DSM blocked this computer's address after too many failed sign-ins".into(),
        408..=410 => "the DSM account's password has expired or must be changed in DSM".into(),
        _ => format!("DSM sign-in failed (error {code})"),
    }
}

/// The error of any other failed DSM call.
fn api_error(api: &str, code: i64) -> String {
    match code {
        102..=104 => format!("this DSM version doesn't offer {api} (error {code})"),
        105 => format!("reading {api} needs a DSM account in the administrators group (error 105)"),
        106 | 107 | 119 => format!("the DSM session ended, try again (error {code})"),
        _ => format!("DSM error {code} on {api}"),
    }
}

enum CallError {
    /// Couldn't reach the NAS (already a user-readable, URL-free message).
    Transport(String),
    /// DSM answered `success: false` with this code.
    Dsm(i64),
}

impl CallError {
    fn message(self, api: &str) -> String {
        match self {
            CallError::Transport(e) => e,
            CallError::Dsm(code) => api_error(api, code),
        }
    }
}

/// `data` of a DSM answer, or its error code.
fn envelope(v: JsonValue) -> Result<JsonValue, CallError> {
    if v.get("success").and_then(JsonValue::as_bool) == Some(true) {
        return Ok(v.get("data").cloned().unwrap_or(JsonValue::Null));
    }
    Err(CallError::Dsm(v.pointer("/error/code").and_then(JsonValue::as_i64).unwrap_or(-1)))
}

const API_INFO: &str = "SYNO.API.Info";
const API_AUTH: &str = "SYNO.API.Auth";
const API_SYSTEM: &str = "SYNO.Core.System";
const API_STORAGE: &str = "SYNO.Storage.CGI.Storage";
/// Name of the session, and of this computer in the account's trusted devices.
const CLIENT_NAME: &str = "StudioManager";

/// Where an API lives and the version to call, from SYNO.API.Info.
#[derive(Debug, Clone)]
struct Api {
    name: &'static str,
    path: String,
    version: i64,
}

/// `want` clamped to what the NAS offers.
fn api(info: &JsonValue, name: &'static str, want: i64) -> Result<Api, String> {
    let entry = info
        .get(name)
        .ok_or_else(|| format!("this NAS doesn't offer {name}: DSM 6 or later is needed"))?;
    let path = text(entry, "path").ok_or_else(|| format!("DSM gave no path for {name}"))?;
    if path.contains('/') || path.contains("..") || path.contains('?') {
        return Err(format!("DSM gave an unexpected path for {name}"));
    }
    let min = entry.get("minVersion").and_then(JsonValue::as_i64).unwrap_or(1);
    let max = entry.get("maxVersion").and_then(JsonValue::as_i64).unwrap_or(min).max(min);
    Ok(Api { name, path, version: want.clamp(min, max) })
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub(crate) struct Secret {
    pub password: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub device_token: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub otp_code: Option<String>,
}

impl Secret {
    /// The Keychain blob, or a bare password (tolerated).
    fn parse(s: &str) -> Result<Self, String> {
        let secret = match serde_json::from_str::<JsonValue>(s) {
            Ok(v @ JsonValue::Object(_)) => {
                serde_json::from_value(v).map_err(|_| "the stored Synology secret is unreadable".to_string())?
            }
            _ => Secret { password: s.to_string(), ..Default::default() },
        };
        if secret.password.is_empty() {
            return Err("no password stored for this connection".into());
        }
        Ok(secret)
    }
}

struct Session {
    auth: Api,
    system: Api,
    storage: Api,
    sid: String,
}

struct System {
    serial: String,
    model: Option<String>,
    firmware: Option<String>,
}

pub(crate) struct Synology {
    account: String,
    secret: Secret,
    transport: Box<dyn Transport>,
    updated: Mutex<Option<String>>,
}

impl Synology {
    pub(crate) fn new(account: String, secret: Secret, transport: Box<dyn Transport>) -> Self {
        Self { account, secret, transport, updated: Mutex::new(None) }
    }

    fn call(&self, api: &Api, method: &str, extra: Vec<(&str, String)>) -> Result<JsonValue, CallError> {
        let mut form = vec![
            ("api", api.name.to_string()),
            ("version", api.version.to_string()),
            ("method", method.to_string()),
        ];
        form.extend(extra);
        envelope(self.transport.post(&api.path, &form).map_err(CallError::Transport)?)
    }

    fn login(&self) -> Result<Session, String> {
        let info_api = Api { name: API_INFO, path: "query.cgi".into(), version: 1 };
        let query = [API_AUTH, API_SYSTEM, API_STORAGE].join(",");
        let info = self.call(&info_api, "query", vec![("query", query)]).map_err(|e| e.message(API_INFO))?;
        let auth = api(&info, API_AUTH, 7)?;
        let system = api(&info, API_SYSTEM, 1)?;
        let storage = api(&info, API_STORAGE, 1)?;

        let mut form = vec![
            ("account", self.account.clone()),
            ("passwd", self.secret.password.clone()),
            ("session", CLIENT_NAME.to_string()),
            ("format", "sid".to_string()),
            ("enable_device_token", "yes".to_string()),
            ("device_name", CLIENT_NAME.to_string()),
        ];
        if let Some(code) = &self.secret.otp_code {
            form.push(("otp_code", code.clone()));
        }
        if let Some(token) = &self.secret.device_token {
            form.push(("device_id", token.clone()));
        }
        let answer = self.call(&auth, "login", form);
        // DSM answered: a one-time code is spent whatever the outcome.
        let spent_code = self.secret.otp_code.is_some() && !matches!(answer, Err(CallError::Transport(_)));
        let data = match answer {
            Ok(d) => d,
            Err(CallError::Dsm(code)) => {
                if spent_code {
                    self.keep(Secret { otp_code: None, ..self.secret.clone() });
                }
                return Err(login_error(code));
            }
            Err(e) => return Err(e.message(API_AUTH)),
        };
        // DSM 7 calls the device token `device_id`, DSM 6 `did`.
        let token = text(&data, "device_id").or_else(|| text(&data, "did"));
        if spent_code || (token.is_some() && token != self.secret.device_token) {
            self.keep(Secret {
                password: self.secret.password.clone(),
                device_token: token.or_else(|| self.secret.device_token.clone()),
                otp_code: None,
            });
        }
        let sid = text(&data, "sid").ok_or("DSM signed in without a session id")?;
        Ok(Session { auth, system, storage, sid })
    }

    fn keep(&self, secret: Secret) {
        if let (Ok(json), Ok(mut slot)) = (serde_json::to_string(&secret), self.updated.lock()) {
            *slot = Some(json);
        }
    }

    fn logout(&self, s: &Session) {
        // Best effort: an expired session is no harm.
        let _ = self.call(&s.auth, "logout", vec![("session", CLIENT_NAME.to_string()), ("_sid", s.sid.clone())]);
    }

    /// Run `f` in a signed-in session, signing out afterwards.
    fn with_session<T>(&self, f: impl FnOnce(&Session) -> Result<T, String>) -> Result<T, String> {
        let s = self.login()?;
        let out = f(&s);
        self.logout(&s);
        out
    }

    fn system(&self, s: &Session) -> Result<System, String> {
        let data = self
            .call(&s.system, "info", vec![("_sid", s.sid.clone())])
            .map_err(|e| e.message(API_SYSTEM))?;
        Ok(System {
            serial: text(&data, "serial").ok_or("DSM did not report the NAS serial number")?,
            model: text(&data, "model"),
            firmware: text(&data, "firmware_ver"),
        })
    }

    fn disks(&self, s: &Session) -> Result<Vec<DiskReading>, String> {
        let data = self
            .call(&s.storage, "load_info", vec![("action", "load_info".to_string()), ("_sid", s.sid.clone())])
            .map_err(|e| e.message(API_STORAGE))?;
        Ok(parse_disks(&data))
    }
}

impl Connector for Synology {
    fn test(&self) -> Result<DeviceList, String> {
        self.with_session(|s| {
            let sys = self.system(s)?;
            Ok(vec![DeviceInfo { device_id: sys.serial, name: sys.firmware, model: sys.model }])
        })
    }

    fn sync(&self) -> Result<SyncResult, String> {
        self.with_session(|s| {
            let sys = self.system(s)?;
            let disks = self.disks(s)?;
            Ok(SyncResult {
                devices: vec![DeviceReading { device_id: sys.serial, model: sys.model, metrics: vec![], disks, print_tasks: None }],
            })
        })
    }

    fn updated_secret(&self) -> Option<String> {
        self.updated.lock().ok()?.clone()
    }
}

/// The real transport: HTTPS POSTs with a form body, certificate checked by
/// the system store or the pinned fingerprint.
struct Https {
    client: reqwest::blocking::Client,
    base: String,
    seen: SeenCert,
}

impl Transport for Https {
    fn post(&self, path: &str, form: &[(&str, String)]) -> Result<JsonValue, String> {
        let body = form
            .iter()
            .map(|(k, v)| format!("{}={}", percent_encode(k, true, false), percent_encode(v, true, false)))
            .collect::<Vec<_>>()
            .join("&");
        let resp = self
            .client
            .post(format!("{}{}", self.base, path))
            .header(reqwest::header::CONTENT_TYPE, "application/x-www-form-urlencoded")
            .body(body)
            .send()
            .map_err(|e| transport_error(&self.seen, format!("cannot reach the NAS: {}", describe(e))))?;
        let status = resp.status();
        if !status.is_success() {
            return Err(format!("the NAS answered HTTP {}", status.as_u16()));
        }
        resp.json::<JsonValue>()
            .map_err(|e| format!("the NAS sent an unreadable answer: {}", describe(e)))
    }
}

#[derive(Deserialize)]
struct Config {
    host: String,
    port: Option<u16>,
    account: String,
    cert_fingerprint: Option<String>,
}

/// Build from the connection config `{host, port, account, cert_fingerprint?}`
/// and the Keychain secret. Makes no request.
pub(crate) fn build(config: &JsonValue, secret: Option<String>) -> Result<Box<dyn Connector>, String> {
    let cfg: Config = serde_json::from_value(config.clone())
        .map_err(|_| "the Synology connection needs an address and an account".to_string())?;
    let host = cfg.host.trim();
    if !valid_host(host) {
        return Err("invalid NAS address: type a host name or IP address only".into());
    }
    let account = cfg.account.trim();
    if account.is_empty() {
        return Err("the Synology connection needs an account".into());
    }
    let secret = Secret::parse(secret.as_deref().unwrap_or(""))?;
    let (builder, seen) = super::tls::pinned_http_client(cfg.cert_fingerprint.as_deref())?;
    let client = builder
        .timeout(std::time::Duration::from_secs(30))
        .connect_timeout(std::time::Duration::from_secs(10))
        // DSM may redirect to its login page; never follow with credentials.
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| format!("HTTP setup failed: {}", describe(e)))?;
    let transport = Https { client, base: base_url(host, cfg.port.unwrap_or(5001)), seen };
    Ok(Box::new(Synology::new(account.to_string(), secret, Box::new(transport))))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};

    const API_INFO: &str = include_str!("fixtures/synology_api_info.json");
    const LOGIN: &str = include_str!("fixtures/synology_login.json");
    const LOGIN_OTP_REQUIRED: &str = include_str!("fixtures/synology_login_otp_required.json");
    const LOGIN_OTP_INVALID: &str = include_str!("fixtures/synology_login_otp_invalid.json");
    const LOGIN_DEVICE_TOKEN: &str = include_str!("fixtures/synology_login_device_token.json");
    const SYSTEM: &str = include_str!("fixtures/synology_system_info.json");
    const STORAGE: &str = include_str!("fixtures/synology_storage_load_info.json");

    fn json(s: &str) -> JsonValue {
        serde_json::from_str(s).unwrap()
    }

    type Calls = Arc<Mutex<Vec<(String, Vec<(String, String)>)>>>;

    /// Answers each API from a fixture and records every request.
    struct Fake {
        login: &'static str,
        storage: JsonValue,
        calls: Calls,
    }

    impl Transport for Fake {
        fn post(&self, path: &str, form: &[(&str, String)]) -> Result<JsonValue, String> {
            let form: Vec<(String, String)> = form.iter().map(|(k, v)| (k.to_string(), v.clone())).collect();
            self.calls.lock().unwrap().push((path.to_string(), form.clone()));
            let get = |k: &str| form.iter().find(|(f, _)| f == k).map(|(_, v)| v.as_str()).unwrap_or("");
            Ok(match (get("api"), get("method")) {
                ("SYNO.API.Info", "query") => json(API_INFO),
                ("SYNO.API.Auth", "login") => json(self.login),
                ("SYNO.API.Auth", "logout") => serde_json::json!({ "success": true }),
                ("SYNO.Core.System", "info") => json(SYSTEM),
                ("SYNO.Storage.CGI.Storage", "load_info") => self.storage.clone(),
                other => panic!("unexpected call {other:?}"),
            })
        }
    }

    fn nas(login: &'static str, secret: Secret) -> (Synology, Calls) {
        let calls: Calls = Arc::default();
        let fake = Fake { login, storage: json(STORAGE), calls: calls.clone() };
        (Synology::new("studio".into(), secret, Box::new(fake)), calls)
    }

    fn pw() -> Secret {
        Secret { password: "pw-1234".into(), ..Default::default() }
    }

    fn param<'a>(form: &'a [(String, String)], k: &str) -> Option<&'a str> {
        form.iter().find(|(f, _)| f == k).map(|(_, v)| v.as_str())
    }

    #[test]
    fn parses_storage_fixture_into_disks() {
        let disks = parse_disks(&json(STORAGE)["data"]);
        assert_eq!(disks.len(), 4);
        let slots: Vec<&str> = disks.iter().map(|d| d.slot.as_str()).collect();
        assert_eq!(slots, ["Drive 1", "Drive 2", "Drive 3", "Drive 4"]);
        let health: Vec<&str> = disks.iter().map(|d| d.health.as_str()).collect();
        // Drive 2: status normal but past DSM's bad-sector threshold.
        assert_eq!(health, ["healthy", "warning", "warning", "failing"]);
        let d1 = &disks[0];
        assert_eq!(d1.serial, "SCRUBBEDDISK1");
        assert_eq!(d1.model.as_deref(), Some("WD40EFZX-68AWUN0"));
        assert_eq!(d1.size_bytes, Some(4_000_787_030_016));
        assert_eq!(d1.temperature, Some(34.0));
        assert_eq!(d1.power_on_hours, None);
        // DSM reports 0 °C for a drive it can't read.
        assert_eq!(disks[3].temperature, None);
    }

    #[test]
    fn maps_dsm_status_values() {
        for s in ["normal", "Normal", "initialized", "not_initialized"] {
            assert_eq!(dsm_health(s), Some("healthy"), "{s}");
        }
        for s in ["warning", "degraded", "abnormal", "system_partition_failed", "attention"] {
            assert_eq!(dsm_health(s), Some("warning"), "{s}");
        }
        for s in ["failing", "crashed", "danger", "critical", "failed", "broken"] {
            assert_eq!(dsm_health(s), Some("failing"), "{s}");
        }
        for s in ["", "not_support", "unknown"] {
            assert_eq!(dsm_health(s), None, "{s}");
        }
        // Something DSM may add later is worth a look, not silence.
        assert_eq!(dsm_health("some_new_state"), Some("warning"));
    }

    #[test]
    fn untrusted_cert_error_carries_fingerprint() {
        use super::super::tls::tests::{self_signed, verify, SystemRefuses};
        use super::super::tls::{fingerprint, PinnedVerifier};
        let cert = self_signed("nas.local");
        let seen: SeenCert = Arc::new(Mutex::new(None));
        let v = PinnedVerifier::new(Arc::new(SystemRefuses), None, seen.clone());
        assert!(verify(&v, &cert, "nas.local").is_err());
        let err = transport_error(&seen, "error sending request: invalid peer certificate: UnknownIssuer".into());
        assert_eq!(err, format!("untrusted_cert:{}", fingerprint(&cert)));
        // Other transport errors pass through.
        let none: SeenCert = Arc::new(Mutex::new(None));
        assert_eq!(transport_error(&none, "connection refused".into()), "connection refused");
    }

    #[test]
    fn otp_required_detected() {
        assert_eq!(login_error(403), "otp_required");
        assert_eq!(login_error(404), "otp_invalid");
        let (c, _) = nas(LOGIN_OTP_REQUIRED, pw());
        assert_eq!(c.test().unwrap_err(), "otp_required");
        let (c, _) = nas(LOGIN_OTP_INVALID, Secret { otp_code: Some("123456".into()), ..pw() });
        assert_eq!(c.sync().unwrap_err(), "otp_invalid");
    }

    #[test]
    fn login_errors_are_plain_and_free_of_secrets() {
        for code in [400, 401, 402, 406, 407, 409, 499] {
            let e = login_error(code);
            assert!(!e.is_empty() && !e.contains("pw-1234"), "{code}: {e}");
        }
    }

    #[test]
    fn test_lists_the_nas_by_serial() {
        let (c, calls) = nas(LOGIN, pw());
        let devices = c.test().unwrap();
        assert_eq!(devices.len(), 1);
        assert_eq!(devices[0].device_id, "SCRUBBEDNAS01");
        assert_eq!(devices[0].model.as_deref(), Some("DS920+"));
        assert_eq!(devices[0].name.as_deref(), Some("DSM 7.2.1-69057 Update 5"));
        // Logged out afterwards.
        let calls = calls.lock().unwrap();
        assert_eq!(param(&calls.last().unwrap().1, "method"), Some("logout"));
    }

    #[test]
    fn sync_reads_one_device_with_its_disks() {
        let (c, _) = nas(LOGIN, pw());
        let r = c.sync().unwrap();
        assert_eq!(r.devices.len(), 1);
        let d = &r.devices[0];
        assert_eq!(d.device_id, "SCRUBBEDNAS01");
        assert_eq!(d.model.as_deref(), Some("DS920+"));
        assert!(d.metrics.is_empty());
        assert_eq!(d.disks.len(), 4);
    }

    #[test]
    fn login_posts_to_the_discovered_path_with_device_token_request() {
        let (c, calls) = nas(LOGIN, Secret { device_token: Some("tok-1".into()), ..pw() });
        c.test().unwrap();
        let calls = calls.lock().unwrap();
        assert_eq!(calls[0].0, "query.cgi");
        let (path, form) = calls.iter().find(|(_, f)| param(f, "method") == Some("login")).unwrap();
        assert_eq!(path, "entry.cgi");
        assert_eq!(param(form, "account"), Some("studio"));
        assert_eq!(param(form, "passwd"), Some("pw-1234"));
        assert_eq!(param(form, "enable_device_token"), Some("yes"));
        assert_eq!(param(form, "device_id"), Some("tok-1"));
        assert_eq!(param(form, "otp_code"), None);
        assert_eq!(param(form, "version"), Some("7"));
        // Later calls carry the session id in the body.
        let (_, storage) = calls.iter().find(|(_, f)| param(f, "method") == Some("info")).unwrap();
        assert_eq!(param(storage, "_sid"), Some("SCRUBBED-SID"));
        // Nothing to store: no code was used and the token didn't change.
        drop(calls);
        assert_eq!(c.updated_secret(), None);
    }

    #[test]
    fn otp_login_stores_the_device_token_and_drops_the_code() {
        let (c, calls) = nas(LOGIN_DEVICE_TOKEN, Secret { otp_code: Some("654321".into()), ..pw() });
        c.test().unwrap();
        {
            let calls = calls.lock().unwrap();
            let (_, form) = calls.iter().find(|(_, f)| param(f, "method") == Some("login")).unwrap();
            assert_eq!(param(form, "otp_code"), Some("654321"));
        }
        let stored: Secret = serde_json::from_str(&c.updated_secret().unwrap()).unwrap();
        assert_eq!(
            stored,
            Secret { password: "pw-1234".into(), device_token: Some("SCRUBBED-DEVICE-TOKEN".into()), otp_code: None }
        );
    }

    #[test]
    fn dsm6_did_is_the_device_token() {
        let (c, _) = nas(
            r#"{"data":{"sid":"S","did":"DSM6-TOKEN"},"success":true}"#,
            Secret { otp_code: Some("111111".into()), ..pw() },
        );
        c.test().unwrap();
        let stored: Secret = serde_json::from_str(&c.updated_secret().unwrap()).unwrap();
        assert_eq!(stored.device_token.as_deref(), Some("DSM6-TOKEN"));
    }

    #[test]
    fn a_wrong_code_is_not_kept_for_the_next_sync() {
        let (c, _) = nas(LOGIN_OTP_INVALID, Secret { otp_code: Some("000000".into()), ..pw() });
        assert!(c.test().is_err());
        let stored: Secret = serde_json::from_str(&c.updated_secret().unwrap()).unwrap();
        assert_eq!(stored.otp_code, None);
        assert_eq!(stored.password, "pw-1234");
    }

    #[test]
    fn storage_without_admin_rights_says_so() {
        let calls: Calls = Arc::default();
        let fake = Fake {
            login: LOGIN,
            storage: serde_json::json!({ "error": { "code": 105 }, "success": false }),
            calls,
        };
        let c = Synology::new("studio".into(), pw(), Box::new(fake));
        let e = c.sync().unwrap_err();
        assert!(e.contains("administrators"), "{e}");
    }

    #[test]
    fn build_checks_config_and_secret() {
        let cfg = serde_json::json!({ "host": "192.168.1.20", "port": 5001, "account": "studio" });
        assert!(build(&cfg, Some(r#"{"password":"x"}"#.into())).is_ok());
        // A plain string secret is the password.
        assert!(build(&cfg, Some("plain".into())).is_ok());
        let e = build(&cfg, None).err().unwrap();
        assert!(e.contains("password"), "{e}");
        for host in ["", "nas/evil", "user@nas", "nas?x=1", "has space"] {
            let bad = serde_json::json!({ "host": host, "port": 5001, "account": "studio" });
            assert!(build(&bad, Some("x".into())).is_err(), "{host}");
        }
        let no_account = serde_json::json!({ "host": "nas.local", "port": 5001, "account": "" });
        assert!(build(&no_account, Some("x".into())).is_err());
    }

    #[test]
    fn base_url_is_https_with_ipv6_brackets() {
        assert_eq!(base_url("nas.local", 5001), "https://nas.local:5001/webapi/");
        assert_eq!(base_url("fe80::1", 5001), "https://[fe80::1]:5001/webapi/");
        assert_eq!(base_url("[fe80::1]", 5001), "https://[fe80::1]:5001/webapi/");
    }
}
