// POST /api/user/onboarding-skip, the legacy onboarding's "skip" (phase-04 plan §7.12: removed at DoD, kept until the
// §12.6 parity check). It marks the user onboarded with no plan check, which is the legacy page's own rule. FIX-1: it
// answers only where that page is served, i.e. while `onboarding-v3` is OFF for the viewer. With the flag on, the v3
// step `PATCH /api/me/onboarding {complete}` (409 plan_required for a non-member, plan §11.1) is the only way to finish
// onboarding, so the legacy route is 404 like every other step route of the other flow.
import type { FlagValues } from "@/lib/flags";

export type LegacySkipDecision = "allow" | "not_found";

export function legacySkipDecision(flags: Pick<FlagValues, "onboarding-v3">): LegacySkipDecision {
  return flags["onboarding-v3"] === true ? "not_found" : "allow";
}
