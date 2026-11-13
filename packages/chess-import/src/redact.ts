// Provider usernames and emails never reach telemetry (phase-04 plan §11.3: no usernames or emails in PostHog or
// Sentry). FIX-1: they travelled in two places nothing scrubbed —
//   - outgoing provider URLs: Sentry's fetch/http integrations record every Chess.com and Lichess call as a span and a
//     breadcrumb with the full URL (`https://api.chess.com/pub/player/<u>/games/2026/11`,
//     `https://lichess.org/api/games/user/<u>?…`), in the worker and on the web;
//   - our own page URLs: the Confirm/Link steps carry `?u=<handle>`, Dodo's return adds `email=` to the activation
//     pages, and PostHog's `$current_url`, Sentry's navigation spans and request URLs copy them.
// `redactUsernames` rewrites both shapes inside any string; `redactDeep` applies a string rewrite to every string of an
// event (objects and arrays in place). Pure and dependency-free: the web ships it in the browser's instrumentation
// chunk, the worker in its Sentry hooks.

/** What replaces a provider username in a URL path. */
export const USERNAME_PLACEHOLDER = ":username";
/** What replaces the value of a personal query parameter. */
export const PARAM_PLACEHOLDER = "[redacted]";
/** Query parameters whose values are personal: a provider handle or an email. Exact names (case-insensitive). */
export const PII_PARAM_NAMES: ReadonlySet<string> = new Set(["u", "user", "username", "handle", "email"]);

const SEGMENT = String.raw`[^/?#&\s"'<>)\]]+`;
/** Chess.com public API: /pub/player/<u>[/stats|/games/archives|/games/YYYY/MM]. */
const CHESSCOM_PLAYER = new RegExp(String.raw`(/pub/player/)${SEGMENT}`, "gi");
/** Lichess game export: /api/games/user/<u>. */
const LICHESS_GAMES = new RegExp(String.raw`(/api/games/user/)${SEGMENT}`, "gi");
/** Lichess public profile: /api/user/<u> on lichess.org (or the e2e mock's /lichess prefix), never our own /api/user/*. */
const LICHESS_USER = new RegExp(String.raw`((?:lichess\.org|/lichess)/api/user/)${SEGMENT}`, "gi");
/** `?u=…`, `&email=…`, and their percent-encoded forms inside another parameter (`%3Fu%3D…`, `%26email%3D…`). */
const PII_PARAM = /((?:[?&]|%3f|%26)(?:u|user|username|handle|email)(?:=|%3d))(?:[^&#\s"'<>%]|%(?!26|23)[0-9a-f]{2})*/gi;

/** Rewrites provider usernames in URL paths and personal query values; any other string is returned unchanged. */
export function redactUsernames(value: string): string {
  let out = value;
  if (out.includes("/pub/player/")) out = out.replace(CHESSCOM_PLAYER, `$1${USERNAME_PLACEHOLDER}`);
  if (out.includes("/user/")) {
    out = out.replace(LICHESS_GAMES, `$1${USERNAME_PLACEHOLDER}`).replace(LICHESS_USER, `$1${USERNAME_PLACEHOLDER}`);
  }
  if (out.includes("=") || /%3d/i.test(out)) out = out.replace(PII_PARAM, `$1${PARAM_PLACEHOLDER}`);
  return out;
}

const MAX_DEPTH = 10;

/**
 * Applies `rewrite` to every string inside `value` (plain objects and arrays changed in place, so a telemetry hook can
 * return the same event) and returns the result. Depth-limited; non-plain objects (Date, Error, typed arrays) are kept.
 * Object keys are kept as they are (Sentry's `url.query` attribute names, PostHog's property names).
 */
export function redactDeep<T>(value: T, rewrite: (s: string) => string = redactUsernames, depth = 0): T {
  if (typeof value === "string") return rewrite(value) as T;
  if (value === null || typeof value !== "object" || depth >= MAX_DEPTH) return value;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) value[i] = redactDeep(value[i], rewrite, depth + 1);
    return value;
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return value;
  const obj = value as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    obj[key] = PII_PARAM_NAMES.has(key.toLowerCase()) && typeof obj[key] === "string" ? PARAM_PLACEHOLDER : redactDeep(obj[key], rewrite, depth + 1);
  }
  return value;
}
