"use client";

// Puzzle streams (phase-05 plan §4.5, §5.2 "Prefetch", §7.3 W3): when two items remain in a streaming puzzle
// session, `POST /api/train/sessions/:ref/extend {after}` appends the next 10 in the background (idempotent on
// `after`), so the member never waits at item 10. A 409 `session_ended` stops the stream quietly; any other failure
// ends it at the current batch ("No more puzzles right now."). Sessions with `?n=` (plan step) never extend.
import type { ExtendResult, SessionPayload } from "@repo/contracts/http/train";
import { ExtendResult as ExtendResultSchema } from "@repo/contracts/http/train";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { useStore } from "zustand";
import { api } from "@/lib/api/client";
import { endpoints } from "@/lib/api/endpoints";
import { qk } from "@/lib/api/keys";
import { trainSessionPath } from "@/lib/api/queries/train";
import { saveSessionSnapshot } from "@/lib/offline/snapshots";
import type { RunnerStore } from "./runner-store";

/** Extend when this many items (or fewer) are left after the current one. */
export const EXTEND_WHEN_LEFT = 2;

export type Extender = (sessionRef: string, after: string) => Promise<ExtendResult>;

export const extendSession: Extender = async (sessionRef, after) => {
  const schema = process.env.NODE_ENV === "production" ? undefined : ExtendResultSchema;
  const { data } = await api(trainSessionPath(endpoints.trainSessionExtend, sessionRef), { method: "POST", body: { after }, schema });
  return data as ExtendResult;
};

/**
 * The `after` of W3: the stream's last pass-1 item. The server reads `after` as a position in the stream
 * (`itemsAfter`: pass-1 items numbered above it), so it must never be a pass-2 copy: an Again re-queues "i8b" at the
 * end of the list, and `after: "i8b"` answered the already-held i9 and i10, the runner appended nothing, stayed idle
 * two items from the end and asked again at once: a request storm that spent the member's `train-write` bucket
 * (120 a minute) and held every grade behind a 429 for 30 s (regression: extend-after-pass2, REGRESSION-5).
 */
export function extendAfter(items: readonly { itemId: string; pass: number }[]): string | null {
  for (let i = items.length - 1; i >= 0; i--) if (items[i]!.pass === 1) return items[i]!.itemId;
  return null;
}

/** True when the stream should ask for more now. */
export function shouldExtend(s: { stream: boolean; extend: string; index: number; items: { length: number }; ended: boolean }): boolean {
  return s.stream && !s.ended && s.extend === "idle" && s.items.length - s.index - 1 <= EXTEND_WHEN_LEFT;
}

export function useSessionExtend(store: RunnerStore, opts: { userRef: string; extender?: Extender; persist?: boolean }): void {
  const qc = useQueryClient();
  const due = useStore(store, shouldExtend);
  const { userRef, extender = extendSession, persist = true } = opts;
  // Setting `extend: "pending"` turns `due` off at once, so the request must outlive that re-render: only an unmount
  // drops its answer.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!due) return;
    const s = store.getState();
    const after = extendAfter(s.items);
    if (!after) return;
    s.setExtend("pending");
    extender(s.ref, after)
      .then((res) => {
        if (!mounted.current) return;
        store.getState().appendItems(res.items, res.stream);
        // The cached payload grows with the stream (items are immutable otherwise; §5.1 "extend appends items").
        const key = qk.train.session(s.ref);
        const cached = qc.getQueryData<SessionPayload>(key);
        if (cached) {
          const known = new Set(cached.items.map((it) => it.itemId));
          const next = { ...cached, items: [...cached.items, ...res.items.filter((it) => !known.has(it.itemId))], stream: res.stream };
          qc.setQueryData(key, next);
          if (persist) void saveSessionSnapshot(userRef, next);
        }
      })
      .catch((err: unknown) => {
        if (!mounted.current) return;
        const reason = (err as { reason?: unknown } | null)?.reason;
        store.getState().setExtend(reason === "session_ended" ? "ended" : "failed");
      });
  }, [due, store, extender, qc, userRef, persist]);
}
