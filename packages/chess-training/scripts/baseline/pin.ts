// The engine pin (phase-06 plan §7.4.5 step 4 "Pinning", FE 10.12.4; P6 interface check §8): the baseline is graded by
// the same Stockfish the worker grades with, or not at all. The script refuses to run unless
//   - the worker's Dockerfile still builds the pinned source (SF_TAG / SF_COMMIT);
//   - the binary's sha256 is the worker image's binary (linux/arm64, `make profile-build ARCH=armv8-dotprod COMP=gcc`);
//   - inside the image, BUILD_INFO names that commit and both NNUE nets with their sha256;
//   - the running engine says "Stockfish 18", loads both nets by their hash-named files, and its `bench` signature
//     (nodes searched, a functional fingerprint of source + nets) is the pinned one;
//   - ENGINE_PROFILE (CA version.ts) is still `sf18-v1` with the settings the pin was recorded for.
// A refresh after a worker engine change updates ENGINE_PIN here in the same PR (runbook: "Engine changed").
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ENGINE_PROFILE } from "@repo/chess-analysis/version";
import type { EngineSpec, UciEngine } from "./engine";

const WORKER_DOCKERFILE = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../apps/analysis-worker/Dockerfile");

/** The worker's engine (recorded 2026-11-17 from the worker image built from apps/analysis-worker/Dockerfile). */
export const ENGINE_PIN = {
  engine: "Stockfish 18",
  tag: "sf_18",
  commit: "cb3d4ee9b47d0c5aae855b12379378ea1439675c",
  nets: {
    big: { file: "nn-c288c895ea92.nnue", sha256: "c288c895ea924429ea9092e3f36b2b3c1f00f2a3a4c759ff7e57e79e3b43e4a7" },
    small: { file: "nn-37f18f62d772.nnue", sha256: "37f18f62d772f3107e1d6aaca3898c130c3c86f2ab63e6555fbbca20635a899d" },
  },
  /** `bench` with default arguments: "Nodes searched". */
  benchNodes: 2_050_811,
  /** The worker image's binary (linux/arm64). */
  binarySha256: "f4a308b1b65544dfa43f52bceb8fed4980e01b3db7555804bcdb41f7520b586c",
  buildId: "sf18-armv8dp-c288c895",
  /** The profile and settings this pin was recorded with (ENGINE_PROFILE must still say so). */
  profile: { id: "sf18-v1", threads: 1, hashMb: 64, pass1: { nodes: 120_000, multipv: 2 } },
} as const;

export interface PinFacts {
  engine: string;
  tag: string;
  commit: string;
  binarySha256: string;
  buildId: string;
  nets: { big: string; small: string };
  benchNodes: number;
  profile: string;
  pass1: { nodes: number; multipv: number };
  threads: number;
  hashMb: number;
  runner: string;
}

export class PinError extends Error {
  constructor(message: string) {
    super(`engine pin: ${message}`);
    this.name = "PinError";
  }
}

function expect(cond: boolean, message: string): void {
  if (!cond) throw new PinError(message);
}

/** The profile half of the pin (pure). */
export function checkProfile(profile: typeof ENGINE_PROFILE = ENGINE_PROFILE): void {
  const p = ENGINE_PIN.profile;
  expect(profile.id === p.id, `ENGINE_PROFILE is "${profile.id}", the pin was recorded for "${p.id}"`);
  expect(profile.threads === p.threads && profile.hashMb === p.hashMb, "ENGINE_PROFILE threads / hash differ from the pin");
  expect(profile.pass1.nodes === p.pass1.nodes && profile.pass1.multipv === p.pass1.multipv, "ENGINE_PROFILE pass 1 differs from the pin");
}

/** The worker Dockerfile's SF_TAG / SF_COMMIT (pure on the file's text). */
export function dockerfilePin(text: string): { tag: string | null; commit: string | null } {
  return {
    tag: /^ARG SF_TAG=(\S+)$/m.exec(text)?.[1] ?? null,
    commit: /^ARG SF_COMMIT=([0-9a-f]{40})$/m.exec(text)?.[1] ?? null,
  };
}

/** BUILD_INFO lines → commit, nets and binary hash (pure). */
export function parseBuildInfo(text: string): { commit: string | null; big: string | null; small: string | null; binary: string | null } {
  return {
    commit: /commit ([0-9a-f]{40})/.exec(text)?.[1] ?? null,
    big: /net big: (\S+) sha256 ([0-9a-f]{64})/.exec(text)?.slice(1, 3).join(" ") ?? null,
    small: /net small: (\S+) sha256 ([0-9a-f]{64})/.exec(text)?.slice(1, 3).join(" ") ?? null,
    binary: /binary sha256: ([0-9a-f]{64})/.exec(text)?.[1] ?? null,
  };
}

