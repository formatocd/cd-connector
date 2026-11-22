use base64::{engine::general_purpose::STANDARD as B64, Engine};
use chrono::Utc;
use std::collections::{HashMap, HashSet};
use tauri::State;
use uuid::Uuid;

use crate::crypto;
use crate::db;
use crate::error::{AppError, AppResult};
use crate::models::{
    CredentialRow, CredentialSecretPayload, ExportBundle, ExportCredential, ExportFolder,
    ExportOptions, ExportSession, ExportSummary, Folder, ImportAction, ImportCommitRequest,
    ImportPreview, ImportPreviewCredential, ImportPreviewFolder, ImportPreviewSession,
    ImportResult, SecurityMode, SecurityStatus, Session,
};
use crate::state::AppState;

#[tauri::command]
pub fn export_data(state: State<'_, AppState>, options: ExportOptions) -> AppResult<String> {
    let local_key = state.get_master_key()?;
    let conn = state
        .db
        .lock()
        .map_err(|_| AppError::Crypto("DB lock poisoned".into()))?;

    let encrypted = options.include_secrets;
    let (export_key, salt_b64, verification_token) = if encrypted {
        let pwd = options.export_password.unwrap_or_default();
        if pwd.len() < 4 {
            return Err(AppError::Validation(
                "Export encryption password must be at least 4 characters long".into(),
            ));
        }
        let salt = crypto::generate_salt();
        let key = crypto::derive_key(&pwd, &salt)?;
        let token = crypto::create_verification_token(&key)?;
        (Some(key), Some(B64.encode(salt)), Some(token))
    } else {
        (None, None, None)
    };

    let folders = db::list_folders(&conn)?
        .into_iter()
        .map(|f| ExportFolder {
            id: f.id,
            parent_id: f.parent_id,
            name: f.name,
            sort_order: f.sort_order,
            icon_color: f.icon_color,
        })
        .collect();

    let mut credentials = Vec::new();
    for c in db::list_credential_rows(&conn)? {
        let (encrypted_secret_b64, nonce_b64) = if let Some(ref ekey) = export_key {
            let plain = crypto::decrypt(&local_key, &c.encrypted_secret, &c.nonce)?;
            let (ct, nonce) = crypto::encrypt(ekey, &plain)?;
            (Some(B64.encode(&ct)), Some(B64.encode(&nonce)))
        } else {
            (None, None)
        };

        credentials.push(ExportCredential {
            id: c.id,
            name: c.name,
            username: if options.include_usernames {
                c.username
            } else {
                String::new()
            },
            auth_type: c.auth_type,
            has_passphrase: if encrypted { c.has_passphrase } else { false },
            reusable: c.reusable,
            encrypted_secret_b64,
            nonce_b64,
        });
    }

    let sessions = db::list_sessions(&conn)?
        .into_iter()
        .map(|s| ExportSession {
            id: s.id,
            folder_id: s.folder_id,
            credential_id: s.credential_id,
            name: s.name,
            protocol: s.protocol,
            host: s.host,
            port: s.port,
            remote_initial_path: s.remote_initial_path,
            local_initial_path: s.local_initial_path,
            passive_mode: s.passive_mode,
            accept_invalid_certs: s.accept_invalid_certs,
            sort_order: s.sort_order,
            icon_color: s.icon_color,
        })
        .collect();

    let bundle = ExportBundle {
        version: 1,
        app: "cd-connector".to_string(),
        exported_at: Utc::now().to_rfc3339(),
        encrypted,
        salt_b64,
        verification_token,
        folders,
        credentials,
        sessions,
    };

    Ok(serde_json::to_string_pretty(&bundle)?)
}

fn derive_import_key(
    bundle: &ExportBundle,
    import_password: Option<&str>,
) -> AppResult<Option<crypto::MasterKey>> {
    if !bundle.encrypted {
        return Ok(None);
    }
    let password = import_password
        .filter(|s| !s.is_empty())
        .ok_or_else(|| AppError::Validation("IMPORT_PASSWORD_REQUIRED".into()))?;
    let salt_b64 = bundle
        .salt_b64
        .as_deref()
        .ok_or_else(|| AppError::Validation("Encrypted export is missing salt".into()))?;
    let verification = bundle
        .verification_token
        .as_deref()
        .ok_or_else(|| AppError::Validation("Encrypted export is missing verification token".into()))?;

    let salt = B64
        .decode(salt_b64)
        .map_err(|e| AppError::Crypto(format!("Invalid export salt: {e}")))?;
    let key = crypto::derive_key(password, &salt)?;
    if !crypto::verify_key(&key, verification)? {
        return Err(AppError::InvalidPassword);
    }
    Ok(Some(key))
}

