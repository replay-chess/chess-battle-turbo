/**
 * Mints the protocol-v2 k6 manifest (phase-02 plan 12.8): creates N fixture games (G-THREEFOLD: initial position,
 * 5+0, no study) between pairs of members through the app's own writers, and mints a socket token for each seat with
 * the target server's SOCKET_TOKEN_SECRET. k6 never holds a key. Tokens live 15 minutes: run right before k6.
 *
 *   cd apps/web && set -a && . ./.env.test && set +a && cd ../../perf/k6
 *   npx tsx setup/v2-manifest.ts --games 25 --ws ws://localhost:3002 --env test --out setup/v2-manifest.json
 *
 * Players: --users <email|ref,…> (≥ 2), default the E2E members A–P (E2E_USER_<L>_EMAIL). Guards: the database must
 * be a local Postgres or the Neon dev endpoint (the seed guards); --env must match the socket's APP_ENV. The output
 * holds live tokens: it is gitignored (perf/k6/setup/*.json) and never printed.
 */
import { writeFileSync } from "node:fs";
import { mintSocketToken, parseSocketKeyRing } from "../../../packages/contracts/src/socket/token.ts";
import { PrismaClient } from "../../../packages/db/src/index.ts";
import { assertFixtureTarget, resolveFixtureUser, seedGameFixture } from "../../../apps/web/scripts/dev/seed-game-fixtures.ts";

function arg(name: string, fallback?: string): string {
  const i = process.argv.indexOf(`--${name}`);
  const v = i >= 0 ? process.argv[i + 1] : fallback;
  if (v === undefined) throw new Error(`--${name} is required`);
  return v;
}

async function main() {
  const games = Number(arg("games", "25"));
  const wsUrl = arg("ws", "ws://localhost:3002");
  const env = arg("env", "test") as "test" | "dev" | "local";
  const out = arg("out", "setup/v2-manifest.json");
  if (!["test", "dev", "local"].includes(env)) throw new Error("--env must be test, dev or local (never production)");
  const users = (process.argv.includes("--users") ? arg("users") : "ABCDEFGHIJKLMNOP".split("").map((l) => process.env[`E2E_USER_${l}_EMAIL`]).filter(Boolean).join(","))
    .split(",")
    .filter(Boolean);
  if (users.length < 2) throw new Error("need at least two players (--users or E2E_USER_<L>_EMAIL)");
  const keys = parseSocketKeyRing(process.env.SOCKET_TOKEN_SECRET);
  const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
  console.log(`[v2-manifest] database ${assertFixtureTarget(url)}; ${games} games; ${users.length} players; socket ${wsUrl}`);

  const db = new PrismaClient({ datasourceUrl: url });
  try {
    const people = await Promise.all(users.map((u) => resolveFixtureUser(db, u)));
    const now = Date.now();
    const ent = Math.floor(now / 1000) + 30 * 24 * 3600;
    const token = (p: (typeof people)[number]) => mintSocketToken({ sub: p.ref, env, ent, role: "user", name: p.name.slice(0, 40) }, keys, now);
    const list = [];
    for (let i = 0; i < games; i++) {
      const white = people[(2 * i) % people.length]!;
      let black = people[(2 * i + 1) % people.length]!;
      if (black.id === white.id) black = people[(2 * i + 2) % people.length]!;
      const g = await seedGameFixture(db, "G-THREEFOLD", { white, black });
      list.push({ ref: g.ref, white: { ref: white.ref, token: token(white).token }, black: { ref: black.ref, token: token(black).token } });
    }
    writeFileSync(out, JSON.stringify({ wsUrl, expiresAt: Math.floor(now / 1000) + 15 * 60, games: list }), { mode: 0o600 });
    console.log(`[v2-manifest] wrote ${list.length} games to ${out} (tokens not shown)`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((e) => {
  console.error(`[v2-manifest] ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
