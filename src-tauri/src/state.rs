use chrono::Utc;
use rusqlite::Connection;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, MutexGuard, RwLock};
use tokio::sync::{Mutex as AsyncMutex, RwLock as AsyncRwLock};
use uuid::Uuid;

use crate::crypto::{self, MasterKey};
use crate::db;
use crate::error::{AppError, AppResult};
use crate::models::{AppConfig, AuthType, CredentialSecretPayload, KnownHost};
use crate::protocols::ssh_terminal::SshTerminalHandle;
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
            transfers: TransferManager::new(
                config.max_concurrent_transfers,
                config.upload_limit_kbps,
                config.download_limit_kbps,
            ),
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
