// The Lichess monthly dump's PGN, read the way J5 needs it (phase-06 plan §7.4.5 steps 1–2): one game's headers and
// movetext, the per-ply `%eval` / `%clk` comments, and the screen that decides whether a game can be sampled at all.
// Pure (no I/O): the dump reader (dump.ts) hands in the text, the sampler (sampler.ts) keeps what passes.
//
// Lichess writes every game as a block of `[Tag "value"]` lines, a blank line, the movetext on one line and a blank
// line. Analysed games carry `{ [%eval 0.17] [%clk 0:03:00] }` after each move: the eval is White's view of the
// position after the move (pawns, or `#n` / `#-n` for a mate), the clock the mover's remaining time after it.

/** The time classes the baseline has cells for (classical and correspondence are skipped). */
export const SAMPLE_TIME_CLASSES = ["BULLET", "BLITZ", "RAPID"] as const;
export type SampleTimeClass = (typeof SAMPLE_TIME_CLASSES)[number];

/** Band keys are the lower edge of a 100-point Lichess rating cell, "600" … "2400" (plan §8.4: c ∈ [700, 2400]). */
export const BAND_MIN = 600;
export const BAND_MAX = 2400;
export const BAND_STEP = 100;
export const BAND_KEYS: readonly string[] = Array.from({ length: (BAND_MAX - BAND_MIN) / BAND_STEP + 1 }, (_, i) => String(BAND_MIN + i * BAND_STEP));

/** Games shorter than this are not sampled (plan §7.4.5 step 2). */
export const MIN_PLIES = 20;

/** Terminations that are not chess: an abandoned game and a game Lichess closed for a rules infraction (cheating). */
export const SKIPPED_TERMINATIONS: ReadonlySet<string> = new Set(["Abandoned", "Rules infraction", "Unterminated"]);

export interface PgnGame {
  headers: Record<string, string>;
  movetext: string;
}

/** A `%eval` value: centipawns (White's view) or a mate in n (positive: White mates). */
export type PgnEval = { cp: number } | { mate: number };

export interface ParsedMovetext {
  /** SAN of each ply, annotation glyphs (`?!`, `!!`, …) removed. */
  sans: string[];
  /** The `%eval` after each ply, or null where the comment has none. */
  evals: (PgnEval | null)[];
  /** The mover's remaining seconds after each ply (`%clk`), or null where the comment has none. */
  clocksSec: (number | null)[];
  /** The result token at the end of the movetext ("1-0", "0-1", "1/2-1/2", "*"), or null. */
  result: string | null;
}

/**
 * The plan's time class from the estimated duration `initial + 40 × increment` (Lichess's own speed rule; audit-api
 * F-28): < 180 s bullet (ultra-bullet included, as the importer folds it), < 480 blitz, < 1500 rapid. Classical,
 * correspondence ("-") and malformed values give null.
 */
export function timeClassOf(timeControl: string): SampleTimeClass | null {
  const m = /^(\d+)\+(\d+)$/.exec(timeControl.trim());
  if (!m) return null;
  const est = Number(m[1]) + 40 * Number(m[2]);
  if (est < 180) return "BULLET";
  if (est < 480) return "BLITZ";
  if (est < 1500) return "RAPID";
  return null;
}

/** `initialTimeSeconds` and `incrementSeconds` of a `TimeControl` header ("300+3" → [300, 3]). */
export function clockOf(timeControl: string): { initialSeconds: number; incrementSeconds: number } | null {
  const m = /^(\d+)\+(\d+)$/.exec(timeControl.trim());
  return m ? { initialSeconds: Number(m[1]), incrementSeconds: Number(m[2]) } : null;
}

/** The band key of a rating, or null outside 600 … 2499. */
export function bandOf(elo: number): string | null {
  if (!Number.isInteger(elo) || elo < BAND_MIN || elo >= BAND_MAX + BAND_STEP) return null;
  return String(Math.floor(elo / BAND_STEP) * BAND_STEP);
}

