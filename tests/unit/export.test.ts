import { describe, expect, it } from "vitest";
import { createProject } from "@shared/project/factory";
import type { Clip, Project } from "@shared/project/schema";
import { autoBitrate, codecCandidates, codecsFor, DEFAULT_EXPORT, estimateBytes, ExportSettings, outputSize } from "@shared/export/settings";
import { audioPlan, exportableLanes, exportRange, fadeEnvelope, frameTimes, soloLane } from "@shared/export/plan";
import { timeStretch } from "@shared/audio/stretch";
import { encodeWav } from "@shared/audio/wav";

function clip(id: string, trackId: string, startMs: number, durationMs: number, extra: Partial<Clip> = {}): Clip {
  return { id, trackId, content: { type: "media" }, startMs, durationMs, sourceInMs: 0, speed: 1, opacity: 1, volume: 1, fadeInMs: 0, fadeOutMs: 0, muted: false, hidden: false, locked: false, ...extra };
}
const lane = (p: Project, kind: string) => p.tracks.find((t) => t.kind === kind)!.id;

function fixture(): Project {
  const p = createProject("t");
  p.media.push(
    { id: "s", kind: "video", origin: "screen", path: "/s.webm", durationMs: 20000, clockOffsetMs: 0, width: 1920, height: 1080 },
    { id: "m", kind: "audio", origin: "mic", path: "/m.webm", durationMs: 20000, clockOffsetMs: 0 },
    { id: "c", kind: "cursor", origin: "screen", path: "/c.jsonl", durationMs: 30000, clockOffsetMs: 0 },
  );
  p.tracks.push({ id: "cur", kind: "cursor", name: "", locked: false, muted: false, solo: false, hidden: false, volume: 1, pan: 0, opacity: 1 });
  p.clips.push(clip("v", lane(p, "screen"), 0, 10000, { mediaId: "s" }), clip("a", lane(p, "mic"), 1000, 8000, { mediaId: "m", sourceInMs: 500, volume: 0.5, fadeInMs: 400, fadeOutMs: 600 }), clip("k", "cur", 0, 30000, { mediaId: "c" }));
  return p;
}

describe("export settings", () => {
  it("output sizes are even and follow the quality scale; GIF is capped", () => {
    const canvas = { width: 1920, height: 1080 };
    expect(outputSize(canvas, DEFAULT_EXPORT)).toEqual({ width: 1920, height: 1080 });
    expect(outputSize(canvas, { ...DEFAULT_EXPORT, quality: "good" })).toEqual({ width: 1440, height: 810 });
    const odd = outputSize({ width: 1366, height: 768 }, { ...DEFAULT_EXPORT, quality: "medium" });
    expect(odd.width % 2 + odd.height % 2).toBe(0);
    expect(outputSize(canvas, { ...DEFAULT_EXPORT, format: "gif" })).toEqual({ width: 1280, height: 720 });
    expect(outputSize({ width: 1080, height: 1920 }, { ...DEFAULT_EXPORT, format: "gif" }).width).toBe(720);
  });

  it("automatic bitrate follows the anchors, frame rate and mode", () => {
    expect(autoBitrate(1920, 1080, 30, "source", "quality")).toBe(12_000_000);
    expect(autoBitrate(1920, 1080, 30, "high", "quality")).toBe(8_000_000);
    expect(autoBitrate(3840, 2160, 30, "source", "quality")).toBe(45_000_000);
    expect(autoBitrate(1920, 1080, 60, "source", "quality")).toBe(Math.round(12e6 * Math.SQRT2));
    expect(autoBitrate(1920, 1080, 30, "source", "balanced")).toBe(9_600_000);
    expect(autoBitrate(320, 240, 30, "medium", "fast")).toBe(2_000_000);
    const mid = autoBitrate(1600, 900, 30, "source", "quality");
    expect(mid).toBeGreaterThan(8e6);
    expect(mid).toBeLessThan(12e6);
  });

  it("codec rules per container and H.264 levels by size", () => {
    expect(codecsFor("mp4")).toEqual(["h264", "hevc", "av1"]);
    expect(codecsFor("webm")).toEqual(["vp9", "av1"]);
    expect(codecCandidates("h264", 1920, 1080)[0]).toBe("avc1.640028");
    expect(codecCandidates("h264", 3840, 2160)[0]).toBe("avc1.640033");
  });

  it("settings validate and size estimates are sensible", () => {
    expect(() => ExportSettings.parse({ format: "mov" })).toThrow();
    const mp4 = estimateBytes(DEFAULT_EXPORT, { width: 1920, height: 1080 }, 60_000);
    expect(mp4 / 1e6).toBeGreaterThan(60);
    expect(mp4 / 1e6).toBeLessThan(110);
    expect(estimateBytes({ ...DEFAULT_EXPORT, format: "wav" }, { width: 1920, height: 1080 }, 60_000)).toBe(48000 * 2 * 2 * 60);
  });
});

