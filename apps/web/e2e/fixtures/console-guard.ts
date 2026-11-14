// Console, hydration and failed-request guard (phase-01 plan §12.0, CT X7).
//
// Fails a test on:
// - an uncaught page error (`pageerror`);
// - `console.error`, and any console message that reports a hydration mismatch;
// - any /api/* response with status >= 500 that the spec did not inject with
//   the `x-rc-fault` header.
//
// It wraps the built-in `context` fixture, so every test that uses `page` or
// `context` is covered; tests that only use `request` launch no browser.
// Contexts a fixture opens itself (`browser.newContext()`) are covered by
// calling `guardContext(context, testInfo)` on them.
//
// Options (set in playwright.config.ts `use`, or per spec with test.use):
//   consoleGuard: "enforce" | "report" | "off"     default "enforce"
//   allowConsole: RegExp[]                          known noise, e.g. [/ResizeObserver loop/]
// Legacy specs listed in e2e/console-baseline.json only report (the list may
// only shrink); every other spec is enforced.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test as base, type BrowserContext, type TestInfo } from "@playwright/test";

export type ConsoleGuardMode = "enforce" | "report" | "off";
export type ConsoleGuardOptions = { consoleGuard: ConsoleGuardMode; allowConsole: RegExp[] };

export const HYDRATION = /Hydration failed|did not match|Text content does not match|hydrat(ion|ing) (error|mismatch)/i;

/**
 * Chrome logs "Failed to load resource: …" for every 4xx/5xx (including
 * injected faults and ordinary 401s) and for third-party network failures
 * (DNS, CORP). Network outcomes are judged by the response rule instead, so
 * these console lines are not problems.
 */
const RESOURCE_STATUS = /^Failed to load resource: /;

/**
 * WebKit's wording for the same network outcomes, plus its headless media-control noise (CI runs the
 * `webkit-iphone` smoke project):
 * - a third-party resource blocked by its own CORP or CORS headers (a directory badge on the marketing
 *   footer: "Cancelled load to https://… because it violates the resource's Cross-Origin-Resource-Policy",
 *   "Cannot load image https://… due to access control checks");
 * - an RSC prefetch aborted by the next navigation ("Failed to fetch RSC payload for … TypeError: Load
 *   failed", Chrome's net::ERR_ABORTED); an RSC 5xx does not reject the fetch, so it never logs this;
 * - "Button failed to load, iconName = …-placard": WebKit's built-in video controls in a headless run.
 * Only other origins' resources are excused; a blocked same-origin load still fails the test.
 */
const WEBKIT_NETWORK_NOISE = [
  /^Cancelled load to https?:\/\/(?!localhost[:/]|127\.0\.0\.1[:/])\S+ because it violates the resource's Cross-Origin-Resource-Policy/,
  /^Cannot load image https?:\/\/(?!localhost[:/]|127\.0\.0\.1[:/])\S+ due to access control checks/,
  /^Failed to fetch RSC payload for \S+\. Falling back to browser navigation\. TypeError: Load failed$/,
  /^Button failed to load, iconName = [\w-]+-placard, /,
];

/**
 * Clerk loads its UI (UserButton, SignIn, …) as lazy chunks from its own CDN on the Frontend API host. When a
 * spec navigates while such a chunk is still loading, the browser aborts it and Clerk's loader logs and throws
 * "ChunkLoadError: Loading chunk N failed. (error: https://<instance>.clerk.accounts.dev/npm/@clerk/…)". WebKit
 * reports the abort this way; Chrome cancels silently. Only Clerk's CDN chunks are excused: a chunk of our own
 * (`/_next/static/…`) that fails to load still fails the test.
 */
