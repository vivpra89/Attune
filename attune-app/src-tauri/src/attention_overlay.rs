use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

pub struct AttentionOverlayState {
    pub active: AtomicBool,
}

impl Default for AttentionOverlayState {
    fn default() -> Self {
        Self {
            active: AtomicBool::new(false),
        }
    }
}

#[tauri::command]
pub async fn start_attention_overlay(app: AppHandle) -> Result<(), String> {
    let state = app.state::<AttentionOverlayState>();
    if state.active.load(Ordering::SeqCst) {
        return Ok(());
    }

    let monitors = app
        .available_monitors()
        .map_err(|e| format!("Failed to get monitors: {}", e))?;

    if monitors.is_empty() {
        return Err("No monitors found".to_string());
    }

    for (idx, display) in monitors.iter().enumerate() {
        let scale_factor = display.scale_factor();
        let size = display.size();
        let position = display.position();
        let logical_width = size.width as f64 / scale_factor;
        let logical_height = size.height as f64 / scale_factor;
        let logical_x = position.x as f64 / scale_factor;
        let logical_y = position.y as f64 / scale_factor;

        let label = format!("attention-dim-{idx}");

        if app.get_webview_window(&label).is_some() {
            continue;
        }

        let mut builder = WebviewWindowBuilder::new(&app, &label, WebviewUrl::App("index.html".into()))
            .title("Attune")
            .inner_size(logical_width, logical_height)
            .position(logical_x, logical_y);
        #[cfg(feature = "macos-panel")]
        {
            builder = builder.transparent(true);
        }
        let overlay = builder
            .always_on_top(true)
            .decorations(false)
            .skip_taskbar(true)
            .resizable(false)
            .closable(false)
            .minimizable(false)
            .maximizable(false)
            .visible(false)
            .focused(false)
            .accept_first_mouse(false)
            .build()
            .map_err(|e| format!("Failed to create dim overlay {idx}: {e}"))?;

        overlay
            .set_ignore_cursor_events(true)
            .map_err(|e| format!("Failed to set click-through: {e}"))?;
        overlay.show().ok();
        overlay.set_always_on_top(true).ok();
    }

    state.active.store(true, Ordering::SeqCst);
    let _ = app.emit("attention-overlay-started", ());
    Ok(())
}

#[tauri::command]
pub async fn stop_attention_overlay(app: AppHandle) -> Result<(), String> {
    let state = app.state::<AttentionOverlayState>();

    for (label, window) in app.webview_windows() {
        if label.starts_with("attention-dim-") {
            window.destroy().ok();
        }
    }

    state.active.store(false, Ordering::SeqCst);
    let _ = app.emit("attention-overlay-stopped", ());
    Ok(())
}

#[tauri::command]
pub async fn set_dim_opacity(app: AppHandle, opacity: f32) -> Result<(), String> {
    let clamped = opacity.clamp(0.0, 1.0);
    let _ = app.emit("dim-opacity-changed", clamped);
    Ok(())
}
