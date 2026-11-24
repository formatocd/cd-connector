mod commands;
mod crypto;
mod db;
mod error;
mod models;
mod protocols;
mod state;
mod transfer;

use std::path::Path;
use tauri::Manager;

use state::AppState;

/// Migrates existing CD Connector database and vault key into the new CD Remote data directory
/// if `cd-remote.db` does not exist yet.
fn migrate_legacy_data_if_needed(app_data_dir: &Path, db_path: &Path) {
    if db_path.exists() {
        return;
    }
    let Some(parent) = app_data_dir.parent() else {
        return;
    };
    let legacy_dir = parent.join("com.formatocd.cd-connector");
    let legacy_db = legacy_dir.join("cd-connector.db");
    if !legacy_db.exists() {
        return;
    }
    if std::fs::create_dir_all(app_data_dir).is_err() {
        return;
    }
    let _ = std::fs::copy(&legacy_db, db_path);
    for suffix in ["-wal", "-shm"] {
        let legacy_sidecar = legacy_dir.join(format!("cd-connector.db{suffix}"));
        if legacy_sidecar.exists() {
            let _ = std::fs::copy(&legacy_sidecar, app_data_dir.join(format!("cd-remote.db{suffix}")));
        }
    }
    let legacy_key = legacy_dir.join("vault.key");
    let new_key = app_data_dir.join("vault.key");
    if legacy_key.exists() && !new_key.exists() {
        let _ = std::fs::copy(&legacy_key, &new_key);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let app_data_dir = app
                .path()
                .app_data_dir()
                .expect("Failed to resolve app data directory");
            let db_path = app_data_dir.join("cd-remote.db");
            migrate_legacy_data_if_needed(&app_data_dir, &db_path);
            let conn = db::init_db(&db_path).expect("Failed to initialize SQLite database");
            let initial_config = db::load_app_config(&conn).unwrap_or_default();

            app.manage(AppState::new(conn, app_data_dir, &initial_config));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::security::get_security_status,
            commands::security::setup_security_mode,
            commands::security::unlock_vault,
            commands::security::lock_vault,
            commands::security::change_security_mode,
            commands::credentials::list_credentials,
            commands::credentials::create_credential,
            commands::credentials::update_credential,
            commands::credentials::delete_credential,
            commands::sessions::list_folders,
            commands::sessions::create_folder,
            commands::sessions::update_folder,
            commands::sessions::delete_folder,
            commands::sessions::list_sessions,
            commands::sessions::create_session,
            commands::sessions::update_session,
            commands::sessions::delete_session,
            commands::sessions::mark_session_opened,
            commands::sessions::reorder_tree_items,
            commands::config::get_app_config,
            commands::config::update_app_config,
            commands::portability::export_data,
            commands::portability::preview_import,
            commands::portability::commit_import,
            commands::portability::inspect_export_bundle,
            commands::portability::setup_from_json,
            commands::local_fs::get_default_local_dir,
            commands::local_fs::local_list_roots,
            commands::local_fs::local_list_dir,
            commands::local_fs::local_mkdir,
            commands::local_fs::local_rename,
            commands::local_fs::local_delete,
            commands::local_fs::local_stat,
            commands::remote::connect_session,
            commands::remote::disconnect_session,
            commands::remote::remote_pwd,
            commands::remote::remote_list_dir,
            commands::remote::remote_mkdir,
            commands::remote::remote_rename,
            commands::remote::remote_delete,
            commands::remote::remote_chmod,
            commands::remote::remote_stat,
            commands::remote::send_raw_command,
            commands::remote::list_known_hosts,
            commands::remote::delete_known_host,
            commands::transfer::enqueue_transfers,
            commands::transfer::list_transfers,
            commands::transfer::pause_transfer,
            commands::transfer::resume_transfer,
            commands::transfer::retry_transfer,
            commands::transfer::cancel_transfer,
            commands::transfer::pause_all_transfers,
            commands::transfer::resume_all_transfers,
            commands::transfer::cancel_all_transfers,
            commands::transfer::clear_completed_transfers,
            commands::transfer::resolve_transfer_conflict,
            commands::ssh::ssh_connect,
            commands::ssh::ssh_write,
            commands::ssh::ssh_resize,
            commands::ssh::ssh_disconnect,
            commands::ssh::ssh_start_log,
            commands::ssh::ssh_stop_log,
        ])
        .run(tauri::generate_context!())
        .expect("Error while running CD Remote");
}
