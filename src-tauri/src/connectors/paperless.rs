//! Paperless-ngx connector: the supplier-invoice inbox. Lists the documents
//! tagged `À saisir`, downloads their original file and thumbnail, and writes
//! the title and tags back once a document became an expense.
//!
//! Secret (Keychain): the API token as a plain string. Every request sends
//! `Authorization: Token <token>` and `Accept: application/json` (no
//! `; version=N`: the server's default API version is used).
//!
//! Error strings the frontend matches on:
//! - `Paperless refused the token (401). Reconnect it in Settings.` (HTTP 401/403);
//! - `Paperless unreachable: <reason>` (no HTTP answer: DNS, connect, TLS, timeout);
//! - `Paperless error <status>` for any other HTTP status.

use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value as JsonValue};
use tauri::Manager;

use super::{describe, read_limited, Connector, DeviceInfo, DeviceList, SyncResult, MAX_RESPONSE_BYTES};

const INBOX_TAG: &str = "À saisir";
const LINKED_TAG: &str = "StudioManager";
const MAX_FILE_BYTES: usize = 50 * 1024 * 1024;
const MAX_THUMB_BYTES: usize = 5 * 1024 * 1024;
const REFUSED: &str = "Paperless refused the token (401). Reconnect it in Settings.";

const INBOX_PATH: &str = "/api/documents/?tags__name__iexact=%C3%80%20saisir&ordering=-created&page_size=100";
const TAGS_PATH: &str = "/api/tags/?page_size=1000";
const CORRESPONDENTS_PATH: &str = "/api/correspondents/?page_size=1000";

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct InboxDoc {
    pub id: i64,
    pub title: String,
    pub correspondent: Option<String>,
    /// YYYY-MM-DD
    pub created: String,
    pub original_file_name: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) enum Method {
    Get,
    Post,
    Patch,
}

#[derive(Debug, Clone)]
pub(crate) struct Request {
    pub method: Method,
    /// Path and query, starting with `/api/`.
    pub path: String,
    pub headers: Vec<(String, String)>,
    pub body: Option<JsonValue>,
    /// Largest body accepted in the answer.
    pub limit: usize,
}

#[derive(Debug, Clone)]
pub(crate) struct Response {
    pub status: u16,
    pub content_type: Option<String>,
    pub content_disposition: Option<String>,
    pub body: Vec<u8>,
}

/// One HTTP round trip. `Err` only when no HTTP answer came back; the message
/// is already `Paperless unreachable: …` and URL-free.
pub(crate) trait Transport: Send + Sync {
    fn send(&self, req: &Request) -> Result<Response, String>;
}

struct Https {
    client: reqwest::blocking::Client,
    base: String,
}

impl Transport for Https {
    fn send(&self, req: &Request) -> Result<Response, String> {
        let url = format!("{}{}", self.base, req.path);
        let mut rb = match req.method {
            Method::Get => self.client.get(url),
            Method::Post => self.client.post(url),
            Method::Patch => self.client.patch(url),
        };
        for (k, v) in &req.headers {
            rb = rb.header(k.as_str(), v.as_str());
        }
        if let Some(b) = &req.body {
            rb = rb.json(b);
        }
        let resp = rb.send().map_err(|e| format!("Paperless unreachable: {}", describe(e)))?;
        let status = resp.status().as_u16();
        let header = |name: &str| resp.headers().get(name).and_then(|v| v.to_str().ok()).map(String::from);
        let content_type = header("content-type");
        let content_disposition = header("content-disposition");
        let body = if (200..300).contains(&status) {
            read_limited(resp.content_length(), resp, req.limit).map_err(|e| format!("Paperless error {status}: {e}"))?
        } else {
            // Error bodies are never passed on (they may echo credentials).
            Vec::new()
        };
        Ok(Response { status, content_type, content_disposition, body })
    }
}

pub(crate) struct Paperless {
    host: String,
    token: String,
    transport: Box<dyn Transport>,
}

fn name_eq(a: &str, b: &str) -> bool {
    a.trim().to_lowercase() == b.trim().to_lowercase()
}

