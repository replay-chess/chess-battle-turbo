// The UCI helpers and the engine session over a fake worker (phase-02 plan 5.3.2, 8.13): init handshake, the R2 →
// origin fallback, options + position + go per search, the 3 s stop cap, cancellation, a hung engine, and the
// command-injection guards.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createEngineClient,
  ENGINE_DOWNLOAD_MAX_MS,
  ENGINE_INIT_TIMEOUT_MS,
  isSafeGo,
  isSafeOption,
  LineCollector,
  lineCp,
  parseBestMove,
  parseEloFloor,
  parseInfoLine,
  positionCommand,
  type EngineAttempt,
  type EngineProgress,
  type EngineWorkerEvents,
} from "./uci";

test("parseInfoLine reads multipv, depth, cp/mate, bounds and the pv; ignores strings and currmove", () => {
  const l = parseInfoLine("info depth 12 seldepth 18 multipv 2 score cp -34 nodes 9000 nps 1 pv e7e5 g1f3 b8c6");
  assert.deepEqual(l, { multipv: 2, depth: 12, pv: ["e7e5", "g1f3", "b8c6"], bound: false, cp: -34 });
  const m = parseInfoLine("info depth 5 score mate -3 pv h7h8q");
  assert.equal(m?.mate, -3);
  assert.equal(m?.multipv, 1);
  assert.equal(parseInfoLine("info depth 9 score cp 12 lowerbound nodes 1 pv d2d4")?.bound, true);
  assert.equal(parseInfoLine("info string NNUE evaluation using nn-9067e33176e8.nnue"), null);
  assert.equal(parseInfoLine("info depth 3 currmove e2e4 currmovenumber 1"), null);
  assert.equal(parseInfoLine("info depth 0 score mate 0"), null);
  assert.equal(parseInfoLine("bestmove e2e4"), null);
});

test("parseBestMove: move, (none), other lines", () => {
  assert.equal(parseBestMove("bestmove e2e4 ponder e7e5"), "e2e4");
  assert.equal(parseBestMove("bestmove a7a8q"), "a7a8q");
  assert.equal(parseBestMove("bestmove (none)"), "");
  assert.equal(parseBestMove("info depth 1"), null);
});

test("LineCollector keeps the latest exact line per slot, ordered by multipv", () => {
  const c = new LineCollector();
  c.push(parseInfoLine("info depth 8 multipv 1 score cp 20 pv e2e4")!);
  c.push(parseInfoLine("info depth 8 multipv 2 score cp 10 pv d2d4")!);
  c.push(parseInfoLine("info depth 9 multipv 1 score cp 25 pv g1f3")!);
  c.push(parseInfoLine("info depth 9 multipv 1 score cp 99 upperbound pv a2a3")!); // bound at same depth: ignored
  assert.deepEqual(
    c.lines().map((l) => [l.multipv, l.uci, l.cp]),
    [
      [1, "g1f3", 25],
      [2, "d2d4", 10],
    ],
  );
  assert.equal(c.lines(1).length, 1);
});

test("commands and guards", () => {
  const fen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
  assert.equal(positionCommand(fen, []), `position fen ${fen}`);
  assert.equal(positionCommand(fen, ["e2e4", "e7e5"]), `position fen ${fen} moves e2e4 e7e5`);
  assert.ok(isSafeGo("go nodes 20000"));
  assert.ok(isSafeGo("go movetime 300"));
  assert.ok(!isSafeGo("go infinite"));
  assert.ok(!isSafeGo("go nodes 1\nquit"));
  assert.ok(isSafeOption("UCI_Elo", "1400"));
  assert.ok(isSafeOption("Skill Level", "20"));
  assert.ok(!isSafeOption("Hash\nquit", "1"));
  assert.ok(!isSafeOption("Hash", "1 quit"));
  assert.equal(lineCp({ cp: -40 }), -40);
  assert.equal(lineCp({ mate: 2 }), 99_998);
  assert.equal(lineCp({ mate: -1 }), -99_999);
  assert.equal(parseEloFloor("option name UCI_Elo type spin default 1320 min 1320 max 3190"), 1320);
  assert.equal(parseEloFloor("option name Hash type spin default 16 min 1 max 2048"), null);
});

// ── a scripted fake worker ──

type Script = (cmd: string, w: FakeWorker) => void;

class FakeWorker {
  sent: string[] = [];
  terminated = false;
  constructor(
    public url: string,
    public events: EngineWorkerEvents,
    private script: Script,
  ) {}
  post(cmd: string) {
    this.sent.push(cmd);
    queueMicrotask(() => {
      if (!this.terminated) this.script(cmd, this);
    });
  }
  terminate() {
    this.terminated = true;
  }
  emit(line: string) {
    if (!this.terminated) this.events.line(line);
  }
}

