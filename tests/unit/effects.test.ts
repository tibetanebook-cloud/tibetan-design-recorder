import { describe, expect, it } from "vitest";
import { createProject } from "@shared/project/factory";
import { CursorStyle, type Clip, type Project, type ZoomRegion } from "@shared/project/schema";
import type { CursorTrack } from "@shared/recording/types";
import { cubicBezier, EASING_CURVES } from "@shared/effects/easing";
import { springAt } from "@shared/effects/spring";
import { cursorStateAt, positionAt, toDisplaySpace } from "@shared/effects/cursor";
import { cameraAt, cameraTarget, clampCamera, depthScale, groupStrength, zoomGroups } from "@shared/effects/zoom";
import { classifyClick, suggestZooms } from "@shared/effects/suggest";
import { applySpeedRegion, addZoom, moveZoom, warpTime } from "@shared/timeline/regions";
import { bubbleFrame, buildScene } from "@shared/scene/buildScene";
import { placeMedia, sourceToStage, squirclePath } from "@shared/scene/placement";

const zoom = (startMs: number, endMs: number, over: Partial<ZoomRegion> = {}): ZoomRegion => ({ id: `z${startMs}`, startMs, endMs, depth: 2, focus: { x: 0.25, y: 0.25 }, mode: "manual", suggested: false, ...over });

const track = (samples: [number, number, number][], events: CursorTrack["events"] = []): CursorTrack => ({
  format: "tdrec-cursor",
  version: 1,
  space: { width: 1920, height: 1080, displayBounds: { x: 0, y: 0, width: 1920, height: 1080 }, coords: "display" },
  sampleHz: 60,
  samples,
  events,
});

describe("easing", () => {
  it("smooth curve: 0 -> 0, 1 -> 1, fast start", () => {
    const e = cubicBezier(EASING_CURVES.smooth);
    expect(e(0)).toBe(0);
    expect(e(1)).toBe(1);
    expect(e(0.25)).toBeGreaterThan(0.6); // expo-out character
  });
  it("linear is the identity", () => {
    const e = cubicBezier(EASING_CURVES.linear);
    for (const x of [0.1, 0.5, 0.9]) expect(e(x)).toBeCloseTo(x, 4);
  });
});

describe("springs (pure function of time)", () => {
  it("same input -> same output, and settles on the target", () => {
    const target = (t: number) => (t < 1000 ? 0 : 100);
    const p = { stiffness: 100, damping: 21, mass: 1 };
    expect(springAt(target, 1500, p)).toBe(springAt(target, 1500, p));
    expect(springAt(target, 3500, p)).toBeCloseTo(100, 0);
    expect(springAt(target, 1100, p)).toBeLessThan(100);
  });
});

describe("zoom envelope", () => {
  const s = createProject("t").zoom;
  const ease = cubicBezier(EASING_CURVES.smooth);

  it("ramps in to full strength 1 s after the start (+200 ms lag) and back out", () => {
    const g = [zoom(2000, 6000)];
    expect(groupStrength(g, 1000, s, ease)).toBe(0);
    expect(groupStrength(g, 3200, s, ease)).toBeCloseTo(1);
    expect(groupStrength(g, 5000, s, ease)).toBeCloseTo(1);
    expect(groupStrength(g, 6000 + 200 - 500 + 1000, s, ease)).toBe(0);
  });

  it("short regions form a triangle instead of jumping", () => {
    const g = [zoom(2000, 2400)];
    const peak = Math.max(...Array.from({ length: 60 }, (_, i) => groupStrength(g, 1500 + i * 50, s, ease)));
    expect(peak).toBeGreaterThan(0.2);
    expect(peak).toBeLessThanOrEqual(1);
  });

  it("regions closer than 1.35 s connect (no zoom-out between)", () => {
    expect(zoomGroups([zoom(1000, 3000), zoom(4000, 6000)], s)).toHaveLength(1);
    expect(zoomGroups([zoom(1000, 3000), zoom(5000, 7000)], s)).toHaveLength(2);
    expect(zoomGroups([zoom(1000, 3000), zoom(4000, 6000)], { ...s, connect: false })).toHaveLength(2);
  });

  it("depth maps to scale", () => {
    expect([1, 2, 3, 4, 5, 6].map(depthScale)).toEqual([1.25, 1.5, 1.8, 2.2, 3.5, 5]);
  });

  it("camera is clamped so the canvas always covers the stage", () => {
    const c = clampCamera({ scale: 2, cx: 0, cy: 0 }, 1920, 1080);
    expect(c.cx).toBe(480);
    expect(c.cy).toBe(270);
  });

  it("camera zooms towards the focus and returns to identity", () => {
    const p: Project = { ...createProject("t"), zooms: [zoom(1000, 5000, { depth: 3, focus: { x: 0.25, y: 0.25 } })] };
    const ctx = { stage: { width: 1920, height: 1080 }, toStage: (q: { x: number; y: number }) => ({ x: q.x * 1920, y: q.y * 1080 }), screenFraction: 1 };
    const mid = cameraTarget(p, 3500, ctx);
    expect(mid.scale).toBeCloseTo(1.8);
    expect(mid.cx).toBeLessThan(960);
    const after = cameraAt(p, 9000, ctx);
    expect(after.scale).toBeCloseTo(1, 2);
    // Deterministic: seeking gives the same frame as playing.
    expect(cameraAt(p, 2500, ctx)).toEqual(cameraAt(p, 2500, ctx));
  });
});

