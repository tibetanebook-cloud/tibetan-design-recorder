/**
 * Right-hand panel tabs: Properties (the Inspector), Library, Captions,
 * Teaching (chapters, quizzes, steps) and Jobs (background queue).
 */
import { useEffect, useState } from "react";
import { parseSubtitles, type Cue } from "@shared/captions/captions";
import type { TranscribeConfig } from "@shared/captions/transcribe";
import { isLibraryClip, type LibraryContents } from "@shared/library";
import { newId } from "@shared/project/factory";
import { CaptionStyle, type Clip, type Project } from "@shared/project/schema";
import { chapterListText, chapters, stepNumbers } from "@shared/teaching";
import * as ops from "@shared/timeline/ops";
import { exportSubtitles, importMedia, insertAnnotation, insertTitle, runAction } from "../actions";
import { useJobs, type Job } from "../jobs";
import { cuesToCaptionClips, laneCues, transcribeLane } from "../mediaJobs";
import { useEditor, type PanelTab } from "../store";
import { formatTimecode } from "../util/time";
import { WALLPAPERS } from "../compositor/wallpapers";
import { Inspector, Check, NumberField, pct, Section, Slider } from "./Inspector";
import { TITLE_TEMPLATES } from "./ToolPanels";
import { wallpaperThumb } from "./StylePanels";

const TABS: PanelTab[] = ["properties", "library", "captions", "teaching", "jobs"];

export function SidePanel() {
  const t = useEditor((s) => s.t);
  const tab = useEditor((s) => s.panelTab);
  const setTab = useEditor((s) => s.setPanelTab);
  const running = useJobs((s) => s.jobs.filter((j) => j.status === "running" || j.status === "queued").length);
  return (
    <div className="side-panel">
      <nav className="panel-tabs" role="tablist">
        {TABS.map((id) => (
          <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? "active" : ""} data-tab={id} onClick={() => setTab(id)}>
            {t(`panel.${id}`)}
            {id === "jobs" && running > 0 && <span className="badge" lang="en">{running}</span>}
          </button>
        ))}
      </nav>
      {tab === "properties" && <Inspector />}
      {tab === "library" && <LibraryPanel />}
      {tab === "captions" && <CaptionsPanel />}
      {tab === "teaching" && <TeachingPanel />}
      {tab === "jobs" && <JobsPanel />}
    </div>
  );
}

// ---------------------------------------------------------------- library

function Tile({ label, onClick, children, testId }: { label: string; onClick: () => void; children?: React.ReactNode; testId?: string }) {
  return (
    <button className="lib-tile" title={label} onClick={onClick} data-lib={testId}>
      <span className="lib-thumb">{children}</span>
      <span className="lib-label">{label}</span>
    </button>
  );
}

