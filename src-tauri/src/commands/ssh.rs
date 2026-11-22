use chrono::Utc;
use tauri::{AppHandle, State};
use uuid::Uuid;

use crate::crypto;
use crate::db;
use crate::error::{AppError, AppResult};
use crate::models::{
    AuthType, ConnectResponse, ConnectStatus, CredentialSecretPayload, SshConnectRequest,
};
use crate::protocols::ssh_terminal::{connect_ssh_terminal, SshCommand, SshConnectOutcome};
use crate::protocols::ResolvedAuth;
use crate::state::AppState;

fn resolve_ssh_auth(state: &AppState, req: &SshConnectRequest) -> AppResult<Option<ResolvedAuth>> {
    if let Some(ref user) = req.username {
        return Ok(Some(ResolvedAuth {
            username: user.clone(),
            auth_type: AuthType::Password,
            password: req.password.clone(),
            private_key: None,
            passphrase: None,
        }));
    }

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

    Ok(None)
}

#[tauri::command]
pub async fn ssh_connect(
    app: AppHandle,
    state: State<'_, AppState>,
    request: SshConnectRequest,
) -> AppResult<ConnectResponse> {
    let Some(auth) = resolve_ssh_auth(&state, &request)? else {
        return Ok(ConnectResponse {
            status: ConnectStatus::AuthRequired,
            current_dir: None,
            host_key_info: None,
        });
    };

    // Close any previous SSH terminal on this tab
    if let Some(prev) = state.ssh_terminals.write().await.remove(&request.tab_id) {
        let _ = prev.tx.send(SshCommand::Close);
    }

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

    let outcome = connect_ssh_terminal(
        app,
        request.tab_id.clone(),
        &request.host,
        request.port,
        &auth,
        known_hosts,
        request.trust_host_key.unwrap_or(false),
        request.cols.unwrap_or(100),
        request.rows.unwrap_or(30),
        request.initial_dir.clone(),
    )
    .await?;

    match outcome {
        SshConnectOutcome::HostKeyPrompt(info) => Ok(ConnectResponse {
            status: ConnectStatus::HostKeyPrompt,
            current_dir: None,
            host_key_info: Some(info),
        }),
        SshConnectOutcome::Connected {
            handle,
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

            state
                .ssh_terminals
                .write()
                .await
                .insert(request.tab_id, handle);

            Ok(ConnectResponse {
                status: ConnectStatus::Connected,
                current_dir: None,
                host_key_info: None,
            })
        }
    }
}

#[tauri::command]
pub async fn ssh_write(state: State<'_, AppState>, tab_id: String, data: String) -> AppResult<()> {
    let map = state.ssh_terminals.read().await;
    if let Some(handle) = map.get(&tab_id) {
        let _ = handle.tx.send(SshCommand::Write(data.into_bytes()));
    }
    Ok(())
}

#[tauri::command]
pub async fn ssh_resize(
    state: State<'_, AppState>,
    tab_id: String,
    cols: u32,
    rows: u32,
) -> AppResult<()> {
    let map = state.ssh_terminals.read().await;
    if let Some(handle) = map.get(&tab_id) {
        let _ = handle.tx.send(SshCommand::Resize { cols, rows });
    }
    Ok(())
}

#[tauri::command]
pub async fn ssh_disconnect(state: State<'_, AppState>, tab_id: String) -> AppResult<()> {
    if let Some(handle) = state.ssh_terminals.write().await.remove(&tab_id) {
        let _ = handle.tx.send(SshCommand::Close);
    }
    Ok(())
}
