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
}

export interface Folder {
  id: string;
  parent_id: string | null;
  name: string;
  sort_order: number;
}

export interface FolderInput {
  parent_id: string | null;
  name: string;
  sort_order?: number;
}

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

export interface ExportSummary {
  encrypted: boolean;
  exported_at: string;
  folders_count: number;
  credentials_count: number;
  sessions_count: number;
}

export interface OpenTab {
  tabId: string;
  session: Session;
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