function LibraryPanel() {
  const t = useEditor((s) => s.t);
  const [lib, setLib] = useState<LibraryContents>({ music: [], user: [] });
  const selection = useEditor((s) => s.selection);
  const project = useEditor((s) => s.history.present);
  useEffect(() => void window.tdr.library.list().then(setLib), []);
  const run = (id: string) => runAction(id);
  const savable = project.clips.filter((c) => selection.includes(c.id) && isLibraryClip(c));

  const saveSelection = async () => {
    if (!savable.length) return;
    const t0 = Math.min(...savable.map((c) => c.startMs));
    const first = savable[0]!.content;
    const name = "text" in first ? first.text : "title" in first ? first.title : t(`insert.${first.type}`);
    const item = { id: newId("lib"), name: String(name).slice(0, 40), createdAt: new Date().toISOString(), clips: savable.map(({ trackId: _t, ...c }) => ({ ...c, startMs: c.startMs - t0 })) };
    setLib(await window.tdr.library.saveUser([...lib.user, item]));
  };

  const insertUser = (clips: Omit<Clip, "trackId">[]) => {
    const s = useEditor.getState();
    const created: string[] = [];
    s.edit("library.insert", (p) => {
      let project: Project = p;
      // Each saved clip goes on a free annotation/caption lane at playhead + its offset.
      for (const c of clips) {
        const kind = c.content.type === "caption" ? "caption" : "annotation";
        const at = s.playheadMs + c.startMs;
        let lane = project.tracks.find((tr) => tr.kind === kind && !tr.locked && ops.firstFreeStart(project, tr.id, at, c.durationMs) === at);
        if (!lane) {
          const r = ops.addTrack(project, kind, 0);
          project = r.project;
          lane = project.tracks.find((tr) => tr.id === r.id)!;
        }
        const clip: Clip = { ...structuredClone(c), id: newId("clp"), trackId: lane.id, startMs: at, linkGroup: undefined };
        created.push(clip.id);
        project = { ...project, clips: [...project.clips, clip] };
      }
      return project;
    });
    s.select(created);
  };

  return (
    <div className="props-panel library">
      <Section title={t("effects.titles")}>
        <div className="lib-grid">
          {TITLE_TEMPLATES.map((tpl) => (
            <Tile key={tpl} label={t(`title.${tpl}`)} onClick={() => insertTitle(tpl)} testId={`title.${tpl}`}>
              <span className={`tpl tpl-${tpl}`} />
            </Tile>
          ))}
        </div>
      </Section>
      <Section title={t("library.annotations")}>
        <div className="lib-grid">
          {(["insert.callout", "insert.highlight", "insert.spotlight", "insert.blurRegion", "insert.stepNumber", "insert.arrow", "insert.shape", "insert.text"] as const).map((id) => (
            <Tile key={id} label={t(id)} onClick={() => run(id)} testId={id}>
              <span className={`ico ico-${id.slice(7)}`} />
            </Tile>
          ))}
          <Tile label={t("shape.ellipse")} onClick={() => insertAnnotation("insert.shape", { type: "shape", shape: "ellipse", color: "#e8c56a", strokeWidth: 8, x1: 0, y1: 0, x2: 0, y2: 0 }, (W, H) => ({ x: W * 0.4, y: H * 0.35, width: W * 0.2, height: H * 0.3 }))}>
            <span className="ico ico-ellipse" />
          </Tile>
        </div>
      </Section>
      <Section title={t("library.backgrounds")}>
        <div className="wallpaper-grid">
          {WALLPAPERS.map((w) => (
            <button key={w.id} className="wallpaper" title={t(w.label)} onClick={() => useEditor.getState().edit("effects.background", (p) => ({ ...p, canvas: { ...p.canvas, background: { type: "wallpaper", id: w.id } } }))}>
              <img src={wallpaperThumb(w.id)} alt={t(w.label)} />
            </button>
          ))}
        </div>
      </Section>
      <Section title={t("library.music")}>
        {lib.music.map((m) => (
          <div key={m.path} className="lib-row">
            <span>♪ {t(m.name)}</span>
            <span className="muted small" lang="en">{m.seconds.toFixed(0)} s</span>
            <button onClick={() => void importMedia([m.path])} data-lib={`music.${m.name}`}>{t("library.add")}</button>
          </div>
        ))}
        <p className="muted small">{t("library.musicNote")}</p>
      </Section>
      <Section title={t("library.mine")}>
        <button disabled={!savable.length} onClick={() => void saveSelection()}>{t("library.saveSelection")}</button>
        {lib.user.length === 0 && <p className="muted small">{t("library.mineEmpty")}</p>}
        {lib.user.map((item) => (
          <div key={item.id} className="lib-row">
            <span lang={/[ༀ-࿿]/.test(item.name) ? "bo" : undefined}>{item.name}</span>
            <span className="muted small" lang="en">{item.clips.length}</span>
            <button onClick={() => insertUser(item.clips)}>{t("library.add")}</button>
            <button className="danger" onClick={() => void window.tdr.library.saveUser(lib.user.filter((x) => x.id !== item.id)).then(setLib)}>×</button>
          </div>
        ))}
      </Section>
    </div>
  );
}

// ---------------------------------------------------------------- captions

const LANGS = ["", "en", "bo", "zh", "hi", "ne", "fr", "de", "es", "ja"];

