/**
 * Playback: one media element per clip, driven by one master clock.
 *
 *  - Video clips are muted <video> elements; the compositor draws their current frame.
 *  - Audio clips are <audio> elements routed through Web Audio:
 *      element -> lane audio tools (FxChain: EQ, noise removal, compressor, leveling)
 *              -> gain (clip volume × lane volume × fades × mute/solo) -> pan (lane) -> speakers
 *  - Every frame the engine computes timeline time from the master clock, starts/stops
 *    elements as clips begin/end, corrects drift > 120 ms, and renders the scene.
 *
 * The master clock is performance.now() (high resolution, always running), not
 * AudioContext.currentTime: with nothing audible, or in a hidden window, Chromium
 * advances the audio clock only in coarse steps (measured: 1.000 s after 1.475 s).
 * The sound itself comes from the media elements, which drift correction keeps on
 * this clock.
 *
 * When paused, `seekFrame` puts every active clip on the exact frame for scrubbing.
 */
import type { Clip, Project } from "@shared/project/schema";
import { buildScene, fadeAt, isClipActive, sourceTime } from "@shared/scene/buildScene";
import { cursorTrackFor, ensureProjectAssets, installedExtensions, sceneContext } from "./assets";
import { isAudible, trackById } from "@shared/timeline/ops";
import type { Compositor } from "../compositor/Compositor";
import { FxChain } from "../audio/fxChain";

const DRIFT_S = 0.12;

interface Slot {
  el: HTMLMediaElement | HTMLImageElement;
  mediaId: string;
  gain?: GainNode;
  pan?: StereoPannerNode;
  fx?: FxChain;
  /** Settings last applied to fx (identity check, so params are not re-set every frame). */
  fxKey?: unknown;
}

export class PlaybackEngine {
  private ctx: AudioContext | null = null;
  private slots = new Map<string, Slot>();
  private raf = 0;
  /** performance.now() when the clock started. */
  private startPerf = 0;
  private startMs = 0;
  playing = false;

  constructor(
    private readonly getProject: () => Project,
    private readonly compositor: () => Compositor | null,
    private readonly onTime: (ms: number) => void,
    private readonly onEnded: () => void,
  ) {}

  /** The media element a clip draws from (for the compositor). */
  element(clipId: string): HTMLVideoElement | HTMLImageElement | undefined {
    const el = this.slots.get(clipId)?.el;
    return el instanceof HTMLVideoElement || el instanceof HTMLImageElement ? el : undefined;
  }

  private audioContext(): AudioContext {
    if (!this.ctx) this.ctx = new AudioContext({ latencyHint: "playback" });
    return this.ctx;
  }

  /** Create/reuse the element for a clip; drop elements of clips that no longer exist. */
  private slot(project: Project, clip: Clip): Slot | null {
    if (clip.content.type !== "media" || !clip.mediaId) return null;
    const media = project.media.find((m) => m.id === clip.mediaId);
    if (!media || media.kind === "cursor") return null;
    let slot = this.slots.get(clip.id);
    if (slot && slot.mediaId !== media.id) {
      this.release(clip.id);
      slot = undefined;
    }
    if (!slot && media.kind === "image") {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.decoding = "async";
      img.src = window.tdr.mediaUrl(media.path);
      slot = { el: img, mediaId: media.id };
      this.slots.set(clip.id, slot);
    }
    if (!slot) {
      const el = media.kind === "video" ? document.createElement("video") : document.createElement("audio");
      el.crossOrigin = "anonymous";
      el.preload = "auto";
      el.src = window.tdr.mediaUrl(media.path);
      if (el instanceof HTMLVideoElement) {
        el.muted = true; // each input's sound is its own audio lane
        el.playsInline = true;
      }
      slot = { el, mediaId: media.id };
      if (media.kind === "audio") {
        const ctx = this.audioContext();
        const source = ctx.createMediaElementSource(el);
        slot.fx = new FxChain(ctx);
        slot.gain = ctx.createGain();
        slot.pan = ctx.createStereoPanner();
        source.connect(slot.fx.input);
        slot.fx.output.connect(slot.gain).connect(slot.pan).connect(ctx.destination);
      }
      this.slots.set(clip.id, slot);
    }
    return slot;
  }