/// Items of a paginated answer (`results`) as `(id, name)`.
fn id_names(page: &JsonValue) -> Vec<(i64, String)> {
    page.get("results")
        .and_then(JsonValue::as_array)
        .map(|a| {
            a.iter()
                .filter_map(|t| Some((t.get("id")?.as_i64()?, t.get("name")?.as_str()?.to_string())))
                .collect()
        })
        .unwrap_or_default()
}

fn ids(v: &JsonValue, key: &str) -> Vec<i64> {
    v.get(key).and_then(JsonValue::as_array).map(|a| a.iter().filter_map(JsonValue::as_i64).collect()).unwrap_or_default()
}

/// The inbox out of the three Paperless answers: documents tagged `À saisir`
/// that don't carry `StudioManager`.
pub(crate) fn parse_inbox(docs: &JsonValue, tags: &JsonValue, correspondents: &JsonValue) -> Vec<InboxDoc> {
    let tag_names = id_names(tags);
    let linked: Vec<i64> = tag_names.iter().filter(|(_, n)| name_eq(n, LINKED_TAG)).map(|(i, _)| *i).collect();
    let people = id_names(correspondents);
    docs.get("results")
        .and_then(JsonValue::as_array)
        .map(|a| a.as_slice())
        .unwrap_or_default()
        .iter()
        .filter(|d| !ids(d, "tags").iter().any(|t| linked.contains(t)))
        .filter_map(|d| {
            let correspondent = d
                .get("correspondent")
                .and_then(JsonValue::as_i64)
                .and_then(|c| people.iter().find(|(i, _)| *i == c))
                .map(|(_, n)| n.clone());
            Some(InboxDoc {
                id: d.get("id")?.as_i64()?,
                title: d.get("title").and_then(JsonValue::as_str).unwrap_or_default().to_string(),
                correspondent,
                created: d.get("created").and_then(JsonValue::as_str).unwrap_or_default().chars().take(10).collect(),
                original_file_name: d.get("original_file_name").and_then(JsonValue::as_str).map(String::from),
            })
        })
        .collect()
}

/// File extension of a downloaded original: the `Content-Disposition` file
/// name, else the content type, else `pdf`.
fn extension(resp: &Response) -> String {
    let from_name = resp.content_disposition.as_deref().and_then(|cd| {
        let i = cd.to_ascii_lowercase().find("filename")?;
        let rest = &cd[i..];
        let name = rest.split(';').next()?.split('=').nth(1)?.trim().trim_matches('"');
        let ext = name.rsplit_once('.')?.1.to_ascii_lowercase();
        Some(ext)
    });
    let from_type = resp.content_type.as_deref().and_then(|ct| {
        Some(match ct.split(';').next()?.trim().to_ascii_lowercase().as_str() {
            "application/pdf" => "pdf",
            "image/png" => "png",
            "image/jpeg" => "jpg",
            "image/webp" => "webp",
            "image/tiff" => "tiff",
            "image/gif" => "gif",
            _ => return None,
        }
        .to_string())
    });
    from_name
        .or(from_type)
        .filter(|e| !e.is_empty() && e.len() <= 5 && e.chars().all(|c| c.is_ascii_alphanumeric()))
        .unwrap_or_else(|| "pdf".into())
}

impl Paperless {
    fn call(&self, method: Method, path: &str, body: Option<JsonValue>, limit: usize) -> Result<Response, String> {
        let req = Request {
            method,
            path: path.to_string(),
            headers: vec![
                ("Authorization".into(), format!("Token {}", self.token)),
                ("Accept".into(), "application/json".into()),
            ],
            body,
            limit,
        };
        let resp = self.transport.send(&req)?;
        match resp.status {
            200..=299 => Ok(resp),
            401 | 403 => Err(REFUSED.into()),
            s => Err(format!("Paperless error {s}")),
        }
    }

    fn json(&self, method: Method, path: &str, body: Option<JsonValue>) -> Result<JsonValue, String> {
        let resp = self.call(method, path, body, MAX_RESPONSE_BYTES)?;
        serde_json::from_slice(&resp.body).map_err(|_| "Paperless sent an unreadable answer: not JSON".to_string())
    }

