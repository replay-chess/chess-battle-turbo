// B-W3 enqueue-weakness-recompute (phase-06 plan 6.6, 7.4.1): the candidate rule, the 30-minute spread and the host
// guard. Its Postgres run is in p06-backfills.int.test.ts.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { SPREAD_SEC, candidateIdsSql, spreadRunAt } from "./enqueue-weakness-recompute";

const HERE = path.dirname(fileURLToPath(import.meta.url));

describe("B-W3", () => {
  it("spreads runAt over 30 minutes, stably per member", () => {
    const now = new Date("2026-11-17T21:00:00.000Z");
    for (const id of [1n, 1799n, 1800n, 123456789n]) {
      const at = spreadRunAt(id, now).getTime() - now.getTime();
      assert.ok(at >= 0 && at < SPREAD_SEC * 1000, `${id}: ${at}`);
      assert.equal(spreadRunAt(id, now).getTime(), spreadRunAt(id, now).getTime());
    }
    assert.equal(spreadRunAt(1800n, now).getTime(), now.getTime());
  });

  it("selects members with enough analysed human games, an old or missing snapshot and no pending job", () => {
    const sql = candidateIdsSql(0n, 500, { userIds: [5n] });
    assert.match(sql.text, /gp\.mode NOT IN \('BOT', 'LEGEND_BOT'\)/);
    assert.match(sql.text, /gp\.result IS DISTINCT FROM 'ABORTED'/);
    assert.match(sql.text, /ORDER BY ws\."weekStart" DESC LIMIT 1\), 0\) < \$\d+/);
    assert.match(sql.text, /j\."dedupeKey" = 'weakness:' \|\| u\.id::text AND j\.status IN \('QUEUED', 'RUNNING'\)/);
    assert.match(sql.text, /u\.id = ANY\(\$\d+::bigint\[\]\)/);
  });
});


describe("the host guard", () => {
  it("enqueue-weakness-recompute.ts refuses a host outside BACKFILL_ALLOWED_HOSTS before connecting", () => {
    const r = spawnSync(process.execPath, ["--import", "tsx", path.join(HERE, "enqueue-weakness-recompute.ts"), "--apply"], {
      cwd: path.resolve(HERE, "../.."),
      env: {
        NODE_ENV: "test",
        PATH: process.env.PATH ?? "",
        DIRECT_URL: "postgresql://someone:secret@db.production.example.com:5432/neondb",
        BACKFILL_ALLOWED_HOSTS: "other-host.example.com",
      },
      encoding: "utf8",
      timeout: 60_000,
    });
    assert.equal(r.status, 1, r.stderr);
    assert.match(r.stderr, /refusing: database host db\.production\.example\.com is not in BACKFILL_ALLOWED_HOSTS/);
    assert.doesNotMatch(r.stderr + r.stdout, /secret/, "the URL's password is never printed");
  });
});
