mod commands;
mod crypto;
mod db;
mod error;
mod models;
mod state;

use tauri::Manager;

use state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let app_data_dir = app
                .path()
                .app_data_dir()
                .expect("Failed to resolve app data directory");
            let db_path = app_data_dir.join("cd-connector.db");
            let conn = db::init_db(&db_path).expect("Failed to initialize SQLite database");

            app.manage(AppState::new(conn, app_data_dir));
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
            commands::config::get_app_config,
            commands::config::update_app_config,
            commands::portability::export_data,
            commands::portability::preview_import,
            commands::portability::commit_import,
            commands::portability::inspect_export_bundle,
            commands::portability::setup_from_json,
        ])
        .run(tauri::generate_context!())
        .expect("Error while running CD Connector");
}
