# Architecture

Tibetan Design Recorder (བོད་ཀྱི་བརྙན་ལེན།) is an Electron + React + TypeScript + Vite
desktop app. PixiJS composes frames; FFmpeg encodes them (Stage 6).

## Why Electron (not Tauri)

Recording and editing need the same engine on every OS: WebCodecs/MediaRecorder for
webcam and audio, WebGL for the PixiJS compositor, and identical font shaping for
Tibetan. Electron ships one Chromium everywhere, so the preview and the export look
the same on Windows, macOS and Linux. Tauri uses each OS's own webview (WebView2,
WKWebView, WebKitGTK), whose WebGL, media and font support differ — that would break
the "what you see is what you export" rule.

## Process layout

```
src/
  shared/      Pure TypeScript, no Electron or DOM. Used by every process and the tests.
    project/   .tdrec schema (zod), factory, undo/redo history, demo project
    scene/     buildScene(project, t) -> Scene   <- the one renderer contract
    text/      Tibetan-aware line breaking
    i18n/      en.json + bo.json (identical keys) and translate()
    menu.ts    One menu definition for the in-app and native menus
    ipc.ts     IPC channel names and payload types
  main/        Electron main: windows, IPC, dialogs, project files, autosave, recovery
    capture/   (Stage 2) native capture helper bridge per OS
  preload/     contextBridge API (window.tdr); renderer has no Node access
  renderer/    React UI + PixiJS Compositor
tests/unit     Vitest: schema, history, scene, i18n, line breaking, save/recovery
```

## The rendering contract (WYSIWYG)

`buildScene(project, timeMs)` returns a plain description of every layer: what it
shows, where, with which opacity, corner radius and shadow. `Compositor.render(scene)`
draws that with PixiJS. The editor preview calls them for the playhead; the exporter
(Stage 6) loads the same renderer bundle in a hidden window, calls them for every
output frame, reads the pixels and pipes them to FFmpeg. Effects (zoom, cursor,
webcam bubble, annotations, captions) are added to `buildScene`, never to a
separate export path.

## Recording model (Stage 2)

Every input is a separate raw file and a separate media entry in the project:

| Lane | Source | Windows | macOS | Linux |
|---|---|---|---|---|
| Screen | display/window/region | Windows Graphics Capture helper | ScreenCaptureKit helper | Electron desktopCapturer (X11 list, Wayland portal) |
| Webcam | camera | getUserMedia | getUserMedia | getUserMedia |
| Mic | microphone | getUserMedia | getUserMedia | getUserMedia |
| System audio | output loopback | WASAPI loopback helper | ScreenCaptureKit audio | PipeWire monitor |
| Cursor | positions, clicks, keys | native hook → JSONL | native hook → JSONL | best effort |