/** The Lichess game id of a `Site` header ("https://lichess.org/game/Q8ku5wgM" or "https://lichess.org/Q8ku5wgM" → "Q8ku5wgM"). */
export function gameIdOf(site: string | undefined): string | null {
  const m = /lichess\.org\/(?:game\/)?([A-Za-z0-9]{8})\b/.exec(site ?? "");
  return m ? (m[1] as string) : null;
}

const EVAL_RE = /\[%eval\s+(#?-?\d+(?:\.\d+)?)\]/;
const CLK_RE = /\[%clk\s+(\d+):(\d{2}):(\d{2}(?:\.\d+)?)\]/;
const RESULT_TOKENS: ReadonlySet<string> = new Set(["1-0", "0-1", "1/2-1/2", "*"]);

/** A `%eval` text ("0.17", "-3.5", "#4", "#-2") → PgnEval. */
export function parseEvalText(t: string): PgnEval | null {
  if (t.startsWith("#")) {
    const n = Number(t.slice(1));
    return Number.isInteger(n) ? { mate: n } : null;
  }
  const x = Number(t);
  return Number.isFinite(x) ? { cp: Math.round(x * 100) } : null;
}

/** Reads one movetext line (see the header). Comments attach to the ply before them. */
export function parseMovetext(text: string): ParsedMovetext {
  const sans: string[] = [];
  const evals: (PgnEval | null)[] = [];
  const clocksSec: (number | null)[] = [];
  let result: string | null = null;
  const n = text.length;
  let i = 0;
  while (i < n) {
    const ch = text[i] as string;
    if (ch === "{") {
      const j = text.indexOf("}", i + 1);
      const comment = text.slice(i + 1, j < 0 ? n : j);
      i = j < 0 ? n : j + 1;
      const last = sans.length - 1;
      if (last < 0) continue;
      const e = EVAL_RE.exec(comment);
      if (e) evals[last] = parseEvalText(e[1] as string);
      const c = CLK_RE.exec(comment);
      if (c) clocksSec[last] = Number(c[1]) * 3600 + Number(c[2]) * 60 + Number(c[3]);
      continue;
    }
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      i++;
      continue;
    }
    let j = i;
    while (j < n && text[j] !== " " && text[j] !== "{" && text[j] !== "\n") j++;
    const tok = text.slice(i, j);
    i = j;
    if (/^\d+\.+$/.test(tok) || tok.startsWith("$")) continue;
    if (RESULT_TOKENS.has(tok)) {
      result = tok;
      continue;
    }
    const san = tok.replace(/^\d+\.+/, "").replace(/[!?]+$/, "");
    if (san === "") continue;
    sans.push(san);
    evals.push(null);
    clocksSec.push(null);
  }
  return { sans, evals, clocksSec, result };
}

export interface ScreenedSide {
  color: "w" | "b";
  elo: number;
  band: string | null;
}

export type Screen =
  | { ok: true; id: string; tc: SampleTimeClass; sides: [ScreenedSide, ScreenedSide]; plies: number }
  | { ok: false; reason: string };

/** Counts `needle` in `s`. */
function count(s: string, needle: string): number {
  let k = 0;
  for (let at = s.indexOf(needle); at >= 0; at = s.indexOf(needle, at + needle.length)) k++;
  return k;
}

/** True when the movetext carries engine evaluations (Lichess analyses every ply or none). */
export function hasEvals(movetext: string): boolean {
  return movetext.includes("[%eval");
}

/**
 * The plan's filter (§7.4.5 step 2), cheap enough to run on every analysed game of the dump: standard and rated, both
 * Elo values, `%eval` on every ply (one short when the game ends in mate: the mated position has none, as the
 * importer's evalHintOf allows), `%clk` on every ply, ≥ 20 plies, no BOT on either side, a bullet / blitz / rapid time
 * control, and a chess ending (not abandoned, not closed for a rules infraction).
 */
export function screenGame(g: PgnGame): Screen {
  const h = g.headers;
  if (!(h.Event ?? "").startsWith("Rated")) return { ok: false, reason: "unrated" };
  if (h.Variant && h.Variant !== "Standard") return { ok: false, reason: "variant" };
  if (h.FEN || h.SetUp === "1") return { ok: false, reason: "from_position" };
  if (h.WhiteTitle === "BOT" || h.BlackTitle === "BOT") return { ok: false, reason: "bot" };
  if (SKIPPED_TERMINATIONS.has(h.Termination ?? "")) return { ok: false, reason: "termination" };
  const tc = timeClassOf(h.TimeControl ?? "-");
  if (!tc) return { ok: false, reason: "time_class" };
  const we = Number(h.WhiteElo);
  const be = Number(h.BlackElo);
  if (!Number.isInteger(we) || !Number.isInteger(be) || we <= 0 || be <= 0) return { ok: false, reason: "elo" };
  const id = gameIdOf(h.Site);
  if (!id) return { ok: false, reason: "site" };
  if (!hasEvals(g.movetext)) return { ok: false, reason: "no_eval" };
  const parsed = parseMovetext(g.movetext);
  const plies = parsed.sans.length;
  if (plies < MIN_PLIES) return { ok: false, reason: "short" };
  if (parsed.clocksSec.some((c) => c === null)) return { ok: false, reason: "clock" };
  const evalCount = count(g.movetext, "[%eval");
  const missing = parsed.evals.findIndex((e) => e === null);
  const endsInMate = (parsed.sans[plies - 1] ?? "").endsWith("#");
  const evalsOk = evalCount === plies ? missing < 0 : endsInMate && evalCount === plies - 1 && missing === plies - 1;
  if (!evalsOk) return { ok: false, reason: "eval_gaps" };
  return {
    ok: true,
    id,
    tc,
    plies,
    sides: [
      { color: "w", elo: we, band: bandOf(we) },
      { color: "b", elo: be, band: bandOf(be) },
    ],
  };
}

/** Tags a sampled game keeps (no player names: the per-side records never identify a player). */
export const KEPT_HEADERS = ["Event", "Site", "UTCDate", "UTCTime", "WhiteElo", "BlackElo", "Result", "ECO", "TimeControl", "Termination"] as const;

/** Parses the `[Tag "value"]` lines of one game. */
export function parseHeaderLine(line: string): [string, string] | null {
  const m = /^\[(\w+)\s+"((?:[^"\\]|\\.)*)"\]\s*$/.exec(line);
  return m ? [m[1] as string, (m[2] as string).replace(/\\(.)/g, "$1")] : null;
}

