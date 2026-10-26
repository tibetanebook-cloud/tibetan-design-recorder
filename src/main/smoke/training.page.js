// Training video scenes (`--demo-video --demo-scenes=training`): a longer, step-by-step
// tour of every feature. Uses the demo engine's helpers (smoke/demo.page.js); each scene
// gets L(i, +ms) = when narration line i starts, and its length in ms.
window.__demoSceneFactory = (H, D) => {
  const { st, P, lane, clipOf, ease, clamp01, setW, setContent, setClip, pos, byText, previewPoint, textBoxPoint, scrollPanelTo, click, maskRecorder, ASSETS, $ } = H;
  const t = (k) => st().t(k);
  const laneEl = (kind) => document.querySelector(`[data-lane="${P().tracks.findIndex((x) => x.kind === kind)}"]`);
  const laneToggle = (kind, n) => () => laneEl(kind)?.querySelectorAll(".lane-toggle")[n];
  const tlBtn = (key) => () => [...document.querySelectorAll(".tl-btn")].find((b) => (b.getAttribute("title") || "").startsWith(t(key)));
  const tab = (id) => `[data-tab="${id}"]`;
  const section = (key) => () => H.section(key);
  const inSection = (key, sel) => () => H.section(key)?.querySelector(sel);
  const scrollTo = (el) => { const e = typeof el === "function" ? el() : el; if (e) e.scrollIntoView({ block: "start" }); };
  const step = (from, every, items) => items.map((x, i) => [from + i * every, x]);

  // On-screen key cap (e.g. Ctrl + Z) while a shortcut is "pressed".
  const keycap = (text) => {
    let k = document.getElementById("demo-key");
    if (!k) {
      k = document.createElement("div");
      k.id = "demo-key";
      k.style.cssText = "position:absolute;left:50%;top:44%;transform:translate(-50%,-50%);padding:14px 30px;border-radius:14px;background:rgba(14,14,20,.9);color:#fff;font-size:44px;font-weight:700;border:2px solid #f1cf7a;box-shadow:0 10px 40px rgba(0,0,0,.5)";
      $("demo-ov").appendChild(k);
    }
    k.textContent = text;
    k.style.display = text ? "block" : "none";
  };
  const countdown = (ms, c0) => {
    const k = ms - c0;
    $("demo-count").style.display = k >= 0 && k < 3000 ? "flex" : "none";
    if (k >= 0 && k < 3000) $("demo-count").textContent = String(3 - Math.floor(k / 1000));
    const rec = k >= 3000 && k < 9000;
    $("demo-rec").style.display = rec ? "flex" : "none";
    if (rec) $("demo-rec-t").textContent = `00:0${Math.floor((k - 3000) / 1000)}`;
  };
  const setCanvas = (patch) => st().edit("demo", (p) => ({ ...p, canvas: { ...p.canvas, ...patch } }));
  const setLook = (patch) => setW({ look: { ...P().webcam.look, ...patch } });
  const playFrom = (from, rate = 1) => (ms) => st().setPlayhead(from + ms * rate);

  return {
    intro: (L, dur) => ({
      card: { from: 0, to: dur - 700, html: `<div class="studio">Welcome to the Nangchen Tashi Studio</div><img src="${ASSETS.icon}"><div class="bo">ནང་ཆེན་བཀྲིས་གློག་ཀླད་མཐོང་རིས་འཛིན་ཆས།</div><div class="en">Nangchen Studio Screen Recorder</div><div class="tag">Training · every feature, step by step</div>` },
      events: [[0, () => H.buildLesson({ audio: true })], [dur - 400, () => H.showCursor(true)]],
      cursor: [[0, [1100, 600]]],
      tick: (ms) => { if (ms > 300) st().setPlayhead(2000); },
    }),

    tour: (L) => ({
      cursor: [[L(0, 1500), ".menubar"], [L(0, 4200), ".sidebar .nav:last-child"], [L(1, 600), () => previewPoint(960, 540)()], [L(1, 2400), ".timeline .lane-clips"],
        ...step(L(2, 1600), 900, [tab("properties"), tab("library"), tab("captions"), tab("teaching"), tab("jobs"), tab("properties")])],
      ring: [[L(0, 900), L(0, 3600), ".menubar"], [L(0, 3600), L(1, 0), ".sidebar"], [L(1, 0), L(1, 2000), ".preview-stage"], [L(1, 2000), L(2, 0), ".timeline"], [L(2, 0), L(2, 7400), ".side-panel"]],
      events: step(L(2, 1650), 900, ["properties", "library", "captions", "teaching", "jobs", "properties"]).map(([ms, id]) => [ms, () => click(tab(id))]),
    }),

    language: (L) => ({
      cursor: [[L(1, 700), ".language-switch button:first-child"], [L(1, 3300), ".language-switch button:last-child"]],
      ring: [[L(1, 0), L(1, 4300), ".language-switch"]],
      events: [
        [L(1, 750), () => { click(".language-switch button:first-child"); void window.tdr.setLanguage("en"); }],
        [L(1, 3350), () => { click(".language-switch button:last-child"); void window.tdr.setLanguage("bo"); }],
      ],
    }),

    rec_sources: (L) => ({
      cursor: [[L(0, 900), ".sidebar .nav:first-child"], [L(1, 1200), ".source-card:nth-child(1)"], [L(1, 2600), ".source-card:nth-child(2)"], [L(1, 4400), ".source-card.region"],
        [L(2, 900), ".rec-section .segmented button:last-child"], [L(2, 3000), ".rec-section .segmented button:first-child"]],
      ring: [[L(1, 0), L(1, 4000), ".source-grid"], [L(1, 4000), L(2, 0), ".source-card.region"], [L(2, 0), L(2, 3800), ".rec-section .segmented"]],
      events: [
        [L(0, 950), () => click(".sidebar .nav:first-child")],
        [L(1, 1250), () => click(".source-card:nth-child(1)")],
        [L(2, 950), () => click(".rec-section .segmented button:last-child")],
        [L(2, 3050), () => click(".rec-section .segmented button:first-child")],
      ],
      tick: maskRecorder,
    }),

    rec_inputs: (L) => ({
      cursor: [[L(0, 1000), ".rec-columns .rec-section:nth-child(1) select"], [L(0, 3200), ".rec-columns .rec-section:nth-child(2) select"],
        [L(1, 800), ".rec-columns .rec-section:nth-child(3) input"], [L(2, 1000), ".rec-columns .rec-section:nth-child(4) input"]],
      ring: [[L(0, 0), L(0, 2800), ".rec-columns .rec-section:nth-child(1)"], [L(0, 2800), L(1, 0), ".rec-columns .rec-section:nth-child(2)"],
        [L(1, 0), L(2, 0), ".rec-columns .rec-section:nth-child(3)"], [L(2, 0), L(2, 6000), ".rec-columns .rec-section:nth-child(4)"]],
      tick: maskRecorder,
    }),

    rec_start: (L) => {
      const c0 = L(0, 2000);
      return {
        cursor: [[L(0, 600), ".rec-columns .rec-section:nth-child(4) .segmented"], [L(0, 1900), ".record-button"], [L(1, 600), ".hotkeys"]],
        ring: [[L(0, 0), L(0, 1600), ".rec-columns .rec-section:nth-child(4) .segmented"], [L(1, 300), L(2, 0), ".hotkeys"]],
        events: [
          [L(0, 1950), () => H.rippleAt(".record-button")],
          [L(2, 600), () => { st().setView("editor"); st().setPlayhead(2000); }],
        ],
        tick: (ms) => { if (st().view === "recorder") maskRecorder(); countdown(ms, c0); },
      };
    },

    timeline: (L, dur) => ({
      cursor: [[L(0, 1500), () => laneEl("screen")?.querySelector(".lane-head")], [L(0, 3200), () => laneEl("mic")?.querySelector(".lane-head")],
        [L(1, 400), tlBtn("shortcuts.playPause")], [L(1, 3200), () => { const r = document.querySelector(".tl-ruler")?.getBoundingClientRect(); return r ? [r.left + r.width * 0.32, r.top + r.height / 2] : null; }],
        [L(1, 5200), tlBtn("view.zoomIn")], [L(1, 6400), tlBtn("view.zoomIn")]],
      ring: [[L(0, 0), L(1, 0), ".timeline"]],
      events: [
        [L(1, 450), () => H.rippleAt(tlBtn("shortcuts.playPause"))],
        [L(1, 3250), () => { H.rippleAt(() => { const r = document.querySelector(".tl-ruler")?.getBoundingClientRect(); return r ? [r.left + r.width * 0.32, r.top + r.height / 2] : null; }); st().setPlayhead(9500); }],
        [L(1, 5250), () => click(tlBtn("view.zoomIn"))],
        [L(1, 6450), () => click(tlBtn("view.zoomIn"))],
        [dur - 200, () => H.T.runAction("view.fitTimeline")],
      ],
      tick: (ms) => { if (ms >= L(1, 500) && ms < L(1, 3250)) st().setPlayhead(2000 + (ms - L(1, 500))); },
    }),

    editing: (L, dur) => {
      const cut = L(0, 1800), t0 = L(1, 600), t1 = L(1, 2800), m0 = L(1, 3600), m1 = L(1, 5600);
      let drag = null;
      return {
        cursor: [[L(0, 700), '[data-clip="clp_lesson"]'], [cut, H.scissors], [t0, H.edgeOf], [t1, H.edgeOf],
          [m0, () => { const id = H.lastLessonPiece(); return document.querySelector(`[data-clip="${id}"] .clip-label`); }], [m1, () => { const id = H.lastLessonPiece(); return document.querySelector(`[data-clip="${id}"] .clip-label`); }]],
        events: [
          [L(0, 750), () => { click('[data-clip="clp_lesson"]'); st().select(["clp_lesson"]); st().setPlayhead(9000); }],
          [cut, () => click(H.scissors())],
          [t0, () => { st().select([H.lastLessonPiece()]); st().beginDrag(); drag = "trim"; }],
          [t1 + 20, () => { st().endDrag("edit.trim"); drag = null; setClip(H.lastLessonPiece(), { durationMs: 15000 }); }],
          [m0, () => { st().beginDrag(); drag = "move"; }],
          [m1 + 20, () => { st().endDrag("edit.move"); drag = null; setClip(H.lastLessonPiece(), { startMs: 10500 }); }],
          [L(2, 200), () => st().setPlayhead(6000)], // on the lesson, not in the gap from the cut
          [L(2, 1000), () => { keycap("Ctrl + Z"); st().undo(); }],
          [L(2, 2200), () => keycap("")],
          [L(2, 2600), () => { keycap("Ctrl + Y"); st().redo(); }],
          [L(2, 3800), () => keycap("")],
          // Close the gap left by the cut, so the lesson stays on screen in later chapters.
          [dur - 150, () => {
            const [a, b] = H.lessonPieces();
            if (a && b) setClip(b.id, { startMs: a.startMs + a.durationMs, durationMs: H.DUR - (a.startMs + a.durationMs) });
          }],
        ],
        tick: (ms) => {
          const id = H.lastLessonPiece();
          if (drag === "trim") {
            const k = ease(clamp01((ms - t0) / (t1 - t0)));
            st().dragPreview((p) => ({ ...p, clips: p.clips.map((c) => (c.id === id ? { ...c, durationMs: Math.round(21000 - k * 6000) } : c)) }));
          }
          if (drag === "move") {
            const k = ease(clamp01((ms - m0) / (m1 - m0)));
            st().dragPreview((p) => ({ ...p, clips: p.clips.map((c) => (c.id === id ? { ...c, startMs: Math.round(9000 + k * 1500) } : c)) }));
          }
        },
      };
    },

    lanes: (L) => ({
      cursor: [[L(0, 500), laneToggle("webcam", 0)], [L(0, 1700), laneToggle("webcam", 1)], [L(0, 3000), laneToggle("mic", 1)],
        [L(1, 900), '[data-clip="clp_cam"]'], [L(1, 2100), '[data-clip="clp_mic"]'], [L(1, 3300), tlBtn("edit.link")]],
      events: [
        [L(0, 550), () => click(laneToggle("webcam", 0)())],
        [L(0, 1750), () => click(laneToggle("webcam", 1)())],
        [L(0, 3050), () => click(laneToggle("mic", 1)())],
        [L(1, 200), () => { click(laneToggle("webcam", 0)()); click(laneToggle("webcam", 1)()); click(laneToggle("mic", 1)()); }],
        [L(1, 950), () => { H.rippleAt('[data-clip="clp_cam"]'); st().select(["clp_cam"]); }],
        [L(1, 2150), () => { H.rippleAt('[data-clip="clp_mic"]'); st().select(["clp_cam", "clp_mic"]); }],
        [L(1, 3350), () => click(tlBtn("edit.link")())],
      ],
    }),

    layouts: (L, dur) => ({
      cursor: step(L(0, 1200), 1500, ['[data-layout="hidden"]', '[data-layout="full"]', '[data-layout="side"]', '[data-layout="bubble"]']),
      ring: [[L(0, 0), dur - 300, ".layout-bar"]],
      events: [[L(0, 100), () => { st().select([]); st().setPlayhead(4000); }],
        ...step(L(0, 1250), 1500, ["hidden", "full", "side", "bubble"]).map(([ms, id]) => [ms, () => click(`[data-layout="${id}"]`)]),
        [dur - 100, () => st().edit("demo", (p) => ({ ...p, layouts: [] }))]],
      tick: (ms) => { if (ms > L(0, 1250)) st().setPlayhead(4000 + (ms - L(0, 1250))); },
    }),

    canvas: (L) => ({
      cursor: [[L(0, 600), tab("properties")], ...step(L(1, 600), 900, [".wallpaper-grid button:nth-child(2)", ".wallpaper-grid button:nth-child(4)", ".wallpaper-grid button:nth-child(1)"]),
        [L(1, 3700), inSection("frame.title", "input[type=range]")]],
      ring: [[L(0, 300), L(1, 0), ".side-panel"]],
      events: [
        [L(0, 100), () => { st().select([]); st().selectTrack(null); st().setPanelTab("properties"); st().setPlayhead(12000); }],
        ...step(L(1, 650), 900, [2, 4, 1]).map(([ms, n]) => [ms, () => click(`.wallpaper-grid button:nth-child(${n})`)]),
      ],
      tick: (ms) => {
        const a = L(1, 3800), b = a + 2600;
        if (ms >= a && ms <= b + 50) {
          const k = Math.sin(clamp01((ms - a) / (b - a)) * Math.PI);
          const pad = Math.round((0.06 + k * 0.06) * 100) / 100, cr = Math.round(16 + k * 32);
          if (P().canvas.padding !== pad || P().canvas.cornerRadius !== cr) setCanvas({ padding: pad, cornerRadius: cr });
        }
      },
    }),

    zoom: (L, dur) => {
      const z0 = L(0, 300);
      return {
        cursor: [[L(0, 300), () => previewPoint(1080, 270)()], [L(2, 400), ".camera-lane .lane-clips"]],
        ring: [[L(2, 0), dur - 300, ".camera-lane"]],
        events: [[L(0, 100), () => { st().select([]); st().setPlayhead(4000); st().edit("demo", (p) => ({ ...p, zooms: [{ id: "zm1", startMs: 4300, endMs: 4300 + (L(2, 0) - 1200), depth: 2, focus: { x: 0.55, y: 0.32 }, mode: "manual", suggested: false }] })); }]],
        tick: (ms) => { if (ms >= z0 && ms < L(2, 200)) st().setPlayhead(4000 + (ms - z0)); },
      };
    },

    webcam_shape: (L) => ({
      cursor: [[L(0, 1300), () => laneEl("webcam")?.querySelector(".lane-head")],
        ...step(L(1, 1100), 700, ["circle", "rounded", "squircle", "square", "hexagon", "diamond", "heart"].map((s) => `[data-shape="${s}"]`)),
        [L(2, 500), inSection("webcamStyle.title", "select")]],
      events: [
        [L(0, 100), () => { st().edit("demo", (p) => ({ ...p, zooms: [] })); st().setPlayhead(3000); }],
        [L(0, 1350), () => { H.rippleAt(() => laneEl("webcam")?.querySelector(".lane-head")); st().selectTrack(lane("webcam").id); }],
        [L(0, 1700), () => scrollPanelTo(t("webcamStyle.title"))],
        ...step(L(1, 1150), 700, ["circle", "rounded", "squircle", "square", "hexagon", "diamond", "heart"]).map(([ms, s]) => [ms, () => click(`[data-shape="${s}"]`)]),
        [L(2, 600), () => { H.rippleAt(inSection("webcamStyle.title", "select")); setW({ aspect: "16:9" }); }],
        [L(2, 1700), () => setW({ aspect: "3:4" })],
        [L(2, 2800), () => setW({ aspect: "1:1", shape: "circle" })],
      ],
      tick: playFrom(3000, 0.15),
    }),

    webcam_border: (L) => ({
      cursor: [...step(L(0, 900), 650, ["solid", "double", "gradient", "glow", "neon", "dashed", "ring", "rainbow"].map((b) => `[data-border="${b}"]`)),
        [L(1, 600), ".color-pair:nth-child(3)"], [L(1, 1700), ".color-pair:nth-child(1)"]],
      events: [
        ...step(L(0, 950), 650, ["solid", "double", "gradient", "glow", "neon", "dashed", "ring", "rainbow"]).map(([ms, b]) => [ms, () => click(`[data-border="${b}"]`)]),
        [L(1, 650), () => click(".color-pair:nth-child(3)")],
        [L(1, 1750), () => { click('[data-border="gradient"]'); click(".color-pair:nth-child(1)"); }],
      ],
      tick: playFrom(3600, 0.2),
    }),

    webcam_filters: (L, dur) => {
      const s0 = L(0, 1500), s1 = L(1, 0);
      return {
        cursor: [[L(0, 400), section("webcamLook.title")], [s1 - 300, section("webcamLook.title")],
          ...step(L(1, 900), 750, ["warm", "film", "vintage", "golden"].map((l) => `[data-look="${l}"]`)),
          [L(2, 600), () => byText(".panel-title", t("effects.greenScreen"))]],
        events: [
          [L(0, 100), () => scrollPanelTo(t("webcamLook.title"))],
          [s1 + 150, () => setLook({ smooth: 0.75, brighten: 0.4 })],
          ...step(L(1, 950), 750, ["warm", "film", "vintage", "golden"]).map(([ms, l]) => [ms, () => click(`[data-look="${l}"]`)]),
          [L(2, 300), () => scrollTo(() => byText(".panel-title", t("effects.greenScreen")))],
          [L(2, 900), () => { H.rippleAt(() => byText(".panel-title", t("effects.greenScreen"))); setW({ chroma: { ...P().webcam.chroma, enabled: true, color: "#4a6688", similarity: 0.3, smoothness: 0.08, spill: 0.2 } }); }],
          [dur - 150, () => setW({ chroma: { ...P().webcam.chroma, enabled: false } })],
        ],
        tick: (ms) => {
          if (ms >= s0 && ms <= s1 + 100) {
            const k = Math.round(clamp01((ms - s0) / (s1 - s0)) * 20) / 20;
            if (P().webcam.look.smooth !== k * 0.75) setLook({ smooth: k * 0.75, brighten: k * 0.4 });
          }
          const a0 = L(1, 4000), a1 = L(2, 0);
          if (ms >= a0 && ms <= a1) {
            const k = Math.round(Math.sin(clamp01((ms - a0) / (a1 - a0)) * Math.PI) * 10) / 10;
            if (P().webcam.look.temperature !== k * 0.4) setLook({ temperature: k * 0.4, contrast: k * 0.2 });
          }
          st().setPlayhead(4200 + ms * 0.15);
        },
      };
    },

    titles: (L) => ({
      cursor: [[L(0, 700), tab("library")], ...step(L(0, 2600), 900, ['[data-lib="title.lowerThird"]', '[data-lib="title.chapter"]', '[data-lib="title.quote"]', '[data-lib="title.lowerThird"]'])],
      ring: [[L(0, 2300), L(0, 6200), () => document.querySelector('[data-lib="title.lowerThird"]')?.parentElement]],
      events: [
        [L(0, 100), () => { st().selectTrack(null); st().select([]); setLook({ preset: "warm", temperature: 0, contrast: 0 }); }],
        [L(0, 750), () => click(tab("library"))],
        [L(0, 5350), () => { st().setPlayhead(5000); click('[data-lib="title.lowerThird"]'); }],
        [L(0, 5500), () => { const c = clipOf("title"); setClip(c.id, { startMs: 1000, durationMs: 27000 }); setContent(c.id, { title: "སློབ་ཚན།", subtitle: "Lesson 1", lang: "bo" }); st().setPlayhead(5000); }],
      ],
    }),

    typing: (L, dur) => {
      const TEXT = Array.from("བཀྲ་ཤིས་བདེ་ལེགས། ང་ཚོའི་སློབ་ཚན་དང་པོ།");
      const a = L(0, 2400), b = dur - 1600;
      return {
        cursor: [[L(0, 1000), textBoxPoint("title")], [dur - 900, textBoxPoint("title")]],
        events: [
          [L(0, 1050), () => H.dblclickPreview(textBoxPoint("title"))],
          [L(0, 1300), () => { const ed = document.querySelector("[data-inline-editor]"); if (ed) H.setTextarea(ed, ""); }],
          [b + 300, () => document.querySelector("[data-inline-editor]")?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))],
        ],
        tick: (ms) => {
          const ed = document.querySelector("[data-inline-editor]");
          if (ed && ms >= a && ms <= b + 200) {
            const v = TEXT.slice(0, Math.min(TEXT.length, Math.floor(((ms - a) / (b - a)) * TEXT.length) + 1)).join("");
            if (ed.value !== v) H.setTextarea(ed, v);
          }
        },
      };
    },

    fonts: (L, dur) => ({
      cursor: [[L(0, 500), "[data-font-picker]"], [L(1, 900), '[data-font="Uchen"]'], [L(1, 3600), ".font-search"], [L(1, 6400), '[data-font="Jomolhari"]'], [dur - 300, textBoxPoint("title")]],
      events: [
        [L(0, 50), () => { st().setPanelTab("properties"); st().select([clipOf("title").id]); }],
        [L(0, 300), () => document.querySelector("[data-font-picker]")?.scrollIntoView({ block: "start" })],
        [L(0, 550), () => click("[data-font-picker]")],
        [L(1, 3650), () => H.rippleAt(".font-search")],
        ...Array.from("Jomo").map((ch, i) => [L(1, 3900 + i * 300), () => { const s = document.querySelector(".font-search"); if (s) H.setInput(s, "Jomo".slice(0, i + 1)); }]),
        [L(1, 6450), () => click('[data-font="Jomolhari"]')],
      ],
    }),

    text_tool: (L, dur) => {
      let id = null;
      return {
        cursor: [[L(0, 800), () => byText(".menu-title", t("menu.insert"))], [L(1, 600), () => previewPoint(640, 140)()], [L(1, 2800), () => document.querySelector(".side-panel .prop-section:last-child") ?? document.querySelector(".side-panel")]],
        events: [
          [L(0, 850), () => {
            H.rippleAt(() => byText(".menu-title", t("menu.insert")));
            st().setPlayhead(6000);
            H.T.runAction("insert.text");
            const c = P().clips.filter((x) => x.content.type === "text").at(-1);
            id = c?.id;
            if (c) {
              setClip(c.id, { startMs: 6000, durationMs: 20000, frame: { x: 240, y: 90, width: 820, height: 150 } });
              setContent(c.id, { text: "ཀ་ཁ་ག་ང་།", lang: "bo", fontSize: 96, color: "#e8c56a", bold: true, align: "left", animation: "typewriter", background: "#14151cd9" });
              st().select([c.id]);
            }
          }],
        ],
        tick: (ms) => { if (ms > L(1, 0)) st().setPlayhead(6000 + Math.min(2600, (ms - L(1, 0)) * 0.6)); },
      };
    },

    annotations: (L) => {
      const put = (type, frame, extra) => () => { const c = clipOf(type); if (c) { setClip(c.id, { startMs: 5500, durationMs: 24000, ...(frame ? { frame } : {}) }); if (extra) setContent(c.id, extra); } };
      return {
        cursor: [[L(0, 300), tab("library")], ...step(L(0, 1300), 1100, ['[data-lib="insert.callout"]', '[data-lib="insert.highlight"]', '[data-lib="insert.spotlight"]', '[data-lib="insert.stepNumber"]']),
          [L(1, 600), '[data-lib="insert.blurRegion"]']],
        events: [
          [L(0, 100), () => { st().select([]); st().setPlayhead(7000); }],
          [L(0, 350), () => click(tab("library"))],
          [L(0, 1350), () => { click('[data-lib="insert.callout"]'); put("callout", { x: 1230, y: 150, width: 420, height: 130 }, { text: "ང་ — nga", lang: "bo", tailX: 1020, tailY: 330 })(); }],
          [L(0, 2450), () => { click('[data-lib="insert.highlight"]'); put("highlight", { x: 960, y: 300, width: 200, height: 170 })(); }],
          [L(0, 3550), () => { click('[data-lib="insert.spotlight"]'); put("spotlight", { x: 900, y: 260, width: 320, height: 260 })(); }],
          [L(0, 4650), () => { click('[data-lib="insert.stepNumber"]'); put("step", { x: 540, y: 290, width: 90, height: 90 })(); }],
          [L(1, 0), () => { const c = clipOf("spotlight"); if (c) st().edit("demo", (p) => ({ ...p, clips: p.clips.filter((x) => x.id !== c.id) })); }],
          [L(1, 650), () => { click('[data-lib="insert.blurRegion"]'); put("redact", { x: 560, y: 120, width: 520, height: 70 })(); }],
        ],
        tick: playFrom(7000, 0.05),
      };
    },

    captions: (L) => ({
      cursor: [[L(0, 500), tab("captions")], [L(0, 2200), '[data-captions="transcribe"]'], [L(0, 4600), '[data-captions="import"]'], [L(1, 600), ".cue-row, .cue-time"],
        [L(1, 2600), () => H.section("captions.style")]],
      ring: [[L(0, 2000), L(0, 4300), '[data-captions="transcribe"]'], [L(0, 4300), L(1, 0), '[data-captions="import"]']],
      events: [
        [L(0, 550), () => click(tab("captions"))],
        [L(0, 4650), () => {
          H.rippleAt('[data-captions="import"]');
          const cues = H.X.parseSubtitles("1\n00:00:05,000 --> 00:00:12,000\nདེ་རིང་ང་ཚོས་གསལ་བྱེད་སུམ་ཅུ་སློབ་སྦྱོང་བྱེད།\n\n2\n00:00:12,000 --> 00:00:30,000\nཀ་ཁ་ག་ང་། ཅ་ཆ་ཇ་ཉ།\n");
          st().edit("captions", (p) => ({ ...H.X.cuesToCaptionClips(p, cues, "bo").project, captionStyle: { ...p.captionStyle, position: "top" } }));
          st().setPlayhead(8000);
        }],
        [L(1, 2700), () => { scrollTo(() => H.section("captions.style")); st().edit("captions", (p) => ({ ...p, captionStyle: { ...p.captionStyle, color: "#f1cf7a" } })); }],
      ],
    }),

    teaching: (L) => ({
      cursor: [[L(0, 500), tab("teaching")], [L(0, 2200), () => byText(".side-panel button", t("insert.chapter"))], [L(0, 3800), '[data-teaching="add-quiz"]']],
      events: [
        [L(0, 550), () => click(tab("teaching"))],
        [L(0, 2250), () => { st().setPlayhead(9000); click(byText(".side-panel button", t("insert.chapter"))); }],
        [L(0, 3850), () => { st().setPlayhead(14000); click('[data-teaching="add-quiz"]'); }],
        [L(1, 0), () => { const q = P().markers.filter((m) => m.kind === "quiz").at(-1); if (q) st().setPlayhead(q.timeMs + (q.quiz?.showMs ?? 4000) * 0.5); }],
      ],
    }),

    audio: (L) => {
      const checks = () => [...document.querySelectorAll(".side-panel input[type=checkbox]")];
      return {
        cursor: [[L(0, 900), () => laneEl("mic")?.querySelector(".lane-head")], ...step(L(0, 2400), 900, [0, 1, 2, 3].map((i) => () => checks()[i])), [L(1, 500), tab("library")],
          [L(1, 1700), () => document.querySelector('[data-lib^="music."]')]],
        events: [
          [L(0, 100), () => { st().select([]); st().setPlayhead(9000); }],
          [L(0, 950), () => { H.rippleAt(() => laneEl("mic")?.querySelector(".lane-head")); st().selectTrack(lane("mic").id); st().setPanelTab("properties"); }],
          ...[0, 1, 2, 3].map((i) => [L(0, 2450 + i * 900), () => { const c = checks()[i]; if (c && !c.checked) click(c); }]),
          [L(1, 550), () => click(tab("library"))],
          [L(1, 1000), () => document.querySelector('[data-lib^="music."]')?.scrollIntoView({ block: "center" })],
          [L(1, 1750), () => click('[data-lib^="music."]')],
        ],
      };
    },

    export: (L, dur) => ({
      cursor: [[L(0, 500), () => byText(".menu-title", t("menu.export"))], ...step(L(0, 2000), 800, ['[data-format="webm"]', '[data-format="gif"]', '[data-format="mp4"]']),
        [L(1, 600), ".export-dialog label:has(input[type=checkbox])"], [L(2, 400), tab("jobs")]],
      ring: [[L(1, 300), L(2, 0), () => document.querySelector(".export-dialog label:has(input[type=checkbox])")?.parentElement]],
      events: [
        [L(0, 100), () => { st().selectTrack(null); st().select([]); st().setPanelTab("properties"); }],
        [L(0, 550), () => { H.rippleAt(() => byText(".menu-title", t("menu.export"))); st().setExportDialog("video"); }],
        ...step(L(0, 2050), 800, ["webm", "gif", "mp4"]).map(([ms, f]) => [ms, () => click(`[data-format="${f}"]`)]),
        [L(2, 0), () => st().setExportDialog(null)],
        [L(2, 450), () => click(tab("jobs"))],
      ],
    }),

    projects: (L, dur) => ({
      cursor: [[L(0, 400), ".menubar .menu-title:first-child"]],
      ring: [[L(0, 900), dur - 400, ".menu-dropdown"]],
      events: [
        [L(0, 450), () => { H.rippleAt(".menubar .menu-title:first-child"); document.querySelector(".menu-title")?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); }],
        [dur - 300, () => document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }))],
      ],
    }),

    outro: (L, dur) => {
      const o = D.outro(L, dur);
      return { ...o, events: [[0, () => { st().setExportDialog(null); st().setPanelTab("properties"); }], [500, () => H.showCursor(false)]] };
    },
  };
};
0;
