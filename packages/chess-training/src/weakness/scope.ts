// Which games count (phase-06 plan §8.2). In scope: the member's sides with a time class of the scope, ended on or
// after `since` (local midnight of the first day of the month `months` months ago, in `User.timeZone`), newest first,
// at most 300. Excluded: bot games (`BOT`, `LEGEND_BOT`: client-run and forgeable, D-P6-6), imported games against a
// `BOT`-titled account (R-LI-09), aborted games, live games (no `endedAt`), DAILY and UNTIMED. Pure.
import { formatYmd, localDate, addDays, weekdayOf, zonedToUtc } from "../tz";
import { MAX_GAMES, SCOPE_DEFAULT, SCOPE_MONTHS } from "./constants";
import type { GameModeDb, TimeClassW, WeaknessGameInput, WeaknessProfileRow, WeaknessScope } from "./types";

/** The order time classes are listed and labelled in: rapid, blitz, bullet, classical (§8.21). */
export const SCOPE_TIME_CLASS_ORDER: readonly TimeClassW[] = ["RAPID", "BLITZ", "BULLET", "CLASSICAL"];
const VALID_TC = new Set<string>(SCOPE_TIME_CLASS_ORDER);

/** The member's scope: the stored columns, or SCOPE_DEFAULT when they are empty / 0 / invalid. */
export function resolveScope(profile: WeaknessProfileRow | null): WeaknessScope {
  const stored = (profile?.weaknessTimeClasses ?? []).filter((tc) => VALID_TC.has(tc));
  const timeClasses = stored.length > 0 ? stored : [...SCOPE_DEFAULT.timeClasses];
  const months = (SCOPE_MONTHS as readonly number[]).includes(profile?.weaknessMonths ?? 0) ? (profile!.weaknessMonths as 3 | 6 | 12) : SCOPE_DEFAULT.months;
  return {
    timeClasses: SCOPE_TIME_CLASS_ORDER.filter((tc) => timeClasses.includes(tc)),
    months,
    maxGames: MAX_GAMES,
  };
}

/** Local midnight (in `timeZone`) of the first day of the month `months` months before `now`'s local month. */
export function scopeSince(now: Date, timeZone: string, months: number): Date {
  const d = localDate(now, timeZone);
  const index = d.y * 12 + (d.m - 1) - months;
  const y = Math.floor(index / 12);
  const m = (index % 12) + 1;
  return zonedToUtc(y, m, 1, 0, 0, timeZone);
}

/** The Monday of `now`'s ISO week in `timeZone`, as a local calendar date "YYYY-MM-DD" (`weakness_snapshots."weekStart"`). */
export function weekStartOf(now: Date, timeZone: string): string {
  const d = localDate(now, timeZone);
  return formatYmd(addDays(d, -weekdayOf(d)));
}

/** An imported game against a `BOT`-titled account (excluded and counted in `games.excludedBot`). */
export function isBotOpponent(g: Pick<WeaknessGameInput, "source" | "oppTitle">): boolean {
  return g.source !== "REPLAY" && g.oppTitle === "BOT";
}

/** In scope (§8.2), the bot-opponent rule included. */
export function isInScope(g: WeaknessGameInput, scope: WeaknessScope, since: Date): boolean {
  if (g.mode === "BOT" || g.mode === "LEGEND_BOT") return false;
  if (g.result === "ABORTED") return false;
  if (g.endedAt === null || g.endedAt.getTime() < since.getTime()) return false;
  if (g.timeClass === null || !(scope.timeClasses as string[]).includes(g.timeClass)) return false;
  return !isBotOpponent(g);
}

/** Games that count toward "Or play N more games here": friend, online and tournament games (D-P6-6). */
export function countsForPlayMore(mode: GameModeDb): boolean {
  return mode === "FRIEND" || mode === "ONLINE" || mode === "TOURNAMENT";
}

/** Newest first, ties by gameId descending (the Q-W5 order). */
export function byNewest(a: WeaknessGameInput, b: WeaknessGameInput): number {
  const ta = a.endedAt?.getTime() ?? 0;
  const tb = b.endedAt?.getTime() ?? 0;
  if (ta !== tb) return tb - ta;
  const ga = BigInt(a.gameId);
  const gb = BigInt(b.gameId);
  return ga === gb ? (a.color < b.color ? -1 : a.color > b.color ? 1 : 0) : gb > ga ? 1 : -1;
}

/** The scope set G: in-scope rows, newest first, at most 300, and how many bot-opponent imports were dropped. */
export function selectScope(inputs: readonly WeaknessGameInput[], scope: WeaknessScope, since: Date): { games: WeaknessGameInput[]; excludedBot: number } {
  let excludedBot = 0;
  const games: WeaknessGameInput[] = [];
  for (const g of inputs) {
    if (isInScope(g, scope, since)) games.push(g);
    else if (isBotOpponent(g) && g.mode !== "BOT" && g.mode !== "LEGEND_BOT" && g.result !== "ABORTED" && g.endedAt !== null && g.endedAt.getTime() >= since.getTime() && g.timeClass !== null && (scope.timeClasses as string[]).includes(g.timeClass)) {
      excludedBot += 1;
    }
  }
  games.sort(byNewest);
  return { games: games.slice(0, scope.maxGames), excludedBot };
}
