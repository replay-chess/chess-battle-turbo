// Home events (phase-05 plan §10.1, TST X6): the member landing page (client, `trackTrain()` in
// apps/web/lib/analytics/train-events.ts). Closed property sets: counts and states only, no names, refs or FENs.
import { z } from "zod";

export const HOME_VIEW_STATES = ["populated", "new_user", "import_running"] as const;

const count = (max = 10_000) => z.number().int().min(0).max(max);

export const homeClientEvents = {
  /** Home mount (once per page view). */
  home_viewed: z.object({ state: z.enum(HOME_VIEW_STATES), due: count(), has_continue: z.boolean() }).strict(),
  /** Continue's primary (Start Review), Start here (Play the Opera Game), or the analysing card. */
  home_continue_clicked: z.object({ kind: z.enum(["review", "first_legend", "analysing"]) }).strict(),
  /** The Mistake Bank card's CTA (Review 4 · About 3 min, or Open Mistake Bank at 0). */
  home_bank_cta_clicked: z.object({ due: count() }).strict(),
  /** A new-user import CTA. */
  home_import_clicked: z.object({ surface: z.enum(["start_here", "recent_empty", "bank_empty"]) }).strict(),
} as const;

export const homeEvents = { ...homeClientEvents } as const;
