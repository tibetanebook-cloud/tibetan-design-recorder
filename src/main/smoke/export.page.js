// Stage 6 smoke script: exports the edited take (from the Stage 5 run) to every
// format, then reads each file back. `__EXPORT_DIR__` is replaced with a
// temporary folder. Returns [{ name, ok, detail }].
(async () => {
  const T = window.__tdrTest;
  const X = T.tools;
  const S = T.store;
  const st = () => S.getState();
  const P = () => st().history.present;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const results = [];
  const check = (name, ok, detail) => results.push({ name, ok: !!ok, detail: detail == null ? undefined : String(detail) });
  const dir = "__EXPORT_DIR__";
  const sep = dir.includes("\\") ? "\\" : "/";
  const url = (p) => window.tdr.mediaUrl(p);
  const exists = async (p) => (await fetch(url(p)).catch(() => ({ ok: false }))).ok;
  const settings = (patch) => X.ExportSettings.parse({ ...X.DEFAULT_EXPORT, ...patch });
  const run = async (patch, file, timeout = 120000) => {
    const path = dir + sep + file;
    const id = X.enqueueExport(settings(patch), path);
    const job = await Promise.race([X.useJobs.getState().wait(id), sleep(timeout).then(() => null)]);
    return { path, job };
  };
  const decodeAudio = async (p) => {
    const buf = await (await fetch(url(p))).arrayBuffer();
    return new OfflineAudioContext(2, 1, 48000).decodeAudioData(buf);
  };
  const rms = (b) => {
    let s = 0;
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) s += d[i] * d[i];
    return Math.sqrt(s / Math.max(1, d.length));
  };
  const loadVideo = (p) =>
    new Promise((resolve, reject) => {
      const v = document.createElement("video");
      v.crossOrigin = "anonymous";
      v.muted = true;
      v.preload = "auto";
      v.onloadeddata = () => resolve(v);
      v.onerror = () => reject(new Error("video failed to load: " + (v.error && v.error.message)));
      v.src = url(p);
    });
  const seek = (v, t) => new Promise((r) => { v.onseeked = () => r(); v.currentTime = t; });
  const pixels = (src, w, h) => {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const g = c.getContext("2d", { willReadFrequently: true });
    g.drawImage(src, 0, 0, w, h);
    return g.getImageData(0, 0, w, h).data;
  };

  try {
    const range = X.exportRange(P(), { range: "all" }, null, null);
    const durS = (range.endMs - range.startMs) / 1000;

    // 1. MP4 (H.264 + AAC) at "good" quality (75 %).
    const mp4 = await run({ format: "mp4", codec: "h264", quality: "good", fps: 30 }, "smoke.mp4");
    check("MP4 export finishes", mp4.job && mp4.job.status === "done", mp4.job ? `${mp4.job.status}: ${mp4.job.result ?? mp4.job.error}` : "timeout");
    const v = await loadVideo(mp4.path);
    check("MP4 plays back at the chosen size and length", v.videoWidth === 1440 && v.videoHeight === 810 && Math.abs(v.duration - durS) < 0.25, `${v.videoWidth}×${v.videoHeight}, ${v.duration.toFixed(2)} s (timeline ${durS.toFixed(2)} s)`);
    check("hardware or software H.264 encoder reported", /avc1\.\w+ · (hardware|software)/.test(mp4.job.result), mp4.job.result);
    const a = await decodeAudio(mp4.path);
    check("MP4 has the mixed audio (AAC)", a.duration > durS - 0.3 && rms(a) > 0.001, `${a.duration.toFixed(2)} s, rms ${rms(a).toFixed(4)}`);

    // Golden frame: the exported frame matches a direct render of the same time.
    const t = Math.min(1.5, durS / 2);
    await seek(v, t);
    const fr = new X.FrameRenderer(P(), 1440, 810);
    await fr.init();
    const ref = pixels(await fr.render(range.startMs + t * 1000), 360, 202);
    fr.dispose();
    const got = pixels(v, 360, 202);
    let diff = 0;
    for (let i = 0; i < ref.length; i += 4) diff += Math.abs(ref[i] - got[i]) + Math.abs(ref[i + 1] - got[i + 1]) + Math.abs(ref[i + 2] - got[i + 2]);
    const mean = diff / (ref.length / 4) / 3;
    check("exported frame matches the preview renderer (golden frame)", mean < 12, `mean difference ${mean.toFixed(2)} / 255 at ${t}s`);

    // 2. WebM (VP9 + Opus).
    const webm = await run({ format: "webm", codec: "vp9", quality: "medium", fps: 24 }, "smoke.webm");
    let wv = null;
    try { wv = webm.job?.status === "done" ? await loadVideo(webm.path) : null; } catch (e) { wv = null; }
    check("WebM (VP9 + Opus) export plays back", wv && wv.videoWidth === 1152 && wv.videoHeight === 648, webm.job ? `${webm.job.status}: ${webm.job.result ?? webm.job.error}${wv ? ` ${wv.videoWidth}×${wv.videoHeight}` : ""}` : "timeout");

    // 3. GIF.
    const gif = await run({ format: "gif", gif: { size: "720p", fps: 10, loop: true } }, "smoke.gif", 180000);
    const gb = gif.job?.status === "done" ? new Uint8Array(await (await fetch(url(gif.path))).arrayBuffer()) : new Uint8Array();
    const gw = gb.length > 10 ? gb[6] | (gb[7] << 8) : 0;
    // Walk the GIF block structure and count image descriptors.
    let frames = 0;
    if (gb.length > 13) {
      let i = 13;
      if (gb[10] & 0x80) i += 3 * (1 << ((gb[10] & 7) + 1));
      const skipSub = () => { while (i < gb.length && gb[i] !== 0) i += gb[i] + 1; i++; };
      while (i < gb.length) {
        const b = gb[i];
        if (b === 0x3b) break;
        if (b === 0x21) { i += 2; skipSub(); }
        else if (b === 0x2c) {
          frames++;
          const packed = gb[i + 9];
          i += 10;
          if (packed & 0x80) i += 3 * (1 << ((packed & 7) + 1));
          i++; // LZW minimum code size
          skipSub();
        } else break;
      }
    }
    check("GIF export: GIF89a, 720p, one frame per 1/10 s", String.fromCharCode(...gb.subarray(0, 6)) === "GIF89a" && gw === 1280 && Math.abs(frames - Math.round(durS * 10)) <= 1, gif.job ? `${gif.job.status}: ${gif.job.result ?? gif.job.error}; ${gw}px, ${frames} frames` : "timeout");

    // 4. Audio only: MP3, WAV, M4A.
    for (const [format, file] of [["mp3", "smoke.mp3"], ["wav", "smoke.wav"], ["m4a", "smoke.m4a"]]) {
      const r = await run({ format }, file);
      let ok = false, detail = r.job ? `${r.job.status}: ${r.job.result ?? r.job.error}` : "timeout";
      if (r.job?.status === "done") {
        const b = await decodeAudio(r.path);
        ok = Math.abs(b.duration - durS) < 0.15 && rms(b) > 0.001;
        detail += ` · ${b.duration.toFixed(2)} s, rms ${rms(b).toFixed(4)}`;
      }
      check(`${format.toUpperCase()} audio export decodes to the full length`, ok, detail);
    }

    // 5. In/Out range + sidecar captions.
    st().setPlayhead(1000); st().setIn(); st().setPlayhead(2500); st().setOut();
    const part = await run({ format: "mp4", quality: "medium", range: "inout", sidecarSrt: true }, "smoke-range.mp4");
    const pv = part.job?.status === "done" ? await loadVideo(part.path) : null;
    check("In/Out export is only that range", pv && Math.abs(pv.duration - 1.5) < 0.15, pv ? `${pv.duration.toFixed(2)} s` : part.job?.error);
    const srt = await fetch(url(dir + sep + "smoke-range.srt")).then((r) => (r.ok ? r.text() : ""));
    check("captions saved next to the video as .srt", srt.replace(/^﻿/, "").startsWith("1\n00:00:00"), srt.split("\n").slice(0, 2).join(" | "));
    st().clearInOut();

    // 6. Every lane as its own file.
    const ids = X.enqueueTracks(settings({ format: "mp4", quality: "medium", fps: 15 }), dir, "wav");
    // Lanes export one after another; allow for many lanes.
    const done = await Promise.all(ids.map((id) => Promise.race([X.useJobs.getState().wait(id), sleep(900000).then(() => null)])));
    const outs = done.map((j) => j && j.output).filter(Boolean);
    const allThere = (await Promise.all(outs.map(exists))).every(Boolean);
    check("each lane exported as its own file", done.every((j) => j && j.status === "done") && allThere && outs.length === ids.length, outs.map((p) => p.split(/[\\/]/).pop()).join(", "));

    // 7. Cancel: no file and no leftover .part.
    const cancelPath = dir + sep + "smoke-cancel.mp4";
    const cid = X.enqueueExport(settings({ format: "mp4", quality: "source", mode: "quality" }), cancelPath);
    for (let i = 0; i < 200; i++) {
      const j = X.useJobs.getState().jobs.find((x) => x.id === cid);
      if (j && j.status === "running" && j.progress > 0.15) break;
      await sleep(50);
    }
    X.useJobs.getState().cancel(cid);
    const cj = await X.useJobs.getState().wait(cid);
    await sleep(300);
    check("cancelling removes the partial file", cj.status === "cancelled" && !(await exists(cancelPath)) && !(await exists(cancelPath + ".part")), cj.status);

    // 8. The export dialog.
    T.runAction("export.video");
    await sleep(800);
    const dlg = document.querySelector("[data-export-dialog]");
    const opts = dlg ? [...dlg.querySelectorAll("select option")].map((o) => o.textContent) : [];
    check("Export dialog opens from the menu command", !!dlg && dlg.querySelectorAll("[data-format]").length === 3, `${opts.length} options`);
  } catch (e) {
    check("export script ran", false, e && e.stack ? e.stack.slice(0, 500) : String(e));
  }
  return results;
})();
