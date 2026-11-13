// regression: posthog-batch-span. PostHog's `/batch` request is the worker's own telemetry delivery, never a span of
// the job that happened to be running. posthog-node starts its 5 s flush timer inside the first capture, which runs
// in the job's async context; on a slow runner (CI, 8 s job) the timer fired before the job ended and Sentry's fetch
// integration added "POST <host>/batch/" to the `job.analyze` transaction (telemetry.int.test.ts saw 7 spans, not 6).
// Here the flush runs inside the transaction on purpose, with real @sentry/node and posthog-node against a local sink;
// a plain fetch in the same transaction proves the fetch integration is live (the assertion is not vacuous).
import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { gunzipSync } from "node:zlib";
import { after, before, describe, it } from "node:test";
import { createProductEvents } from "./posthog";
import { silentLogger } from "./log";
import { sentryTelemetry, type Telemetry } from "./telemetry";

type Tx = { transaction: string; spans: { op?: string; description?: string }[] };

async function body(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks);
  return req.headers["content-encoding"] === "gzip" ? gunzipSync(raw) : raw;
}

describe("PostHog delivery is untraced (Sentry fetch integration on)", () => {
  let server: Server;
  let base: string;
  let telemetry: Telemetry;
  const batches: string[] = [];
  const transactions: Tx[] = [];

  before(async () => {
    server = createServer(async (req, res) => {
      const data = await body(req);
      if (req.url?.startsWith("/batch")) {
        batches.push(...(JSON.parse(data.toString("utf8")) as { batch: { event: string }[] }).batch.map((e) => e.event));
      } else if (req.url?.startsWith("/api/1/envelope")) {
        const lines = data.toString("utf8").split("\n").filter(Boolean);
        for (let i = 1; i + 1 < lines.length; i += 2) {
          const header = JSON.parse(lines[i]!) as { type: string };
          if (header.type === "transaction") transactions.push(JSON.parse(lines[i + 1]!) as Tx);
        }
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end("{}");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    telemetry = await sentryTelemetry({
      dsn: `http://publickey@127.0.0.1:${(server.address() as AddressInfo).port}/1`,
      environment: "test",
      release: "analysis-worker@test",
    });
  });
  after(() => {
    server?.close();
  });

  it("a flush inside job.analyze adds no http.client span; a plain fetch there still does", async () => {
    assert.ok(telemetry.untraced, "the Sentry telemetry offers untraced()");
    const events = createProductEvents({ key: "phc_test_key", host: base }, "test", silentLogger, {
      flushAt: 1_000,
      flushIntervalMs: 60_000,
      untraced: telemetry.untraced.bind(telemetry),
    });

    await telemetry.span(
      "job.analyze",
      { kind: "ANALYZE_GAME" },
      async () => {
        events.capture("analysis_started", "usr_ref_untraced", {
          wait_ms: 10,
          attempt: 1,
          resumed_from_ply: 0,
          priority: 80,
          band: "80+",
        });
        await events.flush();
        await fetch(`${base}/control`);
        await telemetry.span("write", {}, async () => undefined);
      },
      { transaction: true },
    );
    await telemetry.flush(5_000);
    await events.shutdown(1_000);

    assert.deepEqual(batches, ["analysis_started"], "the event was delivered");
    const tx = transactions.find((t) => t.transaction === "job.analyze");
    assert.ok(tx, `a job.analyze transaction (saw ${transactions.map((t) => t.transaction).join(", ")})`);
    const descriptions = tx.spans.map((s) => s.description ?? "");
    assert.ok(
      descriptions.some((d) => d.endsWith("/control")),
      `the fetch integration records an ordinary fetch (spans: ${descriptions.join(", ")})`,
    );
    assert.deepEqual(
      descriptions.filter((d) => d.includes("/batch")),
      [],
      `no PostHog batch span (spans: ${descriptions.join(", ")})`,
    );
  });
});
