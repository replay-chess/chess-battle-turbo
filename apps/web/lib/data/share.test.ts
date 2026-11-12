// The share DAL's rules (phase-03 plan §12.1 `WEB/lib/data/share.test.ts`): the §11.3 masking matrix (member, bot,
// external and legend opponents × the username toggle, both colours), the code alphabet and length, the reuse rule
// as written in the one A10 statement, expiry and revocation on the public read, the daily cap's retry time, the
// username toggle that rewrites only the sharer, and the purge order. The SQL itself runs in
// test/api/share.contract.int.test.ts.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { reviewFixture } from "@repo/contracts/http/fixtures/review";
import type { PlayerCard, ReviewDTO } from "@repo/contracts/http/review";
import { SHARE_CODE_ALPHABET, SHARE_CODE_LENGTH, SHARE_DAILY_CAP, ShareCode, encodeShareCode } from "@repo/contracts/http/share";
import { ShareSnapshotV1 } from "@repo/db/json";
import type { Prisma } from "@repo/db";
import { isApiError } from "@/lib/api/api-error";
import type { GamesDb } from "@/lib/games/snapshot.server";
import {
  dailyCapRetryAfterSec,
  getPublicShare,
  purgeShare,
  revokeShare,
  setSharePurger,
  shareCreateIdentity,
  shareDtoOf,
  updateShare,
} from "@/lib/services/analysis/share";
import { createShareSql } from "@/lib/services/analysis/share-sql";
import {
  ANONYMOUS_SHARER,
  MASKED_OPPONENT,
  UnknownMomentError,
  buildReviewSnapshot,
  shareablePlies,
  snapshotPlayers,
  withSharerName,
  worstMoment,
} from "@/lib/services/analysis/share-snapshot";

const done = reviewFixture("done");
const clean = reviewFixture("clean");
const textOf = (sql: Prisma.Sql) => sql.strings.join("?").replace(/\s+/g, " ");

function withOpponent(dto: ReviewDTO, kind: PlayerCard["kind"], name = "tal_fan_77"): ReviewDTO {
  const opp = dto.you === "w" ? "b" : "w";
  return { ...dto, players: { ...dto.players, [opp]: { ...dto.players[opp], kind, name, rating: 1203 } } };
}

/** A fake GamesDb answering each statement in order (and recording them). */
function fakeDb(answers: unknown[][]): GamesDb & { seen: Prisma.Sql[] } {
  const seen: Prisma.Sql[] = [];
  return {
    seen,
    $queryRaw: async <T>(sql: Prisma.Sql) => {
      seen.push(sql);
      if (answers.length === 0) throw new Error(`unexpected statement: ${textOf(sql).slice(0, 80)}`);
      return answers.shift() as T;
    },
    $executeRaw: async () => {
      throw new Error("no executeRaw expected");
    },
  };
}

describe("§11.3 masking matrix", () => {
  const kinds: PlayerCard["kind"][] = ["member", "bot", "external", "legend"];
  for (const kind of kinds) {
    for (const showUsername of [true, false]) {
      it(`${kind} opponent, Show My Username ${showUsername ? "on" : "off"}`, () => {
        const dto = withOpponent(done, kind);
        const snap = ShareSnapshotV1.parse(buildReviewSnapshot(dto, { showUsername }));
        const me = snap.players[dto.you];
        const them = snap.players[dto.you === "w" ? "b" : "w"];
        if (showUsername) assert.deepEqual(me, { name: dto.players[dto.you].name, rating: dto.players[dto.you].rating, isYou: true });
        else assert.deepEqual(me, { name: ANONYMOUS_SHARER, rating: null, isYou: true });
        if (kind === "member") assert.deepEqual(them, { name: MASKED_OPPONENT, rating: 1203, isYou: false });
        else assert.deepEqual(them, { name: "tal_fan_77", rating: 1203, isYou: false });
      });
    }
  }

  it("follows the sharer's colour (Black)", () => {
    const black: ReviewDTO = { ...done, you: "b", players: { w: { ...done.players.b, isYou: false }, b: { ...done.players.w, isYou: true } } };
    const players = snapshotPlayers(black, false);
    assert.deepEqual(players.b, { name: ANONYMOUS_SHARER, rating: null, isYou: true });
    assert.equal(players.w.name, MASKED_OPPONENT);
  });

  it("never carries a ref, an id, a clock or a share block (only ShareSnapshotV1's keys)", () => {
    const snap = buildReviewSnapshot(reviewFixture("done", { shared: true }), { showUsername: true });
    assert.deepEqual(Object.keys(snap).sort(), Object.keys(ShareSnapshotV1.shape).sort());
    const text = JSON.stringify(snap);
    assert.equal(text.includes(done.ref), false);
    assert.equal(text.includes("clocks"), false);
    assert.equal(snap.playedOn, done.game.playedAt.slice(0, 10));
  });

  it("the username toggle rewrites only the sharer's entry; names longer than 40 are cut", () => {
    const snap = buildReviewSnapshot(withOpponent(done, "bot", "Engine 1400"), { showUsername: false });
    const on = withSharerName(snap, done.you, { name: "x".repeat(60), rating: 1500 }, true);
    assert.deepEqual(on.players[done.you], { name: "x".repeat(40), rating: 1500, isYou: true });
    assert.deepEqual({ ...on, players: snap.players }, snap);
    assert.deepEqual(withSharerName(on, done.you, { name: "y", rating: 1 }, false).players[done.you], {
      name: ANONYMOUS_SHARER,
      rating: null,
      isYou: true,
    });
  });
});

