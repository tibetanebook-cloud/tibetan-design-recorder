// Stage 7 localization audit, installed into the editor page. The main process
// calls __l10n.go(i) for each screen, takes a screenshot, then __l10n.scan().
//  - untranslated: visible Latin-script words outside lang="en" elements that
//    aren't codes or units (text, option labels, title/placeholder/aria-label);
//  - typography: Tibetan text not in Noto Serif Tibetan, line height < 1.8,
//    or clipped (content taller than its box).
(() => {
  const T = window.__tdrTest;
  const S = T.store;
  const st = () => S.getState();
  const P = () => st().history.present;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const TIB = /[ༀ-࿿]/;
  // Codes, units and names that stay in Latin script in Tibetan software.
  const ALLOW = new Set(
    ("fps kbps mbps mb kb gb lufs db hz px ms gpu api srt vtt mp4 webm gif mp3 wav m4a aac opus h264 hevc av1 vp9 openai " +
      "ctrl shift alt space esc enter cmd tab home end del delete backspace pageup pagedown arrowleft arrowright arrowup arrowdown " +
      "english x y x1 y1 x2 y2 auto lame pcm bit avc1 hardware software s c l r ka kha ga nga a b d e f llc lr " +
      "tdrec jsonl webp png jpg jpeg" ).split(/\s+/),
  );
  const visible = (el) => !!(el && el.getClientRects().length) && getComputedStyle(el).visibility !== "hidden";
  // User content: text being edited (textarea/input values), names from the OS, the user's own project data.
  const skip = (el) => !!el.closest('[lang="en"], [data-l10n-skip], textarea, canvas, .clip, .ruler, .zoom-region');
  // A trailing keyboard hint such as "(Shift+Z)" or "(M)" names keys, not words.
  const KEY_HINT = /\s*\((?:(?:Ctrl|Shift|Alt|Cmd|⌘|Space|Esc|Enter|Delete|Backspace|Home|End|Tab|[A-Z0-9\[\]\/.,;'=-]|F\d{1,2}|Arrow\w+)\+?)+\)\s*$/;
  const words = (s) => (s.replace(KEY_HINT, "").match(/[A-Za-z][A-Za-z0-9'’]*/g) || []).filter((w) => !ALLOW.has(w.toLowerCase()) && !/^[a-f0-9]{6,}$/i.test(w));

  function scan() {
    const untranslated = new Map();
    const typography = new Map();
    const add = (map, key, val) => { if (!map.has(key)) map.set(key, val); };
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement;
      const text = n.textContent.trim();
      if (!text || !el || !visible(el)) continue;
      if (!skip(el)) {
        const w = words(text);
        if (w.length) add(untranslated, text.slice(0, 80), { where: describe(el), words: w.join(" ") });
      }
      if (TIB.test(text) && !(el instanceof HTMLOptionElement)) {
        const cs = getComputedStyle(el);
        const size = parseFloat(cs.fontSize);
        const lh = cs.lineHeight === "normal" ? NaN : parseFloat(cs.lineHeight);
        const problems = [];
        if (!/Noto Serif Tibetan/i.test(cs.fontFamily)) problems.push(`font ${cs.fontFamily.split(",")[0]}`);
        if (!(lh / size >= 1.79)) problems.push(`line-height ${Number.isFinite(lh) ? (lh / size).toFixed(2) : cs.lineHeight}`);
        const clipX = cs.overflowX !== "visible" && el.scrollWidth > el.clientWidth + 1 && cs.textOverflow !== "ellipsis";
        const clipY = cs.overflowY !== "visible" && el.scrollHeight > el.clientHeight + 2;
        if (clipY) problems.push(`clipped ${el.scrollHeight}>${el.clientHeight}px`);
        if (clipX) problems.push(`cut off ${el.scrollWidth}>${el.clientWidth}px`);
        if (problems.length) add(typography, `${describe(el)}|${problems.join(",")}`, { where: describe(el), text: text.slice(0, 40), problems: problems.join(", ") });
      }
    }
    // Option labels and attributes the user sees (tooltips, placeholders, screen-reader names).
    for (const el of document.querySelectorAll("option, [title], [placeholder], [aria-label]")) {
      if (skip(el)) continue;
      const host = el instanceof HTMLOptionElement ? el.closest("select") : el;
      if (!host || !visible(host)) continue;
      const parts = el instanceof HTMLOptionElement ? [el.textContent] : ["title", "placeholder", "aria-label"].map((a) => el.getAttribute(a) || "");
      for (const p of parts) {
        const w = words(p || "");
        if (w.length) add(untranslated, p.slice(0, 80), { where: describe(el) + (el instanceof HTMLOptionElement ? " option" : " attribute"), words: w.join(" ") });
      }
    }
    return { untranslated: [...untranslated].map(([text, v]) => ({ text, ...v })), typography: [...typography.values()] };
  }

  function describe(el) {
    const parts = [];
    for (let e = el; e && e !== document.body && parts.length < 3; e = e.parentElement) {
      const c = typeof e.className === "string" && e.className ? "." + e.className.trim().split(/\s+/)[0] : "";
      parts.unshift(e.tagName.toLowerCase() + c);
    }
    return parts.join(">");
  }

  const clipOf = (type) => P().clips.find((c) => c.content.type === type);
  const selectClip = (type) => {
    const c = clipOf(type);
    st().selectZoom(null);
    st().selectTrack(null);
    st().select(c ? [c.id] : []);
    if (c) st().setPlayhead(c.startMs + Math.min(1500, c.durationMs / 2));
    st().setPanelTab("properties");
  };
  const selectLane = (kind) => {
    const t = P().tracks.find((x) => x.kind === kind);
    st().select([]);
    st().selectZoom(null);
    st().selectTrack(t ? t.id : null);
    st().setPanelTab("properties");
  };
  const closeAll = () => {
    st().setExportDialog(null);
    document.querySelectorAll(".modal-backdrop").forEach((m) => m.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })));
    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  };
  const openMenu = (i) => {
    const titles = document.querySelectorAll(".menu-title");
    titles[i]?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  };

  async function setup() {
    // Make sure every kind of content exists to inspect.
    st().setView("editor");
    st().setPlayhead(500);
    const need = [["callout", "insert.callout"], ["redact", "insert.blurRegion"], ["step", "insert.stepNumber"], ["spotlight", "insert.spotlight"], ["highlight", "insert.highlight"], ["text", "insert.text"]];
    for (const [type, action] of need) if (!clipOf(type)) T.runAction(action);
    if (!clipOf("title")) T.tools.insertTitle("lowerThird");
    if (!P().markers.some((m) => m.kind === "quiz")) st().addMarkerAtPlayhead("quiz");
    if (!P().zooms.length) st().addZoomAtPlayhead();
    st().select([]);
    await sleep(200);
  }

  const screens = [
    ["editor", () => { closeAll(); st().select([]); st().selectTrack(null); st().selectZoom(null); st().setPanelTab("properties"); }],
    ...[0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => [`menu-${i}`, () => { closeAll(); openMenu(i); }]),
    ["text", () => { closeAll(); selectClip("text"); }],
    ["callout", () => selectClip("callout")],
    ["redact", () => selectClip("redact")],
    ["spotlight", () => selectClip("spotlight")],
    ["highlight", () => selectClip("highlight")],
    ["step", () => selectClip("step")],
    ["title", () => selectClip("title")],
    ["caption-clip", () => selectClip("caption")],
    ["screen-lane", () => selectLane("screen")],
    ["webcam-lane", () => selectLane("webcam")],
    ["mic-lane", () => selectLane("mic")],
    ["cursor-lane", () => selectLane("cursor")],
    ["zoom", () => { st().select([]); st().selectTrack(null); const z = P().zooms[0]; if (z) st().selectZoom(z.id); }],
    ["library", () => { st().selectZoom(null); st().setPanelTab("library"); }],
    ["captions", () => { st().setPanelTab("captions"); setTimeout(() => [...document.querySelectorAll(".captions button")].find((b) => b.textContent === st().t("captions.service"))?.click(), 50); }],
    ["teaching", () => st().setPanelTab("teaching")],
    ["jobs", () => st().setPanelTab("jobs")],
    ["export-video", () => st().setExportDialog("video")],
    ["export-gif", () => { st().setExportDialog("video"); setTimeout(() => document.querySelector('[data-format="gif"]')?.click(), 50); }],
    ["export-audio", () => { st().setExportDialog(null); setTimeout(() => st().setExportDialog("audio"), 30); }],
    ["export-tracks", () => { st().setExportDialog(null); setTimeout(() => st().setExportDialog("tracks"), 30); }],
    ["export-batch", () => { st().setExportDialog(null); setTimeout(() => st().setExportDialog("batch"), 30); }],
    ["shortcuts", () => { closeAll(); T.command("edit.shortcuts"); }],
    ["about", () => { closeAll(); T.command("help.about"); }],
    ["recorder", () => { closeAll(); st().setView("recorder"); }],
  ];

  window.__l10n = {
    count: screens.length,
    names: screens.map((s) => s[0]),
    setup,
    go: async (i) => {
      await screens[i][1]();
      await sleep(350);
      return screens[i][0];
    },
    scan,
  };
  return screens.length;
})();
