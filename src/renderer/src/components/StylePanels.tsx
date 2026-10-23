/**
 * Stage 4 inspector panels: zoom regions + camera settings, frame styling,
 * cursor effects and webcam layout. Every change is one undo step (sliders
 * preview while dragging and commit on release).
 */
import { useEffect, useMemo, useState } from "react";
import { EASING_PRESETS, WEBCAM_ANCHORS, type CursorStyle, type Project, type WebcamLayout, type ZoomSettings } from "@shared/project/schema";
import * as regions from "@shared/timeline/regions";
import { depthScale } from "@shared/effects/zoom";
import { useEditor } from "../store";
import { installedExtensions, onAssetsChanged } from "../playback/assets";
import { WALLPAPERS } from "../compositor/wallpapers";
import { localName } from "@shared/extensions";
import { formatTimecode } from "../util/time";
import { Check, Section, Slider, pct } from "./Inspector";

type Edit = (label: string, fn: (p: Project) => Project) => void;
const useEdit = (): Edit => useEditor((s) => s.edit);

function Select<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <label className="prop">
      <span className="prop-label">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function Color({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="prop">
      <span className="prop-label">{label}</span>
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

/** Re-render when extensions finish loading. */
function useExtensions() {
  const [, force] = useState(0);
  useEffect(() => onAssetsChanged(() => force((n) => n + 1)), []);
  return installedExtensions();
}

// ---------------------------------------------------------------- zoom

export function ZoomPanel() {
  const t = useEditor((s) => s.t);
  const lang = useEditor((s) => s.language);
  const edit = useEdit();
  const project = useEditor((s) => s.history.present);
  const id = useEditor((s) => s.selectedZoomId);
  const z = project.zooms.find((x) => x.id === id);
  if (!z) return null;
  const set = (patch: Parameters<typeof regions.updateZoom>[2]) => (p: Project) => regions.updateZoom(p, z.id, patch);
  return (
    <div className="props-panel">
      <div className="panel-title">{t("zoom.region")}</div>
      <p className="muted small" lang="en">
        {formatTimecode(z.startMs)} → {formatTimecode(z.endMs)}
      </p>
      {z.suggested && (
        <div className="prop-buttons">
          <button className="primary-btn" onClick={() => useEditor.getState().acceptSuggestions([z.id])}>✓ {t("zoom.accept")}</button>
          <button onClick={() => useEditor.getState().rejectSuggestions([z.id])}>✕ {t("zoom.reject")}</button>
        </div>
      )}
      <Slider label={t("zoom.depth")} value={z.depth} min={1} max={6} step={1} format={(v) => `${depthScale(v)}×`} onPreview={(v) => set({ depth: v })} />
      <Select
        label={t("zoom.mode")}
        value={z.mode}
        options={[
          { value: "manual", label: t("zoom.manual") },
          { value: "auto", label: t("zoom.auto") },
        ]}
        onChange={(mode) => edit("edit.props", set({ mode }))}
      />
      <Slider label={t("inspector.x")} value={z.focus.x} min={0} max={1} step={0.005} format={pct} onPreview={(v) => set({ focus: { ...z.focus, x: v } })} />
      <Slider label={t("inspector.y")} value={z.focus.y} min={0} max={1} step={0.005} format={pct} onPreview={(v) => set({ focus: { ...z.focus, y: v } })} />
      <p className="muted small">{t("zoom.focusHint")}</p>
      <div className="prop-buttons">
        <button className="danger" onClick={() => useEditor.getState().deleteSelectedZoom()}>{t("edit.delete")}</button>
      </div>
      <CameraSettings />
    </div>
  );
}

export function CameraSettings() {
  const t = useEditor((s) => s.t);
  const lang = useEditor((s) => s.language);
  const edit = useEdit();
  const s = useEditor((st) => st.history.present.zoom);
  const status = useEditor((st) => st.suggestStatus);
  const set = (patch: Partial<ZoomSettings>) => (p: Project) => ({ ...p, zoom: { ...p.zoom, ...patch } });
  return (
    <Section title={t("zoom.camera")}>
      <div className="prop-buttons">
        <button onClick={() => useEditor.getState().suggestZooms()}>✨ {t("effects.autoZoom")}</button>
        <button onClick={() => useEditor.getState().addZoomAtPlayhead()}>+ {t("effects.zoomRegion")}</button>
      </div>
      {status && status !== "ok" && <p className="muted small">{t(`zoom.status.${status}`)}</p>}
      <Slider label={t("zoom.zoomIn")} value={s.zoomInMs / 1000} min={0.1} max={4} step={0.05} format={(v) => `${v.toFixed(2)} s`} onPreview={(v) => set({ zoomInMs: v * 1000 })} />
      <Slider label={t("zoom.zoomOut")} value={s.zoomOutMs / 1000} min={0.1} max={4} step={0.05} format={(v) => `${v.toFixed(2)} s`} onPreview={(v) => set({ zoomOutMs: v * 1000 })} />
      <Select label={t("zoom.easing")} value={s.easing} options={EASING_PRESETS.map((e) => ({ value: e, label: t(`zoom.ease.${e}`) }))} onChange={(easing) => edit("edit.props", set({ easing }))} />
      {s.easing === "custom" && (
        <div className="prop-grid curve">
          {s.customCurve.map((v, i) => (
            <label className="prop" key={i}>
              <span className="prop-label" lang="en">{["x1", "y1", "x2", "y2"][i]}</span>
              <input
                type="number"
                lang="en"
                step={0.01}
                defaultValue={v}
                key={v}
                onBlur={(e) => {
                  const curve = [...s.customCurve] as [number, number, number, number];
                  const n = Number(e.target.value);
                  curve[i] = i % 2 === 0 ? Math.min(1, Math.max(0, n)) : n;
                  edit("edit.props", set({ customCurve: curve }));
                }}
              />
            </label>
          ))}
        </div>
      )}
      <Slider label={t("zoom.smoothness")} value={s.smoothness} min={0} max={3} step={0.05} format={(v) => v.toFixed(2)} onPreview={(v) => set({ smoothness: v })} />
      <Slider label={t("cursor.motionBlur")} value={s.motionBlur} min={0} max={2} step={0.05} format={(v) => v.toFixed(2)} onPreview={(v) => set({ motionBlur: v })} />
      <Check label={t("zoom.connect")} checked={s.connect} onChange={(connect) => edit("edit.props", set({ connect }))} />
    </Section>
  );
}

// ---------------------------------------------------------------- frame / background

const ASPECTS: Record<string, [number, number]> = {
  "16:9": [1920, 1080],
  "9:16": [1080, 1920],
  "1:1": [1080, 1080],
  "4:3": [1440, 1080],
  "4:5": [1080, 1350],
  "16:10": [1728, 1080],
  "10:16": [1080, 1728],
};

/** Canvas size for an aspect preset ("native" follows the screen recording, at 1080p). */
export function aspectSize(project: Project, aspect: string): [number, number] {
  if (aspect !== "native") return ASPECTS[aspect] ?? [project.canvas.width, project.canvas.height];
  const screen = project.media.find((m) => m.origin === "screen" && m.width && m.height);
  if (!screen) return [project.canvas.width, project.canvas.height];
  const even = (n: number) => Math.round(n / 2) * 2;
  const scale = 1080 / Math.min(screen.width!, screen.height!);
  return [even(screen.width! * scale), even(screen.height! * scale)];
}

const thumbCache = new Map<string, string>();
export function wallpaperThumb(id: string): string {
  let url = thumbCache.get(id);
  if (!url) {
    const c = document.createElement("canvas");
    c.width = 160;
    c.height = 90;
    WALLPAPERS.find((w) => w.id === id)?.draw(c.getContext("2d")!, 160, 90);
    url = c.toDataURL("image/png");
    thumbCache.set(id, url);
  }
  return url;
}

export function FramePanel() {
  const t = useEditor((s) => s.t);
  const lang = useEditor((s) => s.language);
  const edit = useEdit();
  const c = useEditor((s) => s.history.present.canvas);
  const project = useEditor((s) => s.history.present);
  const extensions = useExtensions();
  const setCanvas = (patch: Partial<Project["canvas"]>) => (p: Project) => ({ ...p, canvas: { ...p.canvas, ...patch } });
  const bg = c.background;
  const extWallpapers = extensions.flatMap((e) => e.wallpapers);
  const frames = extensions.flatMap((e) => e.deviceFrames);

  return (
    <Section title={t("frame.title")}>
      <Select
        label={t("inspector.aspectRatio")}
        value={c.aspect}
        options={["native", ...Object.keys(ASPECTS)].map((a) => ({ value: a, label: a === "native" ? t("frame.native") : a }))}
        onChange={(aspect) => {
          const [width, height] = aspectSize(project, aspect);
          edit("inspector.aspectRatio", setCanvas({ aspect, width, height }));
        }}
      />
      <Select
        label={t("effects.background")}
        value={bg.type}
        options={[
          { value: "wallpaper", label: t("inspector.wallpaper") },
          { value: "gradient", label: t("inspector.gradient") },
          { value: "solid", label: t("inspector.solidColor") },
          { value: "image", label: t("inspector.customImage") },
        ]}
        onChange={async (type) => {
          if (type === bg.type) return;
          if (type === "wallpaper") return edit("effects.background", setCanvas({ background: { type: "wallpaper", id: "lhasa-dusk" } }));
          if (type === "gradient") return edit("effects.background", setCanvas({ background: { type: "gradient", from: "#1b2350", to: "#6b1424", angleDeg: 135, radial: false } }));
          if (type === "solid") return edit("effects.background", setCanvas({ background: { type: "solid", color: "#1b2350" } }));
          const path = await window.tdr.pickImage();
          if (path) edit("effects.background", setCanvas({ background: { type: "image", path, blurPx: 0 } }));
        }}
      />
      {bg.type === "wallpaper" && (
        <div className="wallpaper-grid">
          {WALLPAPERS.map((w) => (
            <button key={w.id} className={`wallpaper ${bg.id === w.id ? "selected" : ""}`} title={t(w.label)} onClick={() => edit("effects.background", setCanvas({ background: { type: "wallpaper", id: w.id } }))}>
              <img src={wallpaperThumb(w.id)} alt={t(w.label)} />
            </button>
          ))}
          {extWallpapers.map((w) => (
            <button key={w.id} className={`wallpaper ${bg.id === w.path ? "selected" : ""}`} title={localName(w, lang)} onClick={() => edit("effects.background", setCanvas({ background: { type: "wallpaper", id: w.path } }))}>
              <img src={window.tdr.mediaUrl(w.path)} alt={localName(w, lang)} />
            </button>
          ))}
        </div>
      )}
      {bg.type === "gradient" && (
        <>
          <Color label={t("frame.from")} value={bg.from} onChange={(from) => edit("effects.background", setCanvas({ background: { ...bg, from } }))} />
          <Color label={t("frame.to")} value={bg.to} onChange={(to) => edit("effects.background", setCanvas({ background: { ...bg, to } }))} />
          <Slider label={t("frame.angle")} value={bg.angleDeg} min={0} max={360} step={1} format={(v) => `${Math.round(v)}°`} onPreview={(angleDeg) => setCanvas({ background: { ...bg, angleDeg } })} />
          <Check label={t("frame.radial")} checked={bg.radial} onChange={(radial) => edit("effects.background", setCanvas({ background: { ...bg, radial } }))} />
        </>
      )}
      {bg.type === "solid" && <Color label={t("inspector.color")} value={bg.color} onChange={(color) => edit("effects.background", setCanvas({ background: { type: "solid", color } }))} />}
      {bg.type === "image" && (
        <button className="link-btn" onClick={async () => {
          const path = await window.tdr.pickImage();
          if (path) edit("effects.background", setCanvas({ background: { type: "image", path, blurPx: 0 } }));
        }}>
          {t("inspector.customImage")}…
        </button>
      )}
      <Slider label={t("inspector.blur")} value={c.backgroundBlur} min={0} max={8} step={0.5} format={(v) => v.toFixed(1)} onPreview={(backgroundBlur) => setCanvas({ backgroundBlur })} />
      <Slider label={t("inspector.padding")} value={c.padding} min={0} max={0.3} step={0.005} format={pct} onPreview={(padding) => setCanvas({ padding })} />
      <Slider label={t("inspector.roundness")} value={c.cornerRadius} min={0} max={120} step={1} format={(v) => `${Math.round(v)} px`} onPreview={(cornerRadius) => setCanvas({ cornerRadius })} />
      <Slider label={t("inspector.shadow")} value={c.shadow} min={0} max={2} step={0.01} format={(v) => v.toFixed(2)} onPreview={(shadow) => setCanvas({ shadow })} />
      <Select
        label={t("frame.device")}
        value={c.deviceFrame ?? ""}
        options={[{ value: "", label: t("record.none") }, ...frames.map((f) => ({ value: f.id, label: localName(f, lang) }))]}
        onChange={(id) => edit("frame.device", setCanvas({ deviceFrame: id || undefined }))}
      />
      <ExtensionsLine />
    </Section>
  );
}

function ExtensionsLine() {
  const t = useEditor((s) => s.t);
  const lang = useEditor((s) => s.language);
  const extensions = useExtensions();
  return (
    <p className="muted small">
      {t("ext.title")}: {extensions.map((e) => `${localName(e, lang)} ${e.version}`).join(", ") || "—"}{" "}
      <button className="link-btn" onClick={() => void window.tdr.extensions.openFolder()}>
        {t("ext.openFolder")}
      </button>
    </p>
  );
}

// ---------------------------------------------------------------- cursor

export function CursorPanel() {
  const t = useEditor((s) => s.t);
  const lang = useEditor((s) => s.language);
  const edit = useEdit();
  const c = useEditor((s) => s.history.present.cursor);
  const extensions = useExtensions();
  const sounds = extensions.flatMap((e) => e.clickSounds);
  const set = (patch: Partial<CursorStyle>) => (p: Project) => ({ ...p, cursor: { ...p.cursor, ...patch } });
  return (
    <Section title={t("effects.cursor")}>
      <Check label={t("cursor.show")} checked={c.visible} onChange={(visible) => edit("cursor.show", set({ visible }))} />
      {!c.visible && <p className="muted small">{t("cursor.osCursorNote")}</p>}
      <Select
        label={t("cursor.style")}
        value={c.style}
        options={(["arrow", "pointer", "dot"] as const).map((v) => ({ value: v, label: t(`cursor.styles.${v}`) }))}
        onChange={(style) => edit("cursor.style", set({ style }))}
      />
      <Slider label={t("cursor.size")} value={c.size} min={0.5} max={10} step={0.1} format={(v) => `${v.toFixed(1)}×`} onPreview={(size) => set({ size })} />
      <Slider label={t("cursor.smoothing")} value={c.smoothing} min={0} max={2} step={0.05} format={(v) => v.toFixed(2)} onPreview={(smoothing) => set({ smoothing })} />
      <Slider label={t("cursor.motionBlur")} value={c.motionBlur} min={0} max={2} step={0.05} format={(v) => v.toFixed(2)} onPreview={(motionBlur) => set({ motionBlur })} />
      <Slider label={t("cursor.clickBounce")} value={c.clickBounce} min={0} max={5} step={0.1} format={(v) => v.toFixed(1)} onPreview={(clickBounce) => set({ clickBounce })} />
      <Slider label={t("cursor.sway")} value={c.sway} min={0} max={2} step={0.05} format={(v) => v.toFixed(2)} onPreview={(sway) => set({ sway })} />
      <Check label={t("cursor.loop")} checked={c.loop} onChange={(loop) => edit("cursor.loop", set({ loop }))} />
      <Select
        label={t("cursor.clickRipple")}
        value={c.clickEffect}
        options={(["none", "ripple", "spotlight", "echo"] as const).map((v) => ({ value: v, label: t(`cursor.effects.${v}`) }))}
        onChange={(clickEffect) => edit("cursor.clickRipple", set({ clickEffect }))}
      />
      {c.clickEffect !== "none" && (
        <>
          <Color label={t("inspector.color")} value={c.clickColor} onChange={(clickColor) => edit("edit.props", set({ clickColor }))} />
          <Slider label={t("inspector.size")} value={c.clickScale} min={0.5} max={2} step={0.05} format={(v) => `${v.toFixed(2)}×`} onPreview={(clickScale) => set({ clickScale })} />
          <Slider label={t("inspector.opacity")} value={c.clickOpacity} min={0} max={1} step={0.01} format={pct} onPreview={(clickOpacity) => set({ clickOpacity })} />
          <Slider label={t("inspector.duration")} value={c.clickEffectMs / 1000} min={0.12} max={1.2} step={0.02} format={(v) => `${v.toFixed(2)} s`} onPreview={(v) => set({ clickEffectMs: v * 1000 })} />
        </>
      )}
      <Check label={t("insert.keystrokes")} checked={c.keystrokes} onChange={(keystrokes) => edit("insert.keystrokes", set({ keystrokes }))} />
      <Select
        label={t("cursor.clickSound")}
        value={c.clickSound ?? ""}
        options={[{ value: "", label: t("record.none") }, ...sounds.map((s) => ({ value: s.id, label: localName(s, lang) }))]}
        onChange={(id) => edit("cursor.clickSound", set({ clickSound: id || undefined }))}
      />
    </Section>
  );
}

// ---------------------------------------------------------------- webcam

export function WebcamPanel() {
  const t = useEditor((s) => s.t);
  const lang = useEditor((s) => s.language);
  const edit = useEdit();
  const w = useEditor((s) => s.history.present.webcam);
  const set = (patch: Partial<WebcamLayout>) => (p: Project) => ({ ...p, webcam: { ...p.webcam, ...patch } });
  const layouts = useMemo(
    () => (["bubble", "side", "full", "hidden"] as const).map((v) => ({ value: v, label: t(v === "bubble" ? "layout.screenWithBubble" : v === "side" ? "layout.sideBySide" : v === "full" ? "layout.webcamOnly" : "layout.screenOnly") })),
    [t],
  );
  return (
    <Section title={t("effects.webcamBubble")}>
      <div className="layout-buttons">
        {layouts.map((l) => (
          <button key={l.value} className={w.layout === l.value ? "selected" : ""} onClick={() => edit("effects.layouts", set({ layout: l.value }))}>
            {l.label}
          </button>
        ))}
      </div>
      {w.layout === "bubble" && (
        <>
          <div className="anchor-grid" role="radiogroup" aria-label={t("inspector.position")}>
            {WEBCAM_ANCHORS.map((a) => (
              <button key={a} role="radio" aria-checked={w.anchor === a} className={w.anchor === a ? "selected" : ""} title={t(`anchor.${a}`)} aria-label={t(`anchor.${a}`)} onClick={() => edit("inspector.position", set({ anchor: a }))} />
            ))}
          </div>
          <Check label={t("webcam.custom")} checked={w.anchor === "custom"} onChange={(v) => edit("inspector.position", set({ anchor: v ? "custom" : "bottom-right" }))} />
          {w.anchor === "custom" && (
            <>
              <Slider label={t("inspector.x")} value={w.x} min={0} max={1} step={0.005} format={pct} onPreview={(x) => set({ x })} />
              <Slider label={t("inspector.y")} value={w.y} min={0} max={1} step={0.005} format={pct} onPreview={(y) => set({ y })} />
            </>
          )}
          <Slider label={t("inspector.size")} value={w.sizePct} min={10} max={100} step={1} format={(v) => `${Math.round(v)}%`} onPreview={(sizePct) => set({ sizePct })} />
          <Slider label={t("inspector.margin")} value={w.marginPx} min={0} max={96} step={1} format={(v) => `${Math.round(v)} px`} onPreview={(marginPx) => set({ marginPx })} />
          <Slider label={t("inspector.roundness")} value={w.roundness} min={0} max={100} step={1} format={(v) => `${Math.round(v)}%`} onPreview={(roundness) => set({ roundness })} />
          <Slider label={t("inspector.shadow")} value={w.shadow} min={0} max={1} step={0.01} format={pct} onPreview={(shadow) => set({ shadow })} />
          <Check label={t("webcam.reactToZoom")} checked={w.reactToZoom} onChange={(reactToZoom) => edit("edit.props", set({ reactToZoom }))} />
        </>
      )}
      <Check label={t("inspector.mirror")} checked={w.mirror} onChange={(mirror) => edit("inspector.mirror", set({ mirror }))} />
    </Section>
  );
}
