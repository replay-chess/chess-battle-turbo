// The worker wake a P6 persona reset takes (packages/db/seed/p06-personas.ts `P06Kick`): one signed
// `POST /internal/analysis/kick` (reason `weakness`, every kind), signed exactly as the web's kickWorker() signs it
// (lib/services/analysis/kick.ts `workerSignature`: the shared HMAC scheme under the web's worker-only kid `webwk`), so
// a reset reaches the worker as TR-12 and the game-end path do. Built here from the same pieces instead of importing
// kickWorker, whose route context imports `next/server` (Playwright's loader runs this file outside Next). Needs
// ANALYSIS_WORKER_URL and INTERNAL_API_SECRET (`.env.test`, `.env.development.local`, or the e2e harness).
import type { P06Kick } from "@repo/db/seed/p06-personas";

export async function loadWorkerKick(env: Readonly<Record<string, string | undefined>> = process.env): Promise<P06Kick> {
  const { signInternal, WEB_TO_WORKER_KID } = await import("@repo/contracts/internal/auth");
  const { KICK_PATH, KICK_TIMEOUT_MS } = await import("@repo/contracts/internal/kick");
  const { internalKeyRing } = await import("../../lib/internal/fetch");
  return async () => {
    const origin = env.ANALYSIS_WORKER_URL?.trim().replace(/\/+$/, "");
    if (!origin) return false;
    const keys = internalKeyRing(env);
    if (!keys.keys.has(WEB_TO_WORKER_KID)) return false;
    // `runAt` (now) keeps the worker's in-memory next run and makes two kicks in the same second different bytes (the
    // worker refuses a byte-identical signed request as a replay).
    const body = JSON.stringify({ v: 1, reason: "weakness", runAt: new Date().toISOString() });
    const headers = { ...signInternal({ keys, method: "POST", path: KICK_PATH, body, nowMs: Date.now(), kid: WEB_TO_WORKER_KID }), "content-type": "application/json" };
    try {
      const res = await fetch(`${origin}${KICK_PATH}`, { method: "POST", headers, body, signal: AbortSignal.timeout(KICK_TIMEOUT_MS * 5) });
      return res.ok;
    } catch {
      return false;
    }
  };
}
