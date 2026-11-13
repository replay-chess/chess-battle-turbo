// P4 HTTP contracts (phase-04 plan §7.0, §7.1, §7.4, §7.5): the typed fixtures parse with their schemas, the request
// schemas refuse what the plan refuses, the registry entries carry the §7.0 auth, cache, limits and statuses, the
// /api/me and G1 additions are backward-compatible, and the zod-free module imports nothing.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  ACCOUNT_SYNC_LIMIT,
  AccountsData,
  ChessComUsername,
  IMPORT_RETRY_LIMIT,
  LichessCallbackQuery,
  LichessStartQuery,
  LinkChessComBody,
  LinkData,
  LinkedAccountView,
  LookupBody,
  LookupData,
  PatchAccountBody,
  RunView,
  SyncBody,
  UnlinkQuery,
} from "./accounts";
import { ActivationData, ActivationQuery, CheckoutBody, CheckoutData, DODO_ACTIVATION_LIMIT } from "./billing";
import { endpointProblems, expectedErrorCodes, rateLimitsOf, successStatusOf } from "./endpoint";
import * as fx from "./fixtures/p04";
import { GamesPageMeta, GamesQuery } from "./games";
import { ImportStatusData, RetryImportBody, RunRefParams } from "./import";
import { Entitlement, MeAccount, MeData, MeImport } from "./me";
import { OnboardingView, PatchOnboardingData } from "./onboarding";
import { isChessComUsername, normaliseChessComUsername, providerFromDb, providerToDb, scopedRateSubject } from "./p04-plain";
import { getEndpoint } from "./registry/index";

describe("P4 fixtures parse with their schemas", () => {
  const cases: [string, { safeParse(v: unknown): { success: boolean } }, unknown][] = [
    ["lookupFound", LookupData, fx.lookupFoundFixture],
    ["lookupPrivate", LookupData, fx.lookupPrivateFixture],
    ["lookupNoGames", LookupData, fx.lookupNoGamesFixture],
    ["runImporting", RunView, fx.runImportingFixture],
    ["runWaiting", RunView, fx.runWaitingFixture],
    ["runDone", RunView, fx.runDoneFixture],
    ["runFailed", RunView, fx.runFailedFixture],
    ["linkedChessCom", LinkedAccountView, fx.linkedChessComFixture],
    ["linkedLichess", LinkedAccountView, fx.linkedLichessFixture],
    ["syncing", LinkedAccountView, fx.accountSyncingFixture],
    ["syncFailed", LinkedAccountView, fx.accountSyncFailedFixture],
    ["rateLimited", LinkedAccountView, fx.accountRateLimitedFixture],
    ["waiting", LinkedAccountView, fx.accountWaitingFixture],
    ["bothLinked", AccountsData, fx.accountsBothLinkedFixture],
    ["noneLinked", AccountsData, fx.accountsNoneLinkedFixture],
    ["onbLevel", OnboardingView, fx.onboardingLevelFixture],
    ["onbPlan", OnboardingView, fx.onboardingPlanFixture],
    ["onbDone", OnboardingView, fx.onboardingDoneFixture],
    ["patchOnb", PatchOnboardingData, fx.patchOnboardingFixture],
    ["linkData", LinkData, fx.linkDataFixture],
    ["statusImporting", ImportStatusData, fx.importStatusImportingFixture],
    ["statusDone", ImportStatusData, fx.importStatusDoneFixture],
    ["trialEntitlement", Entitlement, fx.trialEntitlementFixture],
    ["noneEntitlement", Entitlement, fx.noneEntitlementFixture],
    ["checkout", CheckoutData, fx.checkoutTrialFixture],
    ["activationPending", ActivationData, fx.activationPendingFixture],
    ["activationActive", ActivationData, fx.activationActiveFixture],
    ["activationFailed", ActivationData, fx.activationFailedFixture],
    ["meImport", MeImport, fx.meImportFixture],
  ];
  for (const [name, schema, value] of cases) {
    it(name, () => {
      const r = schema.safeParse(value);
      assert.equal(r.success, true, `${name}: ${JSON.stringify((r as { error?: unknown }).error ?? null)}`);
    });
  }
  it("meAccounts", () => {
    for (const a of fx.meAccountsFixture) assert.equal(MeAccount.safeParse(a).success, true);
  });
});

