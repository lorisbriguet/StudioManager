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
//! - `otp_invalid`: the code was wrong;
//! - `reenter_password`: the connection's address or certificate pin is not the
//!   one the password was saved for (see below). Nothing was sent.
//!
//! Secret (Keychain): JSON `{password, host, port, cert_fingerprint?,
//! device_token?, otp_code?}`. The form puts a one-time code there for one
//! login; the connector then hands back the secret without it and with DSM's
//! device token, so the code isn't asked again.
//!
//! `host`, `port` and `cert_fingerprint` bind the password to the NAS it was
//! typed for. The connection row (SQLite: backed up, restorable, editable)
//! says where to connect; when it names another host or port, or a pin the
//! secret doesn't hold, the password is not sent and the user is asked to type
//! it again (Reconnect). A row without a pin is accepted with a pinned secret:
//! the request then trusts only what the system trusts, which is stricter.

use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;

use super::tls::{normalize_fingerprint, SeenCert};
use super::{describe, percent_encode, read_limited, Connector, MAX_RESPONSE_BYTES, DeviceInfo, DeviceList, DeviceReading, DiskReading, SyncResult};

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
    /// The NAS the password was saved for (see the module doc). `None` only
    /// in a secret saved before the binding existed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub host: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub port: Option<u16>,
    /// The certificate pin the password was saved with; `None`: system trust.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cert_fingerprint: Option<String>,
}

/// Error when the connection row and the secret's binding differ.
pub(crate) const REENTER_PASSWORD: &str = "reenter_password";

const DEFAULT_PORT: u16 = 5001;

fn same_host(a: &str, b: &str) -> bool {
    let norm = |h: &str| h.trim().trim_start_matches('[').trim_end_matches(']').to_ascii_lowercase();
    norm(a) == norm(b)
}

/// May the password of `secret` go to `host:port` with certificate `pin`?
/// `Ok(None)`: yes. `Ok(Some(adopted))`: a legacy secret (no `host`), bound
/// now to the row's values and to be written back. `Err(reenter_password)`:
/// no, nothing may be sent.
///
/// Legacy secrets: a secret saved before the binding existed holds no host.
/// It adopts the row's current host, port and pin once, so existing
/// connections keep syncing without asking every user for the password again.
/// The trade-off: a row tampered with *before* this first adoption is trusted.
/// Any change after it needs the password.
pub(crate) fn check_binding(secret: &Secret, host: &str, port: u16, pin: Option<&str>) -> Result<Option<Secret>, String> {
    let pin = pin.and_then(normalize_fingerprint);
    let Some(bound_host) = secret.host.as_deref() else {
        return Ok(Some(Secret {
            host: Some(host.trim().to_string()),
            port: Some(port),
            cert_fingerprint: pin,
            ..secret.clone()
        }));
    };
    let bound_pin = secret.cert_fingerprint.as_deref().and_then(normalize_fingerprint);
    let pin_ok = pin.is_none() || pin == bound_pin;
    if same_host(bound_host, host) && secret.port.unwrap_or(DEFAULT_PORT) == port && pin_ok {
        Ok(None)
    } else {
        Err(REENTER_PASSWORD.into())
    }
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
                device_token: token.or_else(|| self.secret.device_token.clone()),
                otp_code: None,
                ..self.secret.clone()
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
        let body = read_limited(resp.content_length(), resp, MAX_RESPONSE_BYTES)
            .map_err(|e| format!("the NAS sent an unreadable answer: {e}"))?;
        serde_json::from_slice(&body).map_err(|_| "the NAS sent an unreadable answer: not JSON".to_string())
    }
}

#[derive(Deserialize)]
struct Config {
    host: String,
    /// Wider than `u16` so 70000 is "invalid port", not "needs an address".
    port: Option<i64>,
    account: String,
    cert_fingerprint: Option<String>,
    /// Reconnect: ignore the pin for this call, so the certificate the NAS
    /// shows now is reported (`untrusted_cert:…`) and confirmed again.
    #[serde(default)]
    recheck_cert: bool,
}