export const CLERK_CHUNK_ABORT =
  /^(?:ChunkLoadError: )?Loading chunk [\w-]+ failed\.\s*\(error: https:\/\/(?:[a-z0-9-]+\.clerk\.accounts\.dev|clerk\.[a-z0-9.-]+)\/npm\/@clerk\//;

/**
 * Clerk's bot protection (development instance) probes `<id>.client.protect.clerk.com` on several ports; WebKit
 * blocks the cross-origin probes and reports each as an unhandled "… /probe due to access control checks." page error.
 * Third-party noise only: the host, the `ins_` path and the `/probe` suffix must all match.
 * regression: REGRESSION-2 (webkit-iphone @smoke: telemetry.spec failed on 5 such errors with nothing wrong in the app).
 */
export const CLERK_PROTECT_PROBE =
  /(?:^|\/)[a-z0-9-]+\.client\.protect\.clerk\.com(?::\d+)?\/ins_\w+\/(?:c\/[\w-]+\/)?probe due to access control checks\.?$/;

/**
 * Clerk runs its session timers in a Web Worker made from a `blob:` URL (`createWorkerTimers()` in @clerk/shared,
 * worker name "clerk-timers"; clerk-js creates it on load and again, lazily, from setTimeout/clearTimeout after a
 * cleanup). When that happens on a document that is being left (between `beforeunload` and the next commit), WebKit
 * refuses the worker's load and logs "Cannot load blob:http://<app>/<uuid> due to access control checks." as a
 * JavaScript error, which Playwright reports as a page error ("…/<uuid> due to access control checks."). The app
 * itself creates no blob: worker (the engine is a same-origin file, Sentry Replay is off without a DSN); the timers
 * of a page being left are moot. Only a bare UUID path on the page's own origin is excused: a refused load of any
 * real URL (`/sw.js`, `/api/…`) still fails the test.
 * regression: local WebKit run on /play ("ttp://localhost:3500/7974ae8f-… due to access control checks.", 2026-11-12).
 */
export const CLERK_TIMER_BLOB =
  /(?:^|\/)(?:localhost|127\.0\.0\.1)(?::\d+)?\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12} due to access control checks\.?$/;

/**
 * clerk-js's own loads cancelled by a full-page navigation (the Lichess OAuth round trip leaves /settings/connected
 * while Clerk polls): WebKit rejects the in-flight FAPI fetches and the token poller's blob worker ("Fetch API cannot
 * load https://<instance>.clerk.accounts.dev/v1/client… due to access control checks.", "Cannot load
 * blob:http://localhost:3800/<uuid> due to access control checks.") and clerk-js leaves them unhandled. Excused only
 * when the error's first stack frame is clerk-js itself on Clerk's CDN; the same message from our code still fails.
 * The blob case is also matched by CLERK_TIMER_BLOB (any page being left); this rule adds the cancelled FAPI fetches
 * to Clerk's own host, which CLERK_TIMER_BLOB (page origin only) does not cover.
 * regression: p04-webkit-clerk-abort (webkit-iphone accounts/connected.spec.ts @smoke).
 */
const CLERK_JS_FRAME = /^\s*at .*\(https:\/\/(?:[a-z0-9-]+\.clerk\.accounts\.dev|clerk\.playchess\.tech)\/npm\/@clerk\/clerk-js@[\w.-]+\/dist\/[\w.-]+\.js:\d+:\d+\)$/;
export function isClerkJsAbort(message: string, stack: string | undefined): boolean {
  if (!/ due to access control checks\.?$/.test(message) || !stack) return false;
  const firstFrame = stack.split("\n").find((line) => /^\s*at /.test(line));
  return firstFrame !== undefined && CLERK_JS_FRAME.test(firstFrame);
}

/**
 * The App Router's own RSC fetches (`?_rsc=<id>`: a prefetch, or a soft navigation's payload) on the page's origin,
 * cut by a full-page navigation that leaves the page: WebKit reports each as an uncaught "…/<path>?_rsc=<id> due to
 * access control checks." page error (CI 43430795552, webkit-iphone onboarding/lichess deny: Welcome's prefetch of
 * Link still in flight when "Connect Lichess" left for Lichess). The page that asked is gone, so nothing reads the
 * answer; Next never shows it. Only a same-origin path with an `_rsc` query is excused: /api/…, /sw.js and every other
 * origin still fail the test (regression: webkit-rsc-abort). The same cut on a page being left for an in-app
 * navigation: a nav-link prefetch (regression: webkit-rsc-prefetch-abort, REGRESSION-5: webkit-iphone review-walkthrough
 * `?m=2`, "…/games?_rsc=z6fkr due to access control checks.").
 */
export const NEXT_RSC_ABORT =
  /(?:^|\/)(?:localhost|127\.0\.0\.1)(?::\d+)?\/(?!api\/)[^\s?]*\?(?:[^\s]*&)?_rsc=[\w-]+(?:&[^\s]*)? due to access control checks\.?$/;

const WEB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const BASELINE_FILE = path.join(WEB_DIR, "e2e/console-baseline.json");

type Baseline = { specs: string[] };

let baselineCache: Set<string> | null = null;
export function consoleBaseline(): Set<string> {
  if (!baselineCache) {
    try {
      const data = JSON.parse(readFileSync(BASELINE_FILE, "utf8")) as Baseline;
      baselineCache = new Set(data.specs);
    } catch {
      baselineCache = new Set();
    }
  }
  return baselineCache;
}

export type ConsoleProblem = { kind: "pageerror" | "console" | "hydration" | "api5xx"; text: string; url?: string };

