// The local (bot) controller over a fake engine, an in-memory journal and mocked timers (phase-02 plan 5.3, T14,
// T15): the bot replies after its think delay, Hint twice, Undo, Resign → complete, draw answers, the flag, the
// page-hidden pause (owner Q6), resume from the newer of journal and snapshot, the pending complete, and the
// two-tab lock.
import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import type { CompleteBody, CompleteResponse, GameCreateInput } from "@repo/contracts/http/games";
import { INITIAL_FEN } from "@repo/game-core/constants";
import type { BotJournal } from "@repo/game-core/local/journal";
import { Chess } from "@repo/game-core/rules/chess";
import { snapshotOf, type GameRecord, type GameSnapshot } from "@repo/game-core/snapshot";
import { ApiError } from "@/lib/api/errors";
import type { BoardMove, Sq } from "@/components/board/types";
import type { EngineInitInfo, EngineProgress } from "@/features/engine/uci";
import { createTabLock, type ChannelLike, type LockMessage } from "./lock";
import { createLocalController, type LocalController } from "./useLocalGame";
import type { BotEngine } from "./useBotEngine";

const T = 1_700_000_000_000;
const REF = "cbot00000000000000000001";
const INFO: EngineInitInfo = { eloFloor: 1320, source: "origin", cached: true, bytes: 0, ms: 5 };

function snapshot(over: Partial<GameRecord> = {}, color: "w" | "b" = "w"): GameSnapshot {
  const human = { ref: "cuserwhite0000000000000001", name: "knightowl_88", avatarUrl: null, rating: 1184 };
  const record: GameRecord = {
    referenceId: REF,
    status: "IN_PROGRESS",
    mode: "BOT",
    rated: false,
    timeClass: "RAPID",
    startingFen: INITIAL_FEN,
    studySeconds: 0,
    moves: "",
    moveClocksMs: [],
    fen: null,
    initialTimeSeconds: 600,
    incrementSeconds: 0,
    whiteTimeMs: 600_000,
    blackTimeMs: 600_000,
    clockRunning: null,
    phase: "PLAYING",
    phaseEndsAt: null,
    lastMoveAt: T,
    endMethod: null,
    outcome: null,
    completedAt: null,
    updatedAt: T,
    botElo: 1400,
    meta: { rev: 0 },
    white: color === "w" ? human : null,
    black: color === "b" ? human : null,
    ...over,
  };
  return snapshotOf(record, { role: "player", color }, T);
}

const firstLegal = (fen: string) => {
  const m = new Chess(fen).moves({ verbose: true })[0]!;
  return `${m.from}${m.to}${m.promotion ?? ""}`;
};

const mv = (uci: string): BoardMove => {
  const promotion = uci[4] as BoardMove["promotion"];
  return promotion ? { from: uci.slice(0, 2) as Sq, to: uci.slice(2, 4) as Sq, promotion, uci } : { from: uci.slice(0, 2) as Sq, to: uci.slice(2, 4) as Sq, uci };
};

class Bus {
  members = new Set<ChannelLike>();
  channel(): ChannelLike {
    const ch: ChannelLike = {
      onmessage: null,
      postMessage: (m: LockMessage) => {
        for (const other of this.members) if (other !== ch) other.onmessage?.({ data: m });
      },
      close: () => this.members.delete(ch),
    };
    this.members.add(ch);
    return ch;
  }
}

interface Rig {
  ctl: LocalController;
  journal: Map<string, BotJournal>;
  checkpoints: { rev: number; mode: string; plies: number }[];
  completes: CompleteBody[];
  created: GameCreateInput[];
  tracked: { name: string; props: Record<string, unknown> }[];
  engineCalls: { reply: number; best: number; evaluate: number };
  bus: Bus;
  /** The controller's engine-progress listeners (engine.onLoading). */
  loading: ((p: EngineProgress | null) => void)[];
  detach: () => void;
}

let t = T + 1_000;
const settle = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve();
};
async function advance(ms: number) {
  await settle();
  t += ms;
  mock.timers.tick(ms);
  await settle();
}

