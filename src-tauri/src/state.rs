use chrono::Utc;
use rusqlite::Connection;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, MutexGuard, RwLock};
use std::time::Duration;
use tauri::AppHandle;
use tokio::sync::{Mutex as AsyncMutex, RwLock as AsyncRwLock};
use uuid::Uuid;

use crate::crypto::{self, MasterKey};
use crate::db;
use crate::error::{AppError, AppResult};
use crate::models::{AppConfig, AuthType, CredentialSecretPayload, KnownHost};
use crate::protocols::ssh_terminal::{SshCommand, SshTerminalHandle};
use crate::protocols::{FileTransferClient, ResolvedAuth};
use crate::transfer::TransferManager;

pub type SharedClient = Arc<AsyncMutex<Box<dyn FileTransferClient>>>;
pub type SharedLogFile = Arc<AsyncMutex<tokio::fs::File>>;

pub struct AppState {
    pub db: Mutex<Connection>,
    pub master_key: RwLock<Option<MasterKey>>,
    pub app_data_dir: PathBuf,
    pub connections: Arc<AsyncRwLock<HashMap<String, SharedClient>>>,
    pub ssh_terminals: Arc<AsyncRwLock<HashMap<String, SshTerminalHandle>>>,
    pub ssh_log_files: Arc<AsyncRwLock<HashMap<String, SharedLogFile>>>,
    pub tab_generations: Mutex<HashMap<String, u64>>,
    pub transfers: Arc<TransferManager>,
}

impl AppState {
    pub fn new(conn: Connection, app_data_dir: PathBuf, config: &AppConfig) -> Self {
        Self {
            db: Mutex::new(conn),
            master_key: RwLock::new(None),
            app_data_dir,
            connections: Arc::new(AsyncRwLock::new(HashMap::new())),
            ssh_terminals: Arc::new(AsyncRwLock::new(HashMap::new())),
            ssh_log_files: Arc::new(AsyncRwLock::new(HashMap::new())),
            tab_generations: Mutex::new(HashMap::new()),
            transfers: TransferManager::new(
                config.max_concurrent_transfers,
                config.upload_limit_kbps,
                config.download_limit_kbps,
            ),
        }
    }

    /// Starts a new connection attempt for `tab_id` and returns its unique generation token.
    pub fn begin_tab_connect(&self, tab_id: &str) -> u64 {
        let mut map = self.tab_generations.lock().unwrap_or_else(|e| e.into_inner());
        let next = map.get(tab_id).copied().unwrap_or(0).wrapping_add(1);
        map.insert(tab_id.to_string(), next);
        next
    }

    /// Invalidates any in-flight connection handshake for `tab_id`.
    pub fn invalidate_tab(&self, tab_id: &str) {
        let mut map = self.tab_generations.lock().unwrap_or_else(|e| e.into_inner());
        let next = map.get(tab_id).copied().unwrap_or(0).wrapping_add(1);
        map.insert(tab_id.to_string(), next);
    }

    /// Returns true only if `gen` is still the active connection generation for `tab_id`.
    pub fn is_tab_generation_current(&self, tab_id: &str, gen: u64) -> bool {
        let map = self.tab_generations.lock().unwrap_or_else(|e| e.into_inner());
        map.get(tab_id).copied() == Some(gen)
    }

    /// Gracefully cancels transfers and closes all active FTP/SFTP/SSH sessions and log files.
    pub async fn shutdown_all(&self, app: &AppHandle) {
        {
            let mut map = self.tab_generations.lock().unwrap_or_else(|e| e.into_inner());
            for gen in map.values_mut() {
                *gen = gen.wrapping_add(1);
            }
        }

        self.transfers.cancel_all(app);
        self.ssh_log_files.write().await.clear();

        let terminals: Vec<SshTerminalHandle> = self
            .ssh_terminals
            .write()
            .await
            .drain()
            .map(|(_, h)| h)
            .collect();
        for handle in terminals {
            let _ = handle.tx.send(SshCommand::Close { silent: true });
        }

        let clients: Vec<SharedClient> = self
            .connections
            .write()
            .await
            .drain()
            .map(|(_, c)| c)
            .collect();
        for conn in clients {
            let _ = tokio::time::timeout(Duration::from_secs(2), async {
                let mut client = conn.lock().await;
                let _ = client.disconnect().await;
            })
            .await;
        }
    }

    pub fn db_lock(&self) -> AppResult<MutexGuard<'_, Connection>> {
        self.db
            .lock()
            .map_err(|_| AppError::LockPoisoned("DB lock poisoned".into()))
    }

    pub fn get_master_key(&self) -> AppResult<MasterKey> {
        let guard = self
            .master_key
            .read()
            .map_err(|_| AppError::LockPoisoned("Master key lock poisoned".into()))?;
        guard.clone().ok_or(AppError::VaultLocked)
    }

    pub fn set_master_key(&self, key: Option<MasterKey>) -> AppResult<()> {
        let mut guard = self
            .master_key
            .write()
            .map_err(|_| AppError::LockPoisoned("Master key lock poisoned".into()))?;
        *guard = key;
        Ok(())
    }

    pub fn is_unlocked(&self) -> bool {
        self.master_key
            .read()
            .map(|g| g.is_some())
            .unwrap_or(false)
    }

    pub fn resolve_auth(
        &self,
        credential_id: Option<&str>,
        username: Option<&str>,
        password: Option<&str>,
    ) -> AppResult<Option<ResolvedAuth>> {
        if let Some(user) = username {
            return Ok(Some(ResolvedAuth {
                username: user.to_string(),
                auth_type: AuthType::Password,
                password: password.map(|s| s.to_string()),
                private_key: None,
                passphrase: None,
            }));
        }

        if let Some(cred_id) = credential_id {
            let key = self.get_master_key()?;
            let conn = self.db_lock()?;
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

    pub fn list_known_hosts_for(&self, host: &str, port: u16) -> AppResult<Vec<KnownHost>> {
        let conn = self.db_lock()?;
        Ok(db::list_known_hosts(&conn)?
            .into_iter()
            .filter(|kh| kh.host == host && kh.port == port)
            .collect())
    }

    pub fn record_known_host(
        &self,
        host: &str,
        port: u16,
        key_type: &str,
        fingerprint: &str,
    ) -> AppResult<()> {
        let conn = self.db_lock()?;
        db::upsert_known_host(
            &conn,
            &Uuid::new_v4().to_string(),
            host,
            port,
            key_type,
            fingerprint,
            &Utc::now().to_rfc3339(),
        )
    }

    pub async fn get_connection(&self, tab_id: &str) -> AppResult<SharedClient> {
        let map = self.connections.read().await;
        map.get(tab_id)
            .cloned()
            .ok_or_else(|| AppError::NotConnected(format!("No active connection for tab {tab_id}")))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tab_generation_invalidates_in_flight_connects() {
        let conn = Connection::open_in_memory().unwrap();
        let state = AppState::new(conn, PathBuf::from("."), &AppConfig::default());

        let g1 = state.begin_tab_connect("tab-1");
        assert!(state.is_tab_generation_current("tab-1", g1));

        // Closing the tab invalidates the in-flight generation
        state.invalidate_tab("tab-1");
        assert!(!state.is_tab_generation_current("tab-1", g1));

        // A concurrent reconnect supersedes the previous attempt
        let g2 = state.begin_tab_connect("tab-1");
        let g3 = state.begin_tab_connect("tab-1");
        assert!(!state.is_tab_generation_current("tab-1", g2));
        assert!(state.is_tab_generation_current("tab-1", g3));
    }
}
