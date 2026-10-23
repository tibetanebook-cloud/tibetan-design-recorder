import type { CursorTrack, InputEvent } from "./types";

export type CursorHeader = Omit<CursorTrack, "samples" | "events">;

export const cursorHeaderLine = (header: CursorHeader): string => JSON.stringify(header);
export const cursorLine = (item: [number, number, number] | InputEvent): string => JSON.stringify(item);

/** Parse cursor.jsonl; a torn last line (crash mid-write) is ignored. */
export function parseCursorJsonl(text: string): CursorTrack {
  const lines = text.split("\n").filter((l) => l.trim());
  if (!lines.length) throw new Error("Empty cursor file");
  const header = JSON.parse(lines[0]!) as CursorHeader;
  if (header.format !== "tdrec-cursor") throw new Error("Not a cursor track");
  const track: CursorTrack = { ...header, samples: [], events: [] };
  for (const line of lines.slice(1)) {
    let item: unknown;
    try {
      item = JSON.parse(line);
    } catch {
      continue;
    }
    if (Array.isArray(item)) track.samples.push(item as [number, number, number]);
    else if (item && typeof item === "object") track.events.push(item as InputEvent);
  }
  return track;
}
