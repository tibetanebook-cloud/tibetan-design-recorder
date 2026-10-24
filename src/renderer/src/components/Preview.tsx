import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import type { Project } from "@shared/project/schema";
import { buildScene } from "@shared/scene/buildScene";
import { placeMedia, sourceToStage } from "@shared/scene/placement";
import { depthScale } from "@shared/effects/zoom";
import * as regions from "@shared/timeline/regions";
import * as ops from "@shared/timeline/ops";
import { layoutAt } from "@shared/effects/layouts";
import { setLayout } from "../actions";
import { Compositor, TIBETAN_FONT } from "../compositor/Compositor";
import { PlaybackEngine } from "../playback/engine";
import { ensureProjectAssets, onAssetsChanged, sceneContext } from "../playback/assets";
import { useEditor } from "../store";
import { preloadBundledFonts } from "../bundledFonts";
import { hitText, InlineTextEditor, type InlineEdit } from "./InlineTextEditor";

/** Shared with the smoke test so it can read rendered pixels. */
export const previewCompositor: { current: Compositor | null } = { current: null };
/** The one playback engine (transport buttons and shortcuts drive it). */
export const playback: { current: PlaybackEngine | null } = { current: null };

/** While a zoom region is selected (and paused) the preview shows the un-zoomed frame to edit its focus. */
function viewProject(): Project {
  const s = useEditor.getState();
  const p = s.history.present;
  return s.selectedZoomId && !s.playing ? { ...p, zooms: [] } : p;
}

export function Preview() {
  const host = useRef<HTMLDivElement>(null);
  const project = useEditor((s) => s.history.present);
  const playheadMs = useEditor((s) => s.playheadMs);
  const playing = useEditor((s) => s.playing);
  const zoomId = useEditor((s) => s.selectedZoomId);
  const [ready, setReady] = useState(false);
  const [assetTick, setAssetTick] = useState(0);
  const [inline, setInline] = useState<InlineEdit | null>(null);

  /** Double-click any text, callout, title or caption to edit it in place. */
  const onDoubleClick = async (e: ReactMouseEvent<HTMLDivElement>) => {
    const comp = previewCompositor.current;
    const box = host.current?.getBoundingClientRect();
    if (!comp || !box || (e.target as HTMLElement).closest("[data-inline-editor]")) return;
    const st = useEditor.getState();
    const p = st.history.present;
    const x = ((e.clientX - box.left) / box.width) * p.canvas.width;
    const y = ((e.clientY - box.top) / box.height) * p.canvas.height;
    if (st.playing) {
      st.setPlaying(false);
      await playback.current?.requestFrame(useEditor.getState().playheadMs);
    }
    const hit = hitText(p, comp.textBoxes, useEditor.getState().playheadMs, x, y);
    if (!hit) return;
    e.preventDefault();
    st.select([hit.box.clipId]);
    setInline(hit);
  };

  useEffect(() => {
    const compositor = new Compositor();
    const canvas = document.createElement("canvas");
    const engine = new PlaybackEngine(
      viewProject,
      () => previewCompositor.current,
      (ms) => useEditor.getState().setPlayhead(ms),
      () => useEditor.getState().setPlaying(false),
    );
    compositor.onAssetLoaded = () => setAssetTick((n) => n + 1);
    let cancelled = false;
    let initialized = false;
    void (async () => {
      // Pixi rasterizes text once; make sure the Tibetan font is ready first.
      await Promise.all([document.fonts.load(`64px ${TIBETAN_FONT}`, "བོད"), preloadBundledFonts()]);
      const p = useEditor.getState().history.present;
      await compositor.init(p.canvas.width, p.canvas.height, canvas);
      if (cancelled) return compositor.destroy();
      compositor.onlyNewVideoFrames = true;
      initialized = true;
      host.current?.appendChild(canvas);
      previewCompositor.current = compositor;
      playback.current = engine;
      setReady(true);
    })();
    const offAssets = onAssetsChanged(() => setAssetTick((n) => n + 1));
    // Draw at the size the preview is shown (device pixels), not always full 1080p/4K:
    // much less GPU work while playing; exports still render at full size.
    const resize = new ResizeObserver(() => {
      const box = host.current;
      if (!box) return;
      const k = Math.min(1, Math.max(0.25, Math.ceil(((box.clientWidth * window.devicePixelRatio) / useEditor.getState().history.present.canvas.width) * 20) / 20));
      if (Math.abs(compositor.scale - k) > 0.001) {
        compositor.scale = k;
        setAssetTick((n) => n + 1);
      }
    });
    if (host.current) resize.observe(host.current);
    return () => {
      cancelled = true;
      offAssets();
      resize.disconnect();
      engine.dispose();
      if (initialized) compositor.destroy();
      previewCompositor.current = null;
      playback.current = null;
    };
  }, []);

  useEffect(() => ensureProjectAssets(project), [project]);

  // Start/stop the engine with the transport state.
  useEffect(() => {
    const engine = playback.current;
    if (!ready || !engine) return;
    if (playing) void engine.play(useEditor.getState().playheadMs);
    else engine.pause();
  }, [playing, ready]);

  // Paused: draw the exact frame whenever the playhead, project, selection or assets change.
  useEffect(() => {
    if (!ready || playing) return;
    void playback.current?.requestFrame(playheadMs);
  }, [project, playheadMs, playing, ready, zoomId, assetTick]);

  return (
    <div className="preview-stage">
      <div className="preview-canvas" ref={host} style={{ aspectRatio: `${project.canvas.width} / ${project.canvas.height}` }} onDoubleClick={(e) => void onDoubleClick(e)} data-preview-host>
        {zoomId && !playing && <ZoomFocusOverlay project={project} zoomId={zoomId} />}
        {!zoomId && !playing && !inline && <FrameOverlay project={project} />}
        {inline && !playing && <InlineTextEditor edit={inline} project={project} onDone={() => setInline(null)} />}
      </div>
      <LayoutBar project={project} playheadMs={playheadMs} />
    </div>
  );
}

