/**
 * Font choice for text, callouts, titles and captions. Lists the built-in fonts;
 * one click adds every font installed on this computer (Tibetan fonts first).
 */
import { useState } from "react";
import { BUILT_IN_FONTS, computerFontsLoaded, ensureFont, loadComputerFonts, type FontList } from "../fonts";
import { useEditor } from "../store";

export function FontPicker({ value, onChange }: { value: string | undefined; onChange: (family: string | undefined) => void }) {
  const t = useEditor((s) => s.t);
  const [fonts, setFonts] = useState<FontList | null>(computerFontsLoaded());
  const [state, setState] = useState<"idle" | "loading" | "denied">("idle");
  const pick = async (family: string) => {
    const f = family || undefined;
    await ensureFont(f);
    onChange(f);
  };
  const loadMine = async () => {
    setState("loading");
    const list = await loadComputerFonts();
    setFonts(list);
    setState(list ? "idle" : "denied");
  };
  const known = new Set([...BUILT_IN_FONTS, ...(fonts?.tibetan ?? []), ...(fonts?.other ?? [])]);
  return (
    <div className="font-picker">
      <label className="prop">
        <span className="prop-label">{t("font.label")}</span>
        <select value={value ?? ""} data-font-picker onChange={(e) => void pick(e.target.value)} style={{ fontFamily: value ? `"${value}", var(--font-latin)` : undefined }}>
          <option value="">{t("font.default")}</option>
          {value && !known.has(value) && <option value={value} lang="en" data-l10n-skip>{value}</option>}
          <optgroup label={t("font.builtIn")}>
            {BUILT_IN_FONTS.map((f) => (
              <option key={f} value={f} lang={/[ༀ-࿿]/.test(f) ? "bo" : "en"} data-l10n-skip style={{ fontFamily: `"${f}"` }}>
                {f}
              </option>
            ))}
          </optgroup>
          {fonts && fonts.tibetan.length > 0 && (
            <optgroup label={t("font.tibetan")}>
              {fonts.tibetan.map((f) => (
                <option key={f} value={f} lang={/[ༀ-࿿]/.test(f) ? "bo" : "en"} data-l10n-skip style={{ fontFamily: `"${f}"` }}>
                  {f}
                </option>
              ))}
            </optgroup>
          )}
          {fonts && (
            <optgroup label={t("font.computer")}>
              {fonts.other.map((f) => (
                <option key={f} value={f} lang={/[ༀ-࿿]/.test(f) ? "bo" : "en"} data-l10n-skip style={{ fontFamily: `"${f}"` }}>
                  {f}
                </option>
              ))}
            </optgroup>
          )}
        </select>
      </label>
      {!fonts && (
        <button className="font-load" data-font-load onClick={() => void loadMine()} disabled={state === "loading"}>
          {state === "loading" ? t("font.loading") : t("font.loadComputer")}
        </button>
      )}
      {state === "denied" && <p className="hint">{t("font.denied")}</p>}
    </div>
  );
}
