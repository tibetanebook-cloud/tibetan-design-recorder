/**
 * Layout switching over time ("one-click layouts"): a list of segments, each
 * starting a layout at a time. Switches morph smoothly over LAYOUT_MORPH_MS.
 */
import { newId } from "../project/factory";
import type { LayoutSegment, Project, WebcamLayout } from "../project/schema";
import { cubicBezier, EASING_CURVES } from "./easing";

export const LAYOUT_MORPH_MS = 450;
const ease = cubicBezier(EASING_CURVES.gentle);
type Layout = WebcamLayout["layout"];

export interface LayoutState {
  layout: Layout;
  /** Layout being morphed from (if within LAYOUT_MORPH_MS of a switch). */
  from?: Layout;
  /** 0..1 progress of the morph (1 = settled). */
  k: number;
}

export function layoutAt(project: Project, t: number): LayoutState {
  const segs = [...project.layouts].sort((a, b) => a.startMs - b.startMs);
  let current: Layout = project.webcam.layout;
  let prev: Layout | undefined;
  let since = Infinity;
  for (const s of segs) {
    if (s.startMs > t) break;
    if (s.layout !== current) {
      prev = current;
      since = t - s.startMs;
    }
    current = s.layout;
  }
  if (prev !== undefined && since < LAYOUT_MORPH_MS) return { layout: current, from: prev, k: ease(since / LAYOUT_MORPH_MS) };
  return { layout: current, k: 1 };
}

/** Switch to `layout` from `atMs` onward (replaces a switch at the same moment). */
export function setLayoutFrom(project: Project, atMs: number, layout: Layout): Project {
  const others = project.layouts.filter((s) => Math.abs(s.startMs - atMs) > 1);
  const seg: LayoutSegment = { id: newId("lay"), startMs: Math.max(0, atMs), layout };
  // Before the first switch the project default applies, so a switch at 0 sets it.
  if (atMs <= 1) return { ...project, webcam: { ...project.webcam, layout }, layouts: others.filter((s) => s.startMs > 1) };
  return { ...project, layouts: [...others, seg].sort((a, b) => a.startMs - b.startMs) };
}

export const removeLayoutSwitch = (project: Project, id: string): Project => ({ ...project, layouts: project.layouts.filter((s) => s.id !== id) });

/** Linear blend of two rectangles (for layout morphs). */
export function mixRect(a: { x: number; y: number; width: number; height: number }, b: typeof a, k: number): typeof a {
  return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, width: a.width + (b.width - a.width) * k, height: a.height + (b.height - a.height) * k };
}
