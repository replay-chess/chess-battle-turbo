import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  MUTATING_HELPERS,
  POOL_SIZE,
  POOL_SLOTS_PER_WORKER,
  knownIdentities,
  letterEmail,
  poolEmail,
  poolSlot,
  roleOfEmail,
  roleOfLetter,
  throwawayEmail,
} from "./users";

const E2E = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function specFiles(): Array<{ file: string; src: string }> {
  return readdirSync(E2E, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".spec.ts"))
    .map((e) => {
      const abs = path.join(e.parentPath, e.name);
      return { file: path.relative(E2E, abs).split(path.sep).join("/"), src: readFileSync(abs, "utf8") };
    });
}

/** Shared letters A–R a spec signs in as or names. */
const SHARED_LETTER_USE = /E2E_USER_[A-R]_|\bplayer[A-P]\b|\bnonMemberPage\b|\bauthedPage\b|letterEmail\(\s*["'][A-R]["']/;
const SERIAL = /mode:\s*["']serial["']/;
const LEASE = /leasePersona\(\s*["'`]([a-z0-9_-]+)["'`]/g;

/** Rule 1 (CT X4): a spec that uses a shared letter must not call a mutating persona helper. */
export function sharedLetterViolations(files: Array<{ file: string; src: string }>): string[] {
  return files
    .filter(({ src }) => SHARED_LETTER_USE.test(src) && MUTATING_HELPERS.some((h) => src.includes(h)))
    .map(({ file }) => `${file}: mutates state in a spec that uses shared users A–R; lease a pool persona instead`);
}

/** Rule 2 (CT X4): two spec files leasing the same persona must both run serially. */
export function leaseViolations(files: Array<{ file: string; src: string }>): string[] {
  const byPersona = new Map<string, Array<{ file: string; serial: boolean }>>();
  for (const { file, src } of files) {
    const names = new Set([...src.matchAll(LEASE)].map((m) => m[1]!));
    for (const name of names) {
      const list = byPersona.get(name) ?? [];
      list.push({ file, serial: SERIAL.test(src) });
      byPersona.set(name, list);
    }
  }
  const out: string[] = [];
  for (const [name, list] of byPersona) {
    if (list.length > 1 && list.some((l) => !l.serial)) {
      out.push(`persona "${name}" is leased by ${list.map((l) => l.file).join(", ")} without serial mode in all of them`);
    }
  }
  return out;
}

describe("E2E user registry", () => {
  const env = { E2E_USER_A_EMAIL: "e2e-playera+clerk_test@chessbattle.dev", E2E_ADMIN_EMAIL: "e2e-admin+clerk_test@chessbattle.dev" };

  it("assigns the documented roles", () => {
    assert.equal(roleOfLetter("A"), "shared-member");
    assert.equal(roleOfLetter("p"), "shared-member");
    assert.equal(roleOfLetter("Q"), "read-only");
    assert.equal(roleOfLetter("R"), "read-only");
    assert.equal(roleOfLetter("S"), "persona");
    assert.throws(() => roleOfLetter("T"));
  });

  it("classifies emails, and never treats a permanent user as throwaway", () => {
    assert.equal(roleOfEmail(env.E2E_USER_A_EMAIL, env), "shared-member");
    assert.equal(roleOfEmail(env.E2E_ADMIN_EMAIL, env), "admin");
    assert.equal(roleOfEmail(poolEmail(7, env), env), "pool");
    assert.equal(roleOfEmail("e2e-temp-1730000000000-0@chessbattle.dev", env), "throwaway");
    assert.equal(roleOfEmail(throwawayEmail("account-delete", "run42"), env), "throwaway");
    // Older provisioning runs left plain e2e-player<x>@ users; they are permanent.
    assert.equal(roleOfEmail("e2e-playerq@chessbattle.dev", env), null);
    assert.equal(roleOfEmail("e2e-pool03@chessbattle.dev", env), null);
    // Only the E2E domain is ever swept.
    assert.equal(roleOfEmail("e2e-temp-1@gmail.com", env), null);
    assert.equal(roleOfEmail("someone@example.com", env), null);
  });

  it("builds throwaway emails from the flow and run id", () => {
    assert.equal(throwawayEmail("Account Delete", "Run#42"), "e2e-accountdelete-run42+clerk_test@chessbattle.dev");
  });

  it("gives each worker its own pool slots and refuses an exhausted pool", () => {
    const seen = new Set<number>();
    const workers = Math.floor(POOL_SIZE / POOL_SLOTS_PER_WORKER);
    for (let w = 0; w < workers; w++) {
      for (let i = 0; i < POOL_SLOTS_PER_WORKER; i++) seen.add(poolSlot(w, i));
    }
    assert.equal(seen.size, POOL_SIZE);
    assert.ok(Math.min(...seen) === 1 && Math.max(...seen) === POOL_SIZE);
    assert.throws(() => poolSlot(workers, 0), /pool exhausted/);
    assert.throws(() => poolSlot(0, POOL_SLOTS_PER_WORKER), /at most/);
  });

  it("knownIdentities covers every letter and pool email for the PII guard", () => {
    const ids = knownIdentities(env);
    assert.ok(ids.includes(letterEmail("A", env)));
    assert.ok(ids.includes(poolEmail(24, env)));
    assert.ok(ids.includes("TestPlayerA E2E"));
    assert.ok(ids.includes(env.E2E_ADMIN_EMAIL));
  });
});

describe("spec rules (CT X4)", () => {
  it("the rules catch violations in synthetic specs", () => {
    assert.equal(
      sharedLetterViolations([{ file: "x.spec.ts", src: `test("a", async ({ playerA }) => { resetPersona("A", "lapsed") })` }]).length,
      1,
    );
    assert.equal(
      leaseViolations([
        { file: "a.spec.ts", src: `leasePersona("lapsed")` },
        { file: "b.spec.ts", src: `test.describe.configure({ mode: "serial" }); leasePersona("lapsed")` },
      ]).length,
      1,
    );
    assert.equal(
      leaseViolations([
        { file: "a.spec.ts", src: `test.describe.configure({ mode: "serial" }); leasePersona("lapsed")` },
        { file: "b.spec.ts", src: `test.describe.configure({ mode: 'serial' }); leasePersona('lapsed')` },
      ]).length,
      0,
    );
  });

  it("no spec mutates a shared user A–R", () => {
    assert.deepEqual(sharedLetterViolations(specFiles()), []);
  });

  it("no two spec files lease the same persona without serial mode", () => {
    assert.deepEqual(leaseViolations(specFiles()), []);
  });
});
