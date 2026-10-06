// device.rs — Persistent 9-digit device ID (like AnyDesk)
// Generated from machine hardware UID, stored locally

use std::fs;
use std::path::PathBuf;

/// Get or create a persistent 9-digit device ID
pub fn get_or_create_id() -> String {
    let id_file = id_file_path();

    // Try to read existing ID
    if let Ok(id) = fs::read_to_string(&id_file) {
        let id = id.trim().to_string();
        if id.len() == 9 && id.chars().all(|c| c.is_ascii_digit()) {
            return id;
        }
    }

    // Generate new ID from machine UID
    let new_id = generate_id();
    let _ = fs::create_dir_all(id_file.parent().unwrap());
    let _ = fs::write(&id_file, &new_id);
    new_id
}

/// Format ID as "XXX XXX XXX" (AnyDesk style)
pub fn format_id(id: &str) -> String {
    if id.len() == 9 {
        format!("{} {} {}", &id[0..3], &id[3..6], &id[6..9])
    } else {
        id.to_string()
    }
}

/// Strip spaces from formatted ID
pub fn strip_id(id: &str) -> String {
    id.replace(' ', "")
}

fn generate_id() -> String {
    // Try to use machine hardware UID for persistence across reinstalls
    let base = machine_uid::get()
        .unwrap_or_else(|_| uuid::Uuid::new_v4().to_string());

    // Hash to 9 digits
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut hasher = DefaultHasher::new();
    base.hash(&mut hasher);
    let hash = hasher.finish();

    // Map to 9-digit number (100_000_000 to 999_999_999)
    let id_num = 100_000_000u64 + (hash % 900_000_000u64);
    format!("{:09}", id_num)
}

fn id_file_path() -> PathBuf {
    let data_dir = dirs::data_local_dir()
        .unwrap_or_else(|| PathBuf::from("."));
    data_dir.join("ConnectPro").join("device_id")
}
