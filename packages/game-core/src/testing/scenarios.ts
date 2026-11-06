// One scenario per lit V3Game state (plan 4.3), each driven through the real server machine and client reducer,
// ending in a client transcript whose derived primary state is that design state. The Opera Game (design
// L.MAIN, from @repo/chess-fixtures/design/V3Game.json) is the default line, as in the template.

import { INITIAL_FEN } from "../constants";
import { projectState, type CreateGameInput } from "../machine/create";
import type { GameState } from "../machine/types";
import { createClientGame, reduceClient } from "../client/reducer";
import { deriveViewState, type DesignState } from "../client/viewState";
import { fenAfter, sanToUci } from "../rules/chess";
import { snapshotOf, type GameRecord } from "../snapshot";
import { Harness, type ClientTranscript, type ViewerId } from "./harness";

export const T0 = 1_700_000_000_000;

/** Opera Game, 1.e4 … 17.Rd8# (design L.MAIN). */
export const OPERA_SAN =
  "e4 e5 Nf3 d6 d4 Bg4 dxe5 Bxf3 Qxf3 dxe5 Bc4 Nf6 Qb3 Qe7 Nc3 c6 Bg5 b5 Nxb5 cxb5 Bxb5+ Nbd7 O-O-O Rd8 Rxd7 Rxd7 Rd1 Qe6 Bxd7+ Nxd7 Qb8+ Nxb8 Rd8#".split(
    " ",
  );
export const OPERA_UCI = sanToUci(INITIAL_FEN, OPERA_SAN);
/** "Game starts here": the legend start after 9…b5. */
export const LEGEND_START_PLY = 18;
export const LEGEND_FEN = fenAfter(INITIAL_FEN, OPERA_UCI.slice(0, LEGEND_START_PLY));
export const LEGEND_MOVES = OPERA_UCI.slice(LEGEND_START_PLY);

export function seats(): CreateGameInput["seats"] {
  return {
    w: { ref: "cuserwhite0000000000000001", name: "knightowl_88", avatarUrl: null, rating: 1184 },
    b: { ref: "cuserblack0000000000000001", name: "martin_k", avatarUrl: null, rating: 1212 },
  };
}

export function liveInput(over: Partial<CreateGameInput> = {}): CreateGameInput {
  return {
    ref: "cgame0000000000000000000001",
    mode: "FRIEND",
    tc: { initialMs: 300_000, incrementMs: 3_000 },
    startFen: LEGEND_FEN,
    studySeconds: 30,
    startKind: "position",
    headerLeft: "C41 · Philidor · Morphy vs Duke Karl / Count Isouard 1858",
    prefix: { sans: OPERA_SAN.slice(0, LEGEND_START_PLY).join(" "), startMoveNo: 1, startsBlack: false },
    seats: seats(),
    ...over,
  };
}

const h = (over: Partial<CreateGameInput> = {}) => new Harness(liveInput(over), T0);

/** Legend game past study and both first moves (10.Nxb5 cxb5), White to move in `playing`. */
function playing(over: Partial<CreateGameInput> = {}): Harness {
  const g = h(over).joinAll();
  g.advance(1_000).command("w", { type: "ready", now: 0 }, "study:ready", { type: "ready", side: "w" });
  g.advance(1_000).command("b", { type: "ready", now: 0 }, "study:ready", { type: "ready", side: "b" });
  g.advance(3_000).move("w", LEGEND_MOVES[0]!);
  g.advance(3_000).move("b", LEGEND_MOVES[1]!);
  return g;
}

/** Plays the legend line from the current ply for `n` plies. */
function playOn(g: Harness, n: number, stepMs = 4_000): Harness {
  for (let i = 0; i < n; i++) {
    const ply = g.server.moves.length;
    g.advance(stepMs).move(g.server.turn, LEGEND_MOVES[ply]!);
  }
  return g;
}

function ended(how: "resign_b" | "mate"): Harness {
  const g = playing();
  if (how === "mate") return playOn(g, LEGEND_MOVES.length - 2);
  g.advance(2_000).command("b", { type: "confirmResign", now: 0 }, "game:resign", { type: "resign", side: "b" });
  return g;
}

