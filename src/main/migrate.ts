/**
 * The app was renamed (v0.2.0): "Tibetan Design Recorder" -> "Nangchen T. Studio
 * Screen Recorder". Its data folder name follows the product name, so on the first
 * start under the new name the user's own data is copied over. The old folder is
 * left untouched (a safe backup); Chromium caches are not copied.
 */
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export const OLD_PRODUCT_NAME = "Tibetan Design Recorder";

/** What belongs to the user (everything else in the folder is Chromium cache). */
const USER_DATA = ["settings.json", "library.json", "transcribe.json", "extensions", "autosave", "Local Storage"];

/** Returns the names copied (empty when there was nothing to migrate). */
export function migrateUserData(appDataDir: string, newUserDataDir: string): string[] {
  const oldDir = join(appDataDir, OLD_PRODUCT_NAME);
  if (oldDir === newUserDataDir || !existsSync(oldDir) || existsSync(join(newUserDataDir, "settings.json"))) return [];
  mkdirSync(newUserDataDir, { recursive: true });
  const copied: string[] = [];
  for (const name of USER_DATA) {
    const from = join(oldDir, name);
    if (!existsSync(from)) continue;
    try {
      cpSync(from, join(newUserDataDir, name), { recursive: true, force: false, errorOnExist: false });
      copied.push(name);
    } catch (e) {
      console.warn("Could not move", name, "to the new data folder:", e);
    }
  }
  return copied;
}
