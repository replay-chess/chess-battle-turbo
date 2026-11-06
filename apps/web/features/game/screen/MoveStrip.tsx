"use client";

// Stack mode (phones, iPad portrait): the last 8 plies as a horizontal strip under the board; tapping it opens the
// full list in a bottom Sheet (plan 4.2, 4.6.3).

import { useState } from "react";
import { absPly } from "@repo/game-core/client/reducer";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { BUTTONS } from "../copy";
import { useDispatch, useGame } from "./GameContext";
import { IconList } from "./icons";
import { moveCells, MoveList } from "./MoveList";

const STRIP_PLIES = 8;

export function MoveStrip() {
  const state = useGame((g) => g.state);
  const view = useGame((g) => g.view);
  const dispatch = useDispatch();
  const [open, setOpen] = useState(false);
  const live = absPly(state);
  const current = view ?? live;
  const cells = moveCells(state).filter((c) => !c.prefix).slice(-STRIP_PLIES);

  return (
    <div className="g-strip" data-g-stack="" data-testid="move-strip">
      <div className="g-strip__cells" role="list" aria-label="Last moves">
        {cells.map((c) => {
          const no = Math.floor((c.ply - 1) / 2) + 1;
          const label = c.ply % 2 === 1 ? `${no}.${c.san}` : c.san;
          return (
            <button
              key={c.ply}
              type="button"
              role="listitem"
              className="g-mv"
              aria-current={c.ply === current ? "true" : undefined}
              onClick={() => dispatch({ type: "view", ply: c.ply >= live ? null : c.ply })}
            >
              {label}
            </button>
          );
        })}
      </div>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <button type="button" className="g-act g-sq44" aria-label={BUTTONS.moves} data-testid="open-moves">
            <IconList />
          </button>
        </SheetTrigger>
        <SheetContent title={BUTTONS.moves} height="60" bodyClassName="p-0">
          <MoveList />
        </SheetContent>
      </Sheet>
    </div>
  );
}
