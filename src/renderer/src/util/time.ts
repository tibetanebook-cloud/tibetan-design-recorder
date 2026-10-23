/** 75_300 -> "01:15", 3_675_000 -> "1:01:15" */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Timeline timecode: 75_300 -> "01:15.30" (hundredths), or "01:15" without fraction. */
export function formatTimecode(ms: number, fraction = true): string {
  const clamped = Math.max(0, ms);
  const base = formatClock(clamped);
  if (!fraction) return base;
  return `${base}.${String(Math.floor((clamped % 1000) / 10)).padStart(2, "0")}`;
}
