import { describe, expect, it } from "vitest";
import { join, resolve } from "node:path";
import { READABLE_EXTENSIONS, TRANSCRIBABLE_EXTENSIONS, WritePolicy } from "../../src/main/policy";

// Absolute paths for the current OS (C:\... on Windows, /... elsewhere).
const base = resolve("/home-test/me/Videos/Exports");
const chosen = resolve("/data-test/lessons/lesson1.mp4");

describe("export write policy", () => {
  it("allows only chosen files and files inside chosen folders", () => {
    const p = new WritePolicy();
    p.allowDir(base);
    p.allowFile(chosen);
    expect(p.canWrite(join(base, "a.mp4"))).toBe(true);
    expect(p.canWrite(join(base, "sub", "b.wav"))).toBe(true);
    expect(p.canWrite(chosen)).toBe(true);
    expect(p.canWrite(chosen.replace("lesson1", "lesson2"))).toBe(false);
  });

  it("refuses escapes, relative paths and look-alike folders", () => {
    const p = new WritePolicy();
    p.allowDir(base);
    expect(p.canWrite(join(base, "..", "evil.mp4"))).toBe(false);
    expect(p.canWrite(join(base, "..", "..", "Startup", "x.exe"))).toBe(false);
    expect(p.canWrite(join(base + "Other", "x.mp4"))).toBe(false);
    expect(p.canWrite("relative/x.mp4")).toBe(false);
    expect(p.canWrite(base)).toBe(false);
    expect(p.canWrite(join(base, "a\0.mp4"))).toBe(false);
  });

  it("allows a caption file only next to an allowed video", () => {
    const p = new WritePolicy();
    p.allowFile(chosen);
    expect(p.canWriteSidecar(chosen.replace(".mp4", ".srt"))).toBe(true);
    expect(p.canWriteSidecar(chosen.replace("lesson1.mp4", "other.srt"))).toBe(false);
    expect(p.canWriteSidecar(chosen.replace(".mp4", ".exe"))).toBe(false);
  });
});

describe("readable file types", () => {
  it("serves media and captions only", () => {
    for (const ok of [".webm", ".mp4", ".wav", ".png", ".jsonl", ".srt"]) expect(READABLE_EXTENSIONS.has(ok)).toBe(true);
    for (const no of [".json", ".txt", ".exe", ".pem", ".tdrec", ""]) expect(READABLE_EXTENSIONS.has(no)).toBe(false);
    expect(TRANSCRIBABLE_EXTENSIONS.has(".png")).toBe(false);
  });
});