/** A healthy engine: uci → options + uciok (with the shim's init message); go → info + bestmove (or wait for stop). */
const healthy =
  (opts: { holdUntilStop?: boolean; best?: string } = {}): Script =>
  (cmd, w) => {
    if (cmd === "uci") {
      w.emit("id name Stockfish 18");
      w.emit("option name UCI_Elo type spin default 1320 min 1320 max 3190");
      w.events.meta({ rc: "engine-init", source: w.url.includes("r=") ? "r2" : "origin", cached: true, bytes: 7_300_000 });
      w.emit("uciok");
    } else if (cmd === "isready") w.emit("readyok");
    else if (cmd.startsWith("go")) {
      w.emit("info depth 10 multipv 1 score cp 31 pv e2e4 e7e5");
      w.emit("info depth 10 multipv 2 score cp 12 pv d2d4");
      if (!opts.holdUntilStop) w.emit(`bestmove ${opts.best ?? "e2e4"}`);
    } else if (cmd === "stop") w.emit(`bestmove ${opts.best ?? "e2e4"}`);
  };

function harness(scripts: Record<"r2" | "origin", Script>, attempts: EngineAttempt[]) {
  const workers: FakeWorker[] = [];
  const timers = new Map<number, () => void>();
  let nextId = 1;
  let t = 0;
  const inits: unknown[] = [];
  const client = createEngineClient({
    spawn: (url, events) => {
      const w = new FakeWorker(url, events, url.includes("r=") ? scripts.r2 : scripts.origin);
      workers.push(w);
      return w;
    },
    attempts: () => attempts,
    now: () => t,
    setTimer: (fn) => {
      const id = nextId++;
      timers.set(id, fn);
      return id;
    },
    clearTimer: (id) => timers.delete(id as number),
    onInit: (r) => inits.push(r),
  });
  const fireTimers = () => {
    const fns = [...timers.values()];
    timers.clear();
    for (const fn of fns) fn();
  };
  return { client, workers, inits, fireTimers, advance: (ms: number) => (t += ms) };
}

const R2: EngineAttempt = { url: "/workers/engine-shim.js?o=%2Fworkers%2Fsf18-abc%2F&r=https%3A%2F%2Fm%2F#x", source: "r2" };
const ORIGIN: EngineAttempt = { url: "/workers/engine-shim.js?o=%2Fworkers%2Fsf18-abc%2F#y", source: "origin" };
const FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

test("init: uci → uciok → Hash 16 → isready → readyok; floor, source and cache flag reported once", async () => {
  const h = harness({ r2: healthy(), origin: healthy() }, [R2, ORIGIN]);
  const [a, b] = await Promise.all([h.client.init(), h.client.init()]);
  assert.equal(a, b);
  assert.equal(h.workers.length, 1);
  assert.deepEqual(h.workers[0]!.sent, ["uci", "setoption name Hash value 16", "isready"]);
  assert.equal(a.eloFloor, 1320);
  assert.equal(a.source, "r2");
  assert.equal(a.cached, true);
  assert.equal(h.client.status(), "ready");
  assert.equal(h.inits.length, 1);
});

test("init: a failing R2 worker falls back to the origin copy; both failing reports ok:false", async () => {
  const broken: Script = (cmd, w) => {
    if (cmd === "uci") w.events.error(new Error("importScripts failed"));
  };
  const h = harness({ r2: broken, origin: healthy() }, [R2, ORIGIN]);
  const info = await h.client.init();
  assert.equal(info.source, "origin");
  assert.equal(h.workers.length, 2);
  assert.ok(h.workers[0]!.terminated);

  const h2 = harness({ r2: broken, origin: broken }, [R2, ORIGIN]);
  await assert.rejects(h2.client.init(), /importScripts failed/);
  assert.equal(h2.client.status(), "failed");
  assert.equal((h2.inits[0] as { ok: boolean }).ok, false);
});

test("init times out after 8 s without uciok", async () => {
  const silent: Script = () => {};
  const h = harness({ r2: silent, origin: silent }, [ORIGIN]);
  const p = h.client.init();
  await new Promise((r) => setImmediate(r));
  h.fireTimers();
  await assert.rejects(p, /timed out/);
});

