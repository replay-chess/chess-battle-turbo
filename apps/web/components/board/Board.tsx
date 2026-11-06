"use client";

/**
 * V3MoveBoard (P2 plan §4.5; design `V3MoveBoard.dc.html`, interaction contract
 * `V3GamePrototype.dc.html`). Composes the cell grid (squares, marks, pieces,
 * ghost), the arrow SVG, the badge layer and the promotion picker; the input
 * state machine lives in useBoardInput, the keyboard grid in useKeyboardBoard.
 *
 * Test hooks kept (§4.5.6): `data-testid="chess-board"` + `data-size="fill"` on
 * the root, `[data-square]` on every cell with the piece <img> (alt "White
 * knight") inside, `.rounded-full` legal dots, inline rgba(220, 80, 80, …)
 * capture corners.
 */
import "./board.css";
import { useId, useRef } from "react";
import { ArrowLayer, type ArrowSpec } from "./ArrowLayer";
import { BadgeLayer } from "./BadgeLayer";
import { PromotionPicker } from "./PromotionPicker";
import { CoordLayer, SquareLayer, type CellModel } from "./SquareLayer";
import { displayPos, displayRows, isDarkSquare, parsePlacement, pieceColor, PIECE_NAMES, pieceType, placementKey } from "./geometry";
import type { InputContext } from "./logic";
import { usePieceTracks } from "./PieceLayer";
import type { BoardProps, Sq } from "./types";
import { useBoardInput } from "./useBoardInput";
import { useKeyboardBoard } from "./useKeyboardBoard";

const DEFAULT_MS = 180;
const NO_DESTS: (from: Sq) => Sq[] = () => [];