  private release(clipId: string): void {
    const slot = this.slots.get(clipId);
    if (!slot) return;
    if (slot.el instanceof HTMLMediaElement) {
      slot.el.pause();
      slot.el.removeAttribute("src");
      slot.el.load();
    }
    slot.fx?.disconnect();
    slot.gain?.disconnect();
    slot.pan?.disconnect();
    this.slots.delete(clipId);
  }

  private prune(project: Project): void {
    const live = new Set(project.clips.map((c) => c.id));
    for (const id of [...this.slots.keys()]) if (!live.has(id)) this.release(id);
  }

  private applyMix(project: Project, clip: Clip, slot: Slot, timeMs: number): void {
    if (!slot.gain || !slot.pan) return;
    const track = trackById(project, clip.trackId);
    const level = isAudible(project, clip) ? clip.volume * (track?.volume ?? 1) * fadeAt(clip, timeMs) : 0;
    const now = this.audioContext().currentTime;
    slot.gain.gain.setTargetAtTime(level, now, 0.01);
    slot.pan.pan.setTargetAtTime(track?.pan ?? 0, now, 0.01);
    const analysis = project.analysis[slot.mediaId];
    if (slot.fx && (slot.fxKey as unknown[] | undefined)?.[0] !== track?.audioFx || (slot.fxKey as unknown[] | undefined)?.[1] !== analysis) {
      slot.fx?.update(track?.audioFx, analysis);
      slot.fxKey = [track?.audioFx, analysis];
    }
  }

  /** Audio tools state of a clip's chain (smoke test / UI status). */
  fxStatus(clipId: string): { denoise: boolean } | undefined {
    const fx = this.slots.get(clipId)?.fx;
    return fx && { denoise: fx.denoiseReady };
  }

  // ---------- paused: show an exact frame ----------

  private frameBusy = false;
  private frameWanted: number | null = null;

  /**
   * Show the frame at timeMs while paused. Requests are serialized: overlapping
   * async seeks could otherwise finish out of order and leave an older frame on
   * screen. Only the newest request still waiting is drawn.
   */
  async requestFrame(timeMs: number): Promise<void> {
    this.frameWanted = timeMs;
    if (this.frameBusy) return;
    this.frameBusy = true;
    try {
      while (this.frameWanted !== null) {
        const t = this.frameWanted;
        this.frameWanted = null;
        try {
          await this.seekFrame(t);
        } catch (error) {
          console.error("Preview frame failed:", error);
        }
      }
    } finally {
      this.frameBusy = false;
    }
  }

  /** Seek every visible clip to its frame at timeMs, then draw. */
  async seekFrame(timeMs: number): Promise<void> {
    const project = this.getProject();
    this.prune(project);
    ensureProjectAssets(project);
    const scene = buildScene(project, timeMs, sceneContext());
    await Promise.all(
      scene.layers.map(async (layer) => {
        const clip = project.clips.find((c) => c.id === layer.clipId);
        if (!clip) return;
        const slot = this.slot(project, clip);
        if (slot?.el instanceof HTMLVideoElement) await seekTo(slot.el, layer.sourceTimeMs / 1000);
        else if (slot?.el instanceof HTMLImageElement) await slot.el.decode().catch(() => undefined);
      }),
    );
    if (this.playing) return; // playback started meanwhile
    this.draw(project, timeMs);
  }

  private draw(project: Project, timeMs: number): void {
    const compositor = this.compositor();
    if (!compositor) return;
    compositor.mediaElement = (clipId) => this.element(clipId);
    compositor.render(buildScene(project, timeMs, sceneContext()));
  }

  // ---------- playing ----------

  /** How long the last play() waited for the audio device before the clock started (ms). */
  lastStartLatencyMs = 0;

  async play(fromMs: number): Promise<void> {
    if (this.playing) return;
    const asked = performance.now();
    const ctx = this.audioContext();
    await ctx.resume();
    this.lastStartLatencyMs = performance.now() - asked;
    this.playing = true;
    this.startMs = fromMs;
    this.startPerf = performance.now();
    this.lastClickCheck = fromMs;
    const loop = () => {
      if (!this.playing) return;
      this.tick();
      this.raf = this.schedule(loop);
    };
    loop();
  }

  /**
   * Next frame: requestAnimationFrame when the window is visible; a timer when it
   * is hidden (Chromium barely runs rAF for hidden windows, which would stall
   * playback and the hidden export renderer).
   */
  private schedule(fn: () => void): number {
    if (document.visibilityState === "hidden") return -window.setTimeout(fn, 16);
    return requestAnimationFrame(fn);
  }

