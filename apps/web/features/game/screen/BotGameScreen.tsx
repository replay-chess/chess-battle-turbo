"use client";

// Bot games (plan 5.3): the same v3 screen over WP-H's local controller (engine in the browser, journal, beacons,
// complete). Part of /game/[ref]'s first load (GameScreen imports it eagerly: the screen renders in the document's
// shell, never as a streamed segment); the engine glue stays a lazy chunk (useBotEngine's lazyEngineHost).
// Keyed by ref, so a Rematch / Restart navigation always gets a fresh controller.

import type { GameSnapshot } from "@repo/game-core/snapshot";
import { REVIEW_RESULT_SLOTS } from "@/features/review/game-over/lazy";
import { withBankSlot } from "@/components/train/slots/GameOverBankSlotLazy";
import { useFlag } from "@/lib/flags/client";
import { useLocalGame } from "../local/useLocalGame";
import { GameView } from "./GameView";

export function BotGameScreen({ snapshot }: { snapshot: GameSnapshot }) {
  return <BotGame key={snapshot.ref} snapshot={snapshot} />;
}

function BotGame({ snapshot }: { snapshot: GameSnapshot }) {
  const controller = useLocalGame(snapshot);
  const reviewV3 = useFlag("review-v3");
  const train = useFlag("train"); // P5: the game-over Mistake Bank line (hand-off H-01)
  return <GameView controller={controller} resultSlots={reviewV3 ? withBankSlot(REVIEW_RESULT_SLOTS, train) : undefined} />;
}
