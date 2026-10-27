//! StudioManager agent access: an MCP server over the app's SQLite files.
//! `orgs`, `migrate` and `dbfiles` are the app's own modules, compiled in
//! unchanged so both binaries agree on layout and schema.

#[path = "../../src/orgs.rs"]
pub mod orgs;

#[path = "../../src/migrate.rs"]
pub mod migrate;

// Only some helpers are used here; the rest stay for parity with the app.
#[allow(dead_code)]
#[path = "../../src/dbfiles.rs"]
pub mod dbfiles;

pub mod backup;
pub mod env;
pub mod guard;
pub mod log;
pub mod markdown;
pub mod money;
pub mod read;
pub mod text;
pub mod write;

#[cfg(test)]
pub mod test_support;
