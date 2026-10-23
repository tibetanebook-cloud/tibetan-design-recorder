/**
 * Tibetan orthography checks for UI strings (used by a unit test and the
 * review report). They catch typing slips, not style:
 *  - nga-shad:     ང before a shad needs a tsheg: ང་།
 *  - ga-shad:      no shad after a final ག or ཀ (e.g. སྙོམས་སྒྲིག not སྙོམས་སྒྲིག།)
 *  - tsheg-space:  no space right after a tsheg inside a phrase
 *  - shad-space:   a shad followed by more Tibetan text needs a space
 *  - double-tsheg: ་་
 *  - double-shad:  ། ། (only valid at verse ends, never in UI text)
 *  - latin-punct:  ? ! , ; : next to Tibetan letters (use shad instead)
 *  - double-vowel: the same vowel sign twice in a row (a common PDF/IME artefact)
 *  - space-shad:   a space before a shad
 */
export interface LintProblem {
  rule: string;
  at: number;
}

const L = "[\\u0F40-\\u0FBC]"; // letters, subjoined letters, vowel signs
const RULES: [string, RegExp][] = [
  ["nga-shad", /ང[ཱ-྄]?།/g],
  ["ga-shad", new RegExp(`(?<=${L})[གཀ](?<!^.)[\\u0F71-\\u0F84]?།`, "g")],
  ["tsheg-space", new RegExp(`་ (?=${L})`, "g")],
  ["shad-space", new RegExp(`།(?=${L})`, "g")],
  ["double-tsheg", /་་/g],
  ["double-shad", /། ?།/g],
  ["latin-punct", new RegExp(`(?<=${L}|[་།])[?!,;:]|[?!,;:](?=${L})`, "g")],
  ["double-vowel", /([ིེུ-ཽྀ])\1/g],
  ["space-shad", / །/g],
];

export function lintTibetan(text: string): LintProblem[] {
  const out: LintProblem[] = [];
  for (const [rule, re] of RULES) {
    re.lastIndex = 0;
    for (let m = re.exec(text); m; m = re.exec(text)) {
      // A one-letter string like "ཀ" (an alphabet letter name) is not a syllable ending.
      if (rule === "ga-shad" && text.trim().length <= 2) continue;
      out.push({ rule, at: m.index });
    }
  }
  return out;
}

/** English terms (whole strings, case-insensitive) that got different Tibetan in different keys. */
export function inconsistencies(en: Record<string, string>, bo: Record<string, string>): { english: string; variants: { tibetan: string; keys: string[] }[] }[] {
  const byEnglish = new Map<string, Map<string, string[]>>();
  for (const [key, english] of Object.entries(en)) {
    const tib = bo[key];
    if (!tib || english.length > 40) continue; // only short terms; sentences legitimately vary
    const norm = english.trim().toLowerCase().replace(/[.…:]+$/, "");
    const forms = byEnglish.get(norm) ?? new Map<string, string[]>();
    const t = tib.replace(/[།\s…]+$/, "");
    forms.set(t, [...(forms.get(t) ?? []), key]);
    byEnglish.set(norm, forms);
  }
  return [...byEnglish]
    .filter(([, forms]) => forms.size > 1)
    .map(([english, forms]) => ({ english, variants: [...forms].map(([tibetan, keys]) => ({ tibetan, keys })) }));
}