/** Pure decision for one console message; exported for unit tests. */
export function classifyConsole(type: string, text: string, allow: RegExp[]): ConsoleProblem | null {
  if (allow.some((r) => r.test(text)) || RESOURCE_STATUS.test(text)) return null;
  if (WEBKIT_NETWORK_NOISE.some((r) => r.test(text))) return null;
  if (CLERK_CHUNK_ABORT.test(text) || CLERK_PROTECT_PROBE.test(text) || CLERK_TIMER_BLOB.test(text) || NEXT_RSC_ABORT.test(text)) return null;
  if (HYDRATION.test(text)) return { kind: "hydration", text };
  if (type === "error") return { kind: "console", text };
  return null;
}

/**
 * Pure decision for one response: an /api/* or page response >= 500 not injected with x-rc-fault. Only the app's own
 * responses count: with `pageUrl` (the frame's URL) given, another origin's 5xx (a third-party badge whose path
 * happens to start with /api/, e.g. domainrank.app/api/badge/… in the marketing footer) is not ours to fail on.
 */
export function classifyResponse(
  url: string,
  status: number,
  requestHeaders: Record<string, string>,
  resourceType = "fetch",
  pageUrl?: string,
): ConsoleProblem | null {
  if (status < 500) return null;
  let pathname: string;
  try {
    const u = new URL(url);
    pathname = u.pathname;
    if (pageUrl && /^https?:/.test(pageUrl) && new URL(pageUrl).origin !== u.origin) return null;
  } catch {
    return null;
  }
  if (!pathname.startsWith("/api/") && resourceType !== "document") return null;
  if (requestHeaders["x-rc-fault"]) return null; // injected by the spec
  return { kind: "api5xx", text: `${status} ${pathname}`, url };
}

const problemsByContext = new WeakMap<BrowserContext, ConsoleProblem[]>();

/** Attaches the guard's listeners to a context; returns the list it fills. */
export function guardContext(context: BrowserContext, allow: RegExp[] = []): ConsoleProblem[] {
  const existing = problemsByContext.get(context);
  if (existing) return existing;
  const problems: ConsoleProblem[] = [];
  problemsByContext.set(context, problems);
  context.on("weberror", (err) => {
    const text = err.error().message;
    if (isClerkJsAbort(text, err.error().stack)) return;
    if (
      !allow.some((r) => r.test(text)) &&
      !CLERK_CHUNK_ABORT.test(text) &&
      !CLERK_PROTECT_PROBE.test(text) &&
      !CLERK_TIMER_BLOB.test(text) &&
      !NEXT_RSC_ABORT.test(text)
    )
      problems.push({ kind: "pageerror", text, url: err.page()?.url() });
  });
  context.on("console", (msg) => {
    const problem = classifyConsole(msg.type(), msg.text(), allow);
    if (problem) problems.push({ ...problem, url: msg.page()?.url() });
  });
  context.on("response", (res) => {
    let pageUrl: string | undefined;
    try {
      pageUrl = res.frame().url();
    } catch {
      pageUrl = undefined; // a service worker's own request has no frame
    }
    const problem = classifyResponse(res.url(), res.status(), res.request().headers(), res.request().resourceType(), pageUrl);
    if (problem) problems.push(problem);
  });
  return problems;
}

function specPath(testInfo: TestInfo): string {
  return path.relative(WEB_DIR, testInfo.file).split(path.sep).join("/");
}

/** Reports (and, when enforced, fails on) the problems collected for a test. */
export async function finishGuard(problems: ConsoleProblem[], testInfo: TestInfo, mode: ConsoleGuardMode) {
  if (mode === "off" || problems.length === 0) return;
  const summary = problems.map((p) => `[${p.kind}] ${p.text}${p.url ? ` (${p.url})` : ""}`).join("\n");
  await testInfo.attach("console-guard", { body: summary, contentType: "text/plain" });
  const reportOnly = mode === "report" || consoleBaseline().has(specPath(testInfo));
  if (reportOnly) {
    testInfo.annotations.push({ type: "console-guard", description: `${problems.length} problem(s), report only` });
    return;
  }
  // Only fail a test that otherwise passed; never mask the original failure.
  if (testInfo.status === "passed" || testInfo.status === undefined) {
    throw new Error(`console guard: ${problems.length} problem(s)\n${summary}`);
  }
}

export const test = base.extend<ConsoleGuardOptions>({
  consoleGuard: ["enforce", { option: true }],
  allowConsole: [[], { option: true }],
  context: async ({ context, consoleGuard, allowConsole }, provide, testInfo) => {
    const problems = consoleGuard === "off" ? [] : guardContext(context, allowConsole);
    await provide(context);
    await finishGuard(problems, testInfo, consoleGuard);
  },
});

export { expect } from "@playwright/test";
