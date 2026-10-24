/**
 * Font choice for text, callouts, titles and captions: a searchable list of every
 * font installed on this computer (read when the list is first opened, which needs
 * a click), Tibetan fonts first, each name shown in its own font.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { BUNDLED_LATIN_FONTS, BUNDLED_TIBETAN_FONTS } from "../bundledFonts";
import { BUILT_IN_FONTS, computerFontsLoaded, ensureFont, isTibetanFont, loadComputerFonts, type FontList } from "../fonts";
import { useEditor } from "../store";

const TIBETAN = /[ༀ-࿿]/;
const safe = (f: string) => `"${f.replace(/["\\]/g, "")}"`;

export function FontPicker({ value, onChange }: { value: string | undefined; onChange: (family: string | undefined) => void }) {
  const t = useEditor((s) => s.t);
  const [fonts, setFonts] = useState<FontList | null>(computerFontsLoaded());
  const [state, setState] = useState<"idle" | "loading" | "denied">("idle");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);

  const pick = async (family: string | undefined) => {
    setOpen(false);
    setQuery("");
    await ensureFont(family);
    onChange(family);
  };

  // Opening the list is the click the system needs before it lets the page read the font list.
  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && !fonts && state !== "loading") {
      setState("loading");
      void loadComputerFonts().then((list) => {
        setFonts(list);
        setState(list ? "idle" : "denied");
      });
    }
  };

  useEffect(() => {
    if (!open) return;
    search.current?.focus();
    const away = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", away, true);
    return () => window.removeEventListener("pointerdown", away, true);
  }, [open]);

  // Tibetan (bundled first, then installed) · free fonts included with the app · everything else installed.
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const match = (f: string) => !q || f.toLowerCase().includes(q);
    const tibetan = [...new Set([...BUNDLED_TIBETAN_FONTS, ...(fonts?.tibetan ?? [])])].filter(match);
    const included = BUNDLED_LATIN_FONTS.filter(match);
    const shown = new Set([...tibetan, ...BUNDLED_LATIN_FONTS]);
    const system = fonts ? fonts.other : BUILT_IN_FONTS.filter((f) => !isTibetanFont(f));
    const other = system.filter((f) => !shown.has(f) && match(f));
    return { tibetan, included, other };
  }, [fonts, query]);

  const total = groups.tibetan.length + groups.included.length + groups.other.length;
  const first = groups.tibetan[0] ?? groups.included[0] ?? groups.other[0];
  const row = (f: string) => (
    <button key={f} type="button" role="option" aria-selected={value === f} className={`font-row${value === f ? " selected" : ""}`} data-font={f} onClick={() => void pick(f)}>
      <span className="font-name" lang={TIBETAN.test(f) ? "bo" : "en"} data-l10n-skip style={{ fontFamily: `${safe(f)}, var(--font-latin)` }}>
        {f}
      </span>
      {isTibetanFont(f) && (
        <span className="font-sample" lang="bo" style={{ fontFamily: `${safe(f)}, var(--font-tibetan)` }}>
          ཀ་ཁ་ག་ང་།
        </span>
      )}
    </button>
  );

  return (
    <div className="font-picker" ref={box}>
      <span className="prop-label">{t("font.label")}</span>
      <button type="button" className="font-current" data-font-picker aria-haspopup="listbox" aria-expanded={open} onClick={toggle}>
        <span lang={value ? (TIBETAN.test(value) ? "bo" : "en") : undefined} data-l10n-skip={value ? true : undefined} style={{ fontFamily: value ? `${safe(value)}, var(--font-latin)` : undefined }}>
          {value ?? t("font.default")}
        </span>
        <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="font-popover" role="listbox" aria-label={t("font.label")}>
          <input
            ref={search}
            className="font-search"
            type="search"
            placeholder={t("font.search")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Escape") setOpen(false);
              if (e.key === "Enter" && first) void pick(first);
            }}
          />
          <div className="font-list">
            {!query && (
              <button type="button" role="option" aria-selected={!value} className={`font-row${!value ? " selected" : ""}`} onClick={() => void pick(undefined)}>
                <span className="font-name">{t("font.default")}</span>
              </button>
            )}
            {state === "loading" && <p className="hint">{t("font.loading")}</p>}
            {groups.tibetan.length > 0 && <div className="font-group">{t("font.tibetan")}</div>}
            {groups.tibetan.map(row)}
            {groups.included.length > 0 && <div className="font-group">{t("font.included")}</div>}
            {groups.included.map(row)}
            {groups.other.length > 0 && (
              <div className="font-group">
                {fonts ? t("font.computer") : t("font.builtIn")} <span lang="en">({groups.other.length})</span>
              </div>
            )}
            {groups.other.map(row)}
            {total === 0 && state !== "loading" && <p className="hint">{t("font.none")}</p>}
          </div>
          {state === "denied" && <p className="hint">{t("font.denied")}</p>}
        </div>
      )}
    </div>
  );
}
