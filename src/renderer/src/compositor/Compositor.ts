/**
 * Draws a Scene (from buildScene) with PixiJS. The same class runs in the
 * editor preview and in the export renderer, so both produce identical frames.
 * It renders at full canvas resolution; the preview scales the <canvas> with CSS.
 *
 * Structure per frame:
 *   root
 *    ├─ camera (scaled/moved by the zoom camera): background, screen layers,
 *    │          device frame, click rings, cursor
 *    └─ overlays: webcam, video/image lanes, annotations, captions, key chips
 */
// Our CSP forbids eval; this Pixi module swaps in eval-free shader/uniform code.
import "pixi.js/unsafe-eval";
import {
  Application,
  BlurFilter,
  CanvasTextMetrics,
  Color,
  type Filter,
  Container,
  Graphics,
  Rectangle,
  Sprite,
  Text,
  TextStyle,
  Texture,
  VideoSource,
  type TextureSource,
} from "pixi.js";
import type { Background, ClipContent, WebcamBorder } from "@shared/project/schema";
import { growOutline, resolveGrade, sampleOutline, shapeOutline } from "@shared/effects/webcamStyle";
import { isNeutralLook, LookFilter } from "./lookFilter";
import type { Scene, SceneCaption, SceneCursor, SceneLayer, SceneQuiz } from "@shared/scene/buildScene";
import { cubicBezier, EASING_CURVES } from "@shared/effects/easing";
import { ChromaKeyFilter } from "./chromaKey";
import { placeMedia, squirclePath } from "@shared/scene/placement";
import { wrapText } from "@shared/text/lineBreak";
import { wallpaperById } from "./wallpapers";

export const TIBETAN_FONT = '"Noto Serif Tibetan"';
const LATIN_FONT = '"Segoe UI", "Inter", system-ui, sans-serif';
/** Tibetan stacks need tall lines; never go below 1.8. */
export const TIBETAN_LINE_HEIGHT = 1.8;
const TIBETAN_RE = /[ༀ-࿿]/;

const easeOut = cubicBezier(EASING_CURVES.smooth);
type Content<T extends ClipContent["type"]> = Extract<ClipContent, { type: T }>;
type Box = { x: number; y: number; width: number; height: number };
interface TextOpts {
  bold?: boolean;
  align?: "left" | "center" | "right";
  fontFamily?: string;
}

/** Where a piece of editable text was drawn this frame (canvas pixels), for double-click editing. */
export interface TextBox {
  clipId: string;
  field: "text" | "title" | "subtitle" | "caption";
  x: number;
  y: number;
  width: number;
  height: number;
  lang: string;
  /** Font size on the canvas, for sizing the editor. */
  fontSize: number;
  align: "left" | "center" | "right";
}

