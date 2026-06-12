# Attune

Real-time attention layer for children's learning — macOS menu bar app (Tauri + React).

## Features

- **Menu bar app** with tray controls (Start/Stop session, Parent Dashboard)
- **Fullscreen dim overlay** (click-through) when attention drops — no screen recording permission
- **Apple Vision** face/landmark detection via native Swift (camera only)
- **Session timeline** stored locally (SQLite)
- **Frontmost app tracking** for context in summaries (optional; uses active app name when available)
- **Claude or OpenAI API** session + weekly parent reports (configurable in Settings)
- **Password-protected** parent dashboard
- **Train mode** — EndeavorRx-inspired adaptive steer+tap multitasking missions with webcam engagement tracking

## Requirements

- macOS 12+
- Xcode Command Line Tools (for Swift Vision compilation)
- Node.js 18+
- Rust / Cargo

## Development

```bash
cd attune-app
npm install
npm run tauri dev
```

## Permissions

1. **Camera** — on-device attention detection (required)
2. **Accessibility** — optional legacy path; frontmost app name uses system APIs when permitted

## Mac App Store

See [docs/MAC_APP_STORE.md](../docs/MAC_APP_STORE.md). Store builds use a separate config (`tauri.mas.conf.json`), sandbox entitlements, and [LICENSE-APPSTORE](LICENSE-APPSTORE). Licensing overview: [docs/LICENSING.md](../docs/LICENSING.md).

```bash
export APPLE_TEAM_ID=XXXXXXXXXX
# Place Mac App Store provisioning profile at src-tauri/profiles/MacAppStore.provisionprofile
npm run build:mas
```

## Project structure

```
attune/
├── docs/
│   ├── EEG_INTEGRATION_ROADMAP.md   # Future EEG / neurofeedback plan
│   └── TRAIN_MODE.md                # Adaptive Train mode (Screen → Train → Attune)
├── ml/                              # Training & export pipeline
attune-app/
├── src/                    # React UI (parent dashboard, dim overlay)
├── src-tauri/
│   ├── swift/              # AttuneVision.swift + AttuneWorkspace.swift
│   ├── src/
│   │   ├── attention_overlay.rs
│   │   ├── vision.rs
│   │   ├── session.rs
│   │   └── attune_api.rs
│   └── build.rs            # Compiles Swift static library
```

## License

GPL-3.0 for source and direct downloads ([LICENSE](LICENSE)). Mac App Store builds: [LICENSE-APPSTORE](LICENSE-APPSTORE). See [docs/LICENSING.md](../docs/LICENSING.md).
