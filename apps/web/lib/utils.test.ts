import assert from "node:assert/strict";
import { test } from "node:test";
import { cn } from "./utils";

test("cn keeps a custom font size next to a cb colour", () => {
  assert.equal(cn("text-ui text-cb-text-soft"), "text-ui text-cb-text-soft");
});

test("cn lets the later custom font size win", () => {
  assert.equal(cn("text-ui text-body"), "text-body");
});

test("cn keeps text-overline next to a colour class", () => {
  assert.equal(cn("text-overline text-cb-text"), "text-overline text-cb-text");
});

test("cn merges custom shadows", () => {
  assert.equal(cn("shadow-pop shadow-modal"), "shadow-modal");
});

test("cn keeps accent fill, foreground, size and padding together", () => {
  assert.equal(
    cn("bg-cb-accent text-cb-accent-fg text-ui px-2"),
    "bg-cb-accent text-cb-accent-fg text-ui px-2",
  );
});

test("cn merges rc animations", () => {
  assert.equal(cn("animate-rc-fade animate-rc-pop"), "animate-rc-pop");
});
