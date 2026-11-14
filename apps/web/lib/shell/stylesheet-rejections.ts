// A stylesheet that React inserts at runtime and that fails to load is not an unhandled rejection.
//
// React 19 gives every stylesheet it inserts on the client (a route's CSS on a soft navigation, a stylesheet rendered
// with `precedence`) a promise that nothing awaits or catches: `link._p = new Promise((resolve, reject) => {
// link.onload = resolve; link.onerror = reject })` (react-dom-client, preinitStyle / acquireResource). When the load
// fails, the promise rejects with the link's `error` Event and the browser reports an unhandled rejection whose reason
// prints as "[object Event]" (Sentry's global handler captures it too). WebKit fires that `error` for every stylesheet
// whose load a navigation cut (Chromium does not): a member who leaves /home while the soft navigation that opened it
// is still loading the route's CSS (after the sign-in, or a tap on Home) gets it (regression: webkit-home-css-cut,
// CI 43608761478 webkit-iphone review-walkthrough, "[pageerror] [object Event] (/home)"). React keeps the failure on
// the resource itself (its `loading` state) and the page is being left, so there is nothing to report:
// `installStylesheetRejectionGuard` marks exactly these rejections handled. Any other rejection is untouched.

type LinkLike = { tagName?: unknown; rel?: unknown };

/** The rejection reason of a React stylesheet promise: the `error` Event of a `<link rel="stylesheet">`. */
export function isStylesheetLoadFailure(reason: unknown): boolean {
  if (typeof Event === "undefined" || !(reason instanceof Event) || reason.type !== "error") return false;
  const target = reason.target as LinkLike | null;
  if (!target || typeof target.tagName !== "string" || target.tagName.toUpperCase() !== "LINK") return false;
  return typeof target.rel === "string" && /(?:^|\s)stylesheet(?:\s|$)/i.test(target.rel);
}

type RejectionTarget = { addEventListener(type: "unhandledrejection", listener: (e: PromiseRejectionEvent) => void): void };

const installedOn = new WeakSet<RejectionTarget>();

/**
 * Listens for `unhandledrejection` (once per target; `window` by default, nothing on the server). Install it before any
 * other listener (instrumentation-client.ts does, first): `stopImmediatePropagation` keeps the early Sentry buffer and
 * Sentry's own handler from seeing it.
 */
export function installStylesheetRejectionGuard(target: RejectionTarget | undefined = typeof window === "undefined" ? undefined : window): boolean {
  if (!target) return false;
  if (installedOn.has(target)) return true;
  installedOn.add(target);
  target.addEventListener("unhandledrejection", (e) => {
    if (!isStylesheetLoadFailure(e.reason)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  });
  return true;
}
