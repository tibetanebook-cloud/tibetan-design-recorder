/** IPC channel names and payloads shared by main, preload and renderer. */
import type { Language } from "./i18n";

export const IPC = {
  projectSave: "project:save",
  projectSaveAs: "project:save-as",
  projectOpen: "project:open",
  projectOpenPath: "project:open-path",
  projectAutosave: "project:autosave",
  projectRecoveryCheck: "project:recovery-check",
  projectRecoveryResolve: "project:recovery-resolve",
  settingsGet: "settings:get",
  settingsSetLanguage: "settings:set-language",
  settingsSetShortcuts: "settings:set-shortcuts",
  mediaImport: "media:import",
  pickImage: "dialog:pick-image",
  extensionsList: "extensions:list",
  extensionsOpenFolder: "extensions:open-folder",
  exportPickPath: "export:pick-path",
  exportPickFolder: "export:pick-folder",
  exportPickProjects: "export:pick-projects",
  exportOpen: "export:open",
  exportWrite: "export:write",
  exportClose: "export:close",
  exportReveal: "export:reveal",
  exportDefaultDir: "export:default-dir",
  libraryList: "library:list",
  librarySave: "library:save",
  textOpen: "file:text-open",
  textSave: "file:text-save",
  transcribeConfig: "transcribe:config",
  fontsList: "fonts:list",
  transcribeSetConfig: "transcribe:set-config",
  transcribeRun: "transcribe:run",
  menuCommand: "menu:command",
  rendererReady: "renderer:ready",
  /** Main -> renderer: open this .tdrec (double-clicked in Explorer/Finder, or passed on the command line). */
  projectOpenRequest: "project:open-request",
  appQuit: "app:quit",
} as const;

export interface Settings {
  language: Language;
  recentProjects: string[];
  /** Overrides of the default editor shortcuts (action id -> key or null). */
  shortcuts: Record<string, string | null>;
}

export interface SaveResult {
  ok: boolean;
  path?: string;
  error?: string;
}

export interface OpenResult {
  ok: boolean;
  path?: string;
  /** Raw JSON text; the renderer validates it with parseProject. */
  json?: string;
  error?: string;
}

export interface RecoveryInfo {
  available: boolean;
  projectName?: string;
  autosavedAt?: string;
  json?: string;
}

/** Commands that both menu bars (in-app and native macOS) can send: action ids
 * such as "edit.split" (see shared/shortcuts.ts) plus menu-only ones. */
export type MenuCommand = string;
