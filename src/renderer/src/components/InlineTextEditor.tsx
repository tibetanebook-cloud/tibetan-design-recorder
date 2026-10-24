/**
 * Double-click text, a callout, a title or a caption on the preview to edit it
 * in place. Enter saves, Shift+Enter adds a line, Esc cancels. Text is stored
 * exactly as typed (tsheg and shad kept).
 */
import { useEffect, useRef } from "react";
import type { Project } from "@shared/project/schema";
import { buildScene } from "@shared/scene/buildScene";
import * as ops from "@shared/timeline/ops";
import type { TextBox } from "../compositor/Compositor";
import { sceneContext } from "../playback/assets";
import { useEditor } from "../store";

const TIBETAN = /[ༀ-࿿]/;

export interface InlineEdit {
  box: TextBox;
  /** Box in canvas pixels after the camera (what is on screen). */
  view: { x: number; y: number; width: number; height: number };
  value: string;
  fontFamily?: string;
}

/** Current text of a clip's editable field. */
export function fieldText(project: Project, clipId: string, field: TextBox["field"]): { value: string; fontFamily?: string } | null {
  const c = project.clips.find((x) => x.id === clipId)?.content;
  if (!c) return null;
  if (field === "caption") return c.type === "caption" ? { value: c.text, fontFamily: project.captionStyle.fontFamily } : null;
  if (c.type === "text" || c.type === "callout") return field === "text" ? { value: c.text, fontFamily: c.fontFamily } : null;
  if (c.type === "title") return field === "title" ? { value: c.title, fontFamily: c.fontFamily } : field === "subtitle" ? { value: c.subtitle, fontFamily: c.fontFamily } : null;
  return null;
}

/** Write an edited field back (one undo step). */
export function applyFieldText(clipId: string, field: TextBox["field"], value: string) {
  return (p: Project): Project => {
    const clip = p.clips.find((x) => x.id === clipId);
    if (!clip) return p;
    const c = clip.content;
    const lang = TIBETAN.test(value) ? "bo" : "lang" in c && c.lang === "bo" ? "en" : "lang" in c ? c.lang : "en";
    if ((c.type === "text" || c.type === "callout" || c.type === "caption") && (field === "text" || field === "caption")) return ops.setClipProps(p, [clipId], { content: { ...c, text: value, lang } });
    if (c.type === "title" && field === "title") return ops.setClipProps(p, [clipId], { content: { ...c, title: value, lang } });
    if (c.type === "title" && field === "subtitle") return ops.setClipProps(p, [clipId], { content: { ...c, subtitle: value } });
    return p;
  };
}

/** Topmost editable text under a canvas point, mapped through the camera. */
export function hitText(project: Project, boxes: TextBox[], timeMs: number, x: number, y: number): InlineEdit | null {
  const W = project.canvas.width, H = project.canvas.height;
  const scene = buildScene(project, timeMs, sceneContext());
  for (let i = boxes.length - 1; i >= 0; i--) {
    const b = boxes[i]!;
    const layer = scene.layers.find((l) => l.clipId === b.clipId);
    const cam = layer?.inCamera ? scene.camera : { scale: 1, cx: W / 2, cy: H / 2 };
    const view = { x: (b.x - cam.cx) * cam.scale + W / 2, y: (b.y - cam.cy) * cam.scale + H / 2, width: b.width * cam.scale, height: b.height * cam.scale };
    const pad = 8;
    if (x < view.x - pad || x > view.x + view.width + pad || y < view.y - pad || y > view.y + view.height + pad) continue;
    const text = fieldText(project, b.clipId, b.field);
    if (!text) continue;
    return { box: { ...b, fontSize: b.fontSize * cam.scale }, view, ...text };
  }
  return null;
}

export function InlineTextEditor({ edit, project, onDone }: { edit: InlineEdit; project: Project; onDone: () => void }) {
  const t = useEditor((s) => s.t);
  const ref = useRef<HTMLTextAreaElement>(null);
  const done = useRef(false);
  const W = project.canvas.width, H = project.canvas.height;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.select();
    // Font size follows the preview size.
    const fit = () => {
      const host = el.parentElement?.getBoundingClientRect();
      if (host) el.style.fontSize = `${Math.max(10, (edit.box.fontSize * host.width) / W)}px`;
    };
    fit();
    const ro = new ResizeObserver(fit);
    if (el.parentElement) ro.observe(el.parentElement);
    return () => ro.disconnect();
  }, [edit, W]);

  const finish = (save: boolean) => {
    if (done.current) return;
    done.current = true;
    const value = ref.current?.value ?? edit.value;
    if (save && value !== edit.value) useEditor.getState().edit("edit.text", applyFieldText(edit.box.clipId, edit.box.field, value));
    onDone();
  };

  const pct = (v: number, of: number) => `${(v / of) * 100}%`;
  const minW = Math.max(edit.view.width, 240);
  const left = Math.min(Math.max(0, edit.box.align === "center" ? edit.view.x + edit.view.width / 2 - minW / 2 : edit.box.align === "right" ? edit.view.x + edit.view.width - minW : edit.view.x), W - minW);
  return (
    <textarea
      ref={ref}
      className="inline-text-editor"
      data-inline-editor
      lang={TIBETAN.test(edit.value) ? "bo" : edit.box.lang}
      aria-label={t("inline.edit")}
      defaultValue={edit.value}
      spellCheck={false}
      style={{
        left: pct(left, W),
        top: pct(Math.max(0, edit.view.y - 6), H),
        width: pct(Math.min(W, minW), W),
        minHeight: pct(edit.view.height + 12, H),
        textAlign: edit.box.align,
        fontFamily: `${edit.fontFamily ? `"${edit.fontFamily.replace(/["\\]/g, "")}", ` : ""}var(--font-tibetan), var(--font-latin)`,
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation(); // keep editor shortcuts (space = play, delete, …) out of the way
        if (e.key === "Escape") finish(false);
        else if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
          e.preventDefault();
          finish(true);
        }
      }}
      onBlur={() => finish(true)}
    />
  );
}
