/**
 * The per-lane audio tools as a Web Audio graph. The editor preview and the
 * exporter (an OfflineAudioContext in Stage 6) build the same chain:
 *
 *   in -> high-pass -> low shelf -> mid peak -> high shelf -> noise removal
 *      -> compressor -> make-up gain -> leveling gain -> out
 *
 * Disabled tools are set to neutral values instead of being unplugged, so
 * switching them never clicks and the latency stays constant.
 */
import type { AudioFx, MediaAnalysis } from "@shared/project/schema";
import { dbToGain, levelingGainDb } from "@shared/audio/fx";
import workletUrl from "./denoise.worklet.js?url";

const loaded = new WeakMap<BaseAudioContext, Promise<boolean>>();

/** Load the noise-removal worklet once per context; false if it cannot load. */
export function loadDenoise(ctx: BaseAudioContext): Promise<boolean> {
  let p = loaded.get(ctx);
  if (!p) {
    p = ctx.audioWorklet
      .addModule(workletUrl)
      .then(() => true)
      .catch((e) => {
        console.warn("Noise removal unavailable:", e);
        return false;
      });
    loaded.set(ctx, p);
  }
  return p;
}

export class FxChain {
  readonly input: GainNode;
  readonly output: GainNode;
  private readonly highpass: BiquadFilterNode;
  private readonly low: BiquadFilterNode;
  private readonly mid: BiquadFilterNode;
  private readonly high: BiquadFilterNode;
  private readonly compressor: DynamicsCompressorNode;
  private readonly makeup: GainNode;
  private denoise: AudioWorkletNode | null = null;
  /** Resolves once noise removal is in the chain (or known to be unavailable). */
  readonly ready: Promise<void>;
  private amount = 0;

  constructor(private readonly ctx: BaseAudioContext) {
    this.input = ctx.createGain();
    this.highpass = new BiquadFilterNode(ctx, { type: "highpass", frequency: 10, Q: 0.707 });
    this.low = new BiquadFilterNode(ctx, { type: "lowshelf", frequency: 200, gain: 0 });
    this.mid = new BiquadFilterNode(ctx, { type: "peaking", frequency: 1800, Q: 0.9, gain: 0 });
    this.high = new BiquadFilterNode(ctx, { type: "highshelf", frequency: 6500, gain: 0 });
    this.compressor = new DynamicsCompressorNode(ctx, { threshold: 0, ratio: 1, knee: 0, attack: 0.01, release: 0.2 });
    this.makeup = ctx.createGain();
    this.output = ctx.createGain();
    this.input.connect(this.highpass).connect(this.low).connect(this.mid).connect(this.high);
    this.high.connect(this.compressor).connect(this.makeup).connect(this.output);
    // Splice the worklet in once it has loaded (the chain works without it).
    // The exporter awaits `ready` before rendering offline.
    this.ready = loadDenoise(ctx).then((ok) => {
      if (!ok) return;
      this.denoise = new AudioWorkletNode(ctx, "tdr-denoise", { outputChannelCount: [2], parameterData: { amount: this.amount } });
      this.high.disconnect();
      this.high.connect(this.denoise).connect(this.compressor);
      this.routedThroughDenoise = true;
      this.route(this.amount > 0);
    });
  }

  private routedThroughDenoise = true;

  /** Send audio through the noise worklet only while noise removal is on. */
  private route(throughDenoise: boolean): void {
    if (!this.denoise || throughDenoise === this.routedThroughDenoise) return;
    this.high.disconnect();
    if (throughDenoise) this.high.connect(this.denoise);
    else this.high.connect(this.compressor);
    this.routedThroughDenoise = throughDenoise;
  }

  get denoiseReady(): boolean {
    return this.denoise !== null;
  }

  update(fx: AudioFx | undefined, analysis?: MediaAnalysis): void {
    const at = this.ctx.currentTime;
    const set = (p: AudioParam, v: number) => p.setTargetAtTime(v, at, 0.02);
    const eq = fx?.eq.enabled ? fx.eq : undefined;
    set(this.highpass.frequency, eq ? eq.highpassHz : 10);
    set(this.low.gain, eq ? eq.lowGain : 0);
    set(this.mid.gain, eq ? eq.midGain : 0);
    set(this.mid.frequency, eq ? eq.midHz : 1800);
    set(this.high.gain, eq ? eq.highGain : 0);
    const c = fx?.compressor.enabled ? fx.compressor : undefined;
    set(this.compressor.threshold, c ? c.thresholdDb : 0);
    set(this.compressor.ratio, c ? c.ratio : 1);
    set(this.compressor.knee, c ? c.kneeDb : 0);
    set(this.compressor.attack, c ? c.attackMs / 1000 : 0.01);
    set(this.compressor.release, c ? c.releaseMs / 1000 : 0.2);
    const leveling = fx?.leveling.enabled ? levelingGainDb(analysis?.loudnessLufs, fx.leveling.targetLufs) : 0;
    set(this.makeup.gain, dbToGain((c ? c.makeupDb : 0) + leveling));
    this.amount = fx?.noise.enabled ? fx.noise.amount : 0;
    const p = this.denoise?.parameters.get("amount");
    if (p) set(p, this.amount);
    this.route(this.amount > 0);
  }

  disconnect(): void {
    for (const n of [this.input, this.highpass, this.low, this.mid, this.high, this.compressor, this.makeup, this.output, this.denoise]) n?.disconnect();
  }
}
