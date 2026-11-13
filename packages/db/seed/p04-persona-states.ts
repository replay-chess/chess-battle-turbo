// Phase 4 personas (phase-04 plan 6.7, data-model 13.4; testing X4): the exact account state each persona puts on a
// pool user, S, or a dev user. Pure data: no Prisma import, so the e2e persona registry (WEB/e2e/personas/p04.ts),
// unit tests and Playwright can load it. The writers in ./p04-personas.ts apply these states.
//
// Two name sets point at the same states:
//   - the dev-seed names of plan 6.7 (`new`, `trial`, `member`, `syncfailed`, `privategames`, `onbplan`, `onbused`);
//   - the e2e lease-pool names of plan 6.7 (`onboarding-fresh`, `onboarding-plan`, …, `connected-nonmember`).
//
// Values are the design's (DR/V3OnbPreview, V3OnbDone, V4SettingsConnected) through the typed contract fixtures, so a
// persona and the `/dev/ui/*` demos show the same numbers. Times are relative to the `now` the writer is given.
import {
  linkedChessComFixture,
  linkedLichessFixture,
  onboardingPlanFixture,
  runImportingFixture,
} from "@repo/contracts/http/fixtures/p04";
import type {
  OnboardingGoalDb,
  OnboardingStepDb,
  RatingBandDb,
} from "@repo/contracts/http/p04-plain";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * The billing columns of `users` a persona sets: the same shape as WEB/e2e/personas/p01.ts `BillingColumns`, so the
 * P4 registry entries can use `billing` directly and P1's persona tool writes the identical values.
 */
export type P04BillingColumns = {
  plan: string | null;
  planInterval: string | null;
  subscriptionStatus: string | null;
  subscriptionProductId: string | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  subscriptionUpdatedAt: Date | null;
  trialStartedAt: Date | null;
  trialEndsAt: Date | null;
  /** true → `e2e_persona_<email>` (P1's convention, unique per user); false → null. */
  hasSubscription: boolean;
};

/** The P4 billing columns (M4) a reset sets exactly. `dodoCustomerId` is always NULL (plan 6.7: a fresh customer). */
export type P04BillingExtras = {
  trialOfferedAt: Date | null;
  membershipEndedAt: Date | null;
};

export type P04Onboarding = {
  step: OnboardingStepDb;
  /** Minutes before `now` that onboarding finished; null unless `step` is DONE. */
  onboardedAgoMin: number | null;
  ratingBand: RatingBandDb | null;
  ratingBandSource: string | null;
  initialRating: number | null;
  goals: readonly OnboardingGoalDb[];
  dailyMinutes: number | null;
  /** IANA zone (the first onboarding PATCH writes it; a fresh user still has the column default). */
  timeZone: string;
};

export type P04ProviderDb = "CHESSCOM" | "LICHESS";
export type P04ImportStateDb = "IDLE" | "WAITING_FOR_MEMBERSHIP" | "QUEUED" | "RUNNING" | "RATE_LIMITED" | "FAILED";
export type P04RunStatusDb = "WAITING_FOR_MEMBERSHIP" | "QUEUED" | "RUNNING" | "DONE" | "FAILED" | "CANCELLED";
export type P04ErrorCode = "not_found" | "closed" | "upstream" | "timeout" | "rate_limited" | "internal";

export type P04RunSpec = {
  trigger: "INITIAL" | "MANUAL" | "DAILY" | "RETRY";
  status: P04RunStatusDb;
  phase: "reading" | "saving" | null;
  seen: number;
  total: number | null;
  imported: number;
  skipped: number;
  analysisQueued: number;
  analysed: number;
  /** Minutes before `now`; null = not started (a waiting run). */
  startedAgoMin: number | null;
  finishedAgoMin: number | null;
  error: { code: P04ErrorCode; message: string; agoMin: number } | null;
};

/** Which fixture games the link owns (mapped by @repo/chess-import from @repo/chess-fixtures/import). */
export type P04GameSet = "chesscom-knightowl_88" | "lichess-knightowl88" | null;

