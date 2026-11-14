// Endpoint paths for api() (plan §7.12). The one place a client path is written.
//
// The client imports registry *types* only (no zod at runtime): each path is a string literal that must equal the
// registry entry's `path` type, so renaming a path in `@repo/contracts/http/registry` fails type-checking here,
// and endpoints.test.ts checks the same thing at runtime. A path with `{param}` segments becomes a function.
import type { EndpointById, EndpointId } from "@repo/contracts/http/registry";

type PathOf<I extends EndpointId> = EndpointById<I>["path"];

type EndpointPaths = {
  me: PathOf<"me.get">;
  openings: PathOf<"catalog.openings.index">;
  billingRefresh: PathOf<"billing.refresh">;
  sessionClear: PathOf<"session.clear">;
  health: PathOf<"health.get">;
  socketToken: PathOf<"socket-token.get">;
  subscription: PathOf<"subscription.get">;
  // P2 games (`{ref}` filled by lib/api/queries/games.ts gamePath()).
  gameCreate: PathOf<"games.create">;
  gameDetail: PathOf<"games.detail">;
  gameCheckpoint: PathOf<"games.checkpoint">;
  gameComplete: PathOf<"games.complete">;
  gamePgn: PathOf<"games.pgn">;
  // P3 review (`{ref}` / `{ply}` filled with fillPath()).
  review: PathOf<"review.get">;
  reviewStatus: PathOf<"review.status">;
  reviewAnalyse: PathOf<"review.analyse">;
  reviewRetry: PathOf<"review.retry">;
  reviewProgress: PathOf<"review.progress">;
  reviewMoment: PathOf<"review.moment">;
  reviewComplete: PathOf<"review.complete">;
  reviewPgn: PathOf<"review.pgn">;
  reviewLegend: PathOf<"review.legend">;
  reviewLegendCompute: PathOf<"review.legend.compute">;
  // P3 share (A10 `{ref}`, A11 `{code}`), archive (G1) and practice (PR1).
  shareCreate: PathOf<"share.create">;
  share: PathOf<"share.update">;
  meGames: PathOf<"me.games">;
  practiceContext: PathOf<"practice.context">;
  // P4 accounts and import (`{provider}` / `{ref}` filled with fillPath()), onboarding, checkout and activation.
  accounts: PathOf<"accounts.list">;
  accountLookup: PathOf<"accounts.chesscom.lookup">;
  accountLinkChessCom: PathOf<"accounts.chesscom.link">;
  lichessStart: PathOf<"accounts.lichess.start">;
  lichessCallback: PathOf<"accounts.lichess.callback">;
  accountSync: PathOf<"accounts.sync">;
  account: PathOf<"accounts.update">;
  importStatus: PathOf<"import.status">;
  importRetry: PathOf<"import.retry">;
  meOnboarding: PathOf<"me.onboarding">;
  checkout: PathOf<"billing.checkout">;
  billingActivation: PathOf<"billing.activation">;
  // P5 train, home and reports (`{ref}` filled with fillPath(); a card ref is its itemKey).
  trainToday: PathOf<"train.today">;
  trainBank: PathOf<"train.bank">;
  trainThemes: PathOf<"train.themes">;
  trainSessionCreate: PathOf<"train.sessions.create">;
  trainSession: PathOf<"train.sessions.get">;
  trainSessionExtend: PathOf<"train.sessions.extend">;
  trainSessionEnd: PathOf<"train.sessions.end">;
  trainAttempts: PathOf<"train.attempts">;
  trainCardSkip: PathOf<"train.cards.skip">;
  trainCard: PathOf<"train.cards.remove">;
  trainPrefs: PathOf<"train.prefs">;
  home: PathOf<"home.get">;
  meBadges: PathOf<"me.badges">;
  reports: PathOf<"reports.create">;
};

