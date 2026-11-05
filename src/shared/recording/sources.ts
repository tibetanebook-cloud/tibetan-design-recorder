/**
 * Capture ids are not permanent. Windows numbers a screen by its current device name
 * (\\.\DISPLAY5 is "screen:4:0"), and that number changes when a monitor sleeps or
 * reconnects. Asking for an old id fails with NotReadableError, so the id is looked up
 * again just before recording. A screen is found by its display id, which stays the same.
 */
export interface LiveSource {
  id: string;
  display_id?: string;
}

/** The id to record now, or null if the chosen screen or window is gone. */
export function resolveCaptureSource(
  chosen: { kind: string; sourceId: string; displayId?: string },
  live: LiveSource[],
): string | null {
  if (chosen.kind !== "window" && chosen.displayId) {
    const sameScreen = live.find((s) => s.id.startsWith("screen") && s.display_id === chosen.displayId);
    if (sameScreen) return sameScreen.id;
  }
  return live.some((s) => s.id === chosen.sourceId) ? chosen.sourceId : null;
}
