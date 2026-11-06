// Spectators of one game (phase-02 plan 8.10, 7.4.5 `spectators:update`). The one-ply delay itself lives in
// game-core's reducer (it emits `spectate`-room events with their own seq and withholds the last ply); this class
// only counts spectator sockets and throttles `spectators:update {ref, count}` to at most one per
// SPECTATORS_UPDATE_MIN_MS per game (trailing edge, so the last count always arrives). Spectators are counted, never
// named (plan 11.2 rule 12).

export class SpectatorCounter {
  private readonly sockets = new Set<string>();
  private lastSentAt = Number.NEGATIVE_INFINITY;
  private lastSentCount = 0;
  private trailing: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly minIntervalMs: number,
    private readonly now: () => number,
    /** Sends `spectators:update` with this count to the game and spectate rooms. */
    private readonly send: (count: number) => void,
  ) {}

  get count(): number {
    return this.sockets.size;
  }

  has(socketId: string): boolean {
    return this.sockets.has(socketId);
  }

  /** Returns true when the count changed. */
  add(socketId: string): boolean {
    if (this.sockets.has(socketId)) return false;
    this.sockets.add(socketId);
    this.schedule();
    return true;
  }

  remove(socketId: string): boolean {
    if (!this.sockets.delete(socketId)) return false;
    this.schedule();
    return true;
  }

  private schedule(): void {
    if (this.trailing) return;
    const wait = this.lastSentAt + this.minIntervalMs - this.now();
    if (wait <= 0) return this.flush();
    this.trailing = setTimeout(() => {
      this.trailing = null;
      this.flush();
    }, wait);
  }

  private flush(): void {
    if (this.sockets.size === this.lastSentCount) return;
    this.lastSentAt = this.now();
    this.lastSentCount = this.sockets.size;
    this.send(this.sockets.size);
  }

  destroy(): void {
    if (this.trailing) clearTimeout(this.trailing);
    this.trailing = null;
    this.sockets.clear();
  }
}
