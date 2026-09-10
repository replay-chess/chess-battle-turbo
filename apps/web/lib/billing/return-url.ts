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
  "/legends",
  "/openings",
  "/position",
  "/profile",
  "/analysis",
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
