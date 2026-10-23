import { describe, expect, it } from "vitest";
import { createProject } from "@shared/project/factory";
import { TEXT_DEFAULTS, type Clip, type Project } from "@shared/project/schema";
import {
  addTrack,
  canPlaceOn,
  clipEnd,
  deleteClips,
  duplicateClips,
  isAudible,
  linkClips,
  moveClips,
  removeTrack,
  rippleDelete,
  setClipProps,
  setTrackProps,
  snap,
  snapDelta,
  splitAt,
  trimClip,
  unlinkClips,
} from "@shared/timeline/ops";

/** Project with a 10 s screen file, 10 s mic file and clips placed as given (lane kind -> [start, duration]). */
function fixture(layout: Partial<Record<"webcam" | "screen" | "mic" | "system", [number, number][]>>): Project {
  const p = createProject("t");
  p.media.push(
    { id: "vid", kind: "video", origin: "screen", path: "/s.webm", durationMs: 10_000, clockOffsetMs: 0 },
    { id: "aud", kind: "audio", origin: "mic", path: "/m.webm", durationMs: 10_000, clockOffsetMs: 0 },
  );
  let n = 0;
  for (const [kind, spans] of Object.entries(layout)) {
    const track = p.tracks.find((t) => t.kind === kind)!;
    for (const [startMs, durationMs] of spans!) {
      p.clips.push(clip(`${kind}${n++}`, track.id, kind === "mic" || kind === "system" ? "aud" : "vid", startMs, durationMs));
    }
  }
  return p;
}

function clip(id: string, trackId: string, mediaId: string, startMs: number, durationMs: number): Clip {
  return { id, trackId, mediaId, content: { type: "media" }, startMs, durationMs, sourceInMs: 0, speed: 1, opacity: 1, volume: 1, fadeInMs: 0, fadeOutMs: 0, muted: false, hidden: false, locked: false };
}

const get = (p: Project, id: string) => p.clips.find((c) => c.id === id)!;
const lane = (p: Project, kind: string) => p.tracks.find((t) => t.kind === kind)!.id;

describe("move", () => {
  it("moves a clip on its own, leaving other lanes alone", () => {
    const p = moveClips(fixture({ screen: [[0, 2000]], mic: [[0, 2000]] }), ["screen0"], 500);
    expect(get(p, "screen0").startMs).toBe(500);
    expect(get(p, "mic1").startMs).toBe(0);
  });

  it("stops at a neighbour instead of overlapping it", () => {
    const p = moveClips(fixture({ screen: [[0, 2000], [3000, 1000]] }), ["screen0"], 5000);
    expect(get(p, "screen0").startMs).toBe(1000); // ends exactly where the next clip starts
  });

  it("never goes before 0", () => {
    expect(get(moveClips(fixture({ screen: [[500, 1000]] }), ["screen0"], -9000), "screen0").startMs).toBe(0);
  });

  it("linked clips move together; after unlinking they move alone", () => {
    let p = linkClips(fixture({ webcam: [[0, 2000]], mic: [[0, 2000]] }), ["webcam0", "mic1"]);
    p = moveClips(p, ["webcam0"], 700);
    expect([get(p, "webcam0").startMs, get(p, "mic1").startMs]).toEqual([700, 700]);
    p = moveClips(unlinkClips(p, ["webcam0"]), ["webcam0"], 300);
    expect([get(p, "webcam0").startMs, get(p, "mic1").startMs]).toEqual([1000, 700]);
  });

  it("moves to another lane only if the media fits there", () => {
    const p = fixture({ screen: [[0, 1000]] });
    const down = moveClips(p, ["screen0"], 0, -1); // screen -> webcam lane (both video)
    expect(get(down, "screen0").trackId).toBe(lane(p, "webcam"));
    const intoAudio = moveClips(p, ["screen0"], 0, 1); // screen -> mic lane: not allowed
    expect(get(intoAudio, "screen0").trackId).toBe(lane(p, "screen"));
  });

  it("locked clips and locked lanes do not move", () => {
    let p = fixture({ screen: [[0, 1000]] });
    p = setClipProps(p, ["screen0"], { locked: true });
    expect(get(moveClips(p, ["screen0"], 500), "screen0").startMs).toBe(0);
    p = setTrackProps(setClipProps(p, ["screen0"], { locked: false }), lane(p, "screen"), { locked: true });
    expect(get(moveClips(p, ["screen0"], 500), "screen0").startMs).toBe(0);
  });
});

describe("trim", () => {
  it("trims the start: in-point moves with it", () => {
    const p = trimClip(fixture({ screen: [[1000, 4000]] }), "screen0", "start", 2000);
    expect(get(p, "screen0")).toMatchObject({ startMs: 2000, durationMs: 3000, sourceInMs: 1000 });
  });

  it("cannot extend past the start or end of the source file", () => {
    let p = trimClip(fixture({ screen: [[1000, 4000]] }), "screen0", "start", 0);
    expect(get(p, "screen0").startMs).toBe(1000); // sourceIn is 0 already
    p = trimClip(p, "screen0", "end", 60_000);
    expect(clipEnd(get(p, "screen0"))).toBe(11_000); // 10 s file
  });

  it("stops at neighbours and keeps a minimum length", () => {
    const p = fixture({ screen: [[0, 2000], [3000, 2000]] });
    expect(clipEnd(get(trimClip(p, "screen0", "end", 4000), "screen0"))).toBe(3000);
    expect(get(trimClip(p, "screen0", "end", -100), "screen0").durationMs).toBeGreaterThan(0);
  });
});

