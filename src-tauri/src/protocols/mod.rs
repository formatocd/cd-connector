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
use crate::models::{AuthType, FileEntry, HostKeyPromptInfo, KnownHost, LogLevel, SessionLogEvent};

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

/// Returns true if `name` is a single normal path component without traversal or separators.
pub fn is_safe_remote_entry_name(name: &str) -> bool {
    let trimmed = name.trim();
    if trimmed.is_empty()
        || trimmed == "."
        || trimmed == ".."
        || name.contains('/')
        || name.contains('\\')
        || name.contains('\0')
    {
        return false;
    }
    let mut components = Path::new(name).components();
    matches!(
        (components.next(), components.next()),
        (Some(std::path::Component::Normal(_)), None)
    )
}

pub enum HostKeyDecision {
    Verified,
    TrustedNew,
    Prompt(HostKeyPromptInfo),
}

/// Evaluates an SSH server host key against `known_hosts` and an optional user-approved fingerprint.
/// - Prevents TOCTOU by only trusting when `expected_fingerprint == Some(fingerprint)`.
/// - Prevents key-type confusion by flagging `mismatch: true` if any other key is recorded for `(host, port)`.
pub fn evaluate_ssh_host_key(
    host: &str,
    port: u16,
    known_hosts: &[KnownHost],
    key_type: &str,
    fingerprint: &str,
    expected_fingerprint: Option<&str>,
) -> HostKeyDecision {
    if known_hosts
        .iter()
        .any(|kh| kh.key_type == key_type && kh.fingerprint == fingerprint)
    {
        return HostKeyDecision::Verified;
    }

    if let Some(expected) = expected_fingerprint {
        if expected == fingerprint {
            return HostKeyDecision::TrustedNew;
        }
    }

    let previous = known_hosts
        .iter()
        .find(|kh| kh.key_type == key_type)
        .or_else(|| known_hosts.first());

    HostKeyDecision::Prompt(HostKeyPromptInfo {
        host: host.to_string(),
        port,
        key_type: key_type.to_string(),
        fingerprint: fingerprint.to_string(),
        mismatch: previous.is_some(),
        previous_fingerprint: previous.map(|kh| kh.fingerprint.clone()),
    })
}

pub fn sort_entries(entries: &mut [FileEntry]) {
    entries.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn join_remote_path_normalizes_slashes() {
        assert_eq!(join_remote_path("/", "file.txt"), "/file.txt");
        assert_eq!(join_remote_path("", "/file.txt"), "/file.txt");
        assert_eq!(join_remote_path("/var/www/", "/index.html"), "/var/www/index.html");
    }

    #[test]
    fn format_posix_permissions_formats_type_and_bits() {
        assert_eq!(format_posix_permissions(0o755, true, false), "drwxr-xr-x");
        assert_eq!(format_posix_permissions(0o644, false, false), "-rw-r--r--");
        assert_eq!(format_posix_permissions(0o777, false, true), "lrwxrwxrwx");
    }

    #[test]
    fn evaluate_ssh_host_key_blocks_toctou_and_key_type_confusion() {
        let kh = vec![KnownHost {
            id: "1".into(),
            host: "example.com".into(),
            port: 22,
            key_type: "ssh-ed25519".into(),
            fingerprint: "SHA256:good".into(),
            first_seen_at: "2026-01-01T00:00:00Z".into(),
        }];

        // Exact match -> Verified
        assert!(matches!(
            evaluate_ssh_host_key("example.com", 22, &kh, "ssh-ed25519", "SHA256:good", None),
            HostKeyDecision::Verified
        ));

        // Different key type for same host -> Mismatch prompt (not unknown host)
        match evaluate_ssh_host_key("example.com", 22, &kh, "ssh-rsa", "SHA256:other", None) {
            HostKeyDecision::Prompt(info) => {
                assert!(info.mismatch);
                assert_eq!(info.previous_fingerprint.as_deref(), Some("SHA256:good"));
            }
            _ => panic!("expected mismatch prompt"),
        }

        // TOCTOU: user approved SHA256:approved, attacker swaps SHA256:evil -> must prompt again
        assert!(matches!(
            evaluate_ssh_host_key(
                "example.com",
                22,
                &[],
                "ssh-ed25519",
                "SHA256:evil",
                Some("SHA256:approved")
            ),
            HostKeyDecision::Prompt(_)
        ));

        // Exact approved fingerprint -> TrustedNew
        assert!(matches!(
            evaluate_ssh_host_key(
                "example.com",
                22,
                &[],
                "ssh-ed25519",
                "SHA256:approved",
                Some("SHA256:approved")
            ),
            HostKeyDecision::TrustedNew
        ));
    }
}
