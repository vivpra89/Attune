// Attune AI Speech Detection, and capture system audio (speaker output) as a stream of f32 samples.
use crate::speaker::{AudioDevice, SpeakerInput};
use anyhow::Result;
use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use futures_util::StreamExt;
use hound::{WavSpec, WavWriter};
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::io::Cursor;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Listener, Manager};
use tauri_plugin_shell::ShellExt;
use tracing::{error, warn};

// VAD Configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VadConfig {
    pub enabled: bool,
    pub hop_size: usize,
    pub sensitivity_rms: f32,
    pub peak_threshold: f32,
    pub silence_chunks: usize,
    pub min_speech_chunks: usize,
    pub pre_speech_chunks: usize,
    pub noise_gate_threshold: f32,
    pub max_recording_duration_secs: u64,
    #[serde(default = "default_chunk_secs")]
    pub streaming_chunk_secs: u64,
}

fn default_chunk_secs() -> u64 {
    2
}

impl Default for VadConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            hop_size: 1024,
            sensitivity_rms: 0.003,
            peak_threshold: 0.010,
            silence_chunks: 35,
            min_speech_chunks: 4,
            pre_speech_chunks: 15,
            noise_gate_threshold: 0.0008,
            max_recording_duration_secs: 3600,
            streaming_chunk_secs: 2,
        }
    }
}

#[tauri::command]
pub async fn start_system_audio_capture(
    app: AppHandle,
    vad_config: Option<VadConfig>,
    device_id: Option<String>,
) -> Result<(), String> {
    let state = app.state::<crate::AudioState>();

    // Check if already capturing (atomic check)
    {
        let guard = state
            .stream_task
            .lock()
            .map_err(|e| format!("Failed to acquire lock: {}", e))?;

        if guard.is_some() {
            warn!("Capture already running");
            return Err("Capture already running".to_string());
        }
    }

    // Update VAD config if provided
    if let Some(config) = vad_config {
        let mut vad_cfg = state
            .vad_config
            .lock()
            .map_err(|e| format!("Failed to acquire VAD config lock: {}", e))?;
        *vad_cfg = config;
    }

    println!("[SystemAudio] Creating speaker input...");
    let input = SpeakerInput::new_with_device(device_id).await.map_err(|e| {
        error!("Failed to create speaker input: {}", e);
        format!("Failed to access system audio: {}", e)
    })?;
    println!("[SystemAudio] Speaker input created, starting stream...");

    let stream = input.stream();
    let sr = stream.sample_rate();
    println!("[SystemAudio] Stream started, sample_rate={}", sr);

    // Validate sample rate
    if !(8000..=96000).contains(&sr) {
        error!("Invalid sample rate: {}", sr);
        return Err(format!(
            "Invalid sample rate: {}. Expected 8000-96000 Hz",
            sr
        ));
    }

    let app_clone = app.clone();
    let vad_config = state
        .vad_config
        .lock()
        .map_err(|e| format!("Failed to read VAD config: {}", e))?
        .clone();

    println!("[SystemAudio] VAD config: enabled={}, rms={}, peak={}, noise_gate={}",
        vad_config.enabled, vad_config.sensitivity_rms, vad_config.peak_threshold, vad_config.noise_gate_threshold);

    // Mark as capturing BEFORE spawning task
    *state
        .is_capturing
        .lock()
        .map_err(|e| format!("Failed to set capturing state: {}", e))? = true;

    // Emit capture started event
    let _ = app_clone.emit("capture-started", sr);

    let state_clone = app.state::<crate::AudioState>();
    let task = tokio::spawn(async move {
        if vad_config.enabled {
            run_vad_capture(app_clone.clone(), stream, sr, vad_config).await;
        } else {
            run_streaming_capture(app_clone.clone(), stream, sr, vad_config).await;
        }

        let state = app_clone.state::<crate::AudioState>();
        {
            if let Ok(mut guard) = state.stream_task.lock() {
                *guard = None;
            };
        }
    });

    *state_clone
        .stream_task
        .lock()
        .map_err(|e| format!("Failed to store task: {}", e))? = Some(task);

    Ok(())
}

