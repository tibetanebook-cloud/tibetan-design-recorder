// Speed test (run with --smoke-test --perf --perf-media=<folder>). Plays, scrubs, drags and
// zooms a realistic edited project and reports what the user feels. `args` holds the media folder.
async (args) => {
  const { store, playback, compositor } = window.__tdrTest;
  const raf = () => new Promise((r) => requestAnimationFrame(r));
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const nextTask = () => new Promise((r) => {
    const c = new MessageChannel();
    c.port1.onmessage = () => r();
    c.port2.postMessage(0);
  });
  const pct = (list, p) => (list.length ? [...list].sort((a, b) => a - b)[Math.min(list.length - 1, Math.floor(list.length * p))] : 0);
  const avg = (list) => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : 0);
  const round = (v) => Math.round(v * 10) / 10;

  const useEditorTick = () => store.getState().setPlayhead(store.getState().playheadMs + 0.001);
  let longTasks = [];
  new PerformanceObserver((l) => longTasks.push(...l.getEntries().map((e) => e.duration))).observe({ entryTypes: ["longtask"] });

  // 90 s take cut into 40 pieces on three lanes, with annotations on top: a normal edited lesson.
  const base = store.getState().history.present;
  const lane = (k) => base.tracks.find((t) => t.kind === k).id;
  const CUTS = 40, TOTAL = 90_000, piece = TOTAL / CUTS;
  const defaults = { sourceInMs: 0, speed: 1, opacity: 1, volume: 1, fadeInMs: 0, fadeOutMs: 0, muted: false, hidden: false, locked: false };
  const media = [
    { id: "m-screen", kind: "video", origin: "screen", path: `${args.dir}/screen.webm`, durationMs: TOTAL, width: 1920, height: 1080, clockOffsetMs: 0 },
    { id: "m-webcam", kind: "video", origin: "webcam", path: `${args.dir}/webcam.webm`, durationMs: TOTAL, width: 1280, height: 720, clockOffsetMs: 0 },
    { id: "m-mic", kind: "audio", origin: "mic", path: `${args.dir}/mic.webm`, durationMs: TOTAL, clockOffsetMs: 0 },
  ];
  const clips = [];
  for (let i = 0; i < CUTS; i++)
    for (const [kind, mediaId] of [["screen", "m-screen"], ["webcam", "m-webcam"], ["mic", "m-mic"]])
      clips.push({ ...defaults, id: `c-${kind}-${i}`, trackId: lane(kind), mediaId, content: { type: "media" }, startMs: i * piece, durationMs: piece, sourceInMs: i * piece });
  const noteLane = { id: "t-note", kind: "annotation", name: "", locked: false, muted: false, solo: false, hidden: false, volume: 1, pan: 0, opacity: 1 };
  for (let i = 0; i < 10; i++)
    clips.push({ ...defaults, id: `c-note-${i}`, trackId: "t-note", content: { type: "text", text: "བཀྲ་ཤིས་བདེ་ལེགས།", fontSize: 72, color: "#ffffff", lang: "bo", bold: false, align: "center", animation: "none" }, startMs: i * 9000, durationMs: 4000, frame: { x: 300, y: 80, width: 1300, height: 180 } });
  store.getState().load({ ...base, media, clips, tracks: [noteLane, ...base.tracks], markers: [], zooms: [] });
  await wait(3000);
  const r = {};
  r.mediaElements = playback.current.slots.size;

  // Playback: frames, and how much time React spends on each one.
  longTasks = [];
  let engine = playback.current;
  engine.stats.ticks = 0; engine.stats.maxTickMs = 0; engine.stats.seeks = 0;
  store.getState().setPlayhead(5000);
  store.getState().setPlaying(true);
  const frames = [];
  let last = performance.now();
  const until = last + 15_000;
  // One playhead update = what every frame of playback costs outside the drawing.
  const updates = [];
  while (performance.now() < until) {
    await raf();
    const now = performance.now();
    frames.push(now - last);
    last = now;
    const t0 = performance.now();
    useEditorTick();
    await nextTask();
    updates.push(performance.now() - t0);
  }
  store.getState().setPlaying(false);
  r.playheadUpdateMs = { avg: round(avg(updates)), p95: round(pct(updates, 0.95)) };
  r.play = { fps: round(frames.length / 15), frameP50: round(pct(frames, 0.5)), frameP95: round(pct(frames, 0.95)), frameMax: round(Math.max(...frames)), maxTickMs: round(engine.stats.maxTickMs), hardSeeks: engine.stats.seeks, longTasks: longTasks.length, longTaskMs: Math.round(avg(longTasks) * longTasks.length), mediaElements: playback.current.slots.size };
  await wait(500);

  // Scrubbing: drag the playhead, one exact frame per step.
  const scrub = [];
  for (let i = 0; i < 40; i++) {
    const t0 = performance.now();
    store.getState().setPlayhead(10_000 + i * 700);
    await raf(); // React has now asked for this frame
    await engine.requestFrame(10_000 + i * 700);
    // requestFrame returns at once if a seek is running: wait until that seek is drawn.
    while (engine.frameBusy) await wait(2);
    scrub.push(performance.now() - t0);
  }
  r.scrubMs = { avg: round(avg(scrub)), p95: round(pct(scrub, 0.95)) };

  // Switching to the recorder and back.
  const t1 = performance.now();
  store.getState().setView("recorder");
  await raf();
  store.getState().setView("editor");
  await raf();
  while (!compositor.current) await wait(5);
  r.viewSwitchMs = Math.round(performance.now() - t1);
  await wait(500);

  // Dragging a clip: the cost of each mouse move, including React and the preview frame.
  const drag = [];
  store.getState().select(["c-note-3"]);
  store.getState().beginDrag();
  for (let i = 0; i < 60; i++) {
    const t0 = performance.now();
    store.getState().dragPreview((p) => ({ ...p, clips: p.clips.map((c) => (c.id === "c-note-3" ? { ...c, startMs: 27_000 + i * 10 } : c)) }));
    // The time blocked in React for this one move (a frame is 16.7 ms). React renders
    // store changes in a microtask, so wait for the next task before reading the clock.
    await nextTask();
    drag.push(performance.now() - t0);
    await raf();
  }
  store.getState().cancelDrag();
  r.dragMs = { avg: round(avg(drag)), p95: round(pct(drag, 0.95)) };

  // Timeline zoom (Ctrl + wheel).
  const zoom = [];
  for (let i = 0; i < 30; i++) {
    const t0 = performance.now();
    store.getState().setZoom(40 + i * 8);
    await nextTask();
    zoom.push(performance.now() - t0);
    await raf();
  }
  r.zoomMs = { avg: round(avg(zoom)), p95: round(pct(zoom, 0.95)) };

  r.heapMB = Math.round(performance.memory.usedJSHeapSize / 1e6);
  return r;
};
