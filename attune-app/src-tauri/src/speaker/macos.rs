use super::AudioDevice;
use anyhow::Result;
use cidre::{arc, cm, core_audio as ca, dispatch, ns, objc, sc};
use cidre::sc::StreamOutput;
use futures_util::Stream;
use ringbuf::{
    traits::{Consumer, Producer, Split},
    HeapCons, HeapProd, HeapRb,
};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::task::{Poll, Waker};

// ──────────────────────── Device listing ────────────────────────

pub fn get_input_devices() -> Result<Vec<AudioDevice>> {
    let mut devices = Vec::new();

    let default_input_uid = ca::System::default_input_device()
        .ok()
        .and_then(|d| d.uid().ok())
        .map(|u| u.to_string());

    let all_devices = ca::System::devices()?;

    for device in all_devices.iter() {
        let input_buffers = device
            .input_stream_cfg()
            .map(|cfg| cfg.number_buffers())
            .unwrap_or(0);

        if input_buffers > 0 {
            let name = device
                .name()
                .map(|n| n.to_string())
                .unwrap_or_else(|_| "Unknown Device".to_string());
            let uid = device
                .uid()
                .map(|u| u.to_string())
                .unwrap_or_else(|_| "macos_input_unknown".to_string());
            let is_default = default_input_uid
                .as_ref()
                .map(|def| def == &uid)
                .unwrap_or(false);

            devices.push(AudioDevice {
                id: uid,
                name,
                is_default,
            });
        }
    }

    Ok(devices)
}

pub fn get_output_devices() -> Result<Vec<AudioDevice>> {
    let mut devices = Vec::new();

    let default_output_uid = ca::System::default_output_device()
        .ok()
        .and_then(|d| d.uid().ok())
        .map(|u| u.to_string());

    let all_devices = ca::System::devices()?;

    for device in all_devices.iter() {
        let output_buffers = device
            .output_stream_cfg()
            .map(|cfg| cfg.number_buffers())
            .unwrap_or(0);

        let input_buffers = device
            .input_stream_cfg()
            .map(|cfg| cfg.number_buffers())
            .unwrap_or(0);

        if output_buffers > 0 {
            let is_primarily_input = input_buffers > 0 && output_buffers == 0;
            if !is_primarily_input {
                let name = device
                    .name()
                    .map(|n| n.to_string())
                    .unwrap_or_else(|_| "Unknown Device".to_string());
                let uid = device
                    .uid()
                    .map(|u| u.to_string())
                    .unwrap_or_else(|_| "macos_output_unknown".to_string());
                let is_default = default_output_uid
                    .as_ref()
                    .map(|def| def == &uid)
                    .unwrap_or(false);

                devices.push(AudioDevice {
                    id: uid,
                    name,
                    is_default,
                });
            }
        }
    }

    Ok(devices)
}

// ──────────── ScreenCaptureKit audio output handler ────────────

struct SckSharedState {
    producer: Mutex<HeapProd<f32>>,
    waker_state: Arc<Mutex<WakerState>>,
}

static SCK_STATE: Mutex<Option<Arc<SckSharedState>>> = Mutex::new(None);

cidre::define_obj_type!(
    SckAudioOutput + sc::stream::OutputImpl,
    usize,
    SCK_AUDIO_OUTPUT_CLS
);

impl sc::stream::Output for SckAudioOutput {}

#[objc::add_methods]
impl sc::stream::OutputImpl for SckAudioOutput {
    extern "C" fn impl_stream_did_output_sample_buf(
        &mut self,
        _sel: Option<&ns::Sel>,
        _stream: &sc::Stream,
        sample_buf: &mut cm::SampleBuf,
        kind: sc::OutputType,
    ) {
        if kind != sc::OutputType::Audio {
            return;
        }

        let shared = {
            let guard = SCK_STATE.lock().unwrap();
            match guard.as_ref() {
                Some(s) => Arc::clone(s),
                None => return,
            }
        };

        if let Ok(audio_buf) = sample_buf.audio_buf_list::<1>() {
            let buf = &audio_buf.list().buffers[0];
            let byte_count = buf.data_bytes_size as usize;
            let float_count = byte_count / std::mem::size_of::<f32>();

            if float_count > 0 && !buf.data.is_null() {
                let data = unsafe {
                    std::slice::from_raw_parts(buf.data as *const f32, float_count)
                };

                if let Ok(mut producer) = shared.producer.lock() {
                    producer.push_slice(data);
                }

                let should_wake = {
                    if let Ok(mut ws) = shared.waker_state.lock() {
                        if !ws.has_data {
                            ws.has_data = true;
                            ws.waker.take()
                        } else {
                            None
                        }
                    } else {
                        None
                    }
                };

                if let Some(waker) = should_wake {
                    waker.wake();
                }
            }
        }
    }
}

// ──────────────── CoreGraphics permission APIs ─────────────────

#[link(name = "CoreGraphics", kind = "framework")]
unsafe extern "C" {
    fn CGPreflightScreenCaptureAccess() -> bool;
    fn CGRequestScreenCaptureAccess() -> bool;
}

