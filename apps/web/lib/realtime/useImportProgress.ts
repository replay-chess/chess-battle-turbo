"use client";
// useImportProgress() (phase-04 plan §5.2, §4.8 Done, §4.10 Connected, §4.11 archive banner): the import events into
// the caches (lib/realtime/handlers/import.ts) plus the "About N minutes left" estimate from a 3-sample rate window of
// `import:progress` frames. The estimate is null until two samples of the same run moved forward, and while the run
// is still reading without a total.
import { useState } from "react";
import { useImportEvents, type ImportEvent, type ImportEventName } from "./handlers/import";

export const ETA_SAMPLES = 3;

export type EtaSample = { runRef: string; at: number; imported: number; total: number | null };

/** The next sample window (a new run starts a new window). */
export function pushSample(window: readonly EtaSample[], sample: EtaSample): EtaSample[] {
  const same = window.filter((s) => s.runRef === sample.runRef);
  return [...same, sample].slice(-ETA_SAMPLES);
}

/** Seconds left at the window's rate, or null (too few samples, no total, no progress). */
export function etaSecOf(window: readonly EtaSample[]): number | null {
  if (window.length < 2) return null;
  const first = window[0]!;
  const last = window[window.length - 1]!;
  if (last.total === null || last.total <= last.imported) return last.total !== null && last.total <= last.imported ? 0 : null;
  const dt = (last.at - first.at) / 1000;
  const dn = last.imported - first.imported;
  if (dt <= 0 || dn <= 0) return null;
  return Math.ceil((last.total - last.imported) / (dn / dt));
}

export function useImportProgress(options: { enabled?: boolean; onEvent?: (name: ImportEventName, payload: ImportEvent) => void } = {}): {
  etaSec: number | null;
} {
  const [samples, setSamples] = useState<EtaSample[]>([]);
  useImportEvents({
    enabled: options.enabled,
    onEvent: (name, payload) => {
      if (name === "import:progress") {
        setSamples((w) => pushSample(w, { runRef: payload.runRef, at: Date.now(), imported: payload.imported, total: payload.total ?? null }));
      } else {
        setSamples([]);
      }
      options.onEvent?.(name, payload);
    },
  });
  return { etaSec: etaSecOf(samples) };
}
