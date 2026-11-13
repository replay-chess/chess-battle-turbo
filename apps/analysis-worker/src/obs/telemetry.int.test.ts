// Worker telemetry end to end (phase-03 plan §10, §12 "worker telemetry tests", task C5 `telemetry.int`): the booted
// worker (APP_ENV=test, ENGINE=fake, Postgres as replay_worker) with POSTHOG_HOST and SENTRY_DSN pointed at a local
// sink. A kicked analysis must reach PostHog as `analysis_started` + `analysis_ready` (registry-valid, `app_env`,
// distinct_id = the member's ref, no PII) and Sentry as a `job.analyze` transaction with the load / pass1 / pass2 /
// classify / text / write spans; a failing attempt (the kick's one-shot `fail_at_ply` fault) as `analysis_failed`.
// Skipped without TEST_DATABASE_URL.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { gunzipSync } from "node:zlib";
import { after, before, describe, it } from "node:test";
import { findPii, parseEvent } from "@repo/analytics";
import { mockGradeInput } from "@repo/chess-analysis/fixtures/labels/design-mock";
import { parseKeyRing, signInternal } from "@repo/contracts/internal/auth";
import { JOB_PRIORITY } from "@repo/contracts/internal/jobs";
import { KICK_PATH } from "@repo/contracts/internal/kick";
import { bootWorker, type RunningWorker } from "../boot";
import { loadEnv } from "../config/env";
import { silentLogger } from "./log";
import { insertJob, jobRow, makeGame, makeUser, setupInt, skipInt, type IntEnv, type TestUser } from "../testing/pg";

const GAME_UCI = mockGradeInput("GAME").replay.uci.slice(0, 30);
const k = () => randomBytes(32).toString("base64");

interface Captured {
  posthog: { event: string; distinct_id: string; properties: Record<string, unknown> }[];
  sentry: Record<string, unknown>[];
}

async function body(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks);
  return req.headers["content-encoding"] === "gzip" ? gunzipSync(raw) : raw;
}

