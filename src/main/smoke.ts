/**
 * `electron . --smoke-test`: launches the real app hidden, exercises the Stage 1
 * features end to end and writes screenshots + a JSON report to test-results/smoke/.
 * Exit code 0 means every check passed.
 */
import { app, ipcMain, type BrowserWindow } from "electron";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import type { Language } from "@shared/i18n";
import { IPC } from "@shared/ipc";
import { createProject } from "@shared/project/factory";
import { serializeProject } from "@shared/project/schema";
import { parseCursorJsonl } from "@shared/recording/cursorFile";
import { DEFAULT_RECORDING_SETTINGS, type RecordingSettings, type TakeManifest } from "@shared/recording/types";
import { readDurationMs } from "@shared/recording/webm";
import { loadProject, saveProject, type SessionRecovery } from "./project-io";
import type { RecordingController } from "./recording/controller";
import { inputHookAvailable } from "./recording/cursor-recorder";
import timelineScript from "./smoke/timeline.page.js?raw";
import effectsScript from "./smoke/effects.page.js?raw";
import toolsScript from "./smoke/tools.page.js?raw";
import exportScript from "./smoke/export.page.js?raw";
import l10nScript from "./smoke/l10n.page.js?raw";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { MENUS } from "@shared/menu";
import { REC } from "@shared/recording/ipc";

interface Hooks {
  setLanguage: (language: Language) => Promise<void>;
  recovery: SessionRecovery;
  userData: string;
  recorder: RecordingController;
  /** The path a double-clicked .tdrec takes into the window. */
  openProject: (path: string) => void;
}

type Check = (name: string, ok: boolean, detail?: string) => void;

/**
 * Screenshot of the current state. The smoke window is hidden, and Chromium stops
 * repainting hidden pages, so ask for a fresh paint first.
 */
async function snapshot(win: BrowserWindow): Promise<Buffer> {
  win.webContents.invalidate();
  await new Promise((r) => setTimeout(r, 400));
  return (await win.webContents.capturePage()).toPNG();
}

/**
 * Stage 2: a real recording. Screen (+ Windows system audio) is real; webcam and
 * mic come from Chromium's fake devices (--use-fake-device-for-media-stream).
 */
