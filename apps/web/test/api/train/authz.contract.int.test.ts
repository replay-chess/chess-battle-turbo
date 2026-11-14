/**
 * The auth matrix of every P5 route on a real Postgres (phase-05 plan §12.2 "auth matrix", §11): signed out → 401; a
 * non-member → 402 `subscription_required` with each `details.reason`; another member's session / card / mistake /
 * moment ref → 404 (never 403); malformed JSON → 400 `invalid_json`; an unknown body field → 400; oversize → 413; a
 * route limiter's 429 carries `Retry-After`. Every route in the registry's train / home / reports areas is covered.
 *
 * Skipped unless TEST_DATABASE_URL is set. Throwaway databases only.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { Prisma } from "@repo/db";
import { SUBSCRIPTION_REASONS } from "@repo/contracts/http/codes";
import { ErrorEnvelope } from "@repo/contracts/http/envelope";
import { homeEndpoints, reportsEndpoints, trainEndpoints } from "@repo/contracts/http/registry";
import { rateLimitsOf } from "@repo/contracts/http/endpoint";
import type { Viewer } from "@/lib/auth/viewer";
import { trainWorld, type Member, type RouteName } from "./train-world";

const url = process.env.TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;

type Case = { id: string; name: RouteName; method: "GET" | "POST" | "PATCH" | "DELETE"; path: string; params: Record<string, string>; body?: unknown; maxBody?: number };

describe("P5 auth matrix (Postgres)", { skip: url ? false : "TEST_DATABASE_URL not set" }, () => {
  const w = trainWorld(url ?? "");
  let owner: Member;
  let stranger: Member;
  let sessionRef: string;
  let cardRef: string;
  let mistakeRef: string;
  let fen: string;
  const cases: Case[] = [];

  before(async () => {
    await w.setup();
    owner = await w.member("owner");
    await w.persona(owner, "bank-member");
    // Another member with a bank of their own positions (the same persona would share the owner's card keys: a card's
    // ref is derived from the position, unique per member).
    stranger = await w.member("stranger");
    await w.persona(stranger, "bank-empty");
    const s = await w.call("sessions", "POST", "/api/train/sessions", owner, { body: { kind: "bank", source: "hub" }, headers: { "Idempotency-Key": w.uuid() } });
    sessionRef = ((await s.json()) as { data: { ref: string } }).data.ref;
    const row = (await w.db.$queryRaw<{ itemKey: string; ref: string; fen: string }[]>(Prisma.sql`
      SELECT c."itemKey", m."referenceId" AS ref, m.fen FROM training_cards c JOIN mistakes m ON m.id = c."mistakeId"
       WHERE c."userId" = ${owner.id} ORDER BY c.id LIMIT 1`))[0]!;
    cardRef = row.itemKey;
    mistakeRef = row.ref;
    fen = row.fen;
    const sp = { ref: sessionRef };
    const cp = { ref: cardRef };
    cases.push(
      { id: "train.today", name: "today", method: "GET", path: "/api/train/today", params: {} },
      { id: "train.bank", name: "bank", method: "GET", path: "/api/train/bank", params: {} },
      { id: "train.themes", name: "themes", method: "GET", path: "/api/train/themes", params: {} },
      { id: "train.sessions.create", name: "sessions", method: "POST", path: "/api/train/sessions", params: {}, body: { kind: "bank", source: "hub" }, maxBody: 16_384 },
      { id: "train.sessions.get", name: "session", method: "GET", path: `/api/train/sessions/${sessionRef}`, params: sp },
      { id: "train.sessions.extend", name: "extend", method: "POST", path: `/api/train/sessions/${sessionRef}/extend`, params: sp, body: { after: "i1" }, maxBody: 4_096 },
      { id: "train.sessions.end", name: "end", method: "POST", path: `/api/train/sessions/${sessionRef}/end`, params: sp, body: { reason: "user" }, maxBody: 1_024 },
      { id: "train.attempts", name: "attempts", method: "POST", path: "/api/train/attempts", params: {}, body: { attempts: [] }, maxBody: 65_536 },
      { id: "train.cards.skip", name: "skip", method: "POST", path: `/api/train/cards/${cardRef}/skip`, params: cp, body: { sessionRef: null }, maxBody: 1_024 },
      { id: "train.cards.remove", name: "card", method: "DELETE", path: `/api/train/cards/${cardRef}`, params: cp },
      { id: "train.prefs", name: "prefs", method: "PATCH", path: "/api/train/prefs", params: {}, body: { autoGrade: false }, maxBody: 1_024 },
      { id: "home.get", name: "home", method: "GET", path: "/api/home", params: {} },
      { id: "me.badges", name: "badges", method: "GET", path: "/api/me/badges", params: {} },
      { id: "reports.create", name: "reports", method: "POST", path: "/api/reports", params: {}, body: { targetType: "mistake", targetRef: mistakeRef, reason: "other", fen }, maxBody: 4_096 },
    );
  });
  after(() => w.teardown());

  const headers = (c: Case): Record<string, string> => (c.name === "sessions" || c.name === "reports" ? { "Idempotency-Key": w.uuid() } : {});
  const send = (c: Case, m: Member, init: { viewer?: Viewer | null; signedOut?: boolean; rawBody?: string; body?: unknown; headers?: Record<string, string>; rateLimited?: boolean } = {}) =>
    w.call(c.name, c.method, c.path, m, {
      params: c.params,
      headers: { ...headers(c), ...init.headers },
      ...(init.rawBody !== undefined ? { rawBody: init.rawBody } : { body: init.body ?? c.body }),
      ...(init.viewer !== undefined ? { viewer: init.viewer } : {}),
      ...(init.signedOut ? { signedOut: true } : {}),
    });

  it("covers every P5 registry entry", () => {
    const ids = [...Object.values(trainEndpoints), ...Object.values(homeEndpoints), ...Object.values(reportsEndpoints)].map((e) => e.id).sort();
    assert.deepEqual(cases.map((c) => c.id).sort(), ids);
  });

  it("signed out → 401 everywhere", async () => {
    for (const c of cases) {
      const r = await send(c, owner, { signedOut: true });
      assert.equal(r.res.status, 401, c.id);
      assert.equal(ErrorEnvelope.parse(await r.json()).error.code, "unauthorized");
    }
  });

  it("a non-member → 402 subscription_required with each reason, everywhere", async () => {
    const viewers: Record<(typeof SUBSCRIPTION_REASONS)[number], Viewer> = {
      trial_available: w.viewerOf(owner, { entitlement: { member: false, state: "none", trial: { used: false, eligible: true } } }),
      trial_used: w.viewerOf(owner, { entitlement: { member: false, state: "lapsed", trial: { used: true, eligible: false }, neverPaid: true } }),
      expired: w.viewerOf(owner, { entitlement: { member: false, state: "lapsed", trial: { used: true, eligible: false }, neverPaid: false } }),
      payment_failed: w.viewerOf(owner, { entitlement: { member: false, state: "lapsed", paymentIssue: { state: "expired" } } }),
    };
    for (const c of cases) {
      for (const reason of SUBSCRIPTION_REASONS) {
        const r = await send(c, owner, { viewer: viewers[reason] });
        assert.equal(r.res.status, 402, `${c.id} ${reason}`);
        const err = ErrorEnvelope.parse(await r.json()).error;
        assert.equal(err.code, "subscription_required");
        assert.equal((err.details as { reason?: string }).reason, reason, c.id);
      }
    }
  });

  it("another member's session or card ref → 404 (never 403)", async () => {
    for (const c of cases.filter((x) => "ref" in x.params)) {
      const r = await send(c, stranger);
      assert.equal(r.res.status, 404, `${c.id}: ${await r.res.clone().text()}`);
      assert.equal(ErrorEnvelope.parse(await r.json()).error.code, "not_found");
    }
    const report = cases.find((x) => x.name === "reports")!;
    assert.equal((await send(report, stranger)).res.status, 404, "a report on another member's mistake");
  });

  it("malformed JSON → 400 invalid_json; an unknown field → 400; oversize → 413", async () => {
    for (const c of cases.filter((x) => x.body !== undefined)) {
      const bad = await send(c, owner, { rawBody: "{nope" });
      assert.equal(bad.res.status, 400, c.id);
      assert.equal(ErrorEnvelope.parse(await bad.json()).error.code, "invalid_json");
      const extra = await send(c, owner, { body: { ...(c.body as object), sneaky: 1 } });
      assert.equal(extra.res.status, 400, `${c.id}: strict body`);
      const big = await send(c, owner, { headers: { "content-length": String((c.maxBody ?? 16_384) + 1) } });
      assert.equal(big.res.status, 413, c.id);
    }
  });

  it("the route limiters' 429 carries Retry-After (train-write, train-session-burst, report-burst)", async () => {
    const all = [...Object.values(trainEndpoints), ...Object.values(homeEndpoints), ...Object.values(reportsEndpoints)];
    const limited = cases.filter((c) => rateLimitsOf(all.find((e) => e.id === c.id)!).length > 0);
    assert.deepEqual(limited.map((c) => c.id).sort(), [
      "reports.create",
      "train.attempts",
      "train.cards.remove",
      "train.cards.skip",
      "train.prefs",
      "train.sessions.create",
      "train.sessions.extend",
    ]);
    for (const c of limited) {
      const r = await w.call(c.name, c.method, c.path, owner, {
        params: c.params,
        headers: headers(c),
        body: c.body,
        rateLimit: { allowed: false, retryAfterSec: 17, bucket: c.name === "reports" ? "report-burst" : c.id === "train.sessions.create" ? "train-session-burst" : "train-write" },
      });
      assert.equal(r.res.status, 429, c.id);
      assert.equal(r.res.headers.get("retry-after"), "17", c.id);
      assert.equal(ErrorEnvelope.parse(await r.json()).error.code, "rate_limited");
    }
  });
});
