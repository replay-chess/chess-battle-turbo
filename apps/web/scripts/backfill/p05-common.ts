/**
 * Shared bits of the Phase 5 backfills (phase-05 plan 6.7): enqueue-mistake-extraction.ts (B-M5-1),
 * recount-bank-themes.ts (B-M5-2) and rebuild-cards.ts (the card repair). They follow the Phase 4 rules
 * (./p04-common.ts: dry run by default, `--apply` writes, keyset batches of 500, idempotent predicates, the host guard
 * with BACKFILL_ALLOWED_HOSTS, the user tripwire, hosts and counts printed only) and add:
 *   - one `audit_logs` row per applied run, action `backfill.<name>` (SYSTEM);
 *   - for B-M5-1, ONE signed kick after the inserts, under ops' worker-only kid `opswk` (never `ops`, which the socket
 *     accepts), with kinds ["EXTRACT_MISTAKES"], when ANALYSIS_WORKER_URL and an `opswk` key are in the shell; without
 *     them the worker takes the jobs at its next drain (boot, any kick, the daily backstop).
 */
import { OPS_TO_WORKER_KID, parseKeyRing, restrictKeyRing, signInternal } from "@repo/contracts/internal/auth";
import { KICK_PATH, KICK_TIMEOUT_MS, KickBodyV1 } from "@repo/contracts/internal/kick";
import { audit, type AuditMetaValue } from "../../lib/audit";
import type { BackfillDb } from "./p04-common";

export type P5BackfillName = "mistake_extraction" | "bank_theme_recount" | "bank_cards_rebuild";

/** One audit_logs row for an applied run (meta: counts only). */
export async function recordP5Backfill(db: BackfillDb, name: P5BackfillName, meta: Record<string, AuditMetaValue>): Promise<void> {
  await audit(db, {
    category: "SYSTEM",
    action: `backfill.${name}`,
    actorKind: "SYSTEM",
    targetType: "backfill",
    targetId: name,
    meta,
  });
}

/** The post-backfill wake-up of the worker's engine lane. Returns a one-line outcome; never throws. */
export async function kickExtraction(
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
  const body = JSON.stringify(KickBodyV1.parse({ v: 1, reason: "backfill", kinds: ["EXTRACT_MISTAKES"] }));
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
