// Plan §12.1 lib/auth/viewer.test.ts: toViewer / toMeData with a fixed `now` and the catalog
// { monthly: "pdt_m", yearly: "pdt_y", legacy: ["pdt_old"] }, the column list against VIEWER_SELECT, and the loaders'
// statement shape with a fake database.
import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import { describe, it } from "node:test";
import { MeData } from "@repo/contracts/http/me";
import { toShellSession } from "../shell/shell-user";

// lib/billing/{entitlement,products}.ts start with `import "server-only"`, which only Next.js resolves. Stub it first.
const STUB = "data:text/javascript,export%20%7B%7D";
if (typeof nodeModule.registerHooks === "function") {
  nodeModule.registerHooks({
    resolve: (specifier, context, next) =>
      specifier === "server-only" ? { url: STUB, shortCircuit: true } : next(specifier, context),
  });
} else {
  nodeModule.register(
    "data:text/javascript," +
      encodeURIComponent(
        `export async function resolve(s, c, n) { return s === "server-only" ? { url: ${JSON.stringify(STUB)}, shortCircuit: true } : n(s, c); }`,
      ),
  );
}

const {
  ENTITLEMENT_COLUMNS,
  VIEWER_COLUMNS,
  VIEWER_SELECT,
  VIEWER_BY_ID_SQL,
  VIEWER_SQL,
  ONBOARDING_COLUMNS,
  queryViewerRecord,
  recordOfRow,
  readViewerRecordById,
  toMeData,
  toShellUserRecord,
  toViewer,
} = await import("./viewer");
const { ENTITLEMENT_SELECT } = await import("../billing/entitlement");
const { getProductCatalog } = await import("../billing/products");
type ViewerRecord = import("./viewer").ViewerRecord;

const NOW = new Date("2026-11-05T12:00:00.000Z");
const H = 3_600_000;
const DAY = 24 * H;
const at = (ms: number) => new Date(NOW.getTime() + ms);
const catalog = { monthly: "pdt_m", yearly: "pdt_y", legacy: ["pdt_old"] };
const opts = { now: NOW, paywallEnabled: true, catalog };

/** A copy of `o` without `keys` (a P1-shaped record, a raw row before the joins are folded). */
function omit<T extends object>(o: T, keys: readonly string[]): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k))) as Partial<T>;
}

/** A never-subscribed, onboarded user with no chess.com profile. */
function viewerRecord(overrides: Partial<ViewerRecord> = {}): ViewerRecord {
  return {
    id: 7n,
    referenceId: "cviewerrecord0000000000000",
    code: "ABC123",
    googleId: "user_test",
    email: "viewer@example.test",
    name: "Test Viewer",
    profilePictureUrl: null,
    role: "USER",
    isActive: true,
    onboarded: true,
    dodoCustomerId: null,
    subscriptionSourceAt: null,
    gamesVersion: 0,
    plan: null,
    planInterval: null,
    subscriptionId: null,
    subscriptionStatus: null,
    subscriptionProductId: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    subscriptionUpdatedAt: null,
    trialStartedAt: null,
    trialEndsAt: null,
    onboardingStep: "DONE",
    onboardedAt: null,
    ratingBand: null,
    ratingBandSource: null,
    initialRating: null,
    goals: [],
    dailyMinutes: null,
    timeZone: "UTC",
    pendingCheckoutAt: null,
    blitzRating: null,
    rapidRating: null,
    linkedAccounts: [],
    importRun: null,
    ...overrides,
  };
}

const paid = (overrides: Partial<ViewerRecord> = {}) =>
  viewerRecord({
    subscriptionId: "sub_1",
    subscriptionStatus: "active",
    subscriptionProductId: "pdt_m",
    currentPeriodEnd: at(20 * DAY),
    dodoCustomerId: "cus_1",
    ...overrides,
  });

const trialing = (left: number) =>
  paid({ trialStartedAt: at(left - 7 * DAY), trialEndsAt: at(left), currentPeriodEnd: at(left) });

