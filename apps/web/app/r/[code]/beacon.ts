// `share_page_viewed` from the public page's island (phase-03 plan §10.1; registry `@repo/analytics` reviewServerEvents):
// the referrer's bare host (or "none") and whether a Clerk session cookie is present. Never the URL, path, query or
// any name. Pure, so the rules are unit-tested.

/** The registry's host pattern: lowercase labels with at least one dot (no port, no IP literal with a port). */
const HOST_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

/** The referrer's host without "www.", or "none" (no referrer, unparsable, a port or anything the registry rejects). */
export function referrerDomain(referrer: string): string {
  if (!referrer) return "none";
  let host: string;
  try {
    const url = new URL(referrer);
    if (url.port) return "none";
    host = url.hostname.toLowerCase();
  } catch {
    return "none";
  }
  const bare = host.startsWith("www.") ? host.slice(4) : host;
  return bare.length <= 80 && HOST_RE.test(bare) ? bare : "none";
}

/** Clerk's `__client_uat` cookie is non-zero while a session exists (readable by script; no request needed). */
export function hasSessionCookie(cookie: string): boolean {
  for (const part of cookie.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === "__client_uat" || (name?.startsWith("__client_uat_") ?? false)) {
      const value = rest.join("=").trim();
      if (value !== "" && value !== "0") return true;
    }
  }
  return false;
}

export function beaconProps(referrer: string, cookie: string): { referrer_domain: string; signed_in: boolean } {
  return { referrer_domain: referrerDomain(referrer), signed_in: hasSessionCookie(cookie) };
}
