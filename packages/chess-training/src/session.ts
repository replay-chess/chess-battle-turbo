// Session composition (phase-05 plan §8.6, §7.3 W2/W3; rct-b §3.7): which items a session holds and in which order.
// Pure and deterministic: the service reads the rows (cards, today's counters, the frozen plan) and the shard tuples,
// these functions decide; the service then adds texts and previews and writes one row. Server-only (it sorts the due
// queue by FSRS retrievability, so it imports `fsrs.ts`).
//
// The Again re-queue (`requeueIndex`, `requeueAfterAgain`) lives in the browser-safe `grade.ts` because the runner
// applies it too; it is re-exported here so the server imports it from the session module.
import {
  BANK_SESSION_MAX,
  MIX_THEME,
  PUZZLE_BAND_MAX,
  PUZZLE_BAND_MIN,
  PUZZLE_BATCH,
  PUZZLE_DUE_EVERY,
  PUZZLE_DUE_SHARE,
  PUZZLE_MAX_WIDEN_STEPS,
  PUZZLE_MIN_CANDIDATES,
  PUZZLE_WIDEN_STEP,
  PUZZLE_WINDOW_ABOVE,
  PUZZLE_WINDOW_BELOW,
} from "./constants";
import { retrievability, type CardRow } from "./fsrs";

export { requeueAfterAgain, requeueIndex } from "./grade";

/** `training_sessions.kind` values P5 builds (WEAKNESS is P6's). */
export type SessionKind = "daily" | "bank" | "puzzles" | "practice";
/** `TrainingItemKind` (the session item JSON's `kind`, `SESSION_ITEM_KINDS_DB`). */
export type SessionItemKindDb = "MISTAKE" | "REVIEW_POSITION" | "LICHESS_PUZZLE" | "OPENING_LINE";

/** A shard tuple: [lichessId, fen, "setup best reply …", rating, themesMask] (§8.13). */
export type PuzzleTuple = readonly [id: string, fen: string, moves: string, rating: number, themes: number];

/** A due BANK card candidate (the W2 BANK query's row, mapped). */
export interface BankCardIn {
  key: string;
  kind: "MISTAKE" | "REVIEW_POSITION";
  card: CardRow;
  /** `mistakes."lastPlayedAt"`: NEW cards are taken newest game first. */
  lastPlayedAt: Date;
}

/** A due PUZZLE-deck card of the session's theme (its snapshot comes from the card row). */
export interface PuzzleCardIn {
  key: string;
  puzzleId: string;
  rating: number;
  due: Date;
}

export type EmptyReason = "caughtup" | "cap_reached" | "nothing_matches";

/** One planned item; the service adds texts, previews and the board fields. */
export interface PlannedItem {
  /** Session-local id: "i1", "i2" … ("i3b" is a re-queued pass-2 copy, added later). */
  itemId: string;
  key: string;
  kind: SessionItemKindDb;
  pass: 1;
  /** A new shard puzzle (no card yet): the snapshot to store in the session. */
  puzzle?: PuzzleTuple;
  /** False for practice items: no grade previews, no FSRS effect (`preview: null`). */
  previews: boolean;
}

export interface SessionPlan {
  kind: SessionKind;
  countsTowardCap: boolean;
  items: PlannedItem[];
  empty: EmptyReason | null;
  /** Puzzles: extend while `stream && !targetCount`. */
  stream: boolean;
  targetCount: number | null;
  /** Puzzles: the theme actually served (`mix` after a fallback). */
  theme: string | null;
  widened: PuzzleWindow | null;
}

// ── Item ids ───────────────────────────────────────────────────────────────────────────────────────────────────

function idNumber(itemId: string): number {
  const m = /^i(\d+)b?$/.exec(itemId);
  return m ? Number(m[1]) : 0;
}

/** `n` fresh ids after the ones a session already holds ("i11", "i12" … after ten items). */
export function nextItemIds(existing: readonly { itemId: string }[], n: number): string[] {
  const start = existing.reduce((max, it) => Math.max(max, idNumber(it.itemId)), 0);
  return Array.from({ length: n }, (_, i) => `i${start + i + 1}`);
}