/** The file half of the pin: Dockerfile, binary hash and (Docker) BUILD_INFO. */
export function checkFiles(spec: EngineSpec): { binarySha256: string; buildId: string } {
  checkProfile();
  const df = dockerfilePin(readFileSync(WORKER_DOCKERFILE, "utf8"));
  expect(df.tag === ENGINE_PIN.tag && df.commit === ENGINE_PIN.commit, `the worker Dockerfile builds ${df.tag}@${df.commit}, the pin is ${ENGINE_PIN.tag}@${ENGINE_PIN.commit}`);
  if (spec.kind === "local") {
    const sha = createHash("sha256").update(readFileSync(spec.path)).digest("hex");
    expect(sha === ENGINE_PIN.binarySha256, `ENGINE_PATH sha256 ${sha} is not the worker's binary ${ENGINE_PIN.binarySha256}`);
    return { binarySha256: sha, buildId: ENGINE_PIN.buildId };
  }
  const out = execFileSync(
    "docker",
    ["run", "--rm", "--platform", "linux/arm64", "--network", "none", spec.image, "sh", "-c", `sha256sum ${spec.binary}; cat /out/doc/BUILD_INFO; cat /out/stockfish.build-id`],
    { encoding: "utf8" },
  );
  const sha = /^([0-9a-f]{64})\s/m.exec(out)?.[1] ?? "";
  expect(sha === ENGINE_PIN.binarySha256, `the image binary sha256 ${sha} is not the worker's binary ${ENGINE_PIN.binarySha256}`);
  const info = parseBuildInfo(out);
  expect(info.commit === ENGINE_PIN.commit, `BUILD_INFO commit ${info.commit}`);
  expect(info.big === `${ENGINE_PIN.nets.big.file} ${ENGINE_PIN.nets.big.sha256}`, `BUILD_INFO big net ${info.big}`);
  expect(info.small === `${ENGINE_PIN.nets.small.file} ${ENGINE_PIN.nets.small.sha256}`, `BUILD_INFO small net ${info.small}`);
  expect(info.binary === ENGINE_PIN.binarySha256, `BUILD_INFO binary ${info.binary}`);
  const buildId = out.trim().split("\n").pop()?.trim() ?? "";
  expect(buildId === ENGINE_PIN.buildId, `build id ${buildId}`);
  return { binarySha256: sha, buildId };
}

/** The running half: id, nets loaded, bench signature. `engine` must be started (and is used for one search). */
export async function checkRunning(engine: UciEngine): Promise<number> {
  expect(engine.id === ENGINE_PIN.engine, `the engine says "${engine.id}"`);
  await engine.search({ fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1", moves: [], nodes: 1000, multipv: 1 });
  const nets = engine.infoStrings.join("\n");
  expect(nets.includes(`NNUE evaluation using ${ENGINE_PIN.nets.big.file}`), "the big net was not loaded by name");
  expect(nets.includes(`NNUE evaluation using ${ENGINE_PIN.nets.small.file}`), "the small net was not loaded by name");
  const bench = await engine.bench();
  expect(bench === ENGINE_PIN.benchNodes, `bench signature ${bench}, the pin is ${ENGINE_PIN.benchNodes}`);
  return bench;
}

/** The facts v1.meta.json records. */
export function pinFacts(files: { binarySha256: string; buildId: string }, bench: number, spec: EngineSpec): PinFacts {
  return {
    engine: ENGINE_PIN.engine,
    tag: ENGINE_PIN.tag,
    commit: ENGINE_PIN.commit,
    binarySha256: files.binarySha256,
    buildId: files.buildId,
    nets: { big: ENGINE_PIN.nets.big.sha256, small: ENGINE_PIN.nets.small.sha256 },
    benchNodes: bench,
    profile: ENGINE_PROFILE.id,
    pass1: { nodes: ENGINE_PROFILE.pass1.nodes, multipv: ENGINE_PROFILE.pass1.multipv },
    threads: ENGINE_PROFILE.threads,
    hashMb: ENGINE_PROFILE.hashMb,
    runner: spec.kind === "docker" ? `docker linux/arm64 (${spec.image})` : "local binary",
  };
}