type Built = { g: Harness; viewer: ViewerId; serverNow?: number };

/** Builders for every lit state; each returns the harness, the viewer and (optionally) the server clock to derive at. */
export const SCENARIOS: Partial<Record<DesignState, () => Built | ClientTranscript>> = {
  loading: () => {
    const g = h().join("w").join("b", { joined: false });
    return { g, viewer: "b" };
  },
  waiting: () => ({ g: h().join("w"), viewer: "w" }),
  study: () => ({ g: h().joinAll(), viewer: "w" }),
  study_last5: () => {
    const g = h().joinAll();
    return { g, viewer: "w", serverNow: T0 + 26_000 };
  },
  study_reconnect: () => {
    const g = h().joinAll().advance(5_000);
    g.apply("w", { type: "conn", conn: "reconnecting", now: g.now });
    return { g, viewer: "w" };
  },
  abort: () => {
    const g = h({
      startFen: INITIAL_FEN,
      studySeconds: 0,
      startKind: "initial",
      headerLeft: "",
      prefix: { sans: "", startMoveNo: 1, startsBlack: false },
    }).joinAll();
    return { g, viewer: "w" };
  },
  rematch_study: () => ({ g: h({ rematchOf: "cparent00000000000000000001" }).joinAll(), viewer: "b" }),
  rematch_first: () => {
    const g = h({ rematchOf: "cparent00000000000000000001" }).joinAll().advance(30_000);
    g.serve({ type: "timer" });
    return { g, viewer: "b" };
  },
  rematch_your: () => {
    const g = h({ rematchOf: "cparent00000000000000000001" }).joinAll().advance(30_000);
    g.serve({ type: "timer" });
    g.advance(4_000).move("w", LEGEND_MOVES[0]!);
    return { g, viewer: "b" };
  },
  your_move: () => ({ g: playing(), viewer: "w" }),
  their_move: () => ({ g: playing(), viewer: "b" }),
  premove: () => {
    const g = playing();
    g.advance(2_000).apply("b", { type: "premove", uci: "e7e6", now: g.now });
    return { g, viewer: "b" };
  },
  premove_cancelled: () => {
    const g = playing();
    g.advance(2_000).apply("b", { type: "premove", uci: "e7e6", now: g.now });
    g.advance(1_000).apply("b", { type: "premove", uci: null, now: g.now, reason: "cancelled" });
    return { g, viewer: "b" };
  },
  check: () => {
    const g = h({ startFen: INITIAL_FEN, studySeconds: 0, startKind: "initial", headerLeft: "" }).joinAll();
    for (const uci of sanToUci(INITIAL_FEN, ["d4", "e5", "Nf3", "Bb4+"])) g.advance(3_000).move(g.server.turn, uci);
    return { g, viewer: "w" };
  },
  illegal: () => {
    const g = playOn(playing(), 4); // … 12.O-O-O Rd8, White to move
    g.advance(2_000).apply("w", { type: "illegal", from: "d1", to: "d8", now: g.now });
    return { g, viewer: "w" };
  },
  promotion: () => {
    const g = h({
      startFen: "8/1P3k2/8/5p2/8/6P1/5K2/r7 w - - 0 40",
      studySeconds: 0,
      headerLeft: "Endgame · move 41",
      prefix: { sans: "", startMoveNo: 1, startsBlack: false },
    }).joinAll();
    g.advance(2_000).move("w", "f2e3");
    g.advance(2_000).move("b", "a1b1");
    g.advance(2_000).move("w", "b7b8"); // no piece yet: the picker opens
    return { g, viewer: "w" };
  },
  rejected: () => {
    const g = playing();
    // The client sends a move on a stale ply (another tab already moved): the server refuses with its state.
    g.advance(1_000).move("w", LEGEND_MOVES[2]!);
    g.advance(1_000).move("b", LEGEND_MOVES[3]!);
    const r = g.serve({ type: "move", side: "w", ply: g.server.startPly + 3, uci: "a2a3", clientMoveId: "stale-1" });
    g.apply("w", { type: "move", uci: "a2a3", clientMoveId: "stale-1", now: g.now, serverNow: g.now });
    g.apply("w", { type: "moveAck", clientMoveId: "stale-1", ack: r.ack!, now: g.now });
    return { g, viewer: "w" };
  },
  low_time: () => {
    const g = playing();
    return { g, viewer: "w", serverNow: g.now + 291_000 };
  },
  viewing: () => {
    const g = playOn(playing(), 6);
    g.apply("w", { type: "view", ply: g.server.startPly + 2 });
    return { g, viewer: "w" };
  },
  draw_sent: () => {
    const g = playOn(playing(), 1);
    g.advance(1_000).command("w", { type: "drawOffer", now: g.now }, "draw:offer", { type: "drawOffer", side: "w" });
    return { g, viewer: "w" };
  },
  draw_received: () => {
    const g = playOn(playing(), 1);
    g.advance(1_000).command("b", { type: "drawOffer", now: g.now }, "draw:offer", { type: "drawOffer", side: "b" });
    return { g, viewer: "w" };
  },
  draw_declined: () => {
    const g = playOn(playing(), 1);
    g.advance(1_000).command("b", { type: "drawOffer", now: g.now }, "draw:offer", { type: "drawOffer", side: "b" });
    g.advance(2_000).command("w", { type: "drawAnswer", accept: false, now: g.now }, "draw:decline", {
      type: "drawDecline",
      side: "w",
    });
    return { g, viewer: "b" };
  },
  resign_confirm: () => {
    const g = playing();
    g.apply("w", { type: "resign", open: true });
    return { g, viewer: "w" };
  },
  reconnecting: () => {
    const g = playing();
    g.advance(2_000).apply("w", { type: "conn", conn: "reconnecting", now: g.now });
    g.advance(1_000).move("w", LEGEND_MOVES[2]!); // queued in the outbox
    return { g, viewer: "w" };
  },
  reconnected: () => {
    const g = playing();
    g.advance(2_000).apply("w", { type: "conn", conn: "reconnecting", now: g.now });
    g.serve({ type: "detach", side: "w", socketId: "w-1" });
    g.advance(1_000).move("w", LEGEND_MOVES[2]!);
    g.advance(3_000).apply("w", { type: "conn", conn: "live", now: g.now });
    g.serve({ type: "attach", side: "w", socketId: "w-2" });
    const state = projectFor(g, "w");
    const out = g.apply("w", { type: "replace", state, reason: "join", now: g.now });
    g.flush("w", out);
    return { g, viewer: "w" };
  },
  opp_disconnected: () => {
    const g = playOn(playing(), 1);
    g.advance(1_000).serve({ type: "detach", side: "b", socketId: "b-2" });
    return { g, viewer: "w" };
  },
  opp_reconnected: () => {
    const g = playOn(playing(), 1);
    g.advance(1_000).serve({ type: "detach", side: "b", socketId: "b-2" });
    g.advance(5_000).serve({ type: "attach", side: "b", socketId: "b-9" });
    return { g, viewer: "w" };
  },
  bot: () => botTranscript(),
  already_ended: () => {
    const g = ended("resign_b");
    g.advance(180_000).join("spect"); // a late player tab, minutes later: re-join White's store from the ended state
    const state = projectFor(g, "w");
    g.clients.w = createClientGame(state, { now: g.now, conn: "live", joined: false });
    g.steps.w.length = 0;
    g.initial.w = state;
    g.apply("w", { type: "replace", state, reason: "join", now: g.now });
    return { g, viewer: "w" };
  },
  server_error: () => {
    const g = playing();
    g.apply("w", {
      type: "event",
      event: { name: "game:error", payload: { ref: g.server.ref, code: "internal", message: "x" } },
      now: g.now,
    });
    return { g, viewer: "w" };
  },
  spectate: () => ({ g: playOn(playing(), 3), viewer: "spect" }),
  over_checkmate_win: () => ({ g: ended("mate"), viewer: "w" }),
  over_checkmate_loss: () => ({ g: ended("mate"), viewer: "b" }),
  over_resign_win: () => ({ g: ended("resign_b"), viewer: "w" }),
  over_resign_loss: () => ({ g: ended("resign_b"), viewer: "b" }),
  over_timeout_win: () => {
    const g = playing();
    g.advance(300_100).serve({ type: "timer" });
    return { g, viewer: "b" };
  },
  over_timeout_loss: () => {
    const g = playing();
    g.advance(300_100).serve({ type: "timer" });
    return { g, viewer: "w" };
  },
  over_timeout_insufficient: () => {
    const g = h({
      startFen: "7R/8/4k3/8/8/2K5/8/7r b - - 0 79",
      studySeconds: 0,
      headerLeft: "Endgame · move 81",
    }).joinAll();
    g.advance(2_000).move("b", "h1h2");
    g.advance(2_000).move("w", "h8h2");
    g.advance(2_000).move("b", "e6d5");
    g.advance(300_100).serve({ type: "timer" });
    return { g, viewer: "w" };
  },
  over_stalemate: () => {
    const g = h({
      startFen: "6k1/8/5K2/8/8/8/5Q2/8 w - - 0 57",
      studySeconds: 0,
      headerLeft: "Endgame · move 59",
    }).joinAll();
    for (const uci of ["f6g6", "g8h8", "f2f7"]) g.advance(2_000).move(g.server.turn, uci);
    return { g, viewer: "w" };
  },
  over_threefold: () => {
    const g = h({ startFen: INITIAL_FEN, studySeconds: 0, headerLeft: "" }).joinAll();
    for (const uci of ["g1f3", "g8f6", "f3g1", "f6g8", "g1f3", "g8f6", "f3g1", "f6g8"])
      g.advance(2_000).move(g.server.turn, uci);
    return { g, viewer: "w" };
  },
  over_fifty: () => {
    const g = h({
      startFen: "8/8/4k3/8/8/4K3/8/R6r w - - 98 120",
      studySeconds: 0,
      headerLeft: "Endgame · move 92",
    }).joinAll();
    for (const uci of ["a1a7", "h1h2"]) g.advance(2_000).move(g.server.turn, uci);
    return { g, viewer: "w" };
  },
  over_insufficient: () => {
    const g = h({
      startFen: "8/8/4k3/8/8/2K5/8/2r5 b - - 0 69",
      studySeconds: 0,
      headerLeft: "Endgame · move 70",
    }).joinAll();
    for (const uci of ["c1c2", "c3c2"]) g.advance(2_000).move(g.server.turn, uci);
    return { g, viewer: "w" };
  },
  over_agreement: () => {
    const g = playOn(playing(), 1);
    g.advance(1_000).command("b", { type: "drawOffer", now: g.now }, "draw:offer", { type: "drawOffer", side: "b" });
    g.advance(1_000).command("w", { type: "drawAnswer", accept: true, now: g.now }, "draw:accept", {
      type: "drawAccept",
      side: "w",
    });
    return { g, viewer: "w" };
  },
  over_abandoned: () => {
    const g = playOn(playing(), 1);
    g.advance(1_000).serve({ type: "detach", side: "b", socketId: "b-2" });
    g.advance(30_000).serve({ type: "timer" });
    return { g, viewer: "w" };
  },
  over_aborted: () => {
    const g = h({ startFen: INITIAL_FEN, studySeconds: 0, headerLeft: "" }).joinAll();
    g.advance(30_000).serve({ type: "timer" });
    return { g, viewer: "w" };
  },
  over_spectator: () => ({ g: ended("mate"), viewer: "spect" }),
  over_rematch_sent: () => {
    const g = ended("mate");
    g.advance(2_000).command("w", { type: "rematchOffer", now: g.now, serverNow: g.now }, "rematch:offer", {
      type: "rematchOffer",
      side: "w",
    });
    return { g, viewer: "w" };
  },
  over_rematch_received: () => {
    const g = ended("mate");
    g.advance(2_000).command("b", { type: "rematchOffer", now: g.now, serverNow: g.now }, "rematch:offer", {
      type: "rematchOffer",
      side: "b",
    });
    return { g, viewer: "w" };
  },
  over_rematch_declined: () => {
    const g = ended("mate");
    g.advance(2_000).command("w", { type: "rematchOffer", now: g.now, serverNow: g.now }, "rematch:offer", {
      type: "rematchOffer",
      side: "w",
    });
    g.advance(2_000).command("b", { type: "rematchAnswer", accept: false, now: g.now }, "rematch:decline", {
      type: "rematchDecline",
      side: "b",
    });
    return { g, viewer: "w" };
  },
  over_rematch_expired: () => {
    const g = ended("mate");
    g.advance(2_000).command("w", { type: "rematchOffer", now: g.now, serverNow: g.now }, "rematch:offer", {
      type: "rematchOffer",
      side: "w",
    });
    g.advance(30_000).serve({ type: "timer" });
    return { g, viewer: "w" };
  },
};