const LAYOUTS = [
  { id: "hidden", label: "layout.screenOnly", icon: <rect x="1" y="1" width="20" height="12" rx="2" fill="currentColor" opacity="0.5" /> },
  { id: "full", label: "layout.webcamOnly", icon: <circle cx="11" cy="7" r="5" fill="currentColor" /> },
  {
    id: "side",
    label: "layout.sideBySide",
    icon: (
      <>
        <rect x="1" y="2" width="13" height="10" rx="1.5" fill="currentColor" opacity="0.5" />
        <rect x="15" y="2" width="6" height="10" rx="1.5" fill="currentColor" />
      </>
    ),
  },
  {
    id: "bubble",
    label: "layout.screenWithBubble",
    icon: (
      <>
        <rect x="1" y="1" width="20" height="12" rx="2" fill="currentColor" opacity="0.5" />
        <circle cx="17" cy="10" r="3" fill="currentColor" />
      </>
    ),
  },
] as const;

/** One-click layouts: switch from the playhead onward (the change morphs smoothly). */
function LayoutBar({ project, playheadMs }: { project: Project; playheadMs: number }) {
  const t = useEditor((s) => s.t);
  const current = layoutAt(project, playheadMs).layout;
  return (
    <div className="layout-bar" role="toolbar" aria-label={t("effects.layouts")}>
      {LAYOUTS.map((l) => (
        <button key={l.id} className={current === l.id ? "selected" : ""} title={t(l.label)} data-layout={l.id} onClick={() => setLayout(l.id)}>
          <svg viewBox="0 0 22 14" aria-hidden="true">{l.icon}</svg>
          <span>{t(l.label)}</span>
        </button>
      ))}
    </div>
  );
}

/** Content types moved/resized on the canvas (frame in canvas pixels). */
const FRAMED = new Set(["text", "callout", "highlight", "spotlight", "redact", "step", "shape", "media", "solid"]);

/**
 * Dashed box with a resize handle around the selected annotation; drag to move.
 * Callouts also get a handle for the tip of their pointer. Annotations that
 * follow the camera (redaction, highlight…) are mapped through the zoom.
 */
