// RECOMPUTE_WEAKNESS runs on the I/O lane (phase-06 plan §7.4, §12.3 "Lanes"; interface check §0.8), against a real
// Postgres and the whole booted worker (APP_ENV=test, ENGINE=fake, IMPORT_PAUSED=on: the import kinds are off the lane,
// the weakness kind is not). A member's games are imported and analysed by the real pipelines first; then an
// ANALYZE_GAME of hers is held RUNNING on the engine lane while her recompute is kicked: the I/O lane claims and
// finishes it (a snapshot from her rows) before the analysis is released. Skipped without TEST_DATABASE_URL.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { parseKeyRing, signInternal } from "@repo/contracts/internal/auth";
import { JOB_PRIORITY } from "@repo/contracts/internal/jobs";
import { enqueueAnalysisSql } from "@repo/db/jobs";
import { bootWorker } from "../boot";
import { loadEnv } from "../config/env";
import { fromPrisma } from "../db/client";
import { IMPORT_T0 } from "../import/__tests__/harness";
import { defaultHandlers, type HandlerMap } from "../jobs";
import type { JobHandler } from "../jobs/types";
import { silentLogger } from "../obs/log";
import { noopProductEvents } from "../obs/posthog";
import { setupInt, skipInt, type IntEnv } from "../testing/pg";
import { WeaknessWorld, worldTag } from "../testing/weakness-world";
import { WeaknessProgressEmitter } from "./progressEmitter";
import { defaultWeaknessSettings } from "./settings";

const k = () => randomBytes(32).toString("base64");

describe("RECOMPUTE_WEAKNESS on the I/O lane while the engine lane is busy (Postgres, booted worker)", { skip: skipInt }, () => {
  let env: IntEnv;
  let world: WeaknessWorld;

  before(async () => {
    env = await setupInt("wklanes");
    world = new WeaknessWorld(env, worldTag());
  });
  after(async () => {
    await world?.close();
    await env?.close();
  });

  async function until(check: () => Promise<boolean>, ms = 15_000) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await check()) return;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error("timed out");
  }

  it("the I/O lane claims and finishes the recompute while an analysis holds the engine lane", async () => {
    const member = await world.member("paying", "wklane", "Asia/Kolkata");
    world.imp.upstream.addLichessMany("knightowl88", 8, IMPORT_T0 - 3_600_000, 6 * 3_600_000);
    await world.importAccount(member, "LICHESS", "knightowl88");
    await world.due(["ANALYZE_GAME"], member.id);
    assert.ok((await world.drainAnalysesOf(member.id)) >= 6);
    // Settle the import's own `import` trigger, so the kicked row below is the only due weakness work.
    await world.recompute(member.id);

    const ring = `wk:${k()},webwk:${k()},ws:${k()}`;
    const workerEnv = loadEnv({
      APP_ENV: "test",
      IMPORT_PAUSED: "on",
      WORKER_DATABASE_URL: env.workerUrl,
      INTERNAL_API_SECRET: ring,
      ENGINE: "fake",
      WORKER_ID: "int-wklane",
      PORT: "0",
      EVAL_CACHE: "off",
      EVAL_CACHE_PATH: join(mkdtempSync(join(tmpdir(), "wk-lane-")), "evals.sqlite"),
    });
    assert.equal(workerEnv.weakness.enabled, true);
    let release: () => void = () => undefined;
    const held = new Promise<void>((r) => (release = r));
    let analysisRunning = false;
    const blocking: JobHandler<"ANALYZE_GAME"> = {
      kind: "ANALYZE_GAME",
      async run() {
        analysisRunning = true;
        await held;
        return "done";
      },
    };
    const real = defaultHandlers({
      store: undefined as never,
      book: undefined as never,
      batch: undefined as never,
      events: noopProductEvents,
      weakness: {
        settings: defaultWeaknessSettings(),
        progress: new WeaknessProgressEmitter({ db: world.db, emitter: world.emitter, clock: world.clock, log: silentLogger, settings: defaultWeaknessSettings() }),
      },
    });
    const handlers: HandlerMap = { ANALYZE_GAME: blocking, RECOMPUTE_WEAKNESS: real.RECOMPUTE_WEAKNESS };
    const worker = await bootWorker(workerEnv, { log: silentLogger, handlers });
    try {
      assert.equal(worker.lane.paused, false, "IMPORT_PAUSED leaves the weakness kind on the lane");
      const game = (await world.inputs(member.id)).find((s) => s.accuracy !== null)!;
      const ref = (await world.q<{ ref: string }>(`SELECT "referenceId" AS ref FROM games WHERE id = $1`, [game.gameId]))[0]!.ref;
      await world.db.query(fromPrisma(enqueueAnalysisSql({ gameId: BigInt(game.gameId), gameRef: ref, priority: JOB_PRIORITY.USER_OPENED, reason: "regrade" })));
      await world.arm(member.id);
      const before = (await world.snapshots(member.id)).length;
      const body = JSON.stringify({ v: 1, reason: "test" });
      const keys = parseKeyRing(ring);
      const res = await fetch(`http://127.0.0.1:${worker.port}/internal/analysis/kick`, {
        method: "POST",
        headers: { ...signInternal({ keys, kid: "webwk", method: "POST", path: "/internal/analysis/kick", body, nowMs: Date.now() }), "content-type": "application/json" },
        body,
      });
      assert.equal(res.status, 202);
      await until(async () => analysisRunning);
      await until(async () => (await world.job(member.id))?.status === "DONE");
      const job = (await world.job(member.id))!;
      assert.ok(job.lockedBy?.startsWith("int-wklane-") && /i[12]$/.test(job.lockedBy), `an I/O slot finished it (${job.lockedBy})`);
      assert.ok(analysisRunning, "the analysis still holds the engine lane");
      const analysis = (await world.q<{ status: string }>(`SELECT status::text AS status FROM ${env.schema}.jobs WHERE "dedupeKey" = $1`, [`analyze:${game.gameId}`]))[0]!;
      assert.equal(analysis.status, "RUNNING");
      assert.ok((await world.snapshots(member.id)).length >= before);
    } finally {
      release();
      await worker.shutdown();
    }
  });
});
