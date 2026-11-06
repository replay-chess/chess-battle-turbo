// 1,000 seeded random games (plan 12.1), split over property-{1..4}.test.ts so node --test runs them in parallel: at every ply the server machine's SAN, position, check flag and end
// detection agree with an independent chess.js instance; every legal move is a premove pattern; explainIllegal
// stays silent on legal moves and explains a random illegal one; the final PGN round-trips through loadPgn.
// Seeds 0–999 (mulberry32); a failure names its seed.
import assert from "node:assert/strict";
import { test } from "node:test";
import { Chess, type Square } from "chess.js";
import { mulberry32 } from "../src/bot/strength";
import { INITIAL_FEN } from "../src/constants";
import { createGame } from "../src/machine/create";
import { reduce } from "../src/machine/reduce";
import type { ServerGame } from "../src/machine/state";
import { buildPgn } from "../src/pgn";
import { SQUARES, isPromotionMove, premoveDests } from "../src/rules/chess";
import { explainWith } from "../src/rules/explainIllegal";

export const GAMES = 1_000;
const MAX_PLIES = 140;
const KIWIPETE = "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1";

function referenceEnd(c: Chess): string | null {
  if (c.isCheckmate()) return "checkmate";
  if (c.isStalemate()) return "stalemate";
  if (c.isInsufficientMaterial()) return "insufficient_material";
  if (c.isThreefoldRepetition()) return "threefold";
  if (c.isDrawByFiftyMoves()) return "fifty_move";
  return null;
}

export function playOne(seed: number): { plies: number; end: string | null } {
  const rng = mulberry32(seed);
  const startFen = seed % 10 === 9 ? KIWIPETE : INITIAL_FEN;
  const ref = new Chess(startFen);
  let s: ServerGame = createGame(
    {
      ref: `cprop${seed}`,
      mode: "FRIEND",
      tc: null,
      startFen,
      studySeconds: 0,
      seats: {
        w: { ref: "w", name: "W", avatarUrl: null, rating: null },
        b: { ref: "b", name: "B", avatarUrl: null, rating: null },
      },
    },
    0,
  );
  let now = 0;
  s = reduce(s, { type: "attach", side: "w", socketId: "w" }, now).state;
  s = reduce(s, { type: "attach", side: "b", socketId: "b" }, now).state;
  const uci: string[] = [];
  for (let ply = 0; ply < MAX_PLIES; ply++) {
    const at = `seed ${seed} ply ${ply + 1}`;
    if (ply % 10 === 0) {
      // Every legal move is a premove pattern; legality probes agree with chess.js (verbose moves are costly,
      // so the probes run every tenth ply).
      const legal = ref.moves({ verbose: true });
      const pre = premoveDests(ref.fen(), ref.turn());
      for (const m of legal)
        assert.ok(pre.get(m.from)?.includes(m.to), `${at}: ${m.from}${m.to} missing from premoveDests`);
      const probe = legal[Math.floor(rng() * legal.length)]!;
      assert.equal(explainWith(ref, probe.from, probe.to), null, `${at}: legal move explained`);
      assert.equal(isPromotionMove(ref.fen(), probe.from, probe.to), probe.isPromotion(), `${at}: promotion`);
      const from = SQUARES[Math.floor(rng() * 64)]! as Square;
      const to = SQUARES[Math.floor(rng() * 64)]! as Square;
      const isLegal = legal.some((m) => m.from === from && m.to === to);
      const ex = explainWith(ref, from, to);
      assert.equal(ex === null, isLegal, `${at}: ${from}${to} legal=${isLegal} explanation=${ex?.reason}`);
    }
    const sans = ref.moves();
    const mv = ref.move(sans[Math.floor(rng() * sans.length)]!);
    const u = `${mv.from}${mv.to}${mv.promotion ?? ""}`;
    now += 1_000;
    const side = s.phase === "first_move" ? s.firstMove!.side : s.turn;
    const r = reduce(
      s,
      { type: "move", side, ply: s.startPly + s.moves.length, uci: u, clientMoveId: `${seed}-${ply}` },
      now,
    );
    assert.ok(r.ack?.ok, `${at}: machine refused ${u}: ${JSON.stringify(r.ack)}`);
    s = r.state;
    uci.push(u);
    assert.equal(s.sans.at(-1), mv.san, `${at}: SAN`);
    assert.equal(s.fen, ref.fen(), `${at}: FEN`);
    assert.equal(s.inCheck, ref.inCheck(), `${at}: check`);
    const end = referenceEnd(ref);
    assert.equal(s.result?.method ?? null, end, `${at}: end detection`);
    if (end) break;
  }
  const pgn = buildPgn({
    ref: `cprop${seed}`,
    mode: "FRIEND",
    date: 0,
    white: "W",
    black: "B",
    startFen,
    moves: uci,
    result: s.result ? { winner: s.result.winner, method: s.result.method } : null,
    tc: null,
  });
  const back = new Chess();
  back.loadPgn(pgn);
  assert.deepEqual(back.history(), ref.history(), `seed ${seed}: PGN moves`);
  assert.equal(back.fen(), ref.fen(), `seed ${seed}: PGN final FEN`);
  return { plies: uci.length, end: s.result?.method ?? null };
}

/** Plays seeds [from, to) and checks the mix of endings over the range. */
export function playRange(from: number, to: number): void {
  test(`property: seeds ${from}–${to - 1} agree with chess.js at every ply`, () => {
    const ends = new Map<string, number>();
    let plies = 0;
    for (let seed = from; seed < to; seed++) {
      const r = playOne(seed);
      plies += r.plies;
      ends.set(r.end ?? "unfinished", (ends.get(r.end ?? "unfinished") ?? 0) + 1);
    }
    assert.ok(plies > (to - from) * 50, `only ${plies} plies`);
    assert.ok((ends.get("checkmate") ?? 0) > 0, JSON.stringify([...ends]));
  });
}
