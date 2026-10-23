/**
 * Properties of the selected clip(s), the selected lane, or the canvas.
 * Sliders preview live while dragging and become one undo step when released.
 */
import type { ReactNode } from "react";
import type { Clip, Crop, Project, Rect, Track } from "@shared/project/schema";
import { buildScene, contentFrame } from "@shared/scene/buildScene";
import * as ops from "@shared/timeline/ops";
import { useEditor } from "../store";
import { formatTimecode } from "../util/time";
import { CameraSettings, CursorPanel, FramePanel, WebcamPanel, ZoomPanel } from "./StylePanels";
import { AudioFxPanel, ContentProps, GreenScreenPanel, TextStyleProps, TransitionProps } from "./ToolPanels";

const SPEED_PRESETS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 4];

export function Inspector() {
  const t = useEditor((s) => s.t);
  const project = useEditor((s) => s.history.present);
  const selection = useEditor((s) => s.selection);
  const trackId = useEditor((s) => s.selectedTrackId);
  const zoomId = useEditor((s) => s.selectedZoomId);
  const clips = project.clips.filter((c) => selection.includes(c.id));
  const track = project.tracks.find((tr) => tr.id === (clips[0]?.trackId ?? trackId));

  // Lane-specific styling shown under the clip or lane properties.
  const lanePanel = (lane: Track | undefined) =>
    !lane ? null : lane.kind === "webcam" ? (
      <>
        <WebcamPanel />
        <GreenScreenPanel />
      </>
    ) : lane.kind === "cursor" ? <CursorPanel /> : lane.kind === "screen" ? <FramePanel /> : ops.isAudioTrack(lane) ? <AudioFxPanel track={lane} /> : null;

  if (zoomId)
    return (
      <aside className="inspector">
        <ZoomPanel />
      </aside>
    );
  return (
    <aside className="inspector">
      {clips.length > 0 ? (
        <>
          <ClipInspector project={project} clips={clips} />
          {lanePanel(track)}
        </>
      ) : track ? (
        <>
          <TrackInspector project={project} track={track} />
          {lanePanel(track)}
        </>
      ) : (
        <>
          <CanvasInspector project={project} />
          <FramePanel />
          <CursorPanel />
          <WebcamPanel />
          <CameraSettings />
        </>
      )}
      {clips.length === 0 && !track && <p className="muted small">{t("inspector.noSelection")}</p>}
    </aside>
  );
}

// ---------------------------------------------------------------- helpers

/** A slider that previews while dragging and commits one history step on release. */
export function Slider({ label, value, min, max, step, format, onPreview }: { label: string; value: number; min: number; max: number; step: number; format: (v: number) => string; onPreview: (v: number) => (p: Project) => Project }) {
  const preview = (v: number) => useEditor.getState().dragPreview(onPreview(v));
  return (
    <label className="prop">
      <span className="prop-label">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onPointerDown={() => useEditor.getState().beginDrag()}
        onPointerUp={() => useEditor.getState().endDrag("edit.props")}
        onKeyDown={() => useEditor.getState().dragBase === null && useEditor.getState().beginDrag()}
        onKeyUp={() => useEditor.getState().endDrag("edit.props")}
        onChange={(e) => {
          if (!useEditor.getState().dragBase) useEditor.getState().beginDrag();
          preview(Number(e.target.value));
        }}
      />
      <span className="prop-value" lang={/[ༀ-࿿]/.test(format(value)) ? "bo" : "en"}>{format(value)}</span>
    </label>
  );
}

/** Number field that commits on Enter/blur. */
export function NumberField({ label, value, step = 1, min, onCommit, suffix }: { label: string; value: number; step?: number; min?: number; onCommit: (v: number) => void; suffix?: string }) {
  return (
    <label className="prop">
      <span className="prop-label">{label}</span>
      <input
        key={value}
        type="number"
        lang="en"
        defaultValue={Math.round(value * 1000) / 1000}
        step={step}
        min={min}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        onBlur={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v) && v !== value) onCommit(v);
        }}
      />
      {suffix && <span className="prop-unit">{suffix}</span>}
    </label>
  );
}

export function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="check">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="prop-section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

export const pct = (v: number) => `${Math.round(v * 100)}%`;

// ---------------------------------------------------------------- clip

