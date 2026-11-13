// The worker's Sentry hooks (plan §11.3, FIX-1): provider usernames never leave in a span, a breadcrumb or an event.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { workerSentryRedaction } from "./telemetry";

describe("worker Sentry redaction", () => {
  it("regression: provider-username-in-worker-spans: import fetch spans and breadcrumbs lose the username", () => {
    const tx = workerSentryRedaction.beforeSendTransaction({
      transaction: "job.import_sync",
      spans: [
        { op: "upstream.chesscom", description: "upstream.chesscom" },
        {
          op: "http.client",
          description: "GET https://api.chess.com/pub/player/knightowl_88/games/2026/11",
          data: { "url.full": "https://api.chess.com/pub/player/knightowl_88/games/2026/11", "http.request.method": "GET" },
        },
        { op: "http.client", description: "GET https://lichess.org/api/games/user/DrNykterstein?since=1&max=1000&pgnInJson=true" },
      ],
    });
    const text = JSON.stringify(tx);
    assert.ok(!/knightowl_88|DrNykterstein/.test(text), text);
    assert.match(text, /pub\/player\/:username\/games\/2026\/11/);
    assert.match(text, /api\/games\/user\/:username\?since=1/);

    const crumb = workerSentryRedaction.beforeBreadcrumb({ category: "fetch", data: { url: "https://lichess.org/api/user/DrNykterstein", status_code: 404 } });
    assert.equal(crumb.data.url, "https://lichess.org/api/user/:username");
    const ev = workerSentryRedaction.beforeSend({ message: "lichess 404 for https://lichess.org/api/user/DrNykterstein", tags: { job: "IMPORT_SYNC" } });
    assert.equal(ev.message, "lichess 404 for https://lichess.org/api/user/:username");
  });
});