/** Every record shape the plan names, with the state toViewer must give it (shared with the parity check). */
const VIEWER_CASES: { name: string; record: ViewerRecord; state: string; member: boolean; issue: string | null }[] = [
  { name: "never subscribed", record: viewerRecord(), state: "none", member: false, issue: null },
  { name: "active member", record: paid(), state: "member", member: true, issue: null },
  { name: "trial 5 days", record: trialing(5 * DAY), state: "trial", member: true, issue: null },
  { name: "trial 3 h", record: trialing(3 * H), state: "trial", member: true, issue: null },
  { name: "cancelling", record: paid({ cancelAtPeriodEnd: true }), state: "cancelling", member: true, issue: null },
  { name: "past_due 4 days left", record: paid({ subscriptionStatus: "past_due", currentPeriodEnd: at(4 * DAY) }), state: "grace", member: true, issue: "banner" },
  { name: "on_hold 30 h left", record: paid({ subscriptionStatus: "on_hold", currentPeriodEnd: at(30 * H) }), state: "grace", member: true, issue: "last_day" },
  { name: "failed after period", record: paid({ subscriptionStatus: "failed", currentPeriodEnd: at(-2 * DAY) }), state: "lapsed", member: false, issue: "expired" },
  { name: "expired long ago", record: paid({ subscriptionStatus: "expired", currentPeriodEnd: at(-60 * DAY) }), state: "lapsed", member: false, issue: null },
  {
    name: "trial cancelled",
    record: paid({ subscriptionStatus: "cancelled", trialStartedAt: at(-10 * DAY), trialEndsAt: at(-3 * DAY), currentPeriodEnd: at(-3 * DAY) }),
    state: "lapsed",
    member: false,
    issue: null,
  },
];

