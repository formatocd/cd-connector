pub mod ftp;
pub mod sftp;

use async_trait::async_trait;
use chrono::Utc;
use tauri::{AppHandle, Emitter};
use zeroize::{Zeroize, ZeroizeOnDrop};

use crate::error::AppResult;
use crate::models::{AuthType, FileEntry, LogLevel, Protocol, SessionLogEvent};

#[derive(Clone, Zeroize, ZeroizeOnDrop)]
pub struct ResolvedAuth {
    pub username: String,
    #[zeroize(skip)]
    pub auth_type: AuthType,
    pub password: Option<String>,
    pub private_key: Option<String>,
    pub passphrase: Option<String>,
}

#[derive(Clone)]
pub struct LogEmitter {
    app: AppHandle,
    tab_id: String,
}

impl LogEmitter {
    pub fn new(app: AppHandle, tab_id: String) -> Self {
        Self { app, tab_id }
    }

    pub fn emit(&self, level: LogLevel, message: impl Into<String>) {
        let event = SessionLogEvent {
            tab_id: self.tab_id.clone(),
            timestamp: Utc::now().format("%H:%M:%S").to_string(),
            level,
            message: message.into(),
        };
        let _ = self.app.emit("session-log", event);
    }

    pub fn command(&self, msg: impl Into<String>) {
        self.emit(LogLevel::Command, msg);
    }

    pub fn response(&self, msg: impl Into<String>) {
        self.emit(LogLevel::Response, msg);
    }

    pub fn info(&self, msg: impl Into<String>) {
        self.emit(LogLevel::Info, msg);
    }

    pub fn error(&self, msg: impl Into<String>) {
        self.emit(LogLevel::Error, msg);
    }
}

#[async_trait]
pub trait FileTransferClient: Send + Sync {
    #[allow(dead_code)]
    fn protocol(&self) -> Protocol;
    async fn pwd(&mut self) -> AppResult<String>;
    async fn list_dir(&mut self, path: &str) -> AppResult<Vec<FileEntry>>;
    async fn mkdir(&mut self, path: &str) -> AppResult<()>;
    async fn rename(&mut self, from: &str, to: &str) -> AppResult<()>;
    async fn delete_file(&mut self, path: &str) -> AppResult<()>;
    async fn delete_dir(&mut self, path: &str) -> AppResult<()>;
    async fn chmod(&mut self, path: &str, mode: u32) -> AppResult<()>;
    async fn stat(&mut self, path: &str) -> AppResult<FileEntry>;
    async fn send_raw_command(&mut self, command: &str) -> AppResult<String>;
    async fn disconnect(&mut self) -> AppResult<()>;
}

pub fn format_posix_permissions(mode: u32, is_dir: bool, is_symlink: bool) -> String {
    let mut s = String::with_capacity(10);
    s.push(if is_symlink {
        'l'
    } else if is_dir {
        'd'
    } else {
        '-'
    });
    let flags = [
        (0o400, 'r'),
        (0o200, 'w'),
        (0o100, 'x'),
        (0o040, 'r'),
        (0o020, 'w'),
        (0o010, 'x'),
        (0o004, 'r'),
        (0o002, 'w'),
        (0o001, 'x'),
    ];
    for (bit, ch) in flags {
        s.push(if mode & bit != 0 { ch } else { '-' });
    }
    s
}

pub fn join_remote_path(base: &str, name: &str) -> String {
    if base.is_empty() || base == "/" {
        format!("/{}", name.trim_start_matches('/'))
    } else {
        format!(
            "{}/{}",
            base.trim_end_matches('/'),
            name.trim_start_matches('/')
        )
    }
}

pub fn sort_entries(entries: &mut [FileEntry]) {
    entries.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
}
