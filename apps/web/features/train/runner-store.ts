// The runner's per-instance store (phase-05 plan §4.4, §5.2 S4/S5, cdl §6.3): one Zustand store per TrainerRunner
// mount, created from the session payload. It owns the queue (with the client's Again re-queue, the same rule as the
// server: `requeueAfterAgain` from `@repo/chess-training/grade`), the current item's phase machine (machine.ts), the
// header numbers (solve streak, puzzle rating preview, capRemaining) and the grades made in this mount. No network
// and no timers here: useGrade enqueues to the outbox, TrainerRunner schedules the phase timers.
import type { AttemptIn, AttemptOut, PuzzleRatingState, SessionPayload, ThemeRef, TrainItem } from "@repo/contracts/http/train";
import { requeueAfterAgain, solveStreakAfter, type GradeKey } from "@repo/chess-training/grade";
import { createStore, type StoreApi } from "zustand/vanilla";
import { flagsOf, initialRun, step, viewOf, type ItemRun, type RunEvent, type RunView } from "./machine";
import { previewRating } from "./rating";
import { prepareItem, type PreparedItem } from "./validate";

export type RunnerMode = "bank" | "puzzles";

/** One grade made in this mount (the done line, the result dots, telemetry). */
export type GradedItem = {
  itemId: string;
  kind: TrainItem["kind"];
  pass: 1 | 2;
  grade: GradeKey;
  suggested: GradeKey;
  solved: boolean;
  firstTry: boolean;
  hints: number;
  wrongs: number;
  shown: boolean;
  theme: ThemeRef;
};

export type ExtendState = "idle" | "pending" | "failed" | "ended";

export type RunnerState = {
  ref: string;
  kind: SessionPayload["kind"];
  mode: RunnerMode;
  title: SessionPayload["header"]["title"];
  theme: ThemeRef | null;
  items: TrainItem[];
  index: number;
  /** Where this mount started (items before it were graded on an earlier visit). */
  startIndex: number;
  /** itemId → replayed line (null = broken). */
  prepared: Record<string, PreparedItem | null>;
  run: ItemRun | null;
  /** The item left last and its final state: the board keeps showing it once the session is done. */
  last: { itemId: string; run: ItemRun } | null;
  /** When the current item became solvable (Date.now ms), for `timeMs`. */
  itemStartedAt: number;
  graded: GradedItem[];
  skipped: string[];
  broken: string[];
  solveStreak: number;
  rating: PuzzleRatingState | null;
  /** The rating change shown on the label for the current item (set when it is solved). */
  ratingDelta: number | null;
  capRemaining: number | null;
  countsTowardCap: boolean;
  stream: boolean;
  targetCount: number | null;
  extend: ExtendState;
  /** Every item is graded or skipped (or the member ended the session). */
  done: boolean;
  ended: boolean;
};

export type GradeCommit = {
  item: TrainItem;
  graded: GradedItem;
  /** The interval the toast and telemetry show (the preview of the chosen grade). */
  intervalDays: number;
  intervalLabel: string | null;
  /** The pass-2 copy was queued (Again on pass 1). */
  requeued: boolean;
  timeMs: number;
  /** The item's index before the advance (the outbox resume merge keys on itemIds, not indices). */
  index: number;
};

export type RunnerActions = {
  dispatch(ev: RunEvent): void;
  /** Grades the current graded item and advances. Returns what was graded (null when nothing is gradable). */
  grade(g: GradeKey, now?: number): GradeCommit | null;
  /** Skip for today / report: advances without a grade. */
  skip(now?: number): TrainItem | null;
  appendItems(items: TrainItem[], stream: boolean): void;
  setExtend(s: ExtendState): void;
  /**
   * Server results for this session's attempts: `capRemaining`, and the puzzle rating from the result of
   * `ratingFrom` (the newest puzzle attempt of this mount), so an older batch never rolls the chip back.
   */
  applyResults(results: readonly AttemptOut[], opts?: { capRemaining?: number; ratingFrom?: string | null; rating?: PuzzleRatingState | null }): void;
  end(): void;
};

export type RunnerStore = StoreApi<RunnerState & RunnerActions>;

export type RunnerInit = {
  payload: SessionPayload;
  /** max(payload.resumeIndex, the outbox's highest graded index + 1), computed by the caller. */
  resumeIndex?: number;
  /** Items to re-queue from attempts still in the outbox (Again on pass 1 that the server has not seen). */
  pendingAgain?: readonly string[];
  now?: number;
};

/** A pass-2 copy keeps the item but swaps in the after-Again previews (computed at build: no ts-fsrs here). */
export function pass2Copy(item: TrainItem): TrainItem {
  return { ...item, preview: item.previewAfterAgain, previewAfterAgain: null };
}

/** Re-applies the client's Again re-queues for attempts the server has not applied yet (a reload mid-session). */
export function withLocalRequeues(items: readonly TrainItem[], againIds: readonly string[]): TrainItem[] {
  let out = [...items];
  for (const id of againIds) {
    const i = out.findIndex((it) => it.itemId === id);
    if (i < 0) continue;
    out = requeueAfterAgain(out, i, pass2Copy).items;
  }
  return out;
}

