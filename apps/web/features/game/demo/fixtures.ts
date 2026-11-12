// Fixtures for the /dev/ui/game demo route (P2 plan 4.9): one client store per design state, built by game-core's
// scenarios (the real server machine and client reducer over the Opera Game line, design L.MAIN), so the demo shows
// exactly what a live game in that state shows. Deterministic (fixed epoch, seeded walk), so the server render and
// the hydrated page match.
//
// Every one of the 55 states is reachable. The 5 states P2 does not light (plan 4.3: tournament and the P3/P12
// result variants, over_guest dropped) render their P2 fallback, named in `notes`. Params:
//   side=w|b        the other player's seat when that seat reaches the same state (else the default seat + a note)
//   mode=spectate   the spectator's store (states with a spectator); mode=bot turns a live store into a bot game
//   variant=restart | restart_announced | engine_error | other_tab   (plan 4.7 / 4.3 #24 variants; restart = the
//                   restart under way, clocks paused; restart_announced = a restart time announced, the game runs on)
//   stress=1        120 plies, 20-character names, three-digit move numbers, the longest header (testing X9)

import { Chess } from "chess.js";
import { createClientGame, reduceClient, type ClientGame } from "@repo/game-core/client/reducer";
import {
  DESIGN_STATES,
  UNLIT_STATES,
  deriveViewState,
  type DesignState,
} from "@repo/game-core/client/viewState";
import type { GameState, Side } from "@repo/game-core/machine/types";
import { Harness, type ClientTranscript, type ViewerId } from "@repo/game-core/testing/harness";
import { SCENARIOS, T0, liveInput } from "@repo/game-core/testing/scenarios";

export { DESIGN_STATES };
export type DemoMode = "live" | "bot" | "spectate";
export const DEMO_VARIANTS = ["restart", "restart_announced", "engine_error", "other_tab"] as const;
export type DemoVariant = (typeof DEMO_VARIANTS)[number];

export interface DemoParams {
  state: DesignState;
  side?: Side | null;
  mode?: DemoMode;
  variant?: DemoVariant | null;
  stress?: boolean;
}

export interface DemoFixture {
  requested: DesignState;
  /** The primary state the screen derives at `serverNow` (its `data-phase`). */
  derived: DesignState;
  lit: boolean;
  game: ClientGame;
  /** Server-clock epoch ms the fixture is shown at (clocks and countdowns start here). */
  serverNow: number;
  viewer: ViewerId;
  notes: string[];
}

export function isDesignState(s: string | null | undefined): s is DesignState {
  return !!s && (DESIGN_STATES as readonly string[]).includes(s);
}

/** P2 fallbacks for the states other phases light (plan 4.3, 2.4). */
const UNLIT_FALLBACK: Record<string, { base: DesignState; note: string; mode?: GameState["mode"] }> = {
  tournament: { base: "your_move", mode: "TOURNAMENT", note: "tournament strip is P12; P2 renders a tournament game as your_move" },
  over_analysing: { base: "over_checkmate_win", note: "the accuracy slot (Analysing · N%) is P3; P2 shows the plain result" },
  over_legend: { base: "over_checkmate_win", note: "the legend slot (Compare, Replay from move N) is P3; P2 shows the plain result" },
  over_tournament: {
    base: "over_checkmate_win",
    mode: "TOURNAMENT",
    note: "the tournament slot is P12; P2 shows the result with Back to tournament",
  },
  over_guest: { base: "over_checkmate_win", note: "dropped (Phase 0 §1.6): guests cannot play" },
};

type Built = { g: Harness; viewer: ViewerId; serverNow?: number };

function storeOf(built: Built | ClientTranscript, viewer: ViewerId | null): { game: ClientGame; viewer: ViewerId; serverNow: number } | null {
  if ("v" in built) return null;
  const v = viewer ?? built.viewer;
  const game = built.g.clients[v];
  if (!game) return null;
  return { game, viewer: v, serverNow: built.serverNow ?? built.g.now };
}

