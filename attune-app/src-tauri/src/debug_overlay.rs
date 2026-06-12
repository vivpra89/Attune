use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

pub struct DebugOverlayState {
    pub active: AtomicBool,
}

impl Default for DebugOverlayState {
    fn default() -> Self {
        Self {
            active: AtomicBool::new(false),
        }
    }
}

const DEBUG_WINDOW_LABEL: &str = "debug-overlay";
const DEBUG_WIDTH: f64 = 420.0;
const DEBUG_HEIGHT: f64 = 560.0;
const DEBUG_MARGIN: f64 = 16.0;

#[tauri::command]
pub async fn start_debug_overlay(app: AppHandle) -> Result<(), String> {
    let state = app.state::<DebugOverlayState>();
    if state.active.load(Ordering::SeqCst) {
        if app.get_webview_window(DEBUG_WINDOW_LABEL).is_some() {
            return Ok(());
        }
    }

    let monitors = app
        .available_monitors()
        .map_err(|e| format!("Failed to get monitors: {}", e))?;

    let display = monitors
        .first()
        .ok_or_else(|| "No monitors found".to_string())?;

    let scale_factor = display.scale_factor();
    let size = display.size();
    let position = display.position();
    let logical_width = size.width as f64 / scale_factor;
    let logical_x = position.x as f64 / scale_factor;
    let logical_y = position.y as f64 / scale_factor;

    let x = logical_x + logical_width - DEBUG_WIDTH - DEBUG_MARGIN;
    let y = logical_y + DEBUG_MARGIN;

    if app.get_webview_window(DEBUG_WINDOW_LABEL).is_some() {
        state.active.store(true, Ordering::SeqCst);
        return Ok(());
    }

    let mut builder = WebviewWindowBuilder::new(
        &app,
        DEBUG_WINDOW_LABEL,
        WebviewUrl::App("index.html".into()),
    )
    .title("Attune Debug")
    .inner_size(DEBUG_WIDTH, DEBUG_HEIGHT)
    .position(x, y);
    #[cfg(feature = "macos-panel")]
    {
        builder = builder.transparent(true);
    }
    let overlay = builder
    .always_on_top(true)
    .decorations(false)
    .skip_taskbar(true)
    .resizable(true)
    .closable(false)
    .minimizable(false)
    .maximizable(false)
    .visible(true)
    .focused(false)
    .build()
    .map_err(|e| format!("Failed to create debug overlay: {e}"))?;

    overlay.set_always_on_top(true).ok();

    state.active.store(true, Ordering::SeqCst);
    Ok(())
}

#[tauri::command]
pub async fn stop_debug_overlay(app: AppHandle) -> Result<(), String> {
    let state = app.state::<DebugOverlayState>();

    if let Some(window) = app.get_webview_window(DEBUG_WINDOW_LABEL) {
        window.destroy().ok();
    }

    state.active.store(false, Ordering::SeqCst);
    Ok(())
}
