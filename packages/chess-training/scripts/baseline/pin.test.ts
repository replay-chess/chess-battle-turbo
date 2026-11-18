// The J5 engine pin and UCI parsing (phase-06 plan §7.4.5 step 4, FE 10.12.4). Pure parts only: the pin constants
// against the worker's real Dockerfile and the CA engine profile, BUILD_INFO parsing, and the worker's `info` line
// rules. The live checks (binary sha256, nets loaded, bench signature) run in `build-baseline.ts --pin-check` against
// the worker's image; their results are recorded in baselines/v1.meta.json and checked by baselines.test.ts.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { ENGINE_PROFILE } from "@repo/chess-analysis/version";
import { collectLines, engineCommand, parseInfoLine } from "./engine";
import { ENGINE_PIN, PinError, checkProfile, dockerfilePin, parseBuildInfo } from "./pin";

const here = dirname(fileURLToPath(import.meta.url));

describe("J5 engine pin", () => {
  it("pins the source the worker's Dockerfile builds", () => {
    const df = dockerfilePin(readFileSync(resolve(here, "../../../../apps/analysis-worker/Dockerfile"), "utf8"));
    assert.deepEqual(df, { tag: ENGINE_PIN.tag, commit: ENGINE_PIN.commit });
  });

  it("pins the worker's engine profile, and refuses another one", () => {
    assert.doesNotThrow(() => checkProfile());
    assert.equal(ENGINE_PIN.profile.id, ENGINE_PROFILE.id);
    assert.throws(() => checkProfile({ ...ENGINE_PROFILE, id: "sf18-v2" } as unknown as typeof ENGINE_PROFILE), PinError);
    assert.throws(() => checkProfile({ ...ENGINE_PROFILE, pass1: { nodes: 80_000, multipv: 2 } } as unknown as typeof ENGINE_PROFILE), /pass 1/);
    assert.throws(() => checkProfile({ ...ENGINE_PROFILE, hashMb: 128 } as unknown as typeof ENGINE_PROFILE), /hash/);
  });

  it("the net files are named after their sha256 (Stockfish's own convention)", () => {
    for (const net of Object.values(ENGINE_PIN.nets)) assert.equal(net.file, `nn-${net.sha256.slice(0, 12)}.nnue`);
    assert.ok(ENGINE_PIN.buildId.endsWith(ENGINE_PIN.nets.big.sha256.slice(0, 8)));
  });

  it("parses the image's BUILD_INFO", () => {
    const text = [
      `source: https://github.com/official-stockfish/Stockfish tag sf_18 commit ${ENGINE_PIN.commit}`,
      "build: make profile-build ARCH=armv8-dotprod COMP=gcc (gcc (Debian 12.2.0-14+deb12u1) 12.2.0)",
      `net big: ${ENGINE_PIN.nets.big.file} sha256 ${ENGINE_PIN.nets.big.sha256}`,
      `net small: ${ENGINE_PIN.nets.small.file} sha256 ${ENGINE_PIN.nets.small.sha256}`,
      `binary sha256: ${ENGINE_PIN.binarySha256}`,
      `build id: ${ENGINE_PIN.buildId}`,
    ].join("\n");
    assert.deepEqual(parseBuildInfo(text), {
      commit: ENGINE_PIN.commit,
      big: `${ENGINE_PIN.nets.big.file} ${ENGINE_PIN.nets.big.sha256}`,
      small: `${ENGINE_PIN.nets.small.file} ${ENGINE_PIN.nets.small.sha256}`,
      binary: ENGINE_PIN.binarySha256,
    });
  });

  it("reads info lines by the worker's rules: the last exact line per MultiPV, bounds and strings ignored", () => {
    const lines = [
      "info string NNUE evaluation using nn-c288c895ea92.nnue",
      "info depth 10 seldepth 14 multipv 1 score cp 31 nodes 9000 nps 900000 pv e2e4 e7e5",
      "info depth 10 seldepth 12 multipv 2 score cp 20 nodes 9000 nps 900000 pv d2d4",
      "info depth 11 seldepth 15 multipv 1 score cp 40 lowerbound nodes 12000 pv e2e4",
      "info depth 11 seldepth 15 multipv 1 score mate 3 wdl 1000 0 0 nodes 15000 nps 1 pv e2e4 e7e5 d1h5",
      "info depth 11 currmove e2e4 currmovenumber 1",
    ];
    assert.equal(parseInfoLine(lines[0]!), null);
    assert.equal(parseInfoLine(lines[3]!), null);
    assert.equal(parseInfoLine(lines[5]!), null);
    const got = collectLines(lines);
    assert.deepEqual(
      got.map((l) => [l.multipv, l.depth, l.score, l.pv.join(" ")]),
      [
        [1, 11, { mate: 3 }, "e2e4 e7e5 d1h5"],
        [2, 10, { cp: 20 }, "d2d4"],
      ],
    );
  });

  it("runs the image's binary in an isolated one-CPU container", () => {
    const { cmd, args } = engineCommand({ kind: "docker", image: "img:tag", binary: "/out/stockfish" }, "n1");
    assert.equal(cmd, "docker");
    assert.deepEqual(args.slice(-2), ["img:tag", "/out/stockfish"]);
    for (const a of ["--rm", "-i", "--network", "none", "--cpus", "1"]) assert.ok(args.includes(a), a);
  });
});
