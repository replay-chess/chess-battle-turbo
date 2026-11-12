// Phase 3 routing data (phase-03 plan §3.2): the `/review` → `/games` redirect (308 in production, 307 elsewhere so a
// dev browser does not cache it), after P0's host canonicalisation, and only for the exact path.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
// The plain .mjs registry next.config.js imports (typed through its JSDoc).
import { allRedirects } from "../../config/redirects/index.mjs";

type Redirect = { source: string; destination: string; permanent: boolean };

describe("P3 redirects", () => {
  it("/review → /games: permanent in production, temporary on dev", () => {
    const prod = (allRedirects({ APP_ENV: "production" }) as Redirect[]).filter((r) => r.source === "/review");
    const dev = (allRedirects({ APP_ENV: "dev" }) as Redirect[]).filter((r) => r.source === "/review");
    assert.deepEqual(prod, [{ source: "/review", destination: "/games", permanent: true }]);
    assert.deepEqual(dev, [{ source: "/review", destination: "/games", permanent: false }]);
  });

  it("comes after the P0 rules and touches no /review/<ref> path", () => {
    const all = allRedirects({ APP_ENV: "production" }) as Redirect[];
    assert.equal(all.at(-1)?.source, "/review");
    assert.equal(all.some((r) => r.source.startsWith("/review/")), false);
  });
});
