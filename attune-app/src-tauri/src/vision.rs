use serde::Serialize;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EmotionLabel {
    Unknown,
    Engaged,
    Bored,
    Confused,
    Frustrated,
}

impl EmotionLabel {
    pub fn from_str(s: &str) -> Self {
        match s {
            "engaged" => Self::Engaged,
            "bored" => Self::Bored,
            "confused" => Self::Confused,
            "frustrated" => Self::Frustrated,
            "neutral" | "unknown" => Self::Unknown,
            _ => Self::Unknown,
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Unknown => "neutral",
            Self::Engaged => "engaged",
            Self::Bored => "bored",
            Self::Confused => "confused",
            Self::Frustrated => "frustrated",
        }
    }

    #[cfg(target_os = "macos")]
    pub fn from_code(code: i32) -> Self {
        match code {
            1 => Self::Engaged,
            2 => Self::Bored,
            3 => Self::Confused,
            4 => Self::Frustrated,
            _ => Self::Unknown,
        }
    }
}

#[derive(Clone, Debug, Serialize, Default)]
pub struct AttentionSample {
    pub score: f32,
    pub face_present: bool,
    pub timestamp: f64,
    pub face_quality: f32,
    pub eye_openness: f32,
    pub head_pose_penalty: f32,
    pub emotion: String,
    pub emotion_confidence: f32,
    pub engagement_prob: f32,
    pub gaze_away_prob: f32,
    pub prob_engaged: f32,
    pub prob_bored: f32,
    pub prob_confused: f32,
    pub prob_frustrated: f32,
    pub prob_neutral: f32,
    pub yaw: f32,
    pub pitch: f32,
    pub model_version: String,
}

static LATEST_SAMPLE: Mutex<Option<AttentionSample>> = Mutex::new(None);

#[cfg(target_os = "macos")]
mod ffi {
    pub type AttentionCallback = extern "C" fn(
        f32,
        bool,
        f64,
        f32,
        f32,
        f32,
        i32,
        f32,
        f32,
        f32,
        f32,
        f32,
        f32,
        f32,
        f32,
        f32,
        f32,
        *const std::ffi::c_char,
    );

    extern "C" {
        pub fn attune_vision_set_callback(callback: Option<AttentionCallback>);
        pub fn attune_vision_set_capture_mode(mode: i32);
        pub fn attune_vision_check_camera_permission() -> i32;
        pub fn attune_vision_request_camera_permission() -> i32;
        pub fn attune_vision_start() -> bool;
        pub fn attune_vision_stop();
        pub fn attune_get_frontmost_app(
            name_buffer: *mut std::ffi::c_char,
            bundle_buffer: *mut std::ffi::c_char,
            buffer_len: i32,
        ) -> bool;
    }
}

#[cfg(target_os = "macos")]
static APP_HANDLE: std::sync::OnceLock<AppHandle> = std::sync::OnceLock::new();

#[cfg(target_os = "macos")]
extern "C" fn on_attention_sample(
    score: f32,
    face_present: bool,
    timestamp: f64,
    face_quality: f32,
    eye_openness: f32,
    head_pose_penalty: f32,
    emotion_code: i32,
    emotion_confidence: f32,
    engagement_prob: f32,
    gaze_away_prob: f32,
    prob_engaged: f32,
    prob_bored: f32,
    prob_confused: f32,
    prob_frustrated: f32,
    prob_neutral: f32,
    yaw: f32,
    pitch: f32,
    model_version_ptr: *const std::ffi::c_char,
) {
    let emotion = EmotionLabel::from_code(emotion_code);
    let model_version = if model_version_ptr.is_null() {
        "heuristic-v0.1".to_string()
    } else {
        unsafe {
            std::ffi::CStr::from_ptr(model_version_ptr)
                .to_string_lossy()
                .into_owned()
        }
    };

    let sample = AttentionSample {
        score,
        face_present,
        timestamp,
        face_quality,
        eye_openness,
        head_pose_penalty,
        emotion: emotion.as_str().to_string(),
        emotion_confidence,
        engagement_prob,
        gaze_away_prob,
        prob_engaged,
        prob_bored,
        prob_confused,
        prob_frustrated,
        prob_neutral,
        yaw,
        pitch,
        model_version,
    };

    if let Ok(mut guard) = LATEST_SAMPLE.lock() {
        *guard = Some(sample.clone());
    }

    if let Some(app) = APP_HANDLE.get() {
        let _ = app.emit("attention-sample", sample);
    }
}

pub fn latest_sample() -> AttentionSample {
    LATEST_SAMPLE
        .lock()
        .ok()
        .and_then(|g| g.clone())
        .unwrap_or_default()
}

pub fn latest_score() -> f32 {
    latest_sample().score
}

#[tauri::command]
pub fn check_camera_permission() -> Result<i32, String> {
    #[cfg(target_os = "macos")]
    {
        Ok(unsafe { ffi::attune_vision_check_camera_permission() })
    }
    #[cfg(not(target_os = "macos"))]
    {
        Err("Camera attention detection is only available on macOS".to_string())
    }
}

