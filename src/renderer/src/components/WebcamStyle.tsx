/**
 * Webcam style controls: bubble shape and proportions, border, and filters
 * (beauty + one-click looks + fine adjustments).
 */
import type { Project, WebcamBorder, WebcamLayout, WebcamLook } from "@shared/project/schema";
import { BORDER_STYLES, BUBBLE_ASPECTS, LOOK_PRESETS, shapeOutline, WEBCAM_SHAPES, type WebcamShape } from "@shared/effects/webcamStyle";
import { useEditor } from "../store";
import { pct, Section, Slider } from "./Inspector";

const setWebcam = (patch: Partial<WebcamLayout>) => (p: Project) => ({ ...p, webcam: { ...p.webcam, ...patch } });

/** Small SVG of each shape for the picker. */
function ShapeIcon({ shape }: { shape: WebcamShape }) {
  const pts = shapeOutline(shape, { x: 2, y: 2, width: 20, height: 20 }, 0.25, 32);
  const d = pts.reduce((s, v, i) => s + (i % 2 === 0 ? `${i === 0 ? "M" : "L"}${v.toFixed(1)} ` : `${v.toFixed(1)} `), "") + "Z";
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path d={d} fill="currentColor" opacity="0.85" />
    </svg>
  );
}

export function WebcamShapePanel() {
  const t = useEditor((s) => s.t);
  const edit = useEditor((s) => s.edit);
  const w = useEditor((s) => s.history.present.webcam);
  const current: WebcamShape = w.shape ?? (w.roundness >= 100 ? "circle" : "rounded");
  const border = w.border;
  const setBorder = (patch: Partial<WebcamBorder>) => setWebcam({ border: { ...border, ...patch } });
  return (
    <Section title={t("webcamStyle.title")}>
      <span className="prop-label">{t("webcamStyle.shape")}</span>
      <div className="shape-grid" role="radiogroup" aria-label={t("webcamStyle.shape")}>
        {WEBCAM_SHAPES.map((s) => (
          <button key={s} role="radio" aria-checked={current === s} className={current === s ? "selected" : ""} title={t(`webcamShape.${s}`)} aria-label={t(`webcamShape.${s}`)} data-shape={s} onClick={() => edit("webcamStyle.shape", setWebcam({ shape: s }))}>
            <ShapeIcon shape={s} />
          </button>
        ))}
      </div>
      {current === "rounded" && <Slider label={t("inspector.roundness")} value={w.roundness} min={0} max={99} step={1} format={(v) => `${Math.round(v)}%`} onPreview={(roundness) => setWebcam({ roundness })} />}
      <label className="prop">
        <span className="prop-label">{t("webcamStyle.aspect")}</span>
        <select value={w.aspect} lang="en" onChange={(e) => edit("webcamStyle.aspect", setWebcam({ aspect: e.target.value as WebcamLayout["aspect"] }))}>
          {BUBBLE_ASPECTS.map((a) => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>
      </label>

      <span className="prop-label">{t("webcamStyle.border")}</span>
      <div className="border-grid" role="radiogroup" aria-label={t("webcamStyle.border")}>
        {BORDER_STYLES.map((b) => (
          <button key={b} role="radio" aria-checked={border.style === b} className={`border-swatch b-${b} ${border.style === b ? "selected" : ""}`} data-border={b} style={{ ["--c1" as string]: border.color, ["--c2" as string]: border.color2 }} onClick={() => edit("webcamStyle.border", setBorder({ style: b }))}>
            <span className="swatch" />
            <span className="lib-label">{t(`border.${b}`)}</span>
          </button>
        ))}
      </div>
      {border.style !== "none" && (
        <>
          <Slider label={t("shape.stroke")} value={border.width} min={1} max={30} step={0.5} format={(v) => `${v} px`} onPreview={(width) => setBorder({ width })} />
          <div className="prop-grid">
            <label className="prop">
              <span className="prop-label">{t("inspector.color")}</span>
              <input type="color" value={border.color} onChange={(e) => edit("webcamStyle.border", setBorder({ color: e.target.value }))} />
            </label>
            {["double", "gradient", "neon"].includes(border.style) && (
              <label className="prop">
                <span className="prop-label">{t("webcamStyle.color2")}</span>
                <input type="color" value={border.color2} onChange={(e) => edit("webcamStyle.border", setBorder({ color2: e.target.value }))} />
              </label>
            )}
          </div>
          <div className="preset-row">
            {([["#d4a94a", "#9b1b30"], ["#ffffff", "#4f8cff"], ["#ff4fa3", "#7b5cff"], ["#2fd3c6", "#1b6dff"], ["#ffcf3a", "#ff6b2c"], ["#111111", "#d4a94a"]] as const).map(([a, b]) => (
              <button key={a + b} className="color-pair" lang="en" data-l10n-skip style={{ background: `linear-gradient(135deg, ${a} 50%, ${b} 50%)` }} title={`${a} / ${b}`} aria-label={`${a} / ${b}`} onClick={() => edit("webcamStyle.border", setBorder({ color: a, color2: b }))} />
            ))}
          </div>
        </>
      )}
    </Section>
  );
}

const BEAUTY: (keyof WebcamLook)[] = ["smooth", "brighten", "sharpen"];
const ADJUST: { key: keyof WebcamLook; min: number }[] = [
  { key: "brightness", min: -1 },
  { key: "contrast", min: -1 },
  { key: "saturation", min: -1 },
  { key: "temperature", min: -1 },
  { key: "tint", min: -1 },
  { key: "fade", min: 0 },
  { key: "vignette", min: 0 },
];

export function WebcamLookPanel() {
  const t = useEditor((s) => s.t);
  const edit = useEditor((s) => s.edit);
  const look = useEditor((s) => s.history.present.webcam.look);
  const setLook = (patch: Partial<WebcamLook>) => setWebcam({ look: { ...look, ...patch } });
  const signed = (v: number) => `${v > 0 ? "+" : ""}${Math.round(v * 100)}`;
  return (
    <Section title={t("webcamLook.title")}>
      <span className="prop-label">{t("webcamLook.beauty")}</span>
      {BEAUTY.map((k) => (
        <Slider key={k} label={t(`webcamLook.${k}`)} value={look[k] as number} min={0} max={1} step={0.01} format={pct} onPreview={(v) => setLook({ [k]: v })} />
      ))}
      <span className="prop-label">{t("webcamLook.looks")}</span>
      <div className="look-grid" role="radiogroup" aria-label={t("webcamLook.looks")}>
        {LOOK_PRESETS.map((p) => (
          <button key={p} role="radio" aria-checked={look.preset === p} className={`look-chip l-${p} ${look.preset === p ? "selected" : ""}`} data-look={p} onClick={() => edit("webcamLook.preset", setLook({ preset: p }))}>
            <span className="swatch" />
            <span className="lib-label">{t(`look.${p}`)}</span>
          </button>
        ))}
      </div>
      <span className="prop-label">{t("webcamLook.adjust")}</span>
      {ADJUST.map(({ key, min }) => (
        <Slider key={key} label={t(`webcamLook.${key}`)} value={look[key] as number} min={min} max={1} step={0.01} format={min < 0 ? signed : pct} onPreview={(v) => setLook({ [key]: v })} />
      ))}
      <div className="prop-buttons">
        <button onClick={() => edit("webcamLook.reset", setWebcam({ look: { ...look, preset: "none", smooth: 0, brighten: 0, sharpen: 0, brightness: 0, contrast: 0, saturation: 0, temperature: 0, tint: 0, fade: 0, vignette: 0 } }))}>
          {t("inspector.reset")}
        </button>
      </div>
    </Section>
  );
}
