/**
 * The origin written into a PGN's `Site` tag (`<origin>/game/<ref>`): the origin of NEXT_PUBLIC_SITE_URL, the
 * deployment's configured site (the dev project sets its .vercel.app URL; production sets the canonical domain).
 * Undefined when it is unset or not an http(s) URL, so @repo/game-core's buildPgn falls back to the canonical site.
 * The socket passes its WEB_APP_URL the same way (apps/web-socket/src/boot.ts).
 */
export function pgnSiteOrigin(siteUrl: string | undefined = process.env.NEXT_PUBLIC_SITE_URL): string | undefined {
  const configured = siteUrl?.trim();
  if (!configured) return undefined;
  try {
    const url = new URL(configured);
    return url.protocol === "https:" || url.protocol === "http:" ? url.origin : undefined;
  } catch {
    return undefined;
  }
}