    pub(crate) fn inbox(&self) -> Result<Vec<InboxDoc>, String> {
        let docs = self.json(Method::Get, INBOX_PATH, None)?;
        let tags = self.json(Method::Get, TAGS_PATH, None)?;
        let people = self.json(Method::Get, CORRESPONDENTS_PATH, None)?;
        Ok(parse_inbox(&docs, &tags, &people))
    }

    /// The original file and its extension.
    pub(crate) fn download(&self, doc_id: i64) -> Result<(Vec<u8>, String), String> {
        let resp = self.call(Method::Get, &format!("/api/documents/{doc_id}/download/?original=true"), None, MAX_FILE_BYTES)?;
        let ext = extension(&resp);
        Ok((resp.body, ext))
    }

    pub(crate) fn thumbnail(&self, doc_id: i64) -> Result<String, String> {
        let resp = self.call(Method::Get, &format!("/api/documents/{doc_id}/thumb/"), None, MAX_THUMB_BYTES)?;
        let mime = resp
            .content_type
            .as_deref()
            .and_then(|c| c.split(';').next())
            .map(str::trim)
            .filter(|c| c.starts_with("image/"))
            .unwrap_or("image/webp");
        Ok(format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(&resp.body)))
    }

    pub(crate) fn mark_linked(&self, doc_id: i64, title: &str, tag_names: &[String]) -> Result<(), String> {
        let doc = self.json(Method::Get, &format!("/api/documents/{doc_id}/"), None)?;
        let mut known = id_names(&self.json(Method::Get, TAGS_PATH, None)?);
        let mut new_ids = Vec::new();
        for name in tag_names {
            let name = name.trim();
            if name.is_empty() {
                continue;
            }
            let id = match known.iter().find(|(_, n)| name_eq(n, name)) {
                Some((id, _)) => *id,
                None => {
                    let created = self.json(Method::Post, "/api/tags/", Some(json!({ "name": name })))?;
                    let id = created
                        .get("id")
                        .and_then(JsonValue::as_i64)
                        .ok_or("Paperless sent an unreadable answer: no tag id")?;
                    known.push((id, name.to_string()));
                    id
                }
            };
            new_ids.push(id);
        }
        let inbox: Vec<i64> = known.iter().filter(|(_, n)| name_eq(n, INBOX_TAG)).map(|(i, _)| *i).collect();
        let mut tags: Vec<i64> = ids(&doc, "tags").into_iter().filter(|t| !inbox.contains(t)).collect();
        for id in new_ids {
            if !tags.contains(&id) {
                tags.push(id);
            }
        }
        self.json(Method::Patch, &format!("/api/documents/{doc_id}/"), Some(json!({ "title": title, "tags": tags })))?;
        Ok(())
    }
}

impl Connector for Paperless {
    fn test(&self) -> Result<DeviceList, String> {
        self.json(Method::Get, "/api/documents/?page_size=1", None)?;
        Ok(vec![DeviceInfo { device_id: "paperless".into(), name: Some(self.host.clone()), model: None }])
    }

    fn sync(&self) -> Result<SyncResult, String> {
        Ok(SyncResult { devices: vec![] })
    }
}

#[derive(Deserialize)]
struct Config {
    host: String,
    port: Option<i64>,
    cert_fingerprint: Option<String>,
}

fn valid_host(host: &str) -> bool {
    !host.is_empty()
        && host.len() <= 253
        && host.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_' | ':' | '[' | ']'))
}

fn base_url(host: &str, port: u16) -> String {
    if host.contains(':') && !host.starts_with('[') {
        format!("https://[{host}]:{port}")
    } else {
        format!("https://{host}:{port}")
    }
}

/// Build from the connection config `{host, port, cert_fingerprint?}` and the
/// Keychain secret (the API token). Makes no request.
pub(crate) fn build(config: &JsonValue, secret: Option<String>) -> Result<Box<dyn Connector>, String> {
    Ok(Box::new(build_paperless(config, secret)?))
}

