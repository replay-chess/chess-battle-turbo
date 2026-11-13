// The engine's score helpers with no engine glue (no worker, no UCI session): code that ships in a route's first load
// (the bot screen, useBotEngine) imports them from here, so the UCI module stays in the lazy engine chunk. A module
// shared by an eager and a lazy chunk lands whole in the eager one.

/** Centipawn view of a line (mates as ±100 000), from the side to move. */
export function lineCp(l: { cp?: number; mate?: number }): number | null {
  if (l.mate !== undefined) return l.mate > 0 ? 100_000 - l.mate : -100_000 - l.mate;
  return l.cp ?? null;
}
