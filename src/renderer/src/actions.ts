/**
 * Every editor command in one place: menus, toolbar buttons and keyboard
 * shortcuts all call runAction(id).
 */
import { newId } from "@shared/project/factory";
import { AudioFx, TEXT_DEFAULTS, type Clip, type ClipContent, type Media, type Project, type TrackKind, type Transition } from "@shared/project/schema";
import { setLayoutFrom } from "@shared/effects/layouts";
import { toSrt, toVtt } from "@shared/captions/captions";
import { laneCues } from "./mediaJobs";
import * as ops from "@shared/timeline/ops";
import { DEFAULT_SLOW_DOWN, DEFAULT_SPEED_UP } from "@shared/timeline/regions";
import { useEditor } from "./store";

const IMAGE_EXT = /\.(png|jpe?g|webp|gif)$/i;
const AUDIO_EXT = /\.(mp3|wav|m4a|aac|ogg|opus|flac)$/i;
const IMAGE_DEFAULT_MS = 5000;

/** Actions handled outside the store (files, dialogs). Returns true if handled. */
export type ExternalHandler = (id: string) => boolean;

export function runAction(id: string, external?: ExternalHandler): void {
  const s = useEditor.getState();
  const frameMs = 1000 / s.history.present.canvas.fps;
  switch (id) {
    case "transport.playPause": return s.setPlaying(!s.playing);
    case "transport.play": return s.setPlaying(true);
    case "transport.pause": return s.setPlaying(false);
    case "transport.back": return s.setPlayhead(s.playheadMs - 1000);
    case "transport.prevFrame": s.setPlaying(false); return s.setPlayhead(s.playheadMs - frameMs);
    case "transport.nextFrame": s.setPlaying(false); return s.setPlayhead(s.playheadMs + frameMs);
    case "transport.start": return s.setPlayhead(0);
    case "transport.end": return s.setPlayhead(s.duration());
    case "edit.undo": return s.undo();
    case "edit.redo": return s.redo();
    case "edit.split": return s.split();
    case "edit.delete": return s.selectedZoomId ? s.deleteSelectedZoom() : s.deleteSelection(false);
    case "edit.rippleDelete": return s.deleteSelection(true);
    case "edit.duplicate": return s.duplicateSelection();
    case "edit.copy": return s.copySelection();
    case "edit.cut": return s.cutSelection();
    case "edit.paste": return s.paste();
    case "edit.selectAll": return s.selectAll();
    case "edit.link": return s.linkSelection();
    case "edit.unlink": return s.unlinkSelection();
    case "insert.marker": return s.addMarkerAtPlayhead("marker");
    case "insert.chapter": return s.addMarkerAtPlayhead("chapter");
    case "insert.quiz": return s.addMarkerAtPlayhead("quiz");
    case "insert.text": return insertText();
    case "insert.videoTrack": return addLane("video");
    case "insert.imageTrack": return addLane("image");
    case "insert.audioTrack": return addLane("audio");
    case "insert.annotationTrack": return addLane("annotation");
    case "insert.captionTrack": return addLane("caption");
    case "view.zoomIn": return s.setZoom(s.pps * 1.5);
    case "view.zoomOut": return s.setZoom(s.pps / 1.5);
    case "view.fitTimeline": return void window.dispatchEvent(new Event("tdr:fit-timeline"));
    case "view.snapping": return s.toggleSnapping();
    case "file.import": return void importMedia();
    // Stage 4: camera, speed, styling, annotations
    case "effects.zoomRegion": return s.addZoomAtPlayhead();
    case "effects.autoZoom": return s.suggestZooms();
    case "effects.speedUp": return s.applySpeed(DEFAULT_SPEED_UP);
    case "effects.slowDown": return s.applySpeed(DEFAULT_SLOW_DOWN);
    case "range.in": return s.setIn();
    case "range.out": return s.setOut();
    case "range.clear": return s.clearInOut();
    case "effects.cursor": return selectLane("cursor");
    case "effects.webcamBubble":
    case "effects.layouts":
      return selectLane("webcam");
    case "effects.background":
      s.select([]);
      s.selectZoom(null);
      return s.selectTrack(null);
    case "insert.image": return void insertImage();
    case "insert.arrow": return insertShape("arrow");
    case "insert.shape": return insertShape("rect");
    // Stage 5: callouts, privacy, teaching, titles, layouts, audio tools
    case "insert.callout": return void insertAnnotation("insert.callout", calloutContent(), (W, H) => ({ x: W * 0.52, y: H * 0.16, width: W * 0.3, height: H * 0.13 }));
    case "insert.highlight": return void insertAnnotation("insert.highlight", { type: "highlight", color: "#ffe066", opacity: 0.35 }, (W, H) => ({ x: W * 0.3, y: H * 0.46, width: W * 0.4, height: H * 0.07 }));
    case "insert.spotlight": return void insertAnnotation("insert.spotlight", { type: "spotlight", shape: "ellipse", dim: 0.6, feather: 24 }, (W, H) => ({ x: W * 0.35, y: H * 0.3, width: W * 0.3, height: H * 0.4 }));
    case "insert.blurRegion": return void insertAnnotation("insert.blurRegion", { type: "redact", mode: "pixelate", strength: 24, color: "#14151c" }, (W, H) => ({ x: W * 0.35, y: H * 0.42, width: W * 0.3, height: H * 0.12 }));
    case "insert.stepNumber": return void insertAnnotation("insert.stepNumber", { type: "step", fill: "#d4a94a", color: "#1a1408" }, (W, H) => ({ x: W * 0.47, y: H * 0.45, width: H * 0.09, height: H * 0.09 }));
    case "insert.keystrokes":
      return s.edit("insert.keystrokes", (p) => ({ ...p, cursor: { ...p.cursor, keystrokes: !p.cursor.keystrokes } }));
    case "effects.transitions": return applyTransitions({ type: "fade", durationMs: 600 });
    case "effects.titles":
    case "effects.library":
      return s.setPanelTab("library");
    case "effects.greenScreen": return selectLane("webcam");
    case "effects.removeBackground": return selectLane("webcam");
    case "audio.noiseRemoval": return enableAudioTool("noise");
    case "audio.leveling": return enableAudioTool("leveling");
    case "audio.equalizer": return enableAudioTool("eq");
    case "audio.compressor": return enableAudioTool("compressor");
    case "audio.fadeIn": return s.edit("audio.fadeIn", (p) => ops.setClipProps(p, s.selection, { fadeInMs: 500 }));
    case "audio.fadeOut": return s.edit("audio.fadeOut", (p) => ops.setClipProps(p, s.selection, { fadeOutMs: 500 }));
    case "audio.captions": return s.setPanelTab("captions");
    case "export.subtitles": return void exportSubtitles("srt");
    case "export.queue": return s.setPanelTab("jobs");
    case "file.export":
    case "export.video":
      return s.setExportDialog("video");
    case "export.audioOnly": return s.setExportDialog("audio");
    case "export.tracks": return s.setExportDialog("tracks");
    case "export.batch": return s.setExportDialog("batch");
    case "panel.properties":
    case "panel.library":
    case "panel.captions":
    case "panel.teaching":
    case "panel.jobs":
      return s.setPanelTab(id.slice(6) as Parameters<typeof s.setPanelTab>[0]);
    default:
      if (id.startsWith("title.")) return void insertTitle(id.slice(6) as TitleTemplate);
      if (id.startsWith("layout.")) return setLayout(id.slice(7) as LayoutName);
      external?.(id);
  }
}

