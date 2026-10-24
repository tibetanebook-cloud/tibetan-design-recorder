import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, shell, type MenuItemConstructorOptions } from "electron";
import { promises as fs } from "node:fs";
import { isAbsolute, join } from "node:path";
import { isLanguage, translate, type Language } from "@shared/i18n";
import { IPC, type MenuCommand, type OpenResult, type SaveResult } from "@shared/ipc";
import { MENUS } from "@shared/menu";
import { parseProject } from "@shared/project/schema";
import { projectArg } from "@shared/project/launchArgs";
import { REC } from "@shared/recording/ipc";
import { loadAllExtensions } from "./extensions";
import { handleMediaProtocol, registerMediaScheme } from "./media-protocol";
import { loadProject, saveProject, SessionRecovery } from "./project-io";
import { RecordingController } from "./recording/controller";
import { SettingsStore } from "./settings";
import { TranscribeService } from "./transcribe";
import { hardenWebContents, WritePolicy } from "./security";
import { migrateUserData } from "./migrate";
import { Library } from "./library";
import { closeAllExports, exportClose, exportOpen, exportWrite } from "./exportFiles";
import { runSmokeTest } from "./smoke";

const SMOKE = process.argv.includes("--smoke-test");
if (SMOKE) app.setPath("userData", join(app.getPath("temp"), `tdrec-smoke-${process.pid}`));
/** Folder name under Videos for recordings and exports. */
const PRODUCT_FOLDER = "Nangchen T. Studio Screen Recorder";
// Renamed in v0.2.0: bring the user's settings, library and extensions along.
if (!SMOKE) {
  const moved = migrateUserData(app.getPath("appData"), app.getPath("userData"));
  if (moved.length) console.log("Moved user data from the old app name:", moved.join(", "));
}

/** Project to open once the window is ready. */
let pendingOpen: string | undefined = projectArg(process.argv);
let rendererIsReady = false;
hardenWebContents();
/** Files/folders the renderer may write (chosen by the user in dialogs, or the app's own folders). */
const writes = new WritePolicy();
const isProjectPath = (p: unknown): p is string => typeof p === "string" && /\.tdrec$/i.test(p) && isAbsolute(p);
// One app at a time: a second launch (e.g. double-clicking another project) hands
// its project to the window that is already open, then exits.
if (!SMOKE && !app.requestSingleInstanceLock()) app.exit(0);
const openInWindow = (path: string) => {
  if (!mainWindow || !rendererIsReady) {
    pendingOpen = path;
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
  mainWindow.webContents.send(IPC.projectOpenRequest, path);
};
app.on("second-instance", (_e, argv) => {
  const path = projectArg(argv);
  if (path) openInWindow(path);
  else if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});
// macOS delivers double-clicked files as an event (also before the app is ready).
app.on("open-file", (event, path) => {
  event.preventDefault();
  openInWindow(path);
});
registerMediaScheme();
if (SMOKE && !process.argv.includes("--real-devices")) {
  // Deterministic inputs for the automated test (this also replaces the screen with a
  // test pattern). Chromium only reliably honours these when they are real command-line
  // switches, so `npm run smoke` passes them too; appending here is a fallback.
  app.commandLine.appendSwitch("use-fake-device-for-media-stream");
  app.commandLine.appendSwitch("use-fake-ui-for-media-stream");
}

const PRELOAD = join(__dirname, "../preload/index.js");

/** Load the renderer bundle in a window; `view` selects hud/bubble/region/capture. */
function loadPage(win: BrowserWindow, view = ""): void {
  const query = view ? `?view=${view}` : "";
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL + query);
  else void win.loadFile(join(__dirname, "../renderer/index.html"), { search: query.slice(1) });
}

let recorder: RecordingController;

const isMac = process.platform === "darwin";
/** UI language text for native dialogs (file-type names, titles). */
const tr = (key: string) => translate(settings?.get().language ?? "bo", key);
const projectFilter = () => [{ name: tr("app.name"), extensions: ["tdrec"] }];
const BRAND_BG = "#14151c";

let mainWindow: BrowserWindow | null = null;
let settings: SettingsStore;
let transcriber: TranscribeService;
let recovery: SessionRecovery;

