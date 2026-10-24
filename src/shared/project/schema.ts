/**
 * The `.tdrec` project format: a JSON document holding source-media paths plus
 * the complete editor state. Raw recordings are never modified or embedded.
 *
 * Times are milliseconds (floats allowed); geometry is in canvas pixels.
 */
import { z } from "zod";
import { BORDER_STYLES, BUBBLE_ASPECTS, LOOK_PRESETS, WEBCAM_SHAPES } from "../effects/webcamStyle";

export const PROJECT_FORMAT = "tdrec";
export const PROJECT_VERSION = 1;

/** Fixed recording lanes plus open-ended extra lanes. */
export const TrackKind = z.enum([
  "screen",
  "webcam",
  "mic",
  "system",
  "video",
  "image",
  "audio",
  "annotation",
  "caption",
  /** Cursor/click/keystroke metadata of a take, drawn by the renderer (Stage 4). */
  "cursor",
]);
export type TrackKind = z.infer<typeof TrackKind>;

export const MediaKind = z.enum(["video", "audio", "image", "cursor"]);
export type MediaKind = z.infer<typeof MediaKind>;

export const Media = z.object({
  id: z.string(),
  kind: MediaKind,
  /** Which recorder input produced it, or "import" for user-added files. */
  origin: z.enum(["screen", "webcam", "mic", "system", "cursor", "import"]),
  /** Absolute path at save time. */
  path: z.string(),
  /** Path relative to the project file, used when the folder is moved. */
  relativePath: z.string().optional(),
  durationMs: z.number().nonnegative(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  /** Shared recording clock offset so all inputs of one take line up. */
  clockOffsetMs: z.number().default(0),
});
export type Media = z.infer<typeof Media>;

export const Track = z.object({
  id: z.string(),
  kind: TrackKind,
  name: z.string(),
  locked: z.boolean().default(false),
  muted: z.boolean().default(false),
  solo: z.boolean().default(false),
  hidden: z.boolean().default(false),
  volume: z.number().min(0).max(4).default(1),
  pan: z.number().min(-1).max(1).default(0),
  opacity: z.number().min(0).max(1).default(1),
  /** Audio effects for every clip on this lane (Stage 5). */
  audioFx: z.lazy(() => AudioFx).optional(),
});
export type Track = z.infer<typeof Track>;

// ---------------- Stage 5: audio tools ----------------

export const AudioFx = z.object({
  eq: z
    .object({
      enabled: z.boolean().default(false),
      /** Remove rumble below this frequency (0 = off). */
      highpassHz: z.number().min(0).max(400).default(80),
      lowGain: z.number().min(-18).max(18).default(0),
      midGain: z.number().min(-18).max(18).default(0),
      midHz: z.number().min(200).max(6000).default(1800),
      highGain: z.number().min(-18).max(18).default(0),
    })
    .default({ enabled: false, highpassHz: 80, lowGain: 0, midGain: 0, midHz: 1800, highGain: 0 }),
  compressor: z
    .object({
      enabled: z.boolean().default(false),
      thresholdDb: z.number().min(-60).max(0).default(-20),
      ratio: z.number().min(1).max(20).default(3),
      attackMs: z.number().min(0).max(1000).default(10),
      releaseMs: z.number().min(10).max(2000).default(200),
      kneeDb: z.number().min(0).max(40).default(6),
      makeupDb: z.number().min(0).max(24).default(4),
    })
    .default({ enabled: false, thresholdDb: -20, ratio: 3, attackMs: 10, releaseMs: 200, kneeDb: 6, makeupDb: 4 }),
  leveling: z
    .object({
      enabled: z.boolean().default(false),
      /** Target loudness in LUFS (−16 is common for online video). */
      targetLufs: z.number().min(-30).max(-8).default(-16),
    })
    .default({ enabled: false, targetLufs: -16 }),
  noise: z
    .object({
      enabled: z.boolean().default(false),
      /** 0–1: how strongly the learned noise profile is removed. */
      amount: z.number().min(0).max(1).default(0.7),
    })
    .default({ enabled: false, amount: 0.7 }),
});
export type AudioFx = z.infer<typeof AudioFx>;

export const Rect = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive(),
});
export type Rect = z.infer<typeof Rect>;

