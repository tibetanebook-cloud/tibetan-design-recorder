/**
 * The one clock every track of a take is measured against.
 *
 * Wall time is epoch milliseconds with sub-ms precision (performance.timeOrigin +
 * performance.now() in renderers, the same in main), so main and renderer events
 * share a time base. Recording time starts at 0 and does not advance while paused.
 */
import type { PauseSpan } from "./types";

export const wallNow = (): number => performance.timeOrigin + performance.now();

export class RecordingClock {
  private startWall = 0;
  private pausedAtWall: number | null = null;
  private pausedTotal = 0;
  readonly pauses: PauseSpan[] = [];

  start(atWall = wallNow()): void {
    this.startWall = atWall;
    this.pausedAtWall = null;
    this.pausedTotal = 0;
    this.pauses.length = 0;
  }

  get started(): boolean {
    return this.startWall > 0;
  }

  get paused(): boolean {
    return this.pausedAtWall !== null;
  }

  pause(atWall = wallNow()): void {
    if (this.pausedAtWall === null) this.pausedAtWall = atWall;
  }

  resume(atWall = wallNow()): void {
    if (this.pausedAtWall === null) return;
    const wallMs = atWall - this.pausedAtWall;
    this.pauses.push({ atMs: this.toRecording(this.pausedAtWall), wallMs });
    this.pausedTotal += wallMs;
    this.pausedAtWall = null;
  }

  /** Recording time for a wall time (clamped to the pause point while paused). */
  toRecording(wall: number): number {
    const effective = this.pausedAtWall !== null && wall > this.pausedAtWall ? this.pausedAtWall : wall;
    return Math.max(0, effective - this.startWall - this.pausedTotal);
  }

  now(): number {
    return this.toRecording(wallNow());
  }
}
