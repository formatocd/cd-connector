use tauri::{AppHandle, State};

use crate::db;
use crate::error::{AppError, AppResult};
use crate::models::AppConfig;
use crate::state::AppState;

#[tauri::command]
pub fn get_app_config(state: State<'_, AppState>) -> AppResult<AppConfig> {
    let conn = state.db_lock()?;
    db::load_app_config(&conn)
}

fn normalize_app_config(mut config: AppConfig) -> AppResult<AppConfig> {
    if config.max_concurrent_transfers == 0 {
        return Err(AppError::Validation(
            "max_concurrent_transfers must be at least 1".into(),
        ));
    }
    config.max_concurrent_transfers = config.max_concurrent_transfers.min(20);
    config.terminal_font_size = config.terminal_font_size.clamp(10, 28);
    Ok(config)
}

#[tauri::command]
pub fn update_app_config(
    app: AppHandle,
    state: State<'_, AppState>,
    config: AppConfig,
) -> AppResult<AppConfig> {
    let normalized = normalize_app_config(config)?;
    {
        let conn = state.db_lock()?;
        db::save_app_config(&conn, &normalized)?;
    }
    state.transfers.update_limits(
        app,
        state.connections.clone(),
        normalized.max_concurrent_transfers,
        normalized.upload_limit_kbps,
        normalized.download_limit_kbps,
    );
    Ok(normalized)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_app_config_rejects_zero_concurrency_and_clamps_bounds() {
        let mut cfg = AppConfig::default();
        cfg.max_concurrent_transfers = 0;
        assert!(normalize_app_config(cfg).is_err());

        let mut cfg = AppConfig::default();
        cfg.max_concurrent_transfers = 99;
        cfg.terminal_font_size = 50;
        let out = normalize_app_config(cfg).unwrap();
        assert_eq!(out.max_concurrent_transfers, 20);
        assert_eq!(out.terminal_font_size, 28);
    }
}