export const endpoints = {
  me: "/api/me",
  openings: "/api/openings",
  billingRefresh: "/api/billing/refresh",
  sessionClear: "/api/session/clear",
  health: "/api/health",
  socketToken: "/api/socket-token",
  subscription: "/api/subscription",
  gameCreate: "/api/games",
  gameDetail: "/api/games/{ref}",
  gameCheckpoint: "/api/games/{ref}/checkpoint",
  gameComplete: "/api/games/{ref}/complete",
  gamePgn: "/api/games/{ref}/pgn",
  review: "/api/review/{ref}",
  reviewStatus: "/api/review/{ref}/status",
  reviewAnalyse: "/api/review/{ref}/analyse",
  reviewRetry: "/api/review/{ref}/retry",
  reviewProgress: "/api/review/{ref}/progress",
  reviewMoment: "/api/review/{ref}/moments/{ply}",
  reviewComplete: "/api/review/{ref}/complete",
  reviewPgn: "/api/review/{ref}/pgn",
  reviewLegend: "/api/review/{ref}/legend",
  reviewLegendCompute: "/api/review/{ref}/legend/compute",
  shareCreate: "/api/review/{ref}/share",
  share: "/api/share/{code}",
  meGames: "/api/me/games",
  practiceContext: "/api/practice/context",
  accounts: "/api/accounts",
  accountLookup: "/api/accounts/chesscom/lookup",
  accountLinkChessCom: "/api/accounts/chesscom",
  lichessStart: "/api/accounts/lichess/start",
  lichessCallback: "/api/accounts/lichess/callback",
  accountSync: "/api/accounts/{provider}/sync",
  account: "/api/accounts/{provider}",
  importStatus: "/api/import/status",
  importRetry: "/api/import/{ref}/retry",
  meOnboarding: "/api/me/onboarding",
  checkout: "/api/checkout",
  billingActivation: "/api/billing/activation",
  trainToday: "/api/train/today",
  trainBank: "/api/train/bank",
  trainThemes: "/api/train/themes",
  trainSessionCreate: "/api/train/sessions",
  trainSession: "/api/train/sessions/{ref}",
  trainSessionExtend: "/api/train/sessions/{ref}/extend",
  trainSessionEnd: "/api/train/sessions/{ref}/end",
  trainAttempts: "/api/train/attempts",
  trainCardSkip: "/api/train/cards/{ref}/skip",
  trainCard: "/api/train/cards/{ref}",
  trainPrefs: "/api/train/prefs",
  home: "/api/home",
  meBadges: "/api/me/badges",
  reports: "/api/reports",
} as const satisfies EndpointPaths;

/** The registry id behind each entry (endpoints.test.ts). */
export const ENDPOINT_IDS = {
  me: "me.get",
  openings: "catalog.openings.index",
  billingRefresh: "billing.refresh",
  sessionClear: "session.clear",
  health: "health.get",
  socketToken: "socket-token.get",
  subscription: "subscription.get",
  gameCreate: "games.create",
  gameDetail: "games.detail",
  gameCheckpoint: "games.checkpoint",
  gameComplete: "games.complete",
  gamePgn: "games.pgn",
  review: "review.get",
  reviewStatus: "review.status",
  reviewAnalyse: "review.analyse",
  reviewRetry: "review.retry",
  reviewProgress: "review.progress",
  reviewMoment: "review.moment",
  reviewComplete: "review.complete",
  reviewPgn: "review.pgn",
  reviewLegend: "review.legend",
  reviewLegendCompute: "review.legend.compute",
  shareCreate: "share.create",
  share: "share.update",
  meGames: "me.games",
  practiceContext: "practice.context",
  accounts: "accounts.list",
  accountLookup: "accounts.chesscom.lookup",
  accountLinkChessCom: "accounts.chesscom.link",
  lichessStart: "accounts.lichess.start",
  lichessCallback: "accounts.lichess.callback",
  accountSync: "accounts.sync",
  account: "accounts.update",
  importStatus: "import.status",
  importRetry: "import.retry",
  meOnboarding: "me.onboarding",
  checkout: "billing.checkout",
  billingActivation: "billing.activation",
  trainToday: "train.today",
  trainBank: "train.bank",
  trainThemes: "train.themes",
  trainSessionCreate: "train.sessions.create",
  trainSession: "train.sessions.get",
  trainSessionExtend: "train.sessions.extend",
  trainSessionEnd: "train.sessions.end",
  trainAttempts: "train.attempts",
  trainCardSkip: "train.cards.skip",
  trainCard: "train.cards.remove",
  trainPrefs: "train.prefs",
  home: "home.get",
  meBadges: "me.badges",
  reports: "reports.create",
} as const satisfies Record<keyof typeof endpoints, EndpointId>;