// VAD-enabled capture - OPTIMIZED for real-time speech detection
async fn run_vad_capture(
    app: AppHandle,
    stream: impl StreamExt<Item = f32> + Unpin,
    sr: u32,
    config: VadConfig,
) {
    let mut stream = stream;
    let mut buffer: VecDeque<f32> = VecDeque::new();
    let mut pre_speech: VecDeque<f32> =
        VecDeque::with_capacity(config.pre_speech_chunks * config.hop_size);
    let mut speech_buffer = Vec::new();
    let mut in_speech = false;
    let mut silence_chunks = 0;
    let mut speech_chunks = 0;
    let max_samples = sr as usize * 30; // 30s safety cap per utterance
    let mut total_samples: u64 = 0;
    let mut chunk_count: u64 = 0;
    let mut max_rms: f32 = 0.0;
    let mut max_peak: f32 = 0.0;
    let mut got_first_sample = false;

    let silence_warn_chunks = (sr as u64 * 8) / config.hop_size as u64; // ~8 seconds
    let mut warned_silence = false;

    println!("[VAD] Starting VAD capture loop, sr={}, sensitivity_rms={}, peak_threshold={}, noise_gate={}",
        sr, config.sensitivity_rms, config.peak_threshold, config.noise_gate_threshold);

    while let Some(sample) = stream.next().await {
        if !got_first_sample {
            println!("[VAD] First audio sample received: {:.6}", sample);
            got_first_sample = true;
        }
        total_samples += 1;
        buffer.push_back(sample);

        // Process in fixed chunks for VAD analysis
        while buffer.len() >= config.hop_size {
            let mut mono = Vec::with_capacity(config.hop_size);
            for _ in 0..config.hop_size {
                if let Some(v) = buffer.pop_front() {
                    mono.push(v);
                }
            }

            // Apply noise gate BEFORE VAD (critical for accuracy)
            let mono = apply_noise_gate(&mono, config.noise_gate_threshold);

            let (rms, peak) = calculate_audio_metrics(&mono);
            chunk_count += 1;
            if rms > max_rms { max_rms = rms; }
            if peak > max_peak { max_peak = peak; }

            // Log periodically (~every 5 seconds)
            let chunks_per_5s = (sr as u64 * 5) / config.hop_size as u64;
            if chunk_count % chunks_per_5s == 0 {
                let elapsed_s = total_samples as f64 / sr as f64;
                println!("[VAD] {:.1}s | chunks={} | rms={:.6} peak={:.6} | max_rms={:.6} max_peak={:.6} | speech={}",
                    elapsed_s, chunk_count, rms, peak, max_rms, max_peak, in_speech);
            }

            // Detect all-zero audio (permission issue on macOS 14.2+)
            if !warned_silence && chunk_count >= silence_warn_chunks && max_peak < 0.000001 {
                warned_silence = true;
                println!("[VAD] WARNING: All audio samples are zero after {}s. This usually means macOS is blocking audio tap content.", 
                    total_samples as f64 / sr as f64);
                println!("[VAD] Fix: Go to System Settings > Privacy & Security > Screen & System Audio Recording and add this app.");
                let _ = app.emit("audio-permission-issue",
                    "System audio is silent. Grant \"Screen & System Audio Recording\" permission in System Settings > Privacy & Security, then restart capture.");
            }

            let is_speech = rms > config.sensitivity_rms || peak > config.peak_threshold;

            if is_speech {
                if !in_speech {
                    // Speech START detected
                    in_speech = true;
                    speech_chunks = 0;

                    // Include pre-speech buffer for natural sound
                    speech_buffer.extend(pre_speech.drain(..));

                    let _ = app.emit("speech-start", ());
                }

                speech_chunks += 1;
                speech_buffer.extend_from_slice(&mono);
                silence_chunks = 0; // Reset silence counter on any speech

                // Safety cap: force emit if exceeds 30s
                if speech_buffer.len() > max_samples {
                    let normalized_buffer = normalize_audio_level(&speech_buffer, 0.1);
                    if let Ok(b64) = samples_to_wav_b64(sr, &normalized_buffer) {
                        // let duration = speech_buffer.len() as f32 / sr as f32;
                        let _ = app.emit("speech-detected", b64);
                    }
                    speech_buffer.clear();
                    in_speech = false;
                    speech_chunks = 0;
                }
            } else {
                // Silence detected
                if in_speech {
                    silence_chunks += 1;

                    // Continue collecting during silence (important for natural speech)
                    speech_buffer.extend_from_slice(&mono);

                    // Check if silence duration exceeds threshold
                    if silence_chunks >= config.silence_chunks {
                        // Verify minimum speech duration
                        if speech_chunks >= config.min_speech_chunks && !speech_buffer.is_empty() {
                            // Trim trailing silence (keep ~0.15s for natural ending)
                            let silence_duration_samples = silence_chunks * config.hop_size;
                            let keep_silence_samples = (sr as usize) * 15 / 100; // 0.15s
                            let trim_amount =
                                silence_duration_samples.saturating_sub(keep_silence_samples);

                            if speech_buffer.len() > trim_amount {
                                speech_buffer.truncate(speech_buffer.len() - trim_amount);
                            }

                            // Emit complete speech segment
                            let normalized_buffer = normalize_audio_level(&speech_buffer, 0.1);
                            if let Ok(b64) = samples_to_wav_b64(sr, &normalized_buffer) {
                                // let duration = speech_buffer.len() as f32 / sr as f32;
                                let _ = app.emit("speech-detected", b64);
                            } else {
                                error!("Failed to encode speech to WAV");
                                let _ = app.emit("audio-encoding-error", "Failed to encode speech");
                            }
                        } else {
                            let _ = app.emit(
                                "speech-discarded",
                                "Audio too short (likely background noise)",
                            );
                        }

                        // Reset for next speech detection
                        speech_buffer.clear();
                        in_speech = false;
                        silence_chunks = 0;
                        speech_chunks = 0;
                    }
                } else {
                    // Not in speech yet - maintain rolling pre-speech buffer
                    pre_speech.extend(mono.into_iter());

                    // Trim excess (maintain fixed size)
                    while pre_speech.len() > config.pre_speech_chunks * config.hop_size {
                        pre_speech.pop_front();
                    }

                    // Periodically shrink capacity to prevent memory bloat
                    if pre_speech.len() == config.pre_speech_chunks * config.hop_size {
                        pre_speech.shrink_to_fit();
                    }
                }
            }
        }
    }

    println!("[VAD] Stream ended. total_samples={}, chunks={}, max_rms={:.6}, max_peak={:.6}",
        total_samples, chunk_count, max_rms, max_peak);
}

