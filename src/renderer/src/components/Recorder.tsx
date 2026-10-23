/**
 * Recorder setup / device test screen: choose what to record, see each input live
 * (webcam preview, mic and system-audio meters), then start. Each input is
 * recorded as its own file and lands on its own lane in the editor.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { describeWarning } from "@shared/recording/warnings";
import { RECORDING_HOTKEYS, type CaptureSource, type DisplayInfo, type RecordingSettings, type RecorderStatus } from "@shared/recording/types";
import { meterPosition, startMeter } from "../audio/meter";
import { useEditor } from "../store";
import { useRecorderSettings } from "../recorderSettings";

const isWindows = window.tdr.platform === "win32";
const hotkeyLabel = (acc: string) => acc.replace("CommandOrControl", window.tdr.platform === "darwin" ? "⌘" : "Ctrl");

export function Recorder() {
  const t = useEditor((s) => s.t);
  const { settings, update } = useRecorderSettings();
  const [sources, setSources] = useState<CaptureSource[]>([]);
  const [displays, setDisplays] = useState<DisplayInfo[]>([]);
  const [cams, setCams] = useState<MediaDeviceInfo[]>([]);
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [status, setStatus] = useState<RecorderStatus>({ phase: "idle", elapsedMs: 0 });

  const refresh = useCallback(async () => {
    const [srcs, disps] = await Promise.all([window.tdr.rec.listSources(), window.tdr.rec.listDisplays()]);
    setSources(srcs);
    setDisplays(disps);
    // Default to the first display right away (before the slower device probe).
    const firstDisplay = srcs.find((s) => s.kind === "display");
    const current = useRecorderSettings.getState().settings;
    if (firstDisplay && !srcs.some((s) => s.id === current.screen.sourceId))
      update({ screen: { ...current.screen, kind: "display", sourceId: firstDisplay.id, displayId: firstDisplay.displayId ?? disps[0]?.id ?? "", region: undefined } });
    // Ask once so device labels are available, then list devices.
    try {
      const probe = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      probe.getTracks().forEach((tr) => tr.stop());
    } catch {
      /* no camera or mic is fine */
    }
    const devices = await navigator.mediaDevices.enumerateDevices();
    setCams(devices.filter((d) => d.kind === "videoinput"));
    setMics(devices.filter((d) => d.kind === "audioinput"));
  }, [update]);

  useEffect(() => {
    void refresh();
    void window.tdr.rec.status().then(setStatus);
    const offStatus = window.tdr.rec.onStatus(setStatus);
    navigator.mediaDevices.addEventListener("devicechange", refresh);
    return () => {
      offStatus();
      navigator.mediaDevices.removeEventListener("devicechange", refresh);
    };
  }, [refresh]);

  const chooseSource = (src: CaptureSource) =>
    update({ screen: { ...settings.screen, kind: src.kind, sourceId: src.id, displayId: src.displayId ?? settings.screen.displayId, region: undefined } });

  const chooseRegion = async () => {
    const display = sources.find((s) => s.id === settings.screen.sourceId && s.kind === "display") ?? sources.find((s) => s.kind === "display");
    if (!display) return;
    const displayId = display.displayId ?? displays[0]?.id ?? "";
    const region = await window.tdr.rec.selectRegion(displayId);
    if (region) update({ screen: { ...settings.screen, kind: "region", sourceId: display.id, displayId, region } });
  };

  const busy = status.phase !== "idle" && status.phase !== "error";
  const start = () => void window.tdr.rec.start(useRecorderSettings.getState().settings);

  // Global hotkey asks the UI to start with the current settings.
  useEffect(() => window.tdr.rec.onHotkeyStart(start), []);
  // Record ▸ Start Recording from the menu.
  useEffect(() => {
    const onStart = () => start();
    window.addEventListener("tdr:record-start", onStart);
    return () => window.removeEventListener("tdr:record-start", onStart);
  }, []);

  return (
    <div className="recorder">
      <section className="rec-section">
        <h2>{t("record.source")}</h2>
        <div className="source-grid">
          {sources.map((src) => {
            const selected = settings.screen.sourceId === src.id && (src.kind !== "display" || settings.screen.kind !== "region");
            return (
              <button key={src.id} className={`source-card ${selected ? "selected" : ""}`} onClick={() => chooseSource(src)}>
                <img src={src.thumbnail} alt="" />
                <span className="source-name">
                  {src.kind === "display" && <>{t("record.fullDisplay")} · </>}
                  {/* The OS's own window/screen name: shown as is, in its own script. */}
                  <span data-l10n-skip lang={/[ༀ-࿿]/.test(src.name) ? "bo" : "en"}>{src.name}</span>
                </span>
              </button>
            );
          })}
          <button className={`source-card region ${settings.screen.kind === "region" ? "selected" : ""}`} onClick={() => void chooseRegion()}>
            <span className="region-icon">⬚</span>
            <span className="source-name">
              {t("record.region")}
              {settings.screen.region && <span lang="en"> · {Math.round(settings.screen.region.width)}×{Math.round(settings.screen.region.height)}</span>}
            </span>
          </button>
        </div>
        <div className="row">
          <label>{t("record.frameRate")}</label>
          <Segmented value={settings.screen.fps} options={[30, 60] as const} onChange={(fps) => update({ screen: { ...settings.screen, fps } })} />
        </div>
      </section>

      <div className="rec-columns">
        <WebcamPanel cams={cams} settings={settings} update={update} />
        <section className="rec-section">
          <h2>{t("record.microphone")}</h2>
          <select value={settings.mic.deviceId ?? ""} onChange={(e) => update({ mic: { deviceId: e.target.value || null } })}>
            <option value="">{t("record.none")}</option>
            {mics.map((m) => (
              <option key={m.deviceId} value={m.deviceId} data-l10n-skip>{m.label || m.deviceId.slice(0, 8)}</option>
            ))}
          </select>
          <MicMeter deviceId={settings.mic.deviceId} />
        </section>
        <section className="rec-section">
          <h2>{t("record.systemAudio")}</h2>
          <label className="check">
            <input type="checkbox" checked={settings.systemAudio} disabled={!isWindows} onChange={(e) => update({ systemAudio: e.target.checked })} />
            {t("record.systemAudio")}
          </label>
          {isWindows ? <SystemMeter enabled={settings.systemAudio} /> : <p className="muted small">{t("record.systemAudioHelper")}</p>}
        </section>
        <section className="rec-section">
          <h2>{t("record.cursorData")}</h2>
          <label className="check">
            <input type="checkbox" checked={settings.cursor.enabled} onChange={(e) => update({ cursor: { ...settings.cursor, enabled: e.target.checked } })} />
            {t("record.recordClicks")}
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={settings.cursor.recordTypedKeys}
              disabled={!settings.cursor.enabled}
              onChange={(e) => update({ cursor: { ...settings.cursor, recordTypedKeys: e.target.checked } })}
            />
            {t("record.recordTypedKeys")}
          </label>
          <div className="row">
            <label>{t("record.countdown")}</label>
            <Segmented value={settings.countdownSec} options={[0, 3, 5, 10] as const} onChange={(countdownSec) => update({ countdownSec })} />
          </div>
        </section>
      </div>

      <div className="rec-footer">
        <div className="hotkeys muted small">
          <span>{t("record.start")} / {t("record.stop")}: <kbd lang="en">{hotkeyLabel(RECORDING_HOTKEYS.toggleRecord)}</kbd></span>
          <span>{t("record.pause")}: <kbd lang="en">{hotkeyLabel(RECORDING_HOTKEYS.togglePause)}</kbd></span>
          <span>{t("record.cancel")}: <kbd lang="en">{hotkeyLabel(RECORDING_HOTKEYS.cancel)}</kbd></span>
          <span>{t("insert.marker")}: <kbd lang="en">{hotkeyLabel(RECORDING_HOTKEYS.marker)}</kbd></span>
        </div>
        {status.phase === "error" && <div className="rec-error">{t("status.error")}: <span lang="en">{status.error}</span></div>}
        {!!status.warnings?.length && (
          <div className="rec-error">
            ⚠ {t("record.inputFailed")}:
            {status.warnings.map(describeWarning).map((w, i) => (
              <div key={i} className="rec-warning">
                {w.input && <b>{t(`track.${w.input}`)}: </b>}
                {t(`record.warn.${w.reason}`)}
                <small lang="en" data-l10n-skip> ({w.detail})</small>
              </div>
            ))}
          </div>
        )}
        <button className="record-button" disabled={busy || !settings.screen.sourceId} onClick={start}>
          ● {t("record.start")}
        </button>
      </div>
    </div>
  );
}

