// @repo/chess-import (phase-04 plan §2.1 item 2, §8.6–8.7, WP-B): the Chess.com and Lichess clients (serial through a
// per-provider gate, ETag-aware, anonymous, base URL injectable), the PGN / NDJSON parsers and the mappers onto P2's
// `games` / `game_players` columns. Shared by the web (lookups, the Lichess callback's account schema), the analysis
// worker (imports) and the seeds. Subpaths resolve to src (`@repo/chess-import/chesscom/client` →
// src/chesscom/client.ts); the web should deep-import what it needs so its bundles stay small.
export * from "./errors";
export * from "./http";
export * from "./gate";
export * from "./types";
export * from "./time-class";
export * from "./window";
export * from "./ratings";
export { replaySan, parsePgn, clkToMs, positionKey, boardDraw, type Replayed, type PgnMovetext } from "./replay";
export * from "./chesscom/types";
export * from "./chesscom/map";
export * from "./chesscom/client";
export * from "./lichess/types";
export * from "./lichess/ndjson";
export * from "./lichess/map";
export * from "./lichess/client";
