/**
 * Assets the scene builder needs besides the project itself: parsed cursor tracks
 * (cursor.jsonl of each take) and extension content (device frames, wallpapers,
 * click sounds). Loaded once, cached, and listeners are told when something arrives.
 */
import type { Project } from "@shared/project/schema";
import { parseCursorJsonl } from "@shared/recording/cursorFile";
import { toDisplaySpace } from "@shared/effects/cursor";
import type { CursorTrack } from "@shared/recording/types";
import type { DeviceFrameInfo, SceneContext } from "@shared/scene/buildScene";
import type { ExtensionInfo } from "@shared/extensions";

const cursorTracks = new Map<string, CursorTrack>();
const loading = new Set<string>();
const deviceFrames = new Map<string, DeviceFrameInfo>();
let extensions: ExtensionInfo[] = [];
const listeners = new Set<() => void>();

export function onAssetsChanged(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
const changed = () => listeners.forEach((fn) => fn());

/** Start loading any cursor tracks of this project that aren't loaded yet. */
export function ensureProjectAssets(project: Project): void {
  for (const m of project.media) {
    if (m.kind !== "cursor" || cursorTracks.has(m.id) || loading.has(m.id)) continue;
    loading.add(m.id);
    void fetch(window.tdr.mediaUrl(m.path))
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((text) => {
        cursorTracks.set(m.id, toDisplaySpace(parseCursorJsonl(text)));
        changed();
      })
      .catch((error) => console.warn("Cursor track unavailable:", m.path, error))
      .finally(() => loading.delete(m.id));
  }
}

const fontsReady = new Set<string>();

/**
 * Load the fonts this project uses before its text is drawn (Pixi rasterizes text once).
 * Only these are loaded: reading all 21 bundled families at startup made the app wait
 * for fonts nobody had chosen.
 */
export async function ensureProjectFonts(project: Project): Promise<void> {
  const families = new Set<string>();
  if (project.captionStyle.fontFamily) families.add(project.captionStyle.fontFamily);
  for (const c of project.clips) {
    const family = (c.content as { fontFamily?: string }).fontFamily;
    if (family) families.add(family);
  }
  const missing = [...families].filter((f) => !fontsReady.has(f));
  if (!missing.length) return;
  await Promise.all(
    missing.map(async (family) => {
      const safe = family.replace(/["\\]/g, "");
      await Promise.all(["400", "700"].map((w) => document.fonts.load(`${w} 48px "${safe}"`, "Aa བོད").catch(() => [])));
      fontsReady.add(family);
    }),
  );
}

export const cursorTrackFor = (mediaId: string): CursorTrack | undefined => cursorTracks.get(mediaId);

export function sceneContext(): SceneContext {
  return { cursorTracks, deviceFrames };
}

/** Load the installed extensions (bundled + user folder) and measure their device frames. */
export async function loadExtensions(): Promise<ExtensionInfo[]> {
  extensions = await window.tdr.extensions.list();
  await Promise.all(
    extensions.flatMap((ext) =>
      ext.deviceFrames.map(
        (f) =>
          new Promise<void>((resolve) => {
            const img = new Image();
            img.onload = () => {
              deviceFrames.set(f.id, { path: f.path, width: img.naturalWidth, height: img.naturalHeight, screen: f.screen });
              resolve();
            };
            img.onerror = () => resolve();
            img.src = window.tdr.mediaUrl(f.path);
          }),
      ),
    ),
  );
  changed();
  return extensions;
}

export const installedExtensions = (): ExtensionInfo[] => extensions;
