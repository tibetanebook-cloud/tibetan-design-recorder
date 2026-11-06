/**
 * Asks the user when a newer version is published, then downloads and installs it inside the
 * app. Nothing is downloaded until the user says yes. Checking only reads the public release
 * record on GitHub and sends nothing about the user or their files.
 */
import { app, BrowserWindow, ipcMain, Notification, shell } from "electron";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import type { AppUpdater } from "electron-updater";
import { IPC } from "@shared/ipc";
import { translate, type Language } from "@shared/i18n";
import { isNewerVersion, LATEST_RELEASE_PAGE, type UpdateCheckResult, type UpdateState } from "@shared/updates";

const FIRST_CHECK_MS = 10_000;
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

export class UpdateManager {
  private state: UpdateState | null = null;
  private updater: AppUpdater | null = null;
  private readonly statePath: string;

  constructor(
    private readonly window: () => BrowserWindow | null,
    private readonly language: () => Language,
    /** True while recording: no pop-ups that would end up in the video. */
    private readonly busy: () => boolean,
    userDataDir: string,
  ) {
    this.statePath = join(userDataDir, "update-state.json");
  }

  register(): void {
    ipcMain.handle(IPC.updateCurrent, () => this.state);
    ipcMain.handle(IPC.updateCheck, () => this.check());
    ipcMain.handle(IPC.updateDownload, () => this.download());
    ipcMain.handle(IPC.updateInstall, () => this.install());
    ipcMain.handle(IPC.updateOpenPage, () => shell.openExternal(LATEST_RELEASE_PAGE));
  }

  /** Only an installed app checks by itself; test and development runs stay quiet. */
  start(): void {
    if (!app.isPackaged) return;
    const run = () => {
      if (!this.busy() && this.state?.phase !== "downloading" && this.state?.phase !== "ready") void this.check();
    };
    setTimeout(run, FIRST_CHECK_MS);
    setInterval(run, CHECK_EVERY_MS);
  }

  private set(state: UpdateState): void {
    this.state = state;
    this.window()?.webContents.send(IPC.updateState, state);
  }

  private async load(): Promise<AppUpdater> {
    if (this.updater) return this.updater;
    const loaded = (await import("electron-updater")) as unknown as { autoUpdater?: AppUpdater; default?: { autoUpdater: AppUpdater } };
    const updater = (loaded.autoUpdater ?? loaded.default?.autoUpdater) as AppUpdater;
    updater.autoDownload = false; // only after the user says yes
    updater.autoInstallOnAppQuit = true; // "Later" on a finished download installs when the app closes
    updater.logger = null;
    updater.on("download-progress", (progress) => {
      const percent = Math.round(progress.percent);
      if (this.state && percent !== this.state.percent) this.set({ phase: "downloading", version: this.state.version, percent });
    });
    updater.on("update-downloaded", (info) => this.set({ phase: "ready", version: info.version }));
    updater.on("error", () => {
      if (this.state?.phase === "downloading") this.set({ phase: "failed", version: this.state.version });
    });
    this.updater = updater;
    return updater;
  }

  async check(): Promise<UpdateCheckResult> {
    if (!app.isPackaged) return "failed";
    if (this.state?.phase === "downloading" || this.state?.phase === "ready") return "available";
    try {
      const updater = await this.load();
      const result = await updater.checkForUpdates();
      const version = result?.updateInfo.version;
      if (!version || !isNewerVersion(version, app.getVersion())) return "latest";
      this.set({ phase: "available", version });
      await this.notifyOnce(version);
      return "available";
    } catch {
      return "failed";
    }
  }

  private async download(): Promise<void> {
    if (!this.state || !this.updater || this.state.phase === "downloading" || this.state.phase === "ready") return;
    this.set({ phase: "downloading", version: this.state.version, percent: 0 });
    await this.updater.downloadUpdate().catch(() => {
      if (this.state) this.set({ phase: "failed", version: this.state.version });
    });
  }

  private install(): void {
    if (this.state?.phase !== "ready" || this.busy()) return;
    // Silent on Windows, and the app opens again by itself afterwards.
    this.updater?.quitAndInstall(true, true);
  }

  /** The system notification appears once per version; the question shows each time the app opens. */
  private async notifyOnce(version: string): Promise<void> {
    const seen = await fs.readFile(this.statePath, "utf8").then((text) => (JSON.parse(text) as { notified?: unknown }).notified).catch(() => null);
    if (seen === version || !Notification.isSupported()) return;
    await fs.writeFile(this.statePath, JSON.stringify({ notified: version })).catch(() => {});
    const note = new Notification({ title: translate(this.language(), "help.updateAsk"), body: `${app.getName()} ${version}` });
    note.on("click", () => {
      const win = this.window();
      if (!win) return;
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    });
    note.show();
  }
}