describe("the card's moment", () => {
  it("defaults to the worst moment (largest Win% drop), takes a chosen moment, rejects a ply that is not shareable", () => {
    const moments = done.review!.moments;
    const worst = worstMoment(moments)!;
    assert.ok(moments.every((m) => m.winBefore - m.winAfter <= worst.winBefore - worst.winAfter));
    assert.equal(buildReviewSnapshot(done, { showUsername: true }).moment?.ply, worst.ply);
    const chosen = buildReviewSnapshot(done, { showUsername: true, momentPly: moments[0]!.ply }).moment!;
    assert.equal(chosen.ply, moments[0]!.ply);
    assert.equal(chosen.playedSan, moments[0]!.playedSan);
    assert.deepEqual(chosen.arrow, [moments[0]!.bestUci.slice(0, 2), moments[0]!.bestUci.slice(2, 4)]);
    assert.equal(chosen.caption, moments[0]!.why[0]!.t.slice(0, 200));
    assert.throws(() => buildReviewSnapshot(done, { showUsername: true, momentPly: 1 }), UnknownMomentError);
  });

  it("a clean game shows its best decision (the played move), or a chosen ply equal to it", () => {
    const review = clean.review!;
    assert.deepEqual(shareablePlies(clean), [review.bestPly]);
    const m = buildReviewSnapshot(clean, { showUsername: true }).moment!;
    assert.equal(m.ply, review.bestPly);
    assert.equal(m.playedSan, m.bestSan);
    assert.equal(m.caption, review.bestDecision);
    const uci = clean.moves.split(" ")[review.bestPly!]!;
    assert.deepEqual(m.arrow, [uci.slice(0, 2), uci.slice(2, 4)]);
  });

  it("a review that is not done cannot be shared", () => {
    assert.throws(() => buildReviewSnapshot(reviewFixture("running"), { showUsername: true }), /not done/);
  });
});

describe("codes", () => {
  it(`${SHARE_CODE_LENGTH} chars of Crockford base32, lowercase, no i/l/o/u, 40 random bits`, () => {
    assert.equal(SHARE_CODE_ALPHABET.length, 32);
    for (const ch of "ilou") assert.equal(SHARE_CODE_ALPHABET.includes(ch), false, ch);
    for (let i = 0; i < 2_000; i++) {
      const bytes = new Uint8Array(5).map(() => Math.floor(Math.random() * 256));
      const code = encodeShareCode(bytes);
      assert.equal(code.length, SHARE_CODE_LENGTH);
      assert.ok(ShareCode.safeParse(code).success, code);
    }
    assert.equal(encodeShareCode(new Uint8Array(5)), "00000000");
    assert.equal(encodeShareCode(new Uint8Array(5).fill(255)), "zzzzzzzz");
  });
});

