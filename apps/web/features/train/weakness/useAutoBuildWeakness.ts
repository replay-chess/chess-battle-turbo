"use client";

// The orphaned build's one POST (phase-06 plan §5.4 "Auto-build", §8.14): ≥ 5 analysed games in scope, no snapshot and
// no job — nothing would ever finish the build, and GETs create no work (AP-09). Once per mount, when the payload says
// `progress.orphaned`, the page sends TR-12 `{}` (the same route and durable limit as Retry). A 429 means a build was
// asked for in the last 10 minutes, so one is coming: ignored, no toast. Other errors leave a Sentry breadcrumb only.
import { useEffect, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { WeaknessPayload } from "@repo/contracts/http/weakness";
import { isApiError } from "@/lib/api/errors";
import { qk } from "@/lib/api/keys";
import { postWeaknessRecompute } from "@/lib/api/queries/weakness";
import { withSentry } from "@/lib/sentry/lazy";
import { trackWeakness } from "./telemetry";

export function useAutoBuildWeakness(payload: Pick<WeaknessPayload, "progress"> | undefined, isTrial: boolean): void {
  const qc = useQueryClient();
  const sent = useRef(false);
  const build = useMutation({
    mutationFn: () => postWeaknessRecompute({}),
    onSuccess: () => {
      trackWeakness("weakness_recompute_clicked", { from: "auto", result: "ok" }, isTrial);
      void qc.invalidateQueries({ queryKey: qk.train.weakness(), exact: true });
    },
    onError: (err) => {
      const limited = isApiError(err) && err.code === "rate_limited";
      trackWeakness("weakness_recompute_clicked", { from: "auto", result: limited ? "rate_limited" : "error" }, isTrial);
      if (limited) return;
      withSentry((s) => s.addBreadcrumb({ category: "weakness", message: "auto-build failed", level: "warning", data: { code: isApiError(err) ? err.code : "unknown" } }));
    },
    meta: { errorUi: "inline" },
  });
  const orphaned = payload?.progress?.orphaned === true;
  const { mutate } = build;
  useEffect(() => {
    if (!orphaned || sent.current) return;
    sent.current = true;
    mutate();
  }, [orphaned, mutate]);
}
