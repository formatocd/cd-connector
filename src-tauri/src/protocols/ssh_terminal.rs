use base64::{engine::general_purpose::STANDARD as B64, Engine};
use russh::client::{self, Config};
use russh::keys::{decode_secret_key, HashAlg, PrivateKeyWithHashAlg, PublicKeyOrCertificate};
use russh::{ChannelMsg, Disconnect};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tokio::sync::mpsc::{self, UnboundedSender};

use crate::error::{AppError, AppResult};
use crate::models::{AuthType, HostKeyPromptInfo, KnownHost, SshClosedEvent, SshDataEvent};
use crate::protocols::ResolvedAuth;

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
    trust_host_key: bool,
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

        if let Some(existing) = self.known_hosts.iter().find(|kh| kh.key_type == key_type) {
            if existing.fingerprint == fingerprint {
                return Ok(true);
            }
            if self.trust_host_key {
                if let Ok(mut guard) = self.accepted_key.lock() {
                    *guard = Some((key_type, fingerprint));
                }
                return Ok(true);
            }
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
            if let Ok(mut guard) = self.accepted_key.lock() {
                *guard = Some((key_type, fingerprint));
            }
            return Ok(true);
        }

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

pub async fn connect_ssh_terminal(
    app: AppHandle,
    tab_id: String,
    host: &str,
    port: u16,
    auth: &ResolvedAuth,
    known_hosts: Vec<KnownHost>,
    trust_host_key: bool,
    cols: u32,
    rows: u32,
    initial_dir: Option<String>,
) -> AppResult<SshConnectOutcome> {
    let prompt_info = Arc::new(Mutex::new(None));
    let accepted_key = Arc::new(Mutex::new(None));

    let handler = SshTermHandler {
        host: host.to_string(),
        port,
        known_hosts,
        trust_host_key,
        prompt_info: prompt_info.clone(),
        accepted_key: accepted_key.clone(),
    };

    let config = Config {
        inactivity_timeout: Some(Duration::from_secs(600)),
        keepalive_interval: Some(Duration::from_secs(30)),
        ..Default::default()
    };

    let connect_result = client::connect(Arc::new(config), (host, port), handler).await;
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
    if let Some(dir) = initial_dir.filter(|d| !d.trim().is_empty() && d.trim() != "/") {
        let escaped = dir.replace('\'', "'\\''");
        let cmd = format!("cd '{escaped}'\n");
        let _ = channel.data(cmd.as_bytes()).await;
    }

    let (tx, mut rx) = mpsc::unbounded_channel::<SshCommand>();
    let tab_id_task = tab_id.clone();

    tauri::async_runtime::spawn(async move {
        let close_reason: Option<String> = loop {
            tokio::select! {
                msg = channel.wait() => {
                    match msg {
                        Some(ChannelMsg::Data { data }) => {
                            let _ = app.emit(
                                "ssh-data",
                                SshDataEvent {
                                    tab_id: tab_id_task.clone(),
                                    data_b64: B64.encode(&data[..]),
                                },
                            );
                        }
                        Some(ChannelMsg::ExtendedData { data, .. }) => {
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
