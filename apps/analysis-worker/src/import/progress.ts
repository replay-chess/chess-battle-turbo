// The import's user-room events (phase-04 plan §7.6, §8.6 step 6; api-perf AP-10). Emits are best effort (the
// client heals through `GET /api/import/status`), go to the member's own room only, and are validated against the
// contract before they leave (a payload the socket would refuse fails here, in the worker's logs and tests).
//
// - `import:progress`: while reading, every IMPORT_PROGRESS_EVERY_GAMES (250) games or IMPORT_PROGRESS_EVERY_MS (2 s),
//   whichever comes first; while saving, after each chunk statement; never closer than IMPORT_PROGRESS_MIN_GAP_MS
//   (1 s). A frame that falls inside the gap is dropped, not delayed: there is no timer, so nothing outlives the job,
//   and the terminal `import:finished` / `import:failed` carries the final numbers. ETA-free.
// - `games:changed {v:1}` after a chunk added games, at most once per member per IMPORT_GAMES_CHANGED_MIN_GAP_MS
//   (10 s) across the whole process (both lane slots import for different accounts of the same member), and always
//   once at the end of a run that added games.
// - `import:finished` (dedupe key per run) and `import:failed` (per run and attempt).
import {
  IMPORT_GAMES_CHANGED_MIN_GAP_MS,
  IMPORT_PROGRESS_EVERY_GAMES,
  IMPORT_PROGRESS_EVERY_MS,
  IMPORT_PROGRESS_MIN_GAP_MS,
  ImportFailedEvent,
  ImportFinishedEvent,
  ImportProgressEvent,
  importFailedDedupeKey,
  importFinishedDedupeKey,
} from "@repo/contracts/socket/user";
import type { Logger } from "../obs/log";
import type { Clock } from "../scheduler/clock";
import { buildEvent } from "../socket/events";
import type { EmitSink } from "../socket/emit";

export type ProviderSlug = "chesscom" | "lichess";

export interface ProgressNumbers {
  seen: number;
  imported: number;
  total: number | null;
  analysed: number;
}

/** One key per member and millisecond: two sends in one second differ (their signatures too), a resend does not. */
export function gamesChangedDedupeKey(userRef: string, nowMs: number): string {
  return `games-changed:${userRef}:${Math.floor(nowMs)}`;
}

/** When each member last got `games:changed` from an import in this process. */
const gamesChangedAt = new Map<string, number>();

/** Forget the process-wide `games:changed` throttle (tests). */
export function resetGamesChangedThrottle(): void {
  gamesChangedAt.clear();
}

export class ImportEvents {
  private lastProgressAt = Number.NEGATIVE_INFINITY;
  private lastReadingSeen = 0;
  private lastReadingAt: number;
  private addedSinceChanged = false;

  constructor(
    private readonly opts: {
      emitter: EmitSink;
      clock: Clock;
      log: Logger;
      userRef: string;
      provider: ProviderSlug;
      /** null while a DAILY sync has not created its run yet (nothing is emitted then). */
      runRef: () => string | null;
    },
  ) {
    this.lastReadingAt = opts.clock.now();
  }

  /** Reading-phase cadence check: true when a frame (and the run's `seen` write) is due. */
  readingDue(seen: number): boolean {
    const now = this.opts.clock.now();
    return seen - this.lastReadingSeen >= IMPORT_PROGRESS_EVERY_GAMES || now - this.lastReadingAt >= IMPORT_PROGRESS_EVERY_MS;
  }

  async reading(n: ProgressNumbers): Promise<void> {
    this.lastReadingSeen = n.seen;
    this.lastReadingAt = this.opts.clock.now();
    await this.progress("reading", n);
  }

  async saving(n: ProgressNumbers): Promise<void> {
    await this.progress("saving", n);
  }

  private async progress(phase: "reading" | "saving", n: ProgressNumbers): Promise<void> {
    const runRef = this.opts.runRef();
    if (!runRef) return;
    const now = this.opts.clock.now();
    if (now - this.lastProgressAt < IMPORT_PROGRESS_MIN_GAP_MS) return;
    this.lastProgressAt = now;
    const data = ImportProgressEvent.parse({
      v: 1,
      runRef,
      provider: this.opts.provider,
      phase,
      seen: n.seen,
      imported: n.imported,
      total: n.total,
      analysed: n.analysed,
    });
    await this.opts.emitter.emit("import:progress", data, [this.opts.userRef]);
  }

  /** A chunk added `newRows` games: `games:changed` unless the member got one in the last 10 s. */
  async added(newRows: number): Promise<void> {
    if (newRows <= 0) return;
    this.addedSinceChanged = true;
    const now = this.opts.clock.now();
    const last = gamesChangedAt.get(this.opts.userRef);
    if (last !== undefined && now - last < IMPORT_GAMES_CHANGED_MIN_GAP_MS) return;
    await this.gamesChanged(now);
  }

  /** The end of a run: one last `games:changed` if games were added since the last one. */
  async flushGamesChanged(): Promise<void> {
    if (this.addedSinceChanged) await this.gamesChanged(this.opts.clock.now());
  }

  private async gamesChanged(now: number): Promise<void> {
    gamesChangedAt.set(this.opts.userRef, now);
    this.addedSinceChanged = false;
    // The body `{v:1}` is the same every time: without a per-send key, the run's last `games:changed` in the same
    // second as a chunk's carried the same HMAC signature and the socket refused it as a replay (401, INTEGRATE-2).
    await this.opts.emitter.emit("games:changed", buildEvent("games:changed", {}), [this.opts.userRef], {
      dedupeKey: gamesChangedDedupeKey(this.opts.userRef, now),
    });
  }

  async finished(data: Omit<ImportFinishedEvent, "v" | "runRef" | "provider">, runRef: string): Promise<void> {
    const payload = ImportFinishedEvent.parse({ v: 1, runRef, provider: this.opts.provider, ...data });
    await this.opts.emitter.emit("import:finished", payload, [this.opts.userRef], {
      dedupeKey: importFinishedDedupeKey(runRef),
    });
  }

  async failed(data: Omit<ImportFailedEvent, "v" | "runRef" | "provider">, runRef: string, attempt: number): Promise<void> {
    const payload = ImportFailedEvent.parse({ v: 1, runRef, provider: this.opts.provider, ...data });
    await this.opts.emitter.emit("import:failed", payload, [this.opts.userRef], {
      dedupeKey: importFailedDedupeKey(runRef, attempt),
    });
  }
}
