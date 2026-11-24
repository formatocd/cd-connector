use chrono::Utc;
use std::collections::HashMap;
use tauri::State;
use uuid::Uuid;

use crate::db;
use crate::error::{AppError, AppResult};
use crate::models::{Folder, FolderInput, Session, SessionInput};
use crate::state::AppState;

// --- Folders ---

#[tauri::command]
pub fn list_folders(state: State<'_, AppState>) -> AppResult<Vec<Folder>> {
    let _ = state.get_master_key()?;
    let conn = state
        .db
        .lock()
        .map_err(|_| AppError::Crypto("DB lock poisoned".into()))?;
    db::list_folders(&conn)
}

#[tauri::command]
pub fn create_folder(state: State<'_, AppState>, input: FolderInput) -> AppResult<Folder> {
    let _ = state.get_master_key()?;
    let name = input.name.trim().to_string();
    if name.is_empty() {
        return Err(AppError::Validation("Folder name is required".into()));
    }
    let folder = Folder {
        id: Uuid::new_v4().to_string(),
        parent_id: input.parent_id,
        name,
        sort_order: input.sort_order.unwrap_or(0),
        icon_color: input.icon_color,
    };
    let conn = state
        .db
        .lock()
        .map_err(|_| AppError::Crypto("DB lock poisoned".into()))?;
    db::insert_folder(&conn, &folder)?;
    Ok(folder)
}

#[tauri::command]
pub fn update_folder(
    state: State<'_, AppState>,
    id: String,
    input: FolderInput,
) -> AppResult<Folder> {
    let _ = state.get_master_key()?;
    let name = input.name.trim().to_string();
    if name.is_empty() {
        return Err(AppError::Validation("Folder name is required".into()));
    }

    let conn = state
        .db
        .lock()
        .map_err(|_| AppError::Crypto("DB lock poisoned".into()))?;

    // Prevent circular parenting
    if let Some(ref new_parent) = input.parent_id {
        if new_parent == &id {
            return Err(AppError::Validation(
                "A folder cannot be moved into itself".into(),
            ));
        }
        let all = db::list_folders(&conn)?;
        let parent_map: HashMap<String, Option<String>> =
            all.into_iter().map(|f| (f.id, f.parent_id)).collect();
        let mut cursor = Some(new_parent.clone());
        while let Some(curr) = cursor {
            if curr == id {
                return Err(AppError::Validation(
                    "Cannot move a folder into one of its descendants".into(),
                ));
            }
            cursor = parent_map.get(&curr).cloned().flatten();
        }
    }

    let folder = Folder {
        id,
        parent_id: input.parent_id,
        name,
        sort_order: input.sort_order.unwrap_or(0),
        icon_color: input.icon_color,
    };
    db::update_folder(&conn, &folder)?;
    Ok(folder)
}

#[tauri::command]
pub fn delete_folder(
    state: State<'_, AppState>,
    id: String,
    delete_children: Option<bool>,
) -> AppResult<()> {
    let _ = state.get_master_key()?;
    let mut conn = state
        .db
        .lock()
        .map_err(|_| AppError::Crypto("DB lock poisoned".into()))?;
    db::delete_folder(&mut conn, &id, delete_children.unwrap_or(false))
}

// --- Sessions ---

#[tauri::command]
pub fn list_sessions(state: State<'_, AppState>) -> AppResult<Vec<Session>> {
    let _ = state.get_master_key()?;
    let conn = state
        .db
        .lock()
        .map_err(|_| AppError::Crypto("DB lock poisoned".into()))?;
    db::list_sessions(&conn)
}

#[tauri::command]
pub fn create_session(state: State<'_, AppState>, input: SessionInput) -> AppResult<Session> {
    let _ = state.get_master_key()?;
    let name = input.name.trim().to_string();
    let host = input.host.trim().to_string();
    if name.is_empty() || host.is_empty() {
        return Err(AppError::Validation(
            "Session name and host are required".into(),
        ));
    }

    let session = Session {
        id: Uuid::new_v4().to_string(),
        folder_id: input.folder_id,
        credential_id: input.credential_id,
        name,
        protocol: input.protocol,
        host,
        port: input.port.unwrap_or_else(|| input.protocol.default_port()),
        remote_initial_path: input.remote_initial_path.unwrap_or_default(),
        local_initial_path: input.local_initial_path.unwrap_or_default(),
        passive_mode: input.passive_mode.unwrap_or(true),
        accept_invalid_certs: input.accept_invalid_certs.unwrap_or(false),
        sort_order: input.sort_order.unwrap_or(0),
        icon_color: input.icon_color,
        last_opened_at: None,
    };

    let conn = state
        .db
        .lock()
        .map_err(|_| AppError::Crypto("DB lock poisoned".into()))?;
    db::insert_session(&conn, &session)?;
    Ok(session)
}

