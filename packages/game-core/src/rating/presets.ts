// Glicko-2 configs, one per rated activity (phase-05 plan §8.7). `glicko2.ts` holds no constants; a phase adds its
// preset here and changes nothing else (P9 adds `GAME` with its own τ 0.75 and RD floor 45).
import type { GlickoConfig } from "./glicko2";

/** Puzzle rating (P5): τ 0.5, RD kept within 50–350, volatility capped at 0.1. */
export const PUZZLE: Readonly<GlickoConfig> = Object.freeze({ tau: 0.5, rdFloor: 50, rdCeil: 350, sigmaMax: 0.1 });
