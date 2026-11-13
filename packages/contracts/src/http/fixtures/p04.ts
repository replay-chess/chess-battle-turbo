// Typed P4 HTTP fixtures (phase-04 plan §4, §6.7, §7.1) for the UI packages (`/dev/ui/onboarding`, `/dev/ui/connected`,
// `/dev/ui/activating` demos), component tests, the e2e upstream mock and the contract tests:
// `import { linkedChessComFixture } from "@repo/contracts/http/fixtures/p04"`.
//
// The data is the design's: `DR/V3OnbPreview.dc.html` (knightowl_88: Rapid 1184 with the most games, Blitz 1032,
// Bullet 871, 480 rated games), `V3OnbDone` (importing 212 / 480), `V4SettingsConnected` (Chess.com linked and
// Lichess knightowl88 verified, Blitz 1402, 96 games). Pure data: no zod at runtime, safe to import from client
// demos. Every fixture parses with its schema (p04-contracts.test.ts).
import type { AccountsData, LinkData, LinkedAccountView, LookupData, RunView } from "../accounts";
import type { ActivationData, CheckoutData } from "../billing";
import type { ImportStatusData } from "../import";
import type { Entitlement, MeAccount, MeImport } from "../me";
import type { OnboardingView, PatchOnboardingData } from "../onboarding";

export const P4_FIXTURE_NOW = "2026-11-10T09:30:00.000Z";
export const P4_FIXTURE_RUN_REF = "cm3p4r8un0001slzpimp4rtq1";
export const P4_FIXTURE_LICHESS_RUN_REF = "cm3p4r8un0002slzpimp4rtq2";
export const P4_FIXTURE_FIRST_GAME_REF = "cm3p4g4me0003slzpfirst0g1";
export const P4_FIXTURE_CHESSCOM_USERNAME = "knightowl_88";
export const P4_FIXTURE_LICHESS_USERNAME = "knightowl88";

const minutesAgo = (m: number) => new Date(Date.parse(P4_FIXTURE_NOW) - m * 60_000).toISOString();
const minutesAhead = (m: number) => new Date(Date.parse(P4_FIXTURE_NOW) + m * 60_000).toISOString();

// ── Lookup (ACC-2) ──────────────────────────────────────────────────────────────────────────────────────────────
export const lookupFoundFixture: LookupData = {
  status: "found",
  profile: {
    username: "knightowl_88",
    displayUsername: "KnightOwl_88",
    name: "Sam Rivera",
    avatarUrl: "https://images.chesscomfiles.com/uploads/v1/user/123456.1a2b3c4d.200x200o.5e6f7a8b9c0d.png",
    countryCode: "US",
    joinedAt: "2019-03-14T00:00:00.000Z",
    title: null,
  },
  ratings: {
    rapid: { rating: 1184, best: 1243, games: 312 },
    blitz: { rating: 1032, best: 1101, games: 141 },
    bullet: { rating: 871, best: 902, games: 27 },
  },
  headline: { timeClass: "rapid", rating: 1184 },
  totalRatedGames: 480,
};

export const lookupPrivateFixture: LookupData = {
  ...lookupFoundFixture,
  status: "private",
  profile: { ...lookupFoundFixture.profile, username: "quiet_rook", displayUsername: "quiet_rook", name: null, avatarUrl: null },
  ratings: {},
  headline: null,
  totalRatedGames: 0,
};

export const lookupNoGamesFixture: LookupData = {
  ...lookupFoundFixture,
  status: "no_games",
  profile: { ...lookupFoundFixture.profile, username: "fresh_pawn", displayUsername: "Fresh_Pawn", name: null },
  ratings: {},
  headline: null,
  totalRatedGames: 0,
};

// ── Runs ────────────────────────────────────────────────────────────────────────────────────────────────────────
export const runImportingFixture: RunView = {
  ref: P4_FIXTURE_RUN_REF,
  provider: "chesscom",
  trigger: "initial",
  status: "running",
  phase: "saving",
  seen: 480,
  total: 480,
  imported: 212,
  skipped: 6,
  analysisQueued: 20,
  analysed: 3,
  error: null,
  startedAt: minutesAgo(2),
  finishedAt: null,
  updatedAt: minutesAgo(0),
};