#[tauri::command]
pub fn update_session(
    state: State<'_, AppState>,
    id: String,
    input: SessionInput,
) -> AppResult<Session> {
    let _ = state.get_master_key()?;
    let name = input.name.trim().to_string();
    let host = input.host.trim().to_string();
    if name.is_empty() || host.is_empty() {
        return Err(AppError::Validation(
            "Session name and host are required".into(),
        ));
    }

    let session = Session {
        id,
        folder_id: input.folder_id,
        credential_id: input.credential_id,
        name,
        protocol: input.protocol,
        host,
        port: input.port.unwrap_or_else(|| input.protocol.default_port()),
        remote_initial_path: input.remote_initial_path.unwrap_or_default(),
        local_initial_path: input.local_initial_path.unwrap_or_default(),
        passive_mode: input.passive_mode.unwrap_or(true),
        accept_invalid_certs: input.accept_invalid_certs.unwrap_or(false),
        sort_order: input.sort_order.unwrap_or(0),
        icon_color: input.icon_color,
        last_opened_at: None,
    };

    let conn = state
        .db
        .lock()
        .map_err(|_| AppError::Crypto("DB lock poisoned".into()))?;
    db::update_session(&conn, &session)?;
    Ok(session)
}

#[tauri::command]
pub fn delete_session(state: State<'_, AppState>, id: String) -> AppResult<()> {
    let _ = state.get_master_key()?;
    let conn = state
        .db
        .lock()
        .map_err(|_| AppError::Crypto("DB lock poisoned".into()))?;
    db::delete_session(&conn, &id)
}

#[tauri::command]
pub fn mark_session_opened(state: State<'_, AppState>, id: String) -> AppResult<String> {
    let _ = state.get_master_key()?;
    let now = Utc::now().to_rfc3339();
    let conn = state
        .db
        .lock()
        .map_err(|_| AppError::Crypto("DB lock poisoned".into()))?;
    db::touch_session_last_opened(&conn, &id, &now)?;
    Ok(now)
}

#[tauri::command]
pub fn reorder_tree_items(
    state: State<'_, AppState>,
    kind: String,
    parent_id: Option<String>,
    ordered_ids: Vec<String>,
) -> AppResult<()> {
    let _ = state.get_master_key()?;
    let mut conn = state
        .db
        .lock()
        .map_err(|_| AppError::Crypto("DB lock poisoned".into()))?;

    if kind == "folder" {
        if let Some(ref new_parent) = parent_id {
            let all = db::list_folders(&conn)?;
            let parent_map: HashMap<String, Option<String>> =
                all.into_iter().map(|f| (f.id, f.parent_id)).collect();
            for id in &ordered_ids {
                if new_parent == id {
                    return Err(AppError::Validation(
                        "A folder cannot be moved into itself".into(),
                    ));
                }
                let mut cursor = Some(new_parent.clone());
                while let Some(curr) = cursor {
                    if &curr == id {
                        return Err(AppError::Validation(
                            "Cannot move a folder into one of its descendants".into(),
                        ));
                    }
                    cursor = parent_map.get(&curr).cloned().flatten();
                }
            }
        }
    }

    let tx = conn.transaction()?;
    match kind.as_str() {
        "folder" => {
            for (idx, id) in ordered_ids.iter().enumerate() {
                tx.execute(
                    "UPDATE folders SET parent_id = ?1, sort_order = ?2 WHERE id = ?3",
                    rusqlite::params![parent_id, idx as i64, id],
                )?;
            }
        }
        "session" => {
            for (idx, id) in ordered_ids.iter().enumerate() {
                tx.execute(
                    "UPDATE sessions SET folder_id = ?1, sort_order = ?2 WHERE id = ?3",
                    rusqlite::params![parent_id, idx as i64, id],
                )?;
            }
        }
        _ => {
            return Err(AppError::Validation(format!("Invalid tree item kind: {kind}")));
        }
    }
    tx.commit()?;
    Ok(())
}
