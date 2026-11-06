// The move list's windowed slice (P2 plan 4.6.3): past 200 plies the list renders the latest 100 rows (no
// virtualiser dependency), with a "Show Earlier Moves" row above them. When the viewed ply is older than the window
// (arrow keys, the strip), the window moves back to keep it in the list.

/** Rows rendered once a game passes 200 plies. */
export const MOVE_WINDOW_ROWS = 100;
/** Rows kept above the viewed move when the window has to move back to show it. */
export const WINDOW_LEAD_ROWS = 10;

type RowLike = { w: { ply: number } | null; b: { ply: number } | null };

/** Index of the first row to render (0 = all). `current` is the viewed absolute ply; `all` = the user expanded it. */
export function windowStart(rows: readonly RowLike[], current: number, all: boolean): number {
  if (all || rows.length <= MOVE_WINDOW_ROWS) return 0;
  let start = rows.length - MOVE_WINDOW_ROWS;
  const idx = rows.findIndex((r) => r.w?.ply === current || r.b?.ply === current);
  if (idx >= 0 && idx < start) start = Math.max(0, idx - WINDOW_LEAD_ROWS);
  return start;
}