describe("toViewer / toMeData (plan §8.2)", () => {
  for (const c of VIEWER_CASES) {
    it(`${c.name} → ${c.state}${c.issue ? ` (${c.issue})` : ""}`, () => {
      const v = toViewer(c.record, opts);
      assert.equal(v.entitlement.state, c.state);
      assert.equal(v.entitlement.member, c.member);
      assert.equal(v.entitlement.paymentIssue?.state ?? null, c.issue);
      // Every case serialises to a valid MeData.
      MeData.parse(toMeData(c.record, { ...opts, flags: { "shell-v3": true }, buildId: "test" }));
    });
  }

  it("an active member: plan, price, portal, ids", () => {
    const v = toViewer(paid(), opts);
    assert.equal(v.id, 7n);
    assert.equal(v.ref, "cviewerrecord0000000000000");
    assert.equal(v.clerkUserId, "user_test");
    assert.equal(v.role, "user");
    assert.equal(v.entitlement.entitled, true);
    assert.equal(v.entitlement.planKey, "monthly");
    assert.equal(v.entitlement.interval, "month");
    assert.equal(v.entitlement.status, "active");
    assert.equal(v.entitlement.hasBillingPortal, true);
    assert.equal(v.entitlement.trial.eligible, false);
    assert.equal(v.entitlement.trial.daysLeft, null);
    assert.equal(v.billing.neverPaid, false);
  });

  it("trial daysLeft: 5 days → 5, 3 h → 1", () => {
    assert.equal(toViewer(trialing(5 * DAY), opts).entitlement.trial.daysLeft, 5);
    assert.equal(toViewer(trialing(3 * H), opts).entitlement.trial.daysLeft, 1);
    assert.equal(toViewer(trialing(3 * H), opts).entitlement.trial.active, true);
  });

  it("paymentIssue carries the access end and its UTC label", () => {
    const v = toViewer(paid({ subscriptionStatus: "past_due", currentPeriodEnd: new Date("2026-11-12T03:00:00Z") }), opts);
    assert.deepEqual(v.entitlement.paymentIssue, { state: "banner", accessEndsAt: "2026-11-12T03:00:00.000Z", accessEndsAtLabel: "Nov 12" });
  });

  it("admin without a plan and paywall off are members (entitled stays billing truth)", () => {
    const admin = toViewer(viewerRecord({ role: "ADMIN" }), opts);
    assert.equal(admin.role, "admin");
    assert.equal(admin.user.role, "admin");
    assert.equal(admin.entitlement.member, true);
    assert.equal(admin.entitlement.entitled, false);
    const off = toViewer(viewerRecord(), { ...opts, paywallEnabled: false });
    assert.equal(off.entitlement.member, true);
    assert.equal(off.entitlement.paywall, false);
  });

  it("ratingLabel: blitz first, then rapid, else null", () => {
    assert.equal(toViewer(viewerRecord({ blitzRating: 1184, rapidRating: 1320 }), opts).user.ratingLabel, "Blitz 1184");
    assert.equal(toViewer(viewerRecord({ rapidRating: 1320 }), opts).user.ratingLabel, "Rapid 1320");
    assert.equal(toViewer(viewerRecord(), opts).user.ratingLabel, null);
  });

  it("trial.eligible only before any trial or subscription", () => {
    assert.equal(toViewer(viewerRecord(), opts).entitlement.trial.eligible, true);
    assert.equal(toViewer(viewerRecord({ trialStartedAt: at(-30 * DAY) }), opts).entitlement.trial.eligible, false);
    assert.equal(toViewer(viewerRecord({ subscriptionId: "sub_x", subscriptionStatus: "expired" }), opts).entitlement.trial.eligible, false);
  });

  it("e2e-fixture → monthly in dev/test, no plan in production", () => {
    const record = paid({ subscriptionProductId: "e2e-fixture" });
    assert.equal(toViewer(record, { ...opts, catalog: getProductCatalog(true) }).entitlement.planKey, "monthly");
    const refused: string[] = [];
    const prod = { ...getProductCatalog(false), onFixtureRefused: (id: string) => refused.push(id) };
    assert.equal(toViewer(record, { ...opts, catalog: prod }).entitlement.planKey, null);
    assert.deepEqual(refused, ["e2e-fixture"]);
  });

  it("MeData.user: own fields only, name capped at 120, onboarded", () => {
    const me = toMeData(viewerRecord({ name: "x".repeat(200), profilePictureUrl: "https://img.example/a.png" }), {
      ...opts,
      flags: {},
      buildId: "b1",
    });
    // An onboarded user's /api/me carries no `onboarding` view (FIX-2, plan §9.6 /api/me growth): only the steps read it.
    assert.equal(me.user.onboarded, true);
    assert.deepEqual(Object.keys(me), ["user", "entitlement", "flags", "buildId", "accounts", "import"]);
    assert.deepEqual(Object.keys(me.user), ["ref", "code", "name", "email", "avatarUrl", "role", "onboarded", "ratingLabel", "timeZone"]);
    assert.equal(me.user.name.length, 120);
    assert.equal(me.user.avatarUrl, "https://img.example/a.png");
    assert.equal(me.buildId, "b1");
    const body = JSON.stringify(me);
    for (const secret of ["user_test", "cus_", "googleId", "dodoCustomerId", "subscriptionId"]) assert.ok(!body.includes(secret), secret);
  });

  it("an unknown stored status reads as null (contract enum)", () => {
    assert.equal(toViewer(paid({ subscriptionStatus: "mystery" }), opts).entitlement.status, null);
  });
});

