"use client";

// /dev/ui/train/{runner,puzzles} (phase-05 plan §2.1 "Dev demo routes"): the real TrainerRunner on the contract
// fixtures, with a script of user actions reaching the board state, a fixture extender for puzzle streams, and no
// outbox, socket or network. `saving` shows the done block with queued attempts.
import { extendResultFixture } from "@repo/contracts/http/fixtures/p05";
import type { SessionPayload } from "@repo/contracts/http/train";
import type { Extender } from "@/features/train/useSessionExtend";
import type { DemoStep } from "@/features/train/script";
import { TrainerRunner } from "./TrainerRunner";

const demoExtender: Extender = async (_ref, after) => {
  const n = Number(after.replace(/\D/g, "")) || 10;
  const res = extendResultFixture();
  return { ...res, items: res.items.map((it, i) => ({ ...it, itemId: `i${n + i + 1}` })) };
};

export function TrainerDemo({ payload, script, pendingOutbox }: { payload: SessionPayload; script: DemoStep[]; pendingOutbox?: number }) {
  return (
    <TrainerRunner
      payload={payload}
      userRef="demo-knight-owl"
      source={payload.kind === "puzzles" ? "nav" : "bank"}
      created={false}
      demo={{ script, pendingOutbox, extender: demoExtender }}
    />
  );
}
