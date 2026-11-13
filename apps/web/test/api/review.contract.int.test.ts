/**
 * API contract of the P3 review routes A1–A9b against a real Postgres after `prisma migrate deploy` (phase-03 plan
 * §12.2, tasks D2/D3). Every 2xx body parses with its CT schema; every error has the envelope, its code's status and a
 * requestId (`gone` → 410, conflict reasons from CONFLICT_REASONS). Plus the gates: the 304 path is one statement,
 * GET purity (A1 on an unanalysed game and A9 create no job; 5 parallel A1/A2 on a stale QUEUED job kick exactly
 * once), the enqueue idempotency (A3 twice → one job at priority 100; regrade revives only an outdated DONE job;
 * A4 RUNNING → 409, terminal → 410), the monotonic progress merge (A5), the moment bank (A6), A7 replay, A8 headers,
 * the lazy legend facts (A2/A9) and A9b's attempts (202, 202, 202, 410).
 *
 * Skipped unless TEST_DATABASE_URL is set (CI: the `integration` job's Docker Postgres). Throwaway databases only.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { CONFLICT_REASONS } from "@repo/contracts/http/codes";
import { ErrorEnvelope, ok } from "@repo/contracts/http/envelope";
import { LegendCompareDTO } from "@repo/contracts/http/legend";
import { AnalyseResponse, CompleteOut, RetryResponse, ReviewDTO, ReviewStatusDTO } from "@repo/contracts/http/review";
import { JOB_PRIORITY } from "@repo/contracts/internal/jobs";
import { jsonOf } from "../helpers/route-harness";
import { routeStatements } from "../helpers/query-counter";
import { reviewWorld } from "./review-world";

const url = process.env.TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url; // lib/prisma (imported by the routes) reads it on first use

/** The error envelope of a non-2xx answer: the code's status, `private, no-store`, the request id, a known reason. */
async function errorOf(res: Response, status: number, code: string) {
  assert.equal(res.status, status);
  assert.equal(res.headers.get("cache-control"), "private, no-store");
  const body = ErrorEnvelope.parse(await jsonOf(res));
  assert.equal(body.error.code, code);
  assert.equal(body.error.requestId, res.headers.get("x-request-id"));
  const reason = (body.error.details as { reason?: string } | undefined)?.reason;
  if (code === "conflict") assert.ok((CONFLICT_REASONS as readonly string[]).includes(reason ?? ""), `conflict reason ${reason}`);
  return { reason, details: body.error.details };
}

