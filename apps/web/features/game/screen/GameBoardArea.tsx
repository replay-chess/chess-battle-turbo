"use client";

// The board region (plan 4.4, 4.5.6): V3MoveBoard wired to the controller and the view state, and the test container `[data-testid="game-board-container"]` with the attributes the e2e fixture reads
// (`data-game-started`, `data-player-color`, `data-current-turn`) plus `data-phase` (the primary design state),
// `data-ply`, `data-role` and `data-mode`.

import { lazy, Suspense, useEffect } from "react";
import { Board } from "@/components/board/Board";
import type { BadgeKind, BoardBadge, BoardGhost, PieceCode, Side as BoardSide, Sq } from "@/components/board/types";
import { absPly } from "@repo/game-core/client/reducer";
import { parsePlacement } from "@repo/game-core/rules/chess";
import type { Side } from "@repo/game-core/machine/types";
import { boardLabel, copyCtx, ZONE } from "../copy";
import { destsCallback, legalDestsFor, premoveDestsFor } from "../live/premove";
import { useController, useDispatch, useGame, usePrefs, useView } from "./GameContext";
import { withTelemetry } from "../telemetryLazy";

// Lazy: the /game route is at its first-load budget (plan 9.1), and the input is hidden until focused.
const GameMoveInput = lazy(() => import("./GameMoveInput"));

const BADGE_LABEL: Record<"mate" | "win" | "flag" | "draw", string> = {
  mate: "Checkmated king",
  win: "Winning king",
  flag: "Resigned",
  draw: "Draw",
};

const other = (s: Side): Side => (s === "w" ? "b" : "w");

export function GameBoardArea() {
  const controller = useController();
  const dispatch = useDispatch();
  const view = useView();
  const { flipped } = usePrefs();
  const state = useGame((g) => g.state);
  const animate = useGame((g) => g.animate);
  const hintArrow = useGame((g) => g.bot?.hint?.arrow ?? null);
  const viewing = useGame((g) => g.view !== null);
  const ctx = copyCtx(state);
  const me = ctx.me;
  const b = view.board;

  const orientation: BoardSide = flipped ? other(b.orientation) : b.orientation;
  const mover = b.input === "move" ? me : null;
  const premover = b.input === "premove" ? me : null;
  const now = () => Date.now();

  let ghost: BoardGhost | null = null;
  if (b.ghost) {
    const piece = parsePlacement(state.fen).get(b.ghost.from);
    if (piece) ghost = { sq: b.ghost.to as Sq, piece: `${piece.color}${piece.type}` as PieceCode };
  }
  const badges: BoardBadge[] = b.badges.map((x) => ({
    sq: x.square as Sq,
    kind: x.kind as BadgeKind,
    label: BADGE_LABEL[x.kind],
  }));

  const started = state.phase === "first_move" || state.phase === "playing" || state.phase === "ended";
  const isBot = state.mode === "BOT";
  const gameRef = state.ref;
  // game_board_ready (plan 10.1): the first paint of the board on this page view.
  useEffect(() => {
    requestAnimationFrame(() => {
      const at = performance.now();
      withTelemetry((t) => t.markBoardPainted(gameRef, isBot, at));
    });
  }, [gameRef, isBot]);
  return (
    <div
      className="g-boardarea"
      data-testid="game-board-container"
      data-game-started={started ? "true" : "false"}
      data-player-color={state.you.role === "player" ? state.you.color : undefined}
      data-current-turn={state.turn}
      data-phase={view.primary}
      data-ply={absPly(state)}
      data-role={state.you.role}
      data-mode={state.mode}
    >
      <Board
        fen={b.fen}
        orientation={orientation}
        mover={mover}
        premover={premover}
        dests={destsCallback(mover ? legalDestsFor(b.fen) : EMPTY)}
        premoveDests={destsCallback(premover ? premoveDestsFor(b.fen, me) : EMPTY)}
        onMove={(m) => controller.move(m)}
        onPremove={(m) => controller.setPremove(m)}
        onIllegal={(from, to) => dispatch({ type: "illegal", from, to, now: now() })}
        onLockedAttempt={
          state.phase === "study"
            ? () => dispatch({ type: "toast", code: "hint", now: now(), params: { text: ZONE.lockedAttempt } })
            : undefined
        }
        onSelect={(sq) => dispatch({ type: "select", square: sq })}
        onPromotionOpen={(from, to) => dispatch({ type: "promotion", open: { from, to } })}
        onPromotionCancel={() => dispatch({ type: "promotion", open: null, cancelled: true })}
        lastMove={b.lastMove as [Sq, Sq] | null}
        check={b.checkSquare as Sq | null}
        premove={b.ghost?.kind === "premove" ? { from: b.ghost.from as Sq, to: b.ghost.to as Sq } : null}
        ghost={ghost}
        badges={badges}
        arrows={hintArrow ? [{ from: hintArrow.from as Sq, to: hintArrow.to as Sq, color: hintArrow.color }] : undefined}
        allowDrawArrows={state.you.role === "player" && state.phase !== "ended"}
        dimmed={b.dimmed || viewing}
        animationMs={animate ? 180 : 0}
        label={boardLabel(ctx)}
      />
      {state.you.role === "player" && state.phase !== "ended" ? (
        <Suspense fallback={null}>
          <GameMoveInput fen={b.fen} mover={mover} onMove={(m) => controller.move(m)} />
        </Suspense>
      ) : null}
    </div>
  );
}

const EMPTY = new Map<string, string[]>();
