/**
 * Export dialog: one video (MP4 / WebM / GIF), audio only (MP3 / WAV / M4A),
 * every lane as its own file, or a batch of project files. Queued exports run
 * in the background (Jobs panel).
 */
import { useEffect, useMemo, useState } from "react";
import { exportableLanes, exportRange } from "@shared/export/plan";
import {
  AUDIO_FORMATS,
  codecsFor,
  DEFAULT_EXPORT,
  estimateBytes,
  ExportSettings,
  FILE_EXTENSION,
  outputSize,
  videoBitrate,
  VIDEO_FORMATS,
  type ExportFormat,
} from "@shared/export/settings";
import { pickVideoConfig } from "../export/exporter";
import { enqueueBatch, enqueueExport, enqueueTracks, formatBytes, safeName } from "../export/exportJobs";
import { useEditor, type ExportMode } from "../store";
import { formatTimecode } from "../util/time";
import { Check } from "./Inspector";

const STORAGE_KEY = "tdr.export.settings";

function loadSettings(): ExportSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? ExportSettings.parse(JSON.parse(raw)) : DEFAULT_EXPORT;
  } catch {
    return DEFAULT_EXPORT;
  }
}
function saveSettings(s: ExportSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    // Storage unavailable: settings just aren't remembered.
  }
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="prop">
      <span className="prop-label">{label}</span>
      {children}
    </label>
  );
}

