//! Why a connector call failed. The next task adds the retry rules to this file.

use serde::{Deserialize, Serialize};

/// The kind of a failed call, kept in the hubs' state file.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ErrorKind {
    NotApproved,
    NotStarted,
    TimedOut,
    TooLarge,
    BadAnswer,
    Failed,
}
