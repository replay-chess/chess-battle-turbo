// P6's final-batch extension (phase-06 plan §7.4.1, §8.3.2, §13 WP4; interface check §0.3): two set-based statements
// in the ONE transaction that finishes an analysis (types.ts rules: idempotent, only granted columns, pure builder):
//
//   - the five weakness input columns of every member side (`stats`, `errorThemes`, `errorLog`, `errorThemeN`,
//     `weaknessInputsV`), computed in TS before the batch from the very arrays it writes (CA computeSideInputs; the
//     regrade refreshes them too, its judgements can change), so the profile never reads inputs of an older grading;
//   - the `analysis` trigger: the RECOMPUTE_WEAKNESS row of each member whose scope holds this game and who has a
//     READY profile (checked in SQL, inside this transaction) is armed at now + 240 s, coalesced (@repo/db/
//     weakness-jobs). Members without a READY profile are the progress emitter's after the commit (`first_build`).
//
// A resend after a lost response fails on the batch's lock guard and rolls back (sql-store.ts), so both run once.
import { analysisTriggerStatement, coalescedOf } from "../../weakness/triggers";
import { sideInputsUpdateStatement } from "../../weakness/inputs";
import type { Statement } from "../../db/client";
import type { FinalBatchContext, FinalBatchExtension } from "./types";

export const p06WeaknessExtension: FinalBatchExtension = {
  id: "p06-weakness",
  statements(ctx: FinalBatchContext): Statement[] {
    const plan = ctx.weakness;
    if (!plan || !plan.settings.enabled) return [];
    const out: Statement[] = [];
    if (plan.sides.length > 0) out.push(sideInputsUpdateStatement(plan.sides));
    const trigger = analysisTriggerStatement(plan.inScope, plan.settings);
    if (trigger) out.push(trigger);
    return out;
  },
  committed(ctx, rows, sink) {
    const plan = ctx.weakness;
    if (!plan || !plan.settings.enabled || !analysisTriggerStatement(plan.inScope, plan.settings)) return;
    // §10.2 `worker.weakness.coalesced`: the `analysis` trigger met the member's existing row (QUEUED, RUNNING or DONE).
    const n = coalescedOf(rows[plan.sides.length > 0 ? 1 : 0]);
    if (n > 0) sink.telemetry.metric("count", "worker.weakness.coalesced", n, { trigger: "analysis" });
  },
};
