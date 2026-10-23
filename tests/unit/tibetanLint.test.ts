import { describe, expect, it } from "vitest";
import { MESSAGES, messageKeys, translate } from "@shared/i18n";
import { inconsistencies, lintTibetan } from "@shared/i18n/lint";

describe("Tibetan lint rules", () => {
  it("catches the common slips", () => {
    const rules = (s: string) => lintTibetan(s).map((p) => p.rule);
    expect(rules("སྒྲིག་འགོད།")).toEqual([]);
    expect(rules("རྒྱང།")).toEqual(["nga-shad"]);
    expect(rules("རྒྱང་།")).toEqual([]);
    expect(rules("སྙོམས་སྒྲིག།")).toEqual(["ga-shad"]);
    expect(rules("ཀ")).toEqual([]);
    expect(rules("ཁ་ དོག")).toEqual(["tsheg-space"]);
    expect(rules("ལེགས་གྲུབ།ཁ་ཕྱེ།")).toEqual(["shad-space"]);
    expect(rules("ཡི་གེ?")).toEqual(["latin-punct"]);
    expect(rules("ཡིིག")).toEqual(["double-vowel"]);
    expect(rules("ཡི་་གེ")).toEqual(["double-tsheg"]);
  });
});

describe("the app's Tibetan strings", () => {
  const keys = messageKeys(MESSAGES.bo);
  it("pass the spelling/punctuation lint", () => {
    const problems = keys.flatMap((k) => lintTibetan(translate("bo", k)).map((p) => `${p.rule}: ${k} = ${translate("bo", k)}`));
    expect(problems).toEqual([]);
  });

  it("translate the same short English term the same way (listed exceptions are deliberate)", () => {
    const en = Object.fromEntries(keys.map((k) => [k, translate("en", k)]));
    const bo = Object.fromEntries(keys.map((k) => [k, translate("bo", k)]));
    const allowed = new Set(ALLOWED_VARIANTS);
    const found = inconsistencies(en, bo).filter((x) => !allowed.has(x.english)).map((x) => `${x.english}: ${x.variants.map((v) => `${v.tibetan} [${v.keys.join(",")}]`).join(" | ")}`);
    expect(found).toEqual([]);
  });
});

/** English words whose Tibetan differs by context on purpose (see docs/i18n/TIBETAN_REVIEW.md). */
const ALLOWED_VARIANTS: string[] = [
  "left", // time left (ལྷག་མ) vs the left side (གཡོན)
  "from", // gradient start colour vs caption source
  "zoom", // zoom amount vs the zoom transition
  "wipe", // transition that replaces vs text that is revealed
  "english", // the language switch names each language in its own script
  "captions", // the side-panel tab uses the short form for space
];
