// regression: nightly-check-email-grant (FIX-1). The nightly `weakness-recompute-check` connects as replay_worker
// (nightly.yml DEV_WORKER_DATABASE_URL), which may read users.id and "referenceId" but never users.email
// (replay_worker.p6.sql asserts it). The check looked its user up by email, so every run failed with "permission denied".
// Against the real role (TEST_WORKER_DATABASE_URL, the CI role order): the old email lookup is refused, the ref lookup
// the script now uses finds the member. Skipped without TEST_DATABASE_URL.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { stmt } from "../db/client";
import { userIdOf } from "../../scripts/nightly-weakness-check";
import { setupInt, skipInt, type IntEnv } from "../testing/pg";
import { WeaknessWorld, worldTag } from "../testing/weakness-world";

describe("nightly weakness check: the user lookup as replay_worker (Postgres)", { skip: skipInt }, () => {
  let env: IntEnv;
  let world: WeaknessWorld;

  before(async () => {
    env = await setupInt("wknightly");
    world = new WeaknessWorld(env, worldTag());
  });
  after(async () => {
    await world?.close();
    await env?.close();
  });

  it("finds the member by reference id; an email lookup is not what the role may run", async () => {
    const m = await world.member("paying", "wknightly", "Asia/Kolkata");
    assert.equal(await userIdOf(env.db, m.ref), m.id);
    assert.equal(await userIdOf(env.db, "cwnosuchref00000000000"), undefined);
    const role = (await env.db.query(stmt(`SELECT current_user AS u`, [])))[0]!.u;
    // CI and the local suites connect the worker as replay_worker (TEST_WORKER_DATABASE_URL); only then is the grant real.
    if (process.env.TEST_WORKER_DATABASE_URL) assert.equal(role, "replay_worker");
    if (role === "replay_worker") {
      await assert.rejects(env.db.query(stmt(`SELECT id FROM users WHERE lower(email) = lower($1)`, ["x@y.dev"])), /permission denied/);
    }
  });
});
