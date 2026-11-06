"use client";

/**
 * The /dev/ui/board demo (P2 plan §13.1 row F). chess.js stands in for
 * game-core here: it supplies `dests`, the premove targets and the move
 * validation that the game screen will take from @repo/game-core.
 * Every board callback is logged to [data-testid="board-events"] for the specs
 * (e2e/devices/ui/board.spec.ts).
 */
import { Chess, type Square } from "chess.js";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Board } from "@/components/board/Board";
import { MiniBoard } from "@/components/board/MiniBoard";
import { MoveInput, type MoveInputResult } from "@/components/board/MoveInput";
import { isPromotionMove, parsePlacement, parseUci, pieceName, sideToMove } from "@/components/board/geometry";
import type { BadgeKind, BoardArrow, BoardBadge, BoardMove, PieceCode, Side, Sq } from "@/components/board/types";
import { Button } from "@/components/ui/button";
import { Specimen } from "../_components/Specimen";
import { BOARD_PRESETS, PRESET_FEN, PRESET_LABEL, START, type BoardPreset } from "./presets";

const ALL_BADGES: { sq: Sq; kind: BadgeKind; label: string }[] = [
  { sq: "a8", kind: "brilliant", label: "Brilliant" },
  { sq: "c8", kind: "great", label: "Great" },
  { sq: "f8", kind: "best", label: "Best" },
  { sq: "h8", kind: "excellent", label: "Excellent" },
  { sq: "a7", kind: "good", label: "Good" },
  { sq: "d7", kind: "book", label: "Book" },
  { sq: "e7", kind: "forced", label: "Forced" },
  { sq: "f6", kind: "interesting", label: "Interesting" },
  { sq: "e5", kind: "inaccuracy", label: "Inaccuracy" },
  { sq: "b5", kind: "mistake", label: "Mistake" },
  { sq: "g5", kind: "miss", label: "Miss" },
  { sq: "e4", kind: "blunder", label: "Blunder" },
  { sq: "e8", kind: "mate", label: "Checkmated king" },
  { sq: "c1", kind: "win", label: "Winning king" },
  { sq: "b3", kind: "flag", label: "Resigned" },
  { sq: "h1", kind: "draw", label: "Draw" },
];

const SAMPLE_ARROWS: BoardArrow[] = [
  { from: "e2", to: "e4" },
  { from: "g1", to: "f3", color: "green" },
  { from: "d1", to: "h5", color: "red" },
  { from: "b1", to: "c3", color: "pv-2" },
];

interface GameState {
  fen: string;
  lastMove: [Sq, Sq] | null;
  premove: BoardMove | null;
  waiting: boolean;
  events: string[];
}

function chessOf(fen: string): Chess | null {
  try {
    return new Chess(fen);
  } catch {
    return null;
  }
}

function legalTargets(fen: string, from: Sq): Sq[] {
  const c = chessOf(fen);
  if (!c) return [];
  const out = new Set<Sq>();
  for (const m of c.moves({ square: from as Square, verbose: true })) out.add(m.to as Sq);
  return [...out];
}

/** Targets after a null move (the opponent passes): what the premove can aim at. Demo stand-in for game-core premoveDests. */
function premoveTargets(fen: string, from: Sq, side: Side): Sq[] {
  const parts = fen.split(" ");
  parts[1] = side;
  parts[3] = "-";
  const c = chessOf(parts.join(" "));
  if (!c) return [];
  const out = new Set<Sq>();
  for (const m of c.moves({ square: from as Square, verbose: true })) out.add(m.to as Sq);
  return [...out];
}

function applyMove(fen: string, m: { from: Sq; to: Sq; promotion?: string }): { fen: string; san: string } | null {
  const c = chessOf(fen);
  if (!c) return null;
  try {
    const r = c.move({ from: m.from, to: m.to, promotion: m.promotion });
    return { fen: c.fen(), san: r.san };
  } catch {
    return null;
  }
}

function kingInCheck(fen: string): Sq | null {
  const c = chessOf(fen);
  if (!c || !c.inCheck()) return null;
  const turn = c.turn();
  for (const [sq, p] of parsePlacement(fen)) if (p === `${turn}k`) return sq;
  return null;
}

const push = (events: string[], e: string) => [...events.slice(-19), e];

/** Black's reply (first legal move in UCI order, so specs are deterministic), then the queued premove. */
function respond(g: GameState): GameState {
  const c = chessOf(g.fen);
  if (!c) return { ...g, waiting: false };
  const moves = c.moves({ verbose: true }).sort((a, b) => (a.lan < b.lan ? -1 : 1));
  const reply = moves[0];
  if (!reply) return { ...g, waiting: false, events: push(g.events, "bot none") };
  let fen = applyMove(g.fen, { from: reply.from as Sq, to: reply.to as Sq, promotion: reply.promotion })!.fen;
  let lastMove: [Sq, Sq] = [reply.from as Sq, reply.to as Sq];
  let events = push(g.events, `bot ${reply.lan}`);
  let waiting = false;
  if (g.premove) {
    const done = applyMove(fen, g.premove);
    if (done) {
      fen = done.fen;
      lastMove = [g.premove.from, g.premove.to];
      events = push(events, `premove-played ${g.premove.uci}`);
      waiting = true;
    } else {
      events = push(events, `premove-cancelled ${g.premove.uci}`);
    }
  }
  return { fen, lastMove, premove: null, waiting, events };
}

