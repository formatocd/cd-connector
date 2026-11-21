use base64::{engine::general_purpose::STANDARD as B64, Engine};
use tauri::State;

use crate::crypto::{self, MasterKey};
use crate::db;
use crate::error::{AppError, AppResult};
use crate::models::{SecurityMode, SecurityStatus};
use crate::state::AppState;

#[tauri::command]
pub fn get_security_status(state: State<'_, AppState>) -> AppResult<SecurityStatus> {
    let conn = state
        .db
        .lock()
        .map_err(|_| AppError::Crypto("DB lock poisoned".into()))?;
    let mode = db::get_security_mode(&conn)?;

    match mode {
        None => Ok(SecurityStatus {
            initialized: false,
            mode: None,
            unlocked: false,
        }),
        Some(SecurityMode::Transparent) => {
            if !state.is_unlocked() {
                let key = crypto::load_transparent_key(&state.app_data_dir)?;
                if let Some(token) = db::get_config_value(&conn, "verification_hash")? {
                    if !crypto::verify_key(&key, &token)? {
                        return Err(AppError::Crypto(
                            "Transparent vault key verification failed".into(),
                        ));
                    }
                }
                state.set_master_key(Some(key))?;
            }
            Ok(SecurityStatus {
                initialized: true,
                mode: Some(SecurityMode::Transparent),
                unlocked: true,
            })
        }
        Some(SecurityMode::MasterPassword) => Ok(SecurityStatus {
            initialized: true,
            mode: Some(SecurityMode::MasterPassword),
            unlocked: state.is_unlocked(),
        }),
    }
}

#[tauri::command]
pub fn setup_security_mode(
    state: State<'_, AppState>,
    mode: SecurityMode,
    master_password: Option<String>,
) -> AppResult<SecurityStatus> {
    let conn = state
        .db
        .lock()
        .map_err(|_| AppError::Crypto("DB lock poisoned".into()))?;

    if db::get_security_mode(&conn)?.is_some() {
        return Err(AppError::Validation(
            "Security mode is already initialized. Use change_security_mode instead.".into(),
        ));
    }

    match mode {
        SecurityMode::MasterPassword => {
            let password = master_password.unwrap_or_default();
            if password.len() < 4 {
                return Err(AppError::Validation(
                    "Master password must be at least 4 characters long".into(),
                ));
            }
            let salt = crypto::generate_salt();
            let key = crypto::derive_key(&password, &salt)?;
            let verification = crypto::create_verification_token(&key)?;

            db::set_config_value(&conn, "security_mode", mode.as_str())?;
            db::set_config_value(&conn, "salt", &B64.encode(salt))?;
            db::set_config_value(&conn, "verification_hash", &verification)?;
            state.set_master_key(Some(key))?;
        }
        SecurityMode::Transparent => {
            let key = MasterKey::random();
            let verification = crypto::create_verification_token(&key)?;
            crypto::save_transparent_key(&state.app_data_dir, &key)?;

            db::set_config_value(&conn, "security_mode", mode.as_str())?;
            db::delete_config_value(&conn, "salt")?;
            db::set_config_value(&conn, "verification_hash", &verification)?;
            state.set_master_key(Some(key))?;
        }
    }

    Ok(SecurityStatus {
        initialized: true,
        mode: Some(mode),
        unlocked: true,
    })
}

#[tauri::command]
pub fn unlock_vault(state: State<'_, AppState>, password: String) -> AppResult<SecurityStatus> {
    let conn = state
        .db
        .lock()
        .map_err(|_| AppError::Crypto("DB lock poisoned".into()))?;

    let mode = db::get_security_mode(&conn)?.ok_or(AppError::SecurityNotInitialized)?;
    if mode != SecurityMode::MasterPassword {
        return Err(AppError::Validation(
            "Vault does not use master password mode".into(),
        ));
    }

    let salt_b64 = db::get_config_value(&conn, "salt")?
        .ok_or_else(|| AppError::Crypto("Missing salt in configuration".into()))?;
    let verification = db::get_config_value(&conn, "verification_hash")?
        .ok_or_else(|| AppError::Crypto("Missing verification token".into()))?;

    let salt = B64
        .decode(&salt_b64)
        .map_err(|e| AppError::Crypto(format!("Invalid salt encoding: {e}")))?;
    let key = crypto::derive_key(&password, &salt)?;

    if !crypto::verify_key(&key, &verification)? {
        return Err(AppError::InvalidPassword);
    }

    state.set_master_key(Some(key))?;
    Ok(SecurityStatus {
        initialized: true,
        mode: Some(SecurityMode::MasterPassword),
        unlocked: true,
    })
}