describe("cursor", () => {
  const t = track([
    [0, 0.1, 0.1],
    [1000, 0.5, 0.5],
    [2000, 0.5, 0.5],
  ], [{ t: 1500, type: "down", button: 1, clicks: 1, x: 0.5, y: 0.5 }]);
  const style = CursorStyle.parse({ smoothing: 0, clickEffect: "ripple" });

  it("interpolates between samples", () => {
    const p = positionAt(t, 500)!;
    expect(p.x).toBeCloseTo(0.3);
    expect(p.y).toBeCloseTo(0.3);
  });

  it("bounces after a click and shows a ripple that fades", () => {
    const s = cursorStateAt(t, 1600, style, { startMs: 0, endMs: 2000 }, { width: 1920 })!;
    expect(s.scale).toBeLessThan(1);
    expect(s.scale).toBeGreaterThanOrEqual(0.72);
    expect(s.clicks).toHaveLength(1);
    expect(cursorStateAt(t, 2400, style, { startMs: 0, endMs: 2000 }, { width: 1920 })!.clicks).toHaveLength(0);
  });

  it("smoothing lags behind fast moves but is deterministic", () => {
    const smooth = CursorStyle.parse({ smoothing: 1 });
    const a = cursorStateAt(t, 600, smooth, { startMs: 0, endMs: 2000 }, { width: 1920 })!;
    expect(a.pos.x).toBeLessThan(positionAt(t, 600)!.x);
    expect(cursorStateAt(t, 600, smooth, { startMs: 0, endMs: 2000 }, { width: 1920 })).toEqual(a);
  });

  it("old region-normalized tracks are converted to display space", () => {
    const old: CursorTrack = { ...t, space: { width: 960, height: 540, displayBounds: { x: 0, y: 0, width: 1920, height: 1080 }, region: { x: 960, y: 540, width: 960, height: 540 } } };
    expect(toDisplaySpace(old).samples[0]).toEqual([0, 0.55, 0.55]);
  });
});

describe("auto-zoom suggestions", () => {
  it("classifies a press-drag to the right as text selection", () => {
    const tr = track([[0, 0.2, 0.5], [500, 0.5, 0.5]], [
      { t: 0, type: "down", button: 1, clicks: 1, x: 0.2, y: 0.5 },
      { t: 400, type: "up", button: 1, clicks: 1, x: 0.5, y: 0.5 },
    ]);
    expect(classifyClick(tr, tr.events[0] as never)).toBe("text-selection");
  });

  it("clusters clicks within 2.5 s into one padded suggested region", () => {
    const tr = track([[0, 0.5, 0.5], [9000, 0.5, 0.5]], [
      { t: 2000, type: "down", button: 1, clicks: 1, x: 0.3, y: 0.3 },
      { t: 3500, type: "down", button: 1, clicks: 2, x: 0.31, y: 0.3 },
      { t: 8000, type: "down", button: 1, clicks: 1, x: 0.8, y: 0.8 },
    ]);
    const r = suggestZooms(tr, [], 10_000);
    expect(r.status).toBe("ok");
    expect(r.zooms.map((z) => [z.startMs, z.endMs, z.suggested, z.mode])).toEqual([
      [1500, 4000, true, "auto"],
      [7500, 8500, true, "auto"],
    ]);
  });

  it("skips spans that overlap an existing zoom", () => {
    const tr = track([[0, 0.5, 0.5]], [{ t: 2000, type: "down", button: 1, clicks: 1, x: 0.3, y: 0.3 }]);
    expect(suggestZooms(tr, [zoom(1000, 3000)], 10_000).status).toBe("no-free-slots");
    expect(suggestZooms(null, [], 10_000).status).toBe("no-telemetry");
  });
});