async function smokeRecording(
  win: BrowserWindow,
  recorder: RecordingController,
  outDir: string,
  check: Check,
  page: <T>(code: string) => Promise<T>,
  wait: (ms: number) => Promise<void>,
): Promise<void> {
  win.webContents.send(IPC.menuCommand, "view.recorder");
  await wait(3500);
  const ui = await page<{ sources: number; meters: number[] }>(
    "({ sources: document.querySelectorAll('.source-card').length, meters: [...document.querySelectorAll('.meter')].map(m => Number(m.getAttribute('aria-valuenow'))) })",
  );
  check("recorder lists capture sources", ui.sources > 1, `${ui.sources} cards`);
  await fs.writeFile(join(outDir, "stage2-recorder.png"), await snapshot(win));

  const sources = await recorder.listSources();
  const display = sources.find((s) => s.kind === "display");
  // Same order as the recorder screen: get access first, then list devices. Chromium's
  // video-capture service lists cameras lazily, so retry briefly until one shows up.
  let devices: { kind: string; deviceId: string }[] = [];
  let videoError = "";
  for (let attempt = 0; attempt < 10; attempt++) {
    // Ask for video on its own so its error (if any) is visible, then list devices.
    videoError = await page<string>(
      "navigator.mediaDevices.getUserMedia({ video: true }).then(s => { s.getTracks().forEach(t => t.stop()); return ''; }, e => `${e.name}: ${e.message}`)",
    );
    devices = await page<{ kind: string; deviceId: string }[]>(
      "navigator.mediaDevices.getUserMedia({ audio: true }).then(s => s.getTracks().forEach(t => t.stop())).catch(() => {})" +
        ".then(() => navigator.mediaDevices.enumerateDevices()).then(d => d.map(x => ({ kind: x.kind, deviceId: x.deviceId })))",
    );
    if (devices.some((d) => d.kind === "videoinput") || process.argv.includes("--real-devices")) break;
    await wait(500);
  }
  const cam = devices.find((d) => d.kind === "videoinput")?.deviceId ?? null;
  const mic = devices.find((d) => d.kind === "audioinput" && d.deviceId !== "default" && d.deviceId !== "communications")?.deviceId ?? devices.find((d) => d.kind === "audioinput")?.deviceId ?? null;
  const real = process.argv.includes("--real-devices");
  if (!real) check("fake webcam + mic available", !!cam && !!mic, devices.map((d) => `${d.kind}:${d.deviceId.slice(0, 8) || "(no id)"}`).join(" ") + (videoError ? ` — video: ${videoError}` : ""));
  else check("devices found on this PC", true, `webcam: ${cam ? "yes" : "none"}, mic: ${mic ? "yes" : "none"}`);
  if (real && mic) {
    // Does the OS actually deliver microphone samples? (Hardware mute keys and
    // privacy switches can leave the track "live" but silent / empty.)
    const probe = await page<string>(`(async () => {
      const s = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: ${JSON.stringify(mic)} } } });
      const ctx = new AudioContext(); const src = ctx.createMediaStreamSource(s); const an = ctx.createAnalyser(); src.connect(an);
      const buf = new Float32Array(an.fftSize); let peak = 0;
      for (let i = 0; i < 15; i++) { await new Promise(r => setTimeout(r, 100)); an.getFloatTimeDomainData(buf); for (const v of buf) peak = Math.max(peak, Math.abs(v)); }
      const tr = s.getAudioTracks()[0]; const st = tr.getSettings();
      s.getTracks().forEach(t => t.stop()); await ctx.close();
      return 'peak ' + peak.toFixed(5) + ', muted ' + tr.muted + ', ' + (st.sampleRate || '?') + ' Hz, ' + (st.channelCount || '?') + ' ch';
    })()`).catch((e: unknown) => `error ${String(e)}`);
    check("microphone delivers audio (diagnostic)", !probe.startsWith("peak 0.00000"), probe);
  }
  check("global click/key hook loads", inputHookAvailable());
  if (!display) return check("a display to record", false);

  const settings: RecordingSettings = {
    ...DEFAULT_RECORDING_SETTINGS,
    screen: { kind: "display", sourceId: display.id, displayId: display.displayId ?? "", fps: 30 },
    webcam: { deviceId: cam, width: 1280, height: 720, fps: 30 },
    mic: { deviceId: mic },
    systemAudio: process.platform === "win32",
    countdownSec: 1,
    outputDir: join(app.getPath("temp"), `tdrec-smoke-takes-${process.pid}`),
  };
  await recorder.start(settings);
  await wait(3000);
  recorder.pause();
  await wait(1000);
  recorder.addMarker();
  recorder.resume();
  await wait(2000);
  const take = await recorder.stop();
  if (!take) return check("recording produced a take", false);
  const dir = recorder.lastTakeDir!;

  if (take.warnings?.length) check("inputs that could not be opened (warning only)", true, take.warnings.join(" · "));
  const failed = new Set((take.warnings ?? []).map((w) => w.split(":")[0]));
  const kinds = take.tracks.map((t) => t.kind).sort();
  const expected = ["screen", ...(cam ? ["webcam"] : []), ...(mic ? ["mic"] : []), ...(settings.systemAudio ? ["system"] : [])]
    .filter((k) => !failed.has(k))
    .sort();
  check("each input is its own file", JSON.stringify(kinds) === JSON.stringify(expected), kinds.join(", "));
  for (const t of take.tracks) {
    const head = await fs.readFile(join(dir, t.file)).then((b) => new Uint8Array(b.subarray(0, 65536)));
    const stat = await fs.stat(join(dir, t.file));
    const headerMs = readDurationMs(head);
    check(
      `${t.kind}: file written with duration`,
      stat.size > 1000 && headerMs !== null && Math.abs(headerMs - t.durationMs) < 5,
      `${t.file} ${(stat.size / 1024).toFixed(0)} KB, ${t.durationMs} ms, starts at +${t.startOffsetMs.toFixed(0)} ms, ${t.mimeType}${t.width ? `, ${t.width}x${t.height}` : ""}`,
    );
  }
  const starts = take.tracks.map((t) => t.startOffsetMs);
  const ends = take.tracks.map((t) => t.startOffsetMs + t.durationMs);
  check("tracks start together (< 500 ms apart)", Math.max(...starts) - Math.min(...starts) < 500, starts.map((s) => s.toFixed(0)).join(" / "));
  check("tracks end together (< 300 ms apart)", Math.max(...ends) - Math.min(...ends) < 300, ends.map((s) => s.toFixed(0)).join(" / "));
  check("pause removed from the timeline (~5 s, not 6 s)", take.durationMs > 4500 && take.durationMs < 5600, `${take.durationMs.toFixed(0)} ms`);
  check("pause and marker logged", take.pauses.length === 1 && take.markers.length === 1, `pause at ${take.pauses[0]?.atMs.toFixed(0)} ms`);

  const cursor = parseCursorJsonl(await fs.readFile(join(dir, take.cursorFile ?? "cursor.jsonl"), "utf8"));
  check("cursor metadata track written", cursor.samples.length >= 4 && cursor.sampleHz === 60, `${cursor.samples.length} samples, ${cursor.events.length} input events`);

  // Straight into the editor: four lanes with one clip each.
  await wait(4000);
  const editor = await page<{ clips: number; lanesWithClips: number }>(
    "({ clips: document.querySelectorAll('.clip').length, lanesWithClips: [...document.querySelectorAll('.lane')].filter(l => l.querySelector('.clip')).length })",
  );
  check("take opens in the editor, one lane per input", editor.lanesWithClips === take.tracks.length + (take.cursorFile ? 1 : 0), `${editor.clips} clips on ${editor.lanesWithClips} lanes`);
  await fs.writeFile(join(outDir, "stage2-editor.png"), await snapshot(win));
  await fs.writeFile(join(outDir, "stage2-take.json"), JSON.stringify(take, null, 2));

  // Stage 3: drive the real timeline on this take.
  const results = await page<{ name: string; ok: boolean; detail?: string }[]>(timelineScript);
  for (const r of results) check(`timeline: ${r.name}`, r.ok, r.detail);
  // Screenshots: fit the timeline, select a clip, English then Tibetan.
  await page("{ window.__tdrTest.runAction('view.fitTimeline'); window.__tdrTest.store.getState().setPlayhead(1800); const c = window.__tdrTest.store.getState().history.present.clips.find(c => c.content.type === 'text'); c && window.__tdrTest.store.getState().select([c.id]); } 0");
  await win.webContents.executeJavaScript("window.tdr.setLanguage('en')");
  await wait(1500);
  await fs.writeFile(join(outDir, "stage3-timeline-en.png"), await snapshot(win));
  await win.webContents.executeJavaScript("window.tdr.setLanguage('bo')");
  await wait(1500);
  await fs.writeFile(join(outDir, "stage3-timeline-bo.png"), await snapshot(win));

  // Stage 4: give the take a realistic cursor log (moves, a double-click, a later
  // click, a shortcut), re-open it (which runs auto-zoom suggestions), then test effects.
  await writeSyntheticCursor(join(dir, take.cursorFile ?? "cursor.jsonl"));
  await win.webContents.executeJavaScript("window.tdr.setLanguage('en')");
  win.webContents.send(REC.takeFinished, take, dir);
  await wait(2000);
  const effects = await page<{ name: string; ok: boolean; detail?: string }[]>(effectsScript);
  for (const r of effects) check(`effects: ${r.name}`, r.ok, r.detail);
  await fs.writeFile(join(outDir, "stage4-zoom-en.png"), await snapshot(win));
  // Focus editing: select the first zoom region.
  await page("{ const s = window.__tdrTest.store.getState(); const z = s.history.present.zooms[0]; z && s.selectZoom(z.id); } 0");
  await wait(1500);
  await fs.writeFile(join(outDir, "stage4-focus-en.png"), await snapshot(win));
  // Tibetan UI with the styling panels (nothing selected).
  await page("{ const s = window.__tdrTest.store.getState(); s.selectZoom(null); s.select([]); s.selectTrack(null); } 0");
  await win.webContents.executeJavaScript("window.tdr.setLanguage('bo')");
  await wait(1500);
  await fs.writeFile(join(outDir, "stage4-panels-bo.png"), await snapshot(win));

  await smokeTools(win, outDir, check, page, wait);
  await smokeExport(win, outDir, check, page, wait, dir);
  await smokeL10n(win, outDir, check, page, wait);
}

