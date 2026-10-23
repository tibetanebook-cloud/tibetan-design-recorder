/** Edit ▸ Keyboard Shortcuts: click a shortcut, press the new keys; conflicts are shown. */
import { useEffect, useState } from "react";
import { conflicts, displayShortcut, eventToShortcut, SHORTCUT_ACTIONS } from "@shared/shortcuts";
import { useEditor } from "../store";
import { useShortcuts } from "../shortcuts";

const isMac = window.tdr.platform === "darwin";

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  const t = useEditor((s) => s.t);
  const { map, setKey, reset, resetAll } = useShortcuts();
  const [capturing, setCapturing] = useState<string | null>(null);

  useEffect(() => {
    if (!capturing) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") return setCapturing(null);
      if (e.key === "Backspace" && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
        setKey(capturing, null);
        return setCapturing(null);
      }
      const key = eventToShortcut(e, isMac);
      if (!key) return;
      setKey(capturing, key);
      setCapturing(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [capturing, setKey]);

  const label = (id: string) => t(SHORTCUT_ACTIONS.find((a) => a.id === id)?.label ?? id);

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal wide" role="dialog" aria-labelledby="shortcuts-title" data-shortcuts-dialog>
        <h2 id="shortcuts-title">{t("shortcuts.title")}</h2>
        <div className="shortcut-table">
          <div className="shortcut-row head">
            <span>{t("shortcuts.action")}</span>
            <span>{t("shortcuts.key")}</span>
            <span />
          </div>
          {SHORTCUT_ACTIONS.map((a) => {
            const clash = conflicts(map, a.id);
            return (
              <div key={a.id} className={`shortcut-row ${clash.length ? "clash" : ""}`}>
                <span>{t(a.label)}</span>
                <button className={`shortcut-key ${capturing === a.id ? "capturing" : ""}`} onClick={() => setCapturing(a.id)}>
                  {capturing === a.id ? t("shortcuts.press") : <kbd lang="en">{displayShortcut(map[a.id] ?? null, isMac) || t("shortcuts.none")}</kbd>}
                </button>
                <span className="shortcut-extra">
                  {clash.length > 0 && (
                    <span className="clash-note">
                      ⚠ {t("shortcuts.conflict")}: {clash.map(label).join(", ")}
                    </span>
                  )}
                  {map[a.id] !== a.defaultKey && (
                    <button className="link-btn" onClick={() => reset(a.id)}>
                      {t("shortcuts.reset")}
                    </button>
                  )}
                </span>
              </div>
            );
          })}
        </div>
        <div className="modal-actions">
          <button onClick={resetAll}>{t("shortcuts.resetAll")}</button>
          <button className="primary" onClick={onClose}>
            {t("inspector.ok")}
          </button>
        </div>
      </div>
    </div>
  );
}
