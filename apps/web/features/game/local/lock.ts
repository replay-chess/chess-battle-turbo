// Two-tab lock for a bot game (phase-02 plan 5.3.2): `BroadcastChannel("rc-game-<ref>")`. The newest tab takes the
// lock; the other tab stops its engine and clocks and shows "This game is open in another tab · Use this tab".
// "Use this tab" claims again (it is then the newest). Ties break on the tab id, so two tabs that open at the same
// moment agree on one owner. Without BroadcastChannel every tab owns its game (the journal is last-writer-wins).

export interface LockMessage {
  t: "claim" | "release";
  id: string;
  at: number;
}

export interface ChannelLike {
  postMessage(m: LockMessage): void;
  close(): void;
  onmessage: ((e: { data: unknown }) => void) | null;
}

export interface TabLock {
  readonly id: string;
  held(): boolean;
  /** Takes the lock (newest wins). */
  claim(): void;
  close(): void;
}

export interface TabLockDeps {
  channel(name: string): ChannelLike | null;
  now(): number;
  id(): string;
}

const browserDeps: TabLockDeps = {
  channel(name) {
    try {
      if (typeof BroadcastChannel === "undefined") return null;
      return new BroadcastChannel(name) as unknown as ChannelLike;
    } catch {
      return null;
    }
  },
  now: () => Date.now(),
  id: () => {
    try {
      return crypto.randomUUID();
    } catch {
      return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    }
  },
};

export function lockChannelName(ref: string): string {
  return `rc-game-${ref}`;
}

/** True when claim `a` is newer than claim `b` (later time, then the larger id). */
export function newerClaim(a: { at: number; id: string }, b: { at: number; id: string }): boolean {
  return a.at !== b.at ? a.at > b.at : a.id > b.id;
}

export function createTabLock(ref: string, events: { onLost(): void }, deps: TabLockDeps = browserDeps): TabLock {
  const id = deps.id();
  const channel = deps.channel(lockChannelName(ref));
  let mine: { at: number; id: string } | null = null;
  let held = false;
  /** The newest claim time seen from any tab (a re-claim must beat it). */
  let seen = 0;

  if (channel) {
    channel.onmessage = (e) => {
      const m = e.data as Partial<LockMessage> | null;
      if (!m || m.t !== "claim" || typeof m.id !== "string" || typeof m.at !== "number" || m.id === id) return;
      seen = Math.max(seen, m.at);
      if (!held || !mine) return;
      if (newerClaim({ at: m.at, id: m.id }, mine)) {
        held = false;
        events.onLost();
      }
    };
  }

  return {
    id,
    held: () => held,
    claim() {
      // Strictly newer than any claim this tab has seen or made.
      const at = Math.max(deps.now(), (mine?.at ?? 0) + 1, seen + 1);
      mine = { at, id };
      held = true;
      try {
        channel?.postMessage({ t: "claim", id, at });
      } catch {
        // channel closed
      }
    },
    close() {
      try {
        if (held) channel?.postMessage({ t: "release", id, at: deps.now() });
        channel?.close();
      } catch {
        // already closed
      }
      held = false;
      if (channel) channel.onmessage = null;
    },
  };
}
