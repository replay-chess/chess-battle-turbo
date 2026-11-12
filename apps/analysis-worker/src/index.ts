// The analysis worker (phase-03 plan §8.12, work package C): one Node process on the OCI dev box that claims `jobs`
// rows, grades games with native Stockfish 18 at profile `sf18-v1` and writes the results to Neon over HTTP.
// The process entry is ./main.ts; this module is the package surface (tests, scripts, later handlers).
export { WORKER_VERSION } from "./version";
export { bootWorker, type RunningWorker, type WorkerOverrides } from "./boot";
export { loadEnv, EnvError, type WorkerEnv } from "./config/env";
