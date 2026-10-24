/**
 * Fonts for text, callouts, titles and captions: the free fonts bundled with the
 * app plus every font installed on this computer (read at startup). Tibetan fonts
 * are listed first; text always falls back to Noto Serif Tibetan.
 */
import { BUNDLED_FONTS } from "./bundledFonts";

/** Fonts that are always there: bundled with the app, or part of every Windows/macOS desktop. */
export const BUILT_IN_FONTS = [...BUNDLED_FONTS, "Segoe UI", "Arial", "Georgia", "Times New Roman", "Courier New", "Impact"];

const TIBETAN_NAME = /tibet|jomolhari|monlam|qomolangma|himalaya|kailasa|uchen|umay|sambhota|dzongkha|wangdi|yagpo|pecha|tsuyig|ddc|tcrc|ཡིག/i;

export const isTibetanFont = (family: string) => TIBETAN_NAME.test(family);

export interface FontList {
  tibetan: string[];
  other: string[];
}

interface LocalFont {
  family: string;
}

let cache: FontList | null = null;

/** Families installed on this computer, or null if the system did not allow reading them. */
export async function loadComputerFonts(): Promise<FontList | null> {
  if (cache) return cache;
  pending ??= readComputerFonts().finally(() => (pending = null));
  return pending;
}

let pending: Promise<FontList | null> | null = null;

async function readComputerFonts(): Promise<FontList | null> {
  try {
    // Through the app (works at startup, no click needed); else ask the page directly (needs a click).
    let names = await window.tdr.listFonts().catch(() => null);
    if (!names) {
      const query = (window as unknown as { queryLocalFonts?: () => Promise<LocalFont[]> }).queryLocalFonts;
      if (!query) return null;
      names = (await query.call(window)).map((f) => f.family);
    }
    const families = [...new Set(names.filter((f) => f && f.length <= 200))].sort((a, b) => a.localeCompare(b));
    cache = { tibetan: families.filter(isTibetanFont), other: families.filter((f) => !isTibetanFont(f)) };
    return cache;
  } catch {
    return null;
  }
}

export const computerFontsLoaded = () => cache;

/** Make sure a chosen font is ready before Pixi rasterizes text with it. */
export async function ensureFont(family: string | undefined, sample = "Aa བོད"): Promise<void> {
  if (!family) return;
  try {
    await document.fonts.load(`48px "${family.replace(/["\\]/g, "")}"`, sample);
  } catch {
    /* an installed system font needs no loading */
  }
}
