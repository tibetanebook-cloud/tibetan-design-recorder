/**
 * UI strings live in en.json / bo.json under identical keys. Tibetan strings are
 * stored exactly as written — no trimming, normalization or line re-wrapping —
 * so tsheg (་) and shad (།) always reach the screen intact.
 */
import en from "./en.json";
import bo from "./bo.json";

export const LANGUAGES = ["en", "bo"] as const;
export type Language = (typeof LANGUAGES)[number];
export const DEFAULT_LANGUAGE: Language = "bo";

export type Messages = typeof en;
export const MESSAGES: Record<Language, Messages> = { en, bo };

export const isLanguage = (value: unknown): value is Language =>
  typeof value === "string" && (LANGUAGES as readonly string[]).includes(value);

/** Look up "menu.file"-style keys; falls back to English, then to the key. */
export function translate(language: Language, key: string): string {
  const find = (messages: unknown): string | undefined => {
    let node = messages;
    for (const part of key.split(".")) {
      if (typeof node !== "object" || node === null) return undefined;
      node = (node as Record<string, unknown>)[part];
    }
    return typeof node === "string" ? node : undefined;
  };
  return find(MESSAGES[language]) ?? find(MESSAGES.en) ?? key;
}

/** Every leaf key, e.g. ["app.name", "menu.file", …]. */
export function messageKeys(messages: unknown, prefix = ""): string[] {
  if (typeof messages !== "object" || messages === null) return [];
  return Object.entries(messages).flatMap(([k, v]) =>
    typeof v === "string" ? [`${prefix}${k}`] : messageKeys(v, `${prefix}${k}.`),
  );
}