export const Crop = z.object({
  left: z.number().min(0).max(1).default(0),
  top: z.number().min(0).max(1).default(0),
  right: z.number().min(0).max(1).default(0),
  bottom: z.number().min(0).max(1).default(0),
});
export type Crop = z.infer<typeof Crop>;

/** Content for clips that are not backed by a media file. */
export const ClipContent = z.discriminatedUnion("type", [
  z.object({ type: z.literal("media") }),
  z.object({ type: z.literal("solid"), color: z.string() }),
  z.object({
    type: z.literal("text"),
    text: z.string(),
    fontSize: z.number().positive().default(64),
    color: z.string().default("#ffffff"),
    /** BCP-47 tag; "bo" selects Noto Serif Tibetan and Tibetan line rules. */
    lang: z.string().default("en"),
    bold: z.boolean().default(false),
    /** Font family (installed or built in); unset = Noto Serif Tibetan / system UI font. Tibetan always falls back to Noto Serif Tibetan. */
    fontFamily: z.string().max(200).optional(),
    align: z.enum(["left", "center", "right"]).default("center"),
    /** Optional box behind the text. */
    background: z.string().optional(),
    /** Entrance animation (Tibetan-safe: typewriter reveals whole syllables). */
    animation: z.enum(["none", "fade", "typewriter", "rise", "pop", "wipe"]).default("none"),
  }),
  /** Speech-bubble / box callout with text and a pointer tail ending at (tailX, tailY). */
  z.object({
    type: z.literal("callout"),
    text: z.string(),
    lang: z.string().default("en"),
    style: z.enum(["bubble", "box", "pill"]).default("bubble"),
    fill: z.string().default("#ffffff"),
    color: z.string().default("#1b2350"),
    border: z.string().default("#d4a94a"),
    fontSize: z.number().positive().default(44),
    /** Font family (installed or built in); unset = Noto Serif Tibetan / system UI font. Tibetan always falls back to Noto Serif Tibetan. */
    fontFamily: z.string().max(200).optional(),
    tailX: z.number().optional(),
    tailY: z.number().optional(),
  }),
  /** Translucent highlighter over the frame rectangle. */
  z.object({ type: z.literal("highlight"), color: z.string().default("#ffe066"), opacity: z.number().min(0).max(1).default(0.35) }),
  /** Dim everything except the frame (rectangle or ellipse). */
  z.object({
    type: z.literal("spotlight"),
    shape: z.enum(["rect", "ellipse"]).default("ellipse"),
    dim: z.number().min(0).max(1).default(0.6),
    feather: z.number().min(0).default(24),
  }),
  /** Hide private information under the frame: blur, pixelate or a solid block. */
  z.object({
    type: z.literal("redact"),
    mode: z.enum(["blur", "pixelate", "solid"]).default("pixelate"),
    strength: z.number().min(1).max(100).default(24),
    color: z.string().default("#14151c"),
  }),
  /** Numbered step marker; number = order among step clips unless set. */
  z.object({
    type: z.literal("step"),
    number: z.number().int().positive().optional(),
    fill: z.string().default("#d4a94a"),
    color: z.string().default("#1a1408"),
  }),
  /** Animated title template (intro, outro, lower third, chapter, quote, centre title). */
  z.object({
    type: z.literal("title"),
    template: z.enum(["center", "lowerThird", "chapter", "quote", "intro", "outro"]),
    title: z.string(),
    subtitle: z.string().default(""),
    lang: z.string().default("en"),
    accent: z.string().default("#d4a94a"),
    color: z.string().default("#ffffff"),
    background: z.string().default("#14151c"),
    /** Font family (installed or built in); unset = Noto Serif Tibetan / system UI font. Tibetan always falls back to Noto Serif Tibetan. */
    fontFamily: z.string().max(200).optional(),
  }),
  /** One caption cue (on a caption lane). */
  z.object({ type: z.literal("caption"), text: z.string(), lang: z.string().default("en") }),
  /** Figure annotations. Arrow/line use (x1,y1)->(x2,y2) in canvas pixels; rect/ellipse use the clip frame. */
  z.object({
    type: z.literal("shape"),
    shape: z.enum(["arrow", "line", "rect", "ellipse"]),
    color: z.string().default("#e8c56a"),
    strokeWidth: z.number().min(0).default(8),
    fill: z.string().optional(),
    x1: z.number().default(0),
    y1: z.number().default(0),
    x2: z.number().default(0),
    y2: z.number().default(0),
  }),
]);
export type ClipContent = z.infer<typeof ClipContent>;

