"use client";

// The grade flow (phase-05 plan §5.4 steps 1–3, §8.3): build the `AttemptIn`, write it to the outbox (IndexedDB)
// **before** the runner advances, then advance locally: the Again re-queue, the interval toast from the item's own
// preview ("Back in 4 days"), the optimistic badge decrement for a bank card's first grade today, and
// `train_item_graded`. The outbox scheduler flushes in batches (≥ 3 queued, 4 s idle, session end, hidden tab).
// The server's answer is authoritative and arrives through the outbox events (lib/offline/attempts-sync.ts).
import type { AttemptIn, Badges } from "@repo/contracts/http/train";
import type { MeData } from "@repo/contracts/http/me";
import type { GradeKey } from "@repo/chess-training/grade";
import { useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";
import { notify } from "@/components/ui/toast";
import { intervalDays, isOverridden, trackTrain } from "@/lib/analytics/train-events";
import { qk } from "@/lib/api/keys";
import { getAttemptsScheduler } from "@/lib/offline/attempts-sync";
import { enqueueAttempt } from "@/lib/offline/outbox";
import { applyBankDue } from "@/lib/realtime/handlers/train";
import { flagsOf, viewOf } from "./machine";
import type { GradeCommit, RunnerState, RunnerStore } from "./runner-store";
import { markGradeStart } from "./telemetry";

export function newAttemptId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    // RFC 4122 v4 from Math.random where crypto.randomUUID is missing (old Safari over http in dev).
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
    });
  }
}

/** The W1 attempt for the current graded item, or null when nothing is gradable. */
export function buildAttempt(s: RunnerState, grade: GradeKey, sessionRef: string | null, now: Date, id: string = newAttemptId()): AttemptIn | null {
  const item = s.items[s.index];
  const p = item ? s.prepared[item.itemId] : null;
  if (!item || !p || !s.run || s.run.phase !== "graded") return null;
  const v = viewOf(item, p, s.run);
  const f = flagsOf(s.run, item);
  return {
    clientAttemptId: id,
    sessionRef,
    itemId: item.itemId,
    cardRef: item.cardRef,
    puzzleId: item.puzzleId,
    kind: item.kind,
    solved: !f.shown,
    firstTry: v.firstTry,
    hintsUsed: s.run.hints,
    wrongMovesUci: s.run.wrongMoves,
    solutionShown: f.shown,
    timeMs: Math.max(0, Math.min(3_600_000, now.getTime() - s.itemStartedAt)),
    grade,
    suggestedGrade: v.suggested ?? grade,
    cardReps: item.cardReps,
    reviewedAt: now.toISOString(),
  };
}

/** "Back in 4 days" / "Back in under 10 min" (toast copy: no trailing period). */
export function backInLabel(label: string): string {
  return label.startsWith("<") ? `Back in under ${label.replace(/^<\s*/, "")}` : `Back in ${label}`;
}

export type GradeDeps = {
  store: RunnerStore;
  userRef: string;
  sessionRef: string;
  /** /dev/ui demos: no outbox, no network, no toasts that leave the page. */
  demo?: boolean;
  /** Called after the advance (the runner moves focus and measures grade → next board). */
  onGraded?: (commit: GradeCommit, attempt: AttemptIn) => void;
};

/** Returns `grade(g)`: durable enqueue, then advance. A second call while one is in flight is ignored. */
export function useGrade({ store, userRef, sessionRef, demo = false, onGraded }: GradeDeps): (g: GradeKey) => Promise<void> {
  const qc = useQueryClient();
  const busy = useRef(false);
  return async (g) => {
    if (busy.current) return;
    busy.current = true;
    try {
      const attempt = buildAttempt(store.getState(), g, sessionRef, new Date());
      if (!attempt) return;
      markGradeStart();
      if (!demo) {
        const pending = await enqueueAttempt(userRef, attempt);
        getAttemptsScheduler(userRef).noteEnqueued(pending);
      }
      const commit = store.getState().grade(g);
      if (!commit) return;
      const { item, graded } = commit;
      if (item.preview && commit.intervalLabel) notify.info(backInLabel(commit.intervalLabel), { id: "train-interval" });
      // A bank card's first grade today leaves the due count (the server confirms on flush).
      if (!demo && item.pass === 1 && item.preview && item.cardRef?.startsWith("m_") && store.getState().countsTowardCap) {
        const due = qc.getQueryData<Badges>(qk.badges())?.bankDue ?? qc.getQueryData<MeData & { badges?: Badges }>(qk.me())?.badges?.bankDue;
        if (typeof due === "number" && due > 0) applyBankDue(qc, due - 1);
      }
      trackTrain("train_item_graded", {
        grade: g,
        suggested: graded.suggested,
        overridden: isOverridden(g, graded.suggested),
        first_try: graded.firstTry,
        hints: graded.hints,
        wrongs: Math.min(10, graded.wrongs),
        time_ms: commit.timeMs,
        interval_days: intervalDays(commit.intervalDays),
        kind: item.kind,
        pass: item.pass,
        offline: typeof navigator !== "undefined" && navigator.onLine === false,
      });
      onGraded?.(commit, attempt);
    } finally {
      busy.current = false;
    }
  };
}
