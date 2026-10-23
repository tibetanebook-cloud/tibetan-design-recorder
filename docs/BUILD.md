# Build guide

## Requirements

- Node.js 22.19+ or 24.11+ and npm
- Windows 10 build 19041+, macOS 14+, or a modern Linux desktop
- Python 3 with Pillow, NumPy and SciPy (only to regenerate icons)
- Native capture helpers (Stage 2): Visual Studio 2022 Build Tools on Windows,
  Xcode Command Line Tools on macOS, PipeWire headers on Linux

## Commands

```bash
npm install            # install dependencies
npm run dev            # run with hot reload
npm run typecheck      # TypeScript, main + renderer
npm test               # unit tests (Vitest)
npm run smoke          # build, launch the real app hidden, check it end to end
npm run smoke:l10n     # quick: every screen in Tibetan, no English left, font/line height/clipping
npm run i18n:lint      # Tibetan spelling/punctuation lint of all UI strings
npm run build          # production build into out/
npm run dist:win       # Windows installer (.exe) into dist/
npm run dist:mac       # macOS .dmg (run on a Mac)
npm run dist:linux     # AppImage + .deb (run on Linux)
npm run icons          # rebuild icons from build/icon-source/original.jpg
```

`npm run smoke` makes a real 5-second recording (with a pause and a marker) and opens it in
the editor. By default it uses Chromium's fake camera, microphone **and screen** so it runs the
same on any machine (the switches `--use-fake-device-for-media-stream --use-fake-ui-for-media-stream`
are passed on the command line, where Chromium reliably reads them). To record the real desktop,
webcam and mic instead:

```bash
npx electron . --smoke-test --real-devices
```

`npm run smoke` writes `test-results/smoke/report.json` and screenshots of the UI in
Tibetan and English. It exits with a non-zero code if any check fails.

`npm run smoke` goes through `scripts/run-smoke.mjs`: if Chromium's fake test camera fails to
appear (it happens about 1 run in 3 on the dev PC, before the app opens anything), the run is
repeated, at most 3 attempts, and the retry is printed.

## Installers

| Command | Output (in `dist/`) | Where it can run |
|---|---|---|
| `npm run dist:win` | `…-windows-x64-setup.exe`, `…-windows-x64-portable.exe` | Windows |
| `npm run dist:win-arm64` | `…-windows-arm64-setup.exe` | Windows |
| `npm run dist:mac` | `…-macos-arm64.dmg/.zip`, `…-macos-x64.dmg/.zip` | macOS only |
| `npm run dist:linux` | `…-linux-x86_64.AppImage`, `…-linux-amd64.deb`, `…-linux-arm64.AppImage/.deb` | Linux (or the GitHub workflow) |
| `npm run dist:dir` | `dist/win-unpacked/` (no installer, quickest check) | Windows |

Each first runs `npm run licenses`, which copies the licence text of every third-party
package that ends up in the app (26 packages, including those bundled into the app code)
to `resources/licenses/`; the app ships them. Only `uiohook-napi` and `zod` are shipped as
`node_modules`; everything else is bundled by Vite. lamejs (LGPL) is kept as its own file
(`lamejs-*.js`) so it stays replaceable.

The packaged app can test itself (results go to the temp folder it prints):

```bash
"dist/win-unpacked/Tibetan Design Recorder.exe" --smoke-test --no-record --l10n
```

### Building on GitHub (macOS and Linux)

`.github/workflows/release.yml` builds everything on GitHub's machines (Windows, macOS on
Apple Silicon for both Mac architectures, Linux). It runs the type check, unit tests and the
Tibetan screen audit first.

- Push a tag such as `v0.2.0` → all installers are attached to a **draft** release, with
  `SHA256SUMS.txt`. Nothing is public until you click *Publish release*.
- Or run it by hand (Actions → *Build installers* → *Run workflow*) → the files are kept as
  downloadable artifacts for 14 days.

Repository: https://github.com/tibetanebook-cloud/tibetan-design-recorder (public). v0.1.0 was built and released this way on 2026-10-22.

### Version number

Change `"version"` in `package.json` (e.g. `0.2.0`) and tag the same (`v0.2.0`). File names,
the About box and the Windows Apps list use it.

### Code signing (not set up yet: owner decision 2026-10-22)

Unsigned builds work, but:

- **Windows:** SmartScreen shows "Windows protected your PC" (More info → Run anyway) and
  "Unknown publisher". On PCs with **Smart App Control** turned on (default on many new
  Windows 11 PCs, and on the development PC), unsigned programs can be blocked outright.
  The fix is signing, not turning Smart App Control off (it cannot be turned back on
  without reinstalling Windows).
- **macOS:** Gatekeeper requires *System Settings → Privacy & Security → Open Anyway* once.

To sign later, no code changes are needed, only secrets in the GitHub repository:

- **Windows** — either a code-signing certificate (`CSC_LINK` = base64 .pfx,
  `CSC_KEY_PASSWORD`), or Microsoft's *Artifact Signing* (formerly *Trusted Signing*; a monthly
  subscription, cheapest route to a trusted Windows signature) via electron-builder's
  `win.azureSignOptions`.
- **macOS** — an Apple Developer ID (Apple Developer Program): `CSC_LINK`/`CSC_KEY_PASSWORD`
  for the certificate, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` for
  notarization; then in `electron-builder.yml` remove `identity: null`, set
  `hardenedRuntime: true` and add `notarize: true` (entitlements are in `build/entitlements.mac.plist`).
- Remove `CSC_IDENTITY_AUTO_DISCOVERY: "false"` from the workflow.

## Sample extension

```bash
python build/extensions-source/make_tibetan_basics.py
```

regenerates `resources/extensions/tibetan-basics` (mandala wallpaper, laptop and browser frames,
click sound).

## Library music

```bash
python build/library-source/make_music.py
```

regenerates the three original music loops in `resources/library/music` (needs numpy).

## Icons

`build/icon-source/original.jpg` is the source artwork. `make_icons.py` removes the
painted checkerboard and the thin frame line, then writes `build/icon.png` (1024),
`build/icon.ico` (16–256) and `build/icons/*.png` for Linux. electron-builder makes
the macOS `.icns` from `icon.png`.
