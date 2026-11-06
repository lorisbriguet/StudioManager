//! Binding of a Keychain secret to the server it was saved for.
//!
//! The connection row (SQLite: backed up, restorable, editable) says where to
//! connect. A secret that names its host, port and certificate pin is sent
//! only when the row names the same ones, so a changed row can't redirect a
//! password or token to another server. Used by Synology and Paperless.

use super::tls::normalize_fingerprint;

/// Where a secret may be sent. `host: None`: a secret saved before the
/// binding existed.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Bound<'a> {
    pub host: Option<&'a str>,
    pub port: Option<u16>,
    pub pin: Option<&'a str>,
}

/// The answer of [`check`].
#[derive(Debug, PartialEq)]
pub(crate) enum Binding {
    /// The row matches the secret: send it.
    Matches,
    /// A legacy secret: bind it now to the row's host, port and pin (pin
    /// normalised), and write it back.
    Adopt { host: String, port: u16, pin: Option<String> },
    /// The row names another server: send nothing, ask for the secret again.
    Refused,
}

fn same_host(a: &str, b: &str) -> bool {
    let norm = |h: &str| h.trim().trim_start_matches('[').trim_end_matches(']').to_ascii_lowercase();
    norm(a) == norm(b)
}

/// May a secret bound to `bound` go to `host:port` with certificate `pin`?
/// `default_port` stands in for a bound secret without a port.
///
/// Legacy secrets adopt the row's current values once, so existing
/// connections keep working without asking for the secret again. The
/// trade-off: a row tampered with *before* this first adoption is trusted.
/// Any change after it needs the secret. A row without a pin is accepted with
/// a pinned secret: the request then trusts only what the system trusts,
/// which is stricter.
pub(crate) fn check(bound: &Bound, default_port: u16, host: &str, port: u16, pin: Option<&str>) -> Binding {
    let pin = pin.and_then(normalize_fingerprint);
    let Some(bound_host) = bound.host else {
        return Binding::Adopt { host: host.trim().to_string(), port, pin };
    };
    let bound_pin = bound.pin.and_then(normalize_fingerprint);
    let pin_ok = pin.is_none() || pin == bound_pin;
    if same_host(bound_host, host) && bound.port.unwrap_or(default_port) == port && pin_ok {
        Binding::Matches
    } else {
        Binding::Refused
    }
}