export type P04LinkSpec = {
  provider: P04ProviderDb;
  /** As the provider spells it; `usernameLower` is derived. */
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  countryCode: string | null;
  title: string | null;
  joinedAt: Date | null;
  /** RatingsV1 without `v` (the wire view of the design fixtures). */
  ratings: Partial<Record<"bullet" | "blitz" | "rapid" | "daily" | "classical", { rating: number; best: number | null; games: number }>>;
  totalRatedGames: number;
  verified: boolean;
  status: "ACTIVE" | "ERROR";
  importState: P04ImportStateDb;
  importedCount: number;
  skippedCount: number;
  lastSyncAgoMin: number | null;
  lastSyncOkAgoMin: number | null;
  /** Seconds after `now` (a provider back-off); null = none. */
  nextAllowedSyncInSec: number | null;
  /** Minutes after `now`; null = no daily sync scheduled. */
  nextAutoSyncInMin: number | null;
  lastError: { code: P04ErrorCode; message: string; agoMin: number; retryInSec?: number; httpStatus?: number } | null;
  run: P04RunSpec | null;
  games: P04GameSet;
};

export type P04PersonaState = {
  name: string;
  /** The plan 6.7 dev-seed name this state equals (pool personas), or its own name. */
  seed: string;
  description: string;
  /** Design states the persona reaches on real routes (`Board.state`), for the state-coverage check. */
  states: readonly string[];
  billing: (now: Date) => P04BillingColumns;
  extras: (now: Date) => P04BillingExtras;
  onboarding: P04Onboarding;
  links: (now: Date) => readonly P04LinkSpec[];
  /** Write the user's own `trial_ledger` row (email hash) as the webhook would have at the first trial. */
  ledgerRow: boolean;
};

// ── Billing ────────────────────────────────────────────────────────────────────────────────────────────────────

const FIXTURE_PRODUCT = "e2e-fixture";

const NO_BILLING: P04BillingColumns = {
  plan: null,
  planInterval: null,
  subscriptionStatus: null,
  subscriptionProductId: null,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
  subscriptionUpdatedAt: null,
  trialStartedAt: null,
  trialEndsAt: null,
  hasSubscription: false,
};

const NO_EXTRAS: P04BillingExtras = { trialOfferedAt: null, membershipEndedAt: null };

function subscribed(now: Date, status: string, periodEndMs: number, extra: Partial<P04BillingColumns> = {}): P04BillingColumns {
  return {
    ...NO_BILLING,
    plan: "player",
    planInterval: "month",
    subscriptionStatus: status,
    subscriptionProductId: FIXTURE_PRODUCT,
    currentPeriodEnd: new Date(now.getTime() + periodEndMs),
    subscriptionUpdatedAt: now,
    hasSubscription: true,
    ...extra,
  };
}

const ago = (now: Date, ms: number) => new Date(now.getTime() - ms);

/** Active monthly member, trial long used (P1's `member`). */
const memberBilling = (now: Date) =>
  subscribed(now, "active", 30 * DAY, { trialStartedAt: ago(now, 60 * DAY), trialEndsAt: ago(now, 53 * DAY) });
const memberExtras = (now: Date): P04BillingExtras => ({ trialOfferedAt: ago(now, 60 * DAY), membershipEndedAt: null });

/** In the 7-day trial: started 2 days ago, 5 days left (data-model 13.4 `trial`). */
const trialBilling = (now: Date) => {
  const ends = new Date(now.getTime() + 5 * DAY);
  return subscribed(now, "active", 5 * DAY, { trialStartedAt: ago(now, 2 * DAY), trialEndsAt: ends });
};
const trialExtras = (now: Date): P04BillingExtras => ({ trialOfferedAt: ago(now, 2 * DAY), membershipEndedAt: null });

/** Trial used 60 days ago and cancelled before the first charge (plan 6.7 `onbused`). */
const trialUsedBilling = (now: Date) =>
  subscribed(now, "cancelled", -53 * DAY, {
    plan: null,
    trialStartedAt: ago(now, 60 * DAY),
    trialEndsAt: ago(now, 53 * DAY),
  });