interface L10nScan {
  untranslated: { text: string; where: string; words: string }[];
  typography: { where: string; text: string; problems: string }[];
}

/**
 * Stage 7: walk every screen in the Tibetan UI, screenshot it, and list any
 * English left on screen and any Tibetan text with the wrong font, a line
 * height under 1.8, or clipped stacks.
 */
async function smokeL10n(win: BrowserWindow, outDir: string, check: Check, page: <T>(code: string) => Promise<T>, wait: (ms: number) => Promise<void>): Promise<void> {
  const shots = join(outDir, "l10n");
  await fs.rm(shots, { recursive: true, force: true });
  await fs.mkdir(shots, { recursive: true });
  await win.webContents.executeJavaScript("window.tdr.setLanguage('bo')");
  await wait(1200);
  const count = await page<number>(l10nScript);
  await page("window.__l10n.setup()");
  const names = await page<string[]>("window.__l10n.names");
  const report: Record<string, L10nScan> = {};
  for (let i = 0; i < count; i++) {
    const name = await page<string>(`window.__l10n.go(${i})`);
    await wait(500);
    await fs.writeFile(join(shots, `${String(i).padStart(2, "0")}-${name}.png`), await snapshot(win));
    report[name] = await page<L10nScan>("window.__l10n.scan()");
  }
  await fs.writeFile(join(outDir, "l10n-report.json"), JSON.stringify(report, null, 2));
  const untranslated = Object.entries(report).flatMap(([screen, r]) => r.untranslated.map((u) => `[${screen}] "${u.text}" (${u.words})`));
  const typography = Object.entries(report).flatMap(([screen, r]) => r.typography.map((u) => `[${screen}] ${u.where}: ${u.problems} — ${u.text}`));
  check(`l10n: ${names.length} screens checked in Tibetan`, names.length > 30);
  check("l10n: no English left in the Tibetan UI", untranslated.length === 0, `${untranslated.length}: ${[...new Set(untranslated)].slice(0, 12).join(" · ")}`);
  check("l10n: Tibetan text uses Noto Serif Tibetan, line height ≥ 1.8, nothing clipped", typography.length === 0, `${typography.length}: ${[...new Set(typography)].slice(0, 12).join(" · ")}`);
  await page("{ const s = window.__tdrTest.store.getState(); s.setView('editor'); s.setExportDialog(null); } 0");
  await win.webContents.executeJavaScript("window.tdr.setLanguage('en')");
}

