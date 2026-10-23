import { useEffect, useRef, useState } from "react";
import { MENUS } from "@shared/menu";
import type { MenuCommand } from "@shared/ipc";
import { LANGUAGES, type Language } from "@shared/i18n";
import { displayShortcut } from "@shared/shortcuts";
import { useEditor } from "../store";
import { useShortcuts } from "../shortcuts";
import iconUrl from "../../../../build/icons/64x64.png";

const isMac = window.tdr.platform === "darwin";

/** "CmdOrCtrl+Shift+S" -> "Ctrl+Shift+S" / "⌘⇧S" for display. */
function prettyAccelerator(acc?: string): string {
  if (!acc) return "";
  if (!isMac) return acc.replace("CmdOrCtrl", "Ctrl");
  return acc.replace("CmdOrCtrl+", "⌘").replace("Shift+", "⇧").replace("Alt+", "⌥");
}

export function MenuBar({ onCommand }: { onCommand: (c: MenuCommand) => void }) {
  const t = useEditor((s) => s.t);
  const language = useEditor((s) => s.language);
  const shortcuts = useShortcuts((s) => s.map);
  const accel = (command: string | undefined, fallback?: string) =>
    command && command in shortcuts ? displayShortcut(shortcuts[command] ?? null, isMac) : prettyAccelerator(fallback);
  const [open, setOpen] = useState<number | null>(null);
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (!barRef.current?.contains(e.target as Node)) setOpen(null);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(null);
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", esc);
    };
  }, []);

  const choose = (command?: MenuCommand) => {
    setOpen(null);
    if (command) onCommand(command);
  };

  return (
    <header className={`titlebar ${isMac ? "mac" : ""}`}>
      <img className="app-icon" src={iconUrl} alt="" />
      {/* On macOS the native menu bar carries the menus; keep only the title here. */}
      {!isMac && (
        <nav className="menubar" ref={barRef} role="menubar">
          {MENUS.map((menu, i) => (
            <div key={menu.label} className="menu">
              <button
                role="menuitem"
                className={`menu-title ${open === i ? "active" : ""}`}
                onMouseDown={() => setOpen(open === i ? null : i)}
                onMouseEnter={() => open !== null && setOpen(i)}
              >
                {t(menu.label)}
              </button>
              {open === i && (
                <div className="menu-dropdown" role="menu">
                  {menu.items.map((item) => (
                    <div key={item.label}>
                      {item.separatorBefore && <div className="menu-separator" />}
                      <button
                        role="menuitem"
                        className="menu-item"
                        disabled={item.pending}
                        title={item.pending ? t("menu.pending") : undefined}
                        onClick={() => choose(item.command)}
                      >
                        <span>{t(item.label)}</span>
                        <span className="accelerator" lang="en">
                          {accel(item.command, item.accelerator)}
                        </span>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </nav>
      )}
      <div className="titlebar-drag">
        <span className="window-title">{t("app.name")}</span>
      </div>
      <LanguageSwitch language={language} />
    </header>
  );
}

function LanguageSwitch({ language }: { language: Language }) {
  const t = useEditor((s) => s.t);
  return (
    <div className="language-switch" role="radiogroup" aria-label={t("menu.language")}>
      {LANGUAGES.map((lang) => (
        <button
          key={lang}
          role="radio"
          aria-checked={language === lang}
          className={language === lang ? "selected" : ""}
          lang={lang}
          onClick={() => void window.tdr.setLanguage(lang)}
        >
          {lang === "en" ? "English" : "བོད་ཡིག"}
        </button>
      ))}
    </div>
  );
}
