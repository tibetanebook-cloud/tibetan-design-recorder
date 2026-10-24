import { describe, expect, it } from "vitest";
import { createProject } from "@shared/project/factory";
import { bubbleFrame } from "@shared/scene/buildScene";
import { bubbleSize, growOutline, LOOK_PRESETS, LOOKS, resolveGrade, sampleOutline, shapeOutline, WEBCAM_SHAPES } from "@shared/effects/webcamStyle";

const box = { x: 100, y: 50, width: 200, height: 120 };

describe("webcam shapes", () => {
  it("every shape stays inside its box and is a closed polygon", () => {
    for (const s of WEBCAM_SHAPES) {
      const pts = shapeOutline(s, box, 0.25);
      expect(pts.length % 2, s).toBe(0);
      expect(pts.length / 2, s).toBeGreaterThanOrEqual(4);
      for (let i = 0; i < pts.length; i += 2) {
        expect(pts[i]!, s).toBeGreaterThanOrEqual(box.x - 0.01);
        expect(pts[i]!, s).toBeLessThanOrEqual(box.x + box.width + 0.01);
        expect(pts[i + 1]!, s).toBeGreaterThanOrEqual(box.y - 0.01);
        expect(pts[i + 1]!, s).toBeLessThanOrEqual(box.y + box.height + 0.01);
      }
    }
  });

  it("rings grow outward and outline samples cover the whole loop", () => {
    const circle = shapeOutline("circle", box);
    const ring = growOutline(circle, box, 10);
    expect(ring[0]! === circle[0]! || Math.abs(ring[1]! - circle[1]!) >= 9.9).toBe(true);
    const samples = sampleOutline(circle, 5);
    expect(samples.length).toBeGreaterThan(80);
    expect(samples[0]!.t).toBe(0);
    expect(samples.at(-1)!.t).toBeLessThan(1);
  });

  it("bubble proportions keep the area; wide bubbles fit the canvas", () => {
    const sq = bubbleSize(300, "1:1"), wide = bubbleSize(300, "16:9");
    expect(sq).toEqual({ width: 300, height: 300 });
    expect(wide.width / wide.height).toBeCloseTo(16 / 9, 1);
    expect(Math.abs(wide.width * wide.height - 90000) / 90000).toBeLessThan(0.02);
    const p = createProject("t");
    p.webcam = { ...p.webcam, aspect: "16:9", sizePct: 100 };
    const f = bubbleFrame(p);
    expect(f.x).toBeGreaterThanOrEqual(0);
    expect(f.x + f.width).toBeLessThanOrEqual(p.canvas.width);
    expect(f.y + f.height).toBeLessThanOrEqual(p.canvas.height);
  });
});

describe("webcam looks", () => {
  it("no preset and no sliders = no change", () => {
    expect(Object.values(resolveGrade("none", {})).every((v) => v === 0)).toBe(true);
  });

  it("sliders add to the preset and are clamped", () => {
    const g = resolveGrade("warm", { temperature: 0.9, vignette: 2 });
    expect(g.temperature).toBe(1);
    expect(g.vignette).toBe(1);
    expect(resolveGrade("bw", {}).saturation).toBe(-1);
  });

  it("every preset is defined", () => {
    for (const p of LOOK_PRESETS) expect(LOOKS[p]).toBeDefined();
  });
});