const trialUsedExtras = (now: Date): P04BillingExtras => ({ trialOfferedAt: ago(now, 60 * DAY), membershipEndedAt: ago(now, 53 * DAY) });

// ── Onboarding ─────────────────────────────────────────────────────────────────────────────────────────────────

const PLAN_GOALS = onboardingPlanFixture.goals.map((g) => g.toUpperCase() as OnboardingGoalDb);
const PLAN_BAND = (onboardingPlanFixture.ratingBand?.toUpperCase() ?? null) as RatingBandDb | null;
const ZONE = "Asia/Kolkata";

const FRESH: P04Onboarding = {
  step: "WELCOME",
  onboardedAgoMin: null,
  ratingBand: null,
  ratingBandSource: null,
  initialRating: null,
  goals: [],
  dailyMinutes: null,
  timeZone: "UTC",
};

/** Level, goals and minutes chosen as on the Plan board (chesscom:rapid 1184 → 800–1200). */
const CHOSEN: Omit<P04Onboarding, "step" | "onboardedAgoMin"> = {
  ratingBand: PLAN_BAND,
  ratingBandSource: onboardingPlanFixture.ratingBandSource,
  initialRating: onboardingPlanFixture.initialRating,
  goals: PLAN_GOALS,
  dailyMinutes: onboardingPlanFixture.dailyMinutes,
  timeZone: ZONE,
};

const done = (agoMin: number, chosen: Omit<P04Onboarding, "step" | "onboardedAgoMin"> = CHOSEN): P04Onboarding => ({
  ...chosen,
  step: "DONE",
  onboardedAgoMin: agoMin,
});

/** Onboarded without a linked account: the band came from the self-assessment. */
const SELF_CHOSEN: Omit<P04Onboarding, "step" | "onboardedAgoMin"> = {
  ...CHOSEN,
  ratingBandSource: "self",
  initialRating: null,
};

// ── Links ──────────────────────────────────────────────────────────────────────────────────────────────────────

const chessComBase = {
  provider: "CHESSCOM",
  username: linkedChessComFixture.username,
  displayName: linkedChessComFixture.displayName,
  avatarUrl: linkedChessComFixture.avatarUrl,
  countryCode: "US",
  title: linkedChessComFixture.title,
  joinedAt: new Date("2019-03-14T00:00:00.000Z"),
  ratings: linkedChessComFixture.ratings,
  totalRatedGames: linkedChessComFixture.totalRatedGames ?? 0,
  verified: false,
  status: "ACTIVE",
} as const satisfies Partial<P04LinkSpec>;

const lichessBase = {
  provider: "LICHESS",
  username: linkedLichessFixture.username,
  displayName: linkedLichessFixture.displayName,
  avatarUrl: linkedLichessFixture.avatarUrl,
  countryCode: null,
  title: linkedLichessFixture.title,
  joinedAt: new Date("2022-01-09T00:00:00.000Z"),
  ratings: linkedLichessFixture.ratings,
  totalRatedGames: linkedLichessFixture.totalRatedGames ?? 0,
  verified: true,
  status: "ACTIVE",
} as const satisfies Partial<P04LinkSpec>;

const importing = runImportingFixture;

/** `trial`: Chess.com linked, the INITIAL run saving 212 / 480 (V3OnbDone `importing`, Connected `syncing`). */
const chessComImporting: P04LinkSpec = {
  ...chessComBase,
  importState: "RUNNING",
  importedCount: importing.imported,
  skippedCount: importing.skipped,
  lastSyncAgoMin: 2,
  lastSyncOkAgoMin: null,
  nextAllowedSyncInSec: null,
  nextAutoSyncInMin: null,
  lastError: null,
  run: {
    trigger: "INITIAL",
    status: "RUNNING",
    phase: "saving",
    seen: importing.seen,
    total: importing.total,
    imported: importing.imported,
    skipped: importing.skipped,
    analysisQueued: importing.analysisQueued,
    analysed: importing.analysed,
    startedAgoMin: 2,
    finishedAgoMin: null,
    error: null,
  },
  games: "chesscom-knightowl_88",
};

