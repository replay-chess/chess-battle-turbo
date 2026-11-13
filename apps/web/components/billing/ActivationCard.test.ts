// ActivationCard copy (phase-04 plan §4.7, §4.9). Server-rendered: the success card's body never repeats its title.
import assert from "node:assert/strict";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { before, describe, it } from "node:test";

(globalThis as unknown as { React: typeof React }).React = React;
let mod: typeof import("./ActivationCard");
before(async () => {
  mod = await import("./ActivationCard");
});

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

describe("ActivationCard success copy", () => {
  it("regression: paid-success-duplicate-body (FIX-1): a paid onboarding activation says what's next, not the title again", () => {
    const html = renderToStaticMarkup(
      React.createElement(mod.ActivationCard, { kind: "onboarding", phase: "success", isTrial: false, chargeDateLabel: null, supportHref: "/contact", continueHref: "/onboarding/done" }),
    );
    const t = text(html);
    assert.equal(t.split("Your membership is active.").length - 1, 1, t);
    assert.ok(t.includes(mod.PAID_SUCCESS_BODY));
    const trial = text(
      renderToStaticMarkup(
        React.createElement(mod.ActivationCard, { kind: "onboarding", phase: "success", isTrial: true, chargeDateLabel: "19 Nov", supportHref: "/contact", continueHref: "/onboarding/done" }),
      ),
    );
    assert.ok(trial.includes("Your free trial has started."));
    assert.ok(trial.includes("7 days free. First charge on 19 Nov unless you cancel before then."));
  });
});