/** Stage 6: export the edited take to every format and read the files back. */
async function smokeExport(win: BrowserWindow, outDir: string, check: Check, page: <T>(code: string) => Promise<T>, wait: (ms: number) => Promise<void>, takeDir: string): Promise<void> {
  const exportDir = join(takeDir, "exports");
  await fs.rm(exportDir, { recursive: true, force: true });
  await fs.mkdir(exportDir, { recursive: true });
  await win.webContents.executeJavaScript("window.tdr.setLanguage('en')");
  await wait(500);
  const started = Date.now();
  const results = await page<{ name: string; ok: boolean; detail?: string }[]>(exportScript.replaceAll('"__EXPORT_DIR__"', JSON.stringify(exportDir)));
  for (const r of results) check(`export: ${r.name}`, r.ok, r.detail);
  check("export: all exports finished in reasonable time", Date.now() - started < 20 * 60_000, `${((Date.now() - started) / 1000).toFixed(0)} s`);
  const files = await fs.readdir(exportDir);
  check("export: files on disk, no .part leftovers", files.length >= 8 && !files.some((f) => f.endsWith(".part")), files.join(", "));
  await fs.writeFile(join(outDir, "stage6-dialog-en.png"), await snapshot(win));
  await win.webContents.executeJavaScript("window.tdr.setLanguage('bo')");
  await wait(1200);
  await fs.writeFile(join(outDir, "stage6-dialog-bo.png"), await snapshot(win));
  await page("{ const s = window.__tdrTest.store.getState(); s.setExportDialog(null); s.setPanelTab('jobs'); } 0");
  await wait(1000);
  await fs.writeFile(join(outDir, "stage6-jobs-bo.png"), await snapshot(win));
  // Keep one exported frame as a picture for the report.
  await win.webContents.executeJavaScript("window.tdr.setLanguage('en')");
}

