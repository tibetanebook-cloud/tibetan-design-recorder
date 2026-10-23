/**
 * Damped springs evaluated as a pure function of time.
 *
 * A spring's value depends on its history, but preview, seeking and export must
 * all produce the same frame for the same time. So instead of carrying state from
 * frame to frame, we simulate the spring over a fixed window before the requested
 * time (starting at rest on the target), with a fixed step. A well-damped spring
 * forgets its start well within the window, so the result is deterministic and
 * matches continuous playback.
 */
export interface SpringParams {
  stiffness: number;
  damping: number;
  mass: number;
}

export const SPRING_STEP_MS = 1000 / 240;

/**
 * Value at time `t` of a spring following `target(time)`, simulated from
 * `t - windowMs` (or `from`, if later).
 */
export function springAt(target: (timeMs: number) => number, t: number, p: SpringParams, windowMs = 1500, from = -Infinity): number {
  const t0 = Math.max(from, t - windowMs);
  let x = target(t0);
  let v = 0;
  const dt = SPRING_STEP_MS / 1000;
  for (let time = t0 + SPRING_STEP_MS; time <= t; time += SPRING_STEP_MS) {
    const goal = target(time);
    // Semi-implicit Euler: stable for the stiffness range we use at 240 Hz.
    const a = (p.stiffness * (goal - x) - p.damping * v) / p.mass;
    v += a * dt;
    x += v * dt;
  }
  return x;
}

/** Same for 2D points (x and y independently, sharing one pass). */
export function spring2At(
  target: (timeMs: number) => { x: number; y: number },
  t: number,
  p: SpringParams,
  windowMs = 1500,
): { x: number; y: number } {
  const t0 = t - windowMs;
  const start = target(t0);
  let x = start.x, y = start.y, vx = 0, vy = 0;
  const dt = SPRING_STEP_MS / 1000;
  for (let time = t0 + SPRING_STEP_MS; time <= t; time += SPRING_STEP_MS) {
    const g = target(time);
    vx += ((p.stiffness * (g.x - x) - p.damping * vx) / p.mass) * dt;
    vy += ((p.stiffness * (g.y - y) - p.damping * vy) / p.mass) * dt;
    x += vx * dt;
    y += vy * dt;
  }
  return { x, y };
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Cursor smoothing slider (0–2) -> spring parameters. 0 means "follow exactly". */
export function cursorSpring(smoothing: number): SpringParams | null {
  if (smoothing <= 0.001) return null;
  if (smoothing <= 0.5) {
    const t = smoothing / 0.5;
    return { stiffness: lerp(851, 381, t), damping: lerp(34, 58, t), mass: 1 };
  }
  const t = (smoothing - 0.5) / 1.5;
  return { stiffness: lerp(381, 179, t), damping: lerp(58, 80, t), mass: lerp(1.35, 1.8, t) };
}

/** Camera smoothness (0–3, 1 = default) -> spring parameters; 0 = no spring. */
export function cameraSpring(smoothness: number): SpringParams | null {
  if (smoothness <= 0.001) return null;
  return { stiffness: 100 / smoothness, damping: 21 / Math.sqrt(smoothness), mass: 1 };
}