describe("the A10 statement (reuse rule and daily cap)", () => {
  const sql = createShareSql({ ownerId: 1n, gameId: 2n, ply: 36, color: "w", showUsername: true, snapshot: "{}", code: "8kq2xh4m" });
  const text = textOf(sql);

  it("reuses only a live REVIEW link of the same owner, game, toggle and moment, newest first", () => {
    const reuse = /reuse AS \((.*?)\), ins AS/.exec(text)?.[1] ?? "";
    for (const part of [
      `"ownerId" = ?`,
      `kind = 'REVIEW'`,
      `"gameId" = ?`,
      `"revokedAt" IS NULL`,
      `"expiresAt" > (now() AT TIME ZONE 'UTC')`,
      `"showUsername" = ?`,
      `ply IS NOT DISTINCT FROM ?::smallint`,
      `ORDER BY "createdAt" DESC LIMIT 1`,
    ]) {
      assert.ok(reuse.includes(part), `reuse needs ${part}`);
    }
  });

  it(`inserts only without a reusable link and under the cap of ${SHARE_DAILY_CAP} per 24 h (revoked links count)`, () => {
    const cap = /cap AS \((.*?)\), reuse AS/.exec(text)?.[1] ?? "";
    assert.ok(cap.includes(`"createdAt" > (now() AT TIME ZONE 'UTC') - interval '1 day'`));
    assert.equal(cap.includes("revokedAt"), false);
    assert.ok(text.includes("WHERE NOT EXISTS (SELECT 1 FROM reuse) AND (SELECT n FROM cap) < ?"));
    assert.ok(sql.values.includes(SHARE_DAILY_CAP));
    assert.ok(text.includes("ON CONFLICT (code) DO NOTHING"));
    assert.ok(text.includes(`+ (?::int * interval '1 day')`), "expiresAt = now + 30 days, in UTC");
  });

  it("the request identity is the toggle and the moment (not `from`)", () => {
    assert.deepEqual(shareCreateIdentity({ showUsername: true, momentPly: undefined }), { showUsername: true, momentPly: null });
    assert.deepEqual(shareCreateIdentity({ showUsername: false, momentPly: 36 }), { showUsername: false, momentPly: 36 });
  });

  it("retryAfterSec at the cap = the oldest link in the window + 24 h − now, at least 1 s", () => {
    const now = new Date("2026-11-11T12:00:00Z");
    assert.equal(dailyCapRetryAfterSec(new Date("2026-11-10T15:00:00Z"), now), 3 * 3600);
    assert.equal(dailyCapRetryAfterSec(new Date("2026-11-10T11:59:59Z"), now), 1);
  });
});

describe("ShareDTO", () => {
  it("absolute page and image URLs, the image versioned by ?v=", () => {
    const dto = shareDtoOf(
      { code: "8kq2xh4m", expiresAt: new Date("2026-12-11T12:00:00Z"), showUsername: false, imageVersion: 3 },
      "https://dev.example.test",
    );
    assert.deepEqual(dto, {
      code: "8kq2xh4m",
      url: "https://dev.example.test/r/8kq2xh4m",
      imageUrl: "https://dev.example.test/r/8kq2xh4m/og?v=3",
      expiresAt: "2026-12-11T12:00:00.000Z",
      showUsername: false,
    });
  });
});

describe("the public read (expiry, revocation, kind)", () => {
  const snapshot = buildReviewSnapshot(done, { showUsername: true });
  const base = { snapshot, kind: "REVIEW", expiresAt: new Date("2026-12-01T00:00:00Z"), revokedAt: null, imageVersion: 2, live: true };

  it("ok: the snapshot, the image version and the expiry as plain data (ISR-cacheable)", async () => {
    const out = await getPublicShare(fakeDb([[base]]), "8kq2xh4m");
    assert.deepEqual(out, { state: "ok", code: "8kq2xh4m", snapshot, imageVersion: 2, expiresAt: "2026-12-01T00:00:00.000Z" });
  });

  it("gone: expired or revoked (live false), a POSITION share, an unreadable snapshot", async () => {
    for (const row of [{ ...base, live: false }, { ...base, kind: "POSITION" }, { ...base, snapshot: { v: 9 } }]) {
      assert.deepEqual(await getPublicShare(fakeDb([[row]]), "8kq2xh4m"), { state: "gone", code: "8kq2xh4m" });
    }
  });

  it("not_found: an unknown code, and a malformed code without any query", async () => {
    assert.deepEqual(await getPublicShare(fakeDb([[]]), "8kq2xh4m"), { state: "not_found", code: "8kq2xh4m" });
    const db = fakeDb([]);
    assert.deepEqual(await getPublicShare(db, "../etc"), { state: "not_found", code: "../etc" });
    assert.equal(db.seen.length, 0);
  });
});

