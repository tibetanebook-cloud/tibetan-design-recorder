/**
 * Inspector panels for any picture clip: animation (keyframes and ready-made behaviours)
 * and visual effects (flip, corners, shadow, border, colour, remove a colour), plus
 * volume over time for sound clips.
 */
import { BEHAVIOR_DURING, BEHAVIOR_IN_OUT, clipMotionAt, setKeyframe, volumeAt } from "@shared/effects/animate";
import { LOOK_PRESETS } from "@shared/effects/webcamStyle";
import { ClipFx, type Clip, type Project } from "@shared/project/schema";
import * as ops from "@shared/timeline/ops";
import { useEditor } from "../store";
import { formatTimecode } from "../util/time";
import { Check, pct, Section, Slider } from "./Inspector";

const setClip = (ids: string[], patch: ops.ClipPatch) => (p: Project) => ops.setClipProps(p, ids, patch);

/** Name of a behaviour in the current language (reuses existing words where there are any). */
const behaviorKey = (kind: string) =>
  kind === "none" ? "record.none" : kind === "fade" ? "transition.fade" : kind === "pop" ? "anim.pop" : kind === "sway" ? "cursor.sway" : `motion.b.${kind}`;

export function MotionPanel({ clip, ids }: { clip: Clip; ids: string[] }) {
  const t = useEditor((s) => s.t);
  const edit = useEditor((s) => s.edit);
  const canvas = useEditor((s) => s.history.present.canvas);
  // Which keyframe the sliders change: the one under the playhead, if any. Only this
  // answer is read from the playhead, so the panel stays still during playback.
  const localMs = useEditor((s) => Math.round(Math.max(0, Math.min(clip.durationMs, s.playheadMs - clip.startMs)) / 34));
  const local = localMs * 34;
  const keys = clip.keyframes ?? [];
  const current = keys.find((k) => Math.abs(k.t - local) < 34);
  const now = clipMotionAt({ ...clip, behavior: undefined }, local, canvas);
  const behavior = clip.behavior ?? { in: "none" as const, inMs: 600, during: "none" as const, amount: 1, out: "none" as const, outMs: 600 };
  const setBehavior = (patch: Partial<typeof behavior>) => setClip(ids, { behavior: { ...behavior, ...patch } });

  /** Slider change: makes or updates the keyframe at the playhead. */
  const setValue = (values: Parameters<typeof setKeyframe>[2]) => (p: Project) => {
    const c = p.clips.find((x) => x.id === clip.id);
    return c ? ops.setClipProps(p, [clip.id], { keyframes: setKeyframe(c, local, values) }) : p;
  };

  return (
    <>
      <Section title={t("motion.title")}>
        <p className="muted small">{t("motion.help")}</p>
        <Slider label={t("inspector.x")} value={now.dx} min={-canvas.width} max={canvas.width} step={1} format={(v) => String(Math.round(v))} onPreview={(dx) => setValue({ dx })} />
        <Slider label={t("inspector.y")} value={now.dy} min={-canvas.height} max={canvas.height} step={1} format={(v) => String(Math.round(v))} onPreview={(dy) => setValue({ dy })} />
        <Slider label={t("motion.scale")} value={now.scale} min={0} max={5} step={0.01} format={pct} onPreview={(scale) => setValue({ scale })} />
        <Slider label={t("motion.rotation")} value={now.rotation} min={-360} max={360} step={1} format={(v) => `${Math.round(v)}°`} onPreview={(rotation) => setValue({ rotation })} />
        <Slider label={t("inspector.opacity")} value={now.opacity} min={0} max={1} step={0.01} format={pct} onPreview={(opacity) => setValue({ opacity })} />
        {current && (
          <label className="prop">
            <span className="prop-label">{t("motion.ease")}</span>
            <select value={current.ease} onChange={(e) => edit("edit.props", setValue({ ease: e.target.value as typeof current.ease }))}>
              <option value="smooth">{t("zoom.ease.smooth")}</option>
              <option value="linear">{t("zoom.ease.linear")}</option>
              <option value="in">{t("motion.easeIn")}</option>
              <option value="out">{t("motion.easeOut")}</option>
            </select>
          </label>
        )}
        <div className="prop-buttons">
          <button data-motion="add" onClick={() => edit("motion.addKeyframe", setValue({}))}>{t("motion.addKeyframe")}</button>
          {current && <button onClick={() => edit("motion.deleteKeyframe", setClip(ids, { keyframes: keys.filter((k) => k !== current) }))}>{t("motion.deleteKeyframe")}</button>}
        </div>
        {keys.length > 0 && (
          <div className="key-list">
            {keys.map((k) => (
              <button key={k.t} className={k === current ? "selected" : ""} lang="en" onClick={() => useEditor.getState().setPlayhead(clip.startMs + k.t)}>
                ◆ {formatTimecode(k.t, true)}
              </button>
            ))}
          </div>
        )}
      </Section>
      <Section title={t("motion.behaviors")}>
        <label className="prop">
          <span className="prop-label">{t("motion.in")}</span>
          <select value={behavior.in} data-behavior="in" onChange={(e) => edit("motion.behaviors", setBehavior({ in: e.target.value as typeof behavior.in }))}>
            {BEHAVIOR_IN_OUT.map((k) => <option key={k} value={k}>{t(behaviorKey(k))}</option>)}
          </select>
        </label>
        {behavior.in !== "none" && <Slider label={t("inspector.duration")} value={behavior.inMs / 1000} min={0.1} max={Math.max(0.2, Math.min(5, clip.durationMs / 1000))} step={0.05} format={(v) => `${v.toFixed(2)} s`} onPreview={(v) => setBehavior({ inMs: v * 1000 })} />}
        <label className="prop">
          <span className="prop-label">{t("motion.during")}</span>
          <select value={behavior.during} onChange={(e) => edit("motion.behaviors", setBehavior({ during: e.target.value as typeof behavior.during }))}>
            {BEHAVIOR_DURING.map((k) => <option key={k} value={k}>{t(behaviorKey(k))}</option>)}
          </select>
        </label>
        {behavior.during !== "none" && <Slider label={t("redact.strength")} value={behavior.amount} min={0} max={4} step={0.05} format={pct} onPreview={(amount) => setBehavior({ amount })} />}
        <label className="prop">
          <span className="prop-label">{t("motion.out")}</span>
          <select value={behavior.out} onChange={(e) => edit("motion.behaviors", setBehavior({ out: e.target.value as typeof behavior.out }))}>
            {BEHAVIOR_IN_OUT.map((k) => <option key={k} value={k}>{t(behaviorKey(k))}</option>)}
          </select>
        </label>
        {behavior.out !== "none" && <Slider label={t("inspector.duration")} value={behavior.outMs / 1000} min={0.1} max={Math.max(0.2, Math.min(5, clip.durationMs / 1000))} step={0.05} format={(v) => `${v.toFixed(2)} s`} onPreview={(v) => setBehavior({ outMs: v * 1000 })} />}
      </Section>
    </>
  );
}

