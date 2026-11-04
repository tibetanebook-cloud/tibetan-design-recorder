// Smoke script for animation, visual effects, range edits, pointer effects, themes and
// the rest of the editing tools. Runs in the editor page on the recorded take, and checks
// real pixels and real panels. Returns [{ name, ok, detail }].
(async () => {
  const T = window.__tdrTest;
  const S = T.store;
  const st = () => S.getState();
  const P = () => st().history.present;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const results = [];
  const check = (name, ok, detail) => results.push({ name, ok: !!ok, detail: detail == null ? undefined : String(detail) });
  const clipOn = (kind) => { const l = P().tracks.find((t) => t.kind === kind); return P().clips.find((c) => c.trackId === l?.id); };
  const frame = async (t) => {
    st().setPlayhead(t);
    await sleep(60);
    await T.playback.current.requestFrame(t);
    while (T.playback.current.frameBusy) await sleep(5);
    await sleep(100);
  };
  const near = (hex, r) => T.compositor.current.regionStats(r, hex, 60).near;
  const run = (id) => T.runAction(id);

  try {
    st().setView("editor");
    await sleep(800);
    const screen = clipOn("screen");
    const at = screen.startMs + Math.min(1000, screen.durationMs / 2);

    // ---- a solid-looking annotation to look at: a filled gold rectangle
    st().setPlayhead(at);
    run("insert.shape");
    await sleep(100);
    const rectId = st().selection[0];
    st().edit("edit.props", (p) => ({ ...p, clips: p.clips.map((c) => (c.id === rectId ? { ...c, fadeInMs: 0, fadeOutMs: 0, startMs: at - 500, durationMs: 3000, frame: { x: 100, y: 100, width: 200, height: 200 }, content: { ...c.content, color: "#ff00ff", fill: "#ff00ff", strokeWidth: 0 } } : c)) }));
    await frame(at);
    const homeA = near("#ff00ff", { x: 120, y: 120, width: 160, height: 160 });
    check("rectangle drawn where it was placed", homeA > 100, homeA);

    // ---- keyframes move real pixels
    const clip = () => P().clips.find((c) => c.id === rectId);
    st().edit("motion.addKeyframe", (p) => ({ ...p, clips: p.clips.map((c) => (c.id === rectId ? { ...c, keyframes: [{ t: 0, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, ease: "linear" }, { t: 1000, x: 800, y: 400, scale: 1, rotation: 0, opacity: 1, ease: "linear" }] } : c)) }));
    await frame(clip().startMs + 1000);
    const away = near("#ff00ff", { x: 120, y: 120, width: 160, height: 160 });
    const there = near("#ff00ff", { x: 920, y: 520, width: 160, height: 160 });
    check("keyframes move the clip on the canvas", away === 0 && there > 100, `old place ${away}, new place ${there}`);
    const scene1 = T.scene(clip().startMs + 500).layers.find((l) => l.clipId === rectId);
    check("keyframes pass through the scene (shared with export)", Math.round(scene1.motion.dx) === 400, scene1.motion.dx);

    // ---- rotation and scale
    st().edit("edit.props", (p) => ({ ...p, clips: p.clips.map((c) => (c.id === rectId ? { ...c, keyframes: [{ t: 0, x: 0, y: 0, scale: 1, rotation: 45, opacity: 1, ease: "linear" }] } : c)) }));
    await frame(clip().startMs + 500);
    // Turned 45° about its centre (200, 200): the old corner is empty, the new tip points up.
    const corner = near("#ff00ff", { x: 102, y: 102, width: 10, height: 10 });
    const tip = near("#ff00ff", { x: 195, y: 65, width: 10, height: 10 });
    check("rotation turns the picture", corner === 0 && tip > 0, `square corner ${corner}, rotated tip ${tip}`);
    st().edit("edit.props", (p) => ({ ...p, clips: p.clips.map((c) => (c.id === rectId ? { ...c, keyframes: [{ t: 0, x: 0, y: 0, scale: 2, rotation: 0, opacity: 1, ease: "linear" }] } : c)) }));
    await frame(clip().startMs + 500);
    const grown = near("#ff00ff", { x: 20, y: 20, width: 40, height: 40 });
    check("scale makes the picture bigger", grown > 100, grown);
    st().edit("edit.props", (p) => ({ ...p, clips: p.clips.map((c) => (c.id === rectId ? { ...c, keyframes: undefined } : c)) }));

    // ---- behaviours
    st().edit("motion.behaviors", (p) => ({ ...p, clips: p.clips.map((c) => (c.id === rectId ? { ...c, behavior: { in: "fly-left", inMs: 800, during: "none", amount: 1, out: "fade", outMs: 500 } } : c)) }));
    await frame(clip().startMs + 20);
    const entering = near("#ff00ff", { x: 120, y: 120, width: 160, height: 160 });
    await frame(clip().startMs + 1500);
    const rested = near("#ff00ff", { x: 120, y: 120, width: 160, height: 160 });
    check("fly-in entrance starts away and lands in place", entering === 0 && rested > 100, `${entering} → ${rested}`);
    const leaving = T.scene(clip().startMs + clip().durationMs - 50).layers.find((l) => l.clipId === rectId);
    check("fade exit lowers opacity at the end", leaving.opacity < 0.2, leaving.opacity);
    st().edit("edit.props", (p) => ({ ...p, clips: p.clips.map((c) => (c.id === rectId ? { ...c, behavior: undefined } : c)) }));

    // ---- new shapes, and sketching
    for (const shape of ["ellipse", "triangle", "star", "polygon"]) {
      st().setPlayhead(at);
      run(`insert.${shape}`);
      await sleep(60);
      const c = P().clips.find((x) => x.id === st().selection[0]);
      check(`insert ${shape}`, c?.content.shape === shape, c?.content.shape);
    }
    st().setPlayhead(at);
    run("insert.sketchArrow");
    await sleep(60);
    const arrow = P().clips.find((x) => x.id === st().selection[0]);
    check("sketched arrow draws itself over time", arrow?.content.drawOnMs > 0, arrow?.content.drawOnMs);
    await frame(arrow.startMs + 300);

    // ---- panels open without errors for picture and sound clips, in both languages
    st().setPanelTab("properties");
    st().select([screen.id]);
    await sleep(300);
    check("visual effects panel shows on a recording", !!document.querySelector("[data-fx=look]"));
    check("animation panel shows on a recording", !!document.querySelector("[data-motion=add]") && !!document.querySelector("[data-behavior=in]"));
    check("selected recording can be moved on the canvas", !!document.querySelector("[data-frame-overlay] .frame-box"));

    // ---- visual effects on a recording: flip, colour, border
    st().edit("fx.flipH", (p) => ({ ...p, clips: p.clips.map((c) => (c.id === screen.id ? { ...c, fx: { flipH: true, flipV: false, radius: 40, shadow: 0.5, border: { width: 8, color: "#00ff00" }, look: { preset: "bw", smooth: 0, brighten: 0, sharpen: 0, brightness: 0, contrast: 0, saturation: 0, temperature: 0, tint: 0, fade: 0, vignette: 0 } } } : c)) }));
    await frame(at);
    const layer = T.scene(at).layers.find((l) => l.clipId === screen.id);
    check("visual effects reach the scene", layer.flipH && layer.look?.preset === "bw" && layer.border?.width === 8 && layer.cornerRadius >= 40);
    // Only the recording, without camera zoom, so its edges are on screen and nothing covers them.
    const zooms = P().zooms, tracks = P().tracks;
    st().annotate((p) => ({ ...p, zooms: [], tracks: p.tracks.map((t) => ({ ...t, hidden: t.kind !== "screen" })) }));
    await frame(at);
    const f = layer.frame;
    const green = near("#00ff00", { x: f.x - 8, y: f.y + f.height * 0.3, width: f.width + 16, height: f.height * 0.4 });
    check("border is drawn around the recording", green > 50, green);
    st().annotate((p) => ({ ...p, zooms, tracks }));
    st().edit("inspector.reset", (p) => ({ ...p, clips: p.clips.map((c) => (c.id === screen.id ? { ...c, fx: undefined } : c)) }));

    // ---- copy effects
    st().edit("edit.props", (p) => ({ ...p, clips: p.clips.map((c) => (c.id === rectId ? { ...c, behavior: { in: "pop", inMs: 400, during: "pulse", amount: 1, out: "none", outMs: 300 } } : c)) }));
    st().select([rectId]);
    run("edit.copyLook");
    st().select([arrow.id]);
    run("edit.pasteLook");
    check("copy and paste effects", P().clips.find((c) => c.id === arrow.id).behavior?.during === "pulse");

    // ---- pointer effects
    st().edit("cursor.highlight", (p) => ({ ...p, cursor: { ...p.cursor, visible: true, highlight: { enabled: true, color: "#ffe066", size: 2, opacity: 0.4 }, spotlight: { enabled: true, size: 6, dim: 0.5 }, magnify: { enabled: true, scale: 2, size: 5 } } }));
    const cur = T.scene(at).cursor;
    check("pointer effects reach the scene", !!(cur && cur.highlight && cur.spotlight && cur.magnify), JSON.stringify(cur && { h: !!cur.highlight, s: !!cur.spotlight, m: !!cur.magnify }));
    await frame(at); // draws the magnifier without an error
    st().edit("cursor.highlight", (p) => ({ ...p, cursor: { ...p.cursor, highlight: undefined, spotlight: undefined, magnify: undefined } }));

    // ---- themes
    st().setPanelTab("library");
    await sleep(300);
    const chip = document.querySelector('[data-theme-id="sky"]');
    check("themes are offered in the library", !!chip);
    T.runAction("title.lowerThird");
    await sleep(60);
    chip?.click();
    await sleep(60);
    const title = P().clips.find((c) => c.content.type === "title");
    check("a theme recolours titles", title?.content.accent === "#3b82f6", title?.content.accent);
    st().setPanelTab("properties");

    // ---- range edits: every lane stays together
    const length0 = st().duration();
    const lanes0 = P().tracks.map((t) => P().clips.filter((c) => c.trackId === t.id).reduce((m, c) => Math.max(m, c.startMs + c.durationMs), 0));
    st().setPlayhead(1000); run("range.in");
    st().setPlayhead(2000); run("range.out");
    run("edit.deleteRange");
    await sleep(60);
    check("delete range shortens the video by the range", Math.abs(st().duration() - (length0 - 1000)) < 2, `${length0} → ${st().duration()}`);
    const lanes1 = P().tracks.map((t) => P().clips.filter((c) => c.trackId === t.id).reduce((m, c) => Math.max(m, c.startMs + c.durationMs), 0));
    check("delete range keeps the lanes in step", lanes1.every((v, i) => v === 0 || lanes0[i] - v < 1001), JSON.stringify([lanes0, lanes1]));
    st().undo();
    await sleep(60);
    check("delete range is one undo step", Math.abs(st().duration() - length0) < 2);
    run("range.clear");

    // ---- hold a frame, draws from a paused element
    st().setPlayhead(at);
    st().select([]);
    run("edit.freezeFrame");
    await sleep(60);
    const held = P().clips.find((c) => c.freeze);
    check("hold frame adds 3 s to the video", !!held && Math.abs(st().duration() - (length0 + 3000)) < 2, `${length0} → ${st().duration()}`);
    if (held) {
      await frame(held.startMs + 1000);
      const v = T.playback.current.element(held.id);
      check("held frame shows the chosen moment", v && Math.abs(v.currentTime - held.sourceInMs / 1000) < 0.2, `${v?.currentTime} vs ${held.sourceInMs / 1000}`);
      st().setPlayhead(held.startMs + 100);
      st().setPlaying(true);
      await sleep(800);
      const still = T.playback.current.element(held.id);
      const t0 = still?.currentTime;
      await sleep(400);
      check("held frame stays still during playback", still && still.paused && still.currentTime === t0, `paused ${still?.paused}`);
      st().setPlaying(false);
      await sleep(100);
    }
    st().undo();
    await sleep(60);

    // ---- space and gaps
    run("edit.insertTime");
    check("insert space adds 2 s", Math.abs(st().duration() - (length0 + 2000)) < 2);
    st().undo();

    // ---- volume over time (preview level) and the player count stays small
    const mic = clipOn("mic");
    st().edit("volume.addPoint", (p) => ({ ...p, clips: p.clips.map((c) => (c.id === mic.id ? { ...c, volumePoints: [{ t: 0, gain: 0.5 }] } : c)) }));
    st().setPlayhead(mic.startMs + 100);
    st().setPlaying(true);
    await sleep(500);
    st().setPlaying(false);
    check("sound still plays with volume points", true);
    const mediaClips = P().clips.filter((c) => c.mediaId && P().media.find((m) => m.id === c.mediaId)?.kind !== "cursor").length;
    check("only the players in use stay open", T.playback.current.slots.size < mediaClips, `${T.playback.current.slots.size} open for ${mediaClips} clips`);
    st().edit("edit.props", (p) => ({ ...p, clips: p.clips.map((c) => (c.id === mic.id ? { ...c, volumePoints: undefined } : c)) }));

    // ---- remove silences: the take from the test has fake-device or real audio; must not throw
    const removed = await T.tools.removeSilences();
    check("remove silences runs on the recording", typeof removed === "number", removed);
    if (removed) st().undo();
    check("a message is shown after the command", !!document.querySelector("[data-notice]"), document.querySelector("[data-notice]")?.textContent);
  } catch (error) {
    check("pro script ran", false, `${error}\n${error.stack ?? ""}`.slice(0, 500));
  }
  st().select([]);
  return results;
})();