/** A stand-in for an OpenAI-compatible speech-to-text service (word timings in seconds). */
function startMockStt(): Promise<{ url: string; close: () => void; requests: () => number }> {
  let count = 0;
  const words = "Hello and welcome. Today we will learn the Tibetan alphabet, one letter at a time.".split(" ");
  const server = createServer((req, res) => {
    let body = 0;
    req.on("data", (chunk: Buffer) => (body += chunk.length));
    req.on("end", () => {
      count++;
      const ok = req.url === "/v1/audio/transcriptions" && req.method === "POST" && body > 1000;
      res.writeHead(ok ? 200 : 400, { "content-type": "application/json" });
      res.end(
        JSON.stringify(
          ok
            ? { language: "english", duration: 5, text: words.join(" "), words: words.map((w, i) => ({ word: w, start: 0.2 + i * 0.3, end: 0.45 + i * 0.3 })) }
            : { error: { message: `bad request ${req.method} ${req.url} (${body} bytes)` } },
        ),
      );
    });
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({ url: `http://127.0.0.1:${port}/v1`, close: () => server.close(), requests: () => count });
    }),
  );
}

/** Stage 5: Camtasia-class tools on the recorded take. */
async function smokeTools(win: BrowserWindow, outDir: string, check: Check, page: <T>(code: string) => Promise<T>, wait: (ms: number) => Promise<void>): Promise<void> {
  const stage5 = ["insert.callout", "insert.highlight", "insert.spotlight", "insert.blurRegion", "insert.stepNumber", "insert.keystrokes", "effects.greenScreen", "effects.transitions", "effects.titles", "effects.library", "audio.noiseRemoval", "audio.leveling", "audio.equalizer", "audio.compressor", "audio.captions", "export.subtitles", "export.queue"];
  const items = MENUS.flatMap((m) => m.items);
  const stillPending = stage5.filter((id) => items.find((i) => i.label === id)?.pending !== false && !items.find((i) => i.label === id)?.command);
  check("Stage 5 menu items are enabled", stillPending.length === 0, stillPending.join(", "));

  const stt = await startMockStt();
  await win.webContents.executeJavaScript("window.tdr.setLanguage('en')");
  await wait(800);
  const results = await page<{ name: string; ok: boolean; detail?: string }[]>(toolsScript.replaceAll("__MOCK_STT__", stt.url));
  for (const r of results) check(`tools: ${r.name}`, r.ok, r.detail);
  check("tools: speech service was called with the audio file", stt.requests() >= 1, `${stt.requests()} request(s)`);
  stt.close();

  // Screenshots: annotations (English), captions, quiz, titles + audio tools in Tibetan.
  await wait(800);
  await fs.writeFile(join(outDir, "stage5-annotations-en.png"), await snapshot(win));
  await page("{ const s = window.__tdrTest.store.getState(); s.setPanelTab('captions'); const c = s.history.present.clips.filter(c => c.content.type === 'caption').sort((a,b)=>a.startMs-b.startMs)[1]; c && s.setPlayhead(c.startMs + 300); s.select([]); } 0");
  await wait(1200);
  await fs.writeFile(join(outDir, "stage5-captions-en.png"), await snapshot(win));
  await page("{ const s = window.__tdrTest.store.getState(); s.setPanelTab('teaching'); const q = s.history.present.markers.find(m => m.kind === 'quiz'); q && s.setPlayhead(q.timeMs + q.quiz.showMs * 0.8); } 0");
  await wait(1200);
  await fs.writeFile(join(outDir, "stage5-quiz-en.png"), await snapshot(win));
  await win.webContents.executeJavaScript("window.tdr.setLanguage('bo')");
  await page(`{ const T = window.__tdrTest; const s = T.store.getState();
    s.edit('t', p => ({ ...p, clips: p.clips.map(c => c.content.type === 'title' ? { ...c, content: { ...c.content, title: 'སློབ་ཚན་དང་པོ། ཀ་ཁ་ག་ང་།', subtitle: 'བོད་ཀྱི་གསལ་བྱེད་སློབ་སྦྱོང་།', lang: 'bo' } } : c) }));
    const t = s.history.present.clips.find(c => c.content.type === 'title'); s.setPlayhead(t.startMs + 1500); s.setPanelTab('library'); s.select([]); } 0`);
  await wait(1500);
  await fs.writeFile(join(outDir, "stage5-titles-library-bo.png"), await snapshot(win));
  await page("{ const s = window.__tdrTest.store.getState(); const mic = s.history.present.tracks.find(t => t.kind === 'mic'); s.setPanelTab('properties'); s.select([]); s.selectTrack(mic.id); } 0");
  await wait(1200);
  await fs.writeFile(join(outDir, "stage5-audio-bo.png"), await snapshot(win));
  await page("{ const s = window.__tdrTest.store.getState(); s.setPanelTab('jobs'); s.selectTrack(null); } 0");
  await wait(1000);
  await fs.writeFile(join(outDir, "stage5-jobs-bo.png"), await snapshot(win));
  await win.webContents.executeJavaScript("window.tdr.setLanguage('en')");
}