describe("zoom regions and speed regions", () => {
  const clip = (id: string, trackId: string, startMs: number, durationMs: number): Clip => ({ id, trackId, mediaId: "m", content: { type: "media" }, startMs, durationMs, sourceInMs: 0, speed: 1, opacity: 1, volume: 1, fadeInMs: 0, fadeOutMs: 0, muted: false, hidden: false, locked: false });

  it("zoom regions never overlap", () => {
    let p = addZoom(createProject("t"), 1000, 3000).project;
    p = addZoom(p, 2000, 5000).project; // starts inside the first: clipped to the gap after it
    expect(p.zooms.map((z) => [z.startMs, z.endMs])).toEqual([[1000, 3000], [3000, 5000]]);
    p = moveZoom(p, p.zooms[1]!.id, -2000);
    expect(p.zooms[1]!.startMs).toBe(3000);
  });

  it("warps time: 2x over 2–4 s removes 1 s", () => {
    expect(warpTime(1000, 2000, 4000, 2)).toBe(1000);
    expect(warpTime(3000, 2000, 4000, 2)).toBe(2500);
    expect(warpTime(6000, 2000, 4000, 2)).toBe(5000);
  });

  it("speed region keeps every lane in sync", () => {
    const base = createProject("t");
    const [cam, scr] = base.tracks;
    base.media.push({ id: "m", kind: "video", origin: "screen", path: "/x", durationMs: 10_000, clockOffsetMs: 0 });
    base.clips.push(clip("a", cam!.id, 0, 8000), clip("b", scr!.id, 0, 8000));
    const p = applySpeedRegion(base, 2000, 4000, 2);
    for (const laneId of [cam!.id, scr!.id]) {
      const parts = p.clips.filter((c) => c.trackId === laneId).sort((x, y) => x.startMs - y.startMs);
      expect(parts.map((c) => [c.startMs, c.durationMs, c.speed])).toEqual([
        [0, 2000, 1],
        [2000, 1000, 2],
        [3000, 4000, 1],
      ]);
    }
  });
});

describe("frame layout", () => {
  it("bubble anchors in the bottom-right and shrinks while zoomed", () => {
    const p = createProject("t");
    const f = bubbleFrame(p);
    expect(f.x + f.width).toBe(1920 - p.webcam.marginPx);
    expect(f.y + f.height).toBe(1080 - p.webcam.marginPx);
    expect(bubbleFrame(p, 2).width).toBeLessThan(f.width);
    expect(bubbleFrame({ ...p, webcam: { ...p.webcam, reactToZoom: false } }, 2).width).toBe(f.width);
  });

  it("contain placement maps source points onto the letterboxed picture", () => {
    const pl = placeMedia(1920, 1080, { x: 0, y: 0, width: 1000, height: 1000 }, undefined, "contain");
    expect(pl.dh).toBeCloseTo(562.5);
    const center = sourceToStage({ x: 0.5, y: 0.5 }, 1920, 1080, pl);
    expect(center.x).toBeCloseTo(500);
    expect(center.y).toBeCloseTo(500);
    const cropped = placeMedia(1920, 1080, { x: 0, y: 0, width: 1920, height: 1080 }, { left: 0.5, top: 0, right: 0, bottom: 0 }, "contain");
    expect(sourceToStage({ x: 0.25, y: 0.5 }, 1920, 1080, cropped).inside).toBe(false);
  });

  it("squircle outline stays inside its rectangle", () => {
    const pts = squirclePath({ x: 10, y: 20, width: 300, height: 200 }, 40);
    for (let i = 0; i < pts.length; i += 2) {
      expect(pts[i]!).toBeGreaterThanOrEqual(10 - 1e-6);
      expect(pts[i]!).toBeLessThanOrEqual(310 + 1e-6);
      expect(pts[i + 1]!).toBeGreaterThanOrEqual(20 - 1e-6);
      expect(pts[i + 1]!).toBeLessThanOrEqual(220 + 1e-6);
    }
  });

  it("scene: screen is in the camera, webcam bubble is not, and both get styling", () => {
    const p = createProject("t");
    const [cam, scr] = p.tracks;
    p.media.push({ id: "v", kind: "video", origin: "screen", path: "/x", durationMs: 9000, width: 1920, height: 1080, clockOffsetMs: 0 });
    p.clips.push(
      { id: "c1", trackId: cam!.id, mediaId: "v", content: { type: "media" }, startMs: 0, durationMs: 5000, sourceInMs: 0, speed: 1, opacity: 1, volume: 1, fadeInMs: 0, fadeOutMs: 0, muted: false, hidden: false, locked: false },
      { id: "c2", trackId: scr!.id, mediaId: "v", content: { type: "media" }, startMs: 0, durationMs: 5000, sourceInMs: 0, speed: 1, opacity: 1, volume: 1, fadeInMs: 0, fadeOutMs: 0, muted: false, hidden: false, locked: false },
    );
    const scene = buildScene(p, 1000);
    const screen = scene.layers.find((l) => l.clipId === "c2")!;
    const bubble = scene.layers.find((l) => l.clipId === "c1")!;
    expect(screen.inCamera && screen.squircle).toBe(true);
    expect(bubble.inCamera).toBe(false);
    expect(bubble.mirror).toBe(true);
    expect(bubble.cornerRadius).toBeCloseTo(bubble.frame.width / 2);
    expect(buildScene({ ...p, webcam: { ...p.webcam, layout: "hidden" } }, 1000).layers.some((l) => l.clipId === "c1")).toBe(false);
  });
});
