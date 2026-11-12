// Route classes (plan phase-01 §7.6, P1-11). Pure: no Next, Clerk, env or clock access, so middleware (edge), server
// code and client code (the session guard's "is this a public page?") share one classifier.
//
// Each phase owns one data file (`p01.ts`, later `p02.ts` …) with the lists below. To add or reclassify a route, a phase
// adds its file and one entry in PHASES; middleware.ts never changes. The newest phase that lists a path decides its
// class, so a later phase can move a P1 member page to public without editing p01.ts. REPO/docs/route-map.md §3 holds
// the concrete paths each class must cover; route-classes.test.ts checks the two agree.
import * as p01 from "./p01";
import * as p03 from "./p03";

export type RouteClass = "scanner" | "public" | "public_static" | "member" | "signed_in" | "api" | "api_no_clerk";

export interface RouteClassSet {
  readonly publicPages: readonly string[];
  readonly memberPages: readonly string[];
  readonly signedInPages: readonly string[];
  readonly noClerkApi: readonly string[];
  /**
   * Public pages that never read a session (ISR snapshots served the same to everyone): middleware skips Clerk for
   * them as for `noClerkApi`, so a first visit is never sent through Clerk's handshake redirect (P3 `/r/<code>`; FIX-1).
   */
  readonly staticPages?: readonly string[];
}

/** Oldest first; add one line per phase file. */
const PHASES: readonly RouteClassSet[] = [p01, p03];

/**
 * Probe paths no real route uses (CA AP-33): answered 404 before Clerk. No route ends in .php/.env/.git/.asp(x)/.bak/
 * .sql or starts with these prefixes.
 */
export const SCANNER = /\.(php|env|git|aspx?|bak|sql)$|^\/(wp-|wordpress|\.git|\.env|cgi-bin|phpmyadmin)/i;

const ESCAPE = /[.*+?^${}()|[\]\\]/g;
const escape = (s: string) => s.replace(ESCAPE, "\\$&");

/** Strips one trailing slash ("/play/" → "/play"); "/" stays "/". */
export function normalizePath(pathname: string): string {
  return pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
}

/**
 * "/x" exact; "/x(.*)" = /x or anything below it (segment boundary: "/play(.*)" never matches /playlist);
 * "/x/(.*)" = anything below /x only. Any other regex syntax is rejected so a list can't hide a surprise.
 */
export function compilePattern(pattern: string): RegExp {
  if (!pattern.startsWith("/")) throw new Error(`route pattern must start with "/": ${pattern}`);
  let body: string;
  if (pattern.endsWith("/(.*)")) body = `${escape(pattern.slice(0, -5))}/.*`;
  else if (pattern.endsWith("(.*)")) body = `${escape(normalizePath(pattern.slice(0, -4)))}(?:/.*)?`;
  else body = escape(normalizePath(pattern));
  if (/[()]/.test(pattern.replace(/\(\.\*\)$/, ""))) throw new Error(`unsupported route pattern: ${pattern}`);
  return new RegExp(`^${body}$`);
}

export type PathMatcher = (pathname: string) => boolean;

/** One matcher for a pattern list (normalises the trailing slash). */
export function matcherFor(patterns: readonly string[]): PathMatcher {
  const res = patterns.map(compilePattern);
  return (pathname) => {
    const p = normalizePath(pathname);
    return res.some((re) => re.test(p));
  };
}

interface CompiledSet {
  member: PathMatcher;
  signedIn: PathMatcher;
  public: PathMatcher;
  static: PathMatcher;
  noClerkApi: PathMatcher;
}

const compileSet = (s: RouteClassSet): CompiledSet => ({
  member: matcherFor(s.memberPages),
  signedIn: matcherFor(s.signedInPages),
  public: matcherFor(s.publicPages),
  static: matcherFor(s.staticPages ?? []),
  noClerkApi: matcherFor(s.noClerkApi),
});

const isApi = matcherFor(["/api(.*)", "/trpc(.*)"]);

/** Builds a classifier over phase sets (oldest first). Exported for tests; production code uses classify(). */
export function createClassifier(phases: readonly RouteClassSet[]): (pathname: string) => RouteClass {
  const newestFirst = phases.map(compileSet).reverse();
  return (pathname) => {
    if (SCANNER.test(pathname)) return "scanner";
    if (isApi(pathname)) return newestFirst.some((s) => s.noClerkApi(pathname)) ? "api_no_clerk" : "api";
    for (const s of newestFirst) {
      // Within one phase the stricter class wins an accidental overlap.
      if (s.member(pathname)) return "member";
      if (s.signedIn(pathname)) return "signed_in";
      if (s.static(pathname)) return "public_static";
      if (s.public(pathname)) return "public";
    }
    // Plan §7.6 step 5: every page that is not listed public needs a session.
    return "signed_in";
  };
}

/** The class middleware acts on for a request path (pathname only, no query). */
export const classify: (pathname: string) => RouteClass = createClassifier(PHASES);