describe("the viewer statement", () => {
  it("VIEWER_COLUMNS equals the VIEWER_SELECT keys (one source of truth)", () => {
    assert.deepEqual([...VIEWER_COLUMNS].sort(), Object.keys(VIEWER_SELECT).sort());
    assert.equal(new Set(VIEWER_COLUMNS).size, VIEWER_COLUMNS.length);
  });

  it("ENTITLEMENT_COLUMNS mirrors ENTITLEMENT_SELECT (lib/billing/entitlement.ts)", () => {
    assert.deepEqual([...ENTITLEMENT_COLUMNS].sort(), Object.keys(ENTITLEMENT_SELECT).sort());
  });

  it("one SELECT with a LEFT JOIN on chess_com_profiles and two LATERAL joins, by googleId (or id), bound as $1", () => {
    assert.match(VIEWER_SQL, /^SELECT u\."id", u\."referenceId", /);
    assert.match(VIEWER_SQL, /c\."blitzRating", c\."rapidRating", COALESCE\(la\.accounts, '\[\]'::json\) AS "linkedAccounts", /);
    assert.match(VIEWER_SQL, /FROM users u LEFT JOIN chess_com_profiles c ON c\."userId" = u\.id LEFT JOIN LATERAL \(SELECT json_agg\(/);
    assert.match(VIEWER_SQL, /FROM linked_accounts l WHERE l\."userId" = u\.id\) la ON true /);
    assert.match(VIEWER_SQL, /FROM import_runs r WHERE r\."userId" = u\.id AND \(r\.status IN \('WAITING_FOR_MEMBERSHIP', 'QUEUED', 'RUNNING'\) OR r\."finishedAt" > /);
    assert.match(VIEWER_SQL, /ORDER BY r\."createdAt" DESC LIMIT 1\) ir ON true WHERE u\."googleId" = \$1 LIMIT 1$/);
    assert.match(VIEWER_BY_ID_SQL, /WHERE u\.id = \$1::bigint LIMIT 1$/);
    assert.equal(VIEWER_SQL.replace(`u."googleId" = $1`, `u.id = $1::bigint`), VIEWER_BY_ID_SQL);
    for (const c of VIEWER_COLUMNS) assert.ok(VIEWER_SQL.includes(`u."${c}"`) || VIEWER_SQL.includes(`u.${c}::`), c);
    for (const c of ONBOARDING_COLUMNS) assert.ok((VIEWER_COLUMNS as readonly string[]).includes(c), c);
    assert.ok(VIEWER_SQL.includes(`u."onboardingStep"::text AS "onboardingStep"`));
    assert.ok(VIEWER_SQL.includes(`u.goals::text[] AS goals`));
  });

  /** A raw row as VIEWER_SQL returns it (the LATERAL columns unfolded). */
  function rawRow(overrides: Record<string, unknown> = {}) {
    return {
      ...omit(viewerRecord(), ["linkedAccounts", "importRun"]),
      linkedAccounts: [],
      importRef: null,
      importProvider: null,
      importStatus: null,
      importPhase: null,
      importImported: null,
      importTotal: null,
      ...overrides,
    };
  }

  it("queryViewerRecord runs one statement and returns the first row (joins folded) or null", async () => {
    const calls: unknown[][] = [];
    const db = {
      $queryRawUnsafe: async <T>(...args: unknown[]) => {
        calls.push(args);
        return (args[1] === "user_test" ? [rawRow()] : []) as T;
      },
    };
    const record = await queryViewerRecord(db, "user_test");
    assert.equal(record?.code, "ABC123");
    assert.deepEqual(record?.linkedAccounts, []);
    assert.equal(record?.importRun, null);
    assert.equal(await queryViewerRecord(db, "user_nobody"), null);
    assert.deepEqual(calls, [[VIEWER_SQL, "user_test"], [VIEWER_SQL, "user_nobody"]]);
  });

  it("readViewerRecordById runs the same statement by id (decimal string)", async () => {
    const calls: unknown[][] = [];
    const db = {
      $queryRawUnsafe: async <T>(...args: unknown[]) => {
        calls.push(args);
        return [rawRow({ blitzRating: 1500 })] as T;
      },
    };
    const record = await readViewerRecordById(db, 7n);
    assert.deepEqual(calls, [[VIEWER_BY_ID_SQL, "7"]]);
    assert.equal(record?.blitzRating, 1500);
    assert.equal(record?.rapidRating, null);
  });

  it("recordOfRow folds the json accounts (ISO → Date) and the run columns", () => {
    const r = recordOfRow(
      rawRow({
        linkedAccounts: [
          { provider: "CHESSCOM", username: "knightowl_88", status: "ACTIVE", importState: "RUNNING", lastSyncAt: "2026-11-05T10:00:00.000Z", nextAllowedSyncAt: null },
        ],
        importRef: "cimportrun000000000000000",
        importProvider: "CHESSCOM",
        importStatus: "RUNNING",
        importPhase: "saving",
        importImported: 212,
        importTotal: 480,
      }) as never,
    );
    assert.deepEqual(r.linkedAccounts, [
      { provider: "CHESSCOM", username: "knightowl_88", status: "ACTIVE", importState: "RUNNING", lastSyncAt: new Date("2026-11-05T10:00:00.000Z"), nextAllowedSyncAt: null },
    ]);
    assert.deepEqual(r.importRun, { referenceId: "cimportrun000000000000000", provider: "CHESSCOM", status: "RUNNING", phase: "saving", imported: 212, total: 480 });
  });
});

describe("P4 viewer fields → MeData (phase-04 §7.2)", () => {
  it("onboarding (lowercase wire), timeZone, accounts with the §8.11 view status, the active run", () => {
    const record = viewerRecord({
      onboarded: false,
      onboardingStep: "GOALS",
      ratingBand: "R800_1200",
      ratingBandSource: "chesscom:rapid",
      initialRating: 1184,
      goals: ["STOP_BLUNDERING", "LEARN_OPENINGS"],
      dailyMinutes: 10,
      timeZone: "Asia/Kolkata",
      linkedAccounts: [
        { provider: "CHESSCOM", username: "knightowl_88", status: "ACTIVE", importState: "IDLE", lastSyncAt: at(-2 * H), nextAllowedSyncAt: at(30_000) },
        { provider: "LICHESS", username: "KnightOwl88", status: "ACTIVE", importState: "WAITING_FOR_MEMBERSHIP", lastSyncAt: null, nextAllowedSyncAt: null },
      ],
      importRun: { referenceId: "cimportrun000000000000000", provider: "LICHESS", status: "WAITING_FOR_MEMBERSHIP", phase: null, imported: 0, total: null },
    });
    const v = toViewer(record, opts);
    assert.equal(v.onboarding?.step, "GOALS");
    const me = MeData.parse(toMeData(record, { ...opts, flags: {}, buildId: "b" }));
    assert.equal(me.user.timeZone, "Asia/Kolkata");
    assert.deepEqual(me.onboarding, {
      step: "goals",
      done: false,
      ratingBand: "r800_1200",
      ratingBandSource: "chesscom:rapid",
      initialRating: 1184,
      goals: ["stop_blundering", "learn_openings"],
      dailyMinutes: 10,
      onboardedAt: null,
    });
    assert.deepEqual(me.accounts, [
      { provider: "chesscom", username: "knightowl_88", status: "rate_limited", lastSyncAt: at(-2 * H).toISOString() },
      { provider: "lichess", username: "KnightOwl88", status: "waiting_for_membership", lastSyncAt: null },
    ]);
    assert.deepEqual(me.import, { ref: "cimportrun000000000000000", provider: "lichess", status: "waiting_for_membership", phase: null, imported: 0, total: null });
  });

  it("a P1 shell record without the columns still maps (step from `onboarded`, UTC, no accounts)", () => {
    const p1 = omit(viewerRecord({ onboarded: false }), ["onboardingStep", "timeZone", "linkedAccounts", "importRun", "goals"]);
    const v = toViewer(p1 as Parameters<typeof toViewer>[0], opts);
    assert.equal(v.onboarding?.step, "WELCOME");
    assert.equal(v.onboarding?.timeZone, "UTC");
    assert.deepEqual(v.accounts, []);
    assert.equal(v.importRun, null);
  });
});

describe("shell parity (plan §8.2, lib/shell/shell-user.ts)", () => {
  it("toShellSession(toShellUserRecord(record)) agrees with toViewer on member and the banner state", () => {
    for (const c of VIEWER_CASES) {
      const shell = toShellSession(toShellUserRecord(c.record), opts);
      const v = toViewer(c.record, opts);
      assert.equal(shell.member, v.entitlement.member, c.name);
      if (v.entitlement.member) assert.equal(shell.user.paymentIssueState, v.entitlement.paymentIssue?.state ?? null, c.name);
      assert.equal(shell.user.ratingLabel, v.user.ratingLabel, c.name);
      assert.equal(shell.user.hasBillingPortal, v.entitlement.hasBillingPortal, c.name);
    }
  });
});
