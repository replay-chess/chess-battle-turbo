"use client";

// The board of the review's route loading state (app/(app)/review/[ref]/loading.tsx is a server component): the
// interactive Board takes functions (dests, onMove), which a server component cannot pass to a client component, so
// the skeleton renders it from here, from the start position, with no input.
import { Board } from "@/components/board/Board";
import type { Sq } from "@/components/board/types";

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const NO_DESTS = (): Sq[] => [];
const NO_MOVE = (): void => undefined;

export function LoadingBoard() {
  return <Board fen={START} orientation="w" mover={null} dests={NO_DESTS} onMove={NO_MOVE} thumb label="Loading board" />;
}
