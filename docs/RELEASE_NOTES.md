# Release notes

## 0.2.3 — free fonts included (2026-10-23)

- **Free, open-source fonts come with the app** (SIL Open Font License), so every user has them:
  - Tibetan: **Noto Serif Tibetan, Jomolhari, Uchen**
  - English: Inter, Roboto, Open Sans, Montserrat, Lato, Poppins, Noto Sans, Noto Serif, Merriweather,
    Playfair Display, Oswald, Raleway, Bebas Neue, Lobster, Pacifico, Dancing Script, Caveat, Source Code Pro
- They are loaded when the app starts, so text appears in the right font straight away.
- **All fonts installed on your computer** are read when the app starts too: the font list is complete
  the first time you open it (no extra click). Groups: Tibetan fonts · free fonts included · on this computer.

## 0.2.2 — all your fonts (2026-10-23)

- The font option (text, callouts, titles, captions) now opens a searchable list of **every font
  installed on your computer**: Tibetan fonts first with a ཀ་ཁ་ག་ང་། sample, then all others, each
  name shown in its own font. Type to search; Enter picks the first match.

## 0.2.1 — fixes (2026-10-23)

- Fixed: on some PCs the app stopped at its first start with "A JavaScript error occurred in the
  main process" (while copying settings from 0.1). Starting the app can no longer fail there.
- Fixed: the welcome screen's Tibetan name ran into the English name.
- Fixed: in the lower-third and chapter title templates, a Tibetan subtitle overlapped the title.
- Downloads are now just Windows and Mac, with short names:
  `Nangchen-Recorder-0.2.1-Windows-Setup.exe`, `…-Mac-AppleSilicon.dmg`, `…-Mac-Intel.dmg`.
- The double-click text editor is wider, so short titles don't wrap while typing.

## 0.2.0 — new name, webcam styles and filters, fonts, in-place text editing

The app is now called **Nangchen T. Studio Screen Recorder · ནང་ཆེན་བཀྲིས་གློག་ཀླད་མཐོང་རིས་འཛིན་ཆས།**. Settings, the library and autosaves from 0.1
(Tibetan Design Recorder) are copied over the first time it starts.

**Webcam**
- Smoother webcam playback: small timing differences are corrected by gently adjusting
  the speed instead of jumping, and new video frames are drawn only when they arrive.
- Bubble shapes: circle, rounded, squircle, square, hexagon, diamond and heart, in 1:1,
  4:3, 16:9, 3:4 or 9:16 proportions.
- Borders: solid, double, gradient, glow, neon, dashed, ring and an animated rainbow, with
  ready-made colour pairs.
- Filters: skin smoothing (edge-preserving, keeps eyes and hair sharp), brighten face and
  sharpen; 15 one-click looks (Natural, Warm, Cool, Vivid, Soft, Film, Vintage, Faded,
  Black & White, Sepia, Dramatic, Rose, Teal & Orange, Golden Hour); and brightness,
  contrast, saturation, warmth, tint, matte and vignette sliders. Preview and export match.

**Text and titles**
- Double-click any text, callout, title or caption on the preview to edit it in place
  (Enter saves, Shift+Enter adds a line, Esc cancels; one undo step).
- Font option for text, callouts, titles and captions, including any font installed on
  your computer (Tibetan fonts listed first). Tibetan always falls back to Noto Serif Tibetan.

**Tibetan** — every new control is translated; 42 new terms are added to the review list
(docs/i18n/tibetan-review.csv).

**Faster** — the preview draws at the size it is shown instead of always at full
resolution, and noise removal costs nothing when it is off.

**Security** — see [SECURITY.md](SECURITY.md): files are written only where you chose,
the media protocol serves only media files, auto-captions send only audio/video to an
https service, navigation and pop-ups are locked, test hooks are off in normal use, and
the packaged app is hardened with Electron fuses.

## 0.1.0 — first complete build (2026-10-22)

Tibetan Design Recorder (now Nangchen T. Studio Screen Recorder) — a screen recorder and multi-track editor for
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
