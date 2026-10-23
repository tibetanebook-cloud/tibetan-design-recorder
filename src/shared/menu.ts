/**
 * One menu definition drives both the in-app menu bar (Windows/Linux, rendered
 * in React so Tibetan uses Noto Serif Tibetan) and the native macOS menu.
 * Items not yet built in this stage are listed with `pending: true` so the
 * full translated menu is visible but disabled.
 */
import type { MenuCommand } from "./ipc";
import { SHORTCUT_ACTIONS } from "./shortcuts";

export interface MenuItemDef {
  /** i18n key for the label. */
  label: string;
  command?: MenuCommand;
  accelerator?: string;
  pending?: boolean;
  separatorBefore?: boolean;
}

export interface MenuDef {
  label: string;
  items: MenuItemDef[];
}

const p = (label: string, separatorBefore = false): MenuItemDef => ({ label, pending: true, separatorBefore });
/** A working item whose command is its label key; the accelerator comes from the shortcut table. */
const a = (label: string, separatorBefore = false): MenuItemDef => ({
  label,
  command: label,
  accelerator: SHORTCUT_ACTIONS.find((x) => x.id === label)?.defaultKey?.replace("Mod", "CmdOrCtrl") ?? undefined,
  separatorBefore,
});

export const MENUS: MenuDef[] = [
  {
    label: "menu.file",
    items: [
      { label: "file.newProject", command: "file.newProject", accelerator: "CmdOrCtrl+N" },
      { label: "file.open", command: "file.open", accelerator: "CmdOrCtrl+O" },
      p("file.openRecent"),
      { label: "file.save", command: "file.save", accelerator: "CmdOrCtrl+S", separatorBefore: true },
      { label: "file.saveAs", command: "file.saveAs", accelerator: "CmdOrCtrl+Shift+S" },
      a("file.import", true),
      a("file.export"),
      p("file.settings", true),
      { label: "file.quit", command: "file.quit", accelerator: "CmdOrCtrl+Q", separatorBefore: true },
    ],
  },
  {
    label: "menu.edit",
    items: [
      a("edit.undo"),
      a("edit.redo"),
      a("edit.cut", true),
      a("edit.copy"),
      a("edit.paste"),
      a("edit.delete"),
      a("edit.rippleDelete"),
      a("edit.duplicate"),
      a("edit.selectAll"),
      a("edit.split", true),
      a("edit.link"),
      a("edit.unlink"),
      { label: "edit.shortcuts", command: "edit.shortcuts", separatorBefore: true },
    ],
  },
  {
    label: "menu.view",
    items: [
      { label: "view.recorder", command: "view.recorder" },
      { label: "view.editor", command: "view.editor" },
      a("view.zoomIn", true),
      a("view.zoomOut"),
      a("view.fitTimeline"),
      a("view.snapping"),
      { label: "view.fullScreen", command: "view.fullScreen", accelerator: "F11", separatorBefore: true },
    ],
  },
  {
    label: "menu.record",
    items: [a("record.new"), a("record.start"), a("record.pause"), a("record.resume"), a("record.stop"), a("record.deviceTest", true)],
  },
  {
    label: "menu.insert",
    items: [
      a("insert.text"), a("insert.image"), a("insert.shape"), a("insert.arrow"), a("insert.callout"),
      a("insert.highlight"), a("insert.spotlight"), a("insert.blurRegion"),
      { label: "title.lowerThird", command: "title.lowerThird", separatorBefore: true }, { label: "title.intro", command: "title.intro" }, { label: "title.outro", command: "title.outro" },
      a("insert.marker", true), a("insert.chapter"), a("insert.quiz"), a("insert.stepNumber"), a("insert.keystrokes"),
      a("insert.videoTrack", true), a("insert.imageTrack"), a("insert.audioTrack"), a("insert.annotationTrack"), a("insert.captionTrack"),
    ],
  },
  {
    label: "menu.effects",
    items: [
      a("effects.zoomRegion"), a("effects.autoZoom"), a("effects.speedUp"), a("effects.slowDown"), a("range.in"), a("range.out"), a("range.clear"), a("effects.cursor", true),
      a("effects.background"), a("effects.webcamBubble"), a("effects.greenScreen"), a("effects.layouts"),
      { label: "layout.screenOnly", command: "layout.hidden" }, { label: "layout.webcamOnly", command: "layout.full" }, { label: "layout.sideBySide", command: "layout.side" }, { label: "layout.screenWithBubble", command: "layout.bubble" },
      a("effects.transitions", true), a("effects.titles"), a("effects.library"),
    ],
  },
  {
    label: "menu.audio",
    items: [a("audio.noiseRemoval"), a("audio.leveling"), a("audio.equalizer"), a("audio.compressor"), a("audio.fadeIn", true), a("audio.fadeOut"), a("audio.captions", true)],
  },
  {
    label: "menu.export",
    items: [a("export.video"), a("export.tracks"), a("export.audioOnly"), a("export.subtitles", true), a("export.queue", true), a("export.batch")],
  },
  {
    label: "menu.help",
    items: [{ label: "help.about", command: "help.about" }, p("help.update")],
  },
];