const ADJUST = [
  { key: "brightness", min: -1 },
  { key: "contrast", min: -1 },
  { key: "saturation", min: -1 },
  { key: "temperature", min: -1 },
  { key: "tint", min: -1 },
  { key: "sharpen", min: 0 },
  { key: "vignette", min: 0 },
] as const;

export function PictureFxPanel({ clip, ids }: { clip: Clip; ids: string[] }) {
  const t = useEditor((s) => s.t);
  const edit = useEditor((s) => s.edit);
  const fx: ClipFx = clip.fx ?? ClipFx.parse({});
  const look = fx.look ?? ClipFx.shape.look.unwrap().parse({});
  const chroma = fx.chroma ?? ClipFx.shape.chroma.unwrap().parse({});
  const set = (patch: Partial<ClipFx>) => setClip(ids, { fx: { ...fx, ...patch } });
  const setLook = (patch: Partial<typeof look>) => set({ look: { ...look, ...patch } });
  const setChroma = (patch: Partial<typeof chroma>) => set({ chroma: { ...chroma, ...patch } });
  const signed = (v: number) => `${v > 0 ? "+" : ""}${Math.round(v * 100)}`;
  return (
    <Section title={t("fx.title")}>
      <Check label={t("fx.flipH")} checked={fx.flipH} onChange={(flipH) => edit("fx.flipH", set({ flipH }))} />
      <Check label={t("fx.flipV")} checked={fx.flipV} onChange={(flipV) => edit("fx.flipV", set({ flipV }))} />
      <Slider label={t("inspector.roundness")} value={fx.radius} min={0} max={300} step={1} format={(v) => `${Math.round(v)}`} onPreview={(radius) => set({ radius })} />
      <Slider label={t("inspector.shadow")} value={fx.shadow} min={0} max={2} step={0.05} format={pct} onPreview={(shadow) => set({ shadow })} />
      <Slider label={t("callout.border")} value={fx.border.width} min={0} max={40} step={1} format={(v) => `${Math.round(v)}`} onPreview={(width) => set({ border: { ...fx.border, width } })} />
      {fx.border.width > 0 && (
        <label className="prop">
          <span className="prop-label">{t("inspector.color")}</span>
          <input type="color" value={fx.border.color} onChange={(e) => edit("edit.props", set({ border: { ...fx.border, color: e.target.value } }))} />
        </label>
      )}
      <h4>{t("webcamLook.looks")}</h4>
      <select value={look.preset} data-fx="look" onChange={(e) => edit("webcamLook.preset", setLook({ preset: e.target.value as typeof look.preset }))}>
        {LOOK_PRESETS.map((p) => <option key={p} value={p}>{t(`look.${p}`)}</option>)}
      </select>
      <h4>{t("webcamLook.adjust")}</h4>
      {ADJUST.map(({ key, min }) => (
        <Slider key={key} label={t(`webcamLook.${key}`)} value={look[key]} min={min} max={1} step={0.01} format={min < 0 ? signed : pct} onPreview={(v) => setLook({ [key]: v })} />
      ))}
      <h4>{t("fx.removeColor")}</h4>
      <Check label={t("fx.removeColor")} checked={chroma.enabled} onChange={(enabled) => edit("fx.removeColor", setChroma({ enabled }))} />
      {chroma.enabled && (
        <>
          <label className="prop">
            <span className="prop-label">{t("chroma.key")}</span>
            <input type="color" value={chroma.color} onChange={(e) => edit("edit.props", setChroma({ color: e.target.value }))} />
          </label>
          <Slider label={t("chroma.similarity")} value={chroma.similarity} min={0} max={1} step={0.01} format={pct} onPreview={(similarity) => setChroma({ similarity })} />
          <Slider label={t("chroma.smoothness")} value={chroma.smoothness} min={0} max={1} step={0.01} format={pct} onPreview={(smoothness) => setChroma({ smoothness })} />
          <Slider label={t("chroma.spill")} value={chroma.spill} min={0} max={1} step={0.01} format={pct} onPreview={(spill) => setChroma({ spill })} />
        </>
      )}
      <div className="prop-buttons">
        <button onClick={() => edit("inspector.reset", setClip(ids, { fx: undefined }))}>{t("inspector.reset")}</button>
      </div>
    </Section>
  );
}

