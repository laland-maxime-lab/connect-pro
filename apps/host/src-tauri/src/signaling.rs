// signaling.rs — Socket.IO client connecting to the signaling server
// Handles: registration, incoming requests, WebRTC signal relay

use std::sync::Arc;
use tokio::sync::RwLock;
use rust_socketio::{
    asynchronous::ClientBuilder,
    asynchronous::Client,
    Payload,
};
use serde_json::{json, Value};
use tauri::AppHandle;
use log::{info, warn, error};

use crate::{AppState, SessionState, Permissions};

static mut SOCKET_CLIENT: Option<Client> = None;

/// Start the Socket.IO signaling client
pub async fn start_client(
    app: AppHandle,
    state: Arc<AppState>,
    url: &str,
) -> anyhow::Result<()> {
    info!("[Signaling] Connecting to {}", url);

    let device_id = {
        let info = state.device_info.read().await;
        info.device_id.clone()
    };
    let hostname = {
        let info = state.device_info.read().await;
        info.hostname.clone()
    };

    let app_ref = app.clone();
    let state_ref = state.clone();

    let socket = ClientBuilder::new(url)
        .namespace("/")
        .on("connect", {
            let device_id = device_id.clone();
            let hostname = hostname.clone();
            move |_, socket: Client| {
                let device_id = device_id.clone();
                let hostname = hostname.clone();
                async move {
                    info!("[Signaling] Connected. Registering device {}", device_id);
                    let _ = socket.emit("register-device", json!({
                        "deviceId": device_id,
                        "name": hostname,
                        "os": std::env::consts::OS,
                        "version": "2.0.0"
                    })).await;
                }
            }
        })
        .on("registered", {
            let app = app_ref.clone();
            move |payload: Payload, _| {
                let app = app.clone();
                async move {
                    if let Payload::Text(vals) = payload {
                        if let Some(val) = vals.first() {
                            info!("[Signaling] Registered: {}", val);
                            let _ = app.emit("device-registered", val.clone());
                        }
                    }
                }
            }
        })
        .on("incoming-connection-request", {
            let app = app_ref.clone();
            let state = state_ref.clone();
            move |payload: Payload, _| {
                let app = app.clone();
                let state = state.clone();
                async move {
                    if let Payload::Text(vals) = payload {
                        if let Some(val) = vals.first() {
                            info!("[Signaling] Incoming request: {}", val);
                            let from_id = val["fromDeviceId"].as_str().unwrap_or("").to_string();
                            let from_name = val["fromDeviceName"].as_str().unwrap_or("Unknown").to_string();
                            let request_id = val["requestId"].as_str().unwrap_or("").to_string();

                            {
                                let mut s = state.session_state.lock().await;
                                *s = SessionState::WaitingApproval {
                                    from_id: from_id.clone(),
                                    from_name: from_name.clone(),
                                };
                            }

                            // Emit to Svelte frontend to show the "Accept/Reject" popup
                            let _ = app.emit("incoming-request", json!({
                                "requestId": request_id,
                                "fromId": from_id,
                                "fromName": from_name,
                            }));
                        }
                    }
                }
            }
        })
        .on("webrtc-signal", {
            let app = app_ref.clone();
            move |payload: Payload, _| {
                let app = app.clone();
                async move {
                    if let Payload::Text(vals) = payload {
                        if let Some(val) = vals.first() {
                            // Forward WebRTC signals to the frontend (Svelte handles WebRTC)
                            let _ = app.emit("webrtc-signal", val.clone());
                        }
                    }
                }
            }
        })
        .on("session-ended", {
            let app = app_ref.clone();
            let state = state_ref.clone();
            move |payload: Payload, _| {
                let app = app.clone();
                let state = state.clone();
                async move {
                    info!("[Signaling] Session ended by remote");
                    let mut s = state.session_state.lock().await;
                    *s = SessionState::Idle;
                    let _ = app.emit("session-ended", json!({}));
                }
            }
        })
        .on("disconnect", |_, _| async move {
            warn!("[Signaling] Disconnected from server");
        })
        .on("error", |err, _| async move {
            error!("[Signaling] Error: {:?}", err);
        })
        .connect()
        .await?;

    info!("[Signaling] Client running");

    // Keep alive
    loop {
        tokio::time::sleep(tokio::time::Duration::from_secs(30)).await;
    }
}

/// Tell signaling server we accept the connection
pub async fn accept_request(
    request_id: &str,
    session_id: &str,
    permissions: &Permissions,
) -> anyhow::Result<()> {
    // In real impl: get socket ref and emit
    // For now we emit through the frontend via Tauri event
    info!("[Signaling] Sending accept for {}", request_id);
    Ok(())
}

/// Tell signaling server we reject the connection
pub async fn reject_request(request_id: &str) -> anyhow::Result<()> {
    info!("[Signaling] Sending reject for {}", request_id);
    Ok(())
}

/// End an active session
pub async fn end_session(session_id: &str) -> antml::Result<()> {
    info!("[Signaling] Ending session {}", session_id);
    Ok(())
}
