/**
 * Captions: SRT / WebVTT import and export, and turning a timed transcript
 * (words or segments) into readable cues. Tibetan text is split only at
 * tsheg/shad/space (never inside a syllable), and its text is never altered.
 */
import { breakSegments } from "../text/lineBreak";

export interface Cue {
  startMs: number;
  endMs: number;
  text: string;
}

export interface TimedWord {
  startMs: number;
  endMs: number;
  text: string;
}

const pad = (n: number, w = 2) => String(Math.floor(n)).padStart(w, "0");

export function formatTimestamp(ms: number, sep: "," | "."): string {
  const t = Math.max(0, Math.round(ms));
  const h = Math.floor(t / 3_600_000), m = Math.floor((t % 3_600_000) / 60_000), s = Math.floor((t % 60_000) / 1000);
  return `${pad(h)}:${pad(m)}:${pad(s)}${sep}${pad(t % 1000, 3)}`;
}

export function parseTimestamp(s: string): number {
  const m = /(?:(\d+):)?(\d{1,2}):(\d{2})[,.](\d{1,3})/.exec(s.trim());
  if (!m) return NaN;
  const [, h = "0", mm, ss, ms] = m;
  return Number(h) * 3_600_000 + Number(mm) * 60_000 + Number(ss) * 1000 + Number(ms!.padEnd(3, "0"));
}

export function toSrt(cues: Cue[]): string {
  return cues.map((c, i) => `${i + 1}\n${formatTimestamp(c.startMs, ",")} --> ${formatTimestamp(c.endMs, ",")}\n${c.text}\n`).join("\n");
}

export function toVtt(cues: Cue[]): string {
  return "WEBVTT\n\n" + cues.map((c) => `${formatTimestamp(c.startMs, ".")} --> ${formatTimestamp(c.endMs, ".")}\n${c.text}\n`).join("\n");
}

/** Parse SRT or WebVTT (auto-detected). Cue text is kept exactly (no trimming inside lines). */
export function parseSubtitles(input: string): Cue[] {
  const text = input.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const blocks = text.split(/\n{2,}/);
  const cues: Cue[] = [];
  for (const block of blocks) {
    const lines = block.split("\n").filter((l) => l.length > 0);
    const timeIdx = lines.findIndex((l) => l.includes("-->"));
    if (timeIdx < 0) continue;
    const [a, b] = lines[timeIdx]!.split("-->");
    const startMs = parseTimestamp(a ?? "");
    const endMs = parseTimestamp((b ?? "").trim().split(/\s+/)[0] ?? "");
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) continue;
    const body = lines.slice(timeIdx + 1).join("\n");
    if (body) cues.push({ startMs, endMs, text: body });
  }
  return cues.sort((x, y) => x.startMs - y.startMs);
}

/**
 * Group timed words into cues of at most `maxChars` per line and `rows` lines,
 * breaking at sentence ends and pauses. Words carry their own leading spaces for
 * Latin text; Tibetan "words" are syllables ending in tsheg/shad.
 */
export function wordsToCues(words: TimedWord[], maxChars = 42, rows = 2, maxPauseMs = 700): Cue[] {
  const cues: Cue[] = [];
  let lines: string[] = [""];
  let start = -1;
  let end = 0;
  const flush = () => {
    const text = lines.map((l) => l.trim()).filter(Boolean).join("\n");
    if (text) cues.push({ startMs: start, endMs: end, text });
    lines = [""];
    start = -1;
  };
  for (const w of words) {
    const piece = w.text;
    if (start >= 0 && w.startMs - end > maxPauseMs) flush();
    if (start < 0) start = w.startMs;
    const current = lines[lines.length - 1]!;
    if ((current + piece).trim().length > maxChars && current.trim()) {
      if (lines.length >= rows) {
        flush();
        start = w.startMs;
      } else lines.push("");
    }
    lines[lines.length - 1] += piece;
    end = w.endMs;
    if (/[.!?།༎]\s*$/.test(piece) && lines.join("").trim().length > maxChars * 0.5) flush();
  }
  if (start >= 0) flush();
  return cues;
}

/** Split segment-level transcripts (no word timings) into words with interpolated times. */
export function segmentsToWords(segments: Cue[]): TimedWord[] {
  const words: TimedWord[] = [];
  for (const seg of segments) {
    const units = /[ༀ-࿿]/.test(seg.text) ? breakSegments(seg.text) : seg.text.split(/(?=\s)/);
    const total = units.reduce((n, u) => n + u.length, 0) || 1;
    let t = seg.startMs;
    for (const u of units) {
      const d = ((seg.endMs - seg.startMs) * u.length) / total;
      words.push({ startMs: t, endMs: t + d, text: u });
      t += d;
    }
  }
  return words;
}