/**
 * Splits PGN text into games, line by line. Text that starts in the middle of a game (a dump chunk that begins
 * mid-frame) yields nothing until the first `[Event` line; a game whose movetext never arrived is dropped.
 */
export class PgnSplitter {
  private headers: Record<string, string> | null = null;
  private movetext: string | null = null;
  private carry = "";

  /** Feeds text; returns the games completed by it. */
  push(text: string): PgnGame[] {
    const out: PgnGame[] = [];
    const data = this.carry + text;
    const lines = data.split("\n");
    this.carry = lines.pop() ?? "";
    for (const line of lines) this.line(line, out);
    return out;
  }

  /** Ends the stream; the last game is returned only when the text ended after its movetext line. */
  end(complete: boolean): PgnGame[] {
    const out: PgnGame[] = [];
    if (complete && this.carry !== "") this.line(this.carry, out);
    this.carry = "";
    if (complete) this.flush(out);
    this.headers = null;
    this.movetext = null;
    return out;
  }

  private flush(out: PgnGame[]): void {
    if (this.headers && this.movetext !== null) out.push({ headers: this.headers, movetext: this.movetext });
    this.headers = null;
    this.movetext = null;
  }

  private line(raw: string, out: PgnGame[]): void {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (line.startsWith("[Event ")) {
      this.flush(out);
      this.headers = {};
    }
    if (line.startsWith("[")) {
      if (!this.headers || this.movetext !== null) return;
      const kv = parseHeaderLine(line);
      if (kv) this.headers[kv[0]] = kv[1];
      return;
    }
    if (line.trim() === "") return;
    if (this.headers && this.movetext === null) this.movetext = line;
  }
}
