/**
 * tdr-media://file/<encoded absolute path> serves local media to the renderer with
 * HTTP Range support, so <video> can seek inside multi-GB recordings without the
 * renderer getting general file-system access.
 */
import { protocol } from "electron";
import { createReadStream, promises as fs } from "node:fs";
import { extname } from "node:path";
import { Readable } from "node:stream";
import { READABLE_EXTENSIONS } from "./security";

export const MEDIA_SCHEME = "tdr-media";
/** Lets WebGL read video pixels served from this scheme (our own pages only load it). */
const CORS = { "Access-Control-Allow-Origin": "*" };

const MIME: Record<string, string> = {
  ".webm": "video/webm",
  ".mp4": "video/mp4",
  ".m4a": "audio/mp4",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".jsonl": "application/x-ndjson",
  ".mov": "video/quicktime",
  ".mkv": "video/x-matroska",
  ".m4v": "video/mp4",
  ".aac": "audio/aac",
  ".ogg": "audio/ogg",
  ".opus": "audio/ogg",
  ".flac": "audio/flac",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".srt": "text/plain; charset=utf-8",
  ".vtt": "text/vtt; charset=utf-8",
};

/** Must run before app ready. */
export function registerMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: MEDIA_SCHEME, privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, corsEnabled: true } },
  ]);
}

export function handleMediaProtocol(): void {
  protocol.handle(MEDIA_SCHEME, async (request) => {
    const url = new URL(request.url);
    const path = decodeURIComponent(url.pathname.replace(/^\//, ""));
    // Media and caption files only: the page can't use this to read other files.
    if (!READABLE_EXTENSIONS.has(extname(path).toLowerCase()) || path.includes("\0")) return new Response("Forbidden", { status: 403 });
    let size: number;
    try {
      const stat = await fs.stat(path);
      if (!stat.isFile()) return new Response("Not found", { status: 404 });
      size = stat.size;
    } catch {
      return new Response("Not found", { status: 404 });
    }
    const type = MIME[extname(path).toLowerCase()] ?? "application/octet-stream";
    const range = request.headers.get("range");
    const match = range && /bytes=(\d*)-(\d*)/.exec(range);
    if (match) {
      const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
      const end = match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
      if (start >= size || start > end) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
      const body = Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream;
      return new Response(body, {
        status: 206,
        headers: { ...CORS, "Content-Type": type, "Content-Length": String(end - start + 1), "Content-Range": `bytes ${start}-${end}/${size}`, "Accept-Ranges": "bytes" },
      });
    }
    const body = Readable.toWeb(createReadStream(path)) as ReadableStream;
    return new Response(body, { headers: { ...CORS, "Content-Type": type, "Content-Length": String(size), "Accept-Ranges": "bytes" } });
  });
}