/// Build from the connection config `{host, port, account, cert_fingerprint?,
/// recheck_cert?}` and the Keychain secret. Makes no request; refuses
/// (`reenter_password`) when the config isn't the NAS the secret is bound to.
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
    let port = match cfg.port {
        None => DEFAULT_PORT,
        Some(p) => u16::try_from(p)
            .ok()
            .filter(|p| *p > 0)
            .ok_or("invalid NAS port: use a number from 1 to 65535")?,
    };
    let mut secret = Secret::parse(secret.as_deref().unwrap_or(""))?;
    let adopted = check_binding(&secret, host, port, cfg.cert_fingerprint.as_deref())?;
    if let Some(a) = &adopted {
        secret = a.clone();
    }
    let pin = if cfg.recheck_cert { None } else { cfg.cert_fingerprint.as_deref() };
    let (builder, seen) = super::tls::pinned_http_client(pin)?;
    let client = builder
        .timeout(std::time::Duration::from_secs(30))
        .connect_timeout(std::time::Duration::from_secs(10))
        // DSM may redirect to its login page; never follow with credentials.
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| format!("HTTP setup failed: {}", describe(e)))?;
    let transport = Https { client, base: base_url(host, port), seen };
    let nas = Synology::new(account.to_string(), secret, Box::new(transport));
    if let Some(a) = adopted {
        // Written back by `with_connector` (only if the secret is unchanged).
        nas.keep(a);
    }
    Ok(Box::new(nas))
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
            Secret {
                password: "pw-1234".into(),
                device_token: Some("SCRUBBED-DEVICE-TOKEN".into()),
                otp_code: None,
                ..Default::default()
            }
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

    const FP_A: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const FP_B: &str = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

    fn bound(host: &str, port: u16, pin: Option<&str>) -> Secret {
        Secret { host: Some(host.into()), port: Some(port), cert_fingerprint: pin.map(String::from), ..pw() }
    }

    #[test]
    fn binding_matches_the_nas_the_password_was_saved_for() {
        let s = bound("nas.local", 5001, Some(FP_A));
        assert_eq!(check_binding(&s, "nas.local", 5001, Some(FP_A)), Ok(None));
        // Case, spaces and fingerprint formatting don't matter.
        let colons = FP_A.as_bytes().chunks(2).map(|c| std::str::from_utf8(c).unwrap().to_uppercase()).collect::<Vec<_>>().join(":");
        assert_eq!(check_binding(&s, " NAS.local ", 5001, Some(&colons)), Ok(None));
        assert_eq!(check_binding(&bound("fe80::1", 5001, None), "[fe80::1]", 5001, None), Ok(None));
    }

    #[test]
    fn binding_refuses_another_host_or_port() {
        let s = bound("nas.local", 5001, Some(FP_A));
        assert_eq!(check_binding(&s, "evil.example", 5001, Some(FP_A)).unwrap_err(), REENTER_PASSWORD);
        assert_eq!(check_binding(&s, "nas.local", 5443, Some(FP_A)).unwrap_err(), REENTER_PASSWORD);
        // A secret without a port was saved for DSM's default.
        let no_port = Secret { port: None, ..s };
        assert_eq!(check_binding(&no_port, "nas.local", 5001, Some(FP_A)), Ok(None));
        assert!(check_binding(&no_port, "nas.local", 5000, Some(FP_A)).is_err());
    }

    #[test]
    fn binding_refuses_a_pin_the_secret_does_not_hold() {
        // A tampered row pins the attacker's certificate.
        let s = bound("nas.local", 5001, Some(FP_A));
        assert_eq!(check_binding(&s, "nas.local", 5001, Some(FP_B)).unwrap_err(), REENTER_PASSWORD);
        // Saved without a pin (system trust): any pin in the row is refused.
        let unpinned = bound("nas.local", 5001, None);
        assert_eq!(check_binding(&unpinned, "nas.local", 5001, Some(FP_A)).unwrap_err(), REENTER_PASSWORD);
        // A row without a pin is fine: the request then trusts only the system store.
        assert_eq!(check_binding(&s, "nas.local", 5001, None), Ok(None));
    }

    #[test]
    fn a_legacy_secret_adopts_the_rows_values_once() {
        let adopted = check_binding(&pw(), " nas.local ", 5443, Some(FP_A)).unwrap().unwrap();
        assert_eq!(adopted, bound("nas.local", 5443, Some(FP_A)));
        // From then on it is bound like any other.
        assert_eq!(check_binding(&adopted, "nas.local", 5443, Some(FP_A)), Ok(None));
        assert!(check_binding(&adopted, "evil.example", 5443, Some(FP_A)).is_err());
        // Adopted through `build`, and written back as the updated secret.
        let cfg = serde_json::json!({ "host": "nas.local", "port": 5443, "account": "studio", "cert_fingerprint": FP_A });
        let c = build(&cfg, Some(r#"{"password":"pw-1234","device_token":"tok"}"#.into())).unwrap();
        let stored: Secret = serde_json::from_str(&c.updated_secret().unwrap()).unwrap();
        assert_eq!(stored, Secret { device_token: Some("tok".into()), ..bound("nas.local", 5443, Some(FP_A)) });
    }

    #[test]
    fn build_refuses_a_row_that_differs_from_the_secret() {
        let secret = serde_json::to_string(&bound("nas.local", 5001, Some(FP_A))).unwrap();
        let tampered = serde_json::json!({ "host": "evil.example", "port": 5001, "account": "studio", "cert_fingerprint": FP_B });
        assert_eq!(build(&tampered, Some(secret.clone())).err().unwrap(), REENTER_PASSWORD);
        let same = serde_json::json!({ "host": "nas.local", "port": 5001, "account": "studio", "cert_fingerprint": FP_A });
        let c = build(&same, Some(secret)).unwrap();
        assert_eq!(c.updated_secret(), None, "a bound secret is not rewritten");
    }

    #[test]
    fn the_binding_survives_a_device_token_renewal() {
        let (c, _) = nas(LOGIN_DEVICE_TOKEN, Secret { otp_code: Some("654321".into()), ..bound("nas.local", 5001, Some(FP_A)) });
        c.test().unwrap();
        let stored: Secret = serde_json::from_str(&c.updated_secret().unwrap()).unwrap();
        assert_eq!(stored.host.as_deref(), Some("nas.local"));
        assert_eq!(stored.port, Some(5001));
        assert_eq!(stored.cert_fingerprint.as_deref(), Some(FP_A));
        assert_eq!(stored.otp_code, None);
    }

    #[test]
    fn reconnect_rechecks_the_pinned_certificate() {
        use super::super::tls::tests::{certified, serve};
        use super::super::tls::fingerprint;
        let cert = certified("nas.local");
        let fp = fingerprint(cert.cert.der());
        let port = serve(cert);
        let secret = serde_json::to_string(&bound("127.0.0.1", port, Some(&fp))).unwrap();
        let cfg = |recheck: bool| {
            serde_json::json!({
                "host": "127.0.0.1", "port": port, "account": "studio", "cert_fingerprint": fp, "recheck_cert": recheck,
            })
        };
        // Pinned: the TLS handshake passes (the test server's "ok" isn't DSM JSON).
        let e = build(&cfg(false), Some(secret.clone())).unwrap().test().unwrap_err();
        assert!(e.contains("not JSON"), "{e}");
        // Reconnect: the pin is set aside, so the certificate is shown again.
        let e = build(&cfg(true), Some(secret)).unwrap().test().unwrap_err();
        assert_eq!(e, format!("untrusted_cert:{fp}"));
    }

    #[test]
    fn build_refuses_a_port_outside_1_to_65535() {
        for port in [0, 65536, 70000, -1] {
            let cfg = serde_json::json!({ "host": "nas.local", "port": port, "account": "studio" });
            let e = build(&cfg, Some("x".into())).err().unwrap();
            assert!(e.contains("port"), "{port}: {e}");
        }
        let cfg = serde_json::json!({ "host": "nas.local", "port": 65535, "account": "studio" });
        assert!(build(&cfg, Some("x".into())).is_ok());
    }

    #[test]
    fn base_url_is_https_with_ipv6_brackets() {
        assert_eq!(base_url("nas.local", 5001), "https://nas.local:5001/webapi/");
        assert_eq!(base_url("fe80::1", 5001), "https://[fe80::1]:5001/webapi/");
        assert_eq!(base_url("[fe80::1]", 5001), "https://[fe80::1]:5001/webapi/");
    }
}
