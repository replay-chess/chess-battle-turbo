// Process entry of the analysis worker (`node dist/main.cjs` in the image, `tsx src/main.ts` locally with an explicit
// env file: `set -a; source .env.local-dev; set +a; pnpm --filter analysis-worker dev`). A refused environment exits
// 1 before anything starts (§8.12 boot guards, TST X12); SIGTERM/SIGINT drain and exit 0.
import { bootWorker } from "./boot";
import { EnvError, loadEnv } from "./config/env";

async function main(): Promise<void> {
  let env;
  try {
    env = loadEnv(process.env);
  } catch (error) {
    const message = error instanceof EnvError ? error.message : "invalid environment";
    process.stderr.write(`${JSON.stringify({ level: "error", msg: "worker refused to boot", reason: message })}\n`);
    process.exit(1);
  }
  const worker = await bootWorker(env);
  let signalled = false;
  const onSignal = (signal: NodeJS.Signals) => {
    if (signalled) return;
    signalled = true;
    process.stdout.write(`${JSON.stringify({ level: "info", msg: "signal", signal })}\n`);
    worker.shutdown().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  };
  process.on("SIGTERM", onSignal);
  process.on("SIGINT", onSignal);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  process.stderr.write(`${JSON.stringify({ level: "error", msg: "worker crashed at boot", error: message })}\n`);
  process.exit(1);
});
