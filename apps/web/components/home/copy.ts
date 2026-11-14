// Home copy and view model (phase-05 plan §4.1; boards V3Home, V3HomeNewUser, V3HomeLoading). Pure: no React, no zod,
// no chess.js. Every number in a string comes from HomeData (never the board's sample numbers); time labels arrive
// formatted on the server in the viewer's zone. Buttons and headings are Title Case, status lines sentence case with a
// period, eyebrows lowercase in the source (CSS uppercases them).
import type { HomeBank, HomeContinue, HomeData, HomeImport, HomeRecentGame, HomeWeek } from "@repo/contracts/http/home";
import { movesProgress } from "@/features/review/progress";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export const HOME_COPY = {
  newGame: "New Game",
  playFriend: "Play a Friend",
  continueEyebrow: (when: string) => `Continue · ${when}`,
  reviewHeading: "Review With the Coach",
  cleanHeading: "A Clean Game",
  startReview: "Start Review",
  openReview: "Open Review",
  everyGame: "Every game you play is reviewed.",
  startHereEyebrow: "Start here",
  importChesscom: "Import My Chess.com Games",
  bankHeading: "Mistake Bank",
  bankNewLine: "Mistakes from your games land here as puzzles.",
  howItWorks: "How It Works",
  openBank: "Open Mistake Bank",
  weekHeading: "This week",
  seeProfile: "See Profile",
  playHeading: "Play",
  quickMatch: "Quick Match · 5+3",
  challengeFriend: "Challenge a Friend",
  playBot: "Play a Bot",
  recentHeading: "Recent games",
  recentList: "Recent games list",
  allGames: "All Games",
  recentEmpty: "Your games appear here after you play or import them.",
  importAny: "Import From Chess.com or Lichess",
  weekNoGames: "No games yet",
  weekNewSub: "Play once to start your streak.",
  analysingLabel: "Analysing your game",
  importLabel: "Import progress",
  loading: "Loading",
} as const;

export const HOME_LINKS = {
  newGame: "/play",
  playFriend: "/play?tab=friend",
  // /play reads `tab` and `tc` (lib/play/play-params.ts): Quick Match opens with 5+3 selected (FIX-2).
  quickMatch: "/play?tab=quick&tc=5%2B3",
  playBot: "/play?tab=bot",
  games: "/games",
  connected: "/settings/connected",
  howItWorks: "/how-we-grade",
  bank: "/train/bank",
  bankSession: "/train/bank/session",
} as const;

/** "Good evening, knightowl_88." / "Welcome, knightowl_88." (new members). */
export function greetingText(d: Pick<HomeData, "state" | "greeting">): string {
  return d.state === "new_user" ? `Welcome, ${d.greeting.name}.` : `Good ${d.greeting.part}, ${d.greeting.name}.`;
}

/** The header stat ("4 games this week"); hidden for new members. */
export function gamesThisWeekLabel(n: number): string {
  return `${plural(n, "game", "games")} this week`;
}

/** The Home state the telemetry and the tests name (`import_running` wins over the data state). */
export function homeViewState(d: Pick<HomeData, "state" | "import">): "populated" | "new_user" | "import_running" {
  return d.import ? "import_running" : d.state;
}

// ── Continue ────────────────────────────────────────────────────────────────────────────────────────────────────

/** "Two Knights Defence vs tal_fan_77 (1203)." */
export function gameLine(c: Pick<HomeContinue, "openingName" | "opponent" | "opponentRating">): string {
  const who = c.opponentRating === null ? c.opponent : `${c.opponent} (${c.opponentRating})`;
  return c.openingName ? `${c.openingName} vs ${who}.` : `Your game vs ${who}.`;
}

/** "You lost on move 28." */
export function resultLine(c: Pick<HomeContinue, "result" | "endMove">): string {
  if (c.result === "win") return `You won on move ${c.endMove}.`;
  if (c.result === "loss") return `You lost on move ${c.endMove}.`;
  return `Drawn on move ${c.endMove}.`;
}

/** "Analysing · 14 of 38 moves" (moves, not plies, as the review screen counts them). */
export function analysingLine(a: HomeContinue["analysis"]): string {
  if (a.status === "queued" || a.total <= 0) return "Analysing · queued";
  const { movesDone, movesTotal } = movesProgress(a.done, a.total);
  return `Analysing · ${movesDone} of ${movesTotal} moves`;
}

/** The card's sentence: the game, the result, then what the coach found (or the analysis progress). */
export function continueSentence(c: HomeContinue): string {
  const head = `${gameLine(c)} ${resultLine(c)}`;
  if (c.kind === "analysing") return `${head} ${analysingLine(c.analysis)}.`;
  if (c.kind === "clean") return `${head} ${c.accuracy === null ? "Clean game." : `Clean game · accuracy ${c.accuracy}.`}`;
  const n = c.keyMomentCount;
  return n === 1
    ? `${head} The coach found 1 moment; it is on the board.`
    : `${head} The coach found ${n} moments; the first is on the board.`;
}

