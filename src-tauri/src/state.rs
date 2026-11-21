use rusqlite::Connection;
use std::path::PathBuf;
use std::sync::{Mutex, RwLock};

use crate::crypto::MasterKey;
use crate::error::{AppError, AppResult};

pub struct AppState {
    pub db: Mutex<Connection>,
    pub master_key: RwLock<Option<MasterKey>>,
    pub app_data_dir: PathBuf,
}

impl AppState {
    pub fn new(conn: Connection, app_data_dir: PathBuf) -> Self {
        Self {
            db: Mutex::new(conn),
            master_key: RwLock::new(None),
            app_data_dir,
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
}
