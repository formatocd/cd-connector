use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex as StdMutex};
use std::time::{Instant, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};
use tokio::sync::{oneshot, RwLock as AsyncRwLock};
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::models::{
    ConflictAction, ConflictPromptEvent, EnqueueTransferRequest, TransferDirection, TransferItem,
    TransferStatus,
};
use crate::protocols::{
    join_remote_path, BandwidthLimiter, ExistingFileInfo, TransferControl, TransferOutcome,
};
use crate::state::SharedClient;

struct ItemControl {
    cancel: Arc<AtomicBool>,
    pause: Arc<AtomicBool>,
}

pub struct TransferManager {
    items: StdMutex<Vec<TransferItem>>,
    controls: StdMutex<HashMap<String, ItemControl>>,
    conflict_waiters: StdMutex<HashMap<String, oneshot::Sender<(ConflictAction, bool)>>>,
    batch_policy: StdMutex<Option<ConflictAction>>,
    active_count: AtomicUsize,
    max_concurrent: AtomicUsize,
    upload_limiter: Arc<BandwidthLimiter>,
    download_limiter: Arc<BandwidthLimiter>,
}

impl TransferManager {
    pub fn new(
        max_concurrent: u32,
        upload_limit_kbps: u64,
        download_limit_kbps: u64,
    ) -> Arc<Self> {
        Arc::new(Self {
            items: StdMutex::new(Vec::new()),
            controls: StdMutex::new(HashMap::new()),
            conflict_waiters: StdMutex::new(HashMap::new()),
            batch_policy: StdMutex::new(None),
            active_count: AtomicUsize::new(0),
            max_concurrent: AtomicUsize::new(max_concurrent.max(1) as usize),
            upload_limiter: Arc::new(BandwidthLimiter::new(upload_limit_kbps)),
            download_limiter: Arc::new(BandwidthLimiter::new(download_limit_kbps)),
        })
    }

    pub fn update_limits(
        self: &Arc<Self>,
        app: AppHandle,
        connections: Arc<AsyncRwLock<HashMap<String, SharedClient>>>,
        max_concurrent: u32,
        upload_limit_kbps: u64,
        download_limit_kbps: u64,
    ) {
        self.max_concurrent
            .store(max_concurrent.max(1) as usize, Ordering::Release);
        self.upload_limiter.set_limit_kbps(upload_limit_kbps);
        self.download_limiter.set_limit_kbps(download_limit_kbps);
        self.dispatch_next(app, connections);
    }

    pub fn list(&self) -> Vec<TransferItem> {
        self.items
            .lock()
            .map(|g| g.clone())
            .unwrap_or_default()
    }

    fn emit_queue(&self, app: &AppHandle) {
        let snapshot = self.list();
        let _ = app.emit("transfer-queue-updated", snapshot);
    }

    fn update_item<F: FnOnce(&mut TransferItem)>(&self, id: &str, f: F) {
        if let Ok(mut list) = self.items.lock() {
            if let Some(item) = list.iter_mut().find(|i| i.id == id) {
                f(item);
            }
        }
    }

