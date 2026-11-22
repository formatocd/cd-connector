import { invoke } from "@tauri-apps/api/core";
import type {
  AppConfig,
  ConflictAction,
  ConnectRequest,
  ConnectResponse,
  CredentialInput,
  CredentialSummary,
  EnqueueTransferRequest,
  ExportSummary,
  FileEntry,
  Folder,
  FolderInput,
  ImportCommitRequest,
  ImportPreview,
  ImportResult,
  KnownHost,
  SecurityMode,
  SecurityStatus,
  Session,
  SessionInput,
  TransferItem,
} from "../types";

export const api = {
  // Security
  getSecurityStatus: () => invoke<SecurityStatus>("get_security_status"),
  setupSecurityMode: (mode: SecurityMode, masterPassword?: string) =>
    invoke<SecurityStatus>("setup_security_mode", {
      mode,
      masterPassword: masterPassword ?? null,
    }),
  unlockVault: (password: string) =>
    invoke<SecurityStatus>("unlock_vault", { password }),
  lockVault: () => invoke<SecurityStatus>("lock_vault"),
  changeSecurityMode: (
    targetMode: SecurityMode,
    currentPassword?: string,
    newPassword?: string
  ) =>
    invoke<SecurityStatus>("change_security_mode", {
      targetMode,
      currentPassword: currentPassword ?? null,
      newPassword: newPassword ?? null,
    }),

  // Credentials
  listCredentials: () => invoke<CredentialSummary[]>("list_credentials"),
  createCredential: (input: CredentialInput) =>
    invoke<CredentialSummary>("create_credential", { input }),
  updateCredential: (id: string, input: CredentialInput) =>
    invoke<CredentialSummary>("update_credential", { id, input }),
  deleteCredential: (id: string) => invoke<void>("delete_credential", { id }),

  // Folders
  listFolders: () => invoke<Folder[]>("list_folders"),
  createFolder: (input: FolderInput) =>
    invoke<Folder>("create_folder", { input }),
  updateFolder: (id: string, input: FolderInput) =>
    invoke<Folder>("update_folder", { id, input }),
  deleteFolder: (id: string) => invoke<void>("delete_folder", { id }),

  // Sessions
  listSessions: () => invoke<Session[]>("list_sessions"),
  createSession: (input: SessionInput) =>
    invoke<Session>("create_session", { input }),
  updateSession: (id: string, input: SessionInput) =>
    invoke<Session>("update_session", { id, input }),
  deleteSession: (id: string) => invoke<void>("delete_session", { id }),

  // Config
  getAppConfig: () => invoke<AppConfig>("get_app_config"),
  updateAppConfig: (config: AppConfig) =>
    invoke<AppConfig>("update_app_config", { config }),

  // Portability
  exportData: () => invoke<string>("export_data"),
  previewImport: (rawJson: string, importPassword?: string) =>
    invoke<ImportPreview>("preview_import", {
      rawJson,
      importPassword: importPassword ?? null,
    }),
  commitImport: (request: ImportCommitRequest) =>
    invoke<ImportResult>("commit_import", { request }),
  inspectExportBundle: (rawJson: string) =>
    invoke<ExportSummary>("inspect_export_bundle", { rawJson }),
  setupFromJson: (
    rawJson: string,
    mode: SecurityMode,
    importPassword?: string,
    masterPassword?: string
  ) =>
    invoke<SecurityStatus>("setup_from_json", {
      rawJson,
      importPassword: importPassword ?? null,
      mode,
      masterPassword: masterPassword ?? null,
    }),

  // Local Filesystem
  getDefaultLocalDir: () => invoke<string>("get_default_local_dir"),
  localListRoots: () => invoke<string[]>("local_list_roots"),
  localListDir: (path: string) => invoke<FileEntry[]>("local_list_dir", { path }),
  localMkdir: (path: string) => invoke<void>("local_mkdir", { path }),
  localRename: (from: string, to: string) =>
    invoke<void>("local_rename", { from, to }),
  localDelete: (path: string, isDir: boolean) =>
    invoke<void>("local_delete", { path, isDir }),

  // Remote Protocol Engine
  connectSession: (request: ConnectRequest) =>
    invoke<ConnectResponse>("connect_session", { request }),
  disconnectSession: (tabId: string) =>
    invoke<void>("disconnect_session", { tabId }),
  remotePwd: (tabId: string) => invoke<string>("remote_pwd", { tabId }),
  remoteListDir: (tabId: string, path: string) =>
    invoke<FileEntry[]>("remote_list_dir", { tabId, path }),
  remoteMkdir: (tabId: string, path: string) =>
    invoke<void>("remote_mkdir", { tabId, path }),
  remoteRename: (tabId: string, from: string, to: string) =>
    invoke<void>("remote_rename", { tabId, from, to }),
  remoteDelete: (tabId: string, path: string, isDir: boolean) =>
    invoke<void>("remote_delete", { tabId, path, isDir }),
  remoteChmod: (tabId: string, path: string, mode: number) =>
    invoke<void>("remote_chmod", { tabId, path, mode }),
  sendRawCommand: (tabId: string, command: string) =>
    invoke<string>("send_raw_command", { tabId, command }),
  listKnownHosts: () => invoke<KnownHost[]>("list_known_hosts"),
  deleteKnownHost: (id: string) => invoke<void>("delete_known_host", { id }),

  // Transfer Queue
  enqueueTransfers: (request: EnqueueTransferRequest) =>
    invoke<TransferItem[]>("enqueue_transfers", { request }),
  listTransfers: () => invoke<TransferItem[]>("list_transfers"),
  pauseTransfer: (id: string) => invoke<void>("pause_transfer", { id }),
  resumeTransfer: (id: string) => invoke<void>("resume_transfer", { id }),
  retryTransfer: (id: string) => invoke<void>("retry_transfer", { id }),
  cancelTransfer: (id: string) => invoke<void>("cancel_transfer", { id }),
  pauseAllTransfers: () => invoke<void>("pause_all_transfers"),
  resumeAllTransfers: () => invoke<void>("resume_all_transfers"),
  cancelAllTransfers: () => invoke<void>("cancel_all_transfers"),
  clearCompletedTransfers: () => invoke<void>("clear_completed_transfers"),
  resolveTransferConflict: (
    transferId: string,
    action: ConflictAction,
    applyToAll: boolean
  ) =>
    invoke<void>("resolve_transfer_conflict", {
      transferId,
      action,
      applyToAll,
    }),
};