function selectLane(kind: TrackKind): void {
  const s = useEditor.getState();
  const lane = s.history.present.tracks.find((t) => t.kind === kind);
  s.select([]);
  s.selectZoom(null);
  s.selectTrack(lane?.id ?? null);
}

const ANNOTATION_MS = 4000;

/**
 * An annotation lane that is free at [at, at + ANNOTATION_MS), so the new
 * annotation appears exactly at the playhead; a new lane goes on top if needed.
 */
function annotationLane(project: Project, at: number): { project: Project; laneId: string } {
  const free = project.tracks.find((t) => t.kind === "annotation" && !t.locked && ops.firstFreeStart(project, t.id, at, ANNOTATION_MS) === at);
  if (free) return { project, laneId: free.id };
  const r = ops.addTrack(project, "annotation", 0);
  return { project: r.project, laneId: r.id };
}

function annotationClip(laneId: string, project: Project, at: number, content: Clip["content"], frame?: Clip["frame"], mediaId?: string): Clip {
  return {
    id: newId("clp"),
    trackId: laneId,
    mediaId,
    content,
    startMs: ops.firstFreeStart(project, laneId, at, ANNOTATION_MS),
    durationMs: ANNOTATION_MS,
    sourceInMs: 0,
    speed: 1,
    frame,
    opacity: 1,
    volume: 1,
    fadeInMs: 200,
    fadeOutMs: 200,
    muted: false,
    hidden: false,
    locked: false,
  };
}