function ClipInspector({ project, clips }: { project: Project; clips: Clip[] }) {
  const t = useEditor((s) => s.t);
  const edit = useEditor((s) => s.edit);
  const ids = clips.map((c) => c.id);
  const clip = clips[0]!;
  const track = project.tracks.find((tr) => tr.id === clip.trackId)!;
  const audio = ops.isAudioTrack(track);
  // Cursor clips have no picture of their own (their look is in the Cursor panel).
  const visual = !audio && track.kind !== "cursor";
  const s = t("inspector.seconds");
  const setProps = (patch: ops.ClipPatch) => (p: Project) => ops.setClipProps(p, ids, patch);

  // Effective frame (defaults come from the scene builder, e.g. the webcam bubble).
  const layer = buildScene({ ...project, tracks: project.tracks.map((tr) => ({ ...tr, hidden: false })), clips: [{ ...clip, hidden: false }] }, clip.startMs).layers[0];
  const frame: Rect = clip.frame ?? layer?.frame ?? contentFrame(project);
  const crop: Crop = clip.crop ?? { left: 0, top: 0, right: 0, bottom: 0 };
  const setFrame = (patch: Partial<Rect>) => edit("edit.props", setProps({ frame: { ...frame, ...patch } }));

  return (
    <div className="props-panel">
      <div className="panel-title">
        {t("inspector.clip")}
        {clips.length > 1 && (
          <span className="muted small" lang="en">
            {" "}
            · {clips.length} <span lang={useEditor.getState().language}>{t("inspector.multiple")}</span>
          </span>
        )}
      </div>

      <Section title={t("timeline.time")}>
        <NumberField label={t("inspector.start")} value={clip.startMs / 1000} step={0.01} min={0} suffix={s} onCommit={(v) => edit("edit.move", (p) => ops.moveClips(p, [clip.id], v * 1000 - clip.startMs))} />
        <NumberField
          label={t("inspector.duration")}
          value={clip.durationMs / 1000}
          step={0.01}
          min={0.02}
          suffix={s}
          onCommit={(v) => edit("edit.trim", (p) => ops.trimClip(p, clip.id, "end", clip.startMs + v * 1000))}
        />
        <div className="prop">
          <span className="prop-label">{t("inspector.speed")}</span>
          <select value={SPEED_PRESETS.includes(clip.speed) ? clip.speed : ""} lang="en" onChange={(e) => e.target.value && edit("edit.props", setProps({ speed: Number(e.target.value) }))}>
            {!SPEED_PRESETS.includes(clip.speed) && <option value="">{clip.speed}×</option>}
            {SPEED_PRESETS.map((v) => (
              <option key={v} value={v}>
                {v}×
              </option>
            ))}
          </select>
          <input
            key={clip.speed}
            className="prop-small"
            type="number"
            lang="en"
            min={ops.MIN_SPEED}
            max={ops.MAX_SPEED}
            step={0.05}
            defaultValue={clip.speed}
            onBlur={(e) => Number(e.target.value) !== clip.speed && edit("edit.props", setProps({ speed: Number(e.target.value) }))}
          />
        </div>
        <p className="muted small" lang="en">
          {formatTimecode(clip.startMs)} → {formatTimecode(ops.clipEnd(clip))}
        </p>
      </Section>

      {audio && (
        <Section title={t("menu.audio")}>
          <Slider label={t("track.volume")} value={clip.volume} min={0} max={4} step={0.01} format={pct} onPreview={(v) => setProps({ volume: v })} />
        </Section>
      )}

      <Section title={`${t("audio.fadeIn")} / ${t("audio.fadeOut")}`}>
        <Slider label={t("audio.fadeIn")} value={clip.fadeInMs / 1000} min={0} max={Math.min(10, clip.durationMs / 1000)} step={0.05} format={(v) => `${v.toFixed(2)} s`} onPreview={(v) => setProps({ fadeInMs: v * 1000 })} />
        <Slider label={t("audio.fadeOut")} value={clip.fadeOutMs / 1000} min={0} max={Math.min(10, clip.durationMs / 1000)} step={0.05} format={(v) => `${v.toFixed(2)} s`} onPreview={(v) => setProps({ fadeOutMs: v * 1000 })} />
      </Section>

      {visual && (
        <Section title={t("inspector.properties")}>
          <Slider label={t("inspector.opacity")} value={clip.opacity} min={0} max={1} step={0.01} format={pct} onPreview={(v) => setProps({ opacity: v })} />
          <div className="prop-grid">
            <NumberField label={t("inspector.x")} value={frame.x} onCommit={(v) => setFrame({ x: v })} />
            <NumberField label={t("inspector.y")} value={frame.y} onCommit={(v) => setFrame({ y: v })} />
            <NumberField label={t("inspector.width")} value={frame.width} min={1} onCommit={(v) => setFrame({ width: Math.max(1, v) })} />
            <NumberField label={t("inspector.height")} value={frame.height} min={1} onCommit={(v) => setFrame({ height: Math.max(1, v) })} />
          </div>
          {clip.frame && (
            <button className="link-btn" onClick={() => edit("inspector.reset", (p) => ({ ...p, clips: p.clips.map((c) => (ids.includes(c.id) ? { ...c, frame: undefined } : c)) }))}>
              {t("inspector.reset")}
            </button>
          )}
          {clip.content.type === "media" && (
            <>
              <h4>{t("inspector.crop")}</h4>
              {(["left", "top", "right", "bottom"] as const).map((side) => (
                <Slider key={side} label={t(`inspector.${side}`)} value={crop[side]} min={0} max={0.45} step={0.005} format={pct} onPreview={(v) => setProps({ crop: { ...crop, [side]: v } })} />
              ))}
            </>
          )}
        </Section>
      )}

      {clip.content.type === "text" && <TextProps clip={clip} ids={ids} />}
      {clip.content.type === "shape" && <ShapeProps clip={clip} ids={ids} />}
      <ContentProps clip={clip} ids={ids} />
      {visual && track.kind !== "caption" && <TransitionProps clips={clips} />}

      <Section title={t("inspector.clip")}>
        {audio && <Check label={t("track.mute")} checked={clip.muted} onChange={(v) => edit("track.mute", setProps({ muted: v }))} />}
        {visual && <Check label={t("track.hide")} checked={clip.hidden} onChange={(v) => edit("track.hide", setProps({ hidden: v }))} />}
        <Check label={t("track.lock")} checked={clip.locked} onChange={(v) => edit("track.lock", setProps({ locked: v }))} />
        {clip.linkGroup && <p className="muted small">🔗 {t("timeline.linked")}</p>}
      </Section>
    </div>
  );
}