/** A believable cursor log for the effects test (display-normalized coordinates). */
async function writeSyntheticCursor(path: string): Promise<void> {
  const text = await fs.readFile(path, "utf8");
  const header = JSON.parse(text.split("\n")[0]!) as Record<string, unknown>;
  header.space = { ...(header.space as object), coords: "display" };
  const lines = [JSON.stringify(header)];
  const path2: [number, number, number][] = [];
  for (let t = 0; t <= 4800; t += 50) {
    const k = Math.min(1, t / 1100);
    const x = t < 1100 ? 0.15 + 0.17 * k : t < 2800 ? 0.32 + (t - 1100) * 0.00002 : 0.35 + Math.min(1, (t - 2800) / 400) * 0.35;
    const y = t < 1100 ? 0.15 + 0.15 * k : t < 2800 ? 0.3 : 0.3 + Math.min(1, (t - 2800) / 400) * 0.32;
    path2.push([t, Math.round(x * 10000) / 10000, Math.round(y * 10000) / 10000]);
  }
  for (const s of path2) lines.push(JSON.stringify(s));
  lines.push(JSON.stringify({ t: 1200, type: "down", button: 1, clicks: 1, x: 0.32, y: 0.3 }));
  lines.push(JSON.stringify({ t: 1260, type: "up", button: 1, clicks: 1, x: 0.32, y: 0.3 }));
  lines.push(JSON.stringify({ t: 1450, type: "down", button: 1, clicks: 2, x: 0.322, y: 0.3 }));
  lines.push(JSON.stringify({ t: 1500, type: "up", button: 1, clicks: 2, x: 0.322, y: 0.3 }));
  lines.push(JSON.stringify({ t: 2300, type: "key", key: "S", mods: ["Ctrl"] }));
  lines.push(JSON.stringify({ t: 3300, type: "down", button: 1, clicks: 1, x: 0.7, y: 0.62 }));
  lines.push(JSON.stringify({ t: 3360, type: "up", button: 1, clicks: 1, x: 0.7, y: 0.62 }));
  await fs.writeFile(path, lines.join("\n") + "\n");
}

