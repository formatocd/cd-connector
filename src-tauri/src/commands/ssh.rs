use std::sync::Arc;
use tauri::{AppHandle, State};
use tokio::io::AsyncWriteExt;
use tokio::sync::Mutex as AsyncMutex;

use crate::error::{AppError, AppResult};
use crate::models::{ConnectResponse, ConnectStatus, SshConnectRequest};
use crate::protocols::ssh_terminal::{connect_ssh_terminal, SshCommand, SshConnectOutcome};
use crate::state::AppState;

#[tauri::command]
pub async fn ssh_connect(
    app: AppHandle,
    state: State<'_, AppState>,
    request: SshConnectRequest,
) -> AppResult<ConnectResponse> {
    if request.host.trim().is_empty() {
        return Err(AppError::Validation("Host cannot be empty".into()));
    }
    if request.port == 0 {
        return Err(AppError::Validation("Port must be between 1 and 65535".into()));
    }

    let Some(auth) = state.resolve_auth(
        request.credential_id.as_deref(),
        request.username.as_deref(),
        request.password.as_deref(),
    )?
    else {
        return Ok(ConnectResponse {
            status: ConnectStatus::AuthRequired,
            current_dir: None,
            host_key_info: None,
        });
    };

    let connect_gen = state.begin_tab_connect(&request.tab_id);

    // Close any previous SSH terminal on this tab silently so it doesn't emit a stale disconnect event
    if let Some(prev) = state.ssh_terminals.write().await.remove(&request.tab_id) {
        let _ = prev.tx.send(SshCommand::Close { silent: true });
    }

    let known_hosts = state.list_known_hosts_for(&request.host, request.port)?;

    let outcome = connect_ssh_terminal(
        app,
        request.tab_id.clone(),
        &request.host,
        request.port,
        &auth,
        known_hosts,
        request.expected_host_key_fingerprint.clone(),
        request.cols.unwrap_or(100),
        request.rows.unwrap_or(30),
        request.initial_dir.clone(),
        state.ssh_terminals.clone(),
        state.ssh_log_files.clone(),
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
                state.record_known_host(&request.host, request.port, &key_type, &fingerprint)?;
            }

            // If the tab was closed or superseded during handshake, close immediately
            if !state.is_tab_generation_current(&request.tab_id, connect_gen) {
                let _ = handle.tx.send(SshCommand::Close { silent: true });
                return Err(AppError::NotConnected("Connection cancelled".into()));
            }

            if let Some(prev) = state
                .ssh_terminals
                .write()
                .await
                .insert(request.tab_id, handle)
            {
                let _ = prev.tx.send(SshCommand::Close { silent: true });
            }

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
    state.invalidate_tab(&tab_id);
    if let Some(handle) = state.ssh_terminals.write().await.remove(&tab_id) {
        let _ = handle.tx.send(SshCommand::Close { silent: false });
    }
    state.ssh_log_files.write().await.remove(&tab_id);
    Ok(())
}

#[tauri::command]
pub async fn ssh_start_log(
    state: State<'_, AppState>,
    tab_id: String,
    file_path: String,
) -> AppResult<()> {
    let mut opts = tokio::fs::OpenOptions::new();
    opts.create(true).write(true).truncate(true);
    #[cfg(unix)]
    opts.mode(0o600);
    let file = opts.open(&file_path).await?;
    state
        .ssh_log_files
        .write()
        .await
        .insert(tab_id, Arc::new(AsyncMutex::new(file)));
    Ok(())
}

#[tauri::command]
pub async fn ssh_stop_log(state: State<'_, AppState>, tab_id: String) -> AppResult<()> {
    if let Some(file_arc) = state.ssh_log_files.write().await.remove(&tab_id) {
        let mut f = file_arc.lock().await;
        let _ = f.flush().await;
    }
    Ok(())
}