describe("P3 review routes: contract (Postgres)", { skip: url ? false : "TEST_DATABASE_URL not set" }, () => {
  const w = reviewWorld(url ?? "");
  const { users, games, H, kicks, emits, call, get, runAfter, jobs } = w;

  before(() => w.setup());
  after(() => w.teardown());

  it("A1 done: 200 ReviewDTO with the viewer's moments; If-None-Match → 304 in one statement", async () => {
    const { ref } = games.done!;
    const { res, recorded } = await get(H.review, ref, "a");
    assert.equal(res.status, 200, await res.clone().text());
    assert.equal(res.headers.get("cache-control"), "private, no-cache");
    const etag = res.headers.get("etag");
    assert.match(etag ?? "", /^"r1-1-54-done-\d+-0-wp"$/);
    const dto = ok(ReviewDTO).parse(await jsonOf(res)).data;
    assert.equal(dto.status, "done");
    assert.equal(dto.you, "w");
    assert.equal(dto.players.w.isYou, true);
    assert.equal(dto.players.b.kind, "member");
    assert.equal(dto.players.b.name, users.d.name);
    assert.equal(dto.analysis?.gradedPlies, 54);
    assert.equal(dto.review?.moments.length, 3);
    assert.deepEqual(dto.review?.moments.map((m) => m.ply), [32, 36, 40]);
    assert.equal(dto.san.split(" ").length, 54);
    assert.ok(routeStatements(recorded) === 1, `200 path: ${routeStatements(recorded)} statements`);

    const again = await get(H.review, ref, "a", "", { "if-none-match": etag! });
    assert.equal(again.res.status, 304);
    assert.equal(again.res.headers.get("etag"), etag);
    assert.equal(await again.res.text(), "");
    assert.equal(routeStatements(again.recorded), 1, "the 304 path is the probe only");
  });

  it("A1: a non-player gets 404; an admin reads (the member is 'you', isYou false)", async () => {
    const { ref } = games.done!;
    const outsider = await get(H.review, ref, "b");
    assert.equal(outsider.res.status, 404);
    const admin = await get(H.review, ref, "c");
    assert.equal(admin.res.status, 200);
    const dto = ok(ReviewDTO).parse(await jsonOf(admin.res)).data;
    assert.equal(dto.you, "w");
    assert.equal(dto.players.w.isYou, false);
    assert.equal(dto.players.w.name, users.a.name);
    const unknown = await get(H.review, "cnosuchgame000000000000000", "a");
    assert.equal(unknown.res.status, 404);
  });

  it("A1 GET purity: an unanalysed game answers `none` and creates no job", async () => {
    const { id, ref } = games.none!;
    const { res, recorded } = await get(H.review, ref, "a");
    assert.equal(res.status, 200);
    const dto = ok(ReviewDTO).parse(await jsonOf(res)).data;
    assert.equal(dto.status, "none");
    assert.equal(dto.analysis, null);
    assert.equal(dto.review, null);
    await runAfter(recorded);
    assert.equal((await jobs(id)).length, 0);
  });

  it("A1 states: running, failed retryable, terminal, stalled worker (A2 reports it too), skipped", async () => {
    const running = ok(ReviewDTO).parse(await jsonOf((await get(H.review, games.running!.ref, "a")).res)).data;
    assert.equal(running.status, "running");
    assert.equal(running.analysis?.gradedPlies, 10);
    assert.equal(running.analysis?.j.length, 10);
    assert.equal(running.analysis?.evals.length, 11);
    const failed = ok(ReviewDTO).parse(await jsonOf((await get(H.review, games.failed!.ref, "a")).res)).data;
    assert.equal(failed.status, "failed");
    assert.deepEqual(
      { retryable: failed.analysis?.failure?.retryable, code: failed.analysis?.failure?.code, at: failed.analysis?.failure?.failedAtPly },
      { retryable: true, code: "engine_failed", at: 20 },
    );
    const terminal = ok(ReviewDTO).parse(await jsonOf((await get(H.review, games.terminal!.ref, "a")).res)).data;
    assert.equal(terminal.analysis?.failure?.retryable, false);
    assert.ok(terminal.analysis, "a failed job keeps the analysis skeleton");
    const stalled = ok(ReviewStatusDTO).parse(await jsonOf((await get(H.status, games.stalled!.ref, "a", "/status")).res)).data;
    assert.deepEqual({ s: stalled.analysis.status, c: stalled.analysis.code, r: stalled.analysis.retryable }, { s: "failed", c: "worker_stalled", r: true });
    const skipped = ok(ReviewDTO).parse(await jsonOf((await get(H.review, games.short!.ref, "a")).res)).data;
    assert.equal(skipped.status, "skipped");
    assert.equal(skipped.analysis, null);
  });

  it("regression: short-game-never-skipped: a finished 2-ply game left NONE (no job) reads skipped in A1 and A2; A3 409", async () => {
    const { id, ref } = games.shortNone!;
    const a1 = await get(H.review, ref, "a");
    assert.equal(a1.res.status, 200);
    const dto = ok(ReviewDTO).parse(await jsonOf(a1.res)).data;
    assert.equal(dto.status, "skipped");
    assert.equal(dto.analysis, null);
    const a2 = ok(ReviewStatusDTO).parse(await jsonOf((await get(H.status, ref, "a", "/status")).res)).data;
    assert.equal(a2.analysis.status, "skipped");
    const a3 = await call(H.analyse, "POST", `/api/review/${ref}/analyse`, "a", { params: { ref }, body: {} });
    assert.equal((await errorOf(a3.res, 409, "conflict")).reason, "skipped");
    assert.equal((await jobs(id)).length, 0);
  });

  it("A1/A2 on a QUEUED job due for > 30 s, 5 calls in parallel → exactly one kick (the CAS)", async () => {
    const { id, ref } = games.stale!;
    kicks.length = 0;
    const calls = await Promise.all([
      get(H.review, ref, "a"),
      get(H.status, ref, "a", "/status"),
      get(H.review, ref, "a"),
      get(H.status, ref, "a", "/status"),
      get(H.review, ref, "a"),
    ]);
    for (const c of calls) assert.equal(c.res.status, 200);
    const queued = ok(ReviewDTO).parse(await jsonOf(calls[0]!.res)).data;
    assert.equal(queued.status, "queued");
    assert.ok(queued.analysis?.queue, "a queued job carries the queue position");
    assert.equal(queued.analysis?.gradedPlies, 0);
    await Promise.all(calls.map((c) => runAfter(c.recorded)));
    assert.equal(kicks.length, 1, "one kick however many readers");
    assert.deepEqual(kicks[0]!.body, { v: 1, reason: "stale_queue", watch: ref });
    assert.equal(kicks[0]!.url, "http://worker.test:3003/internal/analysis/kick");
    const [job] = await jobs(id);
    assert.ok(job?.lastKickAt, "lastKickAt is set by the CAS");
  });

  // ── A2 ──────────────────────────────────────────────────────────────────────────────────────────────────────
  it("A2 done: the review summary; If-None-Match → 304 in one statement", async () => {
    const { res } = await get(H.status, games.done!.ref, "a", "/status");
    assert.equal(res.status, 200);
    const dto = ok(ReviewStatusDTO).parse(await jsonOf(res)).data;
    assert.equal(dto.analysis.status, "done");
    assert.equal(dto.review.ready, true);
    assert.equal(dto.review.momentsCount, 3);
    assert.ok(dto.review.coachLine);
    assert.equal(dto.comparison, null);
    assert.equal(dto.bank, null);
    const again = await get(H.status, games.done!.ref, "a", "/status", { "if-none-match": res.headers.get("etag")! });
    assert.equal(again.res.status, 304);
    assert.equal(routeStatements(again.recorded), 1);
  });

  it("A2 on a legend game inserts the facts once (legend_facts) and returns the summary; no job", async () => {
    const { id, ref } = games.legend2!;
    const first = await get(H.status, ref, "a", "/status");
    assert.equal(first.res.status, 200, await first.res.clone().text());
    const dto = ok(ReviewStatusDTO).parse(await jsonOf(first.res)).data;
    assert.equal(dto.comparison?.status, "facts_ready");
    assert.equal(dto.comparison?.legendName, "Morphy");
    assert.deepEqual(
      { matched: dto.comparison?.matched, compared: dto.comparison?.compared, by: dto.comparison?.divergence?.by },
      { matched: 2, compared: 3, by: "user" },
    );
    const rows = await w.db.legendComparison.findMany({ where: { gameId: id } });
    assert.equal(rows.length, 1);
    const second = await get(H.status, ref, "a", "/status", { "if-none-match": first.res.headers.get("etag")! });
    assert.equal(second.res.status, 304, "the probe sees the inserted facts row");
    assert.deepEqual((await jobs(id)).map((j) => j.kind), ["ANALYZE_GAME"]);
  });

  // ── A3 / A4 ─────────────────────────────────────────────────────────────────────────────────────────────────
  it("A3 twice on an unanalysed game → one job at USER_OPENED; kick with watch + analysis:queued", async () => {
    const { id, ref } = games.none!;
    kicks.length = 0;
    emits.length = 0;
    const first = await call(H.analyse, "POST", `/api/review/${ref}/analyse`, "a", { params: { ref }, body: {} });
    assert.equal(first.res.status, 202, await first.res.clone().text());
    const body = ok(AnalyseResponse).parse(await jsonOf(first.res)).data;
    assert.equal(body.status, "queued");
    await runAfter(first.recorded);
    const second = await call(H.analyse, "POST", `/api/review/${ref}/analyse`, "a", { params: { ref } });
    assert.equal(second.res.status, 202);
    const rows = await jobs(id);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.priority, JOB_PRIORITY.USER_OPENED);
    assert.equal(rows[0]!.status, "QUEUED");
    const g = await w.db.game.findUniqueOrThrow({ where: { id }, select: { analysisStatus: true } });
    assert.equal(g.analysisStatus, "QUEUED");
    assert.equal(kicks.length, 1);
    assert.equal((kicks[0]!.body as { watch?: string }).watch, ref);
    assert.equal((kicks[0]!.body as { reason?: string }).reason, "opened");
    const queued = emits.filter((e) => e.body.event === "analysis:queued" && e.body.data.gameRef === ref);
    assert.equal(queued.length, 1);
    assert.deepEqual(queued[0]!.body.targets.map((t) => t.userRef).sort(), [users.a.ref, users.d.ref].sort(), "both players, nobody else");
    assert.equal(queued[0]!.body.data.position, body.position);
  });

  it("A3 on a done game → 200 done; regrade revives only an outdated DONE job (attempts 0)", async () => {
    const { id, ref } = games.done!;
    const opened = await call(H.analyse, "POST", `/api/review/${ref}/analyse`, "a", { params: { ref }, body: { reason: "regrade" } });
    assert.equal(opened.res.status, 200);
    assert.equal(ok(AnalyseResponse).parse(await jsonOf(opened.res)).data.status, "done");
    assert.equal((await jobs(id))[0]!.status, "DONE");
    await w.db.gameAnalysis.update({ where: { gameId: id }, data: { version: 0 } });
    try {
      const regrade = await call(H.analyse, "POST", `/api/review/${ref}/analyse`, "a", { params: { ref }, body: { reason: "regrade" } });
      assert.equal(regrade.res.status, 202, await regrade.res.clone().text());
      const [job] = await jobs(id);
      assert.deepEqual({ status: job!.status, attempts: job!.attempts }, { status: "QUEUED", attempts: 0 });
    } finally {
      await w.db.gameAnalysis.update({ where: { gameId: id }, data: { version: 1 } });
      await w.db.job.updateMany({ where: { gameId: id }, data: { status: "DONE", attempts: 1 } });
      await w.db.game.update({ where: { id }, data: { analysisStatus: "DONE" } });
    }
  });

  it("A3: skipped → 409 skipped; terminal → 410; non-player → 404; non-player admin → 204 no-op", async () => {
    const short = await call(H.analyse, "POST", `/api/review/${games.short!.ref}/analyse`, "a", { params: { ref: games.short!.ref }, body: {} });
    assert.equal((await errorOf(short.res, 409, "conflict")).reason, "skipped");
    const terminal = await call(H.analyse, "POST", `/api/review/${games.terminal!.ref}/analyse`, "a", { params: { ref: games.terminal!.ref }, body: {} });
    await errorOf(terminal.res, 410, "gone");
    const outsider = await call(H.analyse, "POST", `/api/review/${games.legend!.ref}/analyse`, "b", { params: { ref: games.legend!.ref }, body: {} });
    await errorOf(outsider.res, 404, "not_found");
    const admin = await call(H.analyse, "POST", `/api/review/${games.legend!.ref}/analyse`, "c", { params: { ref: games.legend!.ref }, body: {} });
    assert.equal(admin.res.status, 204);
  });

  it("A4: RUNNING → 409 already_running; done → 409 not_failed; terminal → 410; failed retryable → 202 resume", async () => {
    const retry = (key: string) =>
      call(H.retry, "POST", `/api/review/${games[key]!.ref}/retry`, "a", { params: { ref: games[key]!.ref }, body: {} });
    assert.equal((await errorOf((await retry("running")).res, 409, "conflict")).reason, "already_running");
    assert.equal((await errorOf((await retry("done")).res, 409, "conflict")).reason, "not_failed");
    await errorOf((await retry("terminal")).res, 410, "gone");
    const { id, ref } = games.failed!;
    const retried = await call(H.retry, "POST", `/api/review/${ref}/retry`, "a", { params: { ref } });
    assert.equal(retried.res.status, 202, await retried.res.clone().text());
    const body = ok(RetryResponse).parse(await jsonOf(retried.res)).data;
    assert.equal(body.resumeFromPly, 20);
    const [job] = await jobs(id);
    assert.equal(job!.attempts, 1, "attempts are not reset");
    assert.ok(job!.runAt.getTime() <= Date.now() + 1_000, "runAt pulled forward");
    assert.equal((await w.db.game.findUniqueOrThrow({ where: { id } })).analysisStatus, "QUEUED");
  });

  // ── A5 / A6 / A7 / A8 ───────────────────────────────────────────────────────────────────────────────────────
  it("A5: the merge is monotonic (momentIndex, results never overwritten, attempts summed, foreign plies dropped)", async () => {
    const { ref } = games.done!;
    const at = (s: number) => new Date(Date.UTC(2026, 10, 11, 12, 0, s)).toISOString();
    const patch = (body: unknown) => call(H.progress, "PATCH", `/api/review/${ref}/progress`, "a", { params: { ref }, body });
    const first = await patch({
      momentIndex: 2,
      events: [
        { type: "attempt", ply: 32, at: at(1), uci: "b2b3", correct: false },
        { type: "attempt", ply: 32, at: at(1), uci: "b2b3", correct: false },
        { type: "attempt", ply: 32, at: at(2), uci: "d1c1", correct: true },
        { type: "revealed", ply: 36, at: at(3) },
        { type: "plan_picked", ply: 40, at: at(4), chip: "defend" },
        { type: "attempt", ply: 7, at: at(5), uci: "e2e4", correct: true },
      ],
    });
    assert.equal(first.res.status, 204, await first.res.clone().text());
    const second = await patch({
      momentIndex: 1,
      events: [
        { type: "attempt", ply: 36, at: at(6), uci: "f1f5", correct: true },
        { type: "attempt", ply: 40, at: at(7), uci: "a1a2", correct: false },
      ],
    });
    assert.equal(second.res.status, 204);
    const third = await patch({ momentIndex: 0, events: [{ type: "attempt", ply: 40, at: at(8), uci: "c3e2", correct: true }] });
    assert.equal(third.res.status, 204);
    const pr = await w.db.playerReview.findFirstOrThrow({ where: { gameId: games.done!.id, color: "w" } });
    const progress = pr.progress as { momentIndex: number; results: Record<string, string>; attempts: Record<string, number>; planChips: Record<string, string> };
    assert.equal(progress.momentIndex, 2);
    assert.deepEqual(progress.results, { "32": "FOUND_RETRY", "36": "REVEALED", "40": "FOUND_RETRY" });
    assert.deepEqual(progress.attempts, { "32": 2, "40": 2 });
    assert.deepEqual(progress.planChips, { "40": "defend" });
    assert.ok(pr.startedAt);
    const dto = ok(ReviewDTO).parse(await jsonOf((await get(H.review, ref, "a")).res)).data;
    assert.deepEqual(dto.review?.moments.map((m) => [m.ply, m.result, m.attempts]), [
      [32, "found_retry", 2],
      [36, "revealed", 0],
      [40, "found_retry", 2],
    ]);
    assert.equal(dto.review?.progress.momentIndex, 2);
    const text = await call(H.progress, "PATCH", `/api/review/${ref}/progress`, "a", {
      params: { ref },
      headers: { "content-type": "text/plain;charset=UTF-8" },
      body: { momentIndex: 3, events: [] },
    });
    assert.equal(text.res.status, 204, "a text/plain beacon body is accepted");
    const outsider = await call(H.progress, "PATCH", `/api/review/${ref}/progress`, "b", { params: { ref }, body: { momentIndex: 1, events: [] } });
    assert.equal(outsider.res.status, 404);
    const notDone = await call(H.progress, "PATCH", `/api/review/${games.running!.ref}/progress`, "a", {
      params: { ref: games.running!.ref },
      body: { momentIndex: 1, events: [] },
    });
    assert.equal((await errorOf(notDone.res, 409, "conflict")).reason, "analysis_not_done");
  });

  it("A6: bank opt-out set semantics; an unknown ply → 404", async () => {
    const { ref } = games.done!;
    const set = (ply: string, inBank: boolean) =>
      call(H.moment, "PATCH", `/api/review/${ref}/moments/${ply}`, "a", { params: { ref, ply }, body: { inBank } });
    const out = await set("36", false);
    assert.equal(out.res.status, 200, await out.res.clone().text());
    assert.deepEqual((await jsonOf(out.res)).data, { ply: 36, inBank: false, card: null });
    assert.equal((await set("36", false)).res.status, 200);
    let dto = ok(ReviewDTO).parse(await jsonOf((await get(H.review, ref, "a")).res)).data;
    assert.deepEqual(dto.review?.moments.map((m) => m.inBank), [true, false, true]);
    assert.equal((await set("36", true)).res.status, 200);
    dto = ok(ReviewDTO).parse(await jsonOf((await get(H.review, ref, "a")).res)).data;
    assert.deepEqual(dto.review?.moments.map((m) => m.inBank), [true, true, true]);
    await errorOf((await set("37", false)).res, 404, "not_found");
  });

  it("A7: completedAt once; a replay answers the same body", async () => {
    const { ref } = games.done!;
    const a = await call(H.complete, "POST", `/api/review/${ref}/complete`, "a", { params: { ref } });
    assert.equal(a.res.status, 200, await a.res.clone().text());
    const first = ok(CompleteOut).parse(await jsonOf(a.res)).data;
    const b = await call(H.complete, "POST", `/api/review/${ref}/complete`, "a", { params: { ref }, body: {} });
    const second = ok(CompleteOut).parse(await jsonOf(b.res)).data;
    assert.deepEqual(second, first);
    assert.equal(first.moments, 3);
    assert.equal(first.found, 2);
    assert.equal(first.revealed, 1);
    assert.equal(first.bestThisMonth, true);
    const early = await call(H.complete, "POST", `/api/review/${games.running!.ref}/complete`, "a", { params: { ref: games.running!.ref } });
    assert.equal((await errorOf(early.res, 409, "conflict")).reason, "analysis_not_done");
  });

  it("A8: the annotated PGN as a private, no-store attachment; 409 before done", async () => {
    const { res } = await get(H.pgn, games.done!.ref, "a", "/pgn");
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cache-control"), "private, no-store");
    assert.match(res.headers.get("content-type") ?? "", /^text\/x-chess-pgn/);
    assert.match(res.headers.get("content-disposition") ?? "", /^attachment; filename="replaychess-review-a-vs-review-d-\d{4}-\d{2}-\d{2}\.pgn"$/);
    const text = await res.text();
    assert.match(text, /\[%eval /);
    assert.match(text, /\[White "Review A"\]/);
    assert.equal((await errorOf((await get(H.pgn, games.none!.ref, "a", "/pgn")).res, 409, "conflict")).reason, "analysis_not_done");
  });

  // ── A9 / A9b ────────────────────────────────────────────────────────────────────────────────────────────────
  it("A9: the facts are inserted lazily, no job is queued, ?include=explanation adds the narration", async () => {
    const { id, ref } = games.legend!;
    const { res, recorded } = await get(H.legend, ref, "a", "/legend");
    assert.equal(res.status, 200, await res.clone().text());
    const dto = ok(LegendCompareDTO).parse(await jsonOf(res)).data;
    assert.equal(dto.status, "facts_ready");
    assert.equal(dto.legend.name, "Morphy");
    assert.equal(dto.legend.fullName, "Paul Morphy");
    assert.equal(dto.legend.year, 1858);
    assert.equal(dto.divergence?.userSan, "Ba4");
    assert.equal(dto.divergence?.legendSan, "O-O-O");
    assert.equal(dto.hasExplanation, true);
    assert.equal(dto.explanation, null);
    assert.equal(dto.players.b.kind, "bot");
    await runAfter(recorded);
    assert.deepEqual((await jobs(id)).map((j) => j.kind), ["ANALYZE_GAME"], "A9 never enqueues");
    const withText = ok(LegendCompareDTO).parse(await jsonOf((await get(H.legend, ref, "a", "/legend?include=explanation")).res)).data;
    assert.equal(withText.explanation?.segments.length, 1);
    const cached = await get(H.legend, ref, "a", "/legend", { "if-none-match": res.headers.get("etag")! });
    assert.equal(cached.res.status, 304);
    assert.equal((await get(H.legend, games.done!.ref, "a", "/legend")).res.status, 404, "no legend position → 404");
  });

  it("A9b four times → 202, 202, 202, then 410; one LEGEND_COMPARE job; already-ready → 409", async () => {
    const { id, ref } = games.legend!;
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) {
      const r = await call(H.compute, "POST", `/api/review/${ref}/legend/compute`, "a", { params: { ref }, body: {} });
      statuses.push(r.res.status);
      await runAfter(r.recorded);
    }
    assert.deepEqual(statuses, [202, 202, 202, 410]);
    const legendJobs = (await jobs(id)).filter((j) => j.kind === "LEGEND_COMPARE");
    assert.equal(legendJobs.length, 1);
    assert.equal(legendJobs[0]!.dedupeKey, `legend:${id}:${users.a.id}`);
    assert.equal(legendJobs[0]!.priority, JOB_PRIORITY.USER_OPENED);
    await w.db.legendComparison.updateMany({ where: { gameId: id }, data: { status: "READY", attempts: 1 } });
    const ready = await call(H.compute, "POST", `/api/review/${ref}/legend/compute`, "a", { params: { ref }, body: {} });
    assert.equal((await errorOf(ready.res, 409, "conflict")).reason, "already_ready");
  });

  it("rate limit: the 11th A3 in a minute → 429 with Retry-After = retryAfterSec (review-analyse, 10/60 s)", async () => {
    const ref = games.legend!.ref;
    const clerkUserId = `user_rint_rl_${w.run}`;
    const statuses: number[] = [];
    let last: Response | undefined;
    for (let i = 0; i < 11; i++) {
      // Member B is not a player: each call passes the limiter and then answers 404, so nothing is queued.
      const { res } = await call(H.analyse, "POST", `/api/review/${ref}/analyse`, "b", { params: { ref }, body: {}, realRateLimit: true, clerkUserId });
      statuses.push(res.status);
      last = res;
    }
    assert.deepEqual(statuses, [...Array(10).fill(404), 429]);
    const error = (await errorOf(last!, 429, "rate_limited")).details;
    const body = ErrorEnvelope.parse(await jsonOf((await call(H.analyse, "POST", `/api/review/${ref}/analyse`, "b", { params: { ref }, body: {}, realRateLimit: true, clerkUserId })).res));
    assert.equal(body.error.code, "rate_limited");
    assert.ok((body.error.retryAfterSec ?? 0) >= 1 && (body.error.retryAfterSec ?? 0) <= 60);
    assert.equal((error as { bucket?: string }).bucket, "review-analyse");
    await w.db.$executeRawUnsafe(`DELETE FROM rate_limit_buckets WHERE key LIKE $1`, `%${clerkUserId}%`);
  });
});
