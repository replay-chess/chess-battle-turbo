// @repo/game-core: rules, clocks, reducers, local runner, PGN and the bot ladder (phase-02 plan 8).
// Pure TypeScript with one runtime dependency (chess.js). No timers, no I/O, deterministic for a given `now`.
// Deep imports work too (`@repo/game-core/machine/reduce`, `@repo/game-core/client/viewState`, …).

export * from "./constants";
export * from "./machine/types";
export * from "./machine/state";
export * from "./machine/journal";
export * from "./machine/create";
export * from "./machine/timers";
export { reduce } from "./machine/reduce";
export * from "./client/reducer";
export * from "./client/viewState";
export * from "./clock/clock";
export * from "./clock/format";
export * from "./rules/chess";
export * from "./rules/end";
export * from "./rules/insufficient";
export * from "./rules/explainIllegal";
export * from "./rules/material";
export * from "./rules/describe";
export * from "./rules/timeClass";
export * from "./rules/study";
export * from "./pgn";
export * from "./adjudicate";
export {
  snapshotOf,
  endMethodFromDb,
  endMethodToDb,
  outcomeToDb,
  winnerFromOutcome,
  phaseToDb,
  isWatchable,
  type GameRecord,
  type GameSnapshot,
  type PlayerRecord,
  type DbGameStatus,
  type DbLivePhase,
  type DbEndMethod,
  type DbOutcome,
  type DbGameMode,
} from "./snapshot";
export * from "./bot/strength";
export * from "./bot/hints";
export * from "./local/drawPolicy";
export * from "./local/journal";
export * as local from "./local/runner";