// ──────────────── SpeakerInput (ScreenCaptureKit) ──────────────

struct WakerState {
    waker: Option<Waker>,
    has_data: bool,
}

pub struct SpeakerInput {
    display: arc::R<sc::Display>,
    sample_rate: u32,
}

pub struct SpeakerStream {
    consumer: HeapCons<f32>,
    _stream: arc::R<sc::Stream>,
    _output: arc::R<SckAudioOutput>,
    _queue: arc::R<dispatch::Queue>,
    waker_state: Arc<Mutex<WakerState>>,
    current_sample_rate: Arc<AtomicU32>,
    should_terminate: Arc<AtomicBool>,
}

impl SpeakerStream {
    pub fn sample_rate(&self) -> u32 {
        self.current_sample_rate.load(Ordering::Acquire)
    }
}

impl SpeakerInput {
    pub async fn new(_device_id: Option<String>) -> Result<Self> {
        println!("[SystemAudio] Using ScreenCaptureKit for system audio capture");

        // Trigger macOS permission prompt if not yet granted
        let has_access = unsafe { CGPreflightScreenCaptureAccess() };
        if !has_access {
            println!("[SystemAudio] Screen capture permission not granted, requesting...");
            let granted = unsafe { CGRequestScreenCaptureAccess() };
            if !granted {
                println!("[SystemAudio] User must grant permission in System Settings");
            }
        }

        let content = sc::ShareableContent::current().await.map_err(|e| {
            anyhow::anyhow!(
                "Screen capture permission required. Grant access in System Settings > \
                 Privacy & Security > Screen & System Audio Recording. ({})",
                e
            )
        })?;

        let displays = content.displays();
        if displays.is_empty() {
            return Err(anyhow::anyhow!("No display found for audio capture"));
        }
        let display = &displays[0];

        let display = display.retained();

        println!(
            "[SystemAudio] SCK: display {}x{}",
            display.width(),
            display.height()
        );

        Ok(Self {
            display,
            sample_rate: 48000,
        })
    }

    pub fn stream(self) -> SpeakerStream {
        let sr = self.sample_rate;

        let mut cfg = sc::StreamCfg::new();
        cfg.set_captures_audio(true);
        cfg.set_sample_rate(sr as i64);
        cfg.set_channel_count(1);
        cfg.set_excludes_current_process_audio(true);
        cfg.set_width(2);
        cfg.set_height(2);
        cfg.set_minimum_frame_interval(cm::Time::new(1, 1));

        let windows = ns::Array::new();
        let filter = sc::ContentFilter::with_display_excluding_windows(&self.display, &windows);

        let buffer_size = 1024 * 128;
        let rb = HeapRb::<f32>::new(buffer_size);
        let (producer, consumer) = rb.split();

        let waker_state = Arc::new(Mutex::new(WakerState {
            waker: None,
            has_data: false,
        }));

        let current_sample_rate = Arc::new(AtomicU32::new(sr));
        let should_terminate = Arc::new(AtomicBool::new(false));

        let shared = Arc::new(SckSharedState {
            producer: Mutex::new(producer),
            waker_state: waker_state.clone(),
        });

        {
            let mut guard = SCK_STATE.lock().unwrap();
            *guard = Some(shared);
        }

        let stream = sc::Stream::new(&filter, &cfg);

        let output = SckAudioOutput::with(0);
        let queue = dispatch::Queue::serial_with_ar_pool();

        stream
            .add_stream_output(output.as_ref(), sc::OutputType::Audio, Some(&queue))
            .expect("Failed to add SCK audio output");

        stream.start_with_ch(|err| {
            if let Some(e) = err {
                eprintln!("[SystemAudio] SCK start error: {}", e);
            } else {
                println!("[SystemAudio] SCK stream started — capturing system audio");
            }
        });

        SpeakerStream {
            consumer,
            _stream: stream,
            _output: output,
            _queue: queue,
            waker_state,
            current_sample_rate,
            should_terminate,
        }
    }
}

impl Stream for SpeakerStream {
    type Item = f32;

    fn poll_next(
        mut self: std::pin::Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
    ) -> Poll<Option<Self::Item>> {
        if let Some(sample) = self.consumer.try_pop() {
            return Poll::Ready(Some(sample));
        }

        if self.should_terminate.load(Ordering::Acquire) {
            return match self.consumer.try_pop() {
                Some(sample) => Poll::Ready(Some(sample)),
                None => Poll::Ready(None),
            };
        }

        {
            let mut state = self.waker_state.lock().unwrap();
            state.has_data = false;
            state.waker = Some(cx.waker().clone());
        }

        Poll::Pending
    }
}

impl Drop for SpeakerStream {
    fn drop(&mut self) {
        self.should_terminate.store(true, Ordering::Release);
        self._stream.stop_with_ch(|_| {});

        if let Ok(mut guard) = SCK_STATE.lock() {
            *guard = None;
        }
    }
}
