// The page frame of /train/weakness (phase-06 plan §4.3 "one viewport"): the root is a lock-mode page (`data-rc-lock`,
// ViewportStage keeps the document at the viewport's height) and only two regions may scroll — the Top-weaknesses
// column (desktop, iPad L) and, in the tab-bar form, the whole content column (`.scol`). Strings written out in full
// for Tailwind's scanner.

/**
 * Insufficient, computing, failed: the board's `.main` (centred, safe), content up to 1280 px. The one column is
 * `minmax(0, 1fr)` (FIX-1): the implicit `auto` column grew to the content's min-content width, so long labels and
 * scope text (plan §4.3 stress) pushed "How this is calculated" and the Preliminary tags past the right edge at 125 %.
 */
export const FRAME =
  "grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)] items-center-safe px-8 py-7 narrow:p-5 vh640:px-6 vh640:py-3.5 tabbar:items-start tabbar:px-4 tabbar:pt-1 tabbar:pb-4";
export const INNER = "mx-auto flex w-full max-w-[1280px] flex-col gap-5 tabbar:gap-3.5";

/** Ready: the board's `.main.fit` — the frame never scrolls on desktop and iPad L; the columns do. */
export const FIT =
  "flex min-h-0 flex-1 flex-col overflow-hidden px-8 py-6 narrow:p-5 vh700:px-6 vh700:py-3.5 tabbar:block tabbar:overflow-y-auto tabbar:px-4 tabbar:pt-1 tabbar:pb-4";
export const FIT_INNER = "mx-auto flex min-h-0 w-full max-w-[1280px] flex-1 flex-col gap-3.5 tabbar:flex-none";
export const FIT_GRID =
  "grid min-h-0 flex-1 grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] items-start gap-5 narrow:grid-cols-[minmax(0,1fr)_340px] [@media(hover:none)_and_(pointer:coarse)_and_(orientation:landscape)_and_(min-width:901px)]:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] [@media(hover:none)_and_(pointer:coarse)_and_(orientation:landscape)_and_(min-width:901px)]:gap-4 tabbar:flex-none tabbar:grid-cols-1 tabbar:gap-3.5";
export const FIT_COL = "flex max-h-full min-h-0 min-w-0 flex-col gap-2.5 overflow-y-auto overscroll-contain tabbar:max-h-none tabbar:overflow-visible";
