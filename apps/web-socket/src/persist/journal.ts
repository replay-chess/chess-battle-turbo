// The ndjson game journal (phase-02 plan 7.6 "Journal"): `{JOURNAL_DIR}/{ref}.ndjson` on the Docker volume
// `ws_journal`, one line per machine transition (game-core `JournalLine`, ≈ 100 B), written in batches with one
// `fsync` per file every 200 ms. It lets a restarted process restore plies the database has not seen yet (a crash
// between two checkpoints loses nothing but the last ≤ 200 ms).
//
// - The first line of a file is `open` with the format version `v` (game-core JOURNAL_VERSION). A file this process
//   has not written yet starts with a snapshot of the session (open, phase, ready, draw state, every ply, freeze), so
//   every file is self-contained even when the session was loaded from the database mid-game. Lines of a game still
//   in `waiting` are not journaled (nothing to restore).
// - A reader that meets a newer `v` skips the file (restore uses the DB row; `ws.restore{result:"journal_newer"}`).
// - Deleted 1 h after the finish is acknowledged by the DB; files older than 24 h are deleted at boot and hourly.
// Filesystem only: no database query here.
import { mkdir, open, readdir, readFile, rm, stat, type FileHandle } from "node:fs/promises";
import { join } from "node:path";
import { JOURNAL_VERSION, canReadJournal, otherSide, type JournalLine, type ServerGame } from "@repo/game-core";
import type { Logger, Metrics } from "../ports";

export const JOURNAL_FSYNC_EVERY_MS = 200;
/** A finished game's file is deleted this long after the DB acknowledged the finish. */
export const JOURNAL_KEEP_AFTER_END_MS = 60 * 60 * 1000;
/** Any file older than this (mtime) is deleted at boot and by the hourly cleanup. */
export const JOURNAL_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const JOURNAL_CLEANUP_EVERY_MS = 60 * 60 * 1000;

const SAFE_REF = /^[A-Za-z0-9_-]{1,64}$/;
const SUFFIX = ".ndjson";

/** What the journal needs of a session (LiveSession satisfies it). */
export interface JournalSubject {
  readonly ref: string;
  readonly state: ServerGame;
}

export interface JournalFile {
  ref: string;
  lines: JournalLine[];
  /** False when the `open` line is missing or newer than this build understands. */
  readable: boolean;
  /** `open.v`, when present. */
  version: number | null;
  mtimeMs: number;
}

interface FileState {
  handle: FileHandle | null;
  opening: Promise<FileHandle> | null;
  /** Lines not yet written. */
  pending: string[];
  /** Written but not yet fsynced. */
  unsynced: boolean;
  /** Close after the next sync (finished game). */
  closeAfterSync: boolean;
}

export interface JournalOptions {
  dir: string;
  now(): number;
  log: Logger;
  metrics: Metrics;
  fsyncEveryMs?: number;
  keepAfterEndMs?: number;
  maxAgeMs?: number;
}

/** The snapshot lines that make a new file self-contained (`open` first). */
export function snapshotLines(s: ServerGame, at: number): JournalLine[] {
  const lines: JournalLine[] = [
    {
      t: "open",
      v: JOURNAL_VERSION,
      at,
      ref: s.ref,
      startFen: s.startFen,
      tc: s.tc ? { i: s.tc.initialMs, inc: s.tc.incrementMs } : null,
      colors: { w: s.seats.w.ref, b: s.seats.b.ref },
      studyS: s.studySeconds,
    },
  ];
  const phaseAt = s.startedAt ?? at;
  if (s.phase === "study" && s.study) {
    lines.push({ t: "phase", at, phase: "study", endsAt: s.study.endsAt });
    for (const side of ["w", "b"] as const) if (s.study.ready[side]) lines.push({ t: "ready", at, side });
  } else if (s.phase === "first_move" && s.firstMove) {
    lines.push({ t: "phase", at, phase: "first_move", endsAt: s.firstMove.deadlineAt, side: s.firstMove.side });
  } else if (s.phase === "playing" || s.phase === "ended") {
    lines.push({ t: "phase", at: phaseAt, phase: "playing" });
  }
  // Cooldowns first: a `drawx` line also clears the open offer, which the `draw` line below sets again.
  for (const side of ["w", "b"] as const) {
    const canAt = s.canOfferAtPly[side];
    if (canAt > 0) lines.push({ t: "drawx", at, by: otherSide(side), canAt });
  }
  s.moves.forEach((uci, i) => {
    lines.push({
      t: "ply",
      n: i + 1,
      uci,
      san: s.sans[i] ?? "",
      clk: s.tc ? (s.clocksMs[i] ?? null) : null,
      spent: s.spentMs[i] ?? 0,
      at,
    });
  });
  if (s.drawOffer) lines.push({ t: "draw", at, by: s.drawOffer.by, ply: s.drawOffer.ply });
  if (s.frozen) lines.push({ t: "freeze", at: s.frozen.since, w: s.clocks.w, b: s.clocks.b });
  if (s.phase === "ended" && s.result) {
    const r = s.result;
    lines.push({ t: "end", at: r.endedAt, method: r.method, winner: r.winner, ply: s.moves.length, ...(r.abortedBy ? { by: r.abortedBy } : {}) });
  }
  return lines;
}