export const Clip = z.object({
  id: z.string(),
  trackId: z.string(),
  mediaId: z.string().optional(),
  content: ClipContent.default({ type: "media" }),
  /** Position on the timeline. */
  startMs: z.number().nonnegative(),
  /** Length on the timeline (after speed is applied). */
  durationMs: z.number().positive(),
  /** Where playback starts inside the source media. */
  sourceInMs: z.number().nonnegative().default(0),
  speed: z.number().positive().default(1),
  /** Clips sharing a link group move/trim together; unset = independent. */
  linkGroup: z.string().optional(),
  frame: Rect.optional(),
  crop: Crop.optional(),
  opacity: z.number().min(0).max(1).default(1),
  volume: z.number().min(0).max(4).default(1),
  fadeInMs: z.number().nonnegative().default(0),
  fadeOutMs: z.number().nonnegative().default(0),
  muted: z.boolean().default(false),
  hidden: z.boolean().default(false),
  locked: z.boolean().default(false),
  transitionIn: z.lazy(() => Transition).optional(),
  transitionOut: z.lazy(() => Transition).optional(),
});
export type Clip = z.infer<typeof Clip>;

export const TRANSITIONS = ["fade", "dissolve", "slide-left", "slide-right", "slide-up", "slide-down", "wipe", "zoom", "blur"] as const;
export const Transition = z.object({
  type: z.enum(TRANSITIONS),
  durationMs: z.number().min(50).max(5000).default(600),
});
export type Transition = z.infer<typeof Transition>;

export const Marker = z.object({
  id: z.string(),
  timeMs: z.number().nonnegative(),
  label: z.string().default(""),
  kind: z.enum(["marker", "chapter", "quiz", "pause"]).default("marker"),
  /** Quiz shown at this marker (kind "quiz"). */
  quiz: z
    .object({
      question: z.string(),
      choices: z.array(z.string()).min(2).max(6),
      correct: z.number().int().min(0),
      explanation: z.string().default(""),
      lang: z.string().default("en"),
      /** How long the quiz card stays on screen in the video (ms). */
      showMs: z.number().min(1000).max(60000).default(6000),
    })
    .optional(),
});
export type Marker = z.infer<typeof Marker>;

export const Background = z.discriminatedUnion("type", [
  z.object({ type: z.literal("solid"), color: z.string() }),
  z.object({
    type: z.literal("gradient"),
    from: z.string(),
    to: z.string(),
    angleDeg: z.number().default(135),
    radial: z.boolean().default(false),
  }),
  z.object({ type: z.literal("image"), path: z.string(), blurPx: z.number().min(0).default(0) }),
  /** Built-in (drawn in code) or extension wallpaper, by id. */
  z.object({ type: z.literal("wallpaper"), id: z.string() }),
]);
export type Background = z.infer<typeof Background>;