function rig(
  snap: GameSnapshot,
  opts: {
    journal?: Map<string, BotJournal>;
    bus?: Bus;
    replies?: string[];
    best?: string;
    evalCp?: number | null;
    complete?: (b: CompleteBody) => Promise<CompleteResponse>;
    attach?: boolean;
  } = {},
): Rig {
  const journal = opts.journal ?? new Map<string, BotJournal>();
  const bus = opts.bus ?? new Bus();
  const r: Omit<Rig, "ctl" | "detach"> = {
    journal,
    checkpoints: [],
    completes: [],
    created: [],
    tracked: [],
    engineCalls: { reply: 0, best: 0, evaluate: 0 },
    bus,
    loading: [],
  };
  const replies = [...(opts.replies ?? [])];
  const engine: BotEngine = {
    ready: async () => INFO,
    reply: async (state) => {
      r.engineCalls.reply++;
      return replies.shift() ?? firstLegal(state.fen);
    },
    best: async () => {
      r.engineCalls.best++;
      return opts.best ?? "g1f3";
    },
    evaluate: async () => {
      r.engineCalls.evaluate++;
      return opts.evalCp === undefined ? 0 : opts.evalCp;
    },
    newGame() {},
    retain: () => () => {},
    retry: async () => INFO,
    onLoading: (l) => {
      r.loading.push(l);
      return () => {
        r.loading.splice(r.loading.indexOf(l), 1);
      };
    },
  };
  let lockN = 0;
  const ctl = createLocalController(snap, {
    engine,
    createGame: (b) => r.created.push(b),
    complete:
      opts.complete ??
      (async (b) => {
        r.completes.push(b);
        return { status: "COMPLETED", outcome: "DRAW", method: b.method, analysis: { status: "none", etaSec: null }, comparison: null };
      }),
    now: () => t,
    random: () => 0,
    journal: {
      read: (ref) => journal.get(ref) ?? null,
      write: (ref, j) => void journal.set(ref, structuredClone(j)),
      remove: (ref) => void journal.delete(ref),
    },
    checkpoint: (_ref, body, mode) => r.checkpoints.push({ rev: body.rev, mode, plies: body.moves.length }),
    lock: (ref, events) => createTabLock(ref, events, { channel: () => bus.channel(), now: () => t, id: () => `tab${++lockN}-${Math.random()}` }),
    dom: null,
    track: (name, props) => r.tracked.push({ name, props }),
    defer: (fn) => fn(),
  });
  const detach = opts.attach === false ? () => {} : ctl.attach();
  return { ...r, ctl, detach };
}

const view = (ctl: LocalController) => ctl.store.getState();
const moves = (ctl: LocalController) => view(ctl).state.moves;

beforeEach(() => {
  t = T + 1_000;
  mock.timers.enable({ apis: ["setTimeout"] });
});
afterEach(() => {
  mock.timers.reset();
});

test("human move → the bot thinks, waits its delay, replies; journal after each ply", async () => {
  const g = rig(snapshot(), { replies: ["e7e5"] });
  assert.equal(view(g.ctl).bot?.thinking, false);
  g.ctl.move(mv("e2e4"));
  assert.equal(moves(g.ctl), "e2e4");
  assert.equal(g.journal.get(REF)?.moves.length, 1);
  await settle();
  assert.equal(view(g.ctl).bot?.thinking, true);
  assert.equal(moves(g.ctl), "e2e4", "no reply before the think delay (450–850 ms)");
  await advance(500);
  assert.equal(moves(g.ctl), "e2e4 e7e5");
  assert.equal(view(g.ctl).bot?.thinking, false);
  assert.equal(view(g.ctl).state.clocks.run, "w", "clocks run after two plies");
  assert.equal(g.journal.get(REF)?.moves.length, 2);
  assert.equal(g.journal.get(REF)?.rev, 2);
  g.detach();
});

test("the bot moves first when the human plays Black, and an illegal engine answer falls back to a legal move", async () => {
  const g = rig(snapshot({}, "b"), { replies: ["e2e5"] });
  await advance(900);
  assert.equal(moves(g.ctl).split(" ").length, 1);
  assert.equal(view(g.ctl).state.turn, "b");
  g.detach();
});

