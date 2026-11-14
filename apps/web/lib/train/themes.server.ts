// R4 `GET /api/train/themes` (phase-05 plan §7.2, §4.6 S6, §8.11): the puzzle theme picker. One parallel batch: the
// profile (the rating; the seed in memory while the row does not exist) and theme mastery. `available` comes from the
// committed shard manifest near the member's rating (no fetch). The recommended theme is the plan's focus theme
// (§8.10: lowest mastery with ≥ 5 attempts → most banked → fork).
import type { ThemeOption, ThemesResult } from "@repo/contracts/http/train";
import { themePct } from "@repo/chess-training/mastery";
import { focusTheme } from "@repo/chess-training/plan";
import { PICKER_THEMES, themeGroup, themePluralLabel } from "@repo/chess-training/themes";
import type { Viewer } from "@/lib/auth/viewer";
import { planThemesOf, themeMasterySql, type ThemeMasteryRow } from "./bank.server";
import { num, trainDeps, type TrainDeps } from "./db.server";
import { readProfile } from "./profile.server";
import { availableNear } from "./puzzles.server";

/** The picker's options for a rating and the member's mastery rows (the focus theme first, as "recommended"). */
export function themeOptionsOf(rating: number, themes: readonly ThemeMasteryRow[]): ThemeOption[] {
  const byKey = new Map(themes.map((t) => [t.theme, t]));
  const focus = focusTheme(planThemesOf(themes)).key;
  const options = PICKER_THEMES.map((key): ThemeOption => {
    const t = byKey.get(key);
    const attempts = t ? num(t.attempts) : 0;
    return {
      key,
      label: themePluralLabel(key),
      group: key === focus ? "recommended" : themeGroup(key),
      pct: t ? themePct({ attempts, ewma: num(t.ewma) }) : null,
      attempts,
      available: availableNear(key, rating),
      recommended: key === focus,
    };
  });
  return [...options.filter((o) => o.recommended), ...options.filter((o) => !o.recommended)];
}

/** R4. Reads only. */
export async function listThemes(viewer: Viewer, deps: TrainDeps = trainDeps()): Promise<ThemesResult> {
  const [profile, themes] = await Promise.all([
    readProfile(deps.db, viewer),
    deps.db.$queryRaw<ThemeMasteryRow[]>(themeMasterySql(viewer.id)),
  ]);
  const rating = Math.round(profile.puzzleRating);
  return { options: themeOptionsOf(rating, themes), rating };
}
