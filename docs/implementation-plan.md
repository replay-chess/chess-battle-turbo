# Replay Chess: coaching app implementation plan

> **Superseded by the detailed plan (2026-11-02).** The detailed, authoritative plan now lives in [`docs/plan/README.md`](plan/README.md): 13 phases (P1–P13) with per-phase specs, the cross-cutting architecture, data model, API, client data layer and optimisation documents, and the owner's decision register [`docs/plan/99-open-decisions.md`](plan/99-open-decisions.md). It replaces §2 "Phases", §3 "Order and timeline" and §4 "Decisions needed from you" below; the phase numbers here map to the new ones through `docs/plan/01-architecture.md` §6.1. §1 (the paid-only model) still applies and is done (Phase 0, commit `8514fea`). The rest of this file is kept for history.
>
> **Phase 2 (in progress on `dev`; stage A built, stage B pending the owner's actions)** is specified by [`docs/plan/phase-02-board-and-live-game.md`](plan/phase-02-board-and-live-game.md): the shared `@repo/db` and `@repo/game-core` packages, socket protocol v2 with checkpoint persistence and the boot restore, the v3 board and game screen (55 design states), bot games, the web game routes, telemetry (§10) and the tests and gates (§12), with its work packages in §13.1 and the Definition of Done in §15.
>
> **Phase 1 (done, on `dev`)** is specified by two documents: [`docs/plan/phase-01-design-system-app-shell-and-api-foundations.md`](plan/phase-01-design-system-app-shell-and-api-foundations.md) (the phase plan: tracks 1B security hotfixes and API/data-layer foundations, 1Q test and ops plumbing, the work packages in §13.3 and the Definition of Done in §15) and [`docs/plan/phase-01a-spec.md`](plan/phase-01a-spec.md) (SPEC, track 1A: UI kit, app shell, one-viewport layout). The canonical route table (route → boards → phase → flag → auth class), which the middleware route classes are tested against, is [`docs/route-map.md`](route-map.md). The old "Phase 1: Design system and app shell" section below is history only.

Status: draft, 2026-11-01. Branch `hetzner-deploy`.
Design source: Claude Design canvas https://claude.ai/artifact/KdJ3TDSaXSSsW3K8e8B8y9 (v3 pages plus the design system).
Product rule: **there is no free tier.** Every logged-in feature needs an active Coaching membership (or an active 7-day trial).

---

## 0. Where we start

The pivot is mostly new code. This is what exists today in `apps/web` and what is missing.

| Area | Exists today | Missing |
|---|---|---|
| Engine | Stockfish 18 WASM in the browser (`lib/hooks/useStockfish.ts`), MultiPV arrows | Server-side analysis, move classification, accuracy, stored results |
| Game data | `Game.gameData.moveHistory` JSON blob | PGN column, per-move eval rows, imported games |
| Explanations | Static, pre-recorded JSON and audio per legend position or opening (`useExplanationPlayer.ts`) | Any runtime LLM, any TTS code |
| Chess.com | Profile and ratings only (`lib/chess-com.ts`) | Game import; Lichess entirely |
| Training | Practice from any FEN vs Stockfish | Mistake Bank, puzzles, spaced repetition, weakness profile |
| Billing | Dodo subscription, webhook, `isEntitled`, `requireSubscribedUser` (402) on play APIs, client `useRequireSubscription` | Gating on analysis, `/try` and future coach/training APIs; trial |
| Layout | Game page is a 12-col grid; `ChessBoard.tsx` square sizes are width-only Tailwind classes | One-viewport board sizing, zoom-safe layout, tap-to-move polish |
| Design system | `--cb-*` tokens in `app/globals.css`, Geist and Instrument Serif, shadcn button/label | The v3 component set (chips, segmented control, tabs, banners, tags, sheets, popovers, skeletons, toasts) |

Two components are too big to extend safely: `AnalysisPageContent.tsx` (1,175 lines) and `GamePageContent.tsx` (1,437 lines). Both get split while we rebuild them.

---

## 1. Paid-only model (affects every phase)

**Access rules**

| Visitor | Can see | Cannot do |
|---|---|---|
| Logged out | Landing, pricing, blog, learn, legends and openings catalogues (SEO), legal and company pages, sign-in and sign-up | Anything that runs the engine, the coach or a game |
| Signed in, not a member | Onboarding (accounts, level, goals), then the plan step; pricing; membership and account settings; delete account | Play, review, coach, train, import |
| Member (`active`, trial, or cancelled-but-in-period) | Everything | — |
| `past_due` / `on_hold` | Everything during Dodo's grace window, with the payment-failed banner | After grace ends: treated as non-member |

**How**

1. One server helper, `requireMember()`, in `lib/auth/require-subscription.ts`. It wraps the existing `requireSubscribedUser` and is applied to every new API route: analysis, import, coach, puzzles, bank, weakness. It is also added to the existing `api/analysis/[gameId]`, which is currently ungated.
2. `middleware.ts`: signed-in non-members are redirected to `/pricing?reason=required&redirect_url=…` from any app route. The redirect is computed from a short-lived `entitled` claim in the Clerk session (`publicMetadata`, updated by the Dodo webhook) so the middleware does no DB hit.
3. The client paywall becomes a single **hard paywall** screen (`V3PaywallHard`). `V3PaywallSoft`, `V3CoachPaywall`, `V4MembershipFree` and the "3 a day" limits are deleted, along with the usage-metering code they would have needed.
4. Onboarding: the plan step can no longer be skipped. "Continue free" goes away; the only exits are checkout or sign out.
5. **Trial (decided 2026-11-01): 7 days free, card required, first charge on day 8.**
   - **Checkout:** `app/api/checkout/route.ts` passes `subscription_data: { trial_period_days: 7 }` to `dodo.checkoutSessions.create`. The card is collected and authorised at checkout but not charged. Dodo bills the plan price automatically when the trial ends.
   - **One trial per person:** add `User.trialStartedAt DateTime?`. The route only sends `trial_period_days` when it is null, and sets it when the `subscription.active` webhook arrives. A returning user goes straight to a paid checkout, and the copy says "Your free trial has been used."
   - **Access:** during the trial the subscription is `active` with `next_billing_date = trial end`, so `isEntitled` already lets the user in. We also store `trialEndsAt` (from `next_billing_date` on the first webhook) so the UI can show "Trial · 5 days left".
   - **Cancel during trial:** this is the existing cancel-at-period-end flow, which sets `cancel_at_next_billing_date`. Access lasts to day 7, the card is never charged, and the membership screen says "Trial ends on <date>. You won't be charged."
   - **Reminder:** an email 2 days before the first charge (day 5) from a daily cron (Vercel Cron → `/api/cron/trial-reminders`). It is sent through Clerk's email or Resend (decide in Phase 9). This is both good practice and required by card-network rules for free-trial offers.
   - **Failed first charge:** Dodo moves the subscription to `on_hold`, which uses the existing payment-failed banner and the `V3PaymentFailed` screen.
   - **Copy everywhere** (pricing, onboarding plan step, paywall, checkout button): "Start 7-day free trial", with "Then $4.99/month. Cancel any time before <date> and you won't be charged." The yearly plan reads "Then $50/year."
   - **Screens:** `V4MembershipTrial` stays. The onboarding plan step's primary button becomes "Start free trial". `V3CheckoutActivating` says "Starting your trial…".
   - **Tests:** a unit test for the trial-eligibility rule; an e2e test of trial checkout in Dodo test mode, plus a simulated renewal (see the Dodo testing guide) checking the charge on day 8 and access through to day 7 after a cancel.
6. **`/try` guest demo (decided: no free sample):** delete `/try/*`, `api/chess/create-demo-game`, the DEMO and BOT system-user handling for guests, the demo branch in `api/analysis/[gameId]`, and `e2e/specs/demo-game`. Old `/try/*` URLs get a 301 redirect to `/pricing`, which keeps their SEO value. The landing page sells with a looping product preview (an autoplaying review and Mistake Bank demo built from static data, not a playable board).
7. Copy: the plan is renamed from "Player" to **"Coaching"** (`lib/billing/plans.ts`, Dodo product names, pricing, SEO metadata). "Required to play" becomes "Start your 7-day free trial to use this". Copy that Claude Design invented and that needs your sign-off: the "fair use" wording, and "past reviews stay readable after a membership ends", which would mean read-only access to old reviews for lapsed members. If we keep it, `requireMember()` lets GET on `/api/review/*` through for lapsed users.

---

## 2. Phases

Each phase ends with a deployable state on `main`, behind feature flags (PostHog flags) where the old UI must keep working.

### Phase 0: Ship the infrastructure (≈2 days)

- Push `hetzner-deploy`, open a PR, merge.
- Vercel env vars (Clerk, Dodo, PostHog, R2, Sentry, `INTERNAL_API_SECRET`, `NEXT_PUBLIC_WS_URL`).
- DNS: `ws-chess.playchess.tech → 132.226.190.10`; add the `WS_ENV_FILE` GitHub secret so `deploy-oci.yml` can deploy.
- Media: create `media.playchess.tech` on R2, run `scripts/upload-media.ts`, compress the large images.
- Database: the old Neon project's quota resets today (Nov 1). Dump it and restore into the new `replay-chess` project with `pg_dump`/`pg_restore`, then **`prisma migrate deploy` only** (never `migrate dev`, per CLAUDE.md). Every destructive step gets your confirmation first.
- Dodo: products in live mode, webhook URL pointed at Vercel.
- Privacy page: mention PostHog.

### Phase 1: Design system and app shell (≈1 week)

- Port `project/ds/replaychess/tokens.json` into `app/globals.css` (`@theme inline` + `:root` + `.dark`). Keep the `--cb-*` names so old pages don't break.
- Build `components/ui/`: `Button` (primary, secondary, text, icon), `Chip`, `Segmented`, `Tabs`, `Banner` (info, good, warn, bad), `Tag`, `Card`, `Field`/`Input` with error and hint, `Popover`, `Sheet` (bottom sheet on phones), `Dialog`, `Skeleton`, `Toast`, `Spinner`, `ProgressBar`. Build them headless on Radix primitives, because they already ship with shadcn.
- App shell: left rail on desktop and iPad landscape, bottom tab bar on phones and iPad portrait, command palette (⌘K), keyboard shortcut sheet.
- **One-viewport layout primitive.** A `<ViewportStage>` uses `100dvh` and CSS grid with `minmax(0,1fr)` rows, so content inside never pushes the page into scrolling. Secondary content moves into popovers and sheets, as in the design.
- **Zoom-safe sizing.** Rules are written in `rem` plus `dvh`/`dvw`, with no fixed-pixel breakpoints for the board. Browser zoom changes CSS px per screen px, so `dvh` math keeps the board on screen at 80%, 110% and 125%. A Playwright check covers each zoom (Phase 10).

### Phase 2: The board and the live game page (≈1.5 weeks)

- Rewrite `ChessBoard.tsx` sizing. The board size is a CSS variable, `--board: max(220px, min(100dvh - var(--bars), 100dvw - var(--nav) - var(--panel), 880px))`, which is the formula already used in the designs. A `ResizeObserver` only feeds the arrow overlay, which it already does.
- Input: drag and tap-to-move behave the same; premove; promotion picker; illegal-move shake; legal-move dots; keyboard move entry. **Tap-to-move gets a manual test on a real iPhone and an Android phone**, because it failed in the automated design test.
- Split `GamePageContent.tsx` into `useGameSocket` (all socket events), `useClock`, `GameBoardArea`, `PlayerBar` (with the disconnect ring), `MoveStrip`, `GameActions` (overflow menu for resign and draw), and `GameOverCard`.
- States from the design: their move, check, low time, draw offer, premove, promotion, illegal, opponent disconnected (30 s ring), reconnecting, resign confirm, every game-over variant, rematch offer (rematch swaps colours), spectate, study phase.
- Socket server (`GameSession.ts`):
  - Add end methods `threefold`, `fifty_move` and `abort`. Today the first two are mislabelled `draw_agreement`.
  - Add a 30 s first-move countdown, with clocks starting after both first moves (the default you approved).

### Phase 3: Server analysis and Game Review (≈2 weeks)

**Data model** (additive, applied with `prisma db push` on prod):

```prisma
model Game { ... pgn String? source GameSource @default(REPLAY) externalId String? analysisStatus AnalysisStatus @default(NONE) }
enum GameSource { REPLAY CHESSCOM LICHESS }
model GameAnalysis { id, gameId @unique, engine String, depth Int, accuracyWhite Float, accuracyBlack Float,
                     phaseDivision Json, summary Json, createdAt }
model MoveEval { id, gameId, ply Int, color, fenBefore, uci, san, bestUci, bestSan, cpBefore Int?, cpAfter Int?,
                 mateBefore Int?, mateAfter Int?, winBefore Float, winAfter Float, accuracy Float,
                 judgement Judgement, isKeyMoment Boolean, clockMs Int?, timeSpentMs Int?, themes String[]
                 @@unique([gameId, ply]) @@index([gameId]) }
enum Judgement { BRILLIANT GREAT BEST EXCELLENT GOOD BOOK INACCURACY MISTAKE BLUNDER MISS FORCED }
model AnalysisJob { id, gameId, priority Int, status, attempts Int, lockedAt DateTime?, error String? }
```

**Engine worker:** a new `apps/analysis-worker` Node service on the OCI box, next to the WebSocket server. It runs the native `stockfish` binary, which on ARM is about 10× the WASM speed.
- Jobs are pulled from `AnalysisJob` with `SELECT … FOR UPDATE SKIP LOCKED`, so no Redis is needed.
- Default budget: 1M nodes per position, MultiPV 2 on flagged moves only.
- Cache by FEN, seeded from the Lichess CC0 eval DB for common positions.
- Status is pushed to the client through the existing socket server ("Analysing 23/61").

**Classification:** implemented in TypeScript in `packages/chess-analysis`, unit-tested and shared by the worker and the web app. It re-implements the published formulas and copies no AGPL code.
- `win% = 50 + 50·(2/(1+e^(−0.00368208·cp)) − 1)`, cp clamped to ±1000.
- Inaccuracy, mistake and blunder are drops of 5, 10 and 15 Win% points.
- Per-move accuracy uses `103.1668·e^(−0.04354·Δ) − 3.1669 + 1`. Game accuracy is the volatility-weighted mean averaged with the harmonic mean.
- Book moves come from the existing `Opening` table.
- Brilliant: a sacrifice that is best or near-best, played when not already winning.
- Miss: failing to punish an opponent's blunder.
- Key moments: the 3 to 6 biggest swings.

**Review UI** (`/review/[gameId]`, replacing the analysis tabs): states analysing, summary, key moments, clean game, failed, complete and share. The board icons are the ones in `public/board_icons` (your own set). The legend comparison tab stays and moves inside Review.

### Phase 4: Game import (≈1 week)

- **Chess.com:** call `/pub/player/{u}/games/archives`, then fetch only new months, one request at a time with `If-None-Match`, using a User-Agent with a contact address. Parse PGN into `Game` with `source=CHESSCOM`.
- **Lichess:** OAuth PKCE (no app registration needed); store the token encrypted. Stream `/api/games/user/{u}?since=…&clocks&evals&opening&accuracy&division&pgnInJson` as ndjson. Games that already carry `%eval` skip the engine.
- An `ImportCursor` per account; one global Lichess request at a time, with a 60 s back-off on 429.
- Import runs in the analysis worker. Newest 50 games are analysed first and the rest at low priority.
- UI: onboarding link step, Settings › Connected accounts (ok and error states), the import progress line on Home and Onboarding done.

### Phase 5: Mistake Bank and puzzles (≈2 weeks)

**Data model:**

```prisma
model Mistake { id, userId, gameId, ply, fen, playedUci, bestUci, bestLine String[], judgement, themes String[],
                phase, isPuzzle Boolean, createdAt  @@unique([gameId, ply]) }
model ReviewCard { id, userId, mistakeId?, lichessPuzzleId?, due DateTime, stability Float, difficulty Float,
                   reps Int, lapses Int, state Int, lastReview DateTime?  @@index([userId, due]) }
model ReviewLog { id, cardId, rating Int, elapsedMs Int, reviewedAt }
model LichessPuzzle { id String @id, fen, moves String[], rating Int, themes String[], openingTags String[], popularity Int }
```

**Mistake extraction:** every MISTAKE, BLUNDER or MISS by the user becomes a `Mistake`.
- It becomes a scored puzzle when the best move is clearly unique: best minus second-best > 0.5 win-chance units, and best ≥ +200 cp for the user.
- Otherwise it is a "review position" (study, not pass/fail).

**Themes:** a TypeScript port of the published theme heuristics (fork, pin, skewer, hanging piece, back-rank, mate-in-N and others), run on the engine's best line. The names match the Lichess theme keys, so puzzles can be matched to theme puzzles.

**Spaced repetition:** `ts-fsrs`. Correct first try is "good" and with a hint is "hard"; wrong or "show solution" is "again". Daily session order: due cards, then new ones (cap 10 a day), then theme puzzles.

**Lichess CC0 puzzles:** a script loads a filtered subset into `LichessPuzzle`: popularity > 80, ratings 600–2400, about 1M rows, with a GIN index on themes. The full 6.2M rows would blow the Neon storage budget.

**UI states:** bank list and session; empty, loading and caught-up; puzzle solve, hint, wrong, correct, solution and themes; session summary and perfect session.

### Phase 6: Weakness Profile (≈1 week)

- A nightly job, plus a run after each import batch, aggregates `MoveEval` and `Mistake` per user.
- Breakdowns: by theme, by phase (opening, middlegame, endgame accuracy), by clock bucket (<10% of time left), by opening (ECO), and by piece.
- Results are stored in `WeaknessSnapshot { userId, weekOf, metrics Json }`.
- Rates are compared against a rating-band baseline. The baseline is a static table computed once from a Lichess CC0 monthly dump (only the games with `%eval`) and stored as JSON in the repo.
- States: computing; insufficient (fewer than 10 analysed games); profile; drill, which starts a session filtered to that theme.

### Phase 7: AI coach (≈2 weeks)

- **Model:** use the Claude API (`@anthropic-ai/sdk`).
  - `claude-sonnet-5-5` for chat and move explanations.
  - `claude-haiku-5-5` for short game summaries and key-moment captions.
  - Prompt caching on the system prompt and the game context.
- **Grounding (the main risk is the coach inventing chess facts):** the coach never computes chess itself.
  - Every answer is built from engine facts we pass in: eval, best line, judgement, themes, and the legend's move.
  - It also gets tool calls: `evaluate(fen)`, `legalMoves(fen)`, `bestLine(fen, n)`.
  - Any move the model writes is checked against `chess.js` before it is shown, and an illegal move triggers a regenerate.
  - The UI labels engine-checked lines.
- **Endpoint:** `POST /api/coach` (members only) streams Server-Sent Events. `CoachThread` and `CoachMessage` tables store history per game or position.
- **Fair use:** no free tier, but there is a per-member cap against abuse, for example 200 messages a day. It reuses the `V3CoachRateLimit` state. Cost per user is tracked in PostHog.
- **UI states:** suggested questions, typing, streaming, explain-this-move, error and rate limit; side panel on desktop, bottom sheet on phones; starter message on open.
- **Narration:** keep the pre-recorded audio for legend positions. Dynamic TTS for coach answers is a later phase, if wanted.

### Phase 8: Legends, lessons and play hub (≈1.5 weeks)

- Play hub tabs: Legend · Bot · Friend · Online. Matchmaking, friend challenges and tournaments **stay**, because they are in the v3 and v4 designs. They are restyled, not removed.
- Bot strength: use `UCI_LimitStrength` + `UCI_Elo`, so the displayed rating is real instead of a depth label.
- Legend games vs the bot: open at the launching position. "Next position" cycles through the set, using the KT, BF, AK, TS and Morphy games from the design. **Check the Anderssen and Paulsen positions against the real game scores** before seeding them, since the design rebuilt them from memory.
- Lessons: lesson player, guess-the-move, and lesson complete.
- Legend compare inside Review, with narrated comparison.
- Admin: the positions, legends and tournaments screens (V4Admin*).

### Phase 9: Profile, settings and system screens (≈1.5 weeks)

- Profile: own, other, guest view, private; games archive with filters and empty state; stats.
- Settings:
  - Account, appearance (light/dark), board, pieces, sounds, notifications, connected accounts.
  - Membership states: active, trial, cancelling, past due, plan switch, cancel (with pause offered first if Dodo supports it), payment failed.
  - Delete account, which uses Clerk delete and cascades our rows.
- System screens: 404, 500, global error, offline (PWA), maintenance, session expired, rate limited, cookie consent (decline non-essential by default), PWA install and update prompts, notification prompt, toasts, skeletons.
- Auth: Clerk components restyled to the v3 sign-in, sign-up, verify-email and reset-password screens. Google sign-in now; Apple later (decision needed).

### Phase 10: Quality gates (runs across all phases)

- **Unit tests:** classification formulas against known Lichess outputs, the FSRS scheduling wrapper, puzzle uniqueness, the entitlement matrix in §1, and the coach move validator.
- **Playwright:** projects for desktop 1440×900, iPad landscape 1194×834, iPad portrait 834×1194, iPhone 393×852 and Android 412×915. Each also runs at 80%, 110% and 125% zoom (`deviceScaleFactor` plus a CSS zoom fixture).
  - The key assertion on every board page: the board's bounding box sits fully inside the viewport and `document.scrollingElement.scrollHeight <= innerHeight`.
- **Paywall e2e:** a non-member is blocked on every app route and API; a member passes; past-due shows the banner.
- **Sentry release tracking; PostHog funnels:** landing → sign-up → plan → checkout → first review.
- **k6 perf:** coach SSE and analysis-job throughput, with perf CI turned back on.

---

## 3. Order and timeline

| Weeks | Work |
|---|---|
| 1 | Phase 0 and Phase 1 |
| 2–3 | Phase 2, plus the §1 paywall changes |
| 3–5 | Phase 3 (analysis worker and Review) |
| 5–6 | Phase 4 (import) |
| 6–8 | Phase 5 (Mistake Bank and puzzles) |
| 8–9 | Phase 6 (Weakness Profile) |
| 9–11 | Phase 7 (coach) |
| 11–13 | Phases 8 and 9 |

That is about 13 weeks for one developer working with me. Phases 4 and 7 can run alongside Phase 5 once Phase 3 has landed. The first release that's worth charging for is the end of Phase 5: import, then review, then Mistake Bank.

---

## 4. Decisions needed from you

1. ~~Trial~~: **decided**, 7 days free with a card, charged on day 8 (see §1.5).
2. ~~`/try` guest demo~~: **decided**, no free sample (see §1.6).
3. **Price:** keep $4.99/mo and $50/yr, or raise it now that the coach is included (the coach adds roughly $0.30–1.00 per active user per month in LLM cost).
4. **Apple sign-in** at launch or later.
5. **Coach fair-use cap:** 200 messages a day, or another number.
6. Placeholders still in the designs: legal entity name, support email, legal pages.

---

## 5. Risks

- **Coach accuracy:** an LLM can describe moves that aren't legal or aren't good. Mitigation: the engine-grounded facts, the `chess.js` validation and the engine-checked label in Phase 7.
- **OCI ARM capacity:** one 4-core A1 box serves both the sockets and analysis. Mitigation: niceness and priority on the worker, at most 2 Stockfish threads, and moving the worker to its own A1 instance if the queue backs up.
- **Neon storage** on the plan we use: the puzzle subset and `MoveEval` rows grow fast. Budget: about 60 bytes × 80 plies per game. Prune `fenBefore` for non-mistake moves after 90 days.
- **Licensing:** Lichess puzzles, games and eval data are CC0. lichess-puzzler, lila and Maia-3 are AGPL, so we only re-implement their formulas. Maia-2 is MIT, if we later add human-likeness.
- **Chess.com data:** user games are imported on the user's behalf; we don't redistribute them or use Chess.com branding or glyphs.
