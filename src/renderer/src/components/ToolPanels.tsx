/**
 * Properties for the Stage 5 tools: transitions, callouts, highlight/spotlight,
 * redaction, step numbers, title templates, caption cues, lane audio tools and
 * the webcam green screen.
 */
import { AudioFx, TRANSITIONS, type Clip, type ClipContent, type Project, type Track, type Transition } from "@shared/project/schema";
import { fxPreset, levelingGainDb, type FxPreset } from "@shared/audio/fx";
import * as ops from "@shared/timeline/ops";
import { analyzeMedia, laneMediaIds } from "../mediaJobs";
import { useJobs } from "../jobs";
import { useEditor } from "../store";
import { Check, NumberField, pct, Section, Slider } from "./Inspector";

const TIBETAN = /[ༀ-࿿]/;

type Content<T extends ClipContent["type"]> = Extract<ClipContent, { type: T }>;

/** Edit the content of the selected clips (same type). */
function useContentSetter<T extends ClipContent["type"]>(ids: string[], content: Content<T>) {
  const edit = useEditor((s) => s.edit);
  return (patch: Partial<Content<T>>) => edit("edit.props", (p) => ops.setClipProps(p, ids, { content: { ...content, ...patch } as ClipContent }));
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="prop">
      <span className="prop-label">{label}</span>
      <input type="color" value={value.slice(0, 7)} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

function Choice<V extends string>({ label, value, options, onChange }: { label: string; value: V; options: { value: V; label: string }[]; onChange: (v: V) => void }) {
  return (
    <label className="prop">
      <span className="prop-label">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value as V)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Text typed exactly as entered (tsheg and shad kept); language follows the script. */
function TextArea({ value, lang, onCommit, rows = 3 }: { value: string; lang: string; onCommit: (text: string, lang: string) => void; rows?: number }) {
  return (
    <textarea
      key={value}
      className="text-edit"
      lang={lang}
      defaultValue={value}
      rows={rows}
      onBlur={(e) => e.target.value !== value && onCommit(e.target.value, TIBETAN.test(e.target.value) ? "bo" : lang === "bo" ? "en" : lang)}
    />
  );
}

// ---------------------------------------------------------------- transitions

export function TransitionProps({ clips }: { clips: Clip[] }) {
  const t = useEditor((s) => s.t);
  const edit = useEditor((s) => s.edit);
  const ids = clips.map((c) => c.id);
  const clip = clips[0]!;
  const options = [{ value: "none", label: t("transition.none") }, ...TRANSITIONS.map((v) => ({ value: v, label: t(`transition.${v}`) }))];
  const set = (which: "transitionIn" | "transitionOut", tr: Transition | undefined) => edit("effects.transitions", (p) => ({ ...p, clips: p.clips.map((c) => (ids.includes(c.id) ? { ...c, [which]: tr } : c)) }));
  const row = (which: "transitionIn" | "transitionOut", label: string) => {
    const tr = clip[which];
    return (
      <>
        <Choice label={label} value={tr?.type ?? "none"} options={options} onChange={(v) => set(which, v === "none" ? undefined : { type: v as Transition["type"], durationMs: tr?.durationMs ?? 600 })} />
        {tr && (
          <Slider
            label={t("transition.duration")}
            value={tr.durationMs / 1000}
            min={0.1}
            max={Math.min(3, clip.durationMs / 1000)}
            step={0.05}
            format={(v) => `${v.toFixed(2)} s`}
            onPreview={(v) => (p: Project) => ({ ...p, clips: p.clips.map((c) => (ids.includes(c.id) ? { ...c, [which]: { ...tr, durationMs: v * 1000 } } : c)) })}
          />
        )}
      </>
    );
  };
  return (
    <Section title={t("effects.transitions")}>
      {row("transitionIn", t("transition.in"))}
      {row("transitionOut", t("transition.out"))}
    </Section>
  );
}

// ---------------------------------------------------------------- annotations

export function CalloutProps({ ids, content }: { ids: string[]; content: Content<"callout"> }) {
  const t = useEditor((s) => s.t);
  const set = useContentSetter(ids, content);
  return (
    <Section title={t("insert.callout")}>
      <TextArea value={content.text} lang={content.lang} onCommit={(text, lang) => set({ text, lang })} />
      <Choice label={t("callout.style")} value={content.style} options={(["bubble", "box", "pill"] as const).map((v) => ({ value: v, label: t(`callout.${v}`) }))} onChange={(style) => set({ style })} />
      <NumberField label={t("inspector.size")} value={content.fontSize} min={8} onCommit={(v) => set({ fontSize: Math.max(8, v) })} />
      <div className="prop-grid">
        <ColorField label={t("callout.fill")} value={content.fill} onChange={(fill) => set({ fill })} />
        <ColorField label={t("inspector.color")} value={content.color} onChange={(color) => set({ color })} />
        <ColorField label={t("callout.border")} value={content.border} onChange={(border) => set({ border })} />
      </div>
      <Check label={t("callout.tail")} checked={content.tailX !== undefined} onChange={(on) => set(on ? { tailX: 860, tailY: 460 } : { tailX: undefined, tailY: undefined })} />
      {content.tailX !== undefined && (
        <div className="prop-grid">
          <NumberField label={t("callout.tailX")} value={content.tailX} onCommit={(v) => set({ tailX: v })} />
          <NumberField label={t("callout.tailY")} value={content.tailY ?? 0} onCommit={(v) => set({ tailY: v })} />
        </div>
      )}
    </Section>
  );
}

export function HighlightProps({ ids, content }: { ids: string[]; content: Content<"highlight"> }) {
  const t = useEditor((s) => s.t);
  const set = useContentSetter(ids, content);
  return (
    <Section title={t("insert.highlight")}>
      <ColorField label={t("inspector.color")} value={content.color} onChange={(color) => set({ color })} />
      <Slider label={t("inspector.opacity")} value={content.opacity} min={0.05} max={1} step={0.01} format={pct} onPreview={(v) => (p) => ops.setClipProps(p, ids, { content: { ...content, opacity: v } })} />
    </Section>
  );
}

export function SpotlightProps({ ids, content }: { ids: string[]; content: Content<"spotlight"> }) {
  const t = useEditor((s) => s.t);
  const set = useContentSetter(ids, content);
  return (
    <Section title={t("insert.spotlight")}>
      <Choice label={t("spotlight.shape")} value={content.shape} options={[{ value: "ellipse", label: t("spotlight.ellipse") }, { value: "rect", label: t("spotlight.rect") }]} onChange={(shape) => set({ shape })} />
      <Slider label={t("spotlight.dim")} value={content.dim} min={0} max={0.95} step={0.01} format={pct} onPreview={(v) => (p) => ops.setClipProps(p, ids, { content: { ...content, dim: v } })} />
      <Slider label={t("spotlight.feather")} value={content.feather} min={0} max={120} step={1} format={(v) => `${Math.round(v)}`} onPreview={(v) => (p) => ops.setClipProps(p, ids, { content: { ...content, feather: v } })} />
    </Section>
  );
}

export function RedactProps({ ids, content }: { ids: string[]; content: Content<"redact"> }) {
  const t = useEditor((s) => s.t);
  const set = useContentSetter(ids, content);
  return (
    <Section title={t("insert.blurRegion")}>
      <Choice label={t("redact.mode")} value={content.mode} options={(["pixelate", "blur", "solid"] as const).map((v) => ({ value: v, label: t(`redact.${v}`) }))} onChange={(mode) => set({ mode })} />
      {content.mode === "solid" ? (
        <ColorField label={t("inspector.color")} value={content.color} onChange={(color) => set({ color })} />
      ) : (
        <Slider label={t("redact.strength")} value={content.strength} min={4} max={100} step={1} format={(v) => `${Math.round(v)}`} onPreview={(v) => (p) => ops.setClipProps(p, ids, { content: { ...content, strength: v } })} />
      )}
      <p className="muted small">{t("redact.note")}</p>
    </Section>
  );
}

export function StepProps({ ids, content }: { ids: string[]; content: Content<"step"> }) {
  const t = useEditor((s) => s.t);
  const set = useContentSetter(ids, content);
  return (
    <Section title={t("insert.stepNumber")}>
      <Check label={t("step.auto")} checked={content.number === undefined} onChange={(auto) => set({ number: auto ? undefined : 1 })} />
      {content.number !== undefined && <NumberField label={t("step.number")} value={content.number} min={1} onCommit={(v) => set({ number: Math.max(1, Math.round(v)) })} />}
      <div className="prop-grid">
        <ColorField label={t("callout.fill")} value={content.fill} onChange={(fill) => set({ fill })} />
        <ColorField label={t("inspector.color")} value={content.color} onChange={(color) => set({ color })} />
      </div>
    </Section>
  );
}

export const TITLE_TEMPLATES = ["intro", "outro", "lowerThird", "chapter", "quote", "center"] as const;

export function TitleProps({ ids, content }: { ids: string[]; content: Content<"title"> }) {
  const t = useEditor((s) => s.t);
  const set = useContentSetter(ids, content);
  return (
    <Section title={t("effects.titles")}>
      <Choice label={t("title.template")} value={content.template} options={TITLE_TEMPLATES.map((v) => ({ value: v, label: t(`title.${v}`) }))} onChange={(template) => set({ template })} />
      <span className="prop-label">{t("title.title")}</span>
      <TextArea value={content.title} lang={content.lang} rows={2} onCommit={(title, lang) => set({ title, lang })} />
      <span className="prop-label">{t("title.subtitle")}</span>
      <TextArea value={content.subtitle} lang={content.lang} rows={2} onCommit={(subtitle) => set({ subtitle })} />
      <div className="prop-grid">
        <ColorField label={t("title.accent")} value={content.accent} onChange={(accent) => set({ accent })} />
        <ColorField label={t("inspector.color")} value={content.color} onChange={(color) => set({ color })} />
        <ColorField label={t("title.background")} value={content.background} onChange={(background) => set({ background })} />
      </div>
    </Section>
  );
}

export function TextStyleProps({ ids, content }: { ids: string[]; content: Content<"text"> }) {
  const t = useEditor((s) => s.t);
  const set = useContentSetter(ids, content);
  return (
    <>
      <Check label={t("text.bold")} checked={content.bold} onChange={(bold) => set({ bold })} />
      <Choice label={t("text.align")} value={content.align} options={(["left", "center", "right"] as const).map((v) => ({ value: v, label: t(`text.${v}`) }))} onChange={(align) => set({ align })} />
      <Check label={t("text.background")} checked={!!content.background} onChange={(on) => set({ background: on ? "#14151cd9" : undefined })} />
      <Choice
        label={t("text.animation")}
        value={content.animation}
        options={(["none", "fade", "typewriter", "rise", "pop", "wipe"] as const).map((v) => ({ value: v, label: t(`anim.${v}`) }))}
        onChange={(animation) => set({ animation })}
      />
    </>
  );
}

export function CaptionClipProps({ ids, content }: { ids: string[]; content: Content<"caption"> }) {
  const t = useEditor((s) => s.t);
  const set = useContentSetter(ids, content);
  return (
    <Section title={t("captions.cue")}>
      <TextArea value={content.text} lang={content.lang} onCommit={(text, lang) => set({ text, lang })} />
    </Section>
  );
}

/** Content-specific properties for a selected annotation clip. */
export function ContentProps({ clip, ids }: { clip: Clip; ids: string[] }) {
  const c = clip.content;
  switch (c.type) {
    case "callout": return <CalloutProps ids={ids} content={c} />;
    case "highlight": return <HighlightProps ids={ids} content={c} />;
    case "spotlight": return <SpotlightProps ids={ids} content={c} />;
    case "redact": return <RedactProps ids={ids} content={c} />;
    case "step": return <StepProps ids={ids} content={c} />;
    case "title": return <TitleProps ids={ids} content={c} />;
    case "caption": return <CaptionClipProps ids={ids} content={c} />;
    default: return null;
  }
}

// ---------------------------------------------------------------- audio tools

const PRESETS: FxPreset[] = ["voice", "podcast", "warm", "reduceHiss"];

export function AudioFxPanel({ track }: { track: Track }) {
  const t = useEditor((s) => s.t);
  const edit = useEditor((s) => s.edit);
  const project = useEditor((s) => s.history.present);
  const jobs = useJobs((s) => s.jobs);
  const fx = track.audioFx ?? AudioFx.parse({});
  const setFx = (next: AudioFx) => (p: Project) => ops.setTrackProps(p, track.id, { audioFx: next });
  const patch = <K extends keyof AudioFx>(key: K, value: Partial<AudioFx[K]>) => setFx({ ...fx, [key]: { ...fx[key], ...value } });
  const media = laneMediaIds(project, track.id);
  const loudness = media.map((id) => project.analysis[id]?.loudnessLufs).filter((v): v is number => v !== undefined);
  const analysing = jobs.some((j) => j.kind === "analyze" && (j.status === "queued" || j.status === "running"));
  const db = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(1)} dB`;
  return (
    <div className="props-panel audio-fx">
      <div className="panel-title">{t("audio.tools")}</div>
      <div className="preset-row">
        {PRESETS.map((pr) => (
          <button key={pr} onClick={() => {
            edit("audio.preset", setFx(fxPreset(pr)));
            for (const id of media) analyzeMedia(id);
          }}>
            {t(`audio.preset.${pr}`)}
          </button>
        ))}
        <button onClick={() => edit("audio.preset", setFx(AudioFx.parse({})))}>{t("inspector.reset")}</button>
      </div>

      <Section title={t("audio.noiseRemoval")}>
        <Check label={t("audio.enabled")} checked={fx.noise.enabled} onChange={(v) => edit("audio.noiseRemoval", patch("noise", { enabled: v }))} />
        {fx.noise.enabled && <Slider label={t("audio.amount")} value={fx.noise.amount} min={0} max={1} step={0.01} format={pct} onPreview={(v) => patch("noise", { amount: v })} />}
      </Section>

      <Section title={t("audio.leveling")}>
        <Check
          label={t("audio.enabled")}
          checked={fx.leveling.enabled}
          onChange={(v) => {
            edit("audio.leveling", patch("leveling", { enabled: v }));
            if (v) for (const id of media) analyzeMedia(id);
          }}
        />
        {fx.leveling.enabled && (
          <>
            <Slider label={t("audio.target")} value={fx.leveling.targetLufs} min={-30} max={-10} step={0.5} format={(v) => `${v} LUFS`} onPreview={(v) => patch("leveling", { targetLufs: v })} />
            <p className="muted small" lang="en">
              {analysing ? <span lang={useEditor.getState().language}>{t("audio.analysing")}</span> : loudness.length ? `${loudness.map((l) => l.toFixed(1)).join(" / ")} LUFS → ${db(levelingGainDb(loudness[0], fx.leveling.targetLufs))}` : ""}
            </p>
          </>
        )}
      </Section>

      <Section title={t("audio.equalizer")}>
        <Check label={t("audio.enabled")} checked={fx.eq.enabled} onChange={(v) => edit("audio.equalizer", patch("eq", { enabled: v }))} />
        {fx.eq.enabled && (
          <>
            <Slider label={t("audio.highpass")} value={fx.eq.highpassHz} min={0} max={300} step={5} format={(v) => `${Math.round(v)} Hz`} onPreview={(v) => patch("eq", { highpassHz: v })} />
            <Slider label={t("audio.low")} value={fx.eq.lowGain} min={-12} max={12} step={0.5} format={db} onPreview={(v) => patch("eq", { lowGain: v })} />
            <Slider label={t("audio.mid")} value={fx.eq.midGain} min={-12} max={12} step={0.5} format={db} onPreview={(v) => patch("eq", { midGain: v })} />
            <Slider label={t("audio.midFreq")} value={fx.eq.midHz} min={300} max={5000} step={50} format={(v) => `${Math.round(v)} Hz`} onPreview={(v) => patch("eq", { midHz: v })} />
            <Slider label={t("audio.high")} value={fx.eq.highGain} min={-12} max={12} step={0.5} format={db} onPreview={(v) => patch("eq", { highGain: v })} />
          </>
        )}
      </Section>

      <Section title={t("audio.compressor")}>
        <Check label={t("audio.enabled")} checked={fx.compressor.enabled} onChange={(v) => edit("audio.compressor", patch("compressor", { enabled: v }))} />
        {fx.compressor.enabled && (
          <>
            <Slider label={t("audio.threshold")} value={fx.compressor.thresholdDb} min={-50} max={0} step={1} format={db} onPreview={(v) => patch("compressor", { thresholdDb: v })} />
            <Slider label={t("audio.ratio")} value={fx.compressor.ratio} min={1} max={12} step={0.5} format={(v) => `${v}:1`} onPreview={(v) => patch("compressor", { ratio: v })} />
            <Slider label={t("audio.makeup")} value={fx.compressor.makeupDb} min={0} max={18} step={0.5} format={db} onPreview={(v) => patch("compressor", { makeupDb: v })} />
          </>
        )}
      </Section>
    </div>
  );
}

// ---------------------------------------------------------------- green screen

export function GreenScreenPanel() {
  const t = useEditor((s) => s.t);
  const edit = useEditor((s) => s.edit);
  const w = useEditor((s) => s.history.present.webcam);
  const set = (patch: Partial<typeof w.chroma>) => (p: Project) => ({ ...p, webcam: { ...p.webcam, chroma: { ...p.webcam.chroma, ...patch } } });
  return (
    <div className="props-panel">
      <div className="panel-title">{t("effects.greenScreen")}</div>
      <Check label={t("audio.enabled")} checked={w.chroma.enabled} onChange={(v) => edit("effects.greenScreen", set({ enabled: v }))} />
      {w.chroma.enabled && (
        <>
          <ColorField label={t("chroma.key")} value={w.chroma.color} onChange={(color) => edit("effects.greenScreen", set({ color }))} />
          <Slider label={t("chroma.similarity")} value={w.chroma.similarity} min={0.05} max={1} step={0.01} format={pct} onPreview={(v) => set({ similarity: v })} />
          <Slider label={t("chroma.smoothness")} value={w.chroma.smoothness} min={0} max={0.5} step={0.01} format={pct} onPreview={(v) => set({ smoothness: v })} />
          <Slider label={t("chroma.spill")} value={w.chroma.spill} min={0} max={1} step={0.01} format={pct} onPreview={(v) => set({ spill: v })} />
        </>
      )}
      <Check label={t("effects.removeBackground")} checked={w.removeBackground} onChange={(v) => edit("effects.removeBackground", (p) => ({ ...p, webcam: { ...p.webcam, removeBackground: v } }))} />
      {w.removeBackground && <p className="muted small">{t("chroma.modelNeeded")}</p>}
    </div>
  );
}
