"use client";

// The eager side of the game-over `bank` slot (phase-05 plan §4.8, hand-off H-01): one `next/dynamic` stub, so
// /game/[ref]'s first load gains only a few hundred bytes (it is held to its budget). GameScreen / BotGameScreen merge
// it into P3's REVIEW_RESULT_SLOTS when `train` is on: `withBankSlot(REVIEW_RESULT_SLOTS, train)`.
import dynamic from "next/dynamic";
import type { ResultSlots } from "@/features/game/screen/GameOverCard";

const BankSlot = dynamic(() => import("./GameOverBankSlot").then((m) => m.GameOverBankSlot), { ssr: false });

/** The card's slots with the bank line added (train on), or unchanged (train off: no line, no chunk). */
export function withBankSlot(slots: ResultSlots, train: boolean): ResultSlots {
  return train ? { ...slots, bank: <BankSlot /> } : slots;
}