describe("accounts request schemas", () => {
  it("ChessComUsername trims, drops one leading @, and enforces 3–25 of [A-Za-z0-9_-]", () => {
    assert.equal(ChessComUsername.parse("  @KnightOwl_88 "), "KnightOwl_88");
    assert.equal(ChessComUsername.parse("a-b"), "a-b");
    for (const bad of ["ab", "x".repeat(26), "knight owl", "@@knight", "knïght", "", "a/b"]) {
      assert.equal(ChessComUsername.safeParse(bad).success, false, bad);
    }
    assert.equal(normaliseChessComUsername(" @Hikaru "), "Hikaru");
    assert.equal(isChessComUsername("@hikaru"), true);
    assert.equal(isChessComUsername("hi"), false);
  });

  it("bodies are strict; the link context is onboarding | settings", () => {
    assert.equal(LookupBody.safeParse({ username: "hikaru", extra: 1 }).success, false);
    assert.equal(LinkChessComBody.safeParse({ username: "hikaru", context: "onboarding" }).success, true);
    assert.equal(LinkChessComBody.safeParse({ username: "hikaru", context: "profile" }).success, false);
    assert.equal(LinkChessComBody.safeParse({ username: "hikaru" }).success, false);
    assert.equal(PatchAccountBody.safeParse({ autoImport: false }).success, true);
    assert.equal(PatchAccountBody.safeParse({ autoImport: true, timeZone: "Mars/Olympus" }).success, false);
    assert.equal(PatchAccountBody.safeParse({ autoImport: "yes" }).success, false);
    assert.deepEqual(SyncBody.parse(undefined), {});
    assert.equal(SyncBody.safeParse({ force: true }).success, false);
    assert.deepEqual(RetryImportBody.parse(undefined), {});
  });

  it("unlink defaults to keeping the games; Lichess returnTo is an allow-list", () => {
    assert.deepEqual(UnlinkQuery.parse({}), { deleteGames: "0" });
    assert.equal(UnlinkQuery.safeParse({ deleteGames: "true" }).success, false);
    assert.deepEqual(LichessStartQuery.parse({}), { returnTo: "/settings/connected" });
    assert.equal(LichessStartQuery.safeParse({ returnTo: "/onboarding/link" }).success, true);
    assert.equal(LichessStartQuery.safeParse({ returnTo: "https://evil.example/" }).success, false);
    assert.equal(LichessCallbackQuery.safeParse({ code: "abc", state: "s".repeat(32) }).success, true);
    assert.equal(LichessCallbackQuery.safeParse({ error: "access_denied", state: "s".repeat(32) }).success, true);
    // regression: lichess-callback-malformed (FIX-1): a malformed query is not a 400; the handler clears the cookie.
    assert.deepEqual(LichessCallbackQuery.parse({ code: "abc", state: "short" }), { malformed: true });
    assert.deepEqual(LichessCallbackQuery.parse({}), { malformed: true });
    assert.deepEqual(LichessCallbackQuery.parse({ error: "x".repeat(65) }), { malformed: true });
  });

  it("run refs are cuids", () => {
    assert.equal(RunRefParams.safeParse({ ref: fx.P4_FIXTURE_RUN_REF }).success, true);
    assert.equal(RunRefParams.safeParse({ ref: "123" }).success, false);
    assert.equal(RunRefParams.safeParse({ ref: "C3P4R8UN0001SLZPIMP4RTQ1X" }).success, false);
  });

  it("LinkedAccountView never carries a token field (D4-21) and AccountsData holds at most one per provider", () => {
    assert.equal(Object.keys(LinkedAccountView.shape).some((k) => /token/i.test(k)), false);
    const three = { items: [fx.linkedChessComFixture, fx.linkedLichessFixture, fx.linkedChessComFixture] };
    assert.equal(AccountsData.safeParse(three).success, false);
  });

  it("provider slugs map to the DB enum and back", () => {
    assert.equal(providerToDb("chesscom"), "CHESSCOM");
    assert.equal(providerToDb("lichess"), "LICHESS");
    assert.equal(providerFromDb("CHESSCOM"), "chesscom");
    assert.equal(providerFromDb("LICHESS"), "lichess");
    assert.equal(scopedRateSubject("user_2abc", "chesscom"), "user_2abc:chesscom");
  });
});