#[tauri::command]
pub fn request_camera_permission() -> Result<i32, String> {
    #[cfg(target_os = "macos")]
    {
        Ok(unsafe { ffi::attune_vision_request_camera_permission() })
    }
    #[cfg(not(target_os = "macos"))]
    {
        Err("Camera attention detection is only available on macOS".to_string())
    }
}

#[tauri::command]
pub fn start_vision(app: AppHandle) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let _ = APP_HANDLE.set(app.clone());
        unsafe {
            ffi::attune_vision_set_callback(Some(on_attention_sample));
            if !ffi::attune_vision_start() {
                return Err("Failed to start camera for attention detection".to_string());
            }
        }
        Ok(())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        Err("Camera attention detection is only available on macOS".to_string())
    }
}

/// 0 = learning (~4 Hz), 1 = screening (~10 Hz)
#[tauri::command]
pub fn set_vision_capture_mode(mode: i32) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        unsafe {
            ffi::attune_vision_set_capture_mode(mode);
        }
        Ok(())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = mode;
        Err("Camera attention detection is only available on macOS".to_string())
    }
}

#[tauri::command]
pub fn stop_vision() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        unsafe {
            ffi::attune_vision_stop();
            ffi::attune_vision_set_callback(None);
        }
        Ok(())
    }
    #[cfg(not(target_os = "macos"))]
    {
        Ok(())
    }
}

#[derive(Serialize)]
pub struct FrontmostApp {
    pub app_name: String,
    pub bundle_id: String,
}

#[tauri::command]
pub fn get_frontmost_app() -> Result<FrontmostApp, String> {
    #[cfg(target_os = "macos")]
    {
        let mut name_buf = vec![0i8; 256];
        let mut bundle_buf = vec![0i8; 256];
        let ok = unsafe {
            ffi::attune_get_frontmost_app(
                name_buf.as_mut_ptr(),
                bundle_buf.as_mut_ptr(),
                256,
            )
        };
        if !ok {
            return Err("Could not determine frontmost application".to_string());
        }
        let name = unsafe {
            std::ffi::CStr::from_ptr(name_buf.as_ptr())
                .to_string_lossy()
                .into_owned()
        };
        let bundle = unsafe {
            std::ffi::CStr::from_ptr(bundle_buf.as_ptr())
                .to_string_lossy()
                .into_owned()
        };
        Ok(FrontmostApp {
            app_name: name,
            bundle_id: bundle,
        })
    }
    #[cfg(not(target_os = "macos"))]
    {
        Err("Frontmost app detection is only available on macOS".to_string())
    }
}

/// Legacy tier mapping — prefer FeedbackEngine for sessions.
pub fn score_to_opacity(score: f32, sensitivity: f32) -> f32 {
    if score >= sensitivity {
        0.0
    } else if score >= sensitivity * 0.55 {
        0.3
    } else {
        0.7
    }
}

#[derive(Clone, Serialize)]
pub struct InferenceStatus {
    pub model_version: String,
    pub engagement_loaded: bool,
    pub affect_loaded: bool,
    pub gaze_loaded: bool,
    pub affect_source: String,
}

#[cfg(target_os = "macos")]
mod inference_ffi {
    extern "C" {
        pub fn attune_inference_status(
            version_buffer: *mut std::ffi::c_char,
            buffer_len: i32,
            engagement_loaded: *mut bool,
            affect_loaded: *mut bool,
            gaze_loaded: *mut bool,
            affect_source_buffer: *mut std::ffi::c_char,
            affect_source_len: i32,
        );
    }
}

#[tauri::command]
pub fn get_inference_status() -> Result<InferenceStatus, String> {
    #[cfg(target_os = "macos")]
    {
        let mut version_buf = vec![0i8; 64];
        let mut affect_source_buf = vec![0i8; 32];
        let mut engagement_loaded = false;
        let mut affect_loaded = false;
        let mut gaze_loaded = false;
        unsafe {
            inference_ffi::attune_inference_status(
                version_buf.as_mut_ptr(),
                64,
                &mut engagement_loaded,
                &mut affect_loaded,
                &mut gaze_loaded,
                affect_source_buf.as_mut_ptr(),
                32,
            );
        }
        let model_version = unsafe {
            std::ffi::CStr::from_ptr(version_buf.as_ptr())
                .to_string_lossy()
                .into_owned()
        };
        let affect_source = unsafe {
            std::ffi::CStr::from_ptr(affect_source_buf.as_ptr())
                .to_string_lossy()
                .into_owned()
        };
        Ok(InferenceStatus {
            model_version,
            engagement_loaded,
            affect_loaded,
            gaze_loaded,
            affect_source,
        })
    }
    #[cfg(not(target_os = "macos"))]
    {
        Ok(InferenceStatus {
            model_version: "unavailable".to_string(),
            engagement_loaded: false,
            affect_loaded: false,
            gaze_loaded: false,
            affect_source: "heuristic".to_string(),
        })
    }
}
