"use client";
// useActivation (phase-04 plan 5.2, 5.7, 8.5.3): the activating pages' engine, shared by `/checkout/activating` (WP-D)
// and `/onboarding/activating` (WP-F), and in `passive` mode by Done / Plan.
//
// - The activation query (`qk.billing.activation(key)`, seeded by the RSC page) is polled on the plan 5.7 schedule
//   (2 s × 6, 5 s × 12, 15 s; 180 s stop) EVEN WHEN the socket is live and the tab hidden (money: belt and braces).
//   Passive mode polls 5 s × 6 then 15 s, only while the socket is not live.
// - `entitlement:changed` arrives through the "activation" hold (critical: the socket stays up in a hidden tab).
// - Both feed the pure machine (activation-machine.ts); the hook acts on the phase it lands in: on success the Clerk
//   session reloads (so `md.entitled` reaches the JWT; `rc_act` covers the gap), the socket token refreshes (the
//   `ent` claim), `qk.me()` gets the entitlement, and the analytics event names how it got there.
// - Check Again restarts the poller and asks the server with `force=1` (a Dodo lookup); a failing lookup leaves the
//   page `stalled`.
// The poller's start time and poll count live in a module map per query hash, so re-renders never restart it.
import { useEffect, useReducer, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ActivationData, ActivationQuery } from "@repo/contracts/http/billing";
import { activationKeyOf, activationQuery, fetchActivation } from "@/lib/api/queries/billing";
import { setMeEntitlement } from "@/lib/api/queries/me";
import { getRealtime } from "@/lib/realtime/connection";
import { refreshRealtimeToken, useEntitlementEvents } from "@/lib/realtime/handlers/entitlement";
import { POLL_STOP_MS, activationPollDelay, activationReducer, initMachine, type ActivationKind, type MachineState } from "./activation-machine";
import { SESSION_RELOAD_CAP_MS, reloadClerkSession } from "./client";
import { eventSourceOf, statusParamOf, trackBilling } from "./telemetry";

/** How often the machine's clock ticks (the 12 s stall and the 3 s countdown). */
const TICK_MS = 250;

/**
 * One poller per query hash: when it (re)started and how many answers the query had then. TanStack calls
 * `refetchInterval` on every observer update, not once per poll, so the poll count is the query's own answer count
 * (`dataUpdateCount + errorUpdateCount`) minus the count at the start, never a counter bumped by the callback.
 */
type Poller = { startedAt: number; base: number | null };
const pollers = new Map<string, Poller>();

function pollerFor(hash: string, now: number): Poller {
  let p = pollers.get(hash);
  if (!p) {
    p = { startedAt: now, base: null };
    pollers.set(hash, p);
  }
  return p;
}

export type UseActivationInput = {
  kind: ActivationKind;
  /** The URL's Dodo return parameters (+ force). */
  params: ActivationQuery;
  /** The RSC first paint (`getActivation(viewer, params, {dodo: false})`). */
  initial: ActivationData;
  /** The URL is a checkout return (checkout=success, subscription_id or session_id). */
  isReturn: boolean;
  /** The checkout's `source` URL parameter (analytics). */
  source: string | null;
  /** Done / Plan: poll gently and only while the socket is down. */
  passive?: boolean;
};

export type UseActivation = {
  state: MachineState;
  data: ActivationData;
  /** Check Again (stalled): restarts the poller and forces a Dodo lookup. */
  checkAgain: () => void;
  checking: boolean;
  pauseCountdown: () => void;
  resumeCountdown: () => void;
};

