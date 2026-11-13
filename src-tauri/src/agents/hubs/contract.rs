//! The connector contract, version 1 (docs/hub-connector.md): the limits, and the parsers that
//! accept an answer whole or refuse it whole. Text from a connector is data: it is cleaned, never
//! stored here and never shown as markup.

use serde::Deserialize;
use serde_json::{Map, Value};

pub const VERSION: u32 = 1;
pub const MAX_WAITING: u32 = 9999;
pub const TITLE_CHARS: usize = 200;
pub const NOTE_CHARS: usize = 1000;
pub const TEXT_CHARS: usize = 1000;
pub const RECOMMENDATION_CHARS: usize = 500;
pub const MAX_EVENTS: usize = 2000;
pub const MAX_QUESTIONS: usize = 200;
pub const MAX_SPAN_DAYS: i64 = 366;
pub const ERROR_CHARS: usize = 200;
/// The longest id (the rule of `valid_id`, used by the events and questions parsers too).
pub const ID_CHARS: usize = 128;

/// What a connector answered to a request.
#[derive(Debug, Clone, PartialEq)]
pub enum Answer<T> {
    Ok(T),
    /// `"error":"unsupported"`: the request is not offered, which is not a failure.
    Unsupported,
    /// A failure with the connector's one-line message, cleaned.
    Failed(String),
}

#[derive(Debug, Clone, PartialEq)]
pub struct Counts {
    pub waiting: u32,
}

/// Where `open` leads; whether it is allowed is decided by the caller.
#[derive(Debug, Clone, PartialEq)]
pub enum Target {
    Url(String),
    Path(String),
}

/// Control and invisible formatting characters (zero-width, bidirectional overrides, BOM).
fn is_invisible(c: char) -> bool {
    c.is_control()
        || matches!(c, '\u{200B}'..='\u{200F}' | '\u{202A}'..='\u{202E}' | '\u{2060}'..='\u{2069}' | '\u{FEFF}' | '\u{061C}' | '\u{00AD}' | '\u{E0000}'..='\u{E007F}')
}

/// Control characters removed, runs of white space made one space, trimmed, cut at a character
/// boundary to `max_chars` characters.
pub fn clean_text(s: &str, max_chars: usize) -> String {
    let mapped: String = s
        .chars()
        .filter_map(|c| {
            if c.is_whitespace() {
                Some(' ')
            } else if is_invisible(c) {
                None
            } else {
                Some(c)
            }
        })
        .collect();
    let one_line = mapped.split_whitespace().collect::<Vec<_>>().join(" ");
    let cut: String = one_line.chars().take(max_chars).collect();
    cut.trim_end().to_string()
}

/// An id: 1 to 128 characters of `A-Z a-z 0-9 . _ : -`, not starting with a punctuation mark.
pub fn valid_id(id: &str) -> bool {
    let n = id.chars().count();
    (1..=ID_CHARS).contains(&n)
        && id.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | ':' | '-'))
        && id.chars().next().is_some_and(|c| c.is_ascii_alphanumeric())
}

/// The whole stdout as one JSON object (trailing text is an error) with `version` 1. When it
/// carries an `error`, that is the whole answer; otherwise the object is handed back for the
/// request's own shape.
fn envelope(b: &[u8]) -> Result<Result<Map<String, Value>, Answer<()>>, String> {
    let text = std::str::from_utf8(b).map_err(|_| "The answer is not valid UTF-8".to_string())?;
    let value: Value = serde_json::from_str(text).map_err(|e| format!("The answer is not one JSON object: {e}"))?;
    let Value::Object(map) = value else {
        return Err("The answer is not a JSON object".into());
    };
    if map.get("version").and_then(Value::as_u64) != Some(VERSION as u64) {
        return Err(format!("The answer is not version {VERSION}"));
    }
    if let Some(err) = map.get("error") {
        if map.len() != 2 {
            return Err("An error answer has no other key than version and error".into());
        }
        let Value::String(s) = err else {
            return Err("The error is not text".into());
        };
        let line = clean_text(s, ERROR_CHARS);
        return Ok(Err(if line == "unsupported" {
            Answer::Unsupported
        } else if line.is_empty() {
            Answer::Failed("The connector reported an error".into())
        } else {
            Answer::Failed(line)
        }));
    }
    Ok(Ok(map))
}

