// Stage 3 smoke script. Runs inside the editor page (via executeJavaScript) right
// after a recording has opened, and drives the real timeline UI with pointer and
// keyboard events. Returns [{ name, ok, detail }].
(async () => {
  const T = window.__tdrTest;
  const S = T.store;
  const st = () => S.getState();
  const P = () => st().history.present;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const results = [];
  const check = (name, ok, detail) => results.push({ name, ok: !!ok, detail: detail == null ? undefined : String(detail) });
  const laneOf = (kind) => P().tracks.find((t) => t.kind === kind);
  const clipsOn = (kind) => P().clips.filter((c) => c.trackId === laneOf(kind)?.id).sort((a, b) => a.startMs - b.startMs);
  const clipEl = (id) => document.querySelector(`.clip[data-clip="${id}"]`);
  const key = (k, code, mods = {}) => window.dispatchEvent(new KeyboardEvent("keydown", { key: k, code, bubbles: true, ...mods }));
  const round = (v) => Math.round(v);

  async function drag(el, dx, dy = 0, at = "middle") {
    const r = el.getBoundingClientRect();
    const x = at === "start" ? r.left + 2 : at === "end" ? r.right - 2 : r.left + Math.min(r.width / 2, 60);
    const y = r.top + r.height / 2;
    el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: x, clientY: y, button: 0, pointerId: 1 }));
    for (let i = 1; i <= 6; i++) {
      window.dispatchEvent(new PointerEvent("pointermove", { clientX: x + (dx * i) / 6, clientY: y + (dy * i) / 6, pointerId: 1 }));
      await sleep(16);
    }
    window.dispatchEvent(new PointerEvent("pointerup", { clientX: x + dx, clientY: y + dy, pointerId: 1 }));
    await sleep(80);
  }

  try {
    if (st().snapping) st().toggleSnapping();
    st().setZoom(100); // 100 px = 1 s
    st().setPlayhead(0);
    await sleep(300);
    const initialClips = JSON.stringify(P().clips);
    const historyStart = st().history.past.length;

    // 1. Link webcam + mic, drag the webcam: both move.
    const cam0 = clipsOn("webcam")[0];
    const mic0 = clipsOn("mic")[0];
    st().select([cam0.id, mic0.id]);
    T.runAction("edit.link");
    const linked = clipsOn("webcam")[0].linkGroup && clipsOn("webcam")[0].linkGroup === clipsOn("mic")[0].linkGroup;
    check("link webcam + mic clips", linked);
    st().select([cam0.id]);
    await sleep(50);
    await drag(clipEl(cam0.id), 50);
    const cam1 = clipsOn("webcam")[0], mic1 = clipsOn("mic")[0];
    check("drag moves linked clips together (+500 ms)", round(cam1.startMs - cam0.startMs) === 500 && round(mic1.startMs - mic0.startMs) === 500, `webcam +${round(cam1.startMs - cam0.startMs)}, mic +${round(mic1.startMs - mic0.startMs)}`);

    // 2. Unlink and move the webcam alone.
    T.runAction("edit.unlink");
    await drag(clipEl(cam0.id), -20);
    const cam2 = clipsOn("webcam")[0], mic2 = clipsOn("mic")[0];
    check("after unlink, clips move independently", round(cam2.startMs - cam1.startMs) === -200 && mic2.startMs === mic1.startMs && !cam2.linkGroup, `webcam ${round(cam2.startMs - cam1.startMs)}, mic ${round(mic2.startMs - mic1.startMs)}`);

    // 3. Trim the screen clip's end edge by -1 s.
    const scr0 = clipsOn("screen")[0];
    st().select([scr0.id]);
    await sleep(50);
    await drag(clipEl(scr0.id), -100, 0, "end");
    const scr1 = clipsOn("screen")[0];
    check("drag a clip edge to trim (-1 s)", round(scr0.durationMs - scr1.durationMs) === 1000 && scr1.startMs === scr0.startMs, `${round(scr0.durationMs)} → ${round(scr1.durationMs)} ms`);

    // 4. Split with the keyboard shortcut (S) at 2 s: every clip under the playhead splits.
    st().select([]);
    st().setPlayhead(2000);
    const under = P().clips.filter((c) => c.startMs + 16 <= 2000 && c.startMs + c.durationMs - 16 >= 2000).length;
    const before = P().clips.length;
    key("s", "KeyS");
    await sleep(50);
    check("S splits every clip under the playhead", P().clips.length === before + under && under > 0, `${under} clips split, ${before} → ${P().clips.length}`);

    // 5. Ripple delete the first screen piece: the second slides left into its place.
    const [p1, p2] = clipsOn("screen");
    st().select([p1.id]);
    T.runAction("edit.rippleDelete");
    const after = clipsOn("screen")[0];
    check("ripple delete closes the gap", after.id === p2.id && round(after.startMs) === round(p1.startMs), `next piece now starts at ${round(after.startMs)} ms`);
    check("other lanes untouched by ripple", clipsOn("mic").every((c) => P().clips.includes(c)));

    // 6. Undo everything, then redo one step.
    const steps = st().history.past.length - historyStart;
    for (let i = 0; i < steps; i++) T.runAction("edit.undo");
    check("undo restores the original timeline exactly", JSON.stringify(P().clips) === initialClips, `${steps} steps undone`);
    T.runAction("edit.redo");
    check("redo re-applies", st().history.past.length === historyStart + 1 && JSON.stringify(P().clips) !== initialClips);
    for (let i = 0; i < 1; i++) T.runAction("edit.undo");

    // 7. Lane header toggle: mute the mic lane by clicking its M button.
    const micIndex = P().tracks.findIndex((t) => t.kind === "mic");
    const muteBtn = document.querySelector(`.lane[data-lane="${micIndex}"] .lane-toggle[aria-label="${st().t("track.mute")}"]`);
    muteBtn?.click();
    await sleep(50);
    check("lane mute button", laneOf("mic").muted === true);
    muteBtn?.click();
    await sleep(50);

    // 8. Playback: ~1.5 s of play advances the playhead ~1.5 s.
    st().setPlayhead(0);
    await sleep(200);
    // Measure separately: how long the audio device took to start, and how well the
    // audio clock keeps time once running (compared with performance.now()).
    const pressed = performance.now();
    T.runAction("transport.playPause");
    await sleep(1500);
    const engine = T.playback.current;
    const startLatency = engine ? engine.lastStartLatencyMs : NaN;
    const clockMs = engine ? engine.timeMs : NaN;
    const wallSinceStart = performance.now() - pressed - startLatency;
    T.runAction("transport.playPause");
    await sleep(100);
    const played = st().playheadMs;
    check("playback clock keeps real time", Math.abs(clockMs - wallSinceStart) < 120, `clock ${round(clockMs)} ms vs wall ${round(wallSinceStart)} ms, device start ${round(startLatency)} ms`);
    check("playback advances in real time", played > 1300 && played < 1900 && !st().playing, `${round(played)} ms after 1.5 s`);

    // 9. Waveforms drawn for the audio lanes.
    await sleep(1500);
    check("waveforms on audio clips", document.querySelectorAll(".clip-wave").length >= 1, `${document.querySelectorAll(".clip-wave").length} waveforms`);

    // 10. Import a file: picture on a video lane + its sound on a linked audio lane.
    const camPath = P().media.find((m) => m.origin === "webcam")?.path;
    st().setPlayhead(0);
    const imported = await T.importMedia([camPath]);
    const vClip = P().clips.find((c) => c.id === imported[0]);
    const aClip = P().clips.find((c) => c.id === imported[1]);
    const vLane = P().tracks.find((t) => t.id === vClip?.trackId);
    const aLane = P().tracks.find((t) => t.id === aClip?.trackId);
    check("import adds video + linked sound on extra lanes", imported.length === 2 && vLane?.kind === "video" && aLane?.kind === "audio" && vClip.linkGroup === aClip.linkGroup, `${P().tracks.length} lanes`);

    // 11. Insert Tibetan text on an annotation lane.
    await st().setLanguage("bo");
    st().setPlayhead(1000);
    T.runAction("insert.text");
    const text = P().clips.find((c) => c.content.type === "text");
    check("insert text clip (Tibetan)", text && text.content.text === "བཀྲ་ཤིས་བདེ་ལེགས།" && P().tracks.find((t) => t.id === text.trackId)?.kind === "annotation");

    // 12. Rebind "split" to Ctrl+K and use it; then restore defaults.
    T.shortcuts.getState().setKey("edit.split", "Mod+K");
    st().select([]);
    st().setPlayhead(1500);
    const n0 = P().clips.length;
    key("s", "KeyS"); // old key does nothing now
    const afterOld = P().clips.length;
    const mac = window.tdr.platform === "darwin";
    key("k", "KeyK", mac ? { metaKey: true } : { ctrlKey: true });
    await sleep(50);
    check("custom shortcut works, old key released", afterOld === n0 && P().clips.length > n0, `${n0} → ${afterOld} → ${P().clips.length}`);
    T.shortcuts.getState().resetAll();

    // 13. Marker with M.
    const m0 = P().markers.length;
    key("m", "KeyM");
    await sleep(30);
    check("M adds a marker at the playhead", P().markers.length === m0 + 1 && P().markers.some((m) => round(m.timeMs) === 1500));

    // 14. Snapping toggle with N.
    const snap0 = st().snapping;
    key("n", "KeyN");
    check("N toggles snapping", st().snapping !== snap0);
    if (!st().snapping) st().toggleSnapping();

    // 15. The paused preview draws the frame under the playhead (all lanes, not just the background).
    st().select([]);
    st().setPlayhead(1800);
    await sleep(2500);
    const engine2 = T.playback.current;
    const p = P();
    const active = p.clips.filter((c) => c.startMs <= 1800 && c.startMs + c.durationMs > 1800);
    const visual = active.filter((c) => !["mic", "system", "audio", "cursor"].includes(p.tracks.find((t) => t.id === c.trackId)?.kind));
    const drawn = visual.filter((c) => {
      const el = engine2?.element(c.id);
      return c.content.type === "text" || (el && (el.videoWidth || el.naturalWidth));
    });
    const states = visual.map((c) => {
      const el = engine2?.element(c.id);
      return `${p.tracks.find((t) => t.id === c.trackId)?.kind}:${c.content.type}${el ? ` rs${el.readyState} t${el.currentTime?.toFixed?.(2)}` : " no-element"}`;
    });
    // Measures what the app drew by itself after the playhead moved (no direct draw call).
    const brightGreen = window.__tdrTestPixels ? window.__tdrTestPixels() : -1;
    check("paused preview draws every visible clip at the playhead", drawn.length === visual.length && brightGreen > 2000, `${drawn.length}/${visual.length} ready, test-pattern pixels ${brightGreen}; ${states.join(", ")}`);
  } catch (error) {
    check("timeline script ran", false, error && error.stack ? error.stack.slice(0, 400) : String(error));
  }
  return results;
})();
