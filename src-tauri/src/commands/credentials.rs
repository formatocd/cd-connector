use chrono::Utc;
use tauri::State;
use uuid::Uuid;

use crate::crypto;
use crate::db;
use crate::error::{AppError, AppResult};
use crate::models::{
    AuthType, CredentialInput, CredentialRow, CredentialSecretPayload, CredentialSummary,
};
use crate::state::AppState;

fn row_to_summary(row: &CredentialRow, key: &crypto::MasterKey) -> CredentialSummary {
    let has_secret = crypto::decrypt(key, &row.encrypted_secret, &row.nonce)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<CredentialSecretPayload>(&bytes).ok())
        .map(|p| {
            p.password.as_deref().is_some_and(|s| !s.is_empty())
                || p.private_key.as_deref().is_some_and(|s| !s.is_empty())
                || row.auth_type == AuthType::SshAgent
        })
        .unwrap_or(false);

    CredentialSummary {
        id: row.id.clone(),
        name: row.name.clone(),
        username: row.username.clone(),
        auth_type: row.auth_type,
        has_secret,
        has_passphrase: row.has_passphrase,
        reusable: row.reusable,
        created_at: row.created_at.clone(),
        updated_at: row.updated_at.clone(),
    }
}

#[tauri::command]
pub fn list_credentials(state: State<'_, AppState>) -> AppResult<Vec<CredentialSummary>> {
    let key = state.get_master_key()?;
    let conn = state
        .db
        .lock()
        .map_err(|_| AppError::Crypto("DB lock poisoned".into()))?;
    let rows = db::list_credential_rows(&conn)?;
    Ok(rows.iter().map(|r| row_to_summary(r, &key)).collect())
}

#[tauri::command]
pub fn create_credential(
    state: State<'_, AppState>,
    input: CredentialInput,
) -> AppResult<CredentialSummary> {
    let name = input.name.trim().to_string();
    if name.is_empty() {
        return Err(AppError::Validation("Credential name is required".into()));
    }
    let key = state.get_master_key()?;

    let conn = state
        .db
        .lock()
        .map_err(|_| AppError::Crypto("DB lock poisoned".into()))?;

    let (encrypted_secret, nonce, has_passphrase) = if input.keep_existing_secret.unwrap_or(false) {
        if let Some(ref source_id) = input.clone_from_credential_id {
            let source = db::get_credential_row(&conn, source_id)?
                .ok_or_else(|| AppError::NotFound(format!("Credential {source_id}")))?;
            if source.auth_type == input.auth_type {
                let plain = crypto::decrypt(&key, &source.encrypted_secret, &source.nonce)?;
                let (ct, n) = crypto::encrypt(&key, &plain)?;
                (ct, n, source.has_passphrase)
            } else {
                let payload = CredentialSecretPayload {
                    password: input.password.filter(|s| !s.is_empty()),
                    private_key: input.private_key.filter(|s| !s.is_empty()),
                    passphrase: input.passphrase.filter(|s| !s.is_empty()),
                    tls_cert: None,
                    tls_key: None,
                };
                let hp = payload.passphrase.is_some();
                let serialized = serde_json::to_vec(&payload)?;
                let (ct, n) = crypto::encrypt(&key, &serialized)?;
                (ct, n, hp)
            }
        } else {
            let payload = CredentialSecretPayload {
                password: input.password.filter(|s| !s.is_empty()),
                private_key: input.private_key.filter(|s| !s.is_empty()),
                passphrase: input.passphrase.filter(|s| !s.is_empty()),
                tls_cert: None,
                tls_key: None,
            };
            let hp = payload.passphrase.is_some();
            let serialized = serde_json::to_vec(&payload)?;
            let (ct, n) = crypto::encrypt(&key, &serialized)?;
            (ct, n, hp)
        }
    } else {
        let payload = CredentialSecretPayload {
            password: input.password.filter(|s| !s.is_empty()),
            private_key: input.private_key.filter(|s| !s.is_empty()),
            passphrase: input.passphrase.filter(|s| !s.is_empty()),
            tls_cert: None,
            tls_key: None,
        };
        let hp = payload.passphrase.is_some();
        let serialized = serde_json::to_vec(&payload)?;
        let (ct, n) = crypto::encrypt(&key, &serialized)?;
        (ct, n, hp)
    };

    let now = Utc::now().to_rfc3339();
    let row = CredentialRow {
        id: Uuid::new_v4().to_string(),
        name,
        username: input.username.trim().to_string(),
        auth_type: input.auth_type,
        encrypted_secret,
        nonce,
        has_passphrase,
        reusable: input.reusable.unwrap_or(true),
        created_at: now.clone(),
        updated_at: now,
    };

    db::insert_credential(&conn, &row)?;
    Ok(row_to_summary(&row, &key))
}

#[tauri::command]
pub fn update_credential(
    state: State<'_, AppState>,
    id: String,
    input: CredentialInput,
) -> AppResult<CredentialSummary> {
    let name = input.name.trim().to_string();
    if name.is_empty() {
        return Err(AppError::Validation("Credential name is required".into()));
    }
    let key = state.get_master_key()?;
    let conn = state
        .db
        .lock()
        .map_err(|_| AppError::Crypto("DB lock poisoned".into()))?;

    let existing = db::get_credential_row(&conn, &id)?
        .ok_or_else(|| AppError::NotFound(format!("Credential {id}")))?;

    let (encrypted_secret, nonce, has_passphrase) = if input.keep_existing_secret.unwrap_or(false)
        && existing.auth_type == input.auth_type
    {
        (
            existing.encrypted_secret,
            existing.nonce,
            existing.has_passphrase,
        )
    } else {
        let payload = CredentialSecretPayload {
            password: input.password.filter(|s| !s.is_empty()),
            private_key: input.private_key.filter(|s| !s.is_empty()),
            passphrase: input.passphrase.filter(|s| !s.is_empty()),
            tls_cert: None,
            tls_key: None,
        };
        let hp = payload.passphrase.is_some();
        let serialized = serde_json::to_vec(&payload)?;
        let (ct, n) = crypto::encrypt(&key, &serialized)?;
        (ct, n, hp)
    };

    let updated = CredentialRow {
        id,
        name,
        username: input.username.trim().to_string(),
        auth_type: input.auth_type,
        encrypted_secret,
        nonce,
        has_passphrase,
        reusable: input.reusable.unwrap_or(existing.reusable),
        created_at: existing.created_at,
        updated_at: Utc::now().to_rfc3339(),
    };

    db::update_credential_row(&conn, &updated)?;
    Ok(row_to_summary(&updated, &key))
}

#[tauri::command]
pub fn delete_credential(state: State<'_, AppState>, id: String) -> AppResult<()> {
    let _ = state.get_master_key()?;
    let conn = state
        .db
        .lock()
        .map_err(|_| AppError::Crypto("DB lock poisoned".into()))?;
    db::delete_credential(&conn, &id)
}
