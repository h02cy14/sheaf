//! The error type every command returns. Serialised as `{ code, message }`
//! so the frontend can branch on `code` and show `message`.

use serde::Serialize;
use std::io;

#[derive(Debug, Serialize)]
pub struct CmdError {
    pub code: &'static str,
    pub message: String,
}

pub type CmdResult<T> = Result<T, CmdError>;

impl CmdError {
    pub fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }

    pub fn invalid_path(path: &str) -> Self {
        Self::new(
            "invalid-path",
            format!("Not a valid project path: {path:?}"),
        )
    }

    pub fn unknown_handle() -> Self {
        Self::new("unknown-handle", "The project or index is no longer open.")
    }
}

impl From<io::Error> for CmdError {
    fn from(error: io::Error) -> Self {
        let code = match error.kind() {
            io::ErrorKind::NotFound => "not-found",
            io::ErrorKind::PermissionDenied => "permission-denied",
            io::ErrorKind::AlreadyExists => "already-exists",
            _ => "io",
        };
        Self::new(code, error.to_string())
    }
}

impl From<rusqlite::Error> for CmdError {
    fn from(error: rusqlite::Error) -> Self {
        Self::new("sqlite", error.to_string())
    }
}

impl From<tauri::Error> for CmdError {
    fn from(error: tauri::Error) -> Self {
        Self::new("shell", error.to_string())
    }
}
