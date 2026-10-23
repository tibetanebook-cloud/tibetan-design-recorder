import { create } from "zustand";
import { DEFAULT_LANGUAGE, translate, type Language } from "@shared/i18n";
import { apply, canRedo, canUndo, createHistory, redo, undo, type Edit, type History } from "@shared/project/history";
import { createDemoProject } from "@shared/project/demo";
import { projectDurationMs } from "@shared/project/factory";
import { parseProject, serializeProject, type Clip, type Project, type Track } from "@shared/project/schema";
import * as ops from "@shared/timeline/ops";
import * as regions from "@shared/timeline/regions";
import { suggestZooms } from "@shared/effects/suggest";
import { cursorTrackFor } from "./playback/assets";

export type View = "recorder" | "editor";
export type PanelTab = "properties" | "library" | "captions" | "teaching" | "jobs";
export type ExportMode = "video" | "audio" | "tracks" | "batch";
export type SaveState = "saved" | "unsaved" | "autosaved" | "error";

/** Pixels per second limits for timeline zoom. */
export const MIN_PPS = 4;
export const MAX_PPS = 1200;

interface EditorStore {
  language: Language;
  view: View;
  history: History;
  projectPath?: string;
  saveState: SaveState;

  // UI state: not part of undo history (saved into project.editor on save).
  selection: string[];
  selectedTrackId: string | null;
  /** Selected zoom region on the camera lane (exclusive with clip selection). */
  selectedZoomId: string | null;
  /** In/Out points for range actions (speed regions). */
  inMs: number | null;
  outMs: number | null;
  /** Result of the last auto-zoom suggestion run (for the status line). */
  suggestStatus: string | null;
  playheadMs: number;
  pps: number;
  snapping: boolean;
  playing: boolean;
  clipboard: Clip[];
  /** Project before a drag started; edits during the drag are previews of it. */
  dragBase: Project | null;

  t: (key: string) => string;
  setLanguage: (language: Language) => void;
  setView: (view: View) => void;
  edit: (label: string, edit: Edit) => void;
  /** Change the project without an undo step (analysis results and other derived data). */
  annotate: (edit: Edit) => void;
  /** Right-hand panel tab. */
  panelTab: PanelTab;
  setPanelTab: (tab: PanelTab) => void;
  /** Open export dialog, if any. */
  exportDialog: ExportMode | null;
  setExportDialog: (mode: ExportMode | null) => void;
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
  load: (project: Project, path?: string) => void;
  newProject: () => void;
  save: (as?: boolean) => Promise<void>;
  open: () => Promise<void>;
  /** Open a project file by path (file association, recent files). */
  openPath: (path: string) => Promise<boolean>;
  autosave: () => Promise<void>;

  // timeline
  select: (ids: string[], mode?: "replace" | "toggle" | "add") => void;
  selectTrack: (id: string | null) => void;
  selectAll: () => void;
  setPlayhead: (ms: number) => void;
  setZoom: (pps: number) => void;
  toggleSnapping: () => void;
  setPlaying: (playing: boolean) => void;
  beginDrag: () => void;
  dragPreview: (edit: Edit) => void;
  endDrag: (label: string) => void;
  cancelDrag: () => void;
  toggleTrack: (trackId: string, prop: keyof Pick<Track, "locked" | "muted" | "solo" | "hidden">) => void;
  split: () => void;
  deleteSelection: (ripple?: boolean) => void;
  duplicateSelection: () => void;
  copySelection: () => void;
  cutSelection: () => void;
  paste: () => void;
  linkSelection: () => void;
  unlinkSelection: () => void;
  addMarkerAtPlayhead: (kind?: "marker" | "chapter" | "quiz") => void;
  duration: () => number;

  // Stage 4: camera zoom, speed regions
  selectZoom: (id: string | null) => void;
  addZoomAtPlayhead: () => void;
  deleteSelectedZoom: () => void;
  suggestZooms: () => void;
  acceptSuggestions: (ids?: string[]) => void;
  rejectSuggestions: (ids?: string[]) => void;
  setIn: () => void;
  setOut: () => void;
  clearInOut: () => void;
  /** Range for speed regions: In/Out, else the selected clips' span, else playhead + 3 s. */
  actionRange: () => { startMs: number; endMs: number };
  applySpeed: (factor: number) => void;
}

