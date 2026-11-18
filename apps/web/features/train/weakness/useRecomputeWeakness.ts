"use client";

// TR-12 from the page (phase-06 plan §5.4): Retry (failed), "Include bullet games" (insufficient). No idempotency key:
// the member's job row dedupes. Retry is optimistic — the page turns `computing` with an initial progress block at
// once and rolls back on error; the bullet offer waits for the 202. On success the profile is invalidated and today's
// plan marked stale. 429 → the inline countdown (useRetryCountdown on the host, no toast); 402 → the global paywall;
// 5xx → the global toast with the Event ID (meta), and the failed panel turns `failed_again`.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { RecomputeBody, WeaknessPayload, WeaknessProgress } from "@repo/contracts/http/weakness";
import { stepLabels } from "@repo/chess-training/weakness/progress";
import { isApiError } from "@/lib/api/errors";
import { qk } from "@/lib/api/keys";
import { postWeaknessRecompute } from "@/lib/api/queries/weakness";
import { trackWeakness } from "./telemetry";

export type RecomputeFrom = "failed" | "bullet_offer";
export type RecomputeVars = { from: RecomputeFrom; body: RecomputeBody };

/** The `timeClasses` "Include bullet games" asks for (§4.4 `bullet_offer`). */
export const WITH_BULLET: NonNullable<RecomputeBody["timeClasses"]> = ["BULLET", "BLITZ", "RAPID"];

/** The progress block of an optimistic Retry: nothing done yet past the games already analysed. */
export function initialProgress(d: Pick<WeaknessPayload, "games" | "band">): WeaknessProgress {
  const analysed = Math.max(0, d.games.analysed);
  const labels = stepLabels({ importCount: d.games.inScope, bandLabel: d.band?.label ?? null });
  const grade = Math.min(100, Math.floor((100 * Math.min(analysed, 20)) / 20));
  const steps: WeaknessProgress["steps"] = [
    { key: "import", label: labels.import, pct: 100, state: "done" },
    { key: "grade", label: labels.grade, pct: grade, state: grade >= 100 ? "done" : "run" },
    { key: "patterns", label: labels.patterns, pct: grade >= 100 ? 10 : 0, state: grade >= 100 ? "run" : "wait" },
    { key: "compare", label: labels.compare, pct: 0, state: "wait" },
  ];
  return {
    pct: Math.round(15 + 0.7 * grade + (grade >= 100 ? 1 : 0)),
    etaSec: null,
    stalled: false,
    orphaned: false,
    analysed,
    target: Math.max(1, Math.min(300, d.games.inScope || 20)),
    steps,
  };
}

/** The optimistic `computing` payload of a Retry. */
export function optimisticComputing(d: WeaknessPayload): WeaknessPayload {
  return { ...d, status: "computing", failure: null, progress: initialProgress(d) };
}

export function useRecomputeWeakness(isTrial: boolean) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ body }: RecomputeVars) => postWeaknessRecompute(body),
    onMutate: async ({ from }: RecomputeVars) => {
      if (from !== "failed") return { prev: undefined };
      await qc.cancelQueries({ queryKey: qk.train.weakness(), exact: true });
      const prev = qc.getQueryData<WeaknessPayload>(qk.train.weakness());
      if (prev) qc.setQueryData<WeaknessPayload>(qk.train.weakness(), optimisticComputing(prev));
      return { prev };
    },
    onError: (err, { from }, ctx) => {
      if (ctx?.prev) qc.setQueryData(qk.train.weakness(), ctx.prev);
      trackWeakness("weakness_recompute_clicked", { from, result: isApiError(err) && err.code === "rate_limited" ? "rate_limited" : "error" }, isTrial);
    },
    onSuccess: (_res, { from }) => {
      trackWeakness("weakness_recompute_clicked", { from, result: "ok" }, isTrial);
      void qc.invalidateQueries({ queryKey: qk.train.weakness(), exact: true });
      void qc.invalidateQueries({ queryKey: qk.train.today(), exact: true, refetchType: "none" });
    },
    meta: { errorCopy: "Couldn’t rebuild your profile" },
  });
}
