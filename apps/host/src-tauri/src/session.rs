// session.rs — WebRTC session management for the host
// The host receives video track requests, adds screen capture stream
// and executes incoming input events from the controller

use std::sync::Arc;
use tokio::sync::{mpsc, Mutex};
use webrtc::api::APIBuilder;
use webrtc::api::interceptor_registry::register_default_interceptors;
use webrtc::api::media_engine::MediaEngine;
use webrtc::ice_transport::ice_server::RTCIceServer;
use webrtc::interceptor::registry::Registry;
use webrtc::peer_connection::configuration::RTCConfiguration;
use webrtc::peer_connection::RTCPeerConnection;
use webrtc::track::track_local::track_local_static_sample::TrackLocalStaticSample;
use webrtc::track::track_local::TrackLocal;
use webrtc::media::Sample;
use webrtc::data_channel::RTCDataChannel;
use webrtc::peer_connection::peer_connection_state::RTCPeerConnectionState;
use serde_json::Value;
use log::{info, warn, error};
use std::time::Duration;

use crate::capture::{self, Quality};
use crate::input::{self, InputEvent};

/// ICE servers — STUN + TURN for NAT traversal
fn ice_servers() -> Vec<RTCIceServer> {
    vec![
        RTCIceServer {
            urls: vec![
                "stun:stun.l.google.com:19302".to_string(),
                "stun:stun1.l.google.com:19302".to_string(),
            ],
            ..Default::default()
        },
        RTCIceServer {
            urls: vec!["turn:openrelay.metered.ca:80".to_string()],
            username: "openrelayproject".to_string(),
            credential: "openrelayproject".to_string(),
            ..Default::default()
        },
        RTCIceServer {
            urls: vec!["turn:openrelay.metered.ca:443".to_string()],
            username: "openrelayproject".to_string(),
            credential: "openrelayproject".to_string(),
            ..Default::default()
        },
    ]
}

/// Start a WebRTC host session
/// - Adds screen capture as video track
/// - Handles DataChannel for input events
pub async fn start_host_session(
    session_id: String,
    quality: Quality,
    screen_index: usize,
    on_signal: impl Fn(Value) + Send + Sync + 'static,
) -> anyhow::Result<Arc<RTCPeerConnection>> {
    info!("[Session] Starting host session {}", session_id);

    // Setup WebRTC media engine
    let mut media_engine = MediaEngine::default();
    media_engine.register_default_codecs()?;

    let mut registry = Registry::new();
    registry = register_default_interceptors(registry, &mut media_engine)?;

    let api = APIBuilder::new()
        .with_media_engine(media_engine)
        .with_interceptor_registry(registry)
        .build();

    let config = RTCConfiguration {
        ice_servers: ice_servers(),
        ..Default::default()
    };

    let pc = Arc::new(api.new_peer_connection(config).await?);

    // Create video track for screen capture
    let video_track = Arc::new(TrackLocalStaticSample::new(
        webrtc::rtp_transceiver::rtp_codec::RTCRtpCodecCapability {
            mime_type: "video/vp8".to_string(),
            ..Default::default()
        },
        "screen".to_string(),
        "connectpro".to_string(),
    ));

    let rtp_sender = pc
        .add_track(Arc::clone(&video_track) as Arc<dyn TrackLocal + Send + Sync>)
        .await?;

    // Read RTCP packets to unblock senders
    tokio::spawn(async move {
        let mut rtcp_buf = vec![0u8; 1500];
        while let Ok((_, _)) = rtp_sender.read(&mut rtcp_buf).await {}
    });

    // Start screen capture loop → encode → send to WebRTC track
    let track_ref = video_track.clone();
    let q = quality;
    tokio::task::spawn_blocking(move || {
        let (tx, mut rx) = mpsc::unbounded_channel::<capture::Frame>();

        // Capture in a thread (scrap is sync)
        std::thread::spawn(move || {
            if let Err(e) = capture::start_capture_loop(screen_index, q, tx) {
                error!("[Capture] Loop error: {}", e);
            }
        });

        // Encode & push to WebRTC track
        let rt = tokio::runtime::Handle::current();
        while let Some(frame) = rx.blocking_recv() {
            let jpeg = match capture::encode_jpeg(&frame, q.jpeg_quality()) {
                Ok(j) => j,
                Err(e) => { warn!("[Capture] Encode error: {}", e); continue; }
            };
            let sample = Sample {
                data: jpeg.into(),
                duration: Duration::from_millis(1000 / q.target_fps()),
                ..Default::default()
            };
            rt.block_on(async {
                if let Err(e) = track_ref.write_sample(&sample).await {
                    warn!("[Session] Track write error: {}", e);
                }
            });
        }
    });

    // Handle DataChannel for input events
    let pc_ref = pc.clone();
    pc.on_data_channel(Box::new(move |dc: Arc<RTCDataChannel>| {
        info!("[Session] DataChannel opened: {}", dc.label());
        let dc_ref = dc.clone();

        Box::pin(async move {
            dc_ref.on_message(Box::new(move |msg| {
                Box::pin(async move {
                    if let Ok(text) = std::str::from_utf8(&msg.data) {
                        if let Ok(event) = serde_json::from_str::<InputEvent>(text) {
                            if let Err(e) = input::execute_input(&event) {
                                warn!("[Input] Execute error: {}", e);
                            }
                        }
                    }
                })
            }));
        })
    }));

    // ICE candidate handler — send to signaling
    let on_signal = Arc::new(on_signal);
    let on_signal_ref = on_signal.clone();
    pc.on_ice_candidate(Box::new(move |candidate| {
        let on_signal = on_signal_ref.clone();
        Box::pin(async move {
            if let Some(c) = candidate {
                if let Ok(json) = c.to_json() {
                    on_signal(serde_json::json!({
                        "type": "ice-candidate",
                        "candidate": json,
                    }));
                }
            }
        })
    }));

    // Connection state
    pc.on_peer_connection_state_change(Box::new(|state: RTCPeerConnectionState| {
        Box::pin(async move {
            info!("[Session] Peer connection state: {}", state);
        })
    }));

    Ok(pc)
}
