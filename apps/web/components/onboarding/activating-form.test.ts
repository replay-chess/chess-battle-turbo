// Activating's form works before hydration (INTEGRATE-2 regression): a tap on Continue before React hydrated posted
// /onboarding/activating to itself (a reload of the same step) instead of opening Done. The server markup now carries
// action="/onboarding/done" method="get" for the continue phases; a stalled card has no action (it reloads itself).
import assert from "node:assert/strict";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { before, describe, it } from "node:test";

// tsx compiles the component's JSX with the classic runtime (Next's tsconfig says "preserve").
(globalThis as unknown as { React: typeof React }).React = React;
let ActivatingPanel: typeof import("./ActivatingStep").ActivatingPanel;
let activatingFormAction: typeof import("./ActivatingStep").activatingFormAction;
before(async () => {
  ({ ActivatingPanel, activatingFormAction } = await import("./ActivatingStep"));
});
const createElement = React.createElement;

const base = {
  isTrial: true,
  chargeDateLabel: "19 Nov",
  checking: false,
  supportHref: "/contact?topic=billing",
  planHref: "/onboarding/plan?status=failed&plan=monthly",
  importCard: null,
  board: null,
};

describe("Activating form without JavaScript", () => {
  it("continue phases submit to Done with GET; stalled has no action", () => {
    assert.equal(activatingFormAction("success"), "/onboarding/done");
    assert.equal(activatingFormAction("polling"), "/onboarding/done");
    assert.equal(activatingFormAction("stalled"), undefined);
  });

  it("the server markup of the success card carries the action", () => {
    const html = renderToStaticMarkup(createElement(ActivatingPanel, { ...base, phase: "success" }));
    assert.match(html, /<form[^>]*action="\/onboarding\/done"[^>]*method="get"|<form[^>]*method="get"[^>]*action="\/onboarding\/done"/);
    const stalled = renderToStaticMarkup(createElement(ActivatingPanel, { ...base, phase: "stalled" }));
    assert.doesNotMatch(stalled, /<form[^>]*action=/);
  });
});