function CaptionsPanel() {
  const t = useEditor((s) => s.t);
  const edit = useEditor((s) => s.edit);
  const project = useEditor((s) => s.history.present);
  const playheadMs = useEditor((s) => s.playheadMs);
  const style = project.captionStyle;
  const captionLanes = project.tracks.filter((tr) => tr.kind === "caption");
  const audioLanes = project.tracks.filter((tr) => ops.isAudioTrack(tr) && project.clips.some((c) => c.trackId === tr.id));
  const [laneId, setLaneId] = useState<string | undefined>(captionLanes[0]?.id);
  const lane = captionLanes.find((l) => l.id === laneId) ?? captionLanes[0];
  const [source, setSource] = useState<string | undefined>(audioLanes.find((l) => l.kind === "mic")?.id ?? audioLanes[0]?.id);
  const [language, setLanguage] = useState("en");
  const [config, setConfig] = useState<TranscribeConfig | null>(null);
  const [showSetup, setShowSetup] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => void window.tdr.transcribe.config().then(setConfig), []);
  const cues = lane ? project.clips.filter((c) => c.trackId === lane.id && c.content.type === "caption").sort((a, b) => a.startMs - b.startMs) : [];
  const setStyle = (patch: Partial<CaptionStyle>) => (p: Project) => ({ ...p, captionStyle: { ...p.captionStyle, ...patch } });

  const importFile = async () => {
    const file = await window.tdr.openText(t("dialog.subtitles"), ["srt", "vtt"]);
    if (!file) return;
    const parsed: Cue[] = parseSubtitles(file.text);
    if (!parsed.length) return setMessage(t("captions.importEmpty"));
    const lang = /[ༀ-࿿]/.test(file.text) ? "bo" : "en";
    edit("captions.import", (p) => cuesToCaptionClips(p, parsed, lang, undefined).project);
    setMessage(`${parsed.length} ${t("captions.imported")}`);
  };

  const transcribe = () => {
    if (!source) return;
    if (!config?.hasKey && !/localhost|127\.0\.0\.1/.test(config?.baseUrl ?? "")) return setShowSetup(true);
    transcribeLane(source, language);
    useEditor.getState().setPanelTab("jobs");
  };

  return (
    <div className="props-panel captions">
      <Section title={t("audio.captions")}>
        <div className="prop">
          <span className="prop-label">{t("captions.from")}</span>
          <select value={source ?? ""} onChange={(e) => setSource(e.target.value)}>
            {audioLanes.map((l) => (
              <option key={l.id} value={l.id}>{l.name || t(`track.${l.kind}`)}</option>
            ))}
          </select>
        </div>
        <div className="prop">
          <span className="prop-label">{t("captions.language")}</span>
          <select value={language} onChange={(e) => setLanguage(e.target.value)} lang="en">
            {LANGS.map((l) => (
              <option key={l} value={l}>{l ? t(`lang.${l}`) : t("captions.autoDetect")}</option>
            ))}
          </select>
        </div>
        {language === "bo" && <p className="muted small">{t("captions.tibetanNote")}</p>}
        <div className="prop-buttons">
          <button className="primary" disabled={!source} onClick={transcribe} data-captions="transcribe">{t("captions.generate")}</button>
          <button onClick={() => setShowSetup(!showSetup)}>{t("captions.service")}</button>
        </div>
        {showSetup && config && <ServiceSetup config={config} onSaved={setConfig} />}
      </Section>

      <Section title={t("captions.cues")}>
        {captionLanes.length > 1 && (
          <select value={lane?.id} onChange={(e) => setLaneId(e.target.value)}>
            {captionLanes.map((l, i) => (
              <option key={l.id} value={l.id}>{l.name || `${t("track.caption")} ${i + 1}`}</option>
            ))}
          </select>
        )}
        <div className="prop-buttons">
          <button onClick={() => void importFile()} data-captions="import">{t("captions.import")}</button>
          <button disabled={!cues.length} onClick={() => void exportSubtitles("srt", lane?.id)}>SRT</button>
          <button disabled={!cues.length} onClick={() => void exportSubtitles("vtt", lane?.id)}>VTT</button>
          <button
            onClick={() =>
              edit("captions.add", (p) => {
                const at = useEditor.getState().playheadMs;
                const existing = lane ? laneCues(p, lane.id) : [];
                const merged = [...existing, { startMs: at, endMs: at + 2500, text: t("captions.newCue") }].sort((a, b) => a.startMs - b.startMs);
                return cuesToCaptionClips(p, merged, useEditor.getState().language, lane?.id).project;
              })
            }
          >
            + {t("captions.addCue")}
          </button>
        </div>
        {message && <p className="muted small">{message}</p>}
        <div className="cue-list">
          {cues.map((c) => (
            <CueRow key={c.id} clip={c} active={playheadMs >= c.startMs && playheadMs < c.startMs + c.durationMs} />
          ))}
          {!cues.length && <p className="muted small">{t("captions.none")}</p>}
        </div>
      </Section>

      <Section title={t("captions.style")}>
        <Slider label={t("inspector.size")} value={style.fontSize} min={20} max={96} step={1} format={(v) => `${Math.round(v)}`} onPreview={(v) => setStyle({ fontSize: v })} />
        <label className="prop">
          <span className="prop-label">{t("inspector.color")}</span>
          <input type="color" value={style.color} onChange={(e) => edit("captions.style", setStyle({ color: e.target.value }))} />
        </label>
        <label className="prop">
          <span className="prop-label">{t("title.background")}</span>
          <input type="color" value={style.background} onChange={(e) => edit("captions.style", setStyle({ background: e.target.value }))} />
        </label>
        <Slider label={t("captions.bgOpacity")} value={style.backgroundOpacity} min={0} max={1} step={0.01} format={pct} onPreview={(v) => setStyle({ backgroundOpacity: v })} />
        <div className="prop">
          <span className="prop-label">{t("inspector.position")}</span>
          <select value={style.position} onChange={(e) => edit("captions.style", setStyle({ position: e.target.value as "top" | "bottom" }))}>
            <option value="bottom">{t("captions.bottom")}</option>
            <option value="top">{t("captions.top")}</option>
          </select>
        </div>
        <Slider label={t("inspector.margin")} value={style.offsetPct} min={0} max={30} step={0.5} format={(v) => `${v}%`} onPreview={(v) => setStyle({ offsetPct: v })} />
        <Slider label={t("captions.width")} value={style.maxWidthPct} min={30} max={95} step={1} format={(v) => `${Math.round(v)}%`} onPreview={(v) => setStyle({ maxWidthPct: v })} />
        <NumberField label={t("captions.rows")} value={style.rows} min={1} onCommit={(v) => edit("captions.style", setStyle({ rows: Math.max(1, Math.min(4, Math.round(v))) }))} />
        <div className="prop">
          <span className="prop-label">{t("text.animation")}</span>
          <select value={style.animation} onChange={(e) => edit("captions.style", setStyle({ animation: e.target.value as CaptionStyle["animation"] }))}>
            {(["none", "fade", "rise", "pop"] as const).map((a) => (
              <option key={a} value={a}>{t(`anim.${a}`)}</option>
            ))}
          </select>
        </div>
      </Section>
    </div>
  );
}