fn build_paperless(config: &JsonValue, secret: Option<String>) -> Result<Paperless, String> {
    let cfg: Config = serde_json::from_value(config.clone())
        .map_err(|_| "the Paperless connection needs an address".to_string())?;
    let host = cfg.host.trim();
    if !valid_host(host) {
        return Err("invalid Paperless address: type a host name or IP address only".into());
    }
    let port = match cfg.port {
        None => 443,
        Some(p) => u16::try_from(p).ok().filter(|p| *p > 0).ok_or("invalid Paperless port: use a number from 1 to 65535")?,
    };
    let token = secret.map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).ok_or(REFUSED)?;
    let (builder, _seen) = super::tls::pinned_http_client(cfg.cert_fingerprint.as_deref())?;
    let client = builder
        .timeout(std::time::Duration::from_secs(60))
        .connect_timeout(std::time::Duration::from_secs(10))
        // Never follow a redirect with the token attached.
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| format!("HTTP setup failed: {}", describe(e)))?;
    Ok(Paperless { host: host.to_string(), token, transport: Box::new(Https { client, base: base_url(host, port) }) })
}

/// Read the token from the Keychain, build the connector and run `f`, with
/// every error scrubbed of the token.
fn with_paperless<T>(
    store: &dyn super::keychain::SecretStore,
    org: &str,
    id: i64,
    config: &JsonValue,
    f: impl FnOnce(&Paperless) -> Result<T, String>,
) -> Result<T, String> {
    let account = super::keychain::account(org, id)?;
    let secret = store.get(&account)?;
    let p = build_paperless(config, secret.clone()).map_err(|e| super::redact(&e, secret.as_deref()))?;
    f(&p).map_err(|e| super::redact(&e, secret.as_deref()))
}

#[tauri::command]
pub(crate) async fn paperless_inbox(app: tauri::AppHandle, org: String, id: i64, config: JsonValue) -> Result<Vec<InboxDoc>, String> {
    super::guard(&app, &org)?;
    super::blocking(move || with_paperless(&super::keychain::Keychain, &org, id, &config, |p| p.inbox())).await
}

#[tauri::command]
pub(crate) async fn paperless_download(
    app: tauri::AppHandle,
    org: String,
    id: i64,
    config: JsonValue,
    doc_id: i64,
) -> Result<String, String> {
    super::guard(&app, &org)?;
    let dir = app.path().app_cache_dir().map_err(|e| format!("Failed to get app cache dir: {e}"))?.join("paperless");
    super::blocking(move || {
        let (bytes, ext) = with_paperless(&super::keychain::Keychain, &org, id, &config, |p| p.download(doc_id))?;
        std::fs::create_dir_all(&dir).map_err(|e| format!("cannot create the cache folder: {e}"))?;
        let path = dir.join(format!("{doc_id}.{ext}"));
        std::fs::write(&path, bytes).map_err(|e| format!("cannot save the file: {e}"))?;
        Ok(path.to_string_lossy().into_owned())
    })
    .await
}

#[tauri::command]
pub(crate) async fn paperless_thumbnail(
    app: tauri::AppHandle,
    org: String,
    id: i64,
    config: JsonValue,
    doc_id: i64,
) -> Result<String, String> {
    super::guard(&app, &org)?;
    super::blocking(move || with_paperless(&super::keychain::Keychain, &org, id, &config, |p| p.thumbnail(doc_id))).await
}

#[tauri::command]
pub(crate) async fn paperless_mark_linked(
    app: tauri::AppHandle,
    org: String,
    id: i64,
    config: JsonValue,
    doc_id: i64,
    title: String,
    tags: Vec<String>,
) -> Result<(), String> {
    super::guard(&app, &org)?;
    super::blocking(move || with_paperless(&super::keychain::Keychain, &org, id, &config, |p| p.mark_linked(doc_id, &title, &tags))).await
}

#[cfg(test)]
mod tests {
    use super::super::keychain::{MemoryStore, SecretStore};
    use super::*;
    use std::sync::Mutex;

