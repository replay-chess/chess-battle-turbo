// `entitlement:changed` → the query cache (phase-04 plan 5.5, 5.6; api-perf AP-39). Emitted by the web's entitlement
// fan-out (lib/billing/fanout.ts) for every billing write that changed the member's entitlement, and for a recorded
// payment failure (`paymentFailed: true`).
//
// - `qk.me()`: the entitlement is merged from the payload (it carries the full wire DTO; no refetch);
// - every `qk.billing.activation(*)`: entitled → `{state: "active", entitlement}` at once; a payment failure →
//   refetched (the server decides whether the failure belongs to this checkout);
// - an entitled payload refreshes the socket token, so the socket's `ent` claim is true before the member reaches a
//   game (`session:refresh_token`);
// - `router.refresh()` only when the route's gate decision changes (member ↔ not member), and only in the VISIBLE tab;
//   a hidden tab remembers it and refreshes on `visibilitychange`.
// The pure parts are exported for entitlement.test.ts; `useEntitlementEvents()` wires them to the socket.
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { ActivationData } from "@repo/contracts/http/billing";
import type { MeData } from "@repo/contracts/http/me";
import type { EntitlementChangedEvent } from "@repo/contracts/socket/user";
import { qk } from "@/lib/api/keys";
import { fetchSocketToken, getRealtime, type Hold, type RealtimeConnection } from "../connection";

export const ENTITLEMENT_EVENT = "entitlement:changed" as const;
/** Prefix of every activation query (`qk.billing.activation(key)`). */
export const ACTIVATION_QUERY_PREFIX = ["billing", "activation"] as const;

export type EntitlementEffect = {
  /** member before → member after differ (the page's gate decision changed). null before: unknown (no viewer cached). */
  gateChanged: boolean;
  entitled: boolean;
  paymentFailed: boolean;
};

/** Applies one event to the caches. Pure apart from the QueryClient it is given. */
export function applyEntitlementEvent(qc: QueryClient, payload: EntitlementChangedEvent): EntitlementEffect {
  const prev = qc.getQueryData<MeData>(qk.me());
  const wasMember = prev?.entitlement.member;
  qc.setQueryData<MeData>(qk.me(), (me) => (me ? { ...me, entitlement: payload.entitlement } : me));

  const entitled = payload.entitlement.entitled;
  const paymentFailed = payload.paymentFailed === true;
  if (entitled) {
    qc.setQueriesData<ActivationData>({ queryKey: ACTIVATION_QUERY_PREFIX }, (d) =>
      d ? { ...d, state: "active", reason: null, entitlement: payload.entitlement, trial: { ...d.trial, active: payload.entitlement.trial.active, endsAt: payload.entitlement.trial.endsAt } } : d,
    );
  } else if (paymentFailed) {
    void qc.invalidateQueries({ queryKey: ACTIVATION_QUERY_PREFIX, refetchType: "active" });
  }
  return { gateChanged: wasMember !== undefined && wasMember !== payload.entitlement.member, entitled, paymentFailed };
}

/** What the visible / hidden tab does about a changed gate (AP-39). */
export function refreshDecision(effect: Pick<EntitlementEffect, "gateChanged">, visible: boolean): "refresh" | "defer" | "none" {
  if (!effect.gateChanged) return "none";
  return visible ? "refresh" : "defer";
}

/** A fresh socket token handed to the live connection (`session:refresh_token`), so `ent` follows the entitlement. */
export async function refreshRealtimeToken(rt: Pick<RealtimeConnection, "seedToken" | "isLive" | "command"> | null = getRealtime()): Promise<boolean> {
  if (!rt) return false;
  try {
    const token = await fetchSocketToken();
    if (!token) return false;
    rt.seedToken(token);
    if (rt.isLive()) await rt.command("session:refresh_token", { token: token.token });
    return true;
  } catch {
    return false;
  }
}

let validator: Promise<((payload: unknown) => void) | null> | null = null;

/** Dev-only contract check (the dynamic import keeps zod out of production chunks). */
function validateDev(payload: unknown): void {
  if (process.env.NODE_ENV !== "production") {
    validator ??= import("@repo/contracts/socket/user")
      .then(({ EntitlementChangedEvent }) => (p: unknown) => {
        const r = EntitlementChangedEvent.safeParse(p);
        if (!r.success) console.error(`[realtime] "${ENTITLEMENT_EVENT}" does not match its contract`, r.error.issues);
      })
      .catch(() => null);
    void validator.then((v) => v?.(payload));
  }
}

type Frame = EntitlementChangedEvent & { useq?: unknown };

/**
 * Listens to `entitlement:changed` while mounted. `hold` keeps the socket up: the activating pages pass "activation"
 * (critical: survives a hidden tab); others default to "user". `onEvent` sees every validated payload (the activation
 * machine's SOCKET_ENTITLED / payment-failure input), read through a ref so a new callback never re-subscribes.
 */
export function useEntitlementEvents(
  options: { enabled?: boolean; hold?: Hold; onEvent?: (payload: EntitlementChangedEvent, effect: EntitlementEffect) => void } = {},
): void {
  const qc = useQueryClient();
  const router = useRouter();
  const enabled = options.enabled ?? true;
  const hold = options.hold ?? "user";
  const onEvent = useRef(options.onEvent);
  useEffect(() => {
    onEvent.current = options.onEvent;
  });

  useEffect(() => {
    const rt = getRealtime();
    if (!rt || !enabled) return;
    const release = rt.acquire(hold);
    let deferred = false;
    const off = rt.on<Frame>(ENTITLEMENT_EVENT, (frame) => {
      if (!frame || frame.v !== 1) return;
      if (typeof frame.useq === "number") rt.noteUseq(frame.useq);
      validateDev(frame);
      const { useq: _useq, ...payload } = frame;
      void _useq;
      const effect = applyEntitlementEvent(qc, payload);
      if (effect.entitled) void refreshRealtimeToken(rt);
      const decision = refreshDecision(effect, typeof document === "undefined" || document.visibilityState === "visible");
      if (decision === "refresh") router.refresh();
      else if (decision === "defer") deferred = true;
      onEvent.current?.(payload, effect);
    });
    const onVisible = () => {
      if (deferred && document.visibilityState === "visible") {
        deferred = false;
        router.refresh();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      off();
      document.removeEventListener("visibilitychange", onVisible);
      release();
    };
  }, [qc, router, enabled, hold]);
}
