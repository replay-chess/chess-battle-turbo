// User-room Mistake Bank events → the query cache (phase-05 plan §5.5, §7.4; api-perf AP-10). WP-A shipped the cache
// rules and the listener; WP-G owns the file: the listener's default invalidator is `throttledInvalidator()`
// (lib/realtime/invalidateThrottled.ts), so a 500-game backlog costs at most one refetch per key per 30 s, and a hidden
// tab costs none (stale marks only).
//
//   bank:due_changed   {bankDue, dueRaw, total, nextAt}     web W1/W4/W6/A6 after()  (another device graded or removed)
//   mistakes:added     {games, added, cardsAdded, total, bankDue}  worker backfill only (≤ 1 per user per 60 s)
//   analysis:done      + {bankAdded {count, plies} | null, bankDue | null}  (P3 event, P5 fields; may be absent)
//   analysis:batch     + {bankAdded, bankDue}  (P3's coalesced frame for background games)
//
// Every event that carries a due count writes it straight into `qk.me()` (`MeData.badges.bankDue`, when the viewer
// payload has badges), `qk.badges()` and `qk.home()` (`bank.due`), so a visible count is never 30 s behind; then
// today's plan, every bank list and Home are invalidated through the invalidator. Session payloads
// (`qk.train.session(ref)`, `staleTime: Infinity`) are deliberately NOT in that list: their items are immutable and the
// runner patches them from the outbox (§5.1), so a push must never refetch a session that is being played.
// `analysis:done.bankAdded` also writes A2's `bank` (`qk.review.status(gameRef)`) for the game-over line.
// `mistakes:added` never touches an open review (backfill games are old).
import { useEffect, useRef } from "react";
import { useQueryClient, type QueryClient, type QueryKey } from "@tanstack/react-query";
import type { HomeData } from "@repo/contracts/http/home";
import type { MeData } from "@repo/contracts/http/me";
import type { ReviewStatusDTO } from "@repo/contracts/http/review";
import type { Badges } from "@repo/contracts/http/train";
import type { AnalysisBatchEvent, AnalysisDoneEvent } from "@repo/contracts/socket/analysis";
import type { BankDueChangedEvent, MistakesAddedEvent } from "@repo/contracts/socket/user";
import { qk } from "@/lib/api/keys";
import { getRealtime } from "../connection";
import { throttledInvalidator } from "../invalidateThrottled";
import { loadFrameValidator } from "../validate.dev";

export const TRAIN_EVENT_NAMES = ["bank:due_changed", "mistakes:added", "analysis:done", "analysis:batch"] as const;
export type TrainEventName = (typeof TRAIN_EVENT_NAMES)[number];
export type TrainEvent = BankDueChangedEvent | MistakesAddedEvent | AnalysisDoneEvent | AnalysisBatchEvent;

/** How the listener invalidates a key (the default is `throttledInvalidator()`: one trailing refetch per key per 30 s). */
export type Invalidator = (qc: QueryClient, key: QueryKey) => void;

/** Marks a key stale without fetching: the next mount or focus refetches it (the resync path after a reconnect gap). */
export const markStale: Invalidator = (qc, key) => {
  void qc.invalidateQueries({ queryKey: key, refetchType: "none" });
};

/** Every bank list, whatever its filter: the prefix of `qk.train.bank(f)`. */
export const BANK_LISTS_KEY: QueryKey = qk.train.bank({}).slice(0, 2);

/**
 * The keys a bank-affecting event invalidates (§5.5): today's plan, every bank list, Home. Not `qk.train.all()`: that
 * prefix also covers the runner's session payload, which a push must never refetch.
 */
export const TRAIN_INVALIDATE_KEYS: readonly QueryKey[] = [qk.train.today(), BANK_LISTS_KEY, qk.home()];

/** The listener's default: today's plan, the bank and Home refetch at most once per key per 30 s (hidden tab: stale). */
export const pushInvalidator: Invalidator = throttledInvalidator();

/** The due count an event carries, or null when it carries none (a P3 worker's frame, a lost batch response). */
export function bankDueOf(ev: TrainEvent): number | null {
  const due = (ev as { bankDue?: number | null }).bankDue;
  return typeof due === "number" ? due : null;
}

