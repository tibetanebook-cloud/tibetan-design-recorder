/**
 * Fonts for text, callouts, titles and captions: a few built-in choices plus
 * every font installed on this computer (Local Font Access API). Tibetan fonts
 * are listed first; text always falls back to Noto Serif Tibetan.
 */

/** Fonts that are always there (bundled or part of every Windows/macOS/Linux desktop). */
export const BUILT_IN_FONTS = ["Noto Serif Tibetan", "Segoe UI", "Arial", "Georgia", "Times New Roman", "Courier New", "Impact"];

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
  const query = (window as unknown as { queryLocalFonts?: () => Promise<LocalFont[]> }).queryLocalFonts;
  if (!query) return null;
  try {
    const fonts = await query.call(window);
    const families = [...new Set(fonts.map((f) => f.family).filter((f) => f && f.length <= 200))].sort((a, b) => a.localeCompare(b));
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
