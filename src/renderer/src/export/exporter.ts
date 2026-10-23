/**
 * The exporter. Frames come from the same scene builder and compositor as the
 * preview (a separate offscreen instance at the output size), so the file
 * matches what the editor shows. Video goes through the WebCodecs encoders
 * built into Electron (hardware first), into an MP4 or WebM muxer that streams
 * to disk through the main process; GIF uses gifenc; MP3 uses lamejs.
 */
import { Muxer as Mp4Muxer, StreamTarget as Mp4Target } from "mp4-muxer";
import { Muxer as WebmMuxer, StreamTarget as WebmTarget } from "webm-muxer";
import { applyPalette, GIFEncoder, quantize } from "gifenc";
import { toSrt } from "@shared/captions/captions";
import { encodeWav, toInt16 } from "@shared/audio/wav";
import { audioPlan, frameTimes, type ExportRange } from "@shared/export/plan";
import { codecCandidates, isAudioFormat, outputSize, videoBitrate, type ExportSettings } from "@shared/export/settings";
import type { Clip, Project } from "@shared/project/schema";
import { buildScene } from "@shared/scene/buildScene";
import { Compositor, TIBETAN_FONT } from "../compositor/Compositor";
import { laneCues } from "../mediaJobs";
import { seekTo } from "../playback/engine";
import { ensureProjectAssets, sceneContext } from "../playback/assets";
import { renderMix, SAMPLE_RATE } from "./audioMix";

export interface ExportResult {
  path: string;
  bytes: number;
  frames: number;
  /** Which encoder was used, e.g. "avc1.640028 · hardware". */
  encoder: string;
  /** Average rendering + encoding speed (frames per second). */
  fps: number;
}

// ---------------------------------------------------------------- frames

/** Draws project frames at the output size, with its own media elements. */
export class FrameRenderer {
  readonly compositor = new Compositor();
  readonly canvas = document.createElement("canvas");
  private readonly els = new Map<string, HTMLVideoElement | HTMLImageElement>();

  constructor(
    private readonly project: Project,
    readonly width: number,
    readonly height: number,
  ) {}

  async init(): Promise<void> {
    await document.fonts.load(`64px ${TIBETAN_FONT}`, "བོད");
    await this.compositor.init(this.width, this.height, this.canvas);
    this.compositor.scale = this.width / this.project.canvas.width;
    this.compositor.mediaElement = (clipId) => this.els.get(clipId);
    ensureProjectAssets(this.project);
  }

  private element(clip: Clip): HTMLVideoElement | HTMLImageElement | undefined {
    if (clip.content.type !== "media" || !clip.mediaId) return undefined;
    let el = this.els.get(clip.id);
    if (el) return el;
    const media = this.project.media.find((m) => m.id === clip.mediaId);
    if (!media || (media.kind !== "video" && media.kind !== "image")) return undefined;
    if (media.kind === "image") {
      el = new Image();
      el.crossOrigin = "anonymous";
    } else {
      const v = document.createElement("video");
      v.muted = true;
      v.preload = "auto";
      v.crossOrigin = "anonymous";
      el = v;
    }
    el.src = window.tdr.mediaUrl(media.path);
    this.els.set(clip.id, el);
    return el;
  }

  async render(timeMs: number): Promise<HTMLCanvasElement> {
    const scene = buildScene(this.project, timeMs, sceneContext());
    await Promise.all(
      scene.layers.map(async (layer) => {
        const clip = this.project.clips.find((c) => c.id === layer.clipId);
        const el = clip && this.element(clip);
        if (el instanceof HTMLVideoElement) await seekTo(el, layer.sourceTimeMs / 1000);
        else if (el instanceof HTMLImageElement) await el.decode().catch(() => undefined);
      }),
    );
    this.compositor.render(scene);
    // Wallpapers/device frames requested by this frame: wait for them and draw again.
    if (await this.compositor.assetsReady()) this.compositor.render(scene);
    return this.canvas;
  }

  dispose(): void {
    for (const el of this.els.values()) {
      el.removeAttribute("src");
      if (el instanceof HTMLVideoElement) el.load();
    }
    this.els.clear();
    this.compositor.destroy();
  }
}

