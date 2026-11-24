export type SecurityMode = "master_password" | "transparent";

export interface SecurityStatus {
  initialized: boolean;
  mode: SecurityMode | null;
  unlocked: boolean;
}

export type AuthType = "password" | "ssh_key" | "ssh_agent" | "tls_cert";

export interface CredentialSummary {
  id: string;
  name: string;
  username: string;
  auth_type: AuthType;
  has_secret: boolean;
  has_passphrase: boolean;
  reusable: boolean;
  created_at: string;
  updated_at: string;
}

export interface CredentialInput {
  name: string;
  username: string;
  auth_type: AuthType;
  password?: string;
  private_key?: string;
  passphrase?: string;
  keep_existing_secret?: boolean;
  clone_from_credential_id?: string;
  reusable?: boolean;
}

export interface Folder {
  id: string;
  parent_id: string | null;
  name: string;
  sort_order: number;
  icon_color?: string | null;
}

export interface FolderInput {
  parent_id: string | null;
  name: string;
  sort_order?: number;
  icon_color?: string | null;
}

export type SessionKind = "ssh" | "transfer";

export type Protocol =
  | "ftp"
  | "ftps_explicit"
  | "ftps_implicit"
  | "sftp"
  | "ssh";

export interface Session {
  id: string;
  folder_id: string | null;
  credential_id: string | null;
  name: string;
  protocol: Protocol;
  host: string;
  port: number;
  remote_initial_path: string;
  local_initial_path: string;
  passive_mode: boolean;
  accept_invalid_certs: boolean;
  sort_order: number;
  icon_color?: string | null;
  last_opened_at?: string | null;
}

export interface SessionInput {
  folder_id: string | null;
  credential_id: string | null;
  name: string;
  protocol: Protocol;
  host: string;
  port?: number;
  remote_initial_path?: string;
  local_initial_path?: string;
  passive_mode?: boolean;
  accept_invalid_certs?: boolean;
  sort_order?: number;
  icon_color?: string | null;
}

export interface AppConfig {
  theme: "light" | "dark" | "system";
  language: "es" | "en";
  max_concurrent_transfers: number;
  upload_limit_kbps: number;
  download_limit_kbps: number;
  ui_show_sidebar: boolean;
  ui_show_local_panel: boolean;
  ui_show_queue_panel: boolean;
  ui_show_command_panel: boolean;
  terminal_font_family: string;
  terminal_font_size: number;
  terminal_copy_on_select: boolean;
}

export type ImportAction = "import" | "overwrite" | "skip";

export interface ImportPreviewFolder {
  id: string;
  parent_id: string | null;
  name: string;
  sort_order: number;
  conflict_id: string | null;
  action: ImportAction;
}

export interface ImportPreviewCredential {
  id: string;
  name: string;
  username: string;
  auth_type: AuthType;
  has_secret: boolean;
  has_passphrase: boolean;
  reusable: boolean;
  conflict_id: string | null;
  action: ImportAction;
}

export interface ImportPreviewSession {
  id: string;
  folder_id: string | null;
  credential_id: string | null;
  name: string;
  protocol: Protocol;
  host: string;
  port: number;
  remote_initial_path: string;
  local_initial_path: string;
  passive_mode: boolean;
  accept_invalid_certs: boolean;
  sort_order: number;
  conflict_id: string | null;
  action: ImportAction;
}

export interface ImportPreview {
  encrypted: boolean;
  folders: ImportPreviewFolder[];
  credentials: ImportPreviewCredential[];
  sessions: ImportPreviewSession[];
}

export interface ImportCommitRequest {
  raw_json: string;
  import_password: string | null;
  folders: ImportPreviewFolder[];
  credentials: ImportPreviewCredential[];
  sessions: ImportPreviewSession[];
}

export interface ImportResult {
  folders_imported: number;
  credentials_imported: number;
  sessions_imported: number;
}