/** Writes a due count into the badge, the viewer payload and Home (no fetch). Returns true when any cache changed. */
export function applyBankDue(qc: QueryClient, bankDue: number): boolean {
  let changed = false;
  const badges = qc.getQueryData<Badges>(qk.badges());
  if (badges && badges.bankDue !== bankDue) {
    qc.setQueryData<Badges>(qk.badges(), { ...badges, bankDue });
    changed = true;
  }
  const me = qc.getQueryData<MeData & { badges?: Badges }>(qk.me());
  if (me?.badges && me.badges.bankDue !== bankDue) {
    qc.setQueryData(qk.me(), { ...me, badges: { ...me.badges, bankDue } });
    changed = true;
  }
  const home = qc.getQueryData<HomeData>(qk.home());
  if (home && home.bank.due !== bankDue) {
    qc.setQueryData<HomeData>(qk.home(), { ...home, bank: { ...home.bank, due: bankDue } });
    changed = true;
  }
  return changed;
}

/**
 * `analysis:done.bankAdded` → A2's `bank` of that game (the game-over line), when A2 is cached. `null` means the
 * worker lost its batch response (interface check §0.3): the client falls back to A2, so the status is refetched
 * instead of being overwritten with an unknown.
 */
export function applyBankAdded(qc: QueryClient, ev: AnalysisDoneEvent): boolean {
  if (ev.bankAdded === undefined) return false;
  const key = qk.review.status(ev.gameRef);
  const status = qc.getQueryData<ReviewStatusDTO>(key);
  if (!status) return false;
  if (ev.bankAdded === null) {
    void qc.invalidateQueries({ queryKey: key, exact: true, refetchType: "active" });
    return true;
  }
  qc.setQueryData<ReviewStatusDTO>(key, { ...status, bank: ev.bankAdded });
  return true;
}

/**
 * One event: patch the counts, then invalidate the train and home keys. `analysis:done` / `analysis:batch` frames from
 * a P3 worker carry no bank fields and change nothing here (P3's own handlers still run); a P5 frame with null fields
 * (a lost batch response) still invalidates, because cards may have been added.
 */
export function applyTrainEvent(qc: QueryClient, name: TrainEventName, ev: TrainEvent, invalidate: Invalidator = pushInvalidator): void {
  const isAnalysis = name === "analysis:done" || name === "analysis:batch";
  const due = bankDueOf(ev);
  if (due !== null) applyBankDue(qc, due);
  if (name === "analysis:done") applyBankAdded(qc, ev as AnalysisDoneEvent);
  // A P5 worker always sends both fields (null after a lost response); a P3 worker's frame has neither.
  const fromP5 = !isAnalysis || "bankDue" in ev || "bankAdded" in ev;
  if (!fromP5) return;
  for (const key of TRAIN_INVALIDATE_KEYS) invalidate(qc, key);
}

type Frame = { useq?: unknown; gameRef?: string };

function validateDev(name: TrainEventName, payload: unknown): void {
  if (process.env.NODE_ENV === "production") return;
  void loadFrameValidator().then((validate) => validate?.(name, payload));
}

/**
 * Listens on the user room while mounted (the "user" hold): the hub, the bank, Home and the shell mount it. On a
 * resync after a reconnect gap the train and home keys are marked stale (the server may have changed while we were away).
 */
export function useTrainEvents(options: { enabled?: boolean; invalidate?: Invalidator } = {}): void {
  const qc = useQueryClient();
  const enabled = options.enabled ?? true;
  const invalidate = useRef<Invalidator>(options.invalidate ?? pushInvalidator);
  useEffect(() => {
    invalidate.current = options.invalidate ?? pushInvalidator;
  });

  useEffect(() => {
    const rt = getRealtime();
    if (!rt || !enabled) return;
    const release = rt.acquire("user");
    const offs = TRAIN_EVENT_NAMES.map((name) =>
      rt.on<TrainEvent & Frame>(name, (frame) => {
        if (!frame || typeof frame !== "object") return;
        if (typeof frame.useq === "number") rt.noteUseq(frame.useq);
        validateDev(name, frame);
        applyTrainEvent(qc, name, frame, invalidate.current);
      }),
    );
    const offHello = rt.onHello((_hello, resync) => {
      if (!resync) return;
      for (const key of TRAIN_INVALIDATE_KEYS) markStale(qc, key);
      void qc.invalidateQueries({ queryKey: qk.badges(), exact: true, refetchType: "none" });
    });
    return () => {
      for (const off of offs) off();
      offHello();
      release();
    };
  }, [qc, enabled]);
}
