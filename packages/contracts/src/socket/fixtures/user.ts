// Typed P4 and P5 user-room payloads (phase-04 plan §7.6, phase-05 plan §7.4) for the UI packages (the demo routes simulate the socket with them),
// the worker and web tests, and the size tests. `worst` fills every field to its longest realistic value (25-char
// refs, 7-digit counters, the longest provider and error code, ISO instants, a full entitlement DTO with a payment
// issue and a scheduled period end), which is what USER_EVENT_BUDGETS are asserted against.
import type { UserEventName, UserEventPayload } from "../user";

export const USER_FIXTURE_RUN_REF = "cm3p4r8un0001slzpimp4rtq1";
export const USER_FIXTURE_GAME_REF = "cm3p4g4me0003slzpfirst0g1";

/** Typical payloads, as the Done screen sees an import of the design's 480 games. */
export function userEventFixtures(): { [N in UserEventName]: UserEventPayload<N> } {
  return {
    "import:progress": {
      v: 1,
      runRef: USER_FIXTURE_RUN_REF,
      provider: "chesscom",
      phase: "saving",
      seen: 480,
      imported: 212,
      total: 480,
      analysed: 3,
    },
    "import:finished": {
      v: 1,
      runRef: USER_FIXTURE_RUN_REF,
      provider: "chesscom",
      imported: 474,
      skipped: 6,
      total: 480,
      newGames: 474,
      analysisQueued: 20,
      analysed: 5,
      firstReviewGameRef: USER_FIXTURE_GAME_REF,
    },
    "import:failed": {
      v: 1,
      runRef: USER_FIXTURE_RUN_REF,
      provider: "chesscom",
      code: "rate_limited",
      retryAt: "2026-11-10T09:31:00.000Z",
      imported: 212,
      total: 480,
    },
    "entitlement:changed": {
      v: 1,
      entitlement: {
        state: "trial",
        member: true,
        entitled: true,
        paywall: true,
        planKey: "monthly",
        interval: "month",
        priceCents: 499,
        status: "active",
        currentPeriodEnd: "2026-11-17T09:30:00.000Z",
        cancelAtPeriodEnd: false,
        trial: { active: true, used: true, endsAt: "2026-11-17T09:30:00.000Z", daysLeft: 7, eligible: false },
        paymentIssue: null,
        hasBillingPortal: true,
      },
      subscriptionUpdatedAt: "2026-11-10T09:30:00.000Z",
    },
    // P5 (phase-05 §7.4): after grading on another device, 4 due of 23; the next batch tomorrow at 08:00 UTC.
    "bank:due_changed": { v: 1, bankDue: 4, dueRaw: 6, total: 23, nextAt: "2026-11-11T08:00:00.000Z" },
    // P5: a backfill minute that extracted 3 games and added 5 cards.
    "mistakes:added": { v: 1, games: 3, added: 7, cardsAdded: 5, total: 28, bankDue: 9 },
  };
}

/** The longest payloads each event can carry. */
export function worstUserEventFixtures(): { [N in UserEventName]: UserEventPayload<N> } {
  const big = 9_999_999;
  return {
    "import:progress": {
      v: 1,
      runRef: USER_FIXTURE_RUN_REF,
      provider: "chesscom",
      phase: "reading",
      seen: big,
      imported: big,
      total: big,
      analysed: big,
    },
    "import:finished": {
      v: 1,
      runRef: USER_FIXTURE_RUN_REF,
      provider: "chesscom",
      imported: big,
      skipped: big,
      total: big,
      newGames: big,
      analysisQueued: big,
      analysed: big,
      firstReviewGameRef: USER_FIXTURE_GAME_REF,
    },
    "import:failed": {
      v: 1,
      runRef: USER_FIXTURE_RUN_REF,
      provider: "chesscom",
      code: "rate_limited",
      retryAt: "2026-11-10T09:31:00.000Z",
      imported: big,
      total: big,
    },
    "entitlement:changed": {
      v: 1,
      entitlement: {
        state: "cancelling",
        member: true,
        entitled: true,
        paywall: true,
        planKey: "monthly",
        interval: "month",
        priceCents: 99_999,
        status: "past_due",
        currentPeriodEnd: "2026-12-17T09:30:00.000Z",
        cancelAtPeriodEnd: true,
        trial: { active: false, used: true, endsAt: "2026-11-17T09:30:00.000Z", daysLeft: null, eligible: false },
        paymentIssue: { state: "last_day", accessEndsAt: "2026-12-17T09:30:00.000Z", accessEndsAtLabel: "Dec 17" },
        hasBillingPortal: true,
      },
      subscriptionUpdatedAt: "2026-12-10T09:30:00.000Z",
      paymentFailed: true,
    },
    "bank:due_changed": { v: 1, bankDue: 99_999, dueRaw: 99_999, total: 99_999, nextAt: "2026-12-31T08:00:00.000Z" },
    "mistakes:added": { v: 1, games: 99_999, added: 99_999, cardsAdded: 99_999, total: 99_999, bankDue: 99_999 },
  };
}