function modeOf(payload: SessionPayload): RunnerMode {
  return payload.kind === "puzzles" ? "puzzles" : "bank";
}

/** The first index ≥ `from` whose item replays legally (broken ones are collected). */
function nextPlayable(s: Pick<RunnerState, "items" | "prepared">, from: number): { index: number; prepared: Record<string, PreparedItem | null>; broken: string[] } {
  const prepared = { ...s.prepared };
  const broken: string[] = [];
  let i = from;
  for (; i < s.items.length; i++) {
    const it = s.items[i]!;
    if (!(it.itemId in prepared)) prepared[it.itemId] = prepareItem(it);
    if (prepared[it.itemId]) break;
    broken.push(it.itemId);
  }
  return { index: i, prepared, broken };
}

/** The item after the current one, prepared ahead (the pre-rendered next board). */
export function upcomingItem(s: Pick<RunnerState, "items" | "index">): TrainItem | null {
  return s.items[s.index + 1] ?? null;
}

export function createRunnerStore(init: RunnerInit): RunnerStore {
  const { payload } = init;
  const now = init.now ?? Date.now();
  const items = withLocalRequeues(payload.items, init.pendingAgain ?? []);
  const start = Math.min(Math.max(payload.resumeIndex, init.resumeIndex ?? 0), items.length);
  const base = { items, prepared: {} as Record<string, PreparedItem | null> };
  const first = nextPlayable(base, start);
  const item = items[first.index];
  const prep = item ? first.prepared[item.itemId] : null;

  return createStore<RunnerState & RunnerActions>()((set, get) => {
    const enter = (s: RunnerState, from: number, at: number): Partial<RunnerState> => {
      const n = nextPlayable(s, from);
      const it = s.items[n.index];
      const p = it ? n.prepared[it.itemId] : null;
      const atEnd = n.index >= s.items.length;
      const leaving = s.items[s.index];
      return {
        last: leaving && s.run ? { itemId: leaving.itemId, run: s.run } : s.last,
        index: n.index,
        prepared: n.prepared,
        broken: n.broken.length ? [...s.broken, ...n.broken] : s.broken,
        run: it && p ? initialRun(p, it.context?.playedUci ?? null) : null,
        itemStartedAt: at,
        ratingDelta: null,
        done: atEnd && !(s.stream && s.extend === "pending"),
      };
    };

    return {
      ref: payload.ref,
      kind: payload.kind,
      mode: modeOf(payload),
      title: payload.header.title,
      theme: payload.theme,
      items,
      index: first.index,
      startIndex: start,
      prepared: first.prepared,
      run: item && prep ? initialRun(prep, item.context?.playedUci ?? null) : null,
      last: null,
      itemStartedAt: now,
      graded: [],
      skipped: [],
      broken: first.broken,
      solveStreak: payload.header.solveStreak,
      rating: payload.header.rating,
      ratingDelta: null,
      capRemaining: payload.capRemaining,
      countsTowardCap: payload.countsTowardCap,
      stream: payload.stream && payload.targetCount === null,
      targetCount: payload.targetCount,
      extend: "idle",
      done: first.index >= items.length,
      ended: false,

      dispatch(ev) {
        const s = get();
        const it = s.items[s.index];
        const p = it ? s.prepared[it.itemId] : null;
        if (!s.run || !it || !p) return;
        const run = step(p, s.run, ev);
        if (run === s.run) return;
        const patch: Partial<RunnerState> = { run };
        // A solve or a shown solution of a puzzle moves the rating chip at once (D-13), with the objective score.
        if (run.phase === "graded" && s.run.phase !== "graded") {
          const v = viewOf(it, p, run);
          // The solve streak counts pass-1 attempts only, as W1 does (FIX-2): a pass-2 copy neither extends nor resets it.
          if (it.pass === 1) patch.solveStreak = solveStreakAfter(s.solveStreak, flagsOf(run, it));
          // As the server rates: pass 1 only (a re-queued copy is not rated again), never in practice (FIX-1).
          if (it.kind === "puzzle" && it.pass === 1 && s.kind !== "practice" && s.rating && it.rating !== null) {
            const r = previewRating(s.rating, it.rating, v.score);
            patch.rating = r.next;
            patch.ratingDelta = r.delta;
          }
        }
        if (it.pass === 1 && (run.phase === "wrong" || (run.shown && !s.run.shown))) patch.solveStreak = 0;
        set(patch);
      },

      grade(g, at = Date.now()) {
        const s = get();
        const it = s.items[s.index];
        const p = it ? s.prepared[it.itemId] : null;
        if (!s.run || !it || !p || s.run.phase !== "graded") return null;
        const v = viewOf(it, p, s.run);
        const graded: GradedItem = {
          itemId: it.itemId,
          kind: it.kind,
          pass: it.pass,
          grade: g,
          suggested: v.suggested ?? g,
          solved: !s.run.shown,
          firstTry: v.firstTry,
          hints: s.run.hints,
          wrongs: s.run.wrongs,
          shown: s.run.shown,
          theme: it.theme,
        };
        const preview = it.preview?.[g] ?? null;
        let items = s.items;
        let requeued = false;
        if (g === "again" && it.pass === 1 && it.preview !== null) {
          const r = requeueAfterAgain(s.items, s.index, pass2Copy);
          items = r.items;
          requeued = r.requeued;
        }
        const commit: GradeCommit = {
          item: it,
          graded,
          intervalDays: preview?.days ?? 0,
          intervalLabel: preview?.label ?? null,
          requeued,
          timeMs: Math.max(0, Math.min(3_600_000, at - s.itemStartedAt)),
          index: s.index,
        };
        const next = { ...s, items };
        set({ items, graded: [...s.graded, graded], ...enter(next, s.index + 1, at) });
        return commit;
      },

      skip(at = Date.now()) {
        const s = get();
        const it = s.items[s.index];
        if (!it || s.done) return null;
        set({ skipped: [...s.skipped, it.itemId], ...enter(s, s.index + 1, at) });
        return it;
      },

      appendItems(newItems, stream) {
        const s = get();
        const known = new Set(s.items.map((it) => it.itemId));
        const fresh = newItems.filter((it) => !known.has(it.itemId));
        const items = [...s.items, ...fresh];
        // An answer with nothing new ends the stream: asking again with the same `after` would only repeat it (a request
        // loop two items from the end; regression: extend-after-pass2).
        const more = stream && fresh.length > 0;
        const patch: Partial<RunnerState> = { items, stream: more, extend: more ? "idle" : "ended" };
        // Waiting at the end for this batch: start its first item now.
        if (s.index >= s.items.length && fresh.length) Object.assign(patch, enter({ ...s, items, stream: more, extend: more ? "idle" : "ended" }, s.index, Date.now()));
        else if (s.index >= s.items.length) patch.done = true;
        set(patch);
      },

      setExtend(extend) {
        const s = get();
        const atEnd = s.index >= s.items.length;
        set({ extend, done: atEnd && extend !== "pending" ? true : s.done });
      },

      applyResults(results, opts = {}) {
        const s = get();
        const patch: Partial<RunnerState> = {};
        const latest = opts.ratingFrom ? results.find((r) => r.clientAttemptId === opts.ratingFrom && r.status === "ok") : undefined;
        // The server's whole Glicko state (r, RD, volatility), so the next preview starts where the server is (D-13;
        // FIX-1 rating-sync: replacing only the rounded value let RD and volatility drift from the stored ones).
        if (latest?.rating && s.rating) patch.rating = opts.rating ? { ...opts.rating } : { ...s.rating, value: latest.rating.value, provisional: latest.rating.provisional };
        // The solve streak stays the client's (it already counts grades the server has not seen yet).
        if (opts.capRemaining !== undefined && s.capRemaining !== null) patch.capRemaining = opts.capRemaining;
        if (Object.keys(patch).length) set(patch);
      },

      end() {
        const s = get();
        const it = s.items[s.index];
        set({ done: true, ended: true, run: null, last: it && s.run ? { itemId: it.itemId, run: s.run } : s.last });
      },
    };
  });
}

