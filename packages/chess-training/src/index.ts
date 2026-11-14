// @repo/chess-training: the pure training domain shared by the web routes and the worker (phase-05 plan §3.3, §8):
// FSRS wrapper, release time, day keys, caps, daily plan, session composition, mastery, streak, theme taxonomy,
// labels, the deterministic explainer and the itemKey codec. Every time-dependent function takes `now`.
//
// This barrel is for server code only (it pulls in ts-fsrs through `fsrs` and `session`). The browser imports the
// subpaths `@repo/chess-training/grade`, `/labels`, `/items` (and `/rating` for the puzzle-rating preview), which never
// reach ts-fsrs (plan §9.5; `browser-subpaths.test.ts` proves it); `@repo/chess-training/<module>` resolves to
// `src/<module>.ts`.
export * from "./caps";
export * from "./constants";
export * from "./day";
export * from "./explain";
export * from "./fsrs";
export * from "./grade";
export * from "./items";
export * from "./labels";
export * from "./mastery";
export * from "./plan";
export * from "./rating";
export * from "./release";
export * from "./session";
export * from "./streak";
export * from "./themes";
export * from "./tz";
