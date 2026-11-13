// The ledger-aware viewer of the server seeds (FIX-2, billing review round 2; the rest of FIX-1 #17).
// regression: me-seed-ignores-ledger: the server-rendered qk.me() seeds used the users-row trial.eligible, so the store
// (and /pricing) offered "Start free trial" to a ledger hit after a hard load.
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import * as nodeModule from "node:module";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { viewerFixture } from "@/test/helpers/route-harness";

const probes: unknown[][] = [];
const g = globalThis as { __ledgerRows?: unknown[]; __ledgerProbes?: unknown[][] };
g.__ledgerProbes = probes;
const mod = (src: string) => `data:text/javascript,${encodeURIComponent(src)}`;
const FAKES: Record<string, string> = {
  "server-only": mod("export {}"),
  "@/lib/prisma": mod(`export const prisma = { async $queryRawUnsafe(sql, ...values) { globalThis.__ledgerProbes.push(values); return globalThis.__ledgerRows; } };`),
  "@/lib/logger": mod("export const logger = { warn() {}, info() {}, error() {}, debug() {} };"),
};
nodeModule.registerHooks({
  resolve: (specifier, context, next) => (FAKES[specifier] ? { url: FAKES[specifier]!, shortCircuit: true } : next(specifier, context)),
});
process.env.HASH_PEPPER ??= "ledger-viewer-test-pepper-0123456789abcdef";
const { ledgerAwareViewer } = await import("./ledger-viewer");

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

describe("ledgerAwareViewer", () => {
  it("a row-eligible viewer the ledger knows is not eligible; a miss keeps the offer; a non-eligible row is never probed", async () => {
    const fresh = viewerFixture({ entitlement: { member: false, state: "none", trial: { used: false, eligible: true } } });
    g.__ledgerRows = [{ kind: "email" }];
    assert.equal((await ledgerAwareViewer(fresh)).entitlement.trial.eligible, false);
    assert.equal(fresh.entitlement.trial.eligible, true, "the input viewer is not changed");
    g.__ledgerRows = [];
    const other = viewerFixture({ entitlement: { member: false, state: "none", trial: { used: false, eligible: true } } });
    assert.equal((await ledgerAwareViewer(other)).entitlement.trial.eligible, true);
    const before = probes.length;
    const lapsed = viewerFixture({ entitlement: { member: false, state: "lapsed", trial: { used: true, eligible: false } } });
    assert.equal((await ledgerAwareViewer(lapsed)).entitlement.trial.eligible, false);
    assert.equal(probes.length, before, "no probe for a row that is not eligible");
  });

  it("every server seed of qk.me() goes through ledgerAwareViewer", () => {
    const seeds: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) {
          if (name !== "node_modules" && !name.startsWith(".")) walk(full);
        } else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) {
          const text = readFileSync(full, "utf8");
          for (const m of text.matchAll(/setQueryData\(qk\.me\(\),\s*([^\n]+)/g)) seeds.push(`${path.relative(WEB, full)}: ${m[1]}`);
        }
      }
    };
    walk(path.join(WEB, "app"));
    assert.ok(seeds.length >= 3, seeds.join("\n"));
    const raw = seeds.filter((s) => /meDataOf\(viewer\b/.test(s));
    assert.deepEqual(raw, [], "a seed from the raw viewer (row-only trial.eligible)");
  });
});
