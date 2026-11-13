// Provider avatars (phase-04 plan D4-26; feasibility F-API-4). Chess.com avatar URLs are stored and sent on the wire,
// but nothing renders them until the owner's review of the Chess.com User Agreement (OD-2) clears in the P13
// preflight. `images.chesscomfiles.com` is deliberately NOT in next.config.js `images.remotePatterns` or the CSP
// `img-src`. Flipping this constant is the whole switch (plus those two allow-list lines). Lichess has no avatars.
export const PROVIDER_AVATARS_ENABLED = false;

/** The avatar URL a card may render, or null (initials) while avatars are off. */
export function renderableAvatarUrl(avatarUrl: string | null | undefined): string | null {
  return PROVIDER_AVATARS_ENABLED && avatarUrl ? avatarUrl : null;
}

/** Up to two initials for the avatar fallback: "knightowl_88" → "KN", "Magnus Carlsen" → "MC". */
export function accountInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return `${words[0]![0]}${words[1]![0]}`.toUpperCase();
  const w = words[0] ?? "";
  return w.slice(0, 2).toUpperCase() || "?";
}