All files of one take share a start clock (`clockOffsetMs`), so lanes line up without
drift. The details of each helper are informed by the REA clean-room analysis in
`E:\Reverse Engineer\specs\` (behavior only — no Recordly code is used).

### What Stage 2 ships

- **Capture backend: Chromium** (all three OSes). A hidden capture window opens each input
  and runs one MediaRecorder per input, streaming chunks to main, which writes
  `screen.webm`, `webcam.webm`, `mic.webm`, `system.webm`, `cursor.jsonl` and `take.json` into
  `Videos/Tibetan Design Recorder/<take-id>/`. On Windows, Chromium itself uses Windows
  Graphics Capture for the screen and WASAPI loopback for system audio.
- **Sync**: every input is opened and its recorder started-then-paused during the countdown
  (encoders warm up, ~0.7 s for H.264); at "go" the take clock starts and all recorders resume
  in the same task. Each file stores its start offset on the take clock (measured: ≤ 2 ms apart).
- **Pause** closes up every file's timeline; pauses and hotkey markers become timeline markers.
- **Independent inputs**: a blocked webcam or silent mic never stops the take — the other inputs
  record and the failure is shown (HUD ⚠, recorder screen) and stored in `take.json`.
- **Cursor track**: 60 Hz position (only on change + 1 Hz keep-alive) plus global clicks,
  wheel and shortcut keys via uiohook-napi; typed text only if the user opts in.
- **WebM finalization**: a Duration element is inserted into the first chunk and stamped in
  place at stop, so long recordings are never re-read or re-written.
- **Not yet** (native helpers, next): OS cursor hidden in the screen video, true window capture,
  system audio on macOS (ScreenCaptureKit) and Linux (PipeWire).

## Stage 4: effects (all inside the shared scene builder)

Every effect is a pure function of (project, time), computed in `src/shared` and
drawn by the one compositor, so preview, seeking and export always agree.

| Feature | Where | Notes |
|---|---|---|
| Zoom regions | `effects/zoom.ts`, Camera lane | Envelope evaluated 200 ms late: ramp in over zoom-in time ending 1 s after the start, hold to 500 ms before the end, ramp out. Regions < 1.35 s apart connect. Depth 1–6 = 1.25–5×. Easing presets are real (smooth / snappy / gentle / linear / custom Bezier). |
| Camera smoothing | `effects/spring.ts` | Springs are simulated over a fixed window before the requested time, so they are deterministic. Camera clamped so the canvas always covers the frame. Pan motion blur. |
| Follow-cursor zooms | `effects/zoom.ts` | Focus stays inside a dead zone (viewport shrunk 25 % per side), snaps along an axis when the cursor leaves it, freezes while zooming out. |
| Auto-zoom suggestions | `effects/suggest.ts` | Clicks classified (double, text selection, dropdown, text field, generic) + typing bursts; clustered within 2.5 s; padded 0.5 s; shown as ghosts to accept/reject; run automatically after each recording. |
| Cursor | `effects/cursor.ts`, cursor lane | From the metadata track: interpolation, spring smoothing, click bounce, sway, motion trail, loop mode, ripple/spotlight/echo rings, keystroke chips. Own artwork. The cursor lane is linked to the screen clip and can be trimmed/hidden. Off by default for Chromium takes (the OS pointer is already in the video). |
| Frame styling | `scene/placement.ts`, compositor | Squircle corners, three-layer soft shadow, padding, aspect presets, background blur. Built-in wallpapers are drawn in code (`compositor/wallpapers.ts`). |
| Webcam | `scene/buildScene.ts` | Layouts: bubble (9 anchors or custom, size, margin, roundness, mirror, shadow, shrinks while zoomed) / side by side / full / hidden. |
| Speed regions | `timeline/regions.ts` | A time warp over In/Out applied to every unlocked lane at once (clips, markers and zooms move together), so inputs never drift apart. |
| Annotations | `schema.ts` `shape` content, compositor | Text, image, arrow, line, rectangle, ellipse on annotation lanes; a new lane is added when the current one is busy. |

## Stage 5: teaching and editing tools

Same rule as Stage 4: what is on screen is decided in `src/shared` (pure, unit-tested),
and drawn by the one compositor, so preview and export match.

| Tool | Where | Notes |
|---|---|---|
| Callouts | `callout` content, `Compositor.drawCallout` | Bubble / box / pill with a pointer tail (drag the white handle in the preview). Text is wrapped with the Tibetan line breaker. |
| Highlight, spotlight | `highlight`, `spotlight` content | Highlighter uses multiply blending; spotlight dims everything outside an ellipse/rectangle with a soft edge. Both follow the camera zoom. |
| Blur / pixelate / solid redaction | `redact` content, `Compositor.drawRedact` | The pixels already drawn in the camera (screen, background) are captured for the region, then pixelated (low-resolution capture, nearest scaling) or blurred; the region follows the zoom, so private data stays covered. Overlays above the camera (webcam, other annotations) are not part of the capture. |
| Step numbers, keystrokes | `step` content, `teaching.ts` | Steps number themselves by time unless a number is set. Keystroke chips come from the Stage 2 metadata track. |
| Transitions | `effects/transitions.ts` | Per clip in/out: fade, cross dissolve (holds the previous clip's last frame underneath), slides, wipe, zoom, blur. |
| Text animation | `effects/transitions.ts` | Fade, rise, pop, wipe, typewriter. The typewriter reveals whole Tibetan syllables (never half a stack) and whole Latin graphemes. |
| Title templates | `title` content, `Compositor.drawTitle` | Intro, outro, lower third, chapter card, quote, centre title; animated entrance. |
| Layouts over time | `effects/layouts.ts` | One-click buttons under the preview add a switch at the playhead (screen only / webcam only / side by side / screen + bubble); switches morph over 450 ms. |
| Audio tools | `renderer/src/audio/fxChain.ts`, `denoise.worklet.js`, `shared/audio/fx.ts` | Per lane: high-pass → 3-band EQ → noise removal (our own STFT spectral gate in an AudioWorklet: minimum-tracking noise floor, −20 dB max) → compressor → make-up + leveling gain. Leveling uses a loudness estimate (simplified BS.1770 with gating) measured by a background job. Presets: clear voice, podcast, warm, reduce hiss. The exporter will build the same chain in an OfflineAudioContext. |
| Captions | `shared/captions/*`, `main/transcribe.ts`, Captions panel | SRT/VTT import/export (UTF-8 with BOM), editable cue list, caption style (size, colours, box, position, width, rows, animation). Auto-captions call any OpenAI-compatible `/audio/transcriptions` endpoint from the main process; the API key is encrypted with the OS key store (Electron `safeStorage`) and never enters the page. Tibetan speech recognition is weak in current services, so the panel says so and Tibetan SRT import is first-class. |
| Green screen | `compositor/chromaKey.ts` | WebGL filter: CbCr distance key with soft edge and spill suppression. "Remove background" without a green screen is reserved for a person-segmentation model (needs your OK to download). |
| Quizzes, chapters | `Marker.quiz`, `teaching.ts`, Teaching panel | Quiz cards appear in the video for their duration and reveal the correct answer for the last 40 %; chapter list exports in YouTube format. |
| Library | `shared/library.ts`, `main/library.ts` | Title templates, callouts/shapes, wallpapers, three original music loops (`build/library-source/make_music.py`), and "My Library" (save selected titles/callouts, reuse in any project; stored in the user data folder). |
| Job queue | `renderer/src/jobs.ts`, Jobs panel | Loudness analysis and transcription run one at a time in the background with progress and cancel; Stage 6 exports join the same queue. |

## Stage 6: export

Decision (owner, 2026-10-22): encode with the **WebCodecs encoders built into Electron**
(probed on the dev PC: H.264 hardware+software, HEVC hardware, VP9, AV1, AAC, Opus), no
FFmpeg. MP3 via lamejs.

| Part | Where | Notes |
|---|---|---|
| Settings, presets, bitrate | `shared/export/settings.ts` | Quality = resolution scale (source 100 %, high 90, good 75, medium 60). Auto bitrate by pixel count (720p 5/8, 1080p 8/12, 4K 35/45 Mbps for normal/source), × √(fps/30) × mode (fast .5, balanced .8, quality 1), floor 2 Mbps. GIF capped at 720p/1080p. |
| Plan | `shared/export/plan.ts` | Range (whole timeline or In/Out; the cursor track doesn't count), frame times, audio schedule (source position, speed, gain, fades, pan, lane FX) cut to the range. |
| Frames | `renderer/src/export/exporter.ts` `FrameRenderer` | A second compositor at the output size, same `buildScene`; each frame seeks its own media elements, waits for images, then renders. Golden-frame check in the smoke test. |
| Audio | `renderer/src/export/audioMix.ts` | OfflineAudioContext, same `FxChain` as the preview (incl. the noise worklet), fades, pan, soft limiter. Speed ≠ 1 is time-stretched with WSOLA (`shared/audio/stretch.ts`) so voices keep their pitch. |
| Encoding | `exporter.ts` | `VideoEncoder` (codec strings High→Main→Baseline, hardware first, fallback software), keyframe every 2 s, back-pressure on the encode queue; `AudioEncoder` AAC (MP4/M4A) or Opus (WebM); MP3 via lamejs; WAV own writer; GIF via gifenc (per-frame 256-colour palette). |
| Files | `main/exportFiles.ts` | Muxers stream chunks with byte positions to `<file>.part` through the main process; renamed on success, deleted on cancel/failure. MP4 has its index at the end (not fast-start). |
| Jobs | `renderer/src/export/exportJobs.ts`, Jobs panel | Each export is a background job on a snapshot of the project: one file, every lane as its own file (webcam full-frame, sound lanes as WAV/M4A/MP3), or a batch of `.tdrec` files into one folder. Progress, time left, cancel, "Show in folder". |

Known limits: frames come from seeking `<video>` elements, which is slower than a
WebCodecs decoder pipeline for long recordings (the spec's decode-ahead design is the
planned optimisation); MP4 is not fast-start.

### Extensions (data-only)

Folders with `extension.json` in `resources/extensions` (bundled) and
`<userData>/extensions` (user). They can add wallpapers, device frames (image +
screen opening) and click sounds; ids are namespaced `<extension>/<item>`. Files
must stay inside the extension folder (checked on load). Extensions cannot run
code; a render-hook API is reserved but not implemented. Format: `src/shared/extensions.ts`.
The bundled sample "Tibetan Basics" is generated by
`build/extensions-source/make_tibetan_basics.py` (all artwork original).

## Project files

`.tdrec` is JSON: format/version, canvas, media (absolute + relative paths), tracks,
clips, markers, editor state and an `effects` map for later stages. Saves are atomic
(temp file + fsync + rename). Autosave goes to the app's data folder every 30 s; a
session lock marks an unclean exit so the next launch offers recovery.

## Localization

Every visible string is a key in `src/shared/i18n/en.json` and `bo.json`. Tibetan
strings are rendered exactly as stored (no trimming, normalization or wrapping by the
browser); `:lang(bo)` uses Noto Serif Tibetan with line-height ≥ 1.8. Tibetan line
breaks happen only after tsheg/shad, never inside a stack. Term sources are listed in
`docs/i18n/TIBETAN_TERMS.md`.
