import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import { IPC, type MenuCommand, type OpenResult, type RecoveryInfo, type SaveResult, type Settings } from "@shared/ipc";
import type { Language } from "@shared/i18n";
import type { ExtensionInfo } from "@shared/extensions";
import type { Rect } from "@shared/project/schema";
import type { LibraryContents, UserLibraryItem } from "@shared/library";
import type { TranscribeConfig, TranscribeRequest, TranscribeResult } from "@shared/captions/transcribe";
import { REC, type CaptureBeginPayload, type CaptureDonePayload, type TrackStartedPayload } from "@shared/recording/ipc";
import type { CaptureSource, DisplayInfo, RecorderStatus, RecordingSettings, TakeManifest, TrackFileKind } from "@shared/recording/types";

const api = {
  platform: process.platform,
  getSettings: (): Promise<Settings> => ipcRenderer.invoke(IPC.settingsGet),
  setLanguage: (language: Language): Promise<void> => ipcRenderer.invoke(IPC.settingsSetLanguage, language),
  setShortcuts: (shortcuts: Record<string, string | null>): Promise<Settings> => ipcRenderer.invoke(IPC.settingsSetShortcuts, shortcuts),
  /** Shows the open dialog; returns absolute paths of chosen media files. */
  importMedia: (): Promise<string[]> => ipcRenderer.invoke(IPC.mediaImport),
  pickImage: (): Promise<string | null> => ipcRenderer.invoke(IPC.pickImage),
  extensions: {
    list: (): Promise<ExtensionInfo[]> => ipcRenderer.invoke(IPC.extensionsList),
    openFolder: (): Promise<void> => ipcRenderer.invoke(IPC.extensionsOpenFolder),
  },
  /** Open a text file (e.g. .srt/.vtt) chosen by the user; null if cancelled. */
  openText: (name: string, extensions: string[]): Promise<{ path: string; text: string } | null> => ipcRenderer.invoke(IPC.textOpen, name, extensions),
  /** Save text to a file chosen by the user; returns the path or null. */
  saveText: (defaultName: string, extensions: string[], text: string): Promise<string | null> => ipcRenderer.invoke(IPC.textSave, defaultName, extensions, text),
  exporter: {
    /** Save dialog for one export; null if cancelled. */
    pickPath: (defaultName: string, extension: string): Promise<string | null> => ipcRenderer.invoke(IPC.exportPickPath, defaultName, extension),
    pickFolder: (): Promise<string | null> => ipcRenderer.invoke(IPC.exportPickFolder),
    /** Choose .tdrec projects for a batch export. */
    pickProjects: (): Promise<string[]> => ipcRenderer.invoke(IPC.exportPickProjects),
    defaultDir: (): Promise<string> => ipcRenderer.invoke(IPC.exportDefaultDir),
    open: (path: string): Promise<number> => ipcRenderer.invoke(IPC.exportOpen, path),
    write: (id: number, position: number, data: Uint8Array): Promise<void> => ipcRenderer.invoke(IPC.exportWrite, id, position, data),
    close: (id: number, ok: boolean): Promise<{ path: string; bytes: number } | null> => ipcRenderer.invoke(IPC.exportClose, id, ok),
    reveal: (path: string): Promise<void> => ipcRenderer.invoke(IPC.exportReveal, path),
  },
  library: {
    list: (): Promise<LibraryContents> => ipcRenderer.invoke(IPC.libraryList),
    saveUser: (items: UserLibraryItem[]): Promise<LibraryContents> => ipcRenderer.invoke(IPC.librarySave, items),
  },
  transcribe: {
    config: (): Promise<TranscribeConfig> => ipcRenderer.invoke(IPC.transcribeConfig),
    setConfig: (patch: { baseUrl?: string; model?: string; key?: string }): Promise<TranscribeConfig> => ipcRenderer.invoke(IPC.transcribeSetConfig, patch),
    run: (req: TranscribeRequest): Promise<TranscribeResult> => ipcRenderer.invoke(IPC.transcribeRun, req),
  },
  onLanguage: (listener: (language: Language) => void) => {
    const handler = (_e: IpcRendererEvent, language: Language) => listener(language);
    ipcRenderer.on(IPC.settingsSetLanguage, handler);
    return () => ipcRenderer.off(IPC.settingsSetLanguage, handler);
  },
  saveProject: (json: string, path?: string): Promise<SaveResult> => ipcRenderer.invoke(IPC.projectSave, json, path),
  saveProjectAs: (json: string): Promise<SaveResult> => ipcRenderer.invoke(IPC.projectSaveAs, json),
  openProject: (): Promise<OpenResult> => ipcRenderer.invoke(IPC.projectOpen),
  openProjectPath: (path: string): Promise<OpenResult> => ipcRenderer.invoke(IPC.projectOpenPath, path),
  autosave: (json: string): Promise<void> => ipcRenderer.invoke(IPC.projectAutosave, json),
  checkRecovery: (): Promise<RecoveryInfo> => ipcRenderer.invoke(IPC.projectRecoveryCheck),
  resolveRecovery: (restore: boolean): Promise<void> => ipcRenderer.invoke(IPC.projectRecoveryResolve, restore),
  sendMenuCommand: (command: MenuCommand) => ipcRenderer.send(IPC.menuCommand, command),
  onMenuCommand: (listener: (command: MenuCommand) => void) => {
    const handler = (_e: IpcRendererEvent, command: MenuCommand) => listener(command);
    ipcRenderer.on(IPC.menuCommand, handler);
    return () => ipcRenderer.off(IPC.menuCommand, handler);
  },
  quit: (): Promise<void> => ipcRenderer.invoke(IPC.appQuit),
  ready: () => ipcRenderer.send(IPC.rendererReady),
  /** A project to open, sent when one is double-clicked in Explorer/Finder. */
  onOpenProjectRequest: (listener: (path: string) => void) => on<string>(IPC.projectOpenRequest, listener),
  /** Absolute path -> URL the renderer can load (served by main, with seeking). */
  mediaUrl: (path: string) => `tdr-media://file/${encodeURIComponent(path)}`,
  rec: {
    listSources: (): Promise<CaptureSource[]> => ipcRenderer.invoke(REC.listSources),
    listDisplays: (): Promise<DisplayInfo[]> => ipcRenderer.invoke(REC.listDisplays),
    selectRegion: (displayId: string): Promise<Rect | null> => ipcRenderer.invoke(REC.selectRegion, displayId),
    start: (settings: RecordingSettings): Promise<void> => ipcRenderer.invoke(REC.start, settings),
    pause: (): Promise<void> => ipcRenderer.invoke(REC.pause),
    resume: (): Promise<void> => ipcRenderer.invoke(REC.resume),
    stop: (): Promise<TakeManifest | null> => ipcRenderer.invoke(REC.stop),
    cancel: (): Promise<void> => ipcRenderer.invoke(REC.cancel),
    addMarker: (): Promise<void> => ipcRenderer.invoke(REC.marker),
    status: (): Promise<RecorderStatus> => ipcRenderer.invoke(REC.status),
    showBubble: (deviceId: string | null): Promise<void> => ipcRenderer.invoke(REC.showBubble, deviceId),
    onStatus: (listener: (s: RecorderStatus) => void) => on(REC.status, listener),
    onTakeFinished: (listener: (take: TakeManifest, dir: string) => void) =>
      on<[TakeManifest, string]>(REC.takeFinished, (take, dir) => listener(take, dir)),
    onHotkeyStart: (listener: () => void) => on(REC.hotkeyStart, listener),
    chooseRegion: (rect: Rect | null) => ipcRenderer.send(REC.regionChosen, rect),
  },
  /** Used only by the hidden capture window. */
  capture: {
    ready: () => ipcRenderer.send(REC.captureReady),
    onBegin: (listener: (p: CaptureBeginPayload) => void) => on(REC.captureBegin, listener),
    onGo: (listener: () => void) => on(REC.captureGo, listener),
    prepared: () => ipcRenderer.send(REC.capturePrepared),
    onPause: (listener: () => void) => on(REC.capturePause, listener),
    onResume: (listener: () => void) => on(REC.captureResume, listener),
    onEnd: (listener: () => void) => on(REC.captureEnd, listener),
    trackStarted: (p: TrackStartedPayload) => ipcRenderer.send(REC.trackStarted, p),
    chunk: (kind: TrackFileKind, data: Uint8Array) => ipcRenderer.send(REC.chunk, kind, data),
    done: (p: CaptureDonePayload) => ipcRenderer.send(REC.captureDone, p),
    error: (message: string) => ipcRenderer.send(REC.captureError, message),
    warning: (message: string) => ipcRenderer.send(REC.captureWarning, message),
  },
};

function on<A extends unknown[]>(channel: string, listener: (...args: A) => void): () => void;
function on<T>(channel: string, listener: (arg: T) => void): () => void;
function on(channel: string, listener: (...args: unknown[]) => void): () => void {
  const handler = (_e: IpcRendererEvent, ...args: unknown[]) => listener(...args);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.off(channel, handler);
}

export type TdrApi = typeof api;
contextBridge.exposeInMainWorld("tdr", api);
