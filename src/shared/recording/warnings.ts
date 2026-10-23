/**
 * Recording warnings arrive as "<input>: <technical detail>". For the UI they are
 * split into the input (translated lane name), a plain reason (translated) and
 * the original detail (kept in English, for support).
 */
export type WarningReason = "denied" | "notFound" | "inUse" | "noData" | "noStart" | "noSystemAudio" | "failed";

export interface RecordingWarning {
  input?: "screen" | "webcam" | "mic" | "system";
  reason: WarningReason;
  detail: string;
}

export function describeWarning(raw: string): RecordingWarning {
  const m = /^(screen|webcam|mic|system):\s*(.*)$/s.exec(raw.trim());
  const input = m?.[1] as RecordingWarning["input"];
  const detail = (m?.[2] ?? raw).trim();
  const reason: WarningReason = /NotAllowedError|Permission denied/i.test(detail)
    ? "denied"
    : /NotFoundError|Requested device not found/i.test(detail)
      ? "notFound"
      : /NotReadableError|Could not start (video|audio) source|in use/i.test(detail)
        ? "inUse"
        : /no data recorded/i.test(detail)
          ? "noData"
          : /no system audio/i.test(detail)
            ? "noSystemAudio"
            : /could not start recording/i.test(detail)
              ? "noStart"
              : "failed";
  return { input, reason, detail };
}
