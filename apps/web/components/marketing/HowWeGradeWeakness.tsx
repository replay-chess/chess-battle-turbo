// /how-we-grade#weakness (phase-06 plan §2.1 "Lights up", §8.1; WP7): how the Weakness Profile is built, with every
// number read from the engine's own constants (`@repo/chess-training/weakness/constants`) and the committed baseline's
// metadata, so the page cannot drift from what the worker computes; HowWeGradeWeakness.test.ts pins the wording to
// those constants. A server component of the force-static page: none of this reaches the browser. It links nowhere
// inside the app (the page is public and the profile is still behind the `weakness` flag: no dead links).
import { DEFAULT_BASELINE_ID, loadBaseline } from "@repo/chess-training/baselines/load";
import {
  BAND_HALF_WIDTH,
  CLOCK_EDGES_MS,
  CLOCK_MIN_MOVES_BUCKET,
  CLOCK_SENTENCE_RISE_RATIO,
  DEBOUNCE_SEC,
  DRILL_OWN_SHARE,
  DRILL_SIZES,
  EVENTS_PER_GAME_CAP,
  FAMILY_ALPHA,
  GAMES_REQUIRED,
  MAX_GAMES,
  MIN_EVENTS,
  MIN_GAMES_WITH,
  MIN_MOVES,
  MIN_MOVES_TP,
  MORE_N,
  PRELIMINARY_FROM,
  RATIO_MIN,
  RECOMPUTE_LIMIT_SEC,
  SCOPE_DEFAULT,
  TIME_PRESSURE_MS,
  TOP_N,
  TREND_ALPHA,
  TREND_MIN_MOVES,
  TREND_MIN_MOVES_TP,
  TREND_PRIOR_DAYS,
  TREND_RATIO,
  TREND_RECENT_DAYS,
  WHERE_LAST_N,
} from "@repo/chess-training/weakness/constants";
import { ELIGIBILITY_TESTS } from "@repo/chess-training/weakness/patterns";

export const WEAKNESS_ANCHOR = "weakness";

const num = (n: number) => n.toLocaleString("en-US");
const pct = (x: number) => `${Math.round(x * 100)}%`;
const minutes = (sec: number) => `${Math.round(sec / 60)} minutes`;
const clockMinutes = (ms: number) => ms / 60_000;
const words = (keys: readonly string[]) => {
  const lower = keys.map((k) => k.toLowerCase());
  return lower.length <= 1 ? (lower[0] ?? "") : `${lower.slice(0, -1).join(", ")} and ${lower[lower.length - 1]}`;
};

/** A worked band example around 1200: "players rated 1100–1300". */
export function bandExample(center = 1200): string {
  return `${center - BAND_HALF_WIDTH}–${center + BAND_HALF_WIDTH}`;
}

/** Where the comparison numbers come from: the committed default baseline (its own metadata, never a claim). */
export function baselineLine(): string {
  const b = loadBaseline(DEFAULT_BASELINE_ID);
  if (b.synthetic) {
    return "The comparison table for each rating is still being built from the Lichess open database. Until it is published, profiles here are compared with a provisional table; the live site never shows a profile built on it.";
  }
  const month = /(\d{4})-(\d{2})/.exec(b.source.dump);
  const when = month ? ` (${new Date(Date.UTC(Number(month[1]), Number(month[2]) - 1, 1)).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" })})` : "";
  return `The comparison comes from ${num(b.source.games)} rated games of the Lichess open database${when}, CC0, graded by the same engine and the same pattern tagger as your games, in 100-point rating steps.`;
}

export type WeaknessSection = { id: string; title: string; paragraphs: string[] };