const doneRun = (seen: number, imported: number, skipped: number, finishedAgoMin: number): P04RunSpec => ({
  trigger: "INITIAL",
  status: "DONE",
  phase: "saving",
  seen,
  total: seen,
  imported,
  skipped,
  analysisQueued: 20,
  analysed: 20,
  startedAgoMin: finishedAgoMin + 4,
  finishedAgoMin,
  error: null,
});

/** `member`: Chess.com linked, last run DONE, 480 imported (Connected `both_linked`, Done `imported`). */
const chessComLinked: P04LinkSpec = {
  ...chessComBase,
  importState: "IDLE",
  importedCount: linkedChessComFixture.importedCount,
  skippedCount: linkedChessComFixture.skippedCount,
  lastSyncAgoMin: 90,
  lastSyncOkAgoMin: 90,
  nextAllowedSyncInSec: null,
  nextAutoSyncInMin: 18 * 60,
  lastError: null,
  run: doneRun(486, linkedChessComFixture.importedCount, linkedChessComFixture.skippedCount, 90),
  games: "chesscom-knightowl_88",
};

/** `member`: Lichess knightowl88 verified, blitz 1402, 96 imported. */
const lichessLinked: P04LinkSpec = {
  ...lichessBase,
  importState: "IDLE",
  importedCount: linkedLichessFixture.importedCount,
  skippedCount: 0,
  lastSyncAgoMin: 30,
  lastSyncOkAgoMin: 30,
  nextAllowedSyncInSec: null,
  nextAutoSyncInMin: 18 * 60 + 7,
  lastError: null,
  run: doneRun(96, 96, 0, 30),
  games: "lichess-knightowl88",
};

/** `syncfailed`: Chess.com's last run failed upstream 5 minutes ago; the last good sync was 2 hours ago. */
const chessComFailed: P04LinkSpec = {
  ...chessComLinked,
  importState: "FAILED",
  lastSyncAgoMin: 5,
  lastSyncOkAgoMin: 120,
  lastError: { code: "upstream", message: "Chess.com answered 503", agoMin: 5, httpStatus: 503 },
  run: {
    trigger: "DAILY",
    status: "FAILED",
    phase: "reading",
    seen: 0,
    total: null,
    imported: 0,
    skipped: 0,
    analysisQueued: 0,
    analysed: 0,
    startedAgoMin: 21,
    finishedAgoMin: 5,
    error: { code: "upstream", message: "Chess.com answered 503", agoMin: 5 },
  },
};

/** `syncfailed`: Lichess paused us; the next sync is allowed 30 s after the reset. */
const lichessRateLimited: P04LinkSpec = {
  ...lichessLinked,
  importState: "RATE_LIMITED",
  nextAllowedSyncInSec: 30,
  lastError: { code: "rate_limited", message: "Lichess asked us to slow down", agoMin: 0, retryInSec: 30, httpStatus: 429 },
};

/** `privategames`: 480 seen, 168 skipped (private, variant or unrated), 312 imported (Connected `private_games`). */
const chessComPrivateGames: P04LinkSpec = {
  ...chessComLinked,
  importedCount: 312,
  skippedCount: 168,
  run: doneRun(480, 312, 168, 90),
};

/** Linked during onboarding, before the trial: the INITIAL run waits for membership (accountWaitingFixture). */
const chessComWaiting: P04LinkSpec = {
  ...chessComBase,
  importState: "WAITING_FOR_MEMBERSHIP",
  importedCount: 0,
  skippedCount: 0,
  lastSyncAgoMin: null,
  lastSyncOkAgoMin: null,
  nextAllowedSyncInSec: null,
  nextAutoSyncInMin: null,
  lastError: null,
  run: {
    trigger: "INITIAL",
    status: "WAITING_FOR_MEMBERSHIP",
    phase: null,
    seen: 0,
    total: null,
    imported: 0,
    skipped: 0,
    analysisQueued: 0,
    analysed: 0,
    startedAgoMin: null,
    finishedAgoMin: null,
    error: null,
  },
  games: null,
};

