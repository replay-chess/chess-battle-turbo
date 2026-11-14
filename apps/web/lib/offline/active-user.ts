// The signed-in member the offline stores belong to right now (phase-05 plan §5.4, §11 "per user"; FIX-1). Tiny on
// purpose: the (app) layout's useOutboxSync sets it on every route (no IndexedDB code), the outbox sender reads it
// before any flush, and sign-out reads it to know whose stores to clear.
//   undefined = not known yet (before the layout mounted: nothing is blocked)
//   null      = signed out (no queue may be sent: a cookie of nobody, or of the next person)
//   string    = that member's ref (another member's queue waits, untouched, for their next sign-in)
let current: string | null | undefined;

export function setOutboxUser(userRef: string | null): void {
  current = userRef;
}

export function outboxUser(): string | null | undefined {
  return current;
}

/** True when `userRef`'s queue may be sent with the browser's current session. */
export function mayFlushFor(userRef: string): boolean {
  return current === undefined || current === userRef;
}

/** Tests only. */
export function resetOutboxUser(): void {
  current = undefined;
}
