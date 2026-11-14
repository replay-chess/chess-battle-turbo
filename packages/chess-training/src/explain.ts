// The deterministic explainer (phase-05 plan §8.12; data-model D7): the coach lines of a bank card or a puzzle,
// computed at read time from the position, the solution line, the move played in the game and the engine numbers.
// Every sentence states something the board shows (chess.js 1.4: legal moves, `attackers`), so it carries the
// VERIFIED tag; the one fallback that names nothing specific ("Not the move. {hint}") is `verified: false`. P7 replaces
// these strings with verified LLM text stored in `Mistake.texts`. Pure; server-side (the payload carries the texts).
//
// Evaluations are worded from the member's side with a sign and one decimal (cp / 100, "+2.7"); mate as "M{n}".
import { Chess, type Color, type Move, type PieceSymbol, type Square } from "chess.js";

export type ExplainKind = "mistake" | "review_position" | "puzzle";

export interface ExplainInput {
  /** The position the member moves in (after the setup move, if any). */
  fen: string;
  /** UCI from the member's first move: best, reply, best … */
  solution: readonly string[];
  /** Bank items: the move the member played in the game. */
  playedUci?: string | null;
  /** Bank items: the opponent's best reply to the played move (`mistakes."refuteUci"`). */
  refuteUci?: string | null;
  /** Member POV, centipawns, after the best move. */
  cpBest?: number | null;
  /** Member POV: moves to mate (positive: the member mates). */
  mateBest?: number | null;
  /** The primary theme key (`themes.ts`). */
  theme: string;
  kind: ExplainKind;
}

export interface ExplainTexts {
  hint: string;
  /** Puzzles' "This puzzle" line; null for bank items. */
  look: string | null;
  correct: string;
  /** Bank items: the line when the member repeats the game move. */
  wrongGameMove: string | null;
  /** Bank items: the context card ("Rxf5 won a bishop here, about +2.7 for you. Qd2 let it go."). */
  costText: string | null;
  verified: boolean;
}

const NAME: Record<PieceSymbol, string> = { p: "pawn", n: "knight", b: "bishop", r: "rook", q: "queen", k: "king" };
const VALUE: Record<PieceSymbol, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };
const SIDE: Record<Color, string> = { w: "White", b: "Black" };
const NUMBER_WORD = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight"];
const FILES = "abcdefgh";
const SQUARES: Square[] = Array.from({ length: 64 }, (_, i) => `${FILES[i % 8]}${8 - Math.floor(i / 8)}` as Square);

const other = (c: Color): Color => (c === "w" ? "b" : "w");
const word = (n: number) => NUMBER_WORD[n] ?? String(n);

function listJoin(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** "+2.7", "-0.4", "M3". */
export function evalText(cp: number | null | undefined, mate?: number | null): string | null {
  if (mate !== null && mate !== undefined && mate !== 0) return mate > 0 ? `M${mate}` : `-M${-mate}`;
  if (cp === null || cp === undefined) return null;
  const v = Math.round(cp / 10) / 10;
  if (v === 0) return "0.0";
  return `${v > 0 ? "+" : "-"}${Math.abs(v).toFixed(1)}`;
}

function board(fen: string): Chess | null {
  try {
    return new Chess(fen);
  } catch {
    return null;
  }
}

function play(chess: Chess, uci: string | null | undefined): Move | null {
  if (!uci || uci.length < 4) return null;
  try {
    return chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), ...(uci.length > 4 ? { promotion: uci[4] } : {}) });
  } catch {
    return null;
  }
}

/** Plays `line` from `fen`; the moves made (stops at the first illegal one). */
function playLine(fen: string, line: readonly string[]): { chess: Chess; moves: Move[] } | null {
  const chess = board(fen);
  if (!chess) return null;
  const moves: Move[] = [];
  for (const uci of line) {
    const m = play(chess, uci);
    if (!m) break;
    moves.push(m);
  }
  return { chess, moves };
}

interface Target {
  sq: Square;
  type: PieceSymbol;
}