/** The join-ack state the socket would send this player now. */
function projectFor(g: Harness, v: "w" | "b"): GameState {
  return projectState(g.server, { role: "player", color: v }, g.now);
}

/** A bot game in the human's turn with a level-1 hint shown (the design's `bot` state). */
export function botTranscript(): ClientTranscript {
  const record: GameRecord = {
    referenceId: "cbotgame000000000000000001",
    status: "IN_PROGRESS",
    mode: "BOT",
    rated: false,
    timeClass: "RAPID",
    startingFen: LEGEND_FEN,
    studySeconds: 0,
    moves: LEGEND_MOVES.slice(0, 4).join(" "),
    moveClocksMs: [600_000, 600_000, 590_000, 588_000],
    fen: null,
    initialTimeSeconds: 600,
    incrementSeconds: 0,
    whiteTimeMs: 590_000,
    blackTimeMs: 588_000,
    clockRunning: "w",
    phase: "PLAYING",
    phaseEndsAt: null,
    lastMoveAt: T0,
    endMethod: null,
    outcome: null,
    completedAt: null,
    updatedAt: T0,
    botElo: 1400,
    meta: {
      header: "C41 · Philidor · Morphy vs Duke Karl / Count Isouard 1858",
      prefixSan: OPERA_SAN.slice(0, LEGEND_START_PLY),
      rev: 4,
    },
    white: { ref: "cuserwhite0000000000000001", name: "knightowl_88", avatarUrl: null, rating: 1184 },
    black: null,
  };
  const initial = snapshotOf(record, { role: "player", color: "w" }, T0);
  let store = createClientGame(initial, { now: T0, conn: "live", joined: false, bot: true });
  const steps: ClientTranscript["steps"] = [
    { t: 0, action: { type: "replace", state: initial, reason: "local", now: T0 } },
    {
      t: 1_000,
      action: { type: "bot", patch: { hint: { level: 1, text: "Hint 1 of 2: look at your king.", arrow: null } } },
    },
  ];
  for (const s of steps)
    store = reduceClient(store, "event" in s ? { type: "event", event: s.event, now: T0 + s.t } : s.action).store;
  const view = deriveViewState(store, T0 + 2_000);
  return {
    v: 1,
    state: "bot",
    viewer: { role: "player", color: "w" },
    t0: T0,
    joined: true,
    initial,
    steps,
    serverNow: 2_000,
    expect: {
      primary: view.primary,
      zone: view.zone,
      actions: view.actions,
      bar: view.bar,
      toast: view.toast?.code ?? null,
    },
    commands: [],
  };
}

/** Builds the client transcript for one state (throws for states without a scenario). */
export function buildTranscript(state: DesignState): ClientTranscript {
  const make = SCENARIOS[state];
  if (!make) throw new Error(`no scenario for ${state}`);
  const built = make();
  if ("v" in built) return built;
  return built.g.transcript(built.viewer, state, built.serverNow ?? built.g.now);
}
