"use client";

// The /game/[ref] client root (plan 4.4, 7.10). Picks the controller: bot games always run the v3 screen with the
// local controller (WP-H); live human games run the v3 screen over protocol v2 when both `game-v3` and
// `live-protocol-v2` are on, else the legacy v1 screen (features/game/legacy, deleted at the parity gate).

import { lazy, Suspense, useState } from "react";
import dynamic from "next/dynamic";
import { notFound } from "next/navigation";
import type { GameState } from "@repo/game-core/machine/types";
import type { GameSnapshot } from "@repo/game-core/snapshot";
import { useChrome } from "@/components/shell/chrome-context";
import { REVIEW_RESULT_SLOTS } from "@/features/review/game-over/lazy";
import { useFlag } from "@/lib/flags/client";
import { useLiveGame } from "../live/useLiveGame";
import type { JoinFailure } from "../live/useGameSocket";
import { GameView } from "./GameView";

const LegacyGame = dynamic(() => import("../legacy/GamePageContent").then((m) => m.GamePageContent), {
  ssr: false,
});

// Bot games: their own chunk, so PvP and spectator pages never load the bot code (or the engine). React.lazy under
// a Suspense boundary of its own, server-rendered (the server waits for the module) and hydrated once the chunk is
// in. Not next/dynamic `ssr: true`: that one hydrated with different useId values below it than the server
// rendered (every Radix and board id mismatched).
const BotGameScreen = lazy(() => import("./BotGameScreen").then((m) => ({ default: m.BotGameScreen })));

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
        <Suspense fallback={null}>
          <BotGameScreen snapshot={snapshot} />
        </Suspense>
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
  return (
    <Suspense fallback={null}>
      <ShellOffStage>{children}</ShellOffStage>
    </Suspense>
  );
}

// Lazy: only the shell-off (rollback) path needs it, and the /game route is at its 600 kB budget.
const ShellOffStage = lazy(() => import("@/components/layout/ViewportStage").then((m) => ({ default: m.ViewportStage })));

function LiveGameScreen({ snapshot }: { snapshot: GameState }) {
  const [failure, setFailure] = useState<JoinFailure | null>(null);
  const controller = useLiveGame(snapshot, setFailure);
  const reviewV3 = useFlag("review-v3");
  if (failure === "not_found" || failure === "forbidden") notFound();
  if (failure === "not_member" && typeof window !== "undefined") {
    window.location.assign(`/pricing?reason=expired&redirect_url=${encodeURIComponent(`/game/${snapshot.ref}`)}`);
  }
  return <GameView controller={controller} resultSlots={reviewV3 ? REVIEW_RESULT_SLOTS : undefined} />;
}
