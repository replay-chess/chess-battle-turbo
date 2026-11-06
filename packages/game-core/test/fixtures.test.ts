// Chess-correctness fixtures (plan 12.2): perft guards chess.js upgrades; the PGN rule files run through
// game-core's replay, end detection, timeout rule and PGN builder.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { test } from "node:test";
import { Chess } from "chess.js";
import { buildPgn } from "../src/pgn";
import { replay, sanToUci } from "../src/rules/chess";
import { detectEnd } from "../src/rules/end";
import { flagOutcome } from "../src/rules/insufficient";
import { INITIAL_FEN } from "../src/constants";

const require = createRequire(import.meta.url);
const FIX = path.dirname(require.resolve("@repo/chess-fixtures/perft/positions.json")).replace(/perft$/, "");

const perft = JSON.parse(readFileSync(path.join(FIX, "perft/positions.json"), "utf8")) as {
  positions: { name: string; fen: string; depths: Record<string, number>; required?: number }[];
};
for (const p of perft.positions) {
  test(`perft ${p.name}`, () => {
    const c = new Chess(p.fen);
    for (const [depth, nodes] of Object.entries(p.depths)) {
      if (Number(depth) > (p.required ?? 3)) continue;
      assert.equal(c.perft(Number(depth)), nodes, `${p.name} depth ${depth}`);
    }
  });
}

const dir = path.join(FIX, "pgn/rules");
for (const file of readdirSync(dir).filter((f) => f.endsWith(".pgn"))) {
  test(`pgn rule: ${file}`, () => {
    const loaded = new Chess();
    loaded.loadPgn(readFileSync(path.join(dir, file), "utf8"));
    const h = loaded.getHeaders();
    const start = h.FEN ?? INITIAL_FEN;
    const sans = loaded.history();
    const uci = sanToUci(start, sans);
    const r = replay(start, uci);
    assert.ok(r.ok, file);
    if (!r.ok) return;
    assert.deepEqual(r.sans, sans);
    assert.equal(r.chess.fen(), loaded.fen());
    const end = detectEnd(r.chess);
    assert.equal(end?.method ?? "none", h.RcExpect ?? "none", `${file}: end`);
    if (h.RcCastling) assert.equal(r.chess.fen().split(" ")[2], h.RcCastling);
    if (h.RcCheckAfterPly) {
      const k = replay(start, uci.slice(0, Number(h.RcCheckAfterPly)));
      assert.ok(k.ok && k.chess.inCheck(), `${file}: check after ply ${h.RcCheckAfterPly}`);
    }
    if (h.RcFlag) assert.equal(flagOutcome(r.chess.fen(), h.RcFlag as "w" | "b").method, h.RcFlagOutcome);
    // Our PGN builder round-trips every fixture.
    const pgn = buildPgn({
      ref: "cfixture00000000000000000",
      mode: "FRIEND",
      date: 0,
      white: "W",
      black: "B",
      startFen: start,
      moves: uci,
      clocksMs: uci.map((_, i) => 60_000 - i * 100),
      result: end ? { winner: end.winner, method: end.method } : null,
      tc: { initialMs: 60_000, incrementMs: 0 },
    });
    const back = new Chess();
    back.loadPgn(pgn);
    assert.deepEqual(back.history(), sans, `${file}: PGN round trip`);
    assert.equal(back.fen(), loaded.fen());
  });
}