function ShapeProps({ clip, ids }: { clip: Clip; ids: string[] }) {
  const t = useEditor((s) => s.t);
  const edit = useEditor((s) => s.edit);
  if (clip.content.type !== "shape") return null;
  const content = clip.content;
  const set = (patch: Partial<typeof content>) => edit("edit.props", (p) => ops.setClipProps(p, ids, { content: { ...content, ...patch } }));
  const line = content.shape === "arrow" || content.shape === "line";
  return (
    <Section title={t(line ? "insert.arrow" : "insert.shape")}>
      <label className="prop">
        <span className="prop-label">{t("inspector.color")}</span>
        <input type="color" value={content.color} onChange={(e) => set({ color: e.target.value })} />
      </label>
      <NumberField label={t("shape.stroke")} value={content.strokeWidth} min={0} onCommit={(v) => set({ strokeWidth: Math.max(0, v) })} />
      {!line && <Check label={t("shape.fill")} checked={!!content.fill} onChange={(on) => set({ fill: on ? `${content.color}55` : undefined })} />}
      {line && (
        <div className="prop-grid">
          <NumberField label="x1" value={content.x1} onCommit={(v) => set({ x1: v })} />
          <NumberField label="y1" value={content.y1} onCommit={(v) => set({ y1: v })} />
          <NumberField label="x2" value={content.x2} onCommit={(v) => set({ x2: v })} />
          <NumberField label="y2" value={content.y2} onCommit={(v) => set({ y2: v })} />
        </div>
      )}
    </Section>
  );
}

function TextProps({ clip, ids }: { clip: Clip; ids: string[] }) {
  const t = useEditor((s) => s.t);
  const edit = useEditor((s) => s.edit);
  if (clip.content.type !== "text") return null;
  const content = clip.content;
  const set = (patch: Partial<typeof content>) => edit("edit.props", (p) => ops.setClipProps(p, ids, { content: { ...content, ...patch } }));
  return (
    <Section title={t("insert.text")}>
      <textarea
        key={content.text}
        className="text-edit"
        lang={content.lang}
        defaultValue={content.text}
        rows={3}
        // Stored exactly as typed: no trimming or reformatting (keeps tsheg and shad).
        onBlur={(e) => e.target.value !== content.text && set({ text: e.target.value, lang: /[ༀ-࿿]/.test(e.target.value) ? "bo" : content.lang })}
      />
      <NumberField label={t("inspector.size")} value={content.fontSize} min={8} onCommit={(v) => set({ fontSize: Math.max(8, v) })} />
      <label className="prop">
        <span className="prop-label">{t("inspector.color")}</span>
        <input type="color" value={content.color} onChange={(e) => set({ color: e.target.value })} />
      </label>
      <TextStyleProps ids={ids} content={content} />
    </Section>
  );
}

