/**
 * Cubic Bezier easing (CSS-style control points), solved x -> t with Newton's
 * method and a bisection fallback, plus the named zoom easing presets.
 */
import type { ZoomSettings } from "../project/schema";

export type Curve = readonly [number, number, number, number];

export const EASING_CURVES: Record<Exclude<ZoomSettings["easing"], "custom">, Curve> = {
  /** Fast start, long soft landing (expo-out character). */
  smooth: [0.16, 1, 0.3, 1],
  /** Quicker, firmer arrival. */
  snappy: [0.05, 0.9, 0.1, 1],
  /** Gentle start and end. */
  gentle: [0.45, 0, 0.25, 1],
  linear: [0, 0, 1, 1],
};

export function curveFor(settings: Pick<ZoomSettings, "easing" | "customCurve">): Curve {
  return settings.easing === "custom" ? settings.customCurve : EASING_CURVES[settings.easing];
}

export function cubicBezier([x1, y1, x2, y2]: Curve): (x: number) => number {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sampleX = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sampleY = (t: number) => ((ay * t + by) * t + cy) * t;
  const slopeX = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  return (x: number) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i++) {
      const err = sampleX(t) - x;
      if (Math.abs(err) < 1e-6) return sampleY(t);
      const d = slopeX(t);
      if (Math.abs(d) < 1e-6) break;
      t -= err / d;
    }
    // Bisection fallback.
    let lo = 0, hi = 1;
    t = x;
    for (let i = 0; i < 40; i++) {
      const v = sampleX(t);
      if (Math.abs(v - x) < 1e-7) break;
      if (v < x) lo = t;
      else hi = t;
      t = (lo + hi) / 2;
    }
    return sampleY(t);
  };
}

export const easeOutQuint = (t: number): number => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 5);
