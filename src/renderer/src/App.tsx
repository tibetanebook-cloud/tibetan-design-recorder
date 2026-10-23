import { useEffect, useState } from "react";
import type { MenuCommand, RecoveryInfo } from "@shared/ipc";
import { eventToShortcut } from "@shared/shortcuts";
import { parseProject } from "@shared/project/schema";
import { MenuBar } from "./components/MenuBar";
import { playback, Preview, previewCompositor } from "./components/Preview";
import { Recorder } from "./components/Recorder";
import { takeToProject } from "@shared/recording/takeToProject";
import { Timeline } from "./components/Timeline";
import { SidePanel } from "./components/SidePanels";
import { ShortcutsDialog } from "./components/ShortcutsDialog";
import { ExportDialog } from "./components/ExportDialog";
import { importMedia, runAction } from "./actions";
import { useShortcuts } from "./shortcuts";
import { cursorTrackFor, ensureProjectAssets, loadExtensions, sceneContext } from "./playback/assets";
import { buildScene } from "@shared/scene/buildScene";
import { useEditor } from "./store";
import * as tools from "./testTools";

const AUTOSAVE_MS = 30_000;

/** After a recording: wait (≤ 5 s) for its cursor track, then run auto-zoom suggestions once. */
async function suggestWhenCursorLoaded(): Promise<void> {
  const p = useEditor.getState().history.present;
  ensureProjectAssets(p);
  const cursorMedia = p.media.find((m) => m.kind === "cursor");
  if (!cursorMedia) return;
  for (let i = 0; i < 50 && !cursorTrackFor(cursorMedia.id); i++) await new Promise((r) => setTimeout(r, 100));
  if (cursorTrackFor(cursorMedia.id) && useEditor.getState().history.present.id === p.id) useEditor.getState().suggestZooms();
}

