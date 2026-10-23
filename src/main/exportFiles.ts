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
  await fs.rm(f.path, { force: true });
  await fs.rename(`${f.path}.part`, f.path);
  return { path: f.path, bytes: f.bytes };
}

export async function closeAllExports(): Promise<void> {
  await Promise.all([...open.keys()].map((id) => exportClose(id, false)));
}