    const DOCS: &str = include_str!("fixtures/paperless_documents.json");
    const TAGS: &str = include_str!("fixtures/paperless_tags.json");
    const PEOPLE: &str = include_str!("fixtures/paperless_correspondents.json");

    type Handler = Box<dyn Fn(&Request) -> Result<Response, String> + Send + Sync>;

    struct Fake {
        seen: std::sync::Arc<Mutex<Vec<Request>>>,
        handler: Handler,
    }

    impl Transport for Fake {
        fn send(&self, req: &Request) -> Result<Response, String> {
            self.seen.lock().unwrap().push(req.clone());
            (self.handler)(req)
        }
    }

    fn ok(body: &str) -> Result<Response, String> {
        Ok(Response { status: 200, content_type: Some("application/json".into()), content_disposition: None, body: body.as_bytes().to_vec() })
    }

    fn status(s: u16) -> Result<Response, String> {
        Ok(Response { status: s, content_type: None, content_disposition: None, body: vec![] })
    }

    fn fake(handler: impl Fn(&Request) -> Result<Response, String> + Send + Sync + 'static) -> (Paperless, std::sync::Arc<Mutex<Vec<Request>>>) {
        let seen = std::sync::Arc::new(Mutex::new(vec![]));
        let p = Paperless {
            host: "paperless.local".into(),
            token: "t0k".into(),
            transport: Box::new(Fake { seen: seen.clone(), handler: Box::new(handler) }),
        };
        (p, seen)
    }

    fn routes(req: &Request) -> Result<Response, String> {
        let p = req.path.as_str();
        if p.starts_with("/api/documents/?") {
            ok(DOCS)
        } else if p.starts_with("/api/tags/") {
            ok(TAGS)
        } else if p.starts_with("/api/correspondents/") {
            ok(PEOPLE)
        } else {
            status(404)
        }
    }

    #[test]
    fn parse_inbox_skips_studiomanager_tagged() {
        let v = |s: &str| serde_json::from_str::<JsonValue>(s).unwrap();
        let inbox = parse_inbox(&v(DOCS), &v(TAGS), &v(PEOPLE));
        assert_eq!(inbox.len(), 2);
        assert_eq!(
            inbox[0],
            InboxDoc {
                id: 103,
                title: "Facture Swisscom octobre".into(),
                correspondent: Some("Swisscom".into()),
                created: "2026-10-28".into(),
                original_file_name: Some("scan_20261028.pdf".into()),
            }
        );
        assert_eq!(inbox[1].id, 101);
        assert_eq!(inbox[1].correspondent, None);
        assert_eq!(inbox[1].original_file_name, None);
    }

    #[test]
    fn inbox_queries_the_server_by_tag_name() {
        let (p, seen) = fake(routes);
        assert_eq!(p.inbox().unwrap().len(), 2);
        let seen = seen.lock().unwrap();
        assert_eq!(seen[0].path, INBOX_PATH);
        assert!(seen[0].path.contains("tags__name__iexact=%C3%80%20saisir"));
    }

    #[test]
    fn request_has_token_header_and_no_api_version() {
        let (p, seen) = fake(routes);
        p.inbox().unwrap();
        for req in seen.lock().unwrap().iter() {
            assert_eq!(
                req.headers,
                vec![("Authorization".to_string(), "Token t0k".to_string()), ("Accept".to_string(), "application/json".to_string())]
            );
        }
    }

    #[test]
    fn unauthorized_is_redacted_and_readable() {
        let (p, _) = fake(|_| status(401));
        let err = p.inbox().unwrap_err();
        assert_eq!(err, "Paperless refused the token (401). Reconnect it in Settings.");
        assert!(!err.contains("t0k"));
        let (p, _) = fake(|_| status(403));
        assert_eq!(p.test().unwrap_err(), REFUSED);
    }

    #[test]
    fn other_status_is_a_short_error() {
        let (p, _) = fake(|_| status(500));
        assert_eq!(p.inbox().unwrap_err(), "Paperless error 500");
    }