#[tauri::command]
pub fn preview_import(
    state: State<'_, AppState>,
    raw_json: String,
    import_password: Option<String>,
) -> AppResult<ImportPreview> {
    let _ = state.get_master_key()?;
    let bundle: ExportBundle = serde_json::from_str(&raw_json)?;
    let _ = derive_import_key(&bundle, import_password.as_deref())?;

    let conn = state
        .db
        .lock()
        .map_err(|_| AppError::Crypto("DB lock poisoned".into()))?;

    let existing_folders = db::list_folders(&conn)?;
    let existing_creds = db::list_credential_rows(&conn)?;
    let existing_sessions = db::list_sessions(&conn)?;

    let folders = bundle
        .folders
        .into_iter()
        .map(|f| {
            let conflict_id = existing_folders
                .iter()
                .find(|ef| ef.id == f.id || ef.name.eq_ignore_ascii_case(&f.name))
                .map(|ef| ef.id.clone());
            let action = if conflict_id.is_some() {
                ImportAction::Overwrite
            } else {
                ImportAction::Import
            };
            ImportPreviewFolder {
                id: f.id,
                parent_id: f.parent_id,
                name: f.name,
                sort_order: f.sort_order,
                icon_color: f.icon_color,
                conflict_id,
                action,
            }
        })
        .collect();

    let credentials = bundle
        .credentials
        .into_iter()
        .map(|c| {
            let conflict_id = existing_creds
                .iter()
                .find(|ec| ec.id == c.id || ec.name.eq_ignore_ascii_case(&c.name))
                .map(|ec| ec.id.clone());
            let action = if conflict_id.is_some() {
                ImportAction::Overwrite
            } else {
                ImportAction::Import
            };
            ImportPreviewCredential {
                id: c.id,
                name: c.name,
                username: c.username,
                auth_type: c.auth_type,
                has_secret: c.encrypted_secret_b64.is_some() && c.nonce_b64.is_some(),
                has_passphrase: c.has_passphrase,
                reusable: c.reusable,
                conflict_id,
                action,
            }
        })
        .collect();

    let sessions = bundle
        .sessions
        .into_iter()
        .map(|s| {
            let conflict_id = existing_sessions
                .iter()
                .find(|es| {
                    es.id == s.id
                        || (es.name.eq_ignore_ascii_case(&s.name)
                            && es.host.eq_ignore_ascii_case(&s.host))
                })
                .map(|es| es.id.clone());
            let action = if conflict_id.is_some() {
                ImportAction::Overwrite
            } else {
                ImportAction::Import
            };
            ImportPreviewSession {
                id: s.id,
                folder_id: s.folder_id,
                credential_id: s.credential_id,
                name: s.name,
                protocol: s.protocol,
                host: s.host,
                port: s.port,
                remote_initial_path: s.remote_initial_path,
                local_initial_path: s.local_initial_path,
                passive_mode: s.passive_mode,
                accept_invalid_certs: s.accept_invalid_certs,
                sort_order: s.sort_order,
                icon_color: s.icon_color,
                conflict_id,
                action,
            }
        })
        .collect();

    Ok(ImportPreview {
        encrypted: bundle.encrypted,
        folders,
        credentials,
        sessions,
    })
}

