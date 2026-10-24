/**
 * Recording controller (main process).
 *
 * Windows involved:
 *  - capture: hidden window that owns the MediaStreams and one MediaRecorder per
 *    input; it streams each recorder's chunks here, and they go to separate files.
 *  - hud: small always-on-top bar (countdown, timer, pause, stop), excluded from
 *    the screen capture.
 *  - bubble: draggable round webcam preview, also excluded from capture.
 *  - region: full-screen overlay to drag out a recording region.
 *
 * The take clock lives here. Every recorder reports the wall time of its start
 * event; the difference to the take start becomes that file's startOffsetMs.
 */
import { app, BrowserWindow, desktopCapturer, globalShortcut, ipcMain, screen, session } from "electron";
import { join } from "node:path";
import { RecordingClock, wallNow } from "@shared/recording/clock";
import { REC, type CaptureBeginPayload, type CaptureDonePayload, type TrackStartedPayload } from "@shared/recording/ipc";
import {
  RECORDING_HOTKEYS,
  type CaptureSource,
  type DisplayInfo,
  type RecorderStatus,
  type RecordingSettings,
  type TakeManifest,
  type TrackFileKind,
} from "@shared/recording/types";
import type { Rect } from "@shared/project/schema";
import { CursorRecorder } from "./cursor-recorder";
import { TakeWriter } from "./take-writer";
import { restrictPermissions } from "../security";

type LoadPage = (win: BrowserWindow, view: string) => void;

const CURSOR_FILE = "cursor.jsonl";

export class RecordingController {
  private status: RecorderStatus = { phase: "idle", elapsedMs: 0 };
  private clock = new RecordingClock();
  private writer: TakeWriter | null = null;
  private cursor: CursorRecorder | null = null;
  private settings: RecordingSettings | null = null;
  private display: DisplayInfo | null = null;
  private captureWin: BrowserWindow | null = null;

  /** Recording data is accepted only from the hidden capture window. */
  private fromCapture(e: Electron.IpcMainEvent): boolean {
    return !!this.captureWin && !this.captureWin.isDestroyed() && e.sender === this.captureWin.webContents;
  }
  private hudWin: BrowserWindow | null = null;
  private bubbleWin: BrowserWindow | null = null;
  private tick: NodeJS.Timeout | null = null;
  private pendingScreenSource: string | null = null;
  private wantLoopback = false;
  private captureDone: ((p: CaptureDonePayload) => void) | null = null;
  private onFinished: ((take: TakeManifest) => void) | null = null;
  private markers: number[] = [];
  /** Folder of the most recently finished take. */
  lastTakeDir: string | null = null;

  constructor(
    private readonly mainWindow: () => BrowserWindow | null,
    private readonly loadPage: LoadPage,
    private readonly preload: string,
    private readonly defaultOutputDir: string,
  ) {}

