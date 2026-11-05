// Persona lease (phase-01 plan §12.0, CT X4).
//
// A spec that needs an exact account state leases a persona:
//
//   import { test } from "../fixtures/lease";
//   test("payment banner", async ({ leasePersona, page }) => {
//     const user = await leasePersona("payment_banner");
//     await signIn(page, user.email, "");
//   });
//
// The slot is deterministic: pool user = parallelIndex × POOL_SLOTS_PER_WORKER
// + index + 1, so two workers never share a pool user within a run. Runs never
// overlap on the shared dev database because global setup holds the run lock
// (pg_try_advisory_lock). The reset runs scripts/dev/personas.ts in-process,
// with its guards (dev host or local Docker only; A–R refused).
//
// Two spec files that lease the same persona must both use
// `test.describe.configure({ mode: "serial" })` (checked by users.test.ts).
import { test as base, type TestInfo } from "@playwright/test";
import { poolEmail, poolSlot } from "./users";

export type LeasedPersona = { email: string; pool: number; persona: string };

export async function leasePersona(name: string, testInfo: TestInfo, index = 0): Promise<LeasedPersona> {
  const pool = poolSlot(testInfo.parallelIndex, index);
  const { resetPersona } = await import("../../scripts/dev/personas");
  const lines: string[] = [];
  await resetPersona(String(pool), name, { log: (l) => lines.push(l) });
  testInfo.annotations.push({ type: "persona", description: `${name} on pool user ${pool}` });
  return { email: poolEmail(pool), pool, persona: name };
}

export const test = base.extend<{
  /** Resets the worker's pool slot `index` (0 or 1) to persona `name` and returns its login. */
  leasePersona: (name: string, index?: number) => Promise<LeasedPersona>;
}>({
  // Playwright reads the fixture dependencies from the first parameter, so it must be a pattern.
  // eslint-disable-next-line no-empty-pattern
  leasePersona: async ({}, provide, testInfo) => {
    await provide((name, index = 0) => leasePersona(name, testInfo, index));
  },
});

export { expect } from "@playwright/test";
