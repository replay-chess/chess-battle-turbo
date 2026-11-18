/**
 * Shared bits of the Phase 6 backfills (phase-06 plan 6.6): backfill-weakness-inputs.ts (B-W1),
 * backfill-mistake-timepressure.ts (B-W2) and enqueue-weakness-recompute.ts (B-W3). They follow the Phase 4 rules
 * (./p04-common.ts: dry run by default, `--apply` writes, keyset batches of 500, idempotent predicates, the host guard
 * with BACKFILL_ALLOWED_HOSTS, the user tripwire, hosts and counts printed only) and add:
 *   - one `audit_logs` row per applied run, action `backfill.<name>` (SYSTEM), counts only;
 *   - for B-W3, ONE signed kick after the upserts, under ops' worker-only kid `opswk` (never `ops`, which the socket
 *     accepts), with kinds ["RECOMPUTE_WEAKNESS"] and a `runAt` (two identical bodies in one second would carry the same
 *     signature and the worker refuses the second as a replay), when ANALYSIS_WORKER_URL and an `opswk` key are in the
 *     shell; without them the worker takes the jobs at its next drain.
 * Stage A never runs them against Neon; stage B runs them on the dev branch, P13 on production after `migrate deploy`.
 */
import { OPS_TO_WORKER_KID, parseKeyRing, restrictKeyRing, signInternal } from "@repo/contracts/internal/auth";
import { KICK_PATH, KICK_TIMEOUT_MS, KickBodyV1 } from "@repo/contracts/internal/kick";
import { Prisma } from "@repo/db";
import { audit, type AuditMetaValue } from "../../lib/audit";
import { SeedGuardError, type BackfillDb } from "./p04-common";

export type P6BackfillName = "weakness_inputs" | "mistake_time_pressure" | "weakness_recompute";

/** One audit_logs row for an applied run (meta: counts only; never an email, a handle or a token). */
export async function recordP6Backfill(db: BackfillDb, name: P6BackfillName, meta: Record<string, AuditMetaValue>): Promise<void> {
  await audit(db, {
    category: "SYSTEM",
    action: `backfill.${name}`,
    actorKind: "SYSTEM",
    targetType: "backfill",
    targetId: name,
    meta,
  });
}

/** The post-backfill wake-up of the worker's I/O lane for RECOMPUTE_WEAKNESS. Returns a one-line outcome; never throws. */
export async function kickWeakness(
  env: Readonly<Record<string, string | undefined>> = process.env,
  fetchImpl: typeof fetch = fetch,
  nowMs: number = Date.now(),
): Promise<string> {
  const base = env.ANALYSIS_WORKER_URL?.trim();
  let ring;
  try {
    ring = restrictKeyRing(parseKeyRing(env.INTERNAL_API_SECRET), [OPS_TO_WORKER_KID]);
  } catch (err) {
    return `no kick: INTERNAL_API_SECRET does not parse (${(err as Error).message})`;
  }
  if (!base || !ring.signingKid) {
    return "no kick: ANALYSIS_WORKER_URL and an `opswk` key in INTERNAL_API_SECRET are not both set; the worker takes the jobs at its next drain";
  }
  const body = JSON.stringify(
    KickBodyV1.parse({ v: 1, reason: "backfill", kinds: ["RECOMPUTE_WEAKNESS"], runAt: new Date(nowMs).toISOString() }),
  );
  const headers = signInternal({ keys: ring, method: "POST", path: KICK_PATH, body, nowMs });
  const url = new URL(KICK_PATH, base);
  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body,
      signal: AbortSignal.timeout(KICK_TIMEOUT_MS),
    });
    return `kick → ${url.host}: HTTP ${res.status}`;
  } catch (err) {
    return `kick → ${url.host} failed (${(err as Error).name}); the worker takes the jobs at its next drain`;
  }
}

/** `--member <email>` → that member's id (the scripts' member scope); null without the flag. */
export async function memberIdsOf(db: BackfillDb, email: string | undefined): Promise<bigint[] | null> {
  if (!email) return null;
  const rows = await db.$queryRaw<{ id: bigint }[]>(Prisma.sql`SELECT id FROM users WHERE email = ${email} LIMIT 1`);
  if (!rows[0]) throw new SeedGuardError("no user with that email");
  return [rows[0].id];
}

/** The member scope as SQL on a `"userId"` column of `alias`. */
export function memberScopeSql(alias: string, userIds: readonly bigint[] | null | undefined): Prisma.Sql {
  return userIds && userIds.length > 0
    ? Prisma.sql`AND ${Prisma.raw(`${alias}."userId"`)} = ANY(${userIds.map((u) => u.toString())}::bigint[])`
    : Prisma.empty;
}
