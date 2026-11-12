// One live game in memory (phase-02 plan 8.1, 7.6): the game-core `ServerGame` plus the I/O around `reduce()`.
// Every input (a command, an attach/detach, the timer) goes through `dispatch`, which
//   1. runs the pure reducer with the server clock and the timing profile,
//   2. sends the returned events to `game:{ref}` / `spectate:{ref}` (spectators get moves one ply late: the reducer
//      already routed and delayed them),
//   3. runs the effects (journal, checkpoint, finish, abort, rematch creation, telemetry) through the ports,
//   4. re-arms the single per-game timer from the new state.
// Nothing in the move path waits on I/O (plan 9.1): persistence is fire-and-forget behind LivePersistence.
import {
  projectState,
  reduce,
  type AbortedBy,
  type Ack,
  type Effect,
  type GameResult,
  type GameState,
  type MachineInput,
  type ReduceResult,
  type ServerGame,
  type Side,
  type Viewer,
} from "@repo/game-core";
import { ROOM } from "@repo/contracts/socket/rooms";
import { ANALYSIS_MIN_PLIES } from "@repo/contracts/internal/jobs";
import type { FinishAnalysis } from "@repo/db/live";
import type { Timing } from "../config/timing";
import type { FinishOutcome, LivePersistence, Logger, Metrics, Telemetry } from "../ports";
import { SpectatorCounter } from "./spectators";
import { GameTimer } from "./timers";

/** Database identity of a session (what the persistence adapter needs; never sent to clients). */
export interface SessionIds {
  /** games.id; null only for in-memory test sessions. */
  dbId: bigint | null;
  /** users.id of each seat (null = nobody joined yet). */
  userIds: { w: bigint | null; b: bigint | null };
  /** Legacy arena: `tournament_game_ended` after the finish commits (plan 6.6.4). */
  tournament: { ref: string; name: string } | null;
}

export interface SessionDeps {
  /** `io.to(room).emit(event, payload)`. */
  emit(room: string, event: string, payload: unknown): void;
  now(): number;
  timing: Timing;
  persistence: LivePersistence;
  telemetry: Telemetry;
  metrics: Metrics;
  log: Logger;
  appEnv: string;
  /** After the finish committed (tournament lobby refresh). */
  onFinished?(session: LiveSession, result: GameResult): void;
  /** A rematch game exists (the registry remembers the parent for the child's GameState.rematchOf). */
  onRematchCreated?(session: LiveSession, newRef: string): void;
}

type AckAny = Ack<Record<string, unknown>>;

export class LiveSession {
  private _state: ServerGame;
  readonly spectators: SpectatorCounter;
  private readonly timer: GameTimer;
  private rematchWaiters: ((ack: AckAny) => void)[] = [];
  private prewarmed = false;
  private destroyed = false;
  /** Resolves when the finish/abort statement settled (createRematch waits for it: the parent must be COMPLETED). */
  private ending: Promise<FinishOutcome> | null = null;
  /** True while a finish/abort statement of this process has not settled (the DB row may still be IN_PROGRESS). */
  private endingPending = false;
  /** The session was built from a row that had already ended (DB load), so its end is committed already. */
  private readonly endedOnLoad: boolean;
  lastActivityAt: number;
  /** Server time the game ended (eviction clock). */
  endedAt: number | null;

  constructor(
    state: ServerGame,
    readonly ids: SessionIds,
    private readonly deps: SessionDeps,
  ) {
    this._state = state;
    this.lastActivityAt = deps.now();
    this.endedAt = state.phase === "ended" ? (state.result?.endedAt ?? deps.now()) : null;
    this.endedOnLoad = state.phase === "ended";
    this.timer = new GameTimer(deps.now, () => this.onTimer());
    this.spectators = new SpectatorCounter(deps.timing.spectatorsUpdateMinMs, deps.now, (count) => {
      this.deps.emit(ROOM.game(this.ref), "spectators:update", { ref: this.ref, count });
      this.deps.emit(ROOM.spectate(this.ref), "spectators:update", { ref: this.ref, count });
    });
    this.timer.sync(state.timer ?? null);
  }

