import { z } from "zod";
import { defineEndpoint } from "../endpoint";
import {
  ATTEMPTS_MAX_BODY_BYTES,
  AttemptsBody,
  AttemptsResult,
  BankNextPage,
  BankPage,
  BankQuery,
  CardRefParams,
  EndBody,
  ExtendBody,
  ExtendResult,
  SESSION_CREATE_MAX_BODY_BYTES,
  SessionCreate,
  SessionGetResult,
  SessionPayload,
  SessionQuery,
  SessionRefParams,
  SessionSummary,
  SkipBody,
  SkipResult,
  ThemesResult,
  TRAIN_SESSION_BURST_LIMIT,
  TRAIN_WRITE_LIMIT,
  TrainPrefs,
  TrainPrefsPatch,
  TrainToday,
} from "../train";

/**
 * Phase-05 plan §7.2 R1–R4, W1–W6, W8. Handlers: WEB/app/api/train/** (WP-E). Every route is `auth: "member"`,
 * `no-store` (due counts must never be stale across tabs) and takes `ctx.now` (services never read the clock).
 * Owner-scoped refs answer 404 for another member's session or card. The `train` flag never gates authorisation.
 *
 * Durable limits are counted by the handlers from their source rows (interface check §0.8), not by the route
 * limiter: W2 `train-session` 30 / 3600 s (training_sessions, `details.reason: "session_limit"`), the daily puzzle
 * fair use on W2/W3 (`training_days.puzzlesDone`, `details.reason: "daily_puzzle_limit"`). Both answer 429
 * `rate_limited` with `Retry-After`, so the entries list `rate_limited` in `errors`.
 */
