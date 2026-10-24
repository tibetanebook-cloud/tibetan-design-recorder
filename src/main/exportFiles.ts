/**
 * Output files for exports. The muxers stream chunks with a byte position (the
 * MP4 header is patched at the end), so the page writes through an open file
 * handle here. Files are written to "<name>.part" and renamed when finished;
 * a cancelled export removes its part file.
 */
import { promises as fs } from "node:fs";
import type { FileHandle } from "node:fs/promises";

interface Open {
  handle: FileHandle;
  path: string;
  bytes: number;
}

const open = new Map<number, Open>();
let nextId = 1;

export async function exportOpen(path: string): Promise<number> {
  const handle = await fs.open(`${path}.part`, "w");
  const id = nextId++;
  open.set(id, { handle, path, bytes: 0 });
  return id;
}

export async function exportWrite(id: number, position: number, data: Uint8Array): Promise<void> {
  const f = open.get(id);
  if (!f) throw new Error("export file is not open");
  await f.handle.write(data, 0, data.byteLength, position);
  f.bytes = Math.max(f.bytes, position + data.byteLength);
}

/** ok: rename into place (replacing an older file); otherwise delete the part file. */
export async function exportClose(id: number, ok: boolean): Promise<{ path: string; bytes: number } | null> {
  const f = open.get(id);
  if (!f) return null;
  open.delete(id);
  await f.handle.close();
  if (!ok) {
    await fs.rm(`${f.path}.part`, { force: true });
    return null;
  }
  await retryLocked(() => fs.rm(f.path, { force: true }));
  try {
    await retryLocked(() => fs.rename(`${f.path}.part`, f.path));
  } catch (e) {
    // Still locked by another program (the part file can be read but not moved): copy instead.
    console.warn(`export rename blocked (${(e as NodeJS.ErrnoException).code}); copying instead`);
    await fs.copyFile(`${f.path}.part`, f.path);
    await retryLocked(() => fs.rm(`${f.path}.part`, { force: true })).catch(() => undefined);
  }
  return { path: f.path, bytes: f.bytes };
}

/**
 * Windows antivirus and the search indexer briefly lock a file that was just
 * written; retry for up to ~4 s instead of failing the export.
 */
async function retryLocked(op: () => Promise<void>): Promise<void> {
  for (let i = 0; ; i++) {
    try {
      return await op();
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (i >= 12 || !(code === "EPERM" || code === "EBUSY" || code === "EACCES")) throw e;
      await new Promise((r) => setTimeout(r, 50 * (i + 1)));
    }
  }
}

export async function closeAllExports(): Promise<void> {
  await Promise.all([...open.keys()].map((id) => exportClose(id, false)));
}
