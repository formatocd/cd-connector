use tauri::{AppHandle, State};

use crate::error::AppResult;
use crate::models::{ConflictAction, EnqueueTransferRequest, TransferItem};
use crate::state::AppState;

#[tauri::command]
pub async fn enqueue_transfers(
    app: AppHandle,
    state: State<'_, AppState>,
    request: EnqueueTransferRequest,
) -> AppResult<Vec<TransferItem>> {
    state
        .transfers
        .enqueue(app, state.connections.clone(), request)
        .await
}

#[tauri::command]
pub fn list_transfers(state: State<'_, AppState>) -> AppResult<Vec<TransferItem>> {
    Ok(state.transfers.list())
}

#[tauri::command]
pub fn pause_transfer(app: AppHandle, state: State<'_, AppState>, id: String) -> AppResult<()> {
    state.transfers.pause(&app, &id);
    Ok(())
}

#[tauri::command]
pub fn resume_transfer(app: AppHandle, state: State<'_, AppState>, id: String) -> AppResult<()> {
    state
        .transfers
        .resume(app, state.connections.clone(), &id);
    Ok(())
}

#[tauri::command]
pub fn retry_transfer(app: AppHandle, state: State<'_, AppState>, id: String) -> AppResult<()> {
    state.transfers.retry(app, state.connections.clone(), &id);
    Ok(())
}

#[tauri::command]
pub fn cancel_transfer(app: AppHandle, state: State<'_, AppState>, id: String) -> AppResult<()> {
    state.transfers.cancel(&app, &id);
    Ok(())
}

#[tauri::command]
pub fn pause_all_transfers(app: AppHandle, state: State<'_, AppState>) -> AppResult<()> {
    state.transfers.pause_all(&app);
    Ok(())
}

#[tauri::command]
pub fn resume_all_transfers(app: AppHandle, state: State<'_, AppState>) -> AppResult<()> {
    state.transfers.resume_all(app, state.connections.clone());
    Ok(())
}

#[tauri::command]
pub fn cancel_all_transfers(app: AppHandle, state: State<'_, AppState>) -> AppResult<()> {
    state.transfers.cancel_all(&app);
    Ok(())
}

#[tauri::command]
pub fn clear_completed_transfers(app: AppHandle, state: State<'_, AppState>) -> AppResult<()> {
    state.transfers.clear_completed(&app);
    Ok(())
}

#[tauri::command]
pub fn resolve_transfer_conflict(
    state: State<'_, AppState>,
    transfer_id: String,
    action: ConflictAction,
    apply_to_all: bool,
) -> AppResult<()> {
    state
        .transfers
        .resolve_conflict(&transfer_id, action, apply_to_all);
    Ok(())
}
