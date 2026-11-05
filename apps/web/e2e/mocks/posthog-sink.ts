// PostHog server sink (phase-01 plan §10.1, CT X6).
//
// A tiny HTTP server that stands in for PostHog in CI and local e2e. The web
// app's posthog-node client (and later the socket server and worker) point at
// it with POSTHOG_HOST=http://127.0.0.1:4011. It records every captured event
// and serves them back to the telemetry fixture:
//
//   POST /capture, /batch, /e, /i/v0/e (JSON or gzip; trailing slash optional)
//   GET  /__events?since=<epoch ms>&distinct_id=<id>   → { events: [...] }
//   DELETE /__events                                    → clears the log
//   GET  /__health                                      → { ok: true }
//   /decide, /flags, /api/feature_flag/local_evaluation → empty flag answers
//
// Run standalone: `npx tsx e2e/mocks/posthog-sink.ts [--port 4011]`
// (playwright.config.ts starts it as a webServer when E2E_BASE_URL is unset).
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { gunzipSync } from "node:zlib";

export type SinkEvent = {
  event: string;
  distinct_id: string | null;
  properties: Record<string, unknown>;
  receivedAt: number;
  path: string;
};

export const DEFAULT_SINK_PORT = 4011;
const MAX_EVENTS = 10_000;

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function decode(buf: Buffer, req: IncomingMessage, url: URL): unknown {
  let raw = buf;
  const gz =
    req.headers["content-encoding"] === "gzip" ||
    url.searchParams.get("compression") === "gzip" ||
    url.searchParams.get("compression") === "gzip-js" ||
    (raw[0] === 0x1f && raw[1] === 0x8b);
  if (gz) raw = gunzipSync(raw);
  const text = raw.toString("utf8").trim();
  if (!text) return null;
  if (text.startsWith("data=")) {
    // posthog-js form encoding: data=<base64 json>
    const data = new URLSearchParams(text).get("data") ?? "";
    return JSON.parse(Buffer.from(data, "base64").toString("utf8"));
  }
  return JSON.parse(text);
}

/** Flattens the payload shapes PostHog clients send into single events. */
export function extractEvents(payload: unknown): Array<Omit<SinkEvent, "receivedAt" | "path">> {
  const list: unknown[] = Array.isArray(payload)
    ? payload
    : payload && typeof payload === "object" && Array.isArray((payload as { batch?: unknown[] }).batch)
      ? (payload as { batch: unknown[] }).batch
      : payload
        ? [payload]
        : [];
  return list.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const e = item as { event?: unknown; distinct_id?: unknown; properties?: Record<string, unknown> };
    if (typeof e.event !== "string") return [];
    const properties = { ...(e.properties ?? {}) };
    const distinct =
      typeof e.distinct_id === "string" ? e.distinct_id : typeof properties.distinct_id === "string" ? properties.distinct_id : null;
    return [{ event: e.event, distinct_id: distinct, properties }];
  });
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

export function createPosthogSink() {
  const events: SinkEvent[] = [];

  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://sink.local");
    const p = url.pathname.replace(/\/+$/, "") || "/";
    try {
      if (p === "/__health") return json(res, 200, { ok: true, count: events.length });
      if (p === "/__events" && req.method === "DELETE") {
        events.length = 0;
        return json(res, 200, { ok: true });
      }
      if (p === "/__events") {
        const since = Number(url.searchParams.get("since") ?? 0);
        const distinctId = url.searchParams.get("distinct_id");
        const name = url.searchParams.get("event");
        return json(res, 200, {
          events: events.filter(
            (e) => e.receivedAt >= since && (!distinctId || e.distinct_id === distinctId) && (!name || e.event === name),
          ),
        });
      }
      if (["/capture", "/batch", "/e", "/i/v0/e", "/track", "/engage"].includes(p) && req.method === "POST") {
        const payload = decode(await readBody(req), req, url);
        const receivedAt = Date.now();
        for (const e of extractEvents(payload)) events.push({ ...e, receivedAt, path: p });
        if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
        return json(res, 200, { status: 1 });
      }
      if (p === "/decide" || p === "/flags") {
        return json(res, 200, { featureFlags: {}, featureFlagPayloads: {}, flags: {}, errorsWhileComputingFlags: false });
      }
      if (p === "/api/feature_flag/local_evaluation") {
        return json(res, 200, { flags: [], group_type_mapping: {}, cohorts: {} });
      }
      return json(res, 404, { error: "not_found", path: p });
    } catch (err) {
      return json(res, 400, { error: "bad_payload", message: err instanceof Error ? err.message : String(err) });
    }
  });

  return {
    server,
    events,
    listen(port = DEFAULT_SINK_PORT, host = "127.0.0.1") {
      return new Promise<number>((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, () => {
          const addr = server.address();
          resolve(typeof addr === "object" && addr ? addr.port : port);
        });
      });
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const i = process.argv.indexOf("--port");
  const port = i > 0 ? Number(process.argv[i + 1]) : Number(process.env.POSTHOG_SINK_PORT ?? DEFAULT_SINK_PORT);
  createPosthogSink()
    .listen(port)
    .then((p) => console.log(`[posthog-sink] listening on http://127.0.0.1:${p}`))
    .catch((err) => {
      console.error(`[posthog-sink] ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    });
}
