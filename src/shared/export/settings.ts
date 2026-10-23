/**
 * Export settings and presets (pure; unit-tested). Video is encoded with the
 * WebCodecs encoders built into Electron (hardware first), muxed with small
 * MIT libraries; GIF with gifenc (MIT); MP3 with lamejs (LGPL-3.0, unmodified).
 */
import { z } from "zod";

export const VIDEO_FORMATS = ["mp4", "webm", "gif"] as const;
export const AUDIO_FORMATS = ["mp3", "wav", "m4a"] as const;
export const EXPORT_FORMATS = [...VIDEO_FORMATS, ...AUDIO_FORMATS] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export const QUALITY_SCALE = { medium: 0.6, good: 0.75, high: 0.9, source: 1 } as const;
export type QualityPreset = keyof typeof QUALITY_SCALE;

export const ExportSettings = z.object({
  format: z.enum(EXPORT_FORMATS).default("mp4"),
  /** mp4: h264 | hevc | av1; webm: vp9 | av1. */
  codec: z.enum(["h264", "hevc", "av1", "vp9"]).default("h264"),
  quality: z.enum(["medium", "good", "high", "source"]).default("source"),
  fps: z.number().int().min(10).max(60).default(30),
  mode: z.enum(["fast", "balanced", "quality"]).default("balanced"),
  /** Mbps; 0 = automatic from the resolution and frame rate. */
  bitrateMbps: z.number().min(0).max(200).default(0),
  hardware: z.enum(["auto", "hardware", "software"]).default("auto"),
  /** Whole timeline or the In/Out range. */
  range: z.enum(["all", "inout"]).default("all"),
  /** Draw caption lanes into the picture. */
  burnCaptions: z.boolean().default(true),
  /** Also write the captions next to the video as .srt. */
  sidecarSrt: z.boolean().default(false),
  audioKbps: z.number().int().min(64).max(320).default(192),
  gif: z
    .object({
      size: z.enum(["720p", "1080p", "original"]).default("720p"),
      fps: z.number().int().min(5).max(30).default(15),
      loop: z.boolean().default(true),
    })
    .default({ size: "720p", fps: 15, loop: true }),
});
export type ExportSettings = z.infer<typeof ExportSettings>;

export const DEFAULT_EXPORT: ExportSettings = ExportSettings.parse({});

export const isAudioFormat = (f: ExportFormat): f is (typeof AUDIO_FORMATS)[number] => (AUDIO_FORMATS as readonly string[]).includes(f);

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

/** Output picture size for the settings (even numbers, as encoders need). */
export function outputSize(canvas: { width: number; height: number }, s: ExportSettings): { width: number; height: number } {
  if (s.format === "gif") {
    const cap = s.gif.size === "720p" ? 720 : s.gif.size === "1080p" ? 1080 : Infinity;
    const k = Math.min(1, cap / Math.min(canvas.width, canvas.height));
    return { width: even(canvas.width * k), height: even(canvas.height * k) };
  }
  const k = QUALITY_SCALE[s.quality];
  return { width: even(canvas.width * k), height: even(canvas.height * k) };
}

/**
 * Automatic video bitrate (bits/s): anchors by pixel count (720p 5/8, 1080p
 * 8/12, 4K 35/45 Mbps for normal/source presets), linearly interpolated,
 * × sqrt(fps/30) × mode (fast .5, balanced .8, quality 1), floor 2 Mbps.
 */
export function autoBitrate(width: number, height: number, fps: number, quality: QualityPreset, mode: ExportSettings["mode"]): number {
  const px = width * height;
  const source = quality === "source";
  const anchors: [number, number][] = source
    ? [[921_600, 8], [2_073_600, 12], [8_294_400, 45]]
    : [[921_600, 5], [2_073_600, 8], [8_294_400, 35]];
  let mbps: number;
  if (px <= anchors[0]![0]) mbps = anchors[0]![1] * (px / anchors[0]![0]) ** 0.5;
  else if (px >= anchors[2]![0]) mbps = anchors[2]![1];
  else {
    const [a, b] = px <= anchors[1]![0] ? [anchors[0]!, anchors[1]!] : [anchors[1]!, anchors[2]!];
    mbps = a[1] + ((px - a[0]) / (b[0] - a[0])) * (b[1] - a[1]);
  }
  const modeK = mode === "fast" ? 0.5 : mode === "balanced" ? 0.8 : 1;
  return Math.max(2_000_000, Math.round(mbps * Math.sqrt(fps / 30) * modeK * 1_000_000));
}

export function videoBitrate(s: ExportSettings, width: number, height: number): number {
  return s.bitrateMbps > 0 ? Math.round(s.bitrateMbps * 1_000_000) : autoBitrate(width, height, s.fps, s.quality, s.mode);
}

/** Codec strings to try, best first (WebCodecs). */
export function codecCandidates(codec: ExportSettings["codec"], width: number, height: number): string[] {
  const px = width * height;
  switch (codec) {
    case "h264": {
      // Level by frame size: 4.0 up to 1080p, 5.1 up to 4K, 5.2 above.
      const levels = px <= 2_228_224 ? ["28", "2a", "33"] : px <= 8_912_896 ? ["33", "34"] : ["34"];
      return [...levels.map((l) => `avc1.6400${l}`), ...levels.map((l) => `avc1.4d00${l}`), ...levels.map((l) => `avc1.4200${l}`)];
    }
    case "hevc":
      return ["hvc1.1.6.L123.B0", "hvc1.1.6.L150.B0", "hvc1.1.6.L153.B0"];
    case "av1":
      return ["av01.0.08M.08", "av01.0.12M.08", "av01.0.16M.08"];
    case "vp9":
      return ["vp09.00.40.08", "vp09.00.50.08", "vp09.00.51.08"];
  }
}

/** Container and codec rules: which video codecs each format can carry. */
export function codecsFor(format: ExportFormat): ExportSettings["codec"][] {
  return format === "mp4" ? ["h264", "hevc", "av1"] : format === "webm" ? ["vp9", "av1"] : [];
}

/** Rough file-size estimate in bytes (for the dialog). */
export function estimateBytes(s: ExportSettings, canvas: { width: number; height: number }, durationMs: number): number {
  const sec = durationMs / 1000;
  const audio = (s.format === "wav" ? 48000 * 2 * 16 : s.audioKbps * 1000) * sec / 8;
  if (isAudioFormat(s.format)) return audio;
  const { width, height } = outputSize(canvas, s);
  if (s.format === "gif") return width * height * s.gif.fps * sec * 0.08;
  return (videoBitrate(s, width, height) * sec) / 8 + audio;
}

export const FILE_EXTENSION: Record<ExportFormat, string> = { mp4: "mp4", webm: "webm", gif: "gif", mp3: "mp3", wav: "wav", m4a: "m4a" };
