/**
 * API contract of the P3 share routes A10 / A11 and the public share read (phase-03 plan §7.2, §11.3, §12.2; task D4),
 * against a real Postgres after `prisma migrate deploy`: every 2xx body parses with ShareDTO, every error has the
 * envelope and its code's status; the masking matrix holds in the stored snapshot; an identical live link is reused
 * (200) and a different toggle or moment makes a new one (201); the Idempotency-Key replays the same code; the 21st
 * link in 24 h is 429 with the time the oldest one leaves the window; A11 recomputes only the sharer's name, bumps the
 * image version and purges (page tag now, image after the response); Stop Sharing is idempotent and the public read
 * answers `gone` afterwards; the flag `review-share` hides A10 (404) but never A11.
 *
 * Skipped unless TEST_DATABASE_URL is set (CI: the `integration` job's Docker Postgres). Throwaway databases only.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { CONFLICT_REASONS } from "@repo/contracts/http/codes";
import { ErrorEnvelope, ok } from "@repo/contracts/http/envelope";
import { ReviewDTO } from "@repo/contracts/http/review";
import { SHARE_CODE_ALPHABET, SHARE_DAILY_CAP, ShareDTO, encodeShareCode } from "@repo/contracts/http/share";
import { parseShareSnapshot } from "@repo/db/json";
import { rawDb, rawTransaction } from "@/lib/games/snapshot.server";
import { createOrReuseShare, getActiveShare, getPublicShare, setSharePurger } from "@/lib/services/analysis/share";
import { setShareFlag } from "@/lib/services/analysis/share-flag";
import { ANONYMOUS_SHARER, MASKED_OPPONENT } from "@/lib/services/analysis/share-snapshot";
import { setReviewEventSink } from "@/lib/services/analysis/telemetry";
import { jsonOf } from "../helpers/route-harness";
import { reviewWorld, type Handlers, type Who } from "./review-world";

const url = process.env.TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url; // lib/prisma (imported by the routes) reads it on first use

async function errorOf(res: Response, status: number, code: string) {
  assert.equal(res.status, status, await res.clone().text());
  assert.equal(res.headers.get("cache-control"), "private, no-store");
  const body = ErrorEnvelope.parse(await jsonOf(res));
  assert.equal(body.error.code, code);
  assert.equal(body.error.requestId, res.headers.get("x-request-id"));
  const reason = (body.error.details as { reason?: string } | undefined)?.reason;
  if (code === "conflict") assert.ok((CONFLICT_REASONS as readonly string[]).includes(reason ?? ""), `conflict reason ${reason}`);
  return body.error;
}

describe("P3 share routes: contract (Postgres)", { skip: url ? false : "TEST_DATABASE_URL not set" }, () => {
  const w = reviewWorld(url ?? "");
  const { users, games, call, runAfter } = w;
  let A10!: Handlers;
  let A11!: Handlers;
  let A1!: Handlers;
  let flagOn = true;
  const pages: string[] = [];
  const cdn: string[] = [];
  const events: { event: string; props: Record<string, unknown>; who: string }[] = [];
  const restores: (() => void)[] = [];

  before(async () => {
    await w.setup();
    A10 = (await import("@/app/api/review/[ref]/share/route")) as Handlers;
    A11 = (await import("@/app/api/share/[code]/route")) as Handlers;
    A1 = (await import("@/app/api/review/[ref]/route")) as Handlers;
    restores.push(setShareFlag(async () => flagOn));
    restores.push(
      setSharePurger({
        page: (tag) => void pages.push(tag),
        cdn: async (tag) => void cdn.push(tag),
      }),
    );
    restores.push(setReviewEventSink((event, props, who) => events.push({ event, props, who })));
    // A done review against a bot (LEGEND_BOT mode without a position: the engine's name is public).
    const bot = await w.createGame("botdone", { mode: "LEGEND_BOT", blackMember: false, analysisStatus: "DONE" });
    await w.writeAnalysis(bot.id);
    await w.writeJob(bot.id, bot.ref, { status: "DONE", attempts: 1 });
  });
  after(async () => {
    for (const r of restores.reverse()) r();
    await w.db?.share.deleteMany({ where: { ownerId: { in: Object.values(users).map((u) => u.id) } } });
    await w.teardown();
  });

  const create = (ref: string, who: Who, body: unknown = {}, headers: Record<string, string> = {}) =>
    call(A10, "POST", `/api/review/${ref}/share`, who, { params: { ref }, body, headers });
  const patch = (code: string, who: Who, showUsername: boolean) =>
    call(A11, "PATCH", `/api/share/${code}`, who, { params: { code }, body: { showUsername } });
  const revoke = (code: string, who: Who) => call(A11, "DELETE", `/api/share/${code}`, who, { params: { code } });
  const row = (code: string) => w.db.share.findUniqueOrThrow({ where: { code } });

  it("A10 with the flag off → 404 and no row", async () => {
    flagOn = false;
    try {
      const before = await w.db.share.count({ where: { ownerId: users.a.id } });
      const { res } = await create(games.done!.ref, "a");
      await errorOf(res, 404, "not_found");
      assert.equal(await w.db.share.count({ where: { ownerId: users.a.id } }), before);
    } finally {
      flagOn = true;
    }
  });

  let first!: ShareDTO;

  it("A10 → 201 ShareDTO; the snapshot masks a member opponent, shows the sharer, and carries no ref, id or clock", async () => {
    const { res, recorded } = await create(games.done!.ref, "a", { from: "complete" });
    assert.equal(res.status, 201, await res.clone().text());
    assert.equal(res.headers.get("cache-control"), "private, no-store");
    first = ok(ShareDTO).parse(await jsonOf(res)).data;
    assert.equal(res.headers.get("location"), `/api/share/${first.code}`);
    assert.match(first.code, /^[0-9a-hjkmnp-tv-z]{8}$/);
    assert.equal(first.url.endsWith(`/r/${first.code}`), true);
    assert.equal(first.imageUrl.endsWith(`/r/${first.code}/og?v=1`), true);
    assert.equal(first.showUsername, true);
    const days = (Date.parse(first.expiresAt) - Date.now()) / 86_400_000;
    assert.ok(days > 29.9 && days <= 30, `expires in ${days} days`);

    const stored = await row(first.code);
    assert.equal(stored.kind, "REVIEW");
    assert.equal(stored.ownerId, users.a.id);
    assert.equal(stored.gameId, games.done!.id);
    assert.equal(stored.color, "w");
    const snap = parseShareSnapshot(stored.snapshot);
    assert.ok(snap, "the stored snapshot parses as ShareSnapshotV1");
    assert.deepEqual(snap.players.w, { name: users.a.name, rating: 1184, isYou: true });
    assert.deepEqual(snap.players.b, { name: MASKED_OPPONENT, rating: 1203, isYou: false });
    assert.equal(snap.san.split(" ").length, 54);
    assert.equal(snap.j.length, 54);
    assert.ok(snap.moment && [32, 36, 40].includes(snap.moment.ply), `moment ${snap.moment?.ply}`);
    assert.equal(stored.ply, snap.moment!.ply);
    const text = JSON.stringify(stored.snapshot);
    for (const secret of [games.done!.ref, users.a.ref, users.d.ref, users.d.name, "@example.test"]) {
      assert.equal(text.includes(secret), false, `the public snapshot leaks ${secret}`);
    }
    // Only the ShareSnapshotV1 keys: no ids, clocks, refs or position ids anywhere.
    assert.deepEqual(Object.keys(stored.snapshot as object).sort(), [
      "accuracy", "endLabel", "evals", "gradingVersion", "j", "kind", "moment", "moves", "playedOn", "players", "result",
      "san", "startFen", "summary", "tcLabel", "v",
    ]);

    await runAfter(recorded);
    assert.deepEqual(events.at(-1), {
      event: "share_link_created",
      props: { from: "complete", show_username: true, app_env: "local" },
      who: users.a.ref,
    });
  });

  it("A10 again with the same options → 200 and the same link (reuse); no second event", async () => {
    const before = events.length;
    const { res, recorded } = await create(games.done!.ref, "a", { showUsername: true });
    assert.equal(res.status, 200);
    const again = ok(ShareDTO).parse(await jsonOf(res)).data;
    assert.equal(again.code, first.code);
    await runAfter(recorded);
    assert.equal(events.length, before);
  });

  it("A1 shows the live link in ReviewDTO.share", async () => {
    const { res } = await call(A1, "GET", `/api/review/${games.done!.ref}`, "a", { params: { ref: games.done!.ref } });
    const dto = ok(ReviewDTO).parse(await jsonOf(res)).data;
    assert.equal(dto.share?.code, first.code);
    assert.equal(dto.share?.showUsername, true);
  });

  it("the toggle off or another moment is a different link (201), masked as §11.3 says", async () => {
    const { res } = await create(games.done!.ref, "a", { showUsername: false });
    assert.equal(res.status, 201);
    const hidden = ok(ShareDTO).parse(await jsonOf(res)).data;
    assert.notEqual(hidden.code, first.code);
    const snap = parseShareSnapshot((await row(hidden.code)).snapshot)!;
    assert.deepEqual(snap.players.w, { name: ANONYMOUS_SHARER, rating: null, isYou: true });
    assert.deepEqual(snap.players.b, { name: MASKED_OPPONENT, rating: 1203, isYou: false });

    const other = await create(games.done!.ref, "a", { momentPly: 32 });
    const otherDto = ok(ShareDTO).parse(await jsonOf(other.res)).data;
    const stored = await row(otherDto.code);
    assert.equal(stored.ply, 32);
    assert.equal(parseShareSnapshot(stored.snapshot)!.moment?.ply, 32);
  });

  it("a bot opponent's name is public", async () => {
    const { res } = await create(games.botdone!.ref, "a");
    assert.equal(res.status, 201, await res.clone().text());
    const dto = ok(ShareDTO).parse(await jsonOf(res)).data;
    const snap = parseShareSnapshot((await row(dto.code)).snapshot)!;
    assert.deepEqual(snap.players.b, { name: "Engine 1400", rating: 1400, isYou: false });
  });

  it("Idempotency-Key: the same key replays the same code (Idempotent-Replayed), another body with it is 422", async () => {
    const key = randomUUID();
    const one = await create(games.done!.ref, "a", { momentPly: 36 }, { "idempotency-key": key });
    assert.ok([200, 201].includes(one.res.status));
    const a = ok(ShareDTO).parse(await jsonOf(one.res)).data;
    const two = await create(games.done!.ref, "a", { momentPly: 36, from: "complete" }, { "idempotency-key": key });
    assert.equal(two.res.status, one.res.status, "`from` is not part of the request identity");
    assert.equal(two.res.headers.get("idempotent-replayed"), "true");
    assert.equal(ok(ShareDTO).parse(await jsonOf(two.res)).data.code, a.code);
    const three = await create(games.done!.ref, "a", { momentPly: 40 }, { "idempotency-key": key });
    await errorOf(three.res, 422, "idempotency_key_reused");
  });

  it("A10 errors: a moment that is not shareable → 400; not done → 409; a non-player → 404; an admin → 204 no-op", async () => {
    const bad = await create(games.done!.ref, "a", { momentPly: 5 });
    const err = await errorOf(bad.res, 400, "validation_failed");
    assert.ok(err.fields?.momentPly);
    const notDone = await create(games.none!.ref, "a");
    await errorOf(notDone.res, 409, "conflict");
    await errorOf((await create(games.done!.ref, "b")).res, 404, "not_found");
    // Counted on this game only: other int files create shares in the same database at the same time.
    const ofGame = { where: { game: { referenceId: games.done!.ref } } };
    const before = await w.db.share.count(ofGame);
    const admin = await create(games.done!.ref, "c");
    assert.equal(admin.res.status, 204);
    assert.equal(await w.db.share.count(ofGame), before);
  });

  it("A11 PATCH: only the sharer's entry changes, the image version bumps, page purged now and image after", async () => {
    pages.length = 0;
    cdn.length = 0;
    const beforeSnap = parseShareSnapshot((await row(first.code)).snapshot)!;
    const { res, recorded } = await patch(first.code, "a", false);
    assert.equal(res.status, 200, await res.clone().text());
    const dto = ok(ShareDTO).parse(await jsonOf(res)).data;
    assert.equal(dto.code, first.code);
    assert.equal(dto.showUsername, false);
    assert.equal(dto.imageUrl.endsWith("?v=2"), true);
    const stored = await row(first.code);
    assert.equal(stored.imageVersion, 2);
    const snap = parseShareSnapshot(stored.snapshot)!;
    assert.deepEqual(snap.players.w, { name: ANONYMOUS_SHARER, rating: null, isYou: true });
    assert.deepEqual({ ...snap, players: beforeSnap.players }, beforeSnap, "everything but the names stays frozen");
    assert.deepEqual(pages, [`share:${first.code}`]);
    assert.deepEqual(cdn, []);
    await runAfter(recorded);
    assert.deepEqual(cdn, [`share:${first.code}`]);

    const back = await patch(first.code, "a", true);
    const backDto = ok(ShareDTO).parse(await jsonOf(back.res)).data;
    assert.equal(backDto.imageUrl.endsWith("?v=3"), true);
    assert.deepEqual(parseShareSnapshot((await row(first.code)).snapshot)!.players.w, {
      name: users.a.name,
      rating: 1184,
      isYou: true,
    });
  });

  it("A11 PATCH with the current value answers without a write or a purge (set semantics)", async () => {
    pages.length = 0;
    const { res } = await patch(first.code, "a", true);
    assert.equal(res.status, 200);
    assert.equal((await row(first.code)).imageVersion, 3);
    assert.deepEqual(pages, []);
  });

  it("A11 is the owner's only: the opponent, another member and an admin get 404; unknown codes 404", async () => {
    for (const who of ["d", "b", "c"] as const) {
      await errorOf((await patch(first.code, who, false)).res, 404, "not_found");
      await errorOf((await revoke(first.code, who)).res, 404, "not_found");
    }
    await errorOf((await patch("zzzzzzzz", "a", false)).res, 404, "not_found");
    await errorOf((await call(A11, "PATCH", "/api/share/BAD", "a", { params: { code: "BAD" }, body: { showUsername: true } })).res, 400, "validation_failed");
  });

  it("A11 is not flagged: an owner can turn a link off with review-share off", async () => {
    flagOn = false;
    try {
      const { res } = await patch(first.code, "a", true);
      assert.equal(res.status, 200);
    } finally {
      flagOn = true;
    }
  });

  it("the public read: ok with the frozen snapshot only; Stop Sharing → 204 twice, then gone; PATCH after → 410", async () => {
    const db = rawDb(w.db);
    const live = await getPublicShare(db, first.code);
    assert.equal(live.state, "ok");
    if (live.state === "ok") {
      assert.equal(live.imageVersion, 3);
      assert.equal(live.snapshot.players.w.name, users.a.name);
    }
    assert.deepEqual(await getPublicShare(db, "zzzzzzzz"), { state: "not_found", code: "zzzzzzzz" });
    assert.deepEqual(await getPublicShare(db, "NOT-A-CODE"), { state: "not_found", code: "NOT-A-CODE" });

    pages.length = 0;
    const one = await revoke(first.code, "a");
    assert.equal(one.res.status, 204);
    const revokedAt = (await row(first.code)).revokedAt;
    assert.ok(revokedAt);
    assert.deepEqual(pages, [`share:${first.code}`]);
    const two = await revoke(first.code, "a");
    assert.equal(two.res.status, 204);
    assert.deepEqual((await row(first.code)).revokedAt, revokedAt, "a repeat keeps the first time");
    assert.deepEqual(await getPublicShare(db, first.code), { state: "gone", code: first.code });
    await errorOf((await patch(first.code, "a", false)).res, 410, "gone");

    const active = await getActiveShare(db, w.viewerOf("a"), games.done!.ref);
    assert.notEqual(active?.code, first.code, "a revoked link is never the active one");
    await assert.rejects(() => getActiveShare(db, w.viewerOf("b"), games.done!.ref), /not_found|Not found/i);
  });

  it("an expired link: the public read is gone, PATCH is 410 and A10 makes a new one instead of reusing it", async () => {
    const { res } = await create(games.botdone!.ref, "a", { showUsername: false });
    const dto = ok(ShareDTO).parse(await jsonOf(res)).data;
    await w.db.$executeRawUnsafe(`UPDATE shares SET "expiresAt" = (now() AT TIME ZONE 'UTC') - interval '1 minute' WHERE code = $1`, dto.code);
    assert.deepEqual(await getPublicShare(rawDb(w.db), dto.code), { state: "gone", code: dto.code });
    await errorOf((await patch(dto.code, "a", true)).res, 410, "gone");
    const fresh = await create(games.botdone!.ref, "a", { showUsername: false });
    assert.equal(fresh.res.status, 201);
    assert.notEqual(ok(ShareDTO).parse(await jsonOf(fresh.res)).data.code, dto.code);
  });

  it("a colliding random code is retried with a new one", async () => {
    // No live link on this game, so the statement inserts (a reuse would never reach the code).
    await w.db.share.updateMany({ where: { gameId: games.botdone!.id, revokedAt: null }, data: { revokedAt: new Date() } });
    const taken = await w.db.share.findFirstOrThrow({ where: { ownerId: users.a.id }, select: { code: true } });
    const takenBytes = bytesOf(taken.code);
    let calls = 0;
    const out = await createOrReuseShare(rawDb(w.db), w.viewerOf("a"), games.botdone!.ref, { showUsername: true, momentPly: undefined }, {
      nowMs: Date.now(),
      transaction: rawTransaction(w.db),
      random: (n) => {
        calls += 1;
        return calls === 1 ? takenBytes : new Uint8Array(n).map((_, i) => (i * 37 + 11) & 0xff);
      },
    });
    assert.notEqual(out, "admin_noop");
    if (out !== "admin_noop") {
      assert.equal(out.status, 201);
      assert.notEqual(out.dto.code, taken.code);
    }
    assert.equal(calls, 2);
  });

  it(`the ${SHARE_DAILY_CAP + 1}st link in 24 h → 429 with Retry-After = the oldest + 24 h − now; reuse still answers`, async () => {
    const existing = await w.db.share.count({ where: { ownerId: users.a.id, kind: "REVIEW" } });
    const oldest = new Date(Date.now() - 20 * 3_600_000);
    for (let i = existing; i < SHARE_DAILY_CAP; i++) {
      await w.db.$executeRawUnsafe(
        `INSERT INTO shares (code, kind, "ownerId", "gameId", "showUsername", snapshot, "expiresAt", "createdAt")
         VALUES ($1, 'REVIEW', $2, $3, true, '{}'::jsonb, (now() AT TIME ZONE 'UTC') + interval '30 days', $4::timestamp(3))`,
        `${w.run.slice(-5)}${String(i).padStart(3, "0")}`.replace(/[^0-9a-hjkmnp-tv-z]/g, "0").slice(0, 8),
        users.a.id,
        games.none!.id,
        i === existing ? oldest.toISOString().replace("Z", "") : new Date().toISOString().replace("Z", ""),
      );
    }
    const { res } = await create(games.done!.ref, "a", { momentPly: 40, showUsername: false });
    const err = await errorOf(res, 429, "rate_limited");
    const expected = (oldest.getTime() + 86_400_000 - Date.now()) / 1000;
    assert.ok(Math.abs((err.retryAfterSec ?? 0) - expected) < 120, `retryAfterSec ${err.retryAfterSec} vs ${expected}`);
    assert.equal(res.headers.get("retry-after"), String(err.retryAfterSec));
    const reuse = await create(games.done!.ref, "a", { showUsername: false });
    assert.equal(reuse.res.status, 200, "an identical live link is reused even at the cap");
  });

  // regression: share-cap-concurrent-creates (FIX-2, review round 2). The cap counted under READ COMMITTED with no
  // lock, so creates sent at once at n = 19 all saw 19 and all inserted. Behind the per-owner advisory lock they
  // serialise: exactly enough are created to reach the cap and the rest are 429.
  it("concurrent creates at the cap's edge never go over the daily cap", async () => {
    await w.db.$executeRawUnsafe(`DELETE FROM shares WHERE "ownerId" = $1`, users.a.id);
    const filler = SHARE_DAILY_CAP - 2;
    for (let i = 0; i < filler; i++) {
      await w.db.$executeRawUnsafe(
        `INSERT INTO shares (code, kind, "ownerId", "gameId", "showUsername", snapshot, "expiresAt", "createdAt")
         VALUES ($1, 'REVIEW', $2, $3, true, '{}'::jsonb, (now() AT TIME ZONE 'UTC') + interval '30 days', now() AT TIME ZONE 'UTC')`,
        `${w.run.slice(-4)}c${String(i).padStart(3, "0")}`.replace(/[^0-9a-hjkmnp-tv-z]/g, "0").slice(0, 8),
        users.a.id,
        games.none!.id,
      );
    }
    // Four distinct links (two games × the username toggle), so none can be a reuse of another.
    const asks = [games.done!, games.botdone!].flatMap((g) => [true, false].map((showUsername) => ({ ref: g.ref, showUsername })));
    const settled = await Promise.allSettled(
      asks.map((a) =>
        createOrReuseShare(rawDb(w.db), w.viewerOf("a"), a.ref, { showUsername: a.showUsername, momentPly: undefined }, {
          nowMs: Date.now(),
          transaction: rawTransaction(w.db),
        }),
      ),
    );
    const created = settled.filter((r) => r.status === "fulfilled" && r.value !== "admin_noop" && r.value.status === 201);
    const capped = settled.filter((r) => r.status === "rejected" && /rate_limited/.test(String((r.reason as { code?: string }).code ?? r.reason)));
    assert.equal(created.length, 2, "only the two links left under the cap are created");
    assert.equal(capped.length, 2);
    assert.equal(await w.db.share.count({ where: { ownerId: users.a.id, kind: "REVIEW" } }), SHARE_DAILY_CAP);
  });
});

/** The 5 bytes an 8-character code encodes (the inverse of encodeShareCode). */
function bytesOf(code: string): Uint8Array {
  let value = 0;
  for (const ch of code) value = value * 32 + SHARE_CODE_ALPHABET.indexOf(ch);
  const out = new Uint8Array(5);
  for (let i = 4; i >= 0; i--) {
    out[i] = value % 256;
    value = Math.floor(value / 256);
  }
  assert.equal(encodeShareCode(out), code);
  return out;
}