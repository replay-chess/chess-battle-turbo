// clock.ts: the failed card's countdown clock (regression: failed-card-hydration — `useState(() => Date.now())`
// rendered "Trying again in N s" on the server and N ± 1 on the client, a React hydration error).
import assert from "node:assert/strict";
import { test } from "node:test";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { clockSnapshot, subscribeClock, useClientNow } from "./clock";

// tsconfig has jsx: "preserve", so tsx compiles any JSX to React.createElement (classic runtime).
(globalThis as { React?: typeof React }).React = React;

function Probe({ active }: { active: boolean }) {
  const now = useClientNow(active);
  return createElement("span", null, now === null ? "no-time" : `t=${now}`);
}

test("regression: failed-card-hydration: the server render carries no time, active or not", () => {
  assert.equal(renderToStaticMarkup(createElement(Probe, { active: true })), "<span>no-time</span>");
  assert.equal(renderToStaticMarkup(createElement(Probe, { active: false })), "<span>no-time</span>");
});

test("the clock runs only while subscribed: null before, a time during, null after", () => {
  assert.equal(clockSnapshot(), null);
  const before = Date.now();
  let ticks = 0;
  const off = subscribeClock(() => ticks++);
  const t = clockSnapshot();
  assert.ok(t !== null && t >= before && t <= Date.now());
  assert.equal(clockSnapshot(), t, "stable between ticks (useSyncExternalStore needs a cached snapshot)");
  const off2 = subscribeClock(() => undefined);
  off();
  assert.equal(clockSnapshot(), t, "still running for the second subscriber");
  off2();
  assert.equal(clockSnapshot(), null);
  assert.equal(ticks, 0);
});