export const useEditor = create<EditorStore>((set, get) => {
  const present = () => get().history.present;
  return {
    language: DEFAULT_LANGUAGE,
    view: "editor",
    history: createHistory(createDemoProject()),
    saveState: "saved",
    selection: [],
    selectedTrackId: null,
    selectedZoomId: null,
    inMs: null,
    outMs: null,
    suggestStatus: null,
    playheadMs: 2000,
    pps: 80,
    snapping: true,
    playing: false,
    clipboard: [],
    dragBase: null,

    t: (key) => translate(get().language, key),
    setLanguage: (language) => set({ language }),
    setView: (view) => set({ view }),
    edit: (label, edit) =>
      set((s) => {
        const history = apply(s.history, label, edit);
        return history === s.history ? s : { history, saveState: "unsaved" };
      }),
    annotate: (edit) => set((s) => ({ history: { ...s.history, present: edit(s.history.present) }, saveState: "unsaved" })),
    panelTab: "properties",
    setPanelTab: (panelTab) => set({ panelTab }),
    exportDialog: null,
    setExportDialog: (exportDialog) => set({ exportDialog }),
    undo: () => set((s) => ({ history: undo(s.history), saveState: "unsaved", selection: [] })),
    redo: () => set((s) => ({ history: redo(s.history), saveState: "unsaved", selection: [] })),
    canUndo: () => canUndo(get().history),
    canRedo: () => canRedo(get().history),
    load: (project, path) =>
      set({
        history: createHistory(project),
        projectPath: path,
        saveState: "saved",
        selection: [],
        selectedTrackId: null,
        selectedZoomId: null,
        inMs: null,
        outMs: null,
        suggestStatus: null,
        playheadMs: project.editor.playheadMs,
        pps: project.editor.pixelsPerSecond,
        playing: false,
      }),
    newProject: () => get().load(createDemoProject()),
    save: async (as = false) => {
      const json = serializeProject(withEditorState(get()));
      const path = as ? undefined : get().projectPath;
      const result = as ? await window.tdr.saveProjectAs(json) : await window.tdr.saveProject(json, path);
      if (result.ok) set({ projectPath: result.path, saveState: "saved" });
      else if (result.error) set({ saveState: "error" });
    },
    open: async () => {
      const result = await window.tdr.openProject();
      if (result.ok && result.json) get().load(parseProject(JSON.parse(result.json)), result.path);
      else if (result.error) set({ saveState: "error" });
    },
    openPath: async (path) => {
      const result = await window.tdr.openProjectPath(path);
      if (result.ok && result.json) {
        get().load(parseProject(JSON.parse(result.json)), result.path);
        get().setView("editor");
        return true;
      }
      set({ saveState: "error" });
      return false;
    },
    autosave: async () => {
      if (get().saveState !== "unsaved") return;
      await window.tdr.autosave(serializeProject(withEditorState(get())));
      set({ saveState: "autosaved" });
    },

    select: (ids, mode = "replace") =>
      set((s) => {
        if (ids.length) s = { ...s, selectedZoomId: null };
        if (mode === "replace") return { selection: [...new Set(ids)], selectedZoomId: ids.length ? null : s.selectedZoomId };
        const current = new Set(s.selection);
        for (const id of ids) {
          if (mode === "toggle" && current.has(id)) current.delete(id);
          else current.add(id);
        }
        return { selection: [...current], selectedZoomId: null };
      }),
    selectTrack: (id) => set({ selectedTrackId: id }),
    selectAll: () => set({ selection: present().clips.map((c) => c.id) }),
    setPlayhead: (ms) => set({ playheadMs: Math.max(0, ms) }),
    setZoom: (pps) => set({ pps: Math.min(MAX_PPS, Math.max(MIN_PPS, pps)) }),
    toggleSnapping: () => set((s) => ({ snapping: !s.snapping })),
    setPlaying: (playing) => set({ playing }),

    beginDrag: () => set({ dragBase: present() }),
    dragPreview: (edit) =>
      set((s) => (s.dragBase ? { history: { ...s.history, present: edit(s.dragBase) } } : s)),
    endDrag: (label) =>
      set((s) => {
        if (!s.dragBase) return s;
        const final = s.history.present;
        const base = { ...s.history, present: s.dragBase };
        const history = apply(base, label, () => final);
        return { dragBase: null, history, saveState: history === base ? s.saveState : "unsaved" };
      }),
    cancelDrag: () => set((s) => (s.dragBase ? { dragBase: null, history: { ...s.history, present: s.dragBase } } : s)),

    toggleTrack: (trackId, prop) => {
      const track = present().tracks.find((t) => t.id === trackId);
      if (track) get().edit(`track.${prop}`, (p) => ops.setTrackProps(p, trackId, { [prop]: !track[prop] }));
    },
    split: () => {
      const { selection, playheadMs } = get();
      get().edit("edit.split", (p) => ops.splitAt(p, playheadMs, selection.length ? selection : undefined));
    },
    deleteSelection: (ripple = false) => {
      const ids = get().selection;
      if (!ids.length) return;
      get().edit(ripple ? "edit.rippleDelete" : "edit.delete", (p) => (ripple ? ops.rippleDelete(p, ids) : ops.deleteClips(p, ids)));
      set({ selection: [] });
    },
    duplicateSelection: () => {
      let created: string[] = [];
      get().edit("edit.duplicate", (p) => {
        const r = ops.duplicateClips(p, get().selection);
        created = r.ids;
        return r.project;
      });
      if (created.length) set({ selection: created });
    },
    copySelection: () => {
      const ids = ops.withLinked(present(), get().selection);
      set({ clipboard: present().clips.filter((c) => ids.has(c.id)) });
    },
    cutSelection: () => {
      get().copySelection();
      get().deleteSelection(false);
    },
    paste: () => {
      const { clipboard, playheadMs } = get();
      let created: string[] = [];
      get().edit("edit.paste", (p) => {
        // Media may have been removed since copying; only paste what still resolves.
        const valid = clipboard.filter((c) => !c.mediaId || p.media.some((m) => m.id === c.mediaId));
        const r = ops.pasteClips(p, valid, playheadMs);
        created = r.ids;
        return r.project;
      });
      if (created.length) set({ selection: created });
    },
    linkSelection: () => get().edit("edit.link", (p) => ops.linkClips(p, get().selection)),
    unlinkSelection: () => get().edit("edit.unlink", (p) => ops.unlinkClips(p, get().selection)),
    addMarkerAtPlayhead: (kind = "marker") => get().edit("insert.marker", (p) => ops.addMarker(p, get().playheadMs, kind).project),
    duration: () => projectDurationMs(present()),

    selectZoom: (id) => set({ selectedZoomId: id, selection: id ? [] : get().selection }),
    addZoomAtPlayhead: () => {
      const at = get().playheadMs;
      let id = "";
      get().edit("effects.zoomRegion", (p) => {
        const r = regions.addZoom(p, at, at + 2500);
        id = r.id;
        return r.project;
      });
      if (id) get().selectZoom(id);
    },
    deleteSelectedZoom: () => {
      const id = get().selectedZoomId;
      if (!id) return;
      get().edit("edit.delete", (p) => regions.removeZoom(p, id));
      set({ selectedZoomId: null });
    },
    suggestZooms: () => {
      const p = present();
      const lane = p.tracks.find((t) => t.kind === "cursor");
      const clip = lane && p.clips.find((c) => c.trackId === lane.id);
      const track = clip?.mediaId ? cursorTrackFor(clip.mediaId) ?? null : null;
      // Track time -> timeline time for this clip (speed 1 assumed for suggestions).
      const offset = clip ? clip.startMs - clip.sourceInMs : 0;
      const result = suggestZooms(track, p.zooms, projectDurationMs(p), offset);
      set({ suggestStatus: result.status });
      if (result.zooms.length) get().edit("effects.autoZoom", (q) => regions.setSuggestions(q, result.zooms));
    },
    acceptSuggestions: (ids) => get().edit("zoom.accept", (p) => regions.acceptSuggestions(p, ids)),
    rejectSuggestions: (ids) => get().edit("zoom.reject", (p) => regions.rejectSuggestions(p, ids)),
    setIn: () => set((s) => ({ inMs: s.playheadMs, outMs: s.outMs !== null && s.outMs <= s.playheadMs ? null : s.outMs })),
    setOut: () => set((s) => ({ outMs: s.playheadMs, inMs: s.inMs !== null && s.inMs >= s.playheadMs ? null : s.inMs })),
    clearInOut: () => set({ inMs: null, outMs: null }),
    actionRange: () => {
      const s = get();
      if (s.inMs !== null && s.outMs !== null && s.outMs > s.inMs) return { startMs: s.inMs, endMs: s.outMs };
      const sel = present().clips.filter((c) => s.selection.includes(c.id));
      if (sel.length) return { startMs: Math.min(...sel.map((c) => c.startMs)), endMs: Math.max(...sel.map(ops.clipEnd)) };
      return { startMs: s.playheadMs, endMs: s.playheadMs + 3000 };
    },
    applySpeed: (factor) => {
      const { startMs, endMs } = get().actionRange();
      get().edit(factor > 1 ? "effects.speedUp" : "effects.slowDown", (p) => regions.applySpeedRegion(p, startMs, endMs, factor));
      set({ inMs: null, outMs: null });
    },
  };
});

/** The project with the current playhead/zoom/selection stored for reopening. */
function withEditorState(s: Pick<EditorStore, "history" | "playheadMs" | "pps" | "selection">): Project {
  return {
    ...s.history.present,
    editor: { playheadMs: s.playheadMs, pixelsPerSecond: s.pps, selectedClipIds: s.selection },
  };
}
