import "@fontsource/noto-serif-tibetan/400.css";
import "@fontsource/noto-serif-tibetan/700.css";
import "./styles/theme.css";
import "./styles/timeline.css";
import "./styles/effects.css";
import "./styles/tools.css";
import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
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
    node = <App />;
  }
  if (view) document.body.classList.add(`view-${view}`);
  createRoot(document.getElementById("root")!).render(<StrictMode>{node}</StrictMode>);
}

void boot();
