// Socket → analysis worker `POST /internal/analysis/kick` (phase-03 plan §7.4 "After the finish commit", §7.5, §8.17;
// P3-D12, P3-D21). Signed with the shared HMAC scheme under the socket's own kid `ws` (the worker accepts `ws` for the
// kick path only, WORKER_POLICY), over the exact bytes sent. The base URL is ANALYSIS_WORKER_URL
// (`http://analysis-worker:3003` on the dev box's docker network; `http://localhost:3003` locally).
//
// A kick is a wake-up, never a correctness mechanism: the job row was written by the finish statement itself. So a
// kick never throws and never delays the game: errors are a warning plus `ws.analysis.kick{result}`, and the worker's
// drain-end sweep, the web's lost-kick heal (A1/A2 CAS) and the daily cron backstop recover a lost one.
import { signInternal, type KeyRing } from "@repo/contracts/internal/auth";
import { KICK_PATH, KICK_TIMEOUT_MS, KickBodyV1, type KickBodyInput } from "@repo/contracts/internal/kick";
import type { Logger, Metrics } from "../ports";

/** The socket's signing kid (CT/internal/auth.ts INTERNAL_KIDS). */
export const SOCKET_KID = "ws";

export type KickResult =
  | { ok: true; status: number }
  | { ok: false; reason: "not_configured" | "no_key" | "invalid_body" | "http_error" | "network"; status?: number };

export interface WorkerKicker {
  kick(body: KickBodyInput): Promise<KickResult>;
}

export interface WorkerKickerDeps {
  /** ANALYSIS_WORKER_URL (no trailing slash); null = kicks are skipped. */
  baseUrl: string | null;
  /** INTERNAL_API_SECRET: must hold a `ws` key the worker's ring also holds. */
  keys: KeyRing;
  /** Wall clock (the worker checks the signature timestamp against its own clock, ±60 s). */
  now(): number;
  log: Logger;
  metrics: Metrics;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export function createWorkerKicker(deps: WorkerKickerDeps): WorkerKicker {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const timeoutMs = deps.timeoutMs ?? KICK_TIMEOUT_MS;
  let warnedConfig = false;

  const done = (result: KickResult, reason: string): KickResult => {
    deps.metrics.count("ws.analysis.kick", { result: result.ok ? "ok" : result.reason, reason });
    return result;
  };

  return {
    async kick(body) {
      const parsed = KickBodyV1.safeParse(body);
      if (!parsed.success) {
        deps.log.warn("analysis kick refused: invalid body", { reason: body.reason });
        return done({ ok: false, reason: "invalid_body" }, String(body.reason));
      }
      if (!deps.baseUrl) return done({ ok: false, reason: "not_configured" }, parsed.data.reason);
      if (!deps.keys.keys.has(SOCKET_KID)) {
        if (!warnedConfig) {
          warnedConfig = true;
          deps.log.warn("analysis kicks skipped: INTERNAL_API_SECRET has no ws key");
        }
        return done({ ok: false, reason: "no_key" }, parsed.data.reason);
      }
      const text = JSON.stringify(parsed.data);
      const headers = {
        ...signInternal({ keys: deps.keys, method: "POST", path: KICK_PATH, body: text, nowMs: deps.now(), kid: SOCKET_KID }),
        "content-type": "application/json",
      };
      try {
        const res = await fetchImpl(`${deps.baseUrl}${KICK_PATH}`, {
          method: "POST",
          headers,
          body: text,
          signal: AbortSignal.timeout(timeoutMs),
        });
        await res.arrayBuffer().catch(() => undefined);
        if (!res.ok) {
          deps.log.warn("analysis kick answered an error", { status: res.status, reason: parsed.data.reason });
          return done({ ok: false, reason: "http_error", status: res.status }, parsed.data.reason);
        }
        return done({ ok: true, status: res.status }, parsed.data.reason);
      } catch (error) {
        deps.log.warn("analysis kick failed", {
          reason: parsed.data.reason,
          error: error instanceof Error ? error.name : "unknown",
        });
        return done({ ok: false, reason: "network" }, parsed.data.reason);
      }
    },
  };
}
