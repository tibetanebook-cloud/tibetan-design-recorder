/**
 * The single source of truth for "what is on screen at time t".
 *
 * buildScene() is pure and has no DOM/GPU dependency. The editor preview and
 * the exporter both call it and hand the result to the same PixiJS compositor,
 * so the exported video matches the preview frame for frame. Every effect (camera
 * zoom, cursor, click rings, webcam layouts, device frames) is decided here, never
 * in the drawing code.
 */
import type { Background, CaptionStyle, Clip, ClipContent, Crop, CursorStyle, Project, Rect, Track, WebcamBorder, WebcamLayout, WebcamLook } from "../project/schema";
import { bubbleSize, type WebcamShape } from "../effects/webcamStyle";
import { dissolvePartner, NO_TRANSITION, textAnimationAt, transitionAt, type TextAnimState, type TransitionState } from "../effects/transitions";
import { layoutAt, mixRect } from "../effects/layouts";
import { captionClips, quizAt, stepNumbers } from "../teaching";
import type { CursorTrack } from "../recording/types";
import { cursorStateAt, type KeyChip } from "../effects/cursor";
import { cameraAt, type Camera } from "../effects/zoom";
import { placeMedia, sourceToStage } from "./placement";

export interface SceneLayer {
  clipId: string;
  trackId: string;
  content: ClipContent;
  mediaId?: string;
  /** Time inside the source media to show (ms). */
  sourceTimeMs: number;
  frame: Rect;
  crop?: Crop;
  opacity: number;
  cornerRadius: number;
  /** Shadow intensity (three stacked soft layers). */
  shadow: number;
  /** How media fills its frame: "contain" letterboxes, "cover" crops to fill. */
  fit: "contain" | "cover";
  /** Drawn inside the zooming camera (screen and its cursor) or above it (overlays). */
  inCamera: boolean;
  mirror: boolean;
  /** Squircle (superellipse) corners instead of circular ones. */
  squircle: boolean;
  /** Time since the clip started (ms), for animated content. */
  localMs: number;
  /** Clip transition at this moment (alpha already folded into opacity). */
  transition: TransitionState;
  /** Text entrance animation (text and callout content). */
  textAnim?: TextAnimState;
  /** Number drawn on a step clip. */
  stepNumber?: number;
  /** Green-screen key for webcam layers. */
  chroma?: WebcamLayout["chroma"];
  /** Webcam shape, border and look (beauty + colour). `shaped` = cut to the shape (bubble, side by side). */
  webcam?: { shaped: boolean; shape: WebcamShape; roundness: number; border: WebcamBorder; look: WebcamLook };
}

export interface SceneCaption {
  clipId: string;
  text: string;
  lang: string;
  style: CaptionStyle;
  alpha: number;
  /** Rise offset in font-size units. */
  dy: number;
  scale: number;
}

export interface SceneQuiz {
  markerId: string;
  question: string;
  choices: string[];
  correct: number;
  explanation: string;
  lang: string;
  localMs: number;
  showMs: number;
  /** The correct answer is revealed for the last 40 % of the card's time. */
  revealed: boolean;
}

export interface ClickRing {
  x: number;
  y: number;
  radius: number;
  alpha: number;
  lineWidth: number;
}

export interface SceneCursor {
  /** Stage position of the hotspot (inside the camera). */
  x: number;
  y: number;
  /** Cursor height in stage pixels before bounce. */
  size: number;
  scale: number;
  rotation: number;
  style: CursorStyle["style"];
  /** Motion vector over one frame, in stage pixels (for blur trails). */
  blur: { x: number; y: number };
  visible: boolean;
  rings: ClickRing[];
  ringColor: string;
  keys: KeyChip[];
}

export interface DeviceFrameInfo {
  path: string;
  width: number;
  height: number;
  /** Screen opening inside the device image, in image pixels. */
  screen: Rect;
}

export interface SceneContext {
  /** Parsed cursor tracks by media id. */
  cursorTracks?: Map<string, CursorTrack>;
  /** Device frames from extensions, by id. */
  deviceFrames?: Map<string, DeviceFrameInfo>;
}

