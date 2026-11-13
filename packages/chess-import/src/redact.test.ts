import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { redactDeep, redactUsernames } from "./redact";

describe("redactUsernames (plan §11.3, FIX-1)", () => {
  it("regression: provider-username-in-telemetry: provider API paths lose the username", () => {
    assert.equal(
      redactUsernames("https://api.chess.com/pub/player/knightowl_88/games/2026/11"),
      "https://api.chess.com/pub/player/:username/games/2026/11",
    );
    assert.equal(redactUsernames("GET https://api.chess.com/pub/player/KnightOwl_88"), "GET https://api.chess.com/pub/player/:username");
    assert.equal(
      redactUsernames("https://lichess.org/api/games/user/DrNykterstein?since=1&max=1000"),
      "https://lichess.org/api/games/user/:username?since=1&max=1000",
    );
    assert.equal(redactUsernames("https://lichess.org/api/user/DrNykterstein"), "https://lichess.org/api/user/:username");
    assert.equal(redactUsernames("http://127.0.0.1:4810/lichess/api/user/bob"), "http://127.0.0.1:4810/lichess/api/user/:username");
  });

  it("our own /api/user/* routes keep their names", () => {
    assert.equal(redactUsernames("POST /api/user/onboarding-skip"), "POST /api/user/onboarding-skip");
    assert.equal(redactUsernames("https://site.example/api/user/chess-com-profile"), "https://site.example/api/user/chess-com-profile");
  });

  it("regression: pii-query-params: u= and email= values are dropped, plain and percent-encoded", () => {
    assert.equal(
      redactUsernames("https://site.example/onboarding/confirm?provider=chesscom&u=knightowl_88"),
      "https://site.example/onboarding/confirm?provider=chesscom&u=[redacted]",
    );
    assert.equal(redactUsernames("/onboarding/link?error=not_found&u=x_y#top"), "/onboarding/link?error=not_found&u=[redacted]#top");
    assert.equal(
      redactUsernames("/checkout/activating?subscription_id=sub_1&status=active&email=a.b%2Btag%40gmail.com&plan=monthly"),
      "/checkout/activating?subscription_id=sub_1&status=active&email=[redacted]&plan=monthly",
    );
    assert.equal(
      redactUsernames("/sign-in?redirect_url=%2Fonboarding%2Fconfirm%3Fprovider%3Dchesscom%26u%3Dknightowl_88"),
      "/sign-in?redirect_url=%2Fonboarding%2Fconfirm%3Fprovider%3Dchesscom%26u%3D[redacted]",
    );
    // Other parameters, and names that merely contain the letters, are untouched.
    assert.equal(redactUsernames("/games?source=chesscom&tc=blitz&user_ref=x"), "/games?source=chesscom&tc=blitz&user_ref=x");
  });

  it("redactDeep rewrites every string of an event and blanks personal query attributes", () => {
    const event = {
      transaction: "GET /onboarding/confirm",
      request: { url: "https://site.example/onboarding/confirm?u=abc", query_string: { u: "abc", provider: "chesscom" } },
      spans: [{ description: "GET https://api.chess.com/pub/player/abc/stats", data: { "url.full": "https://api.chess.com/pub/player/abc" } }],
      breadcrumbs: [{ category: "fetch", data: { url: "https://lichess.org/api/games/user/abc?max=10" } }],
      when: new Date(0),
    };
    const out = redactDeep(event);
    assert.equal(out, event, "in place");
    assert.equal(out.request.url, "https://site.example/onboarding/confirm?u=[redacted]");
    assert.deepEqual(out.request.query_string, { u: "[redacted]", provider: "chesscom" });
    assert.equal(out.spans[0]!.description, "GET https://api.chess.com/pub/player/:username/stats");
    assert.equal(out.spans[0]!.data["url.full"], "https://api.chess.com/pub/player/:username");
    assert.equal(out.breadcrumbs[0]!.data.url, "https://lichess.org/api/games/user/:username?max=10");
    assert.ok(out.when instanceof Date);
    assert.ok(!JSON.stringify(out).includes("abc"));
  });
});
