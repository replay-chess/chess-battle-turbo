// /play's entry params (FIX-2): Home's Play links open the chosen mode, and Quick Match its 5+3.
import assert from "node:assert/strict";
import { test } from "node:test";
import { HOME_LINKS } from "@/components/home/copy";
import { playModeOf, timeControlOf } from "./play-params";

test("tab → mode; unknown or missing → null (the page default)", () => {
  assert.equal(playModeOf("friend"), "friend");
  assert.equal(playModeOf("bot"), "ai");
  assert.equal(playModeOf("quick"), "quick");
  assert.equal(playModeOf("arena"), null);
  assert.equal(playModeOf(null), null);
});

test("tc → the selector's value; invalid values are ignored", () => {
  assert.deepEqual(timeControlOf("5+3"), { mode: "Blitz", control: "5 | 3", time: 300, increment: 3 });
  assert.deepEqual(timeControlOf("1+0"), { mode: "Bullet", control: "1 min", time: 60, increment: 0 });
  assert.deepEqual(timeControlOf("15+10"), { mode: "Rapid", control: "15 | 10", time: 900, increment: 10 });
  for (const bad of [null, "", "5", "0+3", "181+0", "5+61", "5+3x", "abc"]) assert.equal(timeControlOf(bad), null, String(bad));
});

test("Home's links carry what /play reads", () => {
  const q = (href: string) => new URL(href, "http://x").searchParams;
  assert.equal(playModeOf(q(HOME_LINKS.playFriend).get("tab")), "friend");
  assert.equal(playModeOf(q(HOME_LINKS.playBot).get("tab")), "ai");
  assert.equal(playModeOf(q(HOME_LINKS.quickMatch).get("tab")), "quick");
  assert.deepEqual(timeControlOf(q(HOME_LINKS.quickMatch).get("tc")), { mode: "Blitz", control: "5 | 3", time: 300, increment: 3 });
});
