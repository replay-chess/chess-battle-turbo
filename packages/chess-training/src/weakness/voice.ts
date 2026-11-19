// How Home and the Train hub may name a pattern taken from the Weakness Profile (FIX-4, docs/decisions.md D-P6-FIX4-1).
// One rule for the Home bank line, the hub's plan step and the hub row: "top weakness" / "your weakness" only when the
// profile really compares the member with the rating band (`vs_band`) and the pattern is that list's top row. A
// most-frequent list ("Nothing stands out against players at your level") or an own-only list (no band) names its top
// row as the member's most common mistake, so Home and the hub never contradict the profile page. Pure, browser-safe.

/** `WeaknessMetricsV1["listMode"]` (kept structural so the browser never imports the engine's types module). */
export type WeaknessListMode = "vs_band" | "own_only" | "most_frequent";

/**
 * The voice of a profile pattern on Home and the hub:
 * - `top_weakness`: the top row of a band comparison ("Your top weakness");
 * - `weakness_row`: a lower row of a band comparison ("From your Weakness Profile");
 * - `most_common`: the top row of a most-frequent or own-only list ("Your most common mistake");
 * - `common_row`: a lower row of such a list ("Common in your games").
 */
export type WeaknessVoice = "top_weakness" | "weakness_row" | "most_common" | "common_row";

/** The one rule: only a band comparison ranks weaknesses. */
export function weaknessVoice(listMode: WeaknessListMode | null | undefined, isTopRow: boolean): WeaknessVoice {
  if (listMode === "vs_band") return isTopRow ? "top_weakness" : "weakness_row";
  return isTopRow ? "most_common" : "common_row";
}

/** The hub plan step's reason ("{reason} · rating 1512 · ~4 min"). */
export const WEAKNESS_VOICE_REASON: Readonly<Record<WeaknessVoice, string>> = {
  top_weakness: "Your top weakness",
  weakness_row: "From your Weakness Profile",
  most_common: "Your most common mistake",
  common_row: "Common in your games",
};

/**
 * The Home bank card's line about one pattern: "Missed forks is your top weakness (12 in bank)." for the top row of a
 * band comparison, otherwise "Missed forks is your most common mistake (12 in bank)." (the plan's noun, phase-06 plan
 * §7.1.5; the P5 bank fallback reads the same).
 */
export function bankPatternLine(label: string, n: number, topWeakness: boolean): string {
  return topWeakness ? `${label} is your top weakness (${n} in bank).` : `${label} is your most common mistake (${n} in bank).`;
}
