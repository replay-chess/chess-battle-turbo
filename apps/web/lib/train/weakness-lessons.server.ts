// The legend-lesson slot of the Weakness Profile (phase-06 plan §7.6, critique C-07): the hand-off to P8.
//
// P6 builds every place a lesson renders (a row's LessonLink, the drill config's lesson row, the week plan's third
// row) and this one lookup, which answers null until P8 ships lessons. `getWeakness()` calls it once per payload row
// (the week plan's lesson is the top row's). P8 replaces the body with a lookup over its cached lesson content
// (`unstable_cache`, tag `lessons`) through `Lesson.themes`, and must keep `weakness-lessons.contract.test.ts` green:
// the same signature, and a payload with lessons that still parses and stays under 8 KB.
import type { PatternKey, WeaknessLesson } from "@repo/contracts/http/weakness";

export type ResolvedLesson = WeaknessLesson;

/** The legend lesson that teaches `pattern`, or null (always null in P6: no lessons exist yet). */
export async function resolveLessonForPattern(pattern: PatternKey): Promise<ResolvedLesson | null> {
  void pattern;
  return null;
}

/** One lookup per distinct pattern, in parallel: `{pattern: lesson | null}` (the payload's `lessons` input). */
export async function resolveLessons(patterns: readonly PatternKey[]): Promise<Record<string, ResolvedLesson | null>> {
  const unique = [...new Set(patterns)];
  const found = await Promise.all(unique.map((p) => resolveLessonForPattern(p)));
  return Object.fromEntries(unique.map((p, i) => [p, found[i] ?? null]));
}
