#[cfg(target_os = "macos")]
use tauri::LogicalPosition;
use tauri::{App, AppHandle, Manager, Runtime, WebviewWindow, WebviewWindowBuilder};

#[tauri::command]
pub fn open_parent_dashboard(app: tauri::AppHandle) -> Result<(), String> {
    show_parent_dashboard(&app)
}

#[tauri::command]
pub fn toggle_parent_dashboard(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("parent-dashboard") {
        match window.is_visible() {
            Ok(true) => {
                window.hide().map_err(|e| e.to_string())?;
            }
            Ok(false) => {
                window.show().map_err(|e| e.to_string())?;
                window.set_focus().map_err(|e| e.to_string())?;
            }
            Err(e) => return Err(e.to_string()),
        }
    } else {
        show_parent_dashboard(&app)?;
    }
    Ok(())
}

pub fn show_parent_dashboard<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("parent-dashboard") {
        window.show().map_err(|e| e.to_string())?;
        window.set_focus().map_err(|e| e.to_string())?;
    } else {
        let window = create_parent_dashboard_window(app)
            .map_err(|e| format!("Failed to create parent dashboard: {e}"))?;
        window.show().map_err(|e| e.to_string())?;
        window.set_focus().map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn create_parent_dashboard_window<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<WebviewWindow<R>, tauri::Error> {
    let mut builder = WebviewWindowBuilder::new(
        app,
        "parent-dashboard",
        tauri::WebviewUrl::App("/parent".into()),
    )
    .title("Attune — Parent Dashboard")
    .center()
    .decorations(true)
    .inner_size(1100.0, 760.0)
    .min_inner_size(800.0, 600.0)
    .visible(false);

    #[cfg(target_os = "macos")]
    {
        builder = builder
            .hidden_title(true)
            .title_bar_style(tauri::TitleBarStyle::Overlay)
            .traffic_light_position(LogicalPosition::new(14.0, 18.0));
    }

    let window = builder.build()?;
    let clone = window.clone();
    window.on_window_event(move |event| {
        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            let _ = clone.hide();
        }
    });
    Ok(window)
}

pub fn setup_main_window(app: &mut App) -> Result<(), Box<dyn std::error::Error>> {
    if let Some(window) = app.get_webview_window("main") {
        window.hide().ok();
    }
    Ok(())
}

#[tauri::command]
pub fn show_control_strip(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        window.show().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn hide_control_strip(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        window.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}