// ── The states ─────────────────────────────────────────────────────────────────────────────────────────────────

const none = () => [] as const;

const NEW: Omit<P04PersonaState, "name" | "seed"> = {
  description: "Signed up, picked a time zone, at the Link step; nothing linked, trial available",
  states: ["V3OnbLink.default", "V4SettingsConnected.none_linked"],
  billing: () => ({ ...NO_BILLING }),
  extras: () => ({ ...NO_EXTRAS }),
  onboarding: { ...FRESH, step: "LINK", timeZone: ZONE },
  links: none,
  ledgerRow: false,
};

const TRIAL: Omit<P04PersonaState, "name" | "seed"> = {
  description: "In the trial (5 days left), Chess.com knightowl_88 importing 212 / 480",
  states: ["V3OnbDone.importing", "V4SettingsConnected.syncing", "V3GamesArchive.import_running"],
  billing: trialBilling,
  extras: trialExtras,
  onboarding: done(2 * 24 * 60),
  links: () => [chessComImporting],
  ledgerRow: false,
};

const MEMBER: Omit<P04PersonaState, "name" | "seed"> = {
  description: "Active member with Chess.com (480 imported) and verified Lichess (96 imported) linked",
  states: ["V4SettingsConnected.both_linked", "V3OnbDone.imported"],
  billing: memberBilling,
  extras: memberExtras,
  onboarding: done(60 * 24 * 60),
  links: () => [chessComLinked, lichessLinked],
  ledgerRow: false,
};

const SYNCFAILED: Omit<P04PersonaState, "name" | "seed"> = {
  description: "Member whose Chess.com sync failed upstream and whose Lichess sync is rate limited for 30 s",
  states: ["V4SettingsConnected.sync_failed", "V4SettingsConnected.rate_limited", "V3OnbDone.import_failed"],
  billing: memberBilling,
  extras: memberExtras,
  onboarding: done(60 * 24 * 60),
  links: () => [chessComFailed, lichessRateLimited],
  ledgerRow: false,
};

const PRIVATEGAMES: Omit<P04PersonaState, "name" | "seed"> = {
  description: "Member whose last Chess.com import skipped 168 of 480 games",
  states: ["V4SettingsConnected.private_games"],
  billing: memberBilling,
  extras: memberExtras,
  onboarding: done(60 * 24 * 60),
  links: () => [chessComPrivateGames],
  ledgerRow: false,
};

const ONBPLAN: Omit<P04PersonaState, "name" | "seed"> = {
  description: "At the Plan step with level and goals chosen, Chess.com linked and waiting; trial available",
  states: ["V3OnbPlan.default"],
  billing: () => ({ ...NO_BILLING }),
  extras: () => ({ ...NO_EXTRAS }),
  onboarding: { ...CHOSEN, step: "PLAN", onboardedAgoMin: null },
  links: () => [chessComWaiting],
  ledgerRow: false,
};

const ONBUSED: Omit<P04PersonaState, "name" | "seed"> = {
  description: "As onbplan, but the free trial was used 60 days ago and cancelled (Plan trial-used variant)",
  states: ["V3OnbPlan.trial_used", "V3OnbWelcome.trial_used"],
  billing: trialUsedBilling,
  extras: trialUsedExtras,
  onboarding: { ...CHOSEN, step: "PLAN", onboardedAgoMin: null },
  links: () => [chessComWaiting],
  ledgerRow: true,
};

const seedEntry = (name: string, s: Omit<P04PersonaState, "name" | "seed">): P04PersonaState => ({ ...s, name, seed: name });
const poolEntry = (name: string, seed: string, s: Omit<P04PersonaState, "name" | "seed">, override: Partial<P04PersonaState> = {}): P04PersonaState => ({
  ...s,
  ...override,
  name,
  seed,
});

