// The J5 sample (phase-06 plan §7.4.5 step 3): a reservoir of player sides per (100-point band 600–2400 × {BULLET,
// BLITZ, RAPID}) cell. Each eligible game contributes ONE side — the one whose cell has seen fewer offers so far (the
// cell "not yet full"; a tie goes to a bit of the game id's hash) — so a game is never counted twice and the scarce
// cells fill first. Every cell is an Algorithm-R reservoir: after any number of offers it holds a uniform sample of
// the sides offered to it. The PRNG is seeded and its state is part of the checkpoint, so a resumed run continues
// exactly where it stopped and the same input always gives the same sample. Pure (no I/O).
//
// A cell may be CLOSED before the input ends (chunk mode, sample.ts): once it has seen `closeFactor × cap` offers over
// enough chunks, its reservoir is final — a uniform sample of every side offered to it over the chunks read so far —
// and later games give their side to the other cell (or nothing). Closed cells can be graded while the scarce cells
// keep collecting.
import { BAND_KEYS, SAMPLE_TIME_CLASSES, type SampleTimeClass, type ScreenedSide } from "./pgn";

/** One sampled side: the game (kept headers + movetext) and which side of it the cell measures. */
export interface SampleItem {
  id: string;
  tc: SampleTimeClass;
  band: string;
  color: "w" | "b";
  elo: number;
  headers: Record<string, string>;
  movetext: string;
}

export interface CellState {
  offers: number;
  items: SampleItem[];
  /** Chunks processed when the cell was closed, or null while it is open. */
  closedAt?: number | null;
}

export interface SamplerState {
  cap: number;
  /** mulberry32 state (uint32). */
  rng: number;
  cells: Record<string, CellState>;
}

/** "1200:BLITZ" */
export function cellKey(band: string, tc: SampleTimeClass): string {
  return `${band}:${tc}`;
}

export function allCellKeys(): string[] {
  return BAND_KEYS.flatMap((b) => SAMPLE_TIME_CLASSES.map((tc) => cellKey(b, tc)));
}

/** FNV-1a 32-bit hash of a string (stable tie-breaks). */
export function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export class Sampler {
  readonly state: SamplerState;

  constructor(state: SamplerState) {
    this.state = state;
  }

  static fresh(cap: number, seed: number): Sampler {
    const cells: Record<string, CellState> = {};
    for (const k of allCellKeys()) cells[k] = { offers: 0, items: [] };
    return new Sampler({ cap, rng: seed >>> 0, cells });
  }

  /** mulberry32 over the stored state (the same generator TRN's session shuffle uses). */
  private random(): number {
    this.state.rng = (this.state.rng + 0x6d2b79f5) >>> 0;
    let t = this.state.rng;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** The side a game would contribute (see the header), or null when neither side has a cell. */
  chooseSide(id: string, tc: SampleTimeClass, sides: readonly ScreenedSide[]): ScreenedSide | null {
    const open = sides.filter((s) => s.band !== null && !this.isClosed(cellKey(s.band, tc)));
    if (open.length === 0) return null;
    if (open.length === 1) return open[0] as ScreenedSide;
    const [a, b] = open as [ScreenedSide, ScreenedSide];
    // Either open side with equal chance, from a bit of the game id's hash (deterministic, resumable). FIX-1: giving
    // the side to "the cell with fewer offers" made populous cells hand their cross-band games to their neighbours,
    // so low bands were sampled mostly against stronger opponents and high bands against weaker ones (1200: +88 vs a
    // true +17 in the review's simulation). The choice no longer looks at the cells.
    return (fnv1a(id) & 1) === 0 ? a : b;
  }

  /** Offers one eligible game; returns the cell it went to (or null). */
  offer(item: Omit<SampleItem, "color" | "elo" | "band">, sides: readonly ScreenedSide[]): string | null {
    const side = this.chooseSide(item.id, item.tc, sides);
    if (!side) return null;
    const key = cellKey(side.band as string, item.tc);
    const cell = this.state.cells[key]!;
    cell.offers += 1;
    const full: SampleItem = { ...item, color: side.color, elo: side.elo, band: side.band as string };
    if (cell.items.length < this.state.cap) cell.items.push(full);
    else {
      const j = Math.floor(this.random() * cell.offers);
      if (j < this.state.cap) cell.items[j] = full;
    }
    return key;
  }

  isClosed(key: string): boolean {
    const c = this.state.cells[key];
    return c !== undefined && c.closedAt !== undefined && c.closedAt !== null;
  }

  /** Closes every open cell with ≥ factor × cap offers; returns the keys closed now. */
  closeFull(factor: number, chunksDone: number): string[] {
    const out: string[] = [];
    for (const [k, c] of Object.entries(this.state.cells)) {
      if (this.isClosed(k) || c.offers < factor * this.state.cap) continue;
      c.closedAt = chunksDone;
      out.push(k);
    }
    return out;
  }

  /** Closes every open cell (end of the sample); returns the keys closed now. */
  closeAll(chunksDone: number): string[] {
    const out: string[] = [];
    for (const [k, c] of Object.entries(this.state.cells)) {
      if (this.isClosed(k)) continue;
      c.closedAt = chunksDone;
      out.push(k);
    }
    return out;
  }

  offers(key: string): number {
    return this.state.cells[key]?.offers ?? 0;
  }

  /** True when every cell outside `exempt` has seen at least `target` offers. */
  satisfied(target: number, exempt: (key: string) => boolean): boolean {
    return Object.entries(this.state.cells).every(([k, c]) => exempt(k) || c.offers >= target);
  }
}

/**
 * The first `n` items of a cell in a seeded random order: a uniform subsample of a uniform sample (used when the per-cell
 * size is lowered after sampling, and to pick the calibration sides).
 */
export function subsample<T>(items: readonly T[], n: number, seed: number): T[] {
  const a = [...items];
  let s = seed >>> 0;
  const rnd = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j] as T, a[i] as T];
  }
  return a.slice(0, n);
}
