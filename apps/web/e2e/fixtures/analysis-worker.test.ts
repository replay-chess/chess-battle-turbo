// The e2e analysis worker's environment (fixtures/analysis-worker.ts; phase-03 plan §12.3).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { e2eDatabaseIsLocal, ringKids, ringSignedBy, workerFaultsHonoured, workerRing, workerServerEnv } from "./analysis-worker";

const K = (c: string) => Buffer.alloc(32, c).toString("base64");
const RING = `web:${K("a")},ws:${K("b")},wk:${K("c")},webwk:${K("d")}`;
const LOCAL = "postgresql://postgres:pw@localhost:5432/replay";
const DEV = "postgresql://neondb_owner:pw@ep-fancy-dust-b8b3dp81.c-14.us-east-1.aws.neon.tech/neondb";

describe("e2e analysis worker", () => {
  it("reorders the run's ring so each process signs with its own kid", () => {
    assert.deepEqual(ringKids(ringSignedBy(RING, "wk")), ["wk", "web", "ws", "webwk"]);
    assert.deepEqual(ringKids(ringSignedBy(RING, "ws")), ["ws", "web", "wk", "webwk"]);
    assert.equal(ringSignedBy(RING, "ops"), RING, "a kid the ring lacks leaves it unchanged");
    assert.equal(ringSignedBy("bare-legacy-secret", "wk"), "bare-legacy-secret");
    assert.deepEqual(ringKids("bare-legacy-secret"), ["web"]);
  });

  // regression: worker-holds-web-key (FIX-1): the worker got the whole run ring, including the web's socket key.
  it("gives the worker only its own key and its callers' keys, never web or ops", () => {
    assert.deepEqual(ringKids(workerRing(`${RING},ops:${K("e")},opswk:${K("f")}`)), ["wk", "ws", "webwk", "opswk"]);
  });

  it("is a test worker with the fake engine against a local database, and honours kick faults there only", () => {
    const env = workerServerEnv({ env: { INTERNAL_API_SECRET: RING, DATABASE_URL: LOCAL, E2E_WORKER_DATABASE_URL: LOCAL.replace("postgres:pw", "replay_worker:pw") } });
    assert.equal(env.APP_ENV, "test");
    assert.equal(env.ENGINE, "fake");
    assert.equal(env.EVAL_CACHE, "off");
    assert.match(env.WORKER_DATABASE_URL!, /^postgresql:\/\/replay_worker:/);
    assert.deepEqual(ringKids(env.INTERNAL_API_SECRET), ["wk", "ws", "webwk"]);
    assert.equal(env.WS_INTERNAL_URL, "http://127.0.0.1:3002");
    assert.equal(env.SENTRY_DSN, "");
    assert.equal(workerFaultsHonoured({ DATABASE_URL: LOCAL }), true);
    assert.equal(e2eDatabaseIsLocal({ DIRECT_URL: DEV, DATABASE_URL: LOCAL }), false, "DIRECT_URL wins, as in global setup");
  });

  it("is a dev worker (the real engine, no kick faults) against the Neon dev branch", () => {
    const env = workerServerEnv({ env: { INTERNAL_API_SECRET: RING, DATABASE_URL: DEV, E2E_WORKER_DATABASE_URL: DEV.replace("neondb_owner", "replay_worker"), ENGINE_PATH: "/opt/sf" } });
    assert.equal(env.APP_ENV, "dev");
    assert.equal(env.ENGINE, "stockfish");
    assert.equal(env.ENGINE_PATH, "/opt/sf");
    assert.equal(workerFaultsHonoured({ DATABASE_URL: DEV }), false);
  });

  it("refuses any other database and, when strict, a ring without the worker's key", () => {
    assert.throws(() => workerServerEnv({ env: { INTERNAL_API_SECRET: RING, DATABASE_URL: LOCAL, E2E_WORKER_DATABASE_URL: "postgresql://u:p@db.example.com/x" } }), /refusing/);
    assert.throws(() => workerServerEnv({ strict: true, env: { INTERNAL_API_SECRET: `web:${K("a")}`, DATABASE_URL: LOCAL } }), /wk/);
  });
});