export const Canvas = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  fps: z.number().positive(),
  background: Background,
  /** Fraction of the shorter canvas side kept as padding around the screen. */
  padding: z.number().min(0).max(0.4).default(0.06),
  /** Corner radius of the screen frame in canvas pixels (squircle corners). */
  cornerRadius: z.number().min(0).default(16),
  /** Shadow intensity under the screen frame (three stacked soft layers). */
  shadow: z.number().min(0).max(2).default(0.67),
  /** Blur applied to the background, 0-8. */
  backgroundBlur: z.number().min(0).max(8).default(0),
  /** "native", "16:9", "9:16", "1:1", "4:3", "4:5", "16:10", "10:16" or "custom". */
  aspect: z.string().default("16:9"),
  /** Device frame drawn around the screen (extension id), if any. */
  deviceFrame: z.string().optional(),
});
export type Canvas = z.infer<typeof Canvas>;

// ---------------- Stage 4: camera zoom, cursor, webcam bubble ----------------

/** Depth 1-6 -> scale. */
export const ZOOM_DEPTH_SCALE = [1, 1.25, 1.5, 1.8, 2.2, 3.5, 5.0] as const;

export const ZoomRegion = z.object({
  id: z.string(),
  startMs: z.number().nonnegative(),
  endMs: z.number().nonnegative(),
  depth: z.number().int().min(1).max(6).default(2),
  /** Focus in screen-source space (0-1, before crop). */
  focus: z.object({ x: z.number(), y: z.number() }).default({ x: 0.5, y: 0.5 }),
  /** auto: the camera follows the cursor; manual: fixed focus. */
  mode: z.enum(["auto", "manual"]).default("manual"),
  /** Suggested by auto-zoom and not yet accepted (drawn as a ghost). */
  suggested: z.boolean().default(false),
});
export type ZoomRegion = z.infer<typeof ZoomRegion>;

export const EASING_PRESETS = ["smooth", "snappy", "gentle", "linear", "custom"] as const;

export const ZoomSettings = z.object({
  zoomInMs: z.number().min(60).max(4000).default(1500),
  zoomOutMs: z.number().min(60).max(4000).default(1000),
  easing: z.enum(EASING_PRESETS).default("smooth"),
  /** Custom cubic Bezier control points (x1, y1, x2, y2). */
  customCurve: z.tuple([z.number(), z.number(), z.number(), z.number()]).default([0.16, 1, 0.3, 1]),
  /** Keep zoomed in between regions that are close together. */
  connect: z.boolean().default(true),
  /** 0 = rigid, 1 = default smoothing, up to 3 = very soft camera. */
  smoothness: z.number().min(0).max(3).default(1),
  /** Directional blur while the camera pans (0-2). */
  motionBlur: z.number().min(0).max(2).default(0.35),
});
export type ZoomSettings = z.infer<typeof ZoomSettings>;

export const CursorStyle = z.object({
  visible: z.boolean().default(true),
  style: z.enum(["arrow", "pointer", "dot"]).default("arrow"),
  /** Size multiplier (0.5-10) of a 28 px cursor at 1080p. */
  size: z.number().min(0.5).max(10).default(1),
  /** 0 = raw, 0.5 = default, 2 = very smooth. */
  smoothing: z.number().min(0).max(2).default(0.5),
  motionBlur: z.number().min(0).max(2).default(0.6),
  clickBounce: z.number().min(0).max(5).default(1),
  bounceMs: z.number().min(60).max(500).default(220),
  sway: z.number().min(0).max(2).default(0.4),
  /** Ease the cursor back to its first position at the end, for seamless loops. */
  loop: z.boolean().default(false),
  clickEffect: z.enum(["none", "ripple", "spotlight", "echo"]).default("ripple"),
  clickEffectMs: z.number().min(120).max(1200).default(600),
  clickColor: z.string().default("#4f8cff"),
  clickScale: z.number().min(0.5).max(2).default(1),
  clickOpacity: z.number().min(0).max(1).default(1),
  /** Show pressed keys/shortcuts as chips (from the metadata track). */
  keystrokes: z.boolean().default(false),
  /** Click sound from an extension (id), if any. */
  clickSound: z.string().optional(),
});
export type CursorStyle = z.infer<typeof CursorStyle>;