// Streaming capture: emits a transcription-ready WAV chunk every N seconds
async fn run_streaming_capture(
    app: AppHandle,
    stream: impl StreamExt<Item = f32> + Unpin,
    sr: u32,
    config: VadConfig,
) {
    let mut stream = stream;
    let chunk_secs = config.streaming_chunk_secs.max(1) as usize;
    let chunk_samples = sr as usize * chunk_secs;
    let max_duration = Duration::from_secs(config.max_recording_duration_secs);

    let mut audio_buffer = Vec::with_capacity(chunk_samples);
    let start_time = Instant::now();
    let mut chunk_count: u64 = 0;

    println!(
        "[Streaming] Starting, sr={}, chunk={}s, max={}s",
        sr, chunk_secs, config.max_recording_duration_secs
    );

    loop {
        tokio::select! {
            sample_opt = stream.next() => {
                match sample_opt {
                    Some(sample) => {
                        audio_buffer.push(sample);

                        if audio_buffer.len() % (sr as usize) == 0 {
                            let _ = app.emit("recording-progress", start_time.elapsed().as_secs());
                        }

                        if audio_buffer.len() >= chunk_samples {
                            chunk_count += 1;
                            let cleaned = apply_noise_gate(&audio_buffer, config.noise_gate_threshold);
                            let normalized = normalize_audio_level(&cleaned, 0.1);

                            let (rms, peak) = calculate_audio_metrics(&normalized);
                            println!(
                                "[Streaming] chunk {} | rms={:.5} peak={:.5}",
                                chunk_count, rms, peak
                            );

                            // Only emit if there is audible content
                            if rms > 0.001 {
                                match samples_to_wav_b64(sr, &normalized) {
                                    Ok(b64) => {
                                        let _ = app.emit("speech-detected", b64);
                                    }
                                    Err(e) => {
                                        error!("Failed to encode streaming chunk: {}", e);
                                    }
                                }
                            }

                            audio_buffer.clear();
                        }

                        if start_time.elapsed() >= max_duration {
                            println!("[Streaming] Max duration reached");
                            break;
                        }
                    }
                    None => {
                        warn!("[Streaming] Audio stream ended");
                        break;
                    }
                }
            }
            _ = tokio::time::sleep(tokio::time::Duration::from_millis(10)) => {}
        }
    }

    // Flush remaining audio (if > 0.25s)
    if audio_buffer.len() > sr as usize / 4 {
        let cleaned = apply_noise_gate(&audio_buffer, config.noise_gate_threshold);
        let normalized = normalize_audio_level(&cleaned, 0.1);
        let (rms, _) = calculate_audio_metrics(&normalized);
        if rms > 0.001 {
            if let Ok(b64) = samples_to_wav_b64(sr, &normalized) {
                let _ = app.emit("speech-detected", b64);
            }
        }
    }

    println!("[Streaming] Stopped after {} chunks", chunk_count);
}