#[tauri::command]
pub fn commit_import(
    state: State<'_, AppState>,
    request: ImportCommitRequest,
) -> AppResult<ImportResult> {
    let local_key = state.get_master_key()?;
    let bundle: ExportBundle = serde_json::from_str(&request.raw_json)?;
    let import_key = derive_import_key(&bundle, request.import_password.as_deref())?;

    // Map original credential ID -> decrypted secret payload (if available in encrypted export)
    let mut decrypted_secrets: HashMap<String, CredentialSecretPayload> = HashMap::new();
    if let Some(ref ikey) = import_key {
        for c in &bundle.credentials {
            if let (Some(ct_b64), Some(nonce_b64)) = (&c.encrypted_secret_b64, &c.nonce_b64) {
                let ct = B64
                    .decode(ct_b64)
                    .map_err(|e| AppError::Crypto(format!("Invalid secret encoding: {e}")))?;
                let nonce = B64
                    .decode(nonce_b64)
                    .map_err(|e| AppError::Crypto(format!("Invalid nonce encoding: {e}")))?;
                let plain = crypto::decrypt(ikey, &ct, &nonce)?;
                let payload: CredentialSecretPayload = serde_json::from_slice(&plain)?;
                decrypted_secrets.insert(c.id.clone(), payload);
            }
        }
    }

    let mut conn = state
        .db
        .lock()
        .map_err(|_| AppError::Crypto("DB lock poisoned".into()))?;
    let existing_folder_ids: HashSet<String> = db::list_folders(&conn)?
        .into_iter()
        .map(|f| f.id)
        .collect();
    let existing_cred_ids: HashSet<String> = db::list_credential_rows(&conn)?
        .into_iter()
        .map(|c| c.id)
        .collect();
    let existing_session_ids: HashSet<String> = db::list_sessions(&conn)?
        .into_iter()
        .map(|s| s.id)
        .collect();

    let tx = conn.transaction()?;

    // 1. Folders (resolve ID mapping and insert parents before children)
    let mut folder_id_map: HashMap<String, String> = HashMap::new();
    let mut folders_to_apply: Vec<ImportPreviewFolder> = Vec::new();
    for f in request.folders {
        match f.action {
            ImportAction::Skip => {
                if let Some(cid) = f.conflict_id {
                    folder_id_map.insert(f.id, cid);
                }
            }
            ImportAction::Overwrite => {
                let target_id = f.conflict_id.clone().unwrap_or_else(|| f.id.clone());
                folder_id_map.insert(f.id.clone(), target_id);
                folders_to_apply.push(f);
            }
            ImportAction::Import => {
                let target_id = if existing_folder_ids.contains(&f.id) {
                    Uuid::new_v4().to_string()
                } else {
                    f.id.clone()
                };
                folder_id_map.insert(f.id.clone(), target_id);
                folders_to_apply.push(f);
            }
        }
    }

    let mut inserted_folders: HashSet<String> = existing_folder_ids.clone();
    let mut remaining = folders_to_apply;
    let mut folders_imported = 0usize;
    let max_passes = remaining.len() + 1;
    for _ in 0..max_passes {
        if remaining.is_empty() {
            break;
        }
        let mut next_remaining = Vec::new();
        for f in remaining {
            let mapped_parent = f
                .parent_id
                .as_ref()
                .and_then(|pid| folder_id_map.get(pid).cloned());
            let parent_ready = mapped_parent
                .as_ref()
                .map(|pid| inserted_folders.contains(pid))
                .unwrap_or(true);
            if !parent_ready {
                next_remaining.push(f);
                continue;
            }
            let target_id = folder_id_map.get(&f.id).cloned().unwrap_or(f.id);
            let folder = Folder {
                id: target_id.clone(),
                parent_id: mapped_parent,
                name: f.name.trim().to_string(),
                sort_order: f.sort_order,
                icon_color: f.icon_color,
            };
            if existing_folder_ids.contains(&target_id) {
                db::update_folder(&tx, &folder)?;
            } else {
                db::insert_folder(&tx, &folder)?;
            }
            inserted_folders.insert(target_id);
            folders_imported += 1;
        }
        remaining = next_remaining;
    }

    // 2. Credentials
    let mut cred_id_map: HashMap<String, String> = HashMap::new();
    let mut credentials_imported = 0usize;
    let now = Utc::now().to_rfc3339();

    for c in request.credentials {
        match c.action {
            ImportAction::Skip => {
                if let Some(cid) = c.conflict_id {
                    cred_id_map.insert(c.id, cid);
                }
            }
            ImportAction::Overwrite | ImportAction::Import => {
                let target_id = if c.action == ImportAction::Overwrite {
                    c.conflict_id.clone().unwrap_or_else(|| c.id.clone())
                } else if existing_cred_ids.contains(&c.id) {
                    Uuid::new_v4().to_string()
                } else {
                    c.id.clone()
                };
                cred_id_map.insert(c.id.clone(), target_id.clone());

                let payload = decrypted_secrets
                    .get(&c.id)
                    .cloned()
                    .unwrap_or_default();
                let serialized = serde_json::to_vec(&payload)?;
                let (ct, nonce) = crypto::encrypt(&local_key, &serialized)?;

                let row = CredentialRow {
                    id: target_id.clone(),
                    name: c.name.trim().to_string(),
                    username: c.username.trim().to_string(),
                    auth_type: c.auth_type,
                    encrypted_secret: ct,
                    nonce,
                    has_passphrase: payload.passphrase.is_some(),
                    reusable: c.reusable,
                    created_at: now.clone(),
                    updated_at: now.clone(),
                };
                if existing_cred_ids.contains(&target_id) {
                    db::update_credential_row(&tx, &row)?;
                } else {
                    db::insert_credential(&tx, &row)?;
                }
                credentials_imported += 1;
            }
        }
    }

    // 3. Sessions
    let mut sessions_imported = 0usize;
    for s in request.sessions {
        if s.action == ImportAction::Skip {
            continue;
        }
        let target_id = if s.action == ImportAction::Overwrite {
            s.conflict_id.clone().unwrap_or_else(|| s.id.clone())
        } else if existing_session_ids.contains(&s.id) {
            Uuid::new_v4().to_string()
        } else {
            s.id.clone()
        };

        let mapped_folder = s
            .folder_id
            .as_ref()
            .and_then(|fid| folder_id_map.get(fid).cloned())
            .filter(|fid| inserted_folders.contains(fid));
        let mapped_cred = s
            .credential_id
            .as_ref()
            .and_then(|cid| cred_id_map.get(cid).cloned());

        let session = Session {
            id: target_id.clone(),
            folder_id: mapped_folder,
            credential_id: mapped_cred,
            name: s.name.trim().to_string(),
            protocol: s.protocol,
            host: s.host.trim().to_string(),
            port: s.port,
            remote_initial_path: s.remote_initial_path,
            local_initial_path: s.local_initial_path,
            passive_mode: s.passive_mode,
            accept_invalid_certs: s.accept_invalid_certs,
            sort_order: s.sort_order,
            icon_color: s.icon_color,
            last_opened_at: None,
        };

        if existing_session_ids.contains(&target_id) {
            db::update_session(&tx, &session)?;
        } else {
            db::insert_session(&tx, &session)?;
        }
        sessions_imported += 1;
    }

    tx.commit()?;

    Ok(ImportResult {
        folders_imported,
        credentials_imported,
        sessions_imported,
    })
}

