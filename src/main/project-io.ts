/**
 * Project files and crash recovery.
 *
 * - Saves are atomic: write `<file>.tmp`, fsync, then rename over the target, so a
 *   crash mid-save never leaves a truncated project.
 * - Autosave writes to `<userData>/autosave/current.tdrec` (never over the user's file).
 * - A session lock file marks a running session. If the app starts and finds a lock
 *   from a previous session plus an autosave, that session ended without a clean exit
 *   and the user is offered recovery.
 */
import { promises as fs } from "node:fs";
import { dirname, join, relative } from "node:path";
import { parseProject, serializeProject, type Project } from "@shared/project/schema";
import type { RecoveryInfo } from "@shared/ipc";

export async function writeFileAtomic(path: string, data: string): Promise<void> {
  await fs.mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  const handle = await fs.open(tmp, "w");
  try {
    await handle.writeFile(data, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fs.rename(tmp, path);
}

/** Store media paths relative to the project as well, so moved folders still open. */
export function withRelativePaths(project: Project, projectPath: string): Project {
  const base = dirname(projectPath);
  return {
    ...project,
    media: project.media.map((m) => ({ ...m, relativePath: relative(base, m.path).replaceAll("\\", "/") })),
  };
}

export async function saveProject(path: string, project: Project): Promise<void> {
  const stamped = { ...withRelativePaths(project, path), modifiedAt: new Date().toISOString() };
  await writeFileAtomic(path, serializeProject(stamped));
}

export async function loadProject(path: string): Promise<{ project: Project; json: string }> {
  const json = await fs.readFile(path, "utf8");
  const project = parseProject(JSON.parse(json));
  // Re-resolve media that moved together with the project file.
  const base = dirname(path);
  const media = await Promise.all(
    project.media.map(async (m) => {
      if (await exists(m.path)) return m;
      if (m.relativePath) {
        const candidate = join(base, m.relativePath);
        if (await exists(candidate)) return { ...m, path: candidate };
      }
      return m;
    }),
  );
  const resolved = { ...project, media };
  return { project: resolved, json: serializeProject(resolved) };
}

async function exists(path: string): Promise<boolean> {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

export class SessionRecovery {
  readonly autosavePath: string;
  readonly lockPath: string;

  constructor(userDataDir: string) {
    this.autosavePath = join(userDataDir, "autosave", "current.tdrec");
    this.lockPath = join(userDataDir, "autosave", "session.lock");
  }

  /** Call once at startup, before `begin()`. */
  async check(): Promise<RecoveryInfo> {
    if (!(await exists(this.lockPath)) || !(await exists(this.autosavePath))) return { available: false };
    try {
      const json = await fs.readFile(this.autosavePath, "utf8");
      const project = parseProject(JSON.parse(json));
      const stat = await fs.stat(this.autosavePath);
      return { available: true, projectName: project.name, autosavedAt: stat.mtime.toISOString(), json };
    } catch {
      return { available: false };
    }
  }

  async begin(): Promise<void> {
    await writeFileAtomic(this.lockPath, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
  }

  async autosave(json: string): Promise<void> {
    parseProject(JSON.parse(json)); // never autosave something we could not reopen
    await writeFileAtomic(this.autosavePath, json);
  }

  async discard(): Promise<void> {
    await fs.rm(this.autosavePath, { force: true });
  }

  /** Clean exit: nothing to recover next time. */
  async end(): Promise<void> {
    await fs.rm(this.lockPath, { force: true });
    await fs.rm(this.autosavePath, { force: true });
  }
}
