//! Connection secrets (passwords, tokens) in the macOS Keychain. They never
//! touch SQLite, backups, logs or error messages (spec §8).
//!
//! Everything goes through [`SecretStore`] so tests use an in-memory store
//! and never touch the real Keychain.

/// Keychain service shared by every connection.
pub const SERVICE: &str = "ch.studiomanager.app";

/// Keychain account of a connection: `<org id>:<connection id>`. Connection
/// ids repeat across organisations, so the org is part of the key.
pub fn account(org: &str, id: i64) -> Result<String, String> {
    if org.is_empty() || org.contains(':') {
        return Err("invalid organisation id".into());
    }
    if id <= 0 {
        return Err("invalid connection id".into());
    }
    Ok(format!("{org}:{id}"))
}

pub trait SecretStore: Send + Sync {
    fn get(&self, account: &str) -> Result<Option<String>, String>;
    fn set(&self, account: &str, secret: &str) -> Result<(), String>;
    /// Deleting a secret that isn't there is not an error.
    fn delete(&self, account: &str) -> Result<(), String>;
}

/// The real store: the login Keychain via `keyring` (apple-native backend).
pub struct Keychain;

impl Keychain {
    fn entry(account: &str) -> Result<keyring::Entry, String> {
        keyring::Entry::new(SERVICE, account).map_err(|e| format!("Keychain error: {e}"))
    }
}

impl SecretStore for Keychain {
    fn get(&self, account: &str) -> Result<Option<String>, String> {
        match Self::entry(account)?.get_password() {
            Ok(s) => Ok(Some(s)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(format!("Keychain error: {e}")),
        }
    }

    fn set(&self, account: &str, secret: &str) -> Result<(), String> {
        Self::entry(account)?
            .set_password(secret)
            .map_err(|e| format!("Keychain error: {e}"))
    }

    fn delete(&self, account: &str) -> Result<(), String> {
        match Self::entry(account)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(format!("Keychain error: {e}")),
        }
    }
}

/// In-memory store for tests.
#[cfg(test)]
#[derive(Default)]
pub struct MemoryStore(pub std::sync::Mutex<std::collections::HashMap<String, String>>);

#[cfg(test)]
impl SecretStore for MemoryStore {
    fn get(&self, account: &str) -> Result<Option<String>, String> {
        Ok(self.0.lock().unwrap().get(account).cloned())
    }
    fn set(&self, account: &str, secret: &str) -> Result<(), String> {
        self.0.lock().unwrap().insert(account.to_string(), secret.to_string());
        Ok(())
    }
    fn delete(&self, account: &str) -> Result<(), String> {
        self.0.lock().unwrap().remove(account);
        Ok(())
    }
}