/** Enemy pieces the piece on `from` attacks in `chess` (king first, then by value, then square). */
function attackedBy(chess: Chess, from: Square, opts: { pawns?: boolean } = {}): Target[] {
  const piece = chess.get(from);
  if (!piece) return [];
  const out: Target[] = [];
  for (const sq of SQUARES) {
    const p = chess.get(sq);
    if (!p || p.color === piece.color) continue;
    if (p.type === "p" && !opts.pawns) continue;
    if (chess.attackers(sq, piece.color).includes(from)) out.push({ sq, type: p.type });
  }
  return out.sort((a, b) => VALUE[b.type] - VALUE[a.type] || (a.sq < b.sq ? -1 : 1));
}

/** The fork targets of the moved piece (§8.11 R-THM-05): the king, and non-pawn pieces worth more than it or undefended. */
function forkTargets(chess: Chess, to: Square): Target[] {
  const mover = chess.get(to);
  if (!mover) return [];
  return attackedBy(chess, to).filter((t) => t.type === "k" || VALUE[t.type] > VALUE[mover.type] || chess.attackers(t.sq, other(mover.color)).length === 0);
}

/** "the king, the queen and the rook" (with squares when a type repeats or `squares` is set). */
function targetList(targets: readonly Target[], squares = false): string {
  const counts = new Map<PieceSymbol, number>();
  for (const t of targets) counts.set(t.type, (counts.get(t.type) ?? 0) + 1);
  return listJoin(targets.map((t) => (t.type !== "k" && (squares || counts.get(t.type)! > 1) ? `the ${NAME[t.type]} on ${t.sq}` : `the ${NAME[t.type]}`)));
}

/** The cheapest piece of `color` that attacks `sq`. */
function cheapestAttacker(chess: Chess, sq: Square, color: Color): Target | null {
  const list = chess.attackers(sq, color).map((s) => ({ sq: s, type: chess.get(s)!.type }));
  list.sort((a, b) => VALUE[a.type] - VALUE[b.type] || (a.sq < b.sq ? -1 : 1));
  return list[0] ?? null;
}

function pawnsOnFile(chess: Chess, color: Color, file: string): number {
  let n = 0;
  for (let r = 1; r <= 8; r++) {
    const p = chess.get(`${file}${r}` as Square);
    if (p && p.type === "p" && p.color === color) n += 1;
  }
  return n;
}

/** "doubled e-pawns" / "an isolated e-pawn" after a pawn lands on `sq`, or null when the structure is fine. */
function pawnDamage(chess: Chess, color: Color, sq: Square): { phrase: string; are: string; endsUp: string } | null {
  const file = sq[0]!;
  if (pawnsOnFile(chess, color, file) >= 2) return { phrase: `doubled ${file}-pawns`, are: `your ${file}-pawns are doubled`, endsUp: `your ${file}-pawns end up doubled` };
  const i = FILES.indexOf(file);
  const left = i > 0 ? pawnsOnFile(chess, color, FILES[i - 1]!) : 0;
  const right = i < 7 ? pawnsOnFile(chess, color, FILES[i + 1]!) : 0;
  if (left + right === 0) return { phrase: `an isolated ${file}-pawn`, are: `your ${file}-pawn is isolated`, endsUp: `your ${file}-pawn ends up isolated` };
  return null;
}

/** The first move of `line` in SAN, or the UCI when it is not legal in `fen`. */
function sanOf(fen: string, uci: string): string {
  const chess = board(fen);
  const m = chess ? play(chess, uci) : null;
  return m ? m.san : uci;
}

/** The member's colour (side to move in `fen`). */
function sideToMove(fen: string): Color {
  return fen.split(" ")[1] === "b" ? "b" : "w";
}

// ── Theme look lines (puzzles' "This puzzle") ──────────────────────────────────────────────────────────────────