test("search: options, position, go; lines best-first; ucinewgame once after newGame()", async () => {
  const h = harness({ r2: healthy(), origin: healthy({ best: "d2d4" }) }, [ORIGIN]);
  h.client.newGame();
  const r = await h.client.search({
    startFen: FEN,
    moves: ["e2e4"],
    options: [
      ["UCI_LimitStrength", "true"],
      ["UCI_Elo", "1400"],
    ],
    go: "go nodes 20000",
    multiPv: 2,
  });
  assert.equal(r.best, "d2d4");
  assert.equal(r.cancelled, false);
  assert.deepEqual(
    r.lines.map((l) => l.uci),
    ["e2e4", "d2d4"],
  );
  const sent = h.workers[0]!.sent.slice(3);
  assert.deepEqual(sent, [
    "ucinewgame",
    "setoption name UCI_LimitStrength value true",
    "setoption name UCI_Elo value 1400",
    `position fen ${FEN} moves e2e4`,
    "go nodes 20000",
  ]);
  await h.client.search({ startFen: FEN, moves: [], options: [], go: "go movetime 300" });
  assert.ok(!h.workers[0]!.sent.slice(8).includes("ucinewgame"));
});

test("search: the stop cap fires `stop`; a cancelled search resolves cancelled and the queue goes on", async () => {
  const h = harness({ r2: healthy(), origin: healthy({ holdUntilStop: true }) }, [ORIGIN]);
  await h.client.init();
  const p = h.client.search({ startFen: FEN, moves: [], options: [], go: "go nodes 99999", stopAfterMs: 3000 });
  await new Promise((r) => setImmediate(r));
  h.fireTimers(); // the 3 s cap
  const r = await p;
  assert.equal(r.cancelled, false);
  assert.equal(r.best, "e2e4");
  assert.ok(h.workers[0]!.sent.includes("stop"));

  const ac = new AbortController();
  const p1 = h.client.search({ startFen: FEN, moves: [], options: [], go: "go nodes 99999", signal: ac.signal });
  const p2 = h.client.search({ startFen: FEN, moves: ["e2e4"], options: [], go: "go nodes 10" });
  await new Promise((r) => setImmediate(r));
  ac.abort();
  assert.equal((await p1).cancelled, true);
  await new Promise((r) => setImmediate(r));
  h.fireTimers();
  assert.equal((await p2).cancelled, false);

  const pre = new AbortController();
  pre.abort();
  assert.equal((await h.client.search({ startFen: FEN, moves: [], options: [], go: "go nodes 1", signal: pre.signal })).cancelled, true);
});

test("search: a hung engine fails the job and the queue; the next search starts a fresh worker", async () => {
  const hung: Script = (cmd, w) => {
    if (cmd === "uci") w.emit("uciok");
    else if (cmd === "isready") w.emit("readyok");
  };
  const h = harness({ r2: hung, origin: hung }, [ORIGIN]);
  await h.client.init();
  const p = h.client.search({ startFen: FEN, moves: [], options: [], go: "go nodes 10" });
  const q = h.client.search({ startFen: FEN, moves: [], options: [], go: "go nodes 10" });
  await new Promise((r) => setImmediate(r));
  h.fireTimers(); // stop cap → stop
  h.fireTimers(); // hang timer
  await assert.rejects(p, /did not answer stop/);
  await assert.rejects(q, /did not answer stop/);
  assert.equal(h.client.status(), "failed");
  assert.ok(h.workers[0]!.terminated);
});

test("search refuses unsafe commands without touching the worker", async () => {
  const h = harness({ r2: healthy(), origin: healthy() }, [ORIGIN]);
  await assert.rejects(h.client.search({ startFen: FEN, moves: [], options: [], go: "go infinite" }), /refused go/);
  await assert.rejects(h.client.search({ startFen: FEN, moves: [], options: [["Hash", "1\nquit"]], go: "go nodes 1" }), /refused option/);
  await assert.rejects(h.client.search({ startFen: `${FEN}\nquit`, moves: [], options: [], go: "go nodes 1" }), /refused position/);
  await assert.rejects(h.client.search({ startFen: FEN, moves: ["e2e4 quit"], options: [], go: "go nodes 1" }), /refused position/);
  assert.equal(h.workers.length, 0);
});

// ── download time is not engine failure (CI run 43068898609: "The engine couldn't start" on webkit-iphone) ──

