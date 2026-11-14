// P5's final-batch extension (phase-05 plan §7.6 J1, §8.1 step 8; interface check §0.2, §0.3): the Mistake Bank
// statements of this game ride in the ONE transaction that finishes the analysis, so the cards exist when
// `analysis:done` arrives and they commit together with `game_analyses` and `player_reviews` or not at all.
//
// The rows are built in TS before the batch (`ctx.bank`, extract/extractMistakes.ts: every engine search of the line
// extension runs before planExtensions()), so `statements()` stays pure and synchronous (types.ts rules). The emit
// values (`bankAdded`, `bankDue`) are read from these statements' own rows by the analysis itself (`bankOutcome`),
// not here: `committed()` is telemetry only and is skipped after a lost response.
import { bankStatements } from "../../extract/bankStatements";
import { bankOutcome } from "../../extract/outcome";
import { EXTRACT_VERSION, JOB_MAX_ATTEMPTS, JOB_PRIORITY } from "@repo/contracts/internal/jobs";
import { stmt } from "../../db/client";
import { NOW } from "../../queue/claim";
import type { Row, Statement } from "../../db/client";
import type { FinalBatchContext, FinalBatchExtension, FinalBatchSink } from "./types";

export const p05BankExtension: FinalBatchExtension = {
  id: "p05-bank",
  statements(ctx: FinalBatchContext): Statement[] {
    if (ctx.bank) return bankStatements(ctx.bank);
    return ctx.regrade && ctx.bankReextract ? [regradeReextractStatement(ctx)] : [];
  },
  committed(ctx: FinalBatchContext, rows: readonly Row[][], sink: FinalBatchSink): void {
    const plan = ctx.bank;
    if (!plan) return;
    reportExtraction(plan, bankOutcome(plan, rows), sink);
  },
};

/**
 * A regrade's bank statement (FIX-1): the member sides' `bankVersion` back to 0 and one EXTRACT_MISTAKES job per side
 * (`regradeExtractDedupeKey`, BACKLOG priority), in the regrade's own batch, so the re-extraction is queued exactly
 * when the regrade commits. Cards are never deleted by a re-extraction: a card for a moment the regrade dropped is
 * still a real error of that game (docs/decisions.md, FIX-1).
 */
export function regradeReextractStatement(ctx: FinalBatchContext): ReturnType<typeof stmt> {
  const sides = ctx.members.filter((m) => ctx.memberSides.includes(m.color)).map((m) => m.userId);
  return stmt(
    `WITH v AS (
  UPDATE game_players SET "bankVersion" = 0
   WHERE "gameId" = $1::bigint AND "userId" = ANY($2::bigint[]) AND "bankVersion" IS DISTINCT FROM 0
  RETURNING "userId"
), j AS (
  INSERT INTO jobs (kind, "dedupeKey", priority, "fairSeq", payload, "userId", "gameId", "runAt", "maxAttempts", "createdAt")
  SELECT 'EXTRACT_MISTAKES', 'extract:' || $1::bigint || ':' || u || ':v' || $3::int || ':a' || $4::int, $5::smallint, 0,
         jsonb_build_object('v', 1, 'gameId', $1::bigint::text, 'userId', u::text), u, $1::bigint, ${NOW}, $6::smallint, ${NOW}
    FROM unnest($2::bigint[]) AS u
  ON CONFLICT ("dedupeKey") DO NOTHING
  RETURNING 1
)
SELECT (SELECT count(*) FROM v)::int AS marked, (SELECT count(*) FROM j)::int AS queued`,
    [ctx.gameId, sides, EXTRACT_VERSION, ctx.analysisVersion ?? 1, JOB_PRIORITY.BACKLOG, JOB_MAX_ATTEMPTS.EXTRACT_MISTAKES],
  );
}

/** `mistakes_extracted` per member side and the worker's extraction metrics (§10.1, §10.2). */
export function reportExtraction(
  plan: NonNullable<FinalBatchContext["bank"]>,
  outcome: ReturnType<typeof bankOutcome>,
  sink: FinalBatchSink,
): void {
  sink.telemetry.metric("distribution", "worker.extract.ms", plan.extractMs, { source: plan.source });
  sink.telemetry.metric("distribution", "worker.extract.line_searches", plan.lineSearches, { source: plan.source });
  // §10.2 `worker.extract.batch_server_ms`: the batch that carried the bank statements (one request to Neon).
  if (sink.batchMs !== undefined) sink.telemetry.metric("distribution", "worker.extract.batch_server_ms", Math.max(0, sink.batchMs), { source: plan.source });
  for (const m of plan.members) {
    sink.telemetry.metric("distribution", "worker.extract.candidates", m.candidates, { source: plan.source });
    const o = outcome.get(m.userRef);
    sink.events.capture("mistakes_extracted", m.userRef, {
      candidates: Math.min(4, m.candidates),
      puzzles: Math.min(4, m.puzzles),
      review_positions: Math.min(4, m.reviewPositions),
      cards_added: Math.min(3, o?.cardsAdded ?? 0),
      recurrences: Math.min(4, o?.recurrences ?? 0),
      extract_ms: Math.min(86_400_000, Math.round(plan.extractMs)),
      source: plan.source,
    });
  }
}
