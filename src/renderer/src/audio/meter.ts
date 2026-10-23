/** Live level meter for a MediaStream: returns peak level 0..1 via a callback ~30x/s. */
export function startMeter(stream: MediaStream, onLevel: (level: number) => void): () => void {
  const ctx = new AudioContext();
  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  source.connect(analyser);
  const data = new Float32Array(analyser.fftSize);
  let raf = 0;
  let smoothed = 0;
  const loop = () => {
    analyser.getFloatTimeDomainData(data);
    let peak = 0;
    for (const v of data) peak = Math.max(peak, Math.abs(v));
    // Fast attack, slow release, like a hardware meter.
    smoothed = peak > smoothed ? peak : smoothed * 0.92 + peak * 0.08;
    onLevel(Math.min(1, smoothed));
    raf = requestAnimationFrame(loop);
  };
  loop();
  return () => {
    cancelAnimationFrame(raf);
    source.disconnect();
    void ctx.close();
  };
}

/** 0..1 linear peak -> 0..1 position on a -60..0 dBFS scale. */
export function meterPosition(level: number): number {
  if (level <= 0.001) return 0;
  const db = 20 * Math.log10(level);
  return Math.max(0, Math.min(1, (db + 60) / 60));
}
