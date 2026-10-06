// ConnectPro V2 - HOST Agent
// Architecture: Tauri v2 + scrap (screen capture) + enigo (input control) + WebRTC
// Inspired by RustDesk / AnyDesk internals

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod capture;
mod input;
mod session;
mod signaling;
mod crypto;
mod device;

use std::sync::Arc;
use tokio::sync::{Mutex, RwLock};
use tauri::{Manager, AppHandle, State};
use serde::{Deserialize, Serialize};
use log::{info, error, warn};

// ─────────────────────────────────────────────
// Global App State
// ─────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceInfo {
    pub device_id: String,   // 9-digit ID like AnyDesk: "483 291 734"
    pub hostname: String,
    pub os: String,
    pub password: String,    // Hashed access password
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum SessionState {
    Idle,
    WaitingApproval { from_id: String, from_name: String },
    Active { session_id: String, controller_id: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Permissions {
    pub allow_control: bool,
    pub allow_file_transfer: bool,
    pub allow_clipboard: bool,
}

pub struct AppState {
    pub device_info: RwLock<DeviceInfo>,
    pub session_state: Mutex<SessionState>,
    pub permissions: Mutex<Permissions>,
    pub signaling_url: String,
}

// ─────────────────────────────────────────────
// Tauri Commands (called from Svelte frontend)
// ─────────────────────────────────────────────

/// Get device info (ID, hostname, OS)
#[tauri::command]
async fn get_device_info(state: State<'_, Arc<AppState>>) -> Result<DeviceInfo, String> {
    let info = state.device_info.read().await;
    Ok(info.clone())
}

/// Get current session state
#[tauri::command]
async fn get_session_state(state: State<'_, Arc<AppState>>) -> Result<SessionState, String> {
    let s = state.session_state.lock().await;
    Ok(s.clone())
}

/// Accept an incoming connection request
#[tauri::command]
async fn accept_connection(
    request_id: String,
    permissions: Permissions,
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    info!("[Host] Accepting connection request {}", request_id);

    let session_id = uuid::Uuid::new_v4().to_string();
    {
        let mut s = state.session_state.lock().await;
        // controller_id will be filled from signaling response
        *s = SessionState::Active {
            session_id: session_id.clone(),
            controller_id: request_id.clone(),
        };
    }
    {
        let mut p = state.permissions.lock().await;
        *p = permissions.clone();
    }

    // Notify frontend
    app.emit("session-accepted", serde_json::json!({
        "session_id": session_id,
        "permissions": permissions
    })).map_err(|e| e.to_string())?;

    // Tell signaling server we accepted
    signaling::accept_request(&request_id, &session_id, &permissions).await
        .map_err(|e| e.to_string())?;

    Ok(())
}

/// Reject an incoming connection request
#[tauri::command]
async fn reject_connection(
    request_id: String,
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    info!("[Host] Rejecting connection {}", request_id);
    {
        let mut s = state.session_state.lock().await;
        *s = SessionState::Idle;
    }
    app.emit("session-rejected", serde_json::json!({ "request_id": request_id }))
        .map_err(|e| e.to_string())?;

    signaling::reject_request(&request_id).await
        .map_err(|e| e.to_string())?;

    Ok(())
}

/// End active session
#[tauri::command]
async fn end_session(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    let session_id = {
        let s = state.session_state.lock().await;
        match &*s {
            SessionState::Active { session_id, .. } => session_id.clone(),
            _ => return Err("No active session".to_string()),
        }
    };
    {
        let mut s = state.session_state.lock().await;
        *s = SessionState::Idle;
    }

    app.emit("session-ended", serde_json::json!({ "session_id": session_id }))
        .map_err(|e| e.to_string())?;
    signaling::end_session(&session_id).await
        .map_err(|e| e.to_string())?;

    Ok(())
}

/// Set access password
#[tauri::command]
async fn set_password(
    password: String,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    let hashed = crypto::hash_password(&password);
    let mut info = state.device_info.write().await;
    info.password = hashed;
    Ok(())
}

/// Get list of available screens
#[tauri::command]
async fn get_screens() -> Result<Vec<capture::ScreenInfo>, String> {
    capture::list_screens().map_err(|e| e.to_string())
}

// ─────────────────────────────────────────────
// Main Entry Point
// ─────────────────────────────────────────────

#[tokio::main]
async fn main() {
    env_logger::init();
    info!("[ConnectPro Host] Starting v2.0.0");

    // Generate or load persistent device ID
    let device_id = device::get_or_create_id();
    let formatted_id = device::format_id(&device_id);
    let hostname = hostname::get()
        .unwrap_or_else(|_| "Unknown PC".into())
        .into_string()
        .unwrap_or_else(|_| "Unknown PC".to_string());

    let os = std::env::consts::OS.to_string();

    let device_info = DeviceInfo {
        device_id: formatted_id.clone(),
        hostname: hostname.clone(),
        os,
        password: String::new(),
    };

    info!("[ConnectPro Host] Device ID: {}", formatted_id);

    let signaling_url = std::env::var("SIGNALING_URL")
        .unwrap_or_else(|_| "https://connectpro-signaling.up.railway.app".to_string());

    let app_state = Arc::new(AppState {
        device_info: RwLock::new(device_info),
        session_state: Mutex::new(SessionState::Idle),
        permissions: Mutex::new(Permissions {
            allow_control: false,
            allow_file_transfer: false,
            allow_clipboard: false,
        }),
        signaling_url: signaling_url.clone(),
    });

    let state_clone = app_state.clone();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(app_state)
        .setup(move |app| {
            let app_handle = app.handle().clone();
            let state = state_clone.clone();
            let url = signaling_url.clone();

            // Start signaling client in background
            tokio::spawn(async move {
                if let Err(e) = signaling::start_client(app_handle, state, &url).await {
                    error!("[Signaling] Client error: {}", e);
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_device_info,
            get_session_state,
            accept_connection,
            reject_connection,
            end_session,
            set_password,
            get_screens,
        ])
        .run(tauri::generate_context!())
        .expect("Error running ConnectPro Host");
}