export const WEBCAM_ANCHORS = ["top-left", "top", "top-right", "left", "center", "right", "bottom-left", "bottom", "bottom-right"] as const;

export const WebcamLayout = z.object({
  /** bubble = corner overlay; side = screen and webcam side by side; full = webcam fills the frame. */
  layout: z.enum(["bubble", "side", "full", "hidden"]).default("bubble"),
  anchor: z.enum([...WEBCAM_ANCHORS, "custom"]).default("bottom-right"),
  /** Custom centre position (0-1) when anchor is "custom". */
  x: z.number().min(0).max(1).default(0.85),
  y: z.number().min(0).max(1).default(0.8),
  /** Size as % of the shorter canvas side (10-100). */
  sizePct: z.number().min(10).max(100).default(30),
  marginPx: z.number().min(0).max(96).default(24),
  /** 0 = square, 100 = circle. */
  roundness: z.number().min(0).max(100).default(100),
  mirror: z.boolean().default(true),
  shadow: z.number().min(0).max(1).default(0.3),
  /** Shrink the bubble while the camera is zoomed in. */
  reactToZoom: z.boolean().default(true),
  /** Green screen: make pixels near `color` transparent. */
  chroma: z
    .object({
      enabled: z.boolean().default(false),
      color: z.string().default("#00ff00"),
      similarity: z.number().min(0).max(1).default(0.4),
      smoothness: z.number().min(0).max(1).default(0.08),
      spill: z.number().min(0).max(1).default(0.3),
    })
    .default({ enabled: false, color: "#00ff00", similarity: 0.4, smoothness: 0.08, spill: 0.3 }),
  /** Remove the background without a green screen (person segmentation model). */
  removeBackground: z.boolean().default(false),
  /** Bubble shape; unset = from roundness (100 = circle, else rounded square), as in v0.1. */
  shape: z.enum(WEBCAM_SHAPES).optional(),
  /** Bubble proportions (same area as the square bubble). */
  aspect: z.enum(BUBBLE_ASPECTS).default("1:1"),
  border: z
    .object({
      style: z.enum(BORDER_STYLES).default("none"),
      /** Width in pixels at 1080p. */
      width: z.number().min(0).max(40).default(6),
      color: z.string().default("#d4a94a"),
      /** Second colour (gradient, double, neon glow). */
      color2: z.string().default("#9b1b30"),
    })
    .default({ style: "none", width: 6, color: "#d4a94a", color2: "#9b1b30" }),
  /** Beauty filters and colour look. */
  look: z
    .object({
      preset: z.enum(LOOK_PRESETS).default("none"),
      /** Skin smoothing (edges, eyes and hair stay sharp). */
      smooth: z.number().min(0).max(1).default(0),
      /** Brighten faces (skin tones only). */
      brighten: z.number().min(0).max(1).default(0),
      sharpen: z.number().min(0).max(1).default(0),
      brightness: z.number().min(-1).max(1).default(0),
      contrast: z.number().min(-1).max(1).default(0),
      saturation: z.number().min(-1).max(1).default(0),
      temperature: z.number().min(-1).max(1).default(0),
      tint: z.number().min(-1).max(1).default(0),
      fade: z.number().min(0).max(1).default(0),
      vignette: z.number().min(0).max(1).default(0),
    })
    .default({ preset: "none", smooth: 0, brighten: 0, sharpen: 0, brightness: 0, contrast: 0, saturation: 0, temperature: 0, tint: 0, fade: 0, vignette: 0 }),
});
export type WebcamLayout = z.infer<typeof WebcamLayout>;
export type WebcamLook = WebcamLayout["look"];
export type WebcamBorder = WebcamLayout["border"];

// ---------------- Stage 5: layouts over time, captions, analysis ----------------

export const LayoutSegment = z.object({
  id: z.string(),
  startMs: z.number().nonnegative(),
  layout: z.enum(["bubble", "side", "full", "hidden"]),
});
export type LayoutSegment = z.infer<typeof LayoutSegment>;

