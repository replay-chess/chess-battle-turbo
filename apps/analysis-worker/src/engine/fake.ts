// ENGINE=fake (APP_ENV=test only; env.ts refuses it elsewhere): a deterministic in-process engine for CI's e2e runs
// and the unit tests. It is not chess-strong and does not try to be: each legal move is scored by the material it
// leaves (1 ply), a mate in 1 is found, and a stable hash of (EPD, move) breaks ties and adds ±15 cp of texture, so a
// game gets a mix of labels and the same position always gets the same answer, in microseconds.
import { Chess, type Move } from "chess.js";
import { EngineCrashed, type Engine, type EngineLine, type SearchRequest, type SearchResult } from "./types";

const VALUE: Record<string, number> = { p: 100, n: 300, b: 310, r: 500, q: 900, k: 0 };
const FAKE_DEPTH = 12;

function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/** White-minus-Black material of a position, in centipawns. */
function material(chess: Chess): number {
  let sum = 0;
  for (const row of chess.board()) {
    for (const sq of row) if (sq) sum += (sq.color === "w" ? 1 : -1) * VALUE[sq.type]!;
  }
  return sum;
}

function uciOf(m: Move): string {
  return `${m.from}${m.to}${m.promotion ?? ""}`;
}

function epd(fen: string): string {
  return fen.split(" ").slice(0, 4).join(" ");
}

export class FakeEngine implements Engine {
  readonly kind = "fake" as const;
  readonly buildId = "fake";
  readonly name = "Fake Engine";
  private running = false;
  /** Searches answered (tests assert cache hits avoid them). */
  searches = 0;

  async start(): Promise<void> {
    this.running = true;
  }

  async newGame(): Promise<void> {
    if (!this.running) throw new EngineCrashed("the fake engine is not running");
  }

  async search(req: SearchRequest): Promise<SearchResult> {
    if (!this.running) throw new EngineCrashed("the fake engine is not running");
    this.searches++;
    const chess = new Chess(req.fen);
    for (const m of req.moves ?? []) chess.move(m);
    const key = epd(chess.fen());
    const mover = chess.turn();
    const sign = mover === "w" ? 1 : -1;
    const scored = chess.moves({ verbose: true }).map((m) => {
      chess.move(m);
      const mate = chess.isCheckmate();
      const cp = sign * material(chess) + (fnv1a(`${key}|${uciOf(m)}`) % 31) - 15;
      chess.undo();
      return { move: uciOf(m), mate, cp };
    });
    scored.sort((a, b) => (a.mate !== b.mate ? (a.mate ? -1 : 1) : b.cp - a.cp || (a.move < b.move ? -1 : 1)));
    const lines: EngineLine[] = scored.slice(0, req.multipv).map((s, i) => ({
      multipv: i + 1,
      score: s.mate ? { mate: 1 } : { cp: s.cp },
      depth: FAKE_DEPTH,
      seldepth: FAKE_DEPTH,
      nodes: req.nodes,
      pv: [s.move],
    }));
    return { bestmove: scored[0]?.move ?? null, lines, depth: lines.length ? FAKE_DEPTH : 0, nodes: req.nodes, nps: null, ms: 0 };
  }

  kill(): void {
    this.running = false;
  }

  async quit(): Promise<void> {
    this.running = false;
  }
}
