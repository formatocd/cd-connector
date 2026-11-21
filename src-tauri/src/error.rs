use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("Database error: {0}")]
    Db(#[from] rusqlite::Error),

    #[error("Cryptography error: {0}")]
    Crypto(String),

    #[error("Vault is locked")]
    VaultLocked,

    #[error("Security mode is not initialized")]
    SecurityNotInitialized,

    #[error("Invalid master password")]
    InvalidPassword,

    #[error("Resource not found: {0}")]
    NotFound(String),

    #[error("Validation error: {0}")]
    Validation(String),

    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Serialization error: {0}")]
    Serialization(#[from] serde_json::Error),
}

#[derive(Serialize)]
struct SerializedError {
    code: &'static str,
    message: String,
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        let code = match self {
            AppError::Db(_) => "DB_ERROR",
            AppError::Crypto(_) => "CRYPTO_ERROR",
            AppError::VaultLocked => "VAULT_LOCKED",
            AppError::SecurityNotInitialized => "SECURITY_NOT_INITIALIZED",
            AppError::InvalidPassword => "INVALID_PASSWORD",
            AppError::NotFound(_) => "NOT_FOUND",
            AppError::Validation(_) => "VALIDATION_ERROR",
            AppError::Io(_) => "IO_ERROR",
            AppError::Serialization(_) => "SERIALIZATION_ERROR",
        };
        SerializedError {
            code,
            message: self.to_string(),
        }
        .serialize(serializer)
    }
}

pub type AppResult<T> = Result<T, AppError>;
