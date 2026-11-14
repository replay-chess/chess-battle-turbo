"use client";

// The game-over card's `bank` slot (phase-05 plan §4.8, COV C-01, P2 hand-off H-01; boards V3GameOver, V3GameOverLoss,
// V3Game `over_*` with `r.bankOn`, the device game-over boards and V4TournamentGameOver): one line under the accuracy
// line, "+1 position added to your Mistake Bank (move 13)." Loaded lazily (GameOverBankSlotLazy.tsx): /game/[ref] is at
// its First Load budget.
//
// Data: A2's `bank` in `qk.review.status(ref)`, the same cache the P3 slots read. The P3 primary drives that cache
// (A2 on mount, polling while the socket is down); this slot only adds `analysis:done.bankAdded` for its game (live),
// through handlers/train.ts applyBankAdded (a null `bankAdded`, a lost worker response, refetches A2). After a reload,
// A2 answers with the same `bank`, so the line comes back. Spectators, aborted games and the demo controller's
// socket are excluded; with `train` off the slot is not passed at all.
import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { AnalysisDoneEvent } from "@repo/contracts/socket/analysis";
import { useController, useGame, useView } from "@/features/game/screen/GameContext";
import { trackTrain } from "@/lib/analytics/train-events";
import { reviewStatusQuery } from "@/lib/api/queries/review";
import { getRealtime } from "@/lib/realtime/connection";
import { applyBankAdded } from "@/lib/realtime/handlers/train";
import { bankSlotLine, gameOverMode } from "./bank-line";
import "./game-over-bank.css";

export function GameOverBankSlot() {
  const view = useView();
  const ref = useGame((g) => g.state.ref);
  const startPly = useGame((g) => g.state.startPly);
  const mode = useGame((g) => g.state.mode);
  const controller = useController();
  const r = view.result;
  if (!r || r.spectator || r.method === "aborted") return null;
  return <BankLine gameRef={ref} startPly={startPly} mode={gameOverMode(mode)} live={controller.kind !== "demo"} />;
}

function BankLine({ gameRef, startPly, mode, live }: { gameRef: string; startPly: number; mode: ReturnType<typeof gameOverMode>; live: boolean }) {
  const qc = useQueryClient();
  // Observe the cache only: the P3 primary fetches and polls A2.
  const status = useQuery({ ...reviewStatusQuery(gameRef), enabled: false }).data;

  useEffect(() => {
    if (!live) return;
    const rt = getRealtime();
    if (!rt) return;
    return rt.on<AnalysisDoneEvent>("analysis:done", (frame) => {
      if (!frame || frame.gameRef !== gameRef) return;
      applyBankAdded(qc, frame);
    });
  }, [live, qc, gameRef]);

  const line = bankSlotLine(status, startPly);
  const count = status?.bank?.count ?? 0;
  // `game_over_bank_line_shown` once, on the first render with a line (plan §10.1).
  const shown = useRef(false);
  useEffect(() => {
    if (!line || shown.current) return;
    shown.current = true;
    trackTrain("game_over_bank_line_shown", { count: Math.min(count, 4), mode });
  }, [line, count, mode]);
  // Nothing at all until there is a line: an empty slot wrapper collapses (P3's lazy.css), so the card's gaps never
  // stack up. The line is a polite status region when it appears.
  if (!line) return null;
  return (
    <p className="rc-go-bank g-short-hide" role="status" aria-live="polite" data-testid="game-over-bank-line">
      {line}
    </p>
  );
}