export function useActivation(input: UseActivationInput): UseActivation {
  const qc = useQueryClient();
  const options = activationQuery(input.params);
  const hash = JSON.stringify(options.queryKey);
  const source = eventSourceOf(input.source);
  const passive = input.passive ?? false;
  const [mountedAt] = useState(() => Date.now());

  const [state, dispatch] = useReducer(activationReducer, undefined, () =>
    initMachine({
      kind: input.kind,
      now: mountedAt,
      initial: input.initial.state,
      initialReason: input.initial.reason,
      urlStatusFailed: input.params.status === "failed",
      isReturn: input.isReturn,
    }),
  );
  const phaseRef = useRef(state.phase);
  useEffect(() => {
    phaseRef.current = state.phase;
  }, [state.phase]);

  const query = useQuery({
    ...options,
    initialData: input.initial,
    refetchIntervalInBackground: !passive,
    refetchInterval: (q) => {
      if (phaseRef.current !== "polling" && phaseRef.current !== "stalled") return false;
      if (passive && getRealtime()?.isLive()) return false;
      const now = Date.now();
      const p = pollerFor(hash, now);
      const answers = q.state.dataUpdateCount + q.state.errorUpdateCount;
      if (p.base === null) p.base = answers;
      return activationPollDelay(Math.max(0, answers - p.base), now - p.startedAt, passive);
    },
  });

  // Server answers → the machine.
  const data = query.data ?? input.initial;
  const lastSeen = useRef(query.dataUpdatedAt);
  useEffect(() => {
    if (query.dataUpdatedAt === lastSeen.current) return;
    lastSeen.current = query.dataUpdatedAt;
    dispatch({ type: "SERVER", state: data.state, reason: data.reason, at: Date.now() });
  }, [query.dataUpdatedAt, data.state, data.reason]);

  // The socket → the machine (the cache updates themselves happen in the handler).
  useEntitlementEvents({
    hold: passive ? "user" : "activation",
    onEvent: (payload) => {
      if (payload.entitlement.entitled) dispatch({ type: "SOCKET_ENTITLED", at: Date.now() });
      else if (payload.paymentFailed) dispatch({ type: "SOCKET_PAYMENT_FAILED", at: Date.now() });
    },
  });

  // The 180 s stop (plan 5.7): the poller's own refetchInterval returns false from then on; the machine is told here,
  // outside TanStack's callbacks. Check Again restarts both (a new poller start and a new timer).
  const waiting = state.phase === "polling" || state.phase === "stalled";
  const restartedAt = state.stalledFrom;
  useEffect(() => {
    if (!waiting || state.pollStopped) return;
    const p = pollerFor(hash, Date.now());
    const left = Math.max(0, p.startedAt + POLL_STOP_MS - Date.now());
    const id = setTimeout(() => dispatch({ type: "POLL_STOPPED", at: Date.now() }), left);
    return () => clearTimeout(id);
  }, [waiting, state.pollStopped, restartedAt, hash]);

  // The clock: the 12 s stall while waiting, the countdown on a checkout success.
  const ticking = state.phase === "polling" || (state.phase === "success" && state.countdown !== null && !state.navigate);
  useEffect(() => {
    if (!ticking) return;
    const id = setInterval(() => dispatch({ type: "TICK", at: Date.now() }), TICK_MS);
    return () => clearInterval(id);
  }, [ticking]);

  // checkout_returned, once per mount.
  const returned = useRef(false);
  useEffect(() => {
    if (returned.current || passive) return;
    returned.current = true;
    trackBilling("checkout_returned", { status_param: statusParamOf(input.params.status), source });
  }, [passive, input.params.status, source]);

  // Phase effects (once per transition).
  const acted = useRef<string | null>(null);
  useEffect(() => {
    const mark = `${state.phase}:${state.failedAt ?? ""}:${state.via ?? ""}`;
    if (acted.current === mark) return;
    const previous = acted.current;
    acted.current = mark;
    const waited = Math.min(1_800_000, Math.max(0, Date.now() - state.startedAt));
    if (state.phase === "success") {
      setMeEntitlement(qc, data.entitlement);
      void Promise.race([reloadClerkSession(), new Promise((r) => setTimeout(r, SESSION_RELOAD_CAP_MS))]);
      void refreshRealtimeToken();
      if (!passive) trackBilling("checkout_activation_succeeded", { waited_ms: Math.round(waited), via: state.via ?? "poll", is_trial: data.entitlement.trial.active, source });
    } else if (state.phase === "stalled" && previous !== null && !passive) {
      trackBilling("checkout_activation_stalled", { waited_ms: Math.round(waited), source });
    } else if (state.phase === "failed" && !passive) {
      trackBilling("checkout_activation_failed", { reason: state.failReason ?? "declined", source });
    }
  }, [state.phase, state.failedAt, state.via, state.startedAt, state.failReason, passive, qc, data.entitlement, source]);

  const [checking, setChecking] = useState(false);
  const checkAgain = () => {
    const now = Date.now();
    pollers.set(hash, { startedAt: now, base: null });
    dispatch({ type: "CHECK_AGAIN", at: now });
    if (!passive) trackBilling("checkout_check_again_clicked", { source });
    setChecking(true);
    fetchActivation({ ...input.params, force: "1" })
      .then((fresh) => {
        qc.setQueryData(options.queryKey, fresh);
      })
      .catch(() => {
        // upstream_unavailable / rate_limited: the page stays stalled; the poller keeps asking the database.
      })
      .finally(() => setChecking(false));
  };

  // Release the poller's bookkeeping when the page goes.
  useEffect(() => () => void pollers.delete(hash), [hash]);

  return {
    state,
    data,
    checkAgain,
    checking,
    pauseCountdown: () => dispatch({ type: "COUNTDOWN_PAUSE", at: Date.now() }),
    resumeCountdown: () => dispatch({ type: "COUNTDOWN_RESUME", at: Date.now() }),
  };
}

/** The activation key of a URL's parameters (the page and the hook agree on it). */
export { activationKeyOf };
