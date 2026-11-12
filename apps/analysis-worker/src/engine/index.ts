// Builds the worker's engine from the environment: native Stockfish (the image's /usr/local/bin/stockfish) or the
// in-process FakeEngine (APP_ENV=test only).
//
// The build id that goes into `game_analyses.engine` comes from `<ENGINE_PATH>.build-id`, which the worker image
// writes at build time (Dockerfile: "sf18-armv8dp-<first 8 hex of the main NNUE net>"). A binary without one (a
// local build) is "sf18-local"; analysisEngine() (CA/src/version.ts) appends the profile.
import { existsSync, readFileSync } from "node:fs";
import type { WorkerEnv } from "../config/env";
import type { Logger } from "../obs/log";
import { FakeEngine } from "./fake";
import type { Engine } from "./types";
import { UciEngine } from "./uci";

const BUILD_ID = /^[a-z0-9][a-z0-9._-]{0,38}$/i;

export function engineBuildId(path: string): string {
  const file = `${path}.build-id`;
  if (existsSync(file)) {
    const id = readFileSync(file, "utf8").trim();
    if (!BUILD_ID.test(id)) throw new Error(`${file} does not hold a valid build id`);
    return id;
  }
  return "sf18-local";
}

export function engineFactory(env: WorkerEnv, log: Logger): () => Engine {
  if (env.engine.kind === "fake") return () => new FakeEngine();
  const buildId = engineBuildId(env.engine.path);
  return () =>
    new UciEngine({
      path: env.engine.path,
      threads: env.engine.threads,
      hashMb: env.engine.hashMb,
      buildId,
      nice: env.engine.nice,
      log: log.child({ component: "engine" }),
    });
}

export { EnginePool } from "./pool";
export type { EngineState } from "./pool";
export * from "./types";
