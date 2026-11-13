// Onboarding telemetry (phase-04 plan §10.1). Client-safe, zod-free.
//
// Every event is declared in `@repo/analytics` (src/events/onboarding.ts); this module imports TYPES only, so zod
// never reaches the onboarding chunks, and the e2e telemetry fixture parses what is captured against the schemas.
// Rules as for trackSystem(): the test sink first, PostHog only when loaded and not on a `/dev/**` demo, never
// throws; no usernames, emails or FENs (the schemas allow none).
import type { OnboardingClientEventName, OnboardingClientProps } from "@repo/analytics/events/onboarding";
import { capturePosthog } from "@/lib/analytics/posthog-client";
import { pushToTelemetrySink } from "@/lib/analytics/shell-events";

export type GamesBucket = "0" | "1-49" | "50-499" | "500+";

export type { OnboardingClientEventName };

function onDevRoute(): boolean {
  if (typeof window === "undefined") return false;
  const p = window.location.pathname;
  return p === "/dev" || p.startsWith("/dev/");
}

/** localStorage key of the first step view in this browser (`onb_completed.total_ms`). */
export const ONB_START_KEY = "rc-onb-start";

function markStart(): void {
  try {
    if (typeof window === "undefined" || onDevRoute()) return;
    if (window.localStorage.getItem(ONB_START_KEY) === null) window.localStorage.setItem(ONB_START_KEY, String(Date.now()));
  } catch {
    // Storage blocked (private mode, quota): total_ms reads 0.
  }
}

/** When this browser first viewed an onboarding step (epoch ms), or null. */
export function onboardingStartedAt(): number | null {
  try {
    const raw = typeof window === "undefined" ? null : window.localStorage.getItem(ONB_START_KEY);
    const n = raw === null ? Number.NaN : Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

/** Forget the start mark once `onb_completed` is sent (a later onboarding on this browser starts afresh). */
export function clearOnboardingStart(): void {
  try {
    if (typeof window !== "undefined") window.localStorage.removeItem(ONB_START_KEY);
  } catch {
    // Nothing to clear.
  }
}

export function trackOnboarding<N extends OnboardingClientEventName>(name: N, props: OnboardingClientProps<N>): void {
  if (name === "onb_step_viewed") markStart();
  try {
    pushToTelemetrySink(name, props as Record<string, unknown>);
    if (onDevRoute()) return;
    capturePosthog(name, props as Record<string, unknown>);
  } catch {
    // Telemetry never breaks onboarding.
  }
}

/** `games_bucket` of a rated-games count (never the exact number). */
export function gamesBucket(n: number | null | undefined): GamesBucket {
  const v = typeof n === "number" && Number.isFinite(n) ? n : 0;
  if (v <= 0) return "0";
  if (v < 50) return "1-49";
  if (v < 500) return "50-499";
  return "500+";
}

/** The `reason` of a Lichess return: one of the contract's reasons, else "unknown" (never free text). */
export function lichessReasonProp(
  reason: string | null | undefined,
): "state" | "upstream" | "linked_elsewhere" | "already_linked" | "rate_limited" | "unknown" {
  switch (reason) {
    case "state":
    case "upstream":
    case "linked_elsewhere":
    case "already_linked":
    case "rate_limited":
      return reason;
    default:
      return "unknown";
  }
}
