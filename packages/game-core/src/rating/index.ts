// @repo/game-core/rating: Glicko-2 parameterised by a config (phase-05 plan §8.7, feasibility #11). `glicko2.ts` holds
// the pure update `glicko2(state, results, cfg)` with no constants inside; `presets.ts` exports the configs (`PUZZLE`
// from P5; P9 adds `GAME` and changes nothing else). The browser imports `@repo/game-core/rating` for the deterministic
// rating preview (D-13), so this module stays dependency-free.
export { glicko2, GLICKO_SCALE, type GlickoConfig, type GlickoResult, type GlickoState } from "./glicko2";
export * as presets from "./presets";
export { PUZZLE } from "./presets";