/** A client over one fake worker and a fake clock whose timers fire by time. */
function clocked(script: Script) {
  let t = 0;
  let nextId = 1;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const workers: FakeWorker[] = [];
  const progress: (EngineProgress | null)[] = [];
  const client = createEngineClient({
    spawn: (url, events) => {
      const w = new FakeWorker(url, events, script);
      workers.push(w);
      return w;
    },
    attempts: () => [ORIGIN],
    now: () => t,
    setTimer: (fn, ms) => {
      const id = nextId++;
      timers.set(id, { at: t + ms, fn });
      return id;
    },
    clearTimer: (id) => timers.delete(id as number),
    onProgress: (p) => progress.push(p),
  });
  /** Moves the clock, firing every timer that comes due on the way. */
  const advance = (ms: number) => {
    const end = t + ms;
    for (;;) {
      const due = [...timers.entries()].filter(([, x]) => x.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      timers.delete(due[0]);
      t = due[1].at;
      due[1].fn();
    }
    t = end;
  };
  const tick = () => new Promise((r) => setImmediate(r));
  return { client, workers, progress, advance, tick };
}

const shim = (w: FakeWorker, stage: "glue" | "wasm", state: string, loaded?: number, total?: number) =>
  w.events.meta({ rc: "engine-progress", stage, state, ...(loaded === undefined ? {} : { loaded, total }) });

/** The engine part once the files are in: options, uciok, readyok. */
const engineOnly: Script = (cmd, w) => {
  if (cmd === "uci") return; // the test drives the download, then calls `answer`
  if (cmd === "isready") w.emit("readyok");
};
const answerUci = (w: FakeWorker) => {
  w.emit("option name UCI_Elo type spin default 1320 min 1320 max 3190");
  w.emit("uciok");
};

test("a slow download is loading, not a failure: 40 s of glue + WASM, then the engine starts", async () => {
  const h = clocked(engineOnly);
  const p = h.client.init();
  await h.tick();
  const w = h.workers[0]!;
  shim(w, "glue", "start");
  h.advance(12_000); // a slow glue: importScripts blocks the worker, no heartbeat possible
  shim(w, "glue", "done");
  shim(w, "wasm", "start");
  for (let s = 0; s < 14; s++) {
    h.advance(2_000);
    shim(w, "wasm", "progress", (s + 1) * 500_000, 7_300_000); // the shim's heartbeat / byte counts
  }
  assert.equal(h.client.status(), "loading", "28 s into the WASM: still loading");
  assert.deepEqual(h.client.progress(), { loaded: 7_000_000, total: 7_300_000 });
  shim(w, "wasm", "done", 7_300_000, 7_300_000);
  assert.equal(h.client.progress(), null);
  h.advance(3_000); // compile
  answerUci(w);
  const info = await p;
  assert.equal(info.eloFloor, 1320);
  assert.equal(h.client.status(), "ready");
  assert.deepEqual(h.progress.at(0), { loaded: 0, total: 0 });
  assert.equal(h.progress.at(-1), null);
});

test("after the download the 8 s budget is the engine's: compile + handshake that never answer fail", async () => {
  const h = clocked(engineOnly);
  const p = h.client.init();
  await h.tick();
  const w = h.workers[0]!;
  shim(w, "glue", "start");
  shim(w, "glue", "done");
  shim(w, "wasm", "start");
  for (let s = 0; s < 15; s++) {
    h.advance(2_000);
    shim(w, "wasm", "waiting"); // the heartbeat: 30 s of waiting on the network are fine
  }
  shim(w, "wasm", "done", 7_300_000, 7_300_000);
  h.advance(ENGINE_INIT_TIMEOUT_MS);
  await assert.rejects(p, /engine init timed out after 8000 ms/);
  assert.equal(h.client.status(), "failed");
});

test("a WASM request that stops reporting fails after 8 s; a download still going after 180 s fails", async () => {
  const stalled = clocked(engineOnly);
  const p = stalled.client.init();
  await stalled.tick();
  shim(stalled.workers[0]!, "wasm", "start");
  stalled.advance(ENGINE_INIT_TIMEOUT_MS);
  await assert.rejects(p, /engine download stalled/);

  const crawl = clocked(engineOnly);
  const q = crawl.client.init();
  await crawl.tick();
  shim(crawl.workers[0]!, "wasm", "start");
  let rejected = false;
  q.catch(() => (rejected = true));
  for (let s = 0; s < ENGINE_DOWNLOAD_MAX_MS / 2_000 - 1; s++) {
    crawl.advance(2_000);
    shim(crawl.workers[0]!, "wasm", "progress", s * 1_000, 7_300_000);
  }
  await crawl.tick();
  assert.equal(rejected, false, "178 s of a progressing download is still loading");
  crawl.advance(2_000);
  await assert.rejects(q, /engine download did not finish in 180000 ms/);
});

test("a worker that never reports anything still fails after 8 s (no shim, a blocked worker)", async () => {
  const h = clocked(() => {});
  const p = h.client.init();
  await h.tick();
  h.advance(ENGINE_INIT_TIMEOUT_MS);
  await assert.rejects(p, /engine init timed out/);
});
