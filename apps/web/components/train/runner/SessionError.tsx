"use client";

// A runner page that could not build its session (phase-05 plan §5.6): the hourly session limit (429
// `session_limit`), the daily puzzle fair-use cap (429 `daily_puzzle_limit`: "You've solved 400 puzzles today. More
// tomorrow."), or the puzzle shards unavailable (502 `upstream_unavailable`: "Puzzles are unavailable right now. Your
// Mistake Bank still works."), or puzzles switched off (PUZZLES_ENABLED=off, `details.kind: "disabled"`: "Puzzles
// are taking a break.", plan §7.9). The way on is a link (nothing retries a create by itself). A client component: it styles
// the link with `buttonVariants()` from the client UI kit, which a server component may not call (every 429/502 runner
// page crashed: regression: session-error-server-button, WP-I D-I3, e2e/specs/train/puzzles.spec.ts).
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

import type { SessionErrorKind } from "./session-error-kind";

export type { SessionErrorKind };

function waitText(sec: number | null): string {
  if (!sec || sec <= 0) return "Try again shortly.";
  const min = Math.ceil(sec / 60);
  return min <= 1 ? "Try again in a minute." : `Try again in ${min} minutes.`;
}

export function sessionErrorCopy(kind: SessionErrorKind, retryAfterSec: number | null, dailyLimit: number): { title: string; body: string } {
  switch (kind) {
    case "session_limit":
      return { title: "Take a Short Break", body: `You've started a lot of sessions this hour. ${waitText(retryAfterSec)}` };
    case "daily_puzzle_limit":
      return { title: "That's Today's Puzzles", body: `You've solved ${dailyLimit} puzzles today. More tomorrow.` };
    case "upstream_unavailable":
      return { title: "Puzzles Are Unavailable", body: "Puzzles are unavailable right now. Your Mistake Bank still works." };
    case "puzzles_disabled":
      // The PUZZLES_ENABLED kill switch (plan §7.9): an operator's pause, not an outage.
      return { title: "Puzzles Are Taking a Break", body: "Puzzles are taking a break. Your Mistake Bank still works." };
    case "unavailable":
      return { title: "Training Is Unavailable", body: "We couldn't start this session. Try again shortly." };
  }
}

export function SessionError({ kind, retryAfterSec = null, dailyLimit = 400 }: { kind: SessionErrorKind; retryAfterSec?: number | null; dailyLimit?: number }) {
  const c = sessionErrorCopy(kind, retryAfterSec, dailyLimit);
  const toBank = kind === "upstream_unavailable" || kind === "puzzles_disabled";
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto p-6" role="alert" data-testid="trainer-error" data-kind={kind}>
      <EmptyState
        title={c.title}
        body={c.body}
        ghostRows={0}
        size="card"
        primary={
          <Link className={buttonVariants({ variant: "primary", size: "lg" })} href={toBank ? "/train/bank" : "/train"} prefetch={false}>
            {toBank ? "Open Mistake Bank" : "Back to Train"}
          </Link>
        }
      />
    </div>
  );
}