const LOOK: Record<string, string> = {
  fork: "Look for one square where a piece attacks two things.",
  pin: "Look for a piece that cannot move without exposing a bigger one behind it.",
  skewer: "Look for a line with a valuable piece standing in front of another.",
  hangingPiece: "Look for a piece nobody defends.",
  discoveredAttack: "Look for a piece that can step out of the way of another.",
  doubleCheck: "Look for a move that gives check with two pieces at once.",
  capturingDefender: "Look for the piece that holds everything together, and take it.",
  trappedPiece: "Look for an enemy piece with no safe square.",
  sacrifice: "Look for a forcing move that gives material and gets more back.",
  deflection: "Look for a way to pull a defender away from its job.",
  attraction: "Look for a way to lure a piece onto a bad square.",
  backRankMate: "Look at the back rank. The king has no way out.",
  mateIn1: "Look for a check the king cannot escape.",
  mateIn2: "Look for forcing checks that end in mate.",
  mateIn3: "Look for forcing checks that end in mate.",
  mate: "Look for forcing checks that end in mate.",
  defensiveMove: "Look at what your opponent threatens first.",
  rookEndgame: "Count the pawns and find the most active rook move.",
  pawnEndgame: "Count the squares: which pawn gets there first?",
  promotion: "Look for a pawn that can reach the last rank.",
};

export function lookText(theme: string): string {
  return LOOK[theme] ?? "Look for checks, captures and threats first.";
}

// ── Correct lines ──────────────────────────────────────────────────────────────────────────────────────────────

interface Ctx {
  input: ExplainInput;
  me: Color;
  opp: Color;
  best: Move;
  after: Chess;
  line: Move[];
  ev: string | null;
}

function mateLine(c: Ctx): string | null {
  const full = playLine(c.input.fen, c.input.solution);
  const mates = full !== null && full.chess.isCheckmate() && full.moves.length === c.input.solution.length;
  const n = c.input.mateBest && c.input.mateBest > 0 ? c.input.mateBest : mates ? Math.ceil(c.input.solution.length / 2) : null;
  if (n === null) return null;
  if (n === 1) return `${c.best.san} is mate.`;
  return `${c.best.san} forces mate in ${n}.`;
}

function forkLine(c: Ctx): string | null {
  const targets = forkTargets(c.after, c.best.to);
  if (targets.length < 2) return laterForkLine(c);
  const check = targets.some((t) => t.type === "k");
  let text: string;
  if (check) {
    text = `${c.best.san} hits ${targetList(targets)} at once.`;
  } else {
    text = `${c.best.san} forks ${targetList(targets, true)}.`;
    // The mover stands next to the king and is defended: say why it cannot be taken.
    const kingTakes = c.after.attackers(c.best.to, c.opp).filter((s) => c.after.get(s)?.type === "k");
    const onlyKing = kingTakes.length > 0 && c.after.attackers(c.best.to, c.opp).length === kingTakes.length;
    const guard = cheapestAttacker(c.after, c.best.to, c.me);
    if (onlyKing && guard) text += ` The king can’t take back because your ${NAME[guard.type]} guards ${c.best.to}.`;
  }
  const [, reply, next] = c.line;
  if (reply && next) {
    const lead = reply.piece === "k" ? "After the king moves" : `After ${reply.san}`;
    const full = playLine(c.input.fen, c.input.solution.slice(0, 3));
    if (full && full.chess.isCheckmate()) text += ` ${lead}, ${next.san} is mate.`;
    else if (next.captured) text += ` ${lead}, ${next.san} wins the ${NAME[next.captured]}.`;
  }
  return text;
}

/** The fork comes later in the line: "Bxc4 sets up Nd6+, which hits the king and the rook at once." */
function laterForkLine(c: Ctx): string | null {
  for (let i = 2; i < c.line.length; i += 2) {
    const m = c.line[i]!;
    const targets = forkTargets(new Chess(m.after), m.to);
    if (targets.length >= 2) {
      const how = targets.some((t) => t.type === "k") ? `hits ${targetList(targets)} at once` : `forks ${targetList(targets, true)}`;
      return `${c.best.san} sets up ${m.san}, which ${how}.`;
    }
  }
  return null;
}