  private unschedule(id: number): void {
    if (id < 0) window.clearTimeout(-id);
    else cancelAnimationFrame(id);
  }

  pause(): void {
    if (!this.playing) return;
    // Commit the exact clock time, not the last drawn frame's time.
    const end = this.getProject().clips.reduce((m, c) => Math.max(m, c.startMs + c.durationMs), 0);
    const now = Math.min(this.timeMs, end);
    this.playing = false;
    this.unschedule(this.raf);
    for (const slot of this.slots.values()) if (slot.el instanceof HTMLMediaElement) slot.el.pause();
    this.onTime(now);
  }

  get timeMs(): number {
    return this.startMs + (performance.now() - this.startPerf);
  }

  private tick(): void {
    const project = this.getProject();
    const end = project.clips.reduce((m, c) => Math.max(m, c.startMs + c.durationMs), 0);
    let now = this.timeMs;
    if (now >= end) {
      now = end;
      this.pause();
      this.onTime(now);
      this.onEnded();
      return;
    }
    this.prune(project);
    for (const clip of project.clips) {
      const slot = this.slot(project, clip);
      if (!slot || !(slot.el instanceof HTMLMediaElement)) continue;
      const active = isClipActive(clip, now) && !clip.hidden && !trackById(project, clip.trackId)?.hidden;
      const el = slot.el;
      if (!active) {
        if (!el.paused) el.pause();
        continue;
      }
      const target = sourceTime(clip, now) / 1000;
      el.playbackRate = clip.speed;
      if (el.paused) {
        el.currentTime = target;
        void el.play().catch(() => undefined);
      } else if (Math.abs(el.currentTime - target) > DRIFT_S) {
        el.currentTime = target;
      }
      this.applyMix(project, clip, slot, now);
    }
    this.playClickSounds(project, now);
    this.draw(project, now);
    this.onTime(now);
  }

  // ---------- click sounds (extension) ----------

  private lastClickCheck = -1;
  private clickPool: HTMLAudioElement[] = [];

  /** Play the chosen extension click sound for clicks crossed since the last tick. */
  private playClickSounds(project: Project, now: number): void {
    const from = this.lastClickCheck;
    this.lastClickCheck = now;
    const soundId = project.cursor.clickSound;
    if (!soundId || from < 0 || now <= from || now - from > 250) return;
    const sound = installedExtensions().flatMap((e) => e.clickSounds).find((s) => s.id === soundId);
    if (!sound) return;
    for (const clip of project.clips) {
      if (!isClipActive(clip, now) || clip.hidden || !clip.mediaId) continue;
      if (trackById(project, clip.trackId)?.kind !== "cursor") continue;
      const track = cursorTrackFor(clip.mediaId);
      if (!track) continue;
      const a = sourceTime(clip, from), b = sourceTime(clip, now);
      for (const e of track.events) {
        if (e.type !== "down" || e.t <= a || e.t > b) continue;
        let el = this.clickPool.find((x) => x.paused);
        if (!el) {
          el = new Audio(window.tdr.mediaUrl(sound.path));
          this.clickPool.push(el);
        } else if (!el.src.endsWith(encodeURIComponent(sound.path))) el.src = window.tdr.mediaUrl(sound.path);
        el.currentTime = 0;
        void el.play().catch(() => undefined);
      }
    }
  }

  dispose(): void {
    this.pause();
    for (const id of [...this.slots.keys()]) this.release(id);
    void this.ctx?.close();
    this.ctx = null;
  }
}

/** Resolve once the video shows the frame at `seconds` (or after a timeout). */
export function seekTo(video: HTMLVideoElement, seconds: number): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      video.removeEventListener("seeked", done);
      video.removeEventListener("loadeddata", go);
      resolve();
    };
    const timer = setTimeout(done, 4000);
    const go = () => {
      const target = Math.min(seconds, Number.isFinite(video.duration) ? Math.max(0, video.duration - 0.03) : seconds);
      if (Math.abs(video.currentTime - target) < 0.01 && video.readyState >= 2) return done();
      video.addEventListener("seeked", done, { once: true });
      video.currentTime = target;
    };
    if (video.readyState >= 1) go();
    else video.addEventListener("loadeddata", go, { once: true });
  });
}
