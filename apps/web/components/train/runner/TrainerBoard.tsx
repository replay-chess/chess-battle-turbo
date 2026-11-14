"use client";

// The trainer's board (§4.4, §5.2 "Prefetch / pre-render"): the current item's P2 Board, and the next item's board
// rendered underneath (invisible, inert, aria-hidden) at a deferred priority, keyed by itemId. On a grade the next
// board is already in the DOM, so the swap is an attribute change, not a mount (grade → next ≤ 50 ms, §9.6). The
// move check is local (features/train/validate.ts) and the verdict paint is measured (`rc:train-move-verdict`).
import { useDeferredValue, useEffect } from "react";
import { Board } from "@/components/board/Board";
import type { BoardBadge, BoardMove, Sq } from "@/components/board/types";
import type { TrainItem } from "@repo/contracts/http/train";
import { measureMoveVerdict, type RouteClass } from "@/features/train/telemetry";
import { destsOf, type PreparedItem } from "@/features/train/validate";
import type { RunView } from "@/features/train/machine";
import { preRenderedNext } from "./next-board";

const NO_DESTS = (): Sq[] => [];
const NO_MOVE = (): void => undefined;
const BADGE_LABEL = { best: "Best move", good: "Good move" } as const;

export function boardLabel(i: number, n: number, status: string, side: "w" | "b"): string {
  return `Puzzle ${i + 1} of ${n}. ${status} You play ${side === "w" ? "White" : "Black"}.`;
}

export function TrainerBoard({
  current,
  next,
  routeClass,
  animate,
  onMove,
}: {
  current: { item: TrainItem; prepared: PreparedItem; view: RunView; index: number; total: number };
  next: TrainItem | null;
  routeClass: RouteClass;
  /** False under reduced motion (pieces appear, no slide). */
  animate: boolean;
  onMove: (m: BoardMove) => void;
}) {
  const { item, prepared, view } = current;
  const deferredNext = preRenderedNext(current.item.itemId, useDeferredValue(next));
  const dests = view.mover ? (from: Sq) => (destsOf(view.fen).get(from) ?? []) as Sq[] : NO_DESTS;
  const badges: BoardBadge[] = view.badge ? [{ sq: view.badge.sq as Sq, kind: view.badge.kind, label: BADGE_LABEL[view.badge.kind] }] : [];
  // The paint that shows a verdict (wrong marks, the reply, the solved square) ends the move measure.
  const shown = `${view.fen}|${view.lastMove?.join("") ?? ""}|${Object.keys(view.highlights).join("")}|${view.mover ?? ""}`;
  useEffect(() => measureMoveVerdict(routeClass), [shown, routeClass]);
  return (
    <div className="tr-boards" data-testid="trainer-board" data-item={item.itemId} data-input={view.mover ? "" : undefined}>
      <div key={item.itemId}>
        <Board
          fen={view.fen}
          orientation={item.orient}
          mover={view.mover}
          dests={dests}
          onMove={view.mover ? onMove : NO_MOVE}
          lastMove={view.lastMove as readonly [Sq, Sq] | null}
          check={view.check as Sq | null}
          highlights={view.highlights as Partial<Record<Sq, string>>}
          rings={view.rings as Partial<Record<Sq, string>>}
          arrows={view.arrows as { from: Sq; to: Sq; color: string }[]}
          badges={badges}
          animationMs={animate ? 180 : 0}
          label={boardLabel(current.index, current.total, view.status, prepared.userSide)}
        />
      </div>
      {deferredNext ? (
        <div key={deferredNext.itemId} data-next="" aria-hidden="true" inert>
          <Board
            fen={deferredNext.fen}
            orientation={deferredNext.orient}
            mover={null}
            dests={NO_DESTS}
            onMove={NO_MOVE}
            lastMove={deferredNext.lastMove as readonly [Sq, Sq] | null}
            label="Next position"
            testId="trainer-next-board"
          />
        </div>
      ) : null}
    </div>
  );
}
