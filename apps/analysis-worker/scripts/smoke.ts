// CLI of the post-deploy smoke (src/smoke.ts; phase-03 plan §12.8). Inside the worker container:
//
//   docker compose exec -T analysis-worker node dist/smoke.cjs [--ref <gameRef>]
//
// Locally (the worker running from source on :3003 with its dev env):
//
//   set -a; source .env.local-dev; set +a; tsx scripts/smoke.ts
//
// Reads the worker's own environment (WORKER_DATABASE_URL, INTERNAL_API_SECRET, PORT) through loadEnv, so it talks
// to exactly the database and worker it is deployed with. Exit 0 = every check held.
import { loadEnv, EnvError } from "../src/config/env";
import { createDb } from "../src/db/client";
import { runSmoke, SMOKE_GAME_REF } from "../src/smoke";

export function parseSmokeArgs(argv: readonly string[]): { ref: string } {
  let ref = SMOKE_GAME_REF;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--ref") {
      const v = argv[++i];
      if (!v || !/^[a-z0-9]{8,40}$/.test(v)) throw new Error("--ref needs a game reference");
      ref = v;
    } else {
      throw new Error(`unknown argument ${String(a)}`);
    }
  }
  return { ref };
}

async function main(): Promise<number> {
  let env;
  try {
    env = loadEnv(process.env);
  } catch (error) {
    process.stderr.write(
      `${JSON.stringify({ step: "env", ok: false, reason: error instanceof EnvError ? error.message : "invalid environment" })}\n`,
    );
    return 1;
  }
  const { ref } = parseSmokeArgs(process.argv.slice(2));
  const db = createDb({ url: env.databaseUrl, driver: env.dbDriver });
  try {
    const result = await runSmoke({ db, keys: env.acceptKeys, workerUrl: `http://127.0.0.1:${env.port}`, ref });
    return result.ok ? 0 : 1;
  } finally {
    await db.close();
  }
}

if (process.argv[1] && /smoke\.(c?js|ts)$/.test(process.argv[1])) {
  main().then(
    (code) => process.exit(code),
    (error: unknown) => {
      process.stderr.write(
        `${JSON.stringify({ step: "crash", ok: false, error: error instanceof Error ? error.message : String(error) })}\n`,
      );
      process.exit(1);
    },
  );
}
