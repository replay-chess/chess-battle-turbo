// The worker's HTTP surface (phase-03 plan §7.5, §11.2 rule 4; `node:http`, port 3003, never published on the host):
//
//   POST /internal/analysis/kick  HMAC only (web, ws, ops), body ≤ 1 KB, KickBodyV1 → 202 {draining, nextRunAt}
//   GET  /internal/metrics        HMAC only (web, ops) → WorkerMetricsResponse, from memory (no DB)
//   GET  /health                  → 200 {ok:true} (docker healthcheck; Caddy answers 404 for it)
//   GET  /ready                   → 200 when the engine answered readyok and the eval cache is open, else 503
//   P4 (phase-04 plan §7.7.3, routes/):
//   POST /internal/provider/chesscom/lookup  HMAC only (webwk, opswk), body ≤ 1 KB, InternalLookupBody → 200
//                                            InternalLookupData | 502 (routes/provider-lookup.ts)
//   GET|POST /internal/dev/fault             HMAC only (webwk), body ≤ 1 KB, DevFaultBody → 200 DevFaultData; only
//                                            in a worker with IMPORT_FAULTS_ALLOWED=1, else 404 (routes/dev-fault.ts)
//
// Order on a signed route: size (413) → HMAC (401, no detail on the wire) → caller allow-list (403) → body (400).
// `POST /engine/analyse` is reserved for P7 and answers 404 like every other path.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import {
  ReplayGuard,
  verifyInternal,
  workerKidMayCall,
  type KeyRing,
  type WorkerInternalPath,
} from "@repo/contracts/internal/auth";
import { KICK_BODY_MAX_BYTES, KICK_PATH, KickBodyV1, type KickResponse, type WorkerReadyResponse } from "@repo/contracts/internal/kick";
import type { WorkerMetricsResponse } from "@repo/contracts/internal/kick";
import {
  InternalLookupBody,
  PROVIDER_BODY_MAX_BYTES,
  WORKER_DEV_FAULT_PATH,
  WORKER_PROVIDER_LOOKUP_PATH,
} from "@repo/contracts/internal/provider";
import type { Logger } from "../obs/log";
import type { DevFaultRoute } from "./routes/dev-fault";
import type { LookupOutcome } from "./routes/provider-lookup";

export const METRICS_PATH = "/internal/metrics";

export interface HttpDeps {
  acceptKeys: KeyRing;
  nowMs: () => number;
  log: Logger;
  kick(body: KickBodyV1): KickResponse;
  metrics(): WorkerMetricsResponse;
  ready(): WorkerReadyResponse;
  /** Counts refused internal calls by reason (telemetry). */
  onAuthFail?(reason: string): void;
  /** P4: the Chess.com lookup fallback (routes/provider-lookup.ts); absent → 404. */
  lookup?(body: InternalLookupBody): Promise<LookupOutcome>;
  /** P4: the provider fault table (routes/dev-fault.ts); absent (IMPORT_FAULTS_ALLOWED off) → 404. */
  devFault?: DevFaultRoute;
}

class BodyTooLarge extends Error {}

function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers["content-length"] ?? "0");
    if (Number.isFinite(declared) && declared > limit) {
      req.resume();
      return reject(new BodyTooLarge());
    }
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        req.removeAllListeners("data");
        req.resume();
        reject(new BodyTooLarge());
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(text),
  });
  res.end(text);
}

