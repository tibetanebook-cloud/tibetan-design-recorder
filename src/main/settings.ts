import { promises as fs } from "node:fs";
import { join } from "node:path";
import { DEFAULT_LANGUAGE, isLanguage } from "@shared/i18n";
import type { Settings } from "@shared/ipc";
import { writeFileAtomic } from "./project-io";

const MAX_RECENT = 10;

export class SettingsStore {
  private readonly path: string;
  private value: Settings = { language: DEFAULT_LANGUAGE, recentProjects: [], shortcuts: {} };

  constructor(userDataDir: string) {
    this.path = join(userDataDir, "settings.json");
  }

  async load(): Promise<Settings> {
    try {
      const raw = JSON.parse(await fs.readFile(this.path, "utf8")) as Partial<Settings>;
      this.value = {
        language: isLanguage(raw.language) ? raw.language : DEFAULT_LANGUAGE,
        recentProjects: Array.isArray(raw.recentProjects)
          ? raw.recentProjects.filter((p): p is string => typeof p === "string").slice(0, MAX_RECENT)
          : [],
        shortcuts: raw.shortcuts && typeof raw.shortcuts === "object" ? raw.shortcuts : {},
      };
    } catch {
      // First run or unreadable file: keep defaults.
    }
    return this.value;
  }

  get(): Settings {
    return this.value;
  }

  async update(patch: Partial<Settings>): Promise<Settings> {
    this.value = { ...this.value, ...patch };
    await writeFileAtomic(this.path, JSON.stringify(this.value, null, 2));
    return this.value;
  }

  async addRecent(path: string): Promise<void> {
    const recentProjects = [path, ...this.value.recentProjects.filter((p) => p !== path)].slice(0, MAX_RECENT);
    await this.update({ recentProjects });
  }
}
