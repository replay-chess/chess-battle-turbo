// landing.ts: signed-in `/` → `/home` from the session claims alone (phase-05 plan §4.8; interface check §0.6).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { HOME_PATH, isLandingPath, landingTarget } from "./landing";

const member = { v: 1, onboarded: true, entitled: true, lapsed: false, trialUsed: true, role: "USER" } as const;

test("an onboarded, entitled member lands on /home", () => {
  assert.equal(landingTarget(member), HOME_PATH);
  assert.equal(HOME_PATH, "/home");
});

test("not onboarded, not entitled, lapsed or unknown claims keep the marketing page", () => {
  assert.equal(landingTarget({ ...member, onboarded: false }), null);
  assert.equal(landingTarget({ ...member, entitled: false }), null);
  assert.equal(landingTarget({ ...member, entitled: false, lapsed: true }), null);
  assert.equal(landingTarget({ onboarded: true }), null, "entitlement unknown");
  for (const md of [undefined, null, "", 1, [], ["onboarded"], {}]) assert.equal(landingTarget(md), null, JSON.stringify(md));
});

test("admins and, with the paywall off, every onboarded viewer land on /home", () => {
  assert.equal(landingTarget({ ...member, entitled: false, role: "ADMIN" }), HOME_PATH);
  assert.equal(landingTarget({ ...member, entitled: false }, { BILLING_PAYWALL: "off" }), HOME_PATH);
  assert.equal(landingTarget({ ...member, entitled: false }, { BILLING_PAYWALL: " OFF " }), HOME_PATH);
  assert.equal(landingTarget({ ...member, entitled: false }, { BILLING_PAYWALL: "on" }), null);
  assert.equal(landingTarget({ ...member, onboarded: false }, { BILLING_PAYWALL: "off" }), null, "onboarding first");
});

test("only the root path is the landing page", () => {
  assert.equal(isLandingPath("/"), true);
  for (const p of ["/home", "/pricing", "/play", "//", "/index"]) assert.equal(isLandingPath(p), false, p);
});

// The middleware block is the only caller; it must stay claim-only (no Prisma, no flags, no fetch) and run before the
// public pass-through, for `/` only.
test("middleware calls the rule on `/` before public pages pass, with no database or flag read", () => {
  const src = readFileSync(new URL("../../middleware.ts", import.meta.url), "utf8");
  const block = /── P5 landing rule[\s\S]*?── end P5 landing rule ──/.exec(src)?.[0] ?? "";
  assert.ok(block, "the P5 block exists");
  assert.match(block, /isLandingPath\(req\.nextUrl\.pathname\)/);
  assert.match(block, /landingTarget\(sessionClaims\?\.md, process\.env\)/);
  assert.doesNotMatch(block, /prisma|getFlags|@\/lib\/flags|fetch\(/);
  const passAt = src.indexOf('if (p.cls === "api" || p.cls === "public") return pass(p);');
  assert.ok(passAt > 0 && src.indexOf("── P5 landing rule") < passAt, "the rule runs before the public pass-through");
  assert.doesNotMatch(src, /from "@\/lib\/flags"/, "middleware never imports the flag module");
});