// Apply noise gate
fn apply_noise_gate(samples: &[f32], threshold: f32) -> Vec<f32> {
    const KNEE_RATIO: f32 = 3.0; // Compression ratio for soft knee

    samples
        .iter()
        .map(|&s| {
            let abs = s.abs();
            if abs < threshold {
                s * (abs / threshold).powf(1.0 / KNEE_RATIO)
            } else {
                s
            }
        })
        .collect()
}

// Calculate RMS and peak (optimized)
fn calculate_audio_metrics(chunk: &[f32]) -> (f32, f32) {
    let mut sumsq = 0.0f32;
    let mut peak = 0.0f32;

    for &v in chunk {
        let a = v.abs();
        peak = peak.max(a);
        sumsq += v * v;
    }

    let rms = (sumsq / chunk.len() as f32).sqrt();
    (rms, peak)
}

fn normalize_audio_level(samples: &[f32], target_rms: f32) -> Vec<f32> {
    if samples.is_empty() {
        return Vec::new();
    }

    let sum_squares: f32 = samples.iter().map(|&s| s * s).sum();
    let current_rms = (sum_squares / samples.len() as f32).sqrt();

    if current_rms < 0.001 {
        return samples.to_vec();
    }

    let gain = (target_rms / current_rms).min(10.0);

    samples
        .iter()
        .map(|&s| {
            let amplified = s * gain;
            if amplified.abs() > 1.0 {
                amplified.signum() * (1.0 - (-amplified.abs()).exp())
            } else {
                amplified
            }
        })
        .collect()
}

// Convert samples to WAV base64 (with proper error handling)
fn samples_to_wav_b64(sample_rate: u32, mono_f32: &[f32]) -> Result<String, String> {
    // Validate sample rate
    if !(8000..=96000).contains(&sample_rate) {
        error!("Invalid sample rate: {}", sample_rate);
        return Err(format!(
            "Invalid sample rate: {}. Expected 8000-96000 Hz",
            sample_rate
        ));
    }

    // Validate buffer
    if mono_f32.is_empty() {
        return Err("Empty audio buffer".to_string());
    }

    let mut cursor = Cursor::new(Vec::new());
    let spec = WavSpec {
        channels: 1,
        sample_rate,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };

    let mut writer = WavWriter::new(&mut cursor, spec).map_err(|e| {
        error!("Failed to create WAV writer: {}", e);
        e.to_string()
    })?;

    for &s in mono_f32 {
        let clamped = s.clamp(-1.0, 1.0);
        let sample_i16 = (clamped * i16::MAX as f32) as i16;
        writer.write_sample(sample_i16).map_err(|e| e.to_string())?;
    }

    writer.finalize().map_err(|e| e.to_string())?;

    Ok(B64.encode(cursor.into_inner()))
}

#[tauri::command]
pub async fn stop_system_audio_capture(app: AppHandle) -> Result<(), String> {
    let state = app.state::<crate::AudioState>();

    // Abort task in separate scope (Send trait fix)
    {
        let mut guard = state
            .stream_task
            .lock()
            .map_err(|e| format!("Failed to acquire task lock: {}", e))?;

        if let Some(task) = guard.take() {
            task.abort();
        }
    }

    // LONGER delay for proper cleanup (300ms instead of 150ms)
    tokio::time::sleep(tokio::time::Duration::from_millis(300)).await;

    // Mark as not capturing
    *state
        .is_capturing
        .lock()
        .map_err(|e| format!("Failed to update capturing state: {}", e))? = false;

    // Additional cleanup delay (CRITICAL for mic indicator)
    tokio::time::sleep(tokio::time::Duration::from_millis(200)).await;

    // Emit stopped event
    let _ = app.emit("capture-stopped", ());
    Ok(())
}

