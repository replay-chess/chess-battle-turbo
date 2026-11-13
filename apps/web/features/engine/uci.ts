// UCI text protocol helpers for the bot engine (phase-02 plan 5.3.2, 8.13–8.15). Pure: the provider
// (EngineProvider.tsx) owns the worker; these build the commands and read the engine's lines.

/** One principal variation as the engine reported it. Scores are from the side to move's point of view. */
export interface UciLine {
  multipv: number;
  depth: number;
  /** First move of the PV (UCI). */
  uci: string;
  cp?: number;
  mate?: number;
}

export interface UciInfo {
  multipv: number;
  depth: number;
  pv: string[];
  cp?: number;
  mate?: number;
  /** `lowerbound` / `upperbound` lines are aspiration-window bounds, not final scores. */
  bound: boolean;
}

const UCI_MOVE = /^[a-h][1-8][a-h][1-8][qrbn]?$/;

/** Parses an `info … score … pv …` line; null for lines without a score and a PV (`info string`, currmove…). */
export function parseInfoLine(line: string): UciInfo | null {
  if (!line.startsWith("info ")) return null;
  const t = line.split(/\s+/);
  let multipv = 1;
  let depth = 0;
  let cp: number | undefined;
  let mate: number | undefined;
  let bound = false;
  let pv: string[] | null = null;
  for (let i = 1; i < t.length; i++) {
    const k = t[i];
    if (k === "string") return null;
    if (k === "multipv") multipv = Number(t[++i]);
    else if (k === "depth") depth = Number(t[++i]);
    else if (k === "score") {
      const kind = t[++i];
      const v = Number(t[++i]);
      if (kind === "cp") cp = v;
      else if (kind === "mate") mate = v;
      if (t[i + 1] === "lowerbound" || t[i + 1] === "upperbound") {
        bound = true;
        i++;
      }
    } else if (k === "pv") {
      pv = t.slice(i + 1).filter((m) => UCI_MOVE.test(m));
      break;
    }
  }
  if (!pv || pv.length === 0 || (cp === undefined && mate === undefined)) return null;
  if (!Number.isFinite(multipv) || multipv < 1 || !Number.isFinite(depth)) return null;
  const out: UciInfo = { multipv, depth, pv, bound };
  if (cp !== undefined && Number.isFinite(cp)) out.cp = cp;
  if (mate !== undefined && Number.isFinite(mate)) out.mate = mate;
  return out;
}

/** `bestmove e2e4 ponder e7e5` → "e2e4"; `bestmove (none)` → "" (no legal move); other lines → null. */
export function parseBestMove(line: string): string | null {
  if (!line.startsWith("bestmove")) return null;
  const move = line.split(/\s+/)[1] ?? "";
  return UCI_MOVE.test(move) ? move : "";
}

/** Keeps the latest (deepest, exact) line per multipv slot while a search runs. */
export class LineCollector {
  private slots = new Map<number, UciLine>();

  push(info: UciInfo): void {
    const prev = this.slots.get(info.multipv);
    // A bound line never replaces an exact one of the same depth.
    if (prev && info.bound && prev.depth >= info.depth) return;
    const line: UciLine = { multipv: info.multipv, depth: info.depth, uci: info.pv[0]! };
    if (info.cp !== undefined) line.cp = info.cp;
    if (info.mate !== undefined) line.mate = info.mate;
    this.slots.set(info.multipv, line);
  }

  /** Lines ordered by multipv (best first), at most `max`. */
  lines(max = Infinity): UciLine[] {
    return [...this.slots.values()].sort((a, b) => a.multipv - b.multipv).slice(0, max);
  }

  clear(): void {
    this.slots.clear();
  }
}

/** `setoption name <k> value <v>`. */
export function setOption(name: string, value: string | number | boolean): string {
  return `setoption name ${name} value ${String(value)}`;
}

/** `position fen <startFen> [moves …]`. */
export function positionCommand(startFen: string, moves: readonly string[]): string {
  const fen = startFen.trim();
  return moves.length ? `position fen ${fen} moves ${moves.join(" ")}` : `position fen ${fen}`;
}

/** A `go` command we accept from callers (nodes / movetime / depth); anything else is refused. */
export function isSafeGo(go: string): boolean {
  return /^go( (nodes|movetime|depth) \d{1,9})+$/.test(go);
}

/** Option names and values never contain line breaks (they would inject engine commands). */
export function isSafeOption(name: string, value: string): boolean {
  return /^[A-Za-z][A-Za-z0-9_ ]{0,40}$/.test(name) && /^[A-Za-z0-9_.-]{0,40}$/.test(value);
}

