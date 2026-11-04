// Free fonts bundled with the app (Noto Serif Tibetan, Jomolhari, Uchen + English fonts).
import "./bundledFonts";
import "./styles/theme.css";
import "./styles/timeline.css";
import "./styles/effects.css";
import "./styles/tools.css";
import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { useEditor } from "./store";

/** One bundle, several windows: ?view=hud|bubble|region|capture, default = editor. */
const params = new URLSearchParams(location.search);
const view = params.get("view");

async function boot(): Promise<void> {
  if (view === "capture") {
    await import("./windows/capture");
    return;
  }
  // Floating windows follow the app language too.
  const settings = await window.tdr.getSettings();
  useEditor.getState().setLanguage(settings.language);
  document.documentElement.lang = settings.language;
  window.tdr.onLanguage((lang) => {
    useEditor.getState().setLanguage(lang);
    document.documentElement.lang = lang;
  });

  let node: ReactNode;
  if (view === "hud") {
    const { Hud } = await import("./windows/Hud");
    node = <Hud />;
  } else if (view === "bubble") {
    const { Bubble } = await import("./windows/Bubble");
    node = <Bubble deviceId={params.get("device") ?? ""} />;
  } else if (view === "region") {
    const { RegionSelector } = await import("./windows/RegionSelector");
    node = <RegionSelector />;
  } else {
    // Only the editor window loads the editor (the small recording windows open faster).
    const { App } = await import("./App");
    node = <App />;
    // Read the installed fonts once the app is up, so the font list is ready when first opened.
    const { loadComputerFonts } = await import("./fonts");
    setTimeout(() => void loadComputerFonts(), 1500);
  }
  if (view) document.body.classList.add(`view-${view}`);
  createRoot(document.getElementById("root")!).render(<StrictMode>{node}</StrictMode>);
}

void boot();
