use tauri::State;

use crate::db;
use crate::error::{AppError, AppResult};
use crate::models::AppConfig;
use crate::state::AppState;

#[tauri::command]
pub fn get_app_config(state: State<'_, AppState>) -> AppResult<AppConfig> {
    let conn = state
        .db
        .lock()
        .map_err(|_| AppError::Crypto("DB lock poisoned".into()))?;
    db::load_app_config(&conn)
}

#[tauri::command]
pub fn update_app_config(state: State<'_, AppState>, config: AppConfig) -> AppResult<AppConfig> {
    let conn = state
        .db
        .lock()
        .map_err(|_| AppError::Crypto("DB lock poisoned".into()))?;
    db::save_app_config(&conn, &config)?;
    Ok(config)
}
