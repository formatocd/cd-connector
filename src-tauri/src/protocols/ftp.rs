use async_trait::async_trait;
use rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
use rustls::pki_types::{CertificateDer, ServerName, UnixTime};
use rustls::{ClientConfig, DigitallySignedStruct, RootCertStore, SignatureScheme};
use std::io::SeekFrom;
use std::path::Path;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use suppaftp::tokio::{AsyncRustlsConnector, AsyncRustlsFtpStream};
use suppaftp::types::{FileType, Mode};
use suppaftp::{FtpError, Status};
use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt};

use crate::error::{AppError, AppResult};
use crate::models::{FileEntry, Protocol};
use crate::protocols::{
    join_remote_path, sort_entries, ExistingFileInfo, FileTransferClient, LogEmitter, ResolvedAuth,
    TransferControl, TransferOutcome,
};

#[derive(Debug)]
struct DangerousServerCertVerifier;

impl ServerCertVerifier for DangerousServerCertVerifier {
    fn verify_server_cert(
        &self,
        _end_entity: &CertificateDer<'_>,
        _intermediates: &[CertificateDer<'_>],
        _server_name: &ServerName<'_>,
        _ocsp_response: &[u8],
        _now: UnixTime,
    ) -> Result<ServerCertVerified, rustls::Error> {
        Ok(ServerCertVerified::assertion())
    }

    fn verify_tls12_signature(
        &self,
        _message: &[u8],
        _cert: &CertificateDer<'_>,
        _dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        Ok(HandshakeSignatureValid::assertion())
    }

    fn verify_tls13_signature(
        &self,
        _message: &[u8],
        _cert: &CertificateDer<'_>,
        _dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        Ok(HandshakeSignatureValid::assertion())
    }

    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        vec![
            SignatureScheme::RSA_PKCS1_SHA256,
            SignatureScheme::RSA_PKCS1_SHA384,
            SignatureScheme::RSA_PKCS1_SHA512,
            SignatureScheme::ECDSA_NISTP256_SHA256,
            SignatureScheme::ECDSA_NISTP384_SHA384,
            SignatureScheme::ECDSA_NISTP521_SHA512,
            SignatureScheme::RSA_PSS_SHA256,
            SignatureScheme::RSA_PSS_SHA384,
            SignatureScheme::RSA_PSS_SHA512,
            SignatureScheme::ED25519,
        ]
    }
}