describe("export plan", () => {
  it("the range ignores the cursor track; In/Out narrows it", () => {
    const p = fixture();
    expect(exportRange(p, { range: "all" }, null, null)).toEqual({ startMs: 0, endMs: 10000 });
    expect(exportRange(p, { range: "inout" }, 2000, 5000)).toEqual({ startMs: 2000, endMs: 5000 });
    expect(exportRange(p, { range: "inout" }, null, null)).toEqual({ startMs: 0, endMs: 10000 });
  });

  it("frame times step at the frame rate", () => {
    const f = frameTimes({ startMs: 1000, endMs: 2000 }, 30);
    expect(f).toHaveLength(30);
    expect(f[1]! - f[0]!).toBeCloseTo(1000 / 30, 6);
    expect(f[0]).toBe(1000);
  });

  it("audio plan cuts clips to the range and keeps source positions, volume and fades", () => {
    const p = fixture();
    const [full] = audioPlan(p, { startMs: 0, endMs: 10000 });
    expect(full).toMatchObject({ atMs: 1000, sourceMs: 500, durationMs: 8000, gain: 0.5, fadeInMs: 400, fadeOutMs: 600 });
    const [cut] = audioPlan(p, { startMs: 3000, endMs: 6000 });
    expect(cut).toMatchObject({ atMs: 0, sourceMs: 2500, durationMs: 3000, fadeInMs: 0, fadeOutMs: 0 });
  });

  it("speed changes the source length, mute and solo remove pieces", () => {
    const p = fixture();
    p.clips = p.clips.map((c) => (c.id === "a" ? { ...c, speed: 2, durationMs: 4000 } : c));
    expect(audioPlan(p, { startMs: 0, endMs: 10000 })[0]).toMatchObject({ durationMs: 4000, sourceLenMs: 8000, speed: 2 });
    p.tracks = p.tracks.map((t) => (t.kind === "mic" ? { ...t, muted: true } : t));
    expect(audioPlan(p, { startMs: 0, endMs: 10000 })).toHaveLength(0);
  });

  it("fade envelope ramps in and out", () => {
    expect(fadeEnvelope({ durationMs: 2000, fadeInMs: 500, fadeOutMs: 500, gain: 0.8 })).toEqual([[0, 0], [0.5, 0.8], [1.5, 0.8], [2, 0]]);
    expect(fadeEnvelope({ durationMs: 1000, fadeInMs: 0, fadeOutMs: 0, gain: 1 })).toEqual([[0, 1], [1, 1]]);
  });

  it("per-track export: each lane with content, solo hides and mutes the rest", () => {
    const p = fixture();
    expect(exportableLanes(p).map((l) => l.kind)).toEqual(["screen", "mic"]);
    const solo = soloLane(p, lane(p, "mic"));
    expect(solo.tracks.filter((t) => !t.muted).map((t) => t.kind)).toEqual(["mic", "cursor"]);
    expect(audioPlan(solo, { startMs: 0, endMs: 10000 })).toHaveLength(1);
  });
});

describe("audio helpers", () => {
  const sr = 48000;
  const sine = (hz: number, sec: number) => Float32Array.from({ length: sr * sec }, (_, i) => Math.sin((2 * Math.PI * hz * i) / sr));
  const zeroCrossHz = (x: Float32Array) => {
    let n = 0;
    for (let i = 1; i < x.length; i++) if (x[i - 1]! < 0 && x[i]! >= 0) n++;
    return n / (x.length / sr);
  };

  it("time-stretch changes length but keeps the pitch", () => {
    const x = sine(440, 2);
    for (const speed of [0.5, 1.5, 2]) {
      const y = timeStretch(x, speed);
      expect(y.length).toBe(Math.floor(x.length / speed));
      expect(zeroCrossHz(y.subarray(2048, y.length - 2048))).toBeGreaterThan(425);
      expect(zeroCrossHz(y.subarray(2048, y.length - 2048))).toBeLessThan(455);
    }
  });

  it("WAV writer: header, size and clipping", () => {
    const w = encodeWav([Float32Array.from([0, 1, -1, 2]), Float32Array.from([0, 0.5, -0.5, -2])], 48000);
    const v = new DataView(w.buffer);
    expect(String.fromCharCode(...w.subarray(0, 4))).toBe("RIFF");
    expect(v.getUint32(24, true)).toBe(48000);
    expect(v.getUint32(40, true)).toBe(4 * 2 * 2);
    expect(v.getInt16(44 + 2 * 2 * 3, true)).toBe(32767); // clipped
    expect(v.getInt16(44 + 2 * 2 * 3 + 2, true)).toBe(-32768);
  });
});
