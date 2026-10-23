/**
 * Writes one take folder: a streaming file per track (chunks arrive over IPC from
 * the capture window), the cursor track, and take.json. Each file is independent;
 * nothing is ever muxed together.
 */
import { createWriteStream, promises as fs, type WriteStream } from "node:fs";
import { join } from "node:path";
import { encodeDuration, insertDurationPlaceholder, type DurationPatch } from "@shared/recording/webm";
import type { TakeManifest, TakeTrack, TrackFileKind } from "@shared/recording/types";
import { writeFileAtomic } from "../project-io";

interface OpenTrack {
  meta: TakeTrack;
  path: string;
  stream: WriteStream;
  bytes: number;
  patch: DurationPatch | null;
  first: boolean;
}

export function takeId(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `take-${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
}

export class TakeWriter {
  private readonly tracks = new Map<TrackFileKind, OpenTrack>();

  private constructor(readonly dir: string, readonly id: string) {}

  static async create(rootDir: string, id = takeId()): Promise<TakeWriter> {
    const dir = join(rootDir, id);
    await fs.mkdir(dir, { recursive: true });
    return new TakeWriter(dir, id);
  }

  openTrack(kind: TrackFileKind, mimeType: string, extra: Partial<TakeTrack> = {}): void {
    const ext = mimeType.includes("mp4") ? "mp4" : mimeType.includes("wav") ? "wav" : "webm";
    const file = `${kind}.${ext}`;
    const path = join(this.dir, file);
    this.tracks.set(kind, {
      meta: { kind, file, mimeType, startOffsetMs: 0, durationMs: 0, backend: "chromium", ...extra },
      path,
      stream: createWriteStream(path),
      bytes: 0,
      patch: null,
      first: true,
    });
  }

  setStart(kind: TrackFileKind, startOffsetMs: number, size?: { width: number; height: number }): void {
    const t = this.tracks.get(kind);
    if (!t) return;
    t.meta.startOffsetMs = startOffsetMs;
    if (size) Object.assign(t.meta, size);
  }

  startOffset(kind: TrackFileKind): number {
    return this.tracks.get(kind)?.meta.startOffsetMs ?? 0;
  }

  /** Append a chunk; the first WebM chunk gets a duration placeholder. */
  write(kind: TrackFileKind, chunk: Uint8Array): Promise<void> {
    const t = this.tracks.get(kind);
    if (!t) return Promise.resolve();
    let data = chunk;
    if (t.first) {
      t.first = false;
      if (t.meta.file.endsWith(".webm")) {
        t.patch = insertDurationPlaceholder(chunk);
        if (t.patch) data = t.patch.data;
      }
    }
    t.bytes += data.byteLength;
    return new Promise((resolve, reject) => t.stream.write(data, (err) => (err ? reject(err) : resolve())));
  }

  /**
   * Close every file, stamp each file's own duration (from its first frame),
   * write cursor.json and take.json. Tracks that received no data are dropped.
   */
  async finish(base: Omit<TakeManifest, "tracks" | "cursorFile" | "format" | "version" | "id">, durations: Partial<Record<TrackFileKind, number>>, cursorFile?: string): Promise<TakeManifest> {
    const tracks: TakeTrack[] = [];
    for (const [kind, t] of this.tracks) {
      await new Promise<void>((resolve) => t.stream.end(resolve));
      t.meta.durationMs = Math.round(Math.max(0, durations[kind] ?? base.durationMs - t.meta.startOffsetMs));
      if (t.bytes === 0) {
        await fs.rm(t.path, { force: true });
        continue;
      }
      if (t.patch) {
        const handle = await fs.open(t.path, "r+");
        try {
          await handle.write(encodeDuration(t.meta.durationMs, t.patch.timecodeScale), 0, 8, t.patch.durationOffset);
        } finally {
          await handle.close();
        }
      }
      tracks.push(t.meta);
    }
    const manifest: TakeManifest = { format: "tdrec-take", version: 1, id: this.id, ...base, tracks, cursorFile };
    await writeFileAtomic(join(this.dir, "take.json"), JSON.stringify(manifest, null, 2));
    return manifest;
  }

  /** Cancel: close streams and delete the take folder. */
  async discard(): Promise<void> {
    for (const t of this.tracks.values()) await new Promise<void>((r) => t.stream.end(r));
    await fs.rm(this.dir, { recursive: true, force: true });
  }
}
