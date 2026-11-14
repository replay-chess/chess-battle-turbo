// `mistakes:added` (phase-05 plan §7.4, §5.5): the EXTRACT_MISTAKES backfill and re-extraction tell an open client that
// its bank grew. Only this path emits it (an analysis folds its bank values into `analysis:done` / `analysis:batch`).
// In memory, per user: the counters of every extraction since the user's last frame are summed, and a frame goes out
// at most once per MISTAKES_ADDED_MIN_GAP_MS (60 s): at once when the user's window has passed, else from one timer when
// it ends (a trailing flush), and every pending user at shutdown. A user whose extractions added no card gets no
// frame (`cardsAdded > 0`, §7.4). The socket drops a frame to an empty room early; the dedupe key is per user and
// minute (`mistakesAddedDedupeKey`), so a retried send is not shown twice.
import {
  MISTAKES_ADDED_MIN_GAP_MS,
  mistakesAddedDedupeKey,
  MistakesAddedEvent,
} from "@repo/contracts/socket/user";
import type { Logger } from "../obs/log";
import type { Clock, TimerHandle } from "../scheduler/clock";
import type { EmitSink } from "../socket/emit";

export interface MistakesDelta {
  /** Games extracted (1 per job). */
  games: number;
  /** Mistake rows inserted or seen again. */
  added: number;
  cardsAdded: number;
  /** The user's BANK cards after the extraction. */
  total: number;
  /** The user's capped due count after the extraction. */
  bankDue: number;
}

interface Pending {
  games: number;
  added: number;
  cardsAdded: number;
  total: number;
  bankDue: number;
}

export interface CoalescerOptions {
  emitter: EmitSink;
  clock: Clock;
  log: Logger;
  minGapMs?: number;
}

export class MistakesAddedCoalescer {
  private readonly pending = new Map<string, Pending>();
  private readonly lastSentAtMs = new Map<string, number>();
  private timer: TimerHandle | null = null;
  private chain: Promise<void> = Promise.resolve();
  private readonly gap: number;

  constructor(private readonly opts: CoalescerOptions) {
    this.gap = opts.minGapMs ?? MISTAKES_ADDED_MIN_GAP_MS;
  }

  get pendingUsers(): number {
    return this.pending.size;
  }

  /** One extraction's counters for a user; sends now when the user's window has passed, else at its end. */
  add(userRef: string, d: MistakesDelta): Promise<void> {
    const p = this.pending.get(userRef) ?? { games: 0, added: 0, cardsAdded: 0, total: 0, bankDue: 0 };
    p.games += d.games;
    p.added += d.added;
    p.cardsAdded += d.cardsAdded;
    p.total = d.total;
    p.bankDue = d.bankDue;
    this.pending.set(userRef, p);
    return this.flushDue();
  }

  /** Sends every user whose window has passed and re-arms the timer for the rest. */
  flushDue(): Promise<void> {
    return this.enqueue(() => this.flush(false));
  }

  /** Shutdown: every pending user now, then no timer. */
  flushAll(): Promise<void> {
    return this.enqueue(async () => {
      await this.flush(true);
      this.stop();
    });
  }

  stop(): void {
    this.opts.clock.clearTimeout(this.timer);
    this.timer = null;
  }

  private enqueue(work: () => Promise<void>): Promise<void> {
    this.chain = this.chain.then(work, work);
    return this.chain;
  }

  private async flush(all: boolean): Promise<void> {
    const now = this.opts.clock.now();
    for (const [ref, p] of [...this.pending]) {
      const last = this.lastSentAtMs.get(ref);
      if (!all && last !== undefined && now - last < this.gap) continue;
      this.pending.delete(ref);
      if (p.cardsAdded <= 0) continue;
      this.lastSentAtMs.set(ref, now);
      const data = MistakesAddedEvent.parse({
        v: 1,
        games: p.games,
        added: p.added,
        cardsAdded: p.cardsAdded,
        total: p.total,
        bankDue: p.bankDue,
      });
      await this.opts.emitter.emit("mistakes:added", data, [ref], { dedupeKey: mistakesAddedDedupeKey(ref, now) });
    }
    if (!all) this.arm(now);
  }

  /** One timer for the earliest window end among the users still pending. */
  private arm(now: number): void {
    this.opts.clock.clearTimeout(this.timer);
    this.timer = null;
    if (this.pending.size === 0) return;
    let next = Infinity;
    for (const ref of this.pending.keys()) {
      const last = this.lastSentAtMs.get(ref);
      next = Math.min(next, last === undefined ? now : last + this.gap);
    }
    this.timer = this.opts.clock.setTimeout(
      () => {
        this.timer = null;
        void this.flushDue().catch((error: unknown) => this.opts.log.warn("mistakes:added flush failed", { error }));
      },
      Math.max(0, next - now),
    );
  }
}