#[tauri::command]
pub fn inspect_export_bundle(raw_json: String) -> AppResult<ExportSummary> {
    let bundle: ExportBundle = serde_json::from_str(&raw_json)?;
    if bundle.app != "cd-connector" {
        return Err(AppError::Validation(
            "Invalid backup file: not a CD Connector export".into(),
        ));
    }
    Ok(ExportSummary {
        encrypted: bundle.encrypted,
        exported_at: bundle.exported_at,
        folders_count: bundle.folders.len(),
        credentials_count: bundle.credentials.len(),
        sessions_count: bundle.sessions.len(),
    })
}

#[tauri::command]
pub fn setup_from_json(
    state: State<'_, AppState>,
    raw_json: String,
    import_password: Option<String>,
    mode: SecurityMode,
    master_password: Option<String>,
) -> AppResult<SecurityStatus> {
    let bundle: ExportBundle = serde_json::from_str(&raw_json)?;
    if bundle.app != "cd-connector" {
        return Err(AppError::Validation(
            "Invalid backup file: not a CD Connector export".into(),
        ));
    }

    // 1. Validate & decrypt incoming secrets BEFORE modifying local DB
    let import_key = derive_import_key(&bundle, import_password.as_deref())?;
    let mut decrypted_secrets: HashMap<String, CredentialSecretPayload> = HashMap::new();
    if let Some(ref ikey) = import_key {
        for c in &bundle.credentials {
            if let (Some(ct_b64), Some(nonce_b64)) = (&c.encrypted_secret_b64, &c.nonce_b64) {
                let ct = B64
                    .decode(ct_b64)
                    .map_err(|e| AppError::Crypto(format!("Invalid secret encoding: {e}")))?;
                let nonce = B64
                    .decode(nonce_b64)
                    .map_err(|e| AppError::Crypto(format!("Invalid nonce encoding: {e}")))?;
                let plain = crypto::decrypt(ikey, &ct, &nonce)?;
                let payload: CredentialSecretPayload = serde_json::from_slice(&plain)?;
                decrypted_secrets.insert(c.id.clone(), payload);
            }
        }
    }

    // 2. Prepare new local vault key & config
    let mut conn = state
        .db
        .lock()
        .map_err(|_| AppError::Crypto("DB lock poisoned".into()))?;
    if db::get_security_mode(&conn)?.is_some() {
        return Err(AppError::Validation(
            "Security mode is already initialized".into(),
        ));
    }

    let (local_key, salt_b64) = match mode {
        SecurityMode::MasterPassword => {
            let pwd = master_password.unwrap_or_default();
            if pwd.len() < 4 {
                return Err(AppError::Validation(
                    "Master password must be at least 4 characters long".into(),
                ));
            }
            let salt = crypto::generate_salt();
            let key = crypto::derive_key(&pwd, &salt)?;
            (key, Some(B64.encode(salt)))
        }
        SecurityMode::Transparent => (crypto::MasterKey::random(), None),
    };
    let verification = crypto::create_verification_token(&local_key)?;

    // 3. Transactionally initialize security config and populate DB from JSON
    let tx = conn.transaction()?;

    db::set_config_value(&tx, "security_mode", mode.as_str())?;
    db::set_config_value(&tx, "verification_hash", &verification)?;
    if let Some(ref s) = salt_b64 {
        db::set_config_value(&tx, "salt", s)?;
    } else {
        db::delete_config_value(&tx, "salt")?;
    }

    // Insert folders topologically (parents before children)
    let mut inserted_folders: HashSet<String> = HashSet::new();
    let mut remaining_folders = bundle.folders;
    let max_passes = remaining_folders.len() + 1;
    for _ in 0..max_passes {
        if remaining_folders.is_empty() {
            break;
        }
        let mut next_remaining = Vec::new();
        for f in remaining_folders {
            let parent_ready = f
                .parent_id
                .as_ref()
                .map(|pid| inserted_folders.contains(pid))
                .unwrap_or(true);
            if !parent_ready {
                next_remaining.push(f);
                continue;
            }
            let folder = Folder {
                id: f.id.clone(),
                parent_id: f.parent_id,
                name: f.name.trim().to_string(),
                sort_order: f.sort_order,
                icon_color: f.icon_color,
            };
            db::insert_folder(&tx, &folder)?;
            inserted_folders.insert(f.id);
        }
        remaining_folders = next_remaining;
    }

    // Insert credentials re-encrypted with local_key
    let now = Utc::now().to_rfc3339();
    let mut inserted_creds: HashSet<String> = HashSet::new();
    for c in bundle.credentials {
        let payload = decrypted_secrets.get(&c.id).cloned().unwrap_or_default();
        let serialized = serde_json::to_vec(&payload)?;
        let (ct, nonce) = crypto::encrypt(&local_key, &serialized)?;
        let row = CredentialRow {
            id: c.id.clone(),
            name: c.name.trim().to_string(),
            username: c.username.trim().to_string(),
            auth_type: c.auth_type,
            encrypted_secret: ct,
            nonce,
            has_passphrase: payload.passphrase.is_some(),
            reusable: c.reusable,
            created_at: now.clone(),
            updated_at: now.clone(),
        };
        db::insert_credential(&tx, &row)?;
        inserted_creds.insert(c.id);
    }

    // Insert sessions
    for s in bundle.sessions {
        let session = Session {
            id: s.id,
            folder_id: s.folder_id.filter(|fid| inserted_folders.contains(fid)),
            credential_id: s.credential_id.filter(|cid| inserted_creds.contains(cid)),
            name: s.name.trim().to_string(),
            protocol: s.protocol,
            host: s.host.trim().to_string(),
            port: s.port,
            remote_initial_path: s.remote_initial_path,
            local_initial_path: s.local_initial_path,
            passive_mode: s.passive_mode,
            accept_invalid_certs: s.accept_invalid_certs,
            sort_order: s.sort_order,
            icon_color: s.icon_color,
            last_opened_at: None,
        };
        db::insert_session(&tx, &session)?;
    }

    if mode == SecurityMode::Transparent {
        crypto::save_transparent_key(&state.app_data_dir, &local_key)?;
    }

    tx.commit()?;
    state.set_master_key(Some(local_key))?;

    Ok(SecurityStatus {
        initialized: true,
        mode: Some(mode),
        unlocked: true,
    })
}
