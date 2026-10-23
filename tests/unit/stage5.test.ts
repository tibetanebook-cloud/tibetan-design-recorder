import { describe, expect, it } from "vitest";
import { createProject } from "@shared/project/factory";
import type { Clip, Project } from "@shared/project/schema";
import { dissolvePartner, revealUnits, textAnimationAt, transitionAt } from "@shared/effects/transitions";
import { layoutAt, LAYOUT_MORPH_MS, setLayoutFrom } from "@shared/effects/layouts";
import { formatTimestamp, parseSubtitles, segmentsToWords, toSrt, toVtt, wordsToCues } from "@shared/captions/captions";
import { estimateLufs, fxPreset, levelingGainDb } from "@shared/audio/fx";
import { chapterListText, chapters, quizAt, stepNumbers } from "@shared/teaching";
import { buildScene } from "@shared/scene/buildScene";

function clip(id: string, trackId: string, startMs: number, durationMs: number, extra: Partial<Clip> = {}): Clip {
  return { id, trackId, content: { type: "media" }, startMs, durationMs, sourceInMs: 0, speed: 1, opacity: 1, volume: 1, fadeInMs: 0, fadeOutMs: 0, muted: false, hidden: false, locked: false, ...extra };
}

const lane = (p: Project, kind: string) => p.tracks.find((t) => t.kind === kind)!.id;

describe("transitions", () => {
  it("fade-in goes 0 -> 1 over its duration, fade-out back to 0", () => {
    const c = clip("a", "t", 1000, 4000, { transitionIn: { type: "fade", durationMs: 500 }, transitionOut: { type: "fade", durationMs: 500 } });
    expect(transitionAt(c, 1000).alpha).toBeCloseTo(0, 3);
    expect(transitionAt(c, 1250).alpha).toBeGreaterThan(0.3);
    expect(transitionAt(c, 3000).alpha).toBe(1);
    expect(transitionAt(c, 4999).alpha).toBeLessThan(0.05);
  });

  it("slides start off-stage and end in place", () => {
    const c = clip("a", "t", 0, 4000, { transitionIn: { type: "slide-left", durationMs: 600 } });
    expect(transitionAt(c, 0).dx).toBeCloseTo(1, 3);
    expect(transitionAt(c, 600).dx).toBe(0);
  });

  it("dissolve finds the clip that ends where this one starts on the same lane", () => {
    const a = clip("a", "t", 0, 2000);
    const b = clip("b", "t", 2000, 2000, { transitionIn: { type: "dissolve", durationMs: 600 } });
    const other = clip("c", "u", 0, 2000);
    expect(dissolvePartner([a, b, other], b)?.id).toBe("a");
  });
});

describe("text animation", () => {
  it("typewriter reveals whole Tibetan syllables, never half a stack", () => {
    const text = "བསྒྲུབས་པའི་ཡི་གེ།";
    const units = revealUnits(text);
    expect(units.join("")).toBe(text);
    expect(units[0]).toBe("བསྒྲུབས་");
    for (let t = 0; t < 2500; t += 37) {
      const shown = textAnimationAt(text, "typewriter", t).text;
      expect(units.some((_, i) => units.slice(0, i + 1).join("") === shown)).toBe(true);
    }
    expect(textAnimationAt(text, "typewriter", 5000).text).toBe(text);
  });

  it("rise and fade settle to the resting state", () => {
    expect(textAnimationAt("Hi", "rise", 0).alpha).toBeCloseTo(0, 3);
    expect(textAnimationAt("Hi", "rise", 2000)).toMatchObject({ alpha: 1, dy: 0 });
  });
});

describe("layouts over time", () => {
  it("switches layout at the given time and morphs between them", () => {
    let p = createProject("t");
    p = setLayoutFrom(p, 5000, "side");
    expect(layoutAt(p, 4000)).toEqual({ layout: "bubble", k: 1 });
    const mid = layoutAt(p, 5000 + LAYOUT_MORPH_MS / 2);
    expect(mid.layout).toBe("side");
    expect(mid.from).toBe("bubble");
    expect(mid.k).toBeGreaterThan(0);
    expect(mid.k).toBeLessThan(1);
    expect(layoutAt(p, 9000)).toEqual({ layout: "side", k: 1 });
  });

  it("a switch at 0 sets the starting layout instead of adding a segment", () => {
    const p = setLayoutFrom(createProject("t"), 0, "full");
    expect(p.webcam.layout).toBe("full");
    expect(p.layouts).toHaveLength(0);
  });

  it("the scene shrinks the screen for side-by-side once the switch happens", () => {
    let p = createProject("t");
    p.media.push({ id: "s", kind: "video", origin: "screen", path: "/s.webm", durationMs: 20000, clockOffsetMs: 0, width: 1920, height: 1080 });
    p.media.push({ id: "w", kind: "video", origin: "webcam", path: "/w.webm", durationMs: 20000, clockOffsetMs: 0, width: 1280, height: 720 });
    p.clips.push(clip("sc", lane(p, "screen"), 0, 20000, { mediaId: "s" }), clip("wc", lane(p, "webcam"), 0, 20000, { mediaId: "w" }));
    p = setLayoutFrom(p, 5000, "side");
    const before = buildScene(p, 1000).layers.find((l) => l.clipId === "sc")!;
    const after = buildScene(p, 8000).layers.find((l) => l.clipId === "sc")!;
    expect(after.frame.width).toBeLessThan(before.frame.width * 0.75);
  });
});

