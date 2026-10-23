// Prints {key: ["rule", ...]} for every Tibetan UI string with lint problems.
// Run: node --experimental-strip-types scripts/i18n/lint-json.ts
import { readFileSync } from "node:fs";
import { lintTibetan } from "../../src/shared/i18n/lint.ts";

type Tree = { [k: string]: string | Tree };
const flat = (o: Tree, p = ""): [string, string][] => Object.entries(o).flatMap(([k, v]) => (typeof v === "string" ? [[`${p}${k}`, v] as [string, string]] : flat(v, `${p}${k}.`)));
const bo = flat(JSON.parse(readFileSync("src/shared/i18n/bo.json", "utf8")) as Tree);
const out: Record<string, string[]> = {};
for (const [key, value] of bo) {
  const rules = [...new Set(lintTibetan(value).map((p) => p.rule))];
  if (rules.length) out[key] = rules;
}
console.log(JSON.stringify(out));