/** Arrow (from upper-left towards the centre) or rectangle outline, at the playhead. */
function insertShape(shape: "arrow" | "rect"): void {
  const s = useEditor.getState();
  let created = "";
  s.edit(shape === "arrow" ? "insert.arrow" : "insert.shape", (p) => {
    const { project, laneId } = annotationLane(p, s.playheadMs);
    const { width: W, height: H } = project.canvas;
    const content: Clip["content"] =
      shape === "arrow"
        ? { type: "shape", shape: "arrow", color: "#e8c56a", strokeWidth: Math.round(10 * (W / 1920)), x1: W * 0.3, y1: H * 0.3, x2: W * 0.47, y2: H * 0.46 }
        : { type: "shape", shape: "rect", color: "#e8c56a", strokeWidth: Math.round(8 * (W / 1920)), x1: 0, y1: 0, x2: 0, y2: 0 };
    const frame = shape === "rect" ? { x: Math.round(W * 0.35), y: Math.round(H * 0.38), width: Math.round(W * 0.3), height: Math.round(H * 0.24) } : { x: 0, y: 0, width: W, height: H };
    const clip = annotationClip(laneId, project, s.playheadMs, content, frame);
    created = clip.id;
    return { ...project, clips: [...project.clips, clip] };
  });
  if (created) s.select([created]);
}

/** Image annotation from a file, centred at 30 % of the canvas width. */
async function insertImage(): Promise<void> {
  const path = await window.tdr.pickImage();
  if (!path) return;
  const info = await probe(path).catch(() => null);
  if (!info) return;
  const s = useEditor.getState();
  let created = "";
  s.edit("insert.image", (p) => {
    const { project, laneId } = annotationLane(p, s.playheadMs);
    const { width: W, height: H } = project.canvas;
    const w = Math.round(W * 0.3);
    const h = Math.round((w * (info.height ?? 1)) / (info.width ?? 1));
    const media: Media = { id: newId("med"), kind: "image", origin: "import", path, durationMs: IMAGE_DEFAULT_MS, width: info.width, height: info.height, clockOffsetMs: 0 };
    const clip = annotationClip(laneId, project, s.playheadMs, { type: "media" }, { x: Math.round((W - w) / 2), y: Math.round((H - h) / 2), width: w, height: h }, media.id);
    created = clip.id;
    return { ...project, media: [...project.media, media], clips: [...project.clips, clip] };
  });
  if (created) s.select([created]);
}

type TitleTemplate = Extract<ClipContent, { type: "title" }>["template"];
type LayoutName = "bubble" | "side" | "full" | "hidden";

function calloutContent(): ClipContent {
  const s = useEditor.getState();
  const bo = s.language === "bo";
  const { width: W, height: H } = s.history.present.canvas;
  return { type: "callout", text: s.t("callout.sample"), lang: bo ? "bo" : "en", style: "bubble", fill: "#ffffff", color: "#1b2350", border: "#d4a94a", fontSize: Math.round(44 * (W / 1920)), tailX: W * 0.46, tailY: H * 0.42 };
}

/** Any annotation (callout, highlight, spotlight, redaction, step…) at the playhead, then selected. */
export function insertAnnotation(label: string, content: ClipContent, frame: (W: number, H: number) => { x: number; y: number; width: number; height: number }, durationMs = ANNOTATION_MS): string {
  const s = useEditor.getState();
  let created = "";
  s.edit(label, (p) => {
    const { project, laneId } = annotationLane(p, s.playheadMs);
    const { width: W, height: H } = project.canvas;
    const f = frame(W, H);
    const clip = annotationClip(laneId, project, s.playheadMs, content, { x: Math.round(f.x), y: Math.round(f.y), width: Math.round(f.width), height: Math.round(f.height) });
    clip.durationMs = durationMs;
    created = clip.id;
    return { ...project, clips: [...project.clips, clip] };
  });
  if (created) s.select([created]);
  return created;
}

