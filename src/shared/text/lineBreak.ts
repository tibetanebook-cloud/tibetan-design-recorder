/**
 * Line breaking that is correct for Tibetan as well as Latin text.
 *
 * Tibetan has no spaces between words: the break opportunity is after a tsheg
 * (་ U+0F0B) or after a shad (། U+0F0D) and the space that may follow it. A line
 * must never begin with a shad or tsheg, and stacked letters (subjoined U+0F90–
 * U+0FBC, vowel signs U+0F71–U+0F84) always stay with their base letter because
 * we only ever split at the opportunities below. The text itself is never changed:
 * joining the returned lines with "" (Tibetan) reproduces the input exactly.
 */
const TSHEG = "་";
const NO_LINE_START = /^[་-༔༴༻༽]/;

/** Split into unbreakable segments; each segment ends at a break opportunity. */
export function breakSegments(text: string): string[] {
  const segments: string[] = [];
  let current = "";
  const chars = Array.from(text);
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i]!;
    current += ch;
    const next = chars[i + 1];
    if (ch === "\n") {
      segments.push(current);
      current = "";
      continue;
    }
    const tibetanBreak = ch === TSHEG || ch === "།" || ch === "༎";
    const spaceBreak = ch === " " && next !== undefined && next !== " ";
    // Keep "། " together, and never leave a shad/tsheg to start the next line.
    if ((tibetanBreak || spaceBreak) && next !== undefined && !NO_LINE_START.test(next) && next !== " ") {
      segments.push(current);
      current = "";
    }
  }
  if (current) segments.push(current);
  return segments;
}

/**
 * Greedy wrap: pack segments into lines no wider than maxWidth according to
 * `measure`. A single segment wider than the line is kept whole (never split
 * inside a syllable).
 */
export function wrapText(text: string, maxWidth: number, measure: (s: string) => number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const segment of breakSegments(text)) {
    if (segment.endsWith("\n")) {
      lines.push(line + segment.slice(0, -1));
      line = "";
      continue;
    }
    if (line && measure((line + segment).trimEnd()) > maxWidth) {
      lines.push(line);
      line = segment;
    } else {
      line += segment;
    }
  }
  if (line) lines.push(line);
  return lines;
}
