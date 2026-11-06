/**
 * The board's input decisions (P2 plan §4.5.3), pure so they are unit-tested
 * without a DOM (logic.test.ts). useBoardInput maps pointer, keyboard and
 * picker events onto these and applies the result.
 */
import { isPromotionMove, pieceColor, type Placement } from "./geometry";
import type { Side, Sq } from "./types";

export type InputMode = "move" | "premove";

export interface Selection {
  sq: Sq;
  mode: InputMode;
}

export interface InputContext {
  placement: Placement;
  mover: Side | null;
  premover: Side | null;
  dests: (from: Sq) => Sq[];
  premoveDests?: (from: Sq) => Sq[];
  premove: { from: Sq; to: Sq } | null;
  /** Thumb boards and boards without a mover/premover still report locked presses. */
  canReportLocked: boolean;
}

export type BoardAction =
  | { type: "none" }
  | { type: "select"; sel: Selection }
  | { type: "deselect" }
  | { type: "move"; from: Sq; to: Sq; mode: InputMode; promotion: boolean }
  | { type: "illegal"; from: Sq; to: Sq }
  | { type: "cancel-premove" }
  | { type: "locked" };

/** How a piece on `sq` can be picked up now, if at all. */
export function selectableMode(ctx: InputContext, sq: Sq): InputMode | null {
  const p = ctx.placement.get(sq);
  if (!p) return null;
  const c = pieceColor(p);
  if (ctx.mover && c === ctx.mover) return "move";
  if (ctx.premover && c === ctx.premover && ctx.premoveDests) return "premove";
  return null;
}

/** The selection as it stands under the current props (the turn may have passed since it was made). */
export function currentSelection(ctx: InputContext, sel: Selection | null): Selection | null {
  if (!sel) return null;
  const mode = selectableMode(ctx, sel.sq);
  return mode ? { sq: sel.sq, mode } : null;
}

export function targetsOf(ctx: InputContext, sel: Selection | null): Sq[] {
  if (!sel) return [];
  if (sel.mode === "move") return ctx.dests(sel.sq);
  return ctx.premoveDests?.(sel.sq) ?? [];
}

/**
 * A click (pointer down, tap, Enter/Space) on `sq`. Same-square presses with a
 * pointer are handled by the caller (they may start a drag); here a press on the
 * selected square deselects.
 */
export function decideClick(ctx: InputContext, selected: Selection | null, sq: Sq): BoardAction {
  const sel = currentSelection(ctx, selected);
  if (ctx.premove && sq === ctx.premove.from && (!sel || sel.sq === sq)) return { type: "cancel-premove" };
  if (sel) {
    if (sq === sel.sq) return { type: "deselect" };
    if (targetsOf(ctx, sel).includes(sq)) {
      return { type: "move", from: sel.sq, to: sq, mode: sel.mode, promotion: isPromotionMove(ctx.placement, sel.sq, sq) };
    }
    const mode = selectableMode(ctx, sq);
    if (mode) return { type: "select", sel: { sq, mode } };
    if (ctx.placement.has(sq)) return { type: "illegal", from: sel.sq, to: sq };
    return { type: "deselect" };
  }
  const mode = selectableMode(ctx, sq);
  if (mode) return { type: "select", sel: { sq, mode } };
  if (!ctx.mover && !ctx.premover && ctx.canReportLocked && ctx.placement.has(sq)) return { type: "locked" };
  return { type: "none" };
}

/** The end of a drag that started on `sel.sq`. `to` = null: released outside the board. */
export function decideDrop(ctx: InputContext, selected: Selection | null, to: Sq | null): BoardAction {
  const sel = currentSelection(ctx, selected);
  if (!sel || !to || to === sel.sq) return { type: "none" };
  if (targetsOf(ctx, sel).includes(to)) {
    return { type: "move", from: sel.sq, to, mode: sel.mode, promotion: isPromotionMove(ctx.placement, sel.sq, to) };
  }
  return { type: "illegal", from: sel.sq, to };
}

export const DRAW_COLORS = { green: "green", red: "red", blue: "blue" } as const;
export type DrawColor = keyof typeof DRAW_COLORS;

/** Right-drag colour: green; Shift = red; Alt = blue (§4.5.3 rule 6). */
export function drawColor(e: { shiftKey: boolean; altKey: boolean }): DrawColor {
  if (e.shiftKey) return "red";
  if (e.altKey) return "blue";
  return "green";
}

export interface DrawnArrow {
  from: Sq;
  to: Sq;
  color: DrawColor;
}

/** Drawing the same arrow again removes it; another colour replaces it. */
export function toggleArrow(list: readonly DrawnArrow[], a: DrawnArrow): DrawnArrow[] {
  const i = list.findIndex((x) => x.from === a.from && x.to === a.to);
  if (i < 0) return [...list, a];
  if (list[i]!.color === a.color) return list.filter((_, j) => j !== i);
  return list.map((x, j) => (j === i ? a : x));
}

export function toggleMark(marks: Partial<Record<Sq, DrawColor>>, sq: Sq, color: DrawColor): Partial<Record<Sq, DrawColor>> {
  const next = { ...marks };
  if (next[sq] === color) delete next[sq];
  else next[sq] = color;
  return next;
}

/**
 * A click that came from the keyboard or assistive technology (Enter/Space on a
 * focused button), not the click a browser synthesizes after a pointer or a tap.
 * Chrome's tap emulation sends that click with detail 0 and pointerType "mouse",
 * so detail alone is not enough.
 */
export function isKeyboardClick(e: { detail: number; nativeEvent: Event }): boolean {
  if (e.detail !== 0) return false;
  const pt = (e.nativeEvent as Event & { pointerType?: string }).pointerType;
  return !pt;
}