export { lineCp } from "./score";

/** `option name UCI_Elo type spin default 1320 min 1320 max 3190` → 1320 (the Stockfish 16+ floor, plan 8.13). */
export function parseEloFloor(uciOutput: string): number | null {
  const m = /option name UCI_Elo type spin(?: default -?\d+)? min (-?\d+)/.exec(uciOutput);
  return m ? Number(m[1]) : null;
}

// ── The engine session over one worker ──────────────────────────────────────────────────────────────────────────
//
// One worker at a time, one search at a time (a FIFO queue). init: `uci` → `uciok` (8 s) → `setoption Hash 16` →
// `isready` → `readyok`; each attempt (R2 first when configured, then the same-origin copy) gets its own worker. A
// search sends its options, the position and the `go`, stops itself after `stopAfterMs` (3 s cap for slow devices,
// plan 8.13) and resolves on `bestmove`. A cancelled search is stopped and resolves with `cancelled: true`; the
// next one waits for its `bestmove`, so lines never mix. A worker error or a hung search fails every queued job and
// drops the worker; the next call starts a fresh one.

export type EngineStatus = "idle" | "loading" | "ready" | "failed";

export interface EngineAttempt {
  url: string;
  source: "r2" | "origin";
}

export interface EngineInitInfo {
  eloFloor: number | null;
  source: "r2" | "origin";
  cached: boolean;
  bytes: number;
  ms: number;
}

export interface EngineSearch {
  startFen: string;
  moves: readonly string[];
  options: readonly (readonly [string, string])[];
  go: string;
  multiPv?: number;
  /** `stop` after this long (default 3 s). */
  stopAfterMs?: number;
  signal?: AbortSignal;
}

export interface EngineSearchResult {
  best: string;
  lines: UciLine[];
  cancelled: boolean;
  ms: number;
}

/** The engine files still on their way: bytes of the WASM so far and its size (0 = unknown, or only the glue yet). */
export interface EngineProgress {
  loaded: number;
  total: number;
}

export interface EngineWorkerHandle {
  post(command: string): void;
  terminate(): void;
}

export interface EngineWorkerEvents {
  line(line: string): void;
  meta(meta: Record<string, unknown>): void;
  error(err: unknown): void;
}

export interface EngineClientDeps {
  spawn(url: string, events: EngineWorkerEvents): EngineWorkerHandle;
  attempts(): EngineAttempt[];
  now(): number;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(id: unknown): void;
  /** While the engine files download (null once they are in, or the attempt ended). */
  onProgress?(progress: EngineProgress | null): void;
  /** Called once per init chain (telemetry). */
  onInit?(result: { ok: true; info: EngineInitInfo } | { ok: false; ms: number; error: Error; source: "r2" | "origin" }): void;
}

export interface EngineClient {
  status(): EngineStatus;
  info(): EngineInitInfo | null;
  /** The download in progress, if any (`onProgress` reports each change). */
  progress(): EngineProgress | null;
  init(): Promise<EngineInitInfo>;
  search(job: EngineSearch): Promise<EngineSearchResult>;
  /** `ucinewgame` before the next search. */
  newGame(): void;
  /** Drops the worker and the failure, so the next init starts over ("Try again"). */
  reset(): void;
  dispose(): void;
}

/**
 * How long the engine may go without a sign of life before init fails: from the worker's creation to the shim's first
 * message, and from the end of the downloads to `readyok` (WASM compile + UCI handshake). Download time does not
 * count: while the shim reports a download in flight (`engine-progress`), only ENGINE_DOWNLOAD_MAX_MS applies, so a
 * slow network shows "loading", never "the engine couldn't start" (CI run 43068898609 on webkit-iphone, and a cold
 * 7.3 MB WASM on a slow phone).
 */
export const ENGINE_INIT_TIMEOUT_MS = 8_000;
/** A download that is still going (the shim keeps reporting) fails only after this long: a stalled network. */
export const ENGINE_DOWNLOAD_MAX_MS = 180_000;
export const ENGINE_STOP_AFTER_MS = 3_000;
/** A search that has not answered this long after its `stop` is treated as a hung engine. */
export const ENGINE_HANG_MS = 5_000;
export const ENGINE_HASH_MB = 16;

interface QueuedJob {
  job: EngineSearch;
  resolve(r: EngineSearchResult): void;
  reject(e: Error): void;
}

