import type { TdrApi } from "./index";

declare global {
  interface Window {
    tdr: TdrApi;
    __tdrSmoke?: () => unknown;
    __tdrTest?: Record<string, unknown>;
  }
}