    pub async fn enqueue(
        self: &Arc<Self>,
        app: AppHandle,
        connections: Arc<AsyncRwLock<HashMap<String, SharedClient>>>,
        req: EnqueueTransferRequest,
    ) -> AppResult<Vec<TransferItem>> {
        let client = {
            let map = connections.read().await;
            map.get(&req.tab_id)
                .cloned()
                .ok_or_else(|| AppError::NotConnected("Session is not connected".into()))?
        };

        let mut expanded: Vec<TransferItem> = Vec::new();

        for entry in req.items {
            match req.direction {
                TransferDirection::Upload => {
                    let local_path = PathBuf::from(&entry.local_path);
                    let is_dir = entry.is_dir || local_path.is_dir();
                    if is_dir {
                        expand_local_dir(
                            &client,
                            &req.tab_id,
                            &local_path,
                            &entry.remote_path,
                            &mut expanded,
                        )
                        .await?;
                    } else {
                        let size = std::fs::metadata(&local_path).map(|m| m.len()).unwrap_or(0);
                        let file_name = local_path
                            .file_name()
                            .map(|n| n.to_string_lossy().to_string())
                            .unwrap_or_else(|| entry.local_path.clone());
                        expanded.push(TransferItem {
                            id: Uuid::new_v4().to_string(),
                            tab_id: req.tab_id.clone(),
                            direction: TransferDirection::Upload,
                            file_name,
                            local_path: entry.local_path,
                            remote_path: entry.remote_path,
                            total_bytes: size,
                            transferred_bytes: 0,
                            speed_bps: 0,
                            eta_seconds: None,
                            status: TransferStatus::Queued,
                            error: None,
                        });
                    }
                }
                TransferDirection::Download => {
                    if entry.is_dir {
                        expand_remote_dir(
                            &client,
                            &req.tab_id,
                            &entry.remote_path,
                            Path::new(&entry.local_path),
                            &mut expanded,
                        )
                        .await?;
                    } else {
                        let size = {
                            let mut c = client.lock().await;
                            c.stat(&entry.remote_path)
                                .await
                                .map(|e| e.size)
                                .unwrap_or(0)
                        };
                        let file_name = entry
                            .remote_path
                            .trim_end_matches('/')
                            .rsplit('/')
                            .next()
                            .unwrap_or(&entry.remote_path)
                            .to_string();
                        expanded.push(TransferItem {
                            id: Uuid::new_v4().to_string(),
                            tab_id: req.tab_id.clone(),
                            direction: TransferDirection::Download,
                            file_name,
                            local_path: entry.local_path,
                            remote_path: entry.remote_path,
                            total_bytes: size,
                            transferred_bytes: 0,
                            speed_bps: 0,
                            eta_seconds: None,
                            status: TransferStatus::Queued,
                            error: None,
                        });
                    }
                }
            }
        }

        if let Ok(mut list) = self.items.lock() {
            list.extend(expanded.clone());
        }
        self.emit_queue(&app);
        self.dispatch_next(app, connections);
        Ok(expanded)
    }

    pub fn pause(&self, app: &AppHandle, id: &str) {
        if let Ok(controls) = self.controls.lock() {
            if let Some(ctrl) = controls.get(id) {
                ctrl.pause.store(true, Ordering::Relaxed);
            }
        }
        self.update_item(id, |item| {
            if item.status == TransferStatus::Queued {
                item.status = TransferStatus::Paused;
            }
        });
        self.emit_queue(app);
    }

    pub fn resume(
        self: &Arc<Self>,
        app: AppHandle,
        connections: Arc<AsyncRwLock<HashMap<String, SharedClient>>>,
        id: &str,
    ) {
        self.update_item(id, |item| {
            if item.status == TransferStatus::Paused {
                item.status = TransferStatus::Queued;
                item.error = None;
            }
        });
        self.emit_queue(&app);
        self.dispatch_next(app, connections);
    }

    pub fn retry(
        self: &Arc<Self>,
        app: AppHandle,
        connections: Arc<AsyncRwLock<HashMap<String, SharedClient>>>,
        id: &str,
    ) {
        self.update_item(id, |item| {
            if matches!(
                item.status,
                TransferStatus::Failed | TransferStatus::Cancelled
            ) {
                item.status = TransferStatus::Queued;
                item.transferred_bytes = 0;
                item.speed_bps = 0;
                item.eta_seconds = None;
                item.error = None;
            }
        });
        self.emit_queue(&app);
        self.dispatch_next(app, connections);
    }

    pub fn cancel(&self, app: &AppHandle, id: &str) {
        if let Ok(controls) = self.controls.lock() {
            if let Some(ctrl) = controls.get(id) {
                ctrl.cancel.store(true, Ordering::Relaxed);
            }
        }
        if let Ok(mut waiters) = self.conflict_waiters.lock() {
            if let Some(tx) = waiters.remove(id) {
                let _ = tx.send((ConflictAction::Skip, false));
            }
        }
        self.update_item(id, |item| {
            if matches!(
                item.status,
                TransferStatus::Queued | TransferStatus::Paused | TransferStatus::WaitingConflict
            ) {
                item.status = TransferStatus::Cancelled;
                item.speed_bps = 0;
                item.eta_seconds = None;
            }
        });
        self.emit_queue(app);
    }