describe("billing additions", () => {
  it("CheckoutBody is strict and names its source", () => {
    assert.equal(CheckoutBody.safeParse({ plan: "monthly", source: "onboarding" }).success, true);
    assert.equal(CheckoutBody.safeParse({ plan: "monthly" }).success, false, "source is required");
    assert.equal(CheckoutBody.safeParse({ plan: "weekly", source: "pricing" }).success, false);
    assert.equal(CheckoutBody.safeParse({ plan: "yearly", source: "pricing", returnPath: "/games", theme: "dark" }).success, true);
    assert.equal(CheckoutBody.safeParse({ plan: "yearly", source: "pricing", coupon: "x" }).success, false);
  });

  it("ActivationQuery takes Dodo's return params and force=1 only", () => {
    assert.equal(ActivationQuery.safeParse({ subscription_id: "sub_123", status: "active" }).success, true);
    assert.equal(ActivationQuery.safeParse({ force: "1" }).success, true);
    assert.equal(ActivationQuery.safeParse({ force: "true" }).success, false);
  });
});

describe("/api/me and G1 additions are additive", () => {
  const p1Me = {
    user: { ref: "cm1a7s3c10003ls8dh2m7q5yt", code: "ABC123", name: "Sam", email: "s@example.com", avatarUrl: null, role: "user", onboarded: true, ratingLabel: null },
    entitlement: fx.trialEntitlementFixture,
    flags: {},
    buildId: "dev",
  };
  it("a P1-shaped /api/me body still parses; the P4 one parses too", () => {
    assert.equal(MeData.safeParse(p1Me).success, true);
    const p4Me = {
      ...p1Me,
      user: { ...p1Me.user, timeZone: "Asia/Kolkata" },
      onboarding: fx.onboardingDoneFixture,
      accounts: fx.meAccountsFixture,
      import: fx.meImportFixture,
    };
    assert.equal(MeData.safeParse(p4Me).success, true);
    assert.equal(MeData.safeParse({ ...p4Me, import: null }).success, true);
    assert.equal(MeData.safeParse({ ...p4Me, accounts: [...fx.meAccountsFixture, ...fx.meAccountsFixture, ...fx.meAccountsFixture] }).success, false);
  });

  it("GamesQuery takes an optional source; meta.counts carries per-source counts", () => {
    assert.equal(GamesQuery.parse({}).source, undefined);
    assert.equal(GamesQuery.parse({ source: "chesscom" }).source, "chesscom");
    assert.equal(GamesQuery.safeParse({ source: "CHESSCOM" }).success, false);
    assert.equal(GamesPageMeta.safeParse({ nextCursor: null, counts: { all: 3 } }).success, true);
    assert.equal(GamesPageMeta.safeParse({ nextCursor: null, counts: { all: 52, replay: 4, chesscom: 48, lichess: 0 } }).success, true);
  });
});

