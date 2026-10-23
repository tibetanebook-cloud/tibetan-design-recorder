import { CaptionStyle, CursorStyle, PROJECT_FORMAT, PROJECT_VERSION, WebcamLayout, ZoomSettings, type Project, type Track, type TrackKind } from "./schema";

let counter = 0;
/** Short unique id; crypto.randomUUID exists in Electron main, renderer and Node 19+. */
export const newId = (prefix: string): string =>
  `${prefix}_${globalThis.crypto?.randomUUID?.().slice(0, 8) ?? (++counter).toString(36)}`;

/** Lane order, top to bottom. The top lane draws on top, so the webcam sits above the screen. */
export const RECORDING_LANES: readonly TrackKind[] = ["webcam", "screen", "mic", "system"];

/** An empty name means "show the lane type, translated" in the timeline. */
export function makeTrack(kind: TrackKind, name = ""): Track {
  return {
    id: newId("trk"),
    kind,
    name,
    locked: false,
    muted: false,
    solo: false,
    hidden: false,
    volume: 1,
    pan: 0,
    opacity: 1,
  };
}

/** A new empty project with the four recording lanes in place. */
export function createProject(name: string, now = new Date()): Project {
  const iso = now.toISOString();
  return {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    id: newId("prj"),
    name,
    createdAt: iso,
    modifiedAt: iso,
    canvas: {
      width: 1920,
      height: 1080,
      fps: 30,
      background: { type: "wallpaper", id: "lhasa-dusk" },
      padding: 0.06,
      cornerRadius: 16,
      shadow: 0.67,
      backgroundBlur: 0,
      aspect: "16:9",
    },
    media: [],
    tracks: RECORDING_LANES.map((kind) => makeTrack(kind)),
    clips: [],
    markers: [],
    editor: { playheadMs: 0, pixelsPerSecond: 80, selectedClipIds: [] },
    zooms: [],
    zoom: ZoomSettings.parse({}),
    cursor: CursorStyle.parse({}),
    webcam: WebcamLayout.parse({}),
    layouts: [],
    captionStyle: CaptionStyle.parse({}),
    analysis: {},
    effects: {},
  };
}

/** Timeline length: end of the last clip. */
export function projectDurationMs(project: Project): number {
  return project.clips.reduce((end, c) => Math.max(end, c.startMs + c.durationMs), 0);
}
