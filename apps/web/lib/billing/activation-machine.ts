// The activating pages' client state machine (phase-04 plan 8.5.3; 5.7). A pure reducer: no timers, no I/O. The hook
// (useActivation.ts) feeds it server answers, socket events and clock ticks, and acts on the phase it lands in.
//
//   polling ──SERVER active / SOCKET_ENTITLED──▶ success      (session reload, socket token refresh, analytics `via`)
//   polling ──SERVER failed / URL_STATUS_FAILED──▶ failed     (onboarding: replace to plan with ?status=failed)
//   polling ──TICK at STALLED_AFTER_MS (12 s)──▶ stalled      (polling continues)
//   stalled ──SERVER active / SOCKET_ENTITLED──▶ success
//   stalled ──CHECK_AGAIN──▶ polling                          (refetch with force=1; the stalled timer restarts)
//   failed  ──SERVER active within FAILED_GRACE_MS (30 s)──▶ success   (3-D Secure can succeed after a failed redirect)
//   any     ──POLL_STOPPED (180 s)──▶ unchanged phase          (the UI keeps `stalled`; Check Again restarts the poller)
//
// Checkout only: `success` starts COUNTDOWN_MS (3 s) to the destination, paused while the card has focus or hover.
// Times are epoch ms supplied by the caller.

export const STALLED_AFTER_MS = 12_000;
export const FAILED_GRACE_MS = 30_000;
export const POLL_STOP_MS = 180_000;
export const COUNTDOWN_MS = 3_000;

export type ActivationKind = "checkout" | "onboarding";
export type ActivationPhase = "polling" | "stalled" | "success" | "failed";
/** How success was learned (analytics `checkout_activation_succeeded.via`). */
export type SuccessVia = "socket" | "poll" | "self_heal" | "already";

export type MachineState = {
  kind: ActivationKind;
  phase: ActivationPhase;
  /** When the page started waiting (mount); `waited_ms` is measured from here. */
  startedAt: number;
  /** When the stalled timer started (mount, or the last Check Again). */
  stalledFrom: number;
  /** When `failed` was entered (the 30 s grace window). */
  failedAt: number | null;
  failReason: "declined" | "cancelled" | "url_status" | null;
  via: SuccessVia | null;
  /** True once the 180 s poller gave up (Check Again restarts it). */
  pollStopped: boolean;
  /** Active on the entitled-at-arrival page (no checkout return in the URL): "You're already a member". */
  alreadyMember: boolean;
  /** Checkout success only. null: no countdown (onboarding, or already a member). */
  countdown: { remainingMs: number; paused: boolean; lastTickAt: number } | null;
  /** The countdown reached 0: navigate to the destination (once). */
  navigate: boolean;
};

export type MachineEvent =
  | { type: "SERVER"; state: "pending" | "active" | "failed"; reason?: "declined" | "cancelled" | null; selfHeal?: boolean; at: number }
  | { type: "SOCKET_ENTITLED"; at: number }
  | { type: "SOCKET_PAYMENT_FAILED"; at: number }
  | { type: "URL_STATUS_FAILED"; at: number }
  | { type: "TICK"; at: number }
  | { type: "CHECK_AGAIN"; at: number }
  | { type: "POLL_STOPPED"; at: number }
  | { type: "COUNTDOWN_PAUSE"; at: number }
  | { type: "COUNTDOWN_RESUME"; at: number };

export type MachineInit = {
  kind: ActivationKind;
  now: number;
  /** The RSC first paint's answer (`getActivation(..., {dodo: false})`). */
  initial: "pending" | "active" | "failed";
  initialReason?: "declined" | "cancelled" | null;
  /** Dodo's `?status=failed` (a hint the client may act on: it only ever shows the failure copy). */
  urlStatusFailed: boolean;
  /** The URL is a checkout return (`checkout=success`, `subscription_id` or `session_id`). */
  isReturn: boolean;
};

function succeed(s: MachineState, via: SuccessVia, at: number): MachineState {
  const countdown = s.kind === "checkout" && !s.alreadyMember ? { remainingMs: COUNTDOWN_MS, paused: false, lastTickAt: at } : null;
  return { ...s, phase: "success", via, failedAt: null, failReason: null, countdown, navigate: false };
}

function fail(s: MachineState, reason: MachineState["failReason"], at: number): MachineState {
  return { ...s, phase: "failed", failedAt: at, failReason: reason, via: null, countdown: null };
}