export async function runSmokeTest(win: BrowserWindow, hooks: Hooks): Promise<number> {
  // Packaged apps are read-only: write results to the user-data folder instead.
  const outDir = app.isPackaged ? join(hooks.userData, "test-results", "smoke") : join(app.getAppPath(), "test-results", "smoke");
  await fs.mkdir(outDir, { recursive: true });
  const checks: { name: string; ok: boolean; detail?: string }[] = [];
  const check = (name: string, ok: boolean, detail?: string) => checks.push({ name, ok, detail });
  const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
  const page = <T>(code: string) => win.webContents.executeJavaScript(code) as Promise<T>;
  const consoleErrors: string[] = [];
  win.webContents.on("console-message", (event) => {
    if (event.level === "error" || event.level === "warning") consoleErrors.push(`${event.level}: ${event.message}`);
  });

  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("renderer never became ready")), 30_000);
      ipcMain.once(IPC.rendererReady, () => {
        clearTimeout(timer);
        resolve();
      });
    });
    check("renderer ready", true);
    win.setSize(1440, 900);

    for (const language of ["bo", "en"] as const) {
      await hooks.setLanguage(language);
      await wait(1500);
      const state = await page<{ lang: string; title: string; menus: string[]; previewPixels: number; tibetanFont: boolean }>(
        "window.__tdrSmoke()",
      );
      check(`ui language ${language}`, state.lang === language, JSON.stringify(state.menus));
      check(`preview renders (${language})`, state.previewPixels > 1000, `${state.previewPixels} non-background pixels`);
      if (language === "bo") check("Noto Serif Tibetan loaded", state.tibetanFont);
      await fs.writeFile(join(outDir, `stage1-${language}.png`), await snapshot(win));
      // Open the File menu to show the translated dropdown.
      await page("document.querySelector('.menu-title')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))");
      await wait(300);
      const menuItems = await page<number>("document.querySelectorAll('.menu-dropdown .menu-item').length");
      check(`file menu opens (${language})`, menuItems > 5, `${menuItems} items`);
      await fs.writeFile(join(outDir, `stage1-${language}-menu.png`), await snapshot(win));
      await page("document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))");
    }

    // .tdrec round trip
    const project = createProject("Smoke test");
    project.markers.push({ id: "m1", timeMs: 1234, label: "བཀྲ་ཤིས་བདེ་ལེགས།", kind: "chapter" });
    const file = join(hooks.userData, "projects", "smoke.tdrec");
    await saveProject(file, project);
    const { project: reopened } = await loadProject(file);
    // Double-clicking a project in Explorer/Finder: main sends it to the window, which opens it.
    hooks.openProject(file);
    await wait(1500);
    const opened = await page<string>("window.__tdrTest.store.getState().history.present.name");
    check("double-clicked .tdrec opens in the editor", opened === "Smoke test", opened);
    check(
      ".tdrec save + reopen",
      reopened.id === project.id && reopened.markers[0]?.label === "བཀྲ་ཤིས་བདེ་ལེགས།" && reopened.tracks.length === 4,
    );

    // Crash recovery: an autosave plus a leftover lock means "offer recovery".
    await hooks.recovery.autosave(serializeProject(project));
    const info = await hooks.recovery.check();
    check("crash recovery detects autosave", info.available && info.projectName === "Smoke test");

    if (!process.argv.includes("--no-record")) await smokeRecording(win, hooks.recorder, outDir, check, page, wait);
    else if (process.argv.includes("--l10n")) await smokeL10n(win, outDir, check, page, wait);
  } catch (error) {
    check("smoke test ran", false, String(error));
  }

  const errors = consoleErrors.filter((m) => m.startsWith("error"));
  check("no renderer console errors", errors.length === 0, (errors.length ? errors : consoleErrors).slice(0, 3).join(" | ").slice(0, 600));
  const passed = checks.every((c) => c.ok);
  await fs.writeFile(join(outDir, "report.json"), JSON.stringify({ passed, checks }, null, 2));
  for (const c of checks) console.log(`${c.ok ? "PASS" : "FAIL"}  ${c.name}${c.detail ? `  — ${c.detail}` : ""}`);
  await hooks.recovery.end();
  return passed ? 0 : 1;
}
