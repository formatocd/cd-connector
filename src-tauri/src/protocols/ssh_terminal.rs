use base64::{engine::general_purpose::STANDARD as B64, Engine};
use russh::client::{self, Config};
use russh::keys::{decode_secret_key, HashAlg, PrivateKeyWithHashAlg, PublicKeyOrCertificate};
use russh::{ChannelMsg, Disconnect};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tokio::io::AsyncWriteExt;
use tokio::sync::mpsc::{self, UnboundedSender};
use tokio::sync::RwLock as AsyncRwLock;

use crate::error::{AppError, AppResult};
use crate::models::{AuthType, HostKeyPromptInfo, KnownHost, SshClosedEvent, SshDataEvent};
use crate::protocols::{evaluate_ssh_host_key, HostKeyDecision, ResolvedAuth};
use crate::state::SharedLogFile;

/// Builds a safe POSIX `cd` command for the initial SSH directory, rejecting control characters.
fn build_initial_cd_command(initial_dir: Option<&str>) -> Option<String> {
    let dir = initial_dir?.trim();
    if dir.is_empty() || dir == "/" {
        return None;
    }
    if dir.bytes().any(|b| b < 0x20 || b == 0x7f) {
        return None;
    }
    let escaped = dir.replace('\'', "'\\''");
    Some(format!("cd '{escaped}'\n"))
}

/// Strips ANSI escape sequences (CSI, OSC, and 2-byte ESC sequences) for clean plain-text logs.
fn strip_ansi_bytes(input: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(input.len());
    let mut i = 0;
    while i < input.len() {
        let b = input[i];
        if b == 0x1b {
            i += 1;
            if i >= input.len() {
                break;
            }
            match input[i] {
                b'[' => {
                    // CSI sequence: ESC [ ... final byte 0x40..=0x7E
                    i += 1;
                    while i < input.len() {
                        let c = input[i];
                        i += 1;
                        if (0x40..=0x7e).contains(&c) {
                            break;
                        }
                    }
                }
                b']' => {
                    // OSC sequence: ESC ] ... (BEL 0x07 or ST ESC \)
                    i += 1;
                    while i < input.len() {
                        if input[i] == 0x07 {
                            i += 1;
                            break;
                        }
                        if input[i] == 0x1b && i + 1 < input.len() && input[i + 1] == b'\\' {
                            i += 2;
                            break;
                        }
                        i += 1;
                    }
                }
                _ => {
                    // 2-byte escape sequence
                    i += 1;
                }
            }
        } else if b == b'\r' {
            // Normalize CRLF -> LF (skip CR if followed by LF or standalone carriage return)
            i += 1;
        } else {
            out.push(b);
            i += 1;
        }
    }
    out
}

async fn write_to_log_if_active(
    log_files: &Arc<AsyncRwLock<HashMap<String, SharedLogFile>>>,
    tab_id: &str,
    data: &[u8],
) {
    let file_opt = {
        let guard = log_files.read().await;
        guard.get(tab_id).cloned()
    };
    if let Some(file_arc) = file_opt {
        let cleaned = strip_ansi_bytes(data);
        if !cleaned.is_empty() {
            let mut f = file_arc.lock().await;
            let _ = f.write_all(&cleaned).await;
            let _ = f.flush().await;
        }
    }
}

pub enum SshCommand {
    Write(Vec<u8>),
    Resize { cols: u32, rows: u32 },
    Close { silent: bool },
}

pub struct SshTerminalHandle {
    pub tx: UnboundedSender<SshCommand>,
}

pub enum SshConnectOutcome {
    Connected {
        handle: SshTerminalHandle,
        newly_trusted_key: Option<(String, String)>,
    },
    HostKeyPrompt(HostKeyPromptInfo),
}

struct SshTermHandler {
    host: String,
    port: u16,
    known_hosts: Vec<KnownHost>,
    expected_fingerprint: Option<String>,
    prompt_info: Arc<Mutex<Option<HostKeyPromptInfo>>>,
    accepted_key: Arc<Mutex<Option<(String, String)>>>,
}

impl client::Handler for SshTermHandler {
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

