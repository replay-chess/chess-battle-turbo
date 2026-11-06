"use client";

// The game-screen features of plan 13.1 G4 that are not part of the layout: keyboard shortcuts (`keys/*`),
// sounds (`sound/*`) and the screen-reader live regions. Rendered inside <GameProvider>, once per screen, for
// every controller (live, local, demo).

import { useGameHotkeys } from "../keys/useGameHotkeys";
import { useGameSounds } from "../sound/useGameSounds";
import { LiveRegions } from "./LiveRegions";

export function GameExtensions(): React.ReactNode {
  useGameHotkeys();
  useGameSounds();
  return <LiveRegions />;
}
