"use client";

// TR-13 after a real view (phase-06 plan §5.4 "Mark seen", §8.16): once per profile `version`, when the page shows a
// ready profile whose version is newer than the one the member saw. Optimistic: the Train dot goes off in `qk.me()`
// and `qk.badges()` and the cached payload's `seenVersion` moves up at once; other tabs are told to mark the viewer
// stale (BroadcastChannel "rc-sync"). The POST uses `keepalive`, so leaving the page does not cancel it. Errors are a
// Sentry breadcrumb only: the next view sends it again.
import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { WeaknessPayload } from "@repo/contracts/http/weakness";
import { qk } from "@/lib/api/keys";
import { postWeaknessSeen } from "@/lib/api/queries/weakness";
import { broadcastStale } from "@/lib/offline/crossTab";
import { patchWeaknessBadges } from "@/lib/realtime/handlers/weakness";
import { withSentry } from "@/lib/sentry/lazy";
import { trackWeakness } from "./telemetry";

/**
 * The version to mark as seen, or null (nothing new, still computing, or the ready flash still covers the profile).
 * FIX-1: a settled page that is not ready (insufficient, failed) marks it too: a READY write bumped the version, then
 * a later snapshot (a weekly roll after the games aged out, a narrower scope) replaced it before the member looked, so
 * the Train dot pointed at a profile that no longer exists and visiting the page could never clear it. While
 * computing the dot stays: the new profile is on its way.
 */
export function seenVersionDue(p: Pick<WeaknessPayload, "status" | "version" | "seenVersion"> | undefined, showing: boolean): number | null {
  if (!p || !showing || p.status === "computing" || p.version <= p.seenVersion) return null;
  return p.version;
}

export function useMarkWeaknessSeen(payload: WeaknessPayload | undefined, showing: boolean, isTrial: boolean): void {
  const qc = useQueryClient();
  const sentFor = useRef<number | null>(null);
  const version = seenVersionDue(payload, showing);
  const computedAt = payload?.computedAt ?? null;
  const ready = payload?.status === "ready";
  useEffect(() => {
    if (version === null || sentFor.current === version) return;
    sentFor.current = version;
    patchWeaknessBadges(qc, false);
    qc.setQueryData<WeaknessPayload>(qk.train.weakness(), (d) => (d && d.seenVersion < version ? { ...d, seenVersion: version } : d));
    broadcastStale([qk.me(), qk.badges()]);
    const latency = computedAt ? Math.max(0, Math.round((Date.now() - Date.parse(computedAt)) / 1000)) : 0;
    if (ready) trackWeakness("weakness_ready_seen", { version, latency_s: Math.min(365 * 86_400, latency) }, isTrial);
    postWeaknessSeen(version).catch((err: unknown) => {
      withSentry((s) => s.addBreadcrumb({ category: "weakness", message: "seen failed", level: "info", data: { error: err instanceof Error ? err.name : "unknown" } }));
    });
  }, [version, computedAt, qc, isTrial, ready]);
}