function loosePieceLine(c: Ctx): string | null {
  const capture = c.best.captured ? c.best : c.line.find((m, i) => i % 2 === 0 && m.captured);
  if (!capture || !capture.captured) return null;
  const before = board(capture.before);
  if (!before) return null;
  if (before.attackers(capture.to, c.opp).length > 0) return null;
  const tail = c.ev ? `, and the engine rates the position about ${c.ev}.` : ".";
  const lead = capture === c.best ? `${c.best.san} wins the ${NAME[capture.captured]}` : `${c.best.san} goes after the ${NAME[capture.captured]} on ${capture.to}`;
  return `${lead}. Nothing of ${SIDE[c.opp]}’s defends ${capture.to}${tail}`;
}

/** First pieces along each ray from the moved slider: [front, behind] pairs of enemy pieces. */
function rayPairs(chess: Chess, from: Square): [Target, Target][] {
  const piece = chess.get(from);
  if (!piece || !"brq".includes(piece.type)) return [];
  const dirs: [number, number][] = [];
  if (piece.type !== "b") dirs.push([1, 0], [-1, 0], [0, 1], [0, -1]);
  if (piece.type !== "r") dirs.push([1, 1], [1, -1], [-1, 1], [-1, -1]);
  const f0 = FILES.indexOf(from[0]!);
  const r0 = Number(from[1]);
  const out: [Target, Target][] = [];
  for (const [df, dr] of dirs) {
    const found: Target[] = [];
    let f = f0 + df;
    let r = r0 + dr;
    while (f >= 0 && f < 8 && r >= 1 && r <= 8 && found.length < 2) {
      const sq = `${FILES[f]}${r}` as Square;
      const p = chess.get(sq);
      if (p) {
        if (p.color === piece.color) break;
        found.push({ sq, type: p.type });
      }
      f += df;
      r += dr;
    }
    if (found.length === 2) out.push([found[0]!, found[1]!]);
  }
  return out;
}

function pinLine(c: Ctx): string | null {
  const pair = rayPairs(c.after, c.best.to).find(([front, behind]) => front.type !== "k" && VALUE[behind.type] > VALUE[front.type]);
  if (!pair) return null;
  return `${c.best.san} pins the ${NAME[pair[0].type]} on ${pair[0].sq} to the ${NAME[pair[1].type]}.`;
}

function skewerLine(c: Ctx): string | null {
  const pair = rayPairs(c.after, c.best.to).find(([front, behind]) => VALUE[front.type] > VALUE[behind.type]);
  if (!pair) return null;
  return `${c.best.san} skewers the ${NAME[pair[0].type]}; the ${NAME[pair[1].type]} behind it falls next.`;
}

function discoveredLine(c: Ctx): string | null {
  const before = board(c.input.fen);
  if (!before) return null;
  for (const sq of SQUARES) {
    const p = c.after.get(sq);
    if (!p || p.color !== c.opp || p.type === "p") continue;
    const now = c.after.attackers(sq, c.me).filter((s) => s !== c.best.to);
    const was = before.attackers(sq, c.me);
    const fresh = now.find((s) => !was.includes(s));
    if (fresh) {
      const by = NAME[c.after.get(fresh)!.type];
      return p.type === "k" ? `${c.best.san} uncovers a check from your ${by}.` : `${c.best.san} uncovers your ${by}'s attack on the ${NAME[p.type]}.`;
    }
  }
  return null;
}

/** Material the member wins over the whole line: the biggest piece taken. */
function materialLine(c: Ctx): string | null {
  const taken = c.line.filter((m, i) => i % 2 === 0 && m.captured).map((m) => m.captured!);
  const lost = c.line.filter((m, i) => i % 2 === 1 && m.captured).map((m) => m.captured!);
  const gain = taken.reduce((s, p) => s + VALUE[p], 0) - lost.reduce((s, p) => s + VALUE[p], 0);
  if (gain < 1 || taken.length === 0) return null;
  const biggest = [...taken].sort((a, b) => VALUE[b] - VALUE[a])[0]!;
  const tail = c.ev ? ` The engine rates the position about ${c.ev}.` : "";
  return `${c.best.san} wins the ${NAME[biggest]}.${tail}`;
}

// ── Review positions (`rc:*`) ──────────────────────────────────────────────────────────────────────────────────

