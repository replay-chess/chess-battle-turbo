// The name the onboarding frame greets the member with (phase-04 plan §8.13, inv-pub Q10). Pure.
//
// Chain: the Clerk username → the first linked account's username → the first word of users.name → the local part
// of the email → "there". users.name is "Anonymous User" when Clerk had no name and no username at provisioning
// (lib/webhooks/clerk-events.ts displayName), so that placeholder is skipped like an empty name.

export type DisplayNameInput = {
  /**
   * Clerk's `username`. The default session token does not carry it, so the server passes the `username` session
   * claim when the Clerk session-token template adds one, else null (no Backend API call per render).
   */
  clerkUsername?: string | null;
  /** Linked accounts in link order (oldest first). */
  linkedUsernames?: readonly string[];
  /** users.name */
  name?: string | null;
  /** users.email */
  email?: string | null;
};

/** users.name written when Clerk gave neither a name nor a username. */
export const PLACEHOLDER_NAME = "Anonymous User";

/** Longest greeting we render: the h1 must stay on one or two lines at 150 % zoom. */
export const DISPLAY_NAME_MAX = 40;

function clean(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  // Control characters and markup-ish brackets never reach the h1 (React escapes, this keeps it readable).
  let kept = "";
  for (const ch of value) {
    const code = ch.charCodeAt(0);
    if (code < 0x20 || code === 0x7f || ch === "<" || ch === ">") continue;
    kept += ch;
  }
  const trimmed = kept.trim();
  if (!trimmed) return null;
  return trimmed.length > DISPLAY_NAME_MAX ? trimmed.slice(0, DISPLAY_NAME_MAX) : trimmed;
}

export function displayName(input: DisplayNameInput): string {
  const clerk = clean(input.clerkUsername);
  if (clerk) return clerk;

  for (const u of input.linkedUsernames ?? []) {
    const linked = clean(u);
    if (linked) return linked;
  }

  const name = clean(input.name);
  if (name && name !== PLACEHOLDER_NAME) {
    const first = clean(name.split(/\s+/)[0]);
    if (first) return first;
  }

  const local = emailLocalName(input.email);
  if (local) return local;

  return "there";
}

/**
 * The local part of an email, without a "+tag" ("ana.lima+chess@x.io" → "ana.lima"), or null. A sub-address is how
 * the member files our mail, never a name to show (D5: "Welcome, p4pass.b8fdec7e+clerk_test.").
 */
export function emailLocalName(email: string | null | undefined): string | null {
  if (typeof email !== "string") return null;
  const at = email.lastIndexOf("@");
  if (at <= 0) return null;
  return clean(email.slice(0, at).split("+")[0]);
}

/** users.name unless it is empty or Clerk's placeholder ("Anonymous User"), else null. */
export function realName(name: string | null | undefined): string | null {
  const n = clean(name);
  return n && n !== PLACEHOLDER_NAME ? n : null;
}

/**
 * The member's full name for the account chrome (app shell, account menu, review "you"): users.name unless it is the
 * placeholder, else the §8.13 fallback without a +tag (D5: every fresh sign-up was "Anonymous User" in the shell).
 */
export function accountName(input: { name?: string | null; email?: string | null }): string {
  return realName(input.name) ?? emailLocalName(input.email) ?? "Member";
}

/** Up to two initials of a display name ("knightowl_88" → "KN", "Ana Lima" → "AL", "1984" → "19"). */
export function initialsOf(name: string): string {
  const all = name
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .split(/[\s_-]+/)
    .filter(Boolean);
  // "knightowl_88": the digits are a suffix, not a second name.
  const lettered = all.filter((w) => /\p{L}/u.test(w));
  const words = lettered.length ? lettered : all;
  if (words.length >= 2) return (words[0]![0]! + words[1]![0]!).toUpperCase();
  const one = words[0] ?? "";
  return one.slice(0, 2).toUpperCase() || "?";
}