export interface Scene {
  width: number;
  height: number;
  timeMs: number;
  background: Background;
  backgroundBlur: number;
  camera: Camera;
  /** Bottom to top. */
  layers: SceneLayer[];
  cursor?: SceneCursor;
  /** Device artwork drawn over the screen (inside the camera). */
  deviceFrame?: { path: string; frame: Rect };
  /** Directional blur while the camera pans, in stage pixels. */
  cameraBlur: { x: number; y: number };
  caption?: SceneCaption;
  quiz?: SceneQuiz;
}

type Layout = WebcamLayout["layout"];
/** Annotations that mark screen content follow the camera zoom (redactions must keep covering what they hide). */
const IN_CAMERA_CONTENT = new Set<ClipContent["type"]>(["redact", "highlight", "spotlight", "step"]);

const VISUAL_TRACKS = new Set<Track["kind"]>(["screen", "webcam", "video", "image", "annotation", "caption"]);

/** The rectangle the screen recording sits in after padding. */
export function contentFrame(project: Project): Rect {
  const { width, height, padding } = project.canvas;
  const inset = Math.round(Math.min(width, height) * padding);
  return { x: inset, y: inset, width: width - inset * 2, height: height - inset * 2 };
}

/** Webcam bubble placement (anchor or custom position), optionally shrunk while zoomed in. */
export function bubbleFrame(project: Project, cameraScale = 1): Rect {
  const { width: W, height: H } = project.canvas;
  const w = project.webcam;
  const min = Math.min(W, H);
  let size = (min * w.sizePct) / 100;
  if (w.reactToZoom && cameraScale > 1) size /= cameraScale;
  size = Math.round(Math.min(min - 2 * w.marginPx, Math.max(56, size)));
  const m = w.marginPx;
  // Proportions (1:1, 16:9, 3:4…) keep the bubble's area; never larger than the canvas.
  let { width: bw, height: bh } = bubbleSize(size, w.aspect);
  const fit = Math.min(1, (W - 2 * m) / bw, (H - 2 * m) / bh);
  bw = Math.round(bw * fit);
  bh = Math.round(bh * fit);
  let cx: number, cy: number;
  if (w.anchor === "custom") {
    cx = w.x * W;
    cy = w.y * H;
  } else {
    const [v, h] = w.anchor === "center" ? ["center", "center"] : w.anchor.includes("-") ? w.anchor.split("-") : ["top", "bottom"].includes(w.anchor) ? [w.anchor, "center"] : ["center", w.anchor];
    cx = h === "left" ? m + bw / 2 : h === "right" ? W - m - bw / 2 : W / 2;
    cy = v === "top" ? m + bh / 2 : v === "bottom" ? H - m - bh / 2 : H / 2;
  }
  const x = Math.min(W - m - bw, Math.max(m, cx - bw / 2));
  const y = Math.min(H - m - bh, Math.max(m, cy - bh / 2));
  return { x: Math.round(x), y: Math.round(y), width: bw, height: bh };
}

/** Kept for earlier callers: the bubble at rest. */
export const defaultBubbleFrame = (project: Project): Rect => bubbleFrame(project, 1);

export function isClipActive(clip: Clip, timeMs: number): boolean {
  return timeMs >= clip.startMs && timeMs < clip.startMs + clip.durationMs;
}

/** Source-media time for a timeline time, respecting the clip's in-point and speed. */
export function sourceTime(clip: Clip, timeMs: number): number {
  return clip.sourceInMs + (timeMs - clip.startMs) * clip.speed;
}

/** Fade multiplier in [0,1] at a timeline time. */
export function fadeAt(clip: Clip, timeMs: number): number {
  const local = timeMs - clip.startMs;
  const fadeIn = clip.fadeInMs > 0 ? Math.min(1, local / clip.fadeInMs) : 1;
  const fadeOut = clip.fadeOutMs > 0 ? Math.min(1, (clip.durationMs - local) / clip.fadeOutMs) : 1;
  return Math.max(0, Math.min(fadeIn, fadeOut));
}

const activeOn = (project: Project, kind: Track["kind"], t: number) => {
  for (const track of project.tracks) {
    if (track.kind !== kind || track.hidden) continue;
    const clip = project.clips.find((c) => c.trackId === track.id && !c.hidden && isClipActive(c, t));
    if (clip) return { track, clip };
  }
  return null;
};