    pub fn pause_all(&self, app: &AppHandle) {
        if let Ok(controls) = self.controls.lock() {
            for ctrl in controls.values() {
                ctrl.pause.store(true, Ordering::Relaxed);
            }
        }
        if let Ok(mut list) = self.items.lock() {
            for item in list.iter_mut() {
                if item.status == TransferStatus::Queued {
                    item.status = TransferStatus::Paused;
                }
            }
        }
        self.emit_queue(app);
    }

    pub fn resume_all(
        self: &Arc<Self>,
        app: AppHandle,
        connections: Arc<AsyncRwLock<HashMap<String, SharedClient>>>,
    ) {
        if let Ok(mut list) = self.items.lock() {
            for item in list.iter_mut() {
                if item.status == TransferStatus::Paused {
                    item.status = TransferStatus::Queued;
                }
            }
        }
        self.emit_queue(&app);
        self.dispatch_next(app, connections);
    }

    pub fn cancel_all(&self, app: &AppHandle) {
        if let Ok(controls) = self.controls.lock() {
            for ctrl in controls.values() {
                ctrl.cancel.store(true, Ordering::Relaxed);
            }
        }
        if let Ok(mut waiters) = self.conflict_waiters.lock() {
            for (_, tx) in waiters.drain() {
                let _ = tx.send((ConflictAction::Skip, false));
            }
        }
        if let Ok(mut list) = self.items.lock() {
            for item in list.iter_mut() {
                if matches!(
                    item.status,
                    TransferStatus::Queued
                        | TransferStatus::Paused
                        | TransferStatus::WaitingConflict
                        | TransferStatus::InProgress
                ) {
                    item.status = TransferStatus::Cancelled;
                    item.speed_bps = 0;
                    item.eta_seconds = None;
                }
            }
        }
        if let Ok(mut policy) = self.batch_policy.lock() {
            *policy = None;
        }
        self.emit_queue(app);
    }

    pub fn clear_completed(&self, app: &AppHandle) {
        if let Ok(mut list) = self.items.lock() {
            list.retain(|i| {
                !matches!(
                    i.status,
                    TransferStatus::Completed | TransferStatus::Cancelled | TransferStatus::Failed
                )
            });
        }
        self.emit_queue(app);
    }

    pub fn resolve_conflict(
        &self,
        transfer_id: &str,
        action: ConflictAction,
        apply_to_all: bool,
    ) {
        if apply_to_all {
            if let Ok(mut policy) = self.batch_policy.lock() {
                *policy = Some(action);
            }
        }
        if let Ok(mut waiters) = self.conflict_waiters.lock() {
            if let Some(tx) = waiters.remove(transfer_id) {
                let _ = tx.send((action, apply_to_all));
            }
            if apply_to_all {
                for (_, tx) in waiters.drain() {
                    let _ = tx.send((action, true));
                }
            }
        }
    }

    fn dispatch_next(
        self: &Arc<Self>,
        app: AppHandle,
        connections: Arc<AsyncRwLock<HashMap<String, SharedClient>>>,
    ) {
        let max = self.max_concurrent.load(Ordering::Acquire);
        loop {
            let next_item = {
                let Ok(mut list) = self.items.lock() else {
                    break;
                };
                if self.active_count.load(Ordering::Acquire) >= max {
                    break;
                }
                if let Some(item) = list.iter_mut().find(|i| i.status == TransferStatus::Queued) {
                    item.status = TransferStatus::InProgress;
                    item.error = None;
                    self.active_count.fetch_add(1, Ordering::AcqRel);
                    Some(item.clone())
                } else {
                    None
                }
            };

            let Some(item) = next_item else {
                // If nothing queued and nothing active, reset batch conflict policy
                if self.active_count.load(Ordering::Acquire) == 0 {
                    if let Ok(mut policy) = self.batch_policy.lock() {
                        *policy = None;
                    }
                }
                break;
            };

            let mgr = Arc::clone(self);
            let app_clone = app.clone();
            let conns_clone = Arc::clone(&connections);
            self.emit_queue(&app);

            tauri::async_runtime::spawn(async move {
                mgr.run_transfer(app_clone.clone(), conns_clone.clone(), item)
                    .await;
                mgr.active_count.fetch_sub(1, Ordering::AcqRel);
                mgr.emit_queue(&app_clone);
                mgr.dispatch_next(app_clone, conns_clone);
            });
        }
    }

