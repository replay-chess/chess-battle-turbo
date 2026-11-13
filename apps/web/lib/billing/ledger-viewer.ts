// The ledger-aware viewer for server-rendered pages and layouts (phase-04 plan 7.2, 8.4.3; FIX-2, billing review
// round 2, the other half of FIX-1 #17). FIX-1 made GET /api/me, Plan and Welcome ask the trial ledger, but the server
// seeds of `qk.me()` in app/(app)/layout.tsx, app/onboarding/layout.tsx and app/checkout/activating/page.tsx still used
// the users-row `trial.eligible`; the user store mirrors qk.me(), so after a hard load a client navigation to /pricing
// offered "Start free trial" to a ledger hit until the query refetched, while the checkout sent `trial: false` and Dodo
// charged at once.
//
// One React `cache()` per request (keyed on the viewer object, which getViewer() itself caches per request): a layout
// and its page share the one probe, which runs only while the row says eligible (never-subscribed non-members).
import "server-only";
import { cache } from "react";
import type { Viewer } from "@/lib/auth/viewer";
import { defaultLedgerProbe, withLedgerEligibility } from "./trial-eligibility";

export const ledgerAwareViewer = cache(
  async (viewer: Viewer): Promise<Viewer> =>
    withLedgerEligibility(viewer, defaultLedgerProbe, async (err) => {
      try {
        const { logger } = await import("@/lib/logger");
        logger.warn(`trial-ledger probe failed (${err instanceof Error ? err.name : "unknown"})`);
      } catch {
        // logging never fails a page
      }
    }),
);
