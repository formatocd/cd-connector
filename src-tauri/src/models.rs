use serde::{Deserialize, Serialize};
use zeroize::{Zeroize, ZeroizeOnDrop};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SecurityMode {
    MasterPassword,
    Transparent,
}

impl SecurityMode {
    pub fn as_str(&self) -> &'static str {
        match self {
            SecurityMode::MasterPassword => "master_password",
            SecurityMode::Transparent => "transparent",
        }
    }

    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "master_password" => Some(SecurityMode::MasterPassword),
            "transparent" => Some(SecurityMode::Transparent),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SecurityStatus {
    pub initialized: bool,
    pub mode: Option<SecurityMode>,
    pub unlocked: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AuthType {
    Password,
    SshKey,
    SshAgent,
    TlsCert,
}

impl AuthType {
    pub fn as_str(&self) -> &'static str {
        match self {
            AuthType::Password => "password",
            AuthType::SshKey => "ssh_key",
            AuthType::SshAgent => "ssh_agent",
            AuthType::TlsCert => "tls_cert",
        }
    }

    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "password" => Some(AuthType::Password),
            "ssh_key" => Some(AuthType::SshKey),
            "ssh_agent" => Some(AuthType::SshAgent),
            "tls_cert" => Some(AuthType::TlsCert),
            _ => None,
        }
    }
}

#[derive(Clone, Default, Serialize, Deserialize, Zeroize, ZeroizeOnDrop)]
pub struct CredentialSecretPayload {
    pub password: Option<String>,
    pub private_key: Option<String>,
    pub passphrase: Option<String>,
    pub tls_cert: Option<String>,
    pub tls_key: Option<String>,
}

impl std::fmt::Debug for CredentialSecretPayload {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("CredentialSecretPayload")
            .field("password", &self.password.as_ref().map(|_| "[REDACTED]"))
            .field("private_key", &self.private_key.as_ref().map(|_| "[REDACTED]"))
            .field("passphrase", &self.passphrase.as_ref().map(|_| "[REDACTED]"))
            .finish()
    }
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CredentialSummary {
    pub id: String,
    pub name: String,
    pub username: String,
    pub auth_type: AuthType,
    pub has_secret: bool,
    pub has_passphrase: bool,
    #[serde(default = "default_true")]
    pub reusable: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone)]
