// Stage 4 smoke script: runs in the editor page after the take has been re-opened
// with a synthetic cursor log (moves + clicks). Returns [{ name, ok, detail }].
(async () => {
  const T = window.__tdrTest;
  const S = T.store;
  const st = () => S.getState();
  const P = () => st().history.present;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const results = [];
  const check = (name, ok, detail) => results.push({ name, ok: !!ok, detail: detail == null ? undefined : String(detail) });
  const edit = (label, fn) => st().edit(label, fn);
  const lane = (kind) => P().tracks.find((t) => t.kind === kind);

  try {
    // 1. Cursor lane exists, linked to the screen clip.
    const cursorLane = lane("cursor");
    const cursorClip = P().clips.find((c) => c.trackId === cursorLane?.id);
    const screenClip = P().clips.find((c) => c.trackId === lane("screen")?.id);
    check("cursor is its own lane, linked to the screen", cursorClip && screenClip && cursorClip.linkGroup === screenClip.linkGroup);

    // 2. Auto-zoom suggestions appeared after the recording opened (wait for the track).
    for (let i = 0; i < 50 && !P().zooms.some((z) => z.suggested); i++) await sleep(100);
    const suggested = P().zooms.filter((z) => z.suggested);
    check("auto-zoom suggestions from clicks", suggested.length >= 1 && suggested.every((z) => z.mode === "auto"), suggested.map((z) => `${z.startMs}-${z.endMs}`).join(", ") + ` (${st().suggestStatus})`);
    const ghostEls = document.querySelectorAll(".zoom-region.suggested").length;
    check("suggestions drawn as ghosts on the camera lane", ghostEls === suggested.length, `${ghostEls} ghosts`);
    st().acceptSuggestions();
    await sleep(50);
    check("accept all suggestions", P().zooms.length >= 1 && P().zooms.every((z) => !z.suggested));

    // 3. Camera zooms in during the region and returns to 1x after.
    const z = P().zooms[0];
    const mid = T.scene(Math.min(z.endMs - 100, z.startMs + 1400));
    const after = T.scene(z.endMs + 2500);
    check("camera zooms in during the region", mid.camera.scale > 1.25, `scale ${mid.camera.scale.toFixed(2)} at ${Math.round(z.startMs + 1400)} ms`);
    check("camera returns to 1x after", Math.abs(after.camera.scale - 1) < 0.02, `scale ${after.camera.scale.toFixed(3)}`);
    check("zoom is deterministic (seek = play)", JSON.stringify(T.scene(z.startMs + 900).camera) === JSON.stringify(T.scene(z.startMs + 900).camera));

    // 4. Manual zoom with Z at the playhead, then delete it.
    st().setPlayhead(Math.max(0, z.endMs + 300));
    const n0 = P().zooms.length;
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "z", code: "KeyZ", bubbles: true }));
    await sleep(50);
    check("Z adds a manual zoom at the playhead", P().zooms.length === n0 + 1 && P().zooms.some((x) => x.mode === "manual"), `${n0} → ${P().zooms.length}`);
    T.runAction("edit.delete");
    check("Delete removes the selected zoom", P().zooms.length === n0);

    // 5. Cursor rendering from the metadata track (the drawn cursor is off by default for
    //    Chromium takes because the OS pointer is in the video; turn it on to test).
    edit("cursor.show", (p) => ({ ...p, cursor: { ...p.cursor, visible: true, clickEffect: "ripple", keystrokes: true } }));
    const clickT = 1200;
    const atClick = T.scene(clickT + 120);
    check("cursor drawn from metadata at the right place", atClick.cursor && atClick.cursor.visible && atClick.cursor.x > 0, atClick.cursor ? `(${Math.round(atClick.cursor.x)}, ${Math.round(atClick.cursor.y)})` : "none");
    check("click bounce + ripple after a click", atClick.cursor && atClick.cursor.scale < 1 && atClick.cursor.rings.length >= 1, atClick.cursor ? `scale ${atClick.cursor.scale.toFixed(3)}, ${atClick.cursor.rings.length} ring(s)` : "");
    check("keystroke chips from the metadata track", T.scene(2350).cursor?.keys.length >= 1, T.scene(2350).cursor?.keys.map((k) => k.label).join(", "));
    edit("track.hide", (p) => ({ ...p, tracks: p.tracks.map((t) => (t.kind === "cursor" ? { ...t, hidden: true } : t)) }));
    check("hiding the cursor lane hides the cursor", !T.scene(clickT + 120).cursor);
    edit("track.show", (p) => ({ ...p, tracks: p.tracks.map((t) => (t.kind === "cursor" ? { ...t, hidden: false } : t)) }));

    // 6. Webcam layouts.
    const camLayer = (s) => s.layers.find((l) => l.trackId === lane("webcam").id);
    const setW = (patch) => edit("effects.layouts", (p) => ({ ...p, webcam: { ...p.webcam, ...patch } }));
    const W = P().canvas.width;
    const bubble = camLayer(T.scene(1000));
    setW({ layout: "side" });
    const side = camLayer(T.scene(1000));
    setW({ layout: "hidden" });
    const hidden = camLayer(T.scene(1000));
    setW({ layout: "bubble", anchor: "top-left" });
    const tl = camLayer(T.scene(1000));
    setW({ anchor: "bottom-right" });
    check("webcam layouts: bubble / side / hidden / anchors", bubble && bubble.cornerRadius > 0 && bubble.mirror && side && side.frame.x > W / 2 && !hidden && tl && tl.frame.x < W / 4, `bubble ${bubble?.frame.width}px, side x=${side?.frame.x}, top-left x=${tl?.frame.x}`);
    const zoomed = camLayer(T.scene(z.startMs + 1400));
    check("bubble shrinks while zoomed in", zoomed && zoomed.frame.width < bubble.frame.width, `${bubble.frame.width} → ${zoomed?.frame.width}`);

    // 7. Frame styling: wallpaper, aspect, device frame.
    const setC = (patch) => edit("effects.background", (p) => ({ ...p, canvas: { ...p.canvas, ...patch } }));
    setC({ background: { type: "wallpaper", id: "himalaya" }, backgroundBlur: 2 });
    check("built-in wallpaper + blur", T.scene(1000).background.id === "himalaya" && T.scene(1000).backgroundBlur === 2);
    setC({ aspect: "9:16", width: 1080, height: 1920 });
    const tall = T.scene(1000);
    check("aspect 9:16 changes the canvas", tall.width === 1080 && tall.height === 1920);
    setC({ aspect: "16:9", width: 1920, height: 1080, backgroundBlur: 0 });
    for (let i = 0; i < 30 && !T.scene(1000).deviceFrame; i++) {
      setC({ deviceFrame: "tibetan-basics/laptop" });
      await sleep(100);
    }
    const dev = T.scene(1000);
    const devScreen = dev.layers.find((l) => l.inCamera);
    check("device frame from the bundled extension", dev.deviceFrame && devScreen && devScreen.frame.x > dev.deviceFrame.frame.x, dev.deviceFrame ? `laptop at ${Math.round(dev.deviceFrame.frame.x)},${Math.round(dev.deviceFrame.frame.y)}` : "not loaded");

    // 8. Speed region via In/Out keeps every lane in sync.
    st().setPlayhead(1000);
    T.runAction("range.in");
    st().setPlayhead(2000);
    T.runAction("range.out");
    const before = P().clips.length;
    T.runAction("effects.speedUp");
    const fast = P().clips.filter((c) => c.speed === 1.5);
    const lanesFast = new Set(fast.map((c) => P().tracks.find((t) => t.id === c.trackId)?.kind));
    check("speed-up region on every lane", fast.length >= 4 && lanesFast.has("screen") && lanesFast.has("mic") && lanesFast.has("cursor"), `${before} → ${P().clips.length} clips; 1.5× on ${[...lanesFast].join(", ")}`);
    const ends = ["screen", "webcam", "mic", "system"].map((k) => Math.max(...P().clips.filter((c) => c.trackId === lane(k)?.id).map((c) => c.startMs + c.durationMs)));
    check("lanes still end together after the speed change", Math.max(...ends) - Math.min(...ends) < 400, ends.map(Math.round).join(" / "));

    // 9. Annotations: arrow, rectangle, and they render.
    st().setPlayhead(500);
    T.runAction("insert.arrow");
    T.runAction("insert.shape");
    const shapes = P().clips.filter((c) => c.content.type === "shape");
    check("arrow and shape annotations", shapes.length === 2 && T.scene(700).layers.filter((l) => l.content.type === "shape").length === 2);

    // 10. Click sound from the extension.
    edit("cursor.clickSound", (p) => ({ ...p, cursor: { ...p.cursor, clickSound: "tibetan-basics/soft-click" } }));
    check("click sound selectable from the extension", P().cursor.clickSound === "tibetan-basics/soft-click");

    // Leave a nice frame for the screenshot: zoomed in on the click, ripple showing.
    st().select([]);
    st().selectTrack(null);
    st().setPlayhead(clickT + 160);
    await sleep(1500);
  } catch (error) {
    check("effects script ran", false, error && error.stack ? error.stack.slice(0, 400) : String(error));
  }
  return results;
})();
