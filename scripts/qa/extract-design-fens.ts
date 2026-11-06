/**
 * Extracts the chess positions the game designs use (phase-02 plan 12.2, testing X13) into
 * packages/chess-fixtures/design/<Board>.json (+ index.json), so tests and golden transcripts replay the designers' lines
 * instead of hand copies, and a design typo fails `packages/chess-fixtures/test/design.test.ts` instead of
 * becoming a test expectation.
 *
 * For every `v2/*.dc.html` board whose DCLogic data (`this._d = {…}`) has move lines (`L`), it writes:
 *   - lines: each line's start FEN, first move number, the ply where the game starts ("Game starts here"),
 *     the SAN and UCI moves, and the design's position after each ply (placement + side to move);
 *   - states: per design state (`C`), the line and ply it shows, the marks it draws (last move, rings,
 *     arrows, highlighted squares), the ghost piece, the promotion picker FENs and the end-of-game badges.
 *
 * The design reference (DR) is not in the repo, so the owner runs this once and again whenever the designs
 * change, then commits the JSON:
 *
 *   pnpm exec tsx scripts/qa/extract-design-fens.ts --design <DR dir> [--out packages/chess-fixtures/design]
 *     [--boards V3Game,V3iPhoneGame]
 *
 * <DR dir> is the folder that holds `v2/` (e.g. <scratchpad>/design-ref/project). No chess library is needed
 * here: the fixtures test replays every line with chess.js.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const INITIAL_PLACEMENT = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR";

/** One design ply: [san, from, to, "placement side"]. */
type DesignPly = [string, string, string, string];
type DesignLine = { s: string; no: number; tu: "w" | "b"; g: number; p: DesignPly[] };

export type FixtureLine = {
  startFen: string;
  startMoveNo: number;
  /** Plies before "Game starts here" (the legend prefix). */
  gameStartsAtPly: number;
  san: string[];
  uci: string[];
  /** The design's "placement side" after each ply, compared with chess.js by the fixtures test. */
  designFens: string[];
};

export type FixtureState = {
  line: string;
  ply: number;
  turn: "w" | "b" | null;
  meSide: "w" | "b";
  lastMove: [string, string] | null;
  rings: Record<string, string>;
  highlights: string[];
  arrows: { from: string; to: string; color: string }[];
  ghost: { square: string; piece: string } | null;
  promotion: { square: string; color: string; fens: Record<string, string> } | null;
  badges: { square: string; kind: string }[];
  viewPly: number | null;
  clocks: { w: number | null; b: number | null };
};

export type DesignFixture = {
  $comment: string;
  board: string;
  source: string;
  lines: Record<string, FixtureLine>;
  states: Record<string, FixtureState>;
};

/** Returns the object literal assigned to `this._d` in a DCLogic board, or null. */
export function readBoardData(html: string): Record<string, unknown> | null {
  const marker = "this._d = ";
  const i = html.indexOf(marker);
  if (i < 0) return null;
  let j = i + marker.length;
  let depth = 0;
  let inStr: string | null = null;
  let esc = false;
  for (; j < html.length; j++) {
    const ch = html[j]!;
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === inStr) inStr = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      inStr = ch;
      continue;
    }
    if (ch === "{") depth++;
    if (ch === "}") {
      depth--;
      if (depth === 0) {
        j++;
        break;
      }
    }
  }
  const literal = html.slice(i + marker.length, j);
  return vm.runInNewContext(`(${literal})`, {}, { timeout: 1000 }) as Record<string, unknown>;
}

/** Full FEN for a design placement: castling rights where king and rook stand on their home squares. */
export function fullFen(placement: string, turn: "w" | "b", moveNo: number): string {
  const rows = placement.split("/");
  const at = (file: string, rank: number) => {
    const row = rows[8 - rank] ?? "";
    let f = 0;
    for (const ch of row) {
      if (/\d/.test(ch)) {
        f += Number(ch);
        continue;
      }
      if ("abcdefgh"[f] === file) return ch;
      f++;
    }
    return "";
  };
  let castling = "";
  if (at("e", 1) === "K") {
    if (at("h", 1) === "R") castling += "K";
    if (at("a", 1) === "R") castling += "Q";
  }
  if (at("e", 8) === "k") {
    if (at("h", 8) === "r") castling += "k";
    if (at("a", 8) === "r") castling += "q";
  }
  if (placement === INITIAL_PLACEMENT) castling = "KQkq";
  return `${placement} ${turn} ${castling || "-"} - 0 ${moveNo}`;
}

function promoOf(san: string): string {
  const m = /=([QRBN])/.exec(san);
  return m ? m[1]!.toLowerCase() : "";
}

export function toFixtureLine(l: DesignLine): FixtureLine {
  return {
    startFen: fullFen(l.s, l.tu, l.no),
    startMoveNo: l.no,
    gameStartsAtPly: l.g,
    san: l.p.map((p) => p[0]),
    uci: l.p.map((p) => `${p[1]}${p[2]}${promoOf(p[0])}`),
    designFens: l.p.map((p) => p[3]),
  };
}