/** Volume at chosen moments of a sound clip (drawn straight between points). */
export function VolumePointsPanel({ clip, ids }: { clip: Clip; ids: string[] }) {
  const t = useEditor((s) => s.t);
  const edit = useEditor((s) => s.edit);
  const local = useEditor((s) => Math.round(Math.max(0, Math.min(clip.durationMs, s.playheadMs - clip.startMs)) / 34)) * 34;
  const points = clip.volumePoints ?? [];
  const current = points.find((v) => Math.abs(v.t - local) < 34);
  const setPoint = (gain: number) => (p: Project) => {
    const c = p.clips.find((x) => x.id === clip.id);
    if (!c) return p;
    const list = c.volumePoints ?? [];
    const near = list.find((v) => Math.abs(v.t - local) < 34);
    return ops.setClipProps(p, [clip.id], { volumePoints: [...list.filter((v) => v !== near), { t: near?.t ?? local, gain }].sort((a, b) => a.t - b.t) });
  };
  return (
    <Section title={t("volume.points")}>
      <Slider label={t("track.volume")} value={volumeAt(clip, local)} min={0} max={2} step={0.01} format={pct} onPreview={setPoint} />
      <div className="prop-buttons">
        <button onClick={() => edit("volume.addPoint", setPoint(volumeAt(clip, local)))}>{t("volume.addPoint")}</button>
        {current && <button onClick={() => edit("edit.delete", setClip(ids, { volumePoints: points.filter((v) => v !== current) }))}>{t("edit.delete")}</button>}
        {points.length > 0 && <button onClick={() => edit("volume.clear", setClip(ids, { volumePoints: undefined }))}>{t("volume.clear")}</button>}
      </div>
    </Section>
  );
}
