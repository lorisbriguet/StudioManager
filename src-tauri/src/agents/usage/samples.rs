//! Plan-limit samples and how a status line payload's `rate_limits` becomes them. Shared:
//! the app compiles this file, and `studiomanager-mcp` includes it with `#[path]`.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

/// One reading of a plan-limit window.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Sample {
    /// `five_hour`, `seven_day` or `seven_day_<scope>`.
    pub window: String,
    pub percent: f64,
    /// Epoch seconds.
    pub resets_at: f64,
    /// Epoch seconds.
    pub at: f64,
}

/// The windows of a `rate_limits` object, as samples. Either a `limits` list
/// or named windows (`five_hour`, `seven_day`, `seven_day_<x>`).
pub fn samples_from(rate_limits: &Map<String, Value>, now_s: f64) -> Vec<Sample> {
    let mut out = Vec::new();
    if let Some(Value::Array(rows)) = rate_limits.get("limits") {
        for r in rows {
            let percent = r.get("percent").or_else(|| r.get("used_percentage"));
            let (Some(percent), Some(resets_at)) = (
                percent.and_then(Value::as_f64),
                r.get("resets_at").and_then(epoch_s),
            ) else {
                continue;
            };
            let kind = r
                .get("kind")
                .or_else(|| r.get("name"))
                .and_then(Value::as_str)
                .unwrap_or("");
            let scope = r.get("scope");
            let scope_name = ["model", "surface"].iter().find_map(|k| {
                scope?
                    .get(k)?
                    .get("display_name")?
                    .as_str()
                    .map(str::to_string)
            });
            out.push(Sample {
                window: window_name(kind, scope_name.as_deref()),
                percent,
                resets_at,
                at: now_s,
            });
        }
    } else {
        let mut named: Vec<_> = rate_limits
            .iter()
            .filter(|(k, _)| *k == "five_hour" || k.starts_with("seven_day"))
            .collect();
        named.sort_by(|a, b| a.0.cmp(b.0));
        for (key, w) in named {
            let (Some(percent), Some(resets_at)) = (
                w.get("used_percentage").and_then(Value::as_f64),
                w.get("resets_at").and_then(epoch_s),
            ) else {
                continue;
            };
            out.push(Sample {
                window: key.clone(),
                percent,
                resets_at,
                at: now_s,
            });
        }
    }
    out
}

/// `session` -> `five_hour`, `weekly_all` -> `seven_day`,
/// `weekly_scoped` -> `seven_day_<scope>`; anything else is kept as is.
pub fn window_name(kind: &str, scope: Option<&str>) -> String {
    match kind {
        "session" | "five_hour" => "five_hour".into(),
        "weekly_all" | "seven_day" => "seven_day".into(),
        "weekly_scoped" => format!("seven_day_{}", slug(scope.unwrap_or("scoped"))),
        other => other.into(),
    }
}

/// Lowercase, every run of characters outside `[a-z0-9_]` becomes one `_`.
fn slug(name: &str) -> String {
    let mut out = String::new();
    for c in name.to_lowercase().chars() {
        if c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_' {
            out.push(c);
        } else if !out.ends_with('_') {
            out.push('_');
        }
    }
    out
}

/// Epoch seconds from a number or an ISO-8601 string.
fn epoch_s(v: &Value) -> Option<f64> {
    match v {
        Value::Number(n) => n.as_f64(),
        Value::String(s) => {
            let dt = chrono::DateTime::parse_from_rfc3339(s).ok()?;
            Some(dt.timestamp() as f64 + f64::from(dt.timestamp_subsec_millis()) / 1000.0)
        }
        _ => None,
    }
}