// ---------------------------------------------------------------- output file

/** Streams muxer output (with byte positions) to a file in the main process. */
class OutFile {
  private queue: Promise<void> = Promise.resolve();
  private constructor(private readonly id: number) {}

  static async open(path: string): Promise<OutFile> {
    return new OutFile(await window.tdr.exporter.open(path));
  }

  write = (data: Uint8Array, position: number): void => {
    const copy = data.slice();
    this.queue = this.queue.then(() => window.tdr.exporter.write(this.id, position, copy));
  };

  async close(ok: boolean): Promise<{ path: string; bytes: number } | null> {
    try {
      await this.queue;
    } catch (e) {
      await window.tdr.exporter.close(this.id, false);
      throw e;
    }
    return window.tdr.exporter.close(this.id, ok);
  }
}

// ---------------------------------------------------------------- encoders

/** First codec string + acceleration this machine supports, hardware first unless told otherwise. */
export async function pickVideoConfig(s: ExportSettings, width: number, height: number): Promise<{ config: VideoEncoderConfig; label: string } | null> {
  const accel: HardwareAcceleration[] = s.hardware === "hardware" ? ["prefer-hardware"] : s.hardware === "software" ? ["prefer-software"] : ["prefer-hardware", "prefer-software"];
  const bitrate = videoBitrate(s, width, height);
  for (const hardwareAcceleration of accel)
    for (const codec of codecCandidates(s.codec, width, height)) {
      const config: VideoEncoderConfig = {
        codec,
        width,
        height,
        bitrate,
        framerate: s.fps,
        bitrateMode: "variable",
        latencyMode: s.mode === "fast" ? "realtime" : "quality",
        hardwareAcceleration,
        ...(codec.startsWith("avc") ? { avc: { format: "avc" as const } } : {}),
        ...(codec.startsWith("hvc") ? ({ hevc: { format: "hevc" } } as object) : {}),
      };
      const support = await VideoEncoder.isConfigSupported(config).catch(() => ({ supported: false }));
      if (support.supported) return { config, label: `${codec} · ${hardwareAcceleration === "prefer-hardware" ? "hardware" : "software"}` };
    }
  return null;
}

async function waitQueue(encoder: VideoEncoder | AudioEncoder, max: number): Promise<void> {
  while (encoder.encodeQueueSize > max) await new Promise((r) => encoder.addEventListener("dequeue", r, { once: true }));
}

/** Feed a stereo AudioBuffer to an AudioEncoder in 20 ms blocks. */
async function encodeAudio(mix: AudioBuffer, codec: "mp4a.40.2" | "opus", kbps: number, onChunk: (c: EncodedAudioChunk, m?: EncodedAudioChunkMetadata) => void, signal: AbortSignal): Promise<void> {
  let error: unknown;
  const enc = new AudioEncoder({ output: onChunk, error: (e) => (error = e) });
  enc.configure({ codec, sampleRate: SAMPLE_RATE, numberOfChannels: 2, bitrate: kbps * 1000 });
  const L = mix.getChannelData(0), R = mix.numberOfChannels > 1 ? mix.getChannelData(1) : L;
  const block = SAMPLE_RATE / 50;
  for (let i = 0; i < mix.length && !signal.aborted; i += block) {
    const n = Math.min(block, mix.length - i);
    const data = new Float32Array(n * 2);
    data.set(L.subarray(i, i + n), 0);
    data.set(R.subarray(i, i + n), n);
    const ad = new AudioData({ format: "f32-planar", sampleRate: SAMPLE_RATE, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round((i / SAMPLE_RATE) * 1e6), data });
    enc.encode(ad);
    ad.close();
    await waitQueue(enc, 32);
    if (error) throw error;
  }
  await enc.flush();
  enc.close();
  if (error) throw error;
}

const hasAudio = (project: Project, range: ExportRange) => audioPlan(project, range).length > 0;

/** Hide caption lanes when captions are not burned in. */
function prepare(project: Project, s: ExportSettings): Project {
  return s.burnCaptions ? project : { ...project, tracks: project.tracks.map((t) => (t.kind === "caption" ? { ...t, hidden: true } : t)) };
}

