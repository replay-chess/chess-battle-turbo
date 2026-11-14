// @repo/chess-analysis: the pure grading library of phase 3 (phase-03 plan §8, work package A). No I/O, no clock,
// no randomness: the worker, the web routes, the seeds and the tests all grade with the same functions.
//
// Consumers import modules by subpath (`@repo/chess-analysis/<module>`, e.g. `/codec`, `/classify`,
// `/legend/compare`; fixtures as `@repo/chess-analysis/fixtures/<name>`), so a client bundle pulls in only what it
// uses. This barrel re-exports the public API for server code and tests; WP-A adds one line per module. The text
// helpers in `text/facts` (chess.js fact finders shared by the templates) stay internal: import the subpath.
export * from "./codec";
export * from "./version";
export * from "./winpct";
export * from "./accuracy";
export * from "./board";
export * from "./replay";
export * from "./divider";
export * from "./see";
export * from "./classify";
export * from "./moments";
export * from "./intent";
export * from "./book";
export * from "./pgn";
export * from "./review";
export * from "./analysis";
export * from "./regrade";
export * from "./legend/slice";
export * from "./legend/compare";
export * from "./legend/facts";
export * from "./legend/summary";
export * from "./text/reasons";
export * from "./text/phase";
export * from "./text/summary";
export * from "./text/ask";
export * from "./text/why";
export * from "./text/headline";
export * from "./text/clean";
export * from "./text/coachline";
// P5 (phase-05 plan §8.1, §8.11): bank candidates, puzzle uniqueness and lines, the theme tagger, the position hash.
export * from "./epd";
export * from "./bank/candidates";
export * from "./puzzle/validAttack";
export * from "./puzzle/line";
export * from "./themes/index";
