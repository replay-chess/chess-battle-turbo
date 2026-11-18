// The design member (phase-06 plan §12.1 compute.golden, §6.8 `member`): 212 in-scope rapid and blitz games since
// Aug 2026, all analysed, synthesised so that `computeWeakness()` with the synthetic baseline reproduces the numbers of
// the V3WeaknessProfile board: Missed forks 3.1 vs 1.6 (getting worse, middlegame, 7 of the last 20), Missed free
// pieces (the board's "Loose pieces", relabelled by FIX-1) 2.4 vs 1.9 (about the same, middlegame, 5 of the last 20),
// Time-pressure blunders 4.0 under 1 min vs 2.2 (improving, 4 of the last 20), two more rows, phases 88/84 · 71/76 ·
// 79/74, clock 0.8 · 1.1 · 2.6 · 4.0 ("Below 2 minutes the rate triples"), the openings table (Two Knights Defence
// C55–C59 38 games 47 % most played, Queen's Gambit Declined D30–D69 24 · 38 % most points lost, Sicilian, Alapin B22
// 21 · 57 %, London System D02 19 · 61 % best score), conversion 9 of 10, White book exits 81 %, band 1100–1300 from
// Lichess ratings around 1184.
//
// FIX-2 (D-P6-FIX2-1, -3): the rows and the trends now need evidence (a corrected significance test; a trend test with a
// direction only when the windows differ for sure), so the board's rates are carried by all 212 games (the plan's
// "newest 100 analysed" gave 108 free-piece events against 85.5 expected and 10 time-pressure blunders: chance) and 954
// moves under a minute; the windows are recent = games 0–59, prior = 60–179 (12 h apart), older = 180–211. A unit-test
// fixture of a pure function (allowed by the real-data rule); the leased persona and the seed reach the same state from
// rows in Postgres (WP8). Deterministic: `member-design.json` must equal `buildMemberDesign()` (the golden test checks).
import type { ErrorLogClock, ErrorLogJudgement, ErrorLogPhase } from "@repo/chess-analysis/codec";
import { type ErrorSpec, gameInput, type GameInputJson, type GameSpec, toJson } from "./gen";

export interface MemberDesign {
  /** computedAt of the golden run. */
  now: string;
  timeZone: string;
  ratingBand: null;
  profile: { weaknessTimeClasses: string[]; weaknessMonths: number };
  /** The live reads the payload fixtures use (Q-W2, Q-W4). */
  live: { inBank: Record<string, number>; puzzleRating: number; weaknessVersion: number; lastWeaknessSeenVersion: number };
  games: GameInputJson[];
}

const NOW = new Date("2026-11-16T10:00:00.000Z");
const HOUR = 3_600_000;
const IN_SCOPE = 212;
const ANALYSED = 212;

const endedAtOf = (i: number) => new Date(NOW.getTime() - (12 + 12 * i) * HOUR);
/** Games under a minute at some point: every even game (30 recent, 60 prior, 16 older), 9 moves under a minute each. */
const isLt1Game = (i: number) => i < ANALYSED && i % 2 === 0;
/** 70 % of the analysed games reach an endgame, in pairs (so the alternating accuracies average exactly). */
const reachesEndgame = (i: number) => Math.floor(i / 2) % 10 < 7;

type Bucket = 1 | 2 | 3;

interface PendingError {
  game: number;
  themes: string[];
  phase: ErrorLogPhase;
  winLoss: number;
  /** Fixed for the time-pressure errors; assigned later otherwise. */
  clock?: ErrorLogClock;
  judgement?: ErrorLogJudgement;
}

function cycle<T>(xs: readonly T[], j: number): T {
  return xs[j % xs.length]!;
}

/** Spreads `count` events of one theme over games by a per-game quota. */
function place(out: PendingError[], theme: string, quota: (i: number) => number, phaseOf: (j: number, game: number) => ErrorLogPhase, lossCycle: readonly number[]) {
  let j = 0;
  for (let i = 0; i < ANALYSED; i++) {
    for (let q = 0; q < quota(i); q++, j++) out.push({ game: i, themes: [theme], phase: phaseOf(j, i), winLoss: cycle(lossCycle, j) });
  }
  return j;
}

const mid = (): ErrorLogPhase => 1;
const PIECE_CYCLE = [0, 1, 2, 0, 3, 1, 4, 2, 0, 3, 1, 5] as const;