type DesignState = {
  line?: string;
  ply?: number;
  turn?: "w" | "b";
  meSide?: "w" | "b";
  cw?: number;
  cb?: number;
  view?: number | null;
  ghost?: { sq: string; p: string } | null;
  promo?: { sq: string; c: string; fens: Record<string, string> } | null;
  badges?: { sq: string; k: string }[];
  marks?: {
    last?: [string, string];
    hl?: Record<string, string>;
    ring?: Record<string, string>;
    arrows?: { f: string; t: string; c: string }[];
  };
};

export function toFixtureState(c: DesignState): FixtureState {
  const m = c.marks ?? {};
  return {
    line: c.line ?? "MAIN",
    ply: c.ply ?? 0,
    turn: c.turn ?? null,
    meSide: c.meSide ?? "w",
    lastMove: m.last ? [m.last[0], m.last[1]] : null,
    rings: { ...(m.ring ?? {}) },
    highlights: Object.keys(m.hl ?? {}).sort(),
    arrows: (m.arrows ?? []).map((a) => ({ from: a.f, to: a.t, color: a.c })),
    ghost: c.ghost ? { square: c.ghost.sq, piece: c.ghost.p } : null,
    promotion: c.promo ? { square: c.promo.sq, color: c.promo.c, fens: { ...c.promo.fens } } : null,
    badges: (c.badges ?? []).map((b) => ({ square: b.sq, kind: b.k })),
    viewPly: c.view ?? null,
    clocks: { w: c.cw ?? null, b: c.cb ?? null },
  };
}

export function extractBoard(board: string, html: string): DesignFixture | null {
  const d = readBoardData(html);
  if (!d || !d.L || typeof d.L !== "object") return null;
  const lines: Record<string, FixtureLine> = {};
  for (const [name, l] of Object.entries(d.L as Record<string, DesignLine>)) lines[name] = toFixtureLine(l);
  const states: Record<string, FixtureState> = {};
  for (const [name, c] of Object.entries((d.C ?? {}) as Record<string, DesignState>)) states[name] = toFixtureState(c);
  return {
    $comment: `Generated by scripts/qa/extract-design-fens.ts from v2/${board}.dc.html. Do not edit by hand; re-run the script.`,
    board,
    source: `v2/${board}.dc.html`,
    lines,
    states,
  };
}

function args(argv: string[]): { design: string; out: string; boards: string[] | null } {
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const design = get("--design");
  if (!design) throw new Error("usage: extract-design-fens.ts --design <DR dir> [--out dir] [--boards A,B]");
  return {
    design,
    out: get("--out") ?? path.join(ROOT, "packages/chess-fixtures/design"),
    boards:
      get("--boards")
        ?.split(",")
        .map((s) => s.trim()) ?? null,
  };
}

export function main(argv = process.argv.slice(2)): void {
  const a = args(argv);
  const dir = path.join(a.design, "v2");
  if (!existsSync(dir)) throw new Error(`no v2/ folder under ${a.design}`);
  const boards =
    a.boards ??
    readdirSync(dir)
      .filter((f) => /^V3.*\.dc\.html$/.test(f))
      .map((f) => f.replace(/\.dc\.html$/, ""))
      .sort();
  mkdirSync(a.out, { recursive: true });
  // Most boards are the same template with a different default state: identical data is written once, under the
  // canonical board (V3Game when it is in the group), and index.json maps every board to its file.
  const byContent = new Map<string, { canonical: string; boards: string[]; fixture: DesignFixture }>();
  for (const board of boards) {
    const file = path.join(dir, `${board}.dc.html`);
    if (!existsSync(file)) {
      console.warn(`skip ${board}: no file`);
      continue;
    }
    const fixture = extractBoard(board, readFileSync(file, "utf8"));
    if (!fixture) continue;
    const key = JSON.stringify([fixture.lines, fixture.states]);
    const group = byContent.get(key);
    if (group) {
      group.boards.push(board);
      if (board === "V3Game") group.canonical = board;
    } else byContent.set(key, { canonical: board, boards: [board], fixture });
  }
  const index: Record<string, string> = {};
  for (const g of byContent.values()) {
    const fixture: DesignFixture = {
      ...g.fixture,
      board: g.canonical,
      source: `v2/${g.canonical}.dc.html`,
      $comment: `Generated by scripts/qa/extract-design-fens.ts from v2/${g.canonical}.dc.html (identical data in: ${g.boards.join(", ")}). Do not edit by hand; re-run the script.`,
    };
    writeFileSync(path.join(a.out, `${g.canonical}.json`), `${JSON.stringify(fixture, null, 2)}\n`);
    for (const b of g.boards) index[b] = `${g.canonical}.json`;
    console.log(
      `${g.canonical}.json: ${Object.keys(fixture.lines).length} lines, ${Object.keys(fixture.states).length} states, ${g.boards.length} board(s)`,
    );
  }
  const sorted = Object.fromEntries(Object.entries(index).sort(([x], [y]) => x.localeCompare(y)));
  writeFileSync(
    path.join(a.out, "index.json"),
    `${JSON.stringify({ $comment: "Board → fixture file (generated by scripts/qa/extract-design-fens.ts).", boards: sorted }, null, 2)}\n`,
  );
  console.log(`wrote ${byContent.size} fixture file(s) + index.json to ${path.relative(ROOT, a.out) || a.out}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
