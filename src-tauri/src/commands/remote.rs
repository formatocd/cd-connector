use chrono::Utc;
use std::sync::Arc;
use tauri::{AppHandle, State};
use tokio::sync::Mutex as AsyncMutex;
use uuid::Uuid;

use crate::crypto;
use crate::db;
use crate::error::{AppError, AppResult};
use crate::models::{
    AuthType, ConnectRequest, ConnectResponse, ConnectStatus, CredentialSecretPayload, FileEntry,
    KnownHost, Protocol,
};
use crate::protocols::ftp::FtpClient;
use crate::protocols::sftp::{SftpClient, SftpConnectOutcome};
use crate::protocols::{FileTransferClient, LogEmitter, ResolvedAuth};
use crate::state::AppState;

fn resolve_auth(state: &AppState, req: &ConnectRequest) -> AppResult<Option<ResolvedAuth>> {
    // 1. Explicit on-the-fly credentials take precedence
    if let Some(ref user) = req.username {
        return Ok(Some(ResolvedAuth {
            username: user.clone(),
            auth_type: AuthType::Password,
            password: req.password.clone(),
            private_key: None,
            passphrase: None,
        }));
    }

    // 2. Stored credential from SQLite vault
    if let Some(ref cred_id) = req.credential_id {
        let key = state.get_master_key()?;
        let conn = state
            .db
            .lock()
            .map_err(|_| AppError::Crypto("DB lock poisoned".into()))?;
        let row = db::get_credential_row(&conn, cred_id)?
            .ok_or_else(|| AppError::NotFound(format!("Credential {cred_id}")))?;
        let plain = crypto::decrypt(&key, &row.encrypted_secret, &row.nonce)?;
        let payload: CredentialSecretPayload = serde_json::from_slice(&plain)?;

        // If password auth has no saved password (user chose not to save it), prompt on the fly
        if row.auth_type == AuthType::Password && payload.password.is_none() {
            return Ok(None);
        }

        return Ok(Some(ResolvedAuth {
            username: row.username,
            auth_type: row.auth_type,
            password: payload.password.clone(),
            private_key: payload.private_key.clone(),
            passphrase: payload.passphrase.clone(),
        }));
    }

    // 3. No credential provided -> prompt user (modal supports Anonymous for FTP/FTPS)
    Ok(None)
}

#[tauri::command]
pub async fn connect_session(
    app: AppHandle,
    state: State<'_, AppState>,
    request: ConnectRequest,
) -> AppResult<ConnectResponse> {
    if request.protocol == Protocol::Ssh {
        return Err(AppError::Validation(
            "SSH terminal sessions will be enabled in Phase 4.5.".into(),
        ));
    }

    let Some(auth) = resolve_auth(&state, &request)? else {
        return Ok(ConnectResponse {
            status: ConnectStatus::AuthRequired,
            current_dir: None,
            host_key_info: None,
        });
    };

    let logger = LogEmitter::new(app, request.tab_id.clone());

    // Disconnect any previous connection on this tab
    if let Some(prev) = state.connections.write().await.remove(&request.tab_id) {
        let mut guard = prev.lock().await;
        let _ = guard.disconnect().await;
    }

    let mut client: Box<dyn FileTransferClient> = match request.protocol {
        Protocol::Ftp | Protocol::FtpsExplicit | Protocol::FtpsImplicit => {
            let ftp = FtpClient::connect(
                request.protocol,
                &request.host,
                request.port,
                &auth,
                request.passive_mode.unwrap_or(true),
                request.accept_invalid_certs.unwrap_or(false),
                logger.clone(),
            )
            .await?;
            Box::new(ftp)
        }
        Protocol::Sftp => {
            let known_hosts = {
                let conn = state
                    .db
                    .lock()
                    .map_err(|_| AppError::Crypto("DB lock poisoned".into()))?;
                db::list_known_hosts(&conn)?
                    .into_iter()
                    .filter(|kh| kh.host == request.host && kh.port == request.port)
                    .collect::<Vec<_>>()
            };

            let outcome = SftpClient::connect(
                &request.host,
                request.port,
                &auth,
                known_hosts,
                request.trust_host_key.unwrap_or(false),
                logger.clone(),
            )
            .await?;

            match outcome {
                SftpConnectOutcome::HostKeyPrompt(info) => {
                    return Ok(ConnectResponse {
                        status: ConnectStatus::HostKeyPrompt,
                        current_dir: None,
                        host_key_info: Some(info),
                    });
                }
                SftpConnectOutcome::Connected {
                    client,
                    newly_trusted_key,
                } => {
                    if let Some((key_type, fingerprint)) = newly_trusted_key {
                        let conn = state
                            .db
                            .lock()
                            .map_err(|_| AppError::Crypto("DB lock poisoned".into()))?;
                        db::upsert_known_host(
                            &conn,
                            &Uuid::new_v4().to_string(),
                            &request.host,
                            request.port,
                            &key_type,
                            &fingerprint,
                            &Utc::now().to_rfc3339(),
                        )?;
                    }
                    Box::new(client)
                }
            }
        }
        Protocol::Ssh => unreachable!(),
    };

    let current_dir = match request
        .remote_initial_path
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        Some(initial) => initial.to_string(),
        None => client.pwd().await.unwrap_or_else(|_| "/".to_string()),
    };

    state
        .connections
        .write()
        .await
        .insert(request.tab_id, Arc::new(AsyncMutex::new(client)));

    Ok(ConnectResponse {
        status: ConnectStatus::Connected,
        current_dir: Some(current_dir),
        host_key_info: None,
    })
}