  register(onFinished: (take: TakeManifest) => void): void {
    this.onFinished = onFinished;
    ipcMain.handle(REC.listSources, () => this.listSources());
    ipcMain.handle(REC.listDisplays, () => this.listDisplays());
    ipcMain.handle(REC.selectRegion, (_e, displayId: string) => this.selectRegion(displayId));
    ipcMain.handle(REC.start, (_e, settings: RecordingSettings) => this.start(settings));
    ipcMain.handle(REC.pause, () => this.pause());
    ipcMain.handle(REC.resume, () => this.resume());
    ipcMain.handle(REC.stop, () => this.stop());
    ipcMain.handle(REC.cancel, () => this.cancel());
    ipcMain.handle(REC.marker, () => this.addMarker());
    ipcMain.handle(REC.status, () => this.status);
    ipcMain.handle(REC.showBubble, (_e, deviceId: string | null) => this.showBubble(deviceId));

    ipcMain.on(REC.trackStarted, (e, p: TrackStartedPayload) => {
      if (!this.fromCapture(e) || !this.writer) return;
      const size = p.width && p.height ? { width: p.width, height: p.height } : undefined;
      this.writer.setStart(p.kind, Math.max(0, this.clock.toRecording(p.wallMs)), size);
    });
    ipcMain.on(REC.chunk, (e, kind: TrackFileKind, data: Uint8Array) => {
      if (!this.fromCapture(e)) return;
      void this.writer?.write(kind, data).catch((err) => this.fail(String(err)));
    });
    ipcMain.on(REC.captureDone, (e, p: CaptureDonePayload) => this.fromCapture(e) && this.captureDone?.(p));
    ipcMain.on(REC.captureError, (e, message: string) => this.fromCapture(e) && this.fail(String(message).slice(0, 500)));
    ipcMain.on(REC.captureWarning, (e, raw: string) => {
      if (!this.fromCapture(e)) return;
      const message = String(raw).slice(0, 500);
      console.warn("Recording warning:", message);
      this.setStatus({ warnings: [...(this.status.warnings ?? []), message] });
    });

    // All our windows share the default session, so camera/mic device IDs chosen
    // in the setup screen are valid in the capture window too.
    restrictPermissions(session.defaultSession);
    // getDisplayMedia() requests:
    //  - from the capture window: the source the user picked (+ Windows loopback audio);
    //  - from the setup screen: Windows loopback for the system-audio meter (the page
    //    stops the accompanying screen track immediately).
    session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
      const fromCapture = !!this.captureWin && request.frame?.top?.processId === this.captureWin.webContents.getOSProcessId();
      void desktopCapturer.getSources({ types: ["screen", "window"], thumbnailSize: { width: 0, height: 0 } }).then((sources) => {
        if (fromCapture) {
          const source = sources.find((s) => s.id === this.pendingScreenSource);
          if (!source) return callback({});
          return callback(this.wantLoopback ? { video: source, audio: "loopback" } : { video: source });
        }
        if (process.platform !== "win32") return callback({});
        const first = sources.find((s) => s.id.startsWith("screen"));
        callback(first ? { video: first, audio: "loopback" } : {});
      });
    });
  }

  // ---------- sources ----------

  listDisplays(): DisplayInfo[] {
    return screen.getAllDisplays().map((d) => ({ id: String(d.id), bounds: d.bounds, scaleFactor: d.scaleFactor }));
  }

  async listSources(): Promise<CaptureSource[]> {
    const sources = await desktopCapturer.getSources({
      types: ["screen", "window"],
      thumbnailSize: { width: 320, height: 180 },
      fetchWindowIcons: false,
    });
    const own = new Set(BrowserWindow.getAllWindows().map((w) => w.getMediaSourceId()));
    return sources
      .filter((s) => !own.has(s.id))
      .map((s) => ({
        id: s.id,
        kind: s.id.startsWith("screen") ? "display" : "window",
        name: s.name,
        thumbnail: s.thumbnail.toDataURL(),
        displayId: s.display_id || undefined,
      }));
  }

  /** Full-screen overlay on the display; resolves with a DIP rect relative to it. */
  selectRegion(displayId: string): Promise<Rect | null> {
    const display = screen.getAllDisplays().find((d) => String(d.id) === displayId) ?? screen.getPrimaryDisplay();
    const win = new BrowserWindow({
      ...display.bounds,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      movable: false,
      hasShadow: false,
      fullscreenable: false,
      webPreferences: { preload: this.preload, sandbox: true, contextIsolation: true },
    });
    win.setAlwaysOnTop(true, "screen-saver");
    this.loadPage(win, "region");
    return new Promise((resolve) => {
      const done = (_e: unknown, rect: Rect | null) => {
        ipcMain.removeListener(REC.regionChosen, done);
        if (!win.isDestroyed()) win.close();
        resolve(rect && rect.width >= 16 && rect.height >= 16 ? rect : null);
      };
      ipcMain.on(REC.regionChosen, done);
      win.on("closed", () => done(null, null));
    });
  }

  // ---------- floating windows ----------

  private floating(opts: Electron.BrowserWindowConstructorOptions, view: string): BrowserWindow {
    const win = new BrowserWindow({
      frame: false,
      transparent: true,
      resizable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      hasShadow: false,
      fullscreenable: false,
      show: false,
      ...opts,
      webPreferences: { preload: this.preload, sandbox: true, contextIsolation: true, backgroundThrottling: false },
    });
    win.setAlwaysOnTop(true, "floating");
    // Keep our own UI out of the screen recording (Windows 10 2004+ / macOS).
    win.setContentProtection(true);
    win.once("ready-to-show", () => win.showInactive());
    this.loadPage(win, view);
    return win;
  }

  showBubble(deviceId: string | null): void {
    if (!deviceId) {
      this.bubbleWin?.close();
      this.bubbleWin = null;
      return;
    }
    const wa = screen.getPrimaryDisplay().workArea;
    const size = 220;
    if (!this.bubbleWin || this.bubbleWin.isDestroyed()) {
      this.bubbleWin = this.floating({ width: size, height: size, x: wa.x + wa.width - size - 32, y: wa.y + wa.height - size - 32, movable: true }, `bubble&device=${encodeURIComponent(deviceId)}`);
      this.bubbleWin.on("closed", () => (this.bubbleWin = null));
    } else {
      this.loadPage(this.bubbleWin, `bubble&device=${encodeURIComponent(deviceId)}`);
    }
  }

  private showHud(): void {
    if (this.hudWin && !this.hudWin.isDestroyed()) return;
    const wa = screen.getPrimaryDisplay().workArea;
    const width = 300;
    this.hudWin = this.floating({ width, height: 56, x: Math.round(wa.x + (wa.width - width) / 2), y: wa.y + 16, movable: true }, "hud");
    this.hudWin.on("closed", () => (this.hudWin = null));
  }

  // ---------- state ----------

  private setStatus(patch: Partial<RecorderStatus>): void {
    this.status = { ...this.status, ...patch };
    for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed()) win.webContents.send(REC.status, this.status);
  }

  private fail(message: string): void {
    console.error("Recording error:", message);
    this.setStatus({ phase: "error", error: message });
  }

  // ---------- record ----------

  async start(settings: RecordingSettings): Promise<void> {
    if (this.status.phase !== "idle" && this.status.phase !== "error") return;
    this.settings = settings;
    const d = screen.getAllDisplays().find((x) => String(x.id) === settings.screen.displayId) ?? screen.getPrimaryDisplay();
    this.display = { id: String(d.id), bounds: d.bounds, scaleFactor: d.scaleFactor };
    // Always the app's own recordings folder (the page can't choose where files are written).
    this.writer = await TakeWriter.create(this.defaultOutputDir);
    this.setStatus({ phase: "countdown", countdown: settings.countdownSec, elapsedMs: 0, takeId: this.writer.id, takeDir: this.writer.dir, error: undefined, warnings: undefined });
    this.showHud();
    const main = this.mainWindow();
    if (main?.isVisible()) main.minimize(); // keep the editor out of the recording

    // Open every input during the countdown (the "prepare" step), so that when the
    // countdown ends the clock and all recorders start together.
    const countdown = (async () => {
      for (let n = settings.countdownSec; n > 0; n--) {
        this.setStatus({ countdown: n });
        await new Promise((r) => setTimeout(r, 1000));
      }
    })();
    await this.openCaptureWindow();

    const wantsSystem = settings.systemAudio && process.platform === "win32";
    this.pendingScreenSource = settings.screen.sourceId || null;
    this.wantLoopback = wantsSystem;
    const payload: CaptureBeginPayload = {
      screen: settings.screen.sourceId ? { sourceId: settings.screen.sourceId, fps: settings.screen.fps } : null,
      webcam: settings.webcam.deviceId ? { deviceId: settings.webcam.deviceId, width: settings.webcam.width, height: settings.webcam.height, fps: settings.webcam.fps } : null,
      mic: settings.mic.deviceId ? { deviceId: settings.mic.deviceId } : null,
      systemAudio: wantsSystem,
    };
    // Mime types are decided by the capture window; files are opened lazily.
    for (const kind of ["screen", "webcam", "mic", "system"] as const) {
      const active = kind === "screen" ? payload.screen : kind === "webcam" ? payload.webcam : kind === "mic" ? payload.mic : payload.systemAudio;
      if (active) this.writer.openTrack(kind, kind === "screen" || kind === "webcam" ? "video/webm" : "audio/webm");
    }

    const prepared = new Promise<boolean>((resolve) => {
      const onPrepared = () => cleanup(true);
      const onError = () => cleanup(false);
      const cleanup = (ok: boolean) => {
        ipcMain.removeListener(REC.capturePrepared, onPrepared);
        ipcMain.removeListener(REC.captureError, onError);
        resolve(ok);
      };
      ipcMain.once(REC.capturePrepared, onPrepared);
      ipcMain.once(REC.captureError, onError);
    });
    this.captureWin!.webContents.send(REC.captureBegin, payload);
    const [ok] = await Promise.all([prepared, countdown]);
    if (!ok) {
      // The screen could not be opened: nothing was recorded, remove the empty take.
      this.captureWin?.destroy();
      this.captureWin = null;
      await this.writer.discard();
      this.writer = null;
      this.hudWin?.close();
      const mw = this.mainWindow();
      if (mw?.isMinimized()) mw.restore();
      return;
    }

    this.markers = [];
    this.clock.start(wallNow());
    if (settings.cursor.enabled) {
      const region = settings.screen.kind === "region" ? settings.screen.region : undefined;
      this.cursor = new CursorRecorder(join(this.writer.dir, CURSOR_FILE), this.clock, this.display.bounds, region, settings.cursor.recordTypedKeys);
      await this.cursor.start();
    }
    this.captureWin!.webContents.send(REC.captureGo);
    this.setStatus({ phase: "recording", countdown: undefined });
    this.tick = setInterval(() => this.setStatus({ elapsedMs: this.clock.now() }), 250);
  }

  private openCaptureWindow(): Promise<void> {
    this.captureWin = new BrowserWindow({
      show: false,
      width: 400,
      height: 300,
      webPreferences: {
        preload: this.preload,
        sandbox: true,
        contextIsolation: true,
        backgroundThrottling: false,
      },
    });
    this.loadPage(this.captureWin, "capture");
    return new Promise((resolve) => ipcMain.once(REC.captureReady, () => resolve()));
  }

  pause(): void {
    if (this.status.phase !== "recording") return;
    this.clock.pause();
    this.captureWin?.webContents.send(REC.capturePause);
    this.setStatus({ phase: "paused" });
  }

  resume(): void {
    if (this.status.phase !== "paused") return;
    this.clock.resume();
    this.captureWin?.webContents.send(REC.captureResume);
    this.setStatus({ phase: "recording" });
  }

  async stop(): Promise<TakeManifest | null> {
    if (this.status.phase !== "recording" && this.status.phase !== "paused") return null;
    if (this.clock.paused) this.clock.resume();
    const endMs = this.clock.now();
    this.setStatus({ phase: "stopping", elapsedMs: endMs });
    if (this.tick) clearInterval(this.tick);
    const hadCursor = !!this.cursor;
    await this.cursor?.stop();
    this.cursor = null;

    const done = await new Promise<CaptureDonePayload>((resolve) => {
      this.captureDone = resolve;
      this.captureWin?.webContents.send(REC.captureEnd);
      setTimeout(() => resolve({ stoppedWallMs: {} }), 8000); // capture window hung
    });
    this.captureDone = null;
    this.captureWin?.destroy();
    this.captureWin = null;

    // Each file lasts from its own first frame to its recorder's stop event.
    const writer = this.writer!;
    const durations: Partial<Record<TrackFileKind, number>> = {};
    for (const kind of ["screen", "webcam", "mic", "system"] as const) {
      const wall = done.stoppedWallMs[kind];
      const end = wall !== undefined ? Math.min(endMs, this.clock.toRecording(wall)) : endMs;
      durations[kind] = Math.max(0, end - writer.startOffset(kind));
    }
    const manifest = await writer.finish(
      {
        createdAt: new Date().toISOString(),
        durationMs: endMs,
        settings: this.settings!,
        display: this.display ?? undefined,
        pauses: [...this.clock.pauses],
        markers: [...this.markers],
        warnings: this.status.warnings,
      },
      durations,
      hadCursor ? CURSOR_FILE : undefined,
    );

    this.lastTakeDir = writer.dir;
    this.writer = null;
    this.hudWin?.close();
    this.setStatus({ phase: "idle", elapsedMs: endMs });
    const win = this.mainWindow();
    if (win) {
      if (win.isMinimized()) win.restore();
      if (win.isVisible()) win.focus();
    }
    this.onFinished?.(manifest);
    return manifest;
  }

  /** Throw the take away (hotkey or HUD). */
  async cancel(): Promise<void> {
    if (this.status.phase !== "recording" && this.status.phase !== "paused") return;
    if (this.tick) clearInterval(this.tick);
    await this.cursor?.stop();
    this.cursor = null;
    this.captureWin?.destroy();
    this.captureWin = null;
    await this.writer?.discard();
    this.writer = null;
    this.hudWin?.close();
    this.setStatus({ phase: "idle", elapsedMs: 0, takeId: undefined, takeDir: undefined });
    const mw = this.mainWindow();
    if (mw?.isMinimized()) mw.restore();
  }

  addMarker(): void {
    if (this.status.phase === "recording" || this.status.phase === "paused") this.markers.push(Math.round(this.clock.now()));
  }

  // ---------- global hotkeys (work while the app is minimized) ----------

  /**
   * Ctrl/Cmd+Shift+F9 start (the recorder UI holds the settings) / stop,
   * F10 pause/resume, F11 cancel the take, M add a marker.
   * Returns the accelerators that could not be registered (taken by another app).
   */
  registerHotkeys(requestStartFromUi: () => void): string[] {
    const failed: string[] = [];
    const reg = (acc: string, fn: () => void) => {
      if (!globalShortcut.register(acc, fn)) failed.push(acc);
    };
    reg(RECORDING_HOTKEYS.toggleRecord, () => {
      if (this.status.phase === "idle" || this.status.phase === "error") requestStartFromUi();
      else if (this.status.phase === "recording" || this.status.phase === "paused") void this.stop();
    });
    reg(RECORDING_HOTKEYS.togglePause, () => (this.status.phase === "paused" ? this.resume() : this.pause()));
    reg(RECORDING_HOTKEYS.cancel, () => void this.cancel());
    reg(RECORDING_HOTKEYS.marker, () => this.addMarker());
    app.on("will-quit", () => globalShortcut.unregisterAll());
    return failed;
  }
}
