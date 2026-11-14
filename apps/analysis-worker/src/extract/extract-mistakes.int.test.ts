// The Mistake Bank extraction against Postgres (phase-05 plan §12.2 "Worker"; the plan's WK/test/extractMistakes.int
// .test.ts): a whole ANALYZE_GAME with the FakeEngine through SqlAnalysisStore and the real `db.batch` code path, as
// role replay_worker (TEST_WORKER_DATABASE_URL after replay_worker.p5.sql), so the "no statement reads another's
// RETURNING" rule is exercised for real. Checks:
//   - the bank rows are written in P3's single final batch (one request with the analysis rows), ≤ 4 mistakes per
//     side, cards for key-moment plies only, bankVersion = 1, bankCount = the inserted cards per theme;
//   - `analysis:done` carries bankAdded / bankDue from that batch; no `mistakes:added` / `bank:due_changed` emitted;
//   - re-running is a no-op; a moment ply in `progress.bankOptOut` gets no card; the same position in a later game is
//     one mistake with 2 occurrences, `last*` moved and the card pulled to the next release; a hidden mistake gets no
//     card; a changed best move resets the card;
//   - a final batch whose response is lost after the commit: the retry finds the job DONE, the rows exist once and the
//     event carries nulls;
//   - EXTRACT_MISTAKES on an analysed game without J1: the same rows, at most one coalesced `mistakes:added` per user
//     per 60 s (fake clock); a payload with v: 2 is never claimed (it waits for a newer build), not crashed on;
//   - the training-hygiene statements as replay_worker.
// Skipped without TEST_DATABASE_URL.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { mockGradeInput } from "@repo/chess-analysis/fixtures/labels/design-mock";
import { capState } from "@repo/chess-training/caps";
import { EXTRACT_VERSION, extractMistakesDedupeKey, JOB_PRIORITY } from "@repo/contracts/internal/jobs";
import { AnalysisDoneEvent } from "@repo/contracts/socket/analysis";
import { MISTAKES_ADDED_MIN_GAP_MS } from "@repo/contracts/socket/user";
import { CountingDb, pgDriver, type Driver, type Row, type Statement } from "../db/client";
import { EnginePool } from "../engine";
import { FakeEngine } from "../engine/fake";
import { extractMistakesHandler } from "../jobs/extract-mistakes";
import { runJob, type HandlerMap } from "../jobs/runner";
import { silentLogger } from "../obs/log";
import { Metrics } from "../obs/metrics";
import { RecordingProductEvents } from "../obs/posthog";
import { RecordingTelemetry } from "../obs/telemetry";
import { analyzeGameHandler } from "../pipeline/analyze-game";
import { BatchAccumulator } from "../pipeline/batch-events";
import { OpeningBook } from "../pipeline/openings";
import { SqlAnalysisStore } from "../pipeline/sql-store";
import { claimJob } from "../queue/claim";
import { FakeClock } from "../scheduler/clock";
import {
  abandonStaleSessionsStatement,
  dropOldPlansStatement,
  pruneOldSessionsStatement,
} from "../scheduler/recurring/training-hygiene";
import { RecordingEmitter } from "../socket/emit";
import { insertJob, jobRow, makeGame, makeUser, setupInt, skipInt, type IntEnv, type TestUser } from "../testing/pg";
import { MistakesAddedCoalescer } from "./coalesce";
import { occurrencesStatement } from "./bankStatements";
import { regradeReextractStatement } from "../pipeline/final-batch/p05-bank";

const GAME_UCI = mockGradeInput("GAME").replay.uci;
const ME = "int-bank-00000001";

/** A driver that records every request (statements per round trip) and can lose one response after the commit. */
function recordingDriver(url: string) {
  const inner = pgDriver(url);
  const d = {
    requests: [] as string[][],
    loseNext: null as ((ss: readonly Statement[]) => boolean) | null,
    lost: 0,
    async run(ss: readonly Statement[], tx: boolean): Promise<Row[][]> {
      d.requests.push(ss.map((s) => s.text));
      const out = await inner.run(ss, tx);
      if (d.loseNext && d.loseNext(ss)) {
        d.loseNext = null;
        d.lost++;
        throw Object.assign(new Error("fetch failed"), { code: "ECONNRESET" });
      }
      return out;
    },
    close: () => inner.close(),
  } satisfies Driver & Record<string, unknown>;
  return d;
}

