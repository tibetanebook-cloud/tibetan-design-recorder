/** IPC for recording: recorder UI <-> main <-> capture window / HUD / bubble. */
export const REC = {
  // recorder UI -> main
  listSources: "rec:list-sources",
  listDisplays: "rec:list-displays",
  selectRegion: "rec:select-region",
  start: "rec:start",
  pause: "rec:pause",
  resume: "rec:resume",
  stop: "rec:stop",
  cancel: "rec:cancel",
  marker: "rec:marker",
  status: "rec:status", // main -> all windows (broadcast) and invoke to read
  showBubble: "rec:show-bubble",
  hotkeyStart: "rec:hotkey-start", // main -> recorder UI: start with current settings
  // main -> capture window
  captureBegin: "rec:capture-begin", // open inputs, create recorders (not started)
  captureGo: "rec:capture-go", // start all recorders together
  capturePause: "rec:capture-pause",
  captureResume: "rec:capture-resume",
  captureEnd: "rec:capture-end",
  // capture window -> main
  captureReady: "rec:capture-ready",
  capturePrepared: "rec:capture-prepared",
  trackStarted: "rec:track-started",
  chunk: "rec:chunk",
  captureDone: "rec:capture-done",
  captureError: "rec:capture-error",
  captureWarning: "rec:capture-warning",
  // region selector -> main
  regionChosen: "rec:region-chosen",
  // main -> recorder UI after stop
  takeFinished: "rec:take-finished",
} as const;

export interface CaptureBeginPayload {
  /** The screen source to request via getDisplayMedia (main answers the request). */
  screen: { sourceId: string; fps: number } | null;
  webcam: { deviceId: string; width: number; height: number; fps: number } | null;
  mic: { deviceId: string } | null;
  /** Windows: system audio comes with the screen request as loopback audio. */
  systemAudio: boolean;
}

export interface TrackStartedPayload {
  kind: "screen" | "webcam" | "mic" | "system";
  mimeType: string;
  /** Wall time (epoch ms) of the recorder's start event. */
  wallMs: number;
  width?: number;
  height?: number;
}

export interface CaptureDonePayload {
  /** Wall time of each recorder's stop event. */
  stoppedWallMs: Partial<Record<"screen" | "webcam" | "mic" | "system", number>>;
}
