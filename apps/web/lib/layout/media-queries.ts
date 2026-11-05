// Media-query strings shared by CSS and TS (SPEC 3.3). Each must appear in
// components/layout/viewport.css or app/globals.css exactly as written here.
// Use them only after hydration (toaster placement, analytics surface,
// sheet-vs-dialog on open, keyboard registration), never to pick the first render.

export const RAIL_MQ = "(max-width: 1100px), (hover: none) and (pointer: coarse)";
export const TABBAR_MQ = "(max-width: 600px), (max-width: 900px) and (orientation: portrait)";
export const TABLET_PORTRAIT_MQ = "(min-width: 601px) and (max-width: 900px) and (orientation: portrait)";
export const NARROW_MQ = "(max-width: 1100px)";
/** Shell-mode logic: touch-first devices (rail, no single-key shortcuts, no search button). */
export const COARSE_MQ = "(hover: none) and (pointer: coarse)";
/** Tap-target logic: matches Tailwind's `pointer-coarse:` exactly. */
export const COARSE_POINTER_MQ = "(pointer: coarse)";