/** Title template clip (intro, outro, lower third, chapter card, quote, centre title). */
export function insertTitle(template: TitleTemplate): string {
  const s = useEditor.getState();
  const bo = s.language === "bo";
  const content: ClipContent = {
    type: "title",
    template,
    title: s.t(template === "quote" ? "title.sampleQuote" : template === "outro" ? "title.sampleOutro" : "title.sample"),
    subtitle: s.t(template === "quote" ? "title.sampleAuthor" : "title.sampleSubtitle"),
    lang: bo ? "bo" : "en",
    accent: "#d4a94a",
    color: "#ffffff",
    background: "#14151c",
  };
  return insertAnnotation(`title.${template}`, content, (W, H) => ({ x: 0, y: 0, width: W, height: H }), template === "lowerThird" ? 5000 : 4000);
}

/** One-click layout from the playhead onward (morphs smoothly). */
export function setLayout(layout: LayoutName): void {
  const s = useEditor.getState();
  s.edit(`layout.${layout}`, (p) => setLayoutFrom(p, s.playheadMs, layout));
}

/** Transition in and out on the selected clips; with nothing selected, show the properties panel. */
export function applyTransitions(tr: Transition | undefined, which: "in" | "out" | "both" = "both"): void {
  const s = useEditor.getState();
  if (!s.selection.length) return s.setPanelTab("properties");
  s.edit("effects.transitions", (p) => ({
    ...p,
    clips: p.clips.map((c) =>
      s.selection.includes(c.id)
        ? { ...c, ...(which !== "out" ? { transitionIn: tr } : {}), ...(which !== "in" ? { transitionOut: tr } : {}) }
        : c,
    ),
  }));
}

/** Switch on one audio tool for the selected audio lane (else the microphone lane) and show it. */
function enableAudioTool(tool: "noise" | "leveling" | "eq" | "compressor"): void {
  const s = useEditor.getState();
  const p = s.history.present;
  const selected = p.tracks.find((t) => t.id === (p.clips.find((c) => c.id === s.selection[0])?.trackId ?? s.selectedTrackId));
  const lane = selected && ops.isAudioTrack(selected) ? selected : p.tracks.find((t) => t.kind === "mic");
  if (!lane) return;
  s.edit(`audio.${tool === "noise" ? "noiseRemoval" : tool === "eq" ? "equalizer" : tool}`, (q) =>
    ops.setTrackProps(q, lane.id, { audioFx: (() => { const fx = structuredClone(lane.audioFx ?? AudioFx.parse({})); fx[tool].enabled = true; return fx; })() }),
  );
  s.select([]);
  s.selectZoom(null);
  s.selectTrack(lane.id);
  s.setPanelTab("properties");
}

/** Save the first caption lane as SRT or WebVTT. */
export async function exportSubtitles(format: "srt" | "vtt", laneId?: string): Promise<string | null> {
  const s = useEditor.getState();
  const p = s.history.present;
  const lane = laneId ?? p.tracks.find((t) => t.kind === "caption" && p.clips.some((c) => c.trackId === t.id))?.id;
  if (!lane) return null;
  const cues = laneCues(p, lane);
  return window.tdr.saveText(`${p.name || "captions"}.${format}`, [format], format === "srt" ? toSrt(cues) : toVtt(cues));
}

function addLane(kind: TrackKind): void {
  useEditor.getState().edit("timeline.addTrack", (p) => ops.addTrack(p, kind, 0).project);
}

/** A text clip at the playhead on the top annotation lane (created if needed). */
function insertText(): void {
  const s = useEditor.getState();
  const tibetan = s.language === "bo";
  let created = "";
  s.edit("insert.text", (p) => {
    const { project, laneId } = annotationLane(p, s.playheadMs);
    const { width, height } = project.canvas;
    const clip: Clip = {
      id: newId("clp"),
      trackId: laneId,
      content: { type: "text", ...TEXT_DEFAULTS, text: tibetan ? "བཀྲ་ཤིས་བདེ་ལེགས།" : "Title", fontSize: 96, color: "#ffffff", lang: tibetan ? "bo" : "en" },
      startMs: s.playheadMs,
      durationMs: 4000,
      sourceInMs: 0,
      speed: 1,
      frame: { x: Math.round(width * 0.15), y: Math.round(height * 0.4), width: Math.round(width * 0.7), height: Math.round(height * 0.2) },
      opacity: 1,
      volume: 1,
      fadeInMs: 300,
      fadeOutMs: 300,
      muted: false,
      hidden: false,
      locked: false,
    };
    created = clip.id;
    return { ...project, clips: [...project.clips, clip] };
  });
  if (created) s.select([created]);
}