  get ref(): string {
    return this._state.ref;
  }

  get state(): ServerGame {
    return this._state;
  }

  get phase(): ServerGame["phase"] {
    return this._state.phase;
  }

  get isDestroyed(): boolean {
    return this.destroyed;
  }

  /** The seat a user holds, from the server's own record (plan 11.2 rule 2: nobody claims a role). */
  sideOf(userRef: string): Side | null {
    const { w, b } = this._state.seats;
    if (w.ref === userRef) return "w";
    if (b.ref === userRef) return "b";
    return null;
  }

  /** Sockets of a side currently attached (presence). */
  online(side: Side): boolean {
    return this._state.presence[side].sockets.length > 0;
  }

  hasPlayerSockets(): boolean {
    return this.online("w") || this.online("b");
  }

  /** The join/sync/spectate ack state for one viewer. */
  project(viewer: Viewer): GameState {
    return projectState(this._state, viewer, this.deps.now());
  }

  /** A friend joined through the web after this session was loaded: adopt the seats of the fresh DB row. */
  updateSeats(seats: ServerGame["seats"], userIds: SessionIds["userIds"]): void {
    this._state = { ...this._state, seats };
    this.ids.userIds = userIds;
  }

  /** Feeds one input through the reducer and performs everything it asks for. */
  dispatch(input: MachineInput): ReduceResult {
    const now = this.deps.now();
    const wasEnded = this._state.phase === "ended";
    const r = reduce(this._state, input, now, this.deps.timing.machine);
    this._state = r.state;
    this.lastActivityAt = now;
    if (!wasEnded && r.state.phase === "ended") this.endedAt = now;
    for (const { room, event } of r.events) {
      this.deps.emit(room === "game" ? ROOM.game(this.ref) : ROOM.spectate(this.ref), event.name, event.payload);
    }
    for (const effect of r.effects) this.runEffect(effect);
    if (!this.destroyed) this.timer.sync(this._state.timer);
    return r;
  }

  /**
   * A command with an ack. `rematchAccept` (and a crossing `rematchOffer`) ack only after the rematch game exists
   * (game-core: the ack comes from the later `rematchCreated` / `rematchFailed` input).
   */
  command(input: MachineInput): Promise<AckAny> {
    const r = this.dispatch(input);
    if (r.ack) return Promise.resolve(r.ack);
    if (r.effects.some((e) => e.type === "createRematch")) {
      return new Promise((resolve) => this.rematchWaiters.push(resolve));
    }
    return Promise.resolve({ ok: false, code: "internal" });
  }

  private onTimer(): void {
    if (this.destroyed) return;
    try {
      this.dispatch({ type: "timer" });
    } catch (error) {
      this.deps.log.error("timer dispatch failed", { game: this.ref }, error);
    }
  }

  private trackProps(): Record<string, string> {
    return { app_env: this.deps.appEnv, mode: this._state.mode.toLowerCase(), time_class: this._state.timeClass };
  }

  private runEffect(effect: Effect): void {
    const { persistence, metrics, log } = this.deps;
    switch (effect.type) {
      case "journal":
        persistence.journal(this, effect.line);
        return;
      case "checkpoint":
        if (
          !this.prewarmed &&
          persistence.prewarm &&
          (this._state.phase === "first_move" || this._state.phase === "playing")
        ) {
          // Plan 6.7 rule 4: the game left waiting/study, so the first checkpoint should not also pay a Neon wake.
          this.prewarmed = true;
          persistence.prewarm();
        }
        persistence.checkpoint(this, effect.reason);
        return;
      case "finish": {
        metrics.count("ws.game.end", { method: effect.result.method, mode: this._state.mode });
        if (effect.result.method === "abandoned") metrics.count("ws.abandon");
        this.trackEnding(persistence.finish(this, effect.result).then(
          (outcome) => {
            if (outcome.committed && !this.destroyed) this.emitResult(outcome.analysis?.review);
            if (outcome.committed) this.deps.onFinished?.(this, effect.result);
            return outcome;
          },
          (error: unknown) => {
            log.error("finish failed", { game: this.ref }, error);
            return { committed: false };
          },
        ));
        return;
      }
      case "abortPersist":
        metrics.count("ws.abort", { reason: abortReason(effect.abortedBy) });
        this.trackEnding(
          persistence.abort(this, effect.result, effect.abortedBy).catch((error: unknown) => {
            log.error("abort failed", { game: this.ref }, error);
            return { committed: false };
          }),
        );
        return;
      case "createRematch":
        void this.createRematch(effect.offeredBy, effect.acceptedBy);
        return;
      case "track":
        if (effect.userRef) {
          this.deps.telemetry.capture(effect.event, effect.userRef, { ...this.trackProps(), ...effect.props });
        }
        return;
      case "armTimer":
      case "clearTimer":
        return; // the timer is re-synced from the state after every dispatch
    }
  }