export const CaptionStyle = z.object({
  /** Font size at 1080p. */
  fontSize: z.number().min(16).max(120).default(44),
  color: z.string().default("#ffffff"),
  background: z.string().default("#000000"),
  backgroundOpacity: z.number().min(0).max(1).default(0.75),
  position: z.enum(["bottom", "top"]).default("bottom"),
  /** Distance from the edge, % of canvas height. */
  offsetPct: z.number().min(0).max(40).default(7),
  /** Maximum line width, % of canvas width. */
  maxWidthPct: z.number().min(30).max(95).default(70),
  rows: z.number().int().min(1).max(4).default(2),
  fontFamily: z.string().max(200).optional(),
  animation: z.enum(["none", "fade", "rise", "pop"]).default("fade"),
});
export type CaptionStyle = z.infer<typeof CaptionStyle>;

/** Results of background analysis per media file (noise profile, loudness). */
export const MediaAnalysis = z.object({
  /** Noise magnitude per FFT bin (512-point FFT -> 257 bins). */
  noiseProfile: z.array(z.number()).optional(),
  /** Integrated loudness estimate, LUFS. */
  loudnessLufs: z.number().optional(),
  peakDb: z.number().optional(),
});
export type MediaAnalysis = z.infer<typeof MediaAnalysis>;

export const EditorState = z.object({
  playheadMs: z.number().nonnegative().default(0),
  /** Timeline zoom: pixels per second. */
  pixelsPerSecond: z.number().positive().default(80),
  selectedClipIds: z.array(z.string()).default([]),
});

export const Project = z.object({
  format: z.literal(PROJECT_FORMAT),
  version: z.literal(PROJECT_VERSION),
  id: z.string(),
  name: z.string(),
  createdAt: z.string(),
  modifiedAt: z.string(),
  canvas: Canvas,
  media: z.array(Media),
  tracks: z.array(Track),
  clips: z.array(Clip),
  markers: z.array(Marker).default([]),
  editor: EditorState.default({ playheadMs: 0, pixelsPerSecond: 80, selectedClipIds: [] }),
  zooms: z.array(ZoomRegion).default([]),
  zoom: ZoomSettings.default(ZoomSettings.parse({})),
  cursor: CursorStyle.default(CursorStyle.parse({})),
  webcam: WebcamLayout.default(WebcamLayout.parse({})),
  /** Layout switches over time (one-click layout buttons); empty = webcam.layout throughout. */
  layouts: z.array(LayoutSegment).default([]),
  captionStyle: CaptionStyle.default(CaptionStyle.parse({})),
  analysis: z.record(z.string(), MediaAnalysis).default({}),
  /** Other feature settings (take info, later stages). */
  effects: z.record(z.string(), z.unknown()).default({}),
});
export type Project = z.infer<typeof Project>;

export class ProjectFormatError extends Error {}

/** Parse untrusted JSON into a Project, migrating older versions. */
export function parseProject(json: unknown): Project {
  if (typeof json !== "object" || json === null) throw new ProjectFormatError("Not a project file");
  const candidate = json as { format?: unknown; version?: unknown };
  if (candidate.format !== PROJECT_FORMAT) throw new ProjectFormatError("Not a .tdrec project");
  if (typeof candidate.version === "number" && candidate.version > PROJECT_VERSION)
    throw new ProjectFormatError(
      `Project version ${candidate.version} is newer than this app supports (${PROJECT_VERSION})`,
    );
  const result = Project.safeParse(json);
  if (!result.success) throw new ProjectFormatError(z.prettifyError(result.error));
  return result.data;
}

export function serializeProject(project: Project): string {
  return JSON.stringify(project, null, 2) + "\n";
}

/** Defaults for new text content (bold/align/animation), for code that builds text clips. */
export const TEXT_DEFAULTS = { bold: false, align: "center", animation: "none" } as const;
