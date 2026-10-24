// v0.2 smoke script: webcam shapes/borders/filters, smooth playback, fonts and
// double-click text editing. Runs in the editor page on the recorded take.
// Returns [{ name, ok, detail }].
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
  const edit = (label, fn) => st().edit(label, fn);
  const setW = (patch) => edit("webcamStyle.shape", (p) => ({ ...p, webcam: { ...p.webcam, ...patch } }));
  const frame = async (t) => {
    st().setPlayhead(t);
    await sleep(60);
    await T.playback.current.requestFrame(t);
    await sleep(150);
  };
  const comp = () => T.compositor.current;
  const camLayer = (t) => T.scene(t).layers.find((l) => l.trackId === lane("webcam").id);

  try {
    // Measure at full resolution (the preview normally draws at its on-screen size).
    comp().scale = 1;
    st().select([]);
    st().selectZoom(null);
    const t0 = 1000;
    const W0 = P().webcam;
    setW({ layout: "bubble", anchor: "bottom-right", aspect: "1:1", sizePct: 40 });
    await frame(t0);
    const layer = camLayer(t0);
    check("webcam bubble is on screen", layer && layer.webcam, layer ? `${layer.frame.width}x${layer.frame.height}` : "no webcam layer");
    const f = layer.frame;
    const corner = { x: f.x, y: f.y, width: f.width * 0.12, height: f.height * 0.12 };

    // 1. Shapes: a heart leaves the corner of its box empty, a square fills it.
    setW({ shape: "square", border: { ...P().webcam.border, style: "none" }, look: { ...P().webcam.look, preset: "none" } });
    await frame(t0);
    const sq = comp().regionStats(corner, "#000000", 30);
    setW({ shape: "heart" });
    await frame(t0);
    const heart = comp().regionStats(corner, "#000000", 30);
    check("webcam shapes: heart is masked, square fills its box", heart.detail !== sq.detail || heart.near !== sq.near, `square corner detail ${sq.detail.toFixed(1)} / heart ${heart.detail.toFixed(1)}`);
    const shaped = ["circle", "rounded", "squircle", "square", "hexagon", "diamond", "heart"].every((s) => {
      setW({ shape: s });
      return camLayer(t0)?.webcam?.shape === s;
    });
    check("all 7 webcam shapes reach the scene", shaped);

    // 2. Borders: a bright neon ring shows up around the bubble.
    setW({ shape: "circle", border: { style: "solid", width: 14, color: "#ff00ff", color2: "#00ffff" } });
    await frame(t0);
    const ring = { x: f.x - 30, y: f.y - 30, width: f.width + 60, height: f.height + 60 };
    const solid = comp().regionStats(ring, "#ff00ff", 90).near;
    setW({ border: { style: "none", width: 14, color: "#ff00ff", color2: "#00ffff" } });
    await frame(t0);
    const none = comp().regionStats(ring, "#ff00ff", 90).near;
    check("webcam border draws (solid magenta ring vs none)", solid > none + 200, `${none} → ${solid} magenta px`);
    const styles = ["double", "gradient", "glow", "neon", "dashed", "ring", "rainbow"];
    const drawn = [];
    for (const b of styles) {
      setW({ border: { style: b, width: 10, color: "#ff00ff", color2: "#00ffff" } });
      await frame(t0);
      const s = comp().regionStats(ring, "#000000", 0);
      drawn.push(`${b}:${s.detail.toFixed(1)}`);
    }
    check("every border style renders", drawn.length === styles.length, drawn.join(" "));

    // 3. Filters: black & white removes colour, skin smoothing softens detail.
    setW({ border: { style: "none", width: 6, color: "#d4a94a", color2: "#9b1b30" }, shape: "square" });
    const inner = { x: f.x + f.width * 0.1, y: f.y + f.height * 0.1, width: f.width * 0.8, height: f.height * 0.8 };
    const sat = () => {
      const R = comp().app.renderer;
      const { pixels, width } = R.extract.pixels({ target: comp().app.stage, frame: new (comp().app.screen.constructor)(0, 0, R.width, R.height) });
      const k = comp().scale;
      let s = 0, n = 0;
      for (let y = Math.round(inner.y * k); y < Math.round((inner.y + inner.height) * k); y += 2)
        for (let x = Math.round(inner.x * k); x < Math.round((inner.x + inner.width) * k); x += 2) {
          const i = (y * width + x) * 4;
          s += Math.max(pixels[i], pixels[i + 1], pixels[i + 2]) - Math.min(pixels[i], pixels[i + 1], pixels[i + 2]);
          n++;
        }
      return n ? s / n : 0;
    };
    setW({ look: { ...P().webcam.look, preset: "none", smooth: 0 } });
    await frame(t0);
    const satNone = sat();
    const detailNone = comp().regionStats(inner).detail;
    setW({ look: { ...P().webcam.look, preset: "bw" } });
    await frame(t0);
    const satBw = sat();
    check("filter look 'Black & White' removes colour", satBw < satNone * 0.25 + 2, `colourfulness ${satNone.toFixed(1)} → ${satBw.toFixed(1)}`);
    setW({ look: { ...P().webcam.look, preset: "none", sharpen: 1 } });
    await frame(t0);
    const detailSharp = comp().regionStats(inner).detail;
    check("filter pass runs on the webcam (sharpen adds detail)", detailSharp > detailNone * 1.05, `detail ${detailNone.toFixed(2)} → ${detailSharp.toFixed(2)}`);
    // The test camera has no skin tones, so skin smoothing must leave it unchanged.
    setW({ look: { ...P().webcam.look, preset: "none", sharpen: 0, smooth: 1 } });
    await frame(t0);
    const detailSmooth = comp().regionStats(inner).detail;
    check("skin smoothing leaves non-skin areas sharp", Math.abs(detailSmooth - detailNone) <= detailNone * 0.1 + 0.05, `detail ${detailNone.toFixed(2)} → ${detailSmooth.toFixed(2)}`);
    setW({ look: { ...P().webcam.look, preset: "warm", smooth: 0.5, brighten: 0.3 } });
    await frame(t0);
    // Restore the take's own webcam settings for the rest of the run.
    edit("webcamLook.reset", (p) => ({ ...p, webcam: W0 }));

    // 4. Playback: smooth (few hard seeks, quick ticks).
    await frame(0);
    const s0 = { ...T.playback.current.stats };
    st().setPlaying(true);
    await sleep(2500);
    st().setPlaying(false);
    await sleep(200);
    const s1 = T.playback.current.stats;
    const ticks = s1.ticks - s0.ticks, seeks = s1.seeks - s0.seeks;
    check("playback runs smoothly (≤ 2 hard re-seeks in 2.5 s)", ticks >= 30 && seeks <= 2, `${ticks} frames, ${seeks} seeks, ${s1.nudges - s0.nudges} rate nudges, slowest frame ${s1.maxTickMs.toFixed(1)} ms`);

    // 5. Fonts: a chosen font changes how text is drawn; captions/titles take fonts too.
    st().setPlayhead(400);
    T.runAction("insert.text");
    await sleep(100);
    const text = P().clips.filter((c) => c.content.type === "text").sort((a, b) => b.startMs - a.startMs).find((c) => c.startMs === 400) ?? P().clips.filter((c) => c.content.type === "text").at(-1);
    edit("edit.props", (p) => ({ ...p, clips: p.clips.map((c) => (c.id === text.id ? { ...c, content: { ...c.content, text: "Typing test WWW", lang: "en", fontFamily: undefined } } : c)) }));
    const tt = text.startMs + 600;
    await frame(tt);
    const box = (id, field) => comp().textBoxes.find((b) => b.clipId === id && b.field === field);
    // The first frame after inserting can still be loading fonts: draw until the text is there.
    for (let i = 0; i < 5 && !box(text.id, "text"); i++) await frame(tt);
    const wDefault = box(text.id, "text")?.width;
    edit("edit.props", (p) => ({ ...p, clips: p.clips.map((c) => (c.id === text.id ? { ...c, content: { ...c.content, fontFamily: "Courier New" } } : c)) }));
    await frame(tt);
    const wMono = box(text.id, "text")?.width;
    check("text font option changes the drawn text", wDefault && wMono && Math.abs(wMono - wDefault) > 4, `${wDefault?.toFixed(0)} px → ${wMono?.toFixed(0)} px (Courier New)`);
    // Bundled free Tibetan fonts draw differently from each other (really loaded, not a fallback).
    const widths = {};
    for (const f of ["Noto Serif Tibetan", "Jomolhari", "Uchen"]) {
      edit("edit.props", (p) => ({ ...p, clips: p.clips.map((c) => (c.id === text.id ? { ...c, content: { ...c.content, text: "བཀྲ་ཤིས་བདེ་ལེགས། ཀ་ཁ་ག་ང་།", lang: "bo", fontFamily: f } } : c)) }));
      await frame(tt);
      widths[f] = Math.round(box(text.id, "text")?.width ?? 0);
    }
    check("bundled Tibetan fonts (Noto Serif Tibetan, Jomolhari, Uchen) each draw", new Set(Object.values(widths)).size === 3 && Object.values(widths).every((w) => w > 50), JSON.stringify(widths));
    const viaApp = await window.tdr.listFonts();
    check("installed fonts are read at startup without a click", Array.isArray(viaApp) && viaApp.length > 20, Array.isArray(viaApp) ? `${viaApp.length} families` : String(viaApp));
    edit("edit.props", (p) => ({ ...p, clips: p.clips.map((c) => (c.id === text.id ? { ...c, content: { ...c.content, text: "Typing test WWW", lang: "en", fontFamily: undefined } } : c)) }));
    await frame(tt);
    let local = "not available";
    try {
      const fonts = await window.queryLocalFonts();
      local = `${new Set(fonts.map((x) => x.family)).size} families`;
      check("fonts on this computer can be listed", fonts.length > 0, local);
    } catch (e) {
      check("fonts on this computer can be listed", false, String(e).slice(0, 160));
    }

    // 6. Double-click editing on the preview (text, then a title).
    const host = document.querySelector("[data-preview-host]");
    const dbl = async (b) => {
      const r = host.getBoundingClientRect();
      const k = r.width / P().canvas.width;
      host.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, clientX: r.left + (b.x + b.width / 2) * k, clientY: r.top + (b.y + b.height / 2) * k }));
      await sleep(250);
      return document.querySelector("[data-inline-editor]");
    };
    const typeAndEnter = async (el, value) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
      setter.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      await sleep(250);
    };
    await frame(tt);
    const tb = box(text.id, "text");
    const ed = tb && (await dbl(tb));
    check("double-click text on the preview opens an editor with its text", ed && ed.value === "Typing test WWW", ed ? ed.value : "no editor");
    if (ed) await typeAndEnter(ed, "བཀྲ་ཤིས་བདེ་ལེགས། Hello");
    const after = P().clips.find((c) => c.id === text.id).content;
    check("Enter saves exactly as typed (Tibetan kept, language follows script)", after.text === "བཀྲ་ཤིས་བདེ་ལེགས། Hello" && after.lang === "bo" && !document.querySelector("[data-inline-editor]"), `${after.text} [${after.lang}]`);
    st().undo();
    check("the edit is one undo step", P().clips.find((c) => c.id === text.id).content.text === "Typing test WWW");

    const title = X.insertTitle("lowerThird");
    const titleClip = P().clips.find((c) => c.id === (title?.id ?? title)) ?? P().clips.filter((c) => c.content.type === "title").at(-1);
    await frame(titleClip.startMs + 1500);
    const tbox = box(titleClip.id, "title");
    const ted = tbox && (await dbl(tbox));
    check("double-click a title opens its title text", ted && ted.value === titleClip.content.title, ted ? ted.value : `no editor (boxes: ${comp().textBoxes.map((b) => b.field).join(",")})`);
    if (ted) {
      ted.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      await sleep(200);
    }
    check("Esc cancels without changing the title", !document.querySelector("[data-inline-editor]") && P().clips.find((c) => c.id === titleClip.id).content.title === titleClip.content.title);
    const caps = P().clips.filter((c) => c.content.type === "caption");
    if (caps.length) {
      await frame(caps[0].startMs + 200);
      check("captions on the preview are double-click editable", comp().textBoxes.some((b) => b.field === "caption"), comp().textBoxes.map((b) => b.field).join(","));
    }
    edit("edit.delete", (p) => ({ ...p, clips: p.clips.filter((c) => c.id !== titleClip.id) }));
  } catch (e) {
    check("style script ran", false, e && e.stack ? e.stack.slice(0, 400) : String(e));
  }
  return results;
})();
