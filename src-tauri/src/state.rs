use rusqlite::Connection;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, RwLock};
use tokio::sync::{Mutex as AsyncMutex, RwLock as AsyncRwLock};

use crate::crypto::MasterKey;
use crate::error::{AppError, AppResult};
use crate::protocols::FileTransferClient;

pub type SharedClient = Arc<AsyncMutex<Box<dyn FileTransferClient>>>;

pub struct AppState {
    pub db: Mutex<Connection>,
    pub master_key: RwLock<Option<MasterKey>>,
    pub app_data_dir: PathBuf,
    pub connections: AsyncRwLock<HashMap<String, SharedClient>>,
}

impl AppState {
    pub fn new(conn: Connection, app_data_dir: PathBuf) -> Self {
        Self {
            db: Mutex::new(conn),
            master_key: RwLock::new(None),
            app_data_dir,
            connections: AsyncRwLock::new(HashMap::new()),
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