interface Recapture {
  sq: Square;
  refute: Move;
  recapture: Move;
  damage: NonNullable<ReturnType<typeof pawnDamage>>;
  guard: PieceSymbol;
}

/** The played move lets the opponent capture on a square the member can only take back with a pawn that is damaged. */
function recaptureFacts(c: Ctx): Recapture | null {
  const { playedUci, refuteUci } = c.input;
  if (!playedUci || !refuteUci) return null;
  const chess = board(c.input.fen);
  if (!chess || !play(chess, playedUci)) return null;
  const refute = play(chess, refuteUci);
  if (!refute || !refute.captured) return null;
  const pawnTakes = chess.moves({ verbose: true }).filter((m) => m.to === refute.to && m.piece === "p");
  for (const m of pawnTakes) {
    const probe = new Chess(chess.fen());
    const recapture = play(probe, m.lan);
    if (!recapture) continue;
    const damage = pawnDamage(probe, c.me, refute.to);
    // The best move must keep a piece ready to take back on that square.
    if (damage && c.after.attackers(refute.to, c.me).includes(c.best.to)) return { sq: refute.to, refute, recapture, damage, guard: c.best.piece };
  }
  return null;
}

interface DefendedTarget {
  sq: Square;
  defender: Target;
  mover: PieceSymbol;
  captured: PieceSymbol;
}

function defendedTargetFacts(c: Ctx): DefendedTarget | null {
  const chess = board(c.input.fen);
  if (!chess || !c.input.playedUci) return null;
  const played = play(new Chess(chess.fen()), c.input.playedUci);
  if (!played || !played.captured) return null;
  const defender = cheapestAttacker(chess, played.to, c.opp);
  if (!defender) return null;
  return { sq: played.to, defender, mover: played.piece, captured: played.captured };
}

function evalPhrase(cp: number | null | undefined): string {
  if (cp === null || cp === undefined || Math.abs(cp) < 100) return "keeps the game level";
  return cp > 0 ? "keeps your edge" : "limits the damage";
}

/** What the best move itself does, for the review templates. */
function bestAction(c: Ctx): { text: string; target: Target | null } {
  if (c.best.captured) return { text: `takes the ${NAME[c.best.captured]} on ${c.best.to}`, target: null };
  const before = board(c.input.fen);
  const fresh = attackedBy(c.after, c.best.to).filter((t) => t.type !== "k" && !(before?.attackers(t.sq, c.me) ?? []).includes(c.best.from));
  const target = fresh[0] ?? null;
  if (target) return { text: `challenges the ${NAME[target.type]} on ${target.sq}`, target };
  return { text: `improves your ${NAME[c.best.piece]}`, target: null };
}

// ── Assembly ───────────────────────────────────────────────────────────────────────────────────────────────────

function rookFileNote(c: Ctx): string {
  if (c.best.piece !== "r" && c.best.piece !== "q") return "";
  if (c.best.from[0] !== c.best.to[0]) return "";
  const file = c.best.from[0]!;
  const start = board(c.input.fen);
  return start && pawnsOnFile(start, c.me, file) === 0 ? ` now that the ${file}-pawn is gone` : "";
}

function hintText(c: Ctx): string {
  const theme = c.input.theme;
  if (theme === "rc:recapture") {
    const r = recaptureFacts(c);
    if (r) return `Which piece can guard ${r.sq} without blocking anything?`;
  }
  if (theme === "rc:defendedTarget") {
    const d = defendedTargetFacts(c);
    if (d) {
      const action = bestAction(c);
      const then = action.target ? ` Then look at the ${NAME[action.target.type]} on ${action.target.sq}.` : "";
      return `Before taking on ${d.sq}, count its defenders.${then}`;
    }
  }
  if (theme === "fork") {
    const targets = forkTargets(c.after, c.best.to);
    if (targets.some((t) => t.type === "k")) {
      const start = board(c.input.fen)!;
      const checks = start.moves({ verbose: true }).filter((m) => m.from === c.best.from && m.san.includes("+")).length;
      const prize = targets.find((t) => t.type !== "k");
      if (checks >= 2 && prize) return `Your ${NAME[c.best.piece]} can give check from ${word(checks)} squares. One of them also hits the ${NAME[prize.type]}.`;
      if (prize) return `Your ${NAME[c.best.piece]} can give check and hit the ${NAME[prize.type]} at the same time.`;
    }
    if (targets.length >= 2) return `Look for one square where your ${NAME[c.best.piece]} attacks ${word(targets.length)} things.`;
  }
  if (["mate", "mateIn1", "mateIn2", "mateIn3", "backRankMate", "smotheredMate"].includes(theme)) {
    return "Look for a check that leaves the king no square.";
  }
  return `Look at your ${NAME[c.best.piece]} on ${c.best.from}. What can it see${rookFileNote(c)}?`;
}