describe("captions", () => {
  const cues = [
    { startMs: 1000, endMs: 2500, text: "Hello" },
    { startMs: 3_723_004, endMs: 3_725_000, text: "བཀྲ་ཤིས་བདེ་ལེགས།\nsecond line" },
  ];

  it("timestamps round-trip", () => {
    expect(formatTimestamp(3_723_004, ",")).toBe("01:02:03,004");
    expect(formatTimestamp(3_723_004, ".")).toBe("01:02:03.004");
  });

  it("SRT and VTT round-trip, keeping Tibetan text exactly", () => {
    expect(parseSubtitles(toSrt(cues))).toEqual(cues);
    expect(parseSubtitles(toVtt(cues))).toEqual(cues);
    expect(parseSubtitles("﻿WEBVTT\r\n\r\n00:01.500 --> 00:02.000 align:start\r\nhi\r\n")).toEqual([{ startMs: 1500, endMs: 2000, text: "hi" }]);
  });

  it("groups words into cues by length and pauses", () => {
    const words = "The quick brown fox jumps over the lazy dog. Then it rests".split(/(?=\s)/).map((w, i) => ({ startMs: i * 300 + (i >= 9 ? 2000 : 0), endMs: i * 300 + 280 + (i >= 9 ? 2000 : 0), text: w }));
    const out = wordsToCues(words, 20, 2);
    expect(out.length).toBeGreaterThanOrEqual(2);
    for (const c of out) for (const line of c.text.split("\n")) expect(line.length).toBeLessThanOrEqual(20);
    expect(out.at(-1)!.text).toContain("rests");
  });

  it("segment transcripts split Tibetan only at syllable boundaries", () => {
    const words = segmentsToWords([{ startMs: 0, endMs: 1000, text: "བཀྲ་ཤིས་བདེ་ལེགས།" }]);
    expect(words.map((w) => w.text)).toEqual(["བཀྲ་", "ཤིས་", "བདེ་", "ལེགས།"]);
    expect(words.at(-1)!.endMs).toBeCloseTo(1000, 6);
  });
});

describe("audio tools", () => {
  it("leveling gain moves loudness to the target, clamped", () => {
    expect(levelingGainDb(-26, -16)).toBe(10);
    expect(levelingGainDb(-60, -16)).toBe(20);
    expect(levelingGainDb(undefined, -16)).toBe(0);
  });

  it("presets switch on EQ, compressor, leveling and noise removal", () => {
    const fx = fxPreset("voice");
    expect([fx.eq.enabled, fx.compressor.enabled, fx.leveling.enabled, fx.noise.enabled]).toEqual([true, true, true, true]);
  });

  it("loudness estimate: a -20 dBFS sine reads about -23 LUFS, and 6 dB louder reads 6 LU louder", () => {
    const sr = 48000;
    const sine = (amp: number) => Float32Array.from({ length: sr * 3 }, (_, i) => amp * Math.sin((2 * Math.PI * 1000 * i) / sr));
    const a = estimateLufs(sine(0.1), sr);
    const b = estimateLufs(sine(0.2), sr);
    expect(a.lufs).toBeGreaterThan(-26);
    expect(a.lufs).toBeLessThan(-20);
    expect(b.lufs - a.lufs).toBeCloseTo(6.02, 1);
    expect(a.peakDb).toBeCloseTo(-20, 1);
  });
});

