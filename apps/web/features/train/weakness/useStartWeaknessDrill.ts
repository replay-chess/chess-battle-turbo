"use client";

// TR-7 `POST /api/train/sessions {kind: "weakness", pattern, size, mix}` (phase-06 plan §5.4 "Start drill", §4.7).
// Not optimistic: the server makes the session id; the CTA spins until the payload is back, which is seeded into
// `qk.train.session(ref)` before the runner opens, so its first render needs no fetch. Idempotency: the hub's rule (one
// UUID per intent, reused for repeated clicks of the same body within 10 s; a size or mix change is another body, so
// another key). Errors: 400 `validation_failed {reason: "empty_drill"}` → the config's `empty` state; 422
// `idempotency_key_reused` → a new key and one silent retry; 429 → the inline countdown; 402 → the global paywall;
// 5xx / network → the toast "Couldn't start the drill" with the Event ID and Retry (`startError`; the config stays).
import { useRef } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { SessionPayload } from "@repo/contracts/http/train";
import { createTrainSession } from "@/components/train/hub/useStartSession";
import { keyFor, runnerHref, type KeyState } from "@/components/train/hub/session";
import { copy } from "@/components/train/weakness/copy";
import { noteCreatedSession } from "@/features/train/created-sessions";
import { isApiError } from "@/lib/api/errors";
import { qk } from "@/lib/api/keys";
import { trackWeakness } from "./telemetry";

export type DrillVars = { pattern: string; size: 10 | 20; mix: boolean; own: number; puzzles: number };

/** A TR-7 error that means "nothing to drill" (the config's `empty` state, no toast). */
export function isEmptyDrill(err: unknown): boolean {
  return isApiError(err) && err.code === "validation_failed" && err.reason === "empty_drill";
}

export function startResult(err: unknown): "empty" | "rate_limited" | "error" {
  if (isEmptyDrill(err)) return "empty";
  if (isApiError(err) && err.code === "rate_limited") return "rate_limited";
  return "error";
}

export function useStartWeaknessDrill(isTrial: boolean, retry: () => void) {
  const router = useRouter();
  const qc = useQueryClient();
  const last = useRef<KeyState | null>(null);
  return useMutation({
    mutationFn: async ({ pattern, size, mix }: DrillVars): Promise<SessionPayload> => {
      const body = { kind: "weakness" as const, pattern, size, mix };
      const serial = JSON.stringify(body);
      last.current = keyFor(last.current, serial, Date.now());
      try {
        return await createTrainSession(body, last.current.key);
      } catch (err) {
        if (!isApiError(err) || err.code !== "idempotency_key_reused") throw err;
        last.current = keyFor(null, serial, Date.now());
        return createTrainSession(body, last.current.key);
      }
    },
    onSuccess: (payload, v) => {
      trackWeakness("weakness_drill_started", { pattern: v.pattern, size: v.size, mix: v.mix, own: v.own, puzzles: v.puzzles, result: "ok" }, isTrial);
      noteCreatedSession(payload.ref, "weakness");
      qc.setQueryData(qk.train.session(payload.ref), payload);
      void qc.invalidateQueries({ queryKey: qk.train.today(), exact: true, refetchType: "none" });
      router.push(runnerHref(payload));
    },
    onError: (err, v) => {
      trackWeakness("weakness_drill_started", { pattern: v.pattern, size: v.size, mix: v.mix, own: v.own, puzzles: v.puzzles, result: startResult(err) }, isTrial);
    },
    meta: { errorCopy: copy.startError, object: "the drill", retry },
  });
}
