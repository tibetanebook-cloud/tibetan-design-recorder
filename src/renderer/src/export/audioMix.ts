/**
 * Export audio: every audible clip in the range, mixed in an OfflineAudioContext
 * through the same lane chain as the preview (EQ, noise removal, compressor,
 * leveling), with fades, volume and pan, then a soft limiter on the master.
 * Clips with a speed other than 1 are time-stretched (pitch kept).
 */
import { estimateLufs } from "@shared/audio/fx";
import { timeStretch } from "@shared/audio/stretch";
import { audioPlan, fadeEnvelope, type ExportRange } from "@shared/export/plan";
import type { MediaAnalysis, Project } from "@shared/project/schema";
import { FxChain } from "../audio/fxChain";

export const SAMPLE_RATE = 48000;

/** Decode each media file once per export. */
async function decodeAll(project: Project, ids: string[], signal: AbortSignal): Promise<Map<string, AudioBuffer>> {
  const out = new Map<string, AudioBuffer>();
  const ctx = new OfflineAudioContext(2, 1, SAMPLE_RATE);
  for (const id of ids) {
    const media = project.media.find((m) => m.id === id);
    if (!media) continue;
    const data = await (await fetch(window.tdr.mediaUrl(media.path), { signal })).arrayBuffer();
    out.set(id, await ctx.decodeAudioData(data));
  }
  return out;
}

function mono(buf: AudioBuffer): Float32Array {
  const m = new Float32Array(buf.length);
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < d.length; i++) m[i]! += d[i]! / buf.numberOfChannels;
  }
  return m;
}

/** Stereo mix of the range; resolves to an AudioBuffer of exactly the range length. */
export async function renderMix(project: Project, range: ExportRange, signal: AbortSignal, report: (p: number) => void = () => undefined): Promise<AudioBuffer> {
  const length = Math.max(1, Math.round(((range.endMs - range.startMs) / 1000) * SAMPLE_RATE));
  const ctx = new OfflineAudioContext(2, length, SAMPLE_RATE);
  const pieces = audioPlan(project, range);
  const sources = await decodeAll(project, [...new Set(pieces.map((p) => p.mediaId))], signal);
  report(0.4);

  // Master: soft limiter so peaks stay below about -0.9 dBFS.
  const limiter = new DynamicsCompressorNode(ctx, { threshold: -3, knee: 3, ratio: 20, attack: 0.002, release: 0.12 });
  const master = new GainNode(ctx, { gain: 0.98 });
  limiter.connect(master).connect(ctx.destination);

  // One chain per lane, as in the preview.
  const lanes = new Map<string, { chain: FxChain; pan: StereoPannerNode }>();
  for (const p of pieces) {
    if (lanes.has(p.trackId)) continue;
    const chain = new FxChain(ctx);
    await chain.ready;
    // Leveling needs a loudness measurement; measure now if the job never ran.
    const analysis: MediaAnalysis | undefined = project.analysis[p.mediaId]?.loudnessLufs !== undefined || !p.fx?.leveling.enabled
      ? project.analysis[p.mediaId]
      : { loudnessLufs: estimateLufs(mono(sources.get(p.mediaId)!), SAMPLE_RATE).lufs };
    chain.update(p.fx, analysis);
    const pan = new StereoPannerNode(ctx, { pan: p.pan });
    chain.output.connect(pan).connect(limiter);
    lanes.set(p.trackId, { chain, pan });
  }

  for (const p of pieces) {
    const src = sources.get(p.mediaId);
    if (!src) continue;
    const from = Math.floor((p.sourceMs / 1000) * src.sampleRate);
    const count = Math.min(src.length - from, Math.ceil((p.sourceLenMs / 1000) * src.sampleRate));
    if (count <= 0) continue;
    const channels = Array.from({ length: src.numberOfChannels }, (_, c) => {
      const seg = src.getChannelData(c).subarray(from, from + count);
      return p.speed === 1 ? seg : timeStretch(seg, p.speed);
    });
    const buf = ctx.createBuffer(channels.length, channels[0]!.length || 1, src.sampleRate);
    channels.forEach((d, c) => buf.copyToChannel(d as Float32Array<ArrayBuffer>, c));
    const node = new AudioBufferSourceNode(ctx, { buffer: buf });
    const gain = new GainNode(ctx, { gain: 0 });
    const t0 = p.atMs / 1000;
    const env = fadeEnvelope(p);
    gain.gain.setValueAtTime(env[0]![1], t0);
    for (const [t, v] of env.slice(1)) gain.gain.linearRampToValueAtTime(v, t0 + t);
    node.connect(gain).connect(lanes.get(p.trackId)!.chain.input);
    node.start(t0);
  }
  report(0.5);
  const out = await ctx.startRendering();
  // Safety: nothing above full scale reaches the encoder.
  for (let c = 0; c < out.numberOfChannels; c++) {
    const d = out.getChannelData(c);
    for (let i = 0; i < d.length; i++) if (d[i]! > 0.999) d[i] = 0.999; else if (d[i]! < -0.999) d[i] = -0.999;
  }
  report(1);
  return out;
}
