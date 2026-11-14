"use client";

// The /game/[ref] client root (plan 4.4, 7.10). Picks the controller: bot games always run the v3 screen with the
// local controller (WP-H); live human games run the v3 screen over protocol v2 when both `game-v3` and
// `live-protocol-v2` are on, else the legacy v1 screen (features/game/legacy, deleted at the parity gate).

import { useState } from "react";
import dynamic from "next/dynamic";
import { notFound } from "next/navigation";
import type { GameState } from "@repo/game-core/machine/types";
import type { GameSnapshot } from "@repo/game-core/snapshot";
import { ViewportStage } from "@/components/layout/ViewportStage";
import { useChrome } from "@/components/shell/chrome-context";
import { REVIEW_RESULT_SLOTS } from "@/features/review/game-over/lazy";
import { withBankSlot } from "@/components/train/slots/GameOverBankSlotLazy";
import { useFlag } from "@/lib/flags/client";
import { useLiveGame } from "../live/useLiveGame";
import type { JoinFailure } from "../live/useGameSocket";
import { BotGameScreen } from "./BotGameScreen";
import { GameView } from "./GameView";

const LegacyGame = dynamic(() => import("../legacy/GamePageContent").then((m) => m.GamePageContent), {
  ssr: false,
});

// No Suspense boundary anywhere between the document and the game screen (no route loading.tsx, no lazy screen, no
// lazy stage): the server's HTML is the screen and hydration adopts it. A boundary the server streams as a hidden
// `<div id="S:n">` segment is revealed by React's `$RV` on an animation frame; when an update during hydration (Clerk
// loading) makes React client-render that boundary first, the server's copy stays in the document, hidden, until a
// frame runs: two game-board-containers (CI 43211562326, 43226863882, 43438531034; bot-resume-starved-frames.spec).
// The bot screen is eager for that reason (it was a lazy chunk; /game/[ref] has room in its 600 kB budget). The bot
// engine itself still loads on demand (useBotEngine), and the pieces that render nothing on the server stay lazy.

export type GameScreenFlags = { gameV3: boolean; liveProtocolV2: boolean };

export type GameScreenProps = {
  snapshot: GameSnapshot;
  flags: GameScreenFlags;
  /** The viewer's user ref (the legacy screen needs it). */
  viewerRef: string;
};

export function GameScreen({ snapshot, flags, viewerRef }: GameScreenProps) {
  if (snapshot.mode === "BOT") {
    return (
      <V3Stage>
        <BotGameScreen snapshot={snapshot} />
      </V3Stage>
    );
  }
  if (!flags.gameV3 || !flags.liveProtocolV2) {
    return <LegacyGame gameId={snapshot.ref} userReferenceId={viewerRef} />;
  }
  return (
    <V3Stage>
      <LiveGameScreen snapshot={snapshot} />
    </V3Stage>
  );
}

/**
 * BoardStage needs a definite size from its parent. The app shell gives it one; with `shell-v3` off the (app) layout
 * renders the page bare, so the v3 screen brings its own full-viewport stage (as /dev/ui/game?chrome=none does).
 * regression: REGRESSION-2 — flags-off play-with-bot: the bot board rendered 0 px tall with the shell off.
 */
function V3Stage({ children }: { children: React.ReactNode }) {
  if (useChrome() === "shell") return children;
  // Eager (it was lazy): a lazy stage was a Suspense boundary around the whole screen. ViewportStage is a few lines.
  return <ViewportStage>{children}</ViewportStage>;
}

function LiveGameScreen({ snapshot }: { snapshot: GameState }) {
  const [failure, setFailure] = useState<JoinFailure | null>(null);
  const controller = useLiveGame(snapshot, setFailure);
  const reviewV3 = useFlag("review-v3");
  const train = useFlag("train"); // P5: the game-over Mistake Bank line (hand-off H-01)
  if (failure === "not_found" || failure === "forbidden") notFound();
  if (failure === "not_member" && typeof window !== "undefined") {
    window.location.assign(`/pricing?reason=expired&redirect_url=${encodeURIComponent(`/game/${snapshot.ref}`)}`);
  }
  return <GameView controller={controller} resultSlots={reviewV3 ? withBankSlot(REVIEW_RESULT_SLOTS, train) : undefined} />;
}
