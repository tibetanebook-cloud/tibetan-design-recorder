// Stage 5 smoke script: runs in the editor page on the recorded take (screen,
// fake webcam, fake mic). Returns [{ name, ok, detail }]. `__MOCK_STT__` is
// replaced by the address of a local mock speech-to-text server.
(async () => {
  const T = window.__tdrTest;
  const X = T.tools;
  const S = T.store;
  const st = () => S.getState();
  const P = () => st().history.present;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const results = [];
  const check = (name, ok, detail) => results.push({ name, ok: !!ok, detail: detail == null ? undefined : String(detail) });
  const lane = (kind) => P().tracks.find((t) => t.kind === kind);
  const clipOn = (kind) => P().clips.find((c) => c.trackId === lane(kind)?.id);
  const frame = async (t) => {
    st().setPlayhead(t);
    await sleep(60);
    await T.playback.current.requestFrame(t);
    await sleep(120);
  };
  const stats = (r, hex, tol) => T.compositor.current.regionStats(r, hex, tol);
  const byType = (type) => P().clips.filter((c) => c.content.type === type);

  try {
    const W = P().canvas.width, H = P().canvas.height;
    const duration = st().duration();

    // 1. Insert every annotation tool at the playhead.
    st().setPlayhead(300);
    st().select([]);
    for (const id of ["insert.callout", "insert.highlight", "insert.spotlight", "insert.blurRegion", "insert.stepNumber", "insert.stepNumber"]) T.runAction(id);
    const types = ["callout", "highlight", "spotlight", "redact", "step"];
    check("insert callout, highlight, spotlight, blur region, step numbers", types.every((t) => byType(t).length >= 1), types.map((t) => `${t}:${byType(t).length}`).join(" "));
    const allOnAnnotation = P().clips.filter((c) => types.includes(c.content.type)).every((c) => P().tracks.find((t) => t.id === c.trackId)?.kind === "annotation");
    check("annotations go on annotation lanes at the playhead", allOnAnnotation && byType("callout")[0].startMs === 300);
    const sc = T.scene(1200);
    const steps = sc.layers.filter((l) => l.content.type === "step").map((l) => l.stepNumber);
    check("step numbers count up automatically", JSON.stringify(steps.sort()) === "[1,2]", JSON.stringify(steps));
    check("redaction, highlight, spotlight and steps follow the camera", sc.layers.filter((l) => ["redact", "highlight", "spotlight", "step"].includes(l.content.type)).every((l) => l.inCamera));

    // 2. Redaction really hides pixels. Put the region over the detailed wallpaper border.
    // No camera zoom and no webcam over the test region while measuring.
    const saved = { zooms: P().zooms, webcam: P().webcam };
    st().edit("t", (p) => ({ ...p, zooms: [], webcam: { ...p.webcam, layout: "hidden" }, canvas: { ...p.canvas, background: { type: "wallpaper", id: "gold-lattice" } } }));
    const redact = byType("redact")[0];
    const region = { x: 20, y: 4, width: 420, height: 56 };
    const setRedact = (patch) => st().edit("t", (p) => ({ ...p, clips: p.clips.map((c) => (c.id === redact.id ? { ...c, ...patch } : c)) }));
    setRedact({ frame: region, hidden: true });
    await frame(1500);
    const plain = stats(region);
    setRedact({ hidden: false, content: { ...redact.content, mode: "pixelate", strength: 24 } });
    await frame(1500);
    const pix = stats(region);
    setRedact({ content: { ...redact.content, mode: "blur", strength: 30 } });
    await frame(1500);
    const blur = stats(region);
    setRedact({ content: { ...redact.content, mode: "solid", color: "#ff00ff" } });
    await frame(1500);
    const solid = stats(region, "#ff00ff", 30);
    check("pixelate removes detail under the region", pix.detail < plain.detail * 0.5, `detail ${plain.detail.toFixed(1)} → ${pix.detail.toFixed(1)}`);
    check("blur removes detail under the region", blur.detail < plain.detail * 0.35, `detail ${plain.detail.toFixed(1)} → ${blur.detail.toFixed(1)}`);
    check("solid block covers the region", solid.near > solid.total * 0.95, `${solid.near}/${solid.total} px`);
    st().edit("t", (p) => ({ ...p, zooms: saved.zooms, webcam: saved.webcam }));
    // Back over the screen for the screenshot.
    setRedact({ frame: { x: Math.round(W * 0.36), y: Math.round(H * 0.42), width: Math.round(W * 0.28), height: Math.round(H * 0.1) }, content: { ...redact.content, mode: "pixelate", strength: 22 } });

    // 3. Transitions: fade in on the callout, dissolve between split screen clips.
    const callout = byType("callout")[0];
    st().select([callout.id]);
    X.applyTransitions({ type: "slide-left", durationMs: 600 }, "in");
    const early = T.scene(callout.startMs + 30).layers.find((l) => l.clipId === callout.id);
    const later = T.scene(callout.startMs + 1000).layers.find((l) => l.clipId === callout.id);
    check("transition in: slides from the side, then rests", early.transition.dx > 0.5 && later.transition.dx === 0, `dx ${early.transition.dx.toFixed(2)} → ${later.transition.dx}`);
    st().edit("t", (p) => ({ ...p, clips: p.clips.map((c) => (c.id === callout.id ? { ...c, transitionIn: { type: "fade", durationMs: 600 } } : c)) }));
    const fades = [10, 60, 150, 700].map((dt) => T.scene(callout.startMs + dt).layers.find((l) => l.clipId === callout.id).opacity);
    check("fade transition rises from 0 to full", fades[0] < 0.2 && fades[1] > fades[0] && fades[2] > fades[1] && fades[3] === 1, fades.map((o) => o.toFixed(2)).join(" → "));
    const screenClip = P().clips.find((c) => c.trackId === lane("screen").id && c.startMs < 2400 && c.startMs + c.durationMs > 2600);
    st().select([screenClip.id]);
    st().setPlayhead(2500);
    st().split();
    const right = P().clips.find((c) => c.trackId === lane("screen").id && Math.abs(c.startMs - 2500) < 2);
    if (!right) check("split screen clip for dissolve", false, JSON.stringify(P().clips.filter((c) => c.trackId === lane("screen").id).map((c) => [c.startMs, c.durationMs, c.locked])));
    if (right) st().edit("t", (p) => ({ ...p, clips: p.clips.map((c) => (c.id === right.id ? { ...c, transitionIn: { type: "dissolve", durationMs: 800 } } : c)) }));
    const dis = T.scene(2700).layers.filter((l) => l.trackId === lane("screen").id);
    check("cross dissolve holds the previous clip underneath", dis.length === 2 && dis[1].opacity < 1, dis.map((l) => `${l.clipId.slice(-4)}@${l.opacity.toFixed(2)}`).join(", "));

    // 4. One-click layouts from the preview toolbar (morphs smoothly).
    st().setPlayhead(1000);
    await sleep(50);
    document.querySelector('.layout-bar [data-layout="side"]').click();
    await sleep(50);
    const seg = P().layouts.find((s) => s.layout === "side");
    const cam = (t) => T.scene(t).layers.find((l) => l.trackId === lane("webcam").id);
    const before = cam(900), mid = cam(1200), after = cam(1800);
    check("layout button adds a switch at the playhead", !!seg && Math.abs(seg.startMs - 1000) < 2, seg && `${seg.layout} @ ${seg.startMs}`);
    check("layout change morphs (bubble → side by side)", before && after && mid && after.frame.height > before.frame.height * 1.5 && mid.frame.height > before.frame.height && mid.frame.height < after.frame.height, before && after && `${Math.round(before.frame.height)} → ${Math.round(mid.frame.height)} → ${Math.round(after.frame.height)} px`);
    document.querySelector('.layout-bar [data-layout="bubble"]').click();
    st().setPlayhead(1900);
    await sleep(30);
    document.querySelector('.layout-bar [data-layout="hidden"]').click();
    check("screen-only hides the webcam", !cam(2600), "");
    st().edit("t", (p) => ({ ...p, layouts: [] }));

    // 5. Green screen on the webcam (Chromium's fake camera is bright green).
    await frame(1500);
    const camLayer = cam(1500);
    const camRect = camLayer.frame;
    const greenBefore = stats(camRect, "#20ff20", 120).near;
    st().edit("t", (p) => ({ ...p, webcam: { ...p.webcam, chroma: { enabled: true, color: "#00ff00", similarity: 0.45, smoothness: 0.1, spill: 0.4 } } }));
    await frame(1500);
    const greenAfter = stats(camRect, "#20ff20", 120).near;
    check("green screen keys out the green", greenBefore > 500 && greenAfter < greenBefore * 0.25, `${greenBefore} → ${greenAfter} green px`);

    // 6. Title templates.
    st().setPlayhead(600);
    const lt = X.insertTitle("lowerThird");
    const titleLayer = T.scene(1600).layers.find((l) => l.clipId === lt);
    check("lower-third title inserted", titleLayer && titleLayer.content.template === "lowerThird");

    // 7. Audio tools: preset, loudness analysis job, live chain with noise removal.
    const mic = lane("mic");
    const micClip = clipOn("mic");
    st().select([]);
    st().selectTrack(mic.id);
    st().setPanelTab("properties");
    await sleep(200);
    const presetBtn = [...document.querySelectorAll(".audio-fx .preset-row button")][0];
    presetBtn?.click();
    await sleep(100);
    check("voice preset turns on EQ, compressor, leveling, noise removal", mic && P().tracks.find((t) => t.id === mic.id).audioFx?.eq.enabled && P().tracks.find((t) => t.id === mic.id).audioFx?.noise.enabled);
    const job = X.useJobs.getState().jobs.find((j) => j.kind === "analyze");
    const done = job && (await Promise.race([X.useJobs.getState().wait(job.id), sleep(20000).then(() => null)]));
    const lufs = P().analysis[micClip.mediaId]?.loudnessLufs;
    check("loudness analysis runs as a background job", done && done.status === "done" && Number.isFinite(lufs), done ? `${done.status} ${done.result ?? done.error ?? ""}` : "timeout");

    // Noise removal DSP: noise-only then tone + noise, through the real chain.
    const sr = 48000;
    const render = async (amount) => {
      const ctx = new OfflineAudioContext(1, sr * 4, sr);
      await X.loadDenoise(ctx);
      const chain = new X.FxChain(ctx);
      await sleep(0);
      const fx = X.AudioFx.parse({});
      fx.noise = { enabled: amount > 0, amount };
      chain.update(fx);
      const buf = ctx.createBuffer(1, sr * 4, sr);
      const d = buf.getChannelData(0);
      let seed = 1;
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
      for (let i = 0; i < d.length; i++) d[i] = rnd() * 0.05 + (i > sr * 2 ? 0.3 * Math.sin((2 * Math.PI * 440 * i) / sr) : 0);
      const src = new AudioBufferSourceNode(ctx, { buffer: buf });
      src.connect(chain.input);
      chain.output.connect(ctx.destination);
      src.start();
      const out = (await ctx.startRendering()).getChannelData(0);
      const rms = (a, b) => { let s = 0; for (let i = a; i < b; i++) s += out[i] * out[i]; return Math.sqrt(s / (b - a)); };
      return { noise: rms(sr * 1.2, sr * 1.9), tone: rms(sr * 2.6, sr * 3.8), ready: chain.denoiseReady };
    };
    const off = await render(0);
    const on = await render(0.9);
    const db = (a, b) => 20 * Math.log10(a / b);
    check("noise removal worklet loads", on.ready, "");
    check("noise removal lowers the noise floor", db(off.noise, on.noise) > 8, `${db(off.noise, on.noise).toFixed(1)} dB quieter`);
    check("noise removal keeps the voice/tone", Math.abs(db(off.tone, on.tone)) < 3, `${db(on.tone, off.tone).toFixed(2)} dB change`);

    // Live preview chain is in place for the mic clip.
    st().setPlayhead(200);
    st().setPlaying(true);
    await sleep(1500);
    const live = T.playback.current.fxStatus(micClip.id);
    st().setPlaying(false);
    await sleep(200);
    check("audio tools are in the live playback chain", live && live.denoise, JSON.stringify(live));

    // 8. Auto-captions through the (mock) cloud service, then SRT/VTT.
    await window.tdr.transcribe.setConfig({ baseUrl: "__MOCK_STT__", model: "whisper-1" });
    const capJob = X.transcribeLane(mic.id, "en");
    const capDone = await Promise.race([X.useJobs.getState().wait(capJob), sleep(20000).then(() => null)]);
    const caps = byType("caption");
    check("auto-captions job fills a caption lane", capDone && capDone.status === "done" && caps.length >= 2, capDone ? `${capDone.status}: ${capDone.result ?? capDone.error} (${caps.length} cues)` : "timeout");
    const capScene = T.scene(caps[0] ? caps[0].startMs + 400 : 0).caption;
    check("captions are drawn with the caption style", capScene && capScene.text.length > 0, capScene && capScene.text);
    const capLane = lane("caption");
    const srt = X.toSrt(X.laneCues(P(), capLane.id));
    const back = X.parseSubtitles(srt);
    check("captions export to SRT and re-import identically", back.length === caps.length && back[0].text === caps.sort((a, b) => a.startMs - b.startMs)[0].content.text, srt.split("\n").slice(0, 3).join(" | "));
    const vttBack = X.parseSubtitles(X.toVtt(X.laneCues(P(), capLane.id)));
    check("captions export to WebVTT", vttBack.length === caps.length);
    // Tibetan SRT import keeps tsheg and shad.
    const bo = "1\n00:00:00,500 --> 00:00:02,000\nབཀྲ་ཤིས་བདེ་ལེགས། ཁྱེད་རང་\nསྐུ་གཟུགས་བདེ་པོ་ཡིན་པས།\n";
    const parsed = X.parseSubtitles(bo);
    check("Tibetan SRT parses with the text unchanged", parsed[0]?.text === "བཀྲ་ཤིས་བདེ་ལེགས། ཁྱེད་རང་\nསྐུ་གཟུགས་བདེ་པོ་ཡིན་པས།");

    // 9. Quiz from the Teaching panel.
    st().setPanelTab("teaching");
    st().setPlayhead(3200);
    await sleep(200);
    document.querySelector('[data-teaching="add-quiz"]').click();
    await sleep(100);
    const quiz = P().markers.find((m) => m.kind === "quiz");
    check("quiz added at the playhead from the Teaching panel", quiz && quiz.quiz && Math.abs(quiz.timeMs - 3200) < 2, quiz && `${quiz.quiz.choices.length} choices`);
    const qs = T.scene(3200 + 500).quiz;
    const qr = T.scene(3200 + quiz.quiz.showMs * 0.8).quiz;
    check("quiz card shows, then reveals the answer", qs && !qs.revealed && qr && qr.revealed);
    check("editor UI has the quiz editor", document.querySelectorAll(".quiz-editor").length === 1);

    // 10. Library: built-in music loops and the user's own items.
    const lib = await window.tdr.library.list();
    check("library lists the built-in music loops", lib.music.length === 3, lib.music.map((m) => m.name).join(", "));
    const audioBefore = P().clips.length;
    const added = await T.importMedia([lib.music[0].path]);
    check("music loop goes onto an audio lane at the playhead", added.length === 1 && P().clips.length === audioBefore + 1 && P().tracks.find((t) => t.id === P().clips.find((c) => c.id === added[0]).trackId).kind === "audio");
    st().select([callout.id]);
    st().setPanelTab("library");
    await sleep(200);
    const saveBtn = [...document.querySelectorAll(".library button")].find((b) => !b.disabled && b.closest(".prop-section")?.querySelector("h3")?.textContent === st().t("library.mine"));
    saveBtn?.click();
    await sleep(400);
    const lib2 = await window.tdr.library.list();
    check("selection saved to My Library", lib2.user.length === lib.user.length + 1);
    await window.tdr.library.saveUser(lib.user);

    // Leave a good-looking frame for the screenshot.
    st().setPanelTab("properties");
    st().select([callout.id]);
    st().setPlayhead(1600);
    await frame(1600);
  } catch (e) {
    check("tools script ran", false, e && e.stack ? e.stack.slice(0, 400) : String(e));
  }
  return results;
})();
