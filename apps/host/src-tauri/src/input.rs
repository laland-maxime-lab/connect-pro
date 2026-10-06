// input.rs — OS-level mouse & keyboard control via `enigo`
// enigo uses: Win32 API on Windows, CGEvent on macOS, X11/uinput on Linux
// This is real OS-level control — not browser-limited like getDisplayMedia approach

use enigo::{
    Enigo, Settings,
    Mouse, Keyboard,
    Button, Direction,
    Key, Coordinate,
};
use serde::{Deserialize, Serialize};
use log::{debug, warn};
use std::sync::Mutex;

lazy_static::lazy_static! {
    static ref ENIGO: Mutex<Enigo> = Mutex::new(
        Enigo::new(&Settings::default()).expect("Failed to init Enigo input controller")
    );
}

/// Input event types sent from controller over DataChannel
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum InputEvent {
    /// Mouse move (absolute coordinates, normalized 0.0-1.0)
    MouseMove { x: f64, y: f64, screen_width: u32, screen_height: u32 },

    /// Mouse button click
    MouseClick { button: MouseButton, action: ButtonAction },

    /// Mouse wheel scroll
    MouseScroll { delta_x: i32, delta_y: i32 },

    /// Keyboard key press/release
    KeyEvent { key: String, action: ButtonAction },

    /// Text input (paste)
    TypeText { text: String },

    /// Clipboard sync from controller to host
    ClipboardSync { content: String },

    /// File chunk received
    FileChunk {
        transfer_id: String,
        filename: String,
        chunk_index: u32,
        total_chunks: u32,
        data: String,  // base64
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MouseButton {
    Left,
    Right,
    Middle,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ButtonAction {
    Press,
    Release,
    Click,
    DoubleClick,
}

impl From<&MouseButton> for Button {
    fn from(b: &MouseButton) -> Self {
        match b {
            MouseButton::Left => Button::Left,
            MouseButton::Right => Button::Right,
            MouseButton::Middle => Button::Middle,
        }
    }
}

/// Execute an input event on the host OS
pub fn execute_input(event: &InputEvent) -> anyhow::Result<()> {
    let mut enigo = ENIGO.lock().map_err(|e| anyhow::anyhow!("Enigo lock error: {}", e))?;

    match event {
        InputEvent::MouseMove { x, y, screen_width, screen_height } => {
            // Convert normalized coords to absolute screen pixels
            let abs_x = (*x * *screen_width as f64) as i32;
            let abs_y = (*y * *screen_height as f64) as i32;
            debug!("[Input] Mouse move: ({}, {})", abs_x, abs_y);
            enigo.move_mouse(abs_x, abs_y, Coordinate::Abs)?;
        }

        InputEvent::MouseClick { button, action } => {
            let btn: Button = button.into();
            debug!("[Input] Mouse {:?} {:?}", button, action);
            match action {
                ButtonAction::Press => enigo.button(btn, Direction::Press)?,
                ButtonAction::Release => enigo.button(btn, Direction::Release)?,
                ButtonAction::Click => enigo.button(btn, Direction::Click)?,
                ButtonAction::DoubleClick => {
                    enigo.button(btn, Direction::Click)?;
                    std::thread::sleep(std::time::Duration::from_millis(50));
                    enigo.button(btn, Direction::Click)?;
                }
            }
        }

        InputEvent::MouseScroll { delta_x, delta_y } => {
            debug!("[Input] Scroll ({}, {})", delta_x, delta_y);
            if *delta_y != 0 {
                enigo.scroll(*delta_y, enigo::Axis::Vertical)?;
            }
            if *delta_x != 0 {
                enigo.scroll(*delta_x, enigo::Axis::Horizontal)?;
            }
        }

        InputEvent::KeyEvent { key, action } => {
            debug!("[Input] Key '{}' {:?}", key, action);
            let enigo_key = map_key(key);
            match action {
                ButtonAction::Press => enigo.key(enigo_key, Direction::Press)?,
                ButtonAction::Release => enigo.key(enigo_key, Direction::Release)?,
                ButtonAction::Click => enigo.key(enigo_key, Direction::Click)?,
                _ => {}
            }
        }

        InputEvent::TypeText { text } => {
            debug!("[Input] Type text: {}", text);
            enigo.text(text)?;
        }

        InputEvent::ClipboardSync { content } => {
            debug!("[Input] Clipboard sync ({} chars)", content.len());
            set_clipboard(content)?;
        }

        InputEvent::FileChunk { transfer_id, filename, chunk_index, total_chunks, data } => {
            debug!("[Input] File chunk {}/{} for '{}'", chunk_index, total_chunks, filename);
            handle_file_chunk(transfer_id, filename, *chunk_index, *total_chunks, data)?;
        }
    }

    Ok(())
}

/// Map key string (from JS KeyboardEvent.code) to enigo Key
fn map_key(key: &str) -> Key {
    match key {
        // Special keys
        "Enter" | "NumpadEnter" => Key::Return,
        "Escape" => Key::Escape,
        "Backspace" => Key::Backspace,
        "Tab" => Key::Tab,
        "Space" => Key::Space,
        "Delete" => Key::Delete,
        "Insert" => Key::Insert,
        "Home" => Key::Home,
        "End" => Key::End,
        "PageUp" => Key::PageUp,
        "PageDown" => Key::PageDown,

        // Arrow keys
        "ArrowLeft" => Key::LeftArrow,
        "ArrowRight" => Key::RightArrow,
        "ArrowUp" => Key::UpArrow,
        "ArrowDown" => Key::DownArrow,

        // Modifiers
        "ShiftLeft" | "ShiftRight" => Key::Shift,
        "ControlLeft" | "ControlRight" => Key::Control,
        "AltLeft" | "AltRight" => Key::Alt,
        "MetaLeft" | "MetaRight" => Key::Meta,
        "CapsLock" => Key::CapsLock,

        // Function keys
        "F1" => Key::F1,  "F2" => Key::F2,  "F3" => Key::F3,  "F4" => Key::F4,
        "F5" => Key::F5,  "F6" => Key::F6,  "F7" => Key::F7,  "F8" => Key::F8,
        "F9" => Key::F9,  "F10" => Key::F10, "F11" => Key::F11, "F12" => Key::F12,

        // Letters & numbers — use Unicode
        k if k.starts_with("Key") && k.len() == 4 => {
            let c = k.chars().nth(3).unwrap_or('?');
            Key::Unicode(c.to_lowercase().next().unwrap_or(c))
        }
        k if k.starts_with("Digit") && k.len() == 6 => {
            let c = k.chars().nth(5).unwrap_or('0');
            Key::Unicode(c)
        }

        // Fallback
        k => {
            if let Some(c) = k.chars().next() {
                Key::Unicode(c)
            } else {
                warn!("[Input] Unknown key: {}", k);
                Key::Unicode('?')
            }
        }
    }
}

/// Set clipboard content on the host
fn set_clipboard(text: &str) -> anyhow::Result<()> {
    #[cfg(target_os = "windows")]
    {
        use std::process::Command;
        let mut cmd = Command::new("powershell");
        cmd.args(["-command", &format!("Set-Clipboard '{}'", text.replace("'", "''"))]);
        cmd.output()?;
    }

    #[cfg(target_os = "macos")]
    {
        use std::process::{Command, Stdio};
        use std::io::Write;
        let mut child = Command::new("pbcopy").stdin(Stdio::piped()).spawn()?;
        if let Some(stdin) = child.stdin.as_mut() {
            stdin.write_all(text.as_bytes())?;
        }
        child.wait()?;
    }

    #[cfg(target_os = "linux")]
    {
        use std::process::{Command, Stdio};
        use std::io::Write;
        let mut child = Command::new("xclip")
            .args(["-selection", "clipboard"])
            .stdin(Stdio::piped())
            .spawn()?;
        if let Some(stdin) = child.stdin.as_mut() {
            stdin.write_all(text.as_bytes())?;
        }
        child.wait()?;
    }

    Ok(())
}

/// Handle incoming file chunk — reassemble and save to Downloads
fn handle_file_chunk(
    transfer_id: &str,
    filename: &str,
    chunk_index: u32,
    total_chunks: u32,
    data_b64: &str,
) -> anyhow::Result<()> {
    use std::collections::HashMap;
    use std::sync::Mutex;
    use base64::Engine;

    lazy_static::lazy_static! {
        static ref CHUNKS: Mutex<HashMap<String, Vec<Option<Vec<u8>>>>> = Mutex::new(HashMap::new());
    }

    let data = base64::engine::general_purpose::STANDARD.decode(data_b64)?;
    let mut chunks = CHUNKS.lock().unwrap();
    let entry = chunks.entry(transfer_id.to_string())
        .or_insert_with(|| vec![None; total_chunks as usize]);

    if chunk_index < total_chunks {
        entry[chunk_index as usize] = Some(data);
    }

    // Check if all chunks received
    if entry.iter().all(|c| c.is_some()) {
        let complete: Vec<u8> = entry.iter()
            .flat_map(|c| c.as_ref().unwrap().iter().copied())
            .collect();

        // Save to Downloads folder
        let downloads = dirs::download_dir()
            .unwrap_or_else(|| std::path::PathBuf::from("."));
        let path = downloads.join(filename);
        std::fs::write(&path, &complete)?;
        chunks.remove(transfer_id);
        log::info!("[FileTransfer] Saved {} ({} bytes) to {:?}", filename, complete.len(), path);
    }

    Ok(())
}