function CueRow({ clip, active }: { clip: Clip; active: boolean }) {
  const edit = useEditor((s) => s.edit);
  if (clip.content.type !== "caption") return null;
  const content = clip.content;
  return (
    <div className={`cue ${active ? "active" : ""}`}>
      <button className="cue-time" lang="en" onClick={() => useEditor.getState().setPlayhead(clip.startMs)}>
        {formatTimecode(clip.startMs)}
      </button>
      <textarea
        key={content.text}
        lang={content.lang}
        rows={Math.min(3, content.text.split("\n").length)}
        defaultValue={content.text}
        // Kept exactly as typed (tsheg/shad untouched).
        onBlur={(e) => e.target.value !== content.text && edit("captions.edit", (p) => ops.setClipProps(p, [clip.id], { content: { ...content, text: e.target.value, lang: /[ༀ-࿿]/.test(e.target.value) ? "bo" : content.lang } }))}
      />
      <button className="cue-del" onClick={() => edit("edit.delete", (p) => ops.deleteClips(p, [clip.id]))}>×</button>
    </div>
  );
}

function ServiceSetup({ config, onSaved }: { config: TranscribeConfig; onSaved: (c: TranscribeConfig) => void }) {
  const t = useEditor((s) => s.t);
  const [baseUrl, setBaseUrl] = useState(config.baseUrl);
  const [model, setModel] = useState(config.model);
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="service-setup">
      <p className="muted small">{t("captions.serviceNote")}</p>
      <label className="prop">
        <span className="prop-label">{t("captions.endpoint")}</span>
        <input lang="en" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
      </label>
      <label className="prop">
        <span className="prop-label">{t("captions.model")}</span>
        <input lang="en" value={model} onChange={(e) => setModel(e.target.value)} />
      </label>
      <label className="prop">
        <span className="prop-label">{t("captions.apiKey")}</span>
        <input lang="en" type="password" autoComplete="off" placeholder={config.hasKey ? "••••••••" : ""} value={key} onChange={(e) => setKey(e.target.value)} />
      </label>
      {error && <p className="error small">{error}</p>}
      <div className="prop-buttons">
        <button
          className="primary"
          onClick={() =>
            void window.tdr.transcribe
              .setConfig({ baseUrl, model, key: key || undefined })
              .then((c) => {
                setKey("");
                onSaved(c);
              })
              .catch((e: unknown) => setError(String(e)))
          }
        >
          {t("inspector.apply")}
        </button>
        {config.hasKey && <button onClick={() => void window.tdr.transcribe.setConfig({ key: "" }).then(onSaved)}>{t("captions.removeKey")}</button>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- teaching

function TeachingPanel() {
  const t = useEditor((s) => s.t);
  const edit = useEditor((s) => s.edit);
  const project = useEditor((s) => s.history.present);
  const duration = useEditor((s) => s.duration());
  const list = chapters(project, duration);
  const quizzes = project.markers.filter((m) => m.kind === "quiz");
  const steps = stepNumbers(project);
  const stepClips = project.clips.filter((c) => c.content.type === "step").sort((a, b) => a.startMs - b.startMs);
  const keys = project.cursor.keystrokes;

  const addQuiz = () =>
    edit("insert.quiz", (p) => {
      // No stored label: the timeline shows the quiz name in the current UI language.
      const r = ops.addMarker(p, useEditor.getState().playheadMs, "quiz");
      return ops.updateMarker(r.project, r.id, { quiz: { question: t("quiz.sampleQuestion"), choices: [t("quiz.choice1"), t("quiz.choice2"), t("quiz.choice3")], correct: 0, explanation: "", lang: useEditor.getState().language, showMs: 6000 } });
    });

  return (
    <div className="props-panel teaching">
      <Section title={t("teaching.chapters")}>
        <div className="prop-buttons">
          <button onClick={() => runAction("insert.chapter")}>+ {t("insert.chapter")}</button>
          <button disabled={!list.length} onClick={() => void window.tdr.saveText(`${project.name || "chapters"}-chapters.txt`, ["txt"], chapterListText(list))}>{t("teaching.exportChapters")}</button>
        </div>
        {list.map((c) => (
          <div key={c.id} className="lib-row">
            <button className="cue-time" lang="en" onClick={() => useEditor.getState().setPlayhead(c.startMs)}>{formatTimecode(c.startMs)}</button>
            <input
              key={c.title}
              defaultValue={c.title}
              placeholder={t("insert.chapter")}
              lang={/[ༀ-࿿]/.test(c.title) ? "bo" : undefined}
              onBlur={(e) => e.target.value !== c.title && edit("timeline.renameMarker", (p) => ops.updateMarker(p, c.id, { label: e.target.value }))}
            />
            <button className="danger" onClick={() => edit("timeline.deleteMarker", (p) => ops.removeMarker(p, c.id))}>×</button>
          </div>
        ))}
        {list.length > 0 && list[0]!.startMs > 0 && <p className="muted small">{t("teaching.firstChapterNote")}</p>}
      </Section>

      <Section title={t("teaching.quizzes")}>
        <button onClick={addQuiz} data-teaching="add-quiz">+ {t("insert.quiz")}</button>
        {quizzes.map((m) => (
          <QuizEditor key={m.id} markerId={m.id} />
        ))}
      </Section>

      <Section title={t("insert.stepNumber")}>
        <button onClick={() => runAction("insert.stepNumber")}>+ {t("insert.stepNumber")}</button>
        {stepClips.map((c) => (
          <div key={c.id} className="lib-row">
            <span className="step-dot" lang="en">{steps.get(c.id)}</span>
            <button className="cue-time" lang="en" onClick={() => { useEditor.getState().setPlayhead(c.startMs); useEditor.getState().select([c.id]); }}>{formatTimecode(c.startMs)}</button>
          </div>
        ))}
      </Section>

      <Section title={t("insert.keystrokes")}>
        <Check label={t("teaching.showKeys")} checked={keys} onChange={() => runAction("insert.keystrokes")} />
      </Section>
    </div>
  );
}

function QuizEditor({ markerId }: { markerId: string }) {
  const t = useEditor((s) => s.t);
  const edit = useEditor((s) => s.edit);
  const marker = useEditor((s) => s.history.present.markers.find((m) => m.id === markerId));
  if (!marker?.quiz) return null;
  const q = marker.quiz;
  const set = (patch: Partial<typeof q>) => edit("quiz.edit", (p) => ops.updateMarker(p, markerId, { quiz: { ...q, ...patch } }));
  const bo = (s: string) => (/[ༀ-࿿]/.test(s) ? "bo" : undefined);
  return (
    <div className="quiz-editor">
      <div className="lib-row">
        <button className="cue-time" lang="en" onClick={() => useEditor.getState().setPlayhead(marker.timeMs + 200)}>{formatTimecode(marker.timeMs)}</button>
        <button className="danger" onClick={() => edit("timeline.deleteMarker", (p) => ops.removeMarker(p, markerId))}>×</button>
      </div>
      <textarea key={q.question} lang={bo(q.question)} defaultValue={q.question} rows={2} onBlur={(e) => e.target.value !== q.question && set({ question: e.target.value, lang: bo(e.target.value) ?? q.lang })} />
      {q.choices.map((choice, i) => (
        <div key={i} className="quiz-choice">
          <input type="radio" name={`correct-${markerId}`} checked={q.correct === i} onChange={() => set({ correct: i })} title={t("quiz.correct")} />
          <input key={choice} lang={bo(choice)} defaultValue={choice} onBlur={(e) => e.target.value !== choice && set({ choices: q.choices.map((c, j) => (j === i ? e.target.value : c)) })} />
          {q.choices.length > 2 && <button onClick={() => set({ choices: q.choices.filter((_, j) => j !== i), correct: q.correct >= i && q.correct > 0 ? q.correct - 1 : q.correct })}>×</button>}
        </div>
      ))}
      {q.choices.length < 6 && <button onClick={() => set({ choices: [...q.choices, `${t("quiz.choice")} ${q.choices.length + 1}`] })}>+ {t("quiz.addChoice")}</button>}
      <input key={q.explanation} placeholder={t("quiz.explanation")} lang={bo(q.explanation)} defaultValue={q.explanation} onBlur={(e) => e.target.value !== q.explanation && set({ explanation: e.target.value })} />
      <NumberField label={t("quiz.showFor")} value={q.showMs / 1000} min={1} step={0.5} suffix={t("inspector.seconds")} onCommit={(v) => set({ showMs: Math.max(1000, Math.min(60000, v * 1000)) })} />
    </div>
  );
}

// ---------------------------------------------------------------- jobs

function JobsPanel() {
  const t = useEditor((s) => s.t);
  const jobs = useJobs((s) => s.jobs);
  const { cancel, clearFinished } = useJobs.getState();
  return (
    <div className="props-panel jobs">
      <div className="panel-title">{t("export.queue")}</div>
      {jobs.length === 0 && <p className="muted small">{t("jobs.empty")}</p>}
      {[...jobs].reverse().map((j) => (
        <JobRow key={j.id} job={j} onCancel={() => cancel(j.id)} />
      ))}
      {jobs.some((j) => j.status !== "running" && j.status !== "queued") && <button onClick={clearFinished}>{t("jobs.clear")}</button>}
      <p className="muted small">{t("jobs.note")}</p>
    </div>
  );
}

function JobRow({ job, onCancel }: { job: Job; onCancel: () => void }) {
  const t = useEditor((s) => s.t);
  const active = job.status === "running" || job.status === "queued";
  const err = job.error && (["no-key", "too-large", "too-long"].includes(job.error) ? t(`jobs.error.${job.error}`) : job.error.startsWith("codec-unsupported") ? t("export.unsupported") : job.error);
  return (
    <div className={`job ${job.status}`} data-job={job.kind} data-status={job.status}>
      <div className="job-head">
        <span>{t(job.label)}</span>
        {job.detail && <span className="muted small" lang="en">{job.detail}</span>}
        <span className={`job-status ${job.status}`}>{t(`jobs.${job.status}`)}</span>
      </div>
      <div className="job-bar"><div style={{ width: `${Math.round(job.progress * 100)}%` }} /></div>
      {job.status === "running" && <JobEta job={job} />}
      {job.result && <div className="muted small" lang="en">{job.result}</div>}
      {err && <div className="error small">{err}</div>}
      <div className="prop-buttons">
        {active && <button onClick={onCancel}>{t("inspector.cancel")}</button>}
        {job.output && job.status === "done" && <button onClick={() => void window.tdr.exporter.reveal(job.output!)} data-reveal>{t("export.reveal")}</button>}
      </div>
    </div>
  );
}

/** Percent and time left, from the speed so far. */
function JobEta({ job }: { job: Job }) {
  const t = useEditor((s) => s.t);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const elapsed = (now - (job.startedAt ?? now)) / 1000;
  const left = job.progress > 0.02 ? (elapsed * (1 - job.progress)) / job.progress : NaN;
  return (
    <div className="muted small" lang="en">
      {Math.round(job.progress * 100)}%{Number.isFinite(left) && <> · <span lang={useEditor.getState().language}>{t("export.timeLeft")}</span> {formatTimecode(left * 1000, false)}</>}
    </div>
  );
}