export function parseJournal(text: string): JournalLine[] {
  const lines: JournalLine[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    try {
      const parsed = JSON.parse(line) as unknown;
      if (parsed && typeof parsed === "object" && typeof (parsed as { t?: unknown }).t === "string") {
        lines.push(parsed as JournalLine);
      }
    } catch {
      // A torn last line (crash mid-write) or garbage: skipped; the lines before it still count.
    }
  }
  return lines;
}

export class Journal {
  private readonly files = new Map<string, FileState>();
  /** Refs whose existing file this process continues (restored from it); others are rewritten on first touch. */
  private readonly continueRefs = new Set<string>();
  /** ref → when the DB acknowledged its finish (deletion after keepAfterEndMs). */
  private readonly committedAt = new Map<string, number>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private flushing: Promise<void> = Promise.resolve();
  private cleanupHandle: ReturnType<typeof setInterval> | null = null;
  private closed = false;

  constructor(private readonly options: JournalOptions) {}

  get dir(): string {
    return this.options.dir;
  }

  async init(): Promise<void> {
    await mkdir(this.options.dir, { recursive: true });
  }

  private path(ref: string): string {
    return join(this.options.dir, `${ref}${SUFFIX}`);
  }

  /** The restore read this ref's file and continues it (appends instead of rewriting). */
  continueFile(ref: string): void {
    this.continueRefs.add(ref);
  }

  /** One machine transition of a live session. */
  append(subject: JournalSubject, line: JournalLine): void {
    if (this.closed || !SAFE_REF.test(subject.ref)) return;
    // After the DB acknowledged the end, later lines (rematch offers) are not needed for a restore.
    if (this.committedAt.has(subject.ref)) return;
    let file = this.files.get(subject.ref);
    if (!file) {
      if (subject.state.phase === "waiting") return; // nothing to restore before the game starts
      file = { handle: null, opening: null, pending: [], unsynced: false, closeAfterSync: false };
      this.files.set(subject.ref, file);
      if (!this.continueRefs.has(subject.ref)) {
        // New in this process: (re)write the file with a snapshot of the session first.
        for (const l of snapshotLines(subject.state, this.options.now())) file.pending.push(JSON.stringify(l));
        this.openFile(subject.ref, file, "w");
      }
    }
    file.pending.push(JSON.stringify(line));
    this.schedule();
  }

  /** `{t:"flushed", n}` after a checkpoint (or the finish) committed. */
  flushed(ref: string, plies: number): void {
    const file = this.files.get(ref);
    if (!file || this.closed) return;
    file.pending.push(JSON.stringify({ t: "flushed", n: plies } satisfies JournalLine));
    this.schedule();
  }

  /** The DB acknowledged the finish or abort: the file is closed after the next sync and deleted 1 h later. */
  committed(ref: string, at: number): void {
    this.committedAt.set(ref, at);
    const file = this.files.get(ref);
    if (file) file.closeAfterSync = true;
  }

  private openFile(ref: string, file: FileState, flags: "a" | "w"): Promise<FileHandle> {
    if (file.handle) return Promise.resolve(file.handle);
    if (!file.opening) {
      file.opening = open(this.path(ref), flags).then((h) => {
        file.handle = h;
        file.opening = null;
        return h;
      });
      file.opening.catch(() => {
        file.opening = null;
      });
    }
    return file.opening;
  }

