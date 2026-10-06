// crypto.rs — AES-256-GCM encryption + password hashing

use aes_gcm::{
    aead::{Aead, AeadCore, KeyInit, OsRng},
    Aes256Gcm, Key, Nonce,
};
use base64::Engine;
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};

/// Hash a password for storage (simple hash — use argon2 in production)
pub fn hash_password(password: &str) -> String {
    let mut hasher = DefaultHasher::new();
    password.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

/// Verify a password against stored hash
pub fn verify_password(password: &str, hash: &str) -> bool {
    hash_password(password) == hash
}

/// Generate a random 256-bit AES key
pub fn generate_key() -> Vec<u8> {
    let key = Aes256Gcm::generate_key(OsRng);
    key.to_vec()
}

/// Encrypt data with AES-256-GCM
pub fn encrypt(data: &[u8], key: &[u8]) -> anyhow::Result<Vec<u8>> {
    let key = Key::<Aes256Gcm>::from_slice(key);
    let cipher = Aes256Gcm::new(key);
    let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
    let ciphertext = cipher.encrypt(&nonce, data)
        .map_err(|e| anyhow::anyhow!("Encrypt error: {}", e))?;

    // Prepend nonce to ciphertext
    let mut result = nonce.to_vec();
    result.extend_from_slice(&ciphertext);
    Ok(result)
}

/// Decrypt data with AES-256-GCM
pub fn decrypt(data: &[u8], key: &[u8]) -> anyhow::Result<Vec<u8>> {
    if data.len() < 12 {
        return Err(anyhow::anyhow!("Data too short"));
    }
    let (nonce_bytes, ciphertext) = data.split_at(12);
    let key = Key::<Aes256Gcm>::from_slice(key);
    let cipher = Aes256Gcm::new(key);
    let nonce = Nonce::from_slice(nonce_bytes);
    cipher.decrypt(nonce, ciphertext)
        .map_err(|e| anyhow::anyhow!("Decrypt error: {}", e))
}

/// Encode bytes to base64
pub fn to_base64(data: &[u8]) -> String {
    base64::engine::general_purpose::STANDARD.encode(data)
}

/// Decode base64 to bytes
pub fn from_base64(s: &str) -> anyhow::Result<Vec<u8>> {
    base64::engine::general_purpose::STANDARD
        .decode(s)
        .map_err(|e| anyhow::anyhow!("Base64 decode error: {}", e))
}
