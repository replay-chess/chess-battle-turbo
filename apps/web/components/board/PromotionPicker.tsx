"use client";

/**
 * Promotion picker (P2 plan §4.5.1, V3GamePromotion): a column of Q, R, B, N on
 * the promotion file, running from the promotion square towards the centre, the
 * queen ringed and focused, then ESC. A board child (so the board's
 * container-type never breaks its positioning). Keys while open: Q R B N pick,
 * Esc cancels, arrows move between the items. The move is not emitted until a
 * piece is picked (the server requires the piece, play-a B12).
 */
import { useEffect, useRef } from "react";
import { isKeyboardClick } from "./logic";
import { pieceSrc } from "./PieceLayer";
import type { PromotionPiece, Side } from "./types";

const OPTIONS: { piece: PromotionPiece; name: string }[] = [
  { piece: "q", name: "queen" },
  { piece: "r", name: "rook" },
  { piece: "b", name: "bishop" },
  { piece: "n", name: "knight" },
];

function isEditable(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || typeof el.closest !== "function") return false;
  return !!el.closest("input, textarea, select, [contenteditable='true']");
}

export function PromotionPicker({
  color,
  col,
  edge,
  onPick,
  onCancel,
}: {
  color: Side;
  /** Display column of the promotion square (0..7). */
  col: number;
  /** The board edge the promotion square sits on. */
  edge: "top" | "bottom";
  onPick: (p: PromotionPiece) => void;
  onCancel: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  // The tap that opened the picker ends over it: its synthesized click must not pick the queen or cancel.
  // Pointer clicks count only after a pointerdown inside the picker; keyboard clicks always count.
  const armed = useRef<"menu" | "backdrop" | null>(null);
  const accept = (e: React.MouseEvent, where: "menu" | "backdrop") => isKeyboardClick(e) || armed.current === where;
  const pickRef = useRef(onPick);
  const cancelRef = useRef(onCancel);
  useEffect(() => {
    pickRef.current = onPick;
    cancelRef.current = onCancel;
  });

  useEffect(() => {
    menuRef.current?.querySelector<HTMLButtonElement>("[data-default]")?.focus({ preventScroll: true });
    // One listener for the picker's keys wherever focus is, so page shortcuts (F, M, …) never see them.
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        cancelRef.current();
        return;
      }
      if (isEditable(e.target)) return;
      const k = e.key.toLowerCase();
      if (k === "q" || k === "r" || k === "b" || k === "n") {
        e.preventDefault();
        e.stopPropagation();
        pickRef.current(k);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  const onMenuKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    const items = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])];
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    // Visual order: column-reverse on the bottom edge flips what "down" means.
    const down = (e.key === "ArrowDown") === (edge === "top");
    let next = i;
    if (e.key === "Home") next = 0;
    else if (e.key === "End") next = items.length - 1;
    else next = (i + (down ? 1 : -1) + items.length) % items.length;
    items[next]?.focus();
  };

  return (
    <>
      <div
        className="rc-bd-promo-backdrop"
        data-rc-bd-promo=""
        aria-hidden="true"
        onPointerDown={() => {
          armed.current = "backdrop";
        }}
        onClick={(e) => {
          if (accept(e, "backdrop")) onCancel();
        }}
      />
      <div
        ref={menuRef}
        role="menu"
        aria-label="Choose a promotion piece"
        aria-orientation="vertical"
        className="rc-bd-promo"
        data-rc-bd-promo=""
        data-testid="promotion-picker"
        data-edge={edge}
        style={{ left: `${col * 12.5}%`, ...(edge === "top" ? { top: 0 } : { bottom: 0 }) }}
        onKeyDown={onMenuKey}
        onPointerDown={() => {
          armed.current = "menu";
        }}
      >
        {OPTIONS.map((o, i) => (
          <button
            key={o.piece}
            type="button"
            role="menuitem"
            aria-label={`Promote to ${o.name}`}
            data-promotion={o.piece}
            data-default={i === 0 ? "" : undefined}
            tabIndex={i === 0 ? 0 : -1}
            onClick={(e) => {
              if (accept(e, "menu")) onPick(o.piece);
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- piece PNG, same set as the board */}
            <img src={pieceSrc(`${color}${o.piece}`)} alt="" draggable={false} />
          </button>
        ))}
        <button
          type="button"
          role="menuitem"
          aria-label="Esc, cancel promotion"
          data-esc=""
          tabIndex={-1}
          onClick={(e) => {
            if (accept(e, "menu")) onCancel();
          }}
        >
          ESC
        </button>
      </div>
    </>
  );
}