function correctText(c: Ctx): { text: string; specific: boolean } {
  const theme = c.input.theme;
  const tried: (string | null)[] = [];
  if (theme === "rc:recapture") {
    const r = recaptureFacts(c);
    if (r) tried.push(`${c.best.san} keeps the ${NAME[r.guard]} ready to recapture on ${r.sq}, so you avoid ${r.damage.phrase}.`);
  }
  if (theme === "rc:defendedTarget") {
    const d = defendedTargetFacts(c);
    if (d) tried.push(`${c.best.san} ${bestAction(c).text} and ${evalPhrase(c.input.cpBest)}. ${d.sq} is guarded by the ${NAME[d.defender.type]}.`);
  }
  if (theme.startsWith("mate") || theme === "backRankMate" || theme === "smotheredMate") tried.push(mateLine(c));
  if (theme === "fork") tried.push(forkLine(c));
  if (theme === "hangingPiece") tried.push(loosePieceLine(c));
  if (theme === "pin") tried.push(pinLine(c));
  if (theme === "skewer") tried.push(skewerLine(c));
  if (theme === "discoveredAttack") tried.push(discoveredLine(c));
  // Whatever the theme, a mate or a material win is a true sentence.
  tried.push(mateLine(c), forkLine(c), loosePieceLine(c), materialLine(c));
  const hit = tried.find((t): t is string => typeof t === "string");
  if (hit) return { text: hit, specific: true };
  const ev = c.ev ? `, about ${c.ev} for you` : "";
  return { text: `${c.best.san} is the engine's choice here${ev}.`, specific: true };
}

function wrongGameMoveText(c: Ctx, playedSan: string): { text: string; specific: boolean } {
  const theme = c.input.theme;
  if (theme === "rc:recapture") {
    const r = recaptureFacts(c);
    if (r) return { text: `${playedSan} is what you played. After ${r.refute.san} ${r.recapture.san} ${r.damage.are}. Keep the ${NAME[r.guard]} ready to take back.`, specific: true };
  }
  if (theme === "rc:defendedTarget") {
    const d = defendedTargetFacts(c);
    if (d) {
      return {
        text: `${playedSan} is what you played: the ${NAME[d.defender.type]} on ${d.defender.sq} guards ${d.sq}, so it gives a ${NAME[d.mover]} for a ${NAME[d.captured]}.`,
        specific: true,
      };
    }
  }
  if (theme === "hangingPiece") {
    const loose = c.line.find((m, i) => i % 2 === 0 && m.captured);
    if (loose?.captured) return { text: `Not the move. Something of ${SIDE[c.opp]}’s is loose: count the defenders of the ${NAME[loose.captured]} on ${loose.to}.`, specific: true };
  }
  const chess = board(c.input.fen);
  if (chess && c.input.playedUci && play(chess, c.input.playedUci)) {
    const refute = play(chess, c.input.refuteUci);
    if (refute) {
      if (chess.isCheckmate()) return { text: `${playedSan} is what you played. After ${refute.san} it is mate.`, specific: true };
      if (refute.captured) return { text: `${playedSan} is what you played. After ${refute.san} ${SIDE[c.opp]} wins your ${NAME[refute.captured]}.`, specific: true };
      if (refute.san.includes("+")) return { text: `${playedSan} is what you played. After ${refute.san} your king comes under fire.`, specific: true };
    }
  }
  return { text: `${playedSan} is what you played. Not the move: ${hintText(c)}`, specific: false };
}