export function createEngineClient(deps: EngineClientDeps): EngineClient {
  let status: EngineStatus = "idle";
  let worker: EngineWorkerHandle | null = null;
  let info: EngineInitInfo | null = null;
  let initPromise: Promise<EngineInitInfo> | null = null;
  let progress: EngineProgress | null = null;
  const setProgress = (p: EngineProgress | null) => {
    if (p === progress || (p && progress && p.loaded === progress.loaded && p.total === progress.total)) return;
    progress = p;
    deps.onProgress?.(p);
  };
  let lineSink: ((line: string) => void) | null = null;
  let metaSink: ((meta: Record<string, unknown>) => void) | null = null;
  let errorSink: ((err: unknown) => void) | null = null;
  const queue: QueuedJob[] = [];
  let running = false;
  let pendingNewGame = false;
  let generation = 0;

  const asError = (e: unknown) => (e instanceof Error ? e : new Error(String(e)));

  function drop() {
    generation++;
    try {
      worker?.terminate();
    } catch {
      /* already gone */
    }
    worker = null;
    lineSink = metaSink = errorSink = null;
  }

  function attempt(a: EngineAttempt, started: number): Promise<EngineInitInfo> {
    return new Promise<EngineInitInfo>((resolve, reject) => {
      const gen = ++generation;
      const out: string[] = [];
      let meta: Record<string, unknown> = {};
      let stage: "uci" | "ready" = "uci";
      let settled = false;
      let timer: unknown = null;
      /** When the first download of this attempt started (the ENGINE_DOWNLOAD_MAX_MS clock). */
      let downloadSince: number | null = null;
      const arm = (ms: number, message: string) => {
        if (timer !== null) deps.clearTimer(timer);
        timer = deps.setTimer(() => finish(new Error(message)), Math.max(0, ms));
      };
      const armIdle = () => arm(ENGINE_INIT_TIMEOUT_MS, `engine init timed out after ${ENGINE_INIT_TIMEOUT_MS} ms`);
      /** The shim's `engine-progress {stage, state, loaded?, total?}`: a download is in flight, or it ended. */
      const onProgress = (m: Record<string, unknown>) => {
        const state = m.state;
        if (state === "start" || state === "waiting" || state === "progress") {
          downloadSince ??= deps.now();
          const left = ENGINE_DOWNLOAD_MAX_MS - (deps.now() - downloadSince);
          // The glue loads with a blocking importScripts (no heartbeat until it is in); the WASM request reports every
          // 2 s, so a worker that stops reporting mid-download is still caught after ENGINE_INIT_TIMEOUT_MS.
          const quiet = m.stage === "glue" ? left : Math.min(ENGINE_INIT_TIMEOUT_MS, left);
          arm(quiet, quiet < left ? `engine download stalled for ${ENGINE_INIT_TIMEOUT_MS} ms` : `engine download did not finish in ${ENGINE_DOWNLOAD_MAX_MS} ms`);
          const loaded = typeof m.loaded === "number" ? m.loaded : (progress?.loaded ?? 0);
          const total = typeof m.total === "number" ? m.total : (progress?.total ?? 0);
          setProgress({ loaded, total });
        } else {
          // done / failed: whatever follows (compile, handshake, the glue's error) is the engine's own work again.
          setProgress(null);
          armIdle();
        }
      };
      const finish = (err: Error | null) => {
        if (settled) return;
        settled = true;
        if (timer !== null) deps.clearTimer(timer);
        setProgress(null);
        if (err) {
          if (gen === generation) drop();
          reject(err);
          return;
        }
        const source = meta.source === "r2" || meta.source === "origin" ? meta.source : a.source;
        resolve({
          eloFloor: parseEloFloor(out.join("\n")),
          source,
          cached: meta.cached === true,
          bytes: typeof meta.bytes === "number" ? meta.bytes : 0,
          ms: Math.max(0, Math.round(deps.now() - started)),
        });
      };
      armIdle();
      lineSink = (line) => {
        if (stage === "uci") {
          out.push(line);
          if (line.trim() === "uciok") {
            stage = "ready";
            worker?.post(setOption("Hash", ENGINE_HASH_MB));
            worker?.post("isready");
          }
        } else if (line.trim() === "readyok") finish(null);
      };
      metaSink = (m) => {
        if (m.rc === "engine-progress") onProgress(m);
        else meta = { ...meta, ...m };
      };
      errorSink = (e) => finish(asError(e ?? "engine worker error"));
      try {
        worker = deps.spawn(a.url, {
          line: (l) => gen === generation && lineSink?.(l),
          meta: (m) => gen === generation && metaSink?.(m),
          error: (e) => gen === generation && errorSink?.(e),
        });
        worker.post("uci");
      } catch (e) {
        finish(asError(e));
      }
    });
  }

  async function runInit(): Promise<EngineInitInfo> {
    const started = deps.now();
    const attempts = deps.attempts();
    let lastError: Error = new Error("no engine source");
    for (const a of attempts) {
      try {
        const got = await attempt(a, started);
        info = got;
        status = "ready";
        deps.onInit?.({ ok: true, info: got });
        return got;
      } catch (e) {
        lastError = asError(e);
      }
    }
    status = "failed";
    deps.onInit?.({ ok: false, ms: Math.round(deps.now() - started), error: lastError, source: attempts.at(-1)?.source ?? "origin" });
    throw lastError;
  }

  function init(): Promise<EngineInitInfo> {
    if (status === "ready" && info && worker) return Promise.resolve(info);
    if (initPromise) return initPromise;
    status = "loading";
    initPromise = runInit().finally(() => {
      initPromise = null;
    });
    return initPromise;
  }

  function failAll(err: Error) {
    status = "failed";
    drop();
    running = false;
    for (const q of queue.splice(0)) q.reject(err);
  }

  function runJob(q: QueuedJob): Promise<void> {
    return new Promise<void>((done) => {
      const { job } = q;
      const started = deps.now();
      const collector = new LineCollector();
      let cancelled = false;
      let stopped = false;
      let finished = false;
      let hangTimer: unknown = null;
      const stop = () => {
        if (stopped || finished) return;
        stopped = true;
        worker?.post("stop");
        hangTimer = deps.setTimer(() => {
          if (finished) return;
          finished = true;
          job.signal?.removeEventListener("abort", onAbort);
          failAll(new Error("engine did not answer stop"));
          q.reject(new Error("engine did not answer stop"));
          done();
        }, ENGINE_HANG_MS);
      };
      const onAbort = () => {
        cancelled = true;
        stop();
      };
      const stopTimer = deps.setTimer(stop, job.stopAfterMs ?? ENGINE_STOP_AFTER_MS);
      lineSink = (line) => {
        if (finished) return;
        const best = parseBestMove(line);
        if (best !== null) {
          finished = true;
          deps.clearTimer(stopTimer);
          if (hangTimer !== null) deps.clearTimer(hangTimer);
          job.signal?.removeEventListener("abort", onAbort);
          const lines = collector.lines(job.multiPv ?? Infinity);
          q.resolve({ best: best || lines[0]?.uci || "", lines, cancelled, ms: Math.round(deps.now() - started) });
          done();
          return;
        }
        const parsed = parseInfoLine(line);
        if (parsed) collector.push(parsed);
      };
      errorSink = (e) => {
        if (finished) return;
        finished = true;
        deps.clearTimer(stopTimer);
        if (hangTimer !== null) deps.clearTimer(hangTimer);
        const err = asError(e ?? "engine worker error");
        failAll(err);
        q.reject(err);
        done();
      };
      job.signal?.addEventListener("abort", onAbort, { once: true });
      if (pendingNewGame) {
        pendingNewGame = false;
        worker?.post("ucinewgame");
      }
      for (const [name, value] of job.options) worker?.post(setOption(name, value));
      worker?.post(positionCommand(job.startFen, job.moves));
      worker?.post(job.go);
    });
  }

  async function pump() {
    if (running) return;
    running = true;
    try {
      while (queue.length) {
        const q = queue[0]!;
        if (q.job.signal?.aborted) {
          queue.shift();
          q.resolve({ best: "", lines: [], cancelled: true, ms: 0 });
          continue;
        }
        try {
          await init();
        } catch (e) {
          failAll(asError(e));
          return;
        }
        queue.shift();
        await runJob(q);
      }
    } finally {
      running = false;
    }
  }

  function search(job: EngineSearch): Promise<EngineSearchResult> {
    if (!isSafeGo(job.go)) return Promise.reject(new Error(`refused go command: ${job.go}`));
    for (const [name, value] of job.options) {
      if (!isSafeOption(name, value)) return Promise.reject(new Error(`refused option: ${name}`));
    }
    if (/[\r\n]/.test(job.startFen) || job.moves.some((m) => !UCI_MOVE.test(m))) {
      return Promise.reject(new Error("refused position"));
    }
    return new Promise<EngineSearchResult>((resolve, reject) => {
      queue.push({ job, resolve, reject });
      void pump();
    });
  }

  return {
    status: () => status,
    info: () => info,
    progress: () => progress,
    init,
    search,
    newGame() {
      pendingNewGame = true;
    },
    reset() {
      failAll(new Error("engine reset"));
      info = null;
      status = "idle";
    },
    dispose() {
      failAll(new Error("engine disposed"));
      info = null;
      status = "idle";
    },
  };
}
