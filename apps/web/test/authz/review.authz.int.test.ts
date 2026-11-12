/**
 * Authz matrix of the P3 review routes A1–A9b (phase-03 plan §11.1, §12.2), actors × routes against a real Postgres:
 *
 * | actor                                   | expected                                                         |
 * | signed out                              | 401                                                              |
 * | never a member (user R)                 | 402 trial_available                                              |
 * | trial used (user Q)                     | 402 trial_used                                                   |
 * | lapsed                                  | 402 expired; with `review-lapsed-read` on: GETs as a player, 402 on writes |
 * | member, not a player (B)                | 404 (masking)                                                    |
 * | member, player (A)                      | 2xx                                                              |
 * | admin, not a player (C)                 | 200 on GETs, 204 no-op on writes                                 |
 *
 * Skipped unless TEST_DATABASE_URL is set (CI: the `integration` job's Docker Postgres). Throwaway databases only.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { ErrorEnvelope } from "@repo/contracts/http/envelope";
import { setLapsedReadFlag } from "@/lib/services/analysis/reader";
import { jsonOf, viewerFixture } from "../helpers/route-harness";
import { reviewWorld, type HandlerName, type Who } from "../api/review-world";

const url = process.env.TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;

type Row = {
  name: string;
  handler: HandlerName;
  method: "GET" | "POST" | "PATCH";
  game: string;
  suffix: string;
  body?: unknown;
  params?: Record<string, string>;
  /** The player's success status. */
  ok: number;
};

const ROWS: Row[] = [
  { name: "A1", handler: "review", method: "GET", game: "done", suffix: "", ok: 200 },
  { name: "A2", handler: "status", method: "GET", game: "done", suffix: "/status", ok: 200 },
  { name: "A3", handler: "analyse", method: "POST", game: "done", suffix: "/analyse", body: {}, ok: 200 },
  { name: "A4", handler: "retry", method: "POST", game: "failed", suffix: "/retry", body: {}, ok: 202 },
  { name: "A5", handler: "progress", method: "PATCH", game: "done", suffix: "/progress", body: { momentIndex: 1, events: [] }, ok: 204 },
  { name: "A6", handler: "moment", method: "PATCH", game: "done", suffix: "/moments/32", params: { ply: "32" }, body: { inBank: true }, ok: 200 },
  { name: "A7", handler: "complete", method: "POST", game: "done", suffix: "/complete", body: {}, ok: 200 },
  { name: "A8", handler: "pgn", method: "GET", game: "done", suffix: "/pgn", ok: 200 },
  { name: "A9", handler: "legend", method: "GET", game: "legend", suffix: "/legend", ok: 200 },
  { name: "A9b", handler: "compute", method: "POST", game: "legend", suffix: "/legend/compute", body: {}, ok: 202 },
];

const NEVER_MEMBER = { member: false, entitled: false, state: "none", trial: { used: false, eligible: true } } as const;
const TRIAL_USED = { member: false, entitled: false, state: "lapsed", trial: { used: true, eligible: false }, neverPaid: true } as const;
const EXPIRED = { member: false, entitled: false, state: "lapsed", trial: { used: true, eligible: false }, neverPaid: false } as const;

describe("P3 review routes: authz matrix (Postgres)", { skip: url ? false : "TEST_DATABASE_URL not set" }, () => {
  const w = reviewWorld(url ?? "");

  before(() => w.setup());
  after(() => w.teardown());

  async function hit(row: Row, who: Who, init: { viewer?: ReturnType<typeof viewerFixture>; signedOut?: boolean } = {}) {
    const ref = w.games[row.game]!.ref;
    const { res, recorded } = await w.call(w.H[row.handler], row.method, `/api/review/${ref}${row.suffix}`, who, {
      params: { ref, ...row.params },
      body: row.body,
      ...init,
    });
    await w.runAfter(recorded);
    return res;
  }

  const lapsedA = (entitlement: typeof NEVER_MEMBER | typeof TRIAL_USED | typeof EXPIRED) =>
    viewerFixture({ id: w.users.a.id, ref: w.users.a.ref, user: { name: w.users.a.name }, entitlement });

  async function expectError(res: Response, status: number, code: string, reason?: string) {
    assert.equal(res.status, status, `${res.status} ${await res.clone().text()}`);
    const body = ErrorEnvelope.parse(await jsonOf(res));
    assert.equal(body.error.code, code);
    if (reason) assert.equal((body.error.details as { reason?: string }).reason, reason);
  }

  it("signed out → 401 on every route", async () => {
    for (const row of ROWS) await expectError(await hit(row, "a", { signedOut: true }), 401, "unauthorized");
  });

  it("never a member → 402 trial_available; trial used → 402 trial_used; lapsed → 402 expired", async () => {
    for (const row of ROWS) {
      await expectError(await hit(row, "a", { viewer: lapsedA(NEVER_MEMBER) }), 402, "subscription_required", "trial_available");
      await expectError(await hit(row, "a", { viewer: lapsedA(TRIAL_USED) }), 402, "subscription_required", "trial_used");
      await expectError(await hit(row, "a", { viewer: lapsedA(EXPIRED) }), 402, "subscription_required", "expired");
    }
  });

  it("lapsed with review-lapsed-read on: GETs read as the player, writes stay 402", async () => {
    const restore = setLapsedReadFlag(async () => true);
    try {
      for (const row of ROWS) {
        const res = await hit(row, "a", { viewer: lapsedA(EXPIRED) });
        if (row.method === "GET") assert.equal(res.status, row.ok, `${row.name}: ${await res.clone().text()}`);
        else await expectError(res, 402, "subscription_required", "expired");
      }
      // The flag never opens reads to someone who was never a member.
      await expectError(await hit(ROWS[0]!, "a", { viewer: lapsedA(NEVER_MEMBER) }), 402, "subscription_required", "trial_available");
    } finally {
      restore();
    }
  });

  it("a member who is not a player → 404 on every route (existence is never revealed)", async () => {
    for (const row of ROWS) await expectError(await hit(row, "b"), 404, "not_found");
  });

  it("the player → the route's success status", async () => {
    for (const row of ROWS) {
      const res = await hit(row, "a");
      assert.equal(res.status, row.ok, `${row.name}: ${res.status} ${await res.clone().text()}`);
    }
  });

  it("an admin who is not a player → 200 on GETs, 204 no-op on writes (nothing queued or written)", async () => {
    const legendJobs = async () => (await w.jobs(w.games.legend!.id)).filter((j) => j.kind === "LEGEND_COMPARE");
    const before = (await legendJobs()).length;
    for (const row of ROWS) {
      const res = await hit(row, "c");
      assert.equal(res.status, row.method === "GET" ? 200 : 204, `${row.name}: ${res.status} ${await res.clone().text()}`);
    }
    assert.equal((await legendJobs()).length, before);
  });
});
