// Every QueryState branch (plan §5.7), rendered to static markup.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ApiError } from "@/lib/api/errors";
import { errorVariantOf, formatMmSs } from "./ErrorState";
import { QueryState, type QueryLike, type QueryStateProps } from "./QueryState";

// tsconfig has jsx: "preserve", so tsx compiles the components' JSX to React.createElement (classic runtime).
(globalThis as { React?: typeof React }).React = React;

type Data = { items: string[] };

const base: QueryLike<Data> = {
  data: undefined,
  error: null,
  isPending: true,
  isError: false,
  isFetching: true,
  isPlaceholderData: false,
  fetchStatus: "fetching",
  refetch: () => undefined,
};

function render(query: Partial<QueryLike<Data>>, props: Partial<QueryStateProps<Data>> = {}): string {
  return renderToStaticMarkup(
    // A render function, not elements: createElement's children argument only takes ReactNode.
    // eslint-disable-next-line react/no-children-prop
    createElement(QueryState<Data>, {
      query: { ...base, ...query },
      object: "openings",
      "data-testid": "region",
      children: (d: Data) => createElement("ul", { "data-testid": "rows" }, d.items.join(",")),
      ...props,
    }),
  );
}

const err = (init: Partial<ConstructorParameters<typeof ApiError>[0]>) =>
  new ApiError({ status: 500, code: "internal", ...init });

describe("QueryState", () => {
  test("pending, no data → the default skeleton region (aria-busy, sr-only Loading…), never a spinner", () => {
    const html = render({});
    assert.match(html, /data-testid="region-loading"/);
    assert.match(html, /aria-busy="true"/);
    assert.match(html, /Loading…/);
    assert.doesNotMatch(html, /animate-spin/);
  });

  test("pending → a custom fallback when given", () => {
    const html = render({}, { fallback: createElement("p", null, "custom skeleton") });
    assert.match(html, /custom skeleton/);
  });

  test("pending while paused (offline) → the offline ErrorState", () => {
    const html = render({ fetchStatus: "paused", isFetching: false });
    assert.match(html, /data-state="offline"/);
    assert.match(html, /Needs a connection/);
  });

  test("error, no data → inline ErrorState with the object, Event id and Retry", () => {
    const html = render({
      isPending: false,
      isError: true,
      isFetching: false,
      fetchStatus: "idle",
      error: err({ requestId: "7f3c2a91-e04b-4c1d" }),
    });
    assert.match(html, /role="alert"/);
    assert.match(html, /data-state="default"/);
    assert.match(html, /Couldn’t load openings/);
    assert.match(html, /Event 7f3c2a91/);
    assert.match(html, /data-testid="region-error-retry"/);
    assert.match(html, /Try Again/);
  });

  test("error, no data, refetching → the retrying state", () => {
    const html = render({ isPending: false, isError: true, isFetching: true, error: err({}) });
    assert.match(html, /data-state="retrying"/);
    assert.match(html, /aria-busy="true"/);
  });

  test("error, no data, rate_limited → countdown with a disabled retry", () => {
    const html = render({
      isPending: false,
      isError: true,
      isFetching: false,
      fetchStatus: "idle",
      error: err({ status: 429, code: "rate_limited", retryAfterSec: 30 }),
    });
    assert.match(html, /data-state="rate_limited"/);
    // The shared RetryCountdown row (components/system), described by the retry control.
    assert.match(html, /data-testid="region-error-countdown"/);
    assert.match(html, /Too many requests\. Try again in <span role="timer"[^>]*>0:30<\/span>/);
    assert.match(html, /aria-disabled="true" aria-describedby="rc-retry-/);
    assert.match(html, /Try Again in 0:30/);
  });

  test("errorVariant=page throws to the route error boundary", () => {
    const error = err({});
    assert.throws(() => render({ isPending: false, isError: true, error }, { errorVariant: "page" }), (e) => e === error);
  });

  test("success, empty → the empty node", () => {
    const html = render(
      { data: { items: [] }, isPending: false, isFetching: false, fetchStatus: "idle" },
      { empty: createElement("p", null, "No Openings Yet"), isEmpty: (d) => d.items.length === 0 },
    );
    assert.match(html, /data-testid="region-empty"/);
    assert.match(html, /No Openings Yet/);
    assert.doesNotMatch(html, /data-testid="rows"/);
  });

  test("success → children; no aria-busy when idle", () => {
    const html = render({ data: { items: ["a", "b"] }, isPending: false, isFetching: false, fetchStatus: "idle" });
    assert.match(html, /<ul data-testid="rows">a,b<\/ul>/);
    assert.doesNotMatch(html, /aria-busy/);
  });

  test("background refetch keeps children and sets aria-busy", () => {
    const html = render({ data: { items: ["a"] }, isPending: false, isFetching: true });
    assert.match(html, /data-testid="region" aria-busy="true"/);
    assert.match(html, /data-testid="rows"/);
  });

  test("a background error with data keeps the data", () => {
    const html = render({ data: { items: ["a"] }, isPending: false, isError: true, isFetching: false, error: err({}) });
    assert.match(html, /data-testid="rows"/);
    assert.doesNotMatch(html, /role="alert"/);
  });
});

describe("ErrorState helpers", () => {
  test("formatMmSs", () => {
    assert.equal(formatMmSs(0), "0:00");
    assert.equal(formatMmSs(65), "1:05");
    assert.equal(formatMmSs(3600), "60:00");
    assert.equal(formatMmSs(29.2), "0:30");
    assert.equal(formatMmSs(-3), "0:00");
  });

  test("errorVariantOf", () => {
    assert.equal(errorVariantOf(err({ status: 429, code: "rate_limited" })), "rate_limited");
    assert.equal(errorVariantOf(err({ status: 0, code: "offline" })), "offline");
    assert.equal(errorVariantOf(err({})), "inline");
    assert.equal(errorVariantOf(new Error("x")), "inline");
  });
});
