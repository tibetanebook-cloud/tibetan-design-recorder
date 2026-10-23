/**
 * Turn a finished take into editor state: one media entry and one clip per file,
 * each on its own lane (Screen, Webcam, Mic, System audio), placed at its start
 * offset so the lanes stay in sync. Clips are NOT linked; the user can link
 * webcam+mic later. A region recording becomes a crop on the screen clip, so
 * the full-display file stays untouched and the crop can be changed afterwards.
 */
import { createProject, makeTrack, newId } from "../project/factory";
import type { Clip, Media, Project, TrackKind } from "../project/schema";
import type { TakeManifest, TrackFileKind } from "./types";

const ORIGIN: Record<TrackFileKind, Media["origin"]> = { screen: "screen", webcam: "webcam", mic: "mic", system: "system" };
const MEDIA_KIND: Record<TrackFileKind, Media["kind"]> = { screen: "video", webcam: "video", mic: "audio", system: "audio" };

export function joinPath(dir: string, file: string): string {
  const sep = dir.includes("\\") && !dir.includes("/") ? "\\" : "/";
  return dir.endsWith(sep) ? dir + file : dir + sep + file;
}

export function takeToProject(take: TakeManifest, takeDir: string, name = take.id): Project {
  const project = createProject(name, new Date(take.createdAt));
  const laneFor = (kind: TrackKind) => project.tracks.find((t) => t.kind === kind)!;

  for (const track of take.tracks) {
    const media: Media = {
      id: newId("med"),
      kind: MEDIA_KIND[track.kind],
      origin: ORIGIN[track.kind],
      path: joinPath(takeDir, track.file),
      durationMs: track.durationMs,
      width: track.width,
      height: track.height,
      clockOffsetMs: track.startOffsetMs,
    };
    project.media.push(media);
    if (track.durationMs <= 0) continue;
    const clip: Clip = {
      id: newId("clp"),
      trackId: laneFor(track.kind).id,
      mediaId: media.id,
      content: { type: "media" },
      startMs: Math.max(0, track.startOffsetMs),
      durationMs: track.durationMs,
      sourceInMs: 0,
      speed: 1,
      opacity: 1,
      volume: 1,
      fadeInMs: 0,
      fadeOutMs: 0,
      muted: false,
      hidden: false,
      locked: false,
    };
    const region = take.settings.screen.region;
    if (track.kind === "screen" && take.settings.screen.kind === "region" && region && take.display) {
      const b = take.display.bounds;
      clip.crop = {
        left: region.x / b.width,
        top: region.y / b.height,
        right: 1 - (region.x + region.width) / b.width,
        bottom: 1 - (region.y + region.height) / b.height,
      };
    }
    project.clips.push(clip);
  }

  if (take.cursorFile) {
    const cursorMedia: Media = {
      id: newId("med"),
      kind: "cursor",
      origin: "cursor",
      path: joinPath(takeDir, take.cursorFile),
      durationMs: take.durationMs,
      clockOffsetMs: 0,
    };
    project.media.push(cursorMedia);
    // The cursor gets its own lane (right under the screen) so it can be trimmed or
    // hidden on its own. It is linked to the screen clip because it describes it.
    const lane = makeTrack("cursor");
    const screenIndex = project.tracks.findIndex((t) => t.kind === "screen");
    project.tracks.splice(screenIndex + 1, 0, lane);
    const screenClip = project.clips.find((c) => c.trackId === laneFor("screen").id);
    const group = screenClip ? newId("lnk") : undefined;
    if (screenClip) screenClip.linkGroup = group;
    project.clips.push({
      id: newId("clp"),
      trackId: lane.id,
      mediaId: cursorMedia.id,
      content: { type: "media" },
      startMs: 0,
      durationMs: Math.max(1, take.durationMs),
      sourceInMs: 0,
      speed: 1,
      linkGroup: group,
      opacity: 1,
      volume: 1,
      fadeInMs: 0,
      fadeOutMs: 0,
      muted: false,
      hidden: false,
      locked: false,
    });
  }
  // Chromium capture records the real OS pointer into the screen video; drawing our
  // own on top would show two. Native helpers (cursor-free capture) turn it on.
  const screenTrack = take.tracks.find((t) => t.kind === "screen");
  project.cursor = { ...project.cursor, visible: screenTrack?.backend === "wgc-helper" };
  // Markers added with the hotkey, and the points where recording was paused.
  for (const t of take.markers ?? []) project.markers.push({ id: newId("mrk"), timeMs: t, label: "", kind: "marker" });
  for (const p of take.pauses) project.markers.push({ id: newId("mrk"), timeMs: p.atMs, label: "", kind: "pause" });
  project.markers.sort((a, b) => a.timeMs - b.timeMs);

  // Show a frame from the recording in the preview straight away.
  project.editor.playheadMs = Math.min(1500, Math.max(0, take.durationMs / 2));

  // Match the canvas to the screen recording's shape.
  const screen = take.tracks.find((t) => t.kind === "screen");
  if (screen?.width && screen.height) {
    const landscape = screen.width >= screen.height;
    project.canvas.width = landscape ? 1920 : 1080;
    project.canvas.height = landscape ? 1080 : 1920;
  }
  project.canvas.fps = take.settings.screen.fps;
  project.effects.take = { id: take.id, dir: takeDir, captureKind: take.settings.screen.kind };
  return project;
}