/// Runs the request's own parser on an answer that is not an error; an error answer becomes
/// `Unsupported` or `Failed` whatever the request.
fn parse<T, W: for<'de> Deserialize<'de>>(
    b: &[u8],
    build: impl FnOnce(W) -> Result<T, String>,
) -> Result<Answer<T>, String> {
    match envelope(b)? {
        Err(Answer::Unsupported) => Ok(Answer::Unsupported),
        Err(Answer::Failed(m)) => Ok(Answer::Failed(m)),
        Err(Answer::Ok(())) => unreachable!("an error answer is never Ok"),
        Ok(map) => {
            let wire: W = serde_json::from_value(Value::Object(map)).map_err(|e| format!("The answer has the wrong shape: {e}"))?;
            build(wire).map(Answer::Ok)
        }
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct CountsWire {
    #[allow(dead_code)] // checked in `envelope`
    version: u32,
    waiting: u32,
}

pub fn parse_counts(b: &[u8]) -> Result<Answer<Counts>, String> {
    parse(b, |w: CountsWire| {
        if w.waiting > MAX_WAITING {
            return Err(format!("waiting is above {MAX_WAITING}"));
        }
        Ok(Counts { waiting: w.waiting })
    })
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct OpenWire {
    #[allow(dead_code)] // checked in `envelope`
    version: u32,
    url: Option<String>,
    path: Option<String>,
}

pub fn parse_open(b: &[u8]) -> Result<Answer<Target>, String> {
    parse(b, |w: OpenWire| match (w.url, w.path) {
        (Some(u), None) if !u.is_empty() => Ok(Target::Url(u)),
        (None, Some(p)) if !p.is_empty() => Ok(Target::Path(p)),
        _ => Err("open needs exactly one of url and path".into()),
    })
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct CaptureWire {
    #[allow(dead_code)] // checked in `envelope`
    version: u32,
    saved: bool,
}

pub fn parse_capture(b: &[u8]) -> Result<Answer<()>, String> {
    parse(b, |w: CaptureWire| if w.saved { Ok(()) } else { Err("saved is not true".into()) })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn counts(s: &str) -> Result<Answer<Counts>, String> {
        parse_counts(s.as_bytes())
    }

    #[test]
    fn garbage_is_refused() {
        assert!(counts("Traceback (most recent call last):\n  KeyError").is_err());
        assert!(counts("").is_err());
        assert!(counts("[1]").is_err());
        assert!(counts("3").is_err());
    }

    #[test]
    fn counts_are_read() {
        assert_eq!(counts(r#"{"version":1,"waiting":3}"#), Ok(Answer::Ok(Counts { waiting: 3 })));
        assert_eq!(counts("{\"version\":1,\"waiting\":9999}\n"), Ok(Answer::Ok(Counts { waiting: 9999 })));
    }

    #[test]
    fn trailing_text_is_refused() {
        assert!(counts(r#"{"version":1,"waiting":1} ok"#).is_err());
    }

    #[test]
    fn two_objects_are_refused() {
        assert!(counts(r#"{"version":1,"waiting":1}{"version":1,"waiting":2}"#).is_err());
        assert!(counts("{\"version\":1,\"waiting\":1}\n{\"version\":1,\"waiting\":2}").is_err());
    }

    #[test]
    fn unknown_key_is_refused() {
        assert!(counts(r#"{"version":1,"waiting":1,"extra":true}"#).is_err());
        assert!(counts(r#"{"version":1,"error":"x","extra":true}"#).is_err());
        assert!(parse_open(br#"{"version":1,"url":"https://example.com","x":1}"#).is_err());
        assert!(parse_capture(br#"{"version":1,"saved":true,"x":1}"#).is_err());
    }

    #[test]
    fn version_2_is_refused() {
        assert!(counts(r#"{"version":2,"waiting":1}"#).is_err());
        assert!(counts(r#"{"version":"1","waiting":1}"#).is_err());
        assert!(counts(r#"{"waiting":1}"#).is_err());
        assert!(counts(r#"{"version":2,"error":"unsupported"}"#).is_err());
    }

    #[test]
    fn waiting_out_of_range_is_refused() {
        for bad in ["-1", "10000", "\"3\"", "3.5", "null"] {
            assert!(counts(&format!(r#"{{"version":1,"waiting":{bad}}}"#)).is_err(), "{bad}");
        }
        assert!(counts(r#"{"version":1}"#).is_err());
    }

    #[test]
    fn unsupported_is_not_a_failure() {
        let a = r#"{"version":1,"error":"unsupported"}"#;
        assert_eq!(counts(a), Ok(Answer::Unsupported));
        assert_eq!(parse_open(a.as_bytes()), Ok(Answer::Unsupported));
        assert_eq!(parse_capture(a.as_bytes()), Ok(Answer::Unsupported));
        // Any other error is a failure, with its message cleaned and cut.
        assert_eq!(
            counts("{\"version\":1,\"error\":\"  the store\\nis \\u001b[31mlocked \"}"),
            Ok(Answer::Failed("the store is [31mlocked".into()))
        );
        let long = format!(r#"{{"version":1,"error":"{}"}}"#, "x".repeat(500));
        assert_eq!(counts(&long), Ok(Answer::Failed("x".repeat(ERROR_CHARS))));
        assert!(counts(r#"{"version":1,"error":3}"#).is_err());
    }

    #[test]
    fn open_needs_exactly_one_target() {
        assert_eq!(
            parse_open(br#"{"version":1,"url":"https://example.com/demo-hub/a"}"#),
            Ok(Answer::Ok(Target::Url("https://example.com/demo-hub/a".into())))
        );
        assert_eq!(
            parse_open(br#"{"version":1,"path":"/tmp/demo-hub"}"#),
            Ok(Answer::Ok(Target::Path("/tmp/demo-hub".into())))
        );
        assert!(parse_open(br#"{"version":1}"#).is_err());
        assert!(parse_open(br#"{"version":1,"url":"https://example.com","path":"/tmp"}"#).is_err());
        assert!(parse_open(br#"{"version":1,"url":""}"#).is_err());
        assert!(parse_open(br#"{"version":1,"url":null,"path":null}"#).is_err());
    }

    #[test]
    fn capture_must_be_saved() {
        assert_eq!(parse_capture(br#"{"version":1,"saved":true}"#), Ok(Answer::Ok(())));
        assert!(parse_capture(br#"{"version":1,"saved":false}"#).is_err());
        assert!(parse_capture(br#"{"version":1}"#).is_err());
    }

    #[test]
    fn control_characters_removed() {
        assert_eq!(clean_text("a\u{1b}[31mb", 50), "a[31mb");
        assert_eq!(clean_text("a\u{202e}b\u{0}c\u{200b}d\u{feff}e", 50), "abcde");
        // Arabic letter mark, soft hyphen, tag characters (U+E0000 to U+E007F).
        assert_eq!(clean_text("a\u{61c}b\u{ad}c\u{e0000}d\u{e0041}e\u{e007f}f", 50), "abcdef");
        assert_eq!(clean_text("  a \t\n b\r\n\r\n  c  ", 50), "a b c");
        assert_eq!(clean_text("\u{0}\u{1b}", 50), "");
        // Cut at a character boundary, and no trailing space after the cut.
        assert_eq!(clean_text("aé€😀b", 4), "aé€😀");
        assert_eq!(clean_text("ab cd", 3), "ab");
    }

    #[test]
    fn invalid_utf8_is_refused() {
        assert!(parse_counts(b"{\"version\":1,\"waiting\":\xff}").is_err());
        assert!(parse_counts(b"{\"version\":1,\"error\":\"\xc3\x28\"}").is_err());
    }

    #[test]
    fn valid_id_rule() {
        assert!(valid_id("ms-a.1:2"));
        assert!(valid_id("a"));
        assert!(valid_id("7"));
        assert!(valid_id(&"a".repeat(128)));
        for bad in ["", "-x", ".x", "_x", ":x", "a b", "a/b", "é", "a\n"] {
            assert!(!valid_id(bad), "{bad:?}");
        }
        assert!(!valid_id(&"a".repeat(129)));
    }
}
