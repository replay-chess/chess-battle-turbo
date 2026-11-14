import assert from "node:assert/strict";
import { test } from "node:test";
import { setResumeUrl } from "./resume-url";

test("the resume URL is written with null state, so Next.js syncs its router to ?s=<ref>", () => {
  const calls: unknown[][] = [];
  const history = { replaceState: (...args: unknown[]) => void calls.push(args) };
  setResumeUrl("/train/puzzles?s=cmwfgph9y0di8u4dz0jvbwzfp", history);
  assert.deepEqual(calls, [[null, "", "/train/puzzles?s=cmwfgph9y0di8u4dz0jvbwzfp"]]);
});

test("the runner never passes window.history.state (Next skips a call whose state carries __NA)", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../../components/train/runner/TrainerRunner.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(src, /replaceState\(\s*window\.history\.state/);
  assert.match(src, /setResumeUrl\(/);
});
