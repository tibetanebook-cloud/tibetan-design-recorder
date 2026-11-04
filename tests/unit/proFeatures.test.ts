import { describe, expect, it } from "vitest";
import { duckingPoints, findSilences, mergeRanges, sourceRangesToTimeline } from "@shared/audio/silence";
import { clipMotionAt, NO_MOTION, setKeyframe, volumeAt } from "@shared/effects/animate";
import { applyTheme, THEMES } from "@shared/effects/themes";
import { audioPlan, fadeEnvelope } from "@shared/export/plan";
import { createProject } from "@shared/project/factory";
import { Clip, parseProject, type Project } from "@shared/project/schema";
import { buildScene, sourceTime } from "@shared/scene/buildScene";
import { closeGaps, copyLook, deleteRange, deleteRanges, freezeFrame, insertTime } from "@shared/timeline/ranges";
import { splitAt } from "@shared/timeline/ops";

const clip = (over: Partial<Clip> = {}): Clip => Clip.parse({ id: "c", trackId: "t", startMs: 1000, durationMs: 4000, ...over });

function project(clips: Partial<Clip>[]): Project {
  const p = createProject("t");
  const lane = p.tracks.find((t) => t.kind === "screen")!.id;
  return { ...p, media: [{ id: "m", kind: "video", origin: "screen", path: "/a.webm", durationMs: 60_000, width: 1920, height: 1080, clockOffsetMs: 0 }], clips: clips.map((c, i) => clip({ id: `c${i}`, trackId: lane, mediaId: "m", ...c })) };
}

describe("keyframes", () => {
  it("moves in a straight line between keyframes and holds outside them", () => {
    const c = clip({ keyframes: [{ t: 1000, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, ease: "linear" }, { t: 2000, x: 100, y: 50, scale: 2, rotation: 90, opacity: 0, ease: "linear" }] });
    const size = { width: 1920, height: 1080 };
    expect(clipMotionAt(c, 0, size)).toEqual({ dx: 0, dy: 0, scale: 1, rotation: 0, opacity: 1 });
    expect(clipMotionAt(c, 1500, size)).toEqual({ dx: 50, dy: 25, scale: 1.5, rotation: 45, opacity: 0.5 });
    expect(clipMotionAt(c, 3000, size).dx).toBe(100);
  });

  it("adding at a moment keeps what the clip shows there, and updates a keyframe already there", () => {
    let c = clip({ keyframes: [{ t: 0, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, ease: "linear" }, { t: 1000, x: 100, y: 0, scale: 1, rotation: 0, opacity: 1, ease: "linear" }] });
    c = { ...c, keyframes: setKeyframe(c, 500, {}) };
    expect(c.keyframes!.map((k) => k.t)).toEqual([0, 500, 1000]);
    expect(c.keyframes![1]!.x).toBeCloseTo(50);
    c = { ...c, keyframes: setKeyframe(c, 510, { scale: 3 }) };
    expect(c.keyframes).toHaveLength(3);
    expect(c.keyframes![1]!.scale).toBe(3);
  });

  it("a split leaves the right half with its own keyframes, timed from its new start", () => {
    const p = project([{ keyframes: [{ t: 500, x: 1, y: 0, scale: 1, rotation: 0, opacity: 1, ease: "smooth" }, { t: 3000, x: 2, y: 0, scale: 1, rotation: 0, opacity: 1, ease: "smooth" }] }]);
    const right = splitAt(p, 3000).clips.find((c) => c.startMs === 3000)!;
    expect(right.keyframes!.map((k) => k.t)).toEqual([1000]);
  });
});

describe("behaviours", () => {
  const size = { width: 1000, height: 500 };
  const base = { in: "none", inMs: 500, during: "none", amount: 1, out: "none", outMs: 500 } as const;

  it("an entrance starts away and ends at rest", () => {
    const c = clip({ behavior: { ...base, in: "fly-left" } });
    expect(clipMotionAt(c, 0, size).dx).toBe(-1000);
    expect(clipMotionAt(c, 500, size)).toEqual(NO_MOTION);
  });

  it("an exit leaves by the end of the clip", () => {
    const c = clip({ behavior: { ...base, out: "fade" } });
    expect(clipMotionAt(c, 2000, size).opacity).toBe(1);
    expect(clipMotionAt(c, 4000, size).opacity).toBe(0);
  });

  it("is the same at the same moment (preview and export agree)", () => {
    const c = clip({ behavior: { ...base, during: "pulse" } });
    expect(clipMotionAt(c, 1234, size)).toEqual(clipMotionAt(c, 1234, size));
    expect(clipMotionAt(c, 200, size).scale).not.toBe(1);
  });

  it("reaches the picture through the scene", () => {
    const p = project([{ behavior: { ...base, in: "fade" }, startMs: 0 }]);
    const early = buildScene(p, 50).layers[0]!;
    expect(early.motion?.opacity).toBeLessThan(1);
    expect(early.opacity).toBeLessThan(1);
  });
});