/** The current item and its view (null when done or the payload is empty). */
export function currentView(s: RunnerState): { item: TrainItem; prepared: PreparedItem; view: RunView } | null {
  const item = s.items[s.index];
  const prepared = item ? s.prepared[item.itemId] : null;
  if (!item || !prepared || !s.run) return null;
  return { item, prepared, view: viewOf(item, prepared, s.run) };
}

/** "2 of 3": the position among the items (pass-2 copies count). */
export function progressLabel(s: Pick<RunnerState, "index" | "items" | "done">): string {
  const n = s.items.length;
  return `${Math.min(s.done ? n : s.index + 1, Math.max(n, 1))} of ${n}`;
}

/** Outbox entries of this session → the resume index and the pass-1 Agains the server has not seen. */
export function mergeOutbox(payload: SessionPayload, entries: readonly { attempt: AttemptIn }[]): { resumeIndex: number; pendingAgain: string[] } {
  const mine = entries.filter((e) => e.attempt.sessionRef === payload.ref && e.attempt.itemId).sort((a, b) => Date.parse(a.attempt.reviewedAt) - Date.parse(b.attempt.reviewedAt));
  const pendingAgain = mine.filter((e) => e.attempt.grade === "again" && !e.attempt.itemId!.endsWith("b")).map((e) => e.attempt.itemId!);
  // Items after the local re-queues, so a graded pass-2 copy has an index too.
  const items = withLocalRequeues(payload.items, pendingAgain).map((it) => it.itemId);
  let resumeIndex = payload.resumeIndex;
  for (const e of mine) {
    const i = items.indexOf(e.attempt.itemId!);
    if (i >= 0) resumeIndex = Math.max(resumeIndex, i + 1);
  }
  return { resumeIndex, pendingAgain };
}

