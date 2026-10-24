/**
 * Process-wide security rules (see docs/SECURITY.md):
 *  - pages may only show the app's own UI: no new windows, no navigation away,
 *    no <webview>;
 *  - camera, microphone, screen and font permissions only for the app's own pages;
 *  - the renderer can only write files the user chose in a dialog (or the app's
 *    own folders), so a compromised page cannot overwrite arbitrary files.
 */
import { app, type Session, type WebContents } from "electron";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/** True for URLs of the app's own pages (built files, or the dev server in development). */
export function isAppUrl(url: string): boolean {
  if (!url) return false;
  const dev = process.env.ELECTRON_RENDERER_URL;
  if (dev && url.startsWith(new URL(dev).origin + "/")) return true;
  const rendererDir = pathToFileURL(join(__dirname, "../renderer")).href + "/";
  return url.startsWith(rendererDir);
}

/** Window/navigation lock-down for every web contents the app creates. */
export function hardenWebContents(): void {
  app.on("web-contents-created", (_e, wc: WebContents) => {
    wc.setWindowOpenHandler(() => ({ action: "deny" }));
    wc.on("will-navigate", (event, url) => {
      if (!isAppUrl(url)) event.preventDefault();
    });
    wc.on("will-redirect", (event, url) => {
      if (!isAppUrl(url)) event.preventDefault();
    });
    wc.on("will-attach-webview", (event) => event.preventDefault());
  });
}

const ALLOWED_PERMISSIONS = new Set(["media", "display-capture", "local-fonts", "clipboard-sanitized-write"]);

/** Media/screen/font permissions only for the app's own pages; everything else denied. */
export function restrictPermissions(session: Session): void {
  session.setPermissionRequestHandler((wc, permission, callback) => callback(ALLOWED_PERMISSIONS.has(permission) && isAppUrl(wc.getURL())));
  session.setPermissionCheckHandler((wc, permission) => ALLOWED_PERMISSIONS.has(permission) && !!wc && isAppUrl(wc.getURL()));
}

export { READABLE_EXTENSIONS, TRANSCRIBABLE_EXTENSIONS, WritePolicy } from "./policy";