/** The section's text, in reading order (exported for the test that pins it to the constants). */
export function weaknessSections(): WeaknessSection[] {
  const tpSeconds = TIME_PRESSURE_MS / 1000;
  // The Clock tab's buckets (< 1, 1–2, 2–5, > 5 minutes): the rising-rate rule reads them (breakdown.ts clockRises).
  const [lt1Min, lt2Min, gt5Min] = CLOCK_EDGES_MS.map(clockMinutes) as [number, number, number];
  const own = Math.round(DRILL_SIZES[0] * DRILL_OWN_SHARE);
  return [
    {
      id: "weakness-games",
      title: "Which games count",
      paragraphs: [
        `Your ${words(SCOPE_DEFAULT.timeClasses)} games from the last ${SCOPE_DEFAULT.months} months, up to the ${num(MAX_GAMES)} newest, played against people (bot games are left out). You can add bullet games when you have them.`,
        `A profile needs ${GAMES_REQUIRED} analysed games. From ${PRELIMINARY_FROM} games we show what we can see so far, marked Preliminary: under ${GAMES_REQUIRED} games a pattern can be chance.`,
      ],
    },
    {
      id: "weakness-rate",
      title: "Rate per 100 moves",
      paragraphs: [
        "Every mistake, miss and blunder in those games is tagged with the patterns it shows (a missed fork, a loose piece, a back-rank mate). The same tagger reads your games and the games we compare them with.",
        `For each pattern we count how often it happened per 100 of your moves, next to the same rate for players rated within ${num(BAND_HALF_WIDTH)} points of you (players rated ${bandExample()} for a 1200 player).`,
        baselineLine(),
      ],
    },
    {
      id: "weakness-list",
      title: "What makes the list",
      paragraphs: [
        `A pattern is a weakness when it happened at least ${MIN_EVENTS} times in at least ${MIN_GAMES_WITH} different games, over at least ${num(MIN_MOVES)} of your moves, at least ${RATIO_MIN} times as often as in your rating band, and by a margin that is not chance. We test about ${ELIGIBILITY_TESTS} patterns for every player, so the margin must hold for all of them together: a player exactly at their band's level sees a weakness list no more than ${pct(FAMILY_ALPHA)} of the time. A pattern counts at most ${EVENTS_PER_GAME_CAP} times per game in this test, for you and for your band alike (one long rook endgame can carry many errors). Time pressure is the one exception: it is counted in full, for you and for your band.`,
        `Patterns rank by the win% they cost you per 100 moves beyond what players at your rating lose to them: the top ${TOP_N}, and up to ${TOP_N + MORE_N} with See all. When nothing stands out against your band, we list the patterns you meet most often instead and say so. "Where" counts how many of your last ${WHERE_LAST_N} games it happened in.`,
        `Time-pressure blunders are blunders made with under ${tpSeconds} seconds on your clock, counted per 100 of your moves with that little time. They need at least ${num(MIN_MOVES_TP)} such moves, and your own blunder rate must rise as your clock runs down, as the Clock tab shows it: under ${lt2Min} minutes, and under ${lt1Min} minute alone, it must be at least ${CLOCK_SENTENCE_RISE_RATIO} times your rate with more than ${gt5Min} minutes left (or ${lt2Min}–${gt5Min} minutes when you rarely have ${gt5Min}), each rate over at least ${num(CLOCK_MIN_MOVES_BUCKET)} moves. If you blunder no more often short of time than with time to spare, time pressure is not your weakness, however often you blunder. The per-game limit above does not apply to it: its moves with under ${tpSeconds} seconds left come in the same scrambles as its blunders.`,
      ],
    },
    {
      id: "weakness-trend",
      title: "Trend and updates",
      paragraphs: [
        `The trend compares your last ${TREND_RECENT_DAYS} days with the ${TREND_PRIOR_DAYS} days before them, once each period holds at least ${num(TREND_MIN_MOVES)} of your moves (for time pressure, at least ${num(TREND_MIN_MOVES_TP)} moves with under ${tpSeconds} seconds left). It reads as getting worse or improving only when the rate changed by at least ${TREND_RATIO} times (either way) and the change is clear at the ${pct(TREND_ALPHA)} level; otherwise it is about the same.`,
        `The profile is rebuilt a few minutes after new games are analysed (within about ${minutes(DEBOUNCE_SEC)}). You can ask for a rebuild yourself once every ${minutes(RECOMPUTE_LIMIT_SEC)}.`,
      ],
    },
    {
      id: "weakness-drill",
      title: "Drills",
      paragraphs: [
        `A drill has ${DRILL_SIZES.join(" or ")} positions: ${pct(DRILL_OWN_SHARE)} from your own games (${own} of ${DRILL_SIZES[0]}), the rest matched Lichess puzzles of the same pattern near your puzzle rating. Puzzles have no clock, so a time-pressure drill uses your own positions only.`,
      ],
    },
  ];
}

/** The Weakness Profile tab of /how-we-grade (`#weakness`). */
export function HowWeGradeWeakness() {
  return (
    <>
      <h2 id={WEAKNESS_ANCHOR} className="m-0 scroll-mt-3 text-lg font-medium text-cb-text">
        Weakness Profile
      </h2>
      <p className="m-0 max-w-[720px] text-body text-cb-text">
        Your weakness profile names the mistake patterns that cost you the most points, measured against players at your
        rating, so you train what actually loses you games.
      </p>
      {weaknessSections().map((s) => (
        <section key={s.id} aria-labelledby={`${s.id}-h`} className="flex max-w-[720px] flex-col gap-2" id={s.id} data-testid={`hwg-${s.id}`}>
          <h3 id={`${s.id}-h`} className="m-0 scroll-mt-3 text-base font-medium text-cb-text">
            {s.title}
          </h3>
          {s.paragraphs.map((p) => (
            <p key={p.slice(0, 32)} className="m-0 text-body text-cb-text">
              {p}
            </p>
          ))}
        </section>
      ))}
    </>
  );
}