    async fn run_transfer(
        self: &Arc<Self>,
        app: AppHandle,
        connections: Arc<AsyncRwLock<HashMap<String, SharedClient>>>,
        mut item: TransferItem,
    ) {
        let client_opt = {
            let map = connections.read().await;
            map.get(&item.tab_id).cloned()
        };
        let Some(client_arc) = client_opt else {
            self.update_item(&item.id, |i| {
                i.status = TransferStatus::Failed;
                i.error = Some("Session disconnected".into());
            });
            return;
        };

        let cancel_flag = Arc::new(AtomicBool::new(false));
        let pause_flag = Arc::new(AtomicBool::new(false));
        if let Ok(mut controls) = self.controls.lock() {
            controls.insert(
                item.id.clone(),
                ItemControl {
                    cancel: cancel_flag.clone(),
                    pause: pause_flag.clone(),
                },
            );
        }

        // Check destination conflict only on fresh transfers (offset == 0)
        if item.transferred_bytes == 0 {
            let conflict_res = self
                .check_and_resolve_conflict(&app, &client_arc, &mut item)
                .await;
            match conflict_res {
                Ok(true) => {}
                Ok(false) => {
                    // Skipped
                    self.update_item(&item.id, |i| {
                        i.status = TransferStatus::Completed;
                        i.transferred_bytes = i.total_bytes;
                        i.speed_bps = 0;
                        i.eta_seconds = Some(0);
                    });
                    if let Ok(mut controls) = self.controls.lock() {
                        controls.remove(&item.id);
                    }
                    return;
                }
                Err(e) => {
                    self.update_item(&item.id, |i| {
                        i.status = TransferStatus::Failed;
                        i.error = Some(e.to_string());
                    });
                    if let Ok(mut controls) = self.controls.lock() {
                        controls.remove(&item.id);
                    }
                    return;
                }
            }
        }

        let limiter = match item.direction {
            TransferDirection::Upload => self.upload_limiter.clone(),
            TransferDirection::Download => self.download_limiter.clone(),
        };

        let start_time = Instant::now();
        let start_bytes = item.transferred_bytes;
        let last_emit = Arc::new(StdMutex::new(Instant::now()));
        let mgr_progress = Arc::clone(self);
        let app_progress = app.clone();
        let id_progress = item.id.clone();
        let total_bytes = item.total_bytes;

        let on_progress: Arc<dyn Fn(u64) + Send + Sync> = Arc::new(move |transferred| {
            let elapsed = start_time.elapsed().as_secs_f64().max(0.05);
            let delta = transferred.saturating_sub(start_bytes);
            let speed_bps = (delta as f64 / elapsed) as u64;
            let eta_seconds = if speed_bps > 0 && total_bytes > transferred {
                Some((total_bytes - transferred) / speed_bps)
            } else {
                Some(0)
            };

            mgr_progress.update_item(&id_progress, |i| {
                i.transferred_bytes = transferred;
                i.speed_bps = speed_bps;
                i.eta_seconds = eta_seconds;
            });

            if let Ok(mut last) = last_emit.lock() {
                if last.elapsed().as_millis() >= 150 {
                    *last = Instant::now();
                    mgr_progress.emit_queue(&app_progress);
                }
            }
        });

        let control = TransferControl {
            cancel_flag: cancel_flag.clone(),
            pause_flag: pause_flag.clone(),
            limiter,
            on_progress,
        };

        let outcome = {
            let mut client = client_arc.lock().await;
            match item.direction {
                TransferDirection::Upload => {
                    client
                        .upload_file(
                            Path::new(&item.local_path),
                            &item.remote_path,
                            item.transferred_bytes,
                            control,
                        )
                        .await
                }
                TransferDirection::Download => {
                    client
                        .download_file(
                            &item.remote_path,
                            Path::new(&item.local_path),
                            item.transferred_bytes,
                            control,
                        )
                        .await
                }
            }
        };

        if let Ok(mut controls) = self.controls.lock() {
            controls.remove(&item.id);
        }

        match outcome {
            Ok(TransferOutcome::Completed(bytes)) => {
                self.update_item(&item.id, |i| {
                    i.status = TransferStatus::Completed;
                    i.transferred_bytes = bytes;
                    if i.total_bytes == 0 {
                        i.total_bytes = bytes;
                    }
                    i.speed_bps = 0;
                    i.eta_seconds = Some(0);
                });
                let _ = app.emit(
                    "transfer-completed",
                    serde_json::json!({
                        "tab_id": item.tab_id,
                        "direction": item.direction,
                    }),
                );
            }
            Ok(TransferOutcome::Paused(bytes)) => {
                self.update_item(&item.id, |i| {
                    i.status = TransferStatus::Paused;
                    i.transferred_bytes = bytes;
                    i.speed_bps = 0;
                    i.eta_seconds = None;
                });
            }
            Ok(TransferOutcome::Cancelled) => {
                self.update_item(&item.id, |i| {
                    i.status = TransferStatus::Cancelled;
                    i.speed_bps = 0;
                    i.eta_seconds = None;
                });
            }
            Err(e) => {
                self.update_item(&item.id, |i| {
                    i.status = TransferStatus::Failed;
                    i.speed_bps = 0;
                    i.eta_seconds = None;
                    i.error = Some(e.to_string());
                });
            }
        }
    }

