/**
 * Authz matrix of the other P3 routes, A10, A11 (PATCH, DELETE), G1 and PR1 (phase-03 plan §11.1, §12.2), actors ×
 * routes against a real Postgres:
 *
 * | actor                       | A10 create          | A11 PATCH / DELETE   | G1 my games               | PR1 ?game=           |
 * | signed out                  | 401                 | 401                  | 401                       | 401                  |
 * | never a member (user R)     | 402 trial_available | owner: 200 / 204     | 402 trial_available       | 402 trial_available  |
 * | trial used (user Q)         | 402 trial_used      | owner: 200 / 204     | 402 trial_used            | 402 trial_used       |
 * | lapsed                      | 402 expired         | owner: 200 / 204     | 402; 200 with lapsed-read | 402 expired          |
 * | member, not a player (B)    | 404                 | 404 (not the owner)  | 200, own rows only        | 404                  |
 * | the player / owner (A)      | 201                 | 200 / 204            | 200                       | 200                  |
 * | admin, not a player (C)     | 204 no-op           | 404 (not the owner)  | 200, own rows only        | 200 (support read)   |
 *
 * A11 is `auth: "user"` (FIX-1): an owner without a membership can still anonymise or stop the public page of their
 * game; only ownership (404) gates it. The matrix rows for non-members therefore apply to the owner A.
 *
 * Skipped unless TEST_DATABASE_URL is set (CI: the `integration` job's Docker Postgres). Throwaway databases only.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { ErrorEnvelope, ok } from "@repo/contracts/http/envelope";
import { GamesListResponse } from "@repo/contracts/http/games";
import { ShareDTO } from "@repo/contracts/http/share";
import { setSharePurger } from "@/lib/services/analysis/share";
import { setShareFlag } from "@/lib/services/analysis/share-flag";
import { setLapsedReadFlag } from "@/lib/services/analysis/reader";
import { jsonOf, viewerFixture } from "../helpers/route-harness";
import { reviewWorld, type Handlers, type Who } from "../api/review-world";

const url = process.env.TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;

const NEVER_MEMBER = { member: false, entitled: false, state: "none", trial: { used: false, eligible: true } } as const;
const TRIAL_USED = { member: false, entitled: false, state: "lapsed", trial: { used: true, eligible: false }, neverPaid: true } as const;
const EXPIRED = { member: false, entitled: false, state: "lapsed", trial: { used: true, eligible: false }, neverPaid: false } as const;

type Name = "A10" | "A11 PATCH" | "A11 DELETE" | "G1" | "PR1";

describe("P3 share, archive and practice routes: authz matrix (Postgres)", { skip: url ? false : "TEST_DATABASE_URL not set" }, () => {
  const w = reviewWorld(url ?? "");
  const H = {} as Record<"share" | "shareCode" | "games" | "practice", Handlers>;
  const restores: (() => void)[] = [];
  let code = "";
  /** A key moment other than the default link's, so A10 makes a new link (201) instead of reusing it. */
  let otherMoment = 32;
  /** The key moment of the default link. */
  let codePly = 36;

  before(async () => {
    await w.setup();
    H.share = (await import("@/app/api/review/[ref]/share/route")) as Handlers;
    H.shareCode = (await import("@/app/api/share/[code]/route")) as Handlers;
    H.games = (await import("@/app/api/me/games/route")) as Handlers;
    H.practice = (await import("@/app/api/practice/context/route")) as Handlers;
    restores.push(setShareFlag(async () => true));
    restores.push(setSharePurger({ page: () => undefined, cdn: async () => undefined }));
    const { res } = await w.call(H.share, "POST", `/api/review/${w.games.done!.ref}/share`, "a", {
      params: { ref: w.games.done!.ref },
      body: {},
    });
    assert.equal(res.status, 201, await res.clone().text());
    code = ok(ShareDTO).parse(await jsonOf(res)).data.code;
    const ply = (await w.db.share.findUniqueOrThrow({ where: { code } })).ply;
    codePly = ply ?? -1;
    otherMoment = [32, 36, 40].find((p) => p !== ply)!;
  });
  after(async () => {
    for (const r of restores.reverse()) r();
    await w.teardown();
  });

  async function hit(name: Name, who: Who, init: { viewer?: ReturnType<typeof viewerFixture>; signedOut?: boolean } = {}) {
    const ref = w.games.done!.ref;
    const finished = w.games.legend!.ref;
    let out;
    switch (name) {
      case "A10":
        out = await w.call(H.share, "POST", `/api/review/${ref}/share`, who, { params: { ref }, body: { momentPly: otherMoment }, ...init });
        break;
      case "A11 PATCH":
        out = await w.call(H.shareCode, "PATCH", `/api/share/${code}`, who, { params: { code }, body: { showUsername: true }, ...init });
        break;
      case "A11 DELETE":
        out = await w.call(H.shareCode, "DELETE", `/api/share/${code}`, who, { params: { code }, ...init });
        break;
      case "G1":
        out = await w.call(H.games, "GET", "/api/me/games", who, init);
        break;
      case "PR1":
        out = await w.call(H.practice, "GET", `/api/practice/context?game=${finished}&ply=2`, who, init);
        break;
    }
    await w.runAfter(out.recorded);
    return out.res;
  }

  const lapsedA = (entitlement: typeof NEVER_MEMBER | typeof TRIAL_USED | typeof EXPIRED) =>
    viewerFixture({ id: w.users.a.id, ref: w.users.a.ref, user: { name: w.users.a.name }, entitlement });

  async function expectError(res: Response, status: number, code: string, reason?: string) {
    assert.equal(res.status, status, `${res.status} ${await res.clone().text()}`);
    const body = ErrorEnvelope.parse(await jsonOf(res));
    assert.equal(body.error.code, code);
    if (reason) assert.equal((body.error.details as { reason?: string }).reason, reason);
  }

  // DELETE last in every pass (it revokes the link the PATCH row needs).
  const NAMES: Name[] = ["A10", "A11 PATCH", "G1", "PR1", "A11 DELETE"];

  it("signed out → 401 everywhere", async () => {
    for (const name of NAMES) await expectError(await hit(name, "a", { signedOut: true }), 401, "unauthorized");
  });

  /** The routes that answer 402 to a non-member (A11 is open to any owner, see the header). */
  const PAID: Name[] = ["A10", "G1", "PR1"];

  it("never a member, trial used, lapsed → 402 with the reason (A10, G1, PR1)", async () => {
    for (const name of PAID) {
      await expectError(await hit(name, "a", { viewer: lapsedA(NEVER_MEMBER) }), 402, "subscription_required", "trial_available");
      await expectError(await hit(name, "a", { viewer: lapsedA(TRIAL_USED) }), 402, "subscription_required", "trial_used");
      await expectError(await hit(name, "a", { viewer: lapsedA(EXPIRED) }), 402, "subscription_required", "expired");
    }
  });

  it("lapsed with review-lapsed-read on: only G1 (a GET of the archive) opens; the writes and PR1 stay 402", async () => {
    const restore = setLapsedReadFlag(async () => true);
    try {
      for (const name of PAID) {
        const res = await hit(name, "a", { viewer: lapsedA(EXPIRED) });
        if (name === "G1") assert.equal(res.status, 200, await res.clone().text());
        else await expectError(res, 402, "subscription_required", "expired");
      }
    } finally {
      restore();
    }
  });

  // regression: lapsed-owner-cannot-revoke (FIX-1)
  it("an owner who is not a member (never, trial used, lapsed) can still toggle the username of their link", async () => {
    for (const entitlement of [NEVER_MEMBER, TRIAL_USED, EXPIRED]) {
      const res = await hit("A11 PATCH", "a", { viewer: lapsedA(entitlement) });
      assert.equal(res.status, 200, `${entitlement.state}: ${res.status} ${await res.clone().text()}`);
    }
  });

  it("a member who is not a player (B): 404 on A10, A11 and PR1; G1 lists only B's own (no) games", async () => {
    for (const name of ["A10", "A11 PATCH", "PR1", "A11 DELETE"] as const) await expectError(await hit(name, "b"), 404, "not_found");
    const res = await hit("G1", "b");
    assert.equal(res.status, 200);
    assert.deepEqual(GamesListResponse.parse(((await jsonOf(res)) as { data: unknown }).data), []);
  });

  it("an admin who is not a player (C): A10 is a 204 no-op, A11 404 (not the owner), G1 own rows, PR1 a support read", async () => {
    // Counted on this game only: other int files create shares in the same database at the same time.
    const ofGame = { where: { game: { referenceId: w.games.done!.ref } } };
    const before = await w.db.share.count(ofGame);
    assert.equal((await hit("A10", "c")).status, 204);
    assert.equal(await w.db.share.count(ofGame), before);
    await expectError(await hit("A11 PATCH", "c"), 404, "not_found");
    await expectError(await hit("A11 DELETE", "c"), 404, "not_found");
    const games = await hit("G1", "c");
    assert.deepEqual(GamesListResponse.parse(((await jsonOf(games)) as { data: unknown }).data), []);
    assert.equal((await hit("PR1", "c")).status, 200);
  });

  it("the opponent (D, a player of the game but not the link's owner) cannot edit A's link", async () => {
    await expectError(await hit("A11 PATCH", "d"), 404, "not_found");
    await expectError(await hit("A11 DELETE", "d"), 404, "not_found");
  });

  it("a lapsed owner can stop sharing (204), and a repeat is 204 too", async () => {
    // Its own link, so the owner's success row below keeps a live one.
    const { res } = await w.call(H.share, "POST", `/api/review/${w.games.done!.ref}/share`, "a", {
      params: { ref: w.games.done!.ref },
      body: { momentPly: [32, 36, 40].find((p) => p !== otherMoment && p !== codePly)! },
    });
    assert.equal(res.status, 201, await res.clone().text());
    const own = ok(ShareDTO).parse(await jsonOf(res)).data.code;
    for (let i = 0; i < 2; i++) {
      const out = await w.call(H.shareCode, "DELETE", `/api/share/${own}`, "a", {
        params: { code: own },
        viewer: lapsedA(EXPIRED),
      });
      await w.runAfter(out.recorded);
      assert.equal(out.res.status, 204, await out.res.clone().text());
    }
    assert.ok((await w.db.share.findUniqueOrThrow({ where: { code: own } })).revokedAt);
  });

  it("the player and owner (A) → the routes' success statuses", async () => {
    const expected: Record<Name, number> = { A10: 201, "A11 PATCH": 200, G1: 200, PR1: 200, "A11 DELETE": 204 };
    for (const name of NAMES) {
      const res = await hit(name, "a");
      assert.equal(res.status, expected[name], `${name}: ${res.status} ${await res.clone().text()}`);
    }
  });
});
