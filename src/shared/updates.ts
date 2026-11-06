/** What the update prompt shows, and how versions compare. */
export const LATEST_RELEASE_PAGE = "https://github.com/tibetanebook-cloud/tibetan-design-recorder/releases/latest";
export const WEBSITE_URL = "https://nangchen.com/";

export interface UpdateState {
  phase: "available" | "downloading" | "ready" | "failed";
  version: string;
  /** While downloading: 0 to 100. */
  percent?: number;
}

/** The answer to Help ▸ Check for Updates. */
export type UpdateCheckResult = "latest" | "available" | "failed";

const parts = (version: string): number[] | null => {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(version.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
};

export function isNewerVersion(candidate: string, current: string): boolean {
  const a = parts(candidate);
  const b = parts(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i]! > b[i]!;
  return false;
}
