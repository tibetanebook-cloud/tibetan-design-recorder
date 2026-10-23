/**
 * Exports as background jobs: one export, every lane as its own file, or a
 * batch of project files. Each job works on a snapshot of the project taken
 * when it was queued, so editing can continue.
 */
import { exportableLanes, exportRange, soloLane } from "@shared/export/plan";
import { FILE_EXTENSION, type ExportSettings } from "@shared/export/settings";
import { parseProject, type Project } from "@shared/project/schema";
import { useJobs } from "../jobs";
import { useEditor } from "../store";
import { runExport } from "./exporter";

const fileName = (p: string) => p.split(/[\\/]/).pop() ?? p;
/** Characters Windows/macOS/Linux don't allow in file names. */
export const safeName = (s: string) => s.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").trim() || "export";

export function formatBytes(n: number): string {
  return n >= 1e9 ? `${(n / 1e9).toFixed(2)} GB` : n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`;
}

/** Queue one export of a project (default: the open project, at its In/Out if chosen). */
export function enqueueExport(settings: ExportSettings, path: string, project?: Project, label = "jobs.export"): string {
  const s = useEditor.getState();
  const snapshot = structuredClone(project ?? s.history.present);
  const range = exportRange(snapshot, settings, project ? null : s.inMs, project ? null : s.outMs);
  return useJobs.getState().enqueue(
    "export",
    label,
    async (report, signal) => {
      const r = await runExport({ project: snapshot, settings, range, path, signal, report });
      const speed = r.fps > 0 ? ` · ${r.fps.toFixed(1)} fps` : "";
      return { result: `${formatBytes(r.bytes)} · ${r.encoder}${speed}`, output: r.path };
    },
    fileName(path),
  );
}

/** Each lane with content as its own file: picture lanes as video, sound lanes as audio. */
export function enqueueTracks(settings: ExportSettings, folder: string, audioFormat: "wav" | "m4a" | "mp3" = "wav"): string[] {
  const s = useEditor.getState();
  const project = s.history.present;
  const sep = folder.includes("\\") ? "\\" : "/";
  return exportableLanes(project).map((lane, i) => {
    const track = project.tracks.find((t) => t.id === lane.id)!;
    const name = `${safeName(project.name)} - ${String(i + 1).padStart(2, "0")} ${safeName(track.name || s.t(`track.${track.kind}`))}`;
    const laneSettings: ExportSettings = lane.audio ? { ...settings, format: audioFormat } : { ...settings, format: settings.format === "gif" || ["mp3", "wav", "m4a"].includes(settings.format) ? "mp4" : settings.format, burnCaptions: track.kind === "caption" };
    const solo = soloLane(project, lane.id);
    // The webcam on its own fills the frame; the screen keeps its frame styling.
    if (track.kind === "webcam") Object.assign(solo, { webcam: { ...solo.webcam, layout: "full" }, layouts: [] });
    return enqueueExport(laneSettings, `${folder}${sep}${name}.${FILE_EXTENSION[laneSettings.format]}`, solo, "jobs.exportTrack");
  });
}

/** Several .tdrec projects with the same settings into one folder. */
export async function enqueueBatch(settings: ExportSettings, projectPaths: string[], folder: string): Promise<{ queued: string[]; failed: string[] }> {
  const sep = folder.includes("\\") ? "\\" : "/";
  const queued: string[] = [];
  const failed: string[] = [];
  for (const path of projectPaths) {
    const opened = await window.tdr.openProjectPath(path);
    try {
      if (!opened.ok || !opened.json) throw new Error(opened.error ?? "open failed");
      const project = parseProject(JSON.parse(opened.json));
      queued.push(enqueueExport({ ...settings, range: "all" }, `${folder}${sep}${safeName(project.name || fileName(path).replace(/\.tdrec$/i, ""))}.${FILE_EXTENSION[settings.format]}`, project, "jobs.exportBatch"));
    } catch {
      failed.push(fileName(path));
    }
  }
  return { queued, failed };
}
