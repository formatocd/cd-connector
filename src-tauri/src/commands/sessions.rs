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

#[derive(serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TreeItemKind {
    Folder,
    Session,
}

fn validate_no_folder_cycle(
    folders: &[Folder],
    folder_id: &str,
    new_parent_id: &str,
) -> AppResult<()> {
    if new_parent_id == folder_id {
        return Err(AppError::Validation(
            "A folder cannot be moved into itself".into(),
        ));
    }
    let parent_map: HashMap<&str, Option<&str>> = folders
        .iter()
        .map(|f| (f.id.as_str(), f.parent_id.as_deref()))
        .collect();
    let mut cursor = Some(new_parent_id);
    while let Some(curr) = cursor {
        if curr == folder_id {
            return Err(AppError::Validation(
                "Cannot move a folder into one of its descendants".into(),
            ));
        }
        cursor = parent_map.get(curr).copied().flatten();
    }
    Ok(())
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

    let conn = state.db_lock()?;

    // Prevent circular parenting
    if let Some(ref new_parent) = input.parent_id {
        let all = db::list_folders(&conn)?;
        validate_no_folder_cycle(&all, &id, new_parent)?;
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

    let conn = state
        .db
        .lock()
        .map_err(|_| AppError::Crypto("DB lock poisoned".into()))?;
    let existing_last_opened = db::list_sessions(&conn)?
        .into_iter()
        .find(|s| s.id == id)
        .and_then(|s| s.last_opened_at);

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
        last_opened_at: existing_last_opened,
    };

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
    kind: TreeItemKind,
    parent_id: Option<String>,
    ordered_ids: Vec<String>,
) -> AppResult<()> {
    let _ = state.get_master_key()?;
    let mut conn = state.db_lock()?;

    if matches!(kind, TreeItemKind::Folder) {
        if let Some(ref new_parent) = parent_id {
            let all = db::list_folders(&conn)?;
            for id in &ordered_ids {
                validate_no_folder_cycle(&all, id, new_parent)?;
            }
        }
    }

    let tx = conn.transaction()?;
    match kind {
        TreeItemKind::Folder => {
            for (idx, id) in ordered_ids.iter().enumerate() {
                tx.execute(
                    "UPDATE folders SET parent_id = ?1, sort_order = ?2 WHERE id = ?3",
                    rusqlite::params![parent_id, idx as i64, id],
                )?;
            }
        }
        TreeItemKind::Session => {
            for (idx, id) in ordered_ids.iter().enumerate() {
                tx.execute(
                    "UPDATE sessions SET folder_id = ?1, sort_order = ?2 WHERE id = ?3",
                    rusqlite::params![parent_id, idx as i64, id],
                )?;
            }
        }
    }
    tx.commit()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn folder(id: &str, parent_id: Option<&str>) -> Folder {
        Folder {
            id: id.to_string(),
            parent_id: parent_id.map(str::to_string),
            name: id.to_string(),
            sort_order: 0,
            icon_color: None,
        }
    }

    #[test]
    fn validate_no_folder_cycle_rejects_self_and_descendants() {
        let folders = vec![
            folder("root", None),
            folder("child", Some("root")),
            folder("grandchild", Some("child")),
            folder("sibling", None),
        ];
        assert!(validate_no_folder_cycle(&folders, "root", "root").is_err());
        assert!(validate_no_folder_cycle(&folders, "root", "child").is_err());
        assert!(validate_no_folder_cycle(&folders, "root", "grandchild").is_err());
        assert!(validate_no_folder_cycle(&folders, "child", "sibling").is_ok());
    }
}
