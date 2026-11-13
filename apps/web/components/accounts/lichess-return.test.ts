// The Lichess OAuth round trip from /settings/connected (phase-04 plan §7.3.4, §7.3.5, §4.10 interactions).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LICHESS_RETURN_PATHS } from "@repo/contracts/http/p04-plain";
import { SETTINGS_RETURN_PATH, lichessReturnOf, lichessStartHref, withoutLichessParams } from "./lichess-return";

describe("Lichess return", () => {
  it("?lichess= maps to the card state once", () => {
    assert.deepEqual(lichessReturnOf({ lichess: "linked", reason: null }), { returned: null, linked: true });
    assert.deepEqual(lichessReturnOf({ lichess: "denied", reason: null }), { returned: { kind: "denied" }, linked: false });
    assert.deepEqual(lichessReturnOf({ lichess: "error", reason: "linked_elsewhere" }), {
      returned: { kind: "error", reason: "linked_elsewhere" },
      linked: false,
    });
    assert.deepEqual(lichessReturnOf({ lichess: null, reason: null }), { returned: null, linked: false });
    assert.deepEqual(lichessReturnOf({ lichess: "<script>", reason: "x" }), { returned: null, linked: false });
  });

  it("the start URL returns to this page (an allow-listed returnTo)", () => {
    assert.ok((LICHESS_RETURN_PATHS as readonly string[]).includes(SETTINGS_RETURN_PATH));
    assert.equal(lichessStartHref(), "/api/accounts/lichess/start?returnTo=%2Fsettings%2Fconnected");
  });

  it("consuming the return removes only lichess and reason", () => {
    assert.equal(withoutLichessParams("https://x.test/settings/connected?lichess=denied"), "/settings/connected");
    assert.equal(
      withoutLichessParams("https://x.test/settings/connected?lichess=error&reason=state&utm=a#top"),
      "/settings/connected?utm=a#top",
    );
  });
});
