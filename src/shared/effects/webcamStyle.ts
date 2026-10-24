/**
 * Webcam styling: bubble shapes and proportions, border styles, and the "look"
 * (beauty filters + colour grade). Pure functions; the compositor draws them and
 * a WebGL filter applies the look, identically in preview and export.
 */
import type { Rect } from "../project/schema";

export const WEBCAM_SHAPES = ["circle", "rounded", "squircle", "square", "hexagon", "diamond", "heart"] as const;
export type WebcamShape = (typeof WEBCAM_SHAPES)[number];

export const BUBBLE_ASPECTS = ["1:1", "4:3", "16:9", "3:4", "9:16"] as const;
export type BubbleAspect = (typeof BUBBLE_ASPECTS)[number];

export const BORDER_STYLES = ["none", "solid", "double", "gradient", "glow", "neon", "dashed", "ring", "rainbow"] as const;
export type BorderStyle = (typeof BORDER_STYLES)[number];

export const LOOK_PRESETS = ["none", "natural", "warm", "cool", "vivid", "soft", "film", "vintage", "fade", "bw", "sepia", "dramatic", "rose", "tealOrange", "golden"] as const;
export type LookPreset = (typeof LOOK_PRESETS)[number];

/** Colour grade parameters, each -1..1 (0 = unchanged); sepia/fade/vignette 0..1. */
export interface Grade {
  brightness: number;
  contrast: number;
  saturation: number;
  /** Warm (+) / cool (-). */
  temperature: number;
  /** Magenta (+) / green (-). */
  tint: number;
  sepia: number;
  /** Lifted blacks, flatter look. */
  fade: number;
  vignette: number;
}

export const NEUTRAL_GRADE: Grade = { brightness: 0, contrast: 0, saturation: 0, temperature: 0, tint: 0, sepia: 0, fade: 0, vignette: 0 };

/** One-click looks (each is a starting grade; manual sliders add on top). */
export const LOOKS: Record<LookPreset, Partial<Grade>> = {
  none: {},
  natural: { contrast: 0.06, saturation: 0.08, brightness: 0.02 },
  warm: { temperature: 0.35, saturation: 0.08, brightness: 0.03 },
  cool: { temperature: -0.35, saturation: 0.02 },
  vivid: { saturation: 0.45, contrast: 0.18 },
  soft: { contrast: -0.15, brightness: 0.06, saturation: -0.06, fade: 0.15 },
  film: { contrast: 0.12, saturation: -0.12, temperature: 0.12, fade: 0.2, vignette: 0.35 },
  vintage: { sepia: 0.35, fade: 0.3, saturation: -0.25, temperature: 0.2, vignette: 0.45 },
  fade: { fade: 0.45, contrast: -0.1, saturation: -0.15 },
  bw: { saturation: -1, contrast: 0.15 },
  sepia: { sepia: 0.85, saturation: -0.3, contrast: 0.05 },
  dramatic: { contrast: 0.4, saturation: -0.15, vignette: 0.6, brightness: -0.04 },
  rose: { tint: 0.25, temperature: 0.1, brightness: 0.04, saturation: 0.05 },
  tealOrange: { temperature: 0.18, tint: -0.08, saturation: 0.25, contrast: 0.15 },
  golden: { temperature: 0.45, tint: 0.05, saturation: 0.15, brightness: 0.05, vignette: 0.25 },
};

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Preset + manual adjustments -> the grade the filter uses. */
export function resolveGrade(preset: LookPreset, manual: Partial<Grade>): Grade {
  const base = { ...NEUTRAL_GRADE, ...LOOKS[preset] };
  const out = { ...base };
  for (const k of Object.keys(NEUTRAL_GRADE) as (keyof Grade)[]) {
    const v = base[k] + (manual[k] ?? 0);
    out[k] = k === "sepia" || k === "fade" || k === "vignette" ? clamp(v, 0, 1) : clamp(v, -1, 1);
  }
  return out;
}

/** Bubble frame size for a proportion with the same area as a square of `size`. */
export function bubbleSize(size: number, aspect: BubbleAspect): { width: number; height: number } {
  const [a, b] = aspect.split(":").map(Number) as [number, number];
  const k = Math.sqrt(a / b);
  return { width: Math.round(size * k), height: Math.round(size / k) };
}