#[tauri::command]
pub async fn disconnect_session(state: State<'_, AppState>, tab_id: String) -> AppResult<()> {
    if let Some(conn) = state.connections.write().await.remove(&tab_id) {
        let mut client = conn.lock().await;
        client.disconnect().await?;
    }
    Ok(())
}

#[tauri::command]
pub async fn remote_pwd(state: State<'_, AppState>, tab_id: String) -> AppResult<String> {
    let conn = state.get_connection(&tab_id).await?;
    let mut client = conn.lock().await;
    client.pwd().await
}

#[tauri::command]
pub async fn remote_list_dir(
    state: State<'_, AppState>,
    tab_id: String,
    path: String,
) -> AppResult<Vec<FileEntry>> {
    let conn = state.get_connection(&tab_id).await?;
    let mut client = conn.lock().await;
    client.list_dir(&path).await
}

#[tauri::command]
pub async fn remote_mkdir(
    state: State<'_, AppState>,
    tab_id: String,
    path: String,
) -> AppResult<()> {
    let conn = state.get_connection(&tab_id).await?;
    let mut client = conn.lock().await;
    client.mkdir(&path).await
}

#[tauri::command]
pub async fn remote_rename(
    state: State<'_, AppState>,
    tab_id: String,
    from: String,
    to: String,
) -> AppResult<()> {
    let conn = state.get_connection(&tab_id).await?;
    let mut client = conn.lock().await;
    client.rename(&from, &to).await
}

#[tauri::command]
pub async fn remote_delete(
    state: State<'_, AppState>,
    tab_id: String,
    path: String,
    is_dir: bool,
) -> AppResult<()> {
    let conn = state.get_connection(&tab_id).await?;
    let mut client = conn.lock().await;
    if is_dir {
        client.delete_dir(&path).await
    } else {
        client.delete_file(&path).await
    }
}

#[tauri::command]
pub async fn remote_chmod(
    state: State<'_, AppState>,
    tab_id: String,
    path: String,
    mode: u32,
) -> AppResult<()> {
    let conn = state.get_connection(&tab_id).await?;
    let mut client = conn.lock().await;
    client.chmod(&path, mode).await
}

#[tauri::command]
pub async fn remote_stat(
    state: State<'_, AppState>,
    tab_id: String,
    path: String,
) -> AppResult<FileEntry> {
    let conn = state.get_connection(&tab_id).await?;
    let mut client = conn.lock().await;
    client.stat(&path).await
}

#[tauri::command]
pub async fn send_raw_command(
    state: State<'_, AppState>,
    tab_id: String,
    command: String,
) -> AppResult<String> {
    let conn = state.get_connection(&tab_id).await?;
    let mut client = conn.lock().await;
    client.send_raw_command(&command).await
}

#[tauri::command]
pub fn list_known_hosts(state: State<'_, AppState>) -> AppResult<Vec<KnownHost>> {
    let conn = state
        .db
        .lock()
        .map_err(|_| AppError::Crypto("DB lock poisoned".into()))?;
    db::list_known_hosts(&conn)
}

#[tauri::command]
pub fn delete_known_host(state: State<'_, AppState>, id: String) -> AppResult<()> {
    let conn = state
        .db
        .lock()
        .map_err(|_| AppError::Crypto("DB lock poisoned".into()))?;
    db::delete_known_host(&conn, &id)
}