// ---------------------------------------------------------------- lane

function TrackInspector({ project, track }: { project: Project; track: Track }) {
  const t = useEditor((s) => s.t);
  const edit = useEditor((s) => s.edit);
  const set = (patch: ops.TrackPatch) => (p: Project) => ops.setTrackProps(p, track.id, patch);
  const index = project.tracks.indexOf(track);
  const removable = !["screen", "webcam", "mic", "system"].includes(track.kind);
  return (
    <div className="props-panel">
      <div className="panel-title">
        {t("inspector.lane")} · {track.name || t(`track.${track.kind}`)}
      </div>
      <label className="prop">
        <span className="prop-label">{t("inspector.name")}</span>
        <input
          key={track.name}
          defaultValue={track.name}
          placeholder={t(`track.${track.kind}`)}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          onBlur={(e) => e.target.value.trim() !== track.name && edit("inspector.name", set({ name: e.target.value.trim() }))}
        />
      </label>
      {ops.isAudioTrack(track) ? (
        <>
          <Slider label={t("track.volume")} value={track.volume} min={0} max={4} step={0.01} format={pct} onPreview={(v) => set({ volume: v })} />
          <Slider label={t("track.pan")} value={track.pan} min={-1} max={1} step={0.01} format={(v) => {
              const word = (k: string) => t(k).replace(/།$/, "");
              return Math.abs(v) < 0.01 ? word("anchor.center") : `${word(v < 0 ? "anchor.left" : "anchor.right")} ${Math.round(Math.abs(v) * 100)}`;
            }} onPreview={(v) => set({ pan: v })} />
          <Check label={t("track.mute")} checked={track.muted} onChange={(v) => edit("track.mute", set({ muted: v }))} />
          <Check label={t("track.solo")} checked={track.solo} onChange={(v) => edit("track.solo", set({ solo: v }))} />
        </>
      ) : (
        <>
          <Slider label={t("inspector.opacity")} value={track.opacity} min={0} max={1} step={0.01} format={pct} onPreview={(v) => set({ opacity: v })} />
          <Check label={t("track.hide")} checked={track.hidden} onChange={(v) => edit("track.hide", set({ hidden: v }))} />
        </>
      )}
      <Check label={t("track.lock")} checked={track.locked} onChange={(v) => edit("track.lock", set({ locked: v }))} />
      <div className="prop-buttons">
        <button disabled={index === 0} onClick={() => edit("inspector.moveUp", (p) => ops.moveTrack(p, track.id, index - 1))}>↑ {t("inspector.moveUp")}</button>
        <button disabled={index === project.tracks.length - 1} onClick={() => edit("inspector.moveDown", (p) => ops.moveTrack(p, track.id, index + 1))}>↓ {t("inspector.moveDown")}</button>
        {removable && (
          <button
            className="danger"
            onClick={() => {
              edit("inspector.removeLane", (p) => ops.removeTrack(p, track.id));
              useEditor.getState().selectTrack(null);
            }}
          >
            {t("inspector.removeLane")}
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- canvas

function CanvasInspector({ project }: { project: Project }) {
  const t = useEditor((s) => s.t);
  const c = project.canvas;
  return (
    <div className="props-panel">
      <div className="panel-title">{t("inspector.canvas")}</div>
      <dl className="props">
        <dt>{t("inspector.size")}</dt>
        <dd lang="en">{c.width} × {c.height}</dd>
        <dt>{t("export.frameRate")}</dt>
        <dd lang="en">{c.fps}</dd>
        <dt>{t("effects.background")}</dt>
        <dd>
          {t(
            c.background.type === "gradient"
              ? "inspector.gradient"
              : c.background.type === "solid"
                ? "inspector.solidColor"
                : c.background.type === "wallpaper"
                  ? "inspector.wallpaper"
                  : "inspector.customImage",
          )}
        </dd>
        <dt>{t("inspector.padding")}</dt>
        <dd lang="en">{Math.round(c.padding * 100)}%</dd>
        <dt>{t("inspector.roundness")}</dt>
        <dd lang="en">{c.cornerRadius}px</dd>
      </dl>
    </div>
  );
}
