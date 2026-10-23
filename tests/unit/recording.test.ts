import { describe, expect, it } from "vitest";
import { RecordingClock } from "@shared/recording/clock";
import { cursorHeaderLine, cursorLine, parseCursorJsonl } from "@shared/recording/cursorFile";
import { takeToProject } from "@shared/recording/takeToProject";
import { DEFAULT_RECORDING_SETTINGS, type TakeManifest } from "@shared/recording/types";
import { encodeDuration, insertDurationPlaceholder, readDurationMs } from "@shared/recording/webm";
import { buildScene } from "@shared/scene/buildScene";

/** Minimal WebM start as MediaRecorder writes it: EBML header, Segment (unknown size), Info without Duration, Cluster. */
function fakeWebmHead(): Uint8Array {
  const ebml = [0x1a, 0x45, 0xdf, 0xa3, 0x84, 0x42, 0x86, 0x81, 0x01]; // EBMLVersion=1
  const segment = [0x18, 0x53, 0x80, 0x67, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff];
  const timecodeScale = [0x2a, 0xd7, 0xb1, 0x83, 0x0f, 0x42, 0x40]; // 1 000 000
  const muxingApp = [0x4d, 0x80, 0x84, 0x43, 0x68, 0x72, 0x6f]; // "Chro"
  const infoBody = [...timecodeScale, ...muxingApp];
  const info = [0x15, 0x49, 0xa9, 0x66, 0x80 | infoBody.length, ...infoBody];
  const cluster = [0x1f, 0x43, 0xb6, 0x75, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xe7, 0x81, 0x00];
  return new Uint8Array([...ebml, ...segment, ...info, ...cluster]);
}

