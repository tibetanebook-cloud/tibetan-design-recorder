/**
 * Extension format (data-only in this version).
 *
 * An extension is a folder with `extension.json` and its files:
 *
 *   {
 *     "id": "tibetan-basics", "name": "Tibetan Basics", "version": "1.0.0",
 *     "author": "…", "description": "…",
 *     "contributes": {
 *       "wallpapers":   [{ "id": "…", "name": "…", "file": "wallpapers/a.jpg" }],
 *       "deviceFrames": [{ "id": "…", "name": "…", "file": "frames/laptop.png",
 *                          "screen": { "x": 120, "y": 80, "width": 1680, "height": 1050 } }],
 *       "clickSounds":  [{ "id": "…", "name": "…", "file": "sounds/click.wav" }]
 *     }
 *   }
 *
 * Folders: the app's bundled `resources/extensions` and `<userData>/extensions`.
 * Files must stay inside the extension folder. Extensions cannot run code; a
 * sandboxed render-hook API is planned and reserved under "renderHooks".
 */
import { z } from "zod";

const id = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,63}$/i);
const file = z.string().min(1).max(260);
/** Optional translations of a name, by language code ("bo", "zh"…). */
const names = z.record(z.string().max(10), z.string().max(100)).optional();

export const ExtensionManifest = z.object({
  id,
  name: z.string().min(1).max(100),
  names,
  version: z.string().max(40),
  author: z.string().max(100).optional(),
  description: z.string().max(500).optional(),
  contributes: z
    .object({
      wallpapers: z.array(z.object({ id, name: z.string().max(100), names, file })).default([]),
      deviceFrames: z
        .array(
          z.object({
            id,
            name: z.string().max(100),
            names,
            file,
            screen: z.object({ x: z.number().min(0), y: z.number().min(0), width: z.number().positive(), height: z.number().positive() }),
          }),
        )
        .default([]),
      clickSounds: z.array(z.object({ id, name: z.string().max(100), names, file })).default([]),
      /** Reserved for a future sandboxed render-hook API (ignored today). */
      renderHooks: z.unknown().optional(),
    })
    .default({ wallpapers: [], deviceFrames: [], clickSounds: [] }),
});
export type ExtensionManifest = z.infer<typeof ExtensionManifest>;

/** What the renderer receives: ids are namespaced "<extension>/<item>", paths absolute. */
type Names = Record<string, string> | undefined;

export interface ExtensionInfo {
  id: string;
  name: string;
  names?: Names;
  version: string;
  author?: string;
  description?: string;
  bundled: boolean;
  wallpapers: { id: string; name: string; names?: Names; path: string }[];
  deviceFrames: { id: string; name: string; names?: Names; path: string; screen: { x: number; y: number; width: number; height: number } }[];
  clickSounds: { id: string; name: string; names?: Names; path: string }[];
  /** Problems found while loading (bad files are skipped, not fatal). */
  warnings: string[];
}

/** An extension item's name in the UI language (falls back to its main name). */
export const localName = (item: { name: string; names?: Record<string, string> }, language: string): string => item.names?.[language] || item.name;