test("Hint twice: piece, then arrow + SAN; a third press repeats uncounted; a move clears it", async () => {
  const g = rig(snapshot(), { best: "g1f3" });
  g.ctl.hint!();
  await settle();
  assert.equal(view(g.ctl).bot?.hint?.text, "Hint 1 of 2: look at your knight.");
  assert.equal(view(g.ctl).bot?.hint?.arrow, null);
  g.ctl.hint!();
  await settle();
  assert.equal(view(g.ctl).bot?.hint?.text, "Hint 2 of 2: play Nf3.");
  assert.deepEqual(view(g.ctl).bot?.hint?.arrow, { from: "g1", to: "f3", color: "#0369a1" });
  g.ctl.hint!();
  await settle();
  assert.equal(g.engineCalls.best, 1, "one search per position");
  assert.equal(g.ctl.peek().assists.hints, 2);
  assert.deepEqual(
    g.tracked.map((e) => [e.name, e.props.level]),
    [
      ["hint_used", 1],
      ["hint_used", 2],
    ],
  );
  assert.equal(g.journal.get(REF)?.assists.hints, 2);
  g.ctl.move(mv("g1f3"));
  assert.equal(view(g.ctl).bot?.hint, null);
  g.detach();
});

test("Undo on your turn takes back your move and the reply, with the numbered toast", async () => {
  const g = rig(snapshot(), { replies: ["e7e5"] });
  g.ctl.move(mv("e2e4"));
  await advance(900);
  assert.equal(moves(g.ctl), "e2e4 e7e5");
  const revBefore = g.ctl.peek().rev;
  g.ctl.undo!();
  assert.equal(moves(g.ctl), "");
  assert.equal(view(g.ctl).toast?.code, "took_back");
  assert.equal(view(g.ctl).toast?.params?.text, "Took back 1.e4 and 1…e5.");
  assert.equal(g.ctl.peek().assists.undos, 1);
  assert.ok(g.ctl.peek().rev > revBefore, "rev increments on undo");
  assert.deepEqual(g.tracked.map((e) => e.name), ["undo_used"]);
  await advance(900);
  assert.equal(moves(g.ctl), "", "the bot does not move on your turn");
  g.detach();
});

test("Undo while the bot thinks takes back only your move and cancels the search", async () => {
  const g = rig(snapshot(), { replies: ["e7e5"] });
  g.ctl.move(mv("e2e4"));
  await settle();
  assert.equal(view(g.ctl).bot?.thinking, true);
  g.ctl.undo!();
  assert.equal(moves(g.ctl), "");
  assert.equal(view(g.ctl).bot?.thinking, false);
  await advance(900);
  assert.equal(moves(g.ctl), "", "the cancelled reply is dropped");
  g.detach();
});

test("Resign ends the game and completes once; success removes the journal", async () => {
  const g = rig(snapshot(), { replies: ["e7e5"] });
  g.ctl.move(mv("e2e4"));
  await advance(900);
  g.ctl.resign();
  assert.equal(view(g.ctl).state.phase, "ended");
  assert.equal(view(g.ctl).state.result?.method, "resignation");
  assert.equal(view(g.ctl).state.result?.winner, "b");
  await settle();
  assert.equal(g.completes.length, 1);
  assert.deepEqual(g.completes[0]!.moves, ["e2e4", "e7e5"]);
  assert.equal(g.completes[0]!.result, "b");
  assert.equal(g.journal.has(REF), false);
  g.ctl.resign();
  g.ctl.move(mv("d2d4"));
  await settle();
  assert.equal(g.completes.length, 1);
  g.detach();
});

test("a complete that keeps failing stays in the journal as pendingComplete; a final refusal drops it", async () => {
  const transient = rig(snapshot(), {
    complete: async () => {
      throw new ApiError({ status: 503, code: "unavailable" });
    },
  });
  transient.ctl.abort();
  await settle();
  assert.equal(transient.journal.get(REF)?.pendingComplete?.result, "aborted");
  transient.detach();

  const refused = rig(snapshot(), {
    complete: async () => {
      throw new ApiError({ status: 422, code: "illegal_moves" });
    },
  });
  refused.ctl.abort();
  await settle();
  assert.equal(refused.journal.has(REF), false);
  refused.detach();
});

test("checkmate by the human completes with method checkmate (fool's mate reversed)", async () => {
  const g = rig(snapshot({}, "b"), { replies: ["f2f3", "g2g4"] });
  await advance(900);
  g.ctl.move(mv("e7e5"));
  await advance(900);
  g.ctl.move(mv("d8h4"));
  assert.equal(view(g.ctl).state.result?.method, "checkmate");
  await settle();
  assert.equal(g.completes[0]?.method, "checkmate");
  assert.equal(g.completes[0]?.result, "b");
  g.detach();
});

