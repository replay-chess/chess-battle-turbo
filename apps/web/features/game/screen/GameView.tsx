"use client";

// The v3 game layout for any controller (live, local, demo): BoardStage with the two player bars, the board, the
// panel (aside) and the phone control bar (footer). One viewport on every device (plan 4.2): the board and both
// bars are always on screen; only the move list and the zone scroll inside their own regions.

import { BoardStage } from "@/components/layout/BoardStage";
import type { GameController } from "../controller";
import { GameActionBar } from "./GameActions";
import { GameBoardArea } from "./GameBoardArea";
import { GameProvider, usePrefs } from "./GameContext";
import type { ResultSlots } from "./GameOverCard";
import { GamePanel } from "./GamePanel";
import { GameExtensions } from "./extensions";
import { PlayerBar } from "./PlayerBar";
import { useFocusRestore } from "./useFocusRestore";
import "./game.css";

export type GameViewProps = {
  controller: GameController;
  /** Result-card slots owned by later phases (plan 2.4). */
  resultSlots?: ResultSlots;
  /** Start with the board flipped (the demo route's `flip=1`). */
  initialFlipped?: boolean;
};

export function GameView({ controller, resultSlots, initialFlipped }: GameViewProps) {
  return (
    <GameProvider controller={controller} initialFlipped={initialFlipped}>
      <GameLayout resultSlots={resultSlots} />
      <GameExtensions />
    </GameProvider>
  );
}

function GameLayout({ resultSlots }: { resultSlots?: ResultSlots }) {
  const { flipped } = usePrefs();
  useFocusRestore();
  return (
    // display:contents keeps BoardStage the grid item of the locked page (it needs the definite track size);
    // data-rc-game lets game.css hide the phone tab bar for the whole screen.
    <div data-rc-game="" style={{ display: "contents" }}>
      <BoardStage
        label="Board"
        asideWidth="game"
        top={<PlayerBar who={flipped ? "me" : "opp"} pos="top" />}
        bottom={<PlayerBar who={flipped ? "opp" : "me"} pos="bottom" />}
        board={<GameBoardArea />}
        aside={<GamePanel resultSlots={resultSlots} />}
        footer={<GameActionBar resultSlots={resultSlots} />}
      />
    </div>
  );
}
