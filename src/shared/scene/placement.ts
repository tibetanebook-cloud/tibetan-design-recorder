/**
 * Where a media picture lands on stage: crop (fractions of the source), then fit
 * into the layer frame ("contain" letterboxes, "cover" crops to fill). Shared by
 * the compositor (to draw) and the scene builder (to map cursor/zoom coordinates),
 * so both always agree.
 */
import type { Crop, Rect } from "../project/schema";

export interface Placement {
  /** Source rectangle in media pixels. */
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  /** Destination rectangle on stage. */
  dx: number;
  dy: number;
  dw: number;
  dh: number;
}

const NO_CROP: Crop = { left: 0, top: 0, right: 0, bottom: 0 };

export function placeMedia(mediaW: number, mediaH: number, frame: Rect, crop: Crop | undefined, fit: "contain" | "cover"): Placement {
  const c = crop ?? NO_CROP;
  let sx = c.left * mediaW, sy = c.top * mediaH;
  let sw = Math.max(1, mediaW * (1 - c.left - c.right)), sh = Math.max(1, mediaH * (1 - c.top - c.bottom));
  let dx = frame.x, dy = frame.y, dw = frame.width, dh = frame.height;
  const srcAspect = sw / sh, frameAspect = frame.width / frame.height;
  if (fit === "cover") {
    if (srcAspect > frameAspect) {
      const w = sh * frameAspect;
      sx += (sw - w) / 2;
      sw = w;
    } else {
      const h = sw / frameAspect;
      sy += (sh - h) / 2;
      sh = h;
    }
  } else if (srcAspect > frameAspect) {
    dh = frame.width / srcAspect;
    dy += (frame.height - dh) / 2;
  } else {
    dw = frame.height * srcAspect;
    dx += (frame.width - dw) / 2;
  }
  return { sx, sy, sw, sh, dx, dy, dw, dh };
}

/** Source point (0–1 of the whole media) -> stage, or null if cropped away. */
export function sourceToStage(p: { x: number; y: number }, mediaW: number, mediaH: number, pl: Placement): { x: number; y: number; inside: boolean } {
  const px = p.x * mediaW, py = p.y * mediaH;
  const inside = px >= pl.sx && px <= pl.sx + pl.sw && py >= pl.sy && py <= pl.sy + pl.sh;
  return { x: pl.dx + ((px - pl.sx) / pl.sw) * pl.dw, y: pl.dy + ((py - pl.sy) / pl.sh) * pl.dh, inside };
}

/** Superellipse ("squircle") corner outline, clockwise, for frame masks and shadows. */
export function squirclePath(r: Rect, radius: number, pointsPerCorner = 10): number[] {
  const rad = Math.max(0, Math.min(radius, r.width / 2, r.height / 2));
  if (rad < 0.5) return [r.x, r.y, r.x + r.width, r.y, r.x + r.width, r.y + r.height, r.x, r.y + r.height];
  const n = 4.5; // superellipse exponent: softer than a circle
  const pts: number[] = [];
  const corners = [
    { cx: r.x + r.width - rad, cy: r.y + rad, a0: -Math.PI / 2 },
    { cx: r.x + r.width - rad, cy: r.y + r.height - rad, a0: 0 },
    { cx: r.x + rad, cy: r.y + r.height - rad, a0: Math.PI / 2 },
    { cx: r.x + rad, cy: r.y + rad, a0: Math.PI },
  ];
  for (const { cx, cy, a0 } of corners) {
    for (let i = 0; i <= pointsPerCorner; i++) {
      const a = a0 + (i / pointsPerCorner) * (Math.PI / 2);
      const cos = Math.cos(a), sin = Math.sin(a);
      pts.push(cx + rad * Math.sign(cos) * Math.pow(Math.abs(cos), 2 / n), cy + rad * Math.sign(sin) * Math.pow(Math.abs(sin), 2 / n));
    }
  }
  return pts;
}
