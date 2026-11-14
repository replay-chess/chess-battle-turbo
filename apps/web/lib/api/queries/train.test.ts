// Train and home query options (phase-05 plan §5.1): keys, freshness rules, the bank's page shape and query string,
// and the fetchers end to end against a stubbed fetch (the envelope, the include switch, R2's meta).
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { QueryClient } from "@tanstack/react-query";
import { bankNextPageFixture, bankPageFixture, badgesFixture, homeFixture, sessionPayloadFixture, sessionSummaryFixture, trainTodayFixture } from "@repo/contracts/http/fixtures/p05";
import { qk } from "../keys";
import { BADGES_STALE_MS, badgesQuery, HOME_STALE_MS, homeQuery } from "./home";
import {
  BANK_MAX_PAGES,
  BANK_STALE_MS,
  bankQuery,
  bankRowsOf,
  bankSearch,
  firstBankPage,
  readBankMeta,
  sessionSummaryQuery,
  THEMES_STALE_MS,
  themesQuery,
  TODAY_STALE_MS,
  todayStaleTime,
  trainSessionPath,
  trainSessionQuery,
  trainTodayQuery,
  type BankListData,
} from "./train";

type Call = { url: string; init: RequestInit | undefined };
let calls: Call[] = [];
let replies: unknown[] = [];
const realFetch = globalThis.fetch;

beforeEach(() => {
  calls = [];
  replies = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const body = replies.shift();
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("train query options", () => {
  it("use the qk.train keys with the plan's freshness", () => {
    assert.deepEqual(trainTodayQuery().queryKey, ["train", "today"]);
    assert.deepEqual(bankQuery({ view: "due", theme: "" }).queryKey, ["train", "bank", { view: "due" }]);
    assert.deepEqual(trainSessionQuery("cm5t9s3ss0001slzpbankdrl1").queryKey, qk.train.session("cm5t9s3ss0001slzpbankdrl1"));
    assert.deepEqual(sessionSummaryQuery("cm5t9s3ss0001slzpbankdrl1").queryKey, ["train", "session", "cm5t9s3ss0001slzpbankdrl1", "summary"]);
    assert.equal(trainSessionQuery("x").staleTime, Infinity);
    assert.equal(trainSessionQuery("x").refetchOnWindowFocus, false);
    assert.equal(themesQuery().staleTime, THEMES_STALE_MS);
    assert.equal(bankQuery({}).staleTime, BANK_STALE_MS);
    assert.equal(bankQuery({}).maxPages, BANK_MAX_PAGES);
  });

  it("today is fresh for 30 s, and stale at once when the local day moved on", () => {
    const d = trainTodayFixture("default");
    assert.equal(todayStaleTime(d, "2026-11-12"), TODAY_STALE_MS);
    assert.equal(todayStaleTime(d, "2026-11-13"), 0);
    assert.equal(todayStaleTime(undefined, "2026-11-13"), TODAY_STALE_MS);
    assert.equal(todayStaleTime(d), TODAY_STALE_MS);
  });

  it("the bank query string drops empty values and the cursor of page 1", () => {
    assert.deepEqual(bankSearch({ view: "due", theme: "fork" }, null), {
      view: "due",
      theme: "fork",
      phase: undefined,
      source: undefined,
      cursor: undefined,
      limit: 50,
    });
    assert.equal(bankSearch({}, "abc").cursor, "abc");
    assert.deepEqual(readBankMeta({ nextCursor: "n1", complete: true }, true), { nextCursor: "n1", complete: true });
    assert.deepEqual(readBankMeta({ nextCursor: null, complete: true }, false), { nextCursor: null, complete: false });
    assert.deepEqual(readBankMeta(undefined, true), { nextCursor: null, complete: false });
  });

  it("fetches page 1 (BankPage + complete), then a later page (rows only), through the infinite query", async () => {
    replies.push({ data: bankPageFixture("default"), meta: { nextCursor: "c2", complete: false } });
    replies.push({ data: bankNextPageFixture(), meta: { nextCursor: null } });
    const qc = new QueryClient();
    const opts = bankQuery({ view: "all" });
    await qc.fetchInfiniteQuery({ ...opts, pages: 2 });
    const data = qc.getQueryData(opts.queryKey) as BankListData;
    assert.equal(data.pages.length, 2);
    assert.equal(firstBankPage(data)?.counts.all, 23);
    assert.equal(bankRowsOf(data).length, 23 + 50);
    assert.match(calls[0]!.url, /^\/api\/train\/bank\?view=all&limit=50$/);
    assert.match(calls[1]!.url, /cursor=c2/);
  });

  it("fetches the session with include=items and the summary with include=summary", async () => {
    replies.push({ data: sessionPayloadFixture("bank") }, { data: sessionSummaryFixture("default") });
    const qc = new QueryClient();
    const ref = "cm5t9s3ss0001slzpbankdrl1";
    const payload = await qc.fetchQuery(trainSessionQuery(ref));
    const summary = await qc.fetchQuery(sessionSummaryQuery(ref));
    assert.equal(payload.items.length, 3);
    assert.equal(summary.variant, "default");
    assert.equal(calls[0]!.url, `/api/train/sessions/${ref}?include=items`);
    assert.equal(calls[1]!.url, `/api/train/sessions/${ref}?include=summary`);
    assert.equal(trainSessionPath("/api/train/sessions/{ref}/end", "c a"), "/api/train/sessions/c%20a/end");
  });

  it("fetches today", async () => {
    replies.push({ data: trainTodayFixture("default") });
    const today = await new QueryClient().fetchQuery(trainTodayQuery());
    assert.equal(today.plan.total, 2);
    assert.equal(calls[0]!.url, "/api/train/today");
  });
});

describe("home and badges query options", () => {
  it("keys, freshness and no interval poll", () => {
    assert.deepEqual(homeQuery().queryKey, ["home"]);
    assert.deepEqual(badgesQuery().queryKey, ["badges"]);
    assert.equal(homeQuery().staleTime, HOME_STALE_MS);
    assert.equal(badgesQuery().staleTime, BADGES_STALE_MS);
    assert.equal(badgesQuery().refetchInterval, false);
  });

  it("fetch /api/home and /api/me/badges", async () => {
    replies.push({ data: homeFixture("populated") }, { data: badgesFixture() });
    const qc = new QueryClient();
    assert.equal((await qc.fetchQuery(homeQuery())).state, "populated");
    assert.deepEqual(await qc.fetchQuery(badgesQuery()), badgesFixture());
    assert.deepEqual(calls.map((c) => c.url), ["/api/home", "/api/me/badges"]);
  });
});

it("the client's bank page size is the contract's (a copy keeps zod out of the route chunks)", async () => {
  const contract = await import("@repo/contracts/http/train");
  const queries = await import("./train");
  assert.equal(queries.BANK_PAGE_ROWS, contract.BANK_PAGE_ROWS);
});