    /// Returns Ok(true) to proceed, Ok(false) to skip.
    async fn check_and_resolve_conflict(
        &self,
        app: &AppHandle,
        client_arc: &SharedClient,
        item: &mut TransferItem,
    ) -> AppResult<bool> {
        let (dest_info, source_size, source_mod): (Option<ExistingFileInfo>, u64, Option<i64>) =
            match item.direction {
                TransferDirection::Upload => {
                    let meta = std::fs::metadata(&item.local_path).ok();
                    let src_size = meta.as_ref().map(|m| m.len()).unwrap_or(item.total_bytes);
                    let src_mod = meta
                        .and_then(|m| m.modified().ok())
                        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                        .map(|d| d.as_secs() as i64);
                    let dest = {
                        let mut c = client_arc.lock().await;
                        c.exists_info(&item.remote_path).await?
                    };
                    (dest, src_size, src_mod)
                }
                TransferDirection::Download => {
                    let local_p = Path::new(&item.local_path);
                    let dest = if local_p.exists() {
                        let meta = std::fs::metadata(local_p).ok();
                        let size = meta.as_ref().map(|m| m.len()).unwrap_or(0);
                        let mtime = meta
                            .and_then(|m| m.modified().ok())
                            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                            .map(|d| d.as_secs() as i64);
                        Some(ExistingFileInfo {
                            size,
                            modified_epoch: mtime,
                        })
                    } else {
                        None
                    };
                    let src_info = {
                        let mut c = client_arc.lock().await;
                        c.exists_info(&item.remote_path).await.ok().flatten()
                    };
                    (
                        dest,
                        src_info.as_ref().map(|s| s.size).unwrap_or(item.total_bytes),
                        src_info.and_then(|s| s.modified_epoch),
                    )
                }
            };

        let Some(dest) = dest_info else {
            return Ok(true);
        };

        let action = {
            let cached = self.batch_policy.lock().ok().and_then(|g| *g);
            if let Some(a) = cached {
                a
            } else {
                let (tx, rx) = oneshot::channel();
                if let Ok(mut waiters) = self.conflict_waiters.lock() {
                    waiters.insert(item.id.clone(), tx);
                }
                self.update_item(&item.id, |i| {
                    i.status = TransferStatus::WaitingConflict;
                });
                self.emit_queue(app);

                let _ = app.emit(
                    "transfer-conflict",
                    ConflictPromptEvent {
                        transfer_id: item.id.clone(),
                        tab_id: item.tab_id.clone(),
                        direction: item.direction,
                        file_name: item.file_name.clone(),
                        source_size,
                        source_modified: source_mod,
                        dest_size: dest.size,
                        dest_modified: dest.modified_epoch,
                    },
                );

                let (chosen, _) = rx.await.unwrap_or((ConflictAction::Skip, false));
                self.update_item(&item.id, |i| {
                    if i.status == TransferStatus::WaitingConflict {
                        i.status = TransferStatus::InProgress;
                    }
                });
                self.emit_queue(app);
                chosen
            }
        };

        match action {
            ConflictAction::Overwrite => Ok(true),
            ConflictAction::Skip => Ok(false),
            ConflictAction::OverwriteIfNewerOrDiffSize => {
                let diff_size = source_size != dest.size;
                let is_newer = match (source_mod, dest.modified_epoch) {
                    (Some(s), Some(d)) => s > d,
                    _ => true,
                };
                Ok(diff_size || is_newer)
            }
            ConflictAction::AutoRename => {
                match item.direction {
                    TransferDirection::Upload => {
                        let new_remote =
                            find_unique_remote_path(client_arc, &item.remote_path).await;
                        let new_name = new_remote
                            .rsplit('/')
                            .next()
                            .unwrap_or(&item.file_name)
                            .to_string();
                        item.remote_path = new_remote.clone();
                        item.file_name = new_name.clone();
                        self.update_item(&item.id, |i| {
                            i.remote_path = new_remote;
                            i.file_name = new_name;
                        });
                    }
                    TransferDirection::Download => {
                        let new_local = find_unique_local_path(Path::new(&item.local_path));
                        let new_local_str = new_local.to_string_lossy().to_string();
                        let new_name = new_local
                            .file_name()
                            .map(|n| n.to_string_lossy().to_string())
                            .unwrap_or_else(|| item.file_name.clone());
                        item.local_path = new_local_str.clone();
                        item.file_name = new_name.clone();
                        self.update_item(&item.id, |i| {
                            i.local_path = new_local_str;
                            i.file_name = new_name;
                        });
                    }
                }
                self.emit_queue(app);
                Ok(true)
            }
        }
    }
}

