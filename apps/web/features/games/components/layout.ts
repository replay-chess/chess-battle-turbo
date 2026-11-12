// Shared class strings of the /games screen (DR/V3GamesArchive.dc.html `.amain`, `.agrid`, `.grow`). One place, so
// the live rows, the ghost rows of `loading` and loading.tsx line up to the pixel.

/** The page: one viewport (lock mode); only the list scrolls. */
export const PAGE =
  "mx-auto flex h-full min-h-0 w-full max-w-[1280px] flex-col gap-3.5 px-7 pt-5 pb-4 narrow:px-5 vh700:gap-2.5 vh700:pt-3 vh700:pb-3 tabbar:gap-3 tabbar:px-3 tabbar:pt-3 tabbar:pb-3";

/**
 * List + aside. Desktop: the aside is as wide as the viewport height allows (the board's formula), 300–440 px; rail
 * (iPad L, desktop ≥ 125 %): 300 px; iPad portrait: one column, the aside becomes a strip above the list; phones:
 * no aside.
 */
export const GRID =
  "grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)] gap-5 grid-cols-[minmax(0,1fr)_minmax(300px,min(calc(100dvh-300px),440px))] rail:grid-cols-[minmax(0,1fr)_300px] rail:gap-4 tabbar:grid-cols-[minmax(0,1fr)] tabbar:gap-3 tablet-portrait:grid-rows-[auto_minmax(0,1fr)] [@media(max-height:480px)]:grid-cols-[minmax(0,1fr)]";

/** The same grid without an aside (`empty`: the list card spans the row). */
export const GRID_SINGLE = "grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)]";

export const CARD = "min-h-0 border border-cb-border bg-cb-surface";

/**
 * One row: result · opponent + note · opening (wide only) · date · delta. 56 px (48 at ≤ 700 px tall). The opening
 * column hides at ≤ 1100 px wide; phones use a tighter grid.
 */
export const ROW_GRID =
  "grid min-h-14 grid-cols-[64px_minmax(0,1.4fr)_minmax(0,1fr)_92px_56px] items-center gap-3.5 px-4 vh700:min-h-12 narrow:grid-cols-[56px_minmax(0,1fr)_84px_48px] [@media(max-width:600px)]:grid-cols-[52px_minmax(0,1fr)_auto_28px] [@media(max-width:600px)]:gap-2.5 [@media(max-width:600px)]:px-3";

/** The opening column: hidden at ≤ 1100 px. */
export const WIDE_ONLY = "narrow:hidden";

/** Rows rendered by the loading state (V3Skeletons `list`: 9 ghost rows). */
export const GHOST_ROWS = 9;

/** The aside: hidden on phones and very short viewports; a horizontal strip on iPad portrait. */
export const ASIDE =
  "flex min-h-0 flex-col gap-3 self-start overflow-y-auto p-4 max-h-full [@media(max-width:600px)]:hidden [@media(max-height:480px)]:hidden tablet-portrait:order-first tablet-portrait:flex-row tablet-portrait:items-center tablet-portrait:gap-4 tablet-portrait:self-stretch tablet-portrait:p-3";