export const trainEndpoints = {
  /** R1 (TR-1). The hub. Its only writes are today's frozen plan and the lazy profile row (`daily_plan`). */
  today: defineEndpoint({
    id: "train.today",
    method: "GET",
    path: "/api/train/today",
    auth: "member",
    class: "R1",
    cache: "no-store",
    sideEffects: ["daily_plan"],
    response: TrainToday,
    summary: "Today's training plan, streak, due counts and theme mastery",
  }),
  /**
   * R2 (TR-2). First request (no cursor): `BankPage` + `meta {nextCursor, complete}`; with a cursor: `BankNextPage`
   * + `meta {nextCursor}`. A cursor minted for other filters is 400 `validation_failed` (`cursor_filter_mismatch`).
   */
  bank: defineEndpoint({
    id: "train.bank",
    method: "GET",
    path: "/api/train/bank",
    auth: "member",
    class: "R2",
    cache: "no-store",
    query: BankQuery,
    response: z.union([BankPage, BankNextPage]),
    summary: "The viewer's Mistake Bank (filters, facets, upcoming), keyset-paged",
  }),
  /** R4 (TR-4). The theme picker's options (also embedded in a puzzle session payload). */
  themes: defineEndpoint({
    id: "train.themes",
    method: "GET",
    path: "/api/train/themes",
    auth: "member",
    class: "R1",
    cache: "no-store",
    response: ThemesResult,
    summary: "Puzzle themes with the viewer's mastery and the puzzles available near their rating",
  }),
  /**
   * W2 (TR-7). 201 with a new session; 200 when an ACTIVE session of the same kind and filter (< 2 h) is reused or
   * the Idempotency-Key is replayed. `Idempotency-Key` is required (422 `idempotency_key_reused` on a different body).
   */
  sessionCreate: defineEndpoint({
    id: "train.sessions.create",
    method: "POST",
    path: "/api/train/sessions",
    auth: "member",
    class: "W2",
    cache: "no-store",
    body: SessionCreate,
    response: SessionPayload,
    status: 201,
    errors: ["not_found", "idempotency_key_reused", "rate_limited", "upstream_unavailable"],
    maxBodyBytes: SESSION_CREATE_MAX_BODY_BYTES,
    rateLimit: TRAIN_SESSION_BURST_LIMIT,
    summary: "Creates (or resumes) a training session",
  }),
  /** R3 (TR-3). `include=items` (default) → SessionPayload; `include=summary` → SessionSummary. */
  session: defineEndpoint({
    id: "train.sessions.get",
    method: "GET",
    path: "/api/train/sessions/{ref}",
    auth: "member",
    class: "R2",
    cache: "no-store",
    params: SessionRefParams,
    query: SessionQuery,
    response: SessionGetResult,
    summary: "One of the viewer's training sessions (items or summary)",
  }),
  /** W3 (TR-8). Appends 10 puzzles; a repeat with the same `after` returns what was appended after it. */
  sessionExtend: defineEndpoint({
    id: "train.sessions.extend",
    method: "POST",
    path: "/api/train/sessions/{ref}/extend",
    auth: "member",
    class: "W2",
    cache: "no-store",
    rateLimit: TRAIN_WRITE_LIMIT,
    params: SessionRefParams,
    body: ExtendBody,
    response: ExtendResult,
    errors: ["conflict", "upstream_unavailable"],
    maxBodyBytes: 4_096,
    summary: "Appends puzzles to an active puzzle session",
  }),
  /** W4 (TR-9). Natural idempotency: a second call returns the same summary. */
  sessionEnd: defineEndpoint({
    id: "train.sessions.end",
    method: "POST",
    path: "/api/train/sessions/{ref}/end",
    auth: "member",
    class: "W1",
    cache: "no-store",
    params: SessionRefParams,
    body: EndBody,
    response: SessionSummary,
    maxBodyBytes: 1_024,
    summary: "Ends a training session and returns its summary",
  }),
  /**
   * W1 (TR-6). Per-item statuses (ok, duplicate, conflict, rejected); a 402 rejects the whole batch. Idempotent by
   * `clientAttemptId` (unique) plus the `cardReps` guard.
   */
  attempts: defineEndpoint({
    id: "train.attempts",
    method: "POST",
    path: "/api/train/attempts",
    auth: "member",
    class: "W1",
    cache: "no-store",
    rateLimit: TRAIN_WRITE_LIMIT,
    body: AttemptsBody,
    response: AttemptsResult,
    maxBodyBytes: ATTEMPTS_MAX_BODY_BYTES,
    summary: "Records graded attempts (the offline outbox flush)",
  }),
  /** W5 (TR-10). Suspends the card until the next release ("Tomorrow"). */
  cardSkip: defineEndpoint({
    id: "train.cards.skip",
    method: "POST",
    path: "/api/train/cards/{ref}/skip",
    auth: "member",
    class: "W1",
    cache: "no-store",
    rateLimit: TRAIN_WRITE_LIMIT,
    params: CardRefParams,
    body: SkipBody,
    response: SkipResult,
    maxBodyBytes: 1_024,
    summary: "Skips a card for today",
  }),
  /** W6 (TR-11). Hides the mistake and deletes its card; already removed → 204. Behind `bank-remove` in the UI. */
  cardRemove: defineEndpoint({
    id: "train.cards.remove",
    method: "DELETE",
    path: "/api/train/cards/{ref}",
    auth: "member",
    class: "W1",
    cache: "no-store",
    rateLimit: TRAIN_WRITE_LIMIT,
    params: CardRefParams,
    status: 204,
    summary: "Removes a position from the Mistake Bank",
  }),
  /** W8. The only writer of training prefs; `newPerDay > bankDailyCap` → 400 (`new_per_day_above_cap`). */
  prefs: defineEndpoint({
    id: "train.prefs",
    method: "PATCH",
    path: "/api/train/prefs",
    auth: "member",
    class: "W1",
    cache: "no-store",
    rateLimit: TRAIN_WRITE_LIMIT,
    body: TrainPrefsPatch,
    response: TrainPrefs,
    maxBodyBytes: 1_024,
    summary: "Updates the viewer's training preferences (time zone, day start, release hour, caps)",
  }),
} as const;
