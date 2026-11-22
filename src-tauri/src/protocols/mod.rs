pub mod ftp;
pub mod sftp;
pub mod ssh_terminal;

use async_trait::async_trait;
use chrono::Utc;
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex as AsyncMutex;
use zeroize::{Zeroize, ZeroizeOnDrop};

use crate::error::AppResult;
use crate::models::{AuthType, FileEntry, LogLevel, Protocol, SessionLogEvent};

pub struct BandwidthLimiter {
    limit_kbps: AtomicU64,
    bucket: AsyncMutex<(Instant, f64)>,
}

impl BandwidthLimiter {
    pub fn new(limit_kbps: u64) -> Self {
        Self {
            limit_kbps: AtomicU64::new(limit_kbps),
            bucket: AsyncMutex::new((Instant::now(), 0.0)),
        }
    }

    pub fn set_limit_kbps(&self, limit_kbps: u64) {
        self.limit_kbps.store(limit_kbps, Ordering::Relaxed);
    }

    pub async fn acquire(&self, bytes: usize) {
        let kbps = self.limit_kbps.load(Ordering::Relaxed);
        if kbps == 0 || bytes == 0 {
            return;
        }
        let rate_bps = (kbps as f64) * 1024.0;
        let sleep_dur = {
            let mut state = self.bucket.lock().await;
            let now = Instant::now();
            let elapsed = now.duration_since(state.0).as_secs_f64();
            state.0 = now;
            // Refill up to 1 second burst
            state.1 = (state.1 + elapsed * rate_bps).min(rate_bps);
            state.1 -= bytes as f64;
            if state.1 < 0.0 {
                let wait_secs = (-state.1) / rate_bps;
                Some(Duration::from_secs_f64(wait_secs))
            } else {
                None
            }
        };
        if let Some(dur) = sleep_dur {
            tokio::time::sleep(dur).await;
        }
    }
}

#[derive(Debug, Clone)]
pub struct ExistingFileInfo {
    pub size: u64,
    pub modified_epoch: Option<i64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TransferOutcome {
    Completed(u64),
    Paused(u64),
    Cancelled,
}

#[derive(Clone)]
pub struct TransferControl {
    pub cancel_flag: Arc<AtomicBool>,
    pub pause_flag: Arc<AtomicBool>,
    pub limiter: Arc<BandwidthLimiter>,
    pub on_progress: Arc<dyn Fn(u64) + Send + Sync>,
}

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
    async fn exists_info(&mut self, path: &str) -> AppResult<Option<ExistingFileInfo>>;
    async fn upload_file(
        &mut self,
        local_path: &Path,
        remote_path: &str,
        offset: u64,
        control: TransferControl,
    ) -> AppResult<TransferOutcome>;
    async fn download_file(
        &mut self,
        remote_path: &str,
        local_path: &Path,
        offset: u64,
        control: TransferControl,
    ) -> AppResult<TransferOutcome>;
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