fn split_stem_ext(name: &str) -> (&str, &str) {
    if let Some(dot) = name.rfind('.') {
        if dot > 0 {
            return (&name[..dot], &name[dot..]);
        }
    }
    (name, "")
}

fn find_unique_local_path(original: &Path) -> PathBuf {
    let parent = original.parent().unwrap_or_else(|| Path::new("."));
    let file_name = original
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "file".to_string());
    let (stem, ext) = split_stem_ext(&file_name);
    for idx in 1..10_000 {
        let candidate = parent.join(format!("{stem}_{idx}{ext}"));
        if !candidate.exists() {
            return candidate;
        }
    }
    parent.join(format!("{stem}_copy{ext}"))
}

async fn find_unique_remote_path(client_arc: &SharedClient, original: &str) -> String {
    let (dir, name) = match original.rfind('/') {
        Some(pos) => (&original[..pos], &original[pos + 1..]),
        None => ("", original),
    };
    let (stem, ext) = split_stem_ext(name);
    let mut client = client_arc.lock().await;
    for idx in 1..1_000 {
        let candidate_name = format!("{stem}_{idx}{ext}");
        let candidate = if dir.is_empty() {
            format!("/{candidate_name}")
        } else {
            format!("{dir}/{candidate_name}")
        };
        if client.exists_info(&candidate).await.ok().flatten().is_none() {
            return candidate;
        }
    }
    format!("{dir}/{stem}_copy{ext}")
}