/** CSS font-family list: the chosen font first, then the built-in fallbacks (Tibetan always renders). */
export function fontStack(fontFamily: string | undefined, tibetan: boolean): string {
  const base = tibetan ? `${TIBETAN_FONT}, ${LATIN_FONT}` : `${LATIN_FONT}, ${TIBETAN_FONT}`;
  if (!fontFamily) return base;
  const safe = fontFamily.replace(/["\\]/g, "");
  return `"${safe}", ${base}`;
}

/** Our own cursor artwork (unit height, hotspot at 0,0). */
const ARROW = [0, 0, 0, 0.8, 0.2, 0.64, 0.33, 0.95, 0.46, 0.9, 0.33, 0.59, 0.58, 0.59];

export class Compositor {
  readonly app = new Application();
  private readonly root = new Container();
  private readonly textCache = new Map<string, Text>();
  private readonly backgrounds = new Map<string, Texture>();
  private readonly images = new Map<string, HTMLImageElement>();
  private readonly blurFilters = new Map<string, BlurFilter>();
  private readonly chromaFilter = new ChromaKeyFilter();
  private readonly lookFilter = new LookFilter();
  /** Render textures made for this frame only (redaction snapshots). */
  private frameTextures: Texture[] = [];

  /** Output scale: the exporter renders a 1080p project at 0.75 for a 810p file; the preview at its on-screen size. */
  scale = 1;
  /**
   * Preview only: upload a video's frame to the GPU only when the video has
   * produced a new one (requestVideoFrameCallback), instead of every redraw.
   * The exporter leaves this off, because it seeks and draws each frame itself.
   */
  onlyNewVideoFrames = false;
  private readonly freshFrame = new WeakMap<HTMLVideoElement, boolean>();

  private watchFrames(el: HTMLVideoElement): void {
    const mark = () => {
      this.freshFrame.set(el, true);
      el.requestVideoFrameCallback(mark);
    };
    el.requestVideoFrameCallback(mark);
  }

  /** Called when an asset (wallpaper image, device frame…) finishes loading, so the host can redraw. */
  onAssetLoaded?: () => void;

  async init(width: number, height: number, canvas?: HTMLCanvasElement): Promise<void> {
    await this.app.init({
      width,
      height,
      canvas,
      antialias: true,
      backgroundAlpha: 1,
      preference: "webgl",
      autoStart: false,
      // Keep pixels readable for frame export and the smoke test.
      preserveDrawingBuffer: true,
    });
    this.app.stage.addChild(this.root);
  }

  resize(width: number, height: number): void {
    if (this.app.renderer.width !== width || this.app.renderer.height !== height) this.app.renderer.resize(width, height);
  }

  /** Editable text drawn in the last frame (topmost last). */
  textBoxes: TextBox[] = [];
  private hit(clipId: string, field: TextBox["field"], b: Box, lang: string, fontSize: number, align: TextBox["align"] = "center"): void {
    this.textBoxes.push({ clipId, field, x: b.x, y: b.y, width: b.width, height: b.height, lang, fontSize, align });
  }

  render(scene: Scene): void {
    this.textBoxes = [];
    this.resize(Math.round(scene.width * this.scale), Math.round(scene.height * this.scale));
    this.root.scale.set(this.scale);
    this.clearFrame();
    const W = scene.width, H = scene.height;
    const cam = scene.camera;

    const camera = new Container();
    camera.scale.set(cam.scale);
    camera.position.set(W / 2 - cam.scale * cam.cx, H / 2 - cam.scale * cam.cy);
    const blur = Math.hypot(scene.cameraBlur.x, scene.cameraBlur.y);
    if (blur > 0.6) {
      const f = this.blur(`cam${Math.round(scene.cameraBlur.x)}|${Math.round(scene.cameraBlur.y)}`, 1);
      f.strengthX = Math.min(40, Math.abs(scene.cameraBlur.x) * 0.5);
      f.strengthY = Math.min(40, Math.abs(scene.cameraBlur.y) * 0.5);
      camera.filters = [f];
    }
    camera.addChild(this.drawBackground(scene));
    const overlays = new Container();

    for (const layer of scene.layers) {
      const node = layer.content.type === "redact" ? this.drawRedact(layer, camera, W) : this.drawLayer(layer, W, H);
      if (!node) continue;
      this.applyTransition(node, layer, W, H);
      (layer.inCamera ? camera : overlays).addChild(node);
    }
    if (scene.deviceFrame) {
      const img = this.image(scene.deviceFrame.path);
      if (img) {
        const s = Sprite.from(img);
        s.position.set(scene.deviceFrame.frame.x, scene.deviceFrame.frame.y);
        s.setSize(scene.deviceFrame.frame.width, scene.deviceFrame.frame.height);
        camera.addChild(s);
      }
    }
    if (scene.cursor) {
      camera.addChild(this.drawRings(scene.cursor));
      if (scene.cursor.visible) camera.addChild(this.drawCursor(scene.cursor));
      if (scene.cursor.keys.length) overlays.addChild(this.drawKeys(scene.cursor, W, H));
    }
    if (scene.caption) overlays.addChild(this.drawCaption(scene.caption, W, H));
    if (scene.quiz) overlays.addChild(this.drawQuiz(scene.quiz, W, H));
    this.root.addChild(camera, overlays);
    this.app.render();
  }

  /** Free last frame's per-frame objects; cached text, images and video sources are reused. */
  private clearFrame(): void {
    const destroyTree = (node: Container) => {
      for (const child of [...node.children]) {
        if (child instanceof Text) {
          node.removeChild(child);
          continue;
        }
        if (child instanceof Sprite) {
          // Cached textures (backgrounds, images) must survive; per-frame cropped ones go.
          const cached = [...this.backgrounds.values()].includes(child.texture) || child.texture.label === "cached";
          child.destroy({ texture: !cached, textureSource: false });
          continue;
        }
        destroyTree(child as Container);
      }
      node.filters = null;
      node.destroy({ children: false });
    };
    for (const old of this.root.removeChildren()) destroyTree(old as Container);
    for (const t of this.frameTextures) t.destroy(true);
    this.frameTextures = [];
  }

  private blur(key: string, strength: number, quality = 4): BlurFilter {
    let f = this.blurFilters.get(key);
    if (!f) {
      if (this.blurFilters.size > 64) this.blurFilters.clear();
      f = new BlurFilter({ strength, quality });
      this.blurFilters.set(key, f);
    }
    return f;
  }

  // ---------------------------------------------------------------- background

  private drawBackground(scene: Scene): Container {
    const tex = this.backgroundTexture(scene.background, scene.width, scene.height);
    const sprite = new Sprite(tex);
    if (scene.backgroundBlur > 0) {
      // Extend past the edges so blurred borders don't fade to black.
      const pad = scene.backgroundBlur * 6;
      sprite.position.set(-pad, -pad);
      sprite.setSize(scene.width + pad * 2, scene.height + pad * 2);
      sprite.filters = [this.blur(`bg${scene.backgroundBlur}`, scene.backgroundBlur * 4)];
    }
    return sprite;
  }

  private backgroundTexture(bg: Background, width: number, height: number): Texture {
    const key = `${JSON.stringify(bg)}|${width}x${height}`;
    const hit = this.backgrounds.get(key);
    if (hit) return hit;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d")!;
    let ready = true;
    if (bg.type === "solid") {
      ctx.fillStyle = bg.color;
      ctx.fillRect(0, 0, width, height);
    } else if (bg.type === "gradient") {
      let fill: CanvasGradient;
      if (bg.radial) {
        fill = ctx.createRadialGradient(width / 2, height / 2, 0, width / 2, height / 2, Math.hypot(width, height) / 2);
      } else {
        // CSS-style angle: 0° points up, 90° to the right.
        const a = ((bg.angleDeg - 90) * Math.PI) / 180;
        const half = (Math.abs(width * Math.cos(a)) + Math.abs(height * Math.sin(a))) / 2;
        const cx = width / 2, cy = height / 2, dx = Math.cos(a) * half, dy = Math.sin(a) * half;
        fill = ctx.createLinearGradient(cx - dx, cy - dy, cx + dx, cy + dy);
      }
      fill.addColorStop(0, bg.from);
      fill.addColorStop(1, bg.to);
      ctx.fillStyle = fill;
      ctx.fillRect(0, 0, width, height);
    } else {
      // Wallpaper (built-in drawn in code, or an extension image) or a user image.
      const builtIn = bg.type === "wallpaper" ? wallpaperById(bg.id) : undefined;
      if (builtIn) builtIn.draw(ctx, width, height);
      else {
        const path = bg.type === "image" ? bg.path : bg.id;
        const img = this.image(path);
        ctx.fillStyle = "#14151c";
        ctx.fillRect(0, 0, width, height);
        if (img) {
          // Cover the canvas.
          const k = Math.max(width / img.naturalWidth, height / img.naturalHeight);
          const w = img.naturalWidth * k, h = img.naturalHeight * k;
          ctx.drawImage(img, (width - w) / 2, (height - h) / 2, w, h);
        } else ready = false;
      }
    }
    const texture = Texture.from(canvas);
    texture.label = "cached";
    // Don't cache a placeholder: redraw once the image has loaded.
    if (ready) {
      if (this.backgrounds.size > 6) {
        for (const t of this.backgrounds.values()) t.destroy(true);
        this.backgrounds.clear();
      }
      this.backgrounds.set(key, texture);
    }
    return texture;
  }

  /** Resolves when every image requested so far has loaded (or failed). The exporter waits on this. */
  async assetsReady(): Promise<boolean> {
    const pending = [...this.images.values()].filter((img) => !img.complete);
    if (!pending.length) return false;
    await Promise.all(pending.map((img) => img.decode().catch(() => undefined)));
    // Placeholder backgrounds were drawn while waiting: drop them so they are redrawn.
    return true;
  }

  /** Load an image by absolute path (via the media protocol); undefined until loaded. */
  private image(path: string): HTMLImageElement | undefined {
    let img = this.images.get(path);
    if (!img) {
      img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => this.onAssetLoaded?.();
      img.src = window.tdr.mediaUrl(path);
      this.images.set(path, img);
    }
    return img.complete && img.naturalWidth > 0 ? img : undefined;
  }

  // ---------------------------------------------------------------- layers

  /** Three stacked soft shadow layers (offsets 12/4/2, alphas .7/.5/.3, blur 48/16/8 at 1080p). */
  private shadow(points: number[], intensity: number, unit: number): Container {
    const c = new Container();
    const layers: [number, number, number][] = [
      [12, 0.7, 48],
      [4, 0.5, 16],
      [2, 0.3, 8],
    ];
    for (const [offset, alpha, blur] of layers) {
      const g = new Graphics().poly(points).fill({ color: 0x000000, alpha: Math.min(1, alpha * intensity * 0.6) });
      g.position.set(0, offset * unit);
      g.filters = [this.blur(`sh${blur}|${unit.toFixed(2)}`, (blur * unit) / 2)];
      c.addChild(g);
    }
    return c;
  }

  private drawLayer(layer: SceneLayer, stageW: number, stageH: number): Container | null {
    const { frame, content } = layer;
    const unit = stageW / 1920;
    const node = new Container();
    node.alpha = layer.opacity;
    switch (content.type) {
      case "solid":
        node.addChild(new Graphics().roundRect(frame.x, frame.y, frame.width, frame.height, layer.cornerRadius).fill(content.color));
        return node;
      case "text":
        node.addChild(this.drawText(layer, content));
        return node;
      case "shape":
        node.addChild(this.shape(layer));
        return node;
      case "callout":
        node.addChild(this.drawCallout(layer, content, unit));
        return node;
      case "highlight": {
        const g = new Graphics().roundRect(frame.x, frame.y, frame.width, frame.height, 6 * unit).fill({ color: content.color, alpha: content.opacity * 2 > 1 ? 1 : content.opacity * 2 });
        // Highlighter ink: darkens nothing, tints what is underneath.
        g.blendMode = "multiply";
        node.addChild(g);
        return node;
      }
      case "spotlight": {
        const pad = content.feather * 3 + 8;
        const g = new Graphics().rect(-pad, -pad, stageW + pad * 2, stageH + pad * 2).fill({ color: 0x000000, alpha: content.dim });
        if (content.shape === "ellipse") g.ellipse(frame.x + frame.width / 2, frame.y + frame.height / 2, frame.width / 2, frame.height / 2).cut();
        else g.roundRect(frame.x, frame.y, frame.width, frame.height, 12 * unit).cut();
        if (content.feather > 0) g.filters = [this.blur(`spot${Math.round(content.feather)}|${unit.toFixed(2)}`, (content.feather * unit) / 2)];
        node.addChild(g);
        return node;
      }
      case "step":
        node.addChild(this.drawStep(layer, content, unit));
        return node;
      case "title":
        node.addChild(this.drawTitle(layer, content, stageW, stageH));
        return node;
      case "caption":
      case "redact":
        return null;
    }
    const media = this.mediaElement?.(layer.clipId);
    const sprite = media && this.mediaSprite(layer, media);
    if (!sprite) return null;
    // The picture's real outline (letterboxing removed) for mask and shadow.
    const box = { x: Math.min(sprite.x, sprite.x + sprite.width * Math.sign(sprite.scale.x)), y: sprite.y, width: Math.abs(sprite.width), height: sprite.height };
    const cam = layer.webcam;
    const outline = cam?.shaped
      ? shapeOutline(cam.shape, box, cam.roundness)
      : layer.squircle
        ? squirclePath(box, layer.cornerRadius)
        : layer.cornerRadius > 0
          ? circlePath(box, layer.cornerRadius)
          : [box.x, box.y, box.x + box.width, box.y, box.x + box.width, box.y + box.height, box.x, box.y + box.height];
    if (layer.shadow > 0) node.addChild(this.shadow(outline, layer.shadow, unit));
    node.addChild(sprite);
    // Webcam filters: green screen first, then the look (beauty + colour).
    const filters: Filter[] = [];
    if (layer.chroma) filters.push(this.chromaFilter.set(layer.chroma));
    if (cam) {
      const grade = resolveGrade(cam.look.preset, cam.look);
      if (!isNeutralLook(cam.look, grade)) {
        const videoH = media instanceof HTMLVideoElement ? media.videoHeight : media.naturalHeight;
        filters.push(this.lookFilter.set(cam.look, grade, Math.max(1.5, videoH / 240)));
      }
    }
    sprite.filters = filters.length ? filters : null;
    if ((cam?.shaped && cam.shape !== "square") || (!cam?.shaped && layer.cornerRadius > 0)) {
      const mask = new Graphics().poly(outline).fill(0xffffff);
      node.addChild(mask);
      sprite.mask = mask;
    }
    if (cam?.shaped && cam.border.style !== "none" && cam.border.width > 0) node.addChild(this.drawBorder(outline, box, cam.border, unit, layer.localMs));
    return node;
  }

  /** Webcam border styles, drawn on the shape outline. */
  private drawBorder(outline: number[], box: Box, b: WebcamBorder, unit: number, timeMs: number): Container {
    const w = Math.max(1, b.width * unit);
    const node = new Container();
    const line = (pts: number[], color: string | number, width: number, alpha = 1) =>
      new Graphics().poly(pts).stroke({ color, width, alpha, join: "round" });
    /** Short segments along the outline, each with its own colour (gradient, rainbow). */
    const colourful = (colorAt: (t: number) => number) => {
      const g = new Graphics();
      const pts = sampleOutline(outline, 3);
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i]!, c = pts[(i + 1) % pts.length]!;
        g.moveTo(a.x, a.y).lineTo(c.x, c.y).stroke({ color: colorAt(a.t), width: w, cap: "round" });
      }
      return g;
    };
    const c1 = new Color(b.color), c2 = new Color(b.color2);
    const mix = (t: number) => {
      const k = 0.5 - 0.5 * Math.cos(t * Math.PI * 2);
      const a = c1.toRgbArray(), z = c2.toRgbArray();
      return new Color([0, 1, 2].map((i) => a[i]! + (z[i]! - a[i]!) * k)).toNumber();
    };
    const glow = (color: string, width: number, strength: number) => {
      const g = line(outline, color, width, 0.9);
      g.filters = [this.blur(`glow${Math.round(strength)}`, strength, 3)];
      return g;
    };
    switch (b.style) {
      case "solid":
        node.addChild(line(outline, b.color, w));
        break;
      case "double":
        node.addChild(line(outline, b.color, w * 0.45), line(growOutline(outline, box, w * 0.9), b.color2, w * 0.45));
        break;
      case "gradient":
        node.addChild(colourful(mix));
        break;
      case "rainbow":
        // Slowly turning rainbow (driven by the timeline time, so export matches the preview).
        node.addChild(colourful((t) => new Color({ h: ((t + timeMs / 6000) % 1) * 360, s: 85, l: 58 }).toNumber()));
        break;
      case "glow":
        node.addChild(glow(b.color, w * 2.2, w * 1.4), line(outline, b.color, w * 0.6));
        break;
      case "neon":
        node.addChild(glow(b.color2, w * 3, w * 2), glow(b.color, w * 1.6, w * 0.8), line(outline, "#ffffff", Math.max(1, w * 0.35), 0.95));
        break;
      case "dashed": {
        const g = new Graphics();
        const pts = sampleOutline(outline, w * 1.6);
        for (let i = 0; i < pts.length; i += 2) {
          const a = pts[i]!, c = pts[(i + 1) % pts.length]!;
          g.moveTo(a.x, a.y).lineTo(c.x, c.y).stroke({ color: b.color, width: w, cap: "round" });
        }
        node.addChild(g);
        break;
      }
      case "ring":
        node.addChild(line(growOutline(outline, box, w * 1.3), b.color, w * 0.6));
        break;
    }
    return node;
  }

  private shape(layer: SceneLayer): Graphics {
    const c = layer.content as Extract<SceneLayer["content"], { type: "shape" }>;
    const g = new Graphics();
    const stroke = { color: c.color, width: c.strokeWidth, cap: "round" as const, join: "round" as const };
    const f = layer.frame;
    if (c.shape === "rect") {
      g.roundRect(f.x, f.y, f.width, f.height, Math.min(f.width, f.height) * 0.06);
      if (c.fill) g.fill(c.fill);
      if (c.strokeWidth > 0) g.stroke(stroke);
    } else if (c.shape === "ellipse") {
      g.ellipse(f.x + f.width / 2, f.y + f.height / 2, f.width / 2, f.height / 2);
      if (c.fill) g.fill(c.fill);
      if (c.strokeWidth > 0) g.stroke(stroke);
    } else {
      g.moveTo(c.x1, c.y1).lineTo(c.x2, c.y2).stroke(stroke);
      if (c.shape === "arrow") {
        const a = Math.atan2(c.y2 - c.y1, c.x2 - c.x1);
        const head = Math.max(18, c.strokeWidth * 3.2);
        g.poly([
          c.x2, c.y2,
          c.x2 - head * Math.cos(a - 0.45), c.y2 - head * Math.sin(a - 0.45),
          c.x2 - head * Math.cos(a + 0.45), c.y2 - head * Math.sin(a + 0.45),
        ]).fill(c.color);
      }
    }
    return g;
  }

  /** Transitions: slide offsets, zoom about the frame centre, wipe mask, blur. */
  private applyTransition(node: Container, layer: SceneLayer, W: number, H: number): void {
    const t = layer.transition;
    const f = layer.frame;
    const cx = f.x + f.width / 2, cy = f.y + f.height / 2;
    if (t.scale !== 1) {
      node.pivot.set(cx, cy);
      node.position.set(cx, cy);
      node.scale.set(t.scale);
    }
    if (t.dx || t.dy) node.position.set(node.position.x + t.dx * W, node.position.y + t.dy * H);
    if (t.wipe < 1) {
      const m = new Graphics().rect(f.x, f.y - 2, Math.max(0.5, f.width * t.wipe), f.height + 4).fill(0xffffff);
      node.addChild(m);
      node.mask = m;
    }
    if (t.blur > 0.5) node.filters = [...(node.filters ?? []), this.blur(`tr${Math.round(t.blur)}`, t.blur)];
  }

  /** Bounds of a Text placed by text() (anchor x depends on alignment, anchor y = 0). */
  private static textBox(t: Text): Box {
    return { x: t.x - t.anchor.x * t.width, y: t.y, width: t.width, height: t.height };
  }

  private drawText(layer: SceneLayer, c: Content<"text">): Container {
    const f = layer.frame;
    const a = layer.textAnim;
    const opts = { bold: c.bold, align: c.align, fontFamily: c.fontFamily };
    // The full text decides the box, so a typewriter reveal does not make it jump.
    const full = this.text(layer.clipId, c.text, c.fontSize, c.color, c.lang, f.width, f.x, f.y, opts);
    const box = Compositor.textBox(full);
    this.hit(layer.clipId, "text", box, c.lang, c.fontSize, c.align);
    const shown = a && a.text !== c.text ? this.text(`${layer.clipId}|tw`, a.text, c.fontSize, c.color, c.lang, f.width, f.x, f.y, opts) : full;
    if (shown !== full) shown.position.set(full.x - (full.anchor.x - shown.anchor.x) * full.width, full.y);
    const wrap = new Container();
    if (c.background) {
      const pad = c.fontSize * 0.35;
      wrap.addChild(new Graphics().roundRect(box.x - pad, box.y - pad * 0.4, box.width + pad * 2, box.height + pad * 0.8, pad * 0.6).fill(c.background));
    }
    wrap.addChild(shown);
    if (a) {
      wrap.alpha = a.alpha;
      const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
      wrap.pivot.set(cx, cy);
      wrap.position.set(cx, cy + a.dy * c.fontSize);
      wrap.scale.set(a.scale);
      if (a.wipe < 1) {
        const m = new Graphics().rect(box.x - c.fontSize, box.y - c.fontSize, (box.width + c.fontSize * 2) * a.wipe, box.height + c.fontSize * 2).fill(0xffffff);
        wrap.addChild(m);
        wrap.mask = m;
      }
    }
    return wrap;
  }

  /** Bubble / box / pill with an optional pointer tail to (tailX, tailY). */
  private drawCallout(layer: SceneLayer, c: Content<"callout">, unit: number): Container {
    const f = layer.frame;
    const pad = c.fontSize * 0.55;
    const text = this.text(layer.clipId, c.text, c.fontSize, c.color, c.lang, Math.max(20, f.width - pad * 2), f.x + pad, f.y, { bold: true, fontFamily: c.fontFamily });
    const h = Math.max(f.height, text.height + pad * 1.2);
    const box = { x: f.x, y: f.y + (f.height - h) / 2, width: f.width, height: h };
    text.position.set(box.x + box.width / 2, box.y + (box.height - text.height) / 2);
    this.hit(layer.clipId, "text", box, c.lang, c.fontSize);
    const radius = c.style === "pill" ? box.height / 2 : c.style === "bubble" ? Math.min(box.height / 2, 28 * unit + c.fontSize * 0.3) : 6 * unit;
    const border = { color: c.border, width: Math.max(2, 4 * unit) };
    const g = new Graphics();
    let tail: number[] | undefined;
    if (c.tailX !== undefined && c.tailY !== undefined) {
      const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
      const dx = c.tailX - cx, dy = c.tailY - cy;
      // Where the line from the centre to the tip leaves the box.
      const k = Math.min(Math.abs((box.width / 2 - radius * 0.3) / (dx || 1e-6)), Math.abs((box.height / 2 - radius * 0.3) / (dy || 1e-6)));
      if (k < 1) {
        const bx = cx + dx * k, by = cy + dy * k;
        const len = Math.hypot(dx, dy) || 1;
        const half = Math.min(box.width, box.height) * 0.16;
        const nx = (-dy / len) * half, ny = (dx / len) * half;
        tail = [bx + nx, by + ny, c.tailX, c.tailY, bx - nx, by - ny];
      }
    }
    if (tail) g.poly(tail).fill(c.fill).stroke(border);
    g.roundRect(box.x, box.y, box.width, box.height, radius).fill(c.fill).stroke(border);
    // Cover the box border where the tail joins, so the outline reads as one shape.
    if (tail) g.poly(tail).fill(c.fill);
    const node = new Container();
    node.addChild(g, text);
    const a = layer.textAnim;
    if (a) {
      const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
      node.pivot.set(cx, cy);
      node.position.set(cx, cy);
      node.scale.set(a.scale);
      node.alpha = a.alpha;
    }
    return node;
  }

  private drawStep(layer: SceneLayer, c: Content<"step">, unit: number): Container {
    const f = layer.frame;
    const r = Math.min(f.width, f.height) / 2;
    const cx = f.x + f.width / 2, cy = f.y + f.height / 2;
    const p = Math.min(1, layer.localMs / 320);
    const s = p < 1 ? 0.4 + 0.6 * easeOut(p) + Math.sin(p * Math.PI) * 0.12 : 1;
    const node = new Container();
    node.addChild(new Graphics().circle(cx, cy + 3 * unit, r).fill({ color: 0x000000, alpha: 0.28 }));
    node.addChild(new Graphics().circle(cx, cy, r).fill(c.fill).stroke({ color: 0xffffff, width: Math.max(2, r * 0.09) }));
    const label = String(layer.stepNumber ?? 1);
    const t = this.text(`step|${label}`, label, r * 1.05, c.color, "en", r * 4, cx - r * 2, 0, { bold: true });
    t.position.set(cx, cy - t.height / 2);
    node.addChild(t);
    node.pivot.set(cx, cy);
    node.position.set(cx, cy);
    node.scale.set(s);
    return node;
  }

  /** Title templates: centre title, lower third, chapter card, quote, intro and outro cards. */
  private drawTitle(layer: SceneLayer, c: Content<"title">, W: number, H: number): Container {
    const u = W / 1920;
    const e = easeOut(Math.min(1, layer.localMs / 700));
    const e2 = easeOut(Math.max(0, Math.min(1, (layer.localMs - 200) / 700)));
    const f = layer.frame;
    const node = new Container();
    const rise = (t: Text, k: number) => {
      t.alpha = k;
      t.y += (1 - k) * 30 * u;
      return t;
    };
    switch (c.template) {
      case "lowerThird": {
        // Sized from the real text heights: Tibetan stacks need about twice the line height of Latin.
        const x = 96 * u;
        const tw = Math.min(W * 0.55, 1000 * u);
        const title = this.text(`${layer.clipId}|t`, c.title, 54 * u, c.color, c.lang, tw, x + 40 * u, 0, { bold: true, align: "left", fontFamily: c.fontFamily });
        const sub = c.subtitle ? this.text(`${layer.clipId}|s`, c.subtitle, 32 * u, c.accent, c.lang, tw, x + 40 * u, 0, { align: "left", fontFamily: c.fontFamily }) : undefined;
        const padY = 12 * u;
        const h = Math.max(c.subtitle ? 150 * u : 104 * u, padY * 2 + title.height + (sub ? sub.height - 6 * u : 0));
        const y = H - h - 110 * u;
        const w = Math.min(tw, Math.max(title.width, sub?.width ?? 0)) + 80 * u;
        node.addChild(new Graphics().roundRect(x, y, w * e, h, 10 * u).fill({ color: c.background, alpha: 0.92 }));
        node.addChild(new Graphics().rect(x, y, 10 * u, h * e).fill(c.accent));
        const top = y + (h - title.height - (sub ? sub.height - 6 * u : 0)) / 2;
        title.position.set(x + 40 * u, top);
        const mask = new Graphics().rect(x, y - 40 * u, w * e, h + 80 * u).fill(0xffffff);
        const texts = new Container();
        texts.addChild(rise(title, e2));
        if (sub) {
          sub.position.set(x + 40 * u, top + title.height - 6 * u);
          texts.addChild(rise(sub, e2));
        }
        texts.addChild(mask);
        texts.mask = mask;
        node.addChild(texts);
        this.hit(layer.clipId, "title", { ...Compositor.textBox(title), y: top }, c.lang, 54 * u, "left");
        if (sub) this.hit(layer.clipId, "subtitle", { ...Compositor.textBox(sub), y: top + title.height - 6 * u }, c.lang, 32 * u, "left");
        return node;
      }
      case "chapter": {
        node.addChild(new Graphics().rect(f.x, f.y, f.width, f.height).fill({ color: c.background, alpha: 0.88 * e }));
        const x = f.x + 180 * u;
        const bar = new Graphics().rect(x - 40 * u, f.y + f.height / 2 - 90 * u, 12 * u, 180 * u * e).fill(c.accent);
        const sub = this.text(`${layer.clipId}|s`, c.subtitle, 36 * u, c.accent, c.lang, f.width - 400 * u, x, 0, { align: "left", fontFamily: c.fontFamily });
        sub.position.set(x, f.y + f.height / 2 - 100 * u);
        const title = this.text(`${layer.clipId}|t`, c.title, 88 * u, c.color, c.lang, f.width - 400 * u, x, 0, { bold: true, align: "left", fontFamily: c.fontFamily });
        // Title starts below the subtitle line (Tibetan stacks are tall).
        title.position.set(x, Math.max(f.y + f.height / 2 - 40 * u, sub.y + sub.height - 8 * u));
        node.addChild(bar, rise(sub, e), rise(title, e2));
        this.hit(layer.clipId, "subtitle", Compositor.textBox(sub), c.lang, 36 * u, "left");
        this.hit(layer.clipId, "title", Compositor.textBox(title), c.lang, 88 * u, "left");
        return node;
      }
      case "quote": {
        node.addChild(new Graphics().rect(f.x, f.y, f.width, f.height).fill({ color: c.background, alpha: 0.85 * e }));
        const mark = this.text(`quote|${c.accent}`, "“", 220 * u, c.accent, "en", 400 * u, f.x + f.width / 2 - 200 * u, 0);
        mark.position.set(f.x + f.width / 2, f.y + f.height / 2 - 300 * u);
        const body = this.text(`${layer.clipId}|t`, c.title, 64 * u, c.color, c.lang, Math.min(f.width * 0.7, 1300 * u), f.x + f.width * 0.15, 0, { fontFamily: c.fontFamily });
        body.position.set(f.x + f.width / 2, f.y + f.height / 2 - body.height / 2);
        node.addChild(rise(mark, e), rise(body, e2));
        this.hit(layer.clipId, "title", Compositor.textBox(body), c.lang, 64 * u);
        if (c.subtitle) {
          const by = this.text(`${layer.clipId}|s`, `— ${c.subtitle}`, 36 * u, c.accent, c.lang, f.width * 0.7, f.x + f.width * 0.15, 0, { fontFamily: c.fontFamily });
          by.position.set(f.x + f.width / 2, body.y + body.height + 24 * u);
          node.addChild(rise(by, e2));
          this.hit(layer.clipId, "subtitle", Compositor.textBox(by), c.lang, 36 * u);
        }
        return node;
      }
      default: {
        // center, intro, outro
        const card = c.template !== "center";
        if (card) node.addChild(new Graphics().rect(f.x, f.y, f.width, f.height).fill(c.background));
        const title = this.text(`${layer.clipId}|t`, c.title, (card ? 112 : 96) * u, c.color, c.lang, f.width * 0.8, f.x + f.width * 0.1, 0, { bold: true, fontFamily: c.fontFamily });
        const sub = c.subtitle ? this.text(`${layer.clipId}|s`, c.subtitle, 44 * u, card ? c.accent : c.color, c.lang, f.width * 0.8, f.x + f.width * 0.1, 0, { fontFamily: c.fontFamily }) : undefined;
        const gap = 36 * u;
        const total = title.height + (sub ? gap + sub.height : 0);
        const top = f.y + (f.height - total) / 2;
        title.position.set(f.x + f.width / 2, top);
        const lineW = Math.min(title.width, 520 * u) * e;
        const lineY = c.template === "outro" ? top - 40 * u : top + title.height + gap / 2 - 3 * u;
        node.addChild(new Graphics().roundRect(f.x + f.width / 2 - lineW / 2, lineY, lineW, 6 * u, 3 * u).fill(c.accent));
        node.addChild(rise(title, e));
        this.hit(layer.clipId, "title", { ...Compositor.textBox(title), y: top }, c.lang, (card ? 112 : 96) * u);
        if (sub) {
          sub.position.set(f.x + f.width / 2, top + title.height + gap);
          node.addChild(rise(sub, e2));
          this.hit(layer.clipId, "subtitle", { ...Compositor.textBox(sub), y: top + title.height + gap }, c.lang, 44 * u);
        }
        return node;
      }
    }
  }

  /**
   * Hide private information. The pixels under the region (everything already
   * drawn in the camera) are captured, then pixelated or blurred, so the
   * redaction follows the content while the camera zooms.
   */
  private drawRedact(layer: SceneLayer, camera: Container, W: number): Container {
    const c = layer.content as Content<"redact">;
    const f = layer.frame;
    const node = new Container();
    node.alpha = layer.opacity;
    const unit = W / 1920;
    if (c.mode === "solid") {
      node.addChild(new Graphics().roundRect(f.x, f.y, f.width, f.height, 4 * unit).fill(c.color));
      return node;
    }
    const block = Math.max(2, c.strength * unit);
    // Pixelate: render at 1/block resolution and scale up without smoothing.
    // Blur: render small, then blur strongly (nothing readable survives either way).
    const resolution = c.mode === "pixelate" ? 1 / block : 0.25;
    const pad = c.mode === "blur" ? c.strength * unit * 2 : 0;
    const region = new Rectangle(Math.floor(f.x - pad), Math.floor(f.y - pad), Math.ceil(f.width + pad * 2), Math.ceil(f.height + pad * 2));
    const saved = camera.filters;
    camera.filters = null;
    const tex = this.app.renderer.generateTexture({ target: camera, frame: region, resolution, antialias: false, clearColor: "#14151c" });
    camera.filters = saved ? [...saved] : null;
    tex.source.scaleMode = c.mode === "pixelate" ? "nearest" : "linear";
    this.frameTextures.push(tex);
    const sprite = new Sprite(tex);
    sprite.label = "redact";
    tex.label = "cached"; // freed with frameTextures, not with the sprite
    sprite.position.set(region.x, region.y);
    sprite.setSize(region.width, region.height);
    if (c.mode === "blur") sprite.filters = [this.blur(`redact${Math.round(c.strength)}|${unit.toFixed(2)}`, c.strength * unit * 0.5, 6)];
    const mask = new Graphics().roundRect(f.x, f.y, f.width, f.height, 4 * unit).fill(0xffffff);
    node.addChild(sprite, mask);
    sprite.mask = mask;
    return node;
  }

  private drawCaption(cap: SceneCaption, W: number, H: number): Container {
    const u = W / 1920;
    const st = cap.style;
    const size = st.fontSize * u;
    const maxW = (W * st.maxWidthPct) / 100;
    const text = this.text(`cap|${st.color}`, cap.text, size, st.color, cap.lang, maxW, (W - maxW) / 2, 0, { fontFamily: st.fontFamily });
    // Keep at most `rows` lines (the newest words).
    const lines = text.text.split("\n");
    const shown = lines.length > st.rows ? this.text(`cap|${st.color}|rows`, lines.slice(-st.rows).join("\n"), size, st.color, cap.lang, maxW + 1, (W - maxW - 1) / 2, 0, { fontFamily: st.fontFamily }) : text;
    const padX = size * 0.5, padY = size * (cap.lang === "bo" ? 0.15 : 0.25);
    const bh = shown.height + padY * 2;
    const y = st.position === "bottom" ? H - (H * st.offsetPct) / 100 - bh : (H * st.offsetPct) / 100;
    shown.position.set(W / 2, y + padY);
    this.hit(cap.clipId, "caption", Compositor.textBox(shown), cap.lang, size);
    const node = new Container();
    if (st.backgroundOpacity > 0) {
      const bw = shown.width + padX * 2;
      node.addChild(new Graphics().roundRect(W / 2 - bw / 2, y, bw, bh, size * 0.25).fill({ color: st.background, alpha: st.backgroundOpacity }));
    }
    node.addChild(shown);
    node.alpha = cap.alpha;
    node.pivot.set(W / 2, y + bh / 2);
    node.position.set(W / 2, y + bh / 2 + cap.dy * size);
    node.scale.set(cap.scale);
    return node;
  }

  /** Quiz card: question, lettered choices; the correct one lights up when revealed. */
  private drawQuiz(q: SceneQuiz, W: number, H: number): Container {
    const u = W / 1920;
    const e = easeOut(Math.min(1, q.localMs / 400));
    const out = Math.min(1, (q.showMs - q.localMs) / 300);
    const node = new Container();
    node.addChild(new Graphics().rect(0, 0, W, H).fill({ color: 0x000000, alpha: 0.45 }));
    const cw = Math.min(W - 160 * u, 1200 * u);
    const inner = cw - 120 * u;
    const question = this.text(`quiz|${q.markerId}|q`, q.question, 50 * u, "#ffffff", q.lang, inner, 0, 0, { bold: true });
    const letters = q.lang === "bo" ? ["ཀ", "ཁ", "ག", "ང", "ཅ", "ཆ"] : ["A", "B", "C", "D", "E", "F"];
    const rows = q.choices.map((choice, i) => this.text(`quiz|${q.markerId}|${i}`, choice, 38 * u, "#ffffff", q.lang, inner - 110 * u, 0, 0, { align: "left" }));
    const expl = q.revealed && q.explanation ? this.text(`quiz|${q.markerId}|x`, q.explanation, 32 * u, "#e8c56a", q.lang, inner, 0, 0) : undefined;
    const rowH = rows.map((r) => Math.max(84 * u, r.height + 28 * u));
    const ch = 70 * u + question.height + 40 * u + rowH.reduce((a, b) => a + b + 16 * u, 0) + (expl ? expl.height + 30 * u : 0) + 40 * u;
    const cx = (W - cw) / 2, cy = (H - ch) / 2;
    const card = new Container();
    card.addChild(new Graphics().roundRect(cx, cy, cw, ch, 28 * u).fill({ color: 0x14151c, alpha: 0.96 }).stroke({ color: 0xd4a94a, width: 3 * u }));
    question.position.set(W / 2, cy + 60 * u);
    card.addChild(question);
    let y = cy + 70 * u + question.height + 40 * u;
    rows.forEach((r, i) => {
      const correct = i === q.correct;
      const fill = q.revealed ? (correct ? 0x2f9e6a : 0x23252f) : 0x23252f;
      const row = new Container();
      row.alpha = q.revealed && !correct ? 0.55 : 1;
      row.addChild(new Graphics().roundRect(cx + 60 * u, y, inner, rowH[i]!, 16 * u).fill(fill).stroke({ color: correct && q.revealed ? 0x7be0a8 : 0x3a3d4a, width: 2 * u }));
      const badge = this.text(`quiz|L|${letters[i]}`, letters[i]!, 36 * u, "#1a1408", q.lang === "bo" ? "bo" : "en", 60 * u, 0, 0, { bold: true });
      row.addChild(new Graphics().circle(cx + 60 * u + 50 * u, y + rowH[i]! / 2, 26 * u).fill(0xd4a94a));
      badge.position.set(cx + 110 * u, y + rowH[i]! / 2 - badge.height / 2);
      row.addChild(badge);
      r.position.set(cx + 160 * u, y + (rowH[i]! - r.height) / 2);
      row.addChild(r);
      card.addChild(row);
      y += rowH[i]! + 16 * u;
    });
    if (expl) {
      expl.position.set(W / 2, y + 14 * u);
      card.addChild(expl);
    }
    card.pivot.set(W / 2, H / 2);
    card.position.set(W / 2, H / 2 + (1 - e) * 40 * u);
    card.scale.set(0.94 + 0.06 * e);
    node.addChild(card);
    node.alpha = Math.max(0, Math.min(e, out));
    return node;
  }

  // ---------------------------------------------------------------- cursor

  private cursorShape(style: SceneCursor["style"], size: number): Graphics {
    const g = new Graphics();
    if (style === "dot") {
      g.circle(0, 0, size * 0.3).fill({ color: 0xffffff }).stroke({ color: 0x141414, width: size * 0.07 });
      return g;
    }
    const pts = ARROW.map((v) => v * size);
    if (style === "pointer") g.poly(pts).fill(0xe8c56a).stroke({ color: 0x1b2350, width: size * 0.07, join: "round" });
    else g.poly(pts).fill(0xffffff).stroke({ color: 0x141414, width: size * 0.06, join: "round" });
    return g;
  }

  private drawCursor(c: SceneCursor): Container {
    const node = new Container();
    const place = (g: Container, dx = 0, dy = 0) => {
      g.position.set(c.x + dx, c.y + dy);
      g.rotation = c.rotation;
      g.scale.set(c.scale);
      return g;
    };
    // Motion trail (directional blur) behind the cursor.
    const speed = Math.hypot(c.blur.x, c.blur.y);
    if (speed > 2) {
      for (const [k, alpha] of [[1, 0.22], [0.66, 0.14], [0.33, 0.08]] as const) {
        const ghost = place(this.cursorShape(c.style, c.size), -c.blur.x * k, -c.blur.y * k);
        ghost.alpha = alpha;
        node.addChild(ghost);
      }
    }
    const shadow = place(this.cursorShape(c.style, c.size), 0, 2);
    shadow.tint = 0x000000;
    shadow.alpha = 0.35;
    shadow.filters = [this.blur("cursorShadow", 3, 2)];
    node.addChild(shadow, place(this.cursorShape(c.style, c.size)));
    return node;
  }

  private drawRings(c: SceneCursor): Graphics {
    const g = new Graphics();
    for (const r of c.rings) {
      if (r.alpha <= 0.01) continue;
      g.circle(r.x, r.y, r.radius).stroke({ color: c.ringColor, width: r.lineWidth, alpha: r.alpha });
    }
    return g;
  }

  /** Keystroke chips, bottom centre. */
  private drawKeys(c: SceneCursor, W: number, H: number): Container {
    const node = new Container();
    const unit = W / 1920;
    let x = W / 2;
    const chips = c.keys.map((k) => this.text(`key|${k.label}`, k.label, 34 * unit, "#ffffff", TIBETAN_RE.test(k.label) ? "bo" : "en", 2000, 0, 0));
    const widths = chips.map((t) => t.width + 36 * unit);
    x -= (widths.reduce((a, b) => a + b, 0) + 12 * unit * (chips.length - 1)) / 2;
    chips.forEach((text, i) => {
      const w = widths[i]!;
      const h = 64 * unit;
      const y = H - h - 48 * unit;
      const chip = new Container();
      chip.alpha = c.keys[i]!.opacity;
      chip.addChild(new Graphics().roundRect(x, y, w, h, 14 * unit).fill({ color: 0x101218, alpha: 0.82 }).stroke({ color: 0xe8c56a, width: 2 * unit, alpha: 0.6 }));
      text.position.set(x + w / 2, y + (h - text.height) / 2);
      chip.addChild(text);
      node.addChild(chip);
      x += w + 12 * unit;
    });
    return node;
  }

  // ---------------------------------------------------------------- media

  /**
   * The host supplies decoded media (an HTMLVideoElement already seeked to the
   * layer's source time). The preview and the exporter provide it the same way.
   */
  mediaElement?: (clipId: string) => HTMLVideoElement | HTMLImageElement | undefined;
  private readonly videoSources = new Map<HTMLVideoElement, VideoSource>();
  private readonly imageSources = new Map<HTMLImageElement, TextureSource>();

  private mediaSprite(layer: SceneLayer, el: HTMLVideoElement | HTMLImageElement): Sprite | null {
    const isVideo = el instanceof HTMLVideoElement;
    const W = isVideo ? el.videoWidth : el.naturalWidth;
    const H = isVideo ? el.videoHeight : el.naturalHeight;
    if (!W || !H) return null;
    let source: TextureSource;
    if (isVideo) {
      let v = this.videoSources.get(el);
      if (!v) {
        v = new VideoSource({ resource: el, autoPlay: false, autoLoad: true, updateFPS: 0 });
        this.videoSources.set(el, v);
        if (this.onlyNewVideoFrames) this.watchFrames(el);
        v.update();
      } else if (!this.onlyNewVideoFrames || this.freshFrame.get(el) !== false) {
        v.update(); // pull the current frame
        if (this.onlyNewVideoFrames) this.freshFrame.set(el, false);
      }
      source = v;
    } else {
      let img = this.imageSources.get(el);
      if (!img) {
        img = Texture.from(el).source;
        this.imageSources.set(el, img);
      }
      source = img;
    }
    const pl = placeMedia(W, H, layer.frame, layer.crop, layer.fit);
    const sprite = new Sprite(new Texture({ source, frame: new Rectangle(pl.sx, pl.sy, pl.sw, pl.sh) }));
    sprite.position.set(pl.dx, pl.dy);
    sprite.setSize(pl.dw, pl.dh);
    if (layer.mirror) {
      sprite.scale.x *= -1;
      sprite.x = pl.dx + pl.dw;
    }
    return sprite;
  }

  private text(id: string, value: string, size: number, color: string, lang: string, width: number, x: number, y: number, opts: TextOpts = {}): Text {
    const tibetan = lang === "bo";
    const align = opts.align ?? "center";
    const key = `${id}|${value}|${size}|${color}|${lang}|${width}|${opts.bold ? "b" : ""}${align}|${opts.fontFamily ?? ""}`;
    let text = this.textCache.get(key);
    if (!text) {
      const style = new TextStyle({
        fontFamily: fontStack(opts.fontFamily, tibetan),
        fontSize: size,
        fontWeight: opts.bold ? "700" : "400",
        fill: color,
        align,
        lineHeight: Math.round(size * (tibetan ? TIBETAN_LINE_HEIGHT : 1.3)),
        // Leave room above/below so tall Tibetan stacks are never clipped.
        padding: Math.round(size * 0.5),
      });
      // We wrap ourselves (Pixi's wrapping only breaks at spaces).
      const measure = (s: string) => CanvasTextMetrics.measureText(s, style).width;
      text = new Text({ text: wrapText(value, width, measure).join("\n"), style });
      text.anchor.set(align === "left" ? 0 : align === "right" ? 1 : 0.5, 0);
      if (this.textCache.size > 300) this.textCache.clear();
      this.textCache.set(key, text);
    }
    text.alpha = 1;
    text.position.set(align === "left" ? x : align === "right" ? x + width : x + width / 2, y);
    return text;
  }

  /**
   * Pixel statistics of a canvas rectangle (smoke test): how many pixels are
   * near a color, and the mean difference between neighbouring pixels ("detail").
   */
  regionStats(r: { x: number; y: number; width: number; height: number }, hex = "#000000", tolerance = 60): { near: number; detail: number; total: number } {
    const { pixels, width } = this.app.renderer.extract.pixels({ target: this.app.stage, frame: new Rectangle(0, 0, this.app.renderer.width, this.app.renderer.height) });
    const r0 = parseInt(hex.slice(1, 3), 16), g0 = parseInt(hex.slice(3, 5), 16), b0 = parseInt(hex.slice(5, 7), 16);
    let near = 0, detail = 0, total = 0;
    // r is in canvas (project) pixels; the renderer may be drawing at a smaller scale.
    const k = this.scale;
    const x0 = Math.max(0, Math.round(r.x * k)), y0 = Math.max(0, Math.round(r.y * k));
    const x1 = Math.min(width - 1, Math.round((r.x + r.width) * k)), y1 = Math.min(pixels.length / 4 / width - 1, Math.round((r.y + r.height) * k));
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) {
        const i = (y * width + x) * 4;
        if (Math.abs(pixels[i]! - r0) + Math.abs(pixels[i + 1]! - g0) + Math.abs(pixels[i + 2]! - b0) < tolerance) near++;
        const j = i + 4;
        detail += Math.abs(pixels[i]! - pixels[j]!) + Math.abs(pixels[i + 1]! - pixels[j + 1]!) + Math.abs(pixels[i + 2]! - pixels[j + 2]!);
        total++;
      }
    return { near, detail: total ? detail / total : 0, total };
  }

  /** Count pixels close to a color (smoke test / tests use this). */
  countPixelsNear(hex: string, tolerance = 40): number {
    const { pixels } = this.app.renderer.extract.pixels({ target: this.app.stage, frame: new Rectangle(0, 0, this.app.renderer.width, this.app.renderer.height) });
    const r0 = parseInt(hex.slice(1, 3), 16), g0 = parseInt(hex.slice(3, 5), 16), b0 = parseInt(hex.slice(5, 7), 16);
    let n = 0;
    for (let i = 0; i < pixels.length; i += 4)
      if (Math.abs(pixels[i]! - r0) + Math.abs(pixels[i + 1]! - g0) + Math.abs(pixels[i + 2]! - b0) < tolerance) n++;
    return n;
  }

  destroy(): void {
    this.app.destroy(false, { children: true });
  }
}

/** Rounded-rectangle outline as polygon points (circular corners). */
function circlePath(r: { x: number; y: number; width: number; height: number }, radius: number, steps = 8): number[] {
  const rad = Math.max(0, Math.min(radius, r.width / 2, r.height / 2));
  const pts: number[] = [];
  const corners = [
    [r.x + r.width - rad, r.y + rad, -Math.PI / 2],
    [r.x + r.width - rad, r.y + r.height - rad, 0],
    [r.x + rad, r.y + r.height - rad, Math.PI / 2],
    [r.x + rad, r.y + rad, Math.PI],
  ] as const;
  for (const [cx, cy, a0] of corners)
    for (let i = 0; i <= steps; i++) {
      const a = a0 + (i / steps) * (Math.PI / 2);
      pts.push(cx + rad * Math.cos(a), cy + rad * Math.sin(a));
    }
  return pts;
}