describe("WebM duration patch (makes recordings seekable with a known length)", () => {
  it("inserts a Duration element and keeps the rest of the file intact", () => {
    const head = fakeWebmHead();
    const patch = insertDurationPlaceholder(head)!;
    expect(patch).not.toBeNull();
    expect(patch.data.length).toBe(head.length + 11);
    expect(patch.timecodeScale).toBe(1_000_000);
    // The cluster after Info is unchanged, just shifted.
    expect(Array.from(patch.data.slice(-15))).toEqual(Array.from(head.slice(-15)));
  });

  it("writes the duration in place and reads it back", () => {
    const patch = insertDurationPlaceholder(fakeWebmHead())!;
    patch.data.set(encodeDuration(5012.5, patch.timecodeScale), patch.durationOffset);
    expect(readDurationMs(patch.data)).toBeCloseTo(5012.5);
  });

  it("ignores data that is not the start of a WebM file", () => {
    expect(insertDurationPlaceholder(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toBeNull();
  });
});

describe("take clock", () => {
  it("does not advance while paused, and records the pause", () => {
    const clock = new RecordingClock();
    clock.start(1000);
    expect(clock.toRecording(3000)).toBe(2000);
    clock.pause(3000);
    expect(clock.toRecording(4500)).toBe(2000); // frozen during the pause
    clock.resume(4000);
    expect(clock.toRecording(5000)).toBe(3000); // 1 s pause removed
    expect(clock.pauses).toEqual([{ atMs: 2000, wallMs: 1000 }]);
  });
});

describe("cursor metadata track", () => {
  it("parses samples and events, ignoring a torn last line", () => {
    const text = [
      cursorHeaderLine({ format: "tdrec-cursor", version: 1, space: { width: 1920, height: 1080, displayBounds: { x: 0, y: 0, width: 1920, height: 1080 } }, sampleHz: 60 }),
      cursorLine([0, 0.5, 0.5]),
      cursorLine({ t: 10, type: "down", button: 1, clicks: 1, x: 0.5, y: 0.5 }),
      cursorLine({ t: 12, type: "key", key: "S", mods: ["Ctrl"] }),
      '[16.7, 0.51',
    ].join("\n");
    const track = parseCursorJsonl(text);
    expect(track.samples).toEqual([[0, 0.5, 0.5]]);
    expect(track.events.map((e) => e.type)).toEqual(["down", "key"]);
  });
});

const take = (over: Partial<TakeManifest> = {}): TakeManifest => ({
  format: "tdrec-take",
  version: 1,
  id: "take-1",
  createdAt: "2026-10-21T12:00:00.000Z",
  durationMs: 5000,
  settings: { ...DEFAULT_RECORDING_SETTINGS, screen: { kind: "display", sourceId: "screen:0", displayId: "1", fps: 30 } },
  display: { id: "1", bounds: { x: 0, y: 0, width: 1920, height: 1080 }, scaleFactor: 1 },
  tracks: [
    { kind: "screen", file: "screen.webm", mimeType: "video/webm", startOffsetMs: 11, durationMs: 4989, width: 1920, height: 1080, backend: "chromium" },
    { kind: "webcam", file: "webcam.webm", mimeType: "video/webm", startOffsetMs: 12, durationMs: 4988, width: 1280, height: 720, backend: "chromium" },
    { kind: "mic", file: "mic.webm", mimeType: "audio/webm", startOffsetMs: 10, durationMs: 4990, backend: "chromium" },
    { kind: "system", file: "system.webm", mimeType: "audio/webm", startOffsetMs: 10, durationMs: 4990, backend: "chromium" },
  ],
  cursorFile: "cursor.jsonl",
  pauses: [{ atMs: 3000, wallMs: 1000 }],
  markers: [4200],
  ...over,
});

describe("take -> editor project", () => {
  it("puts every input on its own lane at its start offset, unlinked", () => {
    const p = takeToProject(take(), "C:/Videos/take-1");
    for (const kind of ["screen", "webcam", "mic", "system"] as const) {
      const lane = p.tracks.find((t) => t.kind === kind)!;
      const clips = p.clips.filter((c) => c.trackId === lane.id);
      expect(clips, kind).toHaveLength(1);
      // Inputs are independent; only the screen is linked, to its own cursor lane.
      if (kind !== "screen") expect(clips[0]!.linkGroup, kind).toBeUndefined();
    }
    const screenClip = p.clips.find((c) => c.trackId === p.tracks.find((t) => t.kind === "screen")!.id)!;
    const cursorClip = p.clips.find((c) => c.trackId === p.tracks.find((t) => t.kind === "cursor")!.id)!;
    expect(screenClip.startMs).toBe(11);
    expect(cursorClip.linkGroup).toBe(screenClip.linkGroup);
    expect(p.tracks.map((t) => t.kind)).toEqual(["webcam", "screen", "cursor", "mic", "system"]);
    expect(p.media.map((m) => m.path)).toContain("C:/Videos/take-1/mic.webm");
    expect(p.media.find((m) => m.kind === "cursor")?.path).toBe("C:/Videos/take-1/cursor.jsonl");
  });

  it("turns pauses and hotkey markers into timeline markers", () => {
    const p = takeToProject(take(), "/v/take-1");
    expect(p.markers.map((m) => [m.timeMs, m.kind])).toEqual([
      [3000, "pause"],
      [4200, "marker"],
    ]);
  });

  it("records a region as a crop on the full-display screen clip", () => {
    const t = take({
      settings: { ...DEFAULT_RECORDING_SETTINGS, screen: { kind: "region", sourceId: "screen:0", displayId: "1", fps: 30, region: { x: 480, y: 270, width: 960, height: 540 } } },
    });
    const p = takeToProject(t, "/v/t");
    const crop = p.clips.find((c) => c.crop)!.crop!;
    expect(crop.left).toBeCloseTo(0.25);
    expect(crop.right).toBeCloseTo(0.25);
    expect(crop.top).toBeCloseTo(0.25);
    expect(crop.bottom).toBeCloseTo(0.25);
  });

  it("draws the webcam as a bubble above the screen", () => {
    const p = takeToProject(take(), "/v/t");
    const layers = buildScene(p, 1000).layers;
    const cam = layers.find((l) => l.trackId === p.tracks.find((t) => t.kind === "webcam")!.id)!;
    const screen = layers.find((l) => l.trackId === p.tracks.find((t) => t.kind === "screen")!.id)!;
    expect(layers.indexOf(cam)).toBeGreaterThan(layers.indexOf(screen));
    expect(cam.fit).toBe("cover");
    expect(cam.cornerRadius).toBe(cam.frame.width / 2);
  });
});

describe("recording warnings for the UI", () => {
  it("splits the input, a plain reason and the technical detail", async () => {
    const { describeWarning } = await import("@shared/recording/warnings");
    expect(describeWarning("webcam: NotAllowedError: Permission denied by system")).toEqual({ input: "webcam", reason: "denied", detail: "NotAllowedError: Permission denied by system" });
    expect(describeWarning("mic: no data recorded (track live)").reason).toBe("noData");
    expect(describeWarning("system: no system audio track was provided")).toMatchObject({ input: "system", reason: "noSystemAudio" });
    expect(describeWarning("NotReadableError: Could not start video source")).toMatchObject({ input: undefined, reason: "inUse" });
    expect(describeWarning("something odd").reason).toBe("failed");
  });
});