fn expand_local_dir<'a>(
    client: &'a SharedClient,
    tab_id: &'a str,
    local_dir: &'a Path,
    remote_dir: &'a str,
    out: &'a mut Vec<TransferItem>,
) -> std::pin::Pin<Box<dyn std::future::Future<Output = AppResult<()>> + Send + 'a>> {
    Box::pin(async move {
        {
            let mut c = client.lock().await;
            let _ = c.mkdir(remote_dir).await;
        }
        let entries = std::fs::read_dir(local_dir)?;
        for entry_res in entries {
            let Ok(entry) = entry_res else { continue };
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();
            let child_remote = join_remote_path(remote_dir, &name);
            let Ok(meta) = entry.metadata() else { continue };
            if meta.is_dir() {
                expand_local_dir(client, tab_id, &path, &child_remote, out).await?;
            } else {
                out.push(TransferItem {
                    id: Uuid::new_v4().to_string(),
                    tab_id: tab_id.to_string(),
                    direction: TransferDirection::Upload,
                    file_name: name,
                    local_path: path.to_string_lossy().to_string(),
                    remote_path: child_remote,
                    total_bytes: meta.len(),
                    transferred_bytes: 0,
                    speed_bps: 0,
                    eta_seconds: None,
                    status: TransferStatus::Queued,
                    error: None,
                });
            }
        }
        Ok(())
    })
}

fn validate_remote_entry_name(name: &str) -> AppResult<&str> {
    let trimmed = name.trim();
    if trimmed.is_empty()
        || trimmed == "."
        || trimmed == ".."
        || name.contains('/')
        || name.contains('\\')
        || name.contains('\0')
    {
        return Err(AppError::Validation(format!(
            "Unsafe remote entry name rejected: {name:?}"
        )));
    }
    let mut components = Path::new(name).components();
    match (components.next(), components.next()) {
        (Some(std::path::Component::Normal(_)), None) => Ok(name),
        _ => Err(AppError::Validation(format!(
            "Unsafe remote entry name rejected: {name:?}"
        ))),
    }
}

fn expand_remote_dir<'a>(
    client: &'a SharedClient,
    tab_id: &'a str,
    remote_dir: &'a str,
    local_dir: &'a Path,
    out: &'a mut Vec<TransferItem>,
) -> std::pin::Pin<Box<dyn std::future::Future<Output = AppResult<()>> + Send + 'a>> {
    Box::pin(async move {
        std::fs::create_dir_all(local_dir)?;
        let entries = {
            let mut c = client.lock().await;
            c.list_dir(remote_dir).await?
        };
        for entry in entries {
            let safe_name = validate_remote_entry_name(&entry.name)?;
            let child_local = local_dir.join(safe_name);
            if entry.is_dir {
                expand_remote_dir(client, tab_id, &entry.path, &child_local, out).await?;
            } else {
                out.push(TransferItem {
                    id: Uuid::new_v4().to_string(),
                    tab_id: tab_id.to_string(),
                    direction: TransferDirection::Download,
                    file_name: entry.name,
                    local_path: child_local.to_string_lossy().to_string(),
                    remote_path: entry.path,
                    total_bytes: entry.size,
                    transferred_bytes: 0,
                    speed_bps: 0,
                    eta_seconds: None,
                    status: TransferStatus::Queued,
                    error: None,
                });
            }
        }
        Ok(())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_remote_entry_name_accepts_normal_names() {
        assert_eq!(validate_remote_entry_name("report.pdf").unwrap(), "report.pdf");
        assert_eq!(validate_remote_entry_name(".env").unwrap(), ".env");
        assert_eq!(validate_remote_entry_name("my file (1).txt").unwrap(), "my file (1).txt");
    }

    #[test]
    fn validate_remote_entry_name_rejects_traversal_and_separators() {
        for bad in ["", "   ", ".", "..", "../secret", "a/b", "a\\b", "/etc/passwd", "a\0b"] {
            assert!(
                validate_remote_entry_name(bad).is_err(),
                "expected rejection for {bad:?}"
            );
        }
    }

    #[test]
    fn split_stem_ext_handles_common_cases() {
        assert_eq!(split_stem_ext("archive.tar.gz"), ("archive.tar", ".gz"));
        assert_eq!(split_stem_ext("README"), ("README", ""));
        assert_eq!(split_stem_ext(".bashrc"), (".bashrc", ""));
    }
}