export interface ExportRun {
  project: Project;
  settings: ExportSettings;
  range: ExportRange;
  path: string;
  signal: AbortSignal;
  report: (p: number) => void;
}

export async function runExport(run: ExportRun): Promise<ExportResult> {
  const { settings: s } = run;
  const project = prepare(run.project, s);
  const result = isAudioFormat(s.format) ? await exportAudio({ ...run, project }) : s.format === "gif" ? await exportGif({ ...run, project }) : await exportVideo({ ...run, project });
  if (s.sidecarSrt && !isAudioFormat(s.format)) await writeSidecarSrt(run.project, run.range, run.path);
  return result;
}

async function writeSidecarSrt(project: Project, range: ExportRange, videoPath: string): Promise<void> {
  const lane = project.tracks.find((t) => t.kind === "caption" && project.clips.some((c) => c.trackId === t.id));
  if (!lane) return;
  const cues = laneCues(project, lane.id)
    .filter((c) => c.endMs > range.startMs && c.startMs < range.endMs)
    .map((c) => ({ ...c, startMs: Math.max(0, c.startMs - range.startMs), endMs: Math.min(range.endMs, c.endMs) - range.startMs }));
  const f = await OutFile.open(videoPath.replace(/\.[^.\\/]+$/, "") + ".srt");
  f.write(new TextEncoder().encode("﻿" + toSrt(cues)), 0);
  await f.close(true);
}

async function exportVideo({ project, settings: s, range, path, signal, report }: ExportRun): Promise<ExportResult> {
  const { width, height } = outputSize(project.canvas, s);
  const picked = await pickVideoConfig(s, width, height);
  if (!picked) throw new Error(`codec-unsupported:${s.codec}`);
  const audio = hasAudio(project, range);
  const out = await OutFile.open(path);
  const webm = s.format === "webm";
  const muxer = webm
    ? new WebmMuxer({
        target: new WebmTarget({ onData: out.write, chunked: true }),
        video: { codec: s.codec === "av1" ? "V_AV1" : "V_VP9", width, height, frameRate: s.fps },
        audio: audio ? { codec: "A_OPUS", numberOfChannels: 2, sampleRate: SAMPLE_RATE } : undefined,
        firstTimestampBehavior: "offset",
      })
    : new Mp4Muxer({
        target: new Mp4Target({ onData: out.write, chunked: true }),
        video: { codec: s.codec === "hevc" ? "hevc" : s.codec === "av1" ? "av1" : "avc", width, height, frameRate: s.fps },
        audio: audio ? { codec: "aac", numberOfChannels: 2, sampleRate: SAMPLE_RATE } : undefined,
        fastStart: false,
        firstTimestampBehavior: "offset",
      });
  const renderer = new FrameRenderer(project, width, height);
  let encoder: VideoEncoder | undefined;
  const started = performance.now();
  try {
    // Audio first (small), then video frames in order.
    if (audio) {
      const mix = await renderMix(project, range, signal, (p) => report(p * 0.08));
      await encodeAudio(mix, webm ? "opus" : "mp4a.40.2", s.audioKbps, (c, m) => muxer.addAudioChunk(c, m), signal);
    }
    report(0.1);
    await renderer.init();
    let error: unknown;
    encoder = new VideoEncoder({ output: (c, m) => muxer.addVideoChunk(c, m), error: (e) => (error = e) });
    encoder.configure(picked.config);
    const times = frameTimes(range, s.fps);
    const frameUs = 1e6 / s.fps;
    for (let i = 0; i < times.length; i++) {
      if (signal.aborted) throw new DOMException("cancelled", "AbortError");
      const canvas = await renderer.render(times[i]!);
      const frame = new VideoFrame(canvas, { timestamp: Math.round(i * frameUs), duration: Math.round(frameUs) });
      encoder.encode(frame, { keyFrame: i % (s.fps * 2) === 0 });
      frame.close();
      await waitQueue(encoder, 6);
      if (error) throw error;
      report(0.1 + 0.88 * ((i + 1) / times.length));
    }
    await encoder.flush();
    if (error) throw error;
    muxer.finalize();
    const done = await out.close(true);
    return { path: done!.path, bytes: done!.bytes, frames: times.length, encoder: picked.label, fps: times.length / ((performance.now() - started) / 1000) };
  } catch (e) {
    await out.close(false).catch(() => undefined);
    throw e;
  } finally {
    if (encoder && encoder.state !== "closed") encoder.close();
    renderer.dispose();
  }
}

