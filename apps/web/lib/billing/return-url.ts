/**
 * Pure helpers for the URL a checkout returns to. No environment or framework
 * access, so the checkout route stays thin and these rules can be unit tested.
 */

/**
 * Paths a checkout may return to. Anything else falls back to /pricing so the
 * return URL can never be turned into an open redirect.
 */
export const RETURN_PATH_PREFIXES: readonly string[] = [
  "/pricing",
  "/onboarding",
  "/play",
  "/queue",
  "/challenge",
  "/join",
  "/join-tournament",
  "/tournament",
  "/game",
  "/legends",
  "/openings",
  "/position",
  "/profile",
  // Phase 3 (phase-03 plan §3.2): the review, archive and practice pages send a lapsed or never-member viewer to
  // /pricing with redirect_url = the page. `/analysis` goes at H4, when the legacy pages are deleted.
  "/review",
  "/games",
  "/practice",
  "/analysis",
  // Phase 4 (phase-04 plan §3 return-url row): the activation page itself and the v3 destinations.
  "/checkout",
  "/settings",
  "/home",
  "/train",
  "/learn",
];

export const DEFAULT_RETURN_PATH = "/pricing";

/**
 * Origin the user should land on after paying: the origin of
 * DODO_PAYMENTS_RETURN_URL when it is a valid URL, otherwise `fallback`
 * (the canonical site).
 */
export function resolveAppOrigin(
  env: { DODO_PAYMENTS_RETURN_URL?: string },
  fallback: string,
): string {
  const configured = env.DODO_PAYMENTS_RETURN_URL;
  if (configured) {
    try {
      return new URL(configured).origin;
    } catch {
      // fall through to the canonical site
    }
  }
  return fallback;
}

/** True when `returnPath` is an app-relative path on the allowlist. */
export function isAllowedReturnPath(returnPath: string | undefined): returnPath is string {
  return (
    !!returnPath &&
    returnPath.startsWith("/") &&
    !returnPath.startsWith("//") &&
    RETURN_PATH_PREFIXES.some((prefix) => returnPath.startsWith(prefix))
  );
}

/**
 * Builds the absolute URL Dodo redirects to after checkout. Unsafe or missing
 * paths fall back to /pricing; the caller's query string is preserved and
 * `checkout=success` is appended so the landing page knows to confirm
 * activation.
 */
export function buildReturnUrl(returnPath: string | undefined, origin: string): string {
  const safePath = isAllowedReturnPath(returnPath) ? returnPath : DEFAULT_RETURN_PATH;
  const url = new URL(safePath, origin);
  url.searchParams.set("checkout", "success");
  return url.toString();
}

// ── Phase 4: the activation return (phase-04 plan 7.5.1 step 6, 8.5; D4-29) ──────────────────────────────────────

export type ActivationSource = "pricing" | "onboarding" | "paywall" | "renew";

/** Where every non-onboarding checkout (and onboarding while `onboarding-v3` is off) returns to. */
export const CHECKOUT_ACTIVATING_PATH = "/checkout/activating";
/** The onboarding step that confirms the trial (onboarding-v3 on). */
export const ONBOARDING_ACTIVATING_PATH = "/onboarding/activating";

/**
 * A same-site path a checkout may continue to, or null: app-relative, on the allow-list at a segment boundary
 * (`/play` and `/play/x`, never `/playground`), no backslash, no control character, no protocol-relative or encoded
 * tricks (the path is resolved against a sentinel origin and must stay on it). Returns path + query (+ hash).
 */
export function safeActivationPath(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const p = raw.trim();
  if (!p.startsWith("/") || p.startsWith("//") || p.includes("\\")) return null;
  if ([...p].some((ch) => ch.charCodeAt(0) < 0x20 || ch.charCodeAt(0) === 0x7f)) return null;
  let url: URL;
  try {
    url = new URL(p, "https://replay.invalid");
  } catch {
    return null;
  }
  if (url.origin !== "https://replay.invalid") return null;
  const path = url.pathname;
  if (path.includes("//") || /%2f|%5c/i.test(p.split("?")[0] ?? "")) return null;
  const allowed = RETURN_PATH_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
  return allowed ? `${path}${url.search}${url.hash}` : null;
}

/**
 * The destination carried by a return path that is itself an activation URL (`checkoutReturnPath()` builds
 * `/checkout/activating?redirect_url=…`), so a checkout never nests one activation page inside another.
 */
function unwrapActivation(path: string): string | null {
  const url = new URL(path, "https://replay.invalid");
  if (url.pathname !== CHECKOUT_ACTIVATING_PATH) return path;
  return safeActivationPath(url.searchParams.get("redirect_url"));
}

/**
 * Builds the absolute URL Dodo returns to (plan 7.5.1 step 6). Dodo appends `subscription_id`, `status` and `email`;
 * the server adds only what it can vouch for (`checkout`, `source`, `plan`, a checked `redirect_url`).
 *
 * - `onboarding` with onboarding-v3 on → `/onboarding/activating?checkout=success&plan=…`.
 * - every other source, and onboarding while the flag is off (the legacy page has no activation step of its own) →
 *   `/checkout/activating?checkout=success&source=…&plan=…&redirect_url=<safe path>`; the legacy onboarding page is
 *   its default destination. An unsafe or missing path is dropped (the page then continues to /games).
 */
export function buildActivationReturnUrl(
  source: ActivationSource,
  returnPath: string | null | undefined,
  origin: string,
  options: { onboardingV3: boolean; plan: "monthly" | "yearly" },
): string {
  if (source === "onboarding" && options.onboardingV3) {
    const url = new URL(ONBOARDING_ACTIVATING_PATH, origin);
    url.searchParams.set("checkout", "success");
    url.searchParams.set("plan", options.plan);
    return url.toString();
  }
  const safe = safeActivationPath(returnPath);
  const destination = (safe ? unwrapActivation(safe) : null) ?? (source === "onboarding" ? "/onboarding" : null);
  const url = new URL(CHECKOUT_ACTIVATING_PATH, origin);
  url.searchParams.set("checkout", "success");
  url.searchParams.set("source", source);
  url.searchParams.set("plan", options.plan);
  if (destination) url.searchParams.set("redirect_url", destination);
  return url.toString();
}

/**
 * Where /checkout/activating continues after success (plan 4.9): the checked `redirect_url`, never /checkout/* (no
 * loop); /onboarding while setup is not done; else /home (P5 plan §4.8: members land on Home).
 */
export function activationDestination(redirectUrl: string | null | undefined, onboarded: boolean): string {
  if (!onboarded) return "/onboarding";
  const safe = safeActivationPath(redirectUrl);
  return safe && !safe.startsWith("/checkout") ? safe : "/home";
}
