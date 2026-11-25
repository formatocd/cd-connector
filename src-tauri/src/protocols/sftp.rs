use async_trait::async_trait;
use chrono::{DateTime, Utc};
use russh::client::{self, Config, Handle};
use russh::keys::{decode_secret_key, HashAlg, PrivateKeyWithHashAlg, PublicKeyOrCertificate};
use russh::Disconnect;
use russh_sftp::client::SftpSession;
use russh_sftp::protocol::{FileAttributes, OpenFlags};
use std::io::SeekFrom;
use std::path::Path;
use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex};
use std::time::{Duration, UNIX_EPOCH};
use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt};

use crate::error::{AppError, AppResult};
use crate::models::{AuthType, FileEntry, HostKeyPromptInfo, KnownHost};
use crate::protocols::{
    format_posix_permissions, join_remote_path, sort_entries, ExistingFileInfo,
    FileTransferClient, LogEmitter, ResolvedAuth, TransferControl, TransferOutcome,
};

pub enum SftpConnectOutcome {
    Connected {
        client: SftpClient,
        newly_trusted_key: Option<(String, String)>,
    },
    HostKeyPrompt(HostKeyPromptInfo),
}

struct SftpHandler {
    host: String,
    port: u16,
    known_hosts: Vec<KnownHost>,
    trust_host_key: bool,
    prompt_info: Arc<Mutex<Option<HostKeyPromptInfo>>>,
    accepted_key: Arc<Mutex<Option<(String, String)>>>,
    logger: LogEmitter,
}

impl client::Handler for SftpHandler {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        server_public_key: &PublicKeyOrCertificate,
    ) -> Result<bool, Self::Error> {
        let (key_type, fingerprint) = match server_public_key {
            PublicKeyOrCertificate::PublicKey { key, .. } => (
                key.algorithm().to_string(),
                key.fingerprint(HashAlg::Sha256).to_string(),
            ),
            PublicKeyOrCertificate::Certificate(cert) => (
                cert.public_key().algorithm().to_string(),
                cert.public_key().fingerprint(HashAlg::Sha256).to_string(),
            ),
        };

        if let Some(existing) = self.known_hosts.iter().find(|kh| kh.key_type == key_type) {
            if existing.fingerprint == fingerprint {
                self.logger
                    .info(format!("Host key verified ({key_type}: {fingerprint})"));
                return Ok(true);
            }
            if self.trust_host_key {
                self.logger
                    .info(format!("Updated trusted host key ({key_type}: {fingerprint})"));
                if let Ok(mut guard) = self.accepted_key.lock() {
                    *guard = Some((key_type, fingerprint));
                }
                return Ok(true);
            }
            self.logger.error(format!(
                "Host key MISMATCH for {}:{} ({key_type})!",
                self.host, self.port
            ));
            if let Ok(mut guard) = self.prompt_info.lock() {
                *guard = Some(HostKeyPromptInfo {
                    host: self.host.clone(),
                    port: self.port,
                    key_type,
                    fingerprint,
                    mismatch: true,
                    previous_fingerprint: Some(existing.fingerprint.clone()),
                });
            }
            return Ok(false);
        }

        if self.trust_host_key {
            self.logger
                .info(format!("Trusted new host key ({key_type}: {fingerprint})"));
            if let Ok(mut guard) = self.accepted_key.lock() {
                *guard = Some((key_type, fingerprint));
            }
            return Ok(true);
        }

        self.logger.info(format!(
            "Unknown host key for {}:{} ({key_type}: {fingerprint}) — awaiting user confirmation",
            self.host, self.port
        ));
        if let Ok(mut guard) = self.prompt_info.lock() {
            *guard = Some(HostKeyPromptInfo {
                host: self.host.clone(),
                port: self.port,
                key_type,
                fingerprint,
                mismatch: false,
                previous_fingerprint: None,
            });
        }
        Ok(false)
    }
}

pub struct SftpClient {
    handle: Handle<SftpHandler>,
    sftp: SftpSession,
    logger: LogEmitter,
}