  /**
   * Records a finish/abort statement of this session (the reducer's effect, or the boot restore finishing a game the
   * journal had ended). Until it settles the session must stay in memory: evicting it would let the next join rebuild
   * a live game from the still-IN_PROGRESS row (FIX-A, evict race).
   */
  trackEnding(statement: Promise<FinishOutcome>): Promise<FinishOutcome> {
    this.endingPending = true;
    const tracked = statement.then(
      (outcome) => {
        if (this.ending === tracked) this.endingPending = false;
        return outcome;
      },
      (error: unknown) => {
        if (this.ending === tracked) this.endingPending = false;
        this.deps.log.error("end statement failed", { game: this.ref }, error);
        return { committed: false };
      },
    );
    this.ending = tracked;
    return tracked;
  }

  /** True while the end of the game is not yet committed by this process (the eviction sweep keeps the session). */
  get endPending(): boolean {
    return this.endingPending;
  }

  /**
   * Waits for the finish statement (if any) so the parent row is COMPLETED before the rematch insert. A session built
   * from a row that had already ended (eviction then rejoin, or a late join) has nothing to wait for: its end is
   * committed (FIX-A: the rematch accept failed with `internal` on such sessions).
   */
  whenEnded(): Promise<{ committed: boolean } | null> {
    if (this.ending) return this.ending;
    return Promise.resolve(this.endedOnLoad ? { committed: true } : null);
  }

  private async createRematch(offeredBy: Side, acceptedBy: Side): Promise<void> {
    let r: ReduceResult;
    try {
      const outcome = await this.deps.persistence.createRematch(this, offeredBy, acceptedBy);
      if (outcome.ok) this.deps.onRematchCreated?.(this, outcome.newRef);
      r = outcome.ok
        ? this.dispatch({ type: "rematchCreated", newRef: outcome.newRef })
        : this.dispatch({ type: "rematchFailed", code: outcome.code });
    } catch (error) {
      this.deps.log.error("createRematch failed", { game: this.ref }, error);
      r = this.dispatch({ type: "rematchFailed", code: "internal" });
    }
    const ack: AckAny = r.ack ?? { ok: false, code: "internal" };
    for (const resolve of this.rematchWaiters.splice(0)) resolve(ack);
  }

  /**
   * `game:result` (plan 7.4.5) once the finish committed; P9/P12 fill their fields. `review` (P3 §7.4) is what the
   * finish statement's jobs fragment did; a persistence without a database (in-memory tests) reports nothing, and the
   * same eligibility rule stands in for it (with no ETA: there is no queue to estimate from).
   */
  private emitResult(review?: FinishAnalysis["review"]): void {
    const seq = this._state.seq + 1;
    this._state = { ...this._state, seq };
    const plies = this._state.moves.length;
    this.deps.emit(ROOM.game(this.ref), "game:result", {
      seq,
      ref: this.ref,
      ratings: null,
      tournament: null,
      review:
        review ??
        (plies >= ANALYSIS_MIN_PLIES ? { status: "queued", etaSec: null } : { status: "skipped", etaSec: null }),
    });
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.timer.clear();
    this.spectators.destroy();
    for (const resolve of this.rematchWaiters.splice(0)) resolve({ ok: false, code: "expired" });
  }
}

function abortReason(by: AbortedBy): "timeout" | "player" | "stale" {
  return by === "timeout" || by === "stale" ? by : "player";
}
