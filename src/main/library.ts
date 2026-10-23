import { promises as fs } from "node:fs";
import { join } from "node:path";
import type { LibraryContents, MusicItem, UserLibraryItem } from "@shared/library";
import { writeFileAtomic } from "./project-io";

export class Library {
  constructor(
    private readonly resourcesDir: string,
    private readonly userDataDir: string,
  ) {}

  private get userFile(): string {
    return join(this.userDataDir, "library.json");
  }

  private async music(): Promise<MusicItem[]> {
    const dir = join(this.resourcesDir, "library", "music");
    try {
      const index = JSON.parse(await fs.readFile(join(dir, "index.json"), "utf8")) as { file: string; name: string; seconds: number }[];
      return index.map((m) => ({ name: m.name, seconds: m.seconds, path: join(dir, m.file) }));
    } catch {
      return [];
    }
  }

  private async user(): Promise<UserLibraryItem[]> {
    try {
      const raw = JSON.parse(await fs.readFile(this.userFile, "utf8")) as unknown;
      return Array.isArray(raw) ? (raw as UserLibraryItem[]).filter((x) => x && typeof x.id === "string" && Array.isArray(x.clips)) : [];
    } catch {
      return [];
    }
  }

  async list(): Promise<LibraryContents> {
    return { music: await this.music(), user: await this.user() };
  }

  async saveUser(items: UserLibraryItem[]): Promise<LibraryContents> {
    await writeFileAtomic(this.userFile, JSON.stringify(items, null, 2));
    return this.list();
  }
}
