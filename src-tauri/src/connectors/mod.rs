//! Connections: optional readers of a user's devices (spec §8). One file per
//! kind behind [`Connector`]; the frontend only calls the commands below.
//!
//! The config sent by the frontend never contains the secret: it is read here
//! from the Keychain, and every error returned to the frontend is scrubbed of it.

pub mod keychain;
pub mod synology;
pub mod tls;

use keychain::SecretStore;
use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;

/// A device a connection can see, offered when linking a machine.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DeviceInfo {
    pub device_id: String,
    pub name: Option<String>,
    pub model: Option<String>,
}

pub type DeviceList = Vec<DeviceInfo>;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DiskReading {
    pub slot: String,
    pub model: Option<String>,
    pub serial: String,
    pub size_bytes: Option<i64>,
    pub power_on_hours: Option<i64>,
    /// `healthy`, `warning` or `failing`.
    pub health: String,
    pub bad_sectors: Option<i64>,
    pub temperature: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DeviceReading {
    pub device_id: String,
    pub model: Option<String>,
    /// `(metric, value)`, e.g. `("print_hours", 812.5)`.
    pub metrics: Vec<(String, f64)>,
    pub disks: Vec<DiskReading>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SyncResult {
    pub devices: Vec<DeviceReading>,
}

/// One kind of device reader. Errors are user-readable strings; they are
/// redacted with [`redact`] before reaching the frontend, but connectors must
/// still keep secrets out of them in the first place:
/// - map every reqwest error with `e.without_url()` before formatting it, since
///   request URLs carry query strings (DSM sends `passwd=` and `otp_code=` there);
/// - never put a response body that echoes credentials or tokens in an error.
///
/// Build HTTP clients with [`http_client`] (installs the crypto provider), or
/// [`tls::pinned_http_client`] for a device that may use a self-signed
/// certificate.
pub trait Connector {
    fn test(&self) -> Result<DeviceList, String>;
    fn sync(&self) -> Result<SyncResult, String>;
    /// A new secret to keep after `test` or `sync`, e.g. the DSM device token
    /// earned with a one-time code. Saved to the Keychain, never returned.
    fn updated_secret(&self) -> Option<String> {
        None
    }
}

/// Build the connector of a kind. Task 14 registers `bambu_cloud` here.
fn build_connector(
    kind: &str,
    config: &JsonValue,
    secret: Option<String>,
) -> Result<Box<dyn Connector>, String> {
    match kind {
        "synology" => synology::build(config, secret),
        _ => Err(format!("unsupported connection kind: {kind}")),
    }
}

/// JSON keys whose values are secret whatever their length.
const SECRET_KEYS: &[&str] = &[
    "password", "passwd", "pass", "secret", "token", "access_token", "refresh_token",
    "device_token", "did", "sid", "synotoken", "otp", "otp_code", "code", "verify_code",
];

/// Percent-encoding of every byte outside RFC 3986's unreserved set;
/// `plus_for_space` gives the form-encoded variant.
pub(crate) fn percent_encode(s: &str, plus_for_space: bool, lower: bool) -> String {
    let mut out = String::with_capacity(s.len() * 3);
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => out.push(b as char),
            b' ' if plus_for_space => out.push('+'),
            _ if lower => out.push_str(&format!("%{b:02x}")),
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

/// The forms a secret can take inside an error message: as is, in a URL
/// (percent- or form-encoded, either hex case) and JSON-escaped.
fn variants(n: &str) -> Vec<String> {
    let mut v = vec![
        n.to_string(),
        percent_encode(n, false, false),
        percent_encode(n, false, true),
        percent_encode(n, true, false),
        percent_encode(n, true, true),
    ];
    if let Ok(json) = serde_json::to_string(n) {
        v.push(json[1..json.len() - 1].to_string());
    }
    v.sort();
    v.dedup();
    v
}

/// Remove the secret from a message bound for the frontend (and so from
/// `connections.last_error`, backups and the UI). When the secret is a JSON
/// blob, every value under a secret-looking key is removed whatever its length,
/// and any other string of 4+ characters too. Each needle is also removed in
/// its URL-encoded and JSON-escaped forms.
pub(crate) fn redact(msg: &str, secret: Option<&str>) -> String {
    let Some(secret) = secret else { return msg.to_string() };
    let mut needles: Vec<String> = Vec::new();
    fn collect(v: &JsonValue, keyed_secret: bool, out: &mut Vec<String>) {
        match v {
            JsonValue::String(s) if keyed_secret || s.chars().count() >= 4 => out.push(s.clone()),
            JsonValue::Number(n) if keyed_secret => out.push(n.to_string()),
            JsonValue::Array(a) => a.iter().for_each(|x| collect(x, keyed_secret, out)),
            JsonValue::Object(o) => o.iter().for_each(|(k, x)| {
                let key = k.to_ascii_lowercase();
                collect(x, keyed_secret || SECRET_KEYS.contains(&key.as_str()), out)
            }),
            _ => {}
        }
    }
    if let Ok(v) = serde_json::from_str::<JsonValue>(secret) {
        collect(&v, false, &mut needles);
    }
    if !secret.is_empty() {
        needles.push(secret.to_string());
    }
    let mut all: Vec<String> = needles
        .iter()
        .filter(|n| !n.is_empty())
        .flat_map(|n| variants(n))
        .collect();
    // Longest first so a token inside the blob doesn't leave a partial match.
    all.sort_by_key(|n| std::cmp::Reverse(n.len()));
    all.dedup();
    let mut out = msg.to_string();
    for n in &all {
        out = out.replace(n.as_str(), "[redacted]");
    }
    out
}

type Factory<'a> =
    &'a dyn Fn(&str, &JsonValue, Option<String>) -> Result<Box<dyn Connector>, String>;

fn with_connector<T>(
    store: &dyn SecretStore,
    org: &str,
    id: i64,
    kind: &str,
    config: &JsonValue,
    factory: Factory,
    run: impl FnOnce(&dyn Connector) -> Result<T, String>,
) -> Result<T, String> {
    let account = keychain::account(org, id)?;
    let secret = store.get(&account)?;
    let connector = factory(kind, config, secret.clone()).map_err(|e| redact(&e, secret.as_deref()))?;
    let result = run(connector.as_ref());
    // Kept even when the call failed: a one-time code is spent either way.
    let updated = connector.updated_secret();
    let scrub = |e: String| redact(&redact(&e, secret.as_deref()), updated.as_deref());
    if let Some(new) = updated.as_deref() {
        // Only renew a secret that still exists: a connection removed while
        // the call was in flight must not leave an orphan Keychain entry.
        let saved = match store.get(&account) {
            Ok(Some(_)) => store.set(&account, new),
            Ok(None) => Ok(()),
            Err(e) => Err(e),
        };
        if let Err(e) = saved {
            log::warn!("connection {id}: the renewed secret could not be saved: {}", scrub(e));
        }
    }
    result.map_err(scrub)
}

fn run_test(
    store: &dyn SecretStore,
    org: &str,
    id: i64,
    kind: &str,
    config: &JsonValue,
    factory: Factory,
) -> Result<DeviceList, String> {
    with_connector(store, org, id, kind, config, factory, |c| c.test())
}

fn run_sync(
    store: &dyn SecretStore,
    org: &str,
    id: i64,
    kind: &str,
    config: &JsonValue,
    factory: Factory,
) -> Result<SyncResult, String> {
    with_connector(store, org, id, kind, config, factory, |c| c.sync())
}

/// The frontend names the organisation it means; refuse when another one is
/// active, so a call started before a switch can't use the next org's secret.
fn check_org(requested: &str, active: &str) -> Result<(), String> {
    if requested != active {
        return Err(format!("organisation changed: call was for {requested}, active is {active}"));
    }
    Ok(())
}

static CRYPTO_PROVIDER: std::sync::Once = std::sync::Once::new();

/// HTTP client builder for connectors (Tasks 13–14). reqwest is built without
/// a bundled crypto provider, so install ring as the process default first.
pub(crate) fn http_client() -> reqwest::blocking::ClientBuilder {
    CRYPTO_PROVIDER.call_once(|| {
        // Err means another provider is already installed: fine.
        let _ = rustls::crypto::ring::default_provider().install_default();
    });
    reqwest::blocking::Client::builder()
}

/// Test and presentation modes never talk to a real device or write the
/// Keychain (spec §8), and the call must be for the active organisation.
fn guard(app: &tauri::AppHandle, org: &str) -> Result<(), String> {
    let active = crate::active_org(app)?;
    check_org(org, &active.id)?;
    if active.in_mode() {
        return Err("connections are off in test and presentation modes".into());
    }
    Ok(())
}

async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|e| format!("connection task failed: {e}"))?
}

#[tauri::command]
pub(crate) async fn connection_save_secret(
    app: tauri::AppHandle,
    org: String,
    id: i64,
    secret: String,
) -> Result<(), String> {
    guard(&app, &org)?;
    blocking(move || {
        let account = keychain::account(&org, id)?;
        keychain::Keychain.set(&account, &secret)
    })
    .await
}

/// In test and presentation modes the connection rows are copies of the real
/// ones: removing one there must not delete the real Keychain secret, so the
/// call succeeds without touching it.
#[tauri::command]
pub(crate) async fn connection_delete_secret(app: tauri::AppHandle, org: String, id: i64) -> Result<(), String> {
    let active = crate::active_org(&app)?;
    check_org(&org, &active.id)?;
    if active.in_mode() {
        return Ok(());
    }
    blocking(move || {
        let account = keychain::account(&org, id)?;
        keychain::Keychain.delete(&account)
    })
    .await
}

#[tauri::command]
pub(crate) async fn connection_test(
    app: tauri::AppHandle,
    org: String,
    id: i64,
    kind: String,
    config: JsonValue,
) -> Result<DeviceList, String> {
    guard(&app, &org)?;
    blocking(move || run_test(&keychain::Keychain, &org, id, &kind, &config, &build_connector)).await
}

#[tauri::command]
pub(crate) async fn connection_sync(
    app: tauri::AppHandle,
    org: String,
    id: i64,
    kind: String,
    config: JsonValue,
) -> Result<SyncResult, String> {
    guard(&app, &org)?;
    blocking(move || run_sync(&keychain::Keychain, &org, id, &kind, &config, &build_connector)).await
}

#[cfg(test)]
mod tests {
    use super::keychain::{account, MemoryStore, SecretStore};
    use super::*;

    struct Failing(String);
    impl Connector for Failing {
        fn test(&self) -> Result<DeviceList, String> {
            Err(self.0.clone())
        }
        fn sync(&self) -> Result<SyncResult, String> {
            Err(self.0.clone())
        }
    }

    struct Fine;
    impl Connector for Fine {
        fn test(&self) -> Result<DeviceList, String> {
            Ok(vec![DeviceInfo { device_id: "SN1".into(), name: Some("NAS".into()), model: None }])
        }
        fn sync(&self) -> Result<SyncResult, String> {
            Ok(SyncResult {
                devices: vec![DeviceReading {
                    device_id: "SN1".into(),
                    model: None,
                    metrics: vec![("print_hours".into(), 12.5)],
                    disks: vec![],
                }],
            })
        }
    }

    fn store_with(secret: &str) -> MemoryStore {
        let s = MemoryStore::default();
        s.set("6kun0b:3", secret).unwrap();
        s
    }

    #[test]
    fn keychain_account_is_org_and_id() {
        assert_eq!(account("6kun0b", 3).unwrap(), "6kun0b:3");
    }

    #[test]
    fn keychain_account_refuses_ambiguous_keys() {
        assert!(account("", 3).is_err());
        assert!(account("a:b", 3).is_err());
        assert!(account("6kun0b", 0).is_err());
    }

    #[test]
    fn error_message_never_contains_secret() {
        let store = store_with("hunter2-secret");
        let factory = |_: &str, _: &JsonValue, s: Option<String>| -> Result<Box<dyn Connector>, String> {
            Ok(Box::new(Failing(format!("login failed for password {}", s.unwrap()))))
        };
        let err = run_sync(&store, "6kun0b", 3, "fake", &JsonValue::Null, &factory).unwrap_err();
        assert!(!err.contains("hunter2-secret"), "{err}");
        assert!(err.contains("login failed"), "{err}");
        let err = run_test(&store, "6kun0b", 3, "fake", &JsonValue::Null, &factory).unwrap_err();
        assert!(!err.contains("hunter2-secret"), "{err}");
    }

    #[test]
    fn error_message_never_contains_tokens_of_a_json_secret() {
        let store = store_with(r#"{"password":"pw-9876","device_token":"tok-ABCDEF"}"#);
        let factory = |_: &str, _: &JsonValue, _: Option<String>| -> Result<Box<dyn Connector>, String> {
            Ok(Box::new(Failing("bad token tok-ABCDEF (pw pw-9876)".into())))
        };
        let err = run_sync(&store, "6kun0b", 3, "fake", &JsonValue::Null, &factory).unwrap_err();
        assert!(!err.contains("tok-ABCDEF") && !err.contains("pw-9876"), "{err}");
    }

    #[test]
    fn factory_errors_are_redacted_too() {
        let store = store_with("s3cr3t-value");
        let factory = |_: &str, _: &JsonValue, _: Option<String>| -> Result<Box<dyn Connector>, String> {
            Err("cannot parse s3cr3t-value".into())
        };
        let err = run_test(&store, "6kun0b", 3, "fake", &JsonValue::Null, &factory).unwrap_err();
        assert!(!err.contains("s3cr3t-value"), "{err}");
    }

    #[test]
    fn unknown_kind_is_a_clear_error() {
        let store = MemoryStore::default();
        let err = run_sync(&store, "6kun0b", 3, "fax", &JsonValue::Null, &build_connector)
            .err()
            .unwrap();
        assert_eq!(err, "unsupported connection kind: fax");
    }

    #[test]
    fn synology_kind_is_registered() {
        let config = serde_json::json!({ "host": "nas.local", "port": 5001, "account": "studio" });
        assert!(build_connector("synology", &config, Some(r#"{"password":"x"}"#.into())).is_ok());
    }

    struct Renews;
    impl Connector for Renews {
        fn test(&self) -> Result<DeviceList, String> {
            Err("otp_invalid".into())
        }
        fn sync(&self) -> Result<SyncResult, String> {
            Ok(SyncResult { devices: vec![] })
        }
        fn updated_secret(&self) -> Option<String> {
            Some(r#"{"password":"pw","device_token":"new-token"}"#.into())
        }
    }

    #[test]
    fn updated_secret_is_saved_even_when_the_call_fails() {
        let factory = |_: &str, _: &JsonValue, _: Option<String>| -> Result<Box<dyn Connector>, String> {
            Ok(Box::new(Renews))
        };
        let store = store_with(r#"{"password":"pw","otp_code":"123456"}"#);
        run_sync(&store, "6kun0b", 3, "fake", &JsonValue::Null, &factory).unwrap();
        assert_eq!(store.get("6kun0b:3").unwrap().as_deref(), Some(r#"{"password":"pw","device_token":"new-token"}"#));
        let store = store_with(r#"{"password":"pw","otp_code":"000000"}"#);
        assert_eq!(run_test(&store, "6kun0b", 3, "fake", &JsonValue::Null, &factory).unwrap_err(), "otp_invalid");
        assert!(!store.get("6kun0b:3").unwrap().unwrap().contains("otp_code"));
    }

    #[test]
    fn updated_secret_is_not_written_once_the_connection_is_gone() {
        let factory = |_: &str, _: &JsonValue, _: Option<String>| -> Result<Box<dyn Connector>, String> {
            Ok(Box::new(Renews))
        };
        let store = store_with(r#"{"password":"pw","otp_code":"123456"}"#);
        // The connection (and its secret) is removed while the call is in flight.
        with_connector(&store, "6kun0b", 3, "fake", &JsonValue::Null, &factory, |c| {
            store.delete("6kun0b:3").unwrap();
            c.sync()
        })
        .unwrap();
        assert_eq!(store.get("6kun0b:3").unwrap(), None, "no orphan Keychain entry");
    }

    #[test]
    fn errors_are_scrubbed_of_the_updated_secret_too() {
        struct Leaky;
        impl Connector for Leaky {
            fn test(&self) -> Result<DeviceList, String> {
                Err("token new-token-xyz refused".into())
            }
            fn sync(&self) -> Result<SyncResult, String> {
                unreachable!()
            }
            fn updated_secret(&self) -> Option<String> {
                Some(r#"{"password":"pw","device_token":"new-token-xyz"}"#.into())
            }
        }
        let factory = |_: &str, _: &JsonValue, _: Option<String>| -> Result<Box<dyn Connector>, String> {
            Ok(Box::new(Leaky))
        };
        let store = store_with(r#"{"password":"pw"}"#);
        let err = run_test(&store, "6kun0b", 3, "fake", &JsonValue::Null, &factory).unwrap_err();
        assert!(!err.contains("new-token-xyz"), "{err}");
    }

    #[test]
    fn connector_gets_the_secret_of_its_org_and_id() {
        let store = store_with("the-secret");
        store.set("other:3", "wrong").unwrap();
        let factory = |_: &str, _: &JsonValue, s: Option<String>| -> Result<Box<dyn Connector>, String> {
            assert_eq!(s.as_deref(), Some("the-secret"));
            Ok(Box::new(Fine))
        };
        let r = run_sync(&store, "6kun0b", 3, "fake", &JsonValue::Null, &factory).unwrap();
        assert_eq!(r.devices[0].metrics, vec![("print_hours".to_string(), 12.5)]);
        let d = run_test(&store, "6kun0b", 3, "fake", &JsonValue::Null, &factory).unwrap();
        assert_eq!(d[0].device_id, "SN1");
    }

    #[test]
    fn sync_result_serialises_for_the_frontend() {
        let r = Fine.sync().unwrap();
        let v = serde_json::to_value(&r).unwrap();
        assert_eq!(v["devices"][0]["metrics"][0], serde_json::json!(["print_hours", 12.5]));
    }

    #[test]
    fn redacts_percent_encoded_secret() {
        let store = store_with("p@ss word!");
        let factory = |_: &str, _: &JsonValue, _: Option<String>| -> Result<Box<dyn Connector>, String> {
            Ok(Box::new(Failing(
                "error sending request for url (https://nas:5001/webapi/auth.cgi?account=me&passwd=p%40ss%20word%21&x=1)".into(),
            )))
        };
        let err = run_sync(&store, "6kun0b", 3, "fake", &JsonValue::Null, &factory).unwrap_err();
        assert!(!err.contains("p%40ss"), "{err}");
        assert!(err.contains("account=me"), "{err}");
    }

    #[test]
    fn redacts_lowercase_percent_encoding() {
        assert!(!redact("passwd=p%40ss%20word%21".to_lowercase().as_str(), Some("p@ss word!")).contains("%40ss"));
    }

    #[test]
    fn redacts_form_encoded_secret() {
        let out = redact("body passwd=p%40ss+word%21 rejected", Some("p@ss word!"));
        assert!(!out.contains("p%40ss+word"), "{out}");
    }

    #[test]
    fn redacts_json_escaped_secret() {
        let secret = r#"pa"ss\word"#;
        let msg = r#"server said {"passwd":"pa\"ss\\word"}"#;
        let out = redact(msg, Some(secret));
        assert!(!out.contains(r#"pa\"ss"#), "{out}");
    }

    #[test]
    fn redacts_short_values_of_secret_keys() {
        let secret = r#"{"password":"abc","otp":"12","region":"eu"}"#;
        let out = redact("login abc failed, otp 12, region eu", Some(secret));
        assert!(!out.contains("abc") && !out.contains(" 12"), "{out}");
        // A short value under a non-secret key is left alone.
        assert!(out.contains("region eu"), "{out}");
    }

    #[test]
    fn refuses_another_orgs_connection() {
        assert!(check_org("6kun0b", "6kun0b").is_ok());
        assert!(check_org("other1", "6kun0b").is_err());
    }

    #[test]
    fn http_client_builds_with_the_ring_provider() {
        assert!(http_client().build().is_ok());
    }
}
