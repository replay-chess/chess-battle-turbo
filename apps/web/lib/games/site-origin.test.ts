import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildPgn } from "@repo/game-core/pgn";
import { pgnSiteOrigin } from "./site-origin";

const DEV = "https://replay-chess-dev-replaychess007-1069.vercel.app";
const REF = "cmref0000000000000000000a";

describe("pgnSiteOrigin", () => {
  it("is the origin of NEXT_PUBLIC_SITE_URL", () => {
    assert.equal(pgnSiteOrigin(DEV), DEV);
    assert.equal(pgnSiteOrigin(`${DEV}/`), DEV);
    assert.equal(pgnSiteOrigin(` ${DEV}/pricing?x=1 `), DEV);
    assert.equal(pgnSiteOrigin("http://localhost:3000"), "http://localhost:3000");
  });

  it("is undefined when unset or not an http(s) URL (buildPgn then uses the canonical site)", () => {
    for (const v of [undefined, "", "  ", "not a url", "javascript:alert(1)", "ftp://example.com"]) {
      assert.equal(pgnSiteOrigin(v), undefined, String(v));
    }
  });

  it("puts the configured site into the PGN Site tag", () => {
    const siteOrigin = pgnSiteOrigin(DEV);
    const pgn = buildPgn({
      ref: REF,
      mode: "BOT",
      date: Date.UTC(2026, 10, 11),
      white: "A",
      black: "Bot",
      startFen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
      moves: "",
      result: null,
      tc: null,
      ...(siteOrigin ? { siteOrigin } : {}),
    });
    assert.ok(pgn.includes(`[Site "${DEV}/game/${REF}"]`), pgn);
    assert.ok(!pgn.includes("playchess.tech"), pgn);
  });
});
