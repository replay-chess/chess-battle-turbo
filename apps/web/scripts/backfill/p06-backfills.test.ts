// The Phase 6 backfills' pure parts and guards (phase-06 plan 6.6; B-W3's are in p06-recompute.test.ts): the
// statements' shapes, the time-pressure rule they share with J1, the signed kick, and that every script refuses a database host outside
// BACKFILL_ALLOWED_HOSTS before it opens a connection (the scripts run as child processes, as an operator runs them).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { HEADER_KID } from "@repo/contracts/internal/auth";
import { WEAKNESS_INPUTS_VERSION } from "@repo/chess-analysis/weakness-inputs";
import { candidatesSql, inputsEligibleSql, writeInputsSql } from "./backfill-weakness-inputs";
import { TIME_PRESSURE_THEME, occurrencesSql, tagSql, underAMinute } from "./backfill-mistake-timepressure";
import { kickWeakness, memberScopeSql } from "./p06-common";

const HERE = path.dirname(fileURLToPath(import.meta.url));

describe("B-W1 statements", () => {
  it("selects analysed sides at version 0 with their game and analysis, in (gameId, userId) order", () => {
    const sql = candidatesSql({ gameId: 7n, userId: 9n }, 500);
    assert.match(sql.text, /gp\.accuracy IS NOT NULL AND gp\."weaknessInputsV" = 0/);
    assert.match(sql.text, /JOIN game_analyses ga ON ga\."gameId" = gp\."gameId"/);
    assert.match(sql.text, /\(gp\."gameId", gp\."userId"\) > \(\$\d+::bigint, \$\d+::bigint\)/);
    assert.match(sql.text, /ORDER BY gp\."gameId", gp\."userId"/);
    assert.deepEqual(sql.values.slice(0, 2), ["7", "9"]);
    assert.ok(sql.values.includes(500));
    assert.match(inputsEligibleSql({ userIds: [3n] }).text, /gp\."userId" = ANY\(\$\d+::bigint\[\]\)/);
  });

  it("writes the five columns once, guarded by version 0, without touching updatedAt", () => {
    const sql = writeInputsSql([
      { gameId: 1n, userId: 2n, inputs: { stats: [1], errorLog: [5284], errorThemeN: [1], errorThemes: ["fork"] } },
    ]);
    assert.match(sql.text, /jsonb_to_recordset\(\$2::jsonb\)/);
    assert.match(sql.text, /AND gp\."weaknessInputsV" = 0$/m);
    assert.doesNotMatch(sql.text, /updatedAt/);
    assert.ok(sql.values.includes(WEAKNESS_INPUTS_VERSION));
    assert.equal(sql.values[0], WEAKNESS_INPUTS_VERSION);
    assert.deepEqual(JSON.parse(sql.values[1] as string), [
      { gameId: "1", userId: "2", stats: [1], errorThemes: ["fork"], errorLog: [5284], errorThemeN: [1] },
    ]);
  });
});

describe("B-W2 statements and rule", () => {
  it("scans untagged mistakes' occurrences by (gameId, ply) and appends the tag at most once", () => {
    const scan = occurrencesSql({ gameId: 0n, ply: -1 }, 500);
    assert.match(scan.text, /NOT \(\$1 = ANY\(m\.themes\)\)/);
    assert.equal(scan.values[0], TIME_PRESSURE_THEME);
    assert.match(scan.text, /\(o\."gameId", o\.ply\) > \(\$\d+::bigint, \$\d+::int\)/);
    const tag = tagSql([4n, 5n]);
    assert.match(tag.text, /array_append\(themes, \$1\)/);
    assert.match(tag.text, /AND NOT \(\$3 = ANY\(themes\)\)/);
    assert.deepEqual(tag.values, [TIME_PRESSURE_THEME, ["4", "5"], TIME_PRESSURE_THEME]);
  });

  it("tags a ply played with under a minute on the member's clock (the clock before the move), nothing untimed", () => {
    const g = { gameId: 1n, mistakeId: 1n, moveClocksMs: [181_000, 180_500, 61_000, 59_999, 70_000], initialTimeSeconds: 180, timeClass: "BLITZ" };
    // Ply 4 is White's: its clock before the move is White's clock after ply 2 (61 s); ply 5 reads 59.999 s.
    assert.equal(underAMinute({ ...g, ply: 4 }), false);
    assert.equal(underAMinute({ ...g, ply: 5 }), true);
    assert.equal(underAMinute({ ...g, ply: 0 }), false);
    assert.equal(underAMinute({ ...g, ply: 5, timeClass: "DAILY" }), false);
    assert.equal(underAMinute({ ...g, ply: 5, moveClocksMs: null }), false);
  });
});

describe("kickWeakness", () => {
  const k = () => randomBytes(32).toString("base64");

  it("is skipped without a worker URL or an opswk key", async () => {
    assert.match(await kickWeakness({}), /no kick/);
    assert.match(await kickWeakness({ ANALYSIS_WORKER_URL: "http://127.0.0.1:3003", INTERNAL_API_SECRET: `web:${k()}` }), /no kick/);
  });

  it("signs with opswk, names the RECOMPUTE_WEAKNESS lane and always carries runAt", async () => {
    let seen: { url: string; headers: Record<string, string>; body: string } | null = null;
    const fetchImpl = (async (url: URL, init: RequestInit) => {
      seen = { url: String(url), headers: init.headers as Record<string, string>, body: String(init.body) };
      return new Response(null, { status: 202 });
    }) as unknown as typeof fetch;
    const now = Date.UTC(2026, 10, 17, 21);
    const out = await kickWeakness({ ANALYSIS_WORKER_URL: "http://127.0.0.1:3003", INTERNAL_API_SECRET: `opswk:${k()}` }, fetchImpl, now);
    assert.equal(out, "kick → 127.0.0.1:3003: HTTP 202");
    const s = seen as unknown as { url: string; headers: Record<string, string>; body: string };
    assert.match(s.url, /\/internal\/analysis\/kick$/);
    assert.deepEqual(JSON.parse(s.body), { v: 1, reason: "backfill", kinds: ["RECOMPUTE_WEAKNESS"], runAt: new Date(now).toISOString() });
    assert.equal(s.headers[HEADER_KID], "opswk");
  });

  it("member scope is a bound id list on the alias", () => {
    assert.equal(memberScopeSql("gp", null).text, "");
    const s = memberScopeSql("m", [1n, 2n]);
    assert.match(s.text, /AND m\."userId" = ANY\(\$1::bigint\[\]\)/);
    assert.deepEqual(s.values, [["1", "2"]]);
  });
});

describe("the host guard (every script, run as an operator runs it)", () => {
  for (const script of ["backfill-weakness-inputs.ts", "backfill-mistake-timepressure.ts"]) {
    it(`${script} refuses a host outside BACKFILL_ALLOWED_HOSTS before connecting`, () => {
      const r = spawnSync(process.execPath, ["--import", "tsx", path.join(HERE, script), "--apply"], {
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
  }
});
