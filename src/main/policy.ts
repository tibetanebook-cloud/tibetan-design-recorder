/** File rules that need no Electron (unit-tested in tests/unit/security.test.ts). */
import { extname, isAbsolute, normalize, relative, resolve, sep } from "node:path";

/**
 * Where the renderer may write. Paths become writable only when the user picked
 * them in a save/folder dialog in this session, or they are inside the app's own
 * output folders.
 */
export class WritePolicy {
  private readonly files = new Set<string>();
  private readonly dirs = new Set<string>();

  private static key(p: string): string {
    const n = normalize(resolve(p));
    return process.platform === "win32" || process.platform === "darwin" ? n.toLowerCase() : n;
  }

  allowFile(path: string): void {
    this.files.add(WritePolicy.key(path));
  }

  allowDir(dir: string): void {
    this.dirs.add(WritePolicy.key(dir));
  }

  /** Inside an allowed folder (not a sub-path trick), or exactly an allowed file. */
  canWrite(path: string): boolean {
    if (typeof path !== "string" || !isAbsolute(path) || path.includes("\0")) return false;
    const k = WritePolicy.key(path);
    if (this.files.has(k)) return true;
    for (const d of this.dirs) {
      const rel = relative(d, k);
      if (rel && !rel.startsWith("..") && !isAbsolute(rel) && !rel.includes(`..${sep}`)) return true;
    }
    return false;
  }

  /** A caption file written next to an allowed video (same name, .srt). */
  canWriteSidecar(path: string): boolean {
    if (extname(path).toLowerCase() !== ".srt") return false;
    const base = path.slice(0, -4);
    return this.canWrite(path) || [".mp4", ".webm", ".gif"].some((ext) => this.canWrite(base + ext));
  }
}

/** File types the app reads through its media protocol (anything else is refused). */
export const READABLE_EXTENSIONS = new Set([
  ".webm", ".mp4", ".mov", ".mkv", ".m4v",
  ".m4a", ".wav", ".mp3", ".aac", ".ogg", ".opus", ".flac",
  ".png", ".jpg", ".jpeg", ".webp", ".gif",
  ".jsonl", ".srt", ".vtt",
]);

/** Audio/video files that may be sent to the speech-to-text service. */
export const TRANSCRIBABLE_EXTENSIONS = new Set([".webm", ".mp4", ".m4a", ".wav", ".mp3", ".ogg", ".opus", ".flac", ".aac", ".mov", ".mkv", ".m4v"]);
