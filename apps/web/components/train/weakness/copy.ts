// Every string the Weakness Profile screens write themselves (phase-06 plan §4.4–§4.9, §4.12 copy notes C1–C10).
// Board copy is verbatim from DR/V3WeaknessInsufficient, V3WeaknessComputing, V3WeaknessProfile and V3WeaknessDrill;
// the strings the boards do not have (failed, stalled, updating, bullet offer, no clock, none eligible, unmatched,
// empty, top changed) are the plan's *new* copy. Data strings (labels, the headline, the where line, the trend, the
// breakdown sentences, the scope labels) are formatted on the server and never rebuilt here.

export const WEAKNESS_REQUIRED = 20;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export const copy = {
  title: "Weakness profile",
  howLink: "How this is calculated",
  howHref: "/how-we-grade#weakness",
  backLabel: "Train",
  backHref: "/train",

  // S1 insufficient (§4.4)
  preliminaryTag: "Preliminary",
  insufficientZeroH2: "Play or import 20 games and we can tell you what keeps costing you points",
  insufficientH2: (analysed: number) =>
    `${plural(Math.max(1, WEAKNESS_REQUIRED - analysed), "more game", "more games")} and we can tell you what keeps costing you points`,
  meterLabel: (analysed: number) => `${Math.min(analysed, WEAKNESS_REQUIRED)} of ${WEAKNESS_REQUIRED} games analysed`,
  meterCaption: (analysed: number) => `${Math.min(analysed, WEAKNESS_REQUIRED)} / ${WEAKNESS_REQUIRED} games analysed`,
  importCta: "Import games from Chess.com or Lichess",
  importHref: "/settings/connected",
  checkNewCta: "Check for new games",
  playMore: (n: number) => `Or play ${plural(n, "more game", "more games")} here`,
  playHref: "/play",
  seeSoFar: "What we can see so far",
  seenIn: (seenIn: number, of: number) => `Seen in ${seenIn} of ${plural(of, "game", "games")}`,
  chanceNote: "Under 20 games a pattern can be chance.",
  emptyTitle: "Nothing Yet",
  emptyBody: "Patterns show after 5 analysed games.",
  bulletOffer: (n: number, months: number) => `You have ${plural(n, "bullet game", "bullet games")} from the last ${months} months. Include them?`,
  bulletCta: "Include bullet games",

  // S2 computing (§4.5)
  building: "Building your profile",
  analysing: (n: number, capped: boolean) => (capped ? `Analysing your ${n} newest games` : `Analysing ${plural(n, "game", "games")}`),
  firstTwenty: "Your profile appears after the first 20; the rest keep improving it.",
  pctLine: (pct: number, eta: string) => `${pct}% · ${eta}`,
  leaveNote: "You can leave this page. We’ll show a dot on Train when it’s ready.",
  stalled: "Taking longer than usual. We’ll keep going in the background.",
  readyTag: "Ready",
  readyH2: "Your profile is ready",
  seeProfile: "See your weakness profile",
  progressLabel: "Profile progress",
  stepDone: "done",
  stepRunning: "in progress",
  stepWaiting: "waiting",
  milestone: (pct: number) => (pct >= 100 ? "Your profile is ready" : `Profile ${pct}% built`),

  // S3 ready (§4.6)
  verified: "VERIFIED",
  updating: (n: number) => (n > 0 ? `Updating with ${plural(n, "new game", "new games")}…` : "Updating…"),
  topWeaknesses: "Top weaknesses",
  listLabel: (o: { count: number; band: string | null; mostFrequent: boolean; short: boolean }) => {
    if (o.mostFrequent) return "Most frequent in your games · per 100 moves";
    const head = `Top ${o.count} · per 100 moves`;
    if (!o.band) return head;
    return o.short ? `${head} vs ${o.band}` : `${head}, you vs players rated ${o.band}`;
  },
  rateAria: (o: { you: string; band: string | null; underMinute: boolean }) =>
    `You ${o.you} per 100 moves${o.underMinute ? " under 1 minute" : ""}${o.band === null ? "" : `, rating band ${o.band}`}`,
  rateUnderMinute: "under 1 min",
  drillInBank: (n: number) => `Drill · ${n} in bank`,
  drill: "Drill",
  selected: "Selected",
  exampleLabel: (label: string) => `${label}: example position from your games`,
  lessonLink: (title: string) => `Legend lesson: ${title}`,
  morePatterns: (more: number, total: number) => `${plural(more, "more pattern", "more patterns")} found. All ${total} have drills.`,
  seeAll: "See all",
  showFewer: "Show fewer",
  weekPlan: "This week’s plan from your profile",
  breakdown: "Breakdown",
  tabs: { phase: "By phase", clock: "Clock", open: "Openings", str: "Strengths" },
  phaseRow: (you: number | null, band: number | null) =>
    you === null ? "Not enough moves yet" : band === null ? `You ${you}` : `You ${you} · band ${band}`,
  legendYou: "You",
  legendBand: (band: string) => `Players rated ${band}`,
  noClock: "These games have no clock data, so there is no Clock tab.",
  openingsCols: { family: "Family", games: "Games", score: "Score" },
  openingNotes: { most_played: "Most played", most_points_lost: "Most points lost", best_score: "Best score" },
  openingsEmpty: "Not enough games per opening yet.",
  strengthsTitle: "What you already do well",
  strengthsEmpty: "Nothing stands out yet. Strengths show once a pattern holds across 20 games.",
  footnote: "Updated after every analysed game. Patterns under 20 games are marked Preliminary.",
  topChanged: (label: string) => `Your weakness profile changed: ${label} is now your top pattern.`,

  // S4 drill config (§4.7)
  drillSize: "Drill size",
  size10: "10 positions",
  size20: "20 positions",
  mixLabel: "Fill with matched Lichess puzzles",
  unmatched: "No matching puzzles for this pattern",
  timePressure: "Matched puzzles have no clock, so this drill uses your own positions only",
  // Plan §4.7 (rct-b W2): the pattern is named, "All your fork positions are mastered; …" (FIX-1).
  zeroOwn: (noun: string) => `All your ${noun} positions are mastered; this drill uses matched puzzles`,
  empty: "No positions to drill yet. They’re added as your games are reviewed.",
  startError: "Couldn’t start the drill",
  tooManySessions: "Too many sessions. Try again in",
  closeConfig: "Close drill options",

  // S5 failed (§4.8)
  failedTitle: "We couldn’t build your profile",
  failedBody: "Something went wrong while comparing your games. Your games and Mistake Bank are fine.",
  failedAgain: "If this keeps happening, contact hello@playchess.tech",
  // FIX-1: the worker's kill switch skipped the build (failure.retryable false).
  pausedTitle: "Profile updates are paused",
  pausedBody: "We’re not building new profiles for a short while. Your games and Mistake Bank are fine. Check back later today.",
  retry: "Retry",
  rebuildLimited: "Your profile was asked for recently. Try again in",
  eventId: (id: string) => `Event ID ${id}`,

  // loading (§4.9)
  loading: "Loading…",
} as const;

/** The plan's tab ids (`?tab=`): `str` exists as a tab on phones, iPad portrait and iPad landscape only. */
export const WEAKNESS_TABS = ["phase", "clock", "open", "str"] as const;
export type WeaknessTab = (typeof WEAKNESS_TABS)[number];

export function parseTab(v: string | string[] | undefined | null): WeaknessTab {
  const s = Array.isArray(v) ? v[0] : v;
  return (WEAKNESS_TABS as readonly string[]).includes(s ?? "") ? (s as WeaknessTab) : "phase";
}