describe("A11", () => {
  const viewer = { id: 7n, role: "user" as const };
  const snapshot = buildReviewSnapshot(withOpponent(done, "bot", "Engine 1400"), { showUsername: true });
  const owned = {
    code: "8kq2xh4m",
    expiresAt: new Date("2026-12-01T00:00:00Z"),
    showUsername: true,
    imageVersion: 1,
    snapshot,
    revokedAt: null,
    color: done.you,
    live: true,
    youName: "knightowl_88",
    ratingBefore: 1184,
  };

  it("PATCH: not the owner → 404; revoked or expired → 410; the same value → no write", async () => {
    await assert.rejects(() => updateShare(fakeDb([[]]), viewer, "8kq2xh4m", false), (e) => isApiError(e) && e.code === "not_found");
    await assert.rejects(
      () => updateShare(fakeDb([[{ ...owned, live: false }]]), viewer, "8kq2xh4m", false),
      (e) => isApiError(e) && e.code === "gone",
    );
    const same = fakeDb([[owned]]);
    const out = await updateShare(same, viewer, "8kq2xh4m", true);
    assert.equal(out.changed, false);
    assert.equal(same.seen.length, 1, "set semantics: no UPDATE");
  });

  it("PATCH: writes the recomputed snapshot at the version it read and answers the bumped image", async () => {
    const db = fakeDb([[owned], [{ ...owned, showUsername: false, imageVersion: 2 }]]);
    const out = await updateShare(db, viewer, "8kq2xh4m", false);
    assert.equal(out.changed, true);
    assert.ok(out.dto.imageUrl.endsWith("?v=2"));
    const update = db.seen[1]!;
    assert.match(textOf(update), /"imageVersion" = "imageVersion" \+ 1/);
    assert.match(textOf(update), /"revokedAt" IS NULL AND "expiresAt" > \(now\(\) AT TIME ZONE 'UTC'\) AND "imageVersion" = \?::smallint/);
    const written = ShareSnapshotV1.parse(JSON.parse(update.values.find((v) => typeof v === "string" && v.startsWith("{")) as string));
    assert.deepEqual(written.players[done.you], { name: ANONYMOUS_SHARER, rating: null, isYou: true });
    assert.deepEqual(written.players[done.you === "w" ? "b" : "w"], snapshot.players[done.you === "w" ? "b" : "w"]);
  });

  it("PATCH racing a revoke: the guarded UPDATE matches nothing and the re-read answers 410", async () => {
    const db = fakeDb([[owned], [], [{ ...owned, live: false, revokedAt: new Date() }]]);
    await assert.rejects(() => updateShare(db, viewer, "8kq2xh4m", false), (e) => isApiError(e) && e.code === "gone");
  });

  it("DELETE: 404 for a code the viewer does not own; otherwise idempotent", async () => {
    await assert.rejects(() => revokeShare(fakeDb([[]]), viewer, "8kq2xh4m"), (e) => isApiError(e) && e.code === "not_found");
    const db = fakeDb([[{ code: "8kq2xh4m" }]]);
    await revokeShare(db, viewer, "8kq2xh4m");
    assert.match(textOf(db.seen[0]!), /"revokedAt" = COALESCE\("revokedAt", \(now\(\) AT TIME ZONE 'UTC'\)\)/);
  });

  it("the purge: the page tag inside the request, the image's CDN copy after the response", async () => {
    const calls: string[] = [];
    const restore = setSharePurger({ page: (tag) => void calls.push(`page:${tag}`), cdn: async (tag) => void calls.push(`cdn:${tag}`) });
    try {
      const later: (() => unknown)[] = [];
      purgeShare({ after: (task) => void later.push(task) }, "8kq2xh4m");
      assert.deepEqual(calls, ["page:share:8kq2xh4m"]);
      for (const task of later) await task();
      assert.deepEqual(calls, ["page:share:8kq2xh4m", "cdn:share:8kq2xh4m"]);
    } finally {
      restore();
    }
  });
});