describe("split", () => {
  it("splits under the playhead into two clips that continue the source", () => {
    const p = splitAt(fixture({ screen: [[1000, 4000]] }), 2500);
    const parts = p.clips.filter((c) => c.trackId === lane(p, "screen")).sort((a, b) => a.startMs - b.startMs);
    expect(parts.map((c) => [c.startMs, c.durationMs, c.sourceInMs])).toEqual([
      [1000, 1500, 0],
      [2500, 2500, 1500],
    ]);
  });

  it("splits only the given clips when ids are passed", () => {
    const p = splitAt(fixture({ screen: [[0, 4000]], mic: [[0, 4000]] }), 2000, ["mic1"]);
    expect(p.clips.filter((c) => c.trackId === lane(p, "screen"))).toHaveLength(1);
    expect(p.clips.filter((c) => c.trackId === lane(p, "mic"))).toHaveLength(2);
  });

  it("linked clips split together; the right halves form their own link group", () => {
    const p = splitAt(linkClips(fixture({ webcam: [[0, 4000]], mic: [[0, 4000]] }), ["webcam0", "mic1"]), 2000, ["webcam0"]);
    const right = p.clips.filter((c) => c.startMs === 2000);
    expect(right).toHaveLength(2);
    expect(right[0]!.linkGroup).toBe(right[1]!.linkGroup);
    expect(right[0]!.linkGroup).not.toBe(get(p, "webcam0").linkGroup);
  });
});

describe("delete and ripple delete", () => {
  it("delete leaves a gap", () => {
    const p = deleteClips(fixture({ screen: [[0, 1000], [1000, 1000]] }), ["screen0"]);
    expect(get(p, "screen1").startMs).toBe(1000);
  });

  it("ripple delete closes the gap on that lane only", () => {
    const p = rippleDelete(fixture({ screen: [[0, 1000], [1000, 1000]], mic: [[1500, 500]] }), ["screen0"]);
    expect(get(p, "screen1").startMs).toBe(0);
    expect(get(p, "mic2").startMs).toBe(1500);
  });
});

describe("duplicate, speed, lanes, audio", () => {
  it("duplicate places the copy right after the original", () => {
    const { project, ids } = duplicateClips(fixture({ screen: [[0, 1000]] }), ["screen0"]);
    expect(get(project, ids[0]!).startMs).toBe(1000);
  });

  it("speed keeps the source span: 2x makes the clip half as long", () => {
    const p = setClipProps(fixture({ screen: [[0, 4000]] }), ["screen0"], { speed: 2 });
    expect(get(p, "screen0")).toMatchObject({ speed: 2, durationMs: 2000 });
  });

  it("extra lanes can be added and removed; recording lanes cannot be removed", () => {
    const { project, id } = addTrack(fixture({}), "audio", 4);
    expect(project.tracks[4]!.id).toBe(id);
    expect(removeTrack(project, id).tracks).toHaveLength(4);
    expect(removeTrack(project, lane(project, "mic")).tracks).toHaveLength(5);
  });

  it("solo and mute decide which audio clips are heard", () => {
    let p = fixture({ mic: [[0, 1000]], system: [[0, 1000]] });
    expect([isAudible(p, get(p, "mic0")), isAudible(p, get(p, "system1"))]).toEqual([true, true]);
    p = setTrackProps(p, lane(p, "mic"), { solo: true });
    expect([isAudible(p, get(p, "mic0")), isAudible(p, get(p, "system1"))]).toEqual([true, false]);
    p = setTrackProps(p, lane(p, "mic"), { muted: true });
    expect(isAudible(p, get(p, "mic0"))).toBe(false);
  });

  it("text clips only go on annotation/caption lanes", () => {
    const p = fixture({});
    const text: Clip = { ...clip("t", "", "", 0, 1000), mediaId: undefined, content: { type: "text", ...TEXT_DEFAULTS, text: "བཀྲ་ཤིས།", fontSize: 64, color: "#fff", lang: "bo" } };
    expect(canPlaceOn(p, text, p.tracks.find((t) => t.kind === "screen")!)).toBe(false);
    expect(canPlaceOn(p, text, { ...p.tracks[0]!, kind: "caption" })).toBe(true);
  });
});

describe("snapping", () => {
  it("snaps to the nearest point within the threshold", () => {
    expect(snap(1040, [0, 1000, 2000], 50)).toEqual({ timeMs: 1000, snappedTo: 1000 });
    expect(snap(1100, [0, 1000, 2000], 50)).toEqual({ timeMs: 1100 });
  });

  it("snaps a dragged block by whichever edge is closer", () => {
    // block spans 0..1000, dragged by 1980 -> its end (2980) snaps to 3000
    expect(snapDelta([0, 1000], 1980, [3000, 5000], 50)).toEqual({ deltaMs: 2000, snappedTo: 3000 });
  });
});
