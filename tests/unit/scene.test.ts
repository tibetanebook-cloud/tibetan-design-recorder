import { describe, expect, it } from "vitest";
import { createDemoProject } from "@shared/project/demo";
import { buildScene, contentFrame, fadeAt, sourceTime } from "@shared/scene/buildScene";
import type { Clip } from "@shared/project/schema";

const clip = (over: Partial<Clip> = {}): Clip => ({
  id: "c",
  trackId: "t",
  content: { type: "media" },
  startMs: 1000,
  durationMs: 4000,
  sourceInMs: 500,
  speed: 2,
  opacity: 1,
  volume: 1,
  fadeInMs: 1000,
  fadeOutMs: 1000,
  muted: false,
  hidden: false,
  locked: false,
  ...over,
});

describe("buildScene (shared by preview and export)", () => {
  it("is deterministic: same project and time give the same scene", () => {
    const p = createDemoProject();
    expect(buildScene(p, 1234)).toEqual(buildScene(p, 1234));
  });

  it("draws the top lane on top and skips hidden tracks", () => {
    const p = createDemoProject();
    const layers = buildScene(p, 2000).layers;
    expect(layers.at(-1)?.trackId).toBe(p.tracks[0]!.id);
    const hidden = { ...p, tracks: p.tracks.map((t, i) => (i === 0 ? { ...t, hidden: true } : t)) };
    expect(buildScene(hidden, 2000).layers.some((l) => l.trackId === p.tracks[0]!.id)).toBe(false);
  });

  it("places the screen inside the padded frame", () => {
    const p = createDemoProject();
    const screenLayer = buildScene(p, 0).layers.find((l) => l.content.type === "solid")!;
    expect(screenLayer.frame).toEqual(contentFrame(p));
    expect(contentFrame(p).x).toBe(Math.round(1080 * 0.06));
  });

  it("maps timeline time to source time with in-point and speed", () => {
    expect(sourceTime(clip(), 1000)).toBe(500);
    expect(sourceTime(clip(), 2000)).toBe(2500);
  });

  it("fades in and out", () => {
    expect(fadeAt(clip(), 1000)).toBe(0);
    expect(fadeAt(clip(), 1500)).toBeCloseTo(0.5);
    expect(fadeAt(clip(), 3000)).toBe(1);
    expect(fadeAt(clip(), 4500)).toBeCloseTo(0.5);
  });

  it("shows nothing outside a clip's time range", () => {
    const p = createDemoProject();
    expect(buildScene(p, 60_000).layers).toHaveLength(0);
  });
});