/** The bot transcript is a ClientTranscript (no harness): replay it as a local game (bot view on). */
function replayBot(t: ClientTranscript): { game: ClientGame; serverNow: number } {
  let game = createClientGame(t.initial, { now: t.t0, conn: "live", joined: false, bot: true });
  for (const step of t.steps) {
    const now = t.t0 + step.t;
    game = reduceClient(game, "event" in step ? { type: "event", event: step.event, now } : step.action).store;
  }
  return { game, serverNow: t.t0 + t.serverNow };
}

const NO_BOT = { thinking: false, hint: null, engineError: false, otherTab: false };

function asBot(g: ClientGame): ClientGame {
  const s = g.state;
  const me: Side = s.you.color ?? "w";
  const opp: Side = me === "w" ? "b" : "w";
  const engine = { ...s.players[opp], displayName: "Engine 1400", initials: "E", isBot: true, online: true, graceEndsAt: null, ref: null };
  return {
    ...g,
    bot: g.bot ?? NO_BOT,
    state: {
      ...s,
      mode: "BOT",
      bot: { elo: 1400, name: "Engine 1400" },
      players: { ...s.players, [opp]: engine } as GameState["players"],
      header: { ...s.header, right: "" },
    },
  };
}

function applyVariant(g: ClientGame, variant: DemoVariant, serverNow: number): ClientGame {
  switch (variant) {
    case "restart":
      return {
        ...g,
        conn: "reconnecting",
        disconnectedAt: g.disconnectedAt ?? serverNow,
        restarting: { restartAt: serverNow + 30_000 },
        state: { ...g.state, frozen: { since: serverNow, reason: "restart" } },
      };
    case "restart_announced":
      return { ...g, restarting: { restartAt: serverNow + 42_000 } };
    case "engine_error":
      return { ...g, bot: { ...(g.bot ?? NO_BOT), engineError: true } };
    case "other_tab":
      return { ...g, bot: { ...(g.bot ?? NO_BOT), otherTab: true } };
  }
}

export function buildDemoFixture(p: DemoParams): DemoFixture {
  if (p.stress) return withDerived(stressFixture(p.state), []);
  const notes: string[] = [];
  const fallback = UNLIT_FALLBACK[p.state];
  const lit = !(UNLIT_STATES as readonly string[]).includes(p.state);
  const base = fallback?.base ?? p.state;
  if (fallback) notes.push(`${p.state}: ${fallback.note}`);

  const make = SCENARIOS[base];
  if (!make) throw new Error(`no demo scenario for ${base}`);
  const built = make() as Built | ClientTranscript;

  let picked: { game: ClientGame; viewer: ViewerId; serverNow: number };
  if ("v" in built) {
    picked = { ...replayBot(built), viewer: "w" };
  } else {
    picked = storeOf(built, null)!;
    const want: ViewerId | null = p.mode === "spectate" ? "spect" : p.side && p.side !== picked.viewer ? p.side : null;
    if (want) {
      const other = storeOf(built, want);
      const ok = other && (want === "spect" || deriveViewState(other.game, other.serverNow).primary === base);
      if (other && ok) picked = other;
      else notes.push(`${want === "spect" ? "mode=spectate" : `side=${want}`} does not reach ${base}; showing the default seat`);
    }
  }

  let game = picked.game;
  if (fallback?.mode) game = { ...game, state: { ...game.state, mode: fallback.mode } };
  if (p.mode === "bot" && game.state.mode !== "BOT") {
    if (game.state.you.role === "player") game = asBot(game);
    else notes.push("mode=bot needs a player seat");
  }
  if (p.variant) game = applyVariant(game, p.variant, picked.serverNow);
  return withDerived({ requested: p.state, lit, game, serverNow: picked.serverNow, viewer: picked.viewer }, notes);
}

