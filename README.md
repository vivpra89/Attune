# Attune

Attune is a **real-time attention feedback layer** for children's learning. During homework or screen-based lessons, it watches engagement through the webcam (on-device only), then responds when focus drifts — without screen recording or uploading video.

**Repository:** [github.com/vivpra89/Attune](https://github.com/vivpra89/Attune)

---

## Attention feedback (during learning)

While a session is running, Attune estimates whether your child is engaged using **Apple Vision** face landmarks and **Core ML** models (gaze, expression, presence). That signal drives a **closed-loop feedback loop**:

| Stage | What the child experiences |
|-------|----------------------------|
| **Focused** | Normal screen — no interruption |
| **Soft nudge** | Gentle visual cue when attention starts to slip |
| **Dim** | Full-screen, click-through overlay fades in; clears when they look back |
| **Break suggest** | Prompt to pause after sustained disengagement |
| **Confusion help** | Supportive message when the model detects puzzlement |

Parents control sensitivity (including a **gentler profile** tuned for kids who need longer grace periods). Every session is logged locally so you can review timelines and optional weekly summaries in the **parent dashboard**.

This is **attention support during real work** — not a game replacement for learning apps your child already uses.

---

## Inspiration & ADHD

Attune is **inspired by published cognitive-training research**, especially:

- **[NeuroRacer](https://neuroscape.ucsf.edu/technology/interventions-and-diagnostics/)** (UCSF Neuroscape, *Nature* 2013) — multitasking and adaptive difficulty for attentional control  
- **[EndeavorRx](https://www.endeavorrx.com/)** (Akili) — closed-loop, prescription digital therapeutic for children 8–17 with ADHD  

We borrow ideas from that lineage — **real-time engagement sensing**, **adaptive challenge**, and **mission-style train exercises** — but Attune is **not** EndeavorRx, does **not** use Akili's SSME, and is **not** FDA-authorized.

**Important:** Attune is a **training and homework aid**. It does **not** diagnose ADHD, treat ADHD, replace medication or therapy, or substitute for a clinician. Screening and train modes include plain-language disclaimers in the app.

For families exploring attention challenges, Attune fits the **Screen → Train → Attune** flow: practice attention skills in **Train mode**, then use **live feedback** while doing real schoolwork.

Details: [Train mode](docs/TRAIN_MODE.md) · [Naturalistic attention protocol](docs/NATURALISTIC_ATTENTION_PROTOCOL.md)

---

## What it does

- **Menu bar macOS app** — start/stop sessions from the tray; parent dashboard for reports and settings
- **Real-time attention feedback** — soft nudge → dim → break prompts driven by on-device Vision + Core ML
- **On-device only** — face landmarks and models run locally; video never leaves the device
- **Fullscreen dim overlay** — click-through when focus drops (not screen capture)
- **Parent reports** — optional Claude or OpenAI summaries (bring your own API key)
- **Train mode** — NeuroRacer-style adaptive steer+tap missions (EndeavorRx-*inspired*, not equivalent)
- **Oculomotor screening** — short research-aligned tasks with parent-facing reports (not a diagnosis)
- **COPPA-minded design** — local SQLite sessions, password-protected parent area

---

## Repository layout

| Path | Description |
|------|-------------|
| [`attune-app/`](attune-app/) | **macOS app** — Tauri 2 + React + Rust + Swift (Vision/CoreML) |
| [`ml/`](ml/) | Model training and Core ML export pipeline |
| [`docs/`](docs/) | Product and engineering docs (Train mode, Mac App Store, EEG roadmap) |
| [`attune-ios/`](attune-ios/) | iOS work in progress (Swift packages) |

---

## Quick start (macOS app)

**Requirements:** macOS 12+, Xcode Command Line Tools, Node.js 18+, Rust/Cargo

```bash
git clone https://github.com/vivpra89/Attune.git
cd Attune/attune-app
npm install
npm run tauri dev
```

**Permissions**

1. **Camera** — required for attention detection  
2. **Accessibility** — optional; improves app-name context in reports  

See [`attune-app/README.md`](attune-app/README.md) for full development details.

---

## Build for release

**Direct download (DMG):**

```bash
cd attune-app
npm run tauri build
```

**Mac App Store** (sandboxed build, separate license):

```bash
export APPLE_TEAM_ID=XXXXXXXXXX
cd attune-app
npm run build:mas
```

See [`docs/MAC_APP_STORE.md`](docs/MAC_APP_STORE.md).

---

## Documentation

- [Train mode](docs/TRAIN_MODE.md) — adaptive attention training
- [Mac App Store distribution](docs/MAC_APP_STORE.md) — signing, sandbox, upload
- [Licensing](docs/LICENSING.md) — GPL source vs App Store license
- [EEG integration roadmap](docs/EEG_INTEGRATION_ROADMAP.md) — future neurofeedback plan

---

## Privacy

Camera frames are processed on-device only. Optional LLM reports use API keys stored in the macOS Keychain and sent directly to Anthropic or OpenAI by the parent — not through Attune servers.

Report security issues per [`attune-app/SECURITY.md`](attune-app/SECURITY.md).

---

## License

- **Source & direct downloads:** GPL-3.0 — see [`attune-app/LICENSE`](attune-app/LICENSE)
- **Mac App Store binaries:** proprietary — see [`attune-app/LICENSE-APPSTORE`](attune-app/LICENSE-APPSTORE)

---

## Contact

hello@attune.ai