test("the bot answers a draw offer after its delay: declined below 60 plies (toast + cooldown)", async () => {
  const g = rig(snapshot(), { replies: ["e7e5"], evalCp: 0 });
  g.ctl.offerDraw();
  assert.equal(view(g.ctl).state.drawOffer, null, "offers need two plies");
  g.ctl.move(mv("e2e4"));
  await advance(900);
  g.ctl.offerDraw();
  assert.equal(view(g.ctl).state.drawOffer?.by, "w");
  await advance(1_400);
  assert.equal(view(g.ctl).state.drawOffer?.by, "w", "answer after 1.5–2.5 s");
  await advance(200);
  assert.equal(view(g.ctl).state.drawOffer, null);
  assert.equal(view(g.ctl).toast?.code, "engine_declined_draw");
  assert.equal(view(g.ctl).state.canOfferAtPly.w, 2 + 4);
  g.ctl.offerDraw();
  assert.equal(view(g.ctl).toast?.code, "draw_cooldown");
  g.detach();
});

function quietLine(plies: number): string[] {
  // A deterministic line of `plies` moves with no ending and no repetition.
  for (let seed = 1; seed < 500; seed++) {
    const c = new Chess();
    let s = seed;
    const out: string[] = [];
    while (out.length < plies) {
      const legal = c.moves({ verbose: true });
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      const m = legal[s % legal.length]!;
      c.move(m);
      if (c.isGameOver() || c.isThreefoldRepetition() || c.isCheck()) break;
      out.push(`${m.from}${m.to}${m.promotion ?? ""}`);
    }
    if (out.length === plies && c.turn() === "w") return out;
  }
  throw new Error("no quiet line");
}

test("the bot accepts a draw at ≥ 60 plies with a level evaluation", async () => {
  const line = quietLine(60);
  const journal = new Map<string, BotJournal>([[REF, { v: 1, rev: 60, moves: line, clocksMs: [], startedAt: T, assists: { hints: 0, undos: 0 }, updatedAt: T }]]);
  const g = rig(snapshot(), { journal, evalCp: 12 });
  assert.equal(moves(g.ctl).split(" ").length, 60);
  g.ctl.offerDraw();
  await advance(2_000);
  assert.equal(view(g.ctl).state.result?.method, "agreement");
  await settle();
  assert.equal(g.completes[0]?.result, "draw");
  g.detach();
});

test("the human's clock flags: timeout, complete sent", async () => {
  const snap = snapshot({ moves: "e2e4 e7e5", moveClocksMs: [600_000, 600_000], whiteTimeMs: 1_000, clockRunning: "WHITE" } as Partial<GameRecord>);
  const g = rig(snap);
  assert.equal(view(g.ctl).state.clocks.run, "w");
  await advance(1_100);
  assert.equal(view(g.ctl).state.result?.method, "timeout");
  assert.equal(view(g.ctl).state.result?.winner, "b");
  await settle();
  assert.equal(g.completes[0]?.method, "timeout");
  g.detach();
});

test("page hidden on your turn pauses your clock; the bot never moves while hidden; beacons on hide", async () => {
  const g = rig(snapshot(), { replies: ["e7e5", "b8c6"] });
  g.ctl.move(mv("e2e4"));
  await advance(900);
  const before = view(g.ctl).state.clocks;
  g.ctl.setHidden(true);
  assert.equal(g.checkpoints.at(-1)?.mode, "beacon");
  await advance(60_000);
  g.ctl.setHidden(false);
  const c = view(g.ctl).state.clocks;
  const remaining = c.w - (t - c.at);
  assert.ok(Math.abs(remaining - (before.w - (t - 60_000 - before.at))) < 5, "the hidden minute was not charged");

  g.ctl.move(mv("g1f3"));
  await settle();
  g.ctl.setHidden(true);
  await advance(5_000);
  assert.equal(moves(g.ctl), "e2e4 e7e5 g1f3", "no bot move while hidden");
  const botClock = view(g.ctl).state.clocks;
  g.ctl.setHidden(false);
  const shifted = view(g.ctl).state.clocks;
  assert.equal(shifted.at - botClock.at, 5_000, "the bot's clock is not charged for the hidden time");
  await advance(900);
  assert.equal(moves(g.ctl), "e2e4 e7e5 g1f3 b8c6");
  g.detach();
});

