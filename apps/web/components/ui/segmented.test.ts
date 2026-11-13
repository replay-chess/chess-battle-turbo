// Segmented's arrow keys select as well as move (WAI-ARIA radio group; phase-04 plan §4.5 Goals "Time a day", §4.6 the
// Plan's Monthly/Yearly; FIX-1).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { arrowSelection, type SegmentedItem } from "./segmented";

const items: SegmentedItem<"5" | "10" | "20" | "x">[] = [
  { value: "5", label: "5 min" },
  { value: "10", label: "10 min" },
  { value: "x", label: "off", disabled: true },
  { value: "20", label: "20 min" },
];

describe("Segmented arrow keys", () => {
  it("regression: segmented-arrows-select (FIX-1): → and ↓ select the next item, ← and ↑ the previous, wrapping, skipping disabled", () => {
    assert.equal(arrowSelection(items, "10", "ArrowRight"), "20", "skips the disabled one");
    assert.equal(arrowSelection(items, "10", "ArrowDown"), "20");
    assert.equal(arrowSelection(items, "20", "ArrowRight"), "5", "wraps");
    assert.equal(arrowSelection(items, "5", "ArrowLeft"), "20", "wraps back");
    assert.equal(arrowSelection(items, "20", "ArrowUp"), "10");
    assert.equal(arrowSelection(items, "10", "Enter"), null);
    assert.equal(arrowSelection(items, "10", " "), null);
    assert.equal(arrowSelection([{ value: "a", label: "A" }], "a", "ArrowRight"), null, "a single item stays");
  });
});

describe("Segmented tab stop (FIX-2: a radio group of plain buttons)", () => {
  it("the selected item holds the Tab stop; with none selected (or a disabled one), the first enabled item", async () => {
    const { tabStopValue } = await import("./segmented");
    assert.equal(tabStopValue(items, "20"), "20");
    assert.equal(tabStopValue(items, "x"), "5", "a disabled value is never the stop");
    assert.equal(tabStopValue([{ value: "a", label: "A", disabled: true }], "a"), null);
  });

  it("renders a radiogroup of role=radio buttons with aria-checked, data-state and one Tab stop", async () => {
    const React = await import("react");
    const { renderToStaticMarkup } = await import("react-dom/server");
    (globalThis as unknown as { React: typeof React }).React = React;
    const { Segmented } = await import("./segmented");
    const html = renderToStaticMarkup(
      React.createElement(Segmented, { value: "10", onValueChange: () => {}, items, "aria-label": "Time a day", name: "minutes" }),
    );
    assert.match(html, /role="radiogroup" aria-label="Time a day"/);
    assert.equal((html.match(/role="radio"/g) ?? []).length, 4);
    assert.match(html, /<button[^>]*value="10"[^>]*aria-checked="true"[^>]*data-state="checked"[^>]*tabindex="0"/);
    assert.equal((html.match(/tabindex="0"/g) ?? []).length, 1, "one Tab stop");
    assert.match(html, /<input type="hidden" name="minutes" value="10"\/>/);
    assert.match(html, /<button[^>]*value="x"[^>]*disabled=""/);
    assert.doesNotMatch(html, /radix/i);
  });
});