function WebcamPanel({ cams, settings, update }: { cams: MediaDeviceInfo[]; settings: RecordingSettings; update: (p: Partial<RecordingSettings>) => void }) {
  const t = useEditor((s) => s.t);
  const video = useRef<HTMLVideoElement>(null);
  const [bubble, setBubble] = useState(false);
  const { deviceId, width, height, fps } = settings.webcam;

  useEffect(() => {
    if (!deviceId) return;
    let stream: MediaStream | null = null;
    void navigator.mediaDevices
      .getUserMedia({ video: { deviceId: { exact: deviceId }, width: { ideal: width }, height: { ideal: height }, frameRate: { ideal: fps } } })
      .then((s) => {
        stream = s;
        if (video.current) video.current.srcObject = s;
      })
      .catch(() => undefined);
    return () => stream?.getTracks().forEach((tr) => tr.stop());
  }, [deviceId, width, height, fps]);

  useEffect(() => {
    void window.tdr.rec.showBubble(bubble ? deviceId : null);
  }, [bubble, deviceId]);
  useEffect(() => () => void window.tdr.rec.showBubble(null), []);

  return (
    <section className="rec-section">
      <h2>{t("record.webcam")}</h2>
      <select value={deviceId ?? ""} onChange={(e) => update({ webcam: { ...settings.webcam, deviceId: e.target.value || null } })}>
        <option value="">{t("record.none")}</option>
        {cams.map((c) => (
          <option key={c.deviceId} value={c.deviceId} data-l10n-skip>{c.label || c.deviceId.slice(0, 8)}</option>
        ))}
      </select>
      {deviceId && (
        <>
          <video ref={video} className="cam-preview" autoPlay muted playsInline />
          <div className="row">
            <label>{t("record.resolution")}</label>
            <Segmented
              value={height}
              options={[720, 1080] as const}
              format={(h) => `${h}p`}
              onChange={(h) => update({ webcam: { ...settings.webcam, height: h, width: Math.round((h * 16) / 9) } })}
            />
          </div>
          <div className="row">
            <label>{t("record.frameRate")}</label>
            <Segmented value={fps} options={[30, 60] as const} onChange={(f) => update({ webcam: { ...settings.webcam, fps: f } })} />
          </div>
          <label className="check">
            <input type="checkbox" checked={bubble} onChange={(e) => setBubble(e.target.checked)} />
            {t("record.showBubble")}
          </label>
        </>
      )}
    </section>
  );
}