const iconPath = (): string => join(app.isPackaged ? process.resourcesPath : app.getAppPath(), "resources", "icon.png");

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    backgroundColor: BRAND_BG,
    title: translate(settings.get().language, "app.name"),
    icon: iconPath(),
    // Windows/Linux draw the translated menu bar inside the page (Tibetan font);
    // the OS still draws the minimize/maximize/close buttons.
    titleBarStyle: isMac ? "hiddenInset" : "hidden",
    ...(isMac ? {} : { titleBarOverlay: { color: BRAND_BG, symbolColor: "#e8dcc0", height: 40 } }),
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      // The automated test's hooks exist only in test runs.
      additionalArguments: SMOKE ? ["--tdr-test-hooks"] : [],
      // Keep the device meters and webcam preview live while the window is covered.
      backgroundThrottling: false,
    },
  });
  win.once("ready-to-show", () => {
    if (!SMOKE) win.show();
  });
  loadPage(win);
  return win;
}

/** Native menu, macOS only (Windows/Linux use the in-page menu bar). */
function buildNativeMenu(language: Language): void {
  if (!isMac) {
    Menu.setApplicationMenu(null);
    return;
  }
  const t = (key: string) => translate(language, key);
  const send = (command: MenuCommand) => () => mainWindow?.webContents.send(IPC.menuCommand, command);
  const template: MenuItemConstructorOptions[] = [
    { label: t("app.name"), submenu: [{ role: "about" }, { type: "separator" }, { role: "quit", label: t("file.quit") }] },
    ...MENUS.map<MenuItemConstructorOptions>((menu) => ({
      label: t(menu.label),
      submenu: menu.items.flatMap<MenuItemConstructorOptions>((item) => [
        ...(item.separatorBefore ? [{ type: "separator" as const }] : []),
        {
          label: t(item.label),
          enabled: !item.pending,
          accelerator: item.accelerator,
          click: item.command ? send(item.command) : undefined,
        },
      ]),
    })),
    {
      label: t("menu.language"),
      submenu: (["en", "bo"] as const).map((lang) => ({
        label: t(lang === "en" ? "language.english" : "language.tibetan"),
        type: "radio" as const,
        checked: language === lang,
        click: () => void setLanguage(lang),
      })),
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function setLanguage(language: Language): Promise<void> {
  await settings.update({ language });
  buildNativeMenu(language);
  mainWindow?.setTitle(translate(language, "app.name"));
  mainWindow?.webContents.send(IPC.settingsSetLanguage, language);
}

function registerIpc(): void {
  ipcMain.on(IPC.rendererReady, () => {
    rendererIsReady = true;
    const path = pendingOpen;
    pendingOpen = undefined;
    if (path) openInWindow(path);
  });
  ipcMain.handle(IPC.settingsGet, () => settings.get());
  ipcMain.handle(IPC.settingsSetShortcuts, (_e, shortcuts: unknown) => {
    // Only a flat map of action id -> key name (or null); nothing else is stored.
    if (!shortcuts || typeof shortcuts !== "object" || Array.isArray(shortcuts)) throw new Error("bad shortcuts");
    const clean: Record<string, string | null> = {};
    for (const [k, v] of Object.entries(shortcuts as Record<string, unknown>).slice(0, 300))
      if (/^[a-zA-Z0-9.]{1,64}$/.test(k) && (v === null || (typeof v === "string" && v.length <= 64))) clean[k] = v as string | null;
    return settings.update({ shortcuts: clean });
  });
  ipcMain.handle(IPC.mediaImport, async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ["openFile", "multiSelections"],
      title: tr("file.import"),
      filters: [
        { name: tr("dialog.media"), extensions: ["mp4", "webm", "mov", "mkv", "m4v", "mp3", "wav", "m4a", "aac", "ogg", "opus", "flac", "png", "jpg", "jpeg", "webp", "gif"] },
      ],
    });
    return result.canceled ? [] : result.filePaths;
  });
  ipcMain.handle(IPC.pickImage, async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ["openFile"],
      title: tr("insert.image"),
      filters: [{ name: tr("dialog.images"), extensions: ["png", "jpg", "jpeg", "webp", "gif"] }],
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });
  const extensionsDir = () => join(app.getPath("userData"), "extensions");
  const bundledExtensionsDir = () => join(app.isPackaged ? process.resourcesPath : app.getAppPath(), "resources", "extensions");
  ipcMain.handle(IPC.extensionsList, () => loadAllExtensions(bundledExtensionsDir(), extensionsDir()));
  ipcMain.handle(IPC.extensionsOpenFolder, async () => {
    await fs.mkdir(extensionsDir(), { recursive: true });
    await shell.openPath(extensionsDir());
  });
  ipcMain.handle(IPC.textOpen, async (_e, name: string, extensions: string[]) => {
    const result = await dialog.showOpenDialog(mainWindow!, { properties: ["openFile"], filters: [{ name, extensions }] });
    const path = result.canceled ? undefined : result.filePaths[0];
    return path ? { path, text: await fs.readFile(path, "utf8") } : null;
  });
  ipcMain.handle(IPC.textSave, async (_e, defaultName: string, extensions: string[], text: string) => {
    const result = await dialog.showSaveDialog(mainWindow!, { defaultPath: defaultName, filters: [{ name: extensions.join(", ").toUpperCase(), extensions }] });
    if (result.canceled || !result.filePath) return null;
    // UTF-8 with BOM: some players need it to show Tibetan subtitles correctly.
    await fs.writeFile(result.filePath, (/\.(srt|vtt)$/i.test(result.filePath) ? "\uFEFF" : "") + text, "utf8");
    return result.filePath;
  });
  const library = new Library(join(app.isPackaged ? process.resourcesPath : app.getAppPath(), "resources"), app.getPath("userData"));
  ipcMain.handle(IPC.libraryList, () => library.list());
  const exportDir = () => join(app.getPath("videos"), PRODUCT_FOLDER, "Exports");
  writes.allowDir(exportDir());
  ipcMain.handle(IPC.exportDefaultDir, async () => {
    await fs.mkdir(exportDir(), { recursive: true });
    return exportDir();
  });
  ipcMain.handle(IPC.exportPickPath, async (_e, defaultName: string, extension: string) => {
    await fs.mkdir(exportDir(), { recursive: true });
    const r = await dialog.showSaveDialog(mainWindow!, { title: tr("export.title"), defaultPath: join(exportDir(), `${defaultName}.${extension}`), filters: [{ name: extension.toUpperCase(), extensions: [extension] }] });
    if (r.canceled || !r.filePath) return null;
    writes.allowFile(r.filePath);
    return r.filePath;
  });
  ipcMain.handle(IPC.exportPickFolder, async () => {
    await fs.mkdir(exportDir(), { recursive: true });
    const r = await dialog.showOpenDialog(mainWindow!, { title: tr("export.chooseFolder"), defaultPath: exportDir(), properties: ["openDirectory", "createDirectory"] });
    const dir = r.canceled ? null : (r.filePaths[0] ?? null);
    if (dir) writes.allowDir(dir);
    return dir;
  });
  ipcMain.handle(IPC.exportPickProjects, async () => {
    const r = await dialog.showOpenDialog(mainWindow!, { title: tr("export.batch"), properties: ["openFile", "multiSelections"], filters: projectFilter() });
    return r.canceled ? [] : r.filePaths;
  });
  ipcMain.handle(IPC.exportOpen, (_e, path: unknown) => {
    // Only where the user chose to save (or the app's export folder).
    if (typeof path !== "string" || !(writes.canWrite(path) || writes.canWriteSidecar(path))) throw new Error("export path not allowed");
    return exportOpen(path);
  });
  ipcMain.handle(IPC.exportWrite, (_e, id: number, position: number, data: Uint8Array) => exportWrite(id, position, data));
  ipcMain.handle(IPC.exportClose, (_e, id: number, ok: boolean) => exportClose(id, ok));
  ipcMain.handle(IPC.exportReveal, (_e, path: unknown) => {
    if (typeof path === "string" && writes.canWrite(path)) shell.showItemInFolder(path);
  });
  app.on("before-quit", () => void closeAllExports());
  ipcMain.handle(IPC.librarySave, (_e, items: Parameters<Library["saveUser"]>[0]) => library.saveUser(items));
  ipcMain.handle(IPC.transcribeConfig, () => transcriber.config());
  ipcMain.handle(IPC.transcribeSetConfig, (_e, patch: { baseUrl?: string; model?: string; key?: string }) => transcriber.setConfig(patch));
  ipcMain.handle(IPC.transcribeRun, (_e, req: { path: string; language: string }) => transcriber.run(req));
  ipcMain.handle(IPC.settingsSetLanguage, (_e, language: unknown) => {
    if (!isLanguage(language)) throw new Error("Unknown language");
    return setLanguage(language);
  });

  const writeTo = async (path: string, json: string): Promise<SaveResult> => {
    // Projects are only ever written as .tdrec files.
    if (!isProjectPath(path)) return { ok: false, error: "not a .tdrec path" };
    try {
      await saveProject(path, parseProject(JSON.parse(json)));
      await settings.addRecent(path);
      return { ok: true, path };
    } catch (error) {
      return { ok: false, error: String(error) };
    }
  };
  const askSavePath = async (name: string): Promise<string | undefined> => {
    const result = await dialog.showSaveDialog(mainWindow!, {
      defaultPath: `${name || "Untitled"}.tdrec`,
      title: tr("file.saveAs"),
      filters: projectFilter(),
    });
    return result.canceled ? undefined : result.filePath;
  };

  ipcMain.handle(IPC.projectSave, async (_e, json: string, path?: string): Promise<SaveResult> => {
    const target = path ?? (await askSavePath(parseProject(JSON.parse(json)).name));
    return target ? writeTo(target, json) : { ok: false };
  });
  ipcMain.handle(IPC.projectSaveAs, async (_e, json: string): Promise<SaveResult> => {
    const target = await askSavePath(parseProject(JSON.parse(json)).name);
    return target ? writeTo(target, json) : { ok: false };
  });
  const openPath = async (path: string): Promise<OpenResult> => {
    if (!isProjectPath(path)) return { ok: false, path: String(path), error: "not a .tdrec file" };
    try {
      const { json } = await loadProject(path);
      await settings.addRecent(path);
      return { ok: true, path, json };
    } catch (error) {
      return { ok: false, path, error: String(error) };
    }
  };
  ipcMain.handle(IPC.projectOpen, async (): Promise<OpenResult> => {
    const result = await dialog.showOpenDialog(mainWindow!, { title: tr("file.open"), properties: ["openFile"], filters: projectFilter() });
    const path = result.filePaths[0];
    return result.canceled || !path ? { ok: false } : openPath(path);
  });
  ipcMain.handle(IPC.projectOpenPath, (_e, path: string) => openPath(path));
  ipcMain.handle(IPC.projectAutosave, (_e, json: string) => recovery.autosave(json));
  ipcMain.handle(IPC.projectRecoveryCheck, () => pendingRecovery);
  ipcMain.handle(IPC.projectRecoveryResolve, async (_e, restore: boolean) => {
    if (!restore) await recovery.discard();
    pendingRecovery = { available: false };
  });
  ipcMain.handle(IPC.appQuit, () => app.quit());
  ipcMain.on(IPC.menuCommand, (_e, command: MenuCommand) => {
    if (command === "view.fullScreen") mainWindow?.setFullScreen(!mainWindow.isFullScreen());
  });
}

