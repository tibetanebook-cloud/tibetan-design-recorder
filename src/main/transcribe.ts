/**
 * Cloud speech-to-text (OpenAI-compatible endpoint), run from the main process
 * so the API key never enters the page. The key is encrypted with the OS key
 * store (Electron safeStorage) before it is written to disk.
 */
import { promises as fs } from "node:fs";
import { basename, extname, join } from "node:path";
import { safeStorage } from "electron";
import { DEFAULT_TRANSCRIBE, MAX_UPLOAD_BYTES, parseVerboseJson, type TranscribeConfig, type TranscribeRequest, type TranscribeResult } from "@shared/captions/transcribe";
import { writeFileAtomic } from "./project-io";
import { TRANSCRIBABLE_EXTENSIONS } from "./security";

/** https, or plain http only to this computer (a local speech server). */
const safeEndpoint = (u: string) => {
  try {
    const url = new URL(u);
    return url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname));
  } catch {
    return false;
  }
};

interface Stored {
  baseUrl: string;
  model: string;
  /** base64 of the safeStorage-encrypted key. */
  key?: string;
}

export class TranscribeService {
  private readonly path: string;
  private stored: Stored = { baseUrl: DEFAULT_TRANSCRIBE.baseUrl, model: DEFAULT_TRANSCRIBE.model };

  constructor(userDataDir: string) {
    this.path = join(userDataDir, "transcribe.json");
  }

  async load(): Promise<void> {
    try {
      const raw = JSON.parse(await fs.readFile(this.path, "utf8")) as Partial<Stored>;
      this.stored = {
        baseUrl: typeof raw.baseUrl === "string" ? raw.baseUrl : DEFAULT_TRANSCRIBE.baseUrl,
        model: typeof raw.model === "string" ? raw.model : DEFAULT_TRANSCRIBE.model,
        key: typeof raw.key === "string" ? raw.key : undefined,
      };
    } catch {
      // defaults
    }
  }

  config(): TranscribeConfig {
    return { provider: "cloud", baseUrl: this.stored.baseUrl, model: this.stored.model, hasKey: !!this.stored.key };
  }

  /** key: new key, "" removes it, undefined keeps it. */
  async setConfig(patch: { baseUrl?: string; model?: string; key?: string }): Promise<TranscribeConfig> {
    const next = { ...this.stored };
    if (patch.baseUrl !== undefined) {
      const url = String(patch.baseUrl).trim().replace(/\/+$/, "");
      if (!safeEndpoint(url)) throw new Error("The address must start with https:// (or http://localhost for a local server).");
      next.baseUrl = url;
    }
    if (patch.model !== undefined) next.model = patch.model.trim();
    if (patch.key !== undefined) {
      if (!patch.key) delete next.key;
      else if (safeStorage.isEncryptionAvailable()) next.key = safeStorage.encryptString(patch.key).toString("base64");
      else throw new Error("The system key store is not available, so the key cannot be stored safely.");
    }
    this.stored = next;
    await writeFileAtomic(this.path, JSON.stringify(this.stored, null, 2));
    return this.config();
  }

  private key(): string | undefined {
    if (!this.stored.key) return undefined;
    try {
      return safeStorage.decryptString(Buffer.from(this.stored.key, "base64"));
    } catch {
      return undefined;
    }
  }

  async run(req: TranscribeRequest): Promise<TranscribeResult> {
    const fail = (error: string): TranscribeResult => ({ ok: false, error, words: [], segments: [] });
    // Only audio/video files, only to a safe endpoint.
    if (typeof req?.path !== "string" || !TRANSCRIBABLE_EXTENSIONS.has(extname(req.path).toLowerCase())) return fail("not-media");
    if (!safeEndpoint(this.stored.baseUrl)) return fail("bad-endpoint");
    const key = this.key();
    if (!key && !/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/)/.test(this.stored.baseUrl)) return fail("no-key");
    let data: Buffer;
    try {
      data = await fs.readFile(req.path);
    } catch (e) {
      return fail(String(e));
    }
    if (data.byteLength > MAX_UPLOAD_BYTES) return fail("too-large");
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(data)], { type: "audio/webm" }), basename(req.path));
    form.append("model", this.stored.model);
    form.append("response_format", "verbose_json");
    form.append("timestamp_granularities[]", "word");
    form.append("timestamp_granularities[]", "segment");
    if (req.language) form.append("language", req.language);
    try {
      const res = await fetch(`${this.stored.baseUrl}/audio/transcriptions`, {
        method: "POST",
        headers: key ? { Authorization: `Bearer ${key}` } : {},
        body: form,
        signal: AbortSignal.timeout(10 * 60_000),
      });
      if (!res.ok) return fail(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
      return { ok: true, ...parseVerboseJson(await res.json()) };
    } catch (e) {
      return fail(String(e));
    }
  }
}