describe("old projects", () => {
  it("still open: everything new is optional", () => {
    const p = createProject("old");
    const reopened = parseProject(JSON.parse(JSON.stringify(p)));
    expect(reopened.clips).toEqual(p.clips);
    expect(reopened.cursor.highlight).toBeUndefined();
  });
});

describe("cutting a stretch out of the timeline", () => {
  it("keeps every lane in step and plays on from the right place", () => {
    const p = project([{ startMs: 0, durationMs: 10_000 }]);
    const out = deleteRange(p, { startMs: 2000, endMs: 5000 });
    expect(out.clips.map((c) => [c.startMs, c.durationMs, c.sourceInMs])).toEqual([[0, 2000, 0], [2000, 5000, 5000]]);
  });

  it("moves later clips back and removes clips inside the range", () => {
    const p = project([{ startMs: 0, durationMs: 1000 }, { startMs: 2000, durationMs: 1000 }, { startMs: 6000, durationMs: 1000 }]);
    expect(deleteRange(p, { startMs: 1500, endMs: 3500 }).clips.map((c) => c.startMs)).toEqual([0, 4000]);
  });

  it("moves markers and zooms too, and drops a marker inside the range", () => {
    const p = { ...project([{ startMs: 0, durationMs: 10_000 }]), markers: [{ id: "a", timeMs: 3000, label: "", kind: "marker" as const }, { id: "b", timeMs: 8000, label: "", kind: "marker" as const }] };
    expect(deleteRange(p, { startMs: 2000, endMs: 5000 }).markers.map((m) => [m.id, m.timeMs])).toEqual([["b", 5000]]);
  });

  it("several ranges give the same picture as cutting them one by one from the end", () => {
    const p = project([{ startMs: 0, durationMs: 10_000 }]);
    const out = deleteRanges(p, [{ startMs: 1000, endMs: 2000 }, { startMs: 5000, endMs: 6000 }]);
    expect(out.clips.map((c) => [c.startMs, c.sourceInMs, c.durationMs])).toEqual([[0, 0, 1000], [1000, 2000, 3000], [4000, 6000, 4000]]);
  });

  it("leaves locked clips alone", () => {
    const p = project([{ startMs: 0, durationMs: 10_000, locked: true }]);
    expect(deleteRange(p, { startMs: 2000, endMs: 5000 }).clips[0]!.durationMs).toBe(10_000);
  });
});

describe("making room, closing gaps, holding a frame", () => {
  it("insertTime splits a clip across the point and pushes the rest later", () => {
    const p = project([{ startMs: 0, durationMs: 4000 }, { startMs: 5000, durationMs: 1000 }]);
    expect(insertTime(p, 2000, 3000).clips.map((c) => [c.startMs, c.durationMs, c.sourceInMs])).toEqual([[0, 2000, 0], [5000, 2000, 2000], [8000, 1000, 0]]);
  });

  it("closeGaps slides clips together", () => {
    const p = project([{ startMs: 1000, durationMs: 1000 }, { startMs: 5000, durationMs: 1000 }]);
    expect(closeGaps(p, p.clips[0]!.trackId).clips.map((c) => c.startMs)).toEqual([0, 1000]);
  });

  it("a held frame shows one source moment for its whole length", () => {
    const p = project([{ startMs: 0, durationMs: 4000, sourceInMs: 1000 }]);
    const { project: out, id } = freezeFrame(p, "c0", 2000, 3000);
    const held = out.clips.find((c) => c.id === id)!;
    expect(held.sourceInMs).toBe(3000);
    expect(sourceTime(held, 2000)).toBe(3000);
    expect(sourceTime(held, 4900)).toBe(3000);
    expect(out.clips.filter((c) => c.id !== id).map((c) => [c.startMs, c.durationMs, c.sourceInMs])).toEqual([[0, 2000, 1000], [5000, 2000, 3000]]);
  });

  it("copyLook carries effects but not position or time", () => {
    const p = project([{ startMs: 0, fx: { flipH: true, flipV: false, radius: 5, shadow: 0, border: { width: 0, color: "#fff" } } }, { startMs: 5000 }]);
    const out = copyLook(p, "c0", ["c1"]);
    expect(out.clips[1]!.fx?.flipH).toBe(true);
    expect(out.clips[1]!.startMs).toBe(5000);
  });
});