/** Screen picture frame for this time: padded box, side-by-side layout, or inside a device frame. */
function screenFrame(project: Project, t: number, ctx: SceneContext, layout: Layout): { frame: Rect; device?: { path: string; frame: Rect } } {
  const box = contentFrame(project);
  let frame = box;
  if (layout === "side" && activeOn(project, "webcam", t)) {
    const gap = Math.round(box.width * 0.02);
    frame = { ...box, width: Math.round(box.width * 0.68) - gap };
  }
  const device = project.canvas.deviceFrame ? ctx.deviceFrames?.get(project.canvas.deviceFrame) : undefined;
  if (!device) return { frame };
  // Fit the device artwork into the frame; the screen goes into its opening.
  const k = Math.min(frame.width / device.width, frame.height / device.height);
  const dw = device.width * k, dh = device.height * k;
  const dx = frame.x + (frame.width - dw) / 2, dy = frame.y + (frame.height - dh) / 2;
  return {
    frame: { x: dx + device.screen.x * k, y: dy + device.screen.y * k, width: device.screen.width * k, height: device.screen.height * k },
    device: { path: device.path, frame: { x: dx, y: dy, width: dw, height: dh } },
  };
}

function webcamFrame(project: Project, cameraScale: number, layout: Layout): { frame: Rect; radius: number } | null {
  const w = project.webcam;
  const { width: W, height: H } = project.canvas;
  if (layout === "hidden") return null;
  if (layout === "full") return { frame: { x: 0, y: 0, width: W, height: H }, radius: 0 };
  if (layout === "side") {
    const box = contentFrame(project);
    // Right of the screen picture (which takes 68 % minus a 2 % gap).
    const x = box.x + Math.round(box.width * 0.68);
    return { frame: { x, y: box.y, width: box.x + box.width - x, height: box.height }, radius: project.canvas.cornerRadius };
  }
  const frame = bubbleFrame(project, cameraScale);
  return { frame, radius: (Math.min(frame.width, frame.height) / 2) * Math.sqrt(w.roundness / 100) };
}

