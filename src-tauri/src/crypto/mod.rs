use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use argon2::Argon2;
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use rand::{rngs::OsRng, RngCore};
use std::fs;
use std::path::Path;
use zeroize::{Zeroize, ZeroizeOnDrop};

use crate::error::{AppError, AppResult};

const VERIFICATION_SENTINEL: &[u8] = b"CD_CONNECTOR_VAULT_V1_OK";
const KEY_FILE_NAME: &str = "vault.key";

#[derive(Clone, Zeroize, ZeroizeOnDrop)]
pub struct MasterKey(pub [u8; 32]);

impl MasterKey {
    pub fn random() -> Self {
        let mut bytes = [0u8; 32];
        OsRng.fill_bytes(&mut bytes);
        Self(bytes)
    }

    pub fn from_bytes(bytes: [u8; 32]) -> Self {
        Self(bytes)
    }
}

pub fn generate_salt() -> [u8; 16] {
    let mut salt = [0u8; 16];
    OsRng.fill_bytes(&mut salt);
    salt
}

pub fn derive_key(password: &str, salt: &[u8]) -> AppResult<MasterKey> {
    let mut key = [0u8; 32];
    Argon2::default()
        .hash_password_into(password.as_bytes(), salt, &mut key)
        .map_err(|e| AppError::Crypto(format!("Argon2id derivation failed: {e}")))?;
    Ok(MasterKey::from_bytes(key))
}

pub fn encrypt(key: &MasterKey, plaintext: &[u8]) -> AppResult<(Vec<u8>, Vec<u8>)> {
    let cipher = Aes256Gcm::new_from_slice(&key.0)
        .map_err(|e| AppError::Crypto(format!("Cipher init failed: {e}")))?;
    let mut nonce_bytes = [0u8; 12];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ciphertext = cipher
        .encrypt(nonce, plaintext)
        .map_err(|e| AppError::Crypto(format!("AES-256-GCM encryption failed: {e}")))?;
    Ok((ciphertext, nonce_bytes.to_vec()))
}

pub fn decrypt(key: &MasterKey, ciphertext: &[u8], nonce_bytes: &[u8]) -> AppResult<Vec<u8>> {
    if nonce_bytes.len() != 12 {
        return Err(AppError::Crypto("Invalid nonce length".into()));
    }
    let cipher = Aes256Gcm::new_from_slice(&key.0)
        .map_err(|e| AppError::Crypto(format!("Cipher init failed: {e}")))?;
    let nonce = Nonce::from_slice(nonce_bytes);
    cipher
        .decrypt(nonce, ciphertext)
        .map_err(|_| AppError::InvalidPassword)
}

pub fn create_verification_token(key: &MasterKey) -> AppResult<String> {
    let (ciphertext, nonce) = encrypt(key, VERIFICATION_SENTINEL)?;
    let mut combined = Vec::with_capacity(nonce.len() + ciphertext.len());
    combined.extend_from_slice(&nonce);
    combined.extend_from_slice(&ciphertext);
    Ok(B64.encode(combined))
}

pub fn verify_key(key: &MasterKey, token_b64: &str) -> AppResult<bool> {
    let combined = B64
        .decode(token_b64)
        .map_err(|e| AppError::Crypto(format!("Invalid verification token encoding: {e}")))?;
    if combined.len() <= 12 {
        return Ok(false);
    }
    let (nonce, ciphertext) = combined.split_at(12);
    match decrypt(key, ciphertext, nonce) {
        Ok(plaintext) => Ok(plaintext == VERIFICATION_SENTINEL),
        Err(AppError::InvalidPassword) => Ok(false),
        Err(e) => Err(e),
    }
}

pub fn save_transparent_key(app_data_dir: &Path, key: &MasterKey) -> AppResult<()> {
    fs::create_dir_all(app_data_dir)?;
    let key_path = app_data_dir.join(KEY_FILE_NAME);
    let encoded = B64.encode(key.0);
    fs::write(&key_path, encoded)?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&key_path, fs::Permissions::from_mode(0o600))?;
    }

    Ok(())
}

pub fn load_transparent_key(app_data_dir: &Path) -> AppResult<MasterKey> {
    let key_path = app_data_dir.join(KEY_FILE_NAME);
    let encoded = fs::read_to_string(&key_path).map_err(|e| {
        AppError::Crypto(format!(
            "Could not read local transparent vault key: {e}"
        ))
    })?;
    let decoded = B64
        .decode(encoded.trim())
        .map_err(|e| AppError::Crypto(format!("Invalid local key encoding: {e}")))?;
    if decoded.len() != 32 {
        return Err(AppError::Crypto("Invalid local key length".into()));
    }
    let mut bytes = [0u8; 32];
    bytes.copy_from_slice(&decoded);
    Ok(MasterKey::from_bytes(bytes))
}

pub fn remove_transparent_key(app_data_dir: &Path) -> AppResult<()> {
    let key_path = app_data_dir.join(KEY_FILE_NAME);
    if key_path.exists() {
        fs::remove_file(key_path)?;
    }
    Ok(())
}
