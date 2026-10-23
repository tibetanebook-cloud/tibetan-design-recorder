/**
 * Library: built-in music loops (resources/library/music) and the user's own
 * saved items (annotations, titles… saved from the timeline, kept in the user
 * data folder and reusable in every project).
 */
import type { Clip } from "./project/schema";

export interface MusicItem {
  /** i18n key of the name. */
  name: string;
  path: string;
  seconds: number;
}

/** A saved group of non-media clips; times are relative to the first clip. */
export interface UserLibraryItem {
  id: string;
  name: string;
  createdAt: string;
  clips: Omit<Clip, "trackId">[];
}

export interface LibraryContents {
  music: MusicItem[];
  user: UserLibraryItem[];
}

/** Clips that can be saved (no media files: those live in the project folder). */
export const isLibraryClip = (c: Clip): boolean => c.content.type !== "media" && !c.mediaId;
