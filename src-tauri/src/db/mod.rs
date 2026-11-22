use rusqlite::{params, Connection, OptionalExtension};
use std::path::Path;

use crate::error::{AppError, AppResult};
use crate::models::{
    AppConfig, AuthType, CredentialRow, Folder, KnownHost, Protocol, SecurityMode, Session,
};

pub fn init_db(db_path: &Path) -> AppResult<Connection> {
    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let conn = Connection::open(db_path)?;
    conn.execute_batch(
        "
        PRAGMA foreign_keys = ON;
        PRAGMA journal_mode = WAL;

        CREATE TABLE IF NOT EXISTS credentials (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            username TEXT NOT NULL,
            auth_type TEXT NOT NULL,
            encrypted_secret BLOB NOT NULL,
            nonce BLOB NOT NULL,
            has_passphrase INTEGER NOT NULL DEFAULT 0,
            reusable INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS folders (
            id TEXT PRIMARY KEY,
            parent_id TEXT NULL REFERENCES folders(id) ON DELETE CASCADE,
            name TEXT NOT NULL,
            sort_order INTEGER NOT NULL DEFAULT 0,
            icon_color TEXT NULL
        );

        CREATE TABLE IF NOT EXISTS sessions (
            id TEXT PRIMARY KEY,
            folder_id TEXT NULL REFERENCES folders(id) ON DELETE SET NULL,
            credential_id TEXT NULL REFERENCES credentials(id) ON DELETE SET NULL,
            name TEXT NOT NULL,
            protocol TEXT NOT NULL,
            host TEXT NOT NULL,
            port INTEGER NOT NULL,
            remote_initial_path TEXT NOT NULL DEFAULT '',
            local_initial_path TEXT NOT NULL DEFAULT '',
            passive_mode INTEGER NOT NULL DEFAULT 1,
            accept_invalid_certs INTEGER NOT NULL DEFAULT 0,
            sort_order INTEGER NOT NULL DEFAULT 0,
            icon_color TEXT NULL,
            last_opened_at TEXT NULL
        );

        CREATE TABLE IF NOT EXISTS known_hosts (
            id TEXT PRIMARY KEY,
            host TEXT NOT NULL,
            port INTEGER NOT NULL,
            key_type TEXT NOT NULL,
            fingerprint TEXT NOT NULL,
            first_seen_at TEXT NOT NULL,
            UNIQUE(host, port, key_type)
        );

        CREATE TABLE IF NOT EXISTS app_config (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
        ",
    )?;

    // Safe migration for existing databases without `reusable` column
    let has_reusable: bool = {
        let mut stmt = conn.prepare("PRAGMA table_info(credentials)")?;
        let cols: Vec<String> = stmt
            .query_map([], |row| row.get::<_, String>(1))?
            .collect::<Result<Vec<_>, _>>()?;
        cols.iter().any(|c| c == "reusable")
    };
    if !has_reusable {
        conn.execute(
            "ALTER TABLE credentials ADD COLUMN reusable INTEGER NOT NULL DEFAULT 1",
            [],
        )?;
    }

    let has_folder_color: bool = {
        let mut stmt = conn.prepare("PRAGMA table_info(folders)")?;
        let cols: Vec<String> = stmt
            .query_map([], |row| row.get::<_, String>(1))?
            .collect::<Result<Vec<_>, _>>()?;
        cols.iter().any(|c| c == "icon_color")
    };
    if !has_folder_color {
        conn.execute("ALTER TABLE folders ADD COLUMN icon_color TEXT NULL", [])?;
    }

    let session_cols: Vec<String> = {
        let mut stmt = conn.prepare("PRAGMA table_info(sessions)")?;
        let rows = stmt
            .query_map([], |row| row.get::<_, String>(1))?
            .collect::<Result<Vec<_>, _>>()?;
        rows
    };
    if !session_cols.iter().any(|c| c == "icon_color") {
        conn.execute("ALTER TABLE sessions ADD COLUMN icon_color TEXT NULL", [])?;
    }
    if !session_cols.iter().any(|c| c == "last_opened_at") {
        conn.execute(
            "ALTER TABLE sessions ADD COLUMN last_opened_at TEXT NULL",
            [],
        )?;
    }

    Ok(conn)
}

// --- app_config helpers ---

pub fn get_config_value(conn: &Connection, key: &str) -> AppResult<Option<String>> {
    let val = conn
        .query_row(
            "SELECT value FROM app_config WHERE key = ?1",
            params![key],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    Ok(val)
}

pub fn set_config_value(conn: &Connection, key: &str, value: &str) -> AppResult<()> {
    conn.execute(
        "INSERT INTO app_config (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )?;
    Ok(())
}

pub fn delete_config_value(conn: &Connection, key: &str) -> AppResult<()> {
    conn.execute("DELETE FROM app_config WHERE key = ?1", params![key])?;
    Ok(())
}

pub fn get_security_mode(conn: &Connection) -> AppResult<Option<SecurityMode>> {
    let val = get_config_value(conn, "security_mode")?;
    Ok(val.and_then(|s| SecurityMode::from_str(&s)))
}

pub fn load_app_config(conn: &Connection) -> AppResult<AppConfig> {
    let mut cfg = AppConfig::default();
    if let Some(v) = get_config_value(conn, "theme")? {
        cfg.theme = v;
    }
    if let Some(v) = get_config_value(conn, "language")? {
        cfg.language = v;
    }
    if let Some(v) = get_config_value(conn, "max_concurrent_transfers")? {
        if let Ok(n) = v.parse() {
            cfg.max_concurrent_transfers = n;
        }
    }
    if let Some(v) = get_config_value(conn, "upload_limit_kbps")? {
        if let Ok(n) = v.parse() {
            cfg.upload_limit_kbps = n;
        }
    }
    if let Some(v) = get_config_value(conn, "download_limit_kbps")? {
        if let Ok(n) = v.parse() {
            cfg.download_limit_kbps = n;
        }
    }
    if let Some(v) = get_config_value(conn, "ui_show_sidebar")? {
        cfg.ui_show_sidebar = v == "true";
    }
    if let Some(v) = get_config_value(conn, "ui_show_local_panel")? {
        cfg.ui_show_local_panel = v == "true";
    }
    if let Some(v) = get_config_value(conn, "ui_show_queue_panel")? {
        cfg.ui_show_queue_panel = v == "true";
    }
    if let Some(v) = get_config_value(conn, "ui_show_command_panel")? {
        cfg.ui_show_command_panel = v == "true";
    }
    if let Some(v) = get_config_value(conn, "terminal_font_family")? {
        if !v.trim().is_empty() {
            cfg.terminal_font_family = v;
        }
    }
    if let Some(v) = get_config_value(conn, "terminal_font_size")? {
        if let Ok(n) = v.parse::<u16>() {
            cfg.terminal_font_size = n.clamp(10, 28);
        }
    }
    if let Some(v) = get_config_value(conn, "terminal_copy_on_select")? {
        cfg.terminal_copy_on_select = v == "true";
    }
    Ok(cfg)
}

pub fn save_app_config(conn: &Connection, cfg: &AppConfig) -> AppResult<()> {
    set_config_value(conn, "theme", &cfg.theme)?;
    set_config_value(conn, "language", &cfg.language)?;
    set_config_value(
        conn,
        "max_concurrent_transfers",
        &cfg.max_concurrent_transfers.to_string(),
    )?;
    set_config_value(conn, "upload_limit_kbps", &cfg.upload_limit_kbps.to_string())?;
    set_config_value(
        conn,
        "download_limit_kbps",
        &cfg.download_limit_kbps.to_string(),
    )?;
    set_config_value(conn, "ui_show_sidebar", &cfg.ui_show_sidebar.to_string())?;
    set_config_value(
        conn,
        "ui_show_local_panel",
        &cfg.ui_show_local_panel.to_string(),
    )?;
    set_config_value(
        conn,
        "ui_show_queue_panel",
        &cfg.ui_show_queue_panel.to_string(),
    )?;
    set_config_value(
        conn,
        "ui_show_command_panel",
        &cfg.ui_show_command_panel.to_string(),
    )?;
    set_config_value(conn, "terminal_font_family", &cfg.terminal_font_family)?;
    set_config_value(
        conn,
        "terminal_font_size",
        &cfg.terminal_font_size.clamp(10, 28).to_string(),
    )?;
    set_config_value(
        conn,
        "terminal_copy_on_select",
        &cfg.terminal_copy_on_select.to_string(),
    )?;
    Ok(())
}

// --- credentials ---

pub fn list_credential_rows(conn: &Connection) -> AppResult<Vec<CredentialRow>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, username, auth_type, encrypted_secret, nonce, has_passphrase, reusable, created_at, updated_at
         FROM credentials ORDER BY name COLLATE NOCASE ASC",
    )?;
    let rows = stmt
        .query_map([], |row| {
            let auth_str: String = row.get(3)?;
            let auth_type = AuthType::from_str(&auth_str).unwrap_or(AuthType::Password);
            Ok(CredentialRow {
                id: row.get(0)?,
                name: row.get(1)?,
                username: row.get(2)?,
                auth_type,
                encrypted_secret: row.get(4)?,
                nonce: row.get(5)?,
                has_passphrase: row.get::<_, i64>(6)? != 0,
                reusable: row.get::<_, i64>(7)? != 0,
                created_at: row.get(8)?,
                updated_at: row.get(9)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

pub fn get_credential_row(conn: &Connection, id: &str) -> AppResult<Option<CredentialRow>> {
    let row = conn
        .query_row(
            "SELECT id, name, username, auth_type, encrypted_secret, nonce, has_passphrase, reusable, created_at, updated_at
             FROM credentials WHERE id = ?1",
            params![id],
            |row| {
                let auth_str: String = row.get(3)?;
                let auth_type = AuthType::from_str(&auth_str).unwrap_or(AuthType::Password);
                Ok(CredentialRow {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    username: row.get(2)?,
                    auth_type,
                    encrypted_secret: row.get(4)?,
                    nonce: row.get(5)?,
                    has_passphrase: row.get::<_, i64>(6)? != 0,
                    reusable: row.get::<_, i64>(7)? != 0,
                    created_at: row.get(8)?,
                    updated_at: row.get(9)?,
                })
            },
        )
        .optional()?;
    Ok(row)
}

pub fn insert_credential(conn: &Connection, row: &CredentialRow) -> AppResult<()> {
    conn.execute(
        "INSERT INTO credentials (id, name, username, auth_type, encrypted_secret, nonce, has_passphrase, reusable, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![
            row.id,
            row.name,
            row.username,
            row.auth_type.as_str(),
            row.encrypted_secret,
            row.nonce,
            if row.has_passphrase { 1 } else { 0 },
            if row.reusable { 1 } else { 0 },
            row.created_at,
            row.updated_at
        ],
    )?;
    Ok(())
}

pub fn update_credential_row(conn: &Connection, row: &CredentialRow) -> AppResult<()> {
    let updated = conn.execute(
        "UPDATE credentials
         SET name = ?2, username = ?3, auth_type = ?4, encrypted_secret = ?5, nonce = ?6, has_passphrase = ?7, reusable = ?8, updated_at = ?9
         WHERE id = ?1",
        params![
            row.id,
            row.name,
            row.username,
            row.auth_type.as_str(),
            row.encrypted_secret,
            row.nonce,
            if row.has_passphrase { 1 } else { 0 },
            if row.reusable { 1 } else { 0 },
            row.updated_at
        ],
    )?;
    if updated == 0 {
        return Err(AppError::NotFound(format!("Credential {}", row.id)));
    }
    Ok(())
}

pub fn delete_credential(conn: &Connection, id: &str) -> AppResult<()> {
    let deleted = conn.execute("DELETE FROM credentials WHERE id = ?1", params![id])?;
    if deleted == 0 {
        return Err(AppError::NotFound(format!("Credential {id}")));
    }
    Ok(())
}

// --- folders ---

pub fn list_folders(conn: &Connection) -> AppResult<Vec<Folder>> {
    let mut stmt = conn.prepare(
        "SELECT id, parent_id, name, sort_order, icon_color FROM folders ORDER BY sort_order ASC, name COLLATE NOCASE ASC",
    )?;
    let rows = stmt
        .query_map([], |row| {
            Ok(Folder {
                id: row.get(0)?,
                parent_id: row.get(1)?,
                name: row.get(2)?,
                sort_order: row.get(3)?,
                icon_color: row.get(4)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

pub fn insert_folder(conn: &Connection, folder: &Folder) -> AppResult<()> {
    conn.execute(
        "INSERT INTO folders (id, parent_id, name, sort_order, icon_color) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![
            folder.id,
            folder.parent_id,
            folder.name,
            folder.sort_order,
            folder.icon_color
        ],
    )?;
    Ok(())
}

pub fn update_folder(conn: &Connection, folder: &Folder) -> AppResult<()> {
    let updated = conn.execute(
        "UPDATE folders SET parent_id = ?2, name = ?3, sort_order = ?4, icon_color = ?5 WHERE id = ?1",
        params![
            folder.id,
            folder.parent_id,
            folder.name,
            folder.sort_order,
            folder.icon_color
        ],
    )?;
    if updated == 0 {
        return Err(AppError::NotFound(format!("Folder {}", folder.id)));
    }
    Ok(())
}

pub fn delete_folder(conn: &mut Connection, id: &str, delete_children: bool) -> AppResult<()> {
    let parent_id: Option<String> = conn
        .query_row(
            "SELECT parent_id FROM folders WHERE id = ?1",
            params![id],
            |row| row.get::<_, Option<String>>(0),
        )
        .optional()?
        .ok_or_else(|| AppError::NotFound(format!("Folder {id}")))?;

    let all_folders = list_folders(conn)?;
    let tx = conn.transaction()?;

    if delete_children {
        // Collect target folder and all descendant folder IDs
        let mut to_delete = vec![id.to_string()];
        let mut idx = 0;
        while idx < to_delete.len() {
            let current = to_delete[idx].clone();
            for f in &all_folders {
                if f.parent_id.as_deref() == Some(current.as_str()) {
                    to_delete.push(f.id.clone());
                }
            }
            idx += 1;
        }

        // Delete all sessions inside these folders (and clean up private credentials)
        for fid in &to_delete {
            let mut stmt =
                tx.prepare("SELECT id, credential_id FROM sessions WHERE folder_id = ?1")?;
            let sess_rows: Vec<(String, Option<String>)> = stmt
                .query_map(params![fid], |row| Ok((row.get(0)?, row.get(1)?)))?
                .collect::<Result<Vec<_>, _>>()?;
            drop(stmt);

            for (sid, cid) in sess_rows {
                tx.execute("DELETE FROM sessions WHERE id = ?1", params![sid])?;
                if let Some(cred_id) = cid {
                    let _ = tx.execute(
                        "DELETE FROM credentials WHERE id = ?1 AND reusable = 0",
                        params![cred_id],
                    );
                }
            }
        }

        tx.execute("DELETE FROM folders WHERE id = ?1", params![id])?;
    } else {
        // Move direct children (subfolders and sessions) up one level to parent_id
        tx.execute(
            "UPDATE folders SET parent_id = ?2 WHERE parent_id = ?1",
            params![id, parent_id],
        )?;
        tx.execute(
            "UPDATE sessions SET folder_id = ?2 WHERE folder_id = ?1",
            params![id, parent_id],
        )?;
        tx.execute("DELETE FROM folders WHERE id = ?1", params![id])?;
    }

    tx.commit()?;
    Ok(())
}

// --- sessions ---

pub fn list_sessions(conn: &Connection) -> AppResult<Vec<Session>> {
    let mut stmt = conn.prepare(
        "SELECT id, folder_id, credential_id, name, protocol, host, port, remote_initial_path, local_initial_path, passive_mode, accept_invalid_certs, sort_order, icon_color, last_opened_at
         FROM sessions ORDER BY sort_order ASC, name COLLATE NOCASE ASC",
    )?;
    let rows = stmt
        .query_map([], |row| {
            let proto_str: String = row.get(4)?;
            let protocol = Protocol::from_str(&proto_str).unwrap_or(Protocol::Sftp);
            Ok(Session {
                id: row.get(0)?,
                folder_id: row.get(1)?,
                credential_id: row.get(2)?,
                name: row.get(3)?,
                protocol,
                host: row.get(5)?,
                port: row.get::<_, i64>(6)? as u16,
                remote_initial_path: row.get(7)?,
                local_initial_path: row.get(8)?,
                passive_mode: row.get::<_, i64>(9)? != 0,
                accept_invalid_certs: row.get::<_, i64>(10)? != 0,
                sort_order: row.get(11)?,
                icon_color: row.get(12)?,
                last_opened_at: row.get(13)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

pub fn insert_session(conn: &Connection, session: &Session) -> AppResult<()> {
    conn.execute(
        "INSERT INTO sessions (id, folder_id, credential_id, name, protocol, host, port, remote_initial_path, local_initial_path, passive_mode, accept_invalid_certs, sort_order, icon_color, last_opened_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
        params![
            session.id,
            session.folder_id,
            session.credential_id,
            session.name,
            session.protocol.as_str(),
            session.host,
            session.port as i64,
            session.remote_initial_path,
            session.local_initial_path,
            if session.passive_mode { 1 } else { 0 },
            if session.accept_invalid_certs { 1 } else { 0 },
            session.sort_order,
            session.icon_color,
            session.last_opened_at,
        ],
    )?;
    Ok(())
}

pub fn update_session(conn: &Connection, session: &Session) -> AppResult<()> {
    let updated = conn.execute(
        "UPDATE sessions
         SET folder_id = ?2, credential_id = ?3, name = ?4, protocol = ?5, host = ?6, port = ?7,
             remote_initial_path = ?8, local_initial_path = ?9, passive_mode = ?10,
             accept_invalid_certs = ?11, sort_order = ?12, icon_color = ?13
         WHERE id = ?1",
        params![
            session.id,
            session.folder_id,
            session.credential_id,
            session.name,
            session.protocol.as_str(),
            session.host,
            session.port as i64,
            session.remote_initial_path,
            session.local_initial_path,
            if session.passive_mode { 1 } else { 0 },
            if session.accept_invalid_certs { 1 } else { 0 },
            session.sort_order,
            session.icon_color,
        ],
    )?;
    if updated == 0 {
        return Err(AppError::NotFound(format!("Session {}", session.id)));
    }
    Ok(())
}

pub fn touch_session_last_opened(conn: &Connection, id: &str, timestamp: &str) -> AppResult<()> {
    conn.execute(
        "UPDATE sessions SET last_opened_at = ?2 WHERE id = ?1",
        params![id, timestamp],
    )?;
    Ok(())
}

pub fn delete_session(conn: &Connection, id: &str) -> AppResult<()> {
    let cred_id: Option<String> = conn
        .query_row(
            "SELECT credential_id FROM sessions WHERE id = ?1",
            params![id],
            |row| row.get::<_, Option<String>>(0),
        )
        .optional()?
        .flatten();

    let deleted = conn.execute("DELETE FROM sessions WHERE id = ?1", params![id])?;
    if deleted == 0 {
        return Err(AppError::NotFound(format!("Session {id}")));
    }

    if let Some(cid) = cred_id {
        let _ = conn.execute(
            "DELETE FROM credentials WHERE id = ?1 AND reusable = 0",
            params![cid],
        );
    }
    Ok(())
}

// --- known_hosts ---

pub fn upsert_known_host(
    conn: &Connection,
    id: &str,
    host: &str,
    port: u16,
    key_type: &str,
    fingerprint: &str,
    first_seen_at: &str,
) -> AppResult<()> {
    conn.execute(
        "INSERT INTO known_hosts (id, host, port, key_type, fingerprint, first_seen_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(host, port, key_type) DO UPDATE SET
           fingerprint = excluded.fingerprint,
           first_seen_at = excluded.first_seen_at",
        params![id, host, port as i64, key_type, fingerprint, first_seen_at],
    )?;
    Ok(())
}

pub fn list_known_hosts(conn: &Connection) -> AppResult<Vec<KnownHost>> {
    let mut stmt = conn.prepare(
        "SELECT id, host, port, key_type, fingerprint, first_seen_at
         FROM known_hosts ORDER BY host COLLATE NOCASE ASC, port ASC",
    )?;
    let rows = stmt
        .query_map([], |row| {
            Ok(KnownHost {
                id: row.get(0)?,
                host: row.get(1)?,
                port: row.get::<_, i64>(2)? as u16,
                key_type: row.get(3)?,
                fingerprint: row.get(4)?,
                first_seen_at: row.get(5)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

pub fn delete_known_host(conn: &Connection, id: &str) -> AppResult<()> {
    let deleted = conn.execute("DELETE FROM known_hosts WHERE id = ?1", params![id])?;
    if deleted == 0 {
        return Err(AppError::NotFound(format!("Known host {id}")));
    }
    Ok(())
}