describe("finding pauses", () => {
  const peaks = (...runs: [number, number][]) => runs.flatMap(([value, count]) => Array<number>(count).fill(value));

  it("finds long pauses, keeping a little at each side", () => {
    const r = findSilences(peaks([1, 100], [0, 200], [1, 100]), { rate: 100, threshold: 0.1, minMs: 800, keepMs: 100 });
    expect(r).toEqual([{ startMs: 1100, endMs: 2900 }]);
  });

  it("ignores short pauses and a recording with no sound", () => {
    expect(findSilences(peaks([1, 100], [0, 20], [1, 100]), { rate: 100, threshold: 0.1, minMs: 800, keepMs: 0 })).toEqual([]);
    expect(findSilences(peaks([0, 500]), { rate: 100, threshold: 0.1, minMs: 100, keepMs: 0 })).toEqual([]);
  });

  it("finds a pause at the very end", () => {
    expect(findSilences(peaks([1, 100], [0, 100]), { rate: 100, threshold: 0.1, minMs: 500, keepMs: 0 })).toEqual([{ startMs: 1000, endMs: 2000 }]);
  });

  it("maps file time to timeline time through trim and speed, within the clip only", () => {
    const c = { startMs: 1000, durationMs: 2000, sourceInMs: 500, speed: 2 };
    expect(sourceRangesToTimeline(c, [{ startMs: 1500, endMs: 2500 }, { startMs: 9000, endMs: 9500 }])).toEqual([{ startMs: 1500, endMs: 2000 }]);
  });

  it("joins overlapping ranges", () => {
    expect(mergeRanges([{ startMs: 5, endMs: 8 }, { startMs: 0, endMs: 6 }])).toEqual([{ startMs: 0, endMs: 8 }]);
  });
});

describe("volume over time", () => {
  it("draws straight lines between points", () => {
    const c = { volumePoints: [{ t: 0, gain: 1 }, { t: 1000, gain: 0 }] };
    expect(volumeAt(c, 500)).toBe(0.5);
    expect(volumeAt({}, 500)).toBe(1);
  });

  it("the music stays low while the voice speaks and rises in a long pause", () => {
    const c = { startMs: 0, durationMs: 10_000 };
    const pts = duckingPoints(c, [{ startMs: 4000, endMs: 6000 }], 0.25);
    expect(volumeAt({ volumePoints: pts }, 1000)).toBe(0.25);
    expect(volumeAt({ volumePoints: pts }, 5000)).toBe(1);
    expect(volumeAt({ volumePoints: pts }, 8000)).toBe(0.25);
  });

  it("the export uses the same volume as the preview", () => {
    const env = fadeEnvelope({ durationMs: 2000, fadeInMs: 0, fadeOutMs: 0, gain: 0.5, volumePoints: [{ t: 0, gain: 1 }, { t: 1000, gain: 0 }, { t: 2000, gain: 1 }] });
    expect(env).toEqual([[0, 0.5], [1, 0], [2, 0.5]]);
  });

  it("an export range starting mid-clip keeps the level at the cut", () => {
    const p = createProject("v");
    const lane = p.tracks.find((t) => t.kind === "mic")!.id;
    const q: Project = {
      ...p,
      media: [{ id: "a", kind: "audio", origin: "mic", path: "/a.webm", durationMs: 10_000, clockOffsetMs: 0 }],
      clips: [clip({ id: "x", trackId: lane, mediaId: "a", startMs: 0, durationMs: 10_000, volumePoints: [{ t: 0, gain: 0 }, { t: 2000, gain: 1 }] })],
    };
    const [piece] = audioPlan(q, { startMs: 1000, endMs: 5000 });
    expect(piece!.volumePoints).toEqual([{ t: 0, gain: 0.5 }, { t: 1000, gain: 1 }]);
  });
});

describe("themes", () => {
  it("recolours titles and captions and leaves everything else", () => {
    const p = createProject("t");
    const lane = p.tracks[0]!.id;
    const q: Project = { ...p, clips: [clip({ id: "a", trackId: lane, content: { type: "title", template: "center", title: "x", subtitle: "", lang: "en", accent: "#000000", color: "#000000", background: "#000000" } })] };
    const out = applyTheme(q, THEMES[2]!);
    const c = out.clips[0]!.content as { accent: string };
    expect(c.accent).toBe(THEMES[2]!.accent);
    expect(out.captionStyle.color).toBe(THEMES[2]!.text);
    expect(out.clips[0]!.startMs).toBe(1000);
  });
});
