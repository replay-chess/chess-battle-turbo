// workerLookup(): web → analysis worker `POST /internal/provider/chesscom/lookup` (phase-04 plan §7.3.1, §7.7.3;
// D4-23, D4-24). The web's fallback when its own Chess.com call got 429/403 (Vercel's egress IPs are shared): the
// worker serves it through its Chess.com gate (one request at a time, one IP, one User-Agent) and its 600 s LRU.
//
// Signed like kickWorker() (lib/services/analysis/kick.ts): the shared HMAC scheme over the exact bytes sent, kid
// `webwk` (the worker's allow-list, CT/internal/auth.ts WORKER_POLICY). Budget PROVIDER_LOOKUP_TIMEOUT_MS (6 s) for
// sign + send + the worker's gate wait + its upstream call. The answer is validated with InternalLookupData; the raw
// Chess.com bodies inside are re-validated by the caller with @repo/chess-import's lenient schemas.
import {
  InternalLookupBody,
  InternalLookupData,
  PROVIDER_LOOKUP_TIMEOUT_MS,
  WORKER_PROVIDER_LOOKUP_PATH,
  type InternalLookupBodyInput,
} from "@repo/contracts/internal/provider";
import { getRouteDeps } from "@/lib/api/context";
import { InternalFetchConfigError } from "@/lib/internal/fetch";
import { workerOrigin, workerSignature } from "@/lib/services/analysis/kick";

type Env = Readonly<Record<string, string | undefined>>;

export type WorkerLookupTransport = (url: string, init: RequestInit) => Promise<Response>;

let transport: WorkerLookupTransport = (url, init) => fetch(url, init);

/** Test seam: replaces the HTTP transport; returns a restore function. */
export function setWorkerLookupTransport(next: WorkerLookupTransport): () => void {
  const previous = transport;
  transport = next;
  return () => {
    transport = previous;
  };
}

/** Why the fallback could not answer (the caller maps it to 502 `upstream_unavailable`). */
export type WorkerLookupFailure = { ok: false; kind: "timeout" | "error"; reason: string };
export type WorkerLookupResult = { ok: true; data: InternalLookupData } | WorkerLookupFailure;

/** One signed lookup. Never throws: every failure is a `{ ok: false }` the route turns into a 502. */
export async function workerLookup(
  body: InternalLookupBodyInput,
  options: { env?: Env; nowMs?: number; signal?: AbortSignal } = {},
): Promise<WorkerLookupResult> {
  const deps = getRouteDeps();
  const env = options.env ?? deps.env;
  const parsedBody = InternalLookupBody.safeParse(body);
  if (!parsedBody.success) return { ok: false, kind: "error", reason: "invalid_body" };
  const origin = workerOrigin(env);
  if (!origin) return { ok: false, kind: "error", reason: "not_configured" };
  const text = JSON.stringify(parsedBody.data);
  let headers: Record<string, string>;
  try {
    // Wall clock on purpose (the worker checks the timestamp against its own clock), as kickWorker does.
    headers = { ...workerSignature(env, "POST", WORKER_PROVIDER_LOOKUP_PATH, text, options.nowMs ?? Date.now()), "content-type": "application/json" };
  } catch (err) {
    if (err instanceof InternalFetchConfigError) return { ok: false, kind: "error", reason: "not_configured" };
    throw err;
  }
  const timeout = AbortSignal.timeout(PROVIDER_LOOKUP_TIMEOUT_MS);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  try {
    const res = await transport(`${origin}${WORKER_PROVIDER_LOOKUP_PATH}`, { method: "POST", headers, body: text, signal, cache: "no-store" });
    if (!res.ok) {
      await res.arrayBuffer().catch(() => undefined);
      deps.telemetry.captureMessage("accounts.lookup_fallback_failed", { level: "warning", tags: { reason: "http_error" }, extra: { status: res.status } });
      return { ok: false, kind: "error", reason: `http_${res.status}` };
    }
    const json: unknown = await res.json().catch(() => undefined);
    const data = InternalLookupData.safeParse(json);
    if (!data.success) {
      deps.telemetry.captureMessage("accounts.lookup_fallback_failed", { level: "warning", tags: { reason: "bad_response" } });
      return { ok: false, kind: "error", reason: "bad_response" };
    }
    return { ok: true, data: data.data };
  } catch (err) {
    const timedOut = timeout.aborted || (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError"));
    deps.telemetry.captureMessage("accounts.lookup_fallback_failed", { level: "warning", tags: { reason: timedOut ? "timeout" : "network" } });
    return { ok: false, kind: timedOut ? "timeout" : "error", reason: timedOut ? "timeout" : "network" };
  }
}
