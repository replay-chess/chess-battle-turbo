// The engine interface the pipeline searches with (phase-03 plan §8.12 pass 1 / pass 2, §8.13 profile `sf18-v1`).
// Scores are as UCI prints them: relative to the side to move. The pipeline converts to White POV with
// `fromEngineScore` (CA/src/codec.ts) before storing or caching.

export type EngineScore = { cp: number } | { mate: number };

export interface SearchRequest {
  /** The position searched from (the FEN at `lastIrreversible[i]`, §8.12 step 5) … */
  fen: string;
  /** … and the UCI moves played since, so the engine sees repetitions. */
  moves?: readonly string[];
  nodes: number;
  multipv: number;
}

export interface EngineLine {
  multipv: number;
  score: EngineScore;
  depth: number;
  seldepth: number | null;
  nodes: number;
  pv: string[];
}

export interface SearchResult {
  /** null for `bestmove (none)` (no legal move). */
  bestmove: string | null;
  /** The final exact line per MultiPV index, sorted by index (bound lines are ignored). */
  lines: EngineLine[];
  /** Depth of line 1 (0 when there is no line). */
  depth: number;
  nodes: number;
  nps: number | null;
  ms: number;
}

export type EngineKind = "stockfish" | "fake";

export interface Engine {
  readonly kind: EngineKind;
  /** `game_analyses.engine` build part, e.g. "sf18-armv8dp-c288c895" or "fake" (analysisEngine() appends the profile). */
  readonly buildId: string;
  /** The UCI `id name` ("Stockfish 18"). */
  readonly name: string;
  start(): Promise<void>;
  /** `ucinewgame` + `isready`: the pipeline's Searcher calls it before every search (history-independent facts). */
  newGame(): Promise<void>;
  search(req: SearchRequest): Promise<SearchResult>;
  /** Kills the process at once (fault injection, a hung engine). */
  kill(): void;
  quit(): Promise<void>;
}

export type EngineErrorCode = "timeout" | "crashed" | "protocol" | "start_failed";

export class EngineError extends Error {
  constructor(
    readonly code: EngineErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "EngineError";
  }
}

/** No `bestmove` within the timeout after `go` (§8.12 "Failure": 10 s). */
export class EngineTimeout extends EngineError {
  constructor(message = "no bestmove within the timeout") {
    super("timeout", message);
    this.name = "EngineTimeout";
  }
}

/** The process exited or its pipes broke. */
export class EngineCrashed extends EngineError {
  constructor(message = "the engine process exited") {
    super("crashed", message);
    this.name = "EngineCrashed";
  }
}

/** The pool's verdict after the restart and the one retry also failed: the job fails `engine_failed`. */
export class EngineFailed extends Error {
  readonly code = "engine_failed";
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = "EngineFailed";
  }
}