export function buildScene(project: Project, timeMs: number, ctx: SceneContext = {}): Scene {
  const { canvas } = project;
  const W = canvas.width, H = canvas.height;
  const lay = layoutAt(project, timeMs);
  const screenNow = screenFrame(project, timeMs, ctx, lay.layout);
  const screen = lay.from !== undefined
    ? { ...screenNow, frame: mixRect(screenFrame(project, timeMs, ctx, lay.from).frame, screenNow.frame, lay.k) }
    : screenNow;
  /** Webcam frame with layout morphs; alpha fades the webcam in/out of "hidden". */
  const camFrame = (scale: number): { frame: Rect; radius: number; alpha: number } | null => {
    const to = webcamFrame(project, scale, lay.layout);
    if (lay.from === undefined) return to && { ...to, alpha: 1 };
    const from = webcamFrame(project, scale, lay.from);
    if (to && from) return { frame: mixRect(from.frame, to.frame, lay.k), radius: from.radius + (to.radius - from.radius) * lay.k, alpha: 1 };
    if (to) return { ...to, alpha: lay.k };
    return from && { ...from, alpha: 1 - lay.k };
  };
  const steps = stepNumbers(project);

  // Map screen-source coordinates to stage through the active screen clip.
  const screenActive = activeOn(project, "screen", timeMs);
  const screenMedia = screenActive?.clip.mediaId ? project.media.find((m) => m.id === screenActive.clip.mediaId) : undefined;
  const mw = screenMedia?.width ?? 1920, mh = screenMedia?.height ?? 1080;
  const screenFrameRect = screenActive?.clip.frame ?? screen.frame;
  const placement = placeMedia(mw, mh, screenFrameRect, screenActive?.clip.crop, "contain");
  const toStage = (p: { x: number; y: number }) => sourceToStage(p, mw, mh, placement);

  // Cursor track (from the cursor lane) as a function of timeline time.
  const cursorLane = activeOn(project, "cursor", timeMs);
  const track = cursorLane?.clip.mediaId ? ctx.cursorTracks?.get(cursorLane.clip.mediaId) : undefined;
  const captureKind = (project.effects.take as { captureKind?: string } | undefined)?.captureKind;
  const cursorMappable = !!track && !!screenActive && captureKind !== "window";
  const cursorClip = cursorLane?.clip;
  const cursorRange = cursorClip ? { startMs: cursorClip.sourceInMs, endMs: cursorClip.sourceInMs + cursorClip.durationMs * cursorClip.speed } : { startMs: 0, endMs: 0 };
  const cursorAt = (t: number) => {
    if (!track || !cursorClip || !cursorMappable) return null;
    const st = cursorStateAt(track, sourceTime(cursorClip, Math.min(Math.max(t, cursorClip.startMs), cursorClip.startMs + cursorClip.durationMs)), { ...project.cursor, clickEffect: "none", keystrokes: false, clickBounce: 0 }, cursorRange, { width: W });
    return st?.pos ?? null;
  };

  const camera = screenActive
    ? cameraAt(project, timeMs, { stage: { width: W, height: H }, toStage, screenFraction: placement.dw / W, cursorAt })
    : { scale: 1, cx: W / 2, cy: H / 2 };

  // Track order in the project = lane order in the timeline, top lane drawn on top.
  const layers: SceneLayer[] = [];
  for (const lane of [...project.tracks].reverse()) {
    if (lane.hidden || !VISUAL_TRACKS.has(lane.kind)) continue;
    const laneClips = project.clips.filter((c) => c.trackId === lane.id && !c.hidden);
    for (const clip of laneClips) {
      if (!isClipActive(clip, timeMs) || clip.content.type === "caption") continue;
      const isScreen = lane.kind === "screen";
      const isWebcam = lane.kind === "webcam";
      let frame: Rect;
      let radius = 0;
      let alpha = 1;
      if (isScreen) {
        frame = clip.frame ?? screen.frame;
        radius = screen.device ? 0 : canvas.cornerRadius;
      } else if (isWebcam) {
        const cam = camFrame(camera.scale);
        if (!cam) continue;
        frame = clip.frame ?? cam.frame;
        radius = clip.frame ? 0 : cam.radius;
        alpha = cam.alpha;
      } else {
        frame = clip.frame ?? { x: 0, y: 0, width: W, height: H };
      }
      const transition = transitionAt(clip, timeMs);
      const localMs = timeMs - clip.startMs;
      const c = clip.content;
      const base: SceneLayer = {
        clipId: clip.id,
        trackId: lane.id,
        content: c,
        mediaId: clip.mediaId,
        sourceTimeMs: sourceTime(clip, timeMs),
        frame,
        crop: clip.crop,
        opacity: clip.opacity * lane.opacity * fadeAt(clip, timeMs) * alpha,
        cornerRadius: radius,
        shadow: isScreen ? (screen.device ? 0 : canvas.shadow) : isWebcam && lay.layout === "bubble" ? project.webcam.shadow * 2 : 0,
        fit: isWebcam ? "cover" : "contain",
        inCamera: isScreen || IN_CAMERA_CONTENT.has(c.type),
        mirror: isWebcam && project.webcam.mirror,
        squircle: isScreen,
        localMs,
        transition: NO_TRANSITION,
      };
      // Dissolve: hold the previous clip's last frame underneath while this one fades in.
      const partner = transition.alpha < 1 ? dissolvePartner(laneClips, clip) : undefined;
      if (partner) {
        const lastMs = partner.startMs + partner.durationMs - 1;
        layers.push({ ...base, clipId: partner.id, content: partner.content, mediaId: partner.mediaId, sourceTimeMs: sourceTime(partner, lastMs), crop: partner.crop, opacity: partner.opacity * lane.opacity * alpha, localMs: lastMs - partner.startMs });
      }
      layers.push({
        ...base,
        opacity: base.opacity * transition.alpha,
        transition,
        textAnim: c.type === "text" || c.type === "callout" ? textAnimationAt(c.text, c.type === "text" ? c.animation : "pop", localMs) : undefined,
        stepNumber: c.type === "step" ? steps.get(clip.id) : undefined,
        chroma: isWebcam && project.webcam.chroma.enabled ? project.webcam.chroma : undefined,
        webcam: isWebcam ? webcamStyle(project, lay.layout, clip.frame ?? frame) : undefined,
      });
    }
  }

  // Cursor and click rings, drawn inside the camera on top of the screen.
  let cursor: SceneCursor | undefined;
  if (track && cursorClip && cursorMappable && project.cursor) {
    const style = project.cursor;
    const tt = sourceTime(cursorClip, timeMs);
    const state = cursorStateAt(track, tt, style, cursorRange, { width: W });
    if (state) {
      const p = toStage(state.pos);
      const pPrev = toStage({ x: state.pos.x - state.velocity.x / 60, y: state.pos.y - state.velocity.y / 60 });
      const size = 28 * style.size * (W / 1920);
      const rings: ClickRing[] = state.clicks.map((c) => {
        const at = toStage(c);
        const rem = c.remaining;
        const base = Math.max(12, 0.55 * size * style.clickScale);
        const k = 1 - rem * rem * rem;
        return {
          x: at.x,
          y: at.y,
          radius: base + k * size * 1.95 * style.clickScale,
          alpha: 0.6 * rem * rem * rem * style.clickOpacity,
          lineWidth: Math.max(2, size * 0.12),
        };
      });
      cursor = {
        x: p.x,
        y: p.y,
        size,
        scale: state.scale,
        rotation: state.rotation,
        style: style.style,
        blur: { x: (p.x - pPrev.x) * style.motionBlur, y: (p.y - pPrev.y) * style.motionBlur },
        visible: style.visible && p.inside && cursorLane!.track.hidden !== true,
        rings: style.clickEffect === "echo" ? rings.flatMap((r) => [r, { ...r, radius: r.radius * 0.6, alpha: r.alpha * 0.6 }]) : rings,
        ringColor: style.clickColor,
        keys: state.keys,
      };
    }
  }

  // Pan blur from camera motion over one frame.
  const prevCam = screenActive && project.zoom.motionBlur > 0 && project.zooms.length
    ? cameraAt(project, timeMs - 1000 / canvas.fps, { stage: { width: W, height: H }, toStage, screenFraction: placement.dw / W, cursorAt })
    : camera;
  const cameraBlur = {
    x: (camera.cx - prevCam.cx) * camera.scale * project.zoom.motionBlur,
    y: (camera.cy - prevCam.cy) * camera.scale * project.zoom.motionBlur,
  };

  return {
    width: W,
    height: H,
    timeMs,
    background: canvas.background,
    backgroundBlur: canvas.backgroundBlur,
    camera,
    layers,
    cursor,
    deviceFrame: screen.device,
    cameraBlur,
    caption: captionAt(project, timeMs),
    quiz: sceneQuiz(project, timeMs),
  };
}