export const runWaitingFixture: RunView = {
  ...runImportingFixture,
  status: "waiting_for_membership",
  phase: null,
  seen: 0,
  total: null,
  imported: 0,
  skipped: 0,
  analysisQueued: 0,
  analysed: 0,
  startedAt: null,
};

export const runDoneFixture: RunView = {
  ...runImportingFixture,
  status: "done",
  phase: "saving",
  imported: 474,
  skipped: 6,
  analysisQueued: 20,
  analysed: 20,
  finishedAt: minutesAgo(1),
};

export const runFailedFixture: RunView = {
  ...runImportingFixture,
  status: "failed",
  error: { code: "upstream", at: minutesAgo(5), retryAt: null },
  finishedAt: minutesAgo(5),
};

// ── Accounts (ACC-1) ────────────────────────────────────────────────────────────────────────────────────────────
export const linkedChessComFixture: LinkedAccountView = {
  provider: "chesscom",
  username: "KnightOwl_88",
  displayName: "Sam Rivera",
  avatarUrl: lookupFoundFixture.profile.avatarUrl,
  title: null,
  ratings: lookupFoundFixture.ratings,
  headline: { timeClass: "rapid", rating: 1184 },
  totalRatedGames: 480,
  verified: false,
  status: "linked",
  autoImport: true,
  lastSyncAt: minutesAgo(90),
  lastSyncOkAt: minutesAgo(90),
  nextAllowedSyncAt: null,
  nextAutoSyncAt: minutesAhead(18 * 60),
  importedCount: 480,
  skippedCount: 6,
  lastError: null,
  run: runDoneFixture,
};

export const linkedLichessFixture: LinkedAccountView = {
  provider: "lichess",
  username: "knightowl88",
  displayName: null,
  avatarUrl: null,
  title: null,
  ratings: { blitz: { rating: 1402, best: null, games: 88 }, rapid: { rating: 1350, best: null, games: 8 } },
  headline: { timeClass: "blitz", rating: 1402 },
  totalRatedGames: 96,
  verified: true,
  status: "linked",
  autoImport: true,
  lastSyncAt: minutesAgo(30),
  lastSyncOkAt: minutesAgo(30),
  nextAllowedSyncAt: null,
  nextAutoSyncAt: minutesAhead(18 * 60 + 7),
  importedCount: 96,
  skippedCount: 0,
  lastError: null,
  run: { ...runDoneFixture, ref: P4_FIXTURE_LICHESS_RUN_REF, provider: "lichess", seen: 96, total: 96, imported: 96, skipped: 0 },
};

export const accountSyncingFixture: LinkedAccountView = { ...linkedChessComFixture, status: "syncing", run: runImportingFixture };

export const accountSyncFailedFixture: LinkedAccountView = {
  ...linkedChessComFixture,
  status: "error",
  lastSyncAt: minutesAgo(5),
  lastSyncOkAt: minutesAgo(120),
  lastError: { code: "upstream", at: minutesAgo(5), retryAt: null },
  run: runFailedFixture,
};

export const accountRateLimitedFixture: LinkedAccountView = {
  ...linkedLichessFixture,
  status: "rate_limited",
  nextAllowedSyncAt: minutesAhead(0.5),
  lastError: { code: "rate_limited", at: minutesAgo(0), retryAt: minutesAhead(0.5) },
};

export const accountWaitingFixture: LinkedAccountView = {
  ...linkedChessComFixture,
  status: "waiting_for_membership",
  lastSyncAt: null,
  lastSyncOkAt: null,
  nextAutoSyncAt: null,
  importedCount: 0,
  skippedCount: 0,
  run: runWaitingFixture,
};

export const accountsBothLinkedFixture: AccountsData = { items: [linkedChessComFixture, linkedLichessFixture] };
export const accountsNoneLinkedFixture: AccountsData = { items: [] };

// ── Onboarding ──────────────────────────────────────────────────────────────────────────────────────────────────
export const onboardingLevelFixture: OnboardingView = {
  step: "level",
  done: false,
  ratingBand: "r800_1200",
  ratingBandSource: "chesscom:rapid",
  initialRating: 1184,
  goals: [],
  dailyMinutes: null,
  onboardedAt: null,
};

