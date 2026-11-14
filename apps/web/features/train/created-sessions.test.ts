import assert from "node:assert/strict";
import { test } from "node:test";
import { createdSessionSource, noteCreatedSession } from "./created-sessions";

test("regression: train-session-started-source — a session this tab created keeps its creating surface", () => {
  assert.equal(createdSessionSource("cnotcreated000000000000000"), null);
  noteCreatedSession("ccreatedbyhub0000000000000", "plan");
  noteCreatedSession("ccreatedbypicker000000000", "picker");
  assert.equal(createdSessionSource("ccreatedbyhub0000000000000"), "plan");
  assert.equal(createdSessionSource("ccreatedbypicker000000000"), "picker");
});

test("only the latest 20 sessions are kept", () => {
  for (let i = 0; i < 25; i++) noteCreatedSession(`cbounded${String(i).padStart(18, "0")}`, "bank");
  assert.equal(createdSessionSource(`cbounded${String(0).padStart(18, "0")}`), null);
  assert.equal(createdSessionSource(`cbounded${String(24).padStart(18, "0")}`), "bank");
});