impl SftpClient {
    pub async fn connect(
        host: &str,
        port: u16,
        auth: &ResolvedAuth,
        known_hosts: Vec<KnownHost>,
        trust_host_key: bool,
        logger: LogEmitter,
    ) -> AppResult<SftpConnectOutcome> {
        let prompt_info = Arc::new(Mutex::new(None));
        let accepted_key = Arc::new(Mutex::new(None));

        let handler = SftpHandler {
            host: host.to_string(),
            port,
            known_hosts,
            trust_host_key,
            prompt_info: prompt_info.clone(),
            accepted_key: accepted_key.clone(),
            logger: logger.clone(),
        };

        let config = Config {
            inactivity_timeout: Some(Duration::from_secs(600)),
            keepalive_interval: Some(Duration::from_secs(30)),
            ..Default::default()
        };

        logger.info(format!("Connecting to {host}:{port} via SSH/SFTP..."));
        let connect_result = client::connect(Arc::new(config), (host, port), handler).await;

        let mut handle = match connect_result {
            Ok(h) => h,
            Err(e) => {
                if let Ok(mut guard) = prompt_info.lock() {
                    if let Some(info) = guard.take() {
                        return Ok(SftpConnectOutcome::HostKeyPrompt(info));
                    }
                }
                logger.error(format!("SSH connection failed: {e}"));
                return Err(AppError::Protocol(format!("SSH connection failed: {e}")));
            }
        };

        // Authenticate
        match auth.auth_type {
            AuthType::Password => {
                let password = auth.password.as_deref().unwrap_or("");
                logger.info(format!(
                    "Authenticating user '{}' with password...",
                    auth.username
                ));
                let res = handle
                    .authenticate_password(&auth.username, password)
                    .await
                    .map_err(|e| {
                        logger.error(format!("SSH password auth error: {e}"));
                        AppError::AuthFailed(e.to_string())
                    })?;
                if !res.success() {
                    logger.error("SSH password authentication rejected");
                    return Err(AppError::AuthFailed(
                        "Invalid username or password".into(),
                    ));
                }
            }
            AuthType::SshKey => {
                let key_pem = auth.private_key.as_deref().ok_or_else(|| {
                    AppError::AuthFailed("No SSH private key configured".into())
                })?;
                logger.info(format!(
                    "Authenticating user '{}' with SSH private key...",
                    auth.username
                ));
                let secret_key = decode_secret_key(key_pem, auth.passphrase.as_deref())
                    .map_err(|e| {
                        logger.error(format!("Failed to decode SSH private key: {e}"));
                        AppError::AuthFailed(format!("Invalid SSH key or passphrase: {e}"))
                    })?;
                let hash_alg = handle
                    .best_supported_rsa_hash()
                    .await
                    .ok()
                    .flatten()
                    .flatten();
                let key_with_hash = PrivateKeyWithHashAlg::new(Arc::new(secret_key), hash_alg);
                let res = handle
                    .authenticate_publickey(&auth.username, key_with_hash)
                    .await
                    .map_err(|e| {
                        logger.error(format!("SSH key auth error: {e}"));
                        AppError::AuthFailed(e.to_string())
                    })?;
                if !res.success() {
                    logger.error("SSH public key authentication rejected");
                    return Err(AppError::AuthFailed(
                        "SSH public key was rejected by server".into(),
                    ));
                }
            }
            AuthType::SshAgent => {
                logger.error("System SSH agent authentication is not yet available on this platform");
                return Err(AppError::AuthFailed(
                    "SSH Agent authentication requires an active agent; please use SSH Key or Password for now.".into(),
                ));
            }
            AuthType::TlsCert => {
                return Err(AppError::Validation(
                    "TLS client certificates are not applicable to SFTP".into(),
                ));
            }
        }

        logger.response("SSH authentication succeeded");
        logger.info("Opening SFTP subsystem...");

        let channel = handle.channel_open_session().await.map_err(|e| {
            logger.error(format!("Failed to open SSH channel: {e}"));
            AppError::Protocol(e.to_string())
        })?;
        channel.request_subsystem(true, "sftp").await.map_err(|e| {
            logger.error(format!("Failed to request SFTP subsystem: {e}"));
            AppError::Protocol(e.to_string())
        })?;

        let sftp = SftpSession::new(channel.into_stream()).await.map_err(|e| {
            logger.error(format!("SFTP session init failed: {e}"));
            AppError::Protocol(e.to_string())
        })?;

        logger.response("SFTP subsystem ready");

        let newly_trusted_key = accepted_key.lock().ok().and_then(|mut g| g.take());
        Ok(SftpConnectOutcome::Connected {
            client: Self {
                handle,
                sftp,
                logger,
            },
            newly_trusted_key,
        })
    }
}

fn sftp_attrs_to_entry(name: String, path: String, attrs: &FileAttributes) -> FileEntry {
    let is_dir = attrs.is_dir();
    let is_symlink = attrs.is_symlink();
    let mode = attrs.permissions;
    let permissions = mode.map(|m| format_posix_permissions(m, is_dir, is_symlink));
    let modified = attrs.mtime.map(|secs| {
        let dt: DateTime<Utc> = (UNIX_EPOCH + Duration::from_secs(secs as u64)).into();
        dt.to_rfc3339()
    });
    let owner = match (attrs.uid, attrs.gid) {
        (Some(u), Some(g)) => Some(format!("{u}:{g}")),
        (Some(u), None) => Some(u.to_string()),
        _ => None,
    };

    FileEntry {
        name,
        path,
        is_dir,
        is_symlink,
        size: attrs.size.unwrap_or(0),
        modified,
        permissions,
        mode: mode.map(|m| m & 0o7777),
        owner,
    }
}

