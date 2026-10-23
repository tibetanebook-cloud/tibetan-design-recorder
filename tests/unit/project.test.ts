import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDemoProject } from "@shared/project/demo";
import { createProject, RECORDING_LANES } from "@shared/project/factory";
import { apply, createHistory, redo, undo, MAX_HISTORY } from "@shared/project/history";
import { parseProject, ProjectFormatError, serializeProject } from "@shared/project/schema";
import { loadProject, saveProject, SessionRecovery } from "../../src/main/project-io";

describe(".tdrec project format", () => {
  it("new projects have the four separate recording lanes", () => {
    const p = createProject("Lesson 1");
    expect(p.tracks.map((t) => t.kind)).toEqual([...RECORDING_LANES]);
  });

  it("round-trips through JSON without loss, including Tibetan text", () => {
    const p = createDemoProject();
    p.markers.push({ id: "m", timeMs: 5, label: "ལེའུ་དང་པོ།", kind: "chapter" });
    expect(parseProject(JSON.parse(serializeProject(p)))).toEqual(p);
  });

  it("rejects files that are not projects, or from a newer app version", () => {
    expect(() => parseProject({ hello: 1 })).toThrow(ProjectFormatError);
    expect(() => parseProject({ ...createProject("x"), version: 99 })).toThrow(/newer/);
  });
});

describe("undo/redo history", () => {
  const rename = (name: string) => (p: ReturnType<typeof createProject>) => ({ ...p, name });

  it("undoes and redoes in order", () => {
    let h = createHistory(createProject("a"));
    h = apply(h, "rename", rename("b"));
    h = apply(h, "rename", rename("c"));
    expect(undo(h).present.name).toBe("b");
    expect(undo(undo(h)).present.name).toBe("a");
    expect(redo(undo(undo(h))).present.name).toBe("b");
  });

  it("a new edit clears the redo stack", () => {
    let h = apply(createHistory(createProject("a")), "rename", rename("b"));
    h = apply(undo(h), "rename", rename("z"));
    expect(h.future).toHaveLength(0);
    expect(redo(h).present.name).toBe("z");
  });

  it("no-op edits are not recorded and history is bounded", () => {
    let h = createHistory(createProject("a"));
    h = apply(h, "noop", (p) => p);
    expect(h.past).toHaveLength(0);
    for (let i = 0; i < MAX_HISTORY + 20; i++) h = apply(h, "rename", rename(String(i)));
    expect(h.past).toHaveLength(MAX_HISTORY);
  });
});

describe("saving, reopening and crash recovery", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "tdrec-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("saves atomically and reopens the same project", async () => {
    const p = createDemoProject();
    const file = join(dir, "lesson.tdrec");
    await saveProject(file, p);
    const { project } = await loadProject(file);
    expect(project.id).toBe(p.id);
    expect(project.clips).toEqual(p.clips);
  });

  it("finds media again after the project folder is moved", async () => {
    const p = createProject("moved");
    const media = join(dir, "media", "screen.mp4");
    await writeFile(join(dir, "placeholder"), "");
    p.media.push({ id: "m1", kind: "video", origin: "screen", path: media, durationMs: 1000, clockOffsetMs: 0 });
    const file = join(dir, "moved.tdrec");
    await saveProject(file, p);
    const saved = JSON.parse(await readFile(file, "utf8"));
    expect(saved.media[0].relativePath).toBe("media/screen.mp4");
  });

  it("offers recovery only after an unclean exit", async () => {
    const recovery = new SessionRecovery(dir);
    expect((await recovery.check()).available).toBe(false);
    await recovery.begin();
    await recovery.autosave(serializeProject(createProject("draft")));
    // Simulated crash: the next launch finds the lock and the autosave.
    const next = new SessionRecovery(dir);
    const info = await next.check();
    expect(info.available).toBe(true);
    expect(info.projectName).toBe("draft");
    await next.end(); // clean exit
    expect((await new SessionRecovery(dir).check()).available).toBe(false);
  });

  it("refuses to autosave a broken project", async () => {
    await expect(new SessionRecovery(dir).autosave("{}")).rejects.toThrow();
  });
});

describe("opening a project from the command line", () => {
  it("finds the .tdrec path among the arguments (not flags, not the app itself)", async () => {
    const { projectArg } = await import("@shared/project/launchArgs");
    expect(projectArg(["C:\App\Tibetan Design Recorder.exe", "D:\Lessons\ཀ་ཁ.tdrec"])).toBe("D:\Lessons\ཀ་ཁ.tdrec");
    expect(projectArg(["app", "--smoke-test", "lesson.TDREC"])).toBe("lesson.TDREC");
    expect(projectArg(["app", "--flag=x.tdrec"])).toBeUndefined();
    expect(projectArg(["electron", "."])).toBeUndefined();
  });
});