export function App() {
  const s = useEditor();
  const [recovery, setRecovery] = useState<RecoveryInfo>({ available: false });
  const [about, setAbout] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  const run = (command: MenuCommand) => {
    const st = useEditor.getState();
    switch (command) {
      case "file.newProject": return st.newProject();
      case "file.open": return void st.open();
      case "file.save": return void st.save();
      case "file.saveAs": return void st.save(true);
      case "file.quit": return void window.tdr.quit();
      case "edit.shortcuts": return setShortcutsOpen(true);
      case "record.new":
      case "record.deviceTest":
        return st.setView("recorder");
      case "record.start":
        st.setView("recorder");
        return void window.dispatchEvent(new Event("tdr:record-start"));
      case "record.pause": return void window.tdr.rec.pause();
      case "record.resume": return void window.tdr.rec.resume();
      case "record.stop": return void window.tdr.rec.stop();
      case "view.recorder": return st.setView("recorder");
      case "view.editor": return st.setView("editor");
      case "language.en": return void window.tdr.setLanguage("en");
      case "language.bo": return void window.tdr.setLanguage("bo");
      case "help.about": return setAbout(true);
      default:
        return runAction(command, (id) => {
          window.tdr.sendMenuCommand(id as MenuCommand);
          return true;
        });
    }
  };

  // Settings, language events, native-menu commands, recovery, smoke hook.
  useEffect(() => {
    void window.tdr.getSettings().then((settings) => {
      s.setLanguage(settings.language);
      useShortcuts.getState().load(settings.shortcuts);
    });
    void window.tdr.checkRecovery().then(setRecovery);
    const offLang = window.tdr.onLanguage((lang) => useEditor.getState().setLanguage(lang));
    const offMenu = window.tdr.onMenuCommand(run);
    const offOpen = window.tdr.onOpenProjectRequest((path) => void useEditor.getState().openPath(path));
    // Straight from recording into the editor: every file on its own lane.
    const offTake = window.tdr.rec.onTakeFinished((take, dir) => {
      const st = useEditor.getState();
      st.load(takeToProject(take, dir));
      st.setView("editor");
      // Not saved to a .tdrec yet: autosave it right away so a crash can't lose it.
      useEditor.setState({ saveState: "unsaved" });
      void useEditor.getState().autosave();
      // Suggest zooms from the clicks of this take (shown as ghosts to accept or reject).
      void suggestWhenCursorLoaded();
    });
    void loadExtensions();
    window.__tdrSmoke = () => ({
      lang: document.documentElement.lang,
      title: document.title,
      menus: Array.from(document.querySelectorAll(".menu-title")).map((el) => el.textContent),
      previewPixels: previewCompositor.current?.countPixelsNear("#e8c56a") ?? 0,
      tibetanFont: document.fonts.check('16px "Noto Serif Tibetan"', "བོད"),
    });
    // Test hooks for the automated smoke test (no effect on normal use).
    window.__tdrTest = { store: useEditor, runAction, importMedia, shortcuts: useShortcuts, playback, scene: (t: number) => buildScene(useEditor.getState().history.present, t, sceneContext()), tools, compositor: previewCompositor, command: run };
    // Bright green = Chromium's fake camera/screen test pattern (smoke test only).
    (window as unknown as { __tdrTestPixels: () => number }).__tdrTestPixels = () => previewCompositor.current?.countPixelsNear("#20ff20", 90) ?? 0;
    window.tdr.ready();
    return () => {
      offLang();
      offMenu();
      offOpen();
      offTake();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Editor shortcuts (customizable). Ignored while typing in a field or capturing a new shortcut.
  useEffect(() => {
    const isMac = window.tdr.platform === "darwin";
    const onKey = (e: KeyboardEvent) => {
      const target = e.target;
      if (target instanceof Element && target.closest("input, textarea, select, [contenteditable=true], [data-shortcuts-dialog]")) return;
      const key = eventToShortcut(e, isMac);
      if (!key) return;
      const map = useShortcuts.getState().map;
      const id = Object.keys(map).find((a) => map[a] === key);
      if (!id) return;
      // On macOS the native menu already handles its own accelerators.
      if (isMac && id.startsWith("file.")) return;
      e.preventDefault();
      run(id as MenuCommand);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Language drives <html lang>, which switches fonts and line-height in CSS.
  useEffect(() => {
    document.documentElement.lang = s.language;
    document.title = s.t("app.name");
  }, [s.language, s]);

  useEffect(() => {
    const timer = setInterval(() => void useEditor.getState().autosave(), AUTOSAVE_MS);
    return () => clearInterval(timer);
  }, []);

  const project = s.history.present;
  const restore = async (yes: boolean) => {
    if (yes && recovery.json) s.load(parseProject(JSON.parse(recovery.json)));
    await window.tdr.resolveRecovery(yes);
    setRecovery({ available: false });
  };

  return (
    <div className="app">
      <MenuBar onCommand={run} />
      <div className="workspace">
        <aside className="sidebar">
          <button className={`nav ${s.view === "recorder" ? "active" : ""}`} onClick={() => s.setView("recorder")}>
            <span className="nav-dot rec" /> {s.t("view.recorder")}
          </button>
          <button className={`nav ${s.view === "editor" ? "active" : ""}`} onClick={() => s.setView("editor")}>
            <span className="nav-dot" /> {s.t("view.editor")}
          </button>
        </aside>
        <main className="main">
          {s.view === "editor" ? (
            <div className="editor">
              <Preview />
              <SidePanel />
            </div>
          ) : (
            <Recorder />
          )}
          {s.view === "editor" && <Timeline />}
        </main>
      </div>
      <footer className="statusbar">
        <span className={`status ${s.saveState}`}>{s.t(s.saveState === "error" ? "status.error" : `status.${s.saveState}`)}</span>
        <span className="project-name" data-l10n-skip lang={/[ༀ-࿿]/.test(project.name) ? "bo" : "en"}>{project.name}{s.projectPath ? ` — ${s.projectPath}` : ""}</span>
        <span className="history" lang="en">
          <button disabled={!s.canUndo()} onClick={s.undo} title={s.t("edit.undo")}>↶</button>
          <button disabled={!s.canRedo()} onClick={s.redo} title={s.t("edit.redo")}>↷</button>
        </span>
      </footer>

      {recovery.available && (
        <div className="modal-backdrop">
          <div className="modal" role="dialog" aria-labelledby="recovery-title">
            <h2 id="recovery-title">{s.t("recovery.title")}</h2>
            <p>{s.t("recovery.message")}</p>
            <p className="muted">{recovery.projectName} · <span lang="en">{recovery.autosavedAt && new Date(recovery.autosavedAt).toLocaleString()}</span></p>
            <div className="modal-actions">
              <button onClick={() => void restore(false)}>{s.t("recovery.discard")}</button>
              <button className="primary" onClick={() => void restore(true)}>{s.t("recovery.restore")}</button>
            </div>
          </div>
        </div>
      )}
      {shortcutsOpen && <ShortcutsDialog onClose={() => setShortcutsOpen(false)} />}
      {s.exportDialog && <ExportDialog mode={s.exportDialog} onClose={() => s.setExportDialog(null)} />}
      {about && (
        <div className="modal-backdrop" onClick={() => setAbout(false)}>
          <div className="modal">
            <h2>{s.t("app.name")}</h2>
            <p>{s.t("app.tagline")}</p>
            <p className="muted">{s.t("app.version")} <span lang="en">0.1.0</span></p>
            <div className="modal-actions"><button className="primary">{s.t("inspector.ok")}</button></div>
          </div>
        </div>
      )}
    </div>
  );
}
