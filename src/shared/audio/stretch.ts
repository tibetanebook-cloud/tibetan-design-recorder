/**
 * Time-stretch without changing pitch (WSOLA: waveform-similarity overlap-add),
 * so sped-up or slowed-down speech keeps its voice in the export, like the
 * preview (which uses the browser's pitch-preserving playback).
 */
const FRAME = 1024;
const HOP = FRAME / 2;
const SEARCH = 256;

const window = new Float32Array(FRAME);
for (let i = 0; i < FRAME; i++) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / FRAME);

/** Returns `input` played `speed` times faster (output length ≈ input length / speed). */
export function timeStretch(input: Float32Array, speed: number): Float32Array {
  if (Math.abs(speed - 1) < 1e-3) return input.slice();
  const outLen = Math.max(0, Math.floor(input.length / speed));
  const out = new Float32Array(outLen + FRAME);
  const norm = new Float32Array(outLen + FRAME);
  let prevPos = 0; // where the last frame was taken from
  for (let o = 0; o < outLen; o += HOP) {
    const nominal = Math.round(o * speed);
    let best = nominal;
    if (o > 0) {
      // Continue the waveform: find the offset whose start best matches what
      // naturally followed the previous frame.
      const natural = prevPos + HOP;
      let bestScore = -Infinity;
      const lo = Math.max(0, nominal - SEARCH), hi = Math.min(input.length - FRAME, nominal + SEARCH);
      for (let cand = lo; cand <= hi; cand += 2) {
        let score = 0;
        for (let i = 0; i < HOP; i += 4) score += input[cand + i]! * (input[natural + i] ?? 0);
        if (score > bestScore) {
          bestScore = score;
          best = cand;
        }
      }
    }
    best = Math.max(0, Math.min(best, input.length - 1));
    for (let i = 0; i < FRAME && best + i < input.length; i++) {
      out[o + i]! += input[best + i]! * window[i]!;
      norm[o + i]! += window[i]!;
    }
    prevPos = best;
  }
  for (let i = 0; i < outLen; i++) if (norm[i]! > 1e-3) out[i]! /= norm[i]!;
  return out.subarray(0, outLen);
}