/** Outline of a webcam shape as polygon points [x0, y0, x1, y1, …], clockwise. */
export function shapeOutline(shape: WebcamShape, r: Rect, roundness = 0.25, steps = 64): number[] {
  const cx = r.x + r.width / 2, cy = r.y + r.height / 2, rx = r.width / 2, ry = r.height / 2;
  const pts: number[] = [];
  switch (shape) {
    case "circle":
      for (let i = 0; i < steps; i++) {
        const a = (i / steps) * Math.PI * 2 - Math.PI / 2;
        pts.push(cx + rx * Math.cos(a), cy + ry * Math.sin(a));
      }
      return pts;
    case "square":
      return [r.x, r.y, r.x + r.width, r.y, r.x + r.width, r.y + r.height, r.x, r.y + r.height];
    case "rounded": {
      const rad = Math.max(0, Math.min(roundness, 0.5)) * Math.min(r.width, r.height);
      const corners: [number, number, number][] = [
        [r.x + r.width - rad, r.y + rad, -Math.PI / 2],
        [r.x + r.width - rad, r.y + r.height - rad, 0],
        [r.x + rad, r.y + r.height - rad, Math.PI / 2],
        [r.x + rad, r.y + rad, Math.PI],
      ];
      const n = Math.max(4, Math.round(steps / 8));
      for (const [x, y, a0] of corners)
        for (let i = 0; i <= n; i++) {
          const a = a0 + (i / n) * (Math.PI / 2);
          pts.push(x + rad * Math.cos(a), y + rad * Math.sin(a));
        }
      return pts;
    }
    case "squircle": {
      // Superellipse |x|^n + |y|^n = 1 with n = 4.
      for (let i = 0; i < steps; i++) {
        const a = (i / steps) * Math.PI * 2 - Math.PI / 2;
        const c = Math.cos(a), s = Math.sin(a);
        pts.push(cx + rx * Math.sign(c) * Math.abs(c) ** 0.5, cy + ry * Math.sign(s) * Math.abs(s) ** 0.5);
      }
      return pts;
    }
    case "hexagon":
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
        pts.push(cx + rx * Math.cos(a), cy + ry * Math.sin(a));
      }
      return pts;
    case "diamond":
      return [cx, r.y, r.x + r.width, cy, cx, r.y + r.height, r.x, cy];
    case "heart": {
      // Classic parametric heart, fitted exactly into the box.
      const raw: number[] = [];
      for (let i = 0; i < steps; i++) {
        const t = (i / steps) * Math.PI * 2;
        raw.push(16 * Math.sin(t) ** 3, -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)));
      }
      const xs = raw.filter((_, i) => i % 2 === 0), ys = raw.filter((_, i) => i % 2 === 1);
      const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
      for (let i = 0; i < raw.length; i += 2) pts.push(r.x + ((raw[i]! - x0) / (x1 - x0)) * r.width, r.y + ((raw[i + 1]! - y0) / (y1 - y0)) * r.height);
      return pts;
    }
  }
}

/** The same outline grown outward by `d` pixels from the centre (rings, glows). */
export function growOutline(points: number[], r: Rect, d: number): number[] {
  const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
  const sx = (r.width / 2 + d) / (r.width / 2), sy = (r.height / 2 + d) / (r.height / 2);
  return points.map((v, i) => (i % 2 === 0 ? cx + (v - cx) * sx : cy + (v - cy) * sy));
}

/** Points along a closed outline every `step` pixels (for dashes and colour-varying borders). */
export function sampleOutline(points: number[], step: number): { x: number; y: number; t: number }[] {
  const n = points.length / 2;
  const seg: number[] = [];
  let total = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const len = Math.hypot(points[j * 2]! - points[i * 2]!, points[j * 2 + 1]! - points[i * 2 + 1]!);
    seg.push(len);
    total += len;
  }
  const out: { x: number; y: number; t: number }[] = [];
  if (total === 0) return out;
  let i = 0, acc = 0;
  for (let d = 0; d < total; d += Math.max(1, step)) {
    while (i < n - 1 && acc + seg[i]! < d) acc += seg[i++]!;
    const j = (i + 1) % n;
    const f = seg[i]! > 0 ? (d - acc) / seg[i]! : 0;
    out.push({ x: points[i * 2]! + (points[j * 2]! - points[i * 2]!) * f, y: points[i * 2 + 1]! + (points[j * 2 + 1]! - points[i * 2 + 1]!) * f, t: d / total });
  }
  return out;
}
