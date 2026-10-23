/**
 * Background job queue: analysis, transcription and (Stage 6) exports run here
 * one at a time, so editing stays responsive. Each job reports progress and can
 * be cancelled; the Jobs panel lists them.
 */
import { create } from "zustand";
import { newId } from "@shared/project/factory";

export type JobKind = "analyze" | "transcribe" | "export";
export type JobStatus = "queued" | "running" | "done" | "failed" | "cancelled";

export interface Job {
  id: string;
  kind: JobKind;
  /** i18n key, plus a detail shown as-is (file name, language…). */
  label: string;
  detail?: string;
  status: JobStatus;
  progress: number;
  error?: string;
  /** Short result text (e.g. "-18.2 LUFS", "42 captions"). */
  result?: string;
  /** File the job wrote (exports), for "Show in folder". */
  output?: string;
  startedAt?: number;
  createdAt: number;
  finishedAt?: number;
}

export type JobRunner = (report: (progress: number) => void, signal: AbortSignal) => Promise<string | void | { result: string; output?: string }>;

interface JobsStore {
  jobs: Job[];
  enqueue: (kind: JobKind, label: string, run: JobRunner, detail?: string) => string;
  cancel: (id: string) => void;
  clearFinished: () => void;
  /** Resolves when the job finishes (any status). */
  wait: (id: string) => Promise<Job>;
}

const runners = new Map<string, JobRunner>();
const controllers = new Map<string, AbortController>();
const waiters = new Map<string, ((job: Job) => void)[]>();

export const useJobs = create<JobsStore>((set, get) => {
  const patch = (id: string, p: Partial<Job>) => set((s) => ({ jobs: s.jobs.map((j) => (j.id === id ? { ...j, ...p } : j)) }));
  const finish = (id: string, p: Partial<Job>) => {
    patch(id, { ...p, finishedAt: Date.now() });
    runners.delete(id);
    controllers.delete(id);
    const job = get().jobs.find((j) => j.id === id)!;
    for (const w of waiters.get(id) ?? []) w(job);
    waiters.delete(id);
    pump();
  };
  const pump = () => {
    if (get().jobs.some((j) => j.status === "running")) return;
    const next = get().jobs.find((j) => j.status === "queued");
    if (!next) return;
    const run = runners.get(next.id)!;
    const ctl = new AbortController();
    controllers.set(next.id, ctl);
    patch(next.id, { status: "running", progress: 0, startedAt: Date.now() });
    let last = 0;
    const report = (p: number) => {
      // Throttle store updates to ~10 per second.
      const now = performance.now();
      if (now - last > 100 || p >= 1) {
        last = now;
        patch(next.id, { progress: Math.max(0, Math.min(1, p)) });
      }
    };
    run(report, ctl.signal).then(
      (r) => finish(next.id, ctl.signal.aborted ? { status: "cancelled" } : { status: "done", progress: 1, ...(typeof r === "object" ? r : { result: r ?? undefined }) }),
      (e: unknown) => finish(next.id, ctl.signal.aborted ? { status: "cancelled" } : { status: "failed", error: e instanceof Error ? e.message : String(e) }),
    );
  };
  return {
    jobs: [],
    enqueue: (kind, label, run, detail) => {
      const id = newId("job");
      runners.set(id, run);
      set((s) => ({ jobs: [...s.jobs, { id, kind, label, detail, status: "queued", progress: 0, createdAt: Date.now() }] }));
      queueMicrotask(pump);
      return id;
    },
    cancel: (id) => {
      const job = get().jobs.find((j) => j.id === id);
      if (!job) return;
      if (job.status === "queued") finish(id, { status: "cancelled" });
      else if (job.status === "running") controllers.get(id)?.abort();
    },
    clearFinished: () => set((s) => ({ jobs: s.jobs.filter((j) => j.status === "queued" || j.status === "running") })),
    wait: (id) =>
      new Promise((resolve) => {
        const job = get().jobs.find((j) => j.id === id);
        if (job && job.status !== "queued" && job.status !== "running") return resolve(job);
        waiters.set(id, [...(waiters.get(id) ?? []), resolve]);
      }),
  };
});