export function BoardDemo({
  preset,
  orient,
  fen: fenParam,
  botDelay,
  animate,
}: {
  preset: BoardPreset;
  orient: Side;
  fen?: string;
  botDelay: number;
  animate: boolean;
}) {
  const initialFen = fenParam && chessOf(fenParam) ? fenParam : PRESET_FEN[preset];
  const [game, setGame] = useState<GameState>({ fen: initialFen, lastMove: null, premove: null, waiting: false, events: [] });
  const [orientation, setOrientation] = useState<Side>(orient);
  const [status, setStatus] = useState("");
  const [showInput, setShowInput] = useState(false);

  const premoveMode = preset === "premove";
  const locked = preset === "study";
  const turn = sideToMove(game.fen);
  const human: Side = premoveMode ? "w" : turn;
  const mover: Side | null = locked ? null : premoveMode ? (turn === "w" && !game.waiting ? "w" : null) : turn;
  const premover: Side | null = premoveMode && mover === null ? "w" : null;
  const log = (e: string) => setGame((g) => ({ ...g, events: push(g.events, e) }));

  // The scripted opponent answers after botDelay (0 = the "Black Moves" button), again after a played premove.
  useEffect(() => {
    if (!premoveMode || !game.waiting || botDelay <= 0) return;
    const t = setTimeout(() => setGame((g) => (g.waiting ? respond(g) : g)), botDelay);
    return () => clearTimeout(t);
  }, [premoveMode, game.waiting, game.fen, botDelay]);

  const onMove = (m: BoardMove) => {
    const done = applyMove(game.fen, m);
    if (!done) {
      log(`rejected ${m.uci}`);
      setStatus("Move not accepted. The board is back in sync.");
      return;
    }
    setGame((g) => ({ ...g, fen: done.fen, lastMove: [m.from, m.to], waiting: premoveMode, events: push(g.events, `move ${m.uci}`) }));
    setStatus(`You played ${done.san}.`);
  };

  const onPremove = (m: BoardMove | null) => {
    setGame((g) => ({ ...g, premove: m, events: push(g.events, m ? `premove ${m.uci}` : "premove null") }));
    setStatus(m ? `Premove set: ${m.uci}. Right-click or Esc to cancel.` : "Premove cancelled.");
  };

  const placement = parsePlacement(game.fen);
  const describe = (sq: Sq | null) => {
    if (!sq) return "";
    const p = placement.get(sq);
    return p ? `${pieceName(p).split(" ")[1]!.replace(/^./, (c) => c.toUpperCase())} selected` : "";
  };

  const resolve = (text: string): MoveInputResult => {
    if (!mover) return { ok: false, reason: "It isn't your move." };
    const uci = parseUci(text);
    const c = chessOf(game.fen);
    if (!c) return { ok: false, reason: "The position is not valid." };
    try {
      const r = uci ? c.move({ from: uci.from, to: uci.to, promotion: uci.promotion ?? (isPromotionMove(placement, uci.from, uci.to) ? "q" : undefined) }) : c.move(text);
      const m: BoardMove = { from: r.from as Sq, to: r.to as Sq, uci: r.lan, ...(r.promotion ? { promotion: r.promotion as BoardMove["promotion"] } : {}) };
      return { ok: true, move: m };
    } catch {
      return { ok: false, reason: `That move isn't legal: ${text}.` };
    }
  };

  const ghost = game.premove ? { sq: game.premove.to, piece: placement.get(game.premove.from) as PieceCode } : null;
  const badges: BoardBadge[] = preset === "badges" ? ALL_BADGES : [];
  const arrows = preset === "arrows" ? SAMPLE_ARROWS : [];
  const highlights: Partial<Record<Sq, string>> | undefined =
    preset === "arrows" ? { d4: "highlight-yellow", e5: "rgba(3,105,161,0.22)" } : undefined;
  const rings: Partial<Record<Sq, string>> | undefined = preset === "arrows" ? { d8: "#a3412e" } : undefined;
  const lastEvent = game.events[game.events.length - 1] ?? "";

  return (
    <section aria-labelledby="board-demo-title" data-testid="board-demo" className="flex flex-col gap-6">
      <h2 id="board-demo-title" className="font-serif text-heading">
        V3MoveBoard
      </h2>
      <nav aria-label="Board presets" className="flex flex-wrap gap-1">
        {BOARD_PRESETS.map((p) => (
          <Link
            key={p}
            href={`/dev/ui/board?preset=${p}`}
            aria-current={p === preset ? "page" : undefined}
            className="inline-flex min-h-11 items-center border border-cb-border-strong px-3 text-ui text-cb-text aria-[current=page]:bg-cb-accent aria-[current=page]:text-cb-accent-fg"
          >
            {PRESET_LABEL[p]}
          </Link>
        ))}
      </nav>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,560px)_minmax(0,1fr)]">
        <div className="flex w-full max-w-[560px] flex-col gap-3" data-testid="game-board-container" data-current-turn={turn} data-player-color={human} data-game-started="true">
          <Board
            fen={game.fen}
            orientation={orientation}
            mover={mover}
            premover={premover}
            dests={(sq) => legalTargets(game.fen, sq)}
            premoveDests={premoveMode ? (sq) => premoveTargets(game.fen, sq, "w") : undefined}
            onMove={onMove}
            onPremove={premoveMode ? onPremove : undefined}
            onIllegal={(from, to) => {
              log(`illegal ${from}${to}`);
              setStatus("That move isn't legal. The piece went back.");
            }}
            onLockedAttempt={() => {
              log("locked");
              setStatus("Moves are locked during the study phase.");
            }}
            onSelect={(sq) => {
              log(sq ? `select ${sq}` : "select null");
              setStatus(describe(sq));
            }}
            onPromotionOpen={(from, to) => {
              log(`promotion-open ${from}${to}`);
              setStatus("Choose a piece · Esc puts the pawn back");
            }}
            onPromotionCancel={() => {
              log("promotion-cancel");
              setStatus("Promotion cancelled · the pawn is back");
            }}
            lastMove={game.lastMove}
            check={kingInCheck(game.fen)}
            premove={game.premove ? { from: game.premove.from, to: game.premove.to } : null}
            ghost={ghost}
            highlights={highlights}
            rings={rings}
            arrows={arrows}
            badges={badges}
            allowDrawArrows
            animationMs={animate ? 180 : 0}
            label={`Board. You are ${human === "w" ? "White" : "Black"}.`}
          />
          <MoveInput resolve={resolve} onMove={onMove} visible={showInput} disabled={!mover} />
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" data-testid="board-flip" onClick={() => setOrientation((o) => (o === "w" ? "b" : "w"))}>
              Flip Board
            </Button>
            <Button
              variant="secondary"
              size="sm"
              data-testid="board-reset"
              onClick={() => {
                setGame({ fen: initialFen, lastMove: null, premove: null, waiting: false, events: [] });
                setStatus("");
              }}
            >
              Reset
            </Button>
            <Button variant="secondary" size="sm" pressed={showInput} data-testid="board-show-input" onClick={() => setShowInput((v) => !v)}>
              Show Move Input
            </Button>
            {premoveMode ? (
              <Button
                variant="secondary"
                size="sm"
                data-testid="board-bot-move"
                disabled={!game.waiting}
                onClick={() => setGame((g) => (g.waiting ? respond(g) : g))}
              >
                Black Moves
              </Button>
            ) : null}
          </div>
          <p role="status" aria-live="polite" data-testid="board-status" className="min-h-6 text-ui text-cb-text">
            {status}
          </p>
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-ui">
            <dt className="text-cb-text-soft">Mover</dt>
            <dd data-testid="board-mover">{mover ?? (premover ? `premove (${premover})` : "locked")}</dd>
            <dt className="text-cb-text-soft">Last event</dt>
            <dd data-testid="board-last-event" className="font-mono">
              {lastEvent}
            </dd>
            <dt className="text-cb-text-soft">FEN</dt>
            <dd data-testid="board-fen" className="font-mono break-all">
              {game.fen}
            </dd>
          </dl>
          <ol data-testid="board-events" aria-label="Board events" className="flex flex-col gap-0.5 font-mono text-ui text-cb-text-soft">
            {game.events.map((e, i) => (
              <li key={`${i}-${e}`}>{e}</li>
            ))}
          </ol>
        </div>
      </div>
      {preset === "badges" ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Specimen title="Thumb board (static)" testId="board-thumb">
            <div className="w-full max-w-[240px]">
              <Board
                fen={game.fen}
                orientation="w"
                mover={null}
                dests={() => []}
                onMove={() => {}}
                thumb
                label="Position after 11.Bxd7+"
                testId="chess-board-thumb"
              />
            </div>
          </Specimen>
          <Specimen title="MiniBoard (SVG)" testId="board-mini">
            <MiniBoard fen={START} label="Start position" />
            <MiniBoard fen={game.fen} orientation="b" lastMove={["b5", "d7"]} label="Opera game, Black's view" />
            <MiniBoard fen={PRESET_FEN.promotion} size={96} label="Promotion position" />
          </Specimen>
        </div>
      ) : null}
    </section>
  );
}
