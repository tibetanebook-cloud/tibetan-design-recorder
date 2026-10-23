/**
 * Audio tools math and presets (the DSP itself runs in Web Audio: preview and
 * export use the same node graph and the same noise-reduction worklet).
 */
import { AudioFx } from "../project/schema";

export const DEFAULT_FX: AudioFx = AudioFx.parse({});

/** Gain (dB) that brings measured loudness to the target, limited to ±20 dB. */
export function levelingGainDb(measuredLufs: number | undefined, targetLufs: number): number {
  if (measuredLufs === undefined || !Number.isFinite(measuredLufs)) return 0;
  return Math.max(-20, Math.min(20, targetLufs - measuredLufs));
}

export const dbToGain = (db: number): number => Math.pow(10, db / 20);

export type FxPreset = "voice" | "podcast" | "warm" | "reduceHiss";

/** One-click starting points for a voice (mic) lane. */
export function fxPreset(preset: FxPreset): AudioFx {
  const fx = structuredClone(DEFAULT_FX);
  fx.leveling = { enabled: true, targetLufs: -16 };
  fx.noise = { enabled: true, amount: 0.6 };
  switch (preset) {
    case "voice":
      fx.eq = { enabled: true, highpassHz: 90, lowGain: -2, midGain: 3, midHz: 2500, highGain: 2 };
      fx.compressor = { enabled: true, thresholdDb: -22, ratio: 3, attackMs: 8, releaseMs: 180, kneeDb: 6, makeupDb: 4 };
      break;
    case "podcast":
      fx.eq = { enabled: true, highpassHz: 80, lowGain: 2, midGain: 2, midHz: 3000, highGain: 1 };
      fx.compressor = { enabled: true, thresholdDb: -24, ratio: 4, attackMs: 5, releaseMs: 150, kneeDb: 8, makeupDb: 6 };
      break;
    case "warm":
      fx.eq = { enabled: true, highpassHz: 70, lowGain: 3, midGain: -1, midHz: 1200, highGain: -2 };
      fx.compressor = { enabled: true, thresholdDb: -20, ratio: 2.5, attackMs: 12, releaseMs: 220, kneeDb: 8, makeupDb: 3 };
      break;
    case "reduceHiss":
      fx.eq = { enabled: true, highpassHz: 80, lowGain: 0, midGain: 0, midHz: 1800, highGain: -6 };
      fx.noise = { enabled: true, amount: 0.85 };
      break;
  }
  return fx;
}

/**
 * Loudness estimate (simplified BS.1770: K-weighting approximated by a 1st-order
 * high-shelf, 400 ms blocks, -70 LUFS absolute gate and -10 LU relative gate).
 */
export function estimateLufs(samples: Float32Array, sampleRate: number): { lufs: number; peakDb: number } {
  // Pre-filter: simple high-pass at ~100 Hz + slight treble lift, in one pass.
  const out = new Float32Array(samples.length);
  const rc = 1 / (2 * Math.PI * 100), dt = 1 / sampleRate, a = rc / (rc + dt);
  let prevX = 0, prevY = 0, peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const x = samples[i]!;
    peak = Math.max(peak, Math.abs(x));
    const y = a * (prevY + x - prevX);
    out[i] = y * 1.12;
    prevX = x;
    prevY = y;
  }
  const block = Math.round(0.4 * sampleRate), hop = Math.round(0.1 * sampleRate);
  const powers: number[] = [];
  for (let start = 0; start + block <= out.length; start += hop) {
    let sum = 0;
    for (let i = start; i < start + block; i++) sum += out[i]! * out[i]!;
    powers.push(sum / block);
  }
  const lufsOf = (p: number) => -0.691 + 10 * Math.log10(Math.max(p, 1e-12));
  const abs = powers.filter((p) => lufsOf(p) > -70);
  if (!abs.length) return { lufs: -70, peakDb: 20 * Math.log10(Math.max(peak, 1e-9)) };
  const mean = abs.reduce((s, p) => s + p, 0) / abs.length;
  const rel = abs.filter((p) => lufsOf(p) > lufsOf(mean) - 10);
  const gated = rel.reduce((s, p) => s + p, 0) / Math.max(1, rel.length);
  return { lufs: lufsOf(gated), peakDb: 20 * Math.log10(Math.max(peak, 1e-9)) };
}