let pendingRecovery: Awaited<ReturnType<SessionRecovery["check"]>> = { available: false };

void app.whenReady().then(async () => {
  nativeTheme.themeSource = "dark";
  const userData = app.getPath("userData");
  settings = new SettingsStore(userData);
  recovery = new SessionRecovery(userData);
  await settings.load();
  transcriber = new TranscribeService(userData);
  await transcriber.load();
  pendingRecovery = await recovery.check();
  await recovery.begin();

  registerIpc();
  handleMediaProtocol();
  recorder = new RecordingController(() => mainWindow, loadPage, PRELOAD, join(app.getPath("videos"), PRODUCT_FOLDER));
  recorder.register((take) => {
    const dir = recorder.lastTakeDir;
    if (dir) mainWindow?.webContents.send(REC.takeFinished, take, dir);
  });
  const hotkeysFailed = recorder.registerHotkeys(() => mainWindow?.webContents.send(REC.hotkeyStart));
  if (hotkeysFailed.length) console.warn("Hotkeys already in use by another app:", hotkeysFailed.join(", "));
  buildNativeMenu(settings.get().language);
  mainWindow = createWindow();

  if (SMOKE) {
    const code = await runSmokeTest(mainWindow, { setLanguage, recovery, userData, recorder, openProject: openInWindow, allowWriteDir: (d) => writes.allowDir(d) });
    app.exit(code);
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow();
  });
});

app.on("window-all-closed", () => {
  if (!isMac) app.quit();
});

// A clean exit removes the session lock, so no recovery prompt next time.
let cleaned = false;
app.on("before-quit", (event) => {
  if (cleaned || !recovery) return;
  event.preventDefault();
  void recovery.end().finally(() => {
    cleaned = true;
    app.quit();
  });
});