/** The items appended after `afterId` (W3 extend replays: a repeat returns what the first call added). */
export function itemsAfter<T extends { itemId: string; pass: number }>(items: readonly T[], afterId: string): T[] {
  const firstNew = idNumber(afterId) + 1;
  return items.filter((it) => it.pass === 1 && idNumber(it.itemId) >= firstNew);
}

/** "tal_fan_77 · move 17 · Recapture first" (the runner's queue list). */
export function queueLabel(opponent: string, moveNo: number, themeLabel: string): string {
  return `${opponent} · move ${moveNo} · ${themeLabel}`;
}

// ── The BANK due queue ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * Due BANK cards in queue order (§8.6): review cards by retrievability ascending (most forgotten first; ties: older
 * due, then key), then NEW cards newest game first (ties: key). Cards not due at `now` are dropped.
 */
export function orderDueQueue(cards: readonly BankCardIn[], now: Date): BankCardIn[] {
  const due = cards.filter((c) => c.card.due.getTime() <= now.getTime());
  const reviews = due
    .filter((c) => c.card.state !== "NEW")
    .map((c) => ({ c, r: retrievability(c.card, now) }))
    .sort((a, b) => a.r - b.r || a.c.card.due.getTime() - b.c.card.due.getTime() || (a.c.key < b.c.key ? -1 : a.c.key > b.c.key ? 1 : 0))
    .map((x) => x.c);
  const fresh = due
    .filter((c) => c.card.state === "NEW")
    .sort((a, b) => b.lastPlayedAt.getTime() - a.lastPlayedAt.getTime() || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return [...reviews, ...fresh];
}

/** Takes the queue under the cap: at most `newRemaining` NEW cards, at most `min(capRemaining, max)` in all. */
export function takeUnderCap(ordered: readonly BankCardIn[], o: { capRemaining: number; newRemaining: number; max?: number }): BankCardIn[] {
  const limit = Math.min(o.capRemaining, o.max ?? BANK_SESSION_MAX);
  const out: BankCardIn[] = [];
  let fresh = 0;
  for (const c of ordered) {
    if (out.length >= limit) break;
    if (c.card.state === "NEW") {
      if (fresh >= o.newRemaining) continue;
      fresh += 1;
    }
    out.push(c);
  }
  return out;
}

/** Moves `key` to the front when present (a hub thumbnail's card goes first). */
function keyFirst<T extends { key: string }>(list: readonly T[], key: string | undefined): T[] {
  if (!key) return [...list];
  const i = list.findIndex((x) => x.key === key);
  if (i <= 0) return [...list];
  return [list[i]!, ...list.slice(0, i), ...list.slice(i + 1)];
}

// ── Puzzles: rating window, bands, widening ────────────────────────────────────────────────────────────────────

export interface PuzzleWindow {
  from: number;
  to: number;
}

/** The rating window at widening step `step`: [R − 100 − 100·step, R + 150 + 100·step]. */
export function puzzleWindow(rating: number, step: number): PuzzleWindow {
  const r = Math.round(rating);
  return { from: r - PUZZLE_WINDOW_BELOW - PUZZLE_WIDEN_STEP * step, to: r + PUZZLE_WINDOW_ABOVE + PUZZLE_WIDEN_STEP * step };
}

/** A rating's shard band, `floor(rating / 100)` clamped to the bands that exist (6 … 25). */
export function puzzleBand(rating: number): number {
  return Math.min(PUZZLE_BAND_MAX, Math.max(PUZZLE_BAND_MIN, Math.floor(rating / 100)));
}

/** Every band a window touches, low to high. */
export function bandsInWindow(w: PuzzleWindow): number[] {
  const lo = puzzleBand(w.from);
  const hi = puzzleBand(w.to);
  return Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
}

/** The window as the member reads it ("showing 1300–1800"): widened outward to whole hundreds. */
export function displayWindow(w: PuzzleWindow): PuzzleWindow {
  return { from: Math.floor(w.from / 100) * 100, to: Math.ceil(w.to / 100) * 100 };
}

/** Deterministic PRNG (mulberry32) for the shuffle: same seed, same batch. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A 32-bit seed from a string (FNV-1a), e.g. the session's filter key or `userRef + dayKey`. */
export function seedOf(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export type PuzzlePickItem = { source: "shard"; puzzle: PuzzleTuple } | { source: "card"; card: PuzzleCardIn };

export interface PuzzlePick {
  items: PuzzlePickItem[];
  /** The theme served: the requested one, or `mix` after the fallback. */
  theme: string;
  /** The window the batch came from. */
  window: PuzzleWindow;
  /** Set when the window was widened or the theme fell back ("Few fork puzzles near 1512; showing 1300–1800."). */
  widened: PuzzleWindow | null;
}

export interface SelectPuzzlesInput {
  rating: number;
  theme: string;
  count?: number;
  /** Puzzle ids attempted in the last 90 days (new puzzles only). */
  excludeIds: ReadonlySet<string>;
  /** Puzzle ids already in this session (new puzzles and due cards; extend dedupe). */
  sessionIds?: ReadonlySet<string>;
  /** Due PUZZLE-deck cards of the theme. */
  dueCards?: readonly PuzzleCardIn[];
  /** One shard file; `[]` (or undefined) when the band does not exist. The caller's loader caches. */
  loadBand: (theme: string, band: number) => Promise<readonly PuzzleTuple[] | undefined> | readonly PuzzleTuple[] | undefined;
  seed: number;
}

async function candidatesIn(
  theme: string,
  w: PuzzleWindow,
  input: SelectPuzzlesInput,
  cache: Map<string, readonly PuzzleTuple[]>,
  skip: ReadonlySet<string>,
): Promise<PuzzleTuple[]> {
  const seen = new Set<string>();
  const out: PuzzleTuple[] = [];
  for (const band of bandsInWindow(w)) {
    const k = `${theme}/${band}`;
    let tuples = cache.get(k);
    if (!tuples) {
      tuples = (await input.loadBand(theme, band)) ?? [];
      cache.set(k, tuples);
    }
    for (const p of tuples) {
      const [id, , , rating] = p;
      if (rating < w.from || rating > w.to) continue;
      if (seen.has(id) || skip.has(id) || input.excludeIds.has(id)) continue;
      seen.add(id);
      out.push(p);
    }
  }
  return out;
}

/**
 * A puzzle batch (§8.6, §7.3 W2): due PUZZLE-deck cards of the theme take at most 30 % of the batch (every third
 * slot); the rest are new shard puzzles rated inside [R − 100, R + 150], widened by ±100 per step until 15 candidates
 * remain, then the `mix` theme (both report `widened`). Recently attempted ids and ids already in the session are
 * excluded; the new puzzles are a seeded sample sorted by rating ascending (warm-up).
 */
export async function selectPuzzles(input: SelectPuzzlesInput): Promise<PuzzlePick> {
  const count = input.count ?? PUZZLE_BATCH;
  const sessionIds = input.sessionIds ?? new Set<string>();
  const dueSlots = Math.floor(count * PUZZLE_DUE_SHARE);
  const due = [...(input.dueCards ?? [])]
    .filter((c) => !sessionIds.has(c.puzzleId))
    .sort((a, b) => a.due.getTime() - b.due.getTime() || (a.key < b.key ? -1 : 1))
    .slice(0, dueSlots);
  const skip = new Set<string>([...sessionIds, ...due.map((c) => c.puzzleId)]);
  const need = count - due.length;
  const enough = Math.max(PUZZLE_MIN_CANDIDATES, need);
  const cache = new Map<string, readonly PuzzleTuple[]>();

  let theme = input.theme;
  let step = 0;
  let window = puzzleWindow(input.rating, 0);
  let pool = await candidatesIn(theme, window, input, cache, skip);
  while (pool.length < enough && step < PUZZLE_MAX_WIDEN_STEPS) {
    step += 1;
    window = puzzleWindow(input.rating, step);
    pool = await candidatesIn(theme, window, input, cache, skip);
  }
  let fellBack = false;
  if (pool.length < enough && theme !== MIX_THEME) {
    const own = { theme, step, window, pool };
    fellBack = true;
    theme = MIX_THEME;
    step = 0;
    window = puzzleWindow(input.rating, 0);
    pool = await candidatesIn(theme, window, input, cache, skip);
    while (pool.length < enough && step < PUZZLE_MAX_WIDEN_STEPS) {
      step += 1;
      window = puzzleWindow(input.rating, step);
      pool = await candidatesIn(theme, window, input, cache, skip);
    }
    // `mix` has even fewer (only possible with missing shards): keep the theme's own widest pool.
    if (pool.length < own.pool.length) ({ theme, step, window, pool } = own);
    fellBack = theme === MIX_THEME;
  }

  // Seeded sample of `need`, then warm-up order.
  const rnd = mulberry32(input.seed);
  const shuffled = [...pool].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
  }
  const fresh = shuffled.slice(0, need).sort((a, b) => a[3] - b[3] || (a[0] < b[0] ? -1 : 1));

  return {
    items: interleaveDue<PuzzlePickItem>(
      fresh.map((puzzle) => ({ source: "shard", puzzle }) as const),
      due.map((card) => ({ source: "card", card }) as const),
    ),
    theme,
    window,
    widened: step > 0 || fellBack ? displayWindow(window) : null,
  };
}

/** Puts due cards at every third slot (indices 2, 5, 8 …) between the new puzzles; leftovers go at the end. */
export function interleaveDue<T>(fresh: readonly T[], due: readonly T[]): T[] {
  const out: T[] = [];
  let f = 0;
  let d = 0;
  while (f < fresh.length || d < due.length) {
    const dueSlot = (out.length + 1) % PUZZLE_DUE_EVERY === 0;
    if ((dueSlot && d < due.length) || f >= fresh.length) out.push(due[d++]!);
    else out.push(fresh[f++]!);
  }
  return out;
}

// ── buildSession ───────────────────────────────────────────────────────────────────────────────────────────────

export type BuildSessionInputs =
  | {
      kind: "daily";
      now: Date;
      /** The frozen plan's bank step keys, when the plan has one. */
      frozenKeys: readonly string[] | null;
      dueCards: readonly BankCardIn[];
      capRemaining: number;
      newRemaining: number;
      /** The plan's puzzle step (`selectPuzzles` with count 3), or null when the plan has none. */
      puzzles: PuzzlePick | null;
    }
  | {
      kind: "bank";
      mode: "due";
      now: Date;
      dueCards: readonly BankCardIn[];
      capRemaining: number;
      newRemaining: number;
      /** A hub thumbnail's card goes first. */
      firstKey?: string;
      /** A filter (theme, phase, source) was applied to `dueCards`. */
      filtered: boolean;
      /** Due BANK cards before the filter (cap_reached vs nothing_matches). */
      dueRaw: number;
    }
  | {
      /** "Drill these {n} · nothing due": the current filtered list, list order, no cap. */
      kind: "bank";
      mode: "list";
      cards: readonly BankCardIn[];
    }
  | {
      /** `cardRefs` or `gameRef`: the given cards in the given order, no cap. */
      kind: "bank";
      mode: "explicit";
      cards: readonly BankCardIn[];
    }
  | {
      kind: "puzzles";
      pick: PuzzlePick;
      /** A fixed size (`count`), else the session streams (extends by 10 while 2 remain). */
      count?: number;
    }
  | {
      /** "Start Again": the keys of `fromSessionRef`, no previews, never reschedules. */
      kind: "practice";
      from: readonly { key: string; kind: SessionItemKindDb; pass: 1 | 2; puzzle?: PuzzleTuple }[];
    };

function bankItems(cards: readonly BankCardIn[], ids: string[], previews: boolean): PlannedItem[] {
  return cards.map((c, i) => ({ itemId: ids[i]!, key: c.key, kind: c.kind, pass: 1, previews }));
}

function puzzleItems(pick: PuzzlePick, ids: string[], offset = 0): PlannedItem[] {
  return pick.items.map((p, i) =>
    p.source === "shard"
      ? { itemId: ids[offset + i]!, key: `p_${p.puzzle[0]}`, kind: "LICHESS_PUZZLE", pass: 1, puzzle: p.puzzle, previews: true }
      : { itemId: ids[offset + i]!, key: p.card.key, kind: "LICHESS_PUZZLE", pass: 1, previews: true },
  );
}

const ids = (n: number) => nextItemIds([], n);

/** What `buildSession(kind, …)` takes for each kind. */
type DistOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type SessionInputsOf<K extends SessionKind> = DistOmit<Extract<BuildSessionInputs, { kind: K }>, "kind">;

/** Builds a session's item list (§8.6). See `BuildSessionInputs` for what each kind needs. */
export function buildSession<K extends SessionKind>(kind: K, rest: SessionInputsOf<K>): SessionPlan {
  return compose({ ...(rest as object), kind } as BuildSessionInputs);
}

function compose(inputs: BuildSessionInputs): SessionPlan {
  const base = { stream: false, targetCount: null, theme: null, widened: null } as const;
  switch (inputs.kind) {
    case "daily": {
      const ordered = orderDueQueue(inputs.dueCards, inputs.now);
      let bank: BankCardIn[];
      if (inputs.frozenKeys && inputs.frozenKeys.length > 0) {
        const byKey = new Map(ordered.map((c) => [c.key, c]));
        bank = inputs.frozenKeys.flatMap((k) => (byKey.has(k) ? [byKey.get(k)!] : [])).slice(0, inputs.capRemaining);
      } else {
        bank = takeUnderCap(ordered, { capRemaining: inputs.capRemaining, newRemaining: inputs.newRemaining });
      }
      const n = bank.length + (inputs.puzzles?.items.length ?? 0);
      const all = ids(n);
      const items = [...bankItems(bank, all, true), ...(inputs.puzzles ? puzzleItems(inputs.puzzles, all, bank.length) : [])];
      return {
        ...base,
        kind: "daily",
        countsTowardCap: true,
        items,
        empty: items.length === 0 ? "caughtup" : null,
        theme: inputs.puzzles?.theme ?? null,
        widened: inputs.puzzles?.widened ?? null,
      };
    }
    case "bank": {
      if (inputs.mode === "due") {
        const ordered = takeUnderCap(orderDueQueue(inputs.dueCards, inputs.now), inputs);
        const cards = keyFirst(ordered, inputs.firstKey);
        const items = bankItems(cards, ids(cards.length), true);
        let empty: EmptyReason | null = null;
        if (items.length === 0) {
          if (inputs.capRemaining === 0 && inputs.dueRaw > 0) empty = "cap_reached";
          else if (inputs.filtered && inputs.dueRaw > 0) empty = "nothing_matches";
          else empty = "caughtup";
        }
        return { ...base, kind: "bank", countsTowardCap: true, items, empty };
      }
      const cards = inputs.cards.slice(0, BANK_SESSION_MAX);
      const items = bankItems(cards, ids(cards.length), true);
      return { ...base, kind: "bank", countsTowardCap: false, items, empty: items.length === 0 ? "nothing_matches" : null };
    }
    case "puzzles": {
      const items = puzzleItems(inputs.pick, ids(inputs.pick.items.length));
      return {
        kind: "puzzles",
        countsTowardCap: false,
        items,
        empty: items.length === 0 ? "nothing_matches" : null,
        stream: inputs.count === undefined,
        targetCount: inputs.count ?? null,
        theme: inputs.pick.theme,
        widened: inputs.pick.widened,
      };
    }
    case "practice": {
      const seen = new Set<string>();
      const from = inputs.from.filter((it) => it.pass === 1 && !seen.has(it.key) && (seen.add(it.key), true));
      const all = ids(from.length);
      const items: PlannedItem[] = from.map((it, i) => ({
        itemId: all[i]!,
        key: it.key,
        kind: it.kind,
        pass: 1,
        ...(it.puzzle ? { puzzle: it.puzzle } : {}),
        previews: false,
      }));
      return { ...base, kind: "practice", countsTowardCap: false, items, empty: items.length === 0 ? "nothing_matches" : null };
    }
  }
}

/** Extend (§7.3 W3): new puzzle items after the existing ones, numbered on from them. */
export function extendItems(existing: readonly { itemId: string }[], pick: PuzzlePick): PlannedItem[] {
  return puzzleItems(pick, nextItemIds(existing, pick.items.length));
}
