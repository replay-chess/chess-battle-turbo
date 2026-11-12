// Practice copy (phase-03 plan §4.8; DR/V3Practice.dc.html). Title Case on buttons; sentence case elsewhere; every
// number computed. Pure strings.
export type Side = "w" | "b";

export const COLOUR = { w: "White", b: "Black" } as const;

export const PRACTICE_COPY = {
  takeBack: "Take Back",
  reset: "Reset",
  compare: "Compare",
  hint: "Hint",
  hintArrow: "Show the Arrow",
  retry: "Retry",
  back: "Back",
  loadingNote: "First load only: about 7 MB, cached after this.",
  failed: "Engine didn’t start. This browser may block WebAssembly.",
  offline: "Offline. The engine is cached, so practice still works; hints from the coach are unavailable.",
  thinking: "Engine thinking…",
  viewing: "Viewing an earlier move. Press → or play from the live position.",
  backToLive: "Back to the Game",
} as const;

/** "Engine 1400 plays Black. Untimed and unrated; take back as often as you like." */
export function engineLine(botElo: number, human: Side): string {
  return `Engine ${botElo} plays ${COLOUR[human === "w" ? "b" : "w"]}. Untimed and unrated; take back as often as you like.`;
}

/** "Engine 1400 plays White. The engine moves first." (the start position has the engine to move). */
export function engineFirstLine(botElo: number, human: Side): string {
  return `Engine ${botElo} plays ${COLOUR[human === "w" ? "b" : "w"]}. The engine moves first.`;
}

/** "Engine ready · your move as White". */
export function readyLine(human: Side): string {
  return `Engine ready · your move as ${COLOUR[human]}`;
}

/** "Starting the engine · 34%". */
export function loadingLine(pct: number): string {
  return `Starting the engine · ${Math.max(0, Math.min(100, Math.round(pct)))}%`;
}

export type PracticeFrom = "compare" | "review" | "position" | "fen" | "game_over";

/** practice_started.from: the link's `?from=`, else the same-site referrer's path, else the source. */
export function practiceFrom(param: string | null, referrerPath: string | null, source: "game" | "position" | "fen"): PracticeFrom {
  if (param === "compare" || param === "review" || param === "position" || param === "fen" || param === "game_over") return param;
  if (referrerPath) {
    if (/^\/review\/[^/]+\/legend/.test(referrerPath)) return "compare";
    if (referrerPath.startsWith("/review/")) return "review";
    if (referrerPath.startsWith("/game/")) return "game_over";
  }
  return source === "game" ? "review" : source;
}

/** Back's label from where it goes. */
/** The phone top bar's Back for the same href (the shell prints "Back to {label}" as its accessible name). */
export function shellBack(href: string): { key: "review" | "play"; href: string; label: string } {
  if (/^\/review\/[^/]+\/legend/.test(href)) return { key: "review", href, label: "Comparison" };
  if (href.startsWith("/review/")) return { key: "review", href, label: "Review" };
  if (href.startsWith("/position/")) return { key: "play", href, label: "Position" };
  return { key: "play", href, label: "Play" };
}

export function backLabel(href: string): string {
  if (/^\/review\/[^/]+\/legend/.test(href)) return "Back to the Comparison";
  if (href.startsWith("/review/")) return "Back to the Review";
  if (href.startsWith("/position/")) return "Back to the Position";
  return PRACTICE_COPY.back;
}