export function Board(props: BoardProps) {
  const {
    fen,
    orientation,
    thumb = false,
    coordinates = true,
    animationMs = DEFAULT_MS,
    label,
    testId = "chess-board",
    dimmed = false,
    allowDrawArrows = false,
  } = props;
  const rootRef = useRef<HTMLDivElement>(null);
  const legalId = useId();
  const fenKey = placementKey(fen);
  const placement = parsePlacement(fen);
  const mover = thumb ? null : props.mover;
  const premover = thumb ? null : (props.premover ?? null);
  const enabled = !thumb;

  const ctx: InputContext = {
    placement,
    mover,
    premover,
    dests: mover ? props.dests : NO_DESTS,
    premoveDests: premover ? props.premoveDests : undefined,
    premove: props.premove ?? null,
    canReportLocked: enabled && !!props.onLockedAttempt,
  };

  const input = useBoardInput({
    rootRef,
    ctx,
    orientation,
    enabled,
    allowDrawArrows: enabled && allowDrawArrows,
    fenKey,
    callbacks: {
      onMove: props.onMove,
      onPremove: props.onPremove,
      onIllegal: props.onIllegal,
      onLockedAttempt: props.onLockedAttempt,
      onSelect: props.onSelect,
      onPromotionOpen: props.onPromotionOpen,
      onPromotionCancel: props.onPromotionCancel,
    },
  });

  const view = usePieceTracks(fen, orientation, props.lastMove, input.instant);
  const animate = animationMs > 0;
  const bottomLeft: Sq = orientation === "w" ? "a1" : "h8";
  const keyboard = useKeyboardBoard({ rootRef, orientation, initial: input.selected?.sq ?? bottomLeft, cancel: input.cancel });

  const sel = input.selected;
  const targets = new Map<Sq, "dot" | "cap">();
  if (sel) {
    const list = sel.mode === "move" ? ctx.dests(sel.sq) : (ctx.premoveDests?.(sel.sq) ?? []);
    for (const t of list) targets.set(t, placement.has(t) ? "cap" : "dot");
  }
  const last = props.lastMove ?? null;
  const pm = props.premove ?? null;
  const shake = input.shake;
  const showCoords = coordinates && !thumb;
  const marks = input.drawnMarks;

  const rows: CellModel[][] = displayRows(orientation).map((row) =>
    row.map((sq) => {
      const piece = view.bySq.get(sq);
      const code = placement.get(sq);
      const mark = marks[sq];
      const highlight = props.highlights?.[sq] ?? (mark ? mark : undefined);
      const colour = code ? (pieceColor(code) === "w" ? "white" : "black") : null;
      return {
        sq,
        dark: isDarkSquare(sq),
        label: code ? `${sq}, ${colour} ${PIECE_NAMES[pieceType(code)]}` : `${sq}, empty`,
        piece,
        removed: view.removedBySq.get(sq),
        ghost: props.ghost?.sq === sq ? props.ghost.piece : undefined,
        movable: !!code && (pieceColor(code) === mover || pieceColor(code) === premover),
        shake: shake?.sq === sq ? (shake.n % 2 ? "a" : "b") : undefined,
        lifted: input.lifted === sq,
        last: !!last && (last[0] === sq || last[1] === sq),
        highlight,
        selected: sel?.sq === sq,
        premove: !!pm && (pm.from === sq || pm.to === sq),
        check: props.check === sq,
        ring: props.rings?.[sq],
        target: targets.get(sq),
      } satisfies CellModel;
    }),
  );

  const arrows: (ArrowSpec & { key: string; source: "prop" | "drawn" | "preview" })[] = [
    ...(props.arrows ?? []).map((a, i) => ({ ...a, key: `p${i}-${a.from}${a.to}`, source: "prop" as const })),
    ...input.drawnArrows.map((a) => ({ ...a, key: `d-${a.from}${a.to}`, source: "drawn" as const })),
    ...(input.preview && input.preview.from !== input.preview.to
      ? [{ ...input.preview, key: "preview", source: "preview" as const }]
      : []),
  ];

  const promo = input.promo;
  const promoPiece = promo ? placement.get(promo.from) : undefined;
  const promoPos = promo ? displayPos(promo.to, orientation) : null;
  const interactive = enabled && (!!mover || !!premover || allowDrawArrows);

  return (
    <div
      ref={rootRef}
      className={props.className ? `rc-board ${props.className}` : "rc-board"}
      data-testid={testId}
      data-size="fill"
      data-orientation={orientation}
      data-mover={mover ?? undefined}
      data-interactive={interactive ? "" : undefined}
      data-dimmed={dimmed ? "" : undefined}
      data-thumb={thumb ? "" : undefined}
      data-instant={animate ? undefined : ""}
      data-dragging={input.lifted ? "" : undefined}
      data-promotion={promo ? "" : undefined}
      role={thumb ? "img" : undefined}
      aria-label={thumb ? label : undefined}
      style={animate && animationMs !== DEFAULT_MS ? ({ "--rc-bd-ms": `${animationMs}ms` } as React.CSSProperties) : undefined}
      {...(enabled ? input.handlers : {})}
    >
      <SquareLayer
        rows={rows}
        orientation={orientation}
        label={label}
        thumb={thumb}
        interactive={interactive}
        animate={animate}
        tabStop={keyboard.tabStop}
        legalId={legalId}
        onActivate={input.activate}
        onFocusCell={keyboard.onCellFocus}
        onKeyDown={keyboard.onKeyDown}
      />
      {showCoords ? <CoordLayer orientation={orientation} /> : null}
      <ArrowLayer arrows={arrows} orientation={orientation} />
      <BadgeLayer badges={props.badges ?? []} orientation={orientation} placement={placement} />
      {promo && promoPos && promoPiece ? (
        <PromotionPicker
          color={pieceColor(promoPiece)}
          col={promoPos.col}
          edge={promoPos.row === 0 ? "top" : "bottom"}
          onPick={input.pickPromotion}
          onCancel={input.cancelPromotion}
        />
      ) : null}
      {thumb ? null : (
        <span id={legalId} hidden>
          legal move
        </span>
      )}
    </div>
  );
}