export function initMachine(init: MachineInit): MachineState {
  const base: MachineState = {
    kind: init.kind,
    phase: "polling",
    startedAt: init.now,
    stalledFrom: init.now,
    failedAt: null,
    failReason: null,
    via: null,
    pollStopped: false,
    alreadyMember: false,
    countdown: null,
    navigate: false,
  };
  if (init.initial === "active") return succeed({ ...base, alreadyMember: !init.isReturn }, "already", init.now);
  if (init.initial === "failed") return fail(base, init.initialReason ?? "declined", init.now);
  if (init.urlStatusFailed) return fail(base, "url_status", init.now);
  return base;
}

function tickCountdown(s: MachineState, at: number): MachineState {
  const c = s.countdown;
  if (!c || s.navigate) return s;
  if (c.paused) return { ...s, countdown: { ...c, lastTickAt: at } };
  const remainingMs = Math.max(0, c.remainingMs - Math.max(0, at - c.lastTickAt));
  return { ...s, countdown: { ...c, remainingMs, lastTickAt: at }, navigate: remainingMs === 0 };
}

export function activationReducer(s: MachineState, e: MachineEvent): MachineState {
  switch (e.type) {
    case "SERVER": {
      if (e.state === "active") {
        if (s.phase === "polling" || s.phase === "stalled") return succeed(s, e.selfHeal ? "self_heal" : "poll", e.at);
        if (s.phase === "failed" && s.failedAt !== null && e.at - s.failedAt <= FAILED_GRACE_MS) return succeed(s, e.selfHeal ? "self_heal" : "poll", e.at);
        return s;
      }
      if (e.state === "failed" && (s.phase === "polling" || s.phase === "stalled")) return fail(s, e.reason ?? "declined", e.at);
      return s;
    }
    case "SOCKET_ENTITLED": {
      if (s.phase === "polling" || s.phase === "stalled") return succeed(s, "socket", e.at);
      if (s.phase === "failed" && s.failedAt !== null && e.at - s.failedAt <= FAILED_GRACE_MS) return succeed(s, "socket", e.at);
      return s;
    }
    case "SOCKET_PAYMENT_FAILED":
      // The socket only says "refetch": the server decides (a failure older than this checkout is not this checkout's).
      return s;
    case "URL_STATUS_FAILED":
      return s.phase === "polling" || s.phase === "stalled" ? fail(s, "url_status", e.at) : s;
    case "TICK": {
      if (s.phase === "polling" && e.at - s.stalledFrom >= STALLED_AFTER_MS) return { ...s, phase: "stalled" };
      if (s.phase === "success") return tickCountdown(s, e.at);
      return s;
    }
    case "CHECK_AGAIN":
      return s.phase === "stalled" || (s.phase === "polling" && s.pollStopped)
        ? { ...s, phase: "polling", stalledFrom: e.at, pollStopped: false }
        : s;
    case "POLL_STOPPED":
      // The UI keeps showing what it shows; a poller that gave up while still polling shows `stalled`.
      return { ...s, pollStopped: true, phase: s.phase === "polling" ? "stalled" : s.phase };
    case "COUNTDOWN_PAUSE": {
      if (!s.countdown || s.countdown.paused) return s;
      const t = tickCountdown(s, e.at);
      return t.navigate || !t.countdown ? t : { ...t, countdown: { ...t.countdown, paused: true } };
    }
    case "COUNTDOWN_RESUME":
      return s.countdown && s.countdown.paused ? { ...s, countdown: { ...s.countdown, paused: false, lastTickAt: e.at } } : s;
  }
}

/**
 * The activation poll schedule (plan 5.7): 2 s × 6, then 5 s × 12, then 15 s, stopping at 180 s (false). `passive`
 * (Done before the trial is confirmed, Plan after a failed return): 5 s × 6, then 15 s, also stopping at 180 s.
 * `elapsedMs` = time since the poller (re)started; the n-th delay depends only on how many polls already ran.
 */
export function activationPollDelay(pollsDone: number, elapsedMs: number, passive = false): number | false {
  if (elapsedMs >= POLL_STOP_MS) return false;
  if (passive) return pollsDone < 6 ? 5_000 : 15_000;
  if (pollsDone < 6) return 2_000;
  if (pollsDone < 18) return 5_000;
  return 15_000;
}

/** Whole seconds left on the countdown, for the copy ("in 3 seconds"). */
export function countdownSeconds(s: MachineState): number | null {
  return s.countdown ? Math.ceil(s.countdown.remainingMs / 1000) : null;
}