    #[test]
    fn errors_through_the_command_path_never_contain_the_token() {
        let store = MemoryStore::default();
        store.set("6kun0b:3", "t0k-secret").unwrap();
        let config = json!({ "host": "bad host", "port": 8000 });
        let err = with_paperless(&store, "6kun0b", 3, &config, |p| p.inbox()).unwrap_err();
        assert!(!err.contains("t0k-secret"), "{err}");
        // No stored token at all reads as a refused token.
        let err = with_paperless(&MemoryStore::default(), "6kun0b", 3, &json!({ "host": "paperless.local" }), |p| p.inbox()).unwrap_err();
        assert_eq!(err, REFUSED);
    }

    #[test]
    fn transport_failure_is_unreachable() {
        // A port nobody listens on: connection refused, no HTTP answer.
        let port = std::net::TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port();
        let p = build_paperless(&json!({ "host": "127.0.0.1", "port": port }), Some("t0k".into())).unwrap();
        let err = p.inbox().unwrap_err();
        assert!(err.starts_with("Paperless unreachable: "), "{err}");
        assert!(!err.contains("t0k") && !err.contains("127.0.0.1:"), "{err}");
    }

    #[test]
    fn test_returns_one_device_and_sync_none() {
        let (p, seen) = fake(|_| ok(r#"{"count":0,"results":[]}"#));
        let d = p.test().unwrap();
        assert_eq!(d, vec![DeviceInfo { device_id: "paperless".into(), name: Some("paperless.local".into()), model: None }]);
        assert_eq!(seen.lock().unwrap()[0].path, "/api/documents/?page_size=1");
        assert!(p.sync().unwrap().devices.is_empty());
    }

    #[test]
    fn mark_linked_creates_missing_tags_and_removes_inbox_tag() {
        let (p, seen) = fake(|req| match (req.method, req.path.as_str()) {
            (Method::Get, "/api/documents/101/") => ok(r#"{"id":101,"title":"Scan","tags":[1,3]}"#),
            (Method::Get, "/api/tags/?page_size=1000") => ok(TAGS),
            (Method::Post, "/api/tags/") => ok(r#"{"id":9,"name":"Nouveau"}"#),
            (Method::Patch, "/api/documents/101/") => ok("{}"),
            _ => status(404),
        });
        p.mark_linked(101, "F-26-070 Sunrise", &["studiomanager".into(), "Nouveau".into(), "Fournisseur".into()]).unwrap();
        let seen = seen.lock().unwrap();
        let post = seen.iter().find(|r| r.method == Method::Post).unwrap();
        assert_eq!(post.body, Some(json!({ "name": "Nouveau" })));
        assert_eq!(seen.iter().filter(|r| r.method == Method::Post).count(), 1);
        let patch = seen.last().unwrap();
        assert_eq!(patch.method, Method::Patch);
        assert_eq!(patch.body, Some(json!({ "title": "F-26-070 Sunrise", "tags": [3, 2, 9] })));
    }

    #[test]
    fn download_picks_extension_and_thumbnail_is_a_data_url() {
        let (p, seen) = fake(|req| {
            if req.path.contains("/download/") {
                Ok(Response {
                    status: 200,
                    content_type: Some("application/pdf".into()),
                    content_disposition: Some(r#"attachment; filename="scan.PNG""#.into()),
                    body: b"%PDF".to_vec(),
                })
            } else {
                Ok(Response { status: 200, content_type: None, content_disposition: None, body: vec![1, 2, 3] })
            }
        });
        let (bytes, ext) = p.download(7).unwrap();
        assert_eq!((bytes.as_slice(), ext.as_str()), (&b"%PDF"[..], "png"));
        assert_eq!(seen.lock().unwrap()[0].path, "/api/documents/7/download/?original=true");
        assert_eq!(seen.lock().unwrap()[0].limit, MAX_FILE_BYTES);
        assert_eq!(p.thumbnail(7).unwrap(), "data:image/webp;base64,AQID");
        let r = Response { status: 200, content_type: None, content_disposition: None, body: vec![] };
        assert_eq!(extension(&r), "pdf");
    }
}