#[async_trait]
impl FileTransferClient for SftpClient {
    async fn pwd(&mut self) -> AppResult<String> {
        let dir = self.sftp.canonicalize(".").await.map_err(|e| {
            self.logger.error(format!("SFTP canonicalize error: {e}"));
            AppError::Protocol(e.to_string())
        })?;
        self.logger.info(format!("Remote directory: {dir}"));
        Ok(dir)
    }

    async fn list_dir(&mut self, path: &str) -> AppResult<Vec<FileEntry>> {
        let target = if path.is_empty() { "." } else { path };
        self.logger.info(format!("SFTP readdir: {target}"));
        let read_dir = self.sftp.read_dir(target).await.map_err(|e| {
            self.logger.error(format!("SFTP readdir error: {e}"));
            AppError::Protocol(e.to_string())
        })?;

        let mut entries = Vec::new();
        for entry in read_dir {
            let name = entry.file_name();
            if name == "." || name == ".." {
                continue;
            }
            let full_path = join_remote_path(target, &name);
            let attrs = entry.metadata();
            entries.push(sftp_attrs_to_entry(name, full_path, &attrs));
        }
        sort_entries(&mut entries);
        self.logger
            .response(format!("Listed {} entries in {target}", entries.len()));
        Ok(entries)
    }

    async fn mkdir(&mut self, path: &str) -> AppResult<()> {
        self.logger.info(format!("SFTP mkdir: {path}"));
        self.sftp.create_dir(path).await.map_err(|e| {
            self.logger.error(format!("SFTP mkdir error: {e}"));
            AppError::Protocol(e.to_string())
        })?;
        self.logger.response(format!("Created directory {path}"));
        Ok(())
    }

    async fn rename(&mut self, from: &str, to: &str) -> AppResult<()> {
        self.logger.info(format!("SFTP rename: {from} -> {to}"));
        self.sftp.rename(from, to).await.map_err(|e| {
            self.logger.error(format!("SFTP rename error: {e}"));
            AppError::Protocol(e.to_string())
        })?;
        self.logger.response(format!("Renamed to {to}"));
        Ok(())
    }

    async fn delete_file(&mut self, path: &str) -> AppResult<()> {
        self.logger.info(format!("SFTP remove file: {path}"));
        self.sftp.remove_file(path).await.map_err(|e| {
            self.logger.error(format!("SFTP remove_file error: {e}"));
            AppError::Protocol(e.to_string())
        })?;
        self.logger.response(format!("Deleted {path}"));
        Ok(())
    }

    async fn delete_dir(&mut self, path: &str) -> AppResult<()> {
        self.logger.info(format!("SFTP remove dir: {path}"));
        self.sftp.remove_dir(path).await.map_err(|e| {
            self.logger.error(format!("SFTP remove_dir error: {e}"));
            AppError::Protocol(e.to_string())
        })?;
        self.logger.response(format!("Removed directory {path}"));
        Ok(())
    }

    async fn chmod(&mut self, path: &str, mode: u32) -> AppResult<()> {
        self.logger
            .info(format!("SFTP chmod {:o} {}", mode, path));
        let mut attrs = self.sftp.metadata(path).await.map_err(|e| {
            self.logger.error(format!("SFTP stat error: {e}"));
            AppError::Protocol(e.to_string())
        })?;
        attrs.permissions = Some(mode);
        self.sftp.set_metadata(path, attrs).await.map_err(|e| {
            self.logger.error(format!("SFTP setstat error: {e}"));
            AppError::Protocol(e.to_string())
        })?;
        self.logger
            .response(format!("Updated permissions to {:o}", mode));
        Ok(())
    }

    async fn stat(&mut self, path: &str) -> AppResult<FileEntry> {
        let attrs = self.sftp.metadata(path).await.map_err(|e| {
            self.logger.error(format!("SFTP stat error: {e}"));
            AppError::Protocol(e.to_string())
        })?;
        let name = path
            .trim_end_matches('/')
            .rsplit('/')
            .next()
            .unwrap_or(path)
            .to_string();
        Ok(sftp_attrs_to_entry(name, path.to_string(), &attrs))
    }

    async fn exists_info(&mut self, path: &str) -> AppResult<Option<ExistingFileInfo>> {
        match self.sftp.metadata(path).await {
            Ok(attrs) => Ok(Some(ExistingFileInfo {
                size: attrs.size.unwrap_or(0),
                modified_epoch: attrs.mtime.map(|m| m as i64),
            })),
            Err(_) => Ok(None),
        }
    }

