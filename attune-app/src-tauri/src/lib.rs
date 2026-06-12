mod attention_overlay;
mod attune_api;
mod attune_db;
mod db;
mod debug;
mod debug_overlay;
mod distraction;
mod feedback;
mod feedback_cues;
mod screening;
mod session;
mod training;
mod vision;
mod window;

use attention_overlay::AttentionOverlayState;
use debug_overlay::DebugOverlayState;
use screening::ScreeningState;
use session::SessionState;
use training::TrainingState;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    App, Manager,
};
#[cfg(all(desktop, not(feature = "app-store")))]
use tauri_plugin_autostart::MacosLauncher;

#[tauri::command]
fn get_app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

#[cfg(all(target_os = "macos", feature = "macos-panel"))]
#[allow(deprecated, unexpected_cfgs)]
fn init_macos_panel(app_handle: &tauri::AppHandle) {
    use tauri_nspanel::{cocoa::appkit::NSWindowCollectionBehavior, panel_delegate, WebviewWindowExt};

    let Some(window) = app_handle.get_webview_window("main") else {
        return;
    };

    if let Ok(panel) = window.to_panel() {
        let delegate = panel_delegate!(MyPanelDelegate {
            window_did_become_key,
            window_did_resign_key
        });

        delegate.set_listener(Box::new(|_| {}));

        #[allow(non_upper_case_globals)]
        const NSFloatWindowLevel: i32 = 4;
        panel.set_level(NSFloatWindowLevel);

        #[allow(non_upper_case_globals)]
        const NSWindowStyleMaskNonActivatingPanel: i32 = 1 << 7;
        panel.set_style_mask(NSWindowStyleMaskNonActivatingPanel);

        #[allow(deprecated)]
        panel.set_collection_behaviour(
            NSWindowCollectionBehavior::NSWindowCollectionBehaviorFullScreenAuxiliary
                | NSWindowCollectionBehavior::NSWindowCollectionBehaviorCanJoinAllSpaces,
        );

        panel.set_delegate(delegate);
    }
}

fn setup_tray(app: &App) -> Result<(), Box<dyn std::error::Error>> {
    let start = MenuItem::with_id(app, "start_session", "Start Session", true, None::<&str>)?;
    let stop = MenuItem::with_id(app, "stop_session", "Stop Session", true, None::<&str>)?;
    let dashboard =
        MenuItem::with_id(app, "open_dashboard", "Parent Dashboard", true, None::<&str>)?;
    let setup = MenuItem::with_id(app, "open_setup", "Setup & Permissions", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Attune", true, None::<&str>)?;

    let menu = Menu::with_items(app, &[&start, &stop, &dashboard, &setup, &quit])?;

    let icon = app
        .default_window_icon()
        .cloned()
        .ok_or("Missing app icon")?;

    let _tray = TrayIconBuilder::new()
        .icon(icon)
        .menu(&menu)
        .tooltip("Attune")
        .on_menu_event(|app, event| match event.id.as_ref() {
            "start_session" => {
                let handle = app.clone();
                tauri::async_runtime::spawn(async move {
                    let _ = session::start_session(handle).await;
                });
            }
            "stop_session" => {
                let handle = app.clone();
                tauri::async_runtime::spawn(async move {
                    let _ = session::end_session(handle).await;
                });
            }
            "open_dashboard" => {
                let _ = window::open_parent_dashboard(app.clone());
            }
            "open_setup" => {
                let _ = window::open_parent_dashboard(app.clone());
            }
            "quit" => {
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                let _ = window::toggle_parent_dashboard(app.clone());
            }
        })
        .build(app)?;

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default()
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:attune.db", db::migrations())
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_keychain::init())
        .manage(AttentionOverlayState::default())
        .manage(DebugOverlayState::default())
        .manage(SessionState::default())
        .manage(ScreeningState::default())
        .manage(TrainingState::default());

    #[cfg(target_os = "macos")]
    {
        builder = builder.plugin(tauri_plugin_macos_permissions::init());
    }

    #[cfg(all(target_os = "macos", feature = "macos-panel"))]
    {
        builder = builder.plugin(tauri_nspanel::init());
    }

    #[cfg(all(desktop, not(feature = "app-store")))]
    {
        builder = builder.plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec![]),
        ));
    }

    builder
        .invoke_handler(tauri::generate_handler![
            get_app_version,
            window::open_parent_dashboard,
            window::toggle_parent_dashboard,
            window::show_control_strip,
            window::hide_control_strip,
            attention_overlay::start_attention_overlay,
            attention_overlay::stop_attention_overlay,
            attention_overlay::set_dim_opacity,
            debug_overlay::start_debug_overlay,
            debug_overlay::stop_debug_overlay,
            vision::check_camera_permission,
            vision::request_camera_permission,
            vision::start_vision,
            vision::stop_vision,
            vision::set_vision_capture_mode,
            screening::start_screening,
            screening::end_screening,
            screening::set_screening_task,
            screening::get_screening_timestamp,
            screening::record_screening_trial,
            screening::get_prior_screening_error_rate,
            screening::get_active_screening,
            screening::list_screening_sessions,
            screening::get_screening_report,
            screening::save_screening_label,
            vision::get_frontmost_app,
            vision::get_inference_status,
            session::set_parent_pin,
            session::verify_parent_pin,
            session::has_parent_pin,
            session::save_setting,
            session::get_setting,
            session::set_debug_mode,
            session::start_session,
            session::end_session,
            session::get_active_session,
            session::list_sessions,
            session::get_session_timeline,
            session::submit_distraction_feedback,
            session::list_weekly_reports,
            session::ensure_weekly_report,
            attune_api::save_claude_api_key,
            attune_api::save_openai_api_key,
            attune_api::get_llm_settings,
            attune_api::generate_screening_summary,
            training::start_training_session,
            training::end_training_session,
            training::record_training_run,
            training::record_training_event,
            training::get_active_training,
            training::get_training_difficulty_seed,
            training::list_training_sessions,
            training::get_training_report,
            training::get_training_compliance_cmd,
            training::get_training_insights_cmd,
        ])
        .setup(|app| {
            attune_db::init_db(&app.handle())?;
            window::setup_main_window(app)?;

            #[cfg(all(target_os = "macos", feature = "macos-panel"))]
            init_macos_panel(app.handle());

            let handle = app.handle().clone();
            if handle.get_webview_window("parent-dashboard").is_none() {
                let _ = window::create_parent_dashboard_window(&handle);
            }

            setup_tray(app)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running attune application");
}