export function ExportDialog({ mode, onClose }: { mode: ExportMode; onClose: () => void }) {
  const t = useEditor((s) => s.t);
  const project = useEditor((s) => s.history.present);
  const inMs = useEditor((s) => s.inMs);
  const outMs = useEditor((s) => s.outMs);
  const [s, setS] = useState<ExportSettings>(() => {
    const saved = loadSettings();
    // Keep the format family the dialog was opened for.
    if (mode === "audio" && !(AUDIO_FORMATS as readonly string[]).includes(saved.format)) return { ...saved, format: "mp3" };
    if (mode !== "audio" && (AUDIO_FORMATS as readonly string[]).includes(saved.format)) return { ...saved, format: "mp4" };
    return saved;
  });
  const [trackAudio, setTrackAudio] = useState<"wav" | "m4a" | "mp3">("wav");
  const [supported, setSupported] = useState<Record<string, string | null>>({});
  const [message, setMessage] = useState<string | null>(null);
  const set = (patch: Partial<ExportSettings>) => setS((prev) => ExportSettings.parse({ ...prev, ...patch }));

  const range = exportRange(project, s, inMs, outMs);
  const size = outputSize(project.canvas, s);
  const isVideo = (VIDEO_FORMATS as readonly string[]).includes(s.format);
  const codecs = codecsFor(s.format);
  const lanes = useMemo(() => exportableLanes(project), [project]);

  // Which codecs this computer can encode at this size (hardware or software).
  useEffect(() => {
    if (!codecs.length) return;
    let live = true;
    void Promise.all(codecs.map(async (c) => [c, (await pickVideoConfig({ ...s, codec: c }, size.width, size.height))?.label ?? null] as const)).then((r) => live && setSupported(Object.fromEntries(r)));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.format, s.hardware, size.width, size.height]);
  useEffect(() => {
    if (codecs.length && !codecs.includes(s.codec)) set({ codec: codecs[0]! });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.format]);

  const start = async () => {
    saveSettings(s);
    const st = useEditor.getState();
    if (mode === "tracks") {
      const folder = await window.tdr.exporter.pickFolder();
      if (!folder) return;
      enqueueTracks(s, folder, trackAudio);
    } else if (mode === "batch") {
      const files = await window.tdr.exporter.pickProjects();
      if (!files.length) return;
      const folder = await window.tdr.exporter.pickFolder();
      if (!folder) return;
      const r = await enqueueBatch(s, files, folder);
      if (r.failed.length) return setMessage(`${t("export.batchFailed")}: ${r.failed.join(", ")}`);
    } else {
      const path = await window.tdr.exporter.pickPath(safeName(project.name), FILE_EXTENSION[s.format]);
      if (!path) return;
      enqueueExport(s, path);
    }
    st.setPanelTab("jobs");
    onClose();
  };

  const formats: ExportFormat[] = mode === "audio" ? [...AUDIO_FORMATS] : [...VIDEO_FORMATS];
  const title = t(mode === "audio" ? "export.audioOnly" : mode === "tracks" ? "export.tracks" : mode === "batch" ? "export.batch" : "export.video");
  const durationMs = range.endMs - range.startMs;

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal export-dialog" role="dialog" aria-labelledby="export-title" data-export-dialog>
        <h2 id="export-title">{title}</h2>

        {mode === "tracks" && (
          <p className="muted small">
            {t("export.tracksNote")} ({lanes.length})
          </p>
        )}
        {mode === "batch" && <p className="muted small">{t("export.batchNote")}</p>}

        <div className="export-grid">
          <div className="format-row" role="radiogroup" aria-label={t("export.format")}>
            {formats.map((f) => (
              <button key={f} className={s.format === f ? "selected" : ""} data-format={f} onClick={() => set({ format: f })} lang="en">
                {f.toUpperCase()}
              </button>
            ))}
          </div>

          {isVideo && s.format !== "gif" && (
            <>
              <Row label={t("export.codec")}>
                <select value={s.codec} onChange={(e) => set({ codec: e.target.value as ExportSettings["codec"] })} lang="en">
                  {codecs.map((c) => (
                    <option key={c} value={c} disabled={supported[c] === null}>
                      {c.toUpperCase()}
                      {supported[c] === null ? ` — ${t("export.unsupported")}` : ""}
                    </option>
                  ))}
                </select>
              </Row>
              <Row label={t("export.quality")}>
                <select value={s.quality} onChange={(e) => set({ quality: e.target.value as ExportSettings["quality"] })}>
                  {(["source", "high", "good", "medium"] as const).map((q) => (
                    <option key={q} value={q}>{t(`export.q.${q}`)}</option>
                  ))}
                </select>
              </Row>
              <Row label={t("export.frameRate")}>
                <select value={s.fps} onChange={(e) => set({ fps: Number(e.target.value) })} lang="en">
                  {[24, 25, 30, 50, 60].map((f) => (
                    <option key={f} value={f}>{f} fps</option>
                  ))}
                </select>
              </Row>
              <Row label={t("export.mode")}>
                <select value={s.mode} onChange={(e) => set({ mode: e.target.value as ExportSettings["mode"] })}>
                  {(["fast", "balanced", "quality"] as const).map((m) => (
                    <option key={m} value={m}>{t(`export.m.${m}`)}</option>
                  ))}
                </select>
              </Row>
              <Row label={t("export.gpu")}>
                <select value={s.hardware} onChange={(e) => set({ hardware: e.target.value as ExportSettings["hardware"] })}>
                  {(["auto", "hardware", "software"] as const).map((h) => (
                    <option key={h} value={h}>{t(`export.hw.${h}`)}</option>
                  ))}
                </select>
              </Row>
              <Row label={t("export.bitrate")}>
                <input type="number" min={0} max={200} step={0.5} lang="en" value={s.bitrateMbps} onChange={(e) => set({ bitrateMbps: Math.max(0, Number(e.target.value) || 0) })} />
                <span className="prop-unit" lang="en">Mbps {s.bitrateMbps === 0 ? `(auto ${(videoBitrate(s, size.width, size.height) / 1e6).toFixed(1)})` : ""}</span>
              </Row>
            </>
          )}

          {s.format === "gif" && (
            <>
              <Row label={t("inspector.size")}>
                <select value={s.gif.size} onChange={(e) => set({ gif: { ...s.gif, size: e.target.value as ExportSettings["gif"]["size"] } })} lang="en">
                  <option value="720p">720p</option>
                  <option value="1080p">1080p</option>
                  <option value="original">{t("export.original")}</option>
                </select>
              </Row>
              <Row label={t("export.frameRate")}>
                <select value={s.gif.fps} onChange={(e) => set({ gif: { ...s.gif, fps: Number(e.target.value) } })} lang="en">
                  {[10, 15, 20, 25, 30].map((f) => (
                    <option key={f} value={f}>{f} fps</option>
                  ))}
                </select>
              </Row>
              <Check label={t("export.loop")} checked={s.gif.loop} onChange={(loop) => set({ gif: { ...s.gif, loop } })} />
            </>
          )}

          {(mode === "audio" || (isVideo && s.format !== "gif") || mode === "tracks") && s.format !== "wav" && (
            <Row label={t("export.audioBitrate")}>
              <select value={s.audioKbps} onChange={(e) => set({ audioKbps: Number(e.target.value) })} lang="en">
                {[96, 128, 160, 192, 256, 320].map((k) => (
                  <option key={k} value={k}>{k} kbps</option>
                ))}
              </select>
            </Row>
          )}

          {mode === "tracks" && (
            <Row label={t("export.trackAudio")}>
              <select value={trackAudio} onChange={(e) => setTrackAudio(e.target.value as typeof trackAudio)} lang="en">
                <option value="wav">WAV</option>
                <option value="m4a">M4A (AAC)</option>
                <option value="mp3">MP3</option>
              </select>
            </Row>
          )}

          {mode !== "batch" && (
            <Row label={t("export.range")}>
              <select value={s.range} onChange={(e) => set({ range: e.target.value as ExportSettings["range"] })}>
                <option value="all">{t("export.rangeAll")}</option>
                <option value="inout" disabled={inMs === null || outMs === null}>{t("export.rangeInOut")}</option>
              </select>
            </Row>
          )}

          {isVideo && mode !== "tracks" && (
            <>
              <Check label={t("export.burnCaptions")} checked={s.burnCaptions} onChange={(burnCaptions) => set({ burnCaptions })} />
              {s.format !== "gif" && <Check label={t("export.sidecarSrt")} checked={s.sidecarSrt} onChange={(sidecarSrt) => set({ sidecarSrt })} />}
            </>
          )}
        </div>

        {mode !== "batch" && (
          <p className="export-summary muted small" lang="en">
            {isVideo && `${size.width} × ${size.height} · `}
            {formatTimecode(durationMs)} · ≈ {formatBytes(estimateBytes(s, project.canvas, durationMs) * (mode === "tracks" ? Math.max(1, lanes.length) : 1))}
            {isVideo && s.format !== "gif" && supported[s.codec] ? ` · ${supported[s.codec]}` : ""}
          </p>
        )}
        {message && <p className="error small">{message}</p>}

        <div className="modal-actions">
          <button onClick={onClose}>{t("inspector.cancel")}</button>
          <button className="primary" disabled={isVideo && s.format !== "gif" && supported[s.codec] === null} onClick={() => void start()} data-export-start>
            {t(mode === "tracks" || mode === "batch" ? "export.chooseFolder" : "export.start")}
          </button>
        </div>
      </div>
    </div>
  );
}
