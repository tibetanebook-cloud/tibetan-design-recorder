import { describe, expect, it } from "vitest";
import { MESSAGES, messageKeys, translate } from "@shared/i18n";
import { MENUS } from "@shared/menu";
import { breakSegments, wrapText } from "@shared/text/lineBreak";

const TIBETAN_LETTER = /[ཀ-ྼ]/u;

describe("UI strings", () => {
  it("English and Tibetan have exactly the same keys", () => {
    expect(messageKeys(MESSAGES.bo).sort()).toEqual(messageKeys(MESSAGES.en).sort());
  });

  it("every Tibetan string is non-empty and actually Tibetan (except proper names)", () => {
    // Proper names and the X/Y coordinate axes stay in Latin letters.
    const allowedLatin = new Set(["language.english", "inspector.x", "inspector.y"]);
    for (const key of messageKeys(MESSAGES.bo)) {
      const value = translate("bo", key);
      expect(value.trim(), key).not.toBe("");
      if (!allowedLatin.has(key)) expect(TIBETAN_LETTER.test(value), key).toBe(true);
    }
  });

  it("Tibetan strings have no stray spaces inside words and no doubled tsheg", () => {
    for (const key of messageKeys(MESSAGES.bo)) {
      const value = translate("bo", key);
      expect(value, key).not.toMatch(/[ཀ-ྼ] [ཀ-ྼ]/u);
      expect(value, key).not.toMatch(/་་/u);
    }
  });

  it("the app name is the owner's chosen Tibetan name", () => {
    expect(translate("bo", "app.name")).toBe("ནང་ཆེན་བཀྲིས་གློག་ཀླད་མཐོང་རིས་འཛིན་ཆས།");
    expect(translate("en", "app.name")).toBe("Nangchen T. Studio Screen Recorder");
  });

  it("every menu and menu item label is translated", () => {
    for (const menu of MENUS) {
      for (const key of [menu.label, ...menu.items.map((i) => i.label)]) {
        expect(translate("bo", key), key).not.toBe(key);
        expect(translate("en", key), key).not.toBe(key);
      }
    }
  });
});

describe("Tibetan line breaking", () => {
  const sentence = "བོད་ཀྱི་བརྙན་ལེན། སློབ་ཁྲིད་བརྙན་ཟློས་ལེན་པ་དང་རྩོམ་སྒྲིག";
  const measure = (s: string) => Array.from(s).length;

  it("never changes the text (tsheg and shad stay intact)", () => {
    expect(breakSegments(sentence).join("")).toBe(sentence);
    expect(wrapText(sentence, 12, measure).join("")).toBe(sentence);
  });

  it("breaks only after a tsheg, shad or space", () => {
    for (const line of wrapText(sentence, 12, measure).slice(0, -1)) expect(line).toMatch(/[་། ]$/u);
  });

  it("never starts a line with a shad or tsheg", () => {
    const text = "ཀ་ཁ་ག། ང་ཅ་ཆ།";
    for (let width = 1; width < 12; width++)
      for (const line of wrapText(text, width, measure)) expect(line).not.toMatch(/^[་།]/u);
  });

  it("keeps stacked letters with their syllable", () => {
    const stacks = "བསྒྲུབས་པ་སྐྱེས་བུ།";
    for (const seg of breakSegments(stacks)) expect(seg).not.toMatch(/^[ཱ-ྼ]/u);
  });

  it("still wraps Latin text at spaces", () => {
    expect(wrapText("Record and edit teaching videos", 12, measure)).toEqual(["Record and ", "edit ", "teaching ", "videos"]);
  });
});

describe("every translation key used in the code exists", () => {
  it("t('…') and label: '…' keys in the renderer and shared code resolve in both languages", async () => {
    const { readdirSync, readFileSync, statSync } = await import("node:fs");
    const { join } = await import("node:path");
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(name)) files.push(p);
      }
    };
    walk(join(__dirname, "../../src/renderer/src"));
    walk(join(__dirname, "../../src/shared"));
    const keys = new Set<string>();
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/\bt\(\s*"([a-z][A-Za-z0-9]*(?:\.[A-Za-z0-9-]+)+)"\s*\)/g)) keys.add(m[1]!);
      for (const m of src.matchAll(/\blabel: "([a-z][A-Za-z0-9]*(?:\.[A-Za-z0-9-]+)+)"/g)) keys.add(m[1]!);
    }
    const missing = [...keys].filter((k) => translate("en", k) === k || translate("bo", k) === k);
    expect(missing).toEqual([]);
  });
});