fn build_tls_connector(accept_invalid_certs: bool) -> AppResult<AsyncRustlsConnector> {
    let provider = Arc::new(rustls::crypto::ring::default_provider());
    let config = if accept_invalid_certs {
        ClientConfig::builder_with_provider(provider)
            .with_safe_default_protocol_versions()
            .map_err(|e| AppError::Protocol(format!("TLS config error: {e}")))?
            .dangerous()
            .with_custom_certificate_verifier(Arc::new(DangerousServerCertVerifier))
            .with_no_client_auth()
    } else {
        let root_store = RootCertStore::from_iter(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
        ClientConfig::builder_with_provider(provider)
            .with_safe_default_protocol_versions()
            .map_err(|e| AppError::Protocol(format!("TLS config error: {e}")))?
            .with_root_certificates(root_store)
            .with_no_client_auth()
    };
    Ok(AsyncRustlsConnector::from(
        tokio_rustls::TlsConnector::from(Arc::new(config)),
    ))
}

pub struct FtpClient {
    stream: AsyncRustlsFtpStream,
    logger: LogEmitter,
}

impl FtpClient {
    pub async fn connect(
        protocol: Protocol,
        host: &str,
        port: u16,
        auth: &ResolvedAuth,
        passive_mode: bool,
        accept_invalid_certs: bool,
        logger: LogEmitter,
    ) -> AppResult<Self> {
        let addr = format!("{host}:{port}");
        logger.info(format!("Connecting to {addr} ({})...", protocol.as_str()));

        let mut stream = match protocol {
            Protocol::Ftp => AsyncRustlsFtpStream::connect(&addr)
                .await
                .map_err(|e| {
                    logger.error(format!("Connection failed: {e}"));
                    AppError::Protocol(e.to_string())
                })?,
            Protocol::FtpsExplicit => {
                let plain = AsyncRustlsFtpStream::connect(&addr).await.map_err(|e| {
                    logger.error(format!("Connection failed: {e}"));
                    AppError::Protocol(e.to_string())
                })?;
                if accept_invalid_certs {
                    logger.info("TLS certificate verification disabled for this session");
                }
                logger.command("AUTH TLS");
                let connector = build_tls_connector(accept_invalid_certs)?;
                plain.into_secure(connector, host).await.map_err(|e| {
                    logger.error(format!("FTPS Explicit handshake failed: {e}"));
                    AppError::Protocol(e.to_string())
                })?
            }
            Protocol::FtpsImplicit => {
                if accept_invalid_certs {
                    logger.info("TLS certificate verification disabled for this session");
                }
                let connector = build_tls_connector(accept_invalid_certs)?;
                AsyncRustlsFtpStream::connect_secure_implicit(&addr, connector, host)
                    .await
                    .map_err(|e| {
                        logger.error(format!("FTPS Implicit handshake failed: {e}"));
                        AppError::Protocol(e.to_string())
                    })?
            }
            _ => {
                return Err(AppError::Protocol(
                    "Invalid protocol for FTP client".into(),
                ));
            }
        };

        logger.response("220 Connected to FTP server");

        stream.set_mode(if passive_mode {
            Mode::Passive
        } else {
            Mode::Active
        });
        logger.info(format!(
            "Transfer mode: {}",
            if passive_mode { "Passive (PASV)" } else { "Active (PORT)" }
        ));

        let user = if auth.username.is_empty() {
            "anonymous"
        } else {
            &auth.username
        };
        let pass = auth.password.as_deref().unwrap_or("");
        logger.command(format!("USER {user}"));
        logger.command("PASS ********");
        stream.login(user, pass).await.map_err(|e| {
            logger.error(format!("Login failed: {e}"));
            AppError::AuthFailed(e.to_string())
        })?;
        logger.response("230 User logged in");

        Ok(Self {
            stream,
            logger,
        })
    }
}

#[async_trait]
impl FileTransferClient for FtpClient {
    async fn pwd(&mut self) -> AppResult<String> {
        self.logger.command("PWD");
        let dir = self.stream.pwd().await.map_err(|e| {
            self.logger.error(format!("PWD error: {e}"));
            AppError::Protocol(e.to_string())
        })?;
        self.logger.response(format!("257 \"{dir}\""));
        Ok(dir)
    }

    async fn list_dir(&mut self, path: &str) -> AppResult<Vec<FileEntry>> {
        let target = if path.is_empty() { "/" } else { path };
        self.logger.command(format!("CWD {target}"));
        self.stream.cwd(target).await.map_err(|e| {
            self.logger.error(format!("CWD error: {e}"));
            AppError::Protocol(e.to_string())
        })?;
        self.logger.command("LIST");
        let lines = self.stream.list(None).await.map_err(|e| {
            self.logger.error(format!("LIST error: {e}"));
            AppError::Protocol(e.to_string())
        })?;
        self.logger
            .response(format!("226 Directory listing complete ({} entries)", lines.len()));

        let mut entries: Vec<FileEntry> = lines
            .iter()
            .filter_map(|line| parse_ftp_list_line(line, target))
            .collect();
        sort_entries(&mut entries);
        Ok(entries)
    }

    async fn mkdir(&mut self, path: &str) -> AppResult<()> {
        self.logger.command(format!("MKD {path}"));
        self.stream.mkdir(path).await.map_err(|e| {
            self.logger.error(format!("MKD error: {e}"));
            AppError::Protocol(e.to_string())
        })?;
        self.logger.response(format!("257 \"{path}\" created"));
        Ok(())
    }

    async fn rename(&mut self, from: &str, to: &str) -> AppResult<()> {
        self.logger.command(format!("RNFR {from}"));
        self.logger.command(format!("RNTO {to}"));
        self.stream.rename(from, to).await.map_err(|e| {
            self.logger.error(format!("Rename error: {e}"));
            AppError::Protocol(e.to_string())
        })?;
        self.logger.response("250 Rename successful");
        Ok(())
    }

    async fn delete_file(&mut self, path: &str) -> AppResult<()> {
        self.logger.command(format!("DELE {path}"));
        self.stream.rm(path).await.map_err(|e| {
            self.logger.error(format!("DELE error: {e}"));
            AppError::Protocol(e.to_string())
        })?;
        self.logger.response("250 File deleted");
        Ok(())
    }

    async fn delete_dir(&mut self, path: &str) -> AppResult<()> {
        self.logger.command(format!("RMD {path}"));
        self.stream.rmdir(path).await.map_err(|e| {
            self.logger.error(format!("RMD error: {e}"));
            AppError::Protocol(e.to_string())
        })?;
        self.logger.response("250 Directory removed");
        Ok(())
    }

    async fn chmod(&mut self, path: &str, mode: u32) -> AppResult<()> {
        let cmd = format!("CHMOD {:o} {}", mode, path);
        self.logger.command(format!("SITE {cmd}"));
        let resp = self.stream.site(&cmd).await.map_err(|e| {
            self.logger.error(format!("SITE CHMOD error: {e}"));
            AppError::Protocol(e.to_string())
        })?;
        self.logger.response(format!(
            "{} {}",
            resp.status.code(),
            String::from_utf8_lossy(&resp.body).trim()
        ));
        Ok(())
    }

    async fn stat(&mut self, path: &str) -> AppResult<FileEntry> {
        let size = self.stream.size(path).await.unwrap_or(0) as u64;
        let modified = self
            .stream
            .mdtm(path)
            .await
            .ok()
            .map(|dt| dt.format("%Y-%m-%dT%H:%M:%SZ").to_string());
        let name = path
            .trim_end_matches('/')
            .rsplit('/')
            .next()
            .unwrap_or(path)
            .to_string();
        Ok(FileEntry {
            name,
            path: path.to_string(),
            is_dir: false,
            is_symlink: false,
            size,
            modified,
            permissions: None,
            mode: None,
            owner: None,
        })
    }

    async fn exists_info(&mut self, path: &str) -> AppResult<Option<ExistingFileInfo>> {
        let _ = self.stream.transfer_type(FileType::Binary).await;
        match self.stream.size(path).await {
            Ok(size) => {
                let modified_epoch = self
                    .stream
                    .mdtm(path)
                    .await
                    .ok()
                    .map(|dt| dt.and_utc().timestamp());
                Ok(Some(ExistingFileInfo {
                    size: size as u64,
                    modified_epoch,
                }))
            }
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
        self.stream
            .transfer_type(FileType::Binary)
            .await
            .map_err(|e| AppError::Protocol(e.to_string()))?;

        let mut effective_offset = offset;
        if offset > 0 {
            self.logger.command(format!("REST {offset}"));
            if self.stream.resume_transfer(offset as usize).await.is_err() {
                self.logger
                    .info("Server rejected REST; restarting upload from byte 0");
                effective_offset = 0;
            }
        }

        let mut local_file = tokio::fs::File::open(local_path).await?;
        if effective_offset > 0 {
            local_file.seek(SeekFrom::Start(effective_offset)).await?;
        }

        self.logger.command(format!("STOR {remote_path}"));
        let mut data_stream = self
            .stream
            .put_with_stream(remote_path)
            .await
            .map_err(|e| {
                self.logger.error(format!("STOR error: {e}"));
                AppError::Protocol(e.to_string())
            })?;

        let mut buf = vec![0u8; 64 * 1024];
        let mut transferred = effective_offset;
        (control.on_progress)(transferred);

        loop {
            if control.cancel_flag.load(Ordering::Relaxed) {
                drop(data_stream);
                self.logger.info(format!("Upload cancelled: {remote_path}"));
                return Ok(TransferOutcome::Cancelled);
            }
            if control.pause_flag.load(Ordering::Relaxed) {
                drop(data_stream);
                self.logger
                    .info(format!("Upload paused at {transferred} bytes: {remote_path}"));
                return Ok(TransferOutcome::Paused(transferred));
            }

            let n = local_file.read(&mut buf).await?;
            if n == 0 {
                break;
            }
            control.limiter.acquire(n).await;
            data_stream.write_all(&buf[..n]).await?;
            transferred += n as u64;
            (control.on_progress)(transferred);
        }

        data_stream.finish().await.map_err(|e| {
            self.logger.error(format!("Upload finalize error: {e}"));
            AppError::Protocol(e.to_string())
        })?;
        self.logger
            .response(format!("226 Upload complete: {remote_path} ({transferred} bytes)"));
        Ok(TransferOutcome::Completed(transferred))
    }

    async fn download_file(
        &mut self,
        remote_path: &str,
        local_path: &Path,
        offset: u64,
        control: TransferControl,
    ) -> AppResult<TransferOutcome> {
        self.stream
            .transfer_type(FileType::Binary)
            .await
            .map_err(|e| AppError::Protocol(e.to_string()))?;

        let mut effective_offset = offset;
        if offset > 0 {
            self.logger.command(format!("REST {offset}"));
            if self.stream.resume_transfer(offset as usize).await.is_err() {
                self.logger
                    .info("Server rejected REST; restarting download from byte 0");
                effective_offset = 0;
            }
        }

        if let Some(parent) = local_path.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }
        let mut local_file = tokio::fs::OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(effective_offset == 0)
            .open(local_path)
            .await?;
        if effective_offset > 0 {
            local_file.seek(SeekFrom::Start(effective_offset)).await?;
        }

        self.logger.command(format!("RETR {remote_path}"));
        let mut data_stream = self
            .stream
            .retr_as_stream(remote_path)
            .await
            .map_err(|e| {
                self.logger.error(format!("RETR error: {e}"));
                AppError::Protocol(e.to_string())
            })?;

        let mut buf = vec![0u8; 64 * 1024];
        let mut transferred = effective_offset;
        (control.on_progress)(transferred);

        loop {
            if control.cancel_flag.load(Ordering::Relaxed) {
                drop(data_stream);
                self.logger.info(format!("Download cancelled: {remote_path}"));
                return Ok(TransferOutcome::Cancelled);
            }
            if control.pause_flag.load(Ordering::Relaxed) {
                let _ = local_file.flush().await;
                drop(data_stream);
                self.logger
                    .info(format!("Download paused at {transferred} bytes: {remote_path}"));
                return Ok(TransferOutcome::Paused(transferred));
            }

            let n = data_stream.read(&mut buf).await?;
            if n == 0 {
                break;
            }
            control.limiter.acquire(n).await;
            local_file.write_all(&buf[..n]).await?;
            transferred += n as u64;
            (control.on_progress)(transferred);
        }

        local_file.flush().await?;
        data_stream.finish().await.map_err(|e| {
            self.logger.error(format!("Download finalize error: {e}"));
            AppError::Protocol(e.to_string())
        })?;
        self.logger
            .response(format!("226 Download complete: {remote_path} ({transferred} bytes)"));
        Ok(TransferOutcome::Completed(transferred))
    }

    async fn send_raw_command(&mut self, command: &str) -> AppResult<String> {
        let trimmed = command.trim();
        if trimmed.is_empty() {
            return Ok(String::new());
        }
        self.logger.command(trimmed);
        match self.stream.custom_command(trimmed, &[Status::CommandOk]).await {
            Ok(resp) => {
                let text = format!(
                    "{} {}",
                    resp.status.code(),
                    String::from_utf8_lossy(&resp.body).trim()
                );
                self.logger.response(&text);
                Ok(text)
            }
            Err(FtpError::UnexpectedResponse(resp)) => {
                let code = resp.status.code();
                let text = format!(
                    "{} {}",
                    code,
                    String::from_utf8_lossy(&resp.body).trim()
                );
                if code >= 400 {
                    self.logger.error(&text);
                } else {
                    self.logger.response(&text);
                }
                Ok(text)
            }
            Err(e) => {
                self.logger.error(format!("Command error: {e}"));
                Err(AppError::Protocol(e.to_string()))
            }
        }
    }

    async fn disconnect(&mut self) -> AppResult<()> {
        self.logger.command("QUIT");
        let _ = self.stream.quit().await;
        self.logger.info("Disconnected");
        Ok(())
    }
}

/// Parses standard Unix `ls -l` and DOS/IIS FTP LIST output lines.
fn parse_ftp_list_line(line: &str, parent_dir: &str) -> Option<FileEntry> {
    let trimmed = line.trim();
    if trimmed.is_empty() || trimmed.starts_with("total ") {
        return None;
    }

    // Unix format: drwxr-xr-x 2 user group 4096 Nov 21 20:00 filename
    if trimmed.len() >= 10
        && matches!(
            trimmed.as_bytes()[0],
            b'-' | b'd' | b'l' | b'c' | b'b' | b'p' | b's'
        )
    {
        let parts: Vec<&str> = trimmed.split_whitespace().collect();
        if parts.len() >= 9 {
            let perms = parts[0];
            let is_dir = perms.starts_with('d');
            let is_symlink = perms.starts_with('l');
            let owner = format!("{}:{}", parts[2], parts[3]);
            let size = parts[4].parse::<u64>().unwrap_or(0);
            let modified = format!("{} {} {}", parts[5], parts[6], parts[7]);

            // Reconstruct filename preserving spaces (take everything after the 8th whitespace-delimited field)
            let mut rest = trimmed;
            for _ in 0..8 {
                rest = rest.trim_start();
                if let Some(idx) = rest.find(char::is_whitespace) {
                    rest = &rest[idx..];
                }
            }
            let raw_name = rest.trim_start();
            let name = if is_symlink {
                raw_name.split(" -> ").next().unwrap_or(raw_name)
            } else {
                raw_name
            };
            if name == "." || name == ".." || name.is_empty() {
                return None;
            }
            let mode = parse_unix_perm_mode(perms);
            return Some(FileEntry {
                name: name.to_string(),
                path: join_remote_path(parent_dir, name),
                is_dir,
                is_symlink,
                size,
                modified: Some(modified),
                permissions: Some(perms.to_string()),
                mode,
                owner: Some(owner),
            });
        }
    }

    // DOS/IIS format: 11-21-26  08:15PM       <DIR>          foldername
    let parts: Vec<&str> = trimmed.split_whitespace().collect();
    if parts.len() >= 4 {
        let modified = format!("{} {}", parts[0], parts[1]);
        let is_dir = parts[2].eq_ignore_ascii_case("<DIR>");
        let size = if is_dir {
            0
        } else {
            parts[2].parse::<u64>().unwrap_or(0)
        };
        let name = parts[3..].join(" ");
        if name == "." || name == ".." || name.is_empty() {
            return None;
        }
        return Some(FileEntry {
            name: name.clone(),
            path: join_remote_path(parent_dir, &name),
            is_dir,
            is_symlink: false,
            size,
            modified: Some(modified),
            permissions: None,
            mode: None,
            owner: None,
        });
    }

    None
}

fn parse_unix_perm_mode(perms: &str) -> Option<u32> {
    let bytes = perms.as_bytes();
    if bytes.len() < 10 {
        return None;
    }
    let mut mode = 0u32;
    let map = [
        (1, b'r', 0o400),
        (2, b'w', 0o200),
        (3, b'x', 0o100),
        (4, b'r', 0o040),
        (5, b'w', 0o020),
        (6, b'x', 0o010),
        (7, b'r', 0o004),
        (8, b'w', 0o002),
        (9, b'x', 0o001),
    ];
    for (idx, expected, bit) in map {
        if bytes[idx] == expected {
            mode |= bit;
        }
    }
    Some(mode)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_ftp_list_line_handles_unix_and_dos_formats() {
        assert!(parse_ftp_list_line("total 12", "/").is_none());
        assert!(parse_ftp_list_line("drwxr-xr-x 2 root root 4096 Nov 21 20:00 .", "/").is_none());
        assert!(parse_ftp_list_line("drwxr-xr-x 2 root root 4096 Nov 21 20:00 ..", "/").is_none());

        let file = parse_ftp_list_line(
            "-rw-r--r-- 1 alice staff 1234 Nov 21 20:00 my report.txt",
            "/docs",
        )
        .unwrap();
        assert_eq!(file.name, "my report.txt");
        assert_eq!(file.path, "/docs/my report.txt");
        assert!(!file.is_dir);
        assert_eq!(file.size, 1234);
        assert_eq!(file.mode, Some(0o644));

        let link = parse_ftp_list_line(
            "lrwxrwxrwx 1 root root 11 Nov 21 20:00 current -> release-1.0",
            "/",
        )
        .unwrap();
        assert!(link.is_symlink);
        assert_eq!(link.name, "current");

        let dos_dir =
            parse_ftp_list_line("11-21-26  08:15PM       <DIR>          backups", "/").unwrap();
        assert!(dos_dir.is_dir);
        assert_eq!(dos_dir.name, "backups");
        assert_eq!(dos_dir.path, "/backups");
    }

    #[test]
    fn parse_unix_perm_mode_decodes_rwx_bits() {
        assert_eq!(parse_unix_perm_mode("drwxr-xr-x"), Some(0o755));
        assert_eq!(parse_unix_perm_mode("-rw-------"), Some(0o600));
        assert_eq!(parse_unix_perm_mode("short"), None);
    }
}
