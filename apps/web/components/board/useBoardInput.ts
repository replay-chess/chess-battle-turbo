"use client";

/**
 * The board's input state machine (P2 plan §4.5.3, V3GamePrototype):
 * pointer down selects (and captures the pointer); a drag starts after 4 px and
 * follows the pointer at scale 1.06 above the other pieces; a drop on a target
 * moves with no slide, a drop elsewhere shakes the piece back; click-click moves
 * with the 180 ms slide; promotion opens the picker; premoves on the
 * opponent's turn; right-drag arrows and right-click highlights (local only);
 * touch long-press then drag draws an arrow while moves are locked.
 *
 * The drag position is written to the piece's transform from a ref inside
 * requestAnimationFrame: no React state changes per pointermove (optimization
 * §2.4). React renders only on select, lift, drop and arrow-square changes.
 */
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { squareAtPoint } from "./geometry";
import {
  currentSelection,
  decideClick,
  decideDrop,
  drawColor,
  toggleArrow,
  toggleMark,
  type BoardAction,
  type DrawColor,
  type DrawnArrow,
  type InputContext,
  type InputMode,
  type Selection,
} from "./logic";
import type { BoardMove, PromotionPiece, Side, Sq } from "./types";

export const DRAG_THRESHOLD_PX = 4;
export const LONG_PRESS_MS = 350;
export const SHAKE_MS = 360; // 2 × 180 ms keyframes

export interface BoardInputCallbacks {
  onMove: (m: BoardMove) => void;
  onPremove?: (m: BoardMove | null) => void;
  onIllegal?: (from: Sq, to: Sq) => void;
  onLockedAttempt?: () => void;
  onSelect?: (sq: Sq | null) => void;
  onPromotionOpen?: (from: Sq, to: Sq) => void;
  onPromotionCancel?: () => void;
}

export interface PendingPromotion {
  from: Sq;
  to: Sq;
  mode: InputMode;
  instant: boolean;
}

interface DragState {
  pointerId: number;
  from: Sq;
  sel: Selection;
  x0: number;
  y0: number;
  x: number;
  y: number;
  started: boolean;
  again: boolean;
  rect: DOMRect;
  /** Centre of the from-cell, for the translate. */
  cx: number;
  cy: number;
  img: HTMLElement | null;
  raf: number;
  hover: Sq | null;
}

interface DrawState {
  pointerId: number;
  from: Sq;
  to: Sq;
  color: DrawColor;
  rect: DOMRect;
}

interface LongPress {
  pointerId: number;
  sq: Sq;
  x0: number;
  y0: number;
  timer: ReturnType<typeof setTimeout>;
  rect: DOMRect;
}

const uci = (from: Sq, to: Sq, p?: PromotionPiece) => `${from}${to}${p ?? ""}`;

function pointSquare(rect: DOMRect, x: number, y: number, orientation: Side): Sq | null {
  if (!rect.width || !rect.height) return null;
  return squareAtPoint((x - rect.left) / rect.width, (y - rect.top) / rect.height, orientation);
}

