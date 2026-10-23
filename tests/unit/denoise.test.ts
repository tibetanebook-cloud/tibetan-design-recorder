import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** Load the AudioWorklet processor class in Node with the worklet globals stubbed. */
function loadProcessor(): new () => { process: (i: Float32Array[][], o: Float32Array[][], p: { amount: Float32Array }) => boolean } {
  const src = readFileSync(join(__dirname, "../../src/renderer/src/audio/denoise.worklet.js"), "utf8");
  let registered: unknown;
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  new Function("AudioWorkletProcessor", "registerProcessor", src)(class {}, (_n: string, c: unknown) => (registered = c));
  return registered as never;
}

function run(amount: number, input: Float32Array): Float32Array {
  const P = loadProcessor();
  const proc = new P();
  const out = new Float32Array(input.length);
  for (let i = 0; i + 128 <= input.length; i += 128) {
    const o = [new Float32Array(128)];
    proc.process([[input.subarray(i, i + 128)]], [o], { amount: new Float32Array([amount]) });
    out.set(o[0]!, i);
  }
  return out;
}

const sr = 48000;
const signal = (() => {
  const d = new Float32Array(sr * 4);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  for (let i = 0; i < d.length; i++) d[i] = rnd() * 0.05 + (i > sr * 2 ? 0.3 * Math.sin((2 * Math.PI * 440 * i) / sr) : 0);
  return d;
})();
const rms = (a: Float32Array, from: number, to: number) => Math.sqrt(a.subarray(from, to).reduce((s, v) => s + v * v, 0) / (to - from));
const db = (x: number, y: number) => 20 * Math.log10(x / y);

describe("noise removal worklet", () => {
  it("at amount 0 the output equals the input, 512 samples later", () => {
    const out = run(0, signal);
    for (let i = 4000; i < 5000; i++) expect(out[i]).toBeCloseTo(signal[i - 512]!, 4);
  });

  it("lowers steady noise by more than 10 dB and keeps a tone within 2 dB", () => {
    const off = run(0, signal), on = run(0.9, signal);
    expect(db(rms(off, sr * 1.2, sr * 1.9), rms(on, sr * 1.2, sr * 1.9))).toBeGreaterThan(10);
    expect(Math.abs(db(rms(off, sr * 2.6, sr * 3.8), rms(on, sr * 2.6, sr * 3.8)))).toBeLessThan(2);
  });
});
