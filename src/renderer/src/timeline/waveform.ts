/**
 * Waveform peaks per audio file, computed once and cached (PEAKS_PER_SECOND
 * max-abs values). Files longer than MAX_DECODE_MS are skipped for now: decoding
 * them in the renderer would need too much memory (Stage 6 adds an FFmpeg path).
 */
export const PEAKS_PER_SECOND = 100;
const MAX_DECODE_MS = 30 * 60_000;

const cache = new Map<string, Promise<Float32Array | null>>();

export function waveformPeaks(path: string, durationMs: number): Promise<Float32Array | null> {
  let entry = cache.get(path);
  if (!entry) {
    entry = durationMs > MAX_DECODE_MS ? Promise.resolve(null) : decodePeaks(path);
    cache.set(path, entry);
  }
  return entry;
}

async function decodePeaks(path: string): Promise<Float32Array | null> {
  try {
    const data = await (await fetch(window.tdr.mediaUrl(path))).arrayBuffer();
    // Decode at a low rate: plenty for drawing, far less memory.
    const ctx = new OfflineAudioContext(1, 1, 8000);
    const audio = await ctx.decodeAudioData(data);
    const step = Math.max(1, Math.floor(audio.sampleRate / PEAKS_PER_SECOND));
    const peaks = new Float32Array(Math.ceil(audio.length / step));
    for (let ch = 0; ch < audio.numberOfChannels; ch++) {
      const samples = audio.getChannelData(ch);
      for (let i = 0; i < peaks.length; i++) {
        let max = peaks[i]!;
        const end = Math.min(samples.length, (i + 1) * step);
        for (let s = i * step; s < end; s++) {
          const v = Math.abs(samples[s]!);
          if (v > max) max = v;
        }
        peaks[i] = max;
      }
    }
    return peaks;
  } catch {
    return null;
  }
}

/** Draw the part of the waveform a clip shows, at the clip's on-screen width. */
export function drawWaveform(canvas: HTMLCanvasElement, peaks: Float32Array, sourceInMs: number, durationMs: number, speed: number, color: string): void {
  const width = canvas.width;
  const height = canvas.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = color;
  const mid = height / 2;
  // Boost quiet recordings so the shape stays readable (display only).
  let loudest = 0.05;
  for (const v of peaks) if (v > loudest) loudest = v;
  const scale = 0.95 / loudest;
  const sourceSpan = durationMs * speed;
  for (let x = 0; x < width; x++) {
    const a = Math.floor(((sourceInMs + (x / width) * sourceSpan) / 1000) * PEAKS_PER_SECOND);
    const b = Math.max(a + 1, Math.floor(((sourceInMs + ((x + 1) / width) * sourceSpan) / 1000) * PEAKS_PER_SECOND));
    let v = 0;
    for (let i = a; i < b && i < peaks.length; i++) v = Math.max(v, peaks[i]!);
    const h = Math.max(1, v * scale * mid);
    ctx.fillRect(x, mid - h, 1, h * 2);
  }
}