export const onboardingPlanFixture: OnboardingView = {
  ...onboardingLevelFixture,
  step: "plan",
  goals: ["stop_blundering", "learn_openings"],
  dailyMinutes: 10,
};

export const onboardingDoneFixture: OnboardingView = { ...onboardingPlanFixture, step: "done", done: true, onboardedAt: minutesAgo(0) };

export const patchOnboardingFixture: PatchOnboardingData = { onboarding: onboardingPlanFixture, timeZone: "Asia/Kolkata" };

export const linkDataFixture: LinkData = {
  account: accountWaitingFixture,
  run: runWaitingFixture,
  onboarding: onboardingLevelFixture,
};

// ── Import status (ACC-7) ───────────────────────────────────────────────────────────────────────────────────────
export const importStatusImportingFixture: ImportStatusData = {
  runs: [runImportingFixture],
  firstReview: { gameRef: P4_FIXTURE_FIRST_GAME_REF, analysisStatus: "running", momentsCount: null },
};

export const importStatusDoneFixture: ImportStatusData = {
  runs: [runDoneFixture],
  firstReview: { gameRef: P4_FIXTURE_FIRST_GAME_REF, analysisStatus: "done", momentsCount: 3 },
};

// ── Billing (BIL-1, BIL-2) ──────────────────────────────────────────────────────────────────────────────────────
export const trialEntitlementFixture: Entitlement = {
  state: "trial",
  member: true,
  entitled: true,
  paywall: true,
  planKey: "monthly",
  interval: "month",
  priceCents: 499,
  status: "active",
  currentPeriodEnd: minutesAhead(7 * 24 * 60),
  cancelAtPeriodEnd: false,
  trial: { active: true, used: true, endsAt: minutesAhead(7 * 24 * 60), daysLeft: 7, eligible: false },
  paymentIssue: null,
  hasBillingPortal: true,
};

export const noneEntitlementFixture: Entitlement = {
  state: "none",
  member: false,
  entitled: false,
  paywall: true,
  planKey: null,
  interval: null,
  priceCents: null,
  status: null,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
  trial: { active: false, used: false, endsAt: null, daysLeft: null, eligible: true },
  paymentIssue: null,
  hasBillingPortal: false,
};

export const checkoutTrialFixture: CheckoutData = {
  checkoutUrl: "https://test.checkout.dodopayments.com/session/cks_7Hq2Lr9xVb3MnP0w",
  sessionId: "cks_7Hq2Lr9xVb3MnP0w",
  trial: true,
  chargeDate: minutesAhead(7 * 24 * 60),
  priceCents: 499,
  currency: "USD",
  interval: "month",
};

export const activationPendingFixture: ActivationData = {
  state: "pending",
  reason: null,
  entitlement: noneEntitlementFixture,
  trial: { active: false, endsAt: null, chargeDate: null },
  plan: { interval: "month", priceCents: 499, legacy: false },
  emailMasked: "s•••@gmail.com",
  reference: null,
  waitedMs: 4_200,
};

export const activationActiveFixture: ActivationData = {
  state: "active",
  reason: null,
  entitlement: trialEntitlementFixture,
  trial: { active: true, endsAt: minutesAhead(7 * 24 * 60), chargeDate: minutesAhead(7 * 24 * 60) },
  plan: { interval: "month", priceCents: 499, legacy: false },
  emailMasked: "s•••@gmail.com",
  reference: "sub_8F2K…Q1",
  waitedMs: 2_100,
};

export const activationFailedFixture: ActivationData = {
  ...activationPendingFixture,
  state: "failed",
  reason: "declined",
  waitedMs: 9_800,
};

// ── /api/me additions ───────────────────────────────────────────────────────────────────────────────────────────
export const meAccountsFixture: MeAccount[] = [
  { provider: "chesscom", username: "KnightOwl_88", status: "syncing", lastSyncAt: minutesAgo(2) },
];
export const meImportFixture: MeImport = {
  ref: P4_FIXTURE_RUN_REF,
  provider: "chesscom",
  status: "running",
  phase: "saving",
  imported: 212,
  total: 480,
};
