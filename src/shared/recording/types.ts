/**
 * Recording model. One "take" = one recording session; every input becomes its
 * own raw file inside the take folder and its own lane in the editor:
 *
 *   <Videos>/Nangchen T. Studio Screen Recorder/<take-id>/
 *     screen.webm   webcam.webm   mic.webm   system.webm   cursor.json   take.json
 *
 * All times are "recording time" in ms: they start at 0 when recording starts and
 * stop advancing while paused, so every file of a take lines up on one clock.
 */
import type { Rect } from "../project/schema";

export type CaptureKind = "display" | "window" | "region";
export type TrackFileKind = "screen" | "webcam" | "mic" | "system";

export interface CaptureSource {
  /** desktopCapturer id, e.g. "screen:0:0" or "window:1234:0". */
  id: string;
  kind: "display" | "window";
  name: string;
  /** PNG data URL thumbnail for the picker. */
  thumbnail: string;
  displayId?: string;
}

export interface DisplayInfo {
  id: string;
  /** DIP bounds in the virtual desktop. */
  bounds: Rect;
  scaleFactor: number;
}

export interface RecordingSettings {
  screen: {
    kind: CaptureKind;
    sourceId: string;
    /** Display the screen/region is on (for cursor normalization). */
    displayId: string;
    /** For "region": rectangle in display DIP coordinates. */
    region?: Rect;
    fps: 30 | 60;
  };
  webcam: { deviceId: string | null; width: number; height: number; fps: number };
  mic: { deviceId: string | null };
  systemAudio: boolean;
  cursor: {
    enabled: boolean;
    /** Off by default: only shortcuts and special keys are logged, never typed text. */
    recordTypedKeys: boolean;
  };
  countdownSec: number;
  /** Folder that holds take folders. */
  outputDir?: string;
}

export const DEFAULT_RECORDING_SETTINGS: RecordingSettings = {
  screen: { kind: "display", sourceId: "", displayId: "", fps: 30 },
  webcam: { deviceId: null, width: 1280, height: 720, fps: 30 },
  mic: { deviceId: null },
  systemAudio: true,
  cursor: { enabled: true, recordTypedKeys: false },
  countdownSec: 3,
};

export interface TakeTrack {
  kind: TrackFileKind;
  /** File name inside the take folder. */
  file: string;
  mimeType: string;
  /** When this file's first frame/sample happened, on the take clock. */
  startOffsetMs: number;
  durationMs: number;
  width?: number;
  height?: number;
  /** Which capture backend produced it. */
  backend: "chromium" | "wgc-helper";
}

export interface PauseSpan {
  /** Recording time at which the pause happened. */
  atMs: number;
  /** Wall-clock length of the pause (excluded from all files). */
  wallMs: number;
}

export interface TakeManifest {
  format: "tdrec-take";
  version: 1;
  id: string;
  createdAt: string;
  durationMs: number;
  settings: RecordingSettings;
  display?: DisplayInfo;
  tracks: TakeTrack[];
  cursorFile?: string;
  pauses: PauseSpan[];
  /** Markers added with the hotkey while recording (recording time, ms). */
  markers: number[];
  /** Inputs that failed to open; the rest of the take still recorded. */
  warnings?: string[];
}

// ---- Cursor / input metadata track (cursor.jsonl) ----
// Written while recording, one JSON value per line, so a crash loses at most
// the last second: line 1 is the header (CursorTrack without samples/events),
// then lines are either a sample [t, x, y] or an InputEvent object.

export type InputEvent =
  | { t: number; type: "down" | "up"; button: number; x: number; y: number; clicks: number }
  | { t: number; type: "wheel"; x: number; y: number; dx: number; dy: number }
  | { t: number; type: "key"; key: string; mods: string[] };

export interface CursorTrack {
  format: "tdrec-cursor";
  version: 1;
  /** Coordinates are normalized to the captured area: 0..1 inside, may go outside. */
  /** coords "display": 0–1 across the whole display (Stage 4+); absent: 0–1 across the region. */
  space: { width: number; height: number; displayBounds: Rect; region?: Rect; coords?: "display" };
  sampleHz: number;
  /** [t, x, y] samples, recording time ms and normalized coordinates. */
  samples: [number, number, number][];
  events: InputEvent[];
}

// ---- Controller state shared by the recorder UI, HUD and main ----

export type RecorderPhase = "idle" | "countdown" | "recording" | "paused" | "stopping" | "error";

export interface RecorderStatus {
  phase: RecorderPhase;
  countdown?: number;
  elapsedMs: number;
  takeId?: string;
  takeDir?: string;
  error?: string;
  /** Inputs that could not be recorded this take (e.g. "webcam: NotAllowedError…"). */
  warnings?: string[];
}

/** Global hotkeys (work while minimized). F-keys avoid clashing with app shortcuts. */
export const RECORDING_HOTKEYS = {
  toggleRecord: "CommandOrControl+Shift+F9",
  togglePause: "CommandOrControl+Shift+F10",
  cancel: "CommandOrControl+Shift+F11",
  marker: "CommandOrControl+Shift+M",
} as const;