describe("P4 registry entries (§7.0)", () => {
  it("auth, cache, status and side effects", () => {
    const rows: [string, string, string, string, number][] = [
      ["accounts.list", "GET", "user", "private-etag", 200],
      ["accounts.chesscom.lookup", "POST", "user", "no-store", 200],
      ["accounts.chesscom.link", "POST", "user", "no-store", 201],
      ["accounts.lichess.start", "GET", "optional", "no-store", 302],
      ["accounts.lichess.callback", "GET", "optional", "no-store", 302],
      ["accounts.sync", "POST", "member", "no-store", 202],
      ["accounts.update", "PATCH", "user", "no-store", 200],
      ["accounts.unlink", "DELETE", "user", "no-store", 200],
      ["import.status", "GET", "user", "private-etag", 200],
      ["import.retry", "POST", "member", "no-store", 202],
      ["me.onboarding", "PATCH", "user", "no-store", 200],
      ["billing.checkout", "POST", "user", "no-store", 200],
      ["billing.activation", "GET", "user", "no-store", 200],
    ];
    for (const [id, method, auth, cache, status] of rows) {
      const e = getEndpoint(id as Parameters<typeof getEndpoint>[0]);
      assert.equal(e.method, method, id);
      assert.equal(e.auth, auth, id);
      assert.equal(e.cache, cache, id);
      assert.equal(successStatusOf(e), status, id);
      assert.deepEqual(endpointProblems(e), [], id);
    }
    assert.deepEqual(getEndpoint("import.status").sideEffects, ["kick_cas", "release_waiting"]);
    assert.deepEqual(getEndpoint("billing.activation").sideEffects, ["billing_snapshot"]);
    assert.deepEqual(getEndpoint("accounts.lichess.callback").sideEffects, ["oauth_link"]);
    assert.equal(getEndpoint("accounts.lichess.start").path, "/api/accounts/lichess/start");
    assert.equal(getEndpoint("import.retry").path, "/api/import/{ref}/retry");
    assert.equal(getEndpoint("accounts.sync").path, "/api/accounts/{provider}/sync");
  });

  it("rate limits as §7.0 (limit / windowSec, by); every P4 window is a burst window ≤ 60 s", () => {
    const sig = (id: string) =>
      rateLimitsOf(getEndpoint(id as Parameters<typeof getEndpoint>[0])).map((l) => `${l.bucket} ${l.limit}/${l.windowSec} ${l.by}`);
    assert.deepEqual(sig("accounts.chesscom.lookup"), ["lookup 10/60 user", "lookup-ip 30/60 ip"]);
    assert.deepEqual(sig("accounts.chesscom.link"), ["link 5/60 user"]);
    assert.deepEqual(sig("accounts.lichess.start"), ["link 5/60 user"]);
    assert.deepEqual(sig("accounts.unlink"), ["link 5/60 user"]);
    assert.deepEqual(sig("accounts.update"), ["settings 30/60 user"]);
    assert.deepEqual(sig("me.onboarding"), ["onboarding 60/60 user"]);
    assert.deepEqual(sig("billing.checkout"), ["checkout 6/60 user"]);
    assert.deepEqual(sig("billing.activation"), ["billing-activation 40/60 user"]);
    assert.deepEqual(sig("accounts.list"), []);
    assert.deepEqual(sig("import.status"), []);
    // Scoped by provider / run, applied by the handlers (the wrapper keys by user only).
    assert.deepEqual(sig("accounts.sync"), []);
    assert.deepEqual(sig("import.retry"), []);
    assert.deepEqual(ACCOUNT_SYNC_LIMIT, { bucket: "sync", limit: 1, windowSec: 30, by: "user" });
    assert.deepEqual(IMPORT_RETRY_LIMIT, ACCOUNT_SYNC_LIMIT);
    assert.deepEqual(DODO_ACTIVATION_LIMIT, { bucket: "dodo-activation", limit: 1, windowSec: 5, by: "user" });
    for (const id of ["accounts.sync", "import.retry"]) {
      assert.ok(expectedErrorCodes(getEndpoint(id as Parameters<typeof getEndpoint>[0])).includes("rate_limited"), id);
    }
  });

  it("upstream_unavailable is declared where the plan names it (always 502)", () => {
    for (const id of ["accounts.chesscom.lookup", "accounts.chesscom.link", "billing.checkout", "billing.activation"]) {
      assert.ok(expectedErrorCodes(getEndpoint(id as Parameters<typeof getEndpoint>[0])).includes("upstream_unavailable"), id);
    }
    assert.ok(expectedErrorCodes(getEndpoint("accounts.sync")).includes("subscription_required"));
    assert.ok(expectedErrorCodes(getEndpoint("import.retry")).includes("not_found"));
  });
});

describe("p04-plain.ts stays zod-free", () => {
  it("imports nothing", () => {
    const src = readFileSync(new URL("./p04-plain.ts", import.meta.url), "utf8");
    assert.equal(/^\s*import\s/m.test(src), false);
    assert.equal(/require\(/.test(src), false);
  });
});
