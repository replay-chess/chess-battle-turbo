// One timer per game (phase-02 plan 7.7, 8.4; socket F-14): the earliest of study end, first-move deadline, flag,
// reconnect grace, rematch expiry and restore resume, as computed by game-core (`ServerGame.timer`, `nextTimer`).
// It replaces v1's 100 ms clock interval and the 1 Hz broadcasts. The reducer re-checks every guard when the timer
// fires, so an early or stale fire is harmless; `sync` re-arms from the state after every input, so a fire that
// found nothing due (clock skew of a millisecond) is armed again instead of being lost.

/** Node's setTimeout ceiling (≈ 24.8 days); longer deadlines are re-armed when the first fire finds nothing due. */
const MAX_DELAY_MS = 2_147_483_647;

export interface Deadline {
  at: number;
  kind: string;
}

export class GameTimer {
  private handle: ReturnType<typeof setTimeout> | null = null;
  private armed: Deadline | null = null;

  /**
   * @param slackMs added to every delay, so the reducer's `now >= deadline` holds when the timer fires (the flag
   *   deadline already carries FLAG_TIMER_SLACK_MS from game-core).
   */
  constructor(
    private readonly now: () => number,
    private readonly onFire: (deadline: Deadline) => void,
    private readonly slackMs = 2,
  ) {}

  /** Arms for `deadline` (or clears for null). A no-op when the same deadline is already armed. */
  sync(deadline: Deadline | null): void {
    if (!deadline) return this.clear();
    if (this.handle && this.armed && this.armed.at === deadline.at && this.armed.kind === deadline.kind) return;
    this.clear();
    const delay = Math.min(MAX_DELAY_MS, Math.max(0, deadline.at - this.now() + this.slackMs));
    this.armed = { at: deadline.at, kind: deadline.kind };
    this.handle = setTimeout(() => {
      const fired = this.armed;
      this.handle = null;
      this.armed = null;
      if (fired) this.onFire(fired);
    }, delay);
  }

  clear(): void {
    if (this.handle) clearTimeout(this.handle);
    this.handle = null;
    this.armed = null;
  }

  /** The armed deadline (tests and metrics). */
  get pending(): Deadline | null {
    return this.armed;
  }
}