/** Plan 6.7 dev-seed personas. */
export const P04_SEED_PERSONAS = {
  new: seedEntry("new", NEW),
  trial: seedEntry("trial", TRIAL),
  member: seedEntry("member", MEMBER),
  syncfailed: seedEntry("syncfailed", SYNCFAILED),
  privategames: seedEntry("privategames", PRIVATEGAMES),
  onbplan: seedEntry("onbplan", ONBPLAN),
  onbused: seedEntry("onbused", ONBUSED),
} as const satisfies Record<string, P04PersonaState>;

/** Plan 6.7 e2e lease-pool personas (registered in WEB/e2e/personas/p04.ts). */
export const P04_POOL_PERSONAS = {
  "onboarding-fresh": poolEntry("onboarding-fresh", "new", NEW, {
    description: "Fresh sign-up at Welcome: never trialled, no Dodo customer, nothing linked",
    states: ["V3OnbWelcome.default"],
    onboarding: { ...FRESH },
  }),
  "onboarding-plan": poolEntry("onboarding-plan", "onbplan", ONBPLAN),
  "onboarding-trial-used": poolEntry("onboarding-trial-used", "onbused", ONBUSED),
  "import-trial": poolEntry("import-trial", "trial", TRIAL),
  "connected-none-member": poolEntry("connected-none-member", "member", MEMBER, {
    description: "Active member, onboarded, nothing linked",
    states: ["V4SettingsConnected.none_linked"],
    onboarding: done(60 * 24 * 60, SELF_CHOSEN),
    links: none,
  }),
  "connected-both": poolEntry("connected-both", "member", MEMBER),
  "connected-syncfailed": poolEntry("connected-syncfailed", "syncfailed", SYNCFAILED),
  "connected-privategames": poolEntry("connected-privategames", "privategames", PRIVATEGAMES),
  "connected-nonmember": poolEntry("connected-nonmember", "new", NEW, {
    description: "Onboarded, never trialled, nothing linked (non-member settings)",
    states: ["V4SettingsConnected.non_member"],
    onboarding: done(10 * 24 * 60, SELF_CHOSEN),
  }),
} as const satisfies Record<string, P04PersonaState>;

export const P04_PERSONA_STATES: Readonly<Record<string, P04PersonaState>> = { ...P04_SEED_PERSONAS, ...P04_POOL_PERSONAS };

export type P04SeedPersonaName = keyof typeof P04_SEED_PERSONAS;
export type P04PoolPersonaName = keyof typeof P04_POOL_PERSONAS;
export type P04PersonaName = P04SeedPersonaName | P04PoolPersonaName;

export function isP04PersonaName(name: string): name is P04PersonaName {
  return Object.prototype.hasOwnProperty.call(P04_PERSONA_STATES, name);
}

export function getP04PersonaState(name: string): P04PersonaState {
  if (!isP04PersonaName(name)) {
    throw new Error(`unknown P4 persona "${name}" (known: ${Object.keys(P04_PERSONA_STATES).join(", ")})`);
  }
  return P04_PERSONA_STATES[name]!;
}

/**
 * The view status of a link (plan 8.11 table; WEB/lib/accounts/view-status.ts implements the same rule for the API).
 * Here so the persona tests can state which Connected board each seeded link reaches without importing web code.
 */
export function expectedLinkViewStatus(
  link: Pick<P04LinkSpec, "status" | "importState">,
  nextAllowedSyncAt: Date | null,
  now: Date,
): "linked" | "waiting_for_membership" | "queued" | "syncing" | "rate_limited" | "error" {
  if (link.status === "ERROR") return "error";
  const backoff = nextAllowedSyncAt !== null && nextAllowedSyncAt.getTime() > now.getTime();
  switch (link.importState) {
    case "WAITING_FOR_MEMBERSHIP":
      return "waiting_for_membership";
    case "QUEUED":
      return "queued";
    case "RUNNING":
      return "syncing";
    case "RATE_LIMITED":
      return backoff ? "rate_limited" : "queued";
    case "FAILED":
      return "error";
    case "IDLE":
      return backoff ? "rate_limited" : "linked";
  }
}

export const P04_TIME = { MINUTE, HOUR, DAY } as const;