function Meter({ level }: { level: number }) {
  const pos = meterPosition(level);
  return (
    <div className="meter" role="meter" aria-valuenow={Math.round(pos * 100)} aria-valuemin={0} aria-valuemax={100}>
      <div className="meter-fill" style={{ width: `${pos * 100}%` }} />
    </div>
  );
}

function MicMeter({ deviceId }: { deviceId: string | null }) {
  const [level, setLevel] = useState(0);
  useEffect(() => {
    if (!deviceId) return setLevel(0);
    let stop = () => {};
    let stream: MediaStream | null = null;
    void navigator.mediaDevices
      .getUserMedia({ audio: { deviceId: { exact: deviceId }, echoCancellation: false, noiseSuppression: false, autoGainControl: false } })
      .then((s) => {
        stream = s;
        stop = startMeter(s, setLevel);
      })
      .catch(() => undefined);
    return () => {
      stop();
      stream?.getTracks().forEach((tr) => tr.stop());
    };
  }, [deviceId]);
  return <Meter level={level} />;
}

function SystemMeter({ enabled }: { enabled: boolean }) {
  const [level, setLevel] = useState(0);
  useEffect(() => {
    if (!enabled) return setLevel(0);
    let stop = () => {};
    let stream: MediaStream | null = null;
    void navigator.mediaDevices
      .getDisplayMedia({ video: true, audio: true })
      .then((s) => {
        stream = s;
        s.getVideoTracks().forEach((tr) => tr.stop()); // only the loopback audio is needed
        if (s.getAudioTracks().length) stop = startMeter(new MediaStream(s.getAudioTracks()), setLevel);
      })
      .catch(() => undefined);
    return () => {
      stop();
      stream?.getTracks().forEach((tr) => tr.stop());
    };
  }, [enabled]);
  return <Meter level={level} />;
}

function Segmented<T extends number>({ value, options, onChange, format }: { value: T; options: readonly T[]; onChange: (v: T) => void; format?: (v: T) => string }) {
  return (
    <div className="segmented" lang="en">
      {options.map((o) => (
        <button key={o} className={o === value ? "selected" : ""} onClick={() => onChange(o)}>
          {format ? format(o) : o}
        </button>
      ))}
    </div>
  );
}
