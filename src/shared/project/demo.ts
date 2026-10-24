/**
 * A built-in sample project (no media files needed) used for the welcome
 * preview, the smoke test and the compositor tests.
 */
import { createProject, makeTrack, newId } from "./factory";
import { TEXT_DEFAULTS, type Project } from "./schema";

export function createDemoProject(): Project {
  const project = createProject("Demo");
  const screen = project.tracks.find((t) => t.kind === "screen")!;
  const titles = makeTrack("annotation");
  const subtitle = makeTrack("annotation");
  project.tracks.unshift(titles, subtitle);
  project.clips.push(
    {
      id: newId("clp"),
      trackId: screen.id,
      content: { type: "solid", color: "#20263f" },
      startMs: 0,
      durationMs: 10_000,
      sourceInMs: 0,
      speed: 1,
      opacity: 1,
      volume: 1,
      fadeInMs: 0,
      fadeOutMs: 0,
      muted: false,
      hidden: false,
      locked: false,
    },
    {
      id: newId("clp"),
      trackId: titles.id,
      content: { type: "text", ...TEXT_DEFAULTS, text: "ནང་ཆེན་བཀྲིས་གློག་ཀླད་མཐོང་རིས་འཛིན་ཆས།", fontSize: 92, color: "#e8c56a", lang: "bo" },
      startMs: 0,
      durationMs: 10_000,
      sourceInMs: 0,
      speed: 1,
      frame: { x: 160, y: 300, width: 1600, height: 230 },
      opacity: 1,
      volume: 1,
      fadeInMs: 500,
      fadeOutMs: 0,
      muted: false,
      hidden: false,
      locked: false,
    },
    {
      id: newId("clp"),
      trackId: subtitle.id,
      content: { type: "text", ...TEXT_DEFAULTS, text: "Nangchen T. Studio Screen Recorder", fontSize: 64, color: "#f4ead2", lang: "en" },
      startMs: 0,
      durationMs: 10_000,
      sourceInMs: 0,
      speed: 1,
      frame: { x: 160, y: 580, width: 1600, height: 110 },
      opacity: 1,
      volume: 1,
      fadeInMs: 500,
      fadeOutMs: 0,
      muted: false,
      hidden: false,
      locked: false,
    },
  );
  // Past the 0.5 s title fade-in, so the welcome preview shows the titles.
  project.editor.playheadMs = 2000;
  return project;
}