describe("Mistake Bank extraction through the real batch (Postgres)", { skip: skipInt }, () => {
  let env: IntEnv;
  let driver: ReturnType<typeof recordingDriver>;
  let db: CountingDb;

  before(async () => {
    env = await setupInt("bank");
    driver = recordingDriver(env.workerUrl);
    db = new CountingDb(driver);
  });
  after(async () => {
    await db?.close();
    await env?.close();
  });

  async function game(white: TestUser, black: TestUser, opts: { endedAgoSec?: number } = {}) {
    const g = await makeGame(env.owner, white, black, { plyCount: GAME_UCI.length, analysisStatus: "QUEUED" });
    await env.owner.query(
      `UPDATE games SET moves = $2, "plyCount" = $3, "timeClass" = 'BLITZ',
                        "completedAt" = (now() AT TIME ZONE 'UTC') - ($4::int * interval '1 second')
        WHERE id = $1`,
      [g.id, GAME_UCI.join(" "), GAME_UCI.length, opts.endedAgoSec ?? 5],
    );
    await env.owner.query(
      `UPDATE game_players gp SET result = CASE gp.color WHEN 'w' THEN 'LOSS' ELSE 'WIN' END::"PlayerResult",
              "endedAt" = g."completedAt", "opponentName" = CASE gp.color WHEN 'w' THEN 'tal_fan_77' ELSE 'knightowl_88' END
         FROM games g WHERE g.id = gp."gameId" AND gp."gameId" = $1`,
      [g.id],
    );
    return g;
  }

  function worker(opts: { bank?: boolean } = {}) {
    const clock = new FakeClock(Date.now());
    const metrics = new Metrics({ workerId: ME, bootId: "00000001", version: "0", profile: "sf18-v1" }, clock.now());
    const emitter = new RecordingEmitter();
    const events = new RecordingProductEvents();
    const bankOn = opts.bank !== false;
    const store = new SqlAnalysisStore(db, { training: bankOn });
    const fakes: FakeEngine[] = [];
    const engine = new EnginePool({
      factory: () => {
        const e = new FakeEngine();
        fakes.push(e);
        return e;
      },
      log: silentLogger,
      metrics,
    });
    const batch = new BatchAccumulator({ emitter, clock, log: silentLogger, queuedFor: (r) => store.queuedFor(r) });
    const coalescer = new MistakesAddedCoalescer({ emitter, clock, log: silentLogger });
    const book = new OpeningBook(() => store.openings(), silentLogger);
    const settings = { enabled: bankOn, lineNodes: 20_000 };
    const handlers: HandlerMap = {
      ANALYZE_GAME: analyzeGameHandler({ store, book, batch, events, bank: settings }),
      EXTRACT_MISTAKES: extractMistakesHandler({ settings, events, coalescer }),
    };
    const run = async () => {
      await engine.start();
      const job = await claimJob(db, ME, ["ANALYZE_GAME", "EXTRACT_MISTAKES"], 1);
      assert.ok(job, "a job to claim");
      return runJob(job, {
        db,
        clock,
        log: silentLogger,
        metrics,
        telemetry: new RecordingTelemetry(),
        emitter,
        me: ME,
        appEnv: "test",
        handlers,
        engine,
        evalCache: null,
        evalCacheMaxBytes: 0,
        lag: null,
        stopSignal: new AbortController().signal,
        isWatched: () => true,
        takeFault: () => null,
      });
    };
    const searches = () => fakes.reduce((n, e) => n + e.searches, 0);
    return { clock, emitter, events, run, searches, coalescer };
  }

  const analyse = (g: { id: string; ref: string }) =>
    insertJob(env, {
      gameId: g.id,
      priority: JOB_PRIORITY.GAME_ENDED,
      payload: { v: 1, gameId: g.id, gameRef: g.ref, reason: "live_end" },
    });
  const extractJob = (gameId: string, userId: string, payload?: unknown) =>
    insertJob(env, {
      kind: "EXTRACT_MISTAKES",
      priority: JOB_PRIORITY.BACKLOG,
      payload: payload ?? { v: 1, gameId, userId },
      dedupeKey: payload ? null : extractMistakesDedupeKey(gameId, userId),
      maxAttempts: 3,
    });

  async function q<T = Record<string, unknown>>(text: string, values: unknown[] = []): Promise<T[]> {
    return (await env.owner.query(text, values)).rows as T[];
  }
  const momentPlies = async (gameId: string, color: string) =>
    (
      await q<{ plies: number[] | null }>(
        `SELECT ARRAY(SELECT (m->>'ply')::int FROM jsonb_array_elements(content->'moments') m) AS plies
           FROM player_reviews WHERE "gameId" = $1 AND color = $2`,
        [gameId, color],
      )
    )[0]?.plies ?? [];
  const cardPlies = async (gameId: string, userId: string) =>
    (
      await q<{ ply: number }>(
        `SELECT mo.ply FROM mistake_occurrences mo JOIN mistakes m ON m.id = mo."mistakeId"
           JOIN training_cards c ON c."mistakeId" = m.id
          WHERE mo."gameId" = $1 AND m."userId" = $2 ORDER BY mo.ply`,
        [gameId, userId],
      )
    ).map((r) => r.ply);
  const snapshot = async (userId: string) =>
    (
      await q(
        `SELECT (SELECT count(*)::int FROM mistakes WHERE "userId" = $1) AS mistakes,
                (SELECT count(*)::int FROM mistake_occurrences mo JOIN mistakes m ON m.id = mo."mistakeId"
                  WHERE m."userId" = $1) AS occurrences,
                (SELECT count(*)::int FROM training_cards WHERE "userId" = $1) AS cards,
                (SELECT COALESCE(sum("bankCount"), 0)::int FROM theme_mastery WHERE "userId" = $1) AS "bankCount",
                (SELECT COALESCE(sum(occurrences), 0)::int FROM mistakes WHERE "userId" = $1) AS "occurrenceSum",
                (SELECT array_agg(due ORDER BY id)::text FROM training_cards WHERE "userId" = $1) AS dues`,
        [userId],
      )
    )[0]!;

  let white: TestUser;
  let black: TestUser;
  let first: { id: string; ref: string };
  let whiteMoments: number[] = [];

  it("analysing a game writes the bank rows in P3's single final batch, as replay_worker", async () => {
    white = await makeUser(env.owner, "bw");
    black = await makeUser(env.owner, "bb");
    first = await game(white, black);
    const w = worker();
    await analyse(first);
    const before = driver.requests.length;
    assert.equal(await w.run(), "done");
    const requests = driver.requests.slice(before);
    const finals = requests.filter((r) => r.some((t) => t.startsWith("INSERT INTO mistakes")));
    assert.equal(finals.length, 1, "the bank statements went out in one request");
    assert.ok(
      finals[0]!.some((t) => t.includes("INSERT INTO game_analyses")) && finals[0]!.some((t) => t.includes("SET status = 'DONE'")),
      "… the same request as the analysis rows and the DONE flag",
    );

    whiteMoments = await momentPlies(first.id, "w");
    const blackMoments = await momentPlies(first.id, "b");
    assert.ok(whiteMoments.length + blackMoments.length > 0, "the fake engine's grading has key moments");
    for (const [u, color, moments] of [
      [white, "w", whiteMoments],
      [black, "b", blackMoments],
    ] as const) {
      const m = await q<{ n: number }>(`SELECT count(*)::int AS n FROM mistakes WHERE "userId" = $1`, [u.id]);
      assert.ok(m[0]!.n <= 4, `${color}: ≤ 4 mistakes`);
      assert.ok(m[0]!.n >= moments.length, `${color}: every moment is a mistake`);
      assert.deepEqual(await cardPlies(first.id, u.id), [...moments].sort((a, b) => a - b), `${color}: cards = moments`);
      const v = await q<{ bankVersion: number }>(
        `SELECT "bankVersion" FROM game_players WHERE "gameId" = $1 AND "userId" = $2`,
        [first.id, u.id],
      );
      assert.equal(v[0]!.bankVersion, EXTRACT_VERSION);
      const tm = await q<{ ok: boolean }>(
        `SELECT bool_and(tm."bankCount" = (SELECT count(*) FROM training_cards c WHERE c."userId" = tm."userId"
                                            AND c.theme = tm.theme AND c.deck = 'BANK')) AS ok
           FROM theme_mastery tm WHERE tm."userId" = $1`,
        [u.id],
      );
      assert.notEqual(tm[0]!.ok, false, `${color}: bankCount = the cards per theme`);
    }

    const done = w.emitter.sent.filter((s) => s.event === "analysis:done");
    assert.equal(done.length, 2);
    const ev = AnalysisDoneEvent.parse(done.find((d) => d.userRefs[0] === white.ref)!.data);
    assert.deepEqual(ev.bankAdded, { count: whiteMoments.length, plies: [...whiteMoments].sort((a, b) => a - b) });
    const due = await q<{ review: number; fresh: number }>(
      `SELECT count(*) FILTER (WHERE state <> 'NEW' AND due <= (now() AT TIME ZONE 'UTC'))::int AS review,
              count(*) FILTER (WHERE state = 'NEW' AND due <= (now() AT TIME ZONE 'UTC'))::int AS fresh
         FROM training_cards WHERE "userId" = $1 AND deck = 'BANK'`,
      [white.id],
    );
    const caps = capState({ cap: 10, newPerDay: 5, bankReviewed: 0, newIntroduced: 0, dueReview: due[0]!.review, dueNew: due[0]!.fresh });
    assert.equal(ev.bankDue, caps.dueShown);
    assert.equal(w.emitter.sent.filter((s) => s.event === "mistakes:added" || s.event === "bank:due_changed").length, 0);
    assert.deepEqual(w.events.refused, []);
    assert.equal(w.events.events.filter((e) => e.event === "mistakes_extracted").length, 2);
  });

  it("re-running the extraction is a no-op", async () => {
    const before = await snapshot(white.id);
    const w = worker();
    await extractJob(first.id, white.id);
    assert.equal(await w.run(), "done");
    assert.deepEqual(await snapshot(white.id), before);
  });

  it("a moment ply in progress.bankOptOut gets no card (the mistake and occurrence still exist)", async () => {
    assert.ok(whiteMoments.length > 0, "white has a moment to opt out of");
    const optOut = whiteMoments[0]!;
    const c = await makeUser(env.owner, "ow");
    const d = await makeUser(env.owner, "ob");
    const g = await game(c, d);
    await env.owner.query(
      `INSERT INTO player_reviews ("gameId", color, content, progress, "textStatus", "createdAt", "updatedAt")
       VALUES ($1, 'w', '{"v":1}', $2::jsonb, 'PENDING', now(), now())`,
      [g.id, JSON.stringify({ v: 1, bankOptOut: [optOut] })],
    );
    const w = worker();
    await analyse(g);
    assert.equal(await w.run(), "done");
    const cards = await cardPlies(g.id, c.id);
    assert.ok(!cards.includes(optOut), `no card for the opted-out ply ${optOut}`);
    assert.deepEqual(cards, whiteMoments.filter((p) => p !== optOut).sort((a, b) => a - b));
    const occ = await q(`SELECT 1 FROM mistake_occurrences mo JOIN mistakes m ON m.id = mo."mistakeId"
                          WHERE mo."gameId" = $1 AND mo.ply = $2 AND m."userId" = $3`, [g.id, optOut, c.id]);
    assert.equal(occ.length, 1);
    const progress = await q<{ progress: { bankOptOut: number[] } }>(
      `SELECT progress FROM player_reviews WHERE "gameId" = $1 AND color = 'w'`,
      [g.id],
    );
    assert.deepEqual(progress[0]!.progress.bankOptOut, [optOut], "the analysis never touches progress");
  });

  let second: { id: string; ref: string };
  it("the same position in a later game: one mistake, 2 occurrences, last* moved, the card back at the next release", async () => {
    const opp = await makeUser(env.owner, "o2");
    await env.owner.query(
      `UPDATE training_cards SET due = (now() AT TIME ZONE 'UTC') + interval '30 days', state = 'REVIEW', reps = 2,
              "lastReview" = (now() AT TIME ZONE 'UTC') - interval '2 days' WHERE "userId" = $1`,
      [white.id],
    );
    const before = await snapshot(white.id);
    second = await game(white, opp);
    const w = worker();
    await analyse(second);
    assert.equal(await w.run(), "done");
    const after = await snapshot(white.id);
    assert.equal(after.mistakes, before.mistakes, "deduped per (user, position)");
    assert.equal(after.cards, before.cards, "no second card");
    assert.equal(after.bankCount, before.bankCount);
    const rows = await q<{ occurrences: number; lastGameId: string; pulled: boolean }>(
      `SELECT m.occurrences, m."lastGameId"::text AS "lastGameId",
              (c.due < (now() AT TIME ZONE 'UTC') + interval '2 days') AS pulled
         FROM mistakes m LEFT JOIN training_cards c ON c."mistakeId" = m.id WHERE m."userId" = $1`,
      [white.id],
    );
    for (const r of rows) {
      assert.equal(r.occurrences, 2);
      assert.equal(r.lastGameId, second.id);
    }
    const withCards = await q<{ pulled: boolean }>(
      `SELECT (c.due < (now() AT TIME ZONE 'UTC') + interval '2 days') AS pulled FROM training_cards c
        WHERE c."userId" = $1`,
      [white.id],
    );
    assert.ok(withCards.length > 0 && withCards.every((r) => r.pulled), "a recurrence brings the card back at the next release");
  });

  it("a hidden mistake gets no card", async () => {
    const hidden = (
      await q<{ id: string }>(
        `SELECT m.id::text AS id FROM mistakes m JOIN training_cards c ON c."mistakeId" = m.id WHERE m."userId" = $1
          ORDER BY m.id LIMIT 1`,
        [white.id],
      )
    )[0]!;
    await env.owner.query(`UPDATE mistakes SET "hiddenAt" = now() WHERE id = $1`, [hidden.id]);
    await env.owner.query(`DELETE FROM training_cards WHERE "mistakeId" = $1`, [hidden.id]);
    const opp = await makeUser(env.owner, "o3");
    const g = await game(white, opp);
    const w = worker();
    await analyse(g);
    assert.equal(await w.run(), "done");
    const cards = await q(`SELECT 1 FROM training_cards WHERE "mistakeId" = $1`, [hidden.id]);
    assert.equal(cards.length, 0, "the member's removal is respected");
    const occ = await q<{ occurrences: number }>(`SELECT occurrences FROM mistakes WHERE id = $1`, [hidden.id]);
    assert.equal(occ[0]!.occurrences, 3, "occurrences still count");
    second = g;
  });

  it("a changed best move resets the card to NEW", async () => {
    const card = (
      await q<{ id: string; mistakeId: string }>(
        `SELECT c.id::text AS id, c."mistakeId"::text AS "mistakeId" FROM training_cards c WHERE c."userId" = $1
          ORDER BY c.id LIMIT 1`,
        [white.id],
      )
    )[0]!;
    await env.owner.query(`UPDATE training_cards SET state = 'REVIEW', reps = 4, stability = 12, mastery = 3 WHERE id = $1`, [card.id]);
    await env.owner.query(`UPDATE mistakes SET solution = 'a1a2' WHERE id = $1`, [card.mistakeId]);
    const w = worker();
    await extractJob(second.id, white.id);
    assert.equal(await w.run(), "done");
    const after = await q<{ state: string; reps: number; stability: number; mastery: number; solution: string }>(
      `SELECT c.state::text AS state, c.reps, c.stability, c.mastery, m.solution
         FROM training_cards c JOIN mistakes m ON m.id = c."mistakeId" WHERE c.id = $1`,
      [card.id],
    );
    assert.deepEqual(
      [after[0]!.state, after[0]!.reps, after[0]!.stability, after[0]!.mastery],
      ["NEW", 0, 0, 0],
    );
    assert.notEqual(after[0]!.solution, "a1a2", "the stored solution is the engine's again");
  });

  it("a final batch whose response is lost after the commit: rows once, the job DONE, the event with nulls", async () => {
    const u = await makeUser(env.owner, "lw");
    const v = await makeUser(env.owner, "lb");
    const g = await game(u, v);
    const w = worker();
    await analyse(g);
    driver.loseNext = (ss) => ss.some((s) => s.text.startsWith("INSERT INTO mistakes"));
    const lostBefore = driver.lost;
    assert.equal(await w.run(), "done");
    assert.equal(driver.lost, lostBefore + 1, "the response was lost once");
    const job = (await q<{ status: string }>(`SELECT status::text AS status FROM ${env.schema}.jobs WHERE "gameId" = $1`, [g.id]))[0];
    assert.equal(job?.status, "DONE");
    const fresh = worker();
    await extractJob(g.id, u.id);
    const before = await snapshot(u.id);
    assert.equal(await fresh.run(), "done");
    assert.deepEqual(await snapshot(u.id), before, "the committed batch already holds every row exactly once");
    for (const d of w.emitter.sent.filter((s) => s.event === "analysis:done")) {
      const ev = AnalysisDoneEvent.parse(d.data);
      assert.equal(ev.bankAdded, null);
      assert.equal(ev.bankDue, null);
    }
  });

  it("EXTRACT_MISTAKES on games analysed without J1: the same rows, one coalesced mistakes:added per user per 60 s", async () => {
    const u = await makeUser(env.owner, "xw");
    const v = await makeUser(env.owner, "xb");
    const off = worker({ bank: false });
    const g1 = await game(u, v);
    await analyse(g1);
    assert.equal(await off.run(), "done");
    const g2 = await game(u, v);
    await analyse(g2);
    assert.equal(await off.run(), "done");
    assert.equal((await snapshot(u.id)).mistakes, 0, "J1 off: nothing extracted");
    const v0 = await q<{ bankVersion: number }>(`SELECT "bankVersion" FROM game_players WHERE "gameId" = $1 AND "userId" = $2`, [g1.id, u.id]);
    assert.equal(v0[0]!.bankVersion, 0);

    const w = worker();
    const searches0 = w.searches();
    await extractJob(g1.id, u.id);
    assert.equal(await w.run(), "done");
    await extractJob(g2.id, u.id);
    await w.clock.advance(10_000);
    assert.equal(await w.run(), "done");
    const frames = () => w.emitter.sent.filter((s) => s.event === "mistakes:added");
    const moments = await momentPlies(g1.id, "w");
    assert.deepEqual(await cardPlies(g1.id, u.id), [...moments].sort((a, b) => a - b));
    const v1 = await q<{ bankVersion: number }>(`SELECT "bankVersion" FROM game_players WHERE "gameId" = $1 AND "userId" = $2`, [g1.id, u.id]);
    assert.equal(v1[0]!.bankVersion, EXTRACT_VERSION);
    assert.ok(w.searches() - searches0 <= 4 * 6, "no pass 1: only line searches (≤ 3 + reply fallbacks per candidate)");
    assert.ok(moments.length > 0, "white has key moments in this game (cards to announce)");
    assert.equal(frames().length, 1, "the first extraction is announced at once, the second waits for the window");
    await w.clock.advance(MISTAKES_ADDED_MIN_GAP_MS);
    // The second game's positions were already in the bank: it added no card, so no second frame.
    assert.equal(frames().length, 1);
    assert.deepEqual(frames()[0]!.userRefs, [u.ref]);
    assert.equal(w.emitter.sent.filter((s) => s.event === "analysis:done").length, 0);
  });

  it("an EXTRACT_MISTAKES payload of a newer version waits for a newer build, it is never run or failed", async () => {
    const id = await extractJob(first.id, white.id, { v: 2, gameId: first.id, userId: white.id });
    // The claim skips payloads above PAYLOAD_V_MAX (readJobPayload's "newer"); the runner would release one it got.
    assert.equal(await claimJob(db, ME, ["EXTRACT_MISTAKES"], 1), null);
    const row = await jobRow(env, id);
    assert.equal(row.status, "QUEUED");
    assert.equal(row.attempts, 0);
    await env.owner.query(`DELETE FROM ${env.schema}.jobs WHERE id = $1`, [id]);
  });

  it("training hygiene runs as replay_worker", async () => {
    const u = await makeUser(env.owner, "th");
    const insert = (status: string, startedAgo: string) =>
      env.owner.query(
        `INSERT INTO training_sessions ("referenceId", "userId", kind, status, source, "filterKey", size, items, day,
                                        "startedAt")
         VALUES ('cts' || substr(md5(random()::text), 1, 22), $1, 'BANK', $2::"SessionStatus", 'hub', 'k', 1,
                 '{"v":1,"items":[]}', current_date, (now() AT TIME ZONE 'UTC') - $3::interval) RETURNING id::text AS id`,
        [u.id, status, startedAgo],
      );
    const stale = (await insert("ACTIVE", "30 hours")).rows[0]!.id as string;
    const fresh = (await insert("ACTIVE", "1 hour")).rows[0]!.id as string;
    const old = (await insert("COMPLETED", "91 days")).rows[0]!.id as string;
    await env.owner.query(
      `INSERT INTO training_days ("userId", day, plan, "updatedAt") VALUES ($1, current_date - 10, '{"v":1}', now()),
                                                                        ($1, current_date, '{"v":1}', now())`,
      [u.id],
    );
    const out = await db.batch([abandonStaleSessionsStatement(), dropOldPlansStatement(), pruneOldSessionsStatement()]);
    assert.ok(Number(out[0]![0]!.abandoned) >= 1);
    const sessions = await q<{ id: string; status: string; ended: boolean }>(
      `SELECT id::text AS id, status::text AS status, "endedAt" IS NOT NULL AS ended FROM training_sessions WHERE "userId" = $1`,
      [u.id],
    );
    assert.deepEqual(sessions.find((s) => s.id === stale), { id: stale, status: "ABANDONED", ended: true });
    assert.deepEqual(sessions.find((s) => s.id === fresh), { id: fresh, status: "ACTIVE", ended: false });
    assert.equal(sessions.find((s) => s.id === old), undefined, "deleted after 90 days");
    const days = await q<{ old: boolean; plan: unknown }>(
      `SELECT day < current_date AS old, plan FROM training_days WHERE "userId" = $1 ORDER BY day`,
      [u.id],
    );
    assert.deepEqual(days, [
      { old: true, plan: null },
      { old: false, plan: { v: 1 } },
    ]);
  });

  it("FIX-1: the same mistake again in a newer game, NOT a key moment there, still brings the card back", async () => {
    const opp = await makeUser(env.owner, "o3");
    const third = await game(white, opp);
    const [m] = await q<{ epdHash: string; cardId: string }>(
      `SELECT m."epdHash"::text AS "epdHash", c.id::text AS "cardId" FROM mistakes m JOIN training_cards c ON c."mistakeId" = m.id
        WHERE m."userId" = $1 ORDER BY m.id LIMIT 1`,
      [white.id],
    );
    await env.owner.query(`UPDATE training_cards SET due = (now() AT TIME ZONE 'UTC') + interval '30 days', "lastReview" = NULL WHERE id = $1`, [m!.cardId]);
    const due = new Date(Date.now() + 86_400_000).toISOString().replace("T", " ").replace("Z", "");
    const playedAt = new Date().toISOString().replace("T", " ").replace("Z", "");
    const st = occurrencesStatement({
      gameId: third.id,
      mistakes: [],
      occurrences: [{ userId: white.id, epdHash: m!.epdHash, gameId: third.id, ply: 11, playedAt, due, moment: false }],
      cards: [],
      days: [],
      userIds: [white.id],
      momentPlies: [],
      version: EXTRACT_VERSION,
    });
    const [rows] = await db.batch([st]);
    assert.equal(Number(rows![0]!.recurrences), 1, "counted as a recurrence");
    const [card] = await q<{ pulled: boolean }>(
      `SELECT due < (now() AT TIME ZONE 'UTC') + interval '2 days' AS pulled FROM training_cards WHERE id = $1`,
      [m!.cardId],
    );
    assert.equal(card!.pulled, true);
  });

  it("FIX-1: a regrade's statement marks the side for re-extraction and queues one EXTRACT_MISTAKES job, once, as replay_worker", async () => {
    const me = await makeUser(env.owner, "rg");
    const opp = await makeUser(env.owner, "o4");
    const g = await game(me, opp);
    await env.owner.query(`UPDATE game_players SET "bankVersion" = 1 WHERE "gameId" = $1`, [g.id]);
    const ctx = {
      gameId: g.id,
      gameRef: g.ref,
      startPly: 0,
      moves: [],
      members: [{ color: "w" as const, userId: me.id, userRef: me.ref, result: null }],
      result: {} as never,
      memberSides: ["w" as const],
      regrade: true,
      bankReextract: true,
      analysisVersion: 4,
    };
    const [first] = await db.batch([regradeReextractStatement(ctx)]);

    assert.deepEqual([Number(first![0]!.marked), Number(first![0]!.queued)], [1, 1]);
    const [again] = await db.batch([regradeReextractStatement(ctx)]);
    assert.equal(Number(again![0]!.queued), 0, "the same regrade queues nothing more");
    const jobs = await q<{ kind: string; key: string; payload: { gameId: string; userId: string } }>(
      `SELECT kind::text AS kind, "dedupeKey" AS key, payload FROM ${env.schema}.jobs WHERE "gameId" = $1 AND kind = 'EXTRACT_MISTAKES'`,
      [g.id],
    );
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0]!.key, `extract:${g.id}:${me.id}:v${EXTRACT_VERSION}:a4`);
    assert.deepEqual(jobs[0]!.payload, { v: 1, gameId: g.id, userId: me.id });
    const [gp] = await q<{ v: number }>(`SELECT "bankVersion" AS v FROM game_players WHERE "gameId" = $1 AND "userId" = $2`, [g.id, me.id]);
    assert.equal(gp!.v, 0);
  });

});
