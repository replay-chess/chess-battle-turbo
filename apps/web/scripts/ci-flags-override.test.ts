// A CI job that sets FLAGS_OVERRIDE must also switch the test hooks on, or the override is silently ignored
// (lib/env-server.ts testHooksEnabled: NEXT_PUBLIC_APP_ENV dev|test AND ALLOW_TEST_HOOKS=1; lib/flags/index.ts).
// regression: devices-p5-flags-ignored (CI 43599091643): devices-p5 set `train:on,home:on` without ALLOW_TEST_HOOKS, so
// the build served the flags' off defaults (/train 404, /home → /play); local runs passed because .env.test sets it.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const WORKFLOWS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../.github/workflows");

/** Each job's own `env:` block (the lines indented under `    env:` up to the next key at that level). */
function jobEnvs(yml: string): { job: string; env: string }[] {
  const out: { job: string; env: string }[] = [];
  const jobs = yml.split(/\n(?= {2}[\w-]+:\n)/);
  for (const block of jobs) {
    const name = /^ {2}([\w-]+):\n/.exec(block)?.[1];
    if (!name) continue;
    const env = /\n {4}env:\n((?: {6}.*\n|\s*#.*\n|\s*\n)*)/.exec(block)?.[1] ?? "";
    out.push({ job: name, env });
  }
  return out;
}

describe("CI flag overrides", () => {
  it("every job that sets FLAGS_OVERRIDE turns the test hooks on (else the override is ignored)", () => {
    const offenders: string[] = [];
    for (const file of readdirSync(WORKFLOWS).filter((f) => f.endsWith(".yml"))) {
      for (const { job, env } of jobEnvs(readFileSync(path.join(WORKFLOWS, file), "utf8"))) {
        if (!/^\s+FLAGS_OVERRIDE:/m.test(env)) continue;
        const hooks = /^\s+ALLOW_TEST_HOOKS:\s*"?1"?\s*$/m.test(env);
        const appEnv = /^\s+NEXT_PUBLIC_APP_ENV:\s*"?(test|dev)"?\s*$/m.test(env);
        if (!hooks || !appEnv) offenders.push(`${file} ${job}${hooks ? "" : " (no ALLOW_TEST_HOOKS: \"1\")"}${appEnv ? "" : " (no NEXT_PUBLIC_APP_ENV test|dev)"}`);
      }
    }
    assert.deepEqual(offenders, []);
  });
});
