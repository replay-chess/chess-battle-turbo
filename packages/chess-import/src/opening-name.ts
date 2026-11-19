// The opening name of a game, one rule for the import mappers (the analysis worker) and the web's read paths (the
// archive row, the review header, Home's Continue card), so a name stored before this rule existed is shown the same
// way as one stored after it.
//
// A provider name is kept when it is already a proper name: a book name (as stored: whole, cut at 80 chars by the
// worker, or cut between words by the mappers) or a "Family: Variation" name (Lichess, never a Chess.com slug).
// Otherwise (a Chess.com ECOUrl slug such as "Queens Indian Defense Spassky System 4...Bb7 5.Bd3 Bb4") the name comes
// from the book: the longest book line that is a prefix of the game's moves from the standard start, with that
// line's ECO. Only when the book has no such line is the provider's name kept, its move tail cut off
// (`stripMoveTail`) and its case untouched.
//
// The book is `opening-book.data.ts` (generated from the `openings` seed TSVs, ~400 kB): server code only — the
// mappers and the web's server read paths; never import this module into a client component.
import { OPENING_BOOK } from "./opening-book.data";
import { clipWords, OPENING_NAME_MAX } from "./types";

const INITIAL_BOARD = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -";

export interface GameOpening {
  /** `[A-E]\d\d` from the book line, else the provider's / stored code (may be null or invalid; callers check). */
  eco: string | null;
  name: string;
}

type Index = { byLine: Map<string, { eco: string; name: string }>; maxPlies: number; names: Set<string> };
let index: Index | null = null;

function bookIndex(): Index {
  if (index) return index;
  const byLine = new Map<string, { eco: string; name: string }>();
  const names = new Set<string>();
  let maxPlies = 0;
  for (const [eco, name, uci] of OPENING_BOOK) {
    if (!byLine.has(uci)) byLine.set(uci, { eco, name });
    maxPlies = Math.max(maxPlies, uci.split(" ").length);
    names.add(name).add(name.slice(0, OPENING_NAME_MAX)).add(clipWords(name, OPENING_NAME_MAX));
  }
  index = { byLine, maxPlies, names };
  return index;
}

const isStandardStart = (fen: string): boolean => fen.trim().split(/\s+/).slice(0, 4).join(" ") === INITIAL_BOARD;

/** The longest book line that is a prefix of the game's UCI moves (standard start only), or null. */
export function bookOpeningOf(startingFen: string, moves: string | readonly string[]): { eco: string; name: string } | null {
  if (!isStandardStart(startingFen)) return null;
  const uci = typeof moves === "string" ? (moves.trim() === "" ? [] : moves.trim().split(/\s+/)) : moves;
  const { byLine, maxPlies } = bookIndex();
  for (let n = Math.min(uci.length, maxPlies); n > 0; n--) {
    const hit = byLine.get(uci.slice(0, n).join(" "));
    if (hit) return hit;
  }
  return null;
}

/**
 * A provider name without its move tail: cut at the first move-number token ("5.", "4...", also glued to a "..."
 * as in "Variation...5.O-O"), then a trailing "...", "," ";" ":" "-" or space dropped. Case is kept. Null when
 * nothing is left.
 */
export function stripMoveTail(name: string | null | undefined): string | null {
  if (!name) return null;
  const m = /(?:^|\s|\.{2,})\d+\.(?:\.\.)?/.exec(name);
  const head = (m ? name.slice(0, m.index) : name).replace(/[\s.,;:\-…]+$/, "").trim();
  return head === "" ? null : head;
}

/** A name that is already proper: a book name as stored, or a "Family: Variation" name (Lichess). */
function isProperName(name: string): boolean {
  return bookIndex().names.has(name) || name.includes(":");
}

/** The game's opening by the rule above, or null when there is neither a name nor a book line. */
export function openingOfGame(game: {
  name: string | null | undefined;
  eco: string | null | undefined;
  startingFen: string;
  moves: string | readonly string[];
}): GameOpening | null {
  const name = game.name?.trim() || null;
  if (name && isProperName(name)) return { eco: game.eco ?? null, name: stripMoveTail(name) ?? name };
  const book = bookOpeningOf(game.startingFen, game.moves);
  if (book) return { eco: book.eco, name: book.name };
  const stripped = stripMoveTail(name);
  return stripped ? { eco: game.eco ?? null, name: stripped } : null;
}
