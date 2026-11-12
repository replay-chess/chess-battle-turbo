/* global process */
// Redirect registry (phase-01 plan 13.3 1B·J, CF §7 "registries as directories"). next.config.js `redirects()`
// returns allRedirects(). Each phase owns one file here (`p06.mjs`, `p09.mjs` …) exporting
// `redirects(env) => Redirect[]`, and adds one import and one PHASES entry below; no phase edits another's file.
//
// Order matters: Next uses the first matching rule, and PHASES is concatenated oldest first, so the host
// canonicalisation in p00 always runs before any path rule. A later phase that needs a 307 on dev and a 308 in
// production sets `permanent: env.APP_ENV === "production"` (P8 D8-5).
import * as p00 from "./p00-legacy.mjs";
import * as p03 from "./p03.mjs";

/** Oldest first; one line per phase file. */
const PHASES = [p00, p03];

/**
 * @param {Record<string, string | undefined>} env
 * @returns {import("next/dist/lib/load-custom-routes").Redirect[]}
 */
export function allRedirects(env = process.env) {
  return PHASES.flatMap((phase) => phase.redirects(env));
}

export { mediaUrlOf } from "./p00-legacy.mjs";