export function useBoardInput({
  rootRef,
  ctx,
  orientation,
  enabled,
  allowDrawArrows,
  fenKey,
  callbacks,
}: {
  rootRef: RefObject<HTMLDivElement | null>;
  ctx: InputContext;
  orientation: Side;
  enabled: boolean;
  allowDrawArrows: boolean;
  fenKey: string;
  callbacks: BoardInputCallbacks;
}) {
  const [selected, setSelected] = useState<Selection | null>(null);
  const [promo, setPromo] = useState<PendingPromotion | null>(null);
  const [shake, setShake] = useState<{ sq: Sq; n: number } | null>(null);
  const [lifted, setLifted] = useState<Sq | null>(null);
  const [instant, setInstant] = useState<{ from: Sq; to: Sq } | null>(null);
  const [drawing, setDrawing] = useState<{ fen: string; arrows: DrawnArrow[]; marks: Partial<Record<Sq, DrawColor>> }>({
    fen: fenKey,
    arrows: [],
    marks: {},
  });
  const [preview, setPreview] = useState<DrawnArrow | null>(null);

  const drag = useRef<DragState | null>(null);
  const draw = useRef<DrawState | null>(null);
  const longPress = useRef<LongPress | null>(null);
  const shakeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (shakeTimer.current) clearTimeout(shakeTimer.current);
      if (longPress.current) clearTimeout(longPress.current.timer);
      if (drag.current?.raf) cancelAnimationFrame(drag.current.raf);
    },
    [],
  );

  // Drawings are local and cleared at the next move (the first move after study).
  const drawn = drawing.fen === fenKey ? drawing : { fen: fenKey, arrows: [], marks: {} };
  const sel = currentSelection(ctx, selected);

  const select = (next: Selection | null) => {
    setSelected(next);
    callbacks.onSelect?.(next?.sq ?? null);
  };

  const doShake = (sq: Sq) => {
    setShake((s) => ({ sq, n: (s?.n ?? 0) + 1 }));
    if (shakeTimer.current) clearTimeout(shakeTimer.current);
    shakeTimer.current = setTimeout(() => setShake(null), SHAKE_MS);
  };

  const emit = (from: Sq, to: Sq, promotion: PromotionPiece | undefined, mode: InputMode, isInstant: boolean) => {
    const m: BoardMove = promotion ? { from, to, promotion, uci: uci(from, to, promotion) } : { from, to, uci: uci(from, to) };
    select(null);
    if (mode === "move") {
      setInstant(isInstant ? { from, to } : null);
      callbacks.onMove(m);
    } else {
      callbacks.onPremove?.(m);
    }
  };

  const apply = (action: BoardAction, isInstant: boolean) => {
    switch (action.type) {
      case "select":
        select(action.sel);
        return;
      case "deselect":
        select(null);
        return;
      case "move":
        if (action.promotion) {
          select(null);
          setPromo({ from: action.from, to: action.to, mode: action.mode, instant: isInstant });
          callbacks.onPromotionOpen?.(action.from, action.to);
        } else {
          emit(action.from, action.to, undefined, action.mode, isInstant);
        }
        return;
      case "illegal":
        doShake(action.from);
        callbacks.onIllegal?.(action.from, action.to);
        return;
      case "cancel-premove":
        select(null);
        callbacks.onPremove?.(null);
        return;
      case "locked":
        callbacks.onLockedAttempt?.();
        return;
      case "none":
        return;
    }
  };

  const clearDrawings = () => {
    if (drawn.arrows.length || Object.keys(drawn.marks).length) setDrawing({ fen: fenKey, arrows: [], marks: {} });
  };

  const releaseDrag = (d: DragState) => {
    if (d.raf) cancelAnimationFrame(d.raf);
    if (d.img) d.img.style.transform = "";
    if (d.hover) rootRef.current?.querySelector(`[data-square="${d.hover}"]`)?.removeAttribute("data-drop");
  };

  const paintDrag = () => {
    const d = drag.current;
    if (!d) return;
    d.raf = 0;
    if (d.img) d.img.style.transform = `translate(${d.x - d.cx}px, ${d.y - d.cy}px) scale(1.06)`;
    const over = pointSquare(d.rect, d.x, d.y, orientation);
    const hover = over && over !== d.from ? over : null;
    if (hover !== d.hover) {
      const root = rootRef.current;
      if (d.hover) root?.querySelector(`[data-square="${d.hover}"]`)?.removeAttribute("data-drop");
      if (hover) root?.querySelector(`[data-square="${hover}"]`)?.setAttribute("data-drop", "");
      d.hover = hover;
    }
  };

  const capture = (e: ReactPointerEvent<HTMLDivElement>) => {
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Synthetic or already-released pointers cannot be captured; the drag still works inside the board.
    }
  };

  const startDrag = (e: ReactPointerEvent<HTMLDivElement>, rect: DOMRect, s: Selection, again: boolean) => {
    const root = rootRef.current;
    const cell = root?.querySelector<HTMLElement>(`[data-square="${s.sq}"]`) ?? null;
    const img = cell?.querySelector<HTMLElement>(".rc-bd-piece") ?? null;
    const cr = cell?.getBoundingClientRect();
    drag.current = {
      pointerId: e.pointerId,
      from: s.sq,
      sel: s,
      x0: e.clientX,
      y0: e.clientY,
      x: e.clientX,
      y: e.clientY,
      started: false,
      again,
      rect,
      cx: cr ? cr.left + cr.width / 2 : e.clientX,
      cy: cr ? cr.top + cr.height / 2 : e.clientY,
      img,
      raf: 0,
      hover: null,
    };
    capture(e);
  };

  const startDraw = (pointerId: number, rect: DOMRect, from: Sq, color: DrawColor) => {
    draw.current = { pointerId, from, to: from, color, rect };
    setPreview({ from, to: from, color });
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!enabled || promo) return;
    if ((e.target as HTMLElement).closest?.("[data-rc-bd-promo]")) return;
    const root = rootRef.current;
    if (!root) return;
    const rect = root.getBoundingClientRect();
    const sq = pointSquare(rect, e.clientX, e.clientY, orientation);

    if (e.button === 2) {
      e.preventDefault();
      if (ctx.premove) {
        select(null);
        callbacks.onPremove?.(null);
        return;
      }
      if (sel) select(null);
      if (allowDrawArrows && sq) {
        startDraw(e.pointerId, rect, sq, drawColor(e));
        capture(e);
      }
      return;
    }
    if (e.button !== 0) return;
    // Keep focus and text selection off the board for pointer input; keyboard focus is separate.
    e.preventDefault();
    clearDrawings();
    if (!sq) return;

    if (sel && sq === sel.sq) {
      startDrag(e, rect, sel, true);
      return;
    }
    const action = decideClick(ctx, selected, sq);
    apply(action, false);
    if (action.type === "select") {
      startDrag(e, rect, action.sel, false);
      return;
    }
    if ((action.type === "none" || action.type === "locked") && allowDrawArrows && e.pointerType === "touch") {
      const pointerId = e.pointerId;
      capture(e);
      longPress.current = {
        pointerId,
        sq,
        x0: e.clientX,
        y0: e.clientY,
        rect,
        timer: setTimeout(() => {
          const lp = longPress.current;
          longPress.current = null;
          if (lp) startDraw(lp.pointerId, lp.rect, lp.sq, "green");
        }, LONG_PRESS_MS),
      };
    }
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const lp = longPress.current;
    if (lp && lp.pointerId === e.pointerId && Math.hypot(e.clientX - lp.x0, e.clientY - lp.y0) > 8) {
      clearTimeout(lp.timer);
      longPress.current = null;
    }
    const dr = draw.current;
    if (dr && dr.pointerId === e.pointerId) {
      const sq = pointSquare(dr.rect, e.clientX, e.clientY, orientation);
      if (sq && sq !== dr.to) {
        dr.to = sq;
        setPreview({ from: dr.from, to: sq, color: dr.color });
      }
      return;
    }
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    d.x = e.clientX;
    d.y = e.clientY;
    if (!d.started) {
      if (Math.hypot(d.x - d.x0, d.y - d.y0) <= DRAG_THRESHOLD_PX) return;
      d.started = true;
      setLifted(d.from);
    }
    if (!d.raf) d.raf = requestAnimationFrame(paintDrag);
  };

  const finishDraw = (dr: DrawState) => {
    draw.current = null;
    setPreview(null);
    if (dr.to === dr.from) {
      setDrawing({ fen: fenKey, arrows: drawn.arrows, marks: toggleMark(drawn.marks, dr.from, dr.color) });
    } else {
      setDrawing({ fen: fenKey, arrows: toggleArrow(drawn.arrows, { from: dr.from, to: dr.to, color: dr.color }), marks: drawn.marks });
    }
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const lp = longPress.current;
    if (lp && lp.pointerId === e.pointerId) {
      clearTimeout(lp.timer);
      longPress.current = null;
    }
    const dr = draw.current;
    if (dr && dr.pointerId === e.pointerId) {
      finishDraw(dr);
      return;
    }
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    drag.current = null;
    releaseDrag(d);
    if (d.started) {
      setLifted(null);
      const to = pointSquare(d.rect, e.clientX, e.clientY, orientation);
      apply(decideDrop(ctx, d.sel, to), true);
    } else if (d.again) {
      select(null);
    }
  };

  const onPointerCancel = (e: ReactPointerEvent<HTMLDivElement>) => {
    const lp = longPress.current;
    if (lp && lp.pointerId === e.pointerId) {
      clearTimeout(lp.timer);
      longPress.current = null;
    }
    if (draw.current?.pointerId === e.pointerId) {
      draw.current = null;
      setPreview(null);
    }
    const d = drag.current;
    if (d && d.pointerId === e.pointerId) {
      drag.current = null;
      releaseDrag(d);
      if (d.started) setLifted(null);
    }
  };

  /** Keyboard and assistive-technology activation of a square (no drag). */
  const activate = (sq: Sq) => {
    if (!enabled || promo) return;
    clearDrawings();
    apply(decideClick(ctx, selected, sq), false);
  };

  const pickPromotion = (piece: PromotionPiece) => {
    const p = promo;
    if (!p) return;
    setPromo(null);
    emit(p.from, p.to, piece, p.mode, p.instant);
  };

  const cancelPromotion = () => {
    if (!promo) return;
    setPromo(null);
    callbacks.onPromotionCancel?.();
  };

  /** Esc inside the board: promotion, then selection, then premove, then drawings. Returns whether it acted. */
  const cancel = (): boolean => {
    if (promo) {
      cancelPromotion();
      return true;
    }
    if (sel) {
      select(null);
      return true;
    }
    if (ctx.premove) {
      callbacks.onPremove?.(null);
      return true;
    }
    if (drawn.arrows.length || Object.keys(drawn.marks).length) {
      clearDrawings();
      return true;
    }
    return false;
  };

  return {
    selected: sel,
    promo,
    shake,
    lifted,
    instant,
    drawnArrows: drawn.arrows,
    drawnMarks: drawn.marks,
    preview,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel,
      onLostPointerCapture: onPointerCancel,
      onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
      // A pointer press must not move focus onto a grid cell (Chrome focuses on mousedown even when pointerdown was
      // prevented), so ←/→ keep stepping plies after a mouse move. Keyboard focus is unchanged; the picker keeps its own.
      onMouseDown: (e: React.MouseEvent) => {
        if (e.button === 0 && !(e.target as HTMLElement).closest?.("[data-rc-bd-promo]")) e.preventDefault();
      },
    },
    activate,
    cancel,
    pickPromotion,
    cancelPromotion,
  };
}