function fenFacts(fen: string): { side: "White" | "Black"; move: number } {
  const parts = fen.trim().split(/\s+/);
  const move = Number.parseInt(parts[5] ?? "", 10);
  return { side: parts[1] === "b" ? "Black" : "White", move: Number.isInteger(move) && move > 0 ? move : 1 };
}

/** The board's accessible name: "Your game vs tal_fan_77, before move 19. White to move." */
export function continueBoardLabel(c: Pick<HomeContinue, "kind" | "fen" | "opponent">): string {
  const { side, move } = fenFacts(c.fen);
  const where = c.kind === "moments" ? `before move ${move}` : "final position";
  return `Your game vs ${c.opponent}, ${where}. ${side} to move.`;
}

// ── Mistake Bank card ───────────────────────────────────────────────────────────────────────────────────────────

/** "4 due". */
export function bankCountLabel(due: number): string {
  return `${due} due`;
}

/** "Loose pieces is your most common theme (7 in bank)." */
export function bankLine(b: HomeBank, isNew: boolean): string {
  if (isNew || b.total === 0) return HOME_COPY.bankNewLine;
  if (b.due === 0) return nothingDueLine(b);
  if (b.topTheme) return `${b.topTheme.label} is your most common theme (${b.topTheme.n} in bank).`;
  return `${plural(b.total, "position", "positions")} in your bank.`;
}

/** "Nothing due. Next batch tomorrow at 08:00." (plan §4.1; a payload from an older build: "… at 08:00.") */
export function nothingDueLine(b: Pick<HomeBank, "nextBatch">): string {
  if (!b.nextBatch) return "Nothing due.";
  return `Nothing due. Next batch ${b.nextBatch.whenLabel ?? `at ${b.nextBatch.atLabel}`}.`;
}

/** "About 3 min": round(0.75 n), at least 1 (the server's estMin, recomputed when a socket event changed `due`). */
export function bankMinutes(due: number): number {
  return Math.max(1, Math.round(0.75 * due));
}

export type BankCta = { label: string; href: string; kind: "how" | "review" | "open" };

/** New member → How It Works; something due → Review 4 · About 3 min (the runner); nothing due → Open Mistake Bank. */
export function bankCta(b: HomeBank, isNew: boolean): BankCta {
  if (isNew || b.total === 0) return { label: HOME_COPY.howItWorks, href: HOME_LINKS.howItWorks, kind: "how" };
  if (b.due > 0) return { label: `Review ${b.due} · About ${bankMinutes(b.due)} min`, href: HOME_LINKS.bankSession, kind: "review" };
  return { label: HOME_COPY.openBank, href: HOME_LINKS.bank, kind: "open" };
}

/** A due thumbnail opens the runner on that one card (a session-creating URL: never prefetched). */
export function thumbHref(cardRef: string): string {
  return `${HOME_LINKS.bankSession}?card=${encodeURIComponent(cardRef)}`;
}

// ── This week ───────────────────────────────────────────────────────────────────────────────────────────────────

export const WEEK_DAYS = ["M", "T", "W", "T", "F", "S", "S"] as const;

/** "4 games · 12 puzzles", or "No games yet". */
export function weekLine(w: Pick<HomeWeek, "games" | "puzzles">): string {
  if (w.games === 0 && w.puzzles === 0) return HOME_COPY.weekNoGames;
  return `${plural(w.games, "game", "games")} · ${plural(w.puzzles, "puzzle", "puzzles")}`;
}

// ── Import row ──────────────────────────────────────────────────────────────────────────────────────────────────

const PROVIDER: Record<HomeImport["provider"], string> = { chesscom: "Chess.com", lichess: "Lichess" };

/** "Importing 212 / 480 games" (uppercased by CSS). */
export function importLabel(i: HomeImport): string {
  return i.total === null ? `Importing ${plural(i.imported, "game", "games")}` : `Importing ${i.imported} / ${i.total} games`;
}

/** "about 2 min left", "less than a minute left", "about 3 h left". */
export function etaLabel(sec: number): string {
  if (sec < 60) return "less than a minute left";
  if (sec < 3600) return `about ${Math.round(sec / 60)} min left`;
  return `about ${Math.round(sec / 3600)} h left`;
}

/** "Chess.com · about 2 min left". */
export function importSub(i: HomeImport): string {
  return i.etaSec === null ? PROVIDER[i.provider] : `${PROVIDER[i.provider]} · ${etaLabel(i.etaSec)}`;
}

// ── Recent games ────────────────────────────────────────────────────────────────────────────────────────────────

export const RESULT_LABEL: Record<HomeRecentGame["result"], string> = { win: "Win", loss: "Loss", draw: "Draw" };

/** The row's second line: "Missed Rxf5 · move 19 · today". */
export function recentSub(g: Pick<HomeRecentGame, "chip" | "dateLabel">): string {
  return g.chip ? `${g.chip} · ${g.dateLabel}` : g.dateLabel;
}

/** The review a recent row opens. */
export function reviewHref(gameRef: string): string {
  return `/review/${encodeURIComponent(gameRef)}`;
}