/** A fixture from a harness a later phase's demo built (P3's legend games, features/review/demo/game-over-games.ts). */
export function demoFixtureOf(g: Harness, viewer: ViewerId, requested: DesignState): DemoFixture {
  const picked = storeOf({ g, viewer }, null);
  if (!picked) throw new Error(`demoFixtureOf: no ${viewer} client`);
  return withDerived({ requested, lit: true, game: picked.game, serverNow: picked.serverNow, viewer: picked.viewer }, []);
}

function withDerived(f: Omit<DemoFixture, "derived" | "notes">, notes: string[]): DemoFixture {
  // The screen derives the hydration snapshot at `state.serverNow`: pin it to the moment the fixture is shown.
  const game = { ...f.game, state: { ...f.game.state, serverNow: f.serverNow } };
  return { ...f, game, derived: deriveViewState(game, f.serverNow).primary, notes };
}

// ── stress=1 (testing X9) ──

export const STRESS_NAMES = { w: "Maximilian_Oberhaus2", b: "Alexandra_Kowalczyk9" } as const;
export const STRESS_HEADER =
  "D37 · Queen's Gambit Declined, Harrwitz Attack, Main Line, Fianchetto Defence · Karpov vs Kasparov 1985";
export const STRESS_PLIES = 120;

/** Seeded PRNG (mulberry32), the same walk on server and client. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A legal random walk that prefers quiet moves and never ends the game (mate, stalemate, repetition, 50 moves). */
export function quietWalk(fen: string, plies: number, seed: number): { uci: string[]; fen: string } {
  const chess = new Chess(fen);
  const rand = mulberry32(seed);
  const uci: string[] = [];
  for (let i = 0; i < plies; i++) {
    const moves = chess.moves({ verbose: true });
    const quiet = moves.filter((m) => !m.captured && !m.promotion);
    const pool = [...(quiet.length > 0 ? quiet : moves)];
    let played = false;
    while (pool.length > 0) {
      const pick = pool.splice(Math.floor(rand() * pool.length), 1)[0]!;
      chess.move(pick);
      if (!chess.isGameOver()) {
        uci.push(pick.from + pick.to + (pick.promotion ?? ""));
        played = true;
        break;
      }
      chess.undo();
    }
    if (!played) throw new Error(`quietWalk: no non-terminal move at ply ${i}`);
  }
  return { uci, fen: chess.fen() };
}

let stressCache: Omit<DemoFixture, "derived" | "notes"> | null = null;

function stressFixture(requested: DesignState): Omit<DemoFixture, "derived" | "notes"> {
  if (stressCache) return { ...stressCache, requested };
  const opening = quietWalk(new Chess().fen(), 30, 1_202_611);
  const f = opening.fen.split(" ");
  f[5] = "45"; // later moves reach 104…105: three-digit move numbers in the strip and the list
  const startFen = f.join(" ");
  const walk = quietWalk(startFen, STRESS_PLIES, 1_202_612);
  const g = new Harness(
    liveInput({
      ref: "cstressgame000000000000001",
      tc: { initialMs: 900_000, incrementMs: 10_000 },
      startFen,
      studySeconds: 0,
      startKind: "position",
      headerLeft: STRESS_HEADER,
      prefix: { sans: "", startMoveNo: 1, startsBlack: false },
      seats: {
        w: { ref: "cuserwhite0000000000000001", name: STRESS_NAMES.w, avatarUrl: null, rating: 2851 },
        b: { ref: "cuserblack0000000000000001", name: STRESS_NAMES.b, avatarUrl: null, rating: 1184 },
      },
    }),
    T0,
  ).joinAll();
  for (const uci of walk.uci) g.advance(5_000).move(g.server.turn, uci);
  stressCache = { requested, lit: true, game: g.clients.w!, serverNow: g.now + 2_000, viewer: "w" };
  return stressCache;
}