async function exportGif({ project, settings: s, range, path, signal, report }: ExportRun): Promise<ExportResult> {
  const { width, height } = outputSize(project.canvas, s);
  const renderer = new FrameRenderer(project, width, height);
  const out = await OutFile.open(path);
  const started = performance.now();
  try {
    await renderer.init();
    const times = frameTimes(range, s.gif.fps);
    const gif = GIFEncoder();
    const scratch = document.createElement("canvas");
    scratch.width = width;
    scratch.height = height;
    const ctx = scratch.getContext("2d", { willReadFrequently: true })!;
    for (let i = 0; i < times.length; i++) {
      if (signal.aborted) throw new DOMException("cancelled", "AbortError");
      ctx.drawImage(await renderer.render(times[i]!), 0, 0, width, height);
      const { data } = ctx.getImageData(0, 0, width, height);
      const palette = quantize(data, 256);
      gif.writeFrame(applyPalette(data, palette), width, height, { palette, delay: Math.round(1000 / s.gif.fps), repeat: s.gif.loop ? 0 : -1 });
      report((i + 1) / times.length * 0.97);
      // Let the UI breathe between frames.
      if (i % 4 === 3) await new Promise((r) => setTimeout(r, 0));
    }
    gif.finish();
    out.write(gif.bytes(), 0);
    const done = await out.close(true);
    return { path: done!.path, bytes: done!.bytes, frames: times.length, encoder: "GIF · 256 colours", fps: times.length / ((performance.now() - started) / 1000) };
  } catch (e) {
    await out.close(false).catch(() => undefined);
    throw e;
  } finally {
    renderer.dispose();
  }
}

async function exportAudio({ project, settings: s, range, path, signal, report }: ExportRun): Promise<ExportResult> {
  const out = await OutFile.open(path);
  try {
    const mix = await renderMix(project, range, signal, (p) => report(p * 0.6));
    const L = mix.getChannelData(0), R = mix.numberOfChannels > 1 ? mix.getChannelData(1) : L;
    let encoder = "";
    if (s.format === "wav") {
      out.write(encodeWav([L, R], SAMPLE_RATE), 0);
      encoder = "WAV · 16-bit PCM";
    } else if (s.format === "mp3") {
      // lamejs (LGPL-3.0) is loaded as its own file so it stays a separate, replaceable module.
      const { Mp3Encoder } = await import("@breezystack/lamejs");
      const enc = new Mp3Encoder(2, SAMPLE_RATE, s.audioKbps);
      const l = toInt16(L), r = toInt16(R);
      let pos = 0;
      const BLOCK = 1152 * 20;
      for (let i = 0; i < l.length; i += BLOCK) {
        if (signal.aborted) throw new DOMException("cancelled", "AbortError");
        const bytes = enc.encodeBuffer(l.subarray(i, i + BLOCK), r.subarray(i, i + BLOCK));
        if (bytes.length) {
          out.write(bytes, pos);
          pos += bytes.length;
        }
        report(0.6 + 0.4 * (i / l.length));
      }
      const tail = enc.flush();
      if (tail.length) out.write(tail, pos);
      encoder = `MP3 · ${s.audioKbps} kbps (LAME)`;
    } else {
      const muxer = new Mp4Muxer({ target: new Mp4Target({ onData: out.write, chunked: true }), audio: { codec: "aac", numberOfChannels: 2, sampleRate: SAMPLE_RATE }, fastStart: false, firstTimestampBehavior: "offset" });
      await encodeAudio(mix, "mp4a.40.2", s.audioKbps, (c, m) => muxer.addAudioChunk(c, m), signal);
      muxer.finalize();
      encoder = `AAC · ${s.audioKbps} kbps`;
    }
    const done = await out.close(true);
    return { path: done!.path, bytes: done!.bytes, frames: 0, encoder, fps: 0 };
  } catch (e) {
    await out.close(false).catch(() => undefined);
    throw e;
  }
}
