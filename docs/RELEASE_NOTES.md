# Release notes

## 0.1.0 — first complete build (2026-10-22)

Tibetan Design Recorder · བོད་ཀྱི་བརྙན་ལེན། — a screen recorder and multi-track editor for
teaching, in Tibetan and English.

**Record** — screen, webcam, microphone and system audio, each as its own file and lane,
plus cursor, click and keystroke data; countdown, pause, markers, crash recovery.

**Edit** — multi-track timeline (move, trim, split, ripple delete, link/unlink, snapping,
markers, undo), auto-zoom and zoom regions, cursor effects, styled frames and backgrounds,
webcam bubble and one-click layouts, speed regions, transitions, title templates,
callouts, highlight, spotlight, blur/pixelate redaction, step numbers, keystroke display,
quizzes and chapters, green screen, audio tools (noise removal, leveling, EQ, compressor),
auto-captions (OpenAI-compatible service) with SRT/VTT import/export, a library with
original music loops, and a background job queue.

**Export** — MP4 (H.264/HEVC/AV1), WebM (VP9/AV1), GIF, MP3, WAV, M4A, each lane as its
own file, In/Out range, captions burned in or as .srt, batch export; graphics-card
encoding built in (no FFmpeg).

**Tibetan** — the whole interface is in Tibetan and English (terms from the IT dictionary;
146 new terms await a native speaker's review), Noto Serif Tibetan with tall line height,
syllable-safe line breaking and text animation.

**Known limits**
- Builds are not code-signed yet (see INSTALL.md for the first start).
- Offline speech-to-text and background removal without a green screen need a model
  download (not included).
- Native capture helpers (cursor-free screen capture, single-window capture, system audio
  on macOS/Linux) are planned; the built-in Chromium capture is used today.
- Long recordings export more slowly than they could (frames are read by seeking).
