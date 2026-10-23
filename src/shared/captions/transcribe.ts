/**
 * Speech-to-text providers and their result format.
 *
 * "cloud": any OpenAI-compatible /audio/transcriptions endpoint (OpenAI, Groq,
 * a local whisper server, ...). The key is stored encrypted by the OS
 * (Electron safeStorage) in the main process and never reaches the page.
 * A fully offline engine plugs in behind the same interface.
 */
import type { Cue, TimedWord } from "./captions";

export interface TranscribeConfig {
  provider: "cloud";
  /** e.g. https://api.openai.com/v1 */
  baseUrl: string;
  model: string;
  hasKey: boolean;
}

export interface TranscribeRequest {
  path: string;
  /** ISO-639-1 hint ("en", "zh", "bo"…); empty = auto-detect. */
  language: string;
}

export interface TranscribeResult {
  ok: boolean;
  error?: string;
  language?: string;
  words: TimedWord[];
  segments: Cue[];
}

export const DEFAULT_TRANSCRIBE: TranscribeConfig = { provider: "cloud", baseUrl: "https://api.openai.com/v1", model: "whisper-1", hasKey: false };

/** Most hosted endpoints reject uploads above this size. */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

interface VerboseJson {
  language?: string;
  text?: string;
  duration?: number;
  words?: { word: string; start: number; end: number }[];
  segments?: { text: string; start: number; end: number }[];
}

/** Parse an OpenAI-style verbose_json transcription (seconds -> ms). */
export function parseVerboseJson(raw: unknown): Omit<TranscribeResult, "ok"> {
  const v = (raw ?? {}) as VerboseJson;
  const ms = (s: number) => Math.round(s * 1000);
  const segments: Cue[] = (v.segments ?? []).map((s) => ({ startMs: ms(s.start), endMs: ms(s.end), text: s.text.trim() })).filter((c) => c.text && c.endMs > c.startMs);
  // Word timings come without spaces; re-attach the leading space Latin text needs.
  const words: TimedWord[] = (v.words ?? []).map((w, i) => {
    const t = w.word;
    const needsSpace = i > 0 && !/^\s/.test(t) && !/^[,.!?;:)\]}%»”’]/.test(t) && !/[ༀ-࿿　-鿿]/.test(t);
    return { startMs: ms(w.start), endMs: ms(w.end), text: needsSpace ? ` ${t}` : t };
  });
  if (!segments.length && v.text && v.duration) segments.push({ startMs: 0, endMs: ms(v.duration), text: v.text.trim() });
  return { language: v.language, words, segments };
}