/** Shape/border/look of the webcam for the current layout. */
function webcamStyle(project: Project, layout: Layout, frame: Rect): SceneLayer["webcam"] {
  const w = project.webcam;
  const side = layout === "side";
  const shaped = layout === "bubble" || side;
  const shape: WebcamShape = side ? "rounded" : (w.shape ?? (w.roundness >= 100 ? "circle" : "rounded"));
  const roundness = side ? project.canvas.cornerRadius / Math.max(1, Math.min(frame.width, frame.height)) : w.roundness / 200;
  return { shaped, shape, roundness, border: shaped ? w.border : { ...w.border, style: "none" }, look: w.look };
}

function captionAt(project: Project, t: number): SceneCaption | undefined {
  const lanes = new Map(project.tracks.filter((tr) => tr.kind === "caption").map((tr) => [tr.id, tr]));
  const clip = captionClips(project).find((c) => !c.hidden && !lanes.get(c.trackId)?.hidden && isClipActive(c, t));
  if (!clip || clip.content.type !== "caption") return undefined;
  const style = project.captionStyle;
  const anim = textAnimationAt(clip.content.text, style.animation, t - clip.startMs);
  return { clipId: clip.id, text: clip.content.text, lang: clip.content.lang, style, alpha: anim.alpha * fadeAt(clip, t), dy: anim.dy, scale: anim.scale };
}

function sceneQuiz(project: Project, t: number): SceneQuiz | undefined {
  const hit = quizAt(project, t);
  if (!hit?.marker.quiz) return undefined;
  const q = hit.marker.quiz;
  return { markerId: hit.marker.id, question: q.question, choices: q.choices, correct: q.correct, explanation: q.explanation, lang: q.lang, localMs: hit.localMs, showMs: q.showMs, revealed: hit.localMs >= q.showMs * 0.6 };
}
