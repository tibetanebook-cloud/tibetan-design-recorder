/** Floating recording bar: countdown, timer, pause/resume, stop. Excluded from capture. */
import { useEffect, useState } from "react";
import type { RecorderStatus } from "@shared/recording/types";
import { useEditor } from "../store";
import { formatClock } from "../util/time";

export function Hud() {
  const t = useEditor((s) => s.t);
  const [status, setStatus] = useState<RecorderStatus>({ phase: "idle", elapsedMs: 0 });

  useEffect(() => {
    void window.tdr.rec.status().then(setStatus);
    return window.tdr.rec.onStatus(setStatus);
  }, []);

  if (status.phase === "countdown")
    return (
      <div className="hud countdown" lang="en">
        <span className="countdown-number">{status.countdown}</span>
      </div>
    );

  const paused = status.phase === "paused";
  return (
    <div className="hud">
      <span className={`rec-dot ${paused ? "paused" : ""}`} />
      <span className="hud-time" lang="en">{formatClock(status.elapsedMs)}</span>
      <span className="hud-state">
        {t(paused ? "record.paused" : "record.recording")}
        {!!status.warnings?.length && <span className="hud-warning" title={status.warnings.join("\n")}> ⚠</span>}
      </span>
      <button className="hud-btn" title={t(paused ? "record.resume" : "record.pause")} onClick={() => void (paused ? window.tdr.rec.resume() : window.tdr.rec.pause())}>
        {paused ? "▶" : "❚❚"}
      </button>
      <button className="hud-btn stop" title={t("record.stop")} onClick={() => void window.tdr.rec.stop()}>
        ■
      </button>
    </div>
  );
}
