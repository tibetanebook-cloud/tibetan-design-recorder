// Demo video tour (see src/main/demoVideo.ts). Runs in the editor page with the test
// hooks. Time is virtual: main calls __demo.frame(t) for every video frame (30 fps) and
// captures the window, so each scene is exactly as long as its narration in plan.json.
// Never records the real screen: the Recorder shows made-up sources only.
{
  const PLAN = __PLAN__;
  const ASSETS = __ASSETS__;
  const T = window.__tdrTest;
  const X = T.tools;
  const S = T.store;
  const st = () => S.getState();
  const P = () => st().history.present;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const lane = (kind) => P().tracks.find((t) => t.kind === kind);
  const clipOf = (type) => P().clips.filter((c) => c.content.type === type).at(-1);
  const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
  const clamp01 = (x) => Math.max(0, Math.min(1, x));
  const setW = (patch) => st().edit("demo", (p) => ({ ...p, webcam: { ...p.webcam, ...patch } }));
  const setContent = (id, patch) => st().edit("demo", (p) => ({ ...p, clips: p.clips.map((c) => (c.id === id ? { ...c, content: { ...c.content, ...patch } } : c)) }));
  const setClip = (id, patch) => st().edit("demo", (p) => ({ ...p, clips: p.clips.map((c) => (c.id === id ? { ...c, ...patch } : c)) }));

  // ------------------------------------------------------------------ overlays
  const css = document.createElement("style");
  css.textContent = `
    *, *::before, *::after { transition: none !important; animation: none !important; }
    #demo-ov, #demo-ov * { font-family: "Inter", "Segoe UI", sans-serif !important; }
    #demo-ov { position: fixed; inset: 0; z-index: 2147483000; pointer-events: none; }
    #demo-card .bo { font-family: "Noto Serif Tibetan" !important; }
    #demo-cursor { position: absolute; left: 0; top: 0; width: 30px; height: 30px; filter: drop-shadow(0 2px 3px rgba(0,0,0,.55)); }
    #demo-ripple { position: absolute; border: 3px solid #f1cf7a; border-radius: 50%; }
    #demo-ring { position: absolute; border: 3px solid #f1cf7a; border-radius: 10px; box-shadow: 0 0 0 4px rgba(241,207,122,.25), 0 0 24px rgba(241,207,122,.55); }
    #demo-sub { position: absolute; left: 50%; bottom: 52px; transform: translateX(-50%); max-width: 1500px; padding: 12px 28px; border-radius: 12px;
      background: rgba(12,12,18,.86); color: #fff; font-size: 30px; line-height: 1.35; text-align: center; font-weight: 500; letter-spacing: .2px; box-shadow: 0 8px 30px rgba(0,0,0,.45); }
    #demo-card { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px;
      background: radial-gradient(ellipse at 50% 40%, #2a2440 0%, #14151c 70%); color: #f3ead8; }
    #demo-card img { width: 220px; height: 220px; border-radius: 48px; box-shadow: 0 18px 60px rgba(0,0,0,.6); margin-bottom: 18px; }
    #demo-card .bo { font-family: "Noto Serif Tibetan"; font-weight: 700; font-size: 64px; line-height: 1.9; color: #e8c56a; }
    #demo-card .en { font-size: 54px; font-weight: 700; margin-top: -8px; }
    #demo-card .tag { font-size: 30px; color: #c9bfa8; margin-top: 14px; }
    #demo-card .share { font-size: 34px; font-style: italic; color: #f3ead8; margin-top: 18px; }
    #demo-card .studio { font-size: 34px; letter-spacing: 3px; text-transform: uppercase; color: #e8c56a; margin-bottom: 26px; font-weight: 600; }
    #demo-card img.big { width: 380px; height: 380px; border-radius: 0; box-shadow: none; filter: drop-shadow(0 24px 70px rgba(0,0,0,.7)) drop-shadow(0 0 60px rgba(232,197,106,.25)); margin-bottom: 26px; }
    #demo-card .url { font-size: 44px; color: #f1cf7a; margin-top: 24px; font-weight: 600; }
    #demo-count { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(10,10,14,.55);
      color: #fff; font-size: 260px; font-weight: 800; text-shadow: 0 10px 40px rgba(0,0,0,.6); }
    #demo-rec { position: absolute; top: 14px; left: 50%; transform: translateX(-50%); padding: 8px 18px; border-radius: 22px; background: rgba(20,20,26,.92);
      color: #fff; font-size: 22px; font-weight: 600; display: flex; gap: 10px; align-items: center; }
    #demo-rec i { width: 14px; height: 14px; border-radius: 50%; background: #ff4b4b; display: inline-block; }
    .demo-cam-preview { display: block; width: 100%; max-width: 260px; aspect-ratio: 1; object-fit: cover; border-radius: 10px; margin-top: 10px; }
  `;
  document.head.appendChild(css);
  const ov = document.createElement("div");
  ov.id = "demo-ov";
  ov.lang = "en"; // not the Tibetan UI font rules
  ov.innerHTML = `
    <div id="demo-ring" style="display:none"></div>
    <div id="demo-count" style="display:none"></div>
    <div id="demo-rec" style="display:none"><i></i><span>REC</span> <span id="demo-rec-t">00:00</span></div>
    <div id="demo-card" style="display:none"></div>
    <div id="demo-sub" style="display:none"></div>
    <div id="demo-ripple" style="display:none"></div>
    <div id="demo-mark" style="position:absolute;left:0;top:0;width:3px;height:3px;z-index:10"></div>
    <svg id="demo-cursor" viewBox="0 0 24 24"><path d="M3 2 L3 19 L7.5 14.8 L10.6 21.6 L13.6 20.3 L10.6 13.6 L16.8 13.6 Z" fill="#fff" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/></svg>`;
  document.body.appendChild(ov);
  const $ = (id) => document.getElementById(id);

  // ------------------------------------------------------------------ helpers
  /** Centre of an element (selector, element or [x, y]) in CSS pixels. */
  const pos = (target) => {
    if (Array.isArray(target)) return target;
    const el = typeof target === "string" ? document.querySelector(target) : typeof target === "function" ? target() : target;
    if (!el) return null;
    if (Array.isArray(el)) return el;
    const r = el.getBoundingClientRect();
    return [r.left + r.width / 2, r.top + r.height / 2];
  };
  const byText = (selector, text) => [...document.querySelectorAll(selector)].find((e) => e.textContent.trim().includes(text));
  /** Canvas pixels -> page pixels on the preview. */
  const previewPoint = (x, y) => () => {
    const host = document.querySelector("[data-preview-host]");
    if (!host) return null;
    const r = host.getBoundingClientRect();
    const k = r.width / P().canvas.width;
    return [r.left + x * k, r.top + y * k];
  };
  const textBoxPoint = (field) => () => {
    const title = clipOf("title");
    const b = title && T.compositor.current?.textBoxes.find((x) => x.clipId === title.id && x.field === field);
    return b ? previewPoint(b.x + b.width / 2, b.y + b.height / 2)() : null;
  };
  const scrollPanelTo = (heading) => {
    const h = [...document.querySelectorAll(".prop-section h3")].find((x) => x.textContent.trim() === heading);
    if (h) h.scrollIntoView({ block: "start" });
  };
  const render = async () => {
    await sleep(0);
    await T.playback.current?.requestFrame(st().playheadMs);
  };

  let cursor = [960, 540];
  let cursorVisible = false;
  let ripple = null; // {x, y, t}
  let now = 0;
  const click = (target) => {
    const p = pos(target);
    if (p) ripple = { x: p[0], y: p[1], t: now };
    const el = typeof target === "string" ? document.querySelector(target) : typeof target === "function" ? null : target;
    if (el && el.click) el.click();
  };
  const dblclickPreview = (point) => {
    const p = point();
    const host = document.querySelector("[data-preview-host]");
    if (!p || !host) return;
    ripple = { x: p[0], y: p[1], t: now };
    host.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, clientX: p[0], clientY: p[1] }));
  };
  const setTextarea = (el, value) => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  };
  const setInput = (el, value) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  };

  // Made-up recording sources (the real list would show this computer's windows).
  const FAKE_SOURCES = [
    ["Full Screen · Screen 1", ASSETS.lesson],
    ["Tibetan Lessons — Browser", ASSETS.lesson],
    ["Slides — ཀ་ཁ་ག་ང་།", ASSETS.banner],
  ];
  const maskRecorder = () => {
    const cards = [...document.querySelectorAll(".source-card:not(.region)")];
    cards.forEach((c, i) => {
      if (i >= FAKE_SOURCES.length) return void (c.style.display = "none");
      const img = c.querySelector("img");
      if (img && img.src !== FAKE_SOURCES[i][1]) img.src = FAKE_SOURCES[i][1];
      const name = c.querySelector(".source-name");
      if (name && name.textContent !== FAKE_SOURCES[i][0]) name.textContent = FAKE_SOURCES[i][0];
    });
    const sections = [...document.querySelectorAll(".rec-columns .rec-section")];
    const camSel = sections[0]?.querySelector("select");
    const micSel = sections[1]?.querySelector("select");
    if (camSel && camSel.options[0]) camSel.options[camSel.selectedIndex].text = "HD Webcam";
    if (micSel && micSel.options[0]) micSel.options[micSel.selectedIndex].text = "Microphone (USB)";
    if (sections[0] && !sections[0].querySelector(".demo-cam-preview")) {
      const img = document.createElement("img");
      img.className = "demo-cam-preview";
      img.src = ASSETS.presenter;
      sections[0].appendChild(img);
    }
  };

  // ------------------------------------------------------------------ project
  const DUR = 30000;
  const base = { sourceInMs: 0, speed: 1, opacity: 1, volume: 1, fadeInMs: 0, fadeOutMs: 0, muted: false, hidden: false, locked: false };
  const DIR = "__SHOWCASE_DIR__";
  const MUSIC = `${DIR}\\..\\..\\resources\\library\\music`;
  const buildLesson = (opts = {}) => {
    const p0 = P();
    const screen = p0.tracks.find((t) => t.kind === "screen");
    const cam = p0.tracks.find((t) => t.kind === "webcam");
    const mic = p0.tracks.find((t) => t.kind === "mic");
    const sys = p0.tracks.find((t) => t.kind === "system");
    const audio = opts.audio && mic && sys;
    st().edit("demo", (p) => ({
      ...p,
      name: "གསལ་བྱེད་སུམ་ཅུ། སློབ་ཚན་དང་པོ།",
      media: [
        { id: "med_lesson", kind: "image", origin: "import", path: `${DIR}\\lesson.png`, durationMs: DUR, width: 1920, height: 1080, clockOffsetMs: 0 },
        { id: "med_presenter", kind: "image", origin: "import", path: `${DIR}\\presenter.png`, durationMs: DUR, width: 1080, height: 1080, clockOffsetMs: 0 },
        ...(audio ? [
          { id: "med_mic", kind: "audio", origin: "mic", path: `${MUSIC}\\soft-pulse.wav`, durationMs: 19200, clockOffsetMs: 0 },
          { id: "med_sys", kind: "audio", origin: "system", path: `${MUSIC}\\mountain-pluck.wav`, durationMs: 20000, clockOffsetMs: 0 },
        ] : []),
      ],
      clips: [
        { id: "clp_lesson", trackId: screen.id, mediaId: "med_lesson", content: { type: "media" }, startMs: 0, durationMs: DUR, ...base },
        { id: "clp_cam", trackId: cam.id, mediaId: "med_presenter", content: { type: "media" }, startMs: 0, durationMs: DUR, ...base },
        ...(audio ? [
          { id: "clp_mic", trackId: mic.id, mediaId: "med_mic", content: { type: "media" }, startMs: 0, durationMs: 19200, ...base },
          { id: "clp_sys", trackId: sys.id, mediaId: "med_sys", content: { type: "media" }, startMs: 0, durationMs: 20000, ...base },
        ] : []),
      ],
      markers: [],
      zooms: [],
      canvas: { ...p.canvas, background: { type: "wallpaper", id: "lhasa-dusk" } },
      webcam: {
        ...p.webcam, layout: "bubble", anchor: "bottom-right", sizePct: 30, mirror: false, shape: "circle", aspect: "1:1",
        border: { style: "ring", width: 8, color: "#d4a94a", color2: "#9b1b30" },
        look: { ...p.webcam.look, preset: "none", smooth: 0, brighten: 0, sharpen: 0 },
      },
    }));
    st().select([]);
    st().selectTrack(null);
    st().setPanelTab("properties");
    st().setPlayhead(2000);
    T.runAction("view.fitTimeline");
  };

  // ------------------------------------------------------------------ scenes
  // Each scene: cursor keyframes [ms, target] (the cursor glides in the 650 ms before each),
  // events [ms, fn] (run once), tick(ms) every frame. `L(i, +ms)` = when narration line i starts.
  const defaultScenes = {
    intro: (L, dur) => ({
      card: { from: 0, to: dur - 700, html: `<div class="studio">Welcome to the Nangchen Tashi Studio</div><img src="${ASSETS.icon}"><div class="bo">ནང་ཆེན་བཀྲིས་གློག་ཀླད་མཐོང་རིས་འཛིན་ཆས།</div><div class="en">Nangchen Studio Screen Recorder</div><div class="tag">A quick tour · Tibetan & English</div>` },
      events: [[dur - 400, () => (cursorVisible = true)]],
      cursor: [[0, [1100, 600]]],
    }),
    language: (L) => ({
      cursor: [[L(0, 400), ".language-switch button:first-child"], [L(1, 1600), ".language-switch button:last-child"]],
      ring: [[L(0, 0), L(1, 2600), ".language-switch"]],
      events: [
        [L(0, 450), () => { click(".language-switch button:first-child"); void window.tdr.setLanguage("en"); }],
        [L(1, 1650), () => { click(".language-switch button:last-child"); void window.tdr.setLanguage("bo"); }],
      ],
    }),
    sources: (L) => ({
      cursor: [[L(0, 300), ".sidebar .nav:first-child"], [L(1, 500), ".source-card:nth-child(1)"], [L(1, 2600), ".rec-columns .rec-section:nth-child(1) select"], [L(1, 4300), ".rec-columns .rec-section:nth-child(2) select"], [L(2, 400), ".rec-columns .rec-section:nth-child(3) input"]],
      ring: [[L(1, 2300), L(1, 4100), ".rec-columns .rec-section:nth-child(1)"], [L(1, 4100), L(2, 0), ".rec-columns .rec-section:nth-child(2)"], [L(2, 200), L(2, 2600), ".rec-columns .rec-section:nth-child(3)"]],
      events: [
        [L(0, 350), () => click(".sidebar .nav:first-child")],
        [L(1, 550), () => click(".source-card:nth-child(1)")],
      ],
      tick: maskRecorder,
    }),
    record: (L, dur) => {
      const c0 = L(1, 300);
      return {
        cursor: [[L(0, 250), ".record-button"], [c0 + 3200, [1500, 700]]],
        ring: [[L(0, 0), L(0, 1300), ".record-button"]],
        events: [
          [L(0, 300), () => { const p = pos(".record-button"); if (p) ripple = { x: p[0], y: p[1], t: now }; }],
          [c0 + 3000, () => { st().setView("editor"); buildLesson(); }],
        ],
        tick: (ms) => {
          if (st().view === "recorder") maskRecorder();
          const k = ms - c0;
          $("demo-count").style.display = k >= 0 && k < 3000 ? "flex" : "none";
          if (k >= 0 && k < 3000) $("demo-count").textContent = String(3 - Math.floor(k / 1000));
          const rec = k >= 3000 && k < 3000 + 2200;
          $("demo-rec").style.display = rec ? "flex" : "none";
          if (rec) $("demo-rec-t").textContent = `00:0${Math.floor((k - 3000) / 1000)}`;
          if (k >= 3000) st().setPlayhead(Math.min(DUR, 2000 + (k - 3000) * 0.6));
        },
      };
    },
    timeline: (L, dur) => {
      const sel = L(1, 200), cut = L(1, 1700), trim0 = L(1, 2600), trim1 = dur - 600;
      let dragging = false;
      return {
        cursor: [[L(0, 900), '[data-clip="clp_cam"]'], [sel, '[data-clip="clp_lesson"]'], [cut, scissors], [trim0, edgeOf], [trim1, edgeOf]],
        ring: [[L(0, 0), L(0, 2600), ".timeline"]],
        events: [
          [sel, () => { click('[data-clip="clp_lesson"]'); st().select(["clp_lesson"]); }],
          [sel + 300, () => st().setPlayhead(9000)],
          [cut, () => click(scissors())],
          [trim0, () => { const id = lastLessonPiece(); st().select([id]); st().beginDrag(); dragging = true; }],
          [trim1 + 20, () => { if (dragging) { st().endDrag("edit.trim"); dragging = false; } }],
        ],
        tick: (ms) => {
          if (dragging && ms <= trim1) {
            const k = ease(clamp01((ms - trim0) / (trim1 - trim0)));
            const id = lastLessonPiece();
            st().dragPreview((p) => ({ ...p, clips: p.clips.map((c) => (c.id === id ? { ...c, durationMs: Math.round((DUR - 9000) - k * 6000) } : c)) }));
          }
        },
      };
    },
    zoom: (L, dur) => {
      const z0 = L(0, 300);
      return {
        cursor: [[L(0, 200), () => previewPoint(1100, 260)()], [L(1, 600), ".camera-lane .lane-clips"]],
        events: [
          [L(0, 100), () => {
            st().select([]);
            st().setPlayhead(4000);
            st().edit("demo", (p) => ({ ...p, zooms: [{ id: "zm1", startMs: 4300, endMs: 4300 + (dur - 1400), depth: 2, focus: { x: 0.55, y: 0.32 }, mode: "manual", suggested: false }] }));
          }],
        ],
        tick: (ms) => { if (ms >= z0) st().setPlayhead(4000 + (ms - z0)); },
      };
    },
    webcam: (L) => ({
      cursor: [[L(0, 300), ".lane-head"], [L(1, 900), '[data-shape="circle"]'], [L(1, 2000), '[data-shape="squircle"]'], [L(1, 3200), '[data-shape="heart"]'],
        [L(2, 900), '[data-border="gradient"]'], [L(2, 1700), '[data-border="glow"]'], [L(2, 2500), '[data-border="neon"]'], [L(2, 3300), '[data-border="rainbow"]']],
      events: [
        [L(0, 350), () => { st().setPlayhead(3000); st().edit("demo", (p) => ({ ...p, zooms: [] })); st().selectTrack(lane("webcam").id); }],
        [L(0, 700), () => scrollPanelTo(st().t("webcamStyle.title"))],
        [L(1, 950), () => click('[data-shape="circle"]')],
        [L(1, 2050), () => click('[data-shape="squircle"]')],
        [L(1, 3250), () => click('[data-shape="heart"]')],
        [L(2, 950), () => click('[data-border="gradient"]')],
        [L(2, 1750), () => click('[data-border="glow"]')],
        [L(2, 2550), () => click('[data-border="neon"]')],
        [L(2, 3350), () => click('[data-border="rainbow"]')],
      ],
      tick: (ms) => st().setPlayhead(3000 + ms * 0.2),
    }),
    filters: (L) => {
      const s0 = L(0, 600), s1 = L(1, 0);
      return {
        cursor: [[L(0, 300), () => byText(".prop-section h3", st().t("webcamLook.title"))], [s1 - 200, () => byText(".prop-section h3", st().t("webcamLook.title"))],
          [L(1, 900), '[data-look="warm"]'], [L(1, 1900), '[data-look="film"]'], [L(1, 3000), '[data-look="golden"]']],
        events: [
          [L(0, 100), () => { setW({ shape: "circle", border: { style: "ring", width: 8, color: "#d4a94a", color2: "#9b1b30" }, sizePct: 34 }); scrollPanelTo(st().t("webcamLook.title")); }],
          [L(1, 950), () => click('[data-look="warm"]')],
          [L(1, 1950), () => click('[data-look="film"]')],
          [L(1, 3050), () => click('[data-look="golden"]')],
        ],
        tick: (ms) => {
          if (ms >= s0 && ms <= s1 + 100) {
            const k = clamp01((ms - s0) / (s1 - s0));
            if (Math.round(k * 20) !== Math.round((P().webcam.look.smooth / 0.75) * 20)) setW({ look: { ...P().webcam.look, smooth: Math.round(k * 20) / 20 * 0.75, brighten: Math.round(k * 20) / 20 * 0.4 } });
          }
          st().setPlayhead(3600 + ms * 0.15);
        },
      };
    },
    titles: (L, dur) => {
      const typeFrom = L(1, 2400), typeTo = dur - 1500;
      const TEXT = "བཀྲ་ཤིས་བདེ་ལེགས། ང་ཚོའི་སློབ་ཚན་དང་པོ།";
      const chars = Array.from(TEXT);
      return {
        cursor: [[L(0, 200), '[data-tab="library"]'], [L(0, 1300), '[data-lib="title.lowerThird"]'], [L(1, 1300), textBoxPoint("title")], [dur - 900, textBoxPoint("title")]],
        events: [
          [L(0, 250), () => { st().selectTrack(null); click('[data-tab="library"]'); }],
          [L(0, 1350), () => { st().setPlayhead(5000); click('[data-lib="title.lowerThird"]'); }],
          [L(0, 1500), () => { const t = clipOf("title"); setClip(t.id, { startMs: 1000, durationMs: 25000 }); setContent(t.id, { title: "སློབ་ཚན།", subtitle: "Lesson 1", lang: "bo" }); st().setPlayhead(5000); }],
          [L(1, 1350), () => dblclickPreview(textBoxPoint("title"))],
          [L(1, 1600), () => { const ed = document.querySelector("[data-inline-editor]"); if (ed) setTextarea(ed, ""); }],
          [typeTo + 300, () => { const ed = document.querySelector("[data-inline-editor]"); if (ed) ed.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); }],
        ],
        tick: (ms) => {
          const ed = document.querySelector("[data-inline-editor]");
          if (ed && ms >= typeFrom && ms <= typeTo + 200) {
            const n = Math.min(chars.length, Math.floor(((ms - typeFrom) / (typeTo - typeFrom)) * chars.length) + 1);
            const v = chars.slice(0, n).join("");
            if (ed.value !== v) setTextarea(ed, v);
          }
        },
      };
    },
    fonts: (L, dur) => ({
      cursor: [[L(0, 300), "[data-font-picker]"], [L(1, 600), '[data-font="Noto Serif Tibetan"]'], [L(1, 1600), '[data-font="Uchen"]'], [L(1, 2600), '[data-font="Jomolhari"]'], [dur - 300, textBoxPoint("title")]],
      events: [
        [L(0, 50), () => { st().setPanelTab("properties"); st().select([clipOf("title").id]); }],
        [L(0, 250), () => document.querySelector("[data-font-picker]")?.scrollIntoView({ block: "start" })],
        [L(0, 350), () => click("[data-font-picker]")],
        [L(1, 2650), () => click('[data-font="Jomolhari"]')],
      ],
    }),
    teaching: (L) => ({
      cursor: [[L(0, 200), '[data-tab="library"]'], [L(0, 900), '[data-lib="insert.callout"]'], [L(0, 2100), '[data-lib="insert.highlight"]'], [L(0, 3100), '[data-lib="insert.stepNumber"]'], [L(1, 300), '[data-tab="captions"]']],
      events: [
        [L(0, 100), () => { st().select([]); st().setPlayhead(6000); }],
        [L(0, 250), () => click('[data-tab="library"]')],
        [L(0, 950), () => { click('[data-lib="insert.callout"]'); const c = clipOf("callout"); if (c) { setContent(c.id, { text: "ང་ — nga", lang: "bo", tailX: 1020, tailY: 330 }); setClip(c.id, { startMs: 5500, durationMs: 20000, frame: { x: 1230, y: 150, width: 420, height: 130 } }); } }],
        [L(0, 2150), () => { click('[data-lib="insert.highlight"]'); const c = clipOf("highlight"); if (c) setClip(c.id, { startMs: 5500, durationMs: 20000, frame: { x: 980, y: 300, width: 200, height: 160 } }); }],
        [L(0, 3150), () => { click('[data-lib="insert.stepNumber"]'); const c = clipOf("step"); if (c) setClip(c.id, { startMs: 5500, durationMs: 20000, frame: { x: 560, y: 300, width: 90, height: 90 } }); }],
        [L(1, 350), () => {
          click('[data-tab="captions"]');
          const cues = X.parseSubtitles("1\n00:00:05,000 --> 00:00:30,000\nདེ་རིང་ང་ཚོས་གསལ་བྱེད་སུམ་ཅུ་སློབ་སྦྱོང་བྱེད།\n");
          st().edit("captions", (p) => ({ ...X.cuesToCaptionClips(p, cues, "bo").project, captionStyle: { ...p.captionStyle, position: "top" } }));
          st().select([]);
        }],
      ],
      tick: (ms) => st().setPlayhead(6000 + ms * 0.1),
    }),
    export: (L) => ({
      cursor: [[L(0, 300), () => byText(".menu-title", st().t("menu.export"))], [L(1, 0), () => byText(".export-dialog button", "MP4")], [L(1, 1600), ".export-dialog .modal-actions button:last-child"]],
      events: [[L(0, 350), () => { const p = pos(() => byText(".menu-title", st().t("menu.export"))); if (p) ripple = { x: p[0], y: p[1], t: now }; st().setExportDialog("video"); }]],
    }),
    outro: (L, dur) => ({
      events: [[0, () => st().setExportDialog(null)], [500, () => (cursorVisible = false)]],
      card: { from: 400, to: dur + 1000, fadeIn: true, html: `<img class="big" src="${ASSETS.icon}"><div class="en">Nangchen Studio Screen Recorder</div><div class="tag">Available for Windows and Mac · Tibetan & English</div><div class="share">Let's share our knowledge with others.</div><div class="url">nangchen.com</div>` },
    }),
  };
  const scissors = () => [...document.querySelectorAll(".tl-btn")].find((x) => x.textContent.includes("✂"));
  const lessonPieces = () => P().clips.filter((c) => c.trackId === lane("screen")?.id).sort((a, b) => a.startMs - b.startMs);
  const lastLessonPiece = () => lessonPieces().at(-1)?.id;
  const edgeOf = () => {
    const id = lastLessonPiece();
    const el = id && document.querySelector(`[data-clip="${id}"]`);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return [r.right - 3, r.top + r.height / 2];
  };
  /** Everything a scene file needs (see smoke/training.page.js). */
  const H = {
    T, X, S, st, P, sleep, lane, clipOf, ease, clamp01, setW, setContent, setClip, pos, byText, previewPoint, textBoxPoint,
    scrollPanelTo, click, dblclickPreview, setTextarea, setInput, maskRecorder, buildLesson, scissors, lessonPieces, lastLessonPiece,
    edgeOf, ASSETS, DUR, $,
    now: () => now,
    showCursor: (v) => (cursorVisible = v),
    rippleAt: (target) => { const p = pos(target); if (p) ripple = { x: p[0], y: p[1], t: now }; },
    /** The panel section whose heading is the translation of `key`. */
    section: (key) => [...document.querySelectorAll(".prop-section")].find((x) => x.querySelector("h3")?.textContent.trim() === st().t(key)),
  };
  const scenes = window.__demoSceneFactory ? window.__demoSceneFactory(H, defaultScenes) : defaultScenes;

  // ------------------------------------------------------------------ timeline of scenes
  let start = 0;
  const segs = PLAN.segments.map((s) => {
    const L = (i, plus = 0) => (s.lines[i] ? s.lines[i].start : s.dur) + plus;
    const def = (scenes[s.id] ?? (() => ({})))(L, s.dur);
    const seg = { ...def, id: s.id, start, dur: s.dur, lines: s.lines, done: new Set() };
    start += s.dur;
    return seg;
  });

  const cursorAt = (seg, ms) => {
    const keys = seg.cursor ?? [];
    let from = cursor;
    for (const [at, target] of keys) {
      if (ms < at - 650) break;
      const p = pos(target) ?? from;
      if (ms >= at) { from = p; continue; }
      const k = ease(clamp01((ms - (at - 650)) / 650));
      return [from[0] + (p[0] - from[0]) * k, from[1] + (p[1] - from[1]) * k];
    }
    return from;
  };

  window.__demo = {
    async setup() {
      st().setView("editor");
      st().setPanelTab("properties");
      cursorVisible = false;
    },
    async frame(t, index = 0) {
      now = t;
      const seg = segs.findLast((s) => t >= s.start) ?? segs[0];
      const ms = t - seg.start;
      // Starting mid-way (a render chunk): the loop below replays every earlier action in
      // order. Scenes record any lasting result of an animation as an action of its own.
      // Run every action that is due, including earlier scenes' (when starting mid-way).
      for (const sg of segs) {
        if (sg.start > t) break;
        for (const [i, [at, fn]] of (sg.events ?? []).entries()) {
          if (t - sg.start >= at && !sg.done.has(i)) {
            sg.done.add(i);
            await fn();
            await sleep(30);
          }
        }
      }
      seg.tick?.(ms);
      await sleep(0);
      await render();

      // Cursor (stays where the last scene left it).
      cursor = cursorAt(seg, ms);
      const cur = $("demo-cursor");
      cur.style.display = cursorVisible ? "block" : "none";
      cur.style.transform = `translate(${cursor[0] - 3}px, ${cursor[1] - 2}px)`;
      // Click ripple.
      const rp = $("demo-ripple");
      const age = ripple ? t - ripple.t : 1e9;
      if (age < 450) {
        const r = 8 + (age / 450) * 34;
        Object.assign(rp.style, { display: "block", left: `${ripple.x - r}px`, top: `${ripple.y - r}px`, width: `${r * 2}px`, height: `${r * 2}px`, opacity: String(1 - age / 450) });
      } else rp.style.display = "none";
      // Highlight ring.
      const ring = $("demo-ring");
      const active = (seg.ring ?? []).find(([a, b]) => ms >= a && ms <= b);
      const el = active && (typeof active[2] === "function" ? active[2]() : document.querySelector(active[2]));
      if (el) {
        const r = el.getBoundingClientRect();
        const fade = Math.min(1, (ms - active[0]) / 250, (active[1] - ms) / 250);
        Object.assign(ring.style, { display: "block", left: `${r.left - 6}px`, top: `${r.top - 6}px`, width: `${r.width + 12}px`, height: `${r.height + 12}px`, opacity: String(clamp01(fade)) });
      } else ring.style.display = "none";
      // Title card.
      const card = $("demo-card");
      if (seg.card && ms >= seg.card.from && ms <= seg.card.to + 700) {
        if (card.dataset.seg !== seg.id) { card.innerHTML = seg.card.html; card.dataset.seg = seg.id; }
        const fadeIn = seg.card.fadeIn ? clamp01((ms - seg.card.from) / 700) : 1;
        const fadeOut = clamp01(1 - (ms - seg.card.to) / 700);
        card.style.display = "flex";
        card.style.opacity = String(Math.min(fadeIn, fadeOut));
      } else card.style.display = "none";
      // Subtitle: the narration line being spoken.
      const line = seg.lines.find((l) => ms >= l.start - 120 && ms <= l.end + 250);
      const sub = $("demo-sub");
      sub.style.display = line ? "block" : "none";
      if (line && sub.textContent !== line.text) sub.textContent = line.text;
      // Frame marker (2×2 px, painted over when encoding): main waits until it sees this frame's colour.
      $("demo-mark").style.background = `rgb(${(index % 8) * 32 + 16}, ${(Math.floor(index / 8) % 8) * 32 + 16}, 90)`;
      await sleep(0);
      return { seg: seg.id, ms: Math.round(ms), cursor: cursor.map(Math.round), visible: cursorVisible, sub: line ? line.text.slice(0, 30) : "" };
    },
  };
}
0;