/** Read duration and size of a media file through a hidden element. */
function probe(path: string): Promise<{ kind: Media["kind"]; durationMs: number; width?: number; height?: number }> {
  const url = window.tdr.mediaUrl(path);
  if (IMAGE_EXT.test(path))
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve({ kind: "image", durationMs: IMAGE_DEFAULT_MS, width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => reject(new Error(`Cannot read image ${path}`));
      img.src = url;
    });
  const el = AUDIO_EXT.test(path) ? document.createElement("audio") : document.createElement("video");
  return new Promise((resolve, reject) => {
    el.preload = "metadata";
    el.onloadedmetadata = () => {
      const video = el instanceof HTMLVideoElement && el.videoWidth > 0;
      resolve({
        kind: video ? "video" : "audio",
        durationMs: Number.isFinite(el.duration) ? el.duration * 1000 : 0,
        width: video ? (el as HTMLVideoElement).videoWidth : undefined,
        height: video ? (el as HTMLVideoElement).videoHeight : undefined,
      });
    };
    el.onerror = () => reject(new Error(`Cannot read media ${path}`));
    el.src = url;
  });
}

/** File ▸ Import Media: each file becomes a clip at the playhead on a lane of its kind. */
export async function importMedia(paths?: string[]): Promise<string[]> {
  const chosen = paths ?? (await window.tdr.importMedia());
  const probed = await Promise.all(chosen.map(async (path) => ({ path, info: await probe(path).catch(() => null) })));
  const usable = probed.filter((x) => x.info && (x.info.kind === "image" || x.info.durationMs > 0));
  if (!usable.length) return [];
  const s = useEditor.getState();
  const created: string[] = [];
  s.edit("file.import", (p) => {
    let project: Project = p;
    let at = s.playheadMs;
    for (const { path, info } of usable) {
      const laneKind: TrackKind = info!.kind === "audio" ? "audio" : info!.kind === "image" ? "image" : "video";
      let lane = project.tracks.find((t) => t.kind === laneKind && !t.locked);
      if (!lane) {
        const r = ops.addTrack(project, laneKind, laneKind === "audio" ? project.tracks.length : 0);
        project = r.project;
        lane = project.tracks.find((t) => t.id === r.id)!;
      }
      const media: Media = { id: newId("med"), kind: info!.kind, origin: "import", path, durationMs: info!.durationMs, width: info!.width, height: info!.height, clockOffsetMs: 0 };
      const clip: Clip = {
        id: newId("clp"),
        trackId: lane.id,
        mediaId: media.id,
        content: { type: "media" },
        startMs: ops.firstFreeStart(project, lane.id, at, info!.durationMs),
        durationMs: info!.durationMs,
        sourceInMs: 0,
        speed: 1,
        opacity: 1,
        volume: 1,
        fadeInMs: 0,
        fadeOutMs: 0,
        muted: false,
        hidden: false,
        locked: false,
      };
      created.push(clip.id);
      at = clip.startMs + clip.durationMs;
      project = { ...project, media: [...project.media, media], clips: [...project.clips, clip] };

      // A video's sound goes on its own audio lane, linked to the picture (unlink any time).
      if (info!.kind === "video") {
        let audioLane = project.tracks.find((t) => t.kind === "audio" && !t.locked);
        if (!audioLane) {
          const r = ops.addTrack(project, "audio", project.tracks.length);
          project = r.project;
          audioLane = project.tracks.find((t) => t.id === r.id)!;
        }
        // Only when the audio lane is free at the same time, so picture and sound stay in sync.
        if (ops.firstFreeStart(project, audioLane.id, clip.startMs, clip.durationMs) === clip.startMs) {
          const sound: Media = { ...media, id: newId("med"), kind: "audio", width: undefined, height: undefined };
          const group = newId("lnk");
          const audioClip: Clip = { ...clip, id: newId("clp"), trackId: audioLane.id, mediaId: sound.id, linkGroup: group };
          project = {
            ...project,
            media: [...project.media, sound],
            clips: [...project.clips.map((c) => (c.id === clip.id ? { ...c, linkGroup: group } : c)), audioClip],
          };
          created.push(audioClip.id);
        }
      }
    }
    return project;
  });
  if (created.length) s.select(created);
  return created;
}
