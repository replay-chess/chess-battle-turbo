// kickWorker(): web → analysis worker `POST /internal/analysis/kick` (phase-03 plan §7.3, §7.5, §8.17; P3-D12).
//
// Signed with the shared HMAC scheme (`signInternal`) over the exact bytes sent, under the web's worker-only kid
// `webwk` (WEB_TO_WORKER_KID), never the `web` key the socket accepts: the worker holds the key of every kid it
// verifies, so it must not hold the web's socket key (FIX-1, CT/internal/auth.ts INTERNAL_KIDS). The base URL is ANALYSIS_WORKER_URL (dev: the Caddy front of the OCI box, which drops unsigned
// requests; local: http://localhost:3003). Timeout KICK_TIMEOUT_MS. A kick is a wake-up, never a correctness
// mechanism: errors are a Sentry warning `analysis.kick_failed` and are never thrown. The A1/A2 kick CAS (healKick),
// the worker's drain-end sweep and the daily cron backstop recover a lost kick. Callers run it inside `after()`.
import { signInternal, WEB_TO_WORKER_KID, type InternalHeaders } from "@repo/contracts/internal/auth";
import { KICK_PATH, KICK_TIMEOUT_MS, KickBodyV1, type KickBodyInput } from "@repo/contracts/internal/kick";
import { getRouteDeps } from "@/lib/api/context";
import { InternalFetchConfigError, internalKeyRing } from "@/lib/internal/fetch";

type Env = Readonly<Record<string, string | undefined>>;

export type KickTransport = (url: string, init: RequestInit) => Promise<Response>;

let transport: KickTransport = (url, init) => fetch(url, init);

/**
 * The headers of one signed web → worker call, under kid `webwk`. Throws InternalFetchConfigError when
 * INTERNAL_API_SECRET is unset, malformed or has no `webwk` key (callers report "not configured", never throw).
 */
export function workerSignature(env: Env, method: "GET" | "POST", path: string, body: string, nowMs: number): InternalHeaders {
  const keys = internalKeyRing(env);
  if (!keys.keys.has(WEB_TO_WORKER_KID)) {
    throw new InternalFetchConfigError(`INTERNAL_API_SECRET has no ${WEB_TO_WORKER_KID} key (web → worker calls)`);
  }
  return signInternal({ keys, method, path, body, nowMs, kid: WEB_TO_WORKER_KID });
}

/** Test seam: replaces the HTTP transport; returns a restore function. */
export function setKickTransport(next: KickTransport): () => void {
  const previous = transport;
  transport = next;
  return () => {
    transport = previous;
  };
}

/** The worker's origin (no trailing slash), or null when ANALYSIS_WORKER_URL is unset. */
export function workerOrigin(env: Env = process.env): string | null {
  const raw = env.ANALYSIS_WORKER_URL?.trim();
  return raw ? raw.replace(/\/+$/, "") : null;
}

export type KickResult =
  | { ok: true; status: number }
  | { ok: false; reason: "not_configured" | "invalid_body" | "http_error" | "network"; status?: number };

/** Sends one signed kick. Never throws. */
export async function kickWorker(body: KickBodyInput, options: { env?: Env; nowMs?: number } = {}): Promise<KickResult> {
  const deps = getRouteDeps();
  // The signature timestamp is the wall clock on purpose: the receiver checks it against its own clock (±60 s), so a
  // test-hook x-rc-now would make every kick stale.
  const nowMs = options.nowMs ?? deps.clock();
  const env = options.env ?? process.env;
  const warn = (reason: string, extra: Record<string, unknown> = {}) =>
    deps.telemetry.captureMessage("analysis.kick_failed", {
      level: "warning",
      tags: { reason, kick_reason: body.reason },
      extra,
    });
  const parsed = KickBodyV1.safeParse(body);
  if (!parsed.success) {
    warn("invalid_body");
    return { ok: false, reason: "invalid_body" };
  }
  const origin = workerOrigin(env);
  if (!origin) {
    deps.log("warn", "analysis.kick_skipped", { reason: "ANALYSIS_WORKER_URL is not set", kickReason: body.reason });
    return { ok: false, reason: "not_configured" };
  }
  const text = JSON.stringify(parsed.data);
  let headers: Record<string, string>;
  try {
    headers = {
      ...workerSignature(env, "POST", KICK_PATH, text, nowMs),
      "content-type": "application/json",
    };
  } catch (err) {
    if (err instanceof InternalFetchConfigError) {
      deps.log("warn", "analysis.kick_skipped", { reason: err.message, kickReason: body.reason });
      return { ok: false, reason: "not_configured" };
    }
    throw err;
  }
  try {
    const res = await transport(`${origin}${KICK_PATH}`, {
      method: "POST",
      headers,
      body: text,
      signal: AbortSignal.timeout(KICK_TIMEOUT_MS),
      cache: "no-store",
    });
    await res.arrayBuffer().catch(() => undefined);
    if (!res.ok) {
      warn("http_error", { status: res.status });
      return { ok: false, reason: "http_error", status: res.status };
    }
    return { ok: true, status: res.status };
  } catch (err) {
    warn("network", { error: err instanceof Error ? err.name : "unknown" });
    return { ok: false, reason: "network" };
  }
}
