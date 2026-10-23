/**
 * Loads data-only extensions from the bundled folder and the user's folder.
 * Every referenced file must exist and stay inside its extension folder; bad
 * entries are skipped with a warning instead of failing the whole extension.
 */
import { promises as fs } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { ExtensionManifest, type ExtensionInfo } from "@shared/extensions";

async function exists(path: string): Promise<boolean> {
  try {
    return (await fs.stat(path)).isFile();
  } catch {
    return false;
  }
}

/** Resolve a manifest file path; null if it escapes the extension folder or is missing. */
async function safeFile(dir: string, file: string): Promise<string | null> {
  const full = resolve(dir, file);
  const rel = relative(dir, full);
  // Outside the folder: "..", or (Windows) another drive, which gives an absolute path.
  if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return null;
  return (await exists(full)) ? full : null;
}

export async function loadExtensionsFrom(root: string, bundled: boolean): Promise<ExtensionInfo[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(root);
  } catch {
    return [];
  }
  const out: ExtensionInfo[] = [];
  for (const name of entries) {
    const dir = join(root, name);
    let manifest: ExtensionManifest;
    try {
      manifest = ExtensionManifest.parse(JSON.parse(await fs.readFile(join(dir, "extension.json"), "utf8")));
    } catch {
      continue; // not an extension, or an invalid manifest
    }
    const info: ExtensionInfo = {
      id: manifest.id,
      name: manifest.name,
      names: manifest.names,
      version: manifest.version,
      author: manifest.author,
      description: manifest.description,
      bundled,
      wallpapers: [],
      deviceFrames: [],
      clickSounds: [],
      warnings: [],
    };
    const ns = (itemId: string) => `${manifest.id}/${itemId}`;
    for (const w of manifest.contributes.wallpapers) {
      const path = await safeFile(dir, w.file);
      if (path) info.wallpapers.push({ id: ns(w.id), name: w.name, names: w.names, path });
      else info.warnings.push(`wallpaper "${w.id}": file missing or outside the extension`);
    }
    for (const f of manifest.contributes.deviceFrames) {
      const path = await safeFile(dir, f.file);
      if (path) info.deviceFrames.push({ id: ns(f.id), name: f.name, names: f.names, path, screen: f.screen });
      else info.warnings.push(`device frame "${f.id}": file missing or outside the extension`);
    }
    for (const s of manifest.contributes.clickSounds) {
      const path = await safeFile(dir, s.file);
      if (path) info.clickSounds.push({ id: ns(s.id), name: s.name, names: s.names, path });
      else info.warnings.push(`click sound "${s.id}": file missing or outside the extension`);
    }
    if (manifest.contributes.renderHooks !== undefined) info.warnings.push("render hooks are not supported yet and were ignored");
    out.push(info);
  }
  return out;
}

export async function loadAllExtensions(bundledDir: string, userDir: string): Promise<ExtensionInfo[]> {
  await fs.mkdir(userDir, { recursive: true }).catch(() => undefined);
  const [bundled, user] = await Promise.all([loadExtensionsFrom(bundledDir, true), loadExtensionsFrom(userDir, false)]);
  // A user extension with the same id replaces the bundled one.
  const byId = new Map<string, ExtensionInfo>();
  for (const e of [...bundled, ...user]) byId.set(e.id, e);
  return [...byId.values()];
}
