// User-room Weakness Profile events → the query cache (phase-06 plan §5.5, §7.3; interface check §0.16: there is no
// handler router, so this is a hook the screens that need it mount — the weakness screen, and next to useTrainEvents()
// on Home, the hub and the bank for the Train dot (WP7 owns those one-line mounts)).
//
//   weakness:progress  {v, pct, step, etaSec, stalled, analysed, target, importDone, importTotal}
//                      → patch `qk.train.weakness()` while it is not ready (status `computing`, the progress block from
//                        `progressFromEvent`, the pure function the server's labels share); never a fetch
//   weakness:ready     {v, snapshotKey, status, version, bumped, topLabel}
//                      → invalidate `qk.train.weakness()` (refetches when mounted, else marks stale); mark today's plan
//                        and Home stale WITHOUT refetching (AP-10: an import backlog causes no refetch storm); when
//                        `bumped`, turn the Train dot on in `qk.me()` and `qk.badges()` (`weaknessReady`, `trainDot`)
//
// On a resync after a reconnect gap the profile is marked stale (`qk.train.all()` is on P1's resync list as well).
import { useEffect } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { MeData } from "@repo/contracts/http/me";
import type { Badges } from "@repo/contracts/http/train";
import type { WeaknessPayload } from "@repo/contracts/http/weakness";
import type { WeaknessProgressEvent, WeaknessReadyEvent } from "@repo/contracts/socket/user";
import { progressFromEvent } from "@repo/chess-training/weakness/progress";
import { qk } from "@/lib/api/keys";
import { getRealtime } from "../connection";
import { loadFrameValidator } from "../validate.dev";

export const WEAKNESS_EVENT_NAMES = ["weakness:progress", "weakness:ready"] as const;
export type WeaknessEventName = (typeof WEAKNESS_EVENT_NAMES)[number];

/** `weakness:progress`: the cached profile shows the build's progress (a ready profile is left alone). */
export function applyWeaknessProgress(qc: QueryClient, e: WeaknessProgressEvent): boolean {
  const d = qc.getQueryData<WeaknessPayload>(qk.train.weakness());
  if (!d || d.status === "ready") return false;
  qc.setQueryData<WeaknessPayload>(qk.train.weakness(), { ...d, status: "computing", progress: progressFromEvent(e, d.progress) });
  return true;
}

/** The badges with the weakness dot on or off: `trainDot` = something due in the bank (P5) or a new profile (P6). */
export function withWeaknessReady(b: Badges, on: boolean): Badges {
  return { ...b, weaknessReady: on, trainDot: on || b.bankDue > 0 };
}

/** Turns the Train dot on (a bumped profile) or off (the member saw it) in the viewer payload and the badge. */
export function patchWeaknessBadges(qc: QueryClient, on: boolean): void {
  const me = qc.getQueryData<MeData>(qk.me());
  if (me?.badges) qc.setQueryData<MeData>(qk.me(), { ...me, badges: withWeaknessReady(me.badges, on) });
  const badges = qc.getQueryData<Badges>(qk.badges());
  if (badges) qc.setQueryData<Badges>(qk.badges(), withWeaknessReady(badges, on));
}

/** `weakness:ready`: refetch the profile where it is shown; the hub and Home only go stale; the dot when bumped. */
export function applyWeaknessReady(qc: QueryClient, e: WeaknessReadyEvent): void {
  void qc.invalidateQueries({ queryKey: qk.train.weakness(), exact: true });
  void qc.invalidateQueries({ queryKey: qk.train.today(), exact: true, refetchType: "none" });
  void qc.invalidateQueries({ queryKey: qk.home(), exact: true, refetchType: "none" });
  if (e.bumped) patchWeaknessBadges(qc, true);
}

function validateDev(name: WeaknessEventName, payload: unknown): void {
  if (process.env.NODE_ENV === "production") return;
  void loadFrameValidator().then((validate) => validate?.(name, payload));
}

/** Listens on the user room while mounted (the "user" hold). */
export function useWeaknessEvents(options: { enabled?: boolean } = {}): void {
  const qc = useQueryClient();
  const enabled = options.enabled ?? true;
  useEffect(() => {
    const rt = getRealtime();
    if (!rt || !enabled) return;
    const release = rt.acquire("user");
    const offProgress = rt.on<WeaknessProgressEvent & { useq?: unknown }>("weakness:progress", (frame) => {
      if (!frame || typeof frame !== "object") return;
      if (typeof frame.useq === "number") rt.noteUseq(frame.useq);
      validateDev("weakness:progress", frame);
      applyWeaknessProgress(qc, frame);
    });
    const offReady = rt.on<WeaknessReadyEvent & { useq?: unknown }>("weakness:ready", (frame) => {
      if (!frame || typeof frame !== "object") return;
      if (typeof frame.useq === "number") rt.noteUseq(frame.useq);
      validateDev("weakness:ready", frame);
      applyWeaknessReady(qc, frame);
    });
    const offHello = rt.onHello((_hello, resync) => {
      if (resync) void qc.invalidateQueries({ queryKey: qk.train.weakness(), exact: true });
    });
    return () => {
      offProgress();
      offReady();
      offHello();
      release();
    };
  }, [qc, enabled]);
}
