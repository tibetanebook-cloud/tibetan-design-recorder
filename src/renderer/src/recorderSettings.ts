/** Recorder settings, remembered between sessions (per-machine UI preference). */
import { create } from "zustand";
import { DEFAULT_RECORDING_SETTINGS, type RecordingSettings } from "@shared/recording/types";

const KEY = "tdr.recorder.settings.v1";

function load(): RecordingSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT_RECORDING_SETTINGS, ...(JSON.parse(raw) as Partial<RecordingSettings>) };
  } catch {
    /* ignore */
  }
  return DEFAULT_RECORDING_SETTINGS;
}

export const useRecorderSettings = create<{ settings: RecordingSettings; update: (patch: Partial<RecordingSettings>) => void }>((set) => ({
  settings: load(),
  update: (patch) =>
    set((s) => {
      const settings = { ...s.settings, ...patch };
      try {
        // The region/source ids are machine-specific but harmless to keep.
        localStorage.setItem(KEY, JSON.stringify(settings));
      } catch {
        /* ignore */
      }
      return { settings };
    }),
}));
