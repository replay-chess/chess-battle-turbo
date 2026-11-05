/**
 * GET /api/cron/daily (endpoint `cron.daily`, plan §7.4 A9 and §7.8).
 *
 * Vercel cron calls it once a day (`0 4 * * *`, see vercel.json) with
 * `Authorization: Bearer ${CRON_SECRET}`. Runs the ordered task list in
 * `lib/cron/tasks/index.ts` and answers `{ data: { tasks: { [name]: { ok, ms, count? } }, durationMs } }`.
 * Anything else gets `401 unauthorized`. Never cached.
 *
 * TODO(1B·F1): move onto `route({ id: "cron.daily", auth: "cron", sideEffects: ["cron"] })`
 * once lib/api/route.ts lands; the handler body stays the same.
 */
import { randomUUID } from "node:crypto";
import { after, NextResponse } from "next/server";
import { CRON_SOFT_BUDGET_MS, CRON_TASKS, cronAuthorized, runCronTasks } from "@/lib/cron/tasks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const NO_STORE = "private, no-store";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function GET(req: Request): Promise<Response> {
  const requestId = req.headers.get("x-request-id") || randomUUID();
  const headers = { "Cache-Control": NO_STORE, "x-request-id": requestId };

  if (!cronAuthorized(req.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json(
      { error: { code: "unauthorized", message: "Unauthorized", requestId } },
      { status: 401, headers },
    );
  }

  const start = Date.now();
  const data = await runCronTasks(CRON_TASKS, {
    now: new Date(start),
    clock: Date.now,
    sleep,
    after: (fn) => after(async () => {
      await fn();
    }),
    deadlineMs: start + CRON_SOFT_BUDGET_MS,
  });

  return NextResponse.json({ data }, { status: 200, headers });
}