/// Manual stop for continuous recording
#[tauri::command]
pub async fn manual_stop_continuous(app: AppHandle) -> Result<(), String> {
    let _ = app.emit("manual-stop-continuous", ());

    tokio::time::sleep(tokio::time::Duration::from_millis(20)).await;

    Ok(())
}

#[tauri::command]
pub async fn check_system_audio_access(_app: AppHandle) -> Result<bool, String> {
    match SpeakerInput::new().await {
        Ok(_) => Ok(true),
        Err(e) => {
            error!("System audio access check failed: {}", e);
            Ok(false)
        }
    }
}

#[tauri::command]
pub async fn request_system_audio_access(app: AppHandle) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        // macOS 14.2+ requires "Screen & System Audio Recording" permission for process taps
        app.shell()
            .command("open")
            .args(["x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"])
            .spawn()
            .map_err(|e| {
                error!("Failed to open system preferences: {}", e);
                e.to_string()
            })?;
    }
    #[cfg(target_os = "windows")]
    {
        app.shell()
            .command("ms-settings:sound")
            .spawn()
            .map_err(|e| {
                error!("Failed to open sound settings: {}", e);
                e.to_string()
            })?;
    }
    #[cfg(target_os = "linux")]
    {
        let commands = ["pavucontrol", "gnome-control-center sound"];
        let mut opened = false;

        for cmd in &commands {
            if app.shell().command(cmd).spawn().is_ok() {
                opened = true;
                break;
            }
        }

        if !opened {
            warn!("Failed to open audio settings on Linux");
        }
    }

    Ok(())
}

// VAD Configuration Management
#[tauri::command]
pub async fn get_vad_config(app: AppHandle) -> Result<VadConfig, String> {
    let state = app.state::<crate::AudioState>();
    let config = state
        .vad_config
        .lock()
        .map_err(|e| format!("Failed to get VAD config: {}", e))?
        .clone();
    Ok(config)
}

#[tauri::command]
pub async fn update_vad_config(app: AppHandle, config: VadConfig) -> Result<(), String> {
    // Validate config
    if config.sensitivity_rms < 0.0 || config.sensitivity_rms > 1.0 {
        return Err("Invalid sensitivity_rms: must be 0.0-1.0".to_string());
    }
    if config.max_recording_duration_secs > 3600 {
        return Err("Invalid max_recording_duration_secs: must be <= 3600 (1 hour)".to_string());
    }

    let state = app.state::<crate::AudioState>();
    *state
        .vad_config
        .lock()
        .map_err(|e| format!("Failed to update VAD config: {}", e))? = config;

    Ok(())
}

#[tauri::command]
pub async fn get_capture_status(app: AppHandle) -> Result<bool, String> {
    let state = app.state::<crate::AudioState>();
    let is_capturing = *state
        .is_capturing
        .lock()
        .map_err(|e| format!("Failed to get capture status: {}", e))?;
    Ok(is_capturing)
}

#[tauri::command]
pub async fn get_audio_sample_rate(_app: AppHandle) -> Result<u32, String> {
    let input = SpeakerInput::new().await.map_err(|e| {
        error!("Failed to create speaker input: {}", e);
        format!("Failed to access system audio: {}", e)
    })?;

    let stream = input.stream();
    let sr = stream.sample_rate();

    Ok(sr)
}

#[tauri::command]
pub fn get_input_devices() -> Result<Vec<AudioDevice>, String> {
    crate::speaker::list_input_devices().map_err(|e| {
        error!("Failed to get input devices: {}", e);
        format!("Failed to get input devices: {}", e)
    })
}

#[tauri::command]
pub fn get_output_devices() -> Result<Vec<AudioDevice>, String> {
    crate::speaker::list_output_devices().map_err(|e| {
        error!("Failed to get output devices: {}", e);
        format!("Failed to get output devices: {}", e)
    })
}