pub struct CredentialRow {
    pub id: String,
    pub name: String,
    pub username: String,
    pub auth_type: AuthType,
    pub encrypted_secret: Vec<u8>,
    pub nonce: Vec<u8>,
    pub has_passphrase: bool,
    pub reusable: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CredentialInput {
    pub name: String,
    pub username: String,
    pub auth_type: AuthType,
    pub password: Option<String>,
    pub private_key: Option<String>,
    pub passphrase: Option<String>,
    pub keep_existing_secret: Option<bool>,
    pub clone_from_credential_id: Option<String>,
    pub reusable: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Folder {
    pub id: String,
    pub parent_id: Option<String>,
    pub name: String,
    pub sort_order: i64,
    #[serde(default)]
    pub icon_color: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct FolderInput {
    pub parent_id: Option<String>,
    pub name: String,
    pub sort_order: Option<i64>,
    pub icon_color: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Protocol {
    Ftp,
    FtpsExplicit,
    FtpsImplicit,
    Sftp,
    Ssh,
}

impl Protocol {
    pub fn as_str(&self) -> &'static str {
        match self {
            Protocol::Ftp => "ftp",
            Protocol::FtpsExplicit => "ftps_explicit",
            Protocol::FtpsImplicit => "ftps_implicit",
            Protocol::Sftp => "sftp",
            Protocol::Ssh => "ssh",
        }
    }

    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "ftp" => Some(Protocol::Ftp),
            "ftps_explicit" | "ftps" => Some(Protocol::FtpsExplicit),
            "ftps_implicit" => Some(Protocol::FtpsImplicit),
            "sftp" => Some(Protocol::Sftp),
            "ssh" => Some(Protocol::Ssh),
            _ => None,
        }
    }

    pub fn default_port(&self) -> u16 {
        match self {
            Protocol::Ftp | Protocol::FtpsExplicit => 21,
            Protocol::FtpsImplicit => 990,
            Protocol::Sftp | Protocol::Ssh => 22,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Session {
    pub id: String,
    pub folder_id: Option<String>,
    pub credential_id: Option<String>,
    pub name: String,
    pub protocol: Protocol,
    pub host: String,
    pub port: u16,
    pub remote_initial_path: String,
    pub local_initial_path: String,
    pub passive_mode: bool,
    pub accept_invalid_certs: bool,
    pub sort_order: i64,
    #[serde(default)]
    pub icon_color: Option<String>,
    #[serde(default)]
    pub last_opened_at: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SessionInput {
    pub folder_id: Option<String>,
    pub credential_id: Option<String>,
    pub name: String,
    pub protocol: Protocol,
    pub host: String,
    pub port: Option<u16>,
    pub remote_initial_path: Option<String>,
    pub local_initial_path: Option<String>,
    pub passive_mode: Option<bool>,
    pub accept_invalid_certs: Option<bool>,
    pub sort_order: Option<i64>,
    pub icon_color: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    pub theme: String,
    pub language: String,
    pub max_concurrent_transfers: u32,
    pub upload_limit_kbps: u64,
    pub download_limit_kbps: u64,
    pub ui_show_sidebar: bool,
    pub ui_show_local_panel: bool,
    pub ui_show_queue_panel: bool,
    pub ui_show_command_panel: bool,
    #[serde(default = "default_terminal_font_family")]
    pub terminal_font_family: String,
    #[serde(default = "default_terminal_font_size")]
    pub terminal_font_size: u16,
    #[serde(default = "default_true")]
    pub terminal_copy_on_select: bool,
}

fn default_terminal_font_family() -> String {
    "Cascadia Code, Consolas, ui-monospace, monospace".to_string()
}

fn default_terminal_font_size() -> u16 {
    13
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            theme: "system".to_string(),
            language: "en".to_string(),
            max_concurrent_transfers: 3,
            upload_limit_kbps: 0,
            download_limit_kbps: 0,
            ui_show_sidebar: true,
            ui_show_local_panel: true,
            ui_show_queue_panel: true,
            ui_show_command_panel: true,
            terminal_font_family: default_terminal_font_family(),
            terminal_font_size: default_terminal_font_size(),
            terminal_copy_on_select: true,
        }
    }
}

// --- Portability (Export / Import) ---

#[derive(Debug, Clone, Deserialize)]
pub struct ExportOptions {
    pub include_usernames: bool,
    pub include_secrets: bool,
    pub export_password: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportFolder {
    pub id: String,
    pub parent_id: Option<String>,
    pub name: String,
    pub sort_order: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon_color: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportCredential {
    pub id: String,
    pub name: String,
    pub username: String,
    pub auth_type: AuthType,
    pub has_passphrase: bool,
    #[serde(default = "default_true")]
    pub reusable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub encrypted_secret_b64: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub nonce_b64: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportSession {
    pub id: String,
    pub folder_id: Option<String>,
    pub credential_id: Option<String>,
    pub name: String,
    pub protocol: Protocol,
    pub host: String,
    pub port: u16,
    pub remote_initial_path: String,
    pub local_initial_path: String,
    pub passive_mode: bool,
    pub accept_invalid_certs: bool,
    pub sort_order: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon_color: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportBundle {
    pub version: u32,
    pub app: String,
    pub exported_at: String,
    pub encrypted: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub salt_b64: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub verification_token: Option<String>,
    pub folders: Vec<ExportFolder>,
    pub credentials: Vec<ExportCredential>,
    pub sessions: Vec<ExportSession>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ImportAction {
    Import,
    Overwrite,
    Skip,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportPreviewFolder {
    pub id: String,
    pub parent_id: Option<String>,
    pub name: String,
    pub sort_order: i64,
    #[serde(default)]
    pub icon_color: Option<String>,
    pub conflict_id: Option<String>,
    pub action: ImportAction,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportPreviewCredential {
    pub id: String,
    pub name: String,
    pub username: String,
    pub auth_type: AuthType,
    pub has_secret: bool,
    pub has_passphrase: bool,
    #[serde(default = "default_true")]
    pub reusable: bool,
    pub conflict_id: Option<String>,
    pub action: ImportAction,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportPreviewSession {
    pub id: String,
    pub folder_id: Option<String>,
    pub credential_id: Option<String>,
    pub name: String,
    pub protocol: Protocol,
    pub host: String,
    pub port: u16,
    pub remote_initial_path: String,
    pub local_initial_path: String,
    pub passive_mode: bool,
    pub accept_invalid_certs: bool,
    pub sort_order: i64,
    #[serde(default)]
    pub icon_color: Option<String>,
    pub conflict_id: Option<String>,
    pub action: ImportAction,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportPreview {
    pub encrypted: bool,
    pub folders: Vec<ImportPreviewFolder>,
    pub credentials: Vec<ImportPreviewCredential>,
    pub sessions: Vec<ImportPreviewSession>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ImportCommitRequest {
    pub raw_json: String,
    pub import_password: Option<String>,
    pub folders: Vec<ImportPreviewFolder>,
    pub credentials: Vec<ImportPreviewCredential>,
    pub sessions: Vec<ImportPreviewSession>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ImportResult {
    pub folders_imported: usize,
    pub credentials_imported: usize,
    pub sessions_imported: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct ExportSummary {
    pub encrypted: bool,
    pub exported_at: String,
    pub folders_count: usize,
    pub credentials_count: usize,
    pub sessions_count: usize,
}

// --- Phase 2: Protocol Engine, File Entries, Console & Known Hosts ---

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub is_symlink: bool,
    pub size: u64,
    pub modified: Option<String>,
    pub permissions: Option<String>,
    pub mode: Option<u32>,
    pub owner: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LogLevel {
    Command,
    Response,
    Info,
    Error,
}

#[derive(Debug, Clone, Serialize)]
pub struct SessionLogEvent {
    pub tab_id: String,
    pub timestamp: String,
    pub level: LogLevel,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KnownHost {
    pub id: String,
    pub host: String,
    pub port: u16,
    pub key_type: String,
    pub fingerprint: String,
    pub first_seen_at: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct HostKeyPromptInfo {
    pub host: String,
    pub port: u16,
    pub key_type: String,
    pub fingerprint: String,
    pub mismatch: bool,
    pub previous_fingerprint: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ConnectStatus {
    Connected,
    HostKeyPrompt,
    AuthRequired,
}

#[derive(Debug, Clone, Serialize)]
pub struct ConnectResponse {
    pub status: ConnectStatus,
    pub current_dir: Option<String>,
    pub host_key_info: Option<HostKeyPromptInfo>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ConnectRequest {
    pub tab_id: String,
    pub protocol: Protocol,
    pub host: String,
    pub port: u16,
    pub credential_id: Option<String>,
    pub username: Option<String>,
    pub password: Option<String>,
    pub remote_initial_path: Option<String>,
    pub passive_mode: Option<bool>,
    pub accept_invalid_certs: Option<bool>,
    pub expected_host_key_fingerprint: Option<String>,
}

// --- Phase 4: Transfer Queue & Conflict Resolution ---

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TransferDirection {
    Upload,
    Download,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TransferStatus {
    Queued,
    InProgress,
    Paused,
    WaitingConflict,
    Completed,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ConflictAction {
    Overwrite,
    OverwriteIfNewerOrDiffSize,
    Skip,
    AutoRename,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransferItem {
    pub id: String,
    pub tab_id: String,
    pub direction: TransferDirection,
    pub file_name: String,
    pub local_path: String,
    pub remote_path: String,
    pub total_bytes: u64,
    pub transferred_bytes: u64,
    pub speed_bps: u64,
    pub eta_seconds: Option<u64>,
    pub status: TransferStatus,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ConflictPromptEvent {
    pub transfer_id: String,
    pub tab_id: String,
    pub direction: TransferDirection,
    pub file_name: String,
    pub source_size: u64,
    pub source_modified: Option<i64>,
    pub dest_size: u64,
    pub dest_modified: Option<i64>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct EnqueueEntry {
    pub local_path: String,
    pub remote_path: String,
    pub is_dir: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct EnqueueTransferRequest {
    pub tab_id: String,
    pub direction: TransferDirection,
    pub items: Vec<EnqueueEntry>,
}

// --- Phase 4.5: SSH Terminal Emulator ---

#[derive(Debug, Clone, Deserialize)]
pub struct SshConnectRequest {
    pub tab_id: String,
    pub host: String,
    pub port: u16,
    pub credential_id: Option<String>,
    pub username: Option<String>,
    pub password: Option<String>,
    pub initial_dir: Option<String>,
    pub cols: Option<u32>,
    pub rows: Option<u32>,
    pub expected_host_key_fingerprint: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SshDataEvent {
    pub tab_id: String,
    pub data_b64: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct SshClosedEvent {
    pub tab_id: String,
    pub reason: String,
}