  private schedule(): void {
    if (this.timer || this.closed) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.sync();
    }, this.options.fsyncEveryMs ?? JOURNAL_FSYNC_EVERY_MS);
    this.timer.unref?.();
  }

  /** Writes every pending line and fsyncs each touched file (one at a time; concurrent callers share the chain). */
  sync(): Promise<void> {
    const run = this.flushing.then(() => this.syncOnce());
    this.flushing = run.catch(() => undefined);
    return run;
  }

  private async syncOnce(): Promise<void> {
    const work: Promise<void>[] = [];
    for (const [ref, file] of this.files) {
      if (file.pending.length === 0 && !file.unsynced && !file.closeAfterSync) continue;
      work.push(this.syncFile(ref, file));
    }
    await Promise.all(work);
  }

  private async syncFile(ref: string, file: FileState): Promise<void> {
    try {
      if (file.pending.length > 0) {
        const handle = await this.openFile(ref, file, "a");
        const text = file.pending.join("\n") + "\n";
        file.pending = [];
        await handle.write(text);
        file.unsynced = true;
      }
      if (file.unsynced && file.handle) {
        await file.handle.datasync();
        file.unsynced = false;
      }
      if (file.closeAfterSync && file.pending.length === 0) {
        await file.handle?.close();
        this.files.delete(ref);
      }
    } catch (error) {
      this.options.metrics.count("ws.journal.fail");
      this.options.log.error("journal write failed", { game: ref }, error);
    }
  }

  /** The session left memory: flush and close its file (it stays on disk). */
  async release(ref: string): Promise<void> {
    const file = this.files.get(ref);
    if (!file) return;
    file.closeAfterSync = true;
    await this.sync();
  }

  /** Every journal file in the directory (boot restore). Unreadable versions are reported, not thrown. */
  async readAll(): Promise<JournalFile[]> {
    let names: string[];
    try {
      names = await readdir(this.options.dir);
    } catch {
      return [];
    }
    const out: JournalFile[] = [];
    for (const name of names) {
      if (!name.endsWith(SUFFIX)) continue;
      const ref = name.slice(0, -SUFFIX.length);
      if (!SAFE_REF.test(ref)) continue;
      try {
        const path = this.path(ref);
        const [text, st] = await Promise.all([readFile(path, "utf8"), stat(path)]);
        const lines = parseJournal(text);
        const openLine = lines.find((l): l is Extract<JournalLine, { t: "open" }> => l.t === "open") ?? null;
        out.push({
          ref,
          lines,
          readable: canReadJournal(openLine),
          version: openLine ? openLine.v : null,
          mtimeMs: st.mtimeMs,
        });
      } catch (error) {
        this.options.log.warn("journal file unreadable", { game: ref, err: String(error) });
      }
    }
    return out;
  }

  /**
   * Deletes files of games whose finish was acknowledged more than 1 h ago, and every file older than 24 h that no
   * live session is writing. Returns the number of deleted files.
   */
  async cleanup(liveRefs: ReadonlySet<string> = new Set()): Promise<number> {
    const now = this.options.now();
    const keep = this.options.keepAfterEndMs ?? JOURNAL_KEEP_AFTER_END_MS;
    const maxAge = this.options.maxAgeMs ?? JOURNAL_MAX_AGE_MS;
    let deleted = 0;
    let names: string[] = [];
    try {
      names = await readdir(this.options.dir);
    } catch {
      return 0;
    }
    for (const name of names) {
      if (!name.endsWith(SUFFIX)) continue;
      const ref = name.slice(0, -SUFFIX.length);
      if (this.files.has(ref) && !this.committedAt.has(ref)) continue; // being written
      const committed = this.committedAt.get(ref);
      let drop = committed !== undefined && now - committed >= keep;
      if (!drop && !liveRefs.has(ref)) {
        try {
          drop = now - (await stat(this.path(ref))).mtimeMs >= maxAge;
        } catch {
          continue;
        }
      }
      if (!drop) continue;
      await rm(this.path(ref), { force: true });
      this.continueRefs.delete(ref);
      deleted++;
    }
    // Commit marks outlive their file (late lines of an ended game stay unjournaled) until the session is long gone.
    for (const [ref, at] of this.committedAt) if (now - at >= maxAge) this.committedAt.delete(ref);
    return deleted;
  }

  /** Hourly cleanup (filesystem only). */
  startCleanup(liveRefs: () => ReadonlySet<string>, everyMs = JOURNAL_CLEANUP_EVERY_MS): void {
    if (this.cleanupHandle) return;
    this.cleanupHandle = setInterval(() => {
      void this.cleanup(liveRefs()).catch((error: unknown) => this.options.log.warn("journal cleanup failed", { err: String(error) }));
    }, everyMs);
    this.cleanupHandle.unref?.();
  }

  /** Final sync and close of every file (shutdown). */
  async close(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.cleanupHandle) clearInterval(this.cleanupHandle);
    this.cleanupHandle = null;
    await this.sync();
    this.closed = true;
    for (const file of this.files.values()) await file.handle?.close().catch(() => undefined);
    this.files.clear();
  }

  /** Pending lines (tests, metrics). */
  get pendingLines(): number {
    let n = 0;
    for (const f of this.files.values()) n += f.pending.length;
    return n;
  }
}
