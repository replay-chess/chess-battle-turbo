// LEGEND_COMPARE (phase-03 plan §7.7, task C6): the compare page asked for the evals at the divergence (A9b,
// `POST /api/review/[ref]/legend/compute`, priority USER_OPENED). Two searches at the pass-2 budget: the position
// after the game's move at the divergence ply and the position after the legend's move there. The member's Win%
// after each (1 decimal) goes into `legend_comparisons.facts.evalAtDivergence`, the row becomes READY and the member
// gets `compare:ready {status: "ready"}`.
//
// A facts row without a divergence (the member followed the legend) has nothing to search: it becomes READY as is.
// A row already READY (ANALYZE_GAME's pass 2 got there first) is only confirmed. After the last attempt fails, the
// row becomes FAILED and the member gets `compare:ready {status: "failed"}` (A9b allows 3 requests, then 410).
// The `engine_crash:n` test fault applies here too (dev/test only).
import { replayUci } from "@repo/chess-analysis/replay";
import { ENGINE_PROFILE } from "@repo/chess-analysis/version";
import { bandOf } from "@repo/contracts/internal/jobs";
import { parseComparisonFacts } from "@repo/db/json";
import { buildEvent } from "../socket/events";
import { evalAtDivergence, legendPosition } from "../pipeline/legend";
import { planPositions, type PositionPlan } from "../pipeline/positions";
import { Searcher } from "../pipeline/search";
import type { LegendCompareStore } from "../pipeline/store";
import { JobError, throwIfAborted, type JobHandler } from "./types";

export function legendCompareHandler(deps: { store: LegendCompareStore }): JobHandler<"LEGEND_COMPARE"> {
  return {
    kind: "LEGEND_COMPARE",
    run: (ctx) =>
      ctx.telemetry.span(
        "job.legend_compare",
        {
          kind: "LEGEND_COMPARE",
          attempt: ctx.job.attempts,
          priority: ctx.job.priority,
          band: bandOf(ctx.job.priority),
          profile: ENGINE_PROFILE.id,
        },
        async () => {
          const { gameId, userId, gameRef } = ctx.payload;
          // The one test fault that applies here (dev/test only): kill the engine before the next n searches.
          const fault = ctx.takeFault(gameRef);
          if (fault?.kind === "engine_crash") ctx.engine?.injectCrash(fault.count);
          const row = await ctx.telemetry.span("load", { kind: "LEGEND_COMPARE" }, () =>
            deps.store.loadComparison(gameId, userId),
          );
          if (!row || !row.comparison || !row.member) {
            throw new JobError("internal", "no comparison row for this game and member", { terminal: true });
          }
          const facts = parseComparisonFacts(row.comparison.facts);
          if (!facts) throw new JobError("internal", "the comparison facts do not parse", { terminal: true });
          const memberRef = row.member.userRef;
          let evals = facts.evalAtDivergence;
          const searchable = facts.divergencePly !== null && facts.legendUci !== null;
          if (row.comparison.status !== "READY" && searchable && evals === null) {
            if (!ctx.engine) throw new JobError("internal", "no engine in this worker", { terminal: true });
            const engine = ctx.engine;
            const replay = replayUci(row.startingFen, row.moves);
            const d = facts.divergencePly as number;
            const positions = planPositions(replay);
            const base = positions[d] as PositionPlan | undefined;
            const after = positions[d + 1] as PositionPlan | undefined;
            const legendPos = base ? legendPosition(base, facts.legendUci as string, replay.epds) : null;
            if (!base || !after || !legendPos) {
              throw new JobError("internal", "the divergence does not replay", { terminal: true });
            }
            const searcher = new Searcher({
              engine,
              cache: ctx.evalCache,
              lag: ctx.lag,
              signal: ctx.signal,
              fromInitial: false,
            });
            const [game, legend] = await ctx.telemetry.span("pass2", { kind: "LEGEND_COMPARE" }, async () => {
              await engine.newGame();
              const g = await searcher.evaluate(after, ENGINE_PROFILE.pass2, { pass1: false });
              throwIfAborted(ctx.signal);
              const l = await searcher.evaluate(legendPos, ENGINE_PROFILE.pass2, { pass1: false });
              return [g, l] as const;
            });
            evals = evalAtDivergence(row.member.color, game.eval, legend.eval);
            ctx.evalCache?.flush();
          }
          throwIfAborted(ctx.signal);
          await ctx.telemetry.span("write", { kind: "LEGEND_COMPARE" }, () =>
            deps.store.completeComparison({
              jobId: ctx.job.id,
              me: ctx.me,
              gameId,
              userId,
              evalAtDivergence: searchable ? evals : null,
            }),
          );
          ctx.heartbeat.noteWrite();
          await ctx.emitter.emit("compare:ready", buildEvent("compare:ready", { gameRef, status: "ready" }), [
            memberRef,
          ]);
          return "done" as const;
        },
        { transaction: true },
      ),
    async onFailed({ ctx, failed, code }) {
      ctx.telemetry.metric("count", "worker.job.fail", 1, { kind: "LEGEND_COMPARE", code });
      if (!failed || failed.status !== "FAILED") return;
      const { gameId, userId, gameRef } = ctx.payload;
      await deps.store.failComparison({ gameId, userId, error: `${code}: the evals could not be computed` });
      const row = await deps.store.loadComparison(gameId, userId).catch(() => null);
      if (row?.member) {
        await ctx.emitter.emit("compare:ready", buildEvent("compare:ready", { gameRef, status: "failed" }), [
          row.member.userRef,
        ]);
      }
    },
  };
}