function FrameOverlay({ project }: { project: Project }) {
  const selection = useEditor((s) => s.selection);
  const playheadMs = useEditor((s) => s.playheadMs);
  if (selection.length !== 1) return null;
  const clip = project.clips.find((c) => c.id === selection[0]);
  const lane = clip && project.tracks.find((tr) => tr.id === clip.trackId);
  if (!clip || !lane || lane.kind !== "annotation" || !FRAMED.has(clip.content.type) || !clip.frame) return null;
  if (clip.content.type === "shape" && (clip.content.shape === "arrow" || clip.content.shape === "line")) return null;
  const W = project.canvas.width, H = project.canvas.height;
  const scene = buildScene(project, Math.max(clip.startMs, Math.min(playheadMs, clip.startMs + clip.durationMs - 1)), sceneContext());
  const layer = scene.layers.find((l) => l.clipId === clip.id);
  const cam = layer?.inCamera ? scene.camera : { scale: 1, cx: W / 2, cy: H / 2 };
  const toView = (x: number, y: number) => ({ x: (x - cam.cx) * cam.scale + W / 2, y: (y - cam.cy) * cam.scale + H / 2 });
  const f = clip.frame;
  const a = toView(f.x, f.y);
  const pct = (v: number, of: number) => `${(v / of) * 100}%`;
  const content = clip.content;

  /** Drag in canvas pixels (preview pixels -> canvas pixels -> camera space). */
  const drag = (e: React.PointerEvent, apply: (dx: number, dy: number) => (p: Project) => Project) => {
    e.stopPropagation();
    e.preventDefault();
    const box = (e.currentTarget as HTMLElement).closest(".preview-canvas")!.getBoundingClientRect();
    const k = W / box.width / cam.scale;
    const x0 = e.clientX, y0 = e.clientY;
    const st = useEditor.getState();
    st.beginDrag();
    const move = (ev: PointerEvent) => useEditor.getState().dragPreview(apply((ev.clientX - x0) * k, (ev.clientY - y0) * k));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      useEditor.getState().endDrag("edit.move");
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  const setFrame = (fn: (dx: number, dy: number) => typeof f) => (dx: number, dy: number) => (p: Project) => {
    const next = fn(dx, dy);
    const c = p.clips.find((x) => x.id === clip.id);
    if (!c) return p;
    // Moving a callout box drags its pointer tip along.
    const extra = content.type === "callout" && content.tailX !== undefined && next.width === f.width ? { content: { ...content, tailX: content.tailX + dx, tailY: (content.tailY ?? 0) + dy } } : {};
    return ops.setClipProps(p, [clip.id], { frame: next, ...extra });
  };
  return (
    <div className="frame-overlay" data-frame-overlay>
      <div
        className="frame-box"
        style={{ left: pct(a.x, W), top: pct(a.y, H), width: pct(f.width * cam.scale, W), height: pct(f.height * cam.scale, H) }}
        onPointerDown={(e) => drag(e, setFrame((dx, dy) => ({ ...f, x: Math.round(f.x + dx), y: Math.round(f.y + dy) })))}
      >
        <div
          className="frame-handle"
          onPointerDown={(e) =>
            drag(e, setFrame((dx, dy) => {
              // Step numbers stay round.
              if (content.type === "step") {
                const d = Math.max(16, Math.round(f.width + Math.max(dx, dy)));
                return { ...f, width: d, height: d };
              }
              return { ...f, width: Math.max(16, Math.round(f.width + dx)), height: Math.max(16, Math.round(f.height + dy)) };
            }))
          }
        />
      </div>
      {content.type === "callout" && content.tailX !== undefined && (
        <div
          className="tail-handle"
          style={{ left: pct(toView(content.tailX, content.tailY ?? 0).x, W), top: pct(toView(content.tailX, content.tailY ?? 0).y, H) }}
          onPointerDown={(e) => drag(e, (dx, dy) => (p) => ops.setClipProps(p, [clip.id], { content: { ...content, tailX: Math.round(content.tailX! + dx), tailY: Math.round((content.tailY ?? 0) + dy) } }))}
        />
      )}
    </div>
  );
}

/** Screen placement (un-zoomed) at a time, for mapping focus points. */
function screenPlacement(project: Project, timeMs: number) {
  const scene = buildScene({ ...project, zooms: [] }, timeMs, sceneContext());
  const layer = scene.layers.find((l) => l.inCamera && l.mediaId);
  const media = layer && project.media.find((m) => m.id === layer.mediaId);
  if (!layer || !media) return null;
  const mw = media.width ?? 1920, mh = media.height ?? 1080;
  return { mw, mh, pl: placeMedia(mw, mh, layer.frame, layer.crop, "contain") };
}

/** Gold rectangle = what the zoom will show; click to move its focus. */
function ZoomFocusOverlay({ project, zoomId }: { project: Project; zoomId: string }) {
  const zoom = project.zooms.find((z) => z.id === zoomId);
  if (!zoom) return null;
  const W = project.canvas.width, H = project.canvas.height;
  const placed = screenPlacement(project, Math.max(zoom.startMs, Math.min(zoom.endMs - 1, useEditor.getState().playheadMs)));
  if (!placed) return null;
  const f = sourceToStage(zoom.focus, placed.mw, placed.mh, placed.pl);
  const scale = depthScale(zoom.depth);
  const vw = W / scale, vh = H / scale;
  const vx = Math.min(W - vw, Math.max(0, f.x - vw / 2));
  const vy = Math.min(H - vh, Math.max(0, f.y - vh / 2));
  const pctX = (v: number) => `${(v / W) * 100}%`;
  const pctY = (v: number) => `${(v / H) * 100}%`;

  const onClick = (e: ReactMouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const sx = ((e.clientX - r.left) / r.width) * W;
    const sy = ((e.clientY - r.top) / r.height) * H;
    const { pl, mw, mh } = placed;
    const x = (pl.sx + ((sx - pl.dx) / pl.dw) * pl.sw) / mw;
    const y = (pl.sy + ((sy - pl.dy) / pl.dh) * pl.sh) / mh;
    useEditor.getState().edit("zoom.focus", (p) => regions.updateZoom(p, zoomId, { focus: { x, y } }));
  };

  return (
    <div className="zoom-overlay" onClick={onClick} data-zoom-overlay>
      <div className="zoom-viewport" style={{ left: pctX(vx), top: pctY(vy), width: pctX(vw), height: pctY(vh) }} />
      <div className="zoom-focus" style={{ left: pctX(f.x), top: pctY(f.y) }} />
    </div>
  );
}
