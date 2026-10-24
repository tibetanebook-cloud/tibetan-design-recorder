import { describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrateUserData, OLD_PRODUCT_NAME } from "../../src/main/migrate";

function setup() {
  const appData = mkdtempSync(join(tmpdir(), "tdr-migrate-"));
  const old = join(appData, OLD_PRODUCT_NAME);
  mkdirSync(join(old, "extensions", "mine"), { recursive: true });
  mkdirSync(join(old, "GPUCache"), { recursive: true });
  writeFileSync(join(old, "settings.json"), '{"language":"en"}');
  writeFileSync(join(old, "library.json"), "[]");
  writeFileSync(join(old, "extensions", "mine", "extension.json"), "{}");
  writeFileSync(join(old, "GPUCache", "data_0"), "cache");
  return { appData, old, next: join(appData, "Nangchen T. Studio Screen Recorder") };
}

describe("moving user data to the new app name", () => {
  it("copies the user's files (not caches) and keeps the old folder", () => {
    const { appData, old, next } = setup();
    const moved = migrateUserData(appData, next);
    expect(moved.sort()).toEqual(["extensions", "library.json", "settings.json"]);
    expect(readFileSync(join(next, "settings.json"), "utf8")).toBe('{"language":"en"}');
    expect(existsSync(join(next, "extensions", "mine", "extension.json"))).toBe(true);
    expect(existsSync(join(next, "GPUCache"))).toBe(false);
    expect(existsSync(join(old, "settings.json"))).toBe(true);
    rmSync(appData, { recursive: true, force: true });
  });

  it("does nothing once the new folder has settings, or without an old folder", () => {
    const { appData, next } = setup();
    mkdirSync(next, { recursive: true });
    writeFileSync(join(next, "settings.json"), '{"language":"bo"}');
    expect(migrateUserData(appData, next)).toEqual([]);
    expect(readFileSync(join(next, "settings.json"), "utf8")).toBe('{"language":"bo"}');
    const empty = mkdtempSync(join(tmpdir(), "tdr-migrate-none-"));
    expect(migrateUserData(empty, join(empty, "New"))).toEqual([]);
    rmSync(appData, { recursive: true, force: true });
    rmSync(empty, { recursive: true, force: true });
  });
});