describe("teaching tools", () => {
  it("numbers steps by time unless a number is set", () => {
    const p = createProject("t");
    const ann = lane(p, "screen");
    p.clips.push(
      clip("s2", ann, 5000, 1000, { content: { type: "step", fill: "#000", color: "#fff" } }),
      clip("s1", ann, 1000, 1000, { content: { type: "step", fill: "#000", color: "#fff" } }),
      clip("s9", ann, 9000, 1000, { content: { type: "step", number: 7, fill: "#000", color: "#fff" } }),
    );
    expect(Object.fromEntries(stepNumbers(p))).toEqual({ s1: 1, s2: 2, s9: 7 });
  });

  it("chapters run to the next chapter; the list is YouTube-ready", () => {
    const p = createProject("t");
    p.markers.push({ id: "a", timeMs: 0, label: "Intro", kind: "chapter" }, { id: "b", timeMs: 65_000, label: "ཀ་ཁ་ག", kind: "chapter" }, { id: "m", timeMs: 1000, label: "", kind: "marker" });
    const list = chapters(p, 120_000);
    expect(list.map((c) => [c.startMs, c.endMs])).toEqual([[0, 65_000], [65_000, 120_000]]);
    expect(chapterListText(list)).toBe("0:00 Intro\n1:05 ཀ་ཁ་ག");
  });

  it("quiz cards show for their duration and reveal the answer late", () => {
    const p = createProject("t");
    p.markers.push({ id: "q", timeMs: 2000, label: "", kind: "quiz", quiz: { question: "?", choices: ["a", "b"], correct: 1, explanation: "", lang: "en", showMs: 5000 } });
    expect(quizAt(p, 1999)).toBeUndefined();
    expect(buildScene(p, 3000).quiz?.revealed).toBe(false);
    expect(buildScene(p, 6000).quiz?.revealed).toBe(true);
    expect(quizAt(p, 7000)).toBeUndefined();
  });
});

describe("speech-to-text results", () => {
  it("parses verbose_json words and segments (seconds -> ms) and restores spaces", async () => {
    const { parseVerboseJson } = await import("@shared/captions/transcribe");
    const r = parseVerboseJson({ language: "english", words: [{ word: "Hello", start: 0.2, end: 0.5 }, { word: "world", start: 0.6, end: 0.9 }, { word: ".", start: 0.9, end: 0.95 }], segments: [{ text: " Hello world.", start: 0.2, end: 0.95 }] });
    expect(r.words.map((w) => w.text).join("")).toBe("Hello world.");
    expect(r.words[1]).toMatchObject({ startMs: 600, endMs: 900 });
    expect(r.segments).toEqual([{ startMs: 200, endMs: 950, text: "Hello world." }]);
  });
});

describe("lanes and scene for Stage 5 content", () => {
  it("callouts, redactions and titles go on annotation lanes; captions on caption lanes", async () => {
    const { canPlaceOn } = await import("@shared/timeline/ops");
    const p = createProject("t");
    const ann = { ...p.tracks[0]!, kind: "annotation" as const };
    const cap = { ...p.tracks[0]!, kind: "caption" as const };
    const redact = clip("r", "x", 0, 1000, { content: { type: "redact", mode: "blur", strength: 20, color: "#000" } });
    const cue = clip("c", "x", 0, 1000, { content: { type: "caption", text: "hi", lang: "en" } });
    expect([canPlaceOn(p, redact, ann), canPlaceOn(p, redact, cap)]).toEqual([true, false]);
    expect([canPlaceOn(p, cue, ann), canPlaceOn(p, cue, cap)]).toEqual([false, true]);
  });

  it("caption cues become the scene caption (not a layer), using the caption style", () => {
    const p = createProject("t");
    p.tracks.unshift({ id: "cap", kind: "caption", name: "", locked: false, muted: false, solo: false, hidden: false, volume: 1, pan: 0, opacity: 1 });
    p.clips.push(clip("c1", "cap", 1000, 2000, { content: { type: "caption", text: "བཀྲ་ཤིས་བདེ་ལེགས།", lang: "bo" } }));
    const s = buildScene(p, 2000);
    expect(s.caption?.text).toBe("བཀྲ་ཤིས་བདེ་ལེགས།");
    expect(s.caption?.style.fontSize).toBe(p.captionStyle.fontSize);
    expect(s.layers.some((l) => l.clipId === "c1")).toBe(false);
    expect(buildScene(p, 3500).caption).toBeUndefined();
  });

  it("a dissolve draws the previous clip's last frame under the incoming clip", () => {
    const p = createProject("t");
    p.media.push({ id: "s", kind: "video", origin: "screen", path: "/s.webm", durationMs: 9000, clockOffsetMs: 0, width: 1920, height: 1080 });
    const lane0 = lane(p, "screen");
    p.clips.push(clip("a", lane0, 0, 2000, { mediaId: "s" }), clip("b", lane0, 2000, 2000, { mediaId: "s", sourceInMs: 4000, transitionIn: { type: "dissolve", durationMs: 1000 } }));
    const layers = buildScene(p, 2500).layers.filter((l) => l.trackId === lane0);
    expect(layers.map((l) => l.clipId)).toEqual(["a", "b"]);
    expect(layers[0]!.sourceTimeMs).toBeCloseTo(1999, 0);
    expect(layers[1]!.opacity).toBeGreaterThan(0.2);
    expect(layers[1]!.opacity).toBeLessThan(1);
    expect(buildScene(p, 3500).layers.filter((l) => l.trackId === lane0).map((l) => l.clipId)).toEqual(["b"]);
  });
});