export interface ExportOptions {
  include_usernames: boolean;
  include_secrets: boolean;
  export_password?: string;
}

export interface ExportSummary {
  encrypted: boolean;
  exported_at: string;
  folders_count: number;
  credentials_count: number;
  sessions_count: number;
}

export interface TransientAuth {
  username: string;
  password?: string;
}

export interface OpenTab {
  tabId: string;
  session: Session;
  transientAuth?: TransientAuth;
}

export interface FileEntry {
  name: string;
  path: string;
  is_dir: boolean;
  is_symlink: boolean;
  size: number;
  modified: string | null;
  permissions: string | null;
  mode: number | null;
  owner: string | null;
}

export type LogLevel = "command" | "response" | "info" | "error";

export interface SessionLogEvent {
  tab_id: string;
  timestamp: string;
  level: LogLevel;
  message: string;
}

export interface KnownHost {
  id: string;
  host: string;
  port: number;
  key_type: string;
  fingerprint: string;
  first_seen_at: string;
}

export interface HostKeyPromptInfo {
  host: string;
  port: number;
  key_type: string;
  fingerprint: string;
  mismatch: boolean;
  previous_fingerprint: string | null;
}

export type ConnectStatus = "connected" | "host_key_prompt" | "auth_required";

export interface ConnectResponse {
  status: ConnectStatus;
  current_dir: string | null;
  host_key_info: HostKeyPromptInfo | null;
}

export interface ConnectRequest {
  tab_id: string;
  protocol: Protocol;
  host: string;
  port: number;
  credential_id?: string | null;
  username?: string | null;
  password?: string | null;
  remote_initial_path?: string | null;
  passive_mode?: boolean;
  accept_invalid_certs?: boolean;
  trust_host_key?: boolean;
}

export type TransferDirection = "upload" | "download";

export type TransferStatus =
  | "queued"
  | "in_progress"
  | "paused"
  | "waiting_conflict"
  | "completed"
  | "failed"
  | "cancelled";

export type ConflictAction =
  | "overwrite"
  | "overwrite_if_newer_or_diff_size"
  | "skip"
  | "auto_rename";

export interface TransferItem {
  id: string;
  tab_id: string;
  direction: TransferDirection;
  file_name: string;
  local_path: string;
  remote_path: string;
  total_bytes: number;
  transferred_bytes: number;
  speed_bps: number;
  eta_seconds: number | null;
  status: TransferStatus;
  error: string | null;
}

export interface ConflictPromptEvent {
  transfer_id: string;
  tab_id: string;
  direction: TransferDirection;
  file_name: string;
  source_size: number;
  source_modified: number | null;
  dest_size: number;
  dest_modified: number | null;
}

export interface EnqueueEntry {
  local_path: string;
  remote_path: string;
  is_dir: boolean;
}

export interface EnqueueTransferRequest {
  tab_id: string;
  direction: TransferDirection;
  items: EnqueueEntry[];
}

export interface SshConnectRequest {
  tab_id: string;
  host: string;
  port: number;
  credential_id?: string | null;
  username?: string | null;
  password?: string | null;
  initial_dir?: string | null;
  cols?: number;
  rows?: number;
  trust_host_key?: boolean;
}

export interface SshDataEvent {
  tab_id: string;
  data_b64: string;
}

export interface SshClosedEvent {
  tab_id: string;
  reason: string;
}

export interface BackendError {
  code?: string;
  message?: string;
}

export function defaultPortForProtocol(protocol: Protocol): number {
  switch (protocol) {
    case "ftp":
    case "ftps_explicit":
      return 21;
    case "ftps_implicit":
      return 990;
    case "sftp":
    case "ssh":
      return 22;
  }
}

export function extractErrorMessage(err: unknown): string {
  if (typeof err === "string") return err;
  if (err && typeof err === "object") {
    const be = err as BackendError;
    if (be.message) return be.message;
  }
  return "Unknown error";
}