export function buildMemberDesign(): MemberDesign {
  const pending: PendingError[] = [];
  // Missed forks: 296 = last 20 (games 1, 3 … 13 × 3) 21 + games 20–59 × 2 + prior 90 (3 of every 4 games) + older 105
  // (3 a game, 4 in 180–188). Recent 2× the prior rate: "Getting worse this month".
  const forkQuota = (i: number) =>
    i < 20 ? (i % 2 === 1 && i <= 13 ? 3 : 0) : i < 60 ? 2 : i < 180 ? ((i - 60) % 4 === 3 ? 0 : 1) : i <= 188 ? 4 : 3;
  const forkPhase = (j: number, game: number): ErrorLogPhase => {
    const k = j % 7;
    if (k === 2) return 0;
    if (k === 5 && reachesEndgame(game)) return 2;
    return 1;
  };
  const forks = place(pending, "fork", forkQuota, forkPhase, [14, 18, 20, 22, 26]);
  // 46 of the forks (small mistakes, 8 Win% each) come under a minute, in the even games from 20 (games with time
  // trouble): 46 per 954 moves under a minute vs 250 per 8,586 with more time (1.66×), so the board's clock clause is
  // true (FIX-1, §8.17), and the rows keep the board's order.
  let lt1Forks = 0;
  for (const e of pending) {
    if (lt1Forks === 46) break;
    if (e.themes[0] === "fork" && e.game >= 20 && isLt1Game(e.game) && e.phase === 1) {
      e.clock = 4;
      e.judgement = 0;
      e.winLoss = 8;
      lt1Forks += 1;
    }
  }
  // Missed free pieces: 229 at one rate throughout ("About the same"): last 20 games 14–18 × 2, recent 65, prior 130.
  const hpQuota = (i: number) =>
    i < 20 ? (i >= 14 && i <= 18 ? 2 : 0) : i < 35 ? 2 : i < 60 ? 1 : i < 70 ? 2 : i < 180 ? 1 : i < 182 ? 2 : 1;
  const hpPhase = (j: number, game: number): ErrorLogPhase => (j % 6 === 0 ? 0 : j % 6 === 3 && reachesEndgame(game) ? 2 : 1);
  const hps = place(pending, "hangingPiece", hpQuota, hpPhase, [16, 20, 24]);
  // Missed pins: 153 at one rate (none in the last 20): recent 49 (games 20–28 × 2, 29–59 × 1), prior 98, older 6.
  const pins = place(pending, "pin", (i) => (i < 20 ? 0 : i <= 28 ? 2 : i < 60 ? 1 : i < 158 ? 1 : i >= 180 && i < 186 ? 1 : 0), mid, [9, 11, 13]);
  // Slow development: 95 in the opening, none in the last 20; recent 40 (games 20–59) vs prior 40 (every third game):
  // twice the rate, "Getting worse this month"; older 15.
  const devs = place(pending, "rc:development", (i) => (i < 20 ? 0 : i < 60 ? 1 : i < 180 ? (i % 3 === 0 ? 1 : 0) : i < 195 ? 1 : 0), () => 0, [6, 8, 10]);
  // Below the eligibility gates: skewers (k = 4), rook endgames (below the band), missed threats and discovered attacks (below the band).
  place(pending, "skewer", (i) => (i === 40 || i === 50 || i === 80 || i === 90 ? 1 : 0), mid, [15]);
  place(pending, "rookEndgame", (i) => (reachesEndgame(i) && i >= 21 && i % 3 === 0 ? 1 : 0), () => 2, [10, 14]);
  place(pending, "rc:missedThreat", (i) => (i >= 22 && i < 67 ? 1 : 0), mid, [12, 16, 20]);
  place(pending, "discoveredAttack", (i) => (i >= 23 && i < 63 && i % 2 === 1 ? 1 : 0), mid, [16]);
  // Time pressure: 38 blunders under a minute (recent 4 in games 0, 2, 4, 6; prior 32 in 60 … 122; older 2): 4 per 270
  // recent moves under a minute against 32 per 540 before, "Improving"; and 6 mistakes under a minute.
  const tpGames = [0, 2, 4, 6, ...Array.from({ length: 32 }, (_, k) => 60 + 2 * k), 180, 182];
  for (const i of tpGames) pending.push({ game: i, themes: [], phase: 1, winLoss: 30, clock: 4, judgement: 1 });
  for (const i of [8, 10, 12, 72, 74, 76]) pending.push({ game: i, themes: [], phase: 2, winLoss: 10, clock: 4, judgement: 0 });

  // Clock buckets and judgements of the other errors: buckets cycle 1to2, gt5, 2to5; blunders fill the quotas
  // gt5 19, 2to5 17, 1to2 120 (0.8 · 1.1 · 2.6 per 100 moves over 2,332 · 1,590 · 4,664 moves), every 9th remaining
  // error is a MISS.
  const quota: Record<Bucket, number> = { 1: 19, 2: 17, 3: 120 };
  const buckets: readonly Bucket[] = [3, 1, 2, 3, 2, 1, 3];
  let n = 0;
  for (const e of pending) {
    if (e.clock !== undefined) continue;
    const b = cycle(buckets, n);
    e.clock = b;
    if (quota[b] > 0 && (b === 3 ? n % 2 === 0 : n % 5 === 0)) {
      e.judgement = 1;
      quota[b] -= 1;
    } else {
      e.judgement = n % 9 === 4 ? 2 : 0;
    }
    n += 1;
  }
  // Any quota left (the cycle ran short): turn the first remaining mistakes of that bucket into blunders.
  for (const b of [1, 2, 3] as const) {
    for (const e of pending) {
      if (quota[b] === 0) break;
      if (e.clock === b && e.judgement !== 1) {
        e.judgement = 1;
        quota[b] -= 1;
      }
    }
    if (quota[b] !== 0) throw new Error(`member-design: bucket ${b} lacks ${quota[b]} blunders`);
  }

  const byGame = new Map<number, ErrorSpec[]>();
  pending.forEach((e, k) => {
    const list = byGame.get(e.game) ?? [];
    // The moved piece, roughly as club players err: pawns and minor pieces most, the king least.
    list.push({ judgement: e.judgement!, phase: e.phase, clockBucket: e.clock!, winLoss: e.winLoss, themes: e.themes, piece: cycle(PIECE_CYCLE, k) });
    byGame.set(e.game, list);
  });

  // Results and openings. Conversion: of the newest 30, games 0, 3 … 27 reached +3 and all but game 27 were won.
  const results: Array<"WIN" | "LOSS" | "DRAW"> = Array.from({ length: IN_SCOPE }, (_, i) => cycle(["WIN", "LOSS", "WIN", "LOSS", "DRAW"] as const, i));
  for (let i = 0; i < 30; i += 3) results[i] = i === 27 ? "LOSS" : "WIN";
  const families: Array<{ eco: string; w: number; d: number; l: number }> = [
    { eco: "C55", w: 16, d: 4, l: 18 }, // Two Knights Defence: 38 games, 18 points (47 %)
    { eco: "D35", w: 7, d: 4, l: 13 }, // Queen's Gambit Declined: 24 games, 9 points (38 %)
    { eco: "B22", w: 10, d: 4, l: 7 }, // Sicilian, Alapin: 21 games, 12 points (57 %)
    { eco: "D02", w: 10, d: 3, l: 6 }, // London System: 19 games, 11.5 points (61 %)
    { eco: "B12", w: 5, d: 2, l: 5 }, // Caro-Kann: 12 games
    { eco: "C50", w: 4, d: 2, l: 3 }, // Italian Game: 9 games
    { eco: "C00", w: 2, d: 1, l: 3 }, // French Defence: 6 games
  ];
  const eco: Array<string | null> = Array.from({ length: IN_SCOPE }, () => null);
  const used = new Set<number>();
  for (const f of families) {
    for (const [res, need] of [["WIN", f.w], ["DRAW", f.d], ["LOSS", f.l]] as const) {
      let left = need;
      for (let i = 0; i < IN_SCOPE && left > 0; i++) {
        if (used.has(i) || results[i] !== res) continue;
        used.add(i);
        eco[i] = f.eco;
        left -= 1;
      }
      if (left > 0) throw new Error(`member-design: not enough ${res} games for ${f.eco}`);
    }
  }
  // The rest are spread over families that stay below the table (≤ 8 games each).
  const rest = ["A45", "A40", "B01", "B07", "C20", "C41", "C44", "C60", "D00", "D10", "E60", "A10", "B20", "A00", "B00"];
  let r = 0;
  for (let i = 0; i < IN_SCOPE; i++) if (eco[i] === null) eco[i] = cycle(rest, r++);

  // Lichess ratings around 1184 (the newest 20 have median 1184), Chess.com on every third game.
  let lichess = 0;
  const games: GameInputJson[] = [];
  for (let i = 0; i < IN_SCOPE; i++) {
    const source = i % 3 === 2 ? "CHESSCOM" : "LICHESS";
    const ratingBefore = source === "LICHESS" ? 1184 + ((lichess++ % 7) - 3) * 4 : 1230 + (i % 5) * 6;
    const analysed = i < ANALYSED;
    const color = i % 2 === 0 ? "w" : "b";
    const spec: GameSpec = {
      gameId: String(910_000 + i),
      color,
      endedAt: endedAtOf(i),
      timeClass: i % 5 < 3 ? "BLITZ" : "RAPID",
      mode: "IMPORTED",
      result: results[i]!,
      ratingBefore,
      rated: true,
      source,
      ecoCode: eco[i]!,
      unanalysed: !analysed,
    };
    if (analysed) {
      const end = reachesEndgame(i);
      spec.phaseMoves = end ? [12, 22, 11] : [12, 33, 0];
      spec.phaseAccuracy = i % 2 === 0 ? [86, 69, end ? 77 : -1] : [90, 73, end ? 81 : -1];
      spec.accuracy = i % 2 === 0 ? 78 : 82;
      spec.clockMoves = isLt1Game(i) ? [9, 6, 21, 9] : [13, 9, 23, 0];
      spec.pieceMoves = [14, 8, 8, 7, 5, 3];
      spec.reachedPlus3 = i < 30 && i % 3 === 0;
      spec.converted = spec.reachedPlus3 && i !== 27;
      // Book exits: White 21 equal of 26 known (81 %), Black 18 of 24 (75 %); the rest unknown.
      const wIdx = i / 2;
      const bIdx = (i - 1) / 2;
      spec.bookExitWin = color === "w" ? (wIdx < 26 ? (wIdx < 21 ? 52 : 38) : null) : bIdx < 24 ? (bIdx < 18 ? 50 : 40) : null;
      spec.errors = byGame.get(i) ?? [];
    }
    games.push(toJson(gameInput(spec)));
  }
  // Out of scope (must not change a number): bullet games, bot games, aborted games, a BOT-titled import, a live game.
  const extra: GameSpec[] = [
    ...Array.from({ length: 6 }, (_, k): GameSpec => ({ gameId: String(920_000 + k), color: "w", endedAt: endedAtOf(k * 7), timeClass: "BULLET", ecoCode: "C55", errors: [{ judgement: 1, phase: 1, clockBucket: 4, winLoss: 40, themes: ["fork"] }] })),
    ...Array.from({ length: 3 }, (_, k): GameSpec => ({ gameId: String(921_000 + k), color: "b", endedAt: endedAtOf(k * 11), mode: "BOT", source: "REPLAY", errors: [{ judgement: 1, phase: 1, clockBucket: 2, winLoss: 50, themes: ["fork"] }] })),
    ...Array.from({ length: 2 }, (_, k): GameSpec => ({ gameId: String(922_000 + k), color: "w", endedAt: endedAtOf(k * 13), result: "ABORTED", unanalysed: true })),
    ...Array.from({ length: 2 }, (_, k): GameSpec => ({ gameId: String(923_000 + k), color: "b", endedAt: endedAtOf(k * 17 + 1), oppTitle: "BOT", ecoCode: "D35", result: "LOSS" })),
    { gameId: "924000", color: "w", endedAt: null, result: null, unanalysed: true },
  ];
  for (const s of extra) games.push(toJson(gameInput(s)));
  if (forks !== 296 || hps !== 229 || pins !== 153 || devs !== 95) throw new Error(`member-design: counts ${forks}/${hps}/${pins}/${devs}`);
  return {
    now: NOW.toISOString(),
    timeZone: "Europe/London",
    ratingBand: null,
    profile: { weaknessTimeClasses: [], weaknessMonths: 0 },
    live: { inBank: { fork: 12, hangingPiece: 7, "rc:timePressure": 4, "rc:development": 3, pin: 5 }, puzzleRating: 1512, weaknessVersion: 3, lastWeaknessSeenVersion: 2 },
    games,
  };
}
