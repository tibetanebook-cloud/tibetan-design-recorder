// README screenshots (`--smoke-test --showcase`): builds a demo lesson from
// docs/showcase (a lesson slide as the screen, an illustrated presenter as the
// webcam) and defines one step per screenshot. Main calls each step, then snaps.
{
  const T = window.__tdrTest;
  const X = T.tools;
  const S = T.store;
  const st = () => S.getState();
  const P = () => st().history.present;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const DIR = "__SHOWCASE_DIR__";
  const lane = (kind) => P().tracks.find((t) => t.kind === kind);
  const clipOf = (type) => P().clips.filter((c) => c.content.type === type).at(-1);
  const frame = async (t) => {
    st().setPlayhead(t);
    await sleep(80);
    await T.playback.current.requestFrame(t);
    await sleep(400);
  };
  const setW = (patch) => st().edit("showcase", (p) => ({ ...p, webcam: { ...p.webcam, ...patch } }));
  const setContent = (id, patch) => st().edit("showcase", (p) => ({ ...p, clips: p.clips.map((c) => (c.id === id ? { ...c, content: { ...c.content, ...patch } } : c)) }));
  const setClip = (id, patch) => st().edit("showcase", (p) => ({ ...p, clips: p.clips.map((c) => (c.id === id ? { ...c, ...patch } : c)) }));
  const scrollPanelTo = async (heading) => {
    const h = [...document.querySelectorAll(".prop-section h3")].find((x) => x.textContent.trim() === heading);
    if (h) h.scrollIntoView({ block: "start" });
    await sleep(300);
  };
  const DUR = 30000;
  const base = { sourceInMs: 0, speed: 1, opacity: 1, volume: 1, fadeInMs: 0, fadeOutMs: 0, muted: false, hidden: false, locked: false };

  window.__showcase = {
    async setup() {
      const p0 = P();
      const screen = p0.tracks.find((t) => t.kind === "screen");
      const cam = p0.tracks.find((t) => t.kind === "webcam");
      const media = [
        { id: "med_lesson", kind: "image", origin: "import", path: `${DIR}\\lesson.png`, durationMs: DUR, width: 1920, height: 1080, clockOffsetMs: 0 },
        { id: "med_presenter", kind: "image", origin: "import", path: `${DIR}\\presenter.png`, durationMs: DUR, width: 1080, height: 1080, clockOffsetMs: 0 },
      ];
      const clips = [
        { id: "clp_lesson", trackId: screen.id, mediaId: "med_lesson", content: { type: "media" }, startMs: 0, durationMs: DUR, ...base },
        { id: "clp_cam", trackId: cam.id, mediaId: "med_presenter", content: { type: "media" }, startMs: 0, durationMs: DUR, ...base },
      ];
      st().edit("showcase", (p) => ({
        ...p,
        name: "གསལ་བྱེད་སུམ་ཅུ། སློབ་ཚན་དང་པོ།",
        media,
        clips,
        markers: [{ id: "m1", timeMs: 6000, label: "ཀ་ཁ་ག་ང་།", kind: "chapter" }],
        zooms: [],
        canvas: { ...p.canvas, background: { type: "wallpaper", id: "lhasa-dusk" } },
        webcam: {
          ...p.webcam,
          layout: "bubble",
          anchor: "bottom-right",
          sizePct: 30,
          mirror: false,
          shape: "circle",
          aspect: "1:1",
          border: { style: "ring", width: 8, color: "#d4a94a", color2: "#9b1b30" },
          look: { ...p.webcam.look, preset: "warm", smooth: 0.6, brighten: 0.3, sharpen: 0 },
        },
      }));
      // Lower-third title (inserted in the UI language: Tibetan).
      st().setPlayhead(500);
      X.insertTitle("lowerThird");
      const title = clipOf("title");
      setContent(title.id, { title: "གསལ་བྱེད་སུམ་ཅུ།", subtitle: "སློབ་ཚན་དང་པོ། ཀ་ནས་ཨ་བར།", lang: "bo" });
      setClip(title.id, { startMs: 500, durationMs: 20000 });
      // Captions.
      const cues = X.parseSubtitles("1\n00:00:00,000 --> 00:00:08,000\nདེ་རིང་ང་ཚོས་གསལ་བྱེད་སུམ་ཅུ་སློབ་སྦྱོང་བྱེད་ཀྱི་ཡིན།\n\n2\n00:00:08,000 --> 00:00:20,000\nཀ་ཁ་ག་ང་། ཅ་ཆ་ཇ་ཉ།\n");
      st().edit("captions", (p) => X.cuesToCaptionClips(p, cues, "bo").project);
      st().edit("captions", (p) => ({ ...p, captionStyle: { ...p.captionStyle, position: "top" } }));
      // Callout pointing at ང.
      st().setPlayhead(1000);
      T.runAction("insert.callout");
      const callout = clipOf("callout");
      setContent(callout.id, { text: "ང་ — nga", lang: "bo", tailX: 1020, tailY: 330 });
      setClip(callout.id, { startMs: 1000, durationMs: 15000, frame: { x: 1230, y: 150, width: 420, height: 130 } });
      st().select([]);
      st().selectTrack(null);
      st().setPanelTab("properties");
      T.runAction("view.fitTimeline");
      await frame(4000);
    },

    /** 1. The editor: lesson, webcam bubble, title, callout, captions; title properties (fonts). */
    async editor() {
      st().select([clipOf("title").id]);
      await frame(4000);
    },

    /** 2. Webcam bubble shape and border. */
    async webcamStyle() {
      st().select([]);
      setW({ shape: "heart", border: { style: "neon", width: 9, color: "#ff4fa3", color2: "#7b5cff" }, sizePct: 34 });
      st().selectTrack(lane("webcam").id);
      await frame(4000);
      await scrollPanelTo(st().t("webcamStyle.title"));
    },

    /** 3. Webcam filters: beauty + looks. */
    async webcamFilters() {
      setW({ shape: "squircle", border: { style: "gradient", width: 10, color: "#d4a94a", color2: "#9b1b30" }, look: { ...P().webcam.look, preset: "golden", smooth: 0.7, brighten: 0.4 } });
      await frame(4000);
      await scrollPanelTo(st().t("webcamLook.title"));
    },

    /** 4. Double-click a title on the preview to edit it in place. */
    async inlineEdit() {
      st().selectTrack(null);
      setW({ shape: "circle", border: { style: "ring", width: 8, color: "#d4a94a", color2: "#9b1b30" }, look: { ...P().webcam.look, preset: "warm", smooth: 0.6, brighten: 0.3 }, sizePct: 30 });
      const title = clipOf("title");
      await frame(4000);
      const b = T.compositor.current.textBoxes.find((x) => x.clipId === title.id && x.field === "title");
      const host = document.querySelector("[data-preview-host]");
      if (b && host) {
        const r = host.getBoundingClientRect();
        const k = r.width / P().canvas.width;
        host.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, clientX: r.left + (b.x + b.width / 2) * k, clientY: r.top + (b.y + b.height / 2) * k }));
        await sleep(400);
        const ed = document.querySelector("[data-inline-editor]");
        if (ed) {
          ed.value = "གསལ་བྱེད་སུམ་ཅུ། ཀ་ཁ་ག་ང་།";
          ed.setSelectionRange(ed.value.length, ed.value.length);
        }
      }
      await sleep(300);
    },

    async closeEditor() {
      const ed = document.querySelector("[data-inline-editor]");
      if (ed) ed.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      await sleep(300);
    },

    /** 5. Title templates and the library. */
    async library() {
      st().select([]);
      st().setPanelTab("library");
      await frame(4000);
    },

    /** 6. Captions panel. */
    async captions() {
      st().setPanelTab("captions");
      await frame(9000);
    },

    /** 8. Fonts: every font on this computer, Tibetan fonts first (run as a user gesture). */
    async fonts() {
      st().setPanelTab("properties");
      st().select([clipOf("title").id]);
      await frame(4000);
      await sleep(300);
      const btn = document.querySelector("[data-font-picker]");
      btn.scrollIntoView({ block: "start" });
      btn.click();
      // Wait until this computer's fonts are listed (not just the built-in ones).
      for (let i = 0; i < 100 && document.querySelectorAll(".font-row[data-font]").length < 20; i++) await sleep(100);
      await sleep(600);
      return { rows: document.querySelectorAll(".font-row[data-font]").length, tibetan: document.querySelectorAll(".font-row .font-sample").length };
    },

    async closeFonts() {
      document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      st().select([]);
      await sleep(300);
    },

    /** 7. Export dialog. */
    async exportDialog() {
      st().setPanelTab("properties");
      await frame(4000);
      st().setExportDialog("video");
      await sleep(800);
    },

    async closeExport() {
      st().setExportDialog(null);
      await sleep(300);
    },
  };
}
0;
