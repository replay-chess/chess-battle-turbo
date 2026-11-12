// Phase 3 route classes (phase-03 plan §3.2 middleware row, §4.4, §4.5, §11.1). Pure data; the classifier is ./index.ts.
//
// Public: How we grade. Public without Clerk (`public_static`): the share pages `/r/<code>` and their image
// `/r/<code>/og` (anyone with the link, no account). They read no session (ISR snapshots), so middleware skips Clerk
// there: on a development instance Clerk sent every first visit through a ~1.7 s handshake redirect (FIX-1, the
// Lighthouse gate of G5). `/r` itself is not a page and stays signed-in by default.
//
// Signed in (not "member"): `/review/*`, `/games` and `/practice` need a session at the edge, and their layouts run the
// membership gate (`requireMemberPage` / `pageGateRedirect`). They are deliberately NOT member pages: the optional
// edge member gate (MIDDLEWARE_MEMBER_GATE) would send lapsed members to /pricing before the layout could apply the
// `review-lapsed-read` flag (B26, P3-Q1).
//
// API routes (`/api/review/*`, `/api/share/*`, `/api/me/games`, `/api/practice/context`) keep the default "api" class:
// Clerk runs and route() answers 401/402.

export const publicPages: readonly string[] = ["/how-we-grade"];

export const staticPages: readonly string[] = ["/r/(.*)"];

export const memberPages: readonly string[] = [];

export const signedInPages: readonly string[] = ["/review(.*)", "/games(.*)", "/practice(.*)"];

export const noClerkApi: readonly string[] = [];
