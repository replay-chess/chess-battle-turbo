// Button asChild without Radix Slot (FIX-2, phase-04 plan §9.6): the same merge the Slot did.
import assert from "node:assert/strict";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "node:test";

(globalThis as unknown as { React: typeof React }).React = React;
const { Button, slotInto } = await import("./button");

describe("Button asChild", () => {
  it("renders the child element with the button's classes first, the child's props winning, the icons around its children", () => {
    const html = renderToStaticMarkup(
      React.createElement(
        Button,
        { asChild: true, variant: "secondary", className: "w-full", iconStart: React.createElement("i", { key: "s" }, "S"), "aria-label": "slot" },
        React.createElement("a", { href: "/x", className: "own", "aria-label": "child wins" }, "Go"),
      ),
    );
    assert.match(html, /^<a /, html);
    assert.match(html, /href="\/x"/);
    assert.match(html, /aria-label="child wins"/);
    assert.match(html, /class="[^"]*border-cb-border-strong[^"]*w-full[^"]*own"/, "button classes, then the child's");
    assert.match(html, /<i>S<\/i>Go<\/a>$/);
  });

  it("both click handlers run, the child's first; styles merge", () => {
    const calls: string[] = [];
    const el = slotInto(
      React.createElement("a", { onClick: () => calls.push("child"), style: { color: "red" } }, "x"),
      { onClick: () => calls.push("slot"), style: { margin: 1 }, className: "a" },
    );
    (el.props as { onClick: () => void }).onClick();
    assert.deepEqual(calls, ["child", "slot"]);
    assert.deepEqual((el.props as { style: object }).style, { margin: 1, color: "red" });
  });

  it("a loading asChild button ignores the click (the guard runs)", () => {
    let clicked = 0;
    const el = renderToStaticMarkup(
      React.createElement(Button, { asChild: true, loading: true, onClick: () => clicked++ }, React.createElement("a", { href: "/y" }, "Y")),
    );
    assert.match(el, /aria-busy="true"/);
    assert.equal(clicked, 0);
  });

  it("both refs are set", () => {
    const a = { current: null as unknown };
    const seen: unknown[] = [];
    const el = slotInto(React.createElement("a", { ref: (n: unknown) => seen.push(n) }, "x"), { ref: a });
    (el.props as { ref: (n: unknown) => void }).ref("node");
    assert.equal(a.current, "node");
    assert.deepEqual(seen, ["node"]);
  });
});
