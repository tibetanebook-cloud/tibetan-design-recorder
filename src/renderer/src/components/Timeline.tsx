/**
 * Multi-track timeline.
 *  - Ruler: click/drag to scrub (magnetic: snaps to clip edges and markers), marker flags
 *    (drag to move, double-click to rename, right-click to delete).
 *  - Lanes: one per input plus any extra lanes; header toggles lock/mute/solo/hide.
 *  - Clips: click to select (Ctrl/Cmd toggles, Shift adds), drag to move (also to another
 *    lane of the same kind), drag an edge to trim. Hold Alt to drag without snapping.
 *  - Ctrl/Cmd + wheel zooms around the mouse; Shift + wheel scrolls sideways.
 * Every drag is previewed live and becomes one undo step when released.
 */
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { Clip, Project, Track, TrackKind } from "@shared/project/schema";
import * as ops from "@shared/timeline/ops";
import * as regions from "@shared/timeline/regions";
import { displayShortcut } from "@shared/shortcuts";
import { useEditor } from "../store";
import { useShortcuts } from "../shortcuts";
import { formatTimecode } from "../util/time";
import { drawWaveform, waveformPeaks } from "../timeline/waveform";

const HEAD_W = 236;
const RULER_H = 28;
const LANE_H: Record<TrackKind, number> = { screen: 48, webcam: 48, video: 48, image: 40, mic: 56, system: 56, audio: 56, annotation: 36, caption: 36, cursor: 30 };
const SNAP_PX = 8;
const EDGE_PX = 7;
const isMac = window.tdr.platform === "darwin";

export const KIND_COLOR: Record<TrackKind, string> = {
  screen: "var(--navy-light)",
  webcam: "var(--crimson-light)",
  mic: "var(--gold-dim)",
  system: "var(--teal)",
  video: "#3d5a9e",
  image: "var(--violet)",
  audio: "#8a6d2f",
  annotation: "var(--violet)",
  caption: "#2f6f7d",
  cursor: "#5c6370",
};

const EXTRA_KINDS: TrackKind[] = ["video", "image", "audio", "annotation", "caption"];

