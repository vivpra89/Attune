# Attune

Real-time attention layer for children's learning. Attune uses on-device camera + Apple Vision to detect engagement during homework and learning sessions, then gently nudges kids back when attention drifts — without screen recording or uploading video.

**Repository:** [github.com/vivpra89/Attune](https://github.com/vivpra89/Attune)

---

## What it does

- **Menu bar macOS app** — start/stop sessions from the tray; parent dashboard for reports and settings
- **On-device attention detection** — face landmarks + Core ML models; video never leaves the device
- **Fullscreen dim overlay** — click-through overlay when focus drops (not screen capture)
- **Parent reports** — optional Claude or OpenAI summaries (bring your own API key)
- **Train mode** — adaptive steer+tap missions with webcam engagement tracking
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
