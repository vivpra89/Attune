# Mac App Store distribution — Attune

Runbook for shipping **Attune** (`ai.attune.app`) on the Mac App Store. Direct DMG releases stay on the existing GitHub workflow; store builds use `tauri.mas.conf.json` and sandbox entitlements.

**Licensing:** Store binaries use [LICENSE-APPSTORE](../attune-app/LICENSE-APPSTORE). Source/DMG remain GPL-3.0. See [LICENSING.md](LICENSING.md).

---

## Prerequisites checklist

### Apple Developer (manual)

- [ ] Enroll in [Apple Developer Program](https://developer.apple.com/programs/) ($99/year)
- [ ] **App Store Connect** → Apps → **+** → macOS app
  - Bundle ID: `ai.attune.app` (must match [tauri.mas.conf.json](../attune-app/src-tauri/tauri.mas.conf.json))
  - SKU: e.g. `attune-mac-001`
- [ ] **Certificates** (developer.apple.com → Certificates)
  - **Mac App Distribution** (signs `.app`)
  - **Mac Installer Distribution** (signs `.pkg` for upload)
- [ ] **Identifiers** → App ID for `ai.attune.app`
- [ ] **Profiles** → **Mac App Store Connect** profile → download as:
  - `attune-app/src-tauri/profiles/MacAppStore.provisionprofile` (gitignored)
- [ ] **App Store Connect API key** (Users and Access → Integrations → Individual Keys)
  - Note **Issuer ID** and **Key ID**
  - Download `AuthKey_<KEY_ID>.p8` → place in `~/.appstoreconnect/private_keys/` (or `~/private_keys/`)

### Local environment

```bash
export APPLE_TEAM_ID=XXXXXXXXXX          # 10-char Team ID (Membership details)
export APPLE_API_KEY_ID=...              # App Store Connect API
export APPLE_API_ISSUER=...              # Issuer UUID
# AuthKey_<APPLE_API_KEY_ID>.p8 in ~/.appstoreconnect/private_keys/
```

---

## Build differences (App Store vs direct DMG)

| | Direct DMG (`tauri.conf.json`) | Mac App Store (`tauri.mas.conf.json`) |
|---|--------------------------------|----------------------------------------|
| Sandbox | Off ([Entitlements.plist](../attune-app/src-tauri/Entitlements.plist)) | On ([Entitlements.mas.plist](../attune-app/src-tauri/Entitlements.mas.plist)) |
| Private API / NSPanel | Yes (`macos-panel` feature) | No (`--no-default-features --features app-store`) |
| Login-item autostart | Yes | Disabled for store |
| Bundle targets | all (DMG, etc.) | `app` only |
| Category | — | `Education` |
| License | GPL source tree | LICENSE-APPSTORE binary |

---

## 1. Generate sandbox entitlements

```bash
cd attune-app
export APPLE_TEAM_ID=XXXXXXXXXX
npm run prepare:mas
```

This writes `src-tauri/Entitlements.mas.plist` from `Entitlements.mas.plist.in`.

---

## 2. Build the app bundle

Universal (store upload):

```bash
cd attune-app
npm run build:mas
```

Faster local iteration (Apple Silicon only):

```bash
npm run build:mas:aarch64
```

Output (aarch64 example):

`src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Attune.app`

**Code signing:** Tauri applies signing when `APPLE_SIGNING_IDENTITY` / Xcode profiles are configured. For MAS, use the **Mac App Distribution** identity tied to your store provisioning profile.

---

## 3. Sandbox QA (before upload)

**CI/local compile check:** `cargo check --no-default-features --features app-store` and `npm run build:mas:aarch64` (with `APPLE_TEAM_ID` + placeholder `profiles/MacAppStore.provisionprofile`) produce `Attune.app` with MAS config. Full runtime QA requires your real Team ID, store provisioning profile, and Mac App Distribution signing.

Run the built `.app` from Finder or:

```bash
open src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Attune.app
```

Verify:

1. Menu bar tray appears; Start/Stop session works
2. Camera permission + Vision samples (no crash under sandbox)
3. Dim overlay on all monitors; click-through works
4. Parent dashboard, PIN, SQLite session history persists after restart
5. Keychain: save Claude/OpenAI API key in Settings
6. Weekly report / API call with BYOK key
7. Train mode mission runs

**If the tray panel misbehaves:** store builds omit `tauri-nspanel` (no private API). Use tray menu + Parent Dashboard only; document in Review Notes.

**Dim overlay without transparent windows:** MAS builds disable `macos-private-api`; overlay windows use an opaque webview with CSS tint ([AttentionDimOverlay.tsx](../attune-app/src/components/AttentionDimOverlay.tsx)). Visual parity is close; verify on your displays during QA.

**If autostart is needed later:** requires separate entitlement review; currently disabled for MAS.

---

## 4. Create signed `.pkg`

Replace identity string with your installer certificate name from Keychain:

```bash
APP=Attune
APP_PATH="src-tauri/target/universal-apple-darwin/release/bundle/macos/${APP}.app"
# or aarch64 path from build:mas:aarch64

xcrun productbuild \
  --sign "3rd Party Mac Developer Installer: Your Name (TEAM_ID)" \
  --component "${APP_PATH}" /Applications \
  "${APP}.pkg"
```

Validate:

```bash
xcrun altool --validate-app --type macos --file "${APP}.pkg" \
  --apiKey "$APPLE_API_KEY_ID" --apiIssuer "$APPLE_API_ISSUER"
```

---

## 5. Upload to App Store Connect

```bash
xcrun altool --upload-app --type macos --file "${APP}.pkg" \
  --apiKey "$APPLE_API_KEY_ID" --apiIssuer "$APPLE_API_ISSUER"
```

Or use **Transporter** app with the same `.pkg`.

After processing, the build appears under the app version in App Store Connect → **TestFlight** (macOS) for internal testing.

---

## 6. App Store Connect metadata

### Listing

- **Name:** Attune
- **Subtitle:** Real-time attention for learning
- **Primary category:** Education
- **Secondary:** Health & Fitness or Productivity (optional)
- **Description highlights:**
  - On-device camera + Apple Vision; video never uploaded
  - Parent dashboard, session history, optional AI reports (parent API keys)
  - Dim overlay when attention drops (not screen recording)
- **Privacy Policy URL** (required)
- **Support URL** (required)
- **Screenshots:** macOS sizes per [Apple specs](https://developer.apple.com/help/app-store-connect/reference/screenshot-specifications)

### App Privacy (nutrition labels)

Declare honestly:

| Data | Purpose | Linked to user | Tracking |
|------|---------|----------------|----------|
| Camera | Attention detection on device | No (on-device only) | No |
| User content (session stats) | Parent reports | Yes (local + optional API) | No |
| Other (API keys) | BYOK LLM reports | Yes (stored in Keychain) | No |

No behavioral advertising. No sale of child data.

### Age rating

Complete the questionnaire honestly. **Education** without Kids category is the default path; add **Kids** only if targeting under-13 with full Kids Category compliance (1.3, COPPA, parental gates before external links).

### Export compliance

App uses HTTPS only → typically **No** for custom encryption (`ITSAppUsesNonExemptEncryption` is `false` in [info.plist](../attune-app/src-tauri/info.plist)).

### Review Notes (paste into App Store Connect)

```
Attune is a parent-controlled macOS menu bar app for children's learning sessions.

CAMERA: Used only for on-device Apple Vision face/attention detection. No video is recorded or uploaded.

NETWORK: Optional. Parents enter their own Claude or OpenAI API key in Settings for session summaries. Keys are stored in the macOS Keychain.

ACCESSIBILITY: Not required. Optional frontmost app name uses NSWorkspace for report context.

TESTING: Launch app → menu bar icon → "Setup & Permissions" → allow Camera → "Start Session" → face visible to camera. Parent Dashboard opens from tray (set PIN on first use).

Mac App Store build is sandboxed and licensed under LICENSE-APPSTORE (not GPL).
```

---

## 7. Submit for review

1. App Store Connect → your app → **+ Version** (e.g. 0.1.0)
2. Select uploaded build
3. Complete pricing (free/paid), territories, age rating, privacy
4. **Submit for Review**

Expect 1–3+ days; children's/education apps may take longer.

---

## CI (optional)

Manual workflow: [attune-app/.github/workflows/publish-mas.yml](../attune-app/.github/workflows/publish-mas.yml)

Trigger with `workflow_dispatch` after secrets are set:

- `APPLE_TEAM_ID`
- `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`
- `APPLE_CERTIFICATE` / signing secrets (match your org's pattern)
- Provisioning profile as secret or secure file

---

## Troubleshooting

| Issue | Action |
|-------|--------|
| `prepare-mas-entitlements` fails | Set `APPLE_TEAM_ID` |
| Missing provision profile | Download Mac App Store Connect profile to `src-tauri/profiles/MacAppStore.provisionprofile` |
| Upload rejected: sandbox | Re-run `npm run prepare:mas`; confirm `Entitlements.mas.plist` has `app-sandbox` true |
| GPL / license rejection | Confirm store binary built with LICENSE-APPSTORE; Review Notes |
| Panel/tray UX regression | Expected on MAS build without NSPanel; use tray menu |

---

## Related files

- [tauri.mas.conf.json](../attune-app/src-tauri/tauri.mas.conf.json)
- [Entitlements.mas.plist.in](../attune-app/src-tauri/Entitlements.mas.plist.in)
- [scripts/prepare-mas-entitlements.sh](../attune-app/scripts/prepare-mas-entitlements.sh)
- [LICENSE-APPSTORE](../attune-app/LICENSE-APPSTORE)
