// The Phase 5 backfills' pure parts (phase-05 plan 6.7): the job key the SQL builds equals extractMistakesDedupeKey,
// the payload carries the ids as decimal strings, priority BACKLOG and three attempts; --member parsing; the card the
// repair tool rebuilds equals the worker's (item key from the position hash, due at the next local release); the kick
// is skipped without ANALYSIS_WORKER_URL and an `opswk` key and is signed with `opswk` when both are set.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { randomBytes } from "node:crypto";
import { mistakeItemKey } from "@repo/chess-training/items";
import { nextRelease } from "@repo/chess-training/release";
import { HEADER_KID } from "@repo/contracts/internal/auth";
import { EXTRACT_VERSION, JOB_MAX_ATTEMPTS, JOB_PRIORITY } from "@repo/contracts/internal/jobs";
import { enqueueBatchSql, spotCheckPasses, splitMemberArg } from "./enqueue-mistake-extraction";
import { kickExtraction } from "./p05-common";
import { cardFor, insertCardsSql } from "./rebuild-cards";
import { driftSql, recountSql } from "./recount-bank-themes";

describe("enqueue-mistake-extraction", () => {
  it("builds the job exactly as the contract says", () => {
    const sql = enqueueBatchSql({ gameId: 0n, userId: 0n }, 500);
    assert.match(sql.text, /'EXTRACT_MISTAKES'/);
    assert.match(sql.text, /'extract:' \|\| b."gameId" \|\| ':' \|\| b."userId" \|\| ':v' \|\| \$\d+::int/);
    assert.match(sql.text, /jsonb_build_object\('v', 1, 'gameId', b."gameId"::text, 'userId', b."userId"::text\)/);
    assert.match(sql.text, /ON CONFLICT \("dedupeKey"\) DO NOTHING/);
    assert.match(sql.text, /row_number\(\) OVER \(PARTITION BY b."userId"/);
    assert.ok(sql.values.includes(JOB_PRIORITY.BACKLOG));
    assert.ok(sql.values.includes(JOB_MAX_ATTEMPTS.EXTRACT_MISTAKES));
    assert.ok(sql.values.includes(EXTRACT_VERSION));
    assert.match(sql.text, /g."analysisStatus" = 'DONE' AND gp."bankVersion" < \$\d+/);
  });

  it("--member takes an email; anything else is refused", () => {
    assert.deepEqual(splitMemberArg(["--apply", "--member", "a@b.test"]), { rest: ["--apply"], member: "a@b.test" });
    assert.deepEqual(splitMemberArg(["--apply"]), { rest: ["--apply"], member: undefined });
    assert.throws(() => splitMemberArg(["--member"]), /needs an email/);
    assert.throws(() => splitMemberArg(["--member", "--apply"]), /needs an email/);
  });

  it("a spot check passes only with every occurrence and every expected card", () => {
    assert.equal(spotCheckPasses([{ gameId: "1", userId: "2", moments: 3, occurrences: 3, cardsExpected: 2, cards: 2 }]), true);
    assert.equal(spotCheckPasses([{ gameId: "1", userId: "2", moments: 3, occurrences: 2, cardsExpected: 2, cards: 2 }]), false);
    assert.equal(spotCheckPasses([{ gameId: "1", userId: "2", moments: 3, occurrences: 3, cardsExpected: 2, cards: 1 }]), false);
  });
});

describe("rebuild-cards", () => {
  it("rebuilds the card the worker would have made", () => {
    const now = new Date("2026-11-12T19:00:00.000Z");
    const epd = -6917529027641081856n;
    const card = cardFor({ userId: 7n, mistakeId: 9n, epdHash: epd, isPuzzle: false, timeZone: "Asia/Kolkata", releaseHour: 8 }, now);
    assert.deepEqual(card, {
      userId: "7",
      mistakeId: "9",
      kind: "REVIEW_POSITION",
      itemKey: mistakeItemKey(epd),
      due: nextRelease(now, "Asia/Kolkata", 8).toISOString().replace("T", " ").replace("Z", ""),
    });
    assert.equal(cardFor({ userId: 7n, mistakeId: 9n, epdHash: 1n, isPuzzle: true, timeZone: null, releaseHour: null }, now).kind, "MISTAKE");
  });

  it("inserts idempotently and counts the inserted cards only", () => {
    const sql = insertCardsSql([]);
    assert.match(sql.text, /ON CONFLICT \("userId", "itemKey"\) DO NOTHING/);
    assert.match(sql.text, /"hiddenAt" IS NULL/);
    assert.match(sql.text, /FROM ins GROUP BY 1, 2/);
  });
});

describe("recount-bank-themes", () => {
  it("the dry run reads, the apply writes only drifted rows", () => {
    assert.doesNotMatch(driftSql(0n, 500).text, /INSERT|UPDATE/);
    const apply = recountSql(0n, 500).text;
    assert.match(apply, /IS DISTINCT FROM EXCLUDED."bankCount"/);
    assert.match(apply, /SET "bankCount" = 0/);
  });
});

describe("kickExtraction", () => {
  const k = () => randomBytes(32).toString("base64");

  it("is skipped without a worker URL or an opswk key", async () => {
    assert.match(await kickExtraction({}), /no kick/);
    assert.match(await kickExtraction({ ANALYSIS_WORKER_URL: "http://127.0.0.1:3003", INTERNAL_API_SECRET: `web:${k()}` }), /no kick/);
  });

  it("signs with opswk and names the EXTRACT_MISTAKES lane", async () => {
    let seen: { url: string; headers: Record<string, string>; body: string } | null = null;
    const fetchImpl = (async (url: URL, init: RequestInit) => {
      seen = { url: String(url), headers: init.headers as Record<string, string>, body: String(init.body) };
      return new Response(null, { status: 202 });
    }) as unknown as typeof fetch;
    const out = await kickExtraction(
      { ANALYSIS_WORKER_URL: "http://127.0.0.1:3003", INTERNAL_API_SECRET: `opswk:${k()}` },
      fetchImpl,
      Date.UTC(2026, 10, 12),
    );
    assert.equal(out, "kick → 127.0.0.1:3003: HTTP 202");
    const s = seen as unknown as { url: string; headers: Record<string, string>; body: string };
    assert.match(s.url, /\/internal\/analysis\/kick$/);
    assert.deepEqual(JSON.parse(s.body), { v: 1, reason: "backfill", kinds: ["EXTRACT_MISTAKES"] });
    assert.equal(s.headers[HEADER_KID], "opswk", "ops' worker-only kid signs it, never `ops`");
  });
});