function sink(captured: Captured): Promise<Server> {
  const server = createServer(async (req, res) => {
    const data = await body(req);
    if (req.url?.startsWith("/batch")) {
      const parsed = JSON.parse(data.toString("utf8")) as { batch: Captured["posthog"] };
      captured.posthog.push(...parsed.batch);
    } else if (req.url?.startsWith("/api/1/envelope")) {
      // An envelope: a header line, then (item header, item payload) pairs.
      const lines = data.toString("utf8").split("\n").filter(Boolean);
      for (let i = 1; i + 1 < lines.length; i += 2) {
        const header = JSON.parse(lines[i]!) as { type: string };
        captured.sentry.push({ type: header.type, payload: JSON.parse(lines[i + 1]!) });
      }
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end("{}");
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

describe("worker telemetry (Postgres + PostHog/Sentry sink)", { skip: skipInt }, () => {
  let env: IntEnv;
  let server: Server;
  let worker: RunningWorker | null = null;
  let white: TestUser;
  let black: TestUser;
  const captured: Captured = { posthog: [], sentry: [] };
  const ring = `wk:${k()},webwk:${k()},ws:${k()}`;
  const web = parseKeyRing(ring);

  before(async () => {
    env = await setupInt("telemetry");
    server = await sink(captured);
    white = await makeUser(env.owner, "tw");
    black = await makeUser(env.owner, "tb");
  });
  after(async () => {
    await worker?.shutdown();
    server?.close();
    await env?.close();
  });

  async function game(): Promise<{ id: string; ref: string }> {
    const g = await makeGame(env.owner, white, black, { analysisStatus: "QUEUED" });
    await env.owner.query(
      `UPDATE games SET moves = $2, "plyCount" = $3, "completedAt" = (now() AT TIME ZONE 'UTC') - interval '2 seconds' WHERE id = $1`,
      [g.id, GAME_UCI.join(" "), GAME_UCI.length],
    );
    return g;
  }

  async function kick(body: Record<string, unknown>) {
    const text = JSON.stringify({ v: 1, reason: "test", ...body });
    const headers = signInternal({
      keys: web,
      method: "POST",
      path: KICK_PATH,
      body: text,
      nowMs: Date.now(),
      kid: "webwk",
    });
    const res = await fetch(`http://127.0.0.1:${worker!.port}${KICK_PATH}`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: text,
    });
    assert.equal(res.status, 202);
  }

  // The waits are for the worker to finish real work (a kicked 30-ply analysis, a failed attempt, the sinks' flush), not
  // a latency target: 2.5 s alone, 11 s in CI's integration job (CI 43452098148), where every int file of the package
  // runs at the same time on 4 vCPUs, and more than 15 s once (CI 43468582948: "timed out" on the first wait).
  async function until(check: () => Promise<boolean> | boolean, ms = 60_000) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await check()) return;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error("timed out");
  }

  it("a kicked analysis reaches PostHog and Sentry; a failed attempt reaches PostHog", async () => {
    const port = (server.address() as AddressInfo).port;
    worker = await bootWorker(
      loadEnv({
        APP_ENV: "test",
        // A P3 test: no import work (the boot backstop would sweep other int files' linked accounts, FIX-1).
        IMPORT_PAUSED: "on",
        WORKER_DATABASE_URL: env.workerUrl,
        INTERNAL_API_SECRET: ring,
        ENGINE: "fake",
        WORKER_ID: "int-telemetry",
        PORT: "0",
        EVAL_CACHE: "off",
        POSTHOG_PROJECT_KEY: "phc_test_key",
        POSTHOG_HOST: `http://127.0.0.1:${port}`,
        SENTRY_DSN: `http://publickey@127.0.0.1:${port}/1`,
      }),
      { log: silentLogger },
    );

    const ok = await game();
    const okJob = await insertJob(env, {
      gameId: ok.id,
      priority: JOB_PRIORITY.GAME_ENDED,
      dedupeKey: `analyze:${ok.id}`,
      payload: { v: 1, gameId: ok.id, gameRef: ok.ref, reason: "bot_end" },
    });
    await kick({ watch: ok.ref });
    await until(async () => (await jobRow(env, okJob)).status === "DONE");

    const bad = await game();
    const badJob = await insertJob(env, {
      gameId: bad.id,
      priority: JOB_PRIORITY.GAME_ENDED,
      dedupeKey: `analyze:${bad.id}`,
      payload: { v: 1, gameId: bad.id, gameRef: bad.ref, reason: "live_end" },
    });
    await kick({ watch: bad.ref, fault: "fail_at_ply:12" });
    await until(async () => {
      const row = await jobRow(env, badJob);
      return row.status === "QUEUED" && row.attempts === 1;
    });

    await worker.shutdown();
    worker = null;
    await until(
      () =>
        captured.posthog.some((e) => e.event === "analysis_failed") &&
        captured.sentry.some((s) => s.type === "transaction"),
    );

    // ── PostHog ──
    const names = captured.posthog.map((e) => e.event);
    assert.deepEqual(names.filter((n) => n.startsWith("analysis_")).sort(), [
      "analysis_failed",
      "analysis_ready",
      "analysis_started",
      "analysis_started",
    ]);
    for (const e of captured.posthog) {
      const parsed = parseEvent(e.event, e.properties);
      assert.ok(parsed.ok, parsed.ok ? "" : parsed.error);
      assert.equal(e.properties.app_env, "test");
      assert.equal(e.distinct_id, white.ref, "the member's ref, never an id or a name");
      const own = Object.fromEntries(Object.entries(e.properties).filter(([key]) => !key.startsWith("$")));
      assert.deepEqual(findPii(own, ["tw_", "tb_"]), [], "no PII-shaped value and no player name");
    }
    const ready = captured.posthog.find((e) => e.event === "analysis_ready")!.properties;
    assert.equal(ready.plies, GAME_UCI.length);
    assert.equal(ready.regrade, false);
    assert.ok(typeof ready.ms_from_game_end === "number" && ready.ms_from_game_end >= 2_000);
    const failed = captured.posthog.find((e) => e.event === "analysis_failed")!.properties;
    assert.equal(failed.code, "engine_failed");
    assert.equal(failed.retryable, true);
    assert.equal(failed.failed_at_ply, 10);

    // ── Sentry ──
    const tx = captured.sentry
      .filter((s) => s.type === "transaction")
      .map(
        (s) =>
          s.payload as {
            transaction: string;
            spans: { description: string }[];
            tags?: Record<string, string>;
            contexts?: { trace?: { data?: Record<string, unknown> } };
          },
      );
    const analyze = tx.find((t) => t.transaction === "job.analyze" && t.spans.some((s) => s.description === "write"));
    assert.ok(analyze, `a job.analyze transaction (saw ${tx.map((t) => t.transaction).join(", ")})`);
    assert.deepEqual([...new Set(analyze.spans.map((s) => s.description))].sort(), [
      "classify",
      "load",
      "pass1",
      "pass2",
      "text",
      "write",
    ]);
    assert.equal(analyze.contexts?.trace?.data?.kind, "ANALYZE_GAME");
    assert.equal(analyze.contexts?.trace?.data?.profile, "sf18-v1");
    const metricNames = new Set(
      captured.sentry
        .filter((x) => x.type === "trace_metric")
        .flatMap((x) => (x.payload as { items: { name: string }[] }).items.map((m) => m.name)),
    );
    for (const name of [
      "worker.job.duration_ms",
      "worker.review_ready_ms",
      "worker.queue.wait_ms",
      "worker.queue.depth",
      "worker.job.fail",
    ]) {
      assert.ok(metricNames.has(name), `metric ${name} (saw ${[...metricNames].join(", ")})`);
    }
    const errors = captured.sentry
      .filter((x) => x.type === "event")
      .map((x) => x.payload as { exception: { values: { type: string }[] }; tags?: Record<string, string> });
    assert.ok(
      errors.some((e) => e.exception.values.some((v) => v.type === "JobError") && e.tags?.code === "engine_failed"),
      "the failure is captured with its code",
    );
  });
});