export function createHttpServer(deps: HttpDeps): Server {
  const replay = new ReplayGuard();

  /** HMAC + the worker allow-list. Returns false after answering 401/403. */
  function authorised(req: IncomingMessage, res: ServerResponse, path: WorkerInternalPath, body: Buffer): boolean {
    const verdict = verifyInternal({
      headers: req.headers,
      method: req.method ?? "GET",
      path: req.url ?? path,
      body,
      keys: deps.acceptKeys,
      nowMs: deps.nowMs(),
      replay,
    });
    if (!verdict.ok) {
      deps.onAuthFail?.(verdict.reason);
      deps.log.warn("internal call refused", { path, reason: verdict.reason });
      send(res, 401, { error: "unauthorized" });
      return false;
    }
    if (!workerKidMayCall(verdict.kid, path)) {
      deps.onAuthFail?.("forbidden");
      deps.log.warn("internal call forbidden", { path, kid: verdict.kid });
      send(res, 403, { error: "forbidden" });
      return false;
    }
    return true;
  }

  /** A P4 route body (≤ 1 KB); null after answering 413. */
  async function readSmallBody(req: IncomingMessage, res: ServerResponse): Promise<Buffer | null> {
    try {
      return await readBody(req, PROVIDER_BODY_MAX_BYTES);
    } catch (error) {
      if (error instanceof BodyTooLarge) {
        send(res, 413, { error: "payload_too_large" });
        return null;
      }
      throw error;
    }
  }

  /** JSON or `undefined` (the body schema then refuses it with 400). */
  function parseJson(body: Buffer): unknown {
    try {
      return JSON.parse(body.toString("utf8"));
    } catch {
      return undefined;
    }
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://worker.internal");
    const method = req.method ?? "GET";
    switch (url.pathname) {
      case "/health":
        if (method !== "GET") return send(res, 405, { error: "method_not_allowed" });
        return send(res, 200, { ok: true });
      case "/ready": {
        if (method !== "GET") return send(res, 405, { error: "method_not_allowed" });
        const ready = deps.ready();
        return send(res, ready.ready ? 200 : 503, ready);
      }
      case KICK_PATH: {
        if (method !== "POST") return send(res, 405, { error: "method_not_allowed" });
        let body: Buffer;
        try {
          body = await readBody(req, KICK_BODY_MAX_BYTES);
        } catch (error) {
          if (error instanceof BodyTooLarge) return send(res, 413, { error: "payload_too_large" });
          throw error;
        }
        if (!authorised(req, res, KICK_PATH, body)) return;
        let json: unknown;
        try {
          json = JSON.parse(body.toString("utf8"));
        } catch {
          return send(res, 400, { error: "invalid_json" });
        }
        const parsed = KickBodyV1.safeParse(json);
        if (!parsed.success) return send(res, 400, { error: "invalid_body" });
        return send(res, 202, deps.kick(parsed.data));
      }
      case METRICS_PATH: {
        if (method !== "GET") return send(res, 405, { error: "method_not_allowed" });
        const body = await readBody(req, KICK_BODY_MAX_BYTES).catch(() => Buffer.alloc(0));
        if (!authorised(req, res, METRICS_PATH, body)) return;
        return send(res, 200, deps.metrics());
      }
      case WORKER_PROVIDER_LOOKUP_PATH: {
        if (!deps.lookup) return send(res, 404, { error: "not_found" });
        if (method !== "POST") return send(res, 405, { error: "method_not_allowed" });
        const body = await readSmallBody(req, res);
        if (!body || !authorised(req, res, WORKER_PROVIDER_LOOKUP_PATH, body)) return;
        const json = parseJson(body);
        const parsed = InternalLookupBody.safeParse(json);
        if (!parsed.success) return send(res, 400, { error: "invalid_body" });
        const out = await deps.lookup(parsed.data);
        return send(res, out.status, out.body);
      }
      case WORKER_DEV_FAULT_PATH: {
        // Without IMPORT_FAULTS_ALLOWED the path does not exist (same 404 as any unknown path, nothing read).
        if (!deps.devFault) return send(res, 404, { error: "not_found" });
        if (method !== "POST" && method !== "GET") return send(res, 405, { error: "method_not_allowed" });
        const body = await readSmallBody(req, res);
        if (!body || !authorised(req, res, WORKER_DEV_FAULT_PATH, body)) return;
        const out = method === "GET" ? deps.devFault.view() : deps.devFault.apply(parseJson(body));
        return send(res, out.status, out.body);
      }
      default:
        return send(res, 404, { error: "not_found" });
    }
  }

  return createServer((req, res) => {
    handle(req, res).catch((error: unknown) => {
      deps.log.error("http handler failed", { error });
      if (!res.headersSent) send(res, 500, { error: "internal" });
      else res.destroy();
    });
  });
}
