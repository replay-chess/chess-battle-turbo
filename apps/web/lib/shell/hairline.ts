// Route hairline rule (SPEC 8.2 RouteHairline): show only for a same-origin
// navigation that changes the pathname or the search. Hash-only changes don't count.
export function shouldStartHairline(currentUrl: string, nextUrl: string): boolean {
  try {
    const current = new URL(currentUrl);
    const next = new URL(nextUrl, current);
    if (next.origin !== current.origin) return false;
    return next.pathname !== current.pathname || next.search !== current.search;
  } catch {
    return false;
  }
}

/** Delay before the hairline shows, and the safety timeout that hides it. */
export const HAIRLINE_DELAY_MS = 200;
export const HAIRLINE_SAFETY_MS = 10_000;