test("checkpoints: a keepalive fetch every 10 plies; none when nothing changed", async () => {
  const g = rig(snapshot());
  for (let i = 0; i < 5; i++) {
    const fen = view(g.ctl).state.fen;
    g.ctl.move(mv(firstLegal(fen)));
    await advance(900);
  }
  assert.deepEqual(g.checkpoints, [{ rev: 10, mode: "fetch", plies: 10 }]);
  g.detach();
  // detach sends a beacon only when there is something new
  assert.equal(g.checkpoints.length, 1);
});

test("resume: a newer journal wins (reload resumes at the same ply); an older one is replaced by the snapshot", async () => {
  const journal = new Map<string, BotJournal>([
    [REF, { v: 1, rev: 4, moves: ["e2e4", "e7e5", "g1f3", "b8c6"], clocksMs: [600000, 600000, 598000, 597000], startedAt: T, assists: { hints: 2, undos: 1 }, updatedAt: T }],
  ]);
  const g = rig(snapshot(), { journal });
  assert.equal(moves(g.ctl), "e2e4 e7e5 g1f3 b8c6");
  assert.deepEqual(g.ctl.peek().assists, { hints: 2, undos: 1 });
  assert.equal(g.checkpoints[0]?.rev, 4, "the server is told about the newer line at once");
  g.detach();

  const older = new Map<string, BotJournal>([[REF, { v: 1, rev: 1, moves: ["d2d4"], clocksMs: [600000], startedAt: T, assists: { hints: 0, undos: 0 }, updatedAt: T }]]);
  const snap = snapshotOf(
    { ...(snapshotRecord()), moves: "e2e4 e7e5", moveClocksMs: [600_000, 600_000], meta: { rev: 3 } } as GameRecord,
    { role: "player", color: "w" },
    T,
  );
  const h = rig(snap, { journal: older });
  assert.equal(moves(h.ctl), "e2e4 e7e5");
  assert.equal(older.get(REF)?.rev, 3, "the stale journal is overwritten");
  h.detach();
});

function snapshotRecord(): GameRecord {
  return {
    referenceId: REF,
    status: "IN_PROGRESS",
    mode: "BOT",
    rated: false,
    timeClass: "RAPID",
    startingFen: INITIAL_FEN,
    studySeconds: 0,
    moves: "",
    moveClocksMs: [],
    fen: null,
    initialTimeSeconds: 600,
    incrementSeconds: 0,
    whiteTimeMs: 600_000,
    blackTimeMs: 600_000,
    clockRunning: null,
    phase: "PLAYING",
    phaseEndsAt: null,
    lastMoveAt: T,
    endMethod: null,
    outcome: null,
    completedAt: null,
    updatedAt: T,
    botElo: 1400,
    meta: { rev: 0 },
    white: { ref: "cuserwhite0000000000000001", name: "knightowl_88", avatarUrl: null, rating: 1184 },
    black: null,
  };
}

test("resume: a journal with a pending complete shows the result and re-sends it; an ended snapshot drops the journal", async () => {
  const body = { rev: 3, moves: ["e2e4"], clocksMs: [600000], result: "b" as const, method: "resignation" as const, assists: { hints: 0, undos: 0 }, endedAtClient: T };
  const journal = new Map<string, BotJournal>([[REF, { v: 1, rev: 3, moves: ["e2e4"], clocksMs: [600000], startedAt: T, assists: { hints: 0, undos: 0 }, updatedAt: T, pendingComplete: body }]]);
  const g = rig(snapshot(), { journal });
  assert.equal(view(g.ctl).state.phase, "ended");
  assert.equal(view(g.ctl).state.result?.method, "resignation");
  await settle();
  assert.equal(g.completes.length, 1);
  assert.equal(journal.has(REF), false);
  g.detach();

  const ended = snapshot({ status: "COMPLETED", phase: "ENDED", endMethod: "RESIGNATION", outcome: "BLACK", completedAt: T, moves: "e2e4" } as Partial<GameRecord>);
  const stale = new Map<string, BotJournal>([[REF, { v: 1, rev: 9, moves: ["d2d4"], clocksMs: [600000], startedAt: T, assists: { hints: 0, undos: 0 }, updatedAt: T }]]);
  const h = rig(ended, { journal: stale });
  assert.equal(view(h.ctl).state.phase, "ended");
  assert.equal(stale.has(REF), false);
  await advance(2_000);
  assert.equal(h.engineCalls.reply, 0);
  assert.equal(h.completes.length, 0);
  h.detach();
});