function costTextOf(c: Ctx, playedSan: string): string {
  const theme = c.input.theme;
  if (theme === "rc:recapture") {
    const r = recaptureFacts(c);
    if (r) return `After ${r.refute.san} ${r.recapture.san} ${r.damage.endsUp}.`;
  }
  if (theme === "rc:defendedTarget") {
    const d = defendedTargetFacts(c);
    if (d) return `${playedSan} gave a ${NAME[d.mover]} for a ${NAME[d.captured]}: the ${NAME[d.defender.type]} on ${d.defender.sq} guards ${d.sq}.`;
  }
  const ev = c.ev ? `, about ${c.ev} for you` : "";
  if (mateLine(c)) return `${c.best.san} forced mate here. ${playedSan} let it go.`;
  const won = c.best.captured ?? c.line.find((m, i) => i % 2 === 0 && m.captured)?.captured;
  if (won) return `${c.best.san} won a ${NAME[won]} here${ev}. ${playedSan} let it go.`;
  return `${c.best.san} was the move here${ev}. ${playedSan} let it go.`;
}

/** The coach lines of one item. Throws when the solution's first move is not legal in `fen` (a corrupt row). */
export function explainItem(input: ExplainInput): ExplainTexts {
  const played = playLine(input.fen, input.solution);
  const best = played?.moves[0];
  if (!played || !best) throw new Error(`explain: ${input.solution[0] ?? "(none)"} is not legal in ${input.fen}`);
  const after = new Chess(best.after);
  const me = sideToMove(input.fen);
  const c: Ctx = { input, me, opp: other(me), best, after, line: played.moves, ev: evalText(input.cpBest, input.mateBest) };
  const correct = correctText(c);
  const bank = input.kind !== "puzzle";
  const playedSan = bank && input.playedUci ? sanOf(input.fen, input.playedUci) : null;
  const wrong = playedSan ? wrongGameMoveText(c, playedSan) : null;
  return {
    hint: hintText(c),
    look: bank ? null : lookText(input.theme),
    correct: correct.text,
    wrongGameMove: wrong?.text ?? null,
    costText: playedSan ? costTextOf(c, playedSan) : null,
    verified: correct.specific && (wrong?.specific ?? true),
  };
}

/**
 * The line for a wrong move other than the game move (puzzles; §8.12 "wrong, other move"): what the move attacks and
 * what to look for instead. Falls back to "Not the move. {hint}" (`verified: false`) when nothing specific is true.
 */
export function explainWrongMove(input: ExplainInput, uci: string): { text: string; verified: boolean } {
  const base = playLine(input.fen, input.solution);
  const best = base?.moves[0];
  if (!base || !best) throw new Error(`explain: ${input.solution[0] ?? "(none)"} is not legal in ${input.fen}`);
  const me = sideToMove(input.fen);
  const c: Ctx = { input, me, opp: other(me), best, after: new Chess(best.after), line: base.moves, ev: evalText(input.cpBest, input.mateBest) };
  const chess = board(input.fen)!;
  const wrong = play(chess, uci);
  if (!wrong) return { text: `Not the move. ${hintText(c)}`, verified: false };
  const hits = attackedBy(chess, wrong.to, { pawns: true });
  const want = forkTargets(c.after, best.to).length;
  if (input.theme === "fork" && want >= 2 && hits.length > 0) {
    const lead = wrong.san.includes("+") && wrong.piece === best.piece ? `The ${NAME[wrong.piece]} check is there, but from ${wrong.to} it only attacks` : `${wrong.san} attacks`;
    return { text: `${lead} ${targetList(hits, true)}. Look for the square that hits ${word(want)} things.`, verified: true };
  }
  if (input.theme === "hangingPiece") {
    const loose = c.line.find((m, i) => i % 2 === 0 && m.captured);
    if (loose?.captured) return { text: `Not the move. Something of ${SIDE[c.opp]}’s is loose: count the defenders of the ${NAME[loose.captured]} on ${loose.to}.`, verified: true };
  }
  return { text: `Not the move. ${hintText(c)}`, verified: false };
}
