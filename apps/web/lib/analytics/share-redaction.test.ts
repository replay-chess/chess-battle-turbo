// Share codes never reach telemetry (regression: share-code-in-telemetry-urls, FIX-2, review round 2): posthog-js put
// https://…/r/<code> into $current_url / $pathname / $referrer of every event on the share page, and Sentry recorded the
// URL in request data, navigation breadcrumbs and Replay.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { scrubEvent } from "@/lib/sentry/scrub";
import { posthogRedactShareCodes, redactShareDeep, redactSharePath, replayShareRedaction, sentryShareRedaction } from "./share-redaction";

const URL_ = "https://www.example.test/r/7kd0cbpz";

describe("share code redaction", () => {
  it("rewrites the code segment of share URLs and paths, and nothing else", () => {
    assert.equal(redactSharePath(URL_), "https://www.example.test/r/:code");
    assert.equal(redactSharePath("/r/7kd0cbpz/og?v=3"), "/r/:code/og?v=3");
    assert.equal(redactSharePath("/r/7kd0cbpz?x=1#a"), "/r/:code?x=1#a");
    assert.equal(redactSharePath("went /r/7kd0cbpz then /r/abc12345."), "went /r/:code then /r/abc12345.", "a code followed by a dot is prose, left alone");
    assert.equal(redactSharePath("/review/c123/share"), "/review/c123/share");
    assert.equal(redactSharePath("/games?q=r"), "/games?q=r");
  });

  it("PostHog before_send: $current_url, $pathname, $referrer and the initial ones", () => {
    const event = {
      event: "$pageview",
      properties: { $current_url: URL_, $pathname: "/r/7kd0cbpz", $referrer: URL_, nested: { list: [URL_] }, n: 3 },
      $set_once: { $initial_current_url: URL_, $initial_pathname: "/r/7kd0cbpz" },
      $set: { $current_url: URL_ },
    };
    const out = posthogRedactShareCodes(event)!;
    assert.equal(out, event, "the same event, changed in place");
    assert.deepEqual(out.properties, {
      $current_url: "https://www.example.test/r/:code",
      $pathname: "/r/:code",
      $referrer: "https://www.example.test/r/:code",
      nested: { list: ["https://www.example.test/r/:code"] },
      n: 3,
    });
    assert.equal(out.$set_once.$initial_pathname, "/r/:code");
    assert.equal(out.$set.$current_url, "https://www.example.test/r/:code");
    assert.equal(posthogRedactShareCodes(null), null);
  });

  it("Sentry browser hooks: event, transaction, breadcrumb and Replay recording event", () => {
    const event = { request: { url: URL_ }, transaction: "/r/7kd0cbpz", breadcrumbs: [{ category: "navigation", data: { from: "/review/c1/share", to: "/r/7kd0cbpz" } }] };
    assert.deepEqual(sentryShareRedaction.beforeSend(event), {
      request: { url: "https://www.example.test/r/:code" },
      transaction: "/r/:code",
      breadcrumbs: [{ category: "navigation", data: { from: "/review/c1/share", to: "/r/:code" } }],
    });
    assert.deepEqual(sentryShareRedaction.beforeSendTransaction({ spans: [{ description: "GET /r/7kd0cbpz" }] }), { spans: [{ description: "GET /r/:code" }] });
    assert.deepEqual(sentryShareRedaction.beforeBreadcrumb({ data: { url: URL_ } }), { data: { url: "https://www.example.test/r/:code" } });
    assert.deepEqual(replayShareRedaction.beforeAddRecordingEvent({ type: 4, data: { href: URL_ } }), { type: 4, data: { href: "https://www.example.test/r/:code" } });
  });

  it("server and edge events (scrubEvent) lose the code too", () => {
    const event = scrubEvent({ request: { url: `${URL_}?utm=x`, headers: { referer: URL_ } }, transaction: "GET /r/7kd0cbpz" } as never) as {
      request: { url: string; headers: Record<string, unknown> };
      transaction: string;
    };
    assert.equal(event.request.url, "https://www.example.test/r/:code?utm=x");
    assert.equal(event.transaction, "GET /r/:code");
    assert.deepEqual(event.request.headers, {}, "the referer header is not allow-listed");
  });

  it("leaves non-plain objects alone and stops at a depth limit", () => {
    const d = new Date(0);
    assert.equal(redactShareDeep(d), d);
    let deep: Record<string, unknown> = { url: URL_ };
    for (let i = 0; i < 20; i++) deep = { child: deep };
    assert.doesNotThrow(() => redactShareDeep(deep));
  });
  it("regression: p04-pii-in-telemetry (FIX-1): handles and emails never reach PostHog or Sentry", () => {
    const ph = posthogRedactShareCodes({
      properties: {
        $current_url: "https://dev.example/onboarding/confirm?provider=chesscom&u=knightowl_88",
        $pathname: "/onboarding/confirm",
        $referrer: "https://dev.example/onboarding/link?error=not_found&u=knightowl_88",
      },
      $set_once: { $initial_current_url: "https://dev.example/checkout/activating?subscription_id=sub_1&email=a%40b.c&plan=monthly" },
    })!;
    assert.ok(!JSON.stringify(ph).includes("knightowl_88"));
    assert.ok(!JSON.stringify(ph).includes("a%40b.c"));
    assert.equal(ph.properties.$current_url, "https://dev.example/onboarding/confirm?provider=chesscom&u=[redacted]");

    const tx = sentryShareRedaction.beforeSendTransaction({
      transaction: "/onboarding/confirm",
      request: { url: "https://dev.example/onboarding/confirm?u=knightowl_88" },
      spans: [
        { description: "GET https://api.chess.com/pub/player/knightowl_88/stats", data: { "http.url": "https://api.chess.com/pub/player/knightowl_88/stats" } },
        { description: "GET https://lichess.org/api/user/DrNykterstein" },
      ],
    });
    assert.ok(!/knightowl_88|DrNykterstein/.test(JSON.stringify(tx)));
    const crumb = sentryShareRedaction.beforeBreadcrumb({ category: "navigation", data: { from: "/onboarding/link", to: "/onboarding/confirm?u=knightowl_88" } });
    assert.equal(crumb.data.to, "/onboarding/confirm?u=[redacted]");
    const server = scrubEvent({ request: { url: "https://dev.example/onboarding/confirm?provider=chesscom&u=knightowl_88", query_string: "provider=chesscom&u=knightowl_88" } } as never) as {
      request: { url: string; query_string: string };
    };
    assert.ok(!JSON.stringify(server).includes("knightowl_88"));
    assert.match(server.request.query_string, /provider=chesscom/);
  });
});
