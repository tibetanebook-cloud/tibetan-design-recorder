/**
 * Built-in wallpapers: original artwork drawn in code (Canvas 2D), so they are
 * resolution-independent, identical in preview and export, and owned by us.
 * Drawing is deterministic (seeded random) so every frame matches.
 */
export interface WallpaperDef {
  id: string;
  /** i18n key for the name. */
  label: string;
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void;
}

/** Small seeded PRNG (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function linear(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, stops: [number, string][]): CanvasGradient {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  for (const [o, c] of stops) g.addColorStop(o, c);
  return g;
}

function vignette(ctx: CanvasRenderingContext2D, w: number, h: number, strength = 0.45): void {
  const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.hypot(w, h) * 0.6);
  g.addColorStop(0, "rgba(0,0,0,0)");
  g.addColorStop(1, `rgba(0,0,0,${strength})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

export const WALLPAPERS: WallpaperDef[] = [
  {
    id: "lhasa-dusk",
    label: "wallpaper.lhasaDusk",
    draw(ctx, w, h) {
      ctx.fillStyle = linear(ctx, 0, 0, w * 0.3, h, [[0, "#141a3d"], [0.55, "#5a1630"], [1, "#b8682a"]]);
      ctx.fillRect(0, 0, w, h);
      const sun = ctx.createRadialGradient(w * 0.72, h * 0.78, 0, w * 0.72, h * 0.78, Math.max(w, h) * 0.55);
      sun.addColorStop(0, "rgba(255, 196, 110, 0.55)");
      sun.addColorStop(1, "rgba(255, 196, 110, 0)");
      ctx.fillStyle = sun;
      ctx.fillRect(0, 0, w, h);
      vignette(ctx, w, h, 0.35);
    },
  },
  {
    id: "himalaya",
    label: "wallpaper.himalaya",
    draw(ctx, w, h) {
      ctx.fillStyle = linear(ctx, 0, 0, 0, h, [[0, "#1d2a5a"], [0.55, "#7a5c8a"], [0.8, "#f0b48a"], [1, "#f6d6a8"]]);
      ctx.fillRect(0, 0, w, h);
      const ridges: [number, string, string, number][] = [
        [0.52, "#5b6a9a", "#e9eef8", 11],
        [0.64, "#3c4775", "#c9d3ea", 23],
        [0.78, "#232a4d", "#8e9bc4", 37],
      ];
      for (const [base, fill, snow, seed] of ridges) {
        const r = rng(seed);
        const pts: [number, number][] = [];
        let x = -w * 0.05;
        while (x < w * 1.05) {
          pts.push([x, h * base - r() * h * 0.22]);
          x += w * (0.06 + r() * 0.08);
          pts.push([x, h * base + r() * h * 0.04]);
          x += w * (0.05 + r() * 0.07);
        }
        ctx.beginPath();
        ctx.moveTo(-10, h + 10);
        for (const [px, py] of pts) ctx.lineTo(px, py);
        ctx.lineTo(w + 10, h + 10);
        ctx.closePath();
        ctx.fillStyle = fill;
        ctx.fill();
        // Snow on the peaks.
        ctx.fillStyle = snow;
        for (let i = 0; i < pts.length - 1; i += 2) {
          const [px, py] = pts[i]!;
          const [qx, qy] = pts[i + 1] ?? [px + 40, py + 40];
          const prev = pts[i - 1] ?? [px - 40, py + 40];
          const k = 0.28;
          ctx.beginPath();
          ctx.moveTo(px, py);
          ctx.lineTo(px + (qx - px) * k, py + (qy - py) * k);
          ctx.lineTo(px + (prev[0] - px) * k, py + (prev[1] - py) * k);
          ctx.closePath();
          ctx.globalAlpha = 0.85;
          ctx.fill();
          ctx.globalAlpha = 1;
        }
      }
      vignette(ctx, w, h, 0.25);
    },
  },
  {
    id: "gold-lattice",
    label: "wallpaper.goldLattice",
    draw(ctx, w, h) {
      ctx.fillStyle = linear(ctx, 0, 0, w, h, [[0, "#121838"], [1, "#24123a"]]);
      ctx.fillRect(0, 0, w, h);
      const step = Math.min(w, h) / 9;
      ctx.strokeStyle = "rgba(212, 169, 74, 0.22)";
      ctx.lineWidth = Math.max(1, step * 0.03);
      for (let d = -h; d < w + h; d += step) {
        ctx.beginPath();
        ctx.moveTo(d, 0);
        ctx.lineTo(d + h, h);
        ctx.moveTo(d, h);
        ctx.lineTo(d + h, 0);
        ctx.stroke();
      }
      // Small interlaced knots at the crossings.
      ctx.fillStyle = "rgba(232, 197, 106, 0.28)";
      for (let y = 0; y <= h + step; y += step) {
        for (let x = (y / step) % 2 ? step / 2 : 0; x <= w + step; x += step) {
          const s = step * 0.12;
          ctx.beginPath();
          ctx.moveTo(x, y - s);
          ctx.lineTo(x + s, y);
          ctx.lineTo(x, y + s);
          ctx.lineTo(x - s, y);
          ctx.closePath();
          ctx.fill();
        }
      }
      vignette(ctx, w, h, 0.5);
    },
  },
  {
    id: "prayer-flags",
    label: "wallpaper.prayerFlags",
    draw(ctx, w, h) {
      const colors = ["#2f62b8", "#e9e4d6", "#b82f3a", "#2e8a55", "#e0b13a"];
      const band = (w + h) / colors.length;
      ctx.save();
      ctx.translate(w / 2, h / 2);
      ctx.rotate(-0.35);
      for (let i = 0; i < colors.length; i++) {
        ctx.fillStyle = colors[i]!;
        ctx.fillRect(-w, -h + i * band * 0.8 - band * 0.6, w * 2, band * 0.8 + 2);
      }
      ctx.restore();
      // Soften into a background so the screen stays the focus.
      ctx.fillStyle = "rgba(16, 18, 32, 0.55)";
      ctx.fillRect(0, 0, w, h);
      vignette(ctx, w, h, 0.4);
    },
  },
  {
    id: "night-sky",
    label: "wallpaper.nightSky",
    draw(ctx, w, h) {
      ctx.fillStyle = linear(ctx, 0, 0, 0, h, [[0, "#05070f"], [1, "#16224a"]]);
      ctx.fillRect(0, 0, w, h);
      const r = rng(7);
      const n = Math.round((w * h) / 4000);
      for (let i = 0; i < n; i++) {
        const s = r() < 0.92 ? r() * 1.2 + 0.3 : r() * 2.2 + 1;
        ctx.globalAlpha = 0.35 + r() * 0.65;
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.arc(r() * w, r() * h, (s * Math.min(w, h)) / 1080, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    },
  },
  {
    id: "parchment",
    label: "wallpaper.parchment",
    draw(ctx, w, h) {
      ctx.fillStyle = linear(ctx, 0, 0, w, h, [[0, "#efe2c4"], [1, "#d9c49a"]]);
      ctx.fillRect(0, 0, w, h);
      const r = rng(3);
      for (let i = 0; i < 2500; i++) {
        ctx.fillStyle = `rgba(120, 90, 40, ${r() * 0.05})`;
        ctx.fillRect(r() * w, r() * h, 2 + r() * 6, 2 + r() * 6);
      }
      vignette(ctx, w, h, 0.3);
    },
  },
  {
    id: "graphite",
    label: "wallpaper.graphite",
    draw(ctx, w, h) {
      ctx.fillStyle = linear(ctx, 0, 0, w, h, [[0, "#2b2e38"], [1, "#15161c"]]);
      ctx.fillRect(0, 0, w, h);
      vignette(ctx, w, h, 0.3);
    },
  },
  {
    id: "turquoise",
    label: "wallpaper.turquoise",
    draw(ctx, w, h) {
      ctx.fillStyle = linear(ctx, 0, 0, w, h, [[0, "#0d4a5c"], [0.6, "#1f7a8c"], [1, "#d9b26a"]]);
      ctx.fillRect(0, 0, w, h);
      vignette(ctx, w, h, 0.35);
    },
  },
];

export const wallpaperById = (id: string): WallpaperDef | undefined => WALLPAPERS.find((x) => x.id === id);