export function Timeline() {
  const t = useEditor((s) => s.t);
  const project = useEditor((s) => s.history.present);
  const pps = useEditor((s) => s.pps);
  const scroll = useRef<HTMLDivElement>(null);
  const [snapLine, setSnapLine] = useState<number | null>(null);

  const durationMs = Math.max(ops.snapPoints(project, new Set()).reduce((a, b) => Math.max(a, b), 0), 10_000);
  const contentW = ((durationMs + 30_000) / 1000) * pps;
  const msToX = (ms: number) => (ms / 1000) * pps;

  // Ctrl/Cmd + wheel: zoom around the mouse position.
  useEffect(() => {
    const el = scroll.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const st = useEditor.getState();
      const rect = el.getBoundingClientRect();
      const mouseX = e.clientX - rect.left - HEAD_W + el.scrollLeft;
      const atMs = (mouseX / st.pps) * 1000;
      const next = Math.min(1200, Math.max(4, st.pps * (e.deltaY < 0 ? 1.2 : 1 / 1.2)));
      st.setZoom(next);
      requestAnimationFrame(() => (el.scrollLeft = (atMs / 1000) * next - (e.clientX - rect.left - HEAD_W)));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // Keep the playhead in view while playing.
  useEffect(
    () =>
      useEditor.subscribe((s, prev) => {
        if (!s.playing || s.playheadMs === prev.playheadMs || !scroll.current) return;
        const el = scroll.current;
        const x = (s.playheadMs / 1000) * s.pps;
        const view = el.clientWidth - HEAD_W;
        if (x > el.scrollLeft + view - 40 || x < el.scrollLeft) el.scrollLeft = Math.max(0, x - 80);
      }),
    [],
  );

  const fit = () => {
    const el = scroll.current;
    if (!el) return;
    const total = Math.max(useEditor.getState().duration(), 1000);
    useEditor.getState().setZoom(((el.clientWidth - HEAD_W - 40) / total) * 1000);
    el.scrollLeft = 0;
  };
  useEffect(() => {
    const onFit = () => fit();
    window.addEventListener("tdr:fit-timeline", onFit);
    return () => window.removeEventListener("tdr:fit-timeline", onFit);
  }, []);

  return (
    <section className="timeline" aria-label={t("timeline.title")}>
      <Toolbar onFit={fit} />
      <div className="tl-scroll" ref={scroll}>
        <div className="tl-canvas" style={{ width: HEAD_W + contentW }}>
          <div className="tl-ruler-row">
            <div className="tl-corner">
              <span className="panel-title">{t("timeline.title")}</span>
            </div>
            <Ruler width={contentW} msToX={msToX} setSnapLine={setSnapLine} />
          </div>
          <CameraLane width={contentW} setSnapLine={setSnapLine} />
          {project.tracks.map((track, index) => (
            <Lane key={track.id} track={track} index={index} width={contentW} setSnapLine={setSnapLine} />
          ))}
          <div className="tl-lane-filler" />
          <InOutRange />
          <PlayheadLine />
          {snapLine !== null && <div className="tl-snap-line" style={{ left: HEAD_W + msToX(snapLine) }} />}
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- toolbar

function Toolbar({ onFit }: { onFit: () => void }) {
  const s = useEditor();
  const shortcuts = useShortcuts((x) => x.map);
  const key = (id: string) => (shortcuts[id] ? ` (${displayShortcut(shortcuts[id]!, isMac)})` : "");
  const hasSel = s.selection.length > 0;
  const total = s.duration();
  return (
    <div className="tl-toolbar">
      <button className="tl-btn play" title={s.t("shortcuts.playPause") + key("transport.playPause")} onClick={() => s.setPlaying(!s.playing)}>
        {s.playing ? "❚❚" : "▶"}
      </button>
      <span className="tl-time" lang="en">
        {formatTimecode(s.playheadMs)} <span className="muted">/ {formatTimecode(total)}</span>
      </span>
      <span className="tl-sep" />
      <button className="tl-btn" title={s.t("edit.split") + key("edit.split")} onClick={s.split}>✂</button>
      <button className="tl-btn" disabled={!hasSel} title={s.t("edit.delete") + key("edit.delete")} onClick={() => s.deleteSelection(false)}>🗑</button>
      <button className="tl-btn" disabled={!hasSel} title={s.t("edit.rippleDelete") + key("edit.rippleDelete")} onClick={() => s.deleteSelection(true)}>⇤</button>
      <button className="tl-btn" disabled={!hasSel} title={s.t("edit.duplicate") + key("edit.duplicate")} onClick={s.duplicateSelection}>⧉</button>
      <button className="tl-btn" disabled={s.selection.length < 2} title={s.t("edit.link") + key("edit.link")} onClick={s.linkSelection}>🔗</button>
      <button className="tl-btn" disabled={!hasSel} title={s.t("edit.unlink") + key("edit.unlink")} onClick={s.unlinkSelection}>⛓̸</button>
      <span className="tl-sep" />
      <button className={`tl-btn ${s.snapping ? "on" : ""}`} aria-pressed={s.snapping} title={s.t("view.snapping") + key("view.snapping")} onClick={s.toggleSnapping}>
        🧲
      </button>
      <button className="tl-btn" title={s.t("insert.marker") + key("insert.marker")} onClick={() => s.addMarkerAtPlayhead()}>⚑</button>
      <select
        className="tl-add"
        value=""
        title={s.t("timeline.addTrack")}
        onChange={(e) => {
          const kind = e.target.value as TrackKind;
          if (kind) s.edit("timeline.addTrack", (p) => ops.addTrack(p, kind, 0).project);
        }}
      >
        <option value="">+ {s.t("timeline.addTrack")}</option>
        {EXTRA_KINDS.map((k) => (
          <option key={k} value={k}>
            {s.t(`track.${k}`)}
          </option>
        ))}
      </select>
      <span className="tl-spacer" />
      <button className="tl-btn" title={s.t("view.zoomOut") + key("view.zoomOut")} onClick={() => s.setZoom(s.pps / 1.5)}>−</button>
      <input
        className="tl-zoom"
        type="range"
        min={Math.log(4)}
        max={Math.log(1200)}
        step={0.01}
        value={Math.log(s.pps)}
        aria-label={s.t("view.zoomIn")}
        onChange={(e) => s.setZoom(Math.exp(Number(e.target.value)))}
      />
      <button className="tl-btn" title={s.t("view.zoomIn") + key("view.zoomIn")} onClick={() => s.setZoom(s.pps * 1.5)}>+</button>
      <button className="tl-btn" title={s.t("view.fitTimeline") + key("view.fitTimeline")} onClick={onFit}>⇔</button>
    </div>
  );
}

// ---------------------------------------------------------------- ruler, markers, playhead

const markerKindKey = (kind: string) =>
  kind === "chapter" ? "insert.chapter" : kind === "quiz" ? "insert.quiz" : kind === "pause" ? "record.paused" : "insert.marker";

function tickStep(pps: number): number {
  const steps = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800];
  return steps.find((st) => st * pps >= 90) ?? 3600;
}

function Ruler({ width, msToX, setSnapLine }: { width: number; msToX: (ms: number) => number; setSnapLine: (ms: number | null) => void }) {
  const t = useEditor((s) => s.t);
  const project = useEditor((s) => s.history.present);
  const pps = useEditor((s) => s.pps);
  const [editing, setEditing] = useState<string | null>(null);
  const step = tickStep(pps);
  const ticks: number[] = [];
  for (let sec = 0; sec * pps <= width; sec += step) ticks.push(sec);

  const scrub = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const st = useEditor.getState();
    st.setPlaying(false);
    const at = (clientX: number, alt: boolean) => {
      const ms = Math.max(0, ((clientX - rect.left) / st.pps) * 1000);
      const s2 = useEditor.getState();
      if (!s2.snapping || alt) return { timeMs: ms };
      return ops.snap(ms, ops.snapPoints(s2.history.present, new Set()), (SNAP_PX / s2.pps) * 1000);
    };
    const move = (ev: PointerEvent) => {
      const r = at(ev.clientX, ev.altKey);
      useEditor.getState().setPlayhead(r.timeMs);
      setSnapLine(r.snappedTo ?? null);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setSnapLine(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    move(e.nativeEvent);
  };

  const dragMarker = (e: ReactPointerEvent, id: string, startMs: number) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    const x0 = e.clientX;
    const st = useEditor.getState();
    st.beginDrag();
    const move = (ev: PointerEvent) => {
      const s2 = useEditor.getState();
      let ms = Math.max(0, startMs + ((ev.clientX - x0) / s2.pps) * 1000);
      if (s2.snapping && !ev.altKey) ms = ops.snap(ms, ops.snapPoints(s2.dragBase ?? s2.history.present, new Set(), s2.playheadMs), (SNAP_PX / s2.pps) * 1000).timeMs;
      s2.dragPreview((p) => ops.updateMarker(p, id, { timeMs: ms }));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      useEditor.getState().endDrag("edit.move");
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div className="tl-ruler" style={{ width }} onPointerDown={scrub}>
      {ticks.map((sec) => (
        <div key={sec} className="tl-tick" style={{ left: msToX(sec * 1000) }}>
          <span lang="en">{formatTimecode(sec * 1000, step < 1)}</span>
        </div>
      ))}
      {project.markers.map((m) => (
        <div
          key={m.id}
          className={`tl-marker ${m.kind}`}
          style={{ left: msToX(m.timeMs) }}
          title={`${m.label || t(markerKindKey(m.kind))} · ${formatTimecode(m.timeMs)}`}
          onPointerDown={(e) => dragMarker(e, m.id, m.timeMs)}
          onDoubleClick={(e) => {
            e.stopPropagation();
            setEditing(m.id);
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            useEditor.getState().edit("timeline.deleteMarker", (p) => ops.removeMarker(p, m.id));
          }}
        >
          <span className="tl-marker-flag" />
          {editing === m.id ? (
            <input
              className="tl-marker-input"
              autoFocus
              defaultValue={m.label}
              aria-label={t("timeline.renameMarker")}
              onPointerDown={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                if (e.key === "Escape") setEditing(null);
              }}
              onBlur={(e) => {
                const label = e.target.value;
                setEditing(null);
                if (label !== m.label) useEditor.getState().edit("timeline.renameMarker", (p) => ops.updateMarker(p, m.id, { label }));
              }}
            />
          ) : (
            (m.label || m.kind === "pause") && (
              <span className="tl-marker-label" lang={/[ༀ-࿿]/.test(m.label || t(markerKindKey(m.kind))) ? "bo" : undefined}>
                {m.label || t(markerKindKey(m.kind))}
              </span>
            )
          )}
        </div>
      ))}
    </div>
  );
}

/** Shaded In/Out range (for speed regions). */
function InOutRange() {
  const inMs = useEditor((s) => s.inMs);
  const outMs = useEditor((s) => s.outMs);
  const pps = useEditor((s) => s.pps);
  if (inMs === null && outMs === null) return null;
  const a = inMs ?? 0;
  const b = outMs ?? a;
  return (
    <>
      {inMs !== null && <div className="tl-inout-edge in" style={{ left: HEAD_W + (inMs / 1000) * pps }} />}
      {outMs !== null && <div className="tl-inout-edge out" style={{ left: HEAD_W + (outMs / 1000) * pps }} />}
      {inMs !== null && outMs !== null && <div className="tl-inout" style={{ left: HEAD_W + (a / 1000) * pps, width: ((b - a) / 1000) * pps }} />}
    </>
  );
}

/**
 * Camera lane: zoom regions. Drag to move, drag an edge to resize, double-click
 * empty space to add a 2.5 s zoom. Suggestions are dashed ghosts with ✓ / ✕.
 */
function CameraLane({ width, setSnapLine }: { width: number; setSnapLine: (ms: number | null) => void }) {
  const t = useEditor((s) => s.t);
  const zooms = useEditor((s) => s.history.present.zooms);
  const pps = useEditor((s) => s.pps);
  const selectedId = useEditor((s) => s.selectedZoomId);
  const suggestions = zooms.filter((z) => z.suggested);

  const drag = (e: ReactPointerEvent<HTMLDivElement>, id: string) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const st = useEditor.getState();
    st.setPlaying(false);
    st.selectZoom(id);
    const z = st.history.present.zooms.find((x) => x.id === id);
    if (!z || z.suggested) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const edge: "start" | "end" | null = e.clientX - rect.left < EDGE_PX ? "start" : rect.right - e.clientX < EDGE_PX ? "end" : null;
    const x0 = e.clientX;
    st.beginDrag();
    const base = useEditor.getState().dragBase!;
    const points = ops.snapPoints(base, new Set(), st.playheadMs);
    let moved = false;
    const move = (ev: PointerEvent) => {
      const s2 = useEditor.getState();
      if (!moved && Math.abs(ev.clientX - x0) < 3) return;
      moved = true;
      const dxMs = ((ev.clientX - x0) / s2.pps) * 1000;
      const threshold = s2.snapping && !ev.altKey ? (SNAP_PX / s2.pps) * 1000 : 0;
      if (edge) {
        const orig = edge === "start" ? z.startMs : z.endMs;
        const r = threshold ? ops.snap(orig + dxMs, points, threshold) : { timeMs: orig + dxMs };
        setSnapLine(r.snappedTo ?? null);
        s2.dragPreview((p) => regions.resizeZoom(p, id, edge, r.timeMs));
      } else {
        const r = threshold ? ops.snapDelta([z.startMs, z.endMs], dxMs, points, threshold) : { deltaMs: dxMs };
        setSnapLine(r.snappedTo ?? null);
        s2.dragPreview((p) => regions.moveZoom(p, id, r.deltaMs));
      }
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setSnapLine(null);
      const s2 = useEditor.getState();
      if (moved) s2.endDrag(edge ? "edit.trim" : "edit.move");
      else s2.cancelDrag();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div className="lane camera-lane" style={{ height: 34 }}>
      <div className="lane-head" onPointerDown={() => useEditor.getState().selectZoom(null)}>
        <span className="lane-swatch" style={{ background: "var(--gold)" }} />
        <span className="lane-name">{t("zoom.lane")}</span>
        {suggestions.length > 0 && (
          <span className="lane-tools">
            <button className="lane-toggle on" title={t("zoom.acceptAll")} onPointerDown={(e) => e.stopPropagation()} onClick={() => useEditor.getState().acceptSuggestions()}>✓</button>
            <button className="lane-toggle" title={t("zoom.rejectAll")} onPointerDown={(e) => e.stopPropagation()} onClick={() => useEditor.getState().rejectSuggestions()}>✕</button>
          </span>
        )}
      </div>
      <div
        className="lane-clips"
        style={{ width }}
        onDoubleClick={(e) => {
          if (e.target !== e.currentTarget) return;
          const rect = e.currentTarget.getBoundingClientRect();
          const st = useEditor.getState();
          st.setPlayhead(((e.clientX - rect.left) / st.pps) * 1000);
          st.addZoomAtPlayhead();
        }}
        onPointerDown={(e) => e.target === e.currentTarget && useEditor.getState().selectZoom(null)}
      >
        {zooms.map((z) => (
          <div
            key={z.id}
            data-zoom={z.id}
            className={`zoom-region ${z.suggested ? "suggested" : ""} ${selectedId === z.id ? "selected" : ""} ${z.mode}`}
            style={{ left: (z.startMs / 1000) * pps, width: Math.max(4, ((z.endMs - z.startMs) / 1000) * pps) }}
            title={`${t(z.mode === "auto" ? "zoom.auto" : "zoom.manual")} · ${t("zoom.depth")} ${z.depth} · ${formatTimecode(z.startMs)} → ${formatTimecode(z.endMs)}`}
            onPointerDown={(e) => drag(e, z.id)}
          >
            <span className="zoom-label" lang="en">
              🔍 {depthLabel(z.depth)}
            </span>
            {z.suggested && (
              <span className="zoom-actions">
                <button title={t("zoom.accept")} onPointerDown={(e) => e.stopPropagation()} onClick={() => useEditor.getState().acceptSuggestions([z.id])}>✓</button>
                <button title={t("zoom.reject")} onPointerDown={(e) => e.stopPropagation()} onClick={() => useEditor.getState().rejectSuggestions([z.id])}>✕</button>
              </span>
            )}
            {!z.suggested && (
              <>
                <span className="clip-edge start" />
                <span className="clip-edge end" />
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

const depthLabel = (depth: number) => `${[1.25, 1.5, 1.8, 2.2, 3.5, 5][depth - 1] ?? 1.5}×`;

function PlayheadLine() {
  const ms = useEditor((s) => s.playheadMs);
  const pps = useEditor((s) => s.pps);
  return (
    <div className="tl-playhead" style={{ left: HEAD_W + (ms / 1000) * pps }}>
      <span className="tl-playhead-cap" />
    </div>
  );
}

// ---------------------------------------------------------------- lanes

function Lane({ track, index, width, setSnapLine }: { track: Track; index: number; width: number; setSnapLine: (ms: number | null) => void }) {
  const t = useEditor((s) => s.t);
  // Select the stable clips array and filter here (a filtered array from the selector
  // would be a new object on every read and re-render forever).
  const allClips = useEditor((s) => s.history.present.clips);
  const clips = allClips.filter((c) => c.trackId === track.id);
  const selectedTrack = useEditor((s) => s.selectedTrackId === track.id);
  const toggleTrack = useEditor((s) => s.toggleTrack);
  const [renaming, setRenaming] = useState(false);
  const height = LANE_H[track.kind];
  const name = track.name || t(`track.${track.kind}`);
  const tibetanName = /[ༀ-࿿]/.test(name);

  return (
    <div className={`lane ${track.hidden ? "is-hidden" : ""} ${track.locked ? "is-locked" : ""}`} style={{ height }} data-lane={index}>
      <div
        className={`lane-head ${selectedTrack ? "selected" : ""}`}
        onPointerDown={() => {
          useEditor.getState().selectTrack(track.id);
          useEditor.getState().select([]);
        }}
      >
        <span className="lane-swatch" style={{ background: KIND_COLOR[track.kind] }} />
        {renaming ? (
          <input
            className="lane-rename"
            autoFocus
            defaultValue={track.name}
            placeholder={t(`track.${track.kind}`)}
            aria-label={t("inspector.name")}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") setRenaming(false);
            }}
            onBlur={(e) => {
              const value = e.target.value.trim();
              setRenaming(false);
              if (value !== track.name) useEditor.getState().edit("inspector.name", (p) => ops.setTrackProps(p, track.id, { name: value }));
            }}
          />
        ) : (
          <span className="lane-name" lang={tibetanName ? "bo" : undefined} onDoubleClick={() => setRenaming(true)} title={name}>
            {name}
          </span>
        )}
        <span className="lane-tools">
          <Toggle on={track.locked} label={t(track.locked ? "track.unlock" : "track.lock")} glyph="🔒" onClick={() => toggleTrack(track.id, "locked")} />
          {ops.isAudioTrack(track) && (
            <>
              <Toggle on={track.muted} label={t("track.mute")} glyph="🔈" onClick={() => toggleTrack(track.id, "muted")} />
              <Toggle on={track.solo} label={t("track.solo")} glyph="🎧" onClick={() => toggleTrack(track.id, "solo")} />
            </>
          )}
          {ops.isVisualTrack(track) && <Toggle on={track.hidden} label={t(track.hidden ? "track.show" : "track.hide")} glyph="◐" onClick={() => toggleTrack(track.id, "hidden")} />}
        </span>
      </div>
      <div
        className="lane-clips"
        style={{ width }}
        onPointerDown={(e) => {
          if (e.target !== e.currentTarget) return;
          // Click on empty lane space: clear selection and move the playhead there.
          const rect = e.currentTarget.getBoundingClientRect();
          const st = useEditor.getState();
          st.select([]);
          st.selectTrack(track.id);
          st.setPlaying(false);
          st.setPlayhead(((e.clientX - rect.left) / st.pps) * 1000);
        }}
      >
        {clips.map((c) => (
          <ClipView key={c.id} clip={c} track={track} laneHeight={height} setSnapLine={setSnapLine} />
        ))}
      </div>
    </div>
  );
}

function Toggle({ on, label, glyph, onClick }: { on: boolean; label: string; glyph: string; onClick: () => void }) {
  return (
    <button
      className={`lane-toggle ${on ? "on" : ""}`}
      title={label}
      aria-label={label}
      aria-pressed={on}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={onClick}
    >
      {glyph}
    </button>
  );
}

// ---------------------------------------------------------------- clips

function clipLabel(project: Project, clip: Clip, track: Track, t: (k: string) => string): string {
  if (clip.content.type === "text") return clip.content.text;
  if (clip.content.type === "shape") return t(clip.content.shape === "arrow" || clip.content.shape === "line" ? "insert.arrow" : "insert.shape");
  const media = project.media.find((m) => m.id === clip.mediaId);
  if (media?.origin === "import") return media.path.split(/[\\/]/).pop() ?? "";
  return track.name || t(`track.${track.kind}`);
}

function ClipView({ clip, track, laneHeight, setSnapLine }: { clip: Clip; track: Track; laneHeight: number; setSnapLine: (ms: number | null) => void }) {
  const t = useEditor((s) => s.t);
  const pps = useEditor((s) => s.pps);
  const selected = useEditor((s) => s.selection.includes(clip.id));
  const project = useEditor((s) => s.history.present);
  const media = project.media.find((m) => m.id === clip.mediaId);
  const left = (clip.startMs / 1000) * pps;
  const width = Math.max(2, (clip.durationMs / 1000) * pps);
  const label = clipLabel(project, clip, track, t);
  const locked = clip.locked || track.locked;

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const st = useEditor.getState();
    st.setPlaying(false);
    st.selectTrack(track.id);
    // Selection: Ctrl/Cmd toggles, Shift adds, plain click keeps a multi-selection if it includes this clip.
    if (e.ctrlKey || e.metaKey) st.select([clip.id], "toggle");
    else if (e.shiftKey) st.select([clip.id], "add");
    else if (!st.selection.includes(clip.id)) st.select([clip.id]);
    if (locked) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const offset = e.clientX - rect.left;
    const edge: "start" | "end" | null = offset < EDGE_PX ? "start" : rect.right - e.clientX < EDGE_PX ? "end" : null;
    const x0 = e.clientX;
    const y0 = e.clientY;
    const laneIndex = project.tracks.findIndex((tr) => tr.id === track.id);
    const ids = useEditor.getState().selection;
    st.beginDrag();
    const base = useEditor.getState().dragBase!;
    const moving = ops.withLinked(base, ids);
    const points = ops.snapPoints(base, moving, st.playheadMs);
    let moved = false;

    const move = (ev: PointerEvent) => {
      const s2 = useEditor.getState();
      const dxMs = ((ev.clientX - x0) / s2.pps) * 1000;
      if (!moved && Math.abs(ev.clientX - x0) < 3 && Math.abs(ev.clientY - y0) < 3) return;
      moved = true;
      const threshold = s2.snapping && !ev.altKey ? (SNAP_PX / s2.pps) * 1000 : 0;
      if (edge) {
        const original = edge === "start" ? clip.startMs : ops.clipEnd(clip);
        const r = threshold ? ops.snap(original + dxMs, points, threshold) : { timeMs: original + dxMs };
        setSnapLine(r.snappedTo ?? null);
        s2.dragPreview((p) => ops.trimClip(p, clip.id, edge, r.timeMs));
      } else {
        const edges = base.clips.filter((c) => moving.has(c.id)).flatMap((c) => [c.startMs, ops.clipEnd(c)]);
        const r = threshold ? ops.snapDelta(edges, dxMs, points, threshold) : { deltaMs: dxMs };
        setSnapLine(r.snappedTo ?? null);
        const laneDelta = laneUnder(ev.clientY) - laneIndex;
        s2.dragPreview((p) => ops.moveClips(p, ids, r.deltaMs, Number.isFinite(laneDelta) ? laneDelta : 0));
      }
    };
    const finish = (commit: boolean) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("keydown", esc);
      setSnapLine(null);
      const s2 = useEditor.getState();
      if (commit && moved) s2.endDrag(edge ? "edit.trim" : "edit.move");
      else s2.cancelDrag();
    };
    const up = () => finish(true);
    const esc = (ev: KeyboardEvent) => ev.key === "Escape" && finish(false);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("keydown", esc);
  };

  return (
    <div
      className={`clip ${selected ? "selected" : ""} ${clip.muted ? "is-muted" : ""} ${clip.hidden ? "is-hidden" : ""} ${locked ? "is-locked" : ""}`}
      style={{ left, width, background: KIND_COLOR[track.kind] }}
      onPointerDown={onPointerDown}
      data-clip={clip.id}
      title={`${label} · ${formatTimecode(clip.startMs)} → ${formatTimecode(ops.clipEnd(clip))}${clip.speed !== 1 ? ` · ${clip.speed}×` : ""}`}
    >
      {media?.kind === "audio" && <Waveform clip={clip} path={media.path} durationMs={media.durationMs} width={width} height={laneHeight - 10} />}
      <span className="clip-label" lang={clip.content.type === "text" ? clip.content.lang : /[ༀ-࿿]/.test(label) ? "bo" : undefined}>
        {clip.linkGroup && <span title={t("timeline.linked")}>🔗 </span>}
        {clip.speed !== 1 && <span lang="en">{clip.speed}× </span>}
        {label}
      </span>
      {clip.fadeInMs > 0 && <span className="clip-fade in" style={{ width: (clip.fadeInMs / 1000) * pps }} />}
      {clip.fadeOutMs > 0 && <span className="clip-fade out" style={{ width: (clip.fadeOutMs / 1000) * pps }} />}
      {!locked && (
        <>
          <span className="clip-edge start" />
          <span className="clip-edge end" />
        </>
      )}
    </div>
  );
}

/** Index of the lane under a screen Y position (NaN outside lanes). */
function laneUnder(clientY: number): number {
  for (const el of document.querySelectorAll<HTMLElement>(".lane[data-lane]")) {
    const r = el.getBoundingClientRect();
    if (clientY >= r.top && clientY < r.bottom) return Number(el.dataset.lane);
  }
  return NaN;
}

function Waveform({ clip, path, durationMs, width, height }: { clip: Clip; path: string; durationMs: number; width: number; height: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [peaks, setPeaks] = useState<Float32Array | null>(null);
  useEffect(() => {
    let alive = true;
    void waveformPeaks(path, durationMs).then((p) => alive && setPeaks(p));
    return () => {
      alive = false;
    };
  }, [path, durationMs]);
  const w = Math.min(Math.round(width), 16_000);
  useLayoutEffect(() => {
    if (canvas.current && peaks) drawWaveform(canvas.current, peaks, clip.sourceInMs, clip.durationMs, clip.speed, "rgba(255,255,255,0.55)");
  }, [peaks, w, height, clip.sourceInMs, clip.durationMs, clip.speed]);
  if (!peaks) return null;
  return <canvas ref={canvas} className="clip-wave" width={w} height={height} />;
}

