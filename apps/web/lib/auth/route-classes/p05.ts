// Phase 5 route classes (phase-05 plan §3.1 middleware row, §4, §11; interface check §0.7). Pure data; the classifier
// is ./index.ts.
//
// Signed in (not "member"), as P3 did for `/review/*`: `/home` and `/train/**` need a session at the edge, and their
// pages run the membership gate (`requireMemberPage` / `pageGateRedirect`). They are deliberately NOT member pages: the
// optional edge member gate (MIDDLEWARE_MEMBER_GATE) would otherwise answer before the page, and the owner decision on
// lapsed read access (B26, D-19) may later let a lapsed member read the bank without fighting the edge gate.
//
// `/` stays public (P1). The landing rule "signed-in, onboarded and entitled `/` → `/home`" is P5's one block in
// middleware.ts (WP-H, lib/home/landing.ts): route classes are lists and cannot express a redirect.
// API routes (`/api/train/*`, `/api/home`, `/api/me/badges`, `/api/reports`) keep the default "api" class: Clerk runs
// and route() answers 401/402.

export const publicPages: readonly string[] = [];

export const memberPages: readonly string[] = [];

export const signedInPages: readonly string[] = ["/home(.*)", "/train(.*)"];

export const noClerkApi: readonly string[] = [];