test("two tabs: the newer tab takes the game; 'Use this tab' takes it back and reloads the newer journal", async () => {
  const bus = new Bus();
  const journal = new Map<string, BotJournal>();
  const a = rig(snapshot(), { bus, journal, replies: ["e7e5"] });
  a.ctl.move(mv("e2e4"));
  await settle();
  t += 10;
  const b = rig(snapshot(), { bus, journal, replies: ["e7e5", "b8c6"] });
  assert.equal(view(a.ctl).bot?.otherTab, true);
  assert.equal(view(a.ctl).bot?.thinking, false, "the old tab stops its engine");
  assert.equal(moves(b.ctl), "e2e4", "the new tab resumed from the journal");
  await advance(900);
  assert.equal(moves(b.ctl), "e2e4 e7e5");
  assert.equal(moves(a.ctl), "e2e4", "the passive tab never moves");
  a.ctl.move(mv("g1f3"));
  assert.equal(moves(a.ctl), "e2e4");

  a.ctl.sync(); // "Use this tab"
  assert.equal(view(a.ctl).bot?.otherTab, false);
  assert.equal(view(b.ctl).bot?.otherTab, true);
  assert.equal(moves(a.ctl), "e2e4 e7e5");
  a.ctl.move(mv("g1f3"));
  assert.equal(moves(a.ctl), "e2e4 e7e5 g1f3");
  a.detach();
  b.detach();
});

test("engine failure shows the engine error; Try again (sync) retries and the bot moves", async () => {
  let fail = true;
  const g = rig(snapshot({}, "b"), { attach: false });
  const ctl = createLocalController(snapshot({}, "b"), {
    engine: {
      ready: async () => {
        if (fail) throw new Error("wasm blocked");
        return INFO;
      },
      reply: async (s) => {
        if (fail) throw new Error("wasm blocked");
        return firstLegal(s.fen);
      },
      best: async () => "e7e5",
      evaluate: async () => 0,
      newGame() {},
      retain: () => () => {},
      retry: async () => {
        fail = false;
        return INFO;
      },
      onLoading: () => () => {},
    },
    createGame: () => {},
    complete: async () => ({ status: "COMPLETED", outcome: "DRAW", method: "agreement", analysis: { status: "none", etaSec: null }, comparison: null }),
    now: () => t,
    random: () => 0,
    journal: { read: () => null, write: () => {}, remove: () => {} },
    checkpoint: () => {},
    lock: (ref, events) => createTabLock(ref, events, { channel: () => g.bus.channel(), now: () => t, id: () => "x" }),
    dom: null,
    track: () => {},
    defer: (fn) => fn(),
  });
  const detach = ctl.attach();
  await settle();
  assert.equal(ctl.store.getState().bot?.engineError, true);
  ctl.sync();
  await settle();
  await advance(900);
  assert.equal(ctl.store.getState().bot?.engineError, false);
  assert.equal(ctl.store.getState().state.moves.split(" ").length, 1);
  detach();
});

test("Rematch and Restart create a new bot game from this one (colours handled by the server)", () => {
  const g = rig(snapshot({ initialTimeSeconds: 180, incrementSeconds: 2 } as Partial<GameRecord>));
  g.ctl.offerRematch();
  g.ctl.restart!();
  assert.deepEqual(g.created, [
    { mode: "BOT", parentGameRef: REF, reason: "rematch", tc: { initialSeconds: 180, incrementSeconds: 2 } },
    { mode: "BOT", parentGameRef: REF, reason: "restart", tc: { initialSeconds: 180, incrementSeconds: 2 } },
  ]);
  g.detach();
});

// A slow network is not an engine failure: while the engine files download, the bot game says so ("Loading the
// engine… N %") and never shows the engine error; the listener goes with the controller.
test("engine download progress shows as loading, never as the engine error; detach unsubscribes", async () => {
  const g = rig(snapshot({}, "w"));
  await settle();
  assert.equal(g.loading.length, 1, "the controller listens to the engine's download");
  g.loading[0]!({ loaded: 1_000_000, total: 7_300_000 });
  assert.deepEqual(g.ctl.store.getState().bot?.engineLoading, { loaded: 1_000_000, total: 7_300_000 });
  assert.equal(g.ctl.store.getState().bot?.engineError, false);
  g.loading[0]!(null); // the files are in
  assert.equal(g.ctl.store.getState().bot?.engineLoading ?? null, null);
  g.detach();
  assert.equal(g.loading.length, 0);
});
