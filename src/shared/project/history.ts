/**
 * Undo/redo for editor state. Every edit is a pure function Project -> Project
 * applied through `apply`, so history is a list of immutable snapshots and an
 * undo can never leave the project half-changed. Structural sharing keeps the
 * snapshots cheap: edits copy only the arrays/objects they touch.
 */
import type { Project } from "./schema";

export interface History {
  past: { project: Project; label: string }[];
  present: Project;
  future: { project: Project; label: string }[];
  /** Label of the edit that produced `present`. */
  label: string;
}

export const MAX_HISTORY = 500;

export function createHistory(project: Project): History {
  return { past: [], present: project, future: [], label: "" };
}

export type Edit = (project: Project) => Project;

export function apply(history: History, label: string, edit: Edit): History {
  const next = edit(history.present);
  if (next === history.present) return history;
  const past = [...history.past, { project: history.present, label: history.label }];
  return {
    past: past.length > MAX_HISTORY ? past.slice(past.length - MAX_HISTORY) : past,
    present: next,
    future: [],
    label,
  };
}

export const canUndo = (h: History): boolean => h.past.length > 0;
export const canRedo = (h: History): boolean => h.future.length > 0;

export function undo(h: History): History {
  const previous = h.past.at(-1);
  if (!previous) return h;
  return {
    past: h.past.slice(0, -1),
    present: previous.project,
    future: [{ project: h.present, label: h.label }, ...h.future],
    label: previous.label,
  };
}

export function redo(h: History): History {
  const next = h.future[0];
  if (!next) return h;
  return {
    past: [...h.past, { project: h.present, label: h.label }],
    present: next.project,
    future: h.future.slice(1),
    label: next.label,
  };
}
