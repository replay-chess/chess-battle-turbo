// Weakness Profile client telemetry (phase-06 plan §10.1). Every event is declared in `@repo/analytics`
// (src/events/weakness.ts); this module imports TYPES only, so zod never reaches the weakness chunks. Same rules as
// trackTrain(): the e2e telemetry sink first, PostHog only when loaded (consent-gated, P11) and never on a `/dev/**`
// demo route, never throws. Properties are pattern keys, counts and enums: never a FEN, a label, a name or a ref.
//
// Every event carries the §10.1 context: `device` (the layout the page chose), `viewport_w`, `zoom_bucket` (the page
// zoom rounded to a tested level) and `is_trial`.
import type { EventProps, WeaknessClientEventName } from "@repo/analytics";
import { capturePosthog } from "@/lib/analytics/posthog-client";
import { pushToTelemetrySink } from "@/lib/analytics/shell-events";
import { deviceClass } from "@/lib/shell/device-class";

type ContextKeys = "device" | "viewport_w" | "zoom_bucket" | "is_trial";
export type WeaknessEventProps<N extends WeaknessClientEventName> = Omit<EventProps<N>, ContextKeys>;
export type ZoomBucket = "80" | "100" | "110" | "125" | "150" | "other";

const ZOOMS: readonly [number, ZoomBucket][] = [
  [0.8, "80"],
  [1, "100"],
  [1.1, "110"],
  [1.25, "125"],
  [1.5, "150"],
];

/**
 * The page zoom of a desktop browser is the ratio of the window's outer width to the CSS viewport (the zoom shrinks
 * the CSS viewport, not the window). Phones and tablets have no browser zoom of that kind: 100. A ratio within 3 % of a
 * tested level is that level; anything else is `other`.
 */
export function zoomBucketOf(outerWidth: number, innerWidth: number, device: "phone" | "tablet" | "desktop"): ZoomBucket {
  if (device !== "desktop" || !(outerWidth > 0) || !(innerWidth > 0)) return "100";
  const ratio = outerWidth / innerWidth;
  for (const [z, b] of ZOOMS) if (Math.abs(ratio - z) <= z * 0.03) return b;
  return "other";
}

function context(isTrial: boolean): Pick<EventProps<"weakness_viewed">, ContextKeys> {
  const device = deviceClass();
  if (typeof window === "undefined") return { device, viewport_w: 0, zoom_bucket: "100", is_trial: isTrial };
  return {
    device,
    viewport_w: Math.max(0, Math.min(10_000, Math.round(window.innerWidth))),
    zoom_bucket: zoomBucketOf(window.outerWidth, window.innerWidth, device),
    is_trial: isTrial,
  };
}

export function trackWeakness<N extends WeaknessClientEventName>(name: N, props: WeaknessEventProps<N>, isTrial: boolean): void {
  try {
    const all = { ...context(isTrial), ...props } as Record<string, unknown>;
    pushToTelemetrySink(name, all);
    if (typeof window === "undefined") return;
    const p = window.location.pathname;
    if (p === "/dev" || p.startsWith("/dev/")) return;
    capturePosthog(name, all);
  } catch {
    // Telemetry never breaks the page.
  }
}