    async fn upload_file(
        &mut self,
        local_path: &Path,
        remote_path: &str,
        offset: u64,
        control: TransferControl,
    ) -> AppResult<TransferOutcome> {
        self.logger.info(format!("SFTP upload: {remote_path}"));
        let mut local_file = tokio::fs::File::open(local_path).await?;
        if offset > 0 {
            local_file.seek(SeekFrom::Start(offset)).await?;
        }

        let flags = if offset == 0 {
            OpenFlags::CREATE | OpenFlags::TRUNCATE | OpenFlags::WRITE
        } else {
            OpenFlags::CREATE | OpenFlags::WRITE
        };
        let mut remote_file = self
            .sftp
            .open_with_flags(remote_path, flags)
            .await
            .map_err(|e| {
                self.logger.error(format!("SFTP open remote error: {e}"));
                AppError::Protocol(e.to_string())
            })?;
        if offset > 0 {
            remote_file.seek(SeekFrom::Start(offset)).await?;
        }

        let mut buf = vec![0u8; 64 * 1024];
        let mut transferred = offset;
        (control.on_progress)(transferred);

        loop {
            if control.cancel_flag.load(Ordering::Relaxed) {
                self.logger.info(format!("Upload cancelled: {remote_path}"));
                return Ok(TransferOutcome::Cancelled);
            }
            if control.pause_flag.load(Ordering::Relaxed) {
                let _ = remote_file.flush().await;
                self.logger
                    .info(format!("Upload paused at {transferred} bytes: {remote_path}"));
                return Ok(TransferOutcome::Paused(transferred));
            }

            let n = local_file.read(&mut buf).await?;
            if n == 0 {
                break;
            }
            control.limiter.acquire(n).await;
            remote_file.write_all(&buf[..n]).await?;
            transferred += n as u64;
            (control.on_progress)(transferred);
        }

        remote_file.flush().await?;
        self.logger
            .response(format!("Upload complete: {remote_path} ({transferred} bytes)"));
        Ok(TransferOutcome::Completed(transferred))
    }

    async fn download_file(
        &mut self,
        remote_path: &str,
        local_path: &Path,
        offset: u64,
        control: TransferControl,
    ) -> AppResult<TransferOutcome> {
        self.logger.info(format!("SFTP download: {remote_path}"));
        let mut remote_file = self
            .sftp
            .open_with_flags(remote_path, OpenFlags::READ)
            .await
            .map_err(|e| {
                self.logger.error(format!("SFTP open remote error: {e}"));
                AppError::Protocol(e.to_string())
            })?;
        if offset > 0 {
            remote_file.seek(SeekFrom::Start(offset)).await?;
        }

        if let Some(parent) = local_path.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }
        let mut local_file = tokio::fs::OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(offset == 0)
            .open(local_path)
            .await?;
        if offset > 0 {
            local_file.seek(SeekFrom::Start(offset)).await?;
        }

        let mut buf = vec![0u8; 64 * 1024];
        let mut transferred = offset;
        (control.on_progress)(transferred);

        loop {
            if control.cancel_flag.load(Ordering::Relaxed) {
                self.logger.info(format!("Download cancelled: {remote_path}"));
                return Ok(TransferOutcome::Cancelled);
            }
            if control.pause_flag.load(Ordering::Relaxed) {
                let _ = local_file.flush().await;
                self.logger
                    .info(format!("Download paused at {transferred} bytes: {remote_path}"));
                return Ok(TransferOutcome::Paused(transferred));
            }

            let n = remote_file.read(&mut buf).await?;
            if n == 0 {
                break;
            }
            control.limiter.acquire(n).await;
            local_file.write_all(&buf[..n]).await?;
            transferred += n as u64;
            (control.on_progress)(transferred);
        }

        local_file.flush().await?;
        self.logger
            .response(format!("Download complete: {remote_path} ({transferred} bytes)"));
        Ok(TransferOutcome::Completed(transferred))
    }

    async fn send_raw_command(&mut self, _command: &str) -> AppResult<String> {
        Err(AppError::Validation(
            "Raw FTP commands are not supported on SFTP sessions (SFTP is a binary protocol over SSH).".into(),
        ))
    }

    async fn disconnect(&mut self) -> AppResult<()> {
        self.logger.info("Closing SFTP session...");
        let _ = self.sftp.close().await;
        let _ = self
            .handle
            .disconnect(Disconnect::ByApplication, "User disconnected", "en")
            .await;
        self.logger.info("Disconnected");
        Ok(())
    }
}