        match evaluate_ssh_host_key(
            &self.host,
            self.port,
            &self.known_hosts,
            &key_type,
            &fingerprint,
            self.expected_fingerprint.as_deref(),
        ) {
            HostKeyDecision::Verified => Ok(true),
            HostKeyDecision::TrustedNew => {
                if let Ok(mut guard) = self.accepted_key.lock() {
                    *guard = Some((key_type, fingerprint));
                }
                Ok(true)
            }
            HostKeyDecision::Prompt(info) => {
                if let Ok(mut guard) = self.prompt_info.lock() {
                    *guard = Some(info);
                }
                Ok(false)
            }
        }
    }
}

pub async fn connect_ssh_terminal(
    app: AppHandle,
    tab_id: String,
    host: &str,
    port: u16,
    auth: &ResolvedAuth,
    known_hosts: Vec<KnownHost>,
    expected_fingerprint: Option<String>,
    cols: u32,
    rows: u32,
    initial_dir: Option<String>,
    ssh_terminals: Arc<AsyncRwLock<HashMap<String, SshTerminalHandle>>>,
    ssh_log_files: Arc<AsyncRwLock<HashMap<String, SharedLogFile>>>,
) -> AppResult<SshConnectOutcome> {
    let prompt_info = Arc::new(Mutex::new(None));
    let accepted_key = Arc::new(Mutex::new(None));

    let handler = SshTermHandler {
        host: host.to_string(),
        port,
        known_hosts,
        expected_fingerprint,
        prompt_info: prompt_info.clone(),
        accepted_key: accepted_key.clone(),
    };

    let config = Config {
        inactivity_timeout: Some(Duration::from_secs(600)),
        keepalive_interval: Some(Duration::from_secs(30)),
        ..Default::default()
    };

    let connect_result = tokio::time::timeout(
        Duration::from_secs(30),
        client::connect(Arc::new(config), (host, port), handler),
    )
    .await
    .map_err(|_| AppError::Protocol("SSH connection timed out after 30s".into()))?;
    let mut session = match connect_result {
        Ok(h) => h,
        Err(e) => {
            if let Ok(mut guard) = prompt_info.lock() {
                if let Some(info) = guard.take() {
                    return Ok(SshConnectOutcome::HostKeyPrompt(info));
                }
            }
            return Err(AppError::Protocol(format!("SSH connection failed: {e}")));
        }
    };

    match auth.auth_type {
        AuthType::Password => {
            let password = auth.password.as_deref().unwrap_or("");
            let res = session
                .authenticate_password(&auth.username, password)
                .await
                .map_err(|e| AppError::AuthFailed(e.to_string()))?;
            if !res.success() {
                return Err(AppError::AuthFailed("Invalid username or password".into()));
            }
        }
        AuthType::SshKey => {
            let key_pem = auth
                .private_key
                .as_deref()
                .ok_or_else(|| AppError::AuthFailed("No SSH private key configured".into()))?;
            let secret_key = decode_secret_key(key_pem, auth.passphrase.as_deref())
                .map_err(|e| AppError::AuthFailed(format!("Invalid SSH key or passphrase: {e}")))?;
            let hash_alg = session
                .best_supported_rsa_hash()
                .await
                .ok()
                .flatten()
                .flatten();
            let key_with_hash = PrivateKeyWithHashAlg::new(Arc::new(secret_key), hash_alg);
            let res = session
                .authenticate_publickey(&auth.username, key_with_hash)
                .await
                .map_err(|e| AppError::AuthFailed(e.to_string()))?;
            if !res.success() {
                return Err(AppError::AuthFailed(
                    "SSH public key was rejected by server".into(),
                ));
            }
        }
        AuthType::SshAgent => {
            return Err(AppError::AuthFailed(
                "SSH Agent authentication is not yet available; use SSH Key or Password.".into(),
            ));
        }
        AuthType::TlsCert => {
            return Err(AppError::Validation(
                "TLS client certificates are not applicable to SSH".into(),
            ));
        }
    }

    let mut channel = session
        .channel_open_session()
        .await
        .map_err(|e| AppError::Protocol(format!("Failed to open SSH channel: {e}")))?;

    channel
        .request_pty(false, "xterm-256color", cols.max(20), rows.max(5), 0, 0, &[])
        .await
        .map_err(|e| AppError::Protocol(format!("Failed to allocate PTY: {e}")))?;

    channel
        .request_shell(false)
        .await
        .map_err(|e| AppError::Protocol(format!("Failed to start remote shell: {e}")))?;

    // If launched from an SFTP tab with a specific remote directory, cd into it
    if let Some(cmd) = build_initial_cd_command(initial_dir.as_deref()) {
        let _ = channel.data(cmd.as_bytes()).await;
    }

    let (tx, mut rx) = mpsc::unbounded_channel::<SshCommand>();
    let tx_weak = tx.downgrade();
    let tab_id_task = tab_id.clone();

    tauri::async_runtime::spawn(async move {
        let close_reason: Option<String> = loop {
            tokio::select! {
                msg = channel.wait() => {
                    match msg {
                        Some(ChannelMsg::Data { data }) => {
                            write_to_log_if_active(&ssh_log_files, &tab_id_task, &data[..]).await;
                            let _ = app.emit(
                                "ssh-data",
                                SshDataEvent {
                                    tab_id: tab_id_task.clone(),
                                    data_b64: B64.encode(&data[..]),
                                },
                            );
                        }
                        Some(ChannelMsg::ExtendedData { data, .. }) => {
                            write_to_log_if_active(&ssh_log_files, &tab_id_task, &data[..]).await;
                            let _ = app.emit(
                                "ssh-data",
                                SshDataEvent {
                                    tab_id: tab_id_task.clone(),
                                    data_b64: B64.encode(&data[..]),
                                },
                            );
                        }
                        Some(ChannelMsg::Eof) | Some(ChannelMsg::Close) | None => {
                            break Some("Remote shell exited".to_string());
                        }
                        _ => {}
                    }
                }
                cmd = rx.recv() => {
                    match cmd {
                        Some(SshCommand::Write(bytes)) => {
                            if channel.data(&bytes[..]).await.is_err() {
                                break Some("Write failed".to_string());
                            }
                        }
                        Some(SshCommand::Resize { cols, rows }) => {
                            let _ = channel.window_change(cols, rows, 0, 0).await;
                        }
                        Some(SshCommand::Close { silent }) => {
                            let _ = channel.eof().await;
                            let _ = session
                                .disconnect(Disconnect::ByApplication, "User disconnected", "en")
                                .await;
                            break if silent { None } else { Some("Disconnected".to_string()) };
                        }
                        None => {
                            break None;
                        }
                    }
                }
            }
        };

        // Clean up terminal handle and log file if this handle is still the active one for the tab
        let removed_self = {
            let mut map = ssh_terminals.write().await;
            if let Some(strong_tx) = tx_weak.upgrade() {
                if map
                    .get(&tab_id_task)
                    .map(|h| h.tx.same_channel(&strong_tx))
                    .unwrap_or(false)
                {
                    map.remove(&tab_id_task);
                    true
                } else {
                    false
                }
            } else {
                false
            }
        };
        if removed_self {
            ssh_log_files.write().await.remove(&tab_id_task);
        }

        if let Some(reason) = close_reason {
            let _ = app.emit(
                "ssh-closed",
                SshClosedEvent {
                    tab_id: tab_id_task,
                    reason,
                },
            );
        }
    });

    let newly_trusted_key = accepted_key.lock().ok().and_then(|mut g| g.take());
    Ok(SshConnectOutcome::Connected {
        handle: SshTerminalHandle { tx },
        newly_trusted_key,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_initial_cd_command_escapes_quotes_and_rejects_control_chars() {
        assert_eq!(build_initial_cd_command(None), None);
        assert_eq!(build_initial_cd_command(Some("/")), None);
        assert_eq!(build_initial_cd_command(Some("  ")), None);
        assert_eq!(
            build_initial_cd_command(Some("/var/www/my'site")),
            Some("cd '/var/www/my'\\''site'\n".to_string())
        );
        assert_eq!(build_initial_cd_command(Some("/tmp\nrm -rf /")), None);
        assert_eq!(build_initial_cd_command(Some("/tmp\rwhoami")), None);
        assert_eq!(build_initial_cd_command(Some("/tmp\0evil")), None);
    }

    #[test]
    fn strip_ansi_bytes_removes_csi_osc_and_cr() {
        let raw = b"\x1b[32mhello\x1b[0m \x1b]0;title\x07world\r\nline2\x1b]0;st\x1b\\!";
        assert_eq!(strip_ansi_bytes(raw), b"hello world\nline2!");
    }
}
