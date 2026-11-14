// POST /api/train/attempts (phase-05 plan §7.2 W1, §7.3, §5.4): the outbox flush. Per-attempt statuses; idempotent by
// `clientAttemptId` plus the `cardReps` guard; `train-write` 120 / 60 s. After the commit (in `after()`): the server
// event `train_attempts_applied`, and `bank:due_changed` to the member's other devices only when the batch graded a
// BANK card and either a session finished or nothing is due any more (keeps OCI calls rare).
import { trainEndpoints } from "@repo/contracts/http/registry";
import { getRouteDeps } from "@/lib/api/context";
import { route } from "@/lib/api/route";
import { applyAttempts } from "@/lib/train/attempts.server";
import { captureTrainServerEvent, emitBankDueChanged } from "@/lib/train/events.server";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

export const POST = route(trainEndpoints.attempts, async (ctx) => {
  const viewer = ctx.viewer!;
  const started = performance.now();
  const out = await applyAttempts(viewer, ctx.body.attempts, ctx.now);
  const batchMs = Math.round(performance.now() - started);
  // Sentry metrics (plan §10.2): batch size, and the conflict / duplicate shares (a conflict rate above 5 % is a bug signal).
  const { telemetry } = getRouteDeps();
  telemetry.distribution("train.attempts.batch_size", out.stats.n, {});
  telemetry.distribution("train.attempts.conflicts", out.stats.conflicts, {});
  telemetry.distribution("train.attempts.duplicates", out.stats.duplicates, {});
  ctx.after(async () => {
    await captureTrainServerEvent("train_attempts_applied", { ...out.stats, batch_ms: batchMs }, viewer.ref);
    if (out.touchedBank && (out.sessionFinished || out.due.bankDue === 0)) await emitBankDueChanged(viewer.ref, out.due, ctx.now);
  });
  return out.result;
});