#[tauri::command]
pub fn lock_vault(state: State<'_, AppState>) -> AppResult<SecurityStatus> {
    let conn = state
        .db
        .lock()
        .map_err(|_| AppError::Crypto("DB lock poisoned".into()))?;
    let mode = db::get_security_mode(&conn)?;
    if mode == Some(SecurityMode::MasterPassword) {
        state.set_master_key(None)?;
    }
    Ok(SecurityStatus {
        initialized: mode.is_some(),
        mode,
        unlocked: state.is_unlocked(),
    })
}

#[tauri::command]
pub fn change_security_mode(
    state: State<'_, AppState>,
    target_mode: SecurityMode,
    current_password: Option<String>,
    new_password: Option<String>,
) -> AppResult<SecurityStatus> {
    let old_key = state.get_master_key()?;
    let mut conn = state
        .db
        .lock()
        .map_err(|_| AppError::Crypto("DB lock poisoned".into()))?;

    let current_mode = db::get_security_mode(&conn)?.ok_or(AppError::SecurityNotInitialized)?;

    if current_mode == SecurityMode::MasterPassword {
        let pwd = current_password.ok_or(AppError::InvalidPassword)?;
        let salt_b64 = db::get_config_value(&conn, "salt")?
            .ok_or_else(|| AppError::Crypto("Missing salt".into()))?;
        let verification = db::get_config_value(&conn, "verification_hash")?
            .ok_or_else(|| AppError::Crypto("Missing verification token".into()))?;
        let salt = B64
            .decode(&salt_b64)
            .map_err(|e| AppError::Crypto(format!("Invalid salt: {e}")))?;
        let check_key = crypto::derive_key(&pwd, &salt)?;
        if !crypto::verify_key(&check_key, &verification)? {
            return Err(AppError::InvalidPassword);
        }
    }

    let (new_key, new_salt_b64) = match target_mode {
        SecurityMode::MasterPassword => {
            let pwd = new_password.unwrap_or_default();
            if pwd.len() < 4 {
                return Err(AppError::Validation(
                    "New master password must be at least 4 characters long".into(),
                ));
            }
            let salt = crypto::generate_salt();
            let key = crypto::derive_key(&pwd, &salt)?;
            (key, Some(B64.encode(salt)))
        }
        SecurityMode::Transparent => (MasterKey::random(), None),
    };

    let new_verification = crypto::create_verification_token(&new_key)?;
    let rows = db::list_credential_rows(&conn)?;

    let tx = conn.transaction()?;
    for mut row in rows {
        let plaintext = crypto::decrypt(&old_key, &row.encrypted_secret, &row.nonce)?;
        let (new_ct, new_nonce) = crypto::encrypt(&new_key, &plaintext)?;
        row.encrypted_secret = new_ct;
        row.nonce = new_nonce;
        db::update_credential_row(&tx, &row)?;
    }

    db::set_config_value(&tx, "security_mode", target_mode.as_str())?;
    db::set_config_value(&tx, "verification_hash", &new_verification)?;
    if let Some(ref salt_b64) = new_salt_b64 {
        db::set_config_value(&tx, "salt", salt_b64)?;
    } else {
        db::delete_config_value(&tx, "salt")?;
    }

    if target_mode == SecurityMode::Transparent {
        crypto::save_transparent_key(&state.app_data_dir, &new_key)?;
    }
    tx.commit()?;

    if target_mode == SecurityMode::MasterPassword {
        let _ = crypto::remove_transparent_key(&state.app_data_dir);
    }

    state.set_master_key(Some(new_key))?;

    Ok(SecurityStatus {
        initialized: true,
        mode: Some(target_mode),
        unlocked: true,
    })
}
