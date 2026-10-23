import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadAllExtensions, loadExtensionsFrom } from "../../src/main/extensions";

describe("extensions (data-only)", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "tdr-ext-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function ext(name: string, manifest: unknown, files: Record<string, string> = {}) {
    await mkdir(join(dir, name), { recursive: true });
    await writeFile(join(dir, name, "extension.json"), JSON.stringify(manifest));
    for (const [f, content] of Object.entries(files)) {
      await mkdir(join(dir, name, f, ".."), { recursive: true });
      await writeFile(join(dir, name, f), content);
    }
  }

  it("loads valid items with namespaced ids and absolute paths", async () => {
    await ext("a", { id: "a", name: "A", version: "1", contributes: { clickSounds: [{ id: "tok", name: "Tok", file: "s/tok.wav" }] } }, { "s/tok.wav": "x" });
    const [a] = await loadExtensionsFrom(dir, false);
    expect(a!.clickSounds[0]).toMatchObject({ id: "a/tok", name: "Tok" });
    expect(a!.clickSounds[0]!.path).toBe(join(dir, "a", "s", "tok.wav"));
  });

  it("refuses files outside the extension folder and missing files", async () => {
    await writeFile(join(dir, "secret.txt"), "x");
    await ext("b", {
      id: "b",
      name: "B",
      version: "1",
      contributes: { wallpapers: [{ id: "esc", name: "Escape", file: "../secret.txt" }, { id: "gone", name: "Gone", file: "nope.png" }] },
    });
    const [b] = await loadExtensionsFrom(dir, false);
    expect(b!.wallpapers).toEqual([]);
    expect(b!.warnings).toHaveLength(2);
  });

  it("ignores folders without a valid manifest and warns about render hooks", async () => {
    await mkdir(join(dir, "junk"));
    await ext("c", { id: "c", name: "C", version: "1", contributes: { renderHooks: ["x.js"] } });
    const list = await loadExtensionsFrom(dir, false);
    expect(list.map((e) => e.id)).toEqual(["c"]);
    expect(list[0]!.warnings.join(" ")).toMatch(/render hooks/);
  });

  it("the bundled Tibetan Basics extension loads completely", async () => {
    const bundled = join(__dirname, "../../resources/extensions");
    const list = await loadAllExtensions(bundled, join(dir, "user"));
    const tb = list.find((e) => e.id === "tibetan-basics")!;
    expect(tb.warnings).toEqual([]);
    expect(tb.deviceFrames.map((f) => f.id)).toEqual(["tibetan-basics/laptop", "tibetan-basics/browser"]);
    expect(tb.wallpapers).toHaveLength(1);
    expect(tb.clickSounds).toHaveLength(1);
  });
});
