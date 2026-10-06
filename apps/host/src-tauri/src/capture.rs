// capture.rs — Screen capture using `scrap` crate (60fps, cross-platform)
// scrap uses OS APIs: DXGI on Windows, CGDisplayStream on macOS, X11/pipewire on Linux

use scrap::{Capturer, Display};
use std::io::ErrorKind::WouldBlock;
use std::time::{Duration, Instant};
use serde::{Serialize, Deserialize};
use log::{info, warn, error};
use tokio::sync::mpsc;

/// Metadata about a screen/display
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScreenInfo {
    pub index: usize,
    pub width: u32,
    pub height: u32,
    pub is_primary: bool,
    pub name: String,
}

/// A single captured frame
#[derive(Debug)]
pub struct Frame {
    pub data: Vec<u8>,       // Raw BGRA pixels
    pub width: u32,
    pub height: u32,
    pub timestamp: u64,      // Unix ms
}

/// Quality presets
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Quality {
    Original,    // 60fps, full res
    Balanced,    // 30fps, 80% quality
    LowBandwidth, // 15fps, 50% quality (4G Cameroun)
}

impl Quality {
    pub fn target_fps(&self) -> u64 {
        match self {
            Quality::Original => 60,
            Quality::Balanced => 30,
            Quality::LowBandwidth => 15,
        }
    }

    pub fn jpeg_quality(&self) -> u8 {
        match self {
            Quality::Original => 95,
            Quality::Balanced => 80,
            Quality::LowBandwidth => 50,
        }
    }
}

/// List all available screens
pub fn list_screens() -> anyhow::Result<Vec<ScreenInfo>> {
    let displays = Display::all()?;
    let screens = displays
        .into_iter()
        .enumerate()
        .map(|(i, d)| ScreenInfo {
            index: i,
            width: d.width() as u32,
            height: d.height() as u32,
            is_primary: i == 0,
            name: format!("Display {}", i + 1),
        })
        .collect();
    Ok(screens)
}

/// Start the capture loop — sends frames through the channel
/// Called in a dedicated thread (scrap is synchronous)
pub fn start_capture_loop(
    screen_index: usize,
    quality: Quality,
    frame_tx: mpsc::UnboundedSender<Frame>,
) -> anyhow::Result<()> {
    let displays = Display::all()?;
    let display = displays
        .into_iter()
        .nth(screen_index)
        .ok_or_else(|| anyhow::anyhow!("Screen {} not found", screen_index))?;

    let width = display.width() as u32;
    let height = display.height() as u32;
    let mut capturer = Capturer::new(display)?;

    info!("[Capture] Started {}x{} @ {}fps (screen {})",
        width, height, quality.target_fps(), screen_index);

    let frame_duration = Duration::from_micros(1_000_000 / quality.target_fps());
    let mut last_frame = Instant::now();

    loop {
        // Rate limiting
        let elapsed = last_frame.elapsed();
        if elapsed < frame_duration {
            std::thread::sleep(frame_duration - elapsed);
        }
        last_frame = Instant::now();

        match capturer.frame() {
            Ok(raw_frame) => {
                let data = raw_frame.to_vec();
                let ts = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_millis() as u64;

                let frame = Frame { data, width, height, timestamp: ts };

                if frame_tx.send(frame).is_err() {
                    info!("[Capture] Receiver dropped, stopping capture loop");
                    break;
                }
            }
            Err(ref e) if e.kind() == WouldBlock => {
                // No new frame yet, skip
                std::thread::sleep(Duration::from_millis(1));
            }
            Err(e) => {
                error!("[Capture] Frame error: {}", e);
                std::thread::sleep(Duration::from_millis(10));
            }
        }
    }

    info!("[Capture] Loop stopped");
    Ok(())
}

/// Encode a raw BGRA frame to JPEG bytes
/// Used before sending over WebRTC DataChannel or encoding to VP8
pub fn encode_jpeg(frame: &Frame, quality: u8) -> anyhow::Result<Vec<u8>> {
    use image::{ImageBuffer, Rgba, ImageEncoder};
    use image::codecs::jpeg::JpegEncoder;

    // scrap gives BGRA, convert to RGBA for image crate
    let mut rgba = frame.data.clone();
    for pixel in rgba.chunks_exact_mut(4) {
        pixel.swap(0, 2); // B <-> R
    }

    let img: ImageBuffer<Rgba<u8>, Vec<u8>> =
        ImageBuffer::from_raw(frame.width, frame.height, rgba)
            .ok_or_else(|| anyhow::anyhow!("Failed to create image buffer"))?;

    // Convert to RGB (JPEG doesn't support alpha)
    let rgb = image::DynamicImage::ImageRgba8(img).to_rgb8();

    let mut buf = Vec::new();
    let encoder = JpegEncoder::new_with_quality(&mut buf, quality);
    encoder.write_image(
        rgb.as_raw(),
        frame.width,
        frame.height,
        image::ColorType::Rgb8.into(),
    )?;

    Ok(buf)
}
