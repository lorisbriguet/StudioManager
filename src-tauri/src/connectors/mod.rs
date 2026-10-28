//! Connections: optional readers of a user's devices (spec §8). One file per
//! kind behind [`Connector`]; the frontend only calls the commands below.
//!
//! The config sent by the frontend never contains the secret: it is read here
//! from the Keychain, and every error returned to the frontend is scrubbed of it.

pub mod keychain;

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

pub trait Connector {
    fn test(&self) -> Result<DeviceList, String>;
    fn sync(&self) -> Result<SyncResult, String>;
}

/// Build the connector of a kind. Tasks 13–14 register `synology` and
/// `bambu_cloud` here.
fn build_connector(
    kind: &str,
    _config: &JsonValue,
    _secret: Option<String>,
) -> Result<Box<dyn Connector>, String> {
    Err(format!("unsupported connection kind: {kind}"))
}

/// Remove the secret, and every string inside it when it is a JSON blob
/// (password plus tokens), from a message bound for the frontend.
pub(crate) fn redact(msg: &str, secret: Option<&str>) -> String {
    let Some(secret) = secret else { return msg.to_string() };
    let mut needles: Vec<String> = Vec::new();
    fn collect(v: &JsonValue, out: &mut Vec<String>) {
        match v {
            JsonValue::String(s) => out.push(s.clone()),
            JsonValue::Array(a) => a.iter().for_each(|x| collect(x, out)),
            JsonValue::Object(o) => o.values().for_each(|x| collect(x, out)),
            _ => {}
        }
    }
    if let Ok(v) = serde_json::from_str::<JsonValue>(secret) {
        collect(&v, &mut needles);
    }
    // Longest first so a token inside the blob doesn't leave a partial match.
    // Very short strings (e.g. a region code) are not secrets worth hiding and
    // would mangle the message.
    needles.retain(|n| n.chars().count() >= 4);
    if !secret.is_empty() {
        needles.push(secret.to_string());
    }
    needles.sort_by_key(|n| std::cmp::Reverse(n.len()));
    let mut out = msg.to_string();
    for n in &needles {
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
    let scrub = |e: String| redact(&e, secret.as_deref());
    let connector = factory(kind, config, secret.clone()).map_err(scrub)?;
    run(connector.as_ref()).map_err(scrub)
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

/// Test and presentation modes never talk to a real device (spec §8).
fn refuse_in_mode(app: &tauri::AppHandle) -> Result<(), String> {
    if crate::active_org(app)?.in_mode() {
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
pub(crate) async fn connection_save_secret(org: String, id: i64, secret: String) -> Result<(), String> {
    blocking(move || {
        let account = keychain::account(&org, id)?;
        keychain::Keychain.set(&account, &secret)
    })
    .await
}

#[tauri::command]
pub(crate) async fn connection_delete_secret(org: String, id: i64) -> Result<(), String> {
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
    refuse_in_mode(&app)?;
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
    refuse_in_mode(&app)?;
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
        let err = run_sync(&store, "6kun0b", 3, "synology", &JsonValue::Null, &build_connector)
            .err()
            .unwrap();
        assert_eq!(err, "unsupported connection kind: synology");
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
}
