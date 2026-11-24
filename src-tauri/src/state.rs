use rusqlite::Connection;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, RwLock};
use tokio::sync::{Mutex as AsyncMutex, RwLock as AsyncRwLock};

use crate::crypto::MasterKey;
use crate::error::{AppError, AppResult};
use crate::models::AppConfig;
use crate::protocols::ssh_terminal::SshTerminalHandle;
use crate::protocols::FileTransferClient;
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

    pub fn get_master_key(&self) -> AppResult<MasterKey> {
        let guard = self
            .master_key
            .read()
            .map_err(|_| AppError::Crypto("Lock poisoned".into()))?;
        guard.clone().ok_or(AppError::VaultLocked)
    }

    pub fn set_master_key(&self, key: Option<MasterKey>) -> AppResult<()> {
        let mut guard = self
            .master_key
            .write()
            .map_err(|_| AppError::Crypto("Lock poisoned".into()))?;
        *guard = key;
        Ok(())
    }

    pub fn is_unlocked(&self) -> bool {
        self.master_key
            .read()
            .map(|g| g.is_some())
            .unwrap_or(false)
    }

    pub async fn get_connection(&self, tab_id: &str) -> AppResult<SharedClient> {
        let map = self.connections.read().await;
        map.get(tab_id)
            .cloned()
            .ok_or_else(|| AppError::NotConnected(format!("No active connection for tab {tab_id}")))
    }
}
