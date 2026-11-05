# Phase 10 — Profile, settings, membership, notifications (detailed plan)

Status: plan, revision 2 (critique pass), 2026-11-02, branch `dev` @ `0848b76`. Size: **22 dev-days + 4.4 d buffer (20 %)**; the allocation budgeted 20 (allocation §3 P10), and the +2 comes from findings accepted in this revision (§13, §14 R16). Feature flag: **`account-v3`** (allocation §1.6). Schema: **M10** (+ `m10a` enum file) + contract step **C3** (allocation §5.1). Boards: **39** (allocation §4.1) plus 2 kit-built screens without a board (§4.18 Settings › Training, §4.19 in-game Board settings sheet; owner sign-off, §14 Q21).

This file is the P10 spec in the sense of allocation §1.1 item 8. It refines allocation §3 "P10", inv-acct §2–§4 and §8–§11 and inv-sys §3.12, and applies the cross-cutting rules in architecture.md, data-model.md, api-design.md, client-data-layer.md and optimization.md. Revision 2 applies the five critiques (`SP/plan/critique-{coverage,consistency,feasibility,testing,api-perf}.md`); every finding that concerns P10 is listed with its disposition in **Appendix A**. Where the critiques disagree with each other, §0.2 records the choice and why.

**Path shorthands**

| Short | Path |
|---|---|
| `REPO` | `/Users/rohitpandit/open_source/chess-battle-turbo` |
| `WEB` / `WS` / `WK` | `REPO/apps/web` / `REPO/apps/web-socket` / `REPO/apps/analysis-worker` (created in P3) |
| `CT` | `REPO/packages/contracts/src` (B17; `http/`, `socket/`, `internal/`; imported as `@repo/contracts/{http,socket,internal}/<file>`) |
| `DBP` | `REPO/packages/db` (`src/jobs.ts` = `JOB_PRIORITY`, `json/preferences.ts` = `PreferencesV1`, `src/live/finish.ts`) |
| `SCHEMA` | `DBP/prisma/schema.prisma` (or `WEB/prisma/schema.prisma` if the package move in data-model §2.11 has not happened) |
| `SP` | the planning session's scratchpad, archived scratch inputs that are not in the repo and may no longer exist (see [99-open-decisions.md](99-open-decisions.md) A12) |
| `DR` | `SP/design-ref/project/v2` (board files `*.dc.html`) |
| `DS` | `SP/design-ref/ds/project` (`README.md`, `tokens.json`, `components/*/README.md`) |
| inputs | `SP/plan/{allocation,architecture,data-model,api-design,client-data-layer,optimization,inv-acct,inv-sys,audit-*,critique-*}.md`, `SP/phase1/SPEC.md` |

Line numbers into today's code are at `0848b76`. P1–P9 will have moved or rewritten some of these files before P10 starts; each row in §3 says what P10 expects to find. Shared registries (query keys, flags, cron tasks, realtime handlers, redirects, personas, worker recurring slices, the HTTP route registry) are written in the **directory form** that feasibility §7 asks P1 to adopt (`lib/api/keys/account.ts`, `lib/flags/registry/p10.ts`, `lib/cron/tasks/<task>.ts`, …). If P1 kept single files, WP0 is the only P10 editor of each one (§13.0).

---

## 0. Summary and the decisions this spec makes

### 0.1 What P10 ships, in one paragraph

A public identity for every member (`/@username`, avatar, bio, country, visibility) with a profile in four modes (own, other, private, guest) and four in-place tabs, served from **public CDN-cached routes that read no session** plus a small per-viewer `no-store` route. One settings shell (`/settings/*`) whose Play and App sections are local-first preferences synced across tabs and devices in ≤ 3 s, plus **Training** (P5's daily-bank options and P6's weakness scope), Account (with a Privacy group for P11's cookie settings), Connected (adopted from P4) and Membership; the in-game ⋯ "Board settings" item opens the same Board controls as a sheet. Membership is a DB-only view model rendered in 12 designed states plus `paused`, with plan switch (proration preview), cancel with a retention offer and pause, payment-method update, card and invoices; billing GETs never call Dodo, a `POST /api/billing/refresh` does. Account deletion is typed-confirmation, Clerk step-up, one transaction that anonymises shared games, and an outbox job for the external clean-up. Data export is a ZIP built on the OCI worker. Notifications use Web Push (VAPID) and Resend email from the worker, with a pre-permission prompt, per-channel preferences, quiet hours, one-click unsubscribe, the trial-ending reminder moved here from P4, and **no fixed timers**: every send is a future-dated job planned while Neon is already awake.

### 0.2 Naming reconciliation (binding for P10)

Rule (consistency §1): the first phase that ships a thing fixes its name and shape; allocation B-decisions override. Where two critiques disagree, the row says which one P10 follows.

| Topic | What the inputs say | P10 uses | Why |
|---|---|---|---|
| Per-user game rows | `PlayerGame` (inv-acct), `GamePlayer` (B1, data-model D2) | **`GamePlayer`** with P2's columns (`endedAt`, `opponentUserId`, `opponentName`, `opponentRating`, `timeClass`, `color`, `result`, `ratingBefore/After/Delta`, `source` from M2), P3's (`accuracy`, `momentsCount`, `headline`, `phaseAccuracy`) and P6's (`stats`, `errorThemes`, M6). **Analysis status is `Game.analysisStatus`** (there is no `game_players."analysisStatus"`) | consistency R-01 |
| Per-user game index | `(userId, endedAt DESC, gameId DESC)` (P2, shipped) vs a renamed `playedAt` (api-perf AP-07) | **`game_players_userId_endedAt_gameId_idx`** on `"endedAt"` | P2 created it (R-01). If the owner adopts AP-07's rename, the four P10 queries that name it (§6.5) change mechanically |
| Rating history | `RatingEvent (userId, pool, createdAt DESC)` (old P10) | **`game_players."ratingAfter"`** per time class + `PlayerRating` for current/peak | No `RatingEvent` exists (P9 R3, consistency R-02) |
| Membership read | `GET /api/me/membership` (allocation) vs `GET /api/billing/membership` (api-design BIL-3) | **`GET /api/billing/membership`**, DB only; **`POST /api/billing/refresh`** is the only billing call that reaches Dodo on demand | api-design §0.3; GETs never write (api-perf AP-31) |
| Card + invoices | `GET /api/me/billing` vs `GET /api/billing/details` | **`GET /api/billing/details`**, invoices **`GET /api/billing/invoices/{paymentId}`** (`private, no-store`, attachment) | api-design; AP-04 |
| Billing portal | `GET /api/customer-portal` (side-effecting GET) | **`POST /api/billing/portal`** (BIL-14); the GET stays one release as a 302 alias registered as an allowed side effect | GETs never write |
| Route wrapper and cache tiers | `route()` vs `defineRoute()`; T0–T3 vs six tier names | **`route()`** (`WEB/lib/api/route.ts`) with **P1's tier names**: `public-static` (only with `auth:"public"`), `private-etag` (`private, no-cache` + strong ETag), `no-store` | B18; P1 §7.2.1; AP-22 |
| Membership state enums | P1 `MembershipState` (`member…none`, `me.ts`) vs P10's 13-state view | P1's enum keeps its name and gains `paused`; P10's enum is **`MembershipViewState`** (`billing.ts`) | two enums with one name in one package (found in this pass) |
| Socket rooms / events | `user:{ref}` + `domain:event` (B20) vs `u:{ref}` + dotted | **`user:{ref}`**, **`domain:event`**; P10's watcher event is **`presence:state`** (P2's `presence:update` is the game-room event) | B20; consistency R-07; P2 H-09 |
| Membership push | `membership:updated` (old P10) + `entitlement:changed` (P4) for the same webhook | **one event, `entitlement:changed`**, extended with `subscriptionUpdatedAt` and `cause` | api-perf §1 drift register |
| Internal fan-out | `/internal/user-event`; `{room, event, data}` | **`POST /internal/emit`** with P2's body `{ v:1, targets:[{ userRef }], event, data, dedupeKey? }` | consistency R-07 |
| Internal auth | static `x-internal-token` (P2, consistency R-08) vs HMAC from P2/P3 (feasibility SEC-4, AP-44) | P10 never builds headers: every hop goes through **`CT/internal/auth.ts`** (`internalFetch()`), so whichever scheme P2/P13 ship applies with no P10 change | the critiques disagree; the decision is P2's |
| Worker wake | `/worker/wake`, `/internal/wake` | **`POST /internal/analysis/kick`** `{ v:1, reason, runAt? }`; P10 adds the reasons `notify`, `export`, `purge`, `milestones`, `pause_edge` and the optional `runAt` (additive to P3's schema) | P3-D12; feasibility F-NEON-2 item 4 |
| Timed work | `HOURLY_TICK` slices (old P10, consistency R-05) vs a daily planner / next-due scheduling (feasibility F-NEON-2, api-perf AP-08) | **future-dated `jobs` rows**, inserted by P10 **planner slices** `plan(windowStart, windowEnd)` that P3's scheduler calls once a day (or once an hour if P3 ships `HOURLY_TICK`); settings changes enqueue their own rows from web | Two critiques against one, and P10's own D9 goal (no idle wakes). The slice API works with either P3 scheduler |
| Preferences | `PATCH /api/me/preferences` (B14), `/api/train/prefs` (P5 W8) | **`GET/PATCH /api/me/preferences`** for `PreferencesV1` (file `DBP/json/preferences.ts`, P9). **P5's `PATCH /api/train/prefs` stays the writer of the `TrainingProfile` columns and of `User.timeZone`** (no alias) | consistency 10.5 option (a) |
| Time zone | `User.timeZone` (P4) + `prefs.notifications.timezone` mirror (old P10) | **`User.timeZone` only** (`"timeZone"`, M4) | one stored copy, no sync bug |
| Push subscriptions | `/api/push/subscriptions` vs `/api/me/push-subscriptions` | **`/api/me/push-subscriptions`** | viewer namespace |
| Reports | `UserReport` + a second `POST /api/reports` (old P10) vs P5's `Report` | **P5's `Report` table and `POST /api/reports` handler**, extended with `targetType: "user"` and `"game"` | consistency R-02 (the old P10 schema did not validate) |
| Error codes | `upstream_timeout`, `refresh_failed`, `membership_ended` (old P10) | `502 upstream_unavailable {kind:"timeout"\|"refresh"\|"error", provider:"dodo"}`; `402 subscription_required {reason:"paused"}`; `403 reverification_required` (added by P10); `402 payment_update_required` | consistency R-06 |
| Rate limits | token-bucket wording ("120 / 2 per s") | P1 fixed window **`limit / windowSec`**, with **`store: "durable"`** for every window > 300 s | consistency R-13; api-perf AP-11 |
| Env names | `EMAIL_HASH_PEPPER`, `APP_URL`, `WK_ENV_FILE`, `LINKED_ACCOUNT_KEY` | **`HASH_PEPPER`** (= P4's ledger pepper), **`NEXT_PUBLIC_SITE_URL`** (web), **`WEB_APP_URL`** (OCI), **`WORKER_ENV_FILE` / `WORKER_DEV_ENV_FILE`** (GitHub secrets), **`LINK_TOKEN_KEYS`** | consistency R-09 |
| Daily cron | `GET /api/cron/membership-reconcile` vs one `GET /api/cron/daily` | **tasks `membership-reconcile` and `trial-reminder-backstop`** in `/api/cron/daily` (`lib/cron/tasks/*.ts`) | Hobby: one daily cron |
| Export job | `DataExportJob` vs one `Job` table | **both, B5 pattern** | B5 |
| Profile visibility | `PUBLIC/PRIVATE` vs `public/members/private` | **`PUBLIC \| PRIVATE`** | design has two options |
| Query keys | `qk.membership()` vs `qk.billing.membership()` | **client-data-layer `qk` tree**, extended in §5.1 | the client plan owns keys |
| Worker path, job names | `apps/worker` + dotted vs `apps/analysis-worker` + `JobKind` | **`WK`**, `JobKind` UPPER_SNAKE (§6.1), priorities from **`JOB_PRIORITY`** (`DBP/src/jobs.ts`), never literals | consistency R-05 |
| R2 presign | `aws4fetch` (P10) vs `@aws-sdk/client-s3` (P12) | **`WEB/lib/r2/presign.ts` on `aws4fetch`**, shared: whichever of P10/P12 merges first creates it | consistency R-12 |

### 0.3 P10 decisions (D-numbers referenced below)

| # | Decision | Alternative rejected | Reason |
|---|---|---|---|
| D1 | **Public profile data is served only by public routes that read no session.** Middleware rewrites `/@{u}` to `/u/{u}` (dynamic, signed in) or `/p/{u}` (ISR, `revalidate = 60`). `GET /api/players/{u}[/…]` are `auth:"public"` + `public-static` (tag `player:{usernameKey}`), and the same body serves guests and signed-in viewers. Per-viewer bits (`relation`, `blocked`, `canChallenge`, `presenceTicket`, `h2h`) come from **`GET /api/players/{u}/me`** (`auth:"user"`, `no-store`); own data from `/api/me/*` | One URL that is CDN-cached "when signed out" | The CDN keys on the URL and ignores cookies, so members would get the guest projection and one wrong branch could publish `me` data; P1's wrapper also refuses that combination (api-perf AP-03) |
| D2 | **The RSC for another player's profile reads the public projection from the same data-cache loader** (`getPublicPlayer(usernameKey)`, tag `player:{key}`) and adds one live per-viewer statement | Cache the whole page per viewer | Per-user caches aren't worth invalidating; popular profiles cost 0 DB for the public part |
| D3 | **Stats are computed on read** with one CTE over ≤ 90 days of the player's `game_players` joined to `games` (≈ 3 ms DB). **Deviation from allocation M10**: no `player_stats` table and no `PROFILE_STATS` job. The fallback table (§6.6) ships only if the k6 heavy persona shows DB p95 > 50 ms | Worker-written `PlayerStats` | Zero background writes, always fresh, no Neon wake |
| D4 | **Head-to-head uses P2's `game_players."opponentUserId"`** on the viewer's rows with P9's `game_players_h2h_idx ("userId","opponentUserId","endedAt" DESC)` | A new column (old P10 text wrongly assumed it was missing) | P2 already stores it; P9 M9 adds the index (consistency R-01) |
| D5 | **Preferences are local-first** (`usePrefs` Zustand, `localStorage rc:prefs:v1`), synced by a 400 ms debounced `PATCH` with last-write-wins per leaf; sibling tabs sync through `BroadcastChannel("rc-sync")` carrying the **server version** after each PATCH; a tab ignores `prefs:updated {version}` when its local version is ≥ the event's (0 requests on the same device); other devices do one ETag GET | Server-first prefs; refetch on every event | The board and sounds read prefs synchronously outside React; api-perf AP-24 |
| D6 | **Pause = deferred renewal** (`subscriptions.update(id, { next_billing_date })`) with a local pause window `[pausedFrom, pausedUntil)` that entitlement treats as "no access". Fallback if Dodo test mode rejects it: Dodo's own `pause: true/false` driven by two future-dated edge jobs (§8.4) | Immediate `pause: true` | Immediate pause would cut the paid remainder |
| D7 | **Delete account runs one request-time transaction** (anonymise shared rows, delete private rows by cascade) and an outbox job for Dodo, Clerk, Lichess, R2, PostHog and email. Gate: p95 ≤ 1.5 s on the heavy fixture; if exceeded, stage 1 becomes a tombstone + worker cascade (optimization OPT-63). A 24-hour undo window is an owner option (§14 Q20), off by default | Worker-only deletion | The design promises "Something went wrong and nothing was deleted" |
| D8 | **Presence is authorised by a signed presence ticket** returned by `GET /api/players/{u}/me` (and seeded by the RSC) for targets the viewer may see; the socket verifies it on `presence:watch` and answers with `presence:state` | Socket checks visibility in the DB per watch | No scraping of who is online among private or blocking users; zero socket DB reads |
| D9 | **No fixed timers.** Reminders, weekly digests, the DST pass, the milestone backstop, the trial reminder and the R2 sweep are **future-dated `jobs` rows** inserted by P10 planner slices while Neon is already awake (P3's daily `HOUSEKEEPING`/planner run, 21:00 UTC). A settings change that affects the next 26 h enqueues its own row from web in `after()` with a kick carrying `runAt`. The worker sleeps until `min(runAt)`; an idle day costs one planned wake per distinct reminder minute that has an eligible member, capped by `REMINDER_MAX_RUNS_PER_DAY` (§8.11) | `HOURLY_TICK` (24 wakes a day) or a 15-minute timer (96) | Neon Free is 100 CU-h a month (feasibility F-NEON-2, api-perf AP-08) |
| D10 | **Usernames are case-insensitive unique** (`usernameKey = lower(username)`), display casing kept, change once per 30 days, old handle redirects and is reserved for 90 days | Case-sensitive | inv-acct Q12; copy "Usernames are not case-sensitive." |
| D11 | **Avatars are resized in the browser to 256×256 WebP and PUT straight to R2** with a presigned URL whose signature covers `content-type` and `content-length`; allowed types webp, png, jpeg; the media host serves `X-Content-Type-Options: nosniff` and `Content-Security-Policy: default-src 'none'; img-src 'self'` (Cloudflare Transform Rule); avatars render `unoptimized` (no Vercel image transformations) | `sharp` on Vercel; `next/image` optimisation | No image processing on Hobby (5,000 transformations a month, feasibility F-VER-4); SEC-9 |
| D12 | **Presign with `aws4fetch`** (≈ 3 KB) in the shared `WEB/lib/r2/presign.ts`; the worker keeps `@aws-sdk/client-s3` + `lib-storage` for multipart exports | the AWS SDK on web | Cold start and bundle size; consistency R-12 |
| D13 | **Membership state is derived by one pure function** `deriveMembershipView()` in `WEB/lib/billing/membership-view.ts` (RSC, API, tests). 13 states (12 designed + `paused`) | Client-side derivation (today's `viewFromStore`, `MembershipSection.tsx:64`) | One source, unit-tested |
| D14 | **Non-members see Settings › Account, Connected and Membership only**; public profiles are readable by everyone | Everything gated | Phase 0 §1 access table; owner confirms (§14 Q1) |
| D15 | **Settings › Training writes through the owning phases' routes**: P5's `PATCH /api/train/prefs` (cap, new per day, release hour, day start, auto-grade, time zone) and P6's `POST /api/train/weakness/recompute` (scope). P10 adds no training storage | An alias that rewrites into `PreferencesV1` (old P10) | `PreferencesV1` has no `train` section; P5 stores these as `TrainingProfile` columns (consistency 10.5; coverage C-12) |
| D16 | **Player reports go into P5's `reports` table** through P5's handler: `targetType = USER` (or `GAME` when a game is attached), `reportedUserId` set | A second table and handler | consistency R-02 |
| D17 | **The daily email budget lives in a logged table `email_budget_days`**, reserved atomically per send | `rate_limit_buckets` | That table is UNLOGGED and empties on every Neon suspend (feasibility F-NEON-3) |
| D18 | **[Challenge] links to `/play?tab=friend&opponent={username}`**; P9's friend tab shows "For @{username}" on the link card when the param names a player the viewer may challenge, and ignores it otherwise | `/play/friend?opponent=@u` | That route does not exist (coverage C-11); the link flow stays P9's |
| D19 | **The in-game ⋯ "Board settings" item opens `BoardSettingsSheet`** (`?modal=board-settings`) over the game; the live board is the preview | Navigating to `/settings/board` | Navigation would unmount a live game (coverage C-16) |

---

## 1. Goal and user-visible outcome

**Goal.** The account area: public profiles with privacy, every settings section synced across devices, the full membership lifecycle (plan switch, cancel with retention, pause), account deletion and export, and notifications (push and email) that never need a timer.

**What a member sees at the end of P10.**

- `/@knightowl_88` is their profile: rating chart per pool, recent games, strengths (from P6), milestones, a Games tab with search, filter popover, bulk "Send to coach review" and "Export PGN", a Stats tab with phase accuracy against similar players, and a Milestones tab. Edit profile uploads a photo in a second and the header updates in every open tab.
- Another member's profile shows online presence and "Watch live", head-to-head, Challenge (opens the friend-link flow addressed to that player), Report and Block. A private profile shows only name and rating. A logged-out visitor sees a marketing-chrome profile (noindex) that sells the trial.
- `/settings` is one shell: Board (live preview), Pieces, Sounds and voice (test buttons), Training (daily bank size, new cards, release hour, day start, auto-grade, time zone, weakness scope), Appearance (light/dark/system), Notifications (push and email per channel, reminder time, quiet hours, Install app), Account (email, password, username, visibility, cookie settings, export, delete), Connected accounts and Membership. Changing the board theme on the laptop changes it on the phone within seconds. In a game, ⋯ › Board settings opens the same controls as a sheet without leaving the game.
- Membership shows exactly one of 13 states with the right actions; switching to yearly previews the prorated charge before confirming; cancelling offers a pause or yearly first, then asks a reason; the past-due state links to a Dodo payment update. Trial members get an email two days before the first charge.
- "Download your data" emails a ZIP within minutes; "Delete account" with the typed username removes the account, cancels billing, and leaves opponents' games intact under "Deleted player".
- With push enabled, the daily "6 mistakes are due" reminder arrives at the chosen time (never during quiet hours), and "Send a test" arrives within seconds.

**Owner test on the dev URL** (`https://replay-chess-dev-replaychess007-1069.vercel.app`, ego-browser, flag `account-v3` on). The owner test uses **leased pool users** reset to named personas (`pnpm --filter web personas -- --reset <pool user> --persona <name>`, testing critique X4), never the shared E2E letters, because almost every step mutates the user. Below, "P10A" is a pool user reset to `p10-profile`, "P10B" to `p10-rival`, "P10C" to `p10-trial`, "P10D" to `p10-paid-monthly`, "P10E" to `p10-pastdue`; deletion uses a throwaway `e2e-del-<date>` user.

1. Sign in as P10A. Open `/@<P10A>`: Overview → Games (search "sicilian", filter Losses + Chess.com, Select 2 rows → Send to coach review → rows show "Queued", then badges arrive) → Export PGN downloads a `.pgn` → Stats (switch Blitz/Rapid) → Milestones.
2. Edit profile: type a 2-character name (inline error), a bio with `https://` (error), upload a 4 MB photo (`upload_error`), upload a 300 KB PNG (progress, then saved). The header avatar updates in a second tab without a reload.
3. Open P10B's profile in P10A's session: the online dot appears when P10B has a game open; Block P10B → menu shows Unblock; P10B no longer sees Challenge on P10A. Unblock. Challenge → `/play?tab=friend&opponent=<P10B>` shows "For @<P10B>" on the link card.
4. Set P10B to private (Account › Who can see your games → Only me); P10A sees the private card. Sign out: `/@<P10B>` shows the guest private card; `/@<P10A>` shows the guest public profile with `<meta name="robots" content="noindex">` and `x-vercel-cache: HIT` on the second load; `GET /api/players/<P10A>` signed in and signed out return the same body, and `GET /api/players/<P10A>/me` signed in is `private, no-store`.
5. Two windows as P10A: Settings › Board → Walnut in window 1; window 2's preview turns Walnut within 1 s (BroadcastChannel, no network request in window 2's DevTools). Phone (real iPhone, signed in as P10A): theme changes within 3 s (socket `prefs:updated`).
6. Sounds: press each test button; set volume 0 → "Muted" summary; in a fresh tab with autoplay blocked the banner shows "Turn sound on".
7. Training: set Daily bank size 15 and release hour 07:00 → the Train hub's "next batch" line says 07:00; change Weakness scope to 3 months → "Your weakness profile is updating"; a second change within 10 minutes shows the wait note.
8. Notifications on desktop Chrome: Enable push → browser prompt → Allow → "Send a test" → system notification arrives; click it → app opens on `/train`. Block notifications in site settings → "Check again" shows the denied state. On iPhone Safari (not installed) `ios_install` shows "Show me how" (P11's install sheet once P11 has merged). The Install app row appears in a desktop browser that can install.
9. Reminder: with `?debugReminder=1` (test hook, non-prod only) pick "+20 min" with ≥ 1 due card → the push arrives within 2 minutes of that time; Sentry shows no worker query between the PATCH and the send (next-due scheduling).
10. Membership as P10C (Dodo test mode, trial): "DAY n OF 7" → Switch to yearly (trial copy, nothing to pay) → Cancel trial (trial_offer → reason → trial_done) → trial_cancelled → Keep my trial. The trial-ending email is in the dev Resend log with `runAt = trialEndsAt − 48 h`. As P10D (active monthly): Switch to yearly (preview shows Dodo's prorated amount) → confirm → done; Cancel membership (offer: Pause instead) → paused (scheduled) → Cancel pause; Cancel → reason → done → cancelling → Resume.
11. Past due: `POST /api/dev/billing/simulate?state=past_due` (test hook) on P10E → past_due state and payment banner; Update payment opens the Dodo update link; the return triggers one `POST /api/billing/refresh`.
12. Account › Download your data → "Preparing…" → email arrives with a link → ZIP contains `games.pgn`, `reviews.json`, `mistake-bank.json`, `training-history.json`, `coach.json`, `settings.json`, `profile.json`, `README.txt`.
13. Delete account as the throwaway user who played one game against P10A and has a test subscription: preview shows counts and the active-subscription banner; wrong case → "Doesn't match yet"; correct → Clerk asks to re-verify → Deleting → deleted → signed out. P10A's archive still shows the game against "Deleted player"; the Dodo test dashboard shows the subscription cancelled; the Clerk dev instance no longer has the user.
14. Usernames (pool user reset to `p10-username`): change the username; `/@old` 308-redirects to the new one; a second change is refused with the cooldown date.

---

## 2. Scope

### 2.1 In scope

| Area | Features |
|---|---|
| Profile | `/@username` routing (rewrite, legacy 308s), own profile with tabs Overview, Games, Stats, Milestones, states `default/loading/new_user/not_linked`; other player `public/online/private/not_found/loading`; guest `public/private`; "See it as others do"; copy link; presence (`presence:state`); head-to-head; block, unblock, report (into P5's `reports`); profile edit with avatar upload, initials, display name, bio, country, visibility; player search for the not-found page (public for guests, `no-store` for members) |
| Games tab extras | `POST /api/me/games/review-batch` and `GET /api/me/games/export.pgn`, also lit up in the P3 `/games` archive; P3's `GamesQuery` gains `src` and `legend` filters (additive) |
| Milestones | Catalogue v1 (8 definitions including `TOURNAMENT_PODIUM`, §8.9), evaluation job, `milestone:awarded` toast |
| Settings | Shell (list + detail; phones drill in), Board, Pieces, Sounds and voice, **Training** (§4.18, no board), Appearance, Notifications, Account, Membership; adoption of P4's `/settings/connected`; the in-game **Board settings sheet** (§4.19, no board); preference sync across tabs and devices; legacy `chess-battle-theme` / `chess-sound-muted` / `rc-single-key-shortcuts` migration |
| Preference consumers | Board CSS variables (theme, coordinates, last move, legal moves, piece size/shadow, animation), input mode, premove count, auto-queen, tap-to-confirm, orientation, material difference, sound volume and categories, low-time tick, coach voice settings (consumed by P7), motion, dim-in-dark |
| Membership | 13-state page, Billing card (card on file, invoices, PDF), Manage billing (portal), Switch plan modal (9 states), Cancel modal (8 states + pause), pause/unpause, payment-method update, `POST /api/billing/refresh`, DB-only view model, Dodo webhook additions, daily reconcile task |
| Account | Email change and password via Clerk, username change with availability, visibility, Privacy group with P11's "Cookie settings" row, data export (ZIP via worker), delete account (preview, typed confirm, step-up, transaction, outbox purge), Clerk webhook `user.updated` (email → DB + Dodo) and `user.deleted` |
| Notifications | Pre-permission prompt (`V3NotifPrompt`), push subscription lifecycle, service-worker handlers in `WEB/worker/push.ts`, test push, channel × push/email matrix (7 rows incl. `tournament_new`, both tournament rows lit by `tournaments-v3`), "Install app" row (P11 export), reminder time, quiet hours, time-zone mismatch prompt, worker dispatch (web-push + Resend), reminder producer (`MISTAKES_DUE`), weekly digest, `REVIEW_READY`, `CHALLENGE` ("your challenge link was accepted"), `PAYMENT_FAILED`, **`TRIAL_ENDING`** (moved from P4, §8.17), export-ready and deletion emails, one-click unsubscribe, click tracking, Resend domain setup, durable email budget |
| Schema | M10a + M10 + C3 (§6) |
| Nav | Settings destination enabled; Profile destination points to `/@username`; chords `g u` (profile) and `g s` (settings) |

### 2.2 Explicitly out of scope

| Item | Where it goes |
|---|---|
| In-app notification inbox (`qk.notifications`, `ME-11`, `notification:new`) | Not designed; later. `notifications.readAt` exists so it can ship without a migration |
| Moderation admin for reports, rename user, suspend | P12 admin (reads P5's `reports_status_createdAt_idx`) |
| v3 marketing header on the guest profile | P11 must add the `(public)/p/[username]` group to its chrome swap (P11 §4.0; coverage C-22). P10 renders the existing marketing `Navbar` until then |
| Cookie consent itself and `ConsentRecord` | P11 (M11); P10 renders the Settings row (§4.12) and adds P11's anonymisation line to the deletion transaction (§8.12) |
| v3 sign-in/up/verify/reset screens, the install sheets | P11 (`openInstallPrompt()`); P10 calls it |
| Tournament notification **producers** (`TOURNAMENT_STARTING` rows from P12's join route, `TOURNAMENT_NEW` on arena creation) | P12. P10 ships both rows, the kinds, the dispatcher and the quiet-hours rules |
| LLM `statLine` on the Stats tab | **Not scheduled** (template sentence only; P7 does not pick it up, coverage C-19) |
| Paid TTS for the coach voice | later (inv-acct Q14); P10 uses `speechSynthesis` |
| Extra piece sets B and C | hidden until art exists (inv-acct Q13) |
| Language selector options other than English | disabled "(later)" (inv-acct Q15) |
| Clerk's own email templates | Clerk dashboard |
| Connected accounts features | P4 owns them; P10 moves the page into the shell |
| A "trial started" confirmation email | Dodo's receipt covers it (§14 Q24) |

### 2.3 Dependencies on earlier and parallel phases

| Phase | What P10 needs from it | If missing at P10 start |
|---|---|---|
| P1 | `route()` with the tiers `public-static` (tags as a function of the parsed params; WP0 adds the overload if P1 shipped only `string[]`), `private-etag`, `no-store`; `RateLimitSpec {bucket, limit, windowSec, by, store?: "burst"\|"durable"}` with a LOGGED durable store (api-perf AP-11; WP0 adds `rate_limit_windows` if absent); envelope; `api()` (response schemas parsed in dev/test only, AP-12); `qk`, `QueryProvider`, `reactToApiError`; `getViewer()`/`getMe()`; `GET /api/me`; Clerk webhook; `WebhookEvent`; flags; UI kit; shell; `ScrollRegion`/`BoardStage`; device × zoom config; `/dev/ui`; `signOutEverywhere()` (incl. `POST /api/session/clear` → `Clear-Site-Data: "cache"`, AP-04); `isNonProd()`, `x-rc-now` → `ctx.now`, the test-hook registry, persona lease pool and throwaway-user sweeper (testing X4, X5, X12); `applySubscriptionSnapshot` with the `subscriptionSourceAt` compare-and-set (AP-06); `codes.ts` with `CONFLICT_REASONS`/`FORBIDDEN_REASONS`; middleware `Sec-Fetch-Site: same-origin` check on mutations (SEC-9) | Blocker (the AP-11 store and the `tags` overload are small enough for WP0 to add) |
| P2 | Socket v2 with `user:{ref}` auto-join; `POST /internal/emit` (`targets` body, registry `CT/socket/registry.ts`); `RealtimeProvider`, `UserChannel` handlers; connection lifecycle for presence; `GamePlayer` (B1) incl. `opponentUserId`; `Game.whitePlayerId/blackPlayerId`, `whiteName/blackName/whiteRating/blackRating` (M2, consistency 2.1); spectate; `GameMenu` slot "Board settings"; `games_white_player_idx` / `games_black_player_idx` | Blocker for presence and h2h |
| P3 | `Job` table with `fairSeq` (M3), `JOB_PRIORITY` (`DBP/src/jobs.ts`), the worker drain loop, the scheduler that calls registered **planner slices** once per run (`WK/src/scheduler/recurring/`), `POST /internal/analysis/kick`; `Game.analysisStatus`; `GamePlayer.accuracy/phaseAccuracy/headline/momentsCount`; `games.ecoCode/openingName` (M3); `GET /api/me/games` (`GamesQuery`, `GameRowDTO`); `Game.pgn`; `/review/[ref]` | Blocker for Games/Stats tabs and worker jobs |
| P4 | `LinkedAccount`, `/api/accounts/*`, `/settings/connected`; `TrialLedger` + `WEB/lib/billing/trial-ledger.ts` (`normaliseEmail`, ledger hash with `HASH_PEPPER`); **M4** columns `User.timeZone`, `membershipEndedAt`, `lastPaymentFailedAt`, `lastPaymentFailureReason`; **`AuditLog`** (moved to M4, consistency R-04); `entitlement:changed` emit from `onEntitlementApplied()`; `GET /api/billing/activation`. **P4 does not set up Resend** (consistency 4.16): P10 does (WP3) | Connected section stays standalone |
| P5 | `reports` table + `POST /api/reports` (W7) + `report` bucket; `PATCH /api/train/prefs` (W8) and `TrainingProfile` prefs columns; `TrainingCard` due index `(userId, deck, due)`, `TrainingDay`, `TrainingProfile.dayStreak/dayStreakBest`; `POST /api/train/sessions/:ref/end` (W4) for the milestone hook | Reminders ship without the due predicate (no sends); Training section hidden |
| P6 | `WeaknessSnapshot` strengths; TR-12 `POST /api/train/weakness/recompute {timeClasses, months}` storing the scope in `prefs.training.weakness`; `game_players.stats`/`errorThemes` (M6); baseline JSON `packages/chess-training/baselines/v1.json` | Strengths card and the scope editor hidden; band ticks hidden |
| P7 | Coach panel reading `prefs.sound.coachVoice` / `voiceRate` | Voice rows still save; nothing speaks |
| P8 | Legend practice games (`Game.mode = LEGEND_BOT`, `chessPositionId`) | "Legend positions only" filter and 2 milestones hidden |
| P9 | `PlayerRating`; per-game ratings on `GamePlayer.ratingBefore/After/Delta`; `game_players_h2h_idx` (M9); `UserSettings` with `prefs`, `prefsVersion`, the derived minute columns, `emailOptIns`, `consent`; `PreferencesV1` in `DBP/json/preferences.ts`; `GET/PATCH /api/me/preferences`; `/play?tab=friend` and `POST /api/challenges/{code}/accept` | Rating module shows the linked-account rating only; Challenge links to plain `/play?tab=friend` |
| P11 (parallel) | `openCookieSettings()`, `openInstallPrompt({ source })`, `WEB/worker/index.ts` importing P10's `./push` | Cookie row hidden; Install row hidden; `ios_install` falls back to today's `IOSInstallModal`; P10 creates `worker/index.ts` if P11 has not |
| P12 (parallel) | First to merge creates, second reuses with `IF NOT EXISTS` (consistency R-19): `TournamentParticipant.displayName`, `reverification_required`, `WEB/lib/r2/presign.ts`, the notification kinds | — |

### 2.4 Lights up

- **Earlier slots P10 turns on:** the P6 strengths card (profile); the P3 archive bulk review and PGN export; the Settings nav destination; the account-menu "Settings" and "Membership" items; P7's coach voice; the P1 Shortcuts dialog's "Single-Key Shortcuts" switch (now synced, `prefs.appearance.singleKeyShortcuts`); **P2's in-game ⋯ "Board settings" item** (coverage C-16, D19); **P5's Settings › Training** (P5:108) and **P6's scope editor** (P6:102) (coverage C-12, §4.18); P9's challenge link card label for `?opponent=`.
- **P10 slots later or parallel phases turn on, and how:**
  - P11: the v3 marketing header on `/p/{u}` (P11 adds the group to its chrome swap); "Cookie settings" row and "Install app" row (render when P11's exports exist and, for cookies, when `NEXT_PUBLIC_CONSENT_BAR=on`; coverage C-13); consent gating of client PostHog events.
  - P12: both tournament notification rows render when `flag('tournaments-v3')` is on, so P12's flag flip lights them with no P10 edit (coverage C-24); P12's empty-state link `/settings/notifications#tournament_new` targets the row's anchor (C-14); `TOURNAMENT_PODIUM` is defined and evaluated by P10 from `tournament_participants."finalRank"` and lights up when P12 writes that column (C-23; P12 adds one `after()` line that enqueues `MILESTONES_EVALUATE` for the podium users, otherwise the daily backstop finds them); report moderation.
  - P12 DoD should list "tournament notification rows visible" and "podium milestone awarded" as its checks.

---

## 3. Current code touched

"Expect at P10 start" states what P1–P9 will have done; "P10 action" is what this phase does.

### 3.1 Pages and components

| File (today, `0848b76`) | Today | Expect at P10 start | P10 action |
|---|---|---|---|
| `WEB/app/profile/[referenceId]/page.tsx` (279 lines; fetch in `useEffect` :88–93, `isOwnProfile` from Zustand :116, `ThemeToggle` :198, `MembershipSection` :209, `ChessComConnectModal` :270) | Client page | Moved to `WEB/app/(app)/profile/[referenceId]/` by P1 (SPEC D1), still the legacy page | **Replace** with a server component that resolves `referenceId` → `username` and calls `permanentRedirect('/@'+username)` (308); legacy page body deleted after the parity check |
| `WEB/app/profile/[referenceId]/layout.tsx` (81; `cache()` :11, `generateMetadata` :18–33) | Prisma read + metadata | moved by P1 | **Remove** (metadata moves to `/u/[username]` and `/p/[username]`) |
| `…/ProfileHero.tsx` (250), `StatsOverview.tsx` (184), `GameHistory.tsx` (187), `ChessComRatings.tsx` (117), `loading.tsx` (7) | Legacy profile parts | unchanged | **Remove** after parity (replaced by `WEB/features/profile/*`) |
| `…/ChessComConnectModal.tsx` (306) | Chess.com link modal | P4 replaced its callers with `/settings/connected` | **Remove** if P4 left it |
| `…/MembershipSection.tsx` (1,069; `viewFromStore` :64, `requestJson` :101, mount fetch `GET change-plan` :150–166, refetch after action :178–188, preview :237–252, actions :260–295) | All membership UI | unchanged (P1 left it inside the shell) | **Replace** by `/settings/membership` (`WEB/features/membership/*`). Keep the logic of `viewFromStore` only as test vectors for `deriveMembershipView` |
| `…/MembershipModal.tsx` (179) | Change/cancel modal | unchanged | **Remove** (replaced by `PlanSwitchDialog`, `CancelFlowDialog`) |
| `WEB/app/components/ThemeProvider.tsx` (16; `defaultTheme="light"` :9, `storageKey="chess-battle-theme"` :10, `enableSystem={false}` :11) | Light/dark only | unchanged | **Rework**: `defaultTheme="system"`, `enableSystem`, same storage key; `usePrefs` is the authority and writes through `setTheme` |
| `WEB/app/components/ThemeToggle.tsx` | Toggle on the profile page | unchanged | **Remove** from profile; the shell account menu keeps a 3-way theme item that writes `usePrefs` |
| `WEB/app/components/ThemeAwareClerkProvider.tsx` | Clerk appearance follows theme | unchanged | **Keep**; reads `resolvedTheme` (works with `system`) |
| `WEB/app/components/IOSInstallModal.tsx` | iOS install instructions | P11 replaces it with `IosInstallSheet` + `openInstallPrompt()` | **Fallback only** for `ios_install` "Show me how" until P11's export exists |
| `WEB/app/components/ChessBoard.tsx` (square colours literal `isLightSquare` :392, styling :432–505, piece `<img>` :577, :666, :701) | Fixed theme | P1 added `squareSize="fill"`; P2 rebuilt the board (`packages/board` or `WEB/components/board/*`) | **Rework** the P2 board to read CSS variables `--board-light`, `--board-dark`, `--board-coords`, `--board-last-move`, `--piece-scale`, `--piece-shadow`, `--move-ms`, `--board-dim` and the props `coords`, `showLegal`, `showLastMove`, `inputMode`, `tapConfirm`, `autoQueen` from `usePrefs` |
| `WEB/lib/hooks/useChessSound.ts` (mute key :19, preload on mount :39–51, per-screen instance) | Per screen, mute only | P2 may have moved it to `lib/sound/` | **Rework** into an app singleton `WEB/lib/sound/engine.ts` reading `usePrefs.sound` (volume, `board`, `lowTimeTick`), one shared `AudioContext`, lazy load on first gesture, `autoplay_blocked` detection |
| `WEB/lib/hooks/usePWAInstall.ts` (iPadOS detection :54–58) | Install prompt | P11 fixes the iPadOS bug (inv-sys §2.9) | **Reuse** `isIOS()`/`isStandalone()` for the `ios_install` state |
| `WEB/lib/shell/prefs.ts` (P1: `localStorage["rc-single-key-shortcuts"]`) | — | exists | **Rework**: read/write `usePrefs.appearance.singleKeyShortcuts`, migrate the old key once |
| `WEB/lib/nav/destinations.ts` (P1: `settings.enabled=false`, profile `href=/profile/{ref}`, `match` on own ref) | — | exists | **Edit**: `settings.enabled = flag('account-v3')`, profile `href = '/@'+me.username`, `match` on `/u/*`, `/@*`, `/profile/*`; chords `g u` (profile), `g s` (settings) |
| `WEB/components/shell/AccountMenu.tsx` (P1) | Membership item → `/profile/{ref}#membership` | exists | **Edit** (P10 owns the file during P10∥P11, §13.0): Settings → `/settings`, Membership → `/settings/membership`, Connected accounts → `/settings/connected`; P11's "Install App" item added on its request |
| `WEB/next.config.js` (`rewrites()` :60, `images.remotePatterns` :72–79, `redirects()` :80–91, PWA `withPWAInit` :13–35) | — | P1 H8 fixed runtime caching; P1 moved redirects to `config/redirects/*.mjs`; P11 owns the SW build | **Edit** through `WEB/config/redirects/p10.mjs`: `/membership` → `/settings/membership` (308); no `remotePatterns` entry (avatars render `unoptimized`, D11); the SW entry is P11's (`worker/index.ts` imports P10's `worker/push.ts`) |
| `WEB/middleware.ts` (protected list :16–26) | Prefix list | P1 inverted it to a public allow-list + claim gate, with route classes as data | **Edit** `WEB/lib/routes/classes/account.ts` only: `/@:u` rewrite (signed-in → `/u/:u`, signed-out → `/p/:u`); class `public-api` (no Clerk) for `GET /api/players/:u`, `/api/players/:u/{rating-history,games,stats,milestones}`, `/api/players/search`; public: `/p/*`, `/@*`, `/email/unsubscribe`, `/api/email/unsubscribe`, `/api/push/clicked`; non-member allow-list adds `/settings`, `/settings/account`, `/settings/connected`, `/settings/membership`, `/profile/edit`; `md.paused` → `/settings/membership` |
| `WEB/public/sw.js`, `swe-worker-*.js` (generated) | Generated | regenerated by P1/P11 | **Regenerate** with the custom worker (§7.6) |

### 3.2 API routes and libraries

| File | Today | P10 action |
|---|---|---|
| `WEB/app/api/profile/[referenceId]/route.ts` (162; `include stats, chessComProfile` :25–31, OR query :42–61, fixed 20 rows :48) | Public, no privacy | **Alias for one release**: `auth:"public"`, resolves to the username and returns the PLY-1 body with `Deprecation: true`; delete in P13 (allocation §5.3) |
| `WEB/app/api/subscription/route.ts` (144; Dodo `customers.list` + `subscriptions.list` per call :72–144) | P1 made it DB-first, Dodo on `?refresh=1` | **Keep** for old clients; the new UI calls `GET /api/billing/membership` (DB only) and `POST /api/billing/refresh`; the legacy `?refresh=1` GET path is P1's and no P10 client calls it. Remove when no client calls it (Vercel logs show 0 calls for 7 days) |
| `WEB/app/api/subscription/cancel/route.ts` (84; body `{feedback, comment}` :18–21, `cancellationRejection` :53, Dodo update :65–70) | Works | **Change**: adopt `route()`; body adds `offerShown: 'pause'\|'yearly'\|'none'`; response `{ membership: MembershipView, message }` (old `entitlement` field kept one release) |
| `WEB/app/api/subscription/resume/route.ts` (44) | Works | **Change**: same envelope; also clears a **scheduled** pause (§8.4) |
| `WEB/app/api/subscription/change-plan/route.ts` (145; `decidePlanChange` :74–85, `changePlan` :89–96, DELETE :115–145) | Works | **Change**: `route({ idempotency: "required" })` on POST; returns `membership`; DELETE clears `scheduledPlanKey` locally after Dodo succeeds |
| `WEB/app/api/subscription/change-plan/preview/route.ts` (86) | Works | **Change**: envelope; 4 s timeout → `502 upstream_unavailable {kind:"timeout", provider:"dodo"}` (the modal maps it to `preview_unavailable`) |
| `WEB/app/api/customer-portal/route.ts` (37; GET creates a portal session :30) | GET with side effect | **Alias** (302) one release; new `POST /api/billing/portal` |
| `WEB/app/api/webhook/dodo-payments/route.ts` (72; subscription snapshot :36–54, `payment.succeeded` link :56–68) | P1 added `WebhookEvent` dedupe, Clerk claims, the `subscriptionSourceAt` compare-and-set; P4 added `entitlement:changed`, `lastPaymentFailedAt` | **Extend** (§7.5): `scheduled_change` → `scheduledPlanKey/scheduledChangeAt`, `paused_at` → `pausedAt`, pause-window reconciliation, `TRIAL_ENDING` scheduling, `PAYMENT_FAILED` notification, `revalidateTag('billing:'+customerId)`, `entitlement:changed {subscriptionUpdatedAt, cause}` (no separate membership event) |
| `WEB/app/api/webhook/clerk/route.ts` (P1) | `user.created/updated/deleted` | **Extend**: `user.created` assigns a username (§8.6); `user.updated` email change → DB + Dodo customer email (`after()`, `DODO_CUSTOMER_SYNC` job on failure); `user.deleted` → `deleteAccount({ source: "clerk" })` |
| `WEB/app/api/user/sync/route.ts` (overwrites `name`, `profilePictureUrl` :71–79) | P1 removed it from the boot path | **Change** if it still exists: never write `displayName`/`avatarUrl`; keep Clerk fields in `name`/`profilePictureUrl` only |
| `WEB/lib/billing/entitlement-rules.ts` (`isEntitled` :56–74, `EntitlementSummary` :184–201, `summarizeEntitlement` :209–243) | Pure rules | **Extend**: `EntitlementRecord` gains `pausedFrom`, `pausedUntil`; `isEntitled` returns false inside the pause window; unit tests extended |
| `WEB/lib/billing/subscription-action-rules.ts` (`availablePlanChanges` :84–111, `decidePlanChange` :118–148, `cancellationRejection` :157–168, `resumeRejection` :171–185, `formatMinorUnits` :292–301, `formatMembershipDate` en-US only :304–309, `mergeEntitlementIntoStore` :316–343) | Pure rules | **Extend**: `decidePause()`, `decideUnpause()`, `estimateProration()`; `formatMembershipDate(iso, locale, timeZone)`; `mergeEntitlementIntoStore` deleted with `useUserStore` (P1) |
| `WEB/lib/billing/subscription-actions.ts` (`getOwnedSubscription` :70–134, `respondAfterMutation` :165–190, `buildChangePlanParams` :193–204) | Server wrapper | **Extend**: `respondAfterMutation` returns `{ membership: deriveMembershipView(...) }`; new `pauseSubscription()`, `updatePaymentMethod()` |
| `WEB/lib/billing/entitlement.ts` (`ENTITLEMENT_SELECT` :19–30, `applySubscriptionSnapshot` :54–117) | Applies snapshots | **Extend** select and writes with the M10 billing columns (§6.2); every caller passes the provider event time (never `now()`) to P1's compare-and-set |
| `WEB/lib/billing/trial-rules.ts` (`isTrialEligible` :22–24, `trialDaysLeft` :37–41) | — | **Add** `trialDayNumber()` (§8.2); no change to eligibility (P4 added the ledger check) |
| `WEB/lib/billing/trial-ledger.ts` (P4: `normaliseEmail`, ledger hash with `HASH_PEPPER`) | — | **Reuse** `trialLedgerHash(email)` for `AccountDeletion.emailHash` (one function, so a deleted member's hash matches, consistency 10.2) |
| `WEB/lib/auth/require-subscription.ts` (`BILLING_PAYWALL` :20) | — | **Read** only (dev banner on Membership when the paywall is off) |
| `WEB/prisma/schema.prisma` (`User` :18–65, `Game.creator/opponent` Cascade :90–91, `Tournament.createdBy` Cascade :399, `TournamentParticipant.user` Cascade :428) | — | **M10 + C3** (§6) |
| `WEB/lib/media.ts` (`NEXT_PUBLIC_MEDIA_URL`) | Media base URL | **Reuse** for avatar public URLs |
| `WEB/scripts/upload-media.ts` (`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` :34–64) | Upload script | **Reuse** the env names; P10 adds `R2_PRIVATE_BUCKET` |

### 3.3 Socket server and worker

| File | P10 action |
|---|---|
| `WS/src/handlers/index.ts` (P2 registry) | **Edit**: register `presence:watch` / `presence:unwatch` |
| `WS/src/presence/*` (new) | **Create** `PresenceRegistry.ts`, `presence-handlers.ts`, `ticket.ts` |
| `CT/socket/registry.ts` (P2, the only server→client registry) | **Register** `prefs:updated`, `profile:updated`, `blocks:changed`, `export:ready`, `milestone:awarded`, `presence:state` (schemas in `CT/socket/{user,presence}.ts`); extend P4's `entitlement:changed` schema with optional `subscriptionUpdatedAt`, `cause` |
| `WK/src/jobs/index.ts` (P3 registry) and `WK/src/scheduler/recurring/` (P3, directory of planner slices) | **Edit**: register the P10 job kinds (§7.8) and add the planner slices `p10-{reminders,weekly,dst,milestones,housekeeping}.ts` (no `HOURLY_TICK` dependency) |
| `WK/src/jobs/analyze-game.ts` (P3) | **Edit** one line in its completion step: `await afterAnalysis(tx, { userIds, gameId })` from `WK/src/jobs/account/after-analysis.ts`, which enqueues `MILESTONES_EVALUATE` and the `REVIEW_READY` notification |

---

## 4. Screens

### 4.0 Rules shared by every P10 screen

- **Shell.** All screens render inside the P1 `(app)` shell except `/p/{u}` (marketing chrome). Shell modes (SPEC §2.2): sidebar 220 px (> 1100 px wide, fine pointer), rail 64 px (≤ 1100 or coarse), tab bar (≤ 600 px, or ≤ 900 px portrait). The phone tab bar is Home, Play, Train, Learn, Review, Profile (`DR/V4iPhoneMembership.dc.html` nav).
- **One viewport.** Every P10 page sets `data-rc-lock` (SPEC D15): the document never scrolls; content scrolls inside `ScrollRegion` panels. The only board on a P10 screen is the Board/Pieces preview, which sits **outside** the scroll region so it can't scroll away (DS README "Layout: one viewport" rules 1–2).
- **Short viewports and zoom.** At `@media (max-height: 620px)` (150 % zoom on a laptop) the profile header hides the meta line and linked chips, the settings detail header shrinks to 48 px, and the preview board shrinks with its container (min 220 px). At 80 % zoom (≈ 1800×1125) content is capped at the 1280 px container and centred.
- **Modals.** URL-addressable through `?modal=` (`switch-plan`, `cancel`, `delete-account`, `notif-prompt`, `board-settings`), opened with `history.pushState` so Back closes them (client-data-layer §6.4). `ResponsiveDialog` (SPEC §7.1) renders `DialogContent size="md"` (560 px) at ≥ 600 px wide and `SheetContent height="90"` below.
- **Touch targets** ≥ 44 CSS px; `Segmented` items 36 px tall inside a 44 px row on phones.
- **Copy.** Product name "ReplayChess"; the domain is `playchess.tech` everywhere the boards say `replaychess.com` (inv-acct Q32). Title Case for headings and buttons, sentence case with a period for descriptions, no exclamation marks (DS "Content fundamentals").
- **Loading.** First paint is server-rendered, so a skeleton appears only during navigation (`loading.tsx`) or inside a `<Suspense>` block; spinners appear only inside buttons (client-data-layer D14).
- **Demo routes.** Every board state that real data can't reach on demand is reachable at `/dev/ui/account/{screen}?state=<enum>` (`WEB/app/dev/ui/account/[screen]/page.tsx`, fails closed outside dev per SPEC D11), rendering the real component with a fixture DTO.

### 4.1 Own profile (Overview, Games, Stats, Milestones)

- **Route.** `/@{username}` → rewrite `/u/{username}` (`WEB/app/(app)/u/[username]/page.tsx`). Tab in `?tab=overview|games|stats|milestones` (default `overview`), switched with `history.replaceState` (no RSC round trip). `/profile` → 307 to `/@{me.username}`. Games filters in the URL: `result=win|loss|draw`, `src=replay,chesscom,lichess`, `legend=1`, `q=`. Stats pool `?pool=bullet|blitz|rapid|classical|daily`.
- **Boards.** Desktop `DR/V4Profile.dc.html` (tab overview, milestones), `DR/V4ProfileGames.dc.html` (tab games), `DR/V4ProfileStats.dc.html` (tab stats); iPhone `DR/V4iPhoneProfile.dc.html`; Android `DR/V4AndroidProfile.dc.html`; iPad L `DR/V4iPadLProfile.dc.html`; iPad P `DR/V4iPadPProfile.dc.html`. Enum `default | loading | new_user | not_linked`; tab enum `overview | games | stats | milestones`.

**Layout per device**

| Device | Layout | One-viewport mechanics |
|---|---|---|
| Desktop 1440×900 / 1280×800 | Sidebar. Header block 120 px (avatar 72, eyebrow "Your profile", name, meta line `JOINED AUG 2024 · 412 GAMES · BLITZ 1184`, linked chips, [Edit profile], ⋯). `Tabs` (underline) 44 px. Tab panel grid: Overview = 2 columns (left 7/12: Rating module, Recent games; right 5/12: Strengths, Milestones strip). Games = toolbar row (search, count, Select, Filter n) + list. Stats = 2 columns (summary + W/D/L + phase bars left; Highlights + By colour right) | Header and tabs fixed; the tab panel is one `ScrollRegion`; Games list is a virtualised `role=list` inside it (`@tanstack/react-virtual` above 200 rows) |
| iPad L 1194×834 | Rail; desktop composition at reduced width; Overview right column narrows to 360 px | as desktop |
| iPad P 834×1194 | Tab bar; top bar 52 px with [Edit] and settings gear; desktop sections stacked in one column | tab panel scrolls inside its region |
| iPhone 393×852 / Android 412×915 | Top bar 44 px: logo + settings gear (→ `/settings`). Compact header: avatar 56, name, `BLITZ 1184 · 412 GAMES · CHESS.COM`, edit icon. `TabsList` scrolls horizontally. Overview: Rating module, a "See weakness profile" link row, Recent games (no Strengths or Milestones cards). Games: Result `Segmented` only (no search, filter popover or bulk). Stats: summary, phases, highlights (no By colour) | tab panel scrolls; tab bar stays (not a game screen) |

**States and transitions**

| State | Trigger | Rendering |
|---|---|---|
| `loading` | navigation into the segment | `loading.tsx` = `V3Skeletons` profile variant: header skeleton + tab skeleton, `aria-busy` |
| `default` | data present | as designed |
| `new_user` | server decides: `gamesTotal = 0` | Rating module ghost chart "Play 5 rated games to see your rating trend" with `—` values; Recent games `EmptyState size=card` "Your games appear here after you play or import them." [Play a game] → `/play`, [Import from Chess.com] → `/settings/connected`; Strengths "After 20 analysed games the coach tells you what costs you points. 0 / 20 so far." [Play your first game]; Milestones show NEXT goals only |
| `not_linked` | no `LinkedAccount` rows | header chip "Link Chess.com or Lichess" → `/settings/connected`; extra card "Bring your history · Link Chess.com or Lichess and the coach reads every game you have played there." [Link an account] |
| tab change | tab click, ←/→ | in-place swap; filter popover and ⋯ menu close; Games/Stats/Milestones data fetched on first activation (prefetched on hover/focus of the tab) |
| pool change | Segmented Bullet/Blitz/Rapid (Overview and Stats) | chart and stats swap; previous data stays dimmed (`keepPreviousData`) until the new pool arrives |
| Games: filter popover | [Filter n] | `FilterPopover` (SPEC §7.1) with removable chips, Result segmented, Source chips, "Legend positions only" checkbox, [Clear all], [Show N games] (live count from `meta.total`) |
| Games: bulk mode | [Select] (`aria-pressed`) ↔ [Done] | rows become `role=checkbox`; `Toolbar role=toolbar` "N selected" [Send to coach review] [Export PGN] [Clear]; selection held as a `Set<ref>` across filter changes |
| Games: bulk review sent | [Send to coach review] | rows flip to "Queued" optimistically; `analysis:done` updates each row; toast "N games sent for review" |
| Games: empty | 0 rows, no filters | "No games yet" (as `new_user`) |
| Games: filtered empty | 0 rows with filters | "No games match · Clear a filter to see more games." [Clear filters] |
| Games: loading more | sentinel visible | 1 `SkeletonRow` at the bottom |
| Stats: pool has < 5 games | server | "Play 5 rated games to see your stats." with zeros, for that pool only |
| Stats: phase pending | analysed games < games in pool | phase bar `—` with "Analysing 3 games…" |
| Milestones | tab | achieved (newest first) then NEXT goals with `ProgressBar` and 45 % opacity |
| Toast "Profile link copied" | ⋯ › Copy profile link | `notify.success`, copies `https://playchess.tech/@{username}` |

**Components (Phase 1 kit + P10 feature components).** `PageHeader`-like `ProfileHeader` (`features/profile/ProfileHeader.tsx`: `Avatar size=72 variant=gradient`, `Tag` chips, `Button variant=secondary` "Edit profile", `IconButton` ⋯ → `Menu`/`MenuItem`/`MenuLinkItem`), `Tabs variant=underline`, `RatingModule` (`Segmented` + `RatingChart` hand-written SVG 600×150 with peak marker, `role=img` + visually hidden table), `RecentGamesList` (6 `GameRow compact`), `StrengthsCard` (`Card`; P6 data), `MilestonesStrip` (56 px `MiniBoard` with `article-board-*` squares), `GamesToolbar` (`Input type=search`, `Button pressed`, `FilterPopover`, `RemovableChip`, `Segmented`, `ChipGroup`, `CheckboxRow`), `GameRow` (shared with P3's archive row; `features/games/GameRow.tsx`), `BulkToolbar` (`ActionBar` styling, `role=toolbar`), `StatsPanel` (`StackedBar`, `PhaseBars` with ochre band tick + tick shape, `Card`), `MilestoneList`, `EmptyState`, `SkeletonRegion`, `notify.*`.

**Interactions and keyboard.** Tabs ←/→, Home/End; Segmented ←/→; ⋯ menu Enter/↑/↓/Esc (focus returns to the button); `/` focuses Games search (fine pointer, no input focused, single-key shortcuts on, SPEC D20); Esc closes the filter popover; in bulk mode Space toggles the focused row, ⌘/Ctrl+A selects all visible; Enter opens a row; global chord `g u` → own profile.

**Copy notes.** Meta line uppercase via CSS (DS label rule). Provisional rating shows `1184?`. Imported-only player headline "CHESS.COM 1179" (§8.7). Long display names truncate with `title`. "See it as others do" opens `/@{u}?as=public`.

### 4.2 Other player, signed in (public, online, private, not found)

- **Route.** `/@{username}` (same page, `relation ≠ self`).
- **Boards.** `DR/V4ProfileOther.dc.html` (enum `public | online | private | not_found | loading`, tab enum as §4.1), `DR/V4ProfilePrivate.dc.html` (same enum, default `private`). Device layouts reuse §4.1's device composition with other-mode actions.
- **Differences from own.** Actions [Challenge] (→ `/play?tab=friend&opponent={username}`, D18; hidden for non-members, who get [Start 7-day free trial] → `/pricing`) and ⋯ (Copy profile link, Report player, Block/Unblock); the head-to-head card replaces Strengths ("You vs martin_k · 3 Wins 1 Draws 2 Losses · Last game today: you won the Opera Game position with Rd8#" [Review your last game together] → `/review/{ref}`); stat line in the third person; no bulk select; game rows open `/review/{ref}` when the viewer played that game, otherwise the read-only finished game `/game/{ref}` (inv-acct Q8; §14 Q4). Tabs read the **public** routes (same bodies a guest gets); only the h2h card, the Block/Challenge state and the presence ticket come from `GET /api/players/{u}/me`.

| State | Trigger | Rendering |
|---|---|---|
| `public` | public projection `access = full` and `me.access = full` | as designed |
| `online` | `presence:state {online:true}` after `presence:watch` | presence dot on the avatar (`title="Online now"` + sr text), "Online now · playing Blitz 5+3", [Watch live] → `/game/{ref}?spectate=1` when `activity.spectatable` |
| `private` | target `PRIVATE`, **or** the target blocked the viewer (`me.access = limited`) | header (name, rating, linked chips), no tabs; lock card "This profile is private · martin_k shares only their name and rating. Games, stats and milestones are hidden." [Challenge martin_k] (hidden when a block exists either way). The blocked case renders exactly like a private profile so the block is never revealed |
| `not_found` | no user and no `UsernameHistory` hit | eyebrow "Player", heading "No player called martin_kk", "Check the spelling, or search for the player. Usernames are not case-sensitive." `Input` pre-filled + up to 5 suggestion rows (initials, name, rating) from `GET /api/me/players/search` (members, excludes users who blocked the viewer) or `GET /api/players/search` (guests); HTTP 404 via `not-found.tsx` |
| `loading` | navigation | profile skeleton |
| renamed | `UsernameHistory` hit < 90 days | 308 to `/@{newUsername}` before render |
| Block | ⋯ › Block | optimistic: item flips to Unblock; toast "martin_k blocked. They can't challenge you or be paired with you." with [Undo] (5 s); the blocker's other tabs update through `blocks:changed` (sent only to the blocker's own room) |
| Report | ⋯ › Report player | `ResponsiveDialog` "Report martin_k": reason radiogroup (Cheating, Abuse, Inappropriate name, Other), note ≤ 500, optional game (the viewer's games against this player, from the h2h rows); [Send report] → toast "Thanks. We review every report." A repeat within 24 h answers `duplicate: true` with the same toast |

Note on blocking. Blocking is an **interaction** control (no challenge, no pairing, no presence, no h2h), not a privacy control for public data: a blocked viewer could sign out and read the same public profile, so the public routes do not try to hide it. The signed-in page renders the private card for a blocked viewer only so that the block itself stays invisible.

### 4.3 Other player, logged out (guest)

- **Route.** `/@{u}` → rewrite `/p/{u}` (`WEB/app/(public)/p/[username]/page.tsx`, ISR `revalidate = 60`, `dynamicParams = true`, `generateStaticParams() → []`).
- **Board.** `DR/V4ProfileOtherGuest.dc.html` (enum `public | private`).
- **Layout.** Marketing chrome (existing `Navbar` until P11's v3 header), no app shell, no presence. Actions row [Sign In] [Start coaching]; the h2h slot becomes "Play martin_k from a legend position · ReplayChess coaches you from your own games. Start coaching to challenge martin_k and keep your history." [Start 7-day free trial] → `/sign-up?redirect_url=/@martin_k`, [I have an account] → `/sign-in?redirect_url=/@martin_k`. `private` shows §4.2's lock card with [Start 7-day free trial].
- **Tabs.** Overview, Games (public games only, read-only rows that link to `/sign-in?redirect_url=…`), Stats, Milestones; data comes from the public routes (PLY-1…5) and the `getPublicPlayer` loader, the same bodies signed-in viewers get.
- **SEO.** `<meta name="robots" content="noindex">`, `<link rel="canonical" href="https://playchess.tech/@{u}">`, Open Graph title "{displayName} (@{u}) · ReplayChess", description "Blitz 1184 · 412 games", image `opengraph-image.tsx` (avatar or initials, name, headline rating; 1200×630; cached with the page under tag `player:{usernameKey}`, purged on visibility change, rename and deletion). Not in sitemaps.
- **Loading.** None (ISR HTML). A cold miss renders server-side once per 60 s per username.

### 4.4 Profile edit

- **Route.** `/profile/edit` (`WEB/app/(app)/profile/edit/page.tsx`), signed in, allowed for non-members. `?claim=1` (no username yet) shows a banner "Pick your profile link first" linking to Account › Username.
- **Board.** `DR/V4ProfileEdit.dc.html` (enum `default | dirty | invalid | uploading | upload_error | saving | saved | error`). No device boards: the form stacks; on phones the preview aside moves under the form.
- **Layout.** Desktop: form column (max 560 px) + preview aside (320 px: "How others see you" card and "Your clock chip in a game"); sticky footer inside the page region with the status note (`role=status`) and [Cancel] [Save]. The form column is a `ScrollRegion`; the footer never scrolls away. Phones: footer pinned above the tab bar.

| State | Entry | Footer note / UI |
|---|---|---|
| `default` | load | "No changes yet." Save disabled |
| `dirty` | any field edit, [Use initials], upload finished | "You have unsaved changes." |
| `invalid` | client zod fails | field errors (display name: "Use at least 3 characters." / "Use 24 characters or fewer." / "Letters, numbers, spaces, dots and dashes only."; bio: "Keep it to 160 characters." with red counter, "No links in your bio."); footer "Fix the highlighted fields to save."; Save disabled |
| `uploading` | file chosen and valid | `ProgressBar` "UPLOADING n%" (`role=progressbar`), Save disabled |
| `upload_error` | > 2 MB, wrong type, decode failure (HEIC), network | "That file is 4.2 MB. Use a PNG or JPG under 2 MB." / "Use a PNG or JPG." / "Upload failed. Try again."; otherwise hint "PNG or JPG, square works best, up to 2 MB." |
| `saving` | Save / ⌘S | button `loading` "Saving…" |
| `saved` | 200 | toast "Profile saved" [View profile]; footer "All changes saved."; any edit → `dirty` |
| `error` | 5xx / network | `Banner tone=bad` "Couldn't save your changes. Nothing was lost." [Try again] |

- **Fields.** Photo (upload / [Use initials]); Display name (3–24, `^[\p{L}\p{N} .\-]+$`u, counter "n / 24", hint "Shown on your profile and next to your clock."); Username read-only "Your profile link: playchess.tech/@knightowl_88 · Change in Account settings"; Bio (≤ 160, "A line about how you play. No links."); Country (`Select`: "Not shown" + ISO 3166-1 list); Who can see your games (`Segmented` Everyone | Only me).
- **Keyboard.** ⌘/Ctrl+S saves; Esc returns to the profile (confirm dialog when dirty); `beforeunload` prompt when dirty.

### 4.5 Settings shell

- **Routes.** `/settings` (`WEB/app/(app)/settings/page.tsx`), sections `/settings/{board,pieces,sounds,training,appearance,notifications,account,connected,membership}`; shell `WEB/app/(app)/settings/layout.tsx`.
- **Boards.** Desktop `DR/V4Settings.dc.html`; iPhone `DR/V4iPhoneSettings.dc.html`; Android `DR/V4AndroidSettings.dc.html`; iPad L `DR/V4iPadLSettings.dc.html`; iPad P `DR/V4iPadPSettings.dc.html`. The phone shells contain every section's compact detail, so they are the phone design for §4.6–§4.15.

| Device | `/settings` | `/settings/{section}` |
|---|---|---|
| Desktop | Two panes: section list 280 px (`nav aria-label="Settings sections"`, groups Play: Board, Pieces, Sounds and voice, Training; App: Appearance, Notifications; Account: Account, Connected accounts, Membership; each row shows a live summary) + "All settings" overview: numbered cards 01–09 with summaries and the note "Board, pieces and sound sync to your account, so a new device starts the way you like it." | list + section detail (`ScrollRegion`) |
| iPad L / iPad P | list + Board detail (client-side default selection; URL stays `/settings`) | list + detail |
| Phones | list only, headed by an avatar card (knightowl_88 · membership summary) → profile | detail only with ‹ Back (`aria-label="Back to settings"`) and the "SAVED" pill in the detail header; tab bar visible |

- **Row summaries** (computed server-side, then from `usePrefs` live): Board "Walnut · coordinates inside"; Pieces "ReplayChess · classic"; Sounds "Volume 60%" or "Muted"; Training "10 a day · 5 new · 08:00"; Appearance "Match system" / "Light" / "Dark"; Notifications "Push and email" / "Email only" / "Off" (inv-acct Q17); Account "r••••@gmail.com"; Connected "Chess.com linked" / "Both linked" / "Nothing linked"; Membership "Coaching · monthly" / "Coaching · trial" / "No membership".
- **Non-members** (D14) see only the Account group; Play and App groups are not rendered; their routes redirect to `/settings/account`.
- **Save indicator.** `role=status` pill "SAVED · SYNCED" for 2.6 s after a successful PATCH; "SAVED ON THIS DEVICE" + "Couldn't sync" [Retry] after 3 failed retries; one announcement per flush, not per keystroke.

### 4.6 Settings › Board

- **Boards.** Desktop `DR/V4SettingsBoard.dc.html`; `DR/V4iPhoneSettingsBoard.dc.html`, `DR/V4AndroidSettingsBoard.dc.html`, `DR/V4iPadLSettingsBoard.dc.html`, `DR/V4iPadPSettingsBoard.dc.html` (shells opened on Board). No state enum.
- **Layout.** Desktop and iPad L: controls column (max 520 px, `ScrollRegion`) + preview `BoardStage` to the right (`--board: min(100cqw, 100cqh)`, min 220, max 520). iPad P: preview above the controls (preview height ≤ 42 % of the detail pane). Phones: preview at the top, full width − 32 px, capped at `42dvh`; controls scroll below it; the preview never scrolls (outside the region).
- **Controls.** Theme `RadioCardGroup variant=swatch` (Graphite "ReplayChess default", Walnut "Warm, soft contrast", Sage "Muted green", High contrast "For low vision and glare"); Coordinates `Segmented` Off/Outside/Inside; Highlight last move `SwitchRow`; Show legal moves `SwitchRow` ("Dots for moves, rings for captures"); Board orientation `Segmented` Flip for Black / Always White; Move input Click/Drag/Both; Premoves Off/One/Up to 3 ("Timed games against people only"); Always promote to a queen; Tap twice to confirm a move ("Phones and tablets only"; hidden on `pointer: fine`, still synced).
- **Preview.** The Opera Game position after 9…b5 with the c4 bishop selected; caption "PREVIEW · WALNUT · COORDINATES INSIDE"; non-interactive, `role=img` with the board's aria label; updates in the same frame as the control (CSS variables).
- **States.** default + save pill; sync failure handled by §4.5.

### 4.7 Settings › Pieces

- **Board.** `DR/V4SettingsPieces.dc.html`; phone detail inside the phone shells.
- **Controls.** Piece set (ReplayChess "In use"; the two placeholders are **not rendered**, §14 Q9); Piece shadow Classic/Flat ("Flat drops the lift shadow"); Piece size Standard/Large (scale 0.92 / 1.08); Move animation Off/Fast/Normal; Show material difference (`SwitchRow`, "Captured pieces and +N beside each player"). Preview: starting position, caption "PREVIEW · CLASSIC · STANDARD". Layout as §4.6.

### 4.8 Settings › Sounds and voice

- **Board.** `DR/V4SettingsSounds.dc.html` (enum `default | autoplay_blocked | muted`).
- **Controls.** Master volume `Slider` 0–100 (`aria-valuetext` "60%" / "Off"); Board sounds; Low-time tick ("Once a second from 0:10"); Coach voice: Read coach lines aloud ("Text appears first; the voice starts after the line is verified"), Voice speed 0.9×/1×/1.2×, fixed row "Never during timed games · The coach stays silent while clocks run · Always on"; Test buttons Move, Capture, Check, Low-time tick, Game end, Coach voice sample (each with a playing indicator `aria-label="Playing"`); status note "Tap a sound to hear it at your volume." / "Playing at 60%." / "Master volume is off, so tests are silent."

| State | Detection | UI |
|---|---|---|
| `default` | context running | as above |
| `autoplay_blocked` | shared `AudioContext.state === "suspended"` or `play()` rejects `NotAllowedError` | `Banner tone=warn` "Your browser is holding sound back until you tap once on this page." [Turn sound on] → `ctx.resume()`; test buttons disabled with "Tap 'Turn sound on' first." |
| `muted` | `volume === 0` | summary "Muted"; tests silent with the note above |
| no voice | `speechSynthesis` missing or no English voice after `voiceschanged` | voice rows disabled with "Your browser has no voice for English" |

### 4.9 Settings › Appearance

- **Board.** `DR/V4SettingsAppearance.dc.html`.
- **Controls.** Theme radiogroup Light / Dark / Match system with swatches; note "Follows your device. Right now that is Light." (live `matchMedia('(prefers-color-scheme: dark)')`), "Pure black background, white accent. The board dims to about 85%.", "Warm paper background, dark-brown accent."; Comfort: Dim the board in dark mode (`SwitchRow`), Motion Match system / Reduce / Full ("Reduce turns off slides, pulses and shakes"), fixed row Text size "Follows your browser zoom · Browser"; Language `Select` English (Español and हिन्दी disabled "(later)").
- **Behaviour.** Theme → `usePrefs` → `next-themes setTheme`; Motion → `<html data-motion="system|reduce|full">`; Dim → `--board-dim: .85` under `.dark`.

### 4.10 Settings › Notifications

- **Board.** `DR/V4SettingsNotifications.dc.html` (enum `push_off | enabled | denied | ios_install`, plus local `asking`).
- **Layout.** Banner row on top, then the channel table `role=table` "Notify me about × Push × Email" (6 designed rows + `tournament_new`), then Daily training reminder (`Select` 08:00 / 13:00 / 19:00 / 21:30, "Only when you have mistakes due", with the line "In Asia/Kolkata · [Change]" → Settings › Training time zone), then Quiet hours (`SwitchRow`, "22:00 to 08:00, nothing but tournament starts"), then **Install app** (row rendered only when P11's `openInstallPrompt` export exists and P11's `usePwaInstall().eligible` is true; label "Install app", description "Get reminders on your Home Screen and open ReplayChess like an app." [Install] → `openInstallPrompt({ source: "settings_notifications" })`; coverage C-13 and `V3iPhonePwaInstall` `dismissed` copy "You can install any time from Settings · Notifications.").

| State | Detection (in order) | Banner / controls |
|---|---|---|
| `ios_install` | iOS/iPadOS and not standalone (`navigator.standalone !== true` and not `display-mode: standalone`), or `!('PushManager' in window)` on iOS | "On iPhone, install ReplayChess first. Tap Share, then Add to Home Screen, and open it from there to allow push." [Show me how] → `openInstallPrompt({ source: "notifications_ios" })` (P11's iOS steps sheet; fallback `IOSInstallModal` until P11 merges); push column disabled |
| unsupported | `!('serviceWorker' in navigator) \|\| !('PushManager' in window)` elsewhere | "This browser can't receive push. Email still works."; push column disabled |
| `denied` | `Notification.permission === "denied"` | "Your browser blocked notifications for ReplayChess. Open site settings (the icon left of the address), set Notifications to Allow, then reload." [Check again] |
| `enabled` | `granted` and `registration.pushManager.getSubscription()` non-null and known to the server | "Push is on for this browser. Other devices keep their own setting." [Send a test] |
| `push_off` | otherwise | "Push is off on this device. Turn it on to hear when a challenge or tournament starts." [Enable push] → `V3NotifPrompt` (`?modal=notif-prompt`) |
| `asking` | between `requestPermission()` and its result | "Your browser is asking for permission. Choose Allow in its prompt." |
| time-zone mismatch (modifier) | device `Intl…timeZone` ≠ `me.user.timeZone` and the stored zone is not the default `UTC` (P5 already captures the default case silently, P5:491) | `Banner tone=info` "Your device is in Europe/London. Reminders use Asia/Kolkata." [Use Europe/London] → `PATCH /api/train/prefs {timeZone}`; [Keep] dismisses for 30 days (`rc:dismissed:v1`) |

- **Rows** (`D[]` in the board, plus one): Challenges from friends "When a friend accepts your challenge link" (push on, email off); Tournament starting "Five minutes before a tournament you joined" (on, on); **New tournaments** "When a new arena is announced" (off, off; row `id="tournament_new"`, not in the board: owner sign-off §14 Q22); Your review is ready "The coach finished a long game" (on, off); Mistakes due today "At your reminder time" (on, off); Weekly progress "Sunday summary of your games" (off, on); Product news "New legends and features, about once a month" (off, off). **Both tournament rows render only when `flag('tournaments-v3')` is on** (P12 lights them; coverage C-24). Push switches are `aria-disabled` with the reason via `aria-describedby` unless `enabled`. Switch labels "{row} by push" / "{row} by email". A deep link `#tournament_new` scrolls the row into view inside the `ScrollRegion` and focuses its push switch.
- **Toast** "Test sent. It should arrive in a few seconds."

### 4.11 Notification pre-permission prompt

- **Board.** `DR/V3NotifPrompt.dc.html` (enum `ask | waiting | granted | denied | ios_install_first`).
- **Route.** Overlay `?modal=notif-prompt` (`ResponsiveDialog size="sm"` 440 px; sheet on phones). Entry points: Settings › Notifications [Enable push]; once after the first review completes or the first bank add (at most once per 30 days after "Not now", `localStorage rc:dismissed:v1`); challenge share waiting "Tell me when they join" (P9 slot, flag-gated).

| State | UI | Next |
|---|---|---|
| `ask` | "Get a Nudge When Mistakes Are Due" · "One reminder a day at most, plus the things you pick. Your browser asks for permission next." Preview notification "ReplayChess · 19:00 / 6 mistakes are due. About 4 minutes." (`aria-hidden`, repeated as text). Toggles Daily training reminder "Every day at 19:00" (on), Challenges from friends (on), Tournament starts (off; hidden until P12). [Not now] [Turn on] | [Turn on] → `waiting` |
| `waiting` | button "Waiting for your browser…" (`aria-busy`), hint "Choose Allow in the box your browser just opened, near the address bar." | granted → subscribe → `granted`; denied → `denied`; dismissed → `ask` |
| `granted` | dialog closes; toast "Reminders are on. Next one today at 19:00." [Change] → `/settings/notifications` | — |
| `denied` | "Notifications Are Blocked" + 3 steps; [Done] [I've allowed them] (re-checks permission → silent subscribe if granted) | — |
| `ios_install_first` | "Install the App First · On iPhone and iPad, Safari only sends reminders to apps on your Home Screen. It takes three taps." [Not now] [Show me how] → `openInstallPrompt({ source: "notif_prompt" })` (P11; fallback `IOSInstallModal`) | — |

The prompt's toggles write `prefs.notifications.channels.{mistakes_due,challenge,tournament_start}.push` in the same flush as the subscription.

### 4.12 Settings › Account

- **Board.** `DR/V4SettingsAccount.dc.html` (enum `default | verifying_email | exporting | error`).
- **Sections.** Sign-in: Email (masked, [Change] → inline `verifying_email` group: "We sent a 6-digit code to rohit.p@fastmail.com. Your old address keeps working until you confirm." code input `inputmode=numeric autocomplete=one-time-code` [Confirm] [Resend in 0:45]); Password ("Last changed March 2026" when Clerk exposes it, [Change password] dialog or [Set a password] for Google-only users); Google ("Signed in with r••••@gmail.com · Connected", read-only). Identity: Username ("playchess.tech/@knightowl_88 · you can change it once every 30 days" [Change] → inline field with live availability); Display name and photo → `/profile/edit`; Who can see your games Everyone / Only me ("Private keeps your name and rating visible"). **Privacy** (new group, rendered only when P11's `openCookieSettings` export exists and `NEXT_PUBLIC_CONSENT_BAR=on`; coverage C-13): "Cookie settings · Choose which analytics and replay cookies we may use." [Open] → `openCookieSettings()`. Your data: Download your data ("Games as PGN, reviews and settings as JSON" [Request export]); Delete account ("Removes your games, Mistake Bank and linked accounts" → `?modal=delete-account`).

| State | Trigger | UI |
|---|---|---|
| `default` | load | as above |
| `verifying_email` | [Change] + valid new email | code group; resend countdown 45 s (`aria-live=off`, one announcement when ready); success toast "Email changed to …"; errors inline "That email is already used by another account." / "That code didn't work. Check it or resend." |
| `exporting` | `DataExportJob.status ∈ {QUEUED, RUNNING}` | button "Preparing…" disabled; note "Preparing a ZIP of your games (PGN) and settings. We will email a link within an hour." When `READY`: "Your export is ready · Download (expires 9 Nov)" |
| `error` | username PATCH 409 race | `Banner tone=bad role=alert` "Couldn't update your username. That name was taken a moment ago." |
| username field | typing | debounced 300 ms availability: "Available" (good) / "Taken" / "Reserved" / "3–20 letters, numbers or underscores" / cooldown "You can change it again on 2 Dec" |

### 4.13 Delete account modal

- **Board.** `DR/V4DeleteAccount.dc.html` (enum `default | active_sub | typed | deleting | error | deleted`), over the Account page; `?modal=delete-account`.
- **Content.** Eyebrow "Can't be undone"; title "Delete your account?"; body "This deletes knightowl_88 and everything in it:" + live counts "412 games and their coach reviews", "41 positions in your Mistake Bank and your weakness profile", "Links to Chess.com and Lichess (your accounts there are untouched)"; link "Download your data first" → closes the modal and focuses Request export; confirm field "Type knightowl_88 to confirm" with hint states "Case-sensitive, exactly as shown." → "Doesn't match yet. It is case-sensitive." → "Matches. The button is now active." (`aria-live=polite`); [Keep my account] [Delete account] (danger, disabled until the text matches).

| State | Trigger | UI |
|---|---|---|
| `default` | open, preview loaded, no active membership | as above |
| `active_sub` | `preview.membership.active` | `Banner tone=warn` "Your membership is active. Deleting cancels it at once, with no refund for the rest of this month." (trial: "Your trial ends now and you won't be charged.") + link to Membership |
| blocked (variant of `default`) | `preview.blockers` non-empty | `Banner tone=bad`: `in_game` "Finish or resign your game first."; `last_admin` "You are the last admin. Make someone else an admin first."; `hosting_tournament` "You host an upcoming tournament. Cancel it or hand it over first."; Delete disabled |
| `typed` | exact match | hint "Matches…", button enabled |
| `deleting` | submit (after Clerk reverification) | button `loading` "Deleting…"; Esc disabled |
| `error` | 5xx / network | `Banner tone=bad` "Something went wrong and nothing was deleted. Try again, or contact support." [Try again] |
| `deleted` | 200 | title "Account deleted", "Your account is deleted. We have emailed a confirmation to r••••@gmail.com. Backups clear within 30 days." [Go to ReplayChess] → `/` (after `signOutEverywhere()`); also rendered by `/?account=deleted` |

- **A11y.** `role=dialog aria-modal`; focus starts in the input; Esc closes unless deleting; destructive button text "Delete account".

### 4.14 Settings › Connected accounts (adopted)

- **Boards.** `DR/V4SettingsConnected.dc.html`, `DR/V4SettingsConnectedError.dc.html` belong to **P4** (allocation row 238–239). P10 moves P4's page component into the shell route `WEB/app/(app)/settings/connected/page.tsx` (P4's `features/accounts/*` components unchanged) and supplies the list summary. No new states.

### 4.15 Membership page

- **Route.** `/settings/membership` (`/membership` 308 → here). Reachable by every signed-in user.
- **Boards.** Desktop `DR/V4Membership.dc.html` (active), `DR/V4MembershipTrial.dc.html`, `DR/V4MembershipCancelling.dc.html`, `DR/V4MembershipPastDue.dc.html`, `DR/V4MembershipFree.dc.html`; `DR/V4iPhoneMembership.dc.html`, `DR/V4AndroidMembership.dc.html`, `DR/V4iPadLMembership.dc.html`, `DR/V4iPadPMembership.dc.html`. Enum `active | active_yearly | trial | cancelling | switching | past_due | legacy | expired | free | loading | error | trial_cancelled`; P10 adds `paused`.
- **Layout.** Desktop / iPad L: detail pane with two columns — left: "Your plan" card (plan name · line · sub · pill · actions; trial progress strip; past-due alert) and "Included in your membership" list; right: Billing card ([Manage billing ↗], card line + [Update], invoices `role=table`). iPad P and phones: one column, plan card first; modals become sheets.

| State | Plan · line / sub | Pill | Actions |
|---|---|---|---|
| `active` | Coaching · "$4.99 a month" / "Renews on 12 Nov 2026" | Active (good) | [Switch to yearly · save 16%] (→ `?modal=switch-plan&to=yearly`) · [Manage billing] · [Cancel membership] (→ `?modal=cancel`) |
| `active_yearly` | Coaching · yearly · "$50 a year" / "Renews on 30 Oct 2027" | Active | [Switch to monthly] · [Manage billing] · [Cancel membership] |
| `trial` | "Trial · 5 days left · first charge $4.99 on 21 Oct" / "Cancel before 21 Oct and you won't be charged. One free trial per person." + strip "DAY 3 OF 7 · FIRST CHARGE 21 OCT" (`role=progressbar` "Day 3 of 7") | Trial (warn) | [Switch to yearly · save 16%] · [Manage billing] · [Cancel trial] |
| `trial_cancelled` | "Your trial ends on 21 Oct" / "You won't be charged. Everything works until then." | Trial ends 21 Oct | [Keep my trial] (resume; toast "Trial kept. First charge $4.99 on 21 Oct.") · [Manage billing] |
| `cancelling` | "Ends on 12 Nov 2026" / "You cancelled on 30 Oct. Everything stays until then; nothing more is charged." | Cancels 12 Nov | [Resume membership] (toast "Membership resumed. Renews 12 Nov.") · [Manage billing] |
| `switching` | Coaching · yearly · "$50 a year until 30 Oct 2027" / "Then $4.99 a month. The switch happens at renewal." | Switching | [Keep yearly] (`DELETE /api/subscription/change-plan`; toast "You stay on yearly") · [Manage billing] |
| `past_due` | "Payment issue" / "Access until 12 Nov 2026 while we retry" + `Banner tone=bad` "Your card was declined on 12 Oct. We're retrying it. You keep your membership until 12 Nov." (retry date only if known, inv-acct Q22) | Payment issue (bad) | [Update payment] (→ Dodo payment link) · [Get support] → `/contact` |
| `legacy` | Original plan · "$8 a month, billed monthly" / "Renews on 12 Nov 2026 · grandfathered, no change unless you ask" | Active | [Move to Coaching at $4.99] (switch modal with both targets) · [Manage billing] · [Cancel membership] |
| `expired` | Coaching · "Ended on 12 Oct 2026" / "Your free trial has been used. Your games, reviews and Mistake Bank are all still here" | Ended | [Renew · $4.99 a month] → `/pricing?reason=ended` · [Billing history] (portal) |
| `free` | No membership · "Checkout not finished" / "Start your 7-day free trial to analyse your games" | Inactive | [Start 7-day free trial] → `/pricing` · [See what's included] |
| `paused` (new) | scheduled: "Pause starts 12 Nov · resumes 12 Dec" / "Everything works until 12 Nov. No charge in November."; active: "Paused until 12 Dec" / "No charge in November. Everything resumes on 12 Dec. Your games and Mistake Bank stay as they are." | Paused (warn) | scheduled: [Cancel pause]; active: [Resume now] · [Manage billing] |
| `loading` | `SkeletonRegion` plan card (only during navigation) | — | — |
| `error` | `Banner tone=bad` "Couldn't load your membership. Request failed. Your plan is not affected." | — | [Try again] |

- **Included list.** Paid states "Included in your membership" with ✓; `free`/`expired` "Your membership includes" with +: "Analysis of your Chess.com and Lichess games", "Your Weakness Profile and recurring mistakes", "Daily puzzles built from your mistakes", "Coach questions (fair use), lessons and tournaments" (inv-acct Q23, Q33).
- **Billing card.** For paid, paused and expired states. Card line "Visa ending 4242 · expires 08/28" (past due: "· declined"), sub "Card on file with Dodo Payments", [Update] (= Update payment); invoices table (date, description, amount, status Paid/Failed/No charge/Refunded; each row links to the invoice PDF). Trial: single row "14 Oct 2026 · Trial started · card saved · $0.00 · No charge". Its own skeleton while `GET /api/billing/details` loads; degraded: "Billing details are taking a while. [Open billing portal]".
- **Admin note.** `role=ADMIN` without subscription shows `free` + muted "Admin access doesn't need a membership". `BILLING_PAYWALL=off` shows a dev `Banner tone=info`.
- **Return query params.** `?payment=updated` (from Dodo update link) → toast "Thanks. We're checking your payment." + fallback refresh; `?modal=switch-plan&step=done` (after a 3DS payment link) → modal `done` with refresh.

### 4.16 Switch plan modal

- **Board.** `DR/V4PlanSwitch.dc.html` (enum `preview | loading_preview | preview_unavailable | downgrade | same_plan | confirming | error | done | trial`). `?modal=switch-plan&to=yearly|monthly`.
- **Content.** Eyebrow "Membership", title "Switch your plan" (done: "Switched to yearly"); plan radiogroup Monthly "Billed every month, cancel any time · $4.99 / mo", Yearly "Save 16% · works out at $4.17 a month · $50 / yr" with "Current" tag; amount live region `aria-live=polite`; footer [Keep current plan].

| State | When | Body | CTA |
|---|---|---|---|
| `loading_preview` | upgrade selected, preview pending | "Working out what you would pay today…" (`aria-busy`) | disabled |
| `preview` | preview 200 | "Due today $47.84"; lines "Coaching · yearly $50.00", "Unused monthly time, 13 days −$2.16", "Total today $47.84"; "The switch happens now. Next renewal 30 Oct 2027 at $50. Prices include tax where it applies." | [Confirm and pay $47.84] |
| `trial` | `trial.active` | "Nothing to pay today · Your trial continues. On 21 Oct you pay $50 for the year instead of $4.99 a month. Cancel before 21 Oct and you won't be charged at all." | [Switch to yearly] |
| `downgrade` | yearly → monthly | "Nothing to pay today · You stay on yearly until 30 Oct 2027, then pay $4.99 a month. You can undo this any time before that date." (no preview call) | [Switch at renewal] |
| `preview_unavailable` | preview 5xx / timeout | "Preview unavailable. We couldn't get an exact amount from our payment provider. You will be charged $50 minus your unused monthly time, about $2. The receipt shows the exact figure." (estimate §8.3) | [Confirm switch] |
| `same_plan` | current plan picked | "That is your current plan. Pick the other one to see the difference." | disabled |
| `confirming` | submit | "Switching…" | loading |
| `error` | 4xx/5xx | "The switch didn't go through. You are still on monthly and nothing was charged." (409 `payment_declined`, Dodo's decline message passed through) [Try again]; 402 `payment_update_required`: "Update your payment method before changing plans." [Update payment] | — |
| `done` | 200 | "You are on yearly now." + "We charged $47.84 to Visa ending 4242 and emailed the receipt. Next renewal 30 Oct 2027." (trial: "Nothing was charged today…") | [Done] |

- **Hidden** in `cancelling`, `trial_cancelled`, `past_due`, `paused` (inv-acct Q24).

### 4.17 Cancel membership modal

- **Board.** `DR/V4CancelSub.dc.html` (enum `offer | reason | submitting | error | done | paused | trial_offer | trial_done`). `?modal=cancel&step=offer|reason`.

| State | Content | Actions |
|---|---|---|
| `offer` (Step 1 of 2, paid) | "Before you cancel" · "If you cancel, your membership stays until 12 Nov. After that your games and 41 saved mistakes stay, but new games aren't analysed and puzzles and the coach stop." Offer A "Pause for a month · No charge in November. Everything resumes on 12 Dec." [Pause instead]; Offer B (monthly and legacy only) "Yearly at $4.17 a month · $50 for the year, 16% less than monthly." [Switch to yearly] → switch modal | [Continue to cancel] · [Keep Membership] |
| `trial_offer` | "Cancel your trial?" · "Your trial ends on 21 Oct. You won't be charged. Your games and saved mistakes stay in your account. This is your one free trial, so you can't start another." | [Continue to cancel] · [Keep my trial] |
| `reason` (Step 2 of 2) | "What is the main reason? Required" radiogroup (8 values = `CANCELLATION_FEEDBACK_VALUES`, `subscription-action-rules.ts:15-38`, same order); "Anything we should know? Optional" textarea ≤ 1000; keep note "You keep your membership until 12 Nov 2026. No refund for the current month; nothing more is charged." (trial: "Your trial ends on 21 Oct. You won't be charged.") | [Confirm cancel] (disabled until a reason) · [Keep Membership] |
| `submitting` | "Cancelling…" | — |
| `error` | "Request failed. You are still a member and nothing changed." | [Try again] |
| `done` | "Membership cancelled" · "Your membership ends on 12 Nov 2026. Until then everything works as before. You can resume with one tap from Membership." | [Back to membership] |
| `trial_done` | "Trial cancelled" · "Your trial ends on 21 Oct. You won't be charged. Until then everything works as before. Your one free trial is used; you can start a paid membership any time." | [Back to membership] |
| `paused` | "Membership paused" · "Paused until 12 Dec. No charge in November. Your bank and history stay as they are." | [Back to membership] |

- Pause offer hidden when `pauseEligible = false` (paused in the last 12 months, past due, legacy with an unknown product). Step heading receives focus on step change; required radiogroup has `aria-required`.

### 4.18 Settings › Training (no board; kit-built, owner sign-off §14 Q21)

P5 (P5:108) and P6 (P6:102) hand their settings to P10, and no `V4Settings*` board has a Training section (coverage C-12). P10 builds it from the Phase 1 kit with the Sounds section's layout (controls column, no preview), so nothing new is designed; the owner signs off the copy below.

- **Route.** `/settings/training` (`WEB/app/(app)/settings/training/page.tsx`), Play group after Sounds and voice; "All settings" overview card 04 (the later cards renumber to 09). Members only (D14); hidden while P5's `train` flag is off.
- **Row summary.** "10 a day · 5 new · 08:00".
- **Controls, group "Daily Mistake Bank"** (P5 `TrainingProfile` columns, written by P5's `PATCH /api/train/prefs`, D15):

| Control | Kit component | Values (default) | Copy |
|---|---|---|---|
| Positions per day | `Slider` step 5 | 5–30 (10) | "How many saved mistakes your daily session asks for." `aria-valuetext` "10 a day" |
| New positions per day | `Segmented` | 0 / 3 / 5 / 10 (5); options above the per-day value are disabled | "New mistakes join slowly so reviews don't pile up." |
| New batch arrives at | `Select` | 06:00 … 12:00 hourly (08:00) | "Cards that are due tomorrow become available at this time." |
| Your day starts at | `Select` | 00:00 … 06:00 (04:00) | "Practice after midnight counts for the previous day until then." |
| Grade for me | `SwitchRow` | off | "Applies the suggested grade after each puzzle. You can still change it." |
| Time zone | `Combobox` (IANA list grouped by UTC offset, searchable) | `User.timeZone` | "Used for your daily batch, streak and reminders." Quick action [Use this device's zone (Europe/London)] when they differ |

- **Controls, group "Weakness profile"** (P6 scope; rendered when the `weakness` flag is on): Time controls `ChipGroup` Bullet / Blitz / Rapid / Classical (≥ 1 selected); Look back `Segmented` 3 / 6 / 12 months; status line from `qk.train.weakness().scopeLabel` ("Uses 212 games · rapid and blitz · since Aug 2026"); [Update Profile] (enabled only when the selection differs; the change triggers a recompute, so it is an explicit button, not autosave).
- **Saving.** Daily-bank controls autosave like the other sections: 400 ms debounce per control → `useMutation(PATCH /api/train/prefs)` optimistic on `qk.train.prefs()`, the shell's "SAVED · SYNCED" pill, rollback and "Couldn't save · [Retry]" on error. [Update Profile] → `POST /api/train/weakness/recompute {timeClasses, months}` (P6 TR-12) → note "Saved. Your weakness profile is updating." and `invalidateQueries(qk.train.weakness())`; 429 → `RateLimitedInline` "You can change this again in 7 minutes." (P6's 1 per 600 s bucket).

| State | Trigger | UI |
|---|---|---|
| default | load (RSC seeds `qk.train.prefs()` with one `training_profiles` PK read) | as above |
| saving / saved / error | autosave | shell save pill (§4.5) |
| scope_updating | TR-12 202 | note under the group; P6's `weakness:progress` events update the Train hub, not this page |
| scope_limited | TR-12 429 | inline countdown, button disabled |
| invalid | new per day > per day (only reachable through a stale tab) | server 400 `validation_failed` → field message "Use no more than {cap}." |

- **Keyboard.** Standard kit behaviour; Slider ←/→ by 5; Combobox type-ahead.
- **Effects elsewhere.** Changing the time zone also recomputes the reminder columns (§8.10) inside P5's W8 transaction (WP2 adds that call to P5's route) and emits `profile:updated {fields:["timeZone"]}`; changing the release hour applies to cards graded from now on (P5's snapping, P5 §8.5), existing due dates are not moved.

### 4.19 In-game Board settings sheet (no board; reuses §4.6 controls)

- **Entry.** P2's `GameMenu` item "Board settings" (P2:374), shown when `account-v3` is on (coverage C-16). Opens `?modal=board-settings` on `/game/[ref]` with `history.pushState` (Back closes it). The game never unmounts (D19).
- **Layout.** Desktop and iPad L: a **non-modal** right-side `Sheet` (360 px, `role="dialog" aria-modal="false"`), so the live board stays visible and playable and acts as the preview. iPad P and phones: a modal bottom sheet (`SheetContent height="60"`) that leaves the top of the board visible; in a timed game where it is the viewer's move, a line "Your clock is running." sits under the title.
- **Controls.** The §4.6 and §4.7 controls that make sense mid-game: Theme, Coordinates, Highlight last move, Show legal moves, Move input, Premoves, Always promote to a queen, Tap twice to confirm (coarse pointer only), Move animation, Show material difference, Master volume, Board sounds, Low-time tick. Orientation is left out (the menu already has "Flip board").
- **Footer.** After the game, or for spectators: [All settings] → `/settings/board`. During a live game played by the viewer: "More settings are in Settings after your game." (no link).
- **Data.** The same `usePrefs` path as §4.6 (same-frame CSS variables, debounced PATCH, BroadcastChannel); no new endpoint.
- **Telemetry.** `settings_section_opened {section:"board", from:"game"}`; `settings_changed` as usual.

---

## 5. UI ↔ API data flow

Conventions inherited from client-data-layer.md: RSC first paint through `lib/data/*` (server-only DAL) and `HydrationBoundary`; TanStack Query v5 for client reads with keys from `WEB/lib/api/keys/*`; mutations through `api()` + `useMutation`; socket `user:{ref}` events patch the cache (`setQueryData`) or mark it stale; polling only as a socket-down fallback with `fallbackInterval()`; global error reactions in `reactToApiError()` (401 session modal, 402 paywall by code, 429 countdown, 503 maintenance, 5xx toast with request id).

### 5.1 Query keys added in P10 (`WEB/lib/api/keys/account.ts`, owned by WP0)

```ts
// additions to the client-data-layer §3.3 qk tree
players: {
  public: (u: string) => ["players", u.toLowerCase()] as const,                       // PLY-1: header + overview, public body
  viewer: (u: string) => ["players", u.toLowerCase(), "me"] as const,                 // PLY-7: relation, blocked, canChallenge, ticket, h2h
  ratingHistory: (u: string, pool: Pool) => ["players", u.toLowerCase(), "ratings", pool] as const,
  games: (u: string, f: PlayerGamesFilter) => ["players", u.toLowerCase(), "games", norm(f)] as const,
  stats: (u: string, pool: Pool) => ["players", u.toLowerCase(), "stats", pool] as const,
  milestones: (u: string) => ["players", u.toLowerCase(), "milestones"] as const,
  search: (q: string, scope: "public" | "member") => ["players", "search", scope, q] as const,
},
mine: {                                                                               // own profile tabs (all sources, private ok)
  ratingHistory: (pool: Pool) => ["mine", "ratings", pool] as const,
  stats: (pool: Pool) => ["mine", "stats", pool] as const,
  milestones: () => ["mine", "milestones"] as const,
},
profile: { mine: () => ["profile", "mine"] as const },                              // GET /api/me/profile (edit form)
usernames: { availability: (u: string) => ["usernames", "availability", u.toLowerCase()] as const },
prefs: () => ["prefs"] as const,                                                     // server copy only; usePrefs is the live store
train: { prefs: () => ["train", "prefs"] as const },                                 // P5 TrainingProfile prefs (Settings › Training)
push: { subscriptions: () => ["push", "subscriptions"] as const },
billing: {
  membership: () => ["billing", "membership"] as const,                              // exists
  details: () => ["billing", "details"] as const,
  preview: (plan: PlanKey) => ["billing", "preview", plan] as const,                 // exists
},
account: {
  exportStatus: () => ["account", "export"] as const,
  deletionPreview: () => ["account", "deletion-preview"] as const,
},
```

The own Games tab reuses P3's `qk.games.list(f)` (`GET /api/me/games`, with P10's `src` and `legend` filters added to `GamesQuery`) whenever the viewer may read the archive (member, or lapsed with `LAPSED_READ`); otherwise it falls back to the public `qk.players.games(self, f)`.

| Key | Endpoint | `staleTime` | gcTime | Focus refetch | Realtime updater |
|---|---|---|---|---|---|
| `players.public(u)` | `GET /api/players/{u}` (public, CDN 60 s) | 60 s | 10 min | yes | `profile:updated` (self) → stale |
| `players.viewer(u)` | `GET /api/players/{u}/me` (`no-store`) | 60 s | 5 min | yes | `blocks:changed` (own room) → patch `blocked`; reconnect → stale |
| `players.ratingHistory(u,pool)` | `GET /api/players/{u}/rating-history?pool` | 10 min | 30 min | no | — |
| `players.games(u,f)` (infinite) | `GET /api/players/{u}/games?…&cursor&limit=30` | 60 s | 5 min | no | — (public data; other people's analysis events never reach this tab) |
| `players.stats(u,pool)` | `GET /api/players/{u}/stats?pool` | 10 min | 30 min | no | — |
| `players.milestones(u)` | `GET /api/players/{u}/milestones` | 10 min | 30 min | no | — |
| `players.search(q,"public")` | `GET /api/players/search?q&limit=5` | 5 min | 5 min | no | — |
| `players.search(q,"member")` | `GET /api/me/players/search?q&limit=5` | 60 s | 5 min | no | — |
| `mine.ratingHistory(pool)` | `GET /api/me/rating-history?pool` | 10 min | 30 min | no | `analysis:done`/`game:result` (self) → stale, throttled 30 s |
| `mine.stats(pool)` | `GET /api/me/stats?pool` | 10 min | 30 min | no | `analysis:done`, `analysis:batch` → stale, throttled 30 s (AP-10) |
| `mine.milestones()` | `GET /api/me/milestones` | 10 min | 30 min | no | `milestone:awarded` → stale |
| `games.list(f)` (P3) | `GET /api/me/games` | 60 s | 5 min | yes | P3's handlers; P10 adds nothing |
| `profile.mine()` | `GET /api/me/profile` | ∞ (seeded) | 5 min | no | `profile:updated` → refetch |
| `usernames.availability(u)` | `GET /api/usernames/availability?u` | 30 s | 1 min | no | — |
| `prefs()` | `GET /api/me/preferences` (`private-etag`, ETag = version) | ∞ | ∞ | no | `prefs:updated {version}` → fetch **only** if `version > usePrefs.version` |
| `train.prefs()` | seeded by the RSC; written by `PATCH /api/train/prefs` | ∞ | 5 min | no | — |
| `push.subscriptions()` | `GET /api/me/push-subscriptions` | 60 s | 5 min | no | — |
| `billing.membership()` | `GET /api/billing/membership` (`private-etag`) | 5 min | 10 min | yes | `entitlement:changed` → invalidate (a 304 costs 1 statement) |
| `billing.details()` | `GET /api/billing/details` | 5 min | 10 min | no | `entitlement:changed {cause ∈ payment_*}` → stale |
| `billing.preview(plan)` | `POST /api/subscription/change-plan/preview` (read-only, used as a query) | 60 s | 2 min | no | — |
| `account.exportStatus()` | `GET /api/me/export` (`private-etag`) | 0 | 5 min | yes | `export:ready` → `setQueryData({status:"ready"…})` |
| `account.deletionPreview()` | `GET /api/me/deletion-preview` | 0 | 0 | no | — |

All realtime updaters above live in `WEB/lib/realtime/handlers/{prefs,profile,membership,account,milestones,blocks}.ts`. Handlers that react to bursty worker events (`analysis:*`) go through `invalidateThrottled(key, 30_000)` with a trailing edge, and only mark data stale while the tab is hidden (api-perf AP-10).

### 5.2 Screen-by-screen data flow

#### Own / other / private profile (`/u/[username]`)

| Step | What happens |
|---|---|
| First paint (RSC, dynamic) | `page.tsx`: `viewer = await getViewer()` (cached) → `getPlayerPage(viewer, username, tab)` in `WEB/lib/data/players.ts`. **Other player:** (1) `getPublicPlayer(usernameKey)` = `unstable_cache(loadPublicPlayer, ["player-public", usernameKey], { tags: ["player:"+usernameKey], revalidate: 60 })` (0 DB on a hit; on a miss one header statement then one `Promise.all` of ratings, recent 6 Replay games, linked accounts, strengths, milestones top 4); a miss on the header runs the `UsernameHistory` lookup → `permanentRedirect`; (2) **one** live per-viewer statement: block `EXISTS` both ways + the h2h aggregate over the viewer's `game_players` rows with `"opponentUserId" = $target` (P9's `game_players_h2h_idx`) + `canChallenge`; then the presence ticket is signed in memory when `access = full`. **Own profile:** live DAL (all sources, private allowed): header + `Promise.all` (ratings, recent 6, linked, strengths, milestones). Both: the **entry tab's** data when `?tab ≠ overview`, default pool = most rated games in 90 days (fallback blitz) with its rating history. `qc.setQueryData` into `qk.players.public(u)` + `qk.players.viewer(u)` (other) or the `mine.*` keys (own); `HydrationBoundary` |
| Streaming | Header + tabs awaited; Overview's Strengths and Milestones blocks are `<Suspense>` blocks with their own `HydrationBoundary` |
| Tab switch | `history.replaceState(?tab=)`; `useQuery` on the tab's key (other: `players.games/stats/milestones`, own: `games.list` / `mine.stats` / `mine.milestones`), prefetched on `pointerenter`/`focus` of the tab trigger (`qc.prefetchQuery`, only on intent) |
| Pool switch | `useQuery(players.ratingHistory(u, pool))` or `mine.ratingHistory(pool)` with `placeholderData: keepPreviousData`; Stats pool likewise |
| Games filters | URL is the state (`useUrlState`); `useInfiniteQuery`, `getNextPageParam: p => p.meta.nextCursor`, `maxPages: 10`; search debounced 250 ms, `enabled: q.length === 0 \|\| q.length >= 2`, aborted by `signal`; `keepPreviousData` dims rows (`aria-busy`) and shows the region `Hairline` after 200 ms. The total ("412 games") comes from page 1's `meta.total`; later pages carry only `nextCursor` (AP-38). The filter popover's live count uses `limit=0` |
| Bulk review | `useMutation(POST /api/me/games/review-batch)`: `onMutate` patches selected rows `analysisStatus: "queued"` in every cached `games.list` page; `onError` restores the snapshot; `onSuccess` patches `skipped` rows back; rows move to done on `analysis:done` (bulk jobs run at `JOB_PRIORITY.REVIEW_BATCH`, below the band that emits per-ply progress, AP-10). `Idempotency-Key` per click. 402 → paywall via `reactToApiError` |
| Export PGN | Plain navigation `GET /api/me/games/export.pgn?refs=…` (≤ 500) or `?all=1`, through a hidden `<a download>`; `private, no-store`; no query cache |
| Presence | `usePresence([targetRef], ticket)` (`features/profile/usePresence.ts`) → socket `presence:watch {targets:[{userRef, ticket}]}` (ack `{ok, states}`), `presence:state` → local state; `presence:unwatch` on unmount; a ticket older than 9 min is refreshed by refetching `players.viewer(u)`. Never server-rendered; no HTTP polling |
| Block / unblock | `useMutation(POST /api/me/blocks {username})` / `DELETE /api/me/blocks/{username}`: optimistic flip of `players.viewer(u).blocked`, rollback + toast on error; `onSettled` stale `players.viewer(u)` |
| Report | `useMutation(POST /api/reports {targetType:"user"\|"game", …})` (P5's handler), not optimistic; 429 → inline countdown in the dialog |
| Copy link | `navigator.clipboard.writeText`; no request |
| Errors | `not_found` → `notFound()` (custom not-found with search: `players.search(q, scope)`); private or blocked-by-target → 200 limited projection; public tab endpoints for a private target → 403 `forbidden {reason:"profile_private"}` → lock card; 5xx on a tab → `ErrorState inline` with Retry; 401 inside a signed-in page → session modal |

#### Guest profile (`/p/[username]`, ISR)

| Step | What happens |
|---|---|
| First paint | ISR page reads the same `getPublicPlayer(usernameKey)` loader (tag `player:{usernameKey}`, 60 s). HTML on the CDN; 0 functions on a hit. A not-found username renders `notFound()` and is cached for the same 60 s, so probing costs at most one render per name per minute (P1's edge limiter covers floods) |
| Tabs | Client islands fetch the public `GET /api/players/{u}/games`, `…/stats`, `…/milestones` and `…/rating-history` (`auth:"public"`, `public-static`: `Cache-Control: public, max-age=0, must-revalidate`, `Vercel-CDN-Cache-Control: public, s-maxage=60, stale-while-revalidate=300`, `Vercel-Cache-Tag: player:{usernameKey}`). The middleware skips Clerk for these GETs, so no handshake cookie can be attached; repeated tab views are CDN hits |
| CTAs | links only (`/sign-up?redirect_url=/@{u}`) |

#### Profile edit (`/profile/edit`)

| Step | What happens |
|---|---|
| First paint | RSC `getMyProfile(viewer)` → `qc.setQueryData(qk.profile.mine())` |
| Validation | client checks with the rule functions in `CT/http/profile.rules.ts` on change (debounced 150 ms; no zod in the bundle, AP-12); the server parses `UpdateProfileBody`, built from the same constants |
| Avatar | (1) file picked → client check type ∈ png/jpeg/webp and ≤ 2 MB → `createImageBitmap` → canvas 256×256 cover crop → `toBlob("image/webp", 0.86)` (fallback JPEG) ≈ 20–40 KB; (2) `POST /api/me/avatar/upload-url {contentType, bytes}` → `{uploadUrl, key, publicUrl, headers, expiresAt}`; (3) `XMLHttpRequest PUT uploadUrl` with the signed headers, `upload.onprogress` → `uploading n%`; (4) on 200 → form state `avatar: {kind:"upload", key}` → `dirty`; failures → `upload_error`. No query cache |
| Save | `useMutation(PATCH /api/me/profile)` — **not optimistic** (explicit "Saving…"). `onSuccess`: `setQueryData(qk.profile.mine(), data)`, patch `qk.me()` user fields (`displayName`, `avatarUrl`, `initials`), stale `qk.players.public(username)`; the server emits `profile:updated` to other tabs/devices in `after()` and purges `player:{usernameKey}` (`revalidateTag` + `invalidateByTag`) |
| Errors | 400 `validation_failed` → field errors from `details.issues`; 5xx → `error` banner; 401 → session modal (form state kept in `sessionStorage rc.draft./profile/edit`) |

#### Settings shell and Board / Pieces / Sounds / Appearance / Training

| Step | What happens |
|---|---|
| First paint | `settings/layout.tsx` (RSC): `getSettingsShellData(viewer)` = **0 extra statements** beyond `getMe()`, whose CTE already reads `user_settings`, linked-account status and the entitlement columns (P1/P4). Returns `{ prefs, prefsVersion, emailMasked, linked: [{provider, status}], membershipSummary, timeZone }`. `membershipSummary` comes from `deriveMembershipView()` on the viewer row (pure). `/settings/training` adds one `training_profiles` PK read |
| Store seeding | `PrefsBootstrap` (rendered by `(app)/layout.tsx`; the one-line insertion is handed to P11's WP0, which owns that file during P10∥P11) inlines `{v, prefs}` **only when** cookie `rc_pv` ≠ server `prefsVersion` (≤ 4 KB, otherwise 60 bytes); its inline script writes `localStorage rc:prefs:v1`, sets CSS variables on `<html>` and `data-motion`, and sets the theme class before first paint. `usePrefs` hydrates from localStorage |
| Change a control | `usePrefs.set(path, value)` → store updates (board preview, sounds react same frame) → `localStorage` write → `BroadcastChannel("rc-sync").postMessage({type:"prefs-local", patch})` (same-device tabs apply instantly, 0 requests) → 400 ms debounced batch → `useMutation(PATCH /api/me/preferences {patch, baseVersion}, { scope: { id: "prefs" } })` (serialised). `onSuccess`: `usePrefs.replace(server.prefs, server.version)` only for leaves not dirtied since sending; `BroadcastChannel.postMessage({type:"prefs-version", version})` so sibling tabs adopt the version **before** the socket event arrives; set cookie `rc_pv=version`; pill "SAVED · SYNCED" 2.6 s. `onError`: keep local; retry ×3 (1 s, 3 s, 9 s); then pill "Saved on this device · Couldn't sync [Retry]"; unsynced patch kept in `localStorage rc:prefs:pending` and flushed on `online` and next boot |
| Other devices | server `after()`: `internalFetch("/internal/emit", { v:1, targets:[{ userRef }], event:"prefs:updated", data:{ version }, dedupeKey:"prefs:"+ref+":"+version })` → `UserChannel` handler: **ignore if `usePrefs.version ≥ version`** (every tab on the writing device), else `qc.fetchQuery(qk.prefs())` (`If-None-Match`) → `usePrefs.replace()` |
| Time zone | `User.timeZone` is the only stored zone. Default-zone capture stays P5's (W8 on mount when the stored zone is `UTC`); a different device zone shows the mismatch banner (§4.10) whose action calls `PATCH /api/train/prefs {timeZone}` |
| Training | §4.18: `PATCH /api/train/prefs` (debounced, optimistic on `qk.train.prefs()`) and `POST /api/train/weakness/recompute` |
| Sounds tests | local only (`lib/sound/engine.ts`); `speechSynthesis` for the voice sample; no requests |
| Errors | PATCH 400 (unknown keys are stripped, so only type errors) → Sentry + local value kept; 401 → session flow, then flush; no 402 (prefs are allowed for every signed-in user) |

#### Settings › Notifications and the prompt

| Step | What happens |
|---|---|
| First paint | shell prefs (channels, reminder, quiet hours); push state is computed **client-side** after mount (`usePushState()`: permission + `getSubscription()` + `qk.push.subscriptions()` match by endpoint); SSR renders the `push_off` banner skeleton-free with the button disabled until mount resolves (no layout shift: fixed 72 px banner slot) |
| Enable push | prompt `waiting` → `Notification.requestPermission()` → `registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: NEXT_PUBLIC_VAPID_PUBLIC_KEY })` → `useMutation(POST /api/me/push-subscriptions {endpoint, keys, platform, userAgent})` (upsert by endpoint) → `setQueryData(qk.push.subscriptions())` → prefs flush of the prompt toggles |
| Test | `useMutation(POST /api/me/push-subscriptions/{id}/test)` → 202 → toast; 429 → countdown |
| Turn off on this device | `subscription.unsubscribe()` then `DELETE /api/me/push-subscriptions/{id}` |
| Channel switches, reminder time, quiet hours | prefs path (above) |
| Silent re-subscribe | permission `granted` but no subscription → subscribe + POST without UI |
| SW events | `pushsubscriptionchange` in the SW → `fetch('/api/me/push-subscriptions', {method:'POST', credentials:'include'})` with the new subscription and `oldEndpoint` |

#### Settings › Account

| Step | What happens |
|---|---|
| First paint | RSC: viewer row has `username`, `usernameChangedAt`, `visibility`, `email` (masked); `getExportStatus(viewer)` (1 PK-prefix read of `data_export_jobs`) seeded into `qk.account.exportStatus()`. Clerk-only facts (password enabled/last changed, Google account) come from `useUser()` on the client after mount |
| Email change | Clerk JS only: `user.createEmailAddress({email})` → `emailAddress.prepareVerification({strategy:"email_code"})` → `attemptVerification({code})` → `user.update({primaryEmailAddressId})` → optional `oldAddress.destroy()`. Our DB follows from the Clerk `user.updated` webhook; the Dodo customer email from the same webhook in `after()`. Wrapped in `useReverification()` (Clerk step-up) when Clerk demands it |
| Password | `user.updatePassword({currentPassword, newPassword, signOutOfOtherSessions: true})`; Google-only → `user.updatePassword({newPassword})` ("Set a password") |
| Username | `useQuery(qk.usernames.availability(u))` debounced 300 ms (`enabled` when the regex passes); `useMutation(PATCH /api/me/username)` not optimistic; 409 → `error` banner; 403 cooldown → inline date; success → patch `qk.me()` and `qk.profile.mine()`, `router.replace` nothing (we're on settings) |
| Visibility | `useMutation(PATCH /api/me/profile {visibility})` **optimistic** (segmented flips at once; rollback + toast on error) |
| Export | `useMutation(POST /api/me/export)` with `Idempotency-Key` → 202 `{status:"queued"}` → `setQueryData(qk.account.exportStatus())`; then `export:ready` socket → `setQueryData(ready)`; fallback poll `GET /api/me/export` (ETag) 10 s → 30 s while `queued/running`, socket down and tab visible, stop after 30 min; 429 (one per 24 h) → inline "You can request another export on 3 Nov" |
| Download | link `/api/me/export/download` (302 to a 10-minute presigned R2 URL) |

#### Delete account modal

| Step | What happens |
|---|---|
| Open | `useQuery(qk.account.deletionPreview())` (`staleTime 0`, fetched on open; prefetched on hover of the Delete row) |
| Typed match | local exact compare with `preview.username` |
| Submit | `const del = useReverification(() => api("/api/me", {method:"DELETE", body:{confirm}}))` — Clerk shows its step-up dialog when the server answers 403 `reverification_required`, then retries once. Not optimistic. 200 → render `deleted` 2 s → `signOutEverywhere()` (client-data-layer §6.6; Clerk `signOut` failure is ignored because the Clerk user may already be gone) → `location.assign("/?account=deleted")`. 409 → blocker banner from `details.reason`; 400 `confirm_mismatch` → hint; 5xx → `error` |

#### Membership page and modals

| Step | What happens |
|---|---|
| First paint | RSC `getMembership(viewer, requestNow())` = `deriveMembershipView(viewer row, now)` (**0 extra statements**: every input column is in `VIEWER_SELECT`, §6.2; `requestNow()` honours `x-rc-now` in non-prod for e2e, testing X5) → `qc.setQueryData(qk.billing.membership())`. Billing card is a client block: `useQuery(qk.billing.details())` with its own skeleton, so Dodo latency never blocks the plan card |
| Intent prefetch | `pointerenter`/`focus` on [Switch to yearly] → `qc.prefetchQuery(qk.billing.preview("yearly"))` (one Dodo call only for people who are about to click) |
| Switch modal | opens with `to` = the other plan; downgrade and trial skip the preview; `useQuery(qk.billing.preview(to))` with a 4 s client timeout → `preview_unavailable` on timeout/5xx with the local estimate (§8.3). Confirm: `useMutation(POST /api/subscription/change-plan {plan}, {Idempotency-Key})` not optimistic → response `{membership, paymentLink?}` → `setQueryData(qk.billing.membership(), membership)`, patch `qk.me().entitlement`, stale `qk.billing.details()`; `paymentLink` → `location.assign(paymentLink)` (return `?modal=switch-plan&step=done`). 402 `payment_update_required` and 409 `payment_declined` are handled inline (`meta: { localErrors: [...] }` skips `reactToApiError`) |
| Cancel modal | step state in the URL (`?modal=cancel&step=reason`); reads `qk.billing.membership()` from cache; Pause: `useMutation(POST /api/subscription/pause {months:1}, {Idempotency-Key})`; Confirm cancel: `POST /api/subscription/cancel {feedback, comment, offerShown}`; both not optimistic; responses write `membership` into the cache |
| Resume / Keep my trial / Keep yearly / Cancel pause / Resume now | `POST /api/subscription/resume` or `DELETE /api/subscription/change-plan`; button spinner; response DTO into the cache; `502 upstream_unavailable {kind:"refresh"}` → `Banner` "Your change was saved but we couldn't refresh it yet." [Reload] (one `POST /api/billing/refresh`) |
| Update payment | `useMutation(POST /api/subscription/payment-method, {Idempotency-Key})` → `{paymentLink}` → `location.assign` → return `?payment=updated` → **one `POST /api/billing/refresh`** (bucket `billing-refresh` 1 / 10 s) then wait for `entitlement:changed`; fallback `fallbackInterval({schedule:[2000,4000,8000], stopAfterMs: 30_000, done: s => s.state !== "past_due"})` on `GET /api/billing/membership` (DB only, 304 when unchanged). `fallbackInterval` keeps its start time in `query.meta`, so it stops (api-perf AP-20) |
| Manage billing | click handler opens `const w = window.open("about:blank","_blank","noopener")` synchronously (popup-blocker safe), then `POST /api/billing/portal` → `w.location = url`; on error closes `w` and toasts |
| Invoices | `invoiceUrl` present → `<a target=_blank rel=noopener>`; else `/api/billing/invoices/{paymentId}` (PDF, `private, no-store`, `Content-Disposition: attachment`) |
| Realtime | `entitlement:changed {…, subscriptionUpdatedAt, cause}` (P4's event, extended) → `setQueryData(qk.me())` entitlement from the payload; `invalidateQueries(qk.billing.membership())`; stale `qk.billing.details()` when `cause` is `payment_failed`/`payment_succeeded`. `router.refresh()` only in the visible tab and only when the route's gate decision flips (member ↔ not), hidden tabs on `visibilitychange` (P4's handler, api-perf AP-39) |
| Errors | `GET membership` failure with no data → `error` state + [Try again]; with data → keep it silently ("unknown is not no", client-data-layer §6.2 rule 2); action 409 → inline message from the envelope; 402 `subscription_required` never applies (membership routes are `auth:"user"`) |

### 5.3 Preference sync, end to end

```
Tab A (laptop)                       Vercel iad1                      Socket (OCI)            Phone
usePrefs.set(board.theme=walnut)
 ├─ CSS vars + preview (same frame)
 ├─ localStorage rc:prefs:v1 (v=12, dirty)
 ├─ BroadcastChannel prefs-local → Tab B applies (0 ms network)
 └─ 400 ms → PATCH /api/me/preferences {patch:{board:{theme:"walnut"}}, baseVersion:12}
                                     route(auth:user), one transaction: SELECT prefs, "prefsVersion" … FOR UPDATE;
                                     deep-merge in TS; PreferencesV1.parse; UPDATE prefs, "prefsVersion"+1, derived
                                     columns (§8.10) → 200 {prefs, version:13}
 ├─ BroadcastChannel prefs-version 13 → Tab B sets version 13
                                     after(): internalFetch POST /internal/emit
                                       {v:1, targets:[{userRef}], event:"prefs:updated", data:{version:13}}
                                                                       → emit to user room ────► UserChannel: 13 > 12
 Tab A, Tab B: 13 ≥ 13 → ignore                                                                   GET /api/me/preferences
                                                                                                  (If-None-Match:"12") → 200
                                                                                                  usePrefs.replace(v13)
```

Conflict policy: last write wins per leaf; `baseVersion` is advisory and never causes 412 (inv-acct §3.0.1); the response is always the merged document, which the client adopts only for leaves it has not changed since sending (per-leaf `dirtyAt` map in `usePrefs`). P6's TR-12 scope write goes through the same `patchPreferences()` service (§8.10), so it bumps `"prefsVersion"` and emits `prefs:updated` like any other change.

### 5.4 Realtime events P10 consumes (all on `user:{ref}`; schemas in `CT/socket/user.ts` and `CT/socket/presence.ts`, registered in `CT/socket/registry.ts`)

| Event | Payload | Emitted by | Client effect (`WEB/lib/realtime/handlers/*.ts`) |
|---|---|---|---|
| `prefs:updated` | `{ version: number }` | `patchPreferences()` `after()` | ignore if local version ≥ event; else fetch `qk.prefs()` → `usePrefs.replace` |
| `profile:updated` | `{ fields: ("displayName"\|"avatar"\|"bio"\|"country"\|"visibility"\|"username"\|"timeZone")[] }` | `PATCH /api/me/profile`, `PATCH /api/me/username`, P5 W8 when the zone changes | stale `qk.me()`, `qk.profile.mine()`, `qk.players.public(self)` |
| `blocks:changed` | `{ username: string, blocked: boolean }` | `POST/DELETE /api/me/blocks` — **to the blocker's own room only** (never to the blocked user, which would reveal the block) | patch `qk.players.viewer(username).blocked`; the socket server also drops its cached block set for this user (§7.4) |
| `entitlement:changed` (P4, extended) | `Viewer["entitlement"] & { subscriptionUpdatedAt: string \| null, cause?: "snapshot"\|"payment_failed"\|"payment_succeeded"\|"pause_start"\|"pause_end"\|"scheduled_change" }` | Dodo webhook, billing actions, pause edge job (replaces the old `membership:updated`) | P4 handler + `setQueryData(qk.me())` + invalidate `qk.billing.membership()`; stale `qk.billing.details()` on `payment_*` |
| `export:ready` | `{ jobRef: string, expiresAt: string }` | worker `EXPORT_BUILD` | `setQueryData(qk.account.exportStatus(), ready)`; toast "Your data export is ready" [Download] |
| `milestone:awarded` | `{ kind, key, title, detail \| null }` | worker `MILESTONES_EVALUATE` | achievement toast; stale `qk.mine.milestones()`, `qk.players.public(self)` |
| `presence:state` | `{ userRef, online, activity?: { kind:"game", gameRef, label, spectatable } }` | socket `PresenceRegistry` (sent to watchers only) | `usePresence` local state |
| `analysis:done` / `analysis:batch` (P3) | P3 schemas | worker | throttled stale of `qk.mine.stats(*)`; row patches stay P3's (`games.list`) |

Reconnect: `resyncCaches()` (client-data-layer §5.5 rule 4) marks `qk.billing.membership()`, `qk.account.exportStatus()` and `qk.prefs()` stale **only when the connect ack shows a missed user-room event** (`bootId` changed or a `useq` gap, the P2 rule api-perf AP-25 asks for); a clean reconnect refetches nothing.

### 5.5 Polling fallbacks in P10 (all via `fallbackInterval`, never while the socket is live, all stop)

| Poller | Endpoint | Schedule | Stops |
|---|---|---|---|
| Export status | `GET /api/me/export` (ETag → 304) | 10 s ×6 → 30 s | `ready`/`failed`, hidden tab, socket live, 30 min |
| Payment update return | `GET /api/billing/membership` (ETag) after one `POST /api/billing/refresh` | 2 s, 4 s, 8 s | state ≠ `past_due`, 30 s |
| Plan switch return (`step=done`) | `GET /api/billing/membership` | 2 s, 4 s, 8 s | `scheduledChange`/plan changed, 30 s |

Nothing else in P10 polls, and every poll stops on its own: the start time is read from `query.meta` (api-perf AP-20). Presence has no HTTP fallback (hidden while the socket is down). The polled GETs are DB-only; none reaches Dodo.

### 5.6 Error and status handling specific to P10 (codes from `CT/http/codes.ts`, consistency R-06)

| Code | Where | UI |
|---|---|---|
| 401 `unauthorized` | any signed-in route | `SessionExpiredModal` (P1); drafts kept in `sessionStorage` |
| 402 `subscription_required` (`details.reason` ∈ `trial_used`, `expired`, `payment_failed`, **`paused`**) | `review-batch`, `export.pgn`, other member routes | `reactToApiError` → `/pricing?reason=…&redirect_url=`; `paused` → `/settings/membership` |
| 402 `payment_update_required` | `POST /api/subscription/change-plan`, `…/pause` while past due | handled inline in the modal ("Update your payment method before changing plans." [Update payment]) |
| 403 `forbidden` `profile_private` | public player sub-resources for a private target | lock card |
| 403 `forbidden` `cooldown` | `PATCH /api/me/username` | inline "You can change it again on {date}" |
| 403 `reverification_required` (**added to `codes.ts` by P10**, or by P12 if it merges first) | `DELETE /api/me` | Clerk `useReverification` handles it |
| 404 `not_found` | `/u/[username]`, `DELETE …/blocks/{u}`, invoice, push subscription | not-found view / toast |
| 409 `conflict` — reasons registered in `CONFLICT_REASONS` by P10: `username_taken`, `in_game`, `last_admin`, `hosting_tournament`, `already_paused`, `paused_recently`, `trial_active`, `not_active`, `same_plan`, `already_cancelling`, `nothing_to_resume`, `ended`, `no_scheduled_change`, `subscription_disabled`, `avatar_missing`, **`payment_declined`** | as named | inline per screen (§4) |
| 409 `in_flight` (P2's code) | export already running | show `exporting` |
| 410 `gone` (P3's code) | export download expired; bad unsubscribe token | "This export link has expired. Request a new export." |
| 413 `payload_too_large` | avatar upload-url with `bytes > 2 MiB` | `upload_error` |
| 422 `idempotency_key_reused` | billing actions | Sentry; new key on next click |
| 429 `rate_limited` | availability, avatar, export, delete, test push, report, billing actions | `RateLimitedInline` countdown from `retryAfterSec` |
| 502 `upstream_unavailable {kind, provider:"dodo"}` | billing details (degraded 200 instead), preview `kind:"timeout"` (`preview_unavailable`), billing actions `kind:"error"` (error state), refresh `kind:"refresh"` | as named |
| 503 `not_configured` | billing in an env without Dodo keys | toast "Billing is not available right now." |

`payment_declined` is a 409 reason, not a 502: a declined card is an answer from Dodo, not an outage (deviation from consistency 10.10's blanket mapping, Appendix A).

### 5.7 First-paint request budget for P10 pages

| Page | Function invocations | DB statements after auth | Third-party calls |
|---|---|---|---|
| `/u/[username]` (member viewing another player) | 1 (page) | 0–2 for the public part (data-cache hit or miss) + 1 per-viewer statement | 0 |
| `/u/[username]` (own) | 1 | 2 sequential RT (header, then ≤ 5 parallel) | 0 |
| `/p/[username]` (guest, CDN hit) | 0 | 0 | 0 |
| `/profile/edit` | 1 | 1 | 0 |
| `/settings/*` (any section except Account/Membership/Training) | 1 | 0 | 0 |
| `/settings/training` | 1 | 1 | 0 |
| `/settings/account` | 1 | 1 | 0 (Clerk JS loads client-side) |
| `/settings/membership` | 1 + 1 client (`billing/details`) | 0 + 0 (cache hit) or 1 | 0 on first paint; Dodo ×2 in the details call on a data-cache miss |

---

## 6. Data model (M10a + M10 + C3)

Rules (allocation §1.3, data-model §2 and §11, consistency R-20): additive expand migrations generated with `prisma migrate diff` against a local Docker Postgres 17 shadow; hand-written SQL added for partial indexes, `NOT VALID` FKs and `lock_timeout`; applied on the Neon dev branch (the one named in CLAUDE.md, not a hard-coded id) with **`prisma migrate deploy` only**; **never `prisma db push` on any Neon branch** (it drops the hand-written partial indexes and `UNLOGGED` storage) and **never `prisma migrate dev` on a Neon branch** (only on local Docker); production gets the files in P13 through `migrate deploy` after a rehearsal on a child branch. The C3 step changes delete semantics and needs the owner's explicit confirmation (CLAUDE.md rule 5). **Enum values take two releases** (feasibility §9): the `m10a` file and M10's new enums deploy in release N with no writer; writers are enabled in release N+1 by `account-v3`, so rolling back N+1 → N never meets an unknown value. **UNLOGGED tables hold only limits that are safe to reset** (feasibility F-NEON-3): every P10 budget or window longer than 300 s is in a logged table.

What P10 does **not** create, because an earlier phase owns it: `reports` (P5), `audit_logs` (P4, M4), `users."timeZone"`, `"membershipEndedAt"`, `"lastPaymentFailedAt"`, `"lastPaymentFailureReason"` (P4, M4), `user_settings` and its derived minute columns, `emailOptIns`, `consent` (P9, M9), `game_players_h2h_idx` (P9, M9), `jobs."fairSeq"` and the `JobKind` values `EXPORT_BUILD`, `ACCOUNT_PURGE`, `DODO_CUSTOMER_SYNC` (P3, M3).

### 6.1 Enums

```prisma
enum ProfileVisibility { PUBLIC PRIVATE }
enum NotificationKind  { CHALLENGE TOURNAMENT_STARTING TOURNAMENT_NEW REVIEW_READY MISTAKES_DUE WEEKLY_PROGRESS
                         IMPORT_DONE TRIAL_ENDING PAYMENT_FAILED PRODUCT_NEWS ACCOUNT TEST }   // data-model §4; every kind P10–P12 need, declared once
enum DeliveryStatus    { PENDING SENT SKIPPED FAILED }
enum ExportStatus      { QUEUED RUNNING READY FAILED EXPIRED }
```

Report enums are P5's (`ReportTarget` already has `USER` and `GAME`; `ReportReason` already has `CHEATING`, `ABUSE`, `INAPPROPRIATE_NAME`, `OTHER`), so P10 adds none.

`JobKind` (P3, Postgres enum) gains, **in its own migration file** `…_m10a_job_kinds` before anything uses them (data-model §11.1 rules 3 and 6; consistency R-05 ledger):

```sql
SET lock_timeout = '5s';
ALTER TYPE "JobKind" ADD VALUE IF NOT EXISTS 'MILESTONES_EVALUATE';
ALTER TYPE "JobKind" ADD VALUE IF NOT EXISTS 'NOTIFY_DISPATCH';
ALTER TYPE "JobKind" ADD VALUE IF NOT EXISTS 'NOTIFY_REMINDERS';
ALTER TYPE "JobKind" ADD VALUE IF NOT EXISTS 'NOTIFY_WEEKLY';
ALTER TYPE "JobKind" ADD VALUE IF NOT EXISTS 'MEMBERSHIP_PAUSE_EDGE';
ALTER TYPE "JobKind" ADD VALUE IF NOT EXISTS 'R2_SWEEP';
```

Write order: migration → web deploy (new Prisma client) → OCI deploy (socket + worker clients) → one more web deploy that turns on the writers (behind `account-v3`). Old clients never read rows with these kinds because the P3 worker filters claims by `kind = ANY($lane)`. P10's job priorities are names added to `JOB_PRIORITY` (`DBP/src/jobs.ts`): `ACCOUNT_PURGE 90`, `EXPORT_BUILD 70`, `PAUSE_EDGE 60`, `NOTIFY 30`, `DODO_SYNC 20`, `MILESTONES 10`; `REVIEW_BATCH 60` and `HOUSEKEEPING 0` already exist (R-05).

### 6.2 Changed models

```prisma
model User {
  // …existing (schema.prisma:18-65) and P1–P9 additions (P4 already added timeZone, membershipEndedAt,
  //    lastPaymentFailedAt, lastPaymentFailureReason in M4; P1 F4b added subscriptionSourceAt)…
  // ── M10 public identity ──
  /// Display casing, e.g. "knightowl_88". Uniqueness and lookups use usernameKey.
  username          String?           @db.VarChar(20)
  /// lower(username). Required for every user after backfill B8 (application-enforced; NOT NULL in a later contract step).
  usernameKey       String?           @unique @db.VarChar(20)
  usernameChangedAt DateTime?
  /// User-owned; the UI shows displayName ?? name (Clerk).
  displayName       String?           @db.VarChar(24)
  bio               String?           @db.VarChar(160)
  countryCode       String?           @db.Char(2)
  /// User-owned upload (R2, immutable URL); the UI shows avatarUrl ?? profilePictureUrl (Clerk).
  avatarUrl         String?           @db.VarChar(300)
  avatarKey         String?           @db.VarChar(120)
  visibility        ProfileVisibility @default(PUBLIC)
  // ── M10 billing ──
  scheduledPlanKey  String?           @db.VarChar(32)
  scheduledChangeAt DateTime?
  /// Dodo's own paused_at (only if the D6 fallback, Dodo pause:true, is used)
  pausedAt          DateTime?
  /// Local pause window [pausedFrom, pausedUntil): isEntitled() is false inside it (D6)
  pausedFrom        DateTime?
  pausedUntil       DateTime?
  /// One pause per 12 months
  lastPausedAt      DateTime?

  usernameHistory   UsernameHistory[]
  milestones        UserMilestone[]
  blocksMade        UserBlock[]        @relation("Blocker")
  blocksReceived    UserBlock[]        @relation("Blocked")
  pushSubscriptions PushSubscription[]
  notifications     Notification[]
  dataExports       DataExportJob[]
  // reportsMade Report[] @relation("ReportsMade") is P5's and unchanged
}

model UserSettings {                       // created by P9 (M9); P10 adds one column
  userId              BigInt   @id
  prefs               Json     @default("{}")      // PreferencesV1 (DBP/json/preferences.ts), ≤ 4 KB
  prefsVersion        Int      @default(0)
  reminderUtcMinute   Int?     @db.SmallInt        // P9; 0..1439, UTC minute of the next local reminder; null = off
  quietStartUtcMinute Int?     @db.SmallInt        // P9
  quietEndUtcMinute   Int?     @db.SmallInt        // P9
  emailOptIns         String[] @default([])        // P9; NotificationKind values with email on
  consent             Json?                        // P9, unchanged; P11 D7 writes it
  /// M10: NotificationKind values with push on
  pushOptIns          String[] @default([])
  updatedAt           DateTime @updatedAt
  user                User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@map("user_settings")
}

model TournamentParticipant {              // existing (schema.prisma:412-433)
  // …existing…
  /// M10 (owner of this column; P12 uses ADD COLUMN IF NOT EXISTS if it merges first): name snapshot so finished
  /// standings survive account deletion (C3 makes userId nullable)
  displayName String? @db.VarChar(40)
}

model Report {                             // P5 (M5); P10 adds one index only (§6.4) and writes targetType USER | GAME
  // …unchanged…
}
```

`User.timeZone` (P4, M4) is the only stored time zone: local-day maths, derived reminder minutes and email dates all read it.

### 6.3 New models

```prisma
/// Old handles redirect (308) and stay reserved for 90 days.
model UsernameHistory {
  oldKey    String   @id @db.VarChar(20)   // lower(old username)
  oldName   String   @db.VarChar(20)       // display casing, for the redirect target lookup log
  userId    BigInt
  changedAt DateTime @default(now())
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@index([userId])
  @@map("username_history")
}

/// Achieved and in-progress milestones. Definitions are code (WEB/lib/milestones/definitions.ts, shared with WK).
model UserMilestone {
  id         BigInt    @id @default(autoincrement())
  userId     BigInt
  kind       String    @db.VarChar(40)    // e.g. "REVIEWS_100", "RATING_PEAK"
  key        String    @default("") @db.VarChar(60)   // e.g. pool "blitz", legend slug
  title      String    @db.VarChar(80)
  detail     String?   @db.VarChar(160)
  fen        String?   @db.VarChar(100)   // mini board
  href       String?   @db.VarChar(200)
  progress   Int       @default(0)
  target     Int       @default(1)
  achievedAt DateTime?
  notifiedAt DateTime?                    // toast/notification sent once
  defVersion Int       @default(1) @db.SmallInt
  updatedAt  DateTime  @updatedAt
  user       User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@unique([userId, kind, key])
  @@index([userId, achievedAt(sort: Desc)])
  @@map("user_milestones")
}

model UserBlock {
  blockerId BigInt
  blockedId BigInt
  createdAt DateTime @default(now())
  blocker   User     @relation("Blocker", fields: [blockerId], references: [id], onDelete: Cascade)
  blocked   User     @relation("Blocked", fields: [blockedId], references: [id], onDelete: Cascade)
  @@id([blockerId, blockedId])
  @@index([blockedId])
  @@map("user_blocks")
}

/// One row per browser/device push endpoint.
model PushSubscription {
  id            BigInt    @id @default(autoincrement())
  referenceId   String    @unique @default(cuid())      // API id
  userId        BigInt
  endpoint      String    @unique @db.VarChar(1024)
  p256dh        String    @db.VarChar(120)
  auth          String    @db.VarChar(40)
  platform      String    @db.VarChar(16)             // "web" | "ios_pwa" | "android" | "desktop"
  userAgent     String?   @db.VarChar(200)
  failures      Int       @default(0) @db.SmallInt
  lastSuccessAt DateTime?
  disabledAt    DateTime?
  createdAt     DateTime  @default(now())
  user          User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@index([userId])
  @@map("push_subscriptions")
}

/// One logical notification = send log + per-channel delivery state (+ inbox fields for a later inbox). data-model D14.
model Notification {
  id          BigInt           @id @default(autoincrement())
  referenceId String           @unique @default(cuid())   // used in the signed click URL
  userId      BigInt
  kind        NotificationKind
  /// e.g. "mistakes_due:<userRef>:2026-11-02" — every producer is idempotent
  dedupeKey   String           @unique @db.VarChar(120)
  title       String           @db.VarChar(120)
  body        String           @db.VarChar(300)
  url         String?          @db.VarChar(300)
  data        Json?                                        // ≤ 1 KB, per kind
  runAt       DateTime         @default(now())             // deferred past quiet hours
  pushStatus  DeliveryStatus   @default(SKIPPED)
  emailStatus DeliveryStatus   @default(SKIPPED)
  attempts    Int              @default(0) @db.SmallInt
  lastError   String?          @db.VarChar(300)
  sentAt      DateTime?
  readAt      DateTime?
  clickedAt   DateTime?
  createdAt   DateTime         @default(now())
  user        User             @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@index([userId, createdAt(sort: Desc)])
  @@map("notifications")
}

/// User-visible export status (B5 pattern; the work is Job kind EXPORT_BUILD).
model DataExportJob {
  id          BigInt       @id @default(autoincrement())
  referenceId String       @unique @default(cuid())
  userId      BigInt
  status      ExportStatus @default(QUEUED)
  requestedAt DateTime     @default(now())
  startedAt   DateTime?
  readyAt     DateTime?
  expiresAt   DateTime?                          // readyAt + 7 days
  r2Key       String?      @db.VarChar(200)       // exports/{userRef}/{referenceId}.zip (private bucket)
  bytes       Int?
  counts      Json?                              // { games, reviews, mistakes } for the email
  error       String?      @db.VarChar(300)
  user        User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@index([userId, requestedAt(sort: Desc)])
  @@map("data_export_jobs")
}

/// Durable daily email budget (D17). Logged on purpose: UNLOGGED tables empty on every Neon suspend.
model EmailBudgetDay {
  day   DateTime @id @db.Date            // UTC day
  total Int      @default(0)
  bulk  Int      @default(0)
  @@map("email_budget_days")
}

/// Deletion outbox for external clean-up. No PII; survives the user row (no FK). data-model §5.10.
model AccountDeletion {
  id                 String    @id @default(cuid())
  userRefHash        String    @db.Char(64)     // sha256hex(HASH_PEPPER + "\n" + "u:" + referenceId)
  emailHash          String    @db.Char(64)     // = trialLedgerHash(email) (P4 trial-ledger.ts, HASH_PEPPER)
  clerkUserId        String?   @db.VarChar(64)  // nulled when clerk_delete is done
  dodoCustomerId     String?   @db.VarChar(64)
  dodoSubscriptionId String?   @db.VarChar(64)  // nulled when dodo_cancel is done
  lichessTokenEnc    Bytes?                     // only if P4 stores tokens (F-API-3); still encrypted; nulled after lichess_revoke
  /// Email address kept only until confirmation_email is sent, sealed with LINK_TOKEN_KEYS (P4; ACCOUNT_DATA_KEYS if P4 drops it)
  emailEnc           Bytes?
  r2Prefixes         String[]  @default([])     // ["avatars/<ref>/", "exports/<ref>/"]
  posthogDistinctId  String?   @db.VarChar(40)  // = old referenceId, nulled after posthog_delete
  source             String    @db.VarChar(8)   // "user" | "clerk" | "admin"
  /// { dodo_cancel, clerk_delete, lichess_revoke, r2_delete, posthog_delete, confirmation_email }:
  ///   { status: "pending"|"done"|"skipped"|"failed", attempts, lastError, doneAt }
  steps              Json      @default("{}")
  requestedAt        DateTime  @default(now())
  completedAt        DateTime?
  lastError          String?   @db.VarChar(500)
  @@map("account_deletions")
}
```

### 6.4 Raw SQL in `…_m10_account_area/migration.sql` (after the generated statements)

```sql
SET lock_timeout = '5s';
-- Player search prefix (LIKE 'abc%' on a default-collation unique index can't use it)
CREATE INDEX IF NOT EXISTS users_username_prefix_idx ON users ("usernameKey" text_pattern_ops)
  WHERE "usernameKey" IS NOT NULL;
-- Notification dispatcher claim
CREATE INDEX IF NOT EXISTS notifications_pending_idx ON notifications ("runAt")
  WHERE "pushStatus" = 'PENDING' OR "emailStatus" = 'PENDING';
-- Reminder planning (P9 may have created it with the column; IF NOT EXISTS keeps this a no-op then)
CREATE INDEX IF NOT EXISTS user_settings_reminder_idx ON user_settings ("reminderUtcMinute")
  WHERE "reminderUtcMinute" IS NOT NULL;
-- Deletion outbox retries and the runbook query
CREATE INDEX IF NOT EXISTS account_deletions_open_idx ON account_deletions ("requestedAt")
  WHERE "completedAt" IS NULL;
-- Daily reconcile task: non-terminal subscriptions, oldest refresh first
CREATE INDEX IF NOT EXISTS users_billing_reconcile_idx ON users ("subscriptionUpdatedAt")
  WHERE "subscriptionStatus" IN ('active','on_hold','past_due','paused','pending');
-- Trial reminder backstop: trials ending soon
CREATE INDEX IF NOT EXISTS users_trial_ending_idx ON users ("trialEndsAt")
  WHERE "trialEndsAt" IS NOT NULL;   -- the task filters cancelAtPeriodEnd and status in the query
-- Export expiry sweep
CREATE INDEX IF NOT EXISTS data_export_jobs_ready_idx ON data_export_jobs ("expiresAt")
  WHERE status = 'READY';
-- Reports about one user (P12 moderation view; deletion clean-up). P5's table, P10's first writer of reportedUserId
CREATE INDEX IF NOT EXISTS reports_reported_user_idx ON reports ("reportedUserId", "createdAt" DESC)
  WHERE "reportedUserId" IS NOT NULL;
ALTER TABLE user_settings SET (fillfactor = 80);   -- HOT updates for prefs PATCHes (no-op if set)
```

Every hand-written index name is appended to `DBP/prisma/protected-indexes.txt` so `scripts/db/check-drift.ts` (P2) rejects a generated `DROP INDEX` for it (data-model §11.3).

### 6.5 Indexes and the queries they serve

| Index | Query | Expected plan |
|---|---|---|
| `users_usernameKey_key` (unique) | header: `SELECT … FROM users WHERE "usernameKey" = lower($1) AND "isActive"`; availability; `PATCH /api/me/username` (P2002 → 409) | Index Scan, 1 row |
| `users_username_prefix_idx` | search: `WHERE "usernameKey" LIKE lower($q) \|\| '%' ORDER BY length("usernameKey") LIMIT 5` (+ `"displayName" ILIKE '%'\|\|$q\|\|'%'` as a second, seq-scanned query only when the first returns < 5; users < 10k). The member variant adds `AND NOT EXISTS (SELECT 1 FROM user_blocks WHERE "blockerId" = u.id AND "blockedId" = $viewer)` | Index Scan (range) |
| `username_history_pkey (oldKey)` | rename redirect and the 90-day reservation check | PK |
| `user_milestones_userId_achievedAt_idx` | Milestones tab: `WHERE "userId"=$1 ORDER BY "achievedAt" DESC NULLS LAST, id DESC` (≤ 40 rows) | Index Scan |
| `user_milestones_userId_kind_key_key` | evaluator upsert `ON CONFLICT ("userId", kind, key) DO UPDATE … WHERE user_milestones."achievedAt" IS NULL` | unique |
| `user_blocks_pkey`, `user_blocks_blockedId_idx` | "is there a block either way": `SELECT 1 FROM user_blocks WHERE ("blockerId", "blockedId") IN (($a,$b),($b,$a)) LIMIT 1`; pairing exclusions (P9/P12 socket) | PK |
| `reports_status_createdAt_idx` (P5) | P12 moderation queue | Index Scan |
| `reports_reported_user_idx` | P12 per-user view; P5's 24-hour duplicate check for user reports `WHERE "reporterId"=$1 AND "reportedUserId"=$2 AND "createdAt" > now() - '24 h'`; deletion clean-up | partial Index Scan |
| `push_subscriptions_endpoint_key` | `POST` upsert by endpoint; 410 cleanup | unique |
| `push_subscriptions_userId_idx` | dispatcher: all devices of a user `WHERE "userId"=$1 AND "disabledAt" IS NULL` | Index Scan |
| `notifications_dedupeKey_key` | producers `INSERT … ON CONFLICT ("dedupeKey") DO NOTHING` | unique |
| `notifications_pending_idx` | dispatcher: `UPDATE notifications SET attempts = attempts + 1 WHERE id IN (SELECT id FROM notifications WHERE ("pushStatus"='PENDING' OR "emailStatus"='PENDING') AND "runAt" <= now() ORDER BY "runAt" LIMIT 100 FOR UPDATE SKIP LOCKED) RETURNING …`; the drain's final `SELECT min("runAt")` for the next wake | partial Index Scan |
| `notifications_userId_createdAt_idx` | cascade; 90-day prune per user; future inbox | Index Scan |
| `user_settings_reminder_idx` | planner: `SELECT "reminderUtcMinute", count(*) FROM user_settings WHERE "reminderUtcMinute" IS NOT NULL GROUP BY 1` (index-only); run: `WHERE "reminderUtcMinute" = $m` | Index Only Scan |
| `email_budget_days_pkey (day)` | reserve one send (§8.11) | PK |
| `data_export_jobs_userId_requestedAt_idx` | Account page latest export; the once-per-24 h check (the durable limit for exports is this source row) | Index Scan, LIMIT 1 |
| `data_export_jobs_ready_idx` | `R2_SWEEP`: `WHERE status='READY' AND "expiresAt" < now()` → set EXPIRED | partial |
| `account_deletions_open_idx` | `ACCOUNT_PURGE` re-enqueue sweep; runbook | partial |
| `users_billing_reconcile_idx` | `/api/cron/daily` task: `WHERE "subscriptionStatus" IN (…) AND "subscriptionUpdatedAt" < now() - interval '24 hours' ORDER BY "subscriptionUpdatedAt" LIMIT 50` | partial Index Scan |
| `users_trial_ending_idx` | trial-reminder backstop: `WHERE "trialEndsAt" BETWEEN now() + '24 h' AND now() + '72 h'` | partial Index Scan |
| `game_players_userId_endedAt_gameId_idx` (P2) | profile games keyset, recent 6, stats window, rating history (filter `"timeClass"` and `"ratingAfter" IS NOT NULL` on ≤ 2,000 rows) | Index Scan + filter |
| `game_players_h2h_idx` (P9, M9) | h2h: `WHERE "userId"=$viewer AND "opponentUserId"=$target ORDER BY "endedAt" DESC` | Index Scan |
| `games_white_player_idx` / `games_black_player_idx` (P2, M2 partial) | deletion anonymise `UPDATE games SET "whiteName"='Deleted player' WHERE "whitePlayerId"=$u` | Index Scan |

Indexes deliberately **not** added (data-model §8): trigram on usernames/display names, `(userId, outcome)`, `(userId, source)`, a `searchText` GIN — each serves filters inside ≤ 2,000 rows. The CI index-existence gate (api-perf §5) parses this table: every name above must exist in `pg_indexes` after `migrate deploy` on a throwaway branch.

### 6.6 Stats fallback (only if D3's gate fails)

```prisma
model PlayerStats {                        // not created unless k6 shows stats DB p95 > 50 ms
  userId     BigInt
  pool       String   @db.VarChar(12)     // bullet|blitz|rapid|classical|daily
  window     String   @default("90d") @db.VarChar(8)
  data       Json                          // PlayerStatsDTO (§7.2), ≤ 2 KB
  computedAt DateTime @default(now())
  @@id([userId, pool, window])
  @@map("player_stats")
}
```

with a debounced `PROFILE_STATS` job (a new `JobKind` value in its own `ADD VALUE` file, only if the fallback ships; `dedupeKey pstats:<userId>`, runAt +10 min) enqueued from the P3 analysis completion hook (§3.3).

### 6.7 Contract step C3 (owner confirmation required)

Two files, applied after the M10 file and **only after** the owner confirms with the sentence "This changes what deleting a user does: games against other members are kept and anonymised instead of deleted" (CLAUDE.md rule 5):

`…_c3_user_fk_set_null/migration.sql` (data-model §5.10):

```sql
SET lock_timeout = '5s';
ALTER TABLE games ALTER COLUMN "creatorId" DROP NOT NULL;
ALTER TABLE tournaments ALTER COLUMN "createdByUserId" DROP NOT NULL;
ALTER TABLE tournament_participants ALTER COLUMN "userId" DROP NOT NULL;
ALTER TABLE games DROP CONSTRAINT "games_creatorId_fkey",
  ADD CONSTRAINT "games_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;
ALTER TABLE games DROP CONSTRAINT "games_opponentId_fkey",
  ADD CONSTRAINT "games_opponentId_fkey" FOREIGN KEY ("opponentId") REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;
ALTER TABLE tournaments DROP CONSTRAINT "tournaments_createdByUserId_fkey",
  ADD CONSTRAINT "tournaments_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;
ALTER TABLE tournament_participants DROP CONSTRAINT "tournament_participants_userId_fkey",
  ADD CONSTRAINT "tournament_participants_userId_fkey" FOREIGN KEY ("userId") REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;
```

`…_c3v_validate_user_fks/migration.sql`: `ALTER TABLE … VALIDATE CONSTRAINT …` for the four FKs (SHARE UPDATE EXCLUSIVE, no write block).

Prisma side: `Game.creatorId BigInt?` with `onDelete: SetNull`, `opponent … onDelete: SetNull`, `Tournament.createdByUserId BigInt?` + `createdBy User? … onDelete: SetNull`, `TournamentParticipant.userId BigInt?` + `user User? … onDelete: SetNull`. Every reader of `game.creator` / `participant.user` must handle `null` (grep list in WP5's acceptance criteria). P2's `Game.whitePlayerId/blackPlayerId` are already `SetNull` (data-model §6).

Safety: each `DROP` + `ADD` pair is one statement (no window without a constraint); `NOT VALID` makes the `ADD` instant; rehearse on a child branch of `dev` first, then `dev`; production in P13 after a snapshot.

### 6.8 Migration files (names; timestamps set when written)

| # | Folder | Contents | Confirm |
|---|---|---|---|
| M10a | `2026MMDDhhmmss_m10a_job_kinds` | the 6 `ALTER TYPE "JobKind" ADD VALUE` (§6.1) | — |
| M10 | `…_m10_account_area` | enums §6.1, `users` columns §6.2, `user_settings."pushOptIns"`, `tournament_participants."displayName"` (`ADD COLUMN IF NOT EXISTS`, shared with P12), the 7 new tables §6.3 (`username_history`, `user_milestones`, `user_blocks`, `push_subscriptions`, `notifications`, `data_export_jobs`, `account_deletions`) + `email_budget_days`, raw SQL §6.4 | — |
| C3 | `…_c3_user_fk_set_null` | §6.7 | **owner** |
| C3v | `…_c3v_validate_user_fks` | `VALIDATE CONSTRAINT` ×4 | with C3 |

### 6.9 Backfills (`WEB/scripts/backfill/*.ts`; `--dry-run` default, `--apply`, batches of 500 by id, `BACKFILL_ALLOWED_HOSTS`, one `audit_logs` row each)

| ID | Script | Predicate | Work | Verify |
|---|---|---|---|---|
| B8 | `usernames.ts` | `"usernameKey" IS NULL AND "googleId" NOT LIKE 'system:%'` | candidate order: linked Chess.com handle (if it matches §8.6 and is free), else `slug(name)` (ASCII-fold, `[^a-z0-9_]` → `_`, trim to 14) + `_` + `lower(code)`; on collision append `_2`, `_3`; `username` = candidate in original casing for handles, `usernameKey` = lower; `displayName` = `left(name, 24)` when null; `usernameChangedAt` stays null (first change has no cooldown) | 0 rows with null `usernameKey`; all match `^[a-z0-9][a-z0-9_]{2,19}$` |
| B12 | `prefs-derived.ts` | `user_settings` rows with `"reminderUtcMinute" IS NULL AND prefs ? 'notifications'` | recompute derived columns with `lib/prefs/derived.ts` | spot check 20 rows in 3 zones |
| B13 | `participant-names.ts` | `tournament_participants."displayName" IS NULL` | copy `users.displayName ?? name` | 0 nulls with a non-null `userId` |
| B14 | `milestones-initial.ts` | users with ≥ 1 `game_players` row | enqueue `MILESTONES_EVALUATE {silent:true}` per user (no toasts, no notifications) at `JOB_PRIORITY.MILESTONES` with `fairSeq` (M3) | job count = users |

Order: migrate → deploy readers that tolerate null usernames (the profile route 404s, `/profile` sends the user to `/profile/edit?claim=1`) → B8 → B12/B13 → B14 → enable `account-v3`.

### 6.10 Dev seed and test personas (`WEB/prisma/seed/personas.ts`, `WEB/e2e/personas/p10.ts`; data-model §13, testing X4)

Seed personas (dev demo data, created idempotently by `pnpm --filter web db:seed:personas`):

| Persona | P10 additions | Boards / states |
|---|---|---|
| `member` | username `knightowl_88`, display "Rohit · knightowl", bio, country IN, avatar from `prisma/seed-data/avatars/ko.webp` uploaded to the dev media bucket under `avatars/seed/`; 6 milestones (4 achieved, 2 next); 1 push subscription row (fake endpoint, `disabledAt` set so nothing sends); prefs Walnut / inside / volume 60 | `V4Profile*` default, Settings summaries, `V4SettingsNotifications` enabled (via demo route) |
| `new` | username only | `new_user`, `not_linked`, Membership `free` |
| `private` | `visibility = PRIVATE` | `V4ProfilePrivate`, guest private |
| `rival` (`martin_k`) | 6 games vs `member` (3W 1D 2L, last today, legend position) | h2h card, `V4ProfileOther` public |
| `trial`, `cancelling`, `pastdue`, `legacy`, `caughtup` (yearly), `lapsed` | existing (data-model §13.4) + `lastPaymentFailedAt` for `pastdue`, `scheduledPlanKey='monthly'` on a new `switching` persona | Membership states |
| `paused` (new) | `pausedFrom = now() - 2 d`, `pausedUntil = now() + 28 d` | Membership `paused` active |

**E2E rules (testing X4).** Shared letters A–P are members that specs may only **add** data to and never assert absolute counts on; Q (trial used) and R (non-member) are read-only. Every P10 spec that changes a user's state leases a pool user (`leasePersona(name)`, TTL 15 min, row lock in the dev-only `e2e_leases` table) reset by `scripts/dev/personas.ts --reset <pool user> --persona <name>`. P10 adds these reset modes to `WEB/e2e/personas/p10.ts`:

| Persona | Reset state | Used by |
|---|---|---|
| `p10-profile` | member, username `p10a_<n>`, default prefs, 12 games (3 imported, 2 legend), 2 analysed, milestones 2 achieved, no blocks | `profile-own`, `profile-edit`, `settings-*`, bulk review, export PGN |
| `p10-rival` | member with 6 games vs `p10-profile`, public | `profile-other` (block, report, presence, private toggle) |
| `p10-username` | `usernameChangedAt = null`, no history rows | `account-username` (so the 30-day cooldown never breaks the next run) |
| `p10-export` | no `data_export_jobs` rows | `account-export` (the once-per-24 h limit is per row) |
| `p10-notify` | no push subscriptions, default channels, `timeZone = Asia/Kolkata` | `notifications`, `notif-prompt`, reminder spec |
| `p10-trial`, `p10-paid-monthly`, `p10-pastdue`, `p10-paused` | billing rows as named (synthetic for states, real Dodo test subscriptions only in the serial billing specs) | `membership-*`, `membership-trial-days` |
| `p10-training` | P5 profile defaults | `settings-training` |

**Throwaway users** (testing X4.2): the truly destructive flows create one Clerk dev user each, named `e2e-del-<runId>@…+clerk_test` (deletion, blockers) and `e2e-bill-<runId>-{trial,paid,pastdue}@…+clerk_test` (Dodo checkout flows); P1's sweeper deletes any `e2e-*` user older than 2 h together with its DB and trial-ledger rows.

Seeded billing is fake (`sub_seed_*`); real billing flows use the throwaway `e2e-bill-*` users with Dodo test-mode subscriptions.

### 6.11 Storage (Neon Free 1 GB budget, data-model §10)

| Table | Per member | Note |
|---|---|---|
| `notifications` | ≈ 300 B × (≤ 1 reminder/day + 1 weekly) × 90 days ≈ 30 KB | pruned at 90 days by the `p10-housekeeping` slice |
| `email_budget_days` | one 40 B row per day, global | pruned at 60 days |
| `user_milestones` | ≤ 30 rows × 220 B ≈ 7 KB | |
| `push_subscriptions` | ≤ 3 × 600 B | |
| `username_history` | ≤ 4 rows × 80 B | pruned at 90 days |
| `data_export_jobs` | ≤ 12 rows/year × 200 B | |
| `users` new columns | ≈ 250 B | |
| Total | **≈ 40 KB/member**, < 1 % of the 4.4 MB/member/year budget | |

---

## 7. API

Every route uses `route()` (`WEB/lib/api/route.ts`, B18) with P1's option set; contracts live in `CT/http/*.ts` and are registered in `CT/http/registry/account.ts` (directory registry, feasibility §7) so OpenAPI and contract tests are generated (api-design §2.14). Success `{ data, meta? }`; errors `{ error: { code, message, details?, retryAfterSec?, requestId } }` with the closed code list in `CT/http/codes.ts` (consistency R-06; P10 adds `reverification_required: 403` and its `CONFLICT_REASONS`). Side effects (socket emits, PostHog server events, worker kick, `revalidateTag`/`invalidateByTag`, Dodo/Clerk follow-ups) run in `after()`. Every route exports `maxDuration` (10 s default; 30 s where Dodo, Clerk BAPI or R2 is called). **GETs never write and never call Dodo** (api-perf AP-31, AP-09; the GET-purity gate allows only the registered exceptions `portal_session` on the one-release alias and `pgn_stream_log`); every cross-service call goes through `internalFetch()` from `CT/internal/auth.ts`.

Auth legend: `P` public (`auth:"public"`, reads no session), `U` signed in (member or not), `M` member (402 `subscription_required` otherwise), `O` owner of the resource, `I` internal (P2's scheme through the shared helper), `W` webhook signature, `C` cron bearer, `T` test hook (`isNonProd()` **and** `x-e2e-token` = `E2E_TEST_TOKEN`, registered in `WEB/lib/test-hooks/registry.ts`, 404 otherwise; testing X12). Cache tiers are P1's: `public-static` (only with `P`), `private-etag` (`private, no-cache` + strong ETag), `no-store`. **No per-user response carries `max-age > 0`** (api-perf AP-04); downloads are `private, no-store` + `Content-Disposition: attachment`. Rate limits are P1 fixed windows `limit / windowSec`; `durable` marks the LOGGED store (any window > 300 s, api-perf AP-11).

### 7.1 Endpoint catalogue

| ID | Method · path (file under `WEB/app/api/`) | Auth | Request → `data` | Errors (beyond the implied) | Cache | Rate limit | Idem. | maxDur |
|---|---|---|---|---|---|---|---|---|
| PLY-1 | `GET /api/players/{username}` (`players/[username]/route.ts`) | P | → `PlayerPublic` (§7.2) | `not_found`; 308 `Location: /api/players/{new}` for a renamed handle | `public-static` s-maxage 60, swr 300, tag `player:{usernameKey}` | edge | — | 10 |
| PLY-2 | `GET /api/players/{username}/rating-history?pool` | P | → `RatingHistory` (≤ 60 points, 90 days) | `not_found`, `forbidden {reason:"profile_private"}` | as PLY-1 | edge | — | 10 |
| PLY-3 | `GET /api/players/{username}/games?result&src&legend&q&pool&cursor&limit≤30` | P | → `Paged<GameRowDTO>`; `meta.total` (capped 10,000) **on page 1 only**, `limit=0` → counts only (AP-38). Replay games only (§14 Q3) | as PLY-2 | as PLY-1 | edge | — | 10 |
| PLY-4 | `GET /api/players/{username}/stats?pool` | P | → `PlayerStatsDTO` (Replay games) | as PLY-2 | as PLY-1 | edge | — | 10 |
| PLY-5 | `GET /api/players/{username}/milestones` | P | → `{ achieved: MilestoneItem[], next: MilestoneItem[] }` | as PLY-2 | as PLY-1 | edge | — | 10 |
| PLY-6 | `GET /api/players/search?q&limit≤8` | P | → `{ items: PlayerCard[] }` (no block filter; private users by name) | — | `public-static` s-maxage 300, tag `player-search` | `search` 30 / 60 s by ip | — | 10 |
| PLY-7 | `GET /api/players/{username}/me` (`players/[username]/me/route.ts`) | U | → `PlayerViewer` (§7.2) | `not_found` | `no-store` | `player-viewer` 120 / 60 s | — | 10 |
| PLY-8 | `GET /api/me/players/search?q&limit≤8` | U | → `{ items: PlayerCard[] }` excluding users who blocked the viewer | — | `no-store` | `search` 30 / 60 s | — | 10 |
| ME-19 | `GET /api/me/rating-history?pool` | U | → `RatingHistory` (own, all sources) | — | `private-etag` | — | — | 10 |
| ME-20 | `GET /api/me/stats?pool` | U | → `PlayerStatsDTO` (own, all sources) | — | `private-etag` | — | — | 10 |
| ME-21 | `GET /api/me/milestones` | U | → `{ achieved, next }` | — | `private-etag` | — | — | 10 |
| G1 (P3) | `GET /api/me/games` | M (lapsed read under the flag) | P3's `GamesQuery` **+ `src` (csv of `replay,chesscom,lichess`) and `legend` (bool)**, additive, WP1 edit | P3's | P3's | P3's | — | 10 |
| ME-6a | `GET /api/me/profile` | U | → `MyProfile` | — | `no-store` | — | — | 10 |
| ME-6b | `PATCH /api/me/profile` | U | `UpdateProfileBody` → `MyProfile` | `validation_failed` (`details.issues`), `conflict {reason:"avatar_missing"}` | `no-store` | `profile-write` 30 / 60 s | — | 30 |
| ME-8 | `POST /api/me/avatar/upload-url` | U | `{ contentType: "image/webp"\|"image/png"\|"image/jpeg", bytes ≤ 2_097_152 }` → `{ uploadUrl, method:"PUT", headers, key, publicUrl, expiresAt }` | `payload_too_large` | `no-store` | `avatar` 10 / 3600 s durable | — | 10 |
| SYS-7 | `GET /api/usernames/availability?u` | U | → `{ available, reason?: "taken"\|"reserved"\|"invalid"\|"cooldown", suggestion?, nextChangeAt? }` | — | `no-store` | `username` 30 / 60 s | — | 10 |
| ME-7 | `PATCH /api/me/username` | U | `{ username }` → `{ username, usernameKey, nextChangeAt }` | `conflict {reason:"username_taken"}`, `forbidden {reason:"cooldown", until}`, `validation_failed {reason:"reserved"\|"invalid"}` | `no-store` | `account-danger` 5 / 3600 s durable | — | 10 |
| ME-3a (P9) | `GET /api/me/preferences` | U | → `PrefsData { prefs, version, updatedAt }` | — | `private-etag` (`ETag: "<prefsVersion>"`) | — | — | 10 |
| ME-3b (P9) | `PATCH /api/me/preferences` | U | `PrefsPatchBody` → `PrefsData` (merged; unknown keys stripped) | `validation_failed` (type errors only) | `no-store` | `prefs` 120 / 60 s | — | 10 |
| W8 (P5) | `PATCH /api/train/prefs` | U (member for the training fields) | P5's `TrainPrefsPatch` **extended by P10**: `{ timeZone?, bankDailyCap? (5..30, step 5), newPerDay? (0..10, ≤ cap), releaseHour? (6..12), dayStartHour? (0..6), autoGrade? }` → `TrainPrefs` (all six) | `validation_failed` | `no-store` | `train-write` 120 / 60 s (P5) | natural | 10 |
| ME-9a | `GET /api/me/push-subscriptions` | U | → `{ items: [{ id, platform, createdAt, lastSuccessAt, disabled }] }` | — | `no-store` | — | — | 10 |
| ME-9b | `POST /api/me/push-subscriptions` | U | `PushSubscriptionBody` → 201 `{ id, nextReminderAt \| null }` (upsert by endpoint; re-assigns an endpoint to the caller) | — | `no-store` | `push` 10 / 3600 s durable | — | 10 |
| ME-10a | `DELETE /api/me/push-subscriptions/{id}` | O | → 204 | `not_found` | `no-store` | `push` | — | 10 |
| ME-10b | `POST /api/me/push-subscriptions/{id}/test` | O | → 202 `{ notificationId }` | `not_found`, `conflict {reason:"subscription_disabled"}` | `no-store` | `push-test` 5 / 3600 s durable | — | 10 |
| ME-17a | `GET /email/unsubscribe?t=` (page `WEB/app/email/unsubscribe/page.tsx`) | signed token | renders "Stop {kind} emails?" with one [Unsubscribe] button that POSTs ME-17b; **no write on GET** (mail scanners prefetch links) | bad token → "This link has expired." | `no-store` | edge | — | 10 |
| ME-17b | `POST /api/email/unsubscribe?t=` | signed token | RFC 8058 body `List-Unsubscribe=One-Click` or the page's form → 200 (then the page shows "You won't get these emails any more." with a link to Settings) | `gone` (bad token) | `no-store` | edge | — | 10 |
| ME-18 | `POST /api/push/clicked` | signed id | `{ id: notificationRef, sig }` (beacon, `text/plain` accepted) → 204 | — | `no-store` | edge | — | 10 |
| ME-12a | `POST /api/me/blocks` | U | `{ username }` → 201 `{ username, blockedAt }` (idempotent) | `not_found`, `validation_failed {reason:"self"}` | `no-store` | `block` 30 / 3600 s durable | — | 10 |
| ME-12b | `DELETE /api/me/blocks/{username}` | U | → 204 | — | `no-store` | `block` | — | 10 |
| SYS-6 (P5 W7) | `POST /api/reports` (P5's handler; P10 adds two branches) | U | P5's `ReportBody`, now a discriminated union on `targetType`: P5's `"mistake"\|"puzzle"` plus P10's `{ targetType:"user", targetRef: userRef, reason: "cheating"\|"abuse"\|"inappropriate_name"\|"other", note? }` and `{ targetType:"game", targetRef: gameRef, reportedUserRef, reason, note? }` → 201 `ReportResult { ref, duplicate }` | `not_found` (target not visible to the viewer) | `no-store` | `report` 20 / 86400 s durable (P5's bucket) | header | 10 |
| P10-1 | `POST /api/me/games/review-batch` | M | `{ refs: Ref[] (1..50) }` → `{ queued, alreadyDone, skipped: [{ ref, reason: "not_player"\|"not_finished"\|"in_progress"\|"too_short" }] }` | — | `no-store` | `review-batch` 10 / 3600 s durable | header | 10 |
| P10-2 | `GET /api/me/games/export.pgn?refs=…(≤500)\|all=1` | M | → `text/x-chess-pgn` stream, `Content-Disposition: attachment; filename="replaychess-{username}-{YYYY-MM-DD}.pgn"` | `validation_failed` (> 500) | `private, no-store` | `export-pgn` 20 / 3600 s durable | — | 30 (`supportsCancellation`, AP-02) |
| ME-13a | `POST /api/me/export` | U | → 202 `ExportStatusDTO` | `in_flight` (queued/running), `rate_limited` (one per 24 h from the `data_export_jobs` row; `retryAfterSec`) | `no-store` | `account-danger` | header | 10 |
| ME-13b | `GET /api/me/export` | U | → `ExportStatusDTO` | — | `private-etag` (`ETag: "<ref>.<status>"`) | — | — | 10 |
| ME-13c | `GET /api/me/export/download` | U | → 302 to a presigned R2 GET (10 min, `response-content-disposition`) | `not_found`, `gone` (expired) | `no-store` | `export-dl` 20 / 3600 s durable | — | 10 |
| ME-14 | `GET /api/me/deletion-preview` | U | → `DeletionPreview` | — | `no-store` | — | — | 10 |
| ME-15 | `DELETE /api/me` (`me/route.ts`, next to P1's GET) | U + Clerk step-up `has({ reverification: "strict" })` (≤ 10 min) | `{ confirm }` → `{ deleted: true, emailMasked }` | `validation_failed {reason:"confirm_mismatch"}`, `reverification_required`, `conflict {reason:"in_game"\|"last_admin"\|"hosting_tournament"}` | `no-store` | `account-danger` | — (state guard) | 30 |
| BIL-3 | `GET /api/billing/membership` | U | → `MembershipView` (**DB only**) | — | `private-etag` (`ETag: "<state>.<subscriptionUpdatedAt>"`) | — | — | 10 |
| BIL-15 | `POST /api/billing/refresh` | U | `{}` → `MembershipView` (retrieves the one subscription from Dodo, applies it through the `subscriptionSourceAt` compare-and-set with Dodo's `updated_at` as the event time, derives again) | `upstream_unavailable {kind:"refresh"}` (body still carries the DB view in `details.membership`) | `no-store` | `billing-refresh` 1 / 10 s and 30 / 3600 s durable | natural | 30 |
| BIL-4 | `GET /api/billing/details` | U | → `BillingDetails` (degraded `{card:null, invoices:[], degraded:true}` on Dodo timeout, still 200) | — | `no-store` (server data cache 300 s, tag `billing:{customerId}`) | — | — | 30 |
| BIL-5 | `GET /api/billing/invoices/{paymentId}` | O (customer match) | → `application/pdf` stream | `not_found` | `private, no-store` + `Content-Disposition: attachment` | `invoice` 30 / 3600 s durable | — | 30 |
| BIL-14 | `POST /api/billing/portal` | U | `{ returnPath? }` → `{ url }` | `not_found {reason:"no_customer"}` | `no-store` | `billing-action` 10 / 60 s | — | 30 |
| BIL-7 | `POST /api/subscription/change-plan` (KEEP + envelope) | U | `{ plan }` → `{ membership, message, change, paymentLink \| null }` | `conflict {reason:"same_plan"\|"not_active"\|"payment_declined"}`, 402 `payment_update_required`, `upstream_unavailable {kind:"error"}` | `no-store` | `billing-action` | **required** | 30 |
| BIL-8 | `POST /api/subscription/change-plan/preview` (KEEP) | U | `{ plan }` → `PlanChangePreview` (`subscription-action-rules.ts:199-220`) + `{ change, estimate }` | `upstream_unavailable {kind:"timeout"}` after 4 s | `no-store` | `billing-action` | — | 30 |
| BIL-9 | `DELETE /api/subscription/change-plan` (KEEP) | U | → `{ membership }` | `conflict {reason:"no_scheduled_change"}` | `no-store` | `billing-action` | — | 30 |
| BIL-10 | `POST /api/subscription/cancel` (KEEP + fields) | U | `{ feedback: CancellationFeedback, comment?: string ≤ 1000, offerShown: "pause"\|"yearly"\|"both"\|"none" }` → `{ membership, message }` | `conflict {reason:"already_cancelling"\|"ended"}` | `no-store` | `billing-action` | — | 30 |
| BIL-11 | `POST /api/subscription/resume` (KEEP + pause) | U | `{ what?: "cancellation"\|"pause" }` → `{ membership, message }` | `conflict {reason:"nothing_to_resume"\|"ended"}` | `no-store` | `billing-action` | — | 30 |
| BIL-12 | `POST /api/subscription/pause` | U | `{ months: 1 }` → `{ membership, message }` | `conflict {reason:"trial_active"\|"already_cancelling"\|"already_paused"\|"paused_recently"\|"not_active"}`, 402 `payment_update_required` (past due), `upstream_unavailable {kind:"error"}` | `no-store` | `billing-action` | **required** | 30 |
| BIL-13 | `POST /api/subscription/payment-method` | U | `{}` → `{ paymentLink, expiresOn }` | `not_found {reason:"no_subscription"}`, `upstream_unavailable {kind:"error"}` | `no-store` | `billing-action` | **required** | 30 |
| ALIAS | `GET /api/customer-portal` | U | 302 to the portal for one release (registered GET side effect `portal_session`) | — | `no-store` | `billing-action` | — | 30 |
| ALIAS | `GET /api/profile/{referenceId}` | P | → PLY-1 body + `Deprecation: true` for one release | — | as PLY-1 | edge | — | 10 |
| INT-P1 | `POST /api/internal/account-purge/{deletionId}/{step}` (`step ∈ dodo_cancel, clerk_delete`) | I | `{ v: 1 }` → `{ status: "done"\|"skipped" }` | `upstream_unavailable {kind:"error"}` (retryable) | `no-store` | — | natural (step state) | 30 |
| INT-P2 | `POST /api/internal/billing/pause-edge` | I | `{ v:1, userRef, edge: "start"\|"end" }` → `{ state }` (re-derives entitlement, syncs Clerk claims, emits `entitlement:changed {cause:"pause_start"\|"pause_end"}`) | — | `no-store` | — | natural | 30 |
| INT-P3 | `POST /api/internal/billing/customer-sync` | I | `{ v:1, userRef }` → `{ status }` (`dodo.customers.update` with the current email; the Dodo key lives on web) | `upstream_unavailable` | `no-store` | — | natural | 30 |
| DEV-1 | `POST /api/dev/billing/simulate?state=past_due\|paused\|switching\|expired` | T | applies a synthetic snapshot to the caller's row via `applySubscriptionSnapshot(…, {source:"dev"})` | — | `no-store` | — | — | 10 |
| DEV-2…6 | `GET /api/dev/jobs?mine=1`, `POST /api/dev/push-sink/{token}`, `GET /api/dev/notifications?kind`, `GET /api/dev/account-deletions/latest`, `POST /api/dev/fixtures/game` | T | dev inspection and fixtures for e2e (§12.5) | — | `no-store` | — | — | 10 |

Rate-limit buckets P10 adds (`WEB/lib/rate-limit-buckets.ts`, P1 format `{ bucket, limit, windowSec, by, store }`): `profile-write` 30 / 60 s, `player-viewer` 120 / 60 s, `avatar` 10 / 3600 s durable, `prefs` 120 / 60 s (also applied to P9's PATCH, consistency 9.8), `push` 10 / 3600 s durable, `push-test` 5 / 3600 s durable, `block` 30 / 3600 s durable, `review-batch` 10 / 3600 s durable, `export-pgn` 20 / 3600 s durable, `export-dl` 20 / 3600 s durable, `invoice` 30 / 3600 s durable, `billing-action` 10 / 60 s, `billing-refresh` 1 / 10 s + 30 / 3600 s durable, `account-danger` 5 / 3600 s durable. Reused: `search`, `username` (burst), `report` (P5, durable), `train-write` (P5). The wrapper fails at module load when a `windowSec > 300` spec is not `durable` (AP-11).

### 7.2 Contracts (zod 4, `CT/http/*.ts`)

Client bundles never import these schemas for response parsing in production (api-perf AP-12: `api()` parses only in dev/test). Form validation on `/profile/edit` and the username field uses `CT/http/profile.rules.ts` (plain regexes, lengths and messages, no zod); the zod schemas below are built from the same constants, so client and server agree.

```ts
// CT/http/players.ts
export const Pool = z.enum(["bullet", "blitz", "rapid", "classical", "daily"]);   // = P2 TimeClass, lowercased on the wire
export const ReplayUsername = z.string().regex(USERNAME_RE);                          // §8.6, from profile.rules.ts
export const PlayerCard = z.strictObject({
  username: ReplayUsername, displayName: z.string().max(24), initials: z.string().max(2),
  avatarUrl: z.string().url().nullable(), headline: z.strictObject({ label: z.string(), rating: z.number().int() }).nullable(),
});
/** PLY-1. The same body for every caller; never contains viewer-specific data (D1). */
export const PlayerPublic = z.strictObject({
  player: PlayerCard.extend({
    bio: z.string().max(160).nullable(),                 // null when access = limited
    countryCode: z.string().length(2).nullable(),
    joinedAt: z.string().datetime(),
    visibility: z.enum(["public", "private"]),
    ratings: z.record(Pool, z.strictObject({ rating: z.number().int(), peak: z.number().int(), games: z.number().int(), provisional: z.boolean() })),
    gamesTotal: z.number().int().nullable(),              // null when access = limited
    linked: z.array(z.strictObject({ provider: z.enum(["chesscom", "lichess"]), username: z.string(), rating: z.number().int().nullable() })),
    ref: z.string(),                                      // userRef (presence watch, report target)
  }),
  access: z.enum(["full", "limited"]),                   // limited = PRIVATE target
  overview: z.strictObject({
    defaultPool: Pool,
    ratingHistory: RatingHistory.nullable(),              // for defaultPool
    recentGames: z.array(GameRowDTO).max(6),              // P3 contract (CT/http/games.ts), Replay games only
    strengths: z.strictObject({ costsMost: z.string(), clock: z.string(), strength: z.string(), href: z.string() }).nullable(),
    strengthsProgress: z.strictObject({ analysed: z.number().int(), needed: z.literal(20) }),
    milestones: z.array(MilestoneItem).max(4),
  }).nullable(),                                          // null when access = limited
  states: z.strictObject({ newUser: z.boolean(), notLinked: z.boolean() }),
});
/** PLY-7. Per-viewer bits, no-store. */
export const PlayerViewer = z.strictObject({
  relation: z.enum(["self", "member", "non_member"]),
  access: z.enum(["full", "limited"]),                   // limited also when the target blocked the viewer (not revealed as such)
  canChallenge: z.boolean(), blocked: z.boolean(),        // blocked = the viewer blocked the target
  presenceTicket: z.string().nullable(),                  // §8.8; null unless full + member viewer + not self
  h2h: z.strictObject({ w: z.number().int(), d: z.number().int(), l: z.number().int(),
        recent: z.array(z.strictObject({ gameRef: z.string(), playedAt: z.string().datetime() })).max(5),   // report dialog "optional game"
        last: z.strictObject({ gameRef: z.string(), summary: z.string(), playedAt: z.string().datetime(), href: z.string() }).nullable() }).nullable(),
});
/** Own profile page (RSC only, never an API body): PlayerPublic with all sources + PlayerViewer {relation:"self"}. */
export const RatingHistory = z.strictObject({
  pool: Pool, points: z.array(z.tuple([z.number().int() /* epoch s */, z.number().int()])).max(60),
  first: z.number().int().nullable(), last: z.number().int().nullable(),
  peak: z.number().int().nullable(), peakAt: z.string().datetime().nullable(), delta: z.number().int().nullable(),
  aria: z.string(),                                       // "blitz rating over 90 days, from 1146 to 1184, peak 1231"
});
export const PlayerGamesQuery = z.object({
  result: z.enum(["win", "loss", "draw"]).optional(),
  src: z.string().regex(/^(replay|chesscom|lichess)(,(replay|chesscom|lichess))*$/).optional(),   // ignored on PLY-3 (Replay only)
  legend: z.coerce.boolean().optional(), q: z.string().trim().min(2).max(40).optional(),
  pool: Pool.optional(), cursor: Cursor, limit: z.coerce.number().int().min(0).max(30).default(30),
});
export const PlayerStatsDTO = z.strictObject({
  pool: Pool, window: z.literal("90d"), games: z.number().int(), wins: z.number().int(), draws: z.number().int(), losses: z.number().int(),
  statLine: z.string().max(200).nullable(),               // template (§8.15); no LLM version is scheduled
  phases: z.strictObject({ opening: PhaseAcc, middlegame: PhaseAcc, endgame: PhaseAcc }),   // PhaseAcc = { you: number|null, band: number|null, analysed: int }
  band: z.strictObject({ lo: z.number().int(), hi: z.number().int(), label: z.string() }).nullable(),
  pendingAnalysis: z.number().int(),
  highlights: z.strictObject({
    highest: z.strictObject({ rating: z.number().int(), at: z.string().datetime() }).nullable(),
    bestWin: z.strictObject({ opponent: z.string(), rating: z.number().int(), gameRef: z.string(), title: z.string().nullable(), at: z.string().datetime() }).nullable(),
    bestStreak: z.strictObject({ n: z.number().int(), from: z.string().datetime(), to: z.string().datetime() }).nullable(),
    avgOpponent: z.number().int().nullable(),
  }),
  byColour: z.strictObject({ whiteScorePct: z.number().int().nullable(), blackScorePct: z.number().int().nullable() }),
  enough: z.boolean(),                                    // games >= 5
});
export const MilestoneItem = z.strictObject({
  kind: z.string(), key: z.string(), title: z.string(), detail: z.string().nullable(), fen: z.string().nullable(),
  href: z.string().nullable(), progress: z.number().int(), target: z.number().int(), achievedAt: z.string().datetime().nullable(),
});

// CT/http/profile.ts (messages and patterns from CT/http/profile.rules.ts)
export const DisplayName = z.string().trim().min(3, MSG.nameShort).max(24, MSG.nameLong).regex(DISPLAY_NAME_RE, MSG.nameChars);
export const Bio = z.string().trim().max(160, MSG.bioLong).refine((s) => !BIO_LINK_RE.test(s), MSG.bioLink);
export const UpdateProfileBody = z.strictObject({
  displayName: DisplayName.optional(), bio: Bio.nullable().optional(),
  countryCode: z.string().regex(/^[A-Z]{2}$/).nullable().optional(),
  visibility: z.enum(["public", "private"]).optional(),
  avatar: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("upload"), key: z.string().regex(/^avatars\/c[a-z0-9]{20,31}\/[0-9a-f-]{36}\.(webp|png|jpg)$/) }),
    z.strictObject({ kind: z.literal("initials") }),
  ]).optional(),
}).refine((b) => Object.keys(b).length > 0, "Nothing to update");
export const MyProfile = z.strictObject({
  username: ReplayUsername.nullable(), displayName: z.string(), initials: z.string(), bio: z.string().nullable(),
  countryCode: z.string().nullable(), visibility: z.enum(["public", "private"]), avatarUrl: z.string().nullable(),
  headlineRating: z.string().nullable(), usernameChangeableAt: z.string().datetime().nullable(),
});

// DBP/json/preferences.ts (P9 created PreferencesV1; P10 owns these leaves). Re-exported as @repo/contracts/http/preferences.
export const PreferencesV1 = z.object({
  v: z.literal(1).default(1),
  board: z.object({
    theme: z.enum(["graphite", "walnut", "sage", "contrast"]).default("graphite"),
    coords: z.enum(["off", "outside", "inside"]).default("inside"),
    lastMove: z.boolean().default(true), legalMoves: z.boolean().default(true),
    orientation: z.enum(["auto", "white"]).default("auto"),
    input: z.enum(["click", "drag", "both"]).default("both"),
    premove: z.enum(["off", "one", "three"]).default("one"),
    autoQueen: z.boolean().default(false), tapConfirm: z.boolean().default(false),
  }).default({}),
  pieces: z.object({
    set: z.enum(["replaychess"]).default("replaychess"),
    shadow: z.enum(["classic", "flat"]).default("classic"),
    size: z.enum(["standard", "large"]).default("standard"),
    animation: z.enum(["off", "fast", "normal"]).default("normal"),
    materialDiff: z.boolean().default(true),
  }).default({}),
  sound: z.object({
    volume: z.number().int().min(0).max(100).default(60),
    board: z.boolean().default(true), lowTimeTick: z.boolean().default(true),
    coachVoice: z.boolean().default(true), voiceRate: z.enum(["0.9", "1", "1.2"]).default("1"),
  }).default({}),
  appearance: z.object({
    theme: z.enum(["light", "dark", "system"]).default("system"),
    dimBoardInDark: z.boolean().default(true),
    motion: z.enum(["system", "reduce", "full"]).default("system"),
    language: z.enum(["en"]).default("en"),
    singleKeyShortcuts: z.boolean().default(true),        // P1 ShortcutsDialog switch, now synced
  }).default({}),
  notifications: z.object({
    channels: z.object({
      challenge:         Channel.default({ push: true,  email: false }),
      tournament_start:  Channel.default({ push: true,  email: true  }),
      tournament_new:    Channel.default({ push: false, email: false }),   // new row (§4.10)
      review_ready:      Channel.default({ push: true,  email: false }),
      mistakes_due:      Channel.default({ push: true,  email: false }),
      weekly_progress:   Channel.default({ push: false, email: true  }),
      product_news:      Channel.default({ push: false, email: false }),
    }).default({}),
    reminderTime: z.enum(["08:00", "13:00", "19:00", "21:30"]).default("19:00"),
    quietHours: z.object({ enabled: z.boolean().default(true), start: z.literal("22:00").default("22:00"), end: z.literal("08:00").default("08:00") }).default({}),
    // no time-zone leaf: User.timeZone is the only stored zone (§0.2). A P9-era `timezone` leaf, if present, is ignored.
  }).default({}),
  training: z.object({                                     // P6's weakness scope, written through patchPreferences() by TR-12
    weakness: z.object({ timeClasses: z.array(z.enum(["BULLET", "BLITZ", "RAPID", "CLASSICAL"])).min(1).max(4),
                         months: z.union([z.literal(3), z.literal(6), z.literal(12)]) }).optional(),
  }).default({}),
  play: PlayPrefs.default({}),                             // P9 (botStrength)
});
const Channel = z.object({ push: z.boolean(), email: z.boolean() });
export const PrefsPatchBody = z.object({ patch: PreferencesV1Patch /* deep partial, unknown keys stripped */, baseVersion: z.number().int().min(0) });  // P9

// PKG/contracts/src/http/train.ts (P5's file; P10 extends TrainPrefsPatch, P5 §7.1 "P10 adds the rest")
export const TrainPrefsPatch = z.strictObject({
  timeZone: z.string().max(64).refine(isIanaTimeZone, "Unknown time zone").optional(),
  bankDailyCap: z.number().int().min(5).max(30).multipleOf(5).optional(),
  newPerDay: z.number().int().min(0).max(10).optional(),
  releaseHour: z.number().int().min(6).max(12).optional(),
  dayStartHour: z.number().int().min(0).max(6).optional(),
  autoGrade: z.boolean().optional(),
}).refine((b) => Object.keys(b).length > 0, "Nothing to update");   // newPerDay ≤ cap checked against the stored cap in the route
export const TrainPrefs = z.object({ timeZone: z.string(), bankDailyCap: z.number().int(), newPerDay: z.number().int(),
  releaseHour: z.number().int(), dayStartHour: z.number().int(), autoGrade: z.boolean() });

// CT/http/notifications.ts
export const PushSubscriptionBody = z.strictObject({
  endpoint: z.string().url().max(1024).refine((u) => u.startsWith("https://"), "https only"),
  keys: z.strictObject({ p256dh: z.string().max(120), auth: z.string().max(40) }),
  platform: z.enum(["web", "ios_pwa", "android", "desktop"]), userAgent: z.string().max(200).optional(),
  oldEndpoint: z.string().url().max(1024).optional(),     // pushsubscriptionchange
});

// PKG/contracts/src/http/reports.ts (P5's file) — P10 turns ReportBody into a union and adds two members
export const ReportBody = z.discriminatedUnion("targetType", [
  P5MistakeOrPuzzleReport,                                 // P5's existing strictObject, targetType "mistake" | "puzzle"
  z.strictObject({ targetType: z.literal("user"), targetRef: z.string().max(64) /* userRef */,
    reason: z.enum(["cheating", "abuse", "inappropriate_name", "other"]), note: z.string().max(500).optional() }),
  z.strictObject({ targetType: z.literal("game"), targetRef: z.string().max(64) /* gameRef */, reportedUserRef: z.string().max(64),
    reason: z.enum(["cheating", "abuse", "other"]), note: z.string().max(500).optional() }),
]);

// CT/http/account.ts
export const ExportStatusDTO = z.strictObject({
  ref: z.string().nullable(), status: z.enum(["none", "queued", "running", "ready", "failed", "expired"]),
  requestedAt: z.string().datetime().nullable(), readyAt: z.string().datetime().nullable(),
  expiresAt: z.string().datetime().nullable(), nextAllowedAt: z.string().datetime().nullable(),
});
export const DeletionPreview = z.strictObject({
  username: z.string(), emailMasked: z.string(),
  counts: z.strictObject({ games: z.number().int(), mistakes: z.number().int(), linkedAccounts: z.number().int() }),
  membership: z.strictObject({ active: z.boolean(), inTrial: z.boolean(), periodEnd: z.string().datetime().nullable() }),
  blockers: z.array(z.enum(["in_game", "last_admin", "hosting_tournament"])),
});
export const DeleteAccountBody = z.strictObject({ confirm: z.string().max(20) });

// CT/http/billing.ts
export const MembershipViewState = z.enum(["active", "active_yearly", "trial", "trial_cancelled", "cancelling", "switching",
  "past_due", "legacy", "expired", "free", "paused"]);            // loading/error are client states. P1's MembershipState (me.ts) is a different, coarser enum
export const MembershipView = z.strictObject({
  state: MembershipViewState,
  plan: z.strictObject({ key: z.enum(["monthly", "yearly", "legacy"]).nullable(), name: z.enum(["Coaching", "Original plan"]).nullable(),
                         priceCents: z.number().int().nullable(), currency: z.literal("USD"), interval: z.enum(["month", "year"]).nullable() }),
  periodEnd: z.string().datetime().nullable(), cancelAtPeriodEnd: z.boolean(), cancelledAt: z.string().datetime().nullable(),
  trial: z.strictObject({ active: z.boolean(), used: z.boolean(), startedAt: z.string().datetime().nullable(),
                          endsAt: z.string().datetime().nullable(), day: z.number().int().nullable(), daysLeft: z.number().int() }),
  scheduledChange: z.strictObject({ planKey: z.enum(["monthly", "yearly"]), effectiveAt: z.string().datetime() }).nullable(),
  pause: z.strictObject({ phase: z.enum(["scheduled", "active"]), from: z.string().datetime(), until: z.string().datetime() }).nullable(),
  payment: z.strictObject({ lastFailedAt: z.string().datetime().nullable(), reason: z.string().nullable(), nextRetryAt: z.string().datetime().nullable() }),
  actions: z.strictObject({ switchTo: z.array(z.enum(["monthly", "yearly"])), cancel: z.boolean(), resume: z.boolean(),
                            keepYearly: z.boolean(), pause: z.boolean(), cancelPause: z.boolean(), resumeNow: z.boolean(),
                            updatePayment: z.boolean(), portal: z.boolean(), renew: z.boolean(), startTrial: z.boolean() }),
  notes: z.array(z.enum(["admin_no_membership", "paywall_off"])),
  summary: z.string(),                                     // "Coaching · monthly" (settings row)
  freshness: z.strictObject({ source: z.literal("db"), subscriptionUpdatedAt: z.string().datetime().nullable() }),
});
export const BillingDetails = z.strictObject({
  card: z.strictObject({ network: z.string(), last4: z.string().length(4), expMonth: z.string(), expYear: z.string(), declined: z.boolean() }).nullable(),
  invoices: z.array(z.strictObject({ paymentId: z.string(), date: z.string().datetime(), description: z.string(),
    amountCents: z.number().int(), currency: z.string(), status: z.enum(["paid", "failed", "no_charge", "refunded"]),
    invoiceUrl: z.string().url().nullable() })).max(12),
  degraded: z.boolean(),
});

// CT/http/codes.ts additions (P10): ERROR_STATUS.reverification_required = 403; SUBSCRIPTION_REASONS += "paused";
// CONFLICT_REASONS += the §5.6 list. CT/http/me.ts: MembershipState += "paused".
// CT/internal/kick.ts additions: reason += "notify" | "export" | "purge" | "milestones" | "pause_edge"; optional runAt (ISO).
```

### 7.3 Route behaviour details

| Route | Behaviour |
|---|---|
| PLY-1…5 | `auth:"public"`; read `getPublicPlayer(usernameKey)` (data cache, tag `player:{key}`) and the tab loaders, all `relation = guest` projections (§8.7). Renamed handle → `308` with `Location: /api/players/{new}`. The wrapper asserts no `Set-Cookie` and no session read on these routes; the middleware route class `public-api` skips Clerk for them. Private target: PLY-1 returns the limited projection; PLY-2…5 return 403 `profile_private` (errors are `no-store`, so private probes always reach the function, bounded by the edge limiter) |
| PLY-3 | Same query as P3's `listMyGames` restricted to `source = 'REPLAY'` (§14 Q3) on the target's rows; rows link to `/game/{ref}` (the page decides `/review` for players); `meta.total` only when `cursor` is absent |
| PLY-7 | One statement: block `EXISTS` both ways, `canChallenge` (viewer is a member, target active, no block, viewer ≠ target), h2h aggregate on the viewer's rows (`game_players_h2h_idx`) with the last 5 game refs; then the presence ticket (HMAC, no DB) when `access = full` |
| PLY-8 | PLY-6's query plus the `NOT EXISTS user_blocks` filter for users who blocked the viewer; never returns block lists |
| ME-19…21 | Own data, all sources, private allowed; `private-etag` with the default data-hash ETag (or `users."gamesVersion"` if P3 adopts it, AP-19) |
| ME-6b | Avatar `upload` → `HEAD` the R2 object (aws4fetch): must exist, `content-length ≤ 2 MiB`, `content-type` ∈ webp/png/jpeg, key prefix `avatars/{viewer.ref}/` → set `avatarKey`, `avatarUrl = NEXT_PUBLIC_MEDIA_URL + "/" + key`; the previous object is deleted in `after()` (best effort; `R2_SWEEP`'s orphan scan is the backstop). `initials` → nulls both. Writes `audit_logs` `account.profile_updated` with the field list (table from M4). `after()`: `revalidateTag("player:"+usernameKey)`, `invalidateByTag("player:"+usernameKey)`, emit `profile:updated`, PostHog `profile_edit_saved` |
| ME-8 | presign `PUT https://<account>.r2.cloudflarestorage.com/<R2_BUCKET>/avatars/<ref>/<uuid>.<ext>` with SigV4 (`WEB/lib/r2/presign.ts`, aws4fetch `signQuery: true`), signed headers `content-type` and `content-length` = the declared `bytes`, expiry 300 s; returns the headers the client must send. [V] that R2 rejects a PUT whose headers differ from the signed ones (checked in WP1 day 1; if not, the `HEAD` check in ME-6b is the guard) |
| ME-7 | One transaction: re-check regex/reserved/history (90 days, other users) and cooldown (`usernameChangedAt > now() - 30 days` → 403); `INSERT username_history (oldKey, oldName, userId)`; `UPDATE users SET username, "usernameKey", "usernameChangedAt"=now()`; P2002 → 409 `username_taken`. `after()`: revalidate and CDN-invalidate the old and new `player:` tags, emit `profile:updated {fields:["username"]}`, `audit_logs` |
| ME-3b | `patchPreferences(userId, patch)` (`WEB/lib/services/preferences.ts`, the one writer for `prefs`, also used by P6's TR-12 and ME-17b): §5.3; derived columns recomputed (§8.10) only when `notifications.*` changed; `after()`: emit `prefs:updated`; when the reminder minute changed and the next occurrence is within 26 h, upsert that minute's `NOTIFY_REMINDERS` job and kick with `runAt` |
| W8 (P5, P10 edit) | P5's transaction plus: `newPerDay ≤ bankDailyCap` (stored or patched); when `timeZone` changes, recompute `user_settings` derived columns with `lib/prefs/derived.ts` in the same transaction and, after commit, emit `profile:updated {fields:["timeZone"]}` and upsert the next reminder job as in ME-3b |
| ME-9b | Upsert by `endpoint`; when `oldEndpoint` is given, delete that row first; `nextReminderAt` = next local reminder time if `mistakes_due.push` |
| ME-10b | Inserts `Notification {kind:TEST, dedupeKey:"test:<subRef>:<minute>", pushStatus:PENDING}` targeted at that subscription (`data.subscriptionRef`), upserts `NOTIFY_DISPATCH` (`dedupeKey 'notify-drain:<minute>'`), kicks the worker `{reason:"notify"}` |
| ME-17a/b | Token = `base64url(userRef.kind.exp).base64url(HMAC_SHA256(UNSUBSCRIBE_SECRET, payload))`, `exp` = 1 year. GET renders the confirmation page only. POST sets `prefs.notifications.channels[kind].email = false` through `patchPreferences()` (version bump + `prefs:updated`); `kind = "all"` turns off every email channel |
| ME-18 | `sig = HMAC(PUSH_CLICK_SECRET, notificationRef)`; sets `clickedAt` once (`WHERE "clickedAt" IS NULL`); PostHog `notification_clicked {kind}` |
| ME-12a/b | `INSERT … ON CONFLICT DO NOTHING` / `DELETE`; `after()`: emit `blocks:changed {username, blocked}` to the **blocker's own room** only; the socket server, which relays every user-room emit, drops its 60 s cached block set for that user when it sees the event; the blocked user is never told |
| SYS-6 (P5) | P10's branches: resolve `targetRef` (user) or `reportedUserRef` (game) to an active user the viewer can see (404 otherwise; self → 400 `validation_failed {reason:"self"}`); a game report requires the viewer to have played that game; insert `reports {targetType: USER\|GAME, targetRef, reportedUserId, reason, note}`; P5's 24-hour duplicate rule (same reporter, same `reportedUserId`) answers `{duplicate:true}` |
| P10-1 | For each ref: viewer must be a player; game finished; `games."analysisStatus" ∈ {NONE, FAILED}` → `INSERT jobs (ANALYZE_GAME, priority JOB_PRIORITY.REVIEW_BATCH, "fairSeq" = i, "dedupeKey" 'analyze:<gameId>') ON CONFLICT ("dedupeKey") DO UPDATE SET priority = GREATEST(jobs.priority, EXCLUDED.priority), "runAt" = LEAST(jobs."runAt", now())`; `DONE` → `alreadyDone`; one batched statement; `after()`: `kickWorker({reason:"opened"})` |
| P10-2 | One query `SELECT g.pgn, … FROM games g JOIN game_players gp ON gp."gameId"=g.id AND gp."userId"=$me WHERE g."referenceId" = ANY($refs)` (or keyset pages of 200 for `all=1`, capped at 2,000 games; beyond that the response ends with a PGN comment pointing to Account › Download your data); legacy games without `pgn` reconstructed from `moves` via `packages/game-core/pgn.ts`; streamed with `ReadableStream`; the page loop stops when `request.signal.aborted` (Vercel `supportsCancellation` on this function in `vercel.json`) |
| ME-13a | Transaction: reject if a `QUEUED/RUNNING` row exists (409 `in_flight`) or a row was requested < 24 h ago (429, from the row, so the limit survives Neon restarts); insert `DataExportJob` + `Job(EXPORT_BUILD, priority JOB_PRIORITY.EXPORT_BUILD, dedupeKey 'export:<userId>:<date>')`; `after()`: kick `{reason:"export"}` |
| ME-13c | Re-checks `status = READY AND expiresAt > now()`; presigned GET 600 s on `R2_PRIVATE_BUCKET`; `no-store`; PostHog `data_export_downloaded` |
| ME-14 | One `Promise.all`: counts (`game_players`, `mistakes`, `linked_accounts`), live game check (`games WHERE status='IN_PROGRESS' AND ("whitePlayerId"=$u OR "blackPlayerId"=$u)`), last-admin check, hosted upcoming tournaments |
| ME-15 | §8.12 |
| BIL-3 | `deriveMembershipView(viewerRow, ctx.now)`; never calls Dodo |
| BIL-15 | `dodo.subscriptions.retrieve(user.subscriptionId)` (8 s timeout) → `applySubscriptionSnapshot(…, {source:"api", eventTime: sub.updated_at ?? sub.created_at})` (P1 F4b compare-and-set: writes only when newer and materially different) → derive → `after()`: emit `entitlement:changed {cause:"snapshot"}` only when the row changed |
| BIL-4 | `unstable_cache(fetchBillingDetails, ["billing-details", customerId], { revalidate: 300, tags: ["billing:"+customerId] })`; inside: `Promise.all([dodo.customers.retrievePaymentMethods(customerId), dodo.payments.list({ customer_id: customerId, page_size: 12 })])` with `AbortSignal.timeout(4000)`; card = the method matching `subscription.payment_method_id` else the latest `last_used_at`; invoice description from the product (Coaching · monthly/yearly, Original plan) and `total_amount = 0` → `no_charge`; a trial with no payment yields a synthetic row from `trialStartedAt` |
| BIL-5 | `dodo.payments.retrieve(paymentId)` → `customer.customer_id === user.dodoCustomerId` else 404 → stream `dodo.invoices.payments.retrieve(paymentId)` blob with `Cache-Control: private, no-store` |
| BIL-7 | as today plus: past due → 402 `payment_update_required`; a Dodo decline → 409 `payment_declined` with Dodo's message in `message` |
| BIL-12 | §8.4 |
| BIL-13 | `dodo.subscriptions.updatePaymentMethod(subId, { payment_method: { type: "new", return_url: NEXT_PUBLIC_SITE_URL + "/settings/membership?payment=updated" } })` → `{ payment_link, expires_on }` |

### 7.4 Socket events (protocol v2, `CT/socket/user.ts` and `CT/socket/presence.ts`, registered in `CT/socket/registry.ts`)

| Direction | Event | Payload | Ack / rules |
|---|---|---|---|
| c→s | `presence:watch` | `{ targets: { userRef: string, ticket: string }[] ≤ 20 }` | ack `{ ok: true, states: PresenceState[] }`; invalid/expired ticket → that target omitted; per-socket cap 50 watched refs; rate 5 per 10 s; only entitled sockets (`ent=true`, architecture X18) |
| c→s | `presence:unwatch` | `{ userRefs: string[] }` | ack `{ ok: true }` |
| s→c | `presence:state` | `{ userRef, online: boolean, activity?: { kind: "game", gameRef, label: "Blitz 5+3", spectatable: boolean } }` | sent to watchers on connect/disconnect (after P2's 30 s grace) and game start/end; coalesced ≤ 1 per 2 s per target. Distinct from P2's game-room `presence:update` (P2 H-09) |
| s→c (user room) | `prefs:updated`, `profile:updated`, `blocks:changed`, `export:ready`, `milestone:awarded`; `entitlement:changed` (P4's, extended) | §5.4 | emitted only through `POST /internal/emit` (`{v:1, targets:[{userRef}], event, data, dedupeKey}`); `data` validated against the registry. If P2 adopts caller-scoped events (AP-44), the worker may emit only `export:ready` and `milestone:awarded` of these; the web emits the rest |

`PresenceRegistry` (`WS/src/presence/PresenceRegistry.ts`): `Map<userRef, { sockets: number, activity?: Activity }>` fed by the P2 connection lifecycle and `GameManager` start/end hooks; `Map<userRef, Set<socketId>>` for watchers. Memory ≈ 200 B per online user; no DB access.

Presence ticket (`WS/src/presence/ticket.ts`, `WEB/lib/presence/ticket.ts`): `base64url({ v:1, typ:"presence", sub: viewerRef, tgt: targetRef, exp: now+600 }).HMAC_SHA256(SOCKET_TOKEN_SECRET[kid])`; the socket checks `sub` = the socket's authenticated user and `exp`.

Block exclusions for matchmaking and challenges stay where P9 built them; P10 adds the read: the socket pairer (B4, direct Neon read through `DBP`) loads `user_blocks` for a user on `queue:join` (`WHERE "blockerId" = $u OR "blockedId" = $u`, ≤ tens of rows) and caches it 60 s, dropped early when a `blocks:changed` emit for that user passes through `/internal/emit`; `POST /api/challenges/{code}/accept` (P9) adds the same check. Edits to those P9 files are WP1's (listed in §13).

### 7.5 Webhooks

**Dodo** (`WEB/app/api/webhook/dodo-payments/route.ts`; dedupe by `webhook-id` in `WebhookEvent`, P1; every snapshot write goes through P1 F4b's `subscriptionSourceAt` compare-and-set with the event's own timestamp, api-perf AP-06):

| Event | P10 handling added to P1/P4's handler |
|---|---|
| `subscription.*` | `applySubscriptionSnapshot` also writes `scheduledPlanKey`/`scheduledChangeAt` from `scheduled_change` (product → plan key via `resolvePlanFromProductId`), `pausedAt` from `paused_at`; clears the local pause window when `next_billing_date > pausedUntil` (renewal after a pause happened) or when the status becomes terminal. `membershipEndedAt` stays P4's (`onEntitlementApplied()`). On the **first trialing snapshot** P10 adds a `TRIAL_ENDING` notification row at `trialEndsAt − 48 h` plus its `NOTIFY_DISPATCH` job (§8.17). `after()`: `revalidateTag("billing:"+customerId)`, emit `entitlement:changed {…, subscriptionUpdatedAt, cause}` when anything the client shows changed (P4 already emits on entitlement flips; P10 widens the condition and the payload) |
| `payment.failed` | P4 already sets `lastPaymentFailedAt/Reason` with the event time; P10 adds: `PAYMENT_FAILED` notification (email always, push if any device; `dedupeKey payfail:<paymentId>`) and emit `entitlement:changed {cause:"payment_failed"}` |
| `payment.succeeded` | existing customer link (`route.ts:56-68`, made case-insensitive) + clear `lastPaymentFailedAt/Reason`; revalidate `billing:`; emit `entitlement:changed {cause:"payment_succeeded"}` |
| `refund.*`, `dispute.*` | revalidate `billing:`; `audit_logs` (BILLING); Sentry warning |

**Clerk** (`WEB/app/api/webhook/clerk/route.ts`, svix, P1; **P10 owns this file during P10∥P11**, feasibility §10.16):

| Event | P10 handling |
|---|---|
| `user.created` | after P1's upsert: assign a username (§8.6 generator, retried on P2002), `displayName = first_name + last_name` trimmed to 24 |
| `user.updated` | when the primary **verified** email changed: `UPDATE users SET email` (+ `audit_logs account.email_changed`, no addresses in meta), then `after()`: `dodo.customers.update(customerId, { email })`; failure → `Job(DODO_CUSTOMER_SYNC, priority JOB_PRIORITY.DODO_SYNC, dedupeKey 'dodocust:<userId>')` whose handler calls INT-P3. Never touches `displayName`/`avatarUrl` |
| `user.deleted` | `deleteAccount({ userId, source: "clerk" })` if the row still exists (idempotent; skips the `clerk_delete` step) |

### 7.6 Service worker (`WEB/worker/push.ts`, imported by P11's `WEB/worker/index.ts`)

P11 owns `WEB/worker/index.ts` and its bundling (next-pwa `customWorkerSrc` or Serwist `swSrc`); P10 owns `WEB/worker/push.ts` and exports `registerPushHandlers(self)`. If P10 merges first it creates a minimal `index.ts` that only imports `./push` (consistency/P11 §13.3). The handlers must survive P11's SW rewrite (P11's `sw-on` regression project runs `notifications.spec.ts`).

```ts
// WEB/worker/push.ts
export function registerPushHandlers(self: ServiceWorkerGlobalScope) {
  self.addEventListener("push", (e) => {
    const d = e.data?.json() as { id: string; sig: string; title: string; body: string; url: string; tag: string; kind: string };
    e.waitUntil(self.registration.showNotification(d.title, {
      body: d.body, tag: d.tag, renotify: d.kind === "TEST", icon: "/icons/icon-192x192.png", badge: "/icons/badge-72.png",
      data: { url: d.url, id: d.id, sig: d.sig },
    }));
  });
  self.addEventListener("notificationclick", (e) => {
    e.notification.close();
    const { url, id, sig } = e.notification.data;
    e.waitUntil((async () => {
      fetch("/api/push/clicked", { method: "POST", body: JSON.stringify({ id, sig }), keepalive: true, credentials: "omit" });
      const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const same = all.find((c) => new URL(c.url).origin === self.location.origin);
      if (same) { await same.focus(); return same.navigate(url); }
      return self.clients.openWindow(url);
    })());
  });
  self.addEventListener("pushsubscriptionchange", (e) => { /* re-subscribe with the VAPID key and POST /api/me/push-subscriptions {…, oldEndpoint} */ });
}
```

The SW keeps P1's rules: `/api/*` NetworkOnly, purge on sign-out (client-data-layer §7.1). Unit test `WEB/worker/push.test.ts` drives the handlers with a fake `ServiceWorkerGlobalScope`.

### 7.7 Cron

`GET /api/cron/daily` (API-15, `C` auth, `maxDuration = 60`) gains two task modules in `WEB/lib/cron/tasks/` (directory registry; the route file stays P1's):

- **`membership-reconcile.ts`** (inv-acct #40): up to 50 users from `users_billing_reconcile_idx` (oldest `subscriptionUpdatedAt` > 24 h), `dodo.subscriptions.retrieve` with concurrency 5 and 8 s timeouts, `applySubscriptionSnapshot(…, {source:"reconcile", eventTime: sub.updated_at})` (the compare-and-set writes only when newer and materially different); budget 20 s; summary `{checked, changed, failed}` logged and returned. This task **replaces P1's 6-hour auto-refresh on read** (api-perf AP-31): no GET refreshes from Dodo. It also re-enqueues `ACCOUNT_PURGE` for `account_deletions_open_idx` rows older than 1 h with no queued job (belt and braces).
- **`trial-reminder-backstop.ts`** (§8.17): users from `users_trial_ending_idx` with `"trialEndsAt"` in 24–72 h, still trialing and not `cancelAtPeriodEnd` → `INSERT notifications (TRIAL_ENDING …) ON CONFLICT ("dedupeKey") DO NOTHING` + the dispatch job; returns `{inserted}`.

### 7.8 Worker jobs and planner slices (`WK/src/jobs/{account,notify}/*.ts`, `WK/src/scheduler/recurring/p10-*.ts`)

**Scheduling rule (D9).** Nothing in P10 wakes on a timer. Work is a `jobs` row with a `runAt`; the worker keeps `nextRunAt = min(runAt)` in memory (from each drain's final read and from every kick's `runAt`) and sleeps until then. Recurring work is planned by **slices** that P3's scheduler calls with a window while Neon is awake: `export const slice: PlannerSlice = { name, plan(tx, { from, to, now }) }`. With P3's daily `HOUSEKEEPING` planner the window is the next 26 h; if P3 ships `HOURLY_TICK` instead, the same slices run with a 1-hour window and nothing else changes.

| Slice (`WK/src/scheduler/recurring/`) | Plans |
|---|---|
| `p10-reminders.ts` | one `NOTIFY_REMINDERS` row per distinct `reminderUtcMinute` that has ≥ 1 member with reminders on, at that minute's next instant in the window (`dedupeKey 'rem:<UTC date>:<minute>'`); merge rule `REMINDER_MAX_RUNS_PER_DAY` (§8.11) |
| `p10-weekly.ts` | on Saturday/Sunday windows: one `NOTIFY_WEEKLY` row per distinct `User.timeZone` with ≥ 1 weekly opt-in, at Sunday 18:00 local (`dedupeKey 'wk:<tz>:<isoWeek>'`) |
| `p10-dst.ts` | runs inline: zones whose offset differs between `from` and `to` get their derived columns recomputed (one batched `UPDATE … FROM (VALUES …)`, ≤ a few hundred rows), before `p10-reminders` plans |
| `p10-milestones.ts` | backstop: one `MILESTONES_EVALUATE` per user with a `training_days` row for yesterday or a `tournament_participants."finalRank" ≤ 3` finalized in the window (the event hooks below normally got there first; dedupe makes the backstop free) |
| `p10-housekeeping.ts` | runs inline with P3's `HOUSEKEEPING`: delete `notifications` older than 90 days and `username_history` older than 90 days (batched 1,000); `R2_SWEEP` row for now |

| Kind | Trigger | `runAt` | Lane / priority (`JOB_PRIORITY`) | `dedupeKey` | Work | Retries |
|---|---|---|---|---|---|---|
| `MILESTONES_EVALUATE` | P3 analysis completion hook (`afterAnalysis`); import finished; **P5 session end (W4 `after()`, one line, WP3)**; P12 finalize (`after()`, one line handed to P12); B14 backfill; planner backstop | now + 60 s (debounce: `ON CONFLICT DO UPDATE SET "runAt" = GREATEST(jobs."runAt", EXCLUDED."runAt")` while QUEUED) | I / `MILESTONES` (10) | `ms:<userId>` | evaluate §8.9 catalogue in one read batch; upsert `user_milestones`; for newly achieved: emit `milestone:awarded` (unless `silent`) and set `notifiedAt` | 3 |
| `NOTIFY_REMINDERS` | planner slice; ME-3b / W8 `after()` when a change lands inside the planned window | that minute | I / `NOTIFY` (30) | `rem:<UTC date>:<minute>` | §8.11 selection → `INSERT notifications … ON CONFLICT DO NOTHING` (dedupe `mistakes_due:<userRef>:<localDate>`) → drain in the same run | 3 |
| `NOTIFY_WEEKLY` | planner slice | Sunday 18:00 local | I / `NOTIFY` | `wk:<tz>:<isoWeek>` | per user in the zone with `WEEKLY_PROGRESS` email or push on and ≥ 1 game or attempt in the week: build the summary → Notification (dedupe `weekly:<userRef>:<isoWeek>`) → drain | 3 |
| `NOTIFY_DISPATCH` | every producer insert (web routes, worker jobs) upserts one at the notification's `runAt` (quiet-hours deferrals and retries included) and kicks with `runAt` | the notification's `runAt` | I / `NOTIFY` | `notify-drain:<runAt minute>` | drain `notifications_pending_idx` in batches of 100 with `SKIP LOCKED` until empty; push to every enabled subscription (web-push concurrency 10, TTL per kind), email via Resend after reserving the budget (§8.11), set statuses; HTTP 404/410 → delete subscription; 5 consecutive failures → `disabledAt`; a retry upserts the next `NOTIFY_DISPATCH` at the retry time | per row: 4 attempts (60 s, 10 min, 1 h) |
| `EXPORT_BUILD` | ME-13a | now | I / `EXPORT_BUILD` (70) | `export:<userId>:<date>` | §8.13; then email (`ACCOUNT` Notification, email only) + emit `export:ready` | 3 (15 s, 2 min, 10 min) then `FAILED` + email "Your export didn't finish" |
| `ACCOUNT_PURGE` | ME-15 commit; Clerk `user.deleted`; cron re-enqueue | now | I / `ACCOUNT_PURGE` (90) | `purge:<accountDeletionId>` | §8.12 step machine | per step 10 (1 min → 6 h), each retry a future-dated row; `dodo_cancel` final failure pages the owner |
| `MEMBERSHIP_PAUSE_EDGE` | pause created (two rows: `start` at `pausedFrom`, `end` at `pausedUntil + 6 h`) | as named | I / `PAUSE_EDGE` (60) | `pause:<userId>:<edge>:<date>` | `start`: INT-P2 `{edge:"start"}` (claims + `entitlement:changed`). `end`: if no renewal webhook arrived (pause window still set), INT-P2 `{edge:"end"}`, which refreshes from Dodo through BIL-15's function | 5 |
| `DODO_CUSTOMER_SYNC` | Clerk `user.updated` failure path | now | I / `DODO_SYNC` (20) | `dodocust:<userId>` | INT-P3 | 5 |
| `R2_SWEEP` | planner (daily, with `HOUSEKEEPING`) | the planner run | I / `HOUSEKEEPING` (0) | `cron:R2_SWEEP:<date>` | expired exports (`data_export_jobs_ready_idx` → status EXPIRED, delete object); orphaned `avatars/*` older than 24 h with no `users."avatarKey"` reference (list by prefix, 1,000 per run) | next day |

### 7.9 Third-party integrations

| Service | Calls (P10) | Where | Limits / notes |
|---|---|---|---|
| Dodo Payments (SDK `dodopayments` 2.49) | `subscriptions.retrieve`, `.update` (`next_billing_date` for D6; `cancel_at_next_billing_date`, `cancellation_feedback`, `cancellation_comment`; `status: "cancelled"` on account deletion), `.changePlan`, `.previewChangePlan`, `.cancelChangePlan`, `.updatePaymentMethod`; `customers.retrievePaymentMethods`, `customers.update`, `customers.customerPortal.create`; `payments.list`, `payments.retrieve`; `invoices.payments.retrieve` (checked in the Dodo SDK docs on 2026-11-02) | web only (billing routes, BIL-15, INT-P1/P2/P3, cron) | 8 s per call (4 s for details/preview); never on a GET (AP-31); test mode on dev |
| Clerk | client: `user.createEmailAddress`, `prepareVerification`, `attemptVerification`, `user.update`, `updatePassword`, `useReverification`; server: `auth().has({ reverification: "strict" })`, `clerkClient.users.deleteUser` (purge step), `clerkClient.users.updateUserMetadata` (claims, P1) | web | development instance on dev |
| Cloudflare R2 | presigned PUT (avatars, public bucket `R2_BUCKET` = `replay-chess-media`), presigned GET (exports, private bucket `R2_PRIVATE_BUCKET`), HEAD, DELETE, multipart upload (worker), lifecycle rule `exports/` expire after 8 days; media host Transform Rule adds `X-Content-Type-Options: nosniff` and `Content-Security-Policy: default-src 'none'; img-src 'self'` (D11) | web (`WEB/lib/r2/presign.ts`, aws4fetch), worker (`@aws-sdk/client-s3` + `lib-storage`) | CORS on the media bucket: `PUT` from the dev and prod app origins, headers `content-type`, `content-length` |
| Resend | `POST /emails` with `List-Unsubscribe: <{NEXT_PUBLIC_SITE_URL}/api/email/unsubscribe?t=…>, <mailto:unsubscribe@playchess.tech?subject=…>` + `List-Unsubscribe-Post: List-Unsubscribe=One-Click`; templates in `WK/src/notify/email/templates/*.ts` (plain HTML + text, no React Email dependency). **Set up by P10 (WP3 task 3.0)**: domain `playchess.tech` verified in Resend, DKIM/SPF/DMARC records added DNS-only in the Cloudflare zone, one API key per environment, `mail-tester` score ≥ 9 before weekly emails turn on | worker | free plan 100/day, 3,000/month [V]: budget in §8.11 and §9.6 |
| Web Push | `web-push` 3.x `sendNotification(sub, payload, { TTL, urgency, topic, vapidDetails })` | worker only (VAPID private key never on Vercel) | payload ≤ 3 KB; TTL: MISTAKES_DUE 4 h, CHALLENGE 1 h, REVIEW_READY 12 h, TRIAL_ENDING 24 h, TEST 60 s; urgency `normal` (`high` for TOURNAMENT_STARTING) |
| PostHog | server events (`posthog-node` in `after()`, marked `consentExempt` in the event registry); person deletion: look up the person by `distinct_id` (`GET /api/projects/{id}/persons/?distinct_id=…`) and `DELETE /api/projects/{id}/persons/{personId}/` (or the bulk-delete endpoint with `distinct_ids`, whichever the current API documents [V]) with a personal API key scoped to persons | web (events), worker (delete step) | consent rules from P11 for client events |
| Lichess | `DELETE https://lichess.org/api/token` with the decrypted token — **only if P4 still stores the token**; under feasibility F-API-3 (token revoked right after the initial import) the step is `skipped` | worker (purge) | P4's token crypto |

### 7.10 Environment variables (new or newly used in P10; add to `turbo.json` `globalEnv`; names per consistency R-09)

| Name | Vercel (web) | OCI worker | OCI socket | Notes |
|---|---|---|---|---|
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | yes | — | — | `npx web-push generate-vapid-keys`; one pair per environment |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT=mailto:hello@playchess.tech` | — | yes | — | private key only on OCI (GitHub secrets `WORKER_ENV_FILE` / `WORKER_DEV_ENV_FILE`) |
| `RESEND_API_KEY`, `EMAIL_FROM="ReplayChess <hello@playchess.tech>"` | only if P11's contact form needs it | yes | — | created by P10 WP3 task 3.0; P10 sends email only from the worker |
| `UNSUBSCRIBE_SECRET`, `PUSH_CLICK_SECRET` | yes | yes | — | 32-byte random; separate per environment |
| `R2_PRIVATE_BUCKET` (`replay-chess-private`) | yes | yes | — | plus the existing `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` (token scoped to both buckets); P13's manifest must list it |
| `NEXT_PUBLIC_MEDIA_URL` | yes (exists) | yes | — | avatar public base |
| `POSTHOG_PERSONAL_API_KEY`, `POSTHOG_PROJECT_ID` | — | yes | — | person-delete scope only |
| `HASH_PEPPER` | yes (P4) | yes | — | email and ref hashes in `AccountDeletion` (= P4's trial-ledger pepper; never rotated) |
| `LINK_TOKEN_KEYS` | yes (P4) | yes (P4) | — | seals `AccountDeletion.emailEnc` (and `lichessTokenEnc`); if P4 drops stored tokens (F-API-3), P10 adds `ACCOUNT_DATA_KEYS` with the same format for `emailEnc` only |
| `SOCKET_TOKEN_SECRET` (+ kid) | yes (P2) | — | yes (P2) | also signs presence tickets (`typ:"presence"`) |
| `INTERNAL_API_SECRET` (or P2's HMAC keys) | yes | yes | yes | used only through `internalFetch()` |
| `ANALYSIS_WORKER_URL`, `WS_INTERNAL_URL` | yes | — / yes | — | kick and emit targets |
| `NEXT_PUBLIC_SITE_URL` | yes | — | — | absolute links built on web (Dodo `return_url`) |
| `WEB_APP_URL` | — | yes | yes | absolute links in emails, export download links |
| `NOTIFY_SENDING=on\|off` | — | yes | — | ops kill switch for all sends (dev default `on`, CI `off` except the notification spec's local sink) |
| `REMINDER_MAX_RUNS_PER_DAY` (default 24) | — | yes | — | Neon wake cap for reminder minutes (§8.11) |
| `CLOUDFLARE_PURGE_TOKEN` (optional) | — | yes | — | zone-scoped cache purge for deleted users' avatar URLs (§8.12; owner decision) |
| `E2E_TEST_TOKEN` | yes (dev only) | — | — | header `x-e2e-token` for test hooks (testing X12); never set on production |

### 7.11 Feature flags, switches and test hooks

| Name | Kind | Scope | Effect when off |
|---|---|---|---|
| `account-v3` | PostHog flag, server-evaluated (`lib/flags/registry/p10.ts`) | owner + E2E users A–P + pool users on dev | `/@*` and `/u/*` 404 to the legacy profile, `/settings/*` (except P4's connected) render the legacy `MembershipSection` inside the shell, nav Settings hidden, the in-game "Board settings" item hidden, no P10 jobs enqueued (producers check the flag per user) |
| `tournaments-v3` (P12) | flag | — | both tournament notification rows hidden |
| `NOTIFY_SENDING` | env (worker) | environment | rows still created; dispatcher marks them `SKIPPED` with `lastError="sending_off"` |
| `LAPSED_READ` | env (P1) | environment | own Games tab falls back to the public projection for lapsed users |
| `BILLING_PAYWALL` | env (P0) | environment | Membership shows the dev banner; **on in every e2e run** (testing X3) |
| `PAUSE_MODE=defer\|dodo\|off` | env (web) | environment | D6 implementation choice after the Dodo test-mode check; `off` hides the pause offer |
| `NEXT_PUBLIC_CONSENT_BAR` (P11) | env | deployment | Privacy group hidden |

Test hooks P10 registers in `WEB/lib/test-hooks/registry.ts` (each guarded by `isNonProd()` + `x-e2e-token`, proven 404 or ignored by P1's `prod-guard.spec.ts`): `POST /api/dev/billing/simulate`, `GET /api/dev/jobs`, `POST /api/dev/push-sink/{token}`, `GET /api/dev/notifications`, `GET /api/dev/account-deletions/latest`, `POST /api/dev/fixtures/game`, the `?debugReminder=1` "+20 min" option (UI hook, `isNonProd()` only), and `/dev/ui/account/*` demo routes (P1's existing `/dev/ui` guard).

---

## 8. Domain logic

All of this lives in pure modules (no DB, no network) so it is unit-tested directly: `WEB/lib/billing/membership-view.ts`, `WEB/lib/billing/pause-rules.ts`, `WEB/lib/profile/{username,visibility,rating-history,stats}.ts`, `WEB/lib/prefs/{merge,derived}.ts`, `WEB/lib/notify/{schedule,quiet-hours,dispatch-rules,email-budget,trial-ending}.ts`, `WEB/lib/milestones/definitions.ts` (imported by WK through the workspace), `WEB/lib/account/deletion-plan.ts`.

### 8.1 Membership state (`deriveMembershipView(row, now)`)

Inputs (all in `VIEWER_SELECT`): `ENTITLEMENT_SELECT` (`entitlement.ts:19-30`), `role`, `scheduledPlanKey`, `scheduledChangeAt`, `pausedFrom`, `pausedUntil`, `lastPausedAt`, `lastPaymentFailedAt`, `lastPaymentFailureReason`, `membershipEndedAt`. Plan key from `resolvePlanFromProductId(subscriptionProductId)` (`plans.ts`). `entitled = isEntitled(record, now)` where P10 extends `isEntitled` (`entitlement-rules.ts:56-74`) with: **`if (pausedFrom && pausedUntil && pausedFrom <= now && now < pausedUntil) return false`**.

First match wins:

| # | Condition | State |
|---|---|---|
| 1 | `!subscriptionId` | `trialStartedAt ? "expired" : "free"` |
| 2 | `status === "pending"` | `free` ("Checkout not finished") |
| 3 | `pausedFrom && now < pausedUntil` (scheduled or active), or `status === "paused"` (D6 fallback) | `paused` (`pause.phase = now < pausedFrom ? "scheduled" : "active"`) |
| 4 | `trial.active && cancelAtPeriodEnd` | `trial_cancelled` |
| 5 | `trial.active` | `trial` |
| 6 | `entitled && status ∈ {on_hold, past_due}` | `past_due` |
| 7 | `entitled && cancelAtPeriodEnd` | `cancelling` |
| 8 | `entitled && scheduledPlanKey && scheduledChangeAt > now` | `switching` |
| 9 | `!entitled` | `expired` |
| 10 | `planKey === "legacy"` or unknown product | `legacy` |
| 11 | `interval === "year"` | `active_yearly` |
| 12 | otherwise | `active` |

Actions per state (drives the buttons; the server re-checks every action):

| State | `switchTo` | cancel | resume | keepYearly | pause | cancelPause | resumeNow | updatePayment | renew | startTrial |
|---|---|---|---|---|---|---|---|---|---|---|
| active | `[yearly]` | ✓ | | | ✓ if `pauseEligible` | | | | | |
| active_yearly | `[monthly]` | ✓ | | | ✓ if eligible | | | | | |
| legacy | `[monthly, yearly]` | ✓ | | | ✓ if eligible | | | | | |
| trial | `[yearly]` (or `[monthly]` on a yearly trial) | ✓ (trial copy) | | | | | | | | |
| trial_cancelled | | | ✓ ("Keep my trial") | | | | | | | |
| cancelling | | | ✓ | | | | | | | |
| switching | | | | ✓ | | | | | | |
| past_due | | | | | | | | ✓ | | |
| paused (scheduled) | | | | | | ✓ | | | | |
| paused (active) | | | | | | | ✓ | | | |
| expired | | | | | | | | | ✓ | |
| free | | | | | | | | | | ✓ (`trial.eligible`) else renew |

`pauseEligible = (state ∈ {active, active_yearly, legacy}) && !cancelAtPeriodEnd && !lastPausedAt-within-365-days && PAUSE_MODE !== "off"`. `portal = !!dodoCustomerId`. Notes: `admin_no_membership` when `role = ADMIN && state ∈ {free, expired}`; `paywall_off` when `BILLING_PAYWALL=off`. `summary`: `free → "No membership"`, `trial*/trial → "Coaching · trial"`, `paused → "Coaching · paused"`, else `"{plan name} · {pill text lowercased}"`, matching the board's `M.summary` rule (`V4Membership.dc.html`).

Dates render in the viewer's locale and `User.timeZone` with `Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric", timeZone })` → "12 Nov 2026" (today's `formatMembershipDate` is en-US only, `subscription-action-rules.ts:304-309`); short forms "21 Oct" when the year is the current one.

### 8.2 Trial day maths

`elapsedDays = (now − trialStartedAt) / 86 400 000`; **`day = min(7, floor(elapsedDays) + 1)`**; **`daysLeft = trialDaysLeft(trialEndsAt, now) = ceil((trialEndsAt − now) / 1 day)`** (`trial-rules.ts:37-41`). For a 7-day trial and non-integer `elapsedDays`, `day + daysLeft = 8`, so the board's "DAY 3 OF 7" and "5 days left" are consistent (inv-acct's inconsistency note does not hold). First-charge date = `trialEndsAt` (Dodo's first `next_billing_date`).

### 8.3 Plan switch amounts

- Prices from `BILLING_PLANS` (`plans.ts`): monthly 499 ¢, yearly 5,000 ¢, legacy 800 ¢.
- "save 16%": `round((1 − 5000 / (499 × 12)) × 100) = round(16.5) = 16` (floor to avoid overstating: `floor(16.5) = 16`).
- "works out at $4.17 a month": `ceil(5000 / 12) / 100 = 4.17`.
- The confirmed amount is **only** Dodo's `immediateChargeCents` formatted with `formatMinorUnits` (`subscription-action-rules.ts:292-301`); never a client recomputation.
- `preview_unavailable` estimate: `unusedFraction = clamp((periodEnd − now) / (periodEnd − periodStart), 0, 1)` where `periodStart = periodEnd − 1 interval`; `estimateCents = yearPrice − round(unusedFraction × currentPrice)`; displayed rounded to dollars ("about $2" refers to the credit `round(unusedFraction × currentPrice / 100)`). Example from the board: 13 of 30 days unused → `round(13/30 × 499) = 216` → $2.16 credit → $47.84.
- Rules (`availablePlanChanges`, `decidePlanChange`, `subscription-action-rules.ts:84-148`): monthly → yearly upgrade now, prorated; yearly → monthly at `next_billing_date`, `do_not_bill`; legacy → either, as upgrade; in a trial every switch is `next_billing_date` + `do_not_bill`; `on_payment_failure: "prevent_change"`; only `status === "active"` and not cancelling (`cancelling` hides Switch, inv-acct Q24).

### 8.4 Pause (D6)

```ts
// WEB/lib/billing/pause-rules.ts
export function decidePause(v: MembershipView, row: PauseRow, now: Date):
  | { ok: true; from: Date; until: Date; newNextBillingDate: Date }
  | { ok: false; reason: "trial_active" | "already_cancelling" | "past_due" | "already_paused" | "paused_recently" | "not_active" } {
  if (v.trial.active) return { ok: false, reason: "trial_active" };
  if (v.state === "cancelling") return { ok: false, reason: "already_cancelling" };
  if (v.state === "past_due") return { ok: false, reason: "past_due" };
  if (v.state === "paused") return { ok: false, reason: "already_paused" };
  if (row.lastPausedAt && now.getTime() - row.lastPausedAt.getTime() < 365 * DAY) return { ok: false, reason: "paused_recently" };
  if (!["active", "active_yearly", "legacy"].includes(v.state) || !row.currentPeriodEnd) return { ok: false, reason: "not_active" };
  const from = row.currentPeriodEnd;                       // access continues through the paid period
  const until = addMonthsUtc(from, 1);                     // same day-of-month, clamped (Jan 31 → Feb 28/29)
  return { ok: true, from, until, newNextBillingDate: until };
}
```

`POST /api/subscription/pause` (`PAUSE_MODE=defer`):

1. `getOwnedSubscription()` (`subscription-actions.ts:70-134`) → fresh Dodo state; `decidePause()`.
2. `dodo.subscriptions.update(id, { next_billing_date: until.toISOString() })`.
3. `UPDATE users SET "pausedFrom"=$from, "pausedUntil"=$until, "lastPausedAt"=now() WHERE id=$u AND "pausedFrom" IS NULL`.
4. Enqueue `MEMBERSHIP_PAUSE_EDGE` `start` at `from` and `end` at `until + 6 h`.
5. `respondAfterMutation` → `{ membership }` (`paused`, phase `scheduled`). PostHog `membership_paused`.

Edges: at `from`, the start job calls INT-P2, which re-derives (now not entitled), runs `syncClerkClaims` (middleware starts redirecting member-only routes to `/settings/membership`, §11.4) and emits `entitlement:changed`. At `until`, Dodo charges by itself; the `subscription.renewed` webhook moves `currentPeriodEnd` past `pausedUntil`, the webhook clears the pause columns and access returns. If the charge fails, the normal `on_hold` → `past_due` path applies. The `end` job (6 h later) refreshes from Dodo if the window is still set.

**Cancel pause** (scheduled phase, `POST /api/subscription/resume {what:"pause"}`): `update(id, { next_billing_date: pausedFrom })`, clear the columns, delete the queued edge jobs. **Resume now** (active phase): clear the local window (access returns immediately) and keep Dodo's `next_billing_date = pausedUntil` (the member gets the remaining paused days free; no surprise charge). Copy on the button's confirm: "Your next charge stays on 12 Dec."

Copy values: "No charge in {month(from, tz)}" (the skipped charge is the one on `from`), "Everything resumes on {date(until)}".

**Test-mode verification before the build (§14 Q2):** (a) `update { next_billing_date }` accepted on an `active` monthly test subscription; (b) no charge, credit or proration line created; (c) the next renewal happens on the new date (Dodo test "simulate renewal"); (d) `subscription.updated` webhook carries the new `next_billing_date`. If (a)–(c) fail, set `PAUSE_MODE=dodo`: step 2 becomes a `start`-edge call `update { pause: true }` and the `end` edge calls `update { pause: false }`; `isEntitled` treats `status = paused` as no access (today's behaviour, `entitlement-rules.ts:56-74`).

### 8.5 Cancel flow rules

- Offer step shown for paid states (`active`, `active_yearly`, `legacy`); `trial` gets `trial_offer`; nothing else can open the modal.
- Offer A (pause) shown when `pauseEligible`; Offer B (yearly) shown for `active` (monthly) and `legacy`; if neither is available the modal opens at `reason` with "Step 1 of 1".
- `offerShown` sent with the cancel = which offers were rendered (`pause`, `yearly`, `both`, `none`), so PostHog can compute save rates (`cancel_offer_taken / cancel_flow_opened` per offer).
- Cancel = `cancel_at_next_billing_date: true` with `cancel_reason: "cancelled_by_customer"`, `cancellation_feedback`, `cancellation_comment` (`cancel/route.ts:65-70`); access stays until `currentPeriodEnd`; trial cancel means never charged.

### 8.6 Usernames

- **Regex** `^[A-Za-z0-9][A-Za-z0-9_]{2,19}$` (3–20 chars, starts with a letter or digit, letters/digits/underscore), stored as typed; `usernameKey = username.toLowerCase()`.
- **Reserved** (`WEB/lib/profile/reserved.ts`, exact keys and prefixes): `admin, administrator, api, app, settings, profile, play, train, review, learn, legends, openings, tournaments, tournament, home, help, support, contact, pricing, blog, about, terms, privacy, login, signin, signup, sign_in, sign_up, logout, me, u, p, null, undefined, root, system, deleted, replaychess, replay_chess, playchess, chess, moderator, mod, staff, official`; prefixes `admin_`, `replaychess_`, `support_`; plus a small profanity list (`WEB/lib/profile/blocked-words.ts`, substring match on the key).
- **Availability** (`reason` order): `invalid` (regex) → `reserved` → `taken` (`users.usernameKey` of another user, or `username_history.oldKey` changed < 90 days ago by another user) → `cooldown` (only for the caller: `usernameChangedAt > now − 30 days` → `nextChangeAt = usernameChangedAt + 30 days`).
- **Suggestion** when taken: first free of `{u}_{n}` for `n = 2..9`, then `{u}{yy}` (two-digit year).
- **Generator** (Clerk `user.created`, backfill B8): Chess.com/Lichess handle if valid and free → `slug(firstName+lastName)` (NFKD, strip marks, non `[a-z0-9]` → `_`, collapse `_`, trim to 14, pad with `player` if < 3) + `_` + 4 base32 chars from `code` → collision suffix `_2…`.
- **Redirect**: `/@old` → `UsernameHistory.oldKey` hit (< 90 days) → 308 `/@{current}`; after 90 days the key is free and the `p10-housekeeping` planner slice deletes the row.

### 8.7 Visibility projection (`WEB/lib/profile/visibility.ts`)

Two pure functions, so the public routes can never depend on the viewer: `publicProjection(target)` (used by PLY-1…5, `/p/[u]` and the public part of `/u/[u]`) and `viewerProjection(viewer, target, blocks)` (PLY-7 and the per-viewer part of `/u/[u]`).

| Viewer \ target | PUBLIC | PRIVATE | Target blocked the viewer | Viewer blocked the target |
|---|---|---|---|---|
| public projection (everyone, incl. guests and crawlers) | full (Replay games only), noindex | limited (name, rating, linked chips) | — (public data stays public) | — |
| self (own page, `/api/me/*`) | full, all sources | full, all sources | — | — |
| member (`viewerProjection`) | full + presence ticket + h2h + Challenge | limited; Challenge shown | **limited, no Challenge, no presence, no h2h** — rendered exactly like a private profile (does not reveal the block) | full, Challenge hidden, menu shows Unblock |
| non-member (signed in) | full, CTAs → `/pricing`, no presence | limited | limited | full |
| inactive or deleted target | 404 | 404 | 404 | 404 |

`limited` omits `bio`, `gamesTotal`, `overview`; the public sub-resources return 403 `forbidden {reason:"profile_private"}` for a PRIVATE target. Tournament standings are not affected (public context, inv-acct §2.6). Imported games appear only on the owner's own view (§14 Q3; default: `source = REPLAY` in every public projection).

### 8.8 Presence

- Watch only with a valid ticket (D8); the registry answers `online` when the user has ≥ 1 connected socket after the P2 30 s disconnect grace; the event is `presence:state`.
- `activity` only for games where `spectatable` per P2's spectate rules (members only; quick and tournament games public; friend games private, api-design Q2). A private target, a blocking relation in either direction and a non-member viewer never get a ticket, so no presence leaks.
- "Watch live" → `/game/{ref}?spectate=1`; spectating a game the viewer plays redirects to the player view (P2).

### 8.9 Milestones v1 (`WEB/lib/milestones/definitions.ts`; product copy needs owner sign-off, §14 Q8)

| `kind` | `key` | Title template | Target | Evaluator (one batched read per user) | Lights up |
|---|---|---|---|---|---|
| `FIRST_REVIEW` | "" | "First game reviewed" | 1 | `count(*) FROM game_players gp JOIN games g ON g.id = gp."gameId" WHERE gp."userId" = $u AND g."analysisStatus" = 'DONE'` | P10 |
| `REVIEWS_100` | "" | "First 100 games reviewed" | 100 | same count (progress) | P10 |
| `RATING_PEAK` | pool | "New {pool} high: {peak}" | 1 | `player_ratings.peak` vs stored `meta.peak`; re-awarded (title + `achievedAt` updated) when the peak rises by ≥ 10 after ≥ 5 rated games | P10 (P9 data) |
| `STREAK_7` | "" | "7-day training streak" | 7 | `training_profiles."dayStreakBest"` | P10 (P5 data) |
| `BANK_FIXED_50` | "" | "50 mistakes fixed" | 50 | `count(training_cards WHERE deck='BANK' AND state='REVIEW' AND stability ≥ 21)` | P10 (P5 data) |
| `MATE_LIKE_LEGEND` | legend slug | "Mate like {legend}" | 1 | a won `LEGEND_BOT` game on a position of that legend with `games."endMethod" = 'CHECKMATE'` | P10 (P8 data) |
| `LEGEND_SET` | legend slug | "Play all {n} {legend} positions" | n | distinct `chessPositionId` played among the legend's practice set | P10 (P8 data) |
| `TOURNAMENT_PODIUM` | tournament slug | "Top 3 in {name}" | 1 | `tournament_participants."finalRank" ≤ 3` for a `COMPLETED` tournament (P12 writes `finalRank` at finalize); the evaluator skips the kind while the column does not exist | **P10 defines and evaluates; lights up with P12's data** (coverage C-23) |

Evaluation is idempotent: `INSERT … ON CONFLICT ("userId", kind, key) DO UPDATE SET progress = EXCLUDED.progress, "achievedAt" = COALESCE(user_milestones."achievedAt", EXCLUDED."achievedAt"), …`; a toast is emitted only when `achievedAt` goes from null to set and `notifiedAt` is null (then `notifiedAt = now()`). NEXT goals = the 2 unachieved definitions with the highest `progress / target`. FEN for the mini board: the final position (`games.fen`) of the game that triggered it (legend kinds), else a fixed decorative position per kind.

### 8.10 Preference merge and derived columns

- **One writer** (`WEB/lib/services/preferences.ts#patchPreferences(userId, patch, opts)`): ME-3b, ME-17b (unsubscribe) and P6's TR-12 scope write all call it, so every change bumps `"prefsVersion"`, recomputes derived columns when needed and emits `prefs:updated`. If P6 merged first with its raw `jsonb_set … version = version + 1` (P6 §7.1.2, which also names the column wrongly), WP2 replaces that statement with the call (one-line edit).
- **Merge** (`lib/prefs/merge.ts`): `merged = PreferencesV1.parse(deepMerge(stored, patch))`; arrays replace, objects merge per key; unknown keys stripped; `null` in a patch resets the leaf to its default.
- **Derived** (`lib/prefs/derived.ts`, run in the PATCH transaction, in P5's W8 when `timeZone` changes, and by the `p10-dst` slice), with `tz = users."timeZone"`:
  - `offset(tz, at)` = minutes east of UTC at instant `at` from `Intl.DateTimeFormat(…, { timeZone: tz, timeZoneName: "shortOffset" })`.
  - `nextLocal(hh:mm)` = the next instant when local time in `tz` is `hh:mm`.
  - `reminderUtcMinute = remindersOn ? ((h·60 + m) − offset(tz, nextLocal(reminderTime))) mod 1440 : null`, where `remindersOn = channels.mistakes_due.push || channels.mistakes_due.email`.
  - `quietStartUtcMinute = (22·60 − offset) mod 1440`, `quietEndUtcMinute = (8·60 − offset) mod 1440` when quiet hours are on, else null.
  - `emailOptIns` / `pushOptIns` = the channel keys mapped to `NotificationKind` (`challenge → CHALLENGE`, `tournament_start → TOURNAMENT_STARTING`, `tournament_new → TOURNAMENT_NEW`, `review_ready → REVIEW_READY`, `mistakes_due → MISTAKES_DUE`, `weekly_progress → WEEKLY_PROGRESS`, `product_news → PRODUCT_NEWS`).
  - Fixtures: `Asia/Kolkata` (+330) 19:00 → 810; `Asia/Kathmandu` (+345) 19:00 → 795; `America/New_York` 19:00 → 1380 in summer (−240) and 0 in winter (−300); `Australia/Lord_Howe` (+630/+660); `Pacific/Chatham` (+765/+825).
- **DST pass**: the `p10-dst` planner slice recomputes rows for zones whose offset changes inside the planning window, before reminders are planned.

### 8.11 Reminders, weekly digest, quiet hours, email budget, dispatch

**Planning (`p10-reminders` slice, D9).** In the planner window `[from, to)`:

```sql
SELECT "reminderUtcMinute" AS m, count(*) AS n
FROM user_settings WHERE "reminderUtcMinute" IS NOT NULL GROUP BY 1;     -- index-only on user_settings_reminder_idx
```

For each minute `m` with `n ≥ 1`, insert `jobs (NOTIFY_REMINDERS, runAt = next instant of m in the window, dedupeKey 'rem:<UTC date>:<m>') ON CONFLICT DO NOTHING`. **Wake cap:** when the window holds more than `REMINDER_MAX_RUNS_PER_DAY` (24) distinct minutes, the planner merges the closest neighbouring minutes (the later minute absorbs the earlier one, so no reminder is ever early) until the cap holds, and records the merge lag; real distributions (an India-heavy audience, four reminder times) stay far below the cap. Each run costs one Neon wake unless members are active at that minute anyway (19:00 IST is peak traffic); at ≈ 0.02 CU-h per wake (0.25 CU × 5 min), 12 runs a day ≈ 7 CU-h a month, the largest P10 line in §9.6.

A setting change inside the window (ME-3b, W8) upserts the new minute's row in `after()` and kicks the worker with `runAt`, so the worker's in-memory `nextRunAt` moves earlier without a query.

**Run (`NOTIFY_REMINDERS` for minute m):**

```sql
SELECT u.id, u."referenceId", u."timeZone", s.prefs->'notifications'->'channels'->'mistakes_due' AS ch,
       (SELECT count(*) FROM training_cards c WHERE c."userId" = u.id AND c.deck = 'BANK' AND c.due <= now()
          AND (c."suspendedUntil" IS NULL OR c."suspendedUntil" <= now())) AS due
FROM user_settings s JOIN users u ON u.id = s."userId"
WHERE s."reminderUtcMinute" = $m AND u."isActive"
  AND u."subscriptionStatus" IS NOT NULL;                       -- members only (re-checked with isEntitled in code)
```

then one query `SELECT "userId" FROM training_days WHERE "userId" = ANY($ids) AND day = ANY($localDays) AND "bankReviewed" > 0` (each user's local day computed in TypeScript from `timeZone` and `TrainingProfile.dayStartHour`) removes members who already trained today. Rows with `due ≥ 1` and `isEntitled` → `Notification { kind: MISTAKES_DUE, dedupeKey: "mistakes_due:<ref>:<localDate>", title: "ReplayChess", body: "{due} mistakes are due. About {ceil(due × 0.6)} minutes.", url: "/train", pushStatus: ch.push && hasSubscription ? PENDING : SKIPPED, emailStatus: ch.email ? PENDING : SKIPPED }` in one batched `INSERT … ON CONFLICT DO NOTHING`, then the run drains them directly (no second job). Reminder copy uses 36 s per card (P5 session pacing) rounded up to whole minutes, matching the board's "6 mistakes are due. About 4 minutes."

**Quiet hours** (`lib/notify/quiet-hours.ts`): local window `[22:00, 08:00)`; a notification whose local send time falls inside is deferred: `runAt = next 08:00 local` (and a `NOTIFY_DISPATCH` row at that time), except `TOURNAMENT_STARTING`, `ACCOUNT`, `TRIAL_ENDING` email and `TEST`. Reminder times 08:00 and 21:30 are outside the window by construction.

**Weekly** (`NOTIFY_WEEKLY`, Sunday 18:00 local): summary of the ISO week: games played, average accuracy and its change versus the previous week, mistakes fixed (bank reviews graded ≥ Good), streak; skipped when the week had no activity.

**Email budget (D17).** One logged row per UTC day (Prisma model `EmailBudgetDay`, §6.3; table `email_budget_days (day date PK, total int, bulk int)`):

```sql
-- reserve one send; no row back = over budget
INSERT INTO email_budget_days (day, total, bulk) VALUES (current_date, 1, $isBulk::int)
ON CONFLICT (day) DO UPDATE SET total = email_budget_days.total + 1, bulk = email_budget_days.bulk + EXCLUDED.bulk
WHERE email_budget_days.total < CASE WHEN EXCLUDED.bulk = 1 THEN 70 ELSE 90 END
RETURNING total;
```

Bulk kinds (`WEEKLY_PROGRESS`, `MISTAKES_DUE` email, `PRODUCT_NEWS`, `REVIEW_READY` email) may use the first 70 of the day; transactional kinds (`ACCOUNT`, `PAYMENT_FAILED`, `TRIAL_ENDING`) up to 90, so 20 are always left for them (feasibility §2.5). Once per drain the dispatcher also reads `sum(total)` for the month and treats ≥ 2,900 as over budget for bulk kinds (Resend free: 100/day, 3,000/month [V]). An over-budget bulk email is deferred 24 h (its `runAt` and a dispatch row move to the next day, in user-id order); an over-budget transactional email raises a Sentry error and retries in 1 h. Rows older than 60 days are pruned by `p10-housekeeping`.

**Dispatch rules** (`lib/notify/dispatch-rules.ts`):

| Kind | Push default | Email default | Push TTL | Respects quiet hours | Producer (phase) |
|---|---|---|---|---|---|
| `TEST` | ✓ (one device) | — | 60 s | no | ME-10b (P10) |
| `MISTAKES_DUE` | channel | channel | 4 h | yes | `NOTIFY_REMINDERS` (P10) |
| `WEEKLY_PROGRESS` | channel | channel | 24 h | yes | `NOTIFY_WEEKLY` (P10) |
| `REVIEW_READY` | channel | channel | 12 h | yes | P3 analysis hook via `afterAnalysis()`, only when the analysis took > 2 min or the user had no live socket at completion (worker asks the socket server `GET /internal/presence/{ref}` through `internalFetch`) (P10) |
| `CHALLENGE` | channel | channel | 1 h | yes | **P9's `POST /api/challenges/{code}/accept`**: notifies the link's creator "martin_k accepted your challenge. The game is starting." when the creator has no live socket (P10 adds the call; P9 has no direct challenges, so "Challenges from friends" means accepted links) |
| `ACCOUNT` (export ready, export failed, deletion confirmation) | — | always | — | no | P10 |
| `PAYMENT_FAILED` | ✓ | always | 24 h | yes (push), no (email) | Dodo webhook (P10) |
| `TRIAL_ENDING` | ✓ if any device | always | 24 h | yes (push), no (email) | Dodo webhook + cron backstop (P10, §8.17) |
| `TOURNAMENT_STARTING`, `TOURNAMENT_NEW` | channel | channel | 5 min / 24 h | starting: no | **P12** (rows created by P12's join and arena-create paths) |
| `PRODUCT_NEWS` | channel | channel | 24 h | yes | admin (later) |

Per push send: `web-push` with `{ TTL, urgency: "normal", topic: kind }`; 201 → `lastSuccessAt`, `failures = 0`; 404/410 → delete the subscription; 413 → truncate body and retry once; 429/5xx → `failures++`, retry with back-off; `failures ≥ 5` → `disabledAt = now()` (the Notifications page then shows `push_off` for that device). A notification is `SENT` when ≥ 1 device accepted it. Push payloads carry the first name at most, never an email, and the click URL is signed (§12.1 `payload.test.ts`).

### 8.12 Account deletion (`WEB/lib/services/account-deletion.ts`, D7)

```
deleteAccount({ userId, confirm?, source: "user" | "clerk" | "admin" })
 1. Pre-flight (read-only, Promise.all):
    - row = users by id (username, email, referenceId, usernameKey, googleId, trialStartedAt, subscriptionId, dodoCustomerId, role, avatarKey)
    - source=user: confirm === row.username (exact) else 400 confirm_mismatch
    - blockers: live game (games status IN_PROGRESS with "whitePlayerId"/"blackPlayerId" = u) → 409 in_game;
      role ADMIN and count(ADMIN) = 1 → 409 last_admin; hosted tournament in LOBBY/scheduled → 409 hosting_tournament
    - lichess token (linked_accounts.tokenEnc, only if P4 still stores it), Dodo ids
    - hashes: emailHash = trialLedgerHash(email)   -- P4's WEB/lib/billing/trial-ledger.ts (normaliseEmail + HASH_PEPPER), one function
              userRefHash = sha256hex(HASH_PEPPER + "\n" + "u:" + referenceId)
 2. One transaction (SET LOCAL statement_timeout = '25s'):
    a. INSERT trial_ledger (emailHash, handleHashes) ON CONFLICT DO NOTHING      -- if trialStartedAt (P4 normally wrote it already)
    b. INSERT account_deletions (id, hashes, clerkUserId, dodo ids, lichessTokenEnc?, emailEnc (LINK_TOKEN_KEYS), r2Prefixes,
       posthogDistinctId, source, steps = {dodo_cancel: pending|skipped, clerk_delete: pending|skipped(source=clerk),
       lichess_revoke: pending|skipped(no token), r2_delete, posthog_delete, confirmation_email})
    c. Anonymise shared rows:
       UPDATE games SET "whiteName" = 'Deleted player', "whiteRating" = NULL WHERE "whitePlayerId" = $u;   -- whitePlayerId → NULL by FK
       UPDATE games SET "blackName" = 'Deleted player', "blackRating" = NULL WHERE "blackPlayerId" = $u;
       UPDATE game_players SET "opponentName" = 'Deleted player', "opponentRating" = NULL
         WHERE "gameId" IN (SELECT "gameId" FROM game_players WHERE "userId" = $u) AND "userId" <> $u;   -- opponentUserId → NULL by FK
       UPDATE tournament_participants tp SET "displayName" = 'Deleted player'
         FROM tournaments t WHERE tp."tournamentId" = t.id AND tp."userId" = $u AND t.status = 'COMPLETED';
       UPDATE reports SET "reportedUserId" = NULL WHERE "reportedUserId" = $u AND status <> 'OPEN';     -- resolved history stays, unlinked
       DELETE FROM reports WHERE "reportedUserId" = $u AND status = 'OPEN';                               -- nothing left to moderate
       UPDATE consent_records SET "userId" = NULL WHERE "userId" = $u;                                    -- P11's line (P11 §13.3), if M11 exists
    d. Delete what is only this user's:
       DELETE FROM games g WHERE g.id IN (SELECT gp."gameId" FROM game_players gp WHERE gp."userId" = $u)
         AND NOT EXISTS (SELECT 1 FROM game_players o WHERE o."gameId" = g.id AND o."userId" <> $u)   -- bot, imported, solo games
         AND (g."whitePlayerId" IS NULL OR g."whitePlayerId" = $u) AND (g."blackPlayerId" IS NULL OR g."blackPlayerId" = $u);
       DELETE FROM shares WHERE "ownerId" = $u;                                                          -- P3 REVIEW and P9 POSITION shares
       DELETE FROM tournament_participants tp USING tournaments t WHERE tp."tournamentId" = t.id AND tp."userId" = $u
         AND t.status IN ('LOBBY', 'IN_PROGRESS');
       DELETE FROM jobs WHERE "userId" = $u AND status IN ('QUEUED','WAITING') AND kind <> 'ACCOUNT_PURGE';
    e. DELETE FROM users WHERE id = $u;     -- cascades: settings, links, cursors, game_players, reviews, mistakes, cards, attempts,
                                            -- sessions, days, profiles, weakness snapshots (P6), coach threads/messages/usage (P7),
                                            -- lesson progress (P8), ratings and created challenges (P9), milestones, blocks, push, notifications, export jobs,
                                            -- username history, support requests (P11); SetNull: games creator/opponent/white/black,
                                            -- game_players.opponentUserId, finished tournament_participants.userId,
                                            -- tournaments.createdByUserId, reports.reporterId
    f. INSERT jobs (ACCOUNT_PURGE, priority JOB_PRIORITY.ACCOUNT_PURGE, dedupeKey 'purge:<deletionId>', payload {deletionId})
    g. INSERT audit_logs (ACCOUNT, 'account.deleted', actor USER|SYSTEM, targetId = userRefHash, meta {source, games, hadSubscription})
 3. after(): try dodo_cancel and clerk_delete inline (best effort, ≤ 2 × 8 s), mark steps; kick the worker {reason:"purge"};
    revalidateTag + invalidateByTag("player:"+usernameKey) so the cached public profile, its OG image and API bodies go;
    PostHog server event `account_delete_completed {source, hadSubscription, inTrial, games}` (distinct_id = old ref, exactly once;
    the person is deleted by the job)
 4. Response 200 { deleted: true, emailMasked }; the client runs signOutEverywhere() (incl. P1's Clear-Site-Data: "cache")
```

`ACCOUNT_PURGE` step machine (worker; each step `{status, attempts, lastError, doneAt}` updated with `jsonb_set` in its own statement; each retry is a future-dated job row, never a sleep):

| Step | Executor | Action | Done when |
|---|---|---|---|
| `dodo_cancel` | INT-P1 on web | `dodo.subscriptions.update(subId, { status: "cancelled" })` (verify in test mode that this cancels immediately; else `cancel_at_next_billing_date` + note) — skipped when no subscription or already terminal | Dodo returns a terminal status |
| `clerk_delete` | INT-P1 on web | `clerkClient.users.deleteUser(clerkUserId)`; 404 counts as done | then `clerkUserId = NULL` |
| `lichess_revoke` | worker | decrypt `lichessTokenEnc`, `DELETE https://lichess.org/api/token`; 401 counts as done; `skipped` when P4 keeps no token | then `lichessTokenEnc = NULL` |
| `r2_delete` | worker | list + delete `avatars/{ref}/`, `exports/{ref}/`; if `CLOUDFLARE_PURGE_TOKEN` is set, purge the avatar URLs from the media host cache (purge by URL; otherwise the UUID URLs, no longer referenced anywhere, age out of the edge) | listing empty |
| `posthog_delete` | worker | person delete by distinct id (§7.9) | 200/404 |
| `confirmation_email` | worker | Resend: "Your ReplayChess account is deleted" to the decrypted `emailEnc` (transactional budget) | then `emailEnc = NULL` |

`completedAt` set when every step is `done` or `skipped`. A `dodo_cancel` failure after 10 attempts raises a Sentry `fatal` issue with the deletion id (the person could still be charged) and the runbook `docs/runbooks/account-deletion.md` (WP5) covers manual cancellation in the Dodo dashboard.

Clerk-initiated deletes (`user.deleted`) run steps 1–4 with `source = "clerk"` and no confirmation.

**Undo window (owner option, §14 Q20, off by default).** If the owner wants a 24-hour undo (feasibility §9): `DELETE /api/me` instead sets `users."deletionRequestedAt" = now()`, `"isActive" = false`, cancels Dodo at once, signs out, and enqueues `ACCOUNT_PURGE` at `now() + 24 h` whose first step runs the transaction above; the confirmation email carries a signed "Keep my account" link that clears the two columns before the purge runs. The modal copy changes from "Can't be undone" to "You have 24 hours to change your mind". This adds one column and 0.5 dev-day.

### 8.13 Data export (`WK/src/jobs/account/export-build.ts`)

1. Claim; `DataExportJob.status = RUNNING`, `startedAt`.
2. Stream a ZIP (`archiver`, store-level for PGN, deflate 6 for JSON) into `@aws-sdk/lib-storage` `Upload` (multipart, 8 MB parts, queue size 2) to `R2_PRIVATE_BUCKET` key `exports/{userRef}/{exportRef}.zip`; memory bounded ≈ 20 MB.
3. Entries, each written by a keyset reader of 500 rows:
   - `games.pgn`: every game the user played (all sources), `Game.pgn` (P3) or reconstructed from `moves`; headers include `[Site "https://playchess.tech/review/{ref}"]`;
   - `reviews.json`: per analysed game `{ref, color, accuracy, phaseAccuracy, headline, moments: [{ply, judgement, best, played}], summary sentences}` (no engine arrays);
   - `mistake-bank.json`: mistakes with FEN, best move, themes, card state and last 3 results;
   - `training-history.json`: review logs (date, card, grade);
   - `coach.json`: coach threads and messages (user and coach text, timestamps);
   - `settings.json`: prefs, notification channels;
   - `profile.json`: username, display name, bio, country, visibility, joined, linked account **usernames** (never tokens), membership summary (plan, status, dates; no card data);
   - `README.txt`: what each file is, generated date, how to import the PGN.
4. `READY`, `readyAt`, `expiresAt = readyAt + 7 days`, `bytes`, `counts`; Notification `ACCOUNT` (email) with the link `WEB_APP_URL/api/me/export/download`; emit `export:ready`.
5. Budget: 2,000 games ≈ 3 MB PGN + 2 MB JSON → ZIP ≈ 1.5 MB, < 60 s on the 1-OCPU box with the I/O lane (no engine).

### 8.14 Rating history and the headline rating

- Source (no `rating_events` table exists, consistency R-02): the player's `game_players` rows `WHERE "userId" = $1 AND "timeClass" = $pool AND "ratingAfter" IS NOT NULL AND "endedAt" > now() − 90 days ORDER BY "endedAt"` (≤ ~300 rows, on `game_players_userId_endedAt_gameId_idx`), plus the first point = `"ratingBefore"` of the earliest row in the window (or the latest `"ratingAfter"` before it, `LIMIT 1`). Public routes add `AND source = 'REPLAY'` (ratings only move in Replay games anyway).
- Downsample to ≤ 60 points: split the window into 60 equal time buckets, keep the last point of each non-empty bucket; always keep the first point, the last point and the peak point; `peak`/`peakAt` computed before downsampling; `delta = last − first`.
- `aria` string: "{pool} rating over 90 days, from {first} to {last}, peak {peak}".
- Headline pool: the pool with the most rated games in 90 days; ties → blitz > rapid > bullet. Current rating and all-time peak from `player_ratings` (P9). Provisional (< 5 rated games in the pool): `1184?`. No Replay rating at all (imported only): the linked account's rating for that pool labelled with the provider ("CHESS.COM 1179"), from `linked_accounts.ratings` (P4), §14 Q5.

### 8.15 Stats tab (D3: computed on read)

One statement per request (`WEB/lib/data/player-stats.ts`), 90-day window, one pool; the public variant adds `AND gp.source = 'REPLAY'`:

```sql
WITH g AS (
  SELECT gp."gameId", gp.color, gp.result, gp."endedAt", gp."opponentName", gp."opponentRating", gp.accuracy,
         gp."phaseAccuracy", gp.stats, ga."analysisStatus", gp."ratingAfter"
  FROM game_players gp JOIN games ga ON ga.id = gp."gameId"            -- analysis status lives on games (R-01)
  WHERE gp."userId" = $1 AND gp."timeClass" = $2 AND gp."endedAt" > now() - interval '90 days'
), runs AS (                                   -- gaps-and-islands for the best win streak
  SELECT *, SUM(CASE WHEN result <> 'WIN' THEN 1 ELSE 0 END) OVER (ORDER BY "endedAt", "gameId") AS grp FROM g
)
SELECT
  (SELECT count(*) FROM g) AS games,
  (SELECT count(*) FILTER (WHERE result='WIN')  FROM g) AS wins,
  (SELECT count(*) FILTER (WHERE result='DRAW') FROM g) AS draws,
  (SELECT count(*) FILTER (WHERE result='LOSS') FROM g) AS losses,
  (SELECT count(*) FILTER (WHERE "analysisStatus" IN ('QUEUED','RUNNING')) FROM g) AS pending,
  (SELECT json_agg(json_build_object('pa', "phaseAccuracy", 'st', stats)) FROM g WHERE "analysisStatus" = 'DONE') AS phases,
  (SELECT json_build_object('opp', "opponentName", 'rating', "opponentRating", 'gameId', "gameId", 'at', "endedAt")
     FROM g WHERE result='WIN' AND "opponentRating" IS NOT NULL ORDER BY "opponentRating" DESC, "endedAt" DESC LIMIT 1) AS best_win,
  (SELECT json_build_object('n', count(*), 'from', min("endedAt"), 'to', max("endedAt"))
     FROM runs WHERE result='WIN' GROUP BY grp ORDER BY count(*) DESC, max("endedAt") DESC LIMIT 1) AS best_streak,
  (SELECT round(avg("opponentRating")) FROM g WHERE "opponentRating" IS NOT NULL) AS avg_opp,
  (SELECT round(100.0 * (count(*) FILTER (WHERE result='WIN') + 0.5 * count(*) FILTER (WHERE result='DRAW')) / NULLIF(count(*),0))
     FROM g WHERE color = 'w') AS white_pct,
  (SELECT round(100.0 * (count(*) FILTER (WHERE result='WIN') + 0.5 * count(*) FILTER (WHERE result='DRAW')) / NULLIF(count(*),0))
     FROM g WHERE color = 'b') AS black_pct;
```

- **Phase accuracy** per phase `p`: per game, `phaseAccuracy[p]` (M3) is Lichess's game accuracy on that phase's slice (`(weightedMean + harmonicMean) / 2` over per-move accuracy `103.1668·e^(−0.04354·ΔWin%) − 3.1669 + 1`, Win% = `50 + 50·(2/(1+e^(−0.00368208·cp)) − 1)`, research `implementation.md` §1; computed by the P3 worker). Across games: `you[p] = Σ(acc[p] · moves[p]) / Σ moves[p]` over analysed games where `acc[p] ≥ 0` (−1 = phase not reached), weights `moves[p] = stats[STATS_V1.phaseMoves + p]` (`game_players.stats`, M6 from P6); `null` when no analysed game reached the phase. Before P6 merges (no `stats` column) the weights fall back to 1 per game.
- **Band** = `[lo, lo + 200]` with `lo = clamp(round(rating / 100) × 100 − 100, 600, 2200)` from the headline pool rating; label "players rated 1100–1300"; `band[p]` from the P6 baseline JSON's `phaseAccuracy[lo]` (the P6 builder adds this field if missing; if absent the ochre tick is hidden).
- **Highest rating**: `player_ratings.peak/peakAt` for the pool (all time). **Best win** title: legend position title or `games."openingName"` (M3) of that game (one extra PK read when present).
- **statLine** (template; no LLM version is scheduled, coverage C-19): strongest phase by `you − band` → "{Name} is strongest in the {phase} ({you} vs {band} for similar players)."; second person on the own profile ("You are strongest in…"); null when < 5 analysed games.
- `enough = games ≥ 5`; otherwise the `new_user` copy for that pool.

### 8.16 Display name, bio, avatar rules

Display name: NFC-normalised, trimmed, internal whitespace collapsed, `DisplayName` schema (§7.2), not unique, reserved-word check on the lowercased name. Bio: `Bio` schema; newlines collapsed to spaces. Avatar: type `image/webp|png|jpeg`, ≤ 2 MiB declared and verified by `HEAD`, client output 256×256; initials = first letters of the first two words of `displayName ?? username`, uppercase; gradient seed = `userRef` (P1 `avatar-gradient.ts`).

### 8.17 Trial-ending reminder (moved from P4, consistency 10.17)

P4 builds no trial email (consistency 4.16), and the paid-only model with a card-on-file trial needs one before the first charge.

- **Producer.** On the first trialing snapshot (Dodo webhook, P4's `onEntitlementApplied()` hook point), P10 inserts `Notification { kind: TRIAL_ENDING, dedupeKey: "trial_ending:<userRef>:<trialEndsAt date>", runAt: trialEndsAt − 48 h, emailStatus: PENDING, pushStatus: hasSubscription ? PENDING : SKIPPED, title: "Your trial ends on {date}", body: "On {date} we charge {price} for Coaching unless you cancel. Everything stays as it is until then.", url: "/settings/membership" }` and a `NOTIFY_DISPATCH` row at the same `runAt` (so the worker wakes for it without a timer).
- **Backstop.** The daily cron task `trial-reminder-backstop` (§7.7) inserts any missing row for trials ending in 24–72 h (`ON CONFLICT DO NOTHING`), covering a lost webhook.
- **Send-time check.** The dispatcher re-reads the user: skip (`SKIPPED`, `lastError = "no_longer_trialing"`) when the trial was cancelled (`cancelAtPeriodEnd`), converted early (switch to yearly charges at the trial end anyway, so the email still goes, with the yearly price), or the account is gone.
- **Email.** Transactional budget; quiet hours apply to push only. Template `WK/src/notify/email/templates/trial-ending.ts` with the plan, price, date in `User.timeZone`, [Manage membership] and the one-trial note. No unsubscribe link (transactional), but a footer link to notification settings.
- **Copy and timing** need the owner's sign-off (§14 Q24): 48 h before the first charge by default.

---

## 9. Performance and optimisation

The scarce resources are Neon compute hours (Free: 100 CU-h/month; scale to zero after 5 idle minutes), Vercel Hobby function usage, Mumbai↔us-east RTT (~200 ms) for anything from OCI, and the 1-OCPU OCI box (optimization §1.1). P10's rules: no third-party call on R/W-class routes; public profile reads on the CDN; no timers that wake Neon except planned reminder minutes; per-viewer data computed in one parallel batch.

### 9.1 Hot paths: queries, indexes, statement budgets

| Path | Class (optimization §2.1) | Sequential RT after auth | Statements | Index / plan | Target DB time |
|---|---|---|---|---|---|
| `/u/[username]` RSC, other player | R2 | 0–2 public (data cache) + 1 viewer | public on a miss: header `users WHERE "usernameKey"=$1`, then `Promise.all` ratings (≤ 5 rows), recent 6 Replay games (keyset `LIMIT 6` ⋈ `games` PK), linked (≤ 2), strengths (1 PK-prefix read), milestones (`LIMIT 4`); viewer: one statement with the two block `EXISTS` and the h2h aggregate | §6.5 (`game_players_h2h_idx` for h2h) | ≤ 12 ms on a miss, ≤ 3 ms on a hit |
| `/u/[username]` RSC, own | R2 | 2 | header, then `Promise.all` as above (all sources) + rating history | §6.5 | ≤ 12 ms |
| `/u/[username]?tab=games` page 1 / PLY-3 / G1 | R2 | 2 | keyset `LIMIT 31` + `count(*)` **on page 1 only** (AP-38) | `game_players_userId_endedAt_gameId_idx`; filters applied on ≤ 2,000 rows | ≤ 8 ms |
| PLY-4 / ME-20 stats | R2 | 2 | §8.15 CTE (≤ 90 days, one pool, ⋈ `games` PK) + 1 PK read | same index, range on `endedAt` | ≤ 6 ms (gate 50 ms → §6.6 fallback) |
| PLY-2 / ME-19 rating history | R2 | 2 | 1 range scan with the `timeClass`/`ratingAfter` filter + 1 "before window" `LIMIT 1` | `game_players_userId_endedAt_gameId_idx` | ≤ 3 ms |
| PLY-1…5 on the CDN | P | 0 on a hit | — | `public-static` | edge TTFB ≤ 100 ms p95 |
| PLY-7 viewer bits | R1 | 1 | one statement (blocks + h2h + canChallenge) | PK + `game_players_h2h_idx` | ≤ 3 ms |
| `/p/[username]` guest | P | 0 on a CDN hit | — | ISR | edge TTFB ≤ 100 ms p95 |
| `/settings/*` RSC | R1 | 1 (`getMe()` CTE, P1) | 0 extra (`/settings/training`: +1 PK read) | PKs | ≤ 5 ms |
| ME-3b prefs PATCH | W1 | 2 + tx | `SELECT … FOR UPDATE` + `UPDATE` (HOT, fillfactor 80) | PK | ≤ 4 ms |
| BIL-3 membership | R1 | 1 | 0 extra (viewer row); 304 on the ETag | — | ≤ 2 ms |
| BIL-15 refresh | X | 1 + 1 Dodo call | compare-and-set `UPDATE … RETURNING` | PK | Dodo p95 ≤ 1.5 s |
| BIL-4 billing details | X | 1 + 2 Dodo calls on a miss | — | data cache 300 s | Dodo p95 ≤ 1.5 s; hit ≤ 50 ms |
| ME-13a export request | W1 | 2 + tx | check + 2 inserts | `data_export_jobs (userId, requestedAt DESC)`, `jobs.dedupeKey` | ≤ 5 ms |
| ME-15 delete | W2 | 3 + tx | §8.12: ≤ 15 statements; heaviest `DELETE FROM users` cascade (≈ 2,000 `game_players`, ≈ 10k `training_attempts`, ≈ 500 cards, coach messages) | FK indexes on every cascade child (data-model §6) | ≤ 1.5 s p95 on the heavy fixture (gate) |
| Dispatcher drain (worker) | — | 1 per batch of 100 + 1 budget reserve per email | claim `UPDATE … RETURNING` + per-row status updates batched in one `UPDATE … FROM (VALUES …)`; final `min("runAt")` read for the next wake | `notifications_pending_idx`, `email_budget_days_pkey` | 2 RT per 100 notifications from Mumbai ≈ 0.4 s |
| Reminder minute (worker) | — | 3 | candidate query (§8.11) + trained-today filter + one batched `INSERT … ON CONFLICT DO NOTHING` | `user_settings_reminder_idx`, `training_cards (userId, deck, due)`, `training_days` PK | ≤ 20 ms for 1,000 candidates |
| Planner slices (worker, once a day) | — | 4 | reminder minutes (index-only), weekly zones, DST rows, milestone backstop | as named | ≤ 30 ms |

`EXPLAIN (ANALYZE, BUFFERS)` of every query above is captured on the perf branch seeded with `--scale 100` (data-model §13.6) and committed to `docs/perf/p10-plans.md`; CI's `scripts/explain-hot-queries.ts` (optimization OPT-66) gains these queries and fails on a `Seq Scan` over `game_players`, `users` or `notifications` with more than 1,000 rows, and the index-existence gate checks §6.5's names (api-perf §5).

### 9.2 Caching layers

| Layer | What | Key / tag | TTL | Invalidation |
|---|---|---|---|---|
| CDN (Vercel) | `/p/[username]` HTML (ISR) and its OG image | path; data-cache tag `player:{usernameKey}` | 60 s | `revalidateTag("player:"+key)` on profile edit, visibility change, username change (old and new keys), account deletion |
| CDN | PLY-1…5 JSON (public bodies only, D1) | URL; `Vercel-Cache-Tag: player:{usernameKey}` | `s-maxage=60, swr=300` | same tag via `invalidateByTag` (`@vercel/functions`) in `after()`; 60 s bound if the purge API is unavailable on Hobby [V] |
| CDN | PLY-6 public search | URL; tag `player-search` | 300 s | time |
| Next data cache | public player loader `getPublicPlayer` | `["player-public", usernameKey]`, tag `player:{usernameKey}` | 60 s | as above |
| Next data cache | billing details per customer | `["billing-details", customerId]`, tag `billing:{customerId}` | 300 s | Dodo webhook `payment.*`/`subscription.*`, billing actions |
| React `cache()` | `getViewer`, `getMe`, `getPlayerHeader(usernameKey)` | per request | request | — |
| TanStack Query | §5.1 keys | per tab | §5.1 | §5.4 events |
| Browser HTTP cache | **nothing per-user**: per-user responses are `private, no-cache` + ETag or `no-store`; downloads `private, no-store` (AP-04). Avatar images on the media host are public, `public, max-age=31536000, immutable` (UUID keys) | — | — | new key per upload |
| Browser storage | `rc:prefs:v1`, `rc_pv` cookie, `rc:dismissed:v1` | device | ∞ | sign-out clears per client-data-layer §6.6 |
| Service worker | nothing from `/api/*` (NetworkOnly) | — | — | purge on sign-out |
| Worker memory | VAPID details, Resend client, `nextRunAt`, presence lookups | process | — | — |

Never cached: viewer bits (PLY-7), the membership view beyond the 5-minute client copy, billing actions, export download URLs, deletion preview, presence (optimization §4.10).

### 9.3 Payload budgets

| Response | Raw | Brotli | How |
|---|---|---|---|
| `PlayerPublic` (overview) | ≤ 7 KB | ≤ 2.5 KB | rating history ≤ 60 `[t, r]` tuples (≈ 1 KB); 6 game rows; no PGN, no FEN lists beyond the 6 final FENs |
| `PlayerViewer` (PLY-7) | ≤ 1 KB | ≤ 0.4 KB | h2h counts + 5 refs, ticket ≈ 180 B |
| PLY-3 page (30 rows) | ≤ 10 KB | ≤ 3 KB | `GameRowDTO` (P3), mini boards rendered from the DTO's `finalFen` on the client |
| PLY-4 stats | ≤ 1.5 KB | ≤ 0.7 KB | |
| PLY-5 milestones | ≤ 4 KB | ≤ 1.2 KB | ≤ 30 rows |
| `GET /api/me/preferences` | ≤ 4 KB (zod max) | ≤ 1 KB | |
| PATCH prefs request | ≤ 1 KB | — | patch only, never the whole doc |
| `PrefsBootstrap` inline script | ≤ 4.3 KB when versions differ; 60 B otherwise | — | `rc_pv` cookie |
| `MembershipView` | ≤ 1.5 KB | ≤ 0.6 KB | |
| `BillingDetails` | ≤ 3 KB | ≤ 1 KB | 12 invoices |
| Push payload | ≤ 1 KB | — | `{id, sig, title, body, url, tag, kind}` |
| Socket `presence:state` | ≤ 200 B | — | |

### 9.4 Bundle impact (First Load JS, gzip; optimization §5.7 app list routes ≤ 260 kB)

| Route | Budget | Kept small by |
|---|---|---|
| `/u/[username]` | ≤ 250 kB | hand-written SVG chart (no chart library); Games tab list + virtualiser `next/dynamic` on tab activation; Report dialog, filter popover and bulk toolbar dynamic |
| `/p/[username]` | ≤ 180 kB (marketing budget) | no shell, no socket client, no TanStack devtools |
| `/settings/board`, `/settings/pieces` | ≤ 260 kB | the board renderer is already in the shared app chunk (P2); preview position is a static FEN |
| `/settings/sounds` | ≤ 230 kB | sound engine shared; `speechSynthesis` is native |
| `/settings/notifications` | ≤ 230 kB | `NotifPrompt` dynamic; no `web-push` on the client |
| `/settings/account` | ≤ 240 kB | Clerk is loaded app-wide already (P1); delete modal and username editor dynamic |
| `/settings/membership` | ≤ 240 kB | Plan switch and cancel flows `next/dynamic` (opened on intent, prefetched on hover) |
| `/profile/edit` | ≤ 230 kB | image resize uses canvas, no library; form rules without zod (AP-12) |
| `/settings/training` | ≤ 230 kB | kit components only |

Server bundles: `aws4fetch` (~3 KB) instead of `@aws-sdk/client-s3` in web routes (D12); `dodopayments` imported only by billing routes; `web-push`, `archiver`, `@aws-sdk/*` only in WK. CI's bundle report (P1 F7) fails a route that exceeds its budget by > 5 %.

### 9.5 SLOs and how they are measured

| SLO | Target | Measurement |
|---|---|---|
| PLY-1/3/4 server time | p95 ≤ 160 ms (R2) | Sentry span `api players.*` + `Server-Timing` in dev; k6 `account-reads` |
| Guest profile edge TTFB | p95 ≤ 100 ms on a HIT; hit ratio ≥ 90 % after warm-up | `x-vercel-cache` in k6; Vercel Analytics |
| `/u/[username]` RSC TTFB | p95 ≤ 400 ms (US), ≤ 900 ms (India) | Speed Insights (field), Playwright `performance.timing` (lab) |
| Profile LCP | p75 ≤ 2.5 s, CLS ≤ 0.05 at 80–150 % zoom | Speed Insights; Playwright CLS observer in the device suite |
| Prefs sync to another device | p95 ≤ 3 s from PATCH 200 to the other device's store | e2e `settings-sync.spec.ts` is the gate (lab); PostHog `prefs_synced_remote {lagMs}` (10 % sample) is indicative only, because client events are consent-gated after P11 (AP-15) |
| PATCH prefs | p95 ≤ 150 ms (W1), 0 ms perceived | Sentry span |
| Membership page | plan card painted from RSC with 0 Dodo calls; billing card p95 ≤ 1.6 s | Sentry spans; `billing_degraded` rate ≤ 2 % |
| Delete account | p95 ≤ 1.5 s on the heavy fixture; 100 % of purges complete ≤ 1 h; `dodo_cancel` ≤ 5 min p95 | Sentry span `api me.delete`; `account_deletions` open-age metric `account.purge.open_max_age_s` |
| Export | p95 ≤ 2 min from request to email for 2,000 games | job duration metric `worker.job.duration_ms{kind=EXPORT_BUILD}` |
| Reminder punctuality | p95 ≤ 2 min after the chosen local time (minutes merged by the wake cap are reported separately as `notify.reminder.merge_lag_s`) | `notification_sent.lagSec = sentAt − scheduled` (PostHog server event, consent-exempt) |
| Push delivery accepted | ≥ 98 % of attempts 2xx (excluding 404/410) | `notify.push.result{status}` |

### 9.6 Neon wake, Vercel and email budgets

- **Neon wakes added (D9, measured weekly by the ops CU-h report):** reminder minutes only, ≈ 0.02 CU-h each when nothing else is awake: with members in 2–3 zones and 4 reminder times ≈ 8–12 runs/day ≈ 5–7 CU-h/month in the worst case, less in practice because 19:00 IST is peak traffic; capped by `REMINDER_MAX_RUNS_PER_DAY`. Weekly digest: 1 run per zone per week. Pause edges and trial reminders: one run each, rare. Planner slices ride P3's daily housekeeping wake. Dispatcher drains, exports and purges are triggered by producers while Neon is already awake. **No `HOURLY_TICK` dependency, no poller, no 15-minute timer.** The P10 timer-audit unit test boots the worker with a fake clock over 24 idle hours with no reminder rows and asserts ≤ 1 DB round trip (api-perf §5 "Timer audit").
- **Vercel invocations per active member per day (P10 share):** profile view 1–2 (other players' public parts mostly CDN hits), prefs PATCH ≤ 3 (debounced), membership 1–2 (page + details), push click beacon ≤ 1 → ≈ 6, inside the optimization §1.3 budget of ≤ 60/day. Guest profile views and public tab JSON cost 0 on a hit.
- **Resend:** free plan 100 emails/day, 3,000/month [V]. Volume at 300 members: weekly digest ≈ 300/week (default email on), reminders (email off by default), trial-ending ≈ trials/day, export/deletion/payment-failed a handful. Built-in guard: the logged `email_budget_days` reserve (§8.11): 90/day with 20 kept for transactional kinds, and bulk paused at 2,900/month; `WEEKLY_PROGRESS` spreads over Sunday–Tuesday when the cap is hit. The counter survives Neon suspends because the table is logged (feasibility F-NEON-3). Owner decision §14 Q6 (Resend Pro at ~$20/month before launch).
- **OCI:** notify and export jobs run in the I/O lane; `web-push` concurrency 10; export streaming ≤ 20 MB RSS; no engine time.
- **Vercel image transformations:** 0 (avatars pre-sized and `unoptimized`, D11).

### 9.7 Performance checks (k6 against dev, `perf/k6/src/scenarios/`)

| Scenario | Load | Thresholds |
|---|---|---|
| `account-reads.ts` | 50 VUs: PLY-1 + PLY-7 (member), PLY-3 page 1 + 2 filters, PLY-4, BIL-3, `GET /api/me/preferences` | p95 ≤ 200 ms, errors < 0.5 % |
| `guest-profile.ts` | 100 VUs on 20 usernames, signed out | p95 ≤ 150 ms, `x-vercel-cache: HIT` ≥ 90 % after 30 s |
| `prefs-write.ts` | 30 VUs PATCH every 2 s with random leaves | p95 ≤ 200 ms, 0 lost leaves (final GET equals the union of patches) |
| `notify-burst.ts` (worker, dev) | 1,000 synthetic `MISTAKES_DUE` rows to fake push endpoints (a local mock push service on the dev VM) | drained ≤ 60 s, socket loop lag p99 ≤ 100 ms during the burst |
| `delete-heavy.ts` | 5 deletions of the `--scale` heavy persona | p95 ≤ 1.5 s, all purges complete |

---

## 10. Telemetry

### 10.1 PostHog events

Naming `area_object_action` (inv-acct §1.6). Every event carries `{ device: "desktop"|"ipad_l"|"ipad_p"|"phone", member_state, app_env }`; `distinct_id = User.referenceId` (architecture X14); no emails or free text in properties. Client events respect P11 consent once it ships; server events (marked S) are sent from `after()` or the worker. Every event is registered with a closed property schema in `packages/analytics/src/events/account.ts` (P1's registry, testing X6); server events are marked `consentExempt: true`.

| Area | Event | Properties |
|---|---|---|
| Profile | `profile_viewed` | `mode: own\|other\|private\|guest`, `tab`, `online` |
| | `profile_tab_changed` | `tab`, `mode` |
| | `profile_rating_pool_changed` | `pool` |
| | `profile_link_copied` / `profile_view_as_public_clicked` | — |
| | `profile_games_searched` (debounced 2 s) | `len` |
| | `profile_games_filtered` | `result`, `sources`, `legendOnly` |
| | `profile_games_bulk_mode_toggled` | `on` |
| | `games_bulk_review_requested` | `n`, `queued`, `alreadyDone`, `from: profile\|archive` |
| | `games_exported` | `n`, `all`, `from` |
| | `profile_game_opened` | `source`, `reviewStatus`, `target: review\|replay` |
| | `profile_stats_viewed` | `pool`, `own`, `enough` |
| | `profile_milestones_viewed` | `achieved`, `next` |
| | `profile_challenge_clicked` / `profile_watch_live_clicked` / `h2h_review_clicked` | — |
| | `player_blocked` / `player_unblocked` | — |
| | `player_reported` | `reason`, `hasNote`, `hasGame` |
| | `guest_profile_cta_clicked` | `cta: trial\|signin` |
| | `player_search_used` | `results` |
| | `milestone_awarded` (S) | `kind` |
| Edit | `profile_edit_opened` / `profile_edit_saved` | `fields: string[]` |
| | `profile_edit_failed` | `code` |
| | `avatar_upload_started` / `avatar_upload_failed` | `reason: too_large\|type\|decode\|network` |
| | `profile_visibility_changed` | `to`, `from: edit\|account` |
| Settings | `settings_viewed` | `section` |
| | `settings_section_opened` | `section`, `from: list\|card` |
| | `settings_changed` (one per flush) | `section`, `keys: string[]` |
| | `settings_sync_failed` | `attempts` |
| | `prefs_synced_remote` (10 % sample) | `lagMs` |
| | `appearance_theme_changed` | `to` |
| | `sound_test_played` | `sound` |
| | `sound_unblocked` | — |
| Notifications | `notif_prompt_shown` | `entry: settings\|review_complete\|bank_add\|challenge` |
| | `push_enable_clicked` | `entry` |
| | `push_permission_result` | `result: granted\|denied\|dismissed` |
| | `push_subscribed` (S) | `platform` |
| | `push_test_sent` | — |
| | `notification_channel_changed` | `kind`, `channel`, `on` |
| | `reminder_time_changed` | `time` |
| | `quiet_hours_toggled` | `on` |
| | `notification_sent` (S) | `kind`, `channel`, `lagSec` |
| | `notification_failed` (S) | `kind`, `channel`, `code` |
| | `notification_clicked` (S) | `kind` |
| | `email_unsubscribed` (S) | `kind` |
| Account | `account_email_change_started` / `account_email_changed` / `account_email_code_failed` | — |
| | `account_password_changed` | `wasSet` |
| | `username_change_started` / `username_changed` | — |
| | `username_change_failed` | `reason` |
| | `data_export_requested` (S) / `data_export_ready` (S) / `data_export_downloaded` (S) | `games`, `bytes` (ready) |
| | `account_delete_opened` / `account_delete_confirm_matched` / `account_delete_kept` | `blockers` |
| | `account_delete_completed` (S, exactly once) | `source`, `hadSubscription`, `inTrial`, `games` |
| | `account_delete_failed` (S) | `code` |
| Membership | `membership_viewed` | `state` |
| | `membership_action_clicked` | `action`, `state` |
| | `membership_resumed` (S) | `from: cancelling\|trial_cancelled\|pause` |
| | `scheduled_change_cancelled` (S) | — |
| | `payment_update_clicked` / `payment_updated` (S, on the next `payment.succeeded`) | — |
| | `billing_portal_opened` / `invoice_downloaded` | — |
| | `billing_degraded` (S) | `ms` |
| | `plan_switch_opened` | `from`, `to`, `trial` |
| | `plan_switch_previewed` | `to`, `amountCents \| null`, `unavailable` |
| | `plan_switch_confirmed` (S) | `from`, `to`, `kind`, `trial`, `amountCents` |
| | `plan_switch_failed` | `code` |
| | `plan_switch_kept_current` | — |
| | `cancel_flow_opened` | `trial`, `interval`, `offers` |
| | `cancel_offer_taken` | `offer: pause\|yearly` |
| | `cancel_continue_clicked` / `cancel_reason_selected` | `reason` |
| | `cancel_confirmed` (S) | `reason`, `hasComment`, `trial`, `offerShown` |
| | `cancel_failed` / `cancel_abandoned` | `step` |
| | `membership_paused` (S) / `membership_pause_cancelled` (S) / `membership_resumed_now` (S) | `months` |

**Funnels / insights:** cancel save rate per offer (`cancel_flow_opened` → `cancel_offer_taken` vs `cancel_confirmed`); push opt-in (`notif_prompt_shown` → `push_permission_result=granted` → `notification_clicked`); reminder effectiveness (`notification_clicked{kind=MISTAKES_DUE}` → `train_session_started` within 30 min, P5 event); profile edit completion; export to deletion within 24 h (churn signal).

### 10.2 Sentry

- **Spans** from `route()` for every P10 route (`api players.get`, `api me.preferences.patch`, `api billing.details`, …) with tags `route`, `class`, `status`, `code`; `tracesSampler`: 1.0 for `/api/subscription/*`, `/api/billing/*`, `DELETE /api/me`, webhooks; 0.1 for player reads; 0 for `/api/push/clicked` and `/api/email/unsubscribe`.
- **Metrics:** `notify.push.result{status}`, `notify.email.result{status}`, `notify.lag_s{kind}`, `notify.queue.depth`, `export.build.duration_ms`, `account.purge.step{step,outcome}`, `account.purge.open_max_age_s`, `billing.details.degraded`, `billing.dodo.latency_ms{call}`, `prefs.patch.conflicts` (stale `baseVersion`), `presence.watchers`, `email.budget.used{bucket}`, `notify.reminder.merge_lag_s`.
- **Alerts (owner email):** any `account.purge` `dodo_cancel` final failure (fatal); `account.purge.open_max_age_s > 3600`; `notify.push.result` 5xx rate > 10 % / 1 h; Resend 4xx (domain or quota) any; `billing.details.degraded` > 5 % / 1 h; webhook processing failures (existing).
- **Crons:** Sentry cron monitors for the P10 planner slices (one check-in per planner run, daily) and the `/api/cron/daily` tasks `membership-reconcile` and `trial-reminder-backstop`.
- **Privacy:** `sendDefaultPii: false`; `Sentry.setUser({ id: ref })` only; the deletion flow does not need a Sentry user delete because no PII is sent (architecture §3.3); breadcrumbs never include email or bio text.

---

## 11. Security, privacy and access rules

### 11.1 Access matrix for P10 routes (D14; Phase 0 §1)

| Route / API | Guest | Signed in, non-member | Member | Lapsed (`expired`) | Admin |
|---|---|---|---|---|---|
| `/@{u}` other public profile | ✓ (ISR, noindex) | ✓ (CTAs → pricing) | ✓ | ✓ | ✓ |
| own profile `/@{me}` | — | ✓ (empty states) | ✓ | ✓ (read-only history) | ✓ |
| `/profile/edit`, Settings › Account, Connected, Membership | — (sign-in) | ✓ | ✓ | ✓ | ✓ |
| Settings › Board, Pieces, Sounds, Training, Appearance, Notifications | — | → `/settings/account` | ✓ | → `/settings/account` | ✓ |
| `review-batch`, `export.pgn` | 401 | 402 `subscription_required` | ✓ | 402 `subscription_required {reason}` | ✓ |
| PLY-1…6 public reads | ✓ (public projection) | ✓ (same body) | ✓ (same body) | ✓ | ✓ |
| PLY-7 viewer bits, PLY-8 member search, ME-19…21 own reads | 401 | ✓ | ✓ | ✓ | ✓ |
| Blocks, reports | 401 | ✓ | ✓ | ✓ | ✓ |
| Presence watch | — | ✗ (socket `ent=false` may join only its user room, architecture X18) | ✓ | ✗ | ✓ |
| Push subscriptions, prefs, export, delete, billing reads and actions | 401 | ✓ | ✓ | ✓ | ✓ |

### 11.2 Enforcement

- **Server-side only**: visibility in `publicProjection()` / `viewerProjection()` (DAL) for pages and APIs; never just hidden in the UI. Private sub-resources return 403; inactive/deleted users 404.
- **Ownership**: push subscription id, export, invoice (Dodo customer match), deletion (self only; admin deletions are a later admin tool) — 404 on mismatch.
- **Step-up** for `DELETE /api/me` (`auth().has({ reverification: "strict" })`, 10 min) and Clerk's own step-up for email/password changes.
- **CSRF**: P1 middleware's `Origin` check plus `Sec-Fetch-Site: same-origin` on cookie-authenticated mutations (the media host is same-site, feasibility SEC-9); the two token-authenticated endpoints (ME-17 unsubscribe, ME-18 push click) need no cookie and verify an HMAC with a timing-safe compare.
- **Rate limits**: §7.1 buckets on every write and lookup that can be abused (availability enumeration, avatar spam, report spam, test-push spam, export abuse).
- **Upload safety**: presigned PUT limited by signed `content-type` + `content-length`, key prefix bound to the caller's ref, 5-minute expiry; server `HEAD` verification before the URL is stored; images served from the media domain with `Content-Type` from R2 (never `text/html`), `X-Content-Type-Options: nosniff` and `Content-Security-Policy: default-src 'none'; img-src 'self'` via a Cloudflare Transform Rule (D11); avatars render `unoptimized`, so no `images.remotePatterns` entry is added.
- **Caching**: public player routes read no session and carry only the public projection (D1); per-viewer data is `no-store`; no per-user response has `max-age > 0`; downloads are `private, no-store` (AP-03, AP-04).
- **Bio and names**: no links in bios (regex), reserved and blocked words, React escapes output; OG images render text through `next/og` (no HTML injection).
- **Presence**: signed tickets; no presence for private or blocking relations; the block itself is never revealed.
- **Webhooks**: signature first, dedupe by delivery id (P1); Clerk `user.updated` only trusts the **verified** primary email.
- **Secrets**: VAPID private key, Resend key and PostHog personal key only in the OCI env file; `UNSUBSCRIBE_SECRET`, `PUSH_CLICK_SECRET` per environment; nothing in `NEXT_PUBLIC_*` except the VAPID public key and the media URL.

### 11.3 Privacy and data rights

- **Personal data added by P10:** username, display name, bio, country, avatar (user-provided, public unless private); push endpoints (device identifiers; deleted on 410 and with the account); notification log (90 days); username history (90 days); export archives (7 days, private bucket, lifecycle 8 days).
- **Export (GDPR Art. 20)** covers every table that holds the user's data (§8.13) except security logs (`audit_logs`, `webhook_events`), which hold ids only.
- **Deletion (Art. 17)**: private rows deleted in the transaction; shared games anonymised ("Deleted player", ratings nulled on the deleted side); open reports about the user deleted, resolved ones and consent records unlinked; finished standings keep the snapshot name; Clerk, Dodo (cancel; Dodo keeps invoices for tax law), Lichess token, R2, PostHog removed by the outbox; Sentry holds no PII; backups expire within 30 days (architecture §2.3.9 keeps ≤ 30 days; data-model O9 — align the retention to 30 days so the copy "Backups clear within 30 days" is true); `TrialLedger` keeps a salted email hash to enforce one trial per person (privacy policy disclosure, P4 decision 2).
- **Guest profiles**: `noindex`, not in sitemaps, OG data limited to name, avatar, headline rating; private profiles expose only name and rating everywhere.
- **Analytics**: no PII in events; unsubscribe and click endpoints log no email.

### 11.4 Paywall rules specific to P10

- Membership, Account, Connected, Profile edit and own profile work for non-members (the paid-only model still needs them).
- Producers check entitlement before creating `MISTAKES_DUE`, `REVIEW_READY` and `WEEKLY_PROGRESS` notifications (lapsed members get none); `ACCOUNT` and `PAYMENT_FAILED` go to anyone.
- The pause window counts as "no access". A paused member who opens a member-only route is redirected to `/settings/membership` (where [Resume now] is), not to `/pricing`: the Clerk claim carries `md.paused = true` (set by INT-P2 at the start edge), which P1's middleware gate reads alongside `md.entitled`. APIs answer 402 `subscription_required` with `details.reason = "paused"`, which `reactToApiError` maps to the same page.

---

## 12. Testing

Runners and layout (testing X1): unit tests `node:test` via `tsx` (SPEC D13), next to the source as `*.test.ts` (including `WEB/features/**` and `WEB/worker/**`, which P1's unified `test:unit` glob covers; `check-test-globs` must show every P10 test file running); DB-backed tests `*.int.test.ts` under `WEB/test/integration/`; route, contract and authz tests under `WEB/test/{api,authz}/`; socket tests with `socket.io-client` against an in-process server; Playwright for e2e (`WEB/e2e/specs/account/*.spec.ts`) with **`BILLING_PAYWALL=on`** (X3) and the P1 device × zoom matrix (`playwright.devices.config.ts`: 8 devices × 80/100/110/125/150 %). Every P10 spec carries `@p10`; six carry `@smoke` (`profile-own`, `settings-sync`, `notifications`, `membership-states`, `account-export`, `account-authz`); every spec tags the design states it reaches as `@state:<Board>.<value>` (real data) or `@demo:<Board>.<value>` (demo route, with a reason in `design-states.overrides.json`), so P1's `state-coverage` check proves all 39 boards (X8). User rules: §6.10 (shared letters only add data; state-changing specs lease pool personas; destructive specs use throwaway `e2e-*` users). Server time in e2e comes from `serverNow.set()` (`x-rc-now` + `x-e2e-token`, X5); the auto-use console guard (X7) and the telemetry sink with its PII guard (X6) run on every spec.

### 12.1 Unit tests

| File | Cases |
|---|---|
| `WEB/lib/billing/membership-view.test.ts` | every row of §8.1 in precedence order (13 states) with boundary instants (`now = trialEndsAt − 1 ms`, `= trialEndsAt`, `pausedFrom ± 1 ms`, `pausedUntil`); actions table per state; `pauseEligible` (paused 364 vs 366 days ago); admin note; paywall-off note; summary strings; legacy unknown product → `legacy`; vectors ported from `viewFromStore` (`MembershipSection.tsx:64`) |
| `WEB/lib/billing/entitlement-rules.test.ts` (extend) | `isEntitled` false inside the pause window, true before and after; existing grace and cancelled cases unchanged |
| `WEB/lib/billing/pause-rules.test.ts` | `decidePause` rejections (trial, cancelling, past due, already paused, paused recently, not active); `addMonthsUtc` (Jan 31 → Feb 28 and Feb 29 in 2028, Dec → Jan year roll); "No charge in {month}" uses `from` in the user's time zone (12 Nov 00:30 IST = 11 Nov UTC) |
| `WEB/lib/billing/proration-estimate.test.ts` | the board example (13/30 → $2.16 → $47.84); fraction clamped to [0, 1]; legacy 800 ¢ |
| `WEB/lib/billing/format.test.ts` | `formatMembershipDate` en-GB/en-US/hi-IN in `Asia/Kolkata` and `America/New_York`; "16%"; "$4.17" |
| `WEB/lib/billing/trial-rules.test.ts` (extend) | `trialDayNumber` = floor + 1, `day + daysLeft = 8` for non-integer elapsed, day 7 cap |
| `WEB/lib/profile/username.test.ts` | regex accept/reject (`_abc`, `ab`, 21 chars, unicode, `a__b` ok); reserved exact and prefix; blocked words; case-insensitive taken; history reservation 89 vs 91 days; own history allowed; cooldown 29 vs 31 days; suggestion order; generator from "Rohit Pandit" / "Ångström" / "李" / empty name |
| `WEB/lib/profile/visibility.test.ts` (split) | `publicProjection` never reads a viewer argument (type-level: it takes none); `viewerProjection` over self/member/non-member × public/private × block either way; a blocked-by-target viewer gets output identical to a private target's |
| `WEB/lib/profile/rating-history.test.ts` | ≤ 60 points; first/last/peak kept; empty window; single event; window-start carry-over; aria string |
| `WEB/lib/profile/stats.test.ts` | phase accuracy weighting with `−1` phases; `null` when no phase reached; band rounding and clamping (650 → 600–800, 2450 → 2200–2400); best streak with ties; colour score % with draws; `enough` at 4/5 games; statLine pick and person |
| `WEB/lib/profile/bio.test.ts` / `display-name.test.ts` | link patterns (`http://`, `www.`, `example.com/x`, `e.g.` allowed); NFC; counter rules |
| `WEB/lib/prefs/merge.test.ts` | deep merge per leaf; arrays replace; `null` resets to default; unknown keys stripped; v1 defaults fill every missing section; 4 KB cap |
| `WEB/lib/prefs/derived.test.ts` | §8.10 fixtures (Kolkata, Kathmandu, New York summer/winter, Lord Howe, Chatham); quiet-hours UTC minutes; reminders off → null; opt-in arrays |
| `WEB/lib/prefs/store.test.ts` | debounce batching (3 changes in 400 ms → 1 PATCH); per-leaf `dirtyAt` merge with a server doc; BroadcastChannel apply; legacy migration of `chess-battle-theme`, `chess-sound-muted`, `rc-single-key-shortcuts` |
| `WEB/lib/notify/quiet-hours.test.ts` | local 21:59 send, 22:00 deferred to 08:00, 07:59 deferred, 08:00 sends; TOURNAMENT_STARTING bypass; DST night in New York |
| `WEB/lib/notify/schedule.test.ts` | dedupe keys per local date across a UTC midnight; reminder body minutes (`ceil(due × 0.6)`); weekly zone selection on Sunday 18:xx for UTC+5:45 |
| `WEB/lib/notify/tokens.test.ts` | unsubscribe and push-click HMAC round trip; tamper → reject; timing-safe compare used |
| `WEB/lib/milestones/definitions.test.ts` | each evaluator over fixture inputs; idempotent upsert decision (achieved only once; RATING_PEAK re-award threshold); NEXT goal pick |
| `WEB/lib/account/deletion-plan.test.ts` | blockers (in game, last admin, hosting); step initial states by source (`clerk` skips `clerk_delete`; no subscription skips `dodo_cancel`); email masking |
| `WEB/lib/presence/ticket.test.ts` | sign/verify; `sub` mismatch; expiry; kid rotation |
| `WEB/features/profile-edit/resizeImage.test.ts` (logic only) | cover-crop rectangle maths for portrait/landscape/square |
| `WEB/lib/api/registry-tiers.test.ts` (P10 entries) | every P10 route with `auth ≠ "public"` uses `private-etag` or `no-store`; no P10 route sets `max-age > 0` on a per-user response; every `windowSec > 300` bucket is `durable` (api-perf §5 registry lint) |
| `WEB/lib/notify/templates.test.ts` | for each email (reminder, weekly digest, trial ending, export ready, export failed, account deleted, payment failed, email changed): text and HTML snapshots; every link absolute to `WEB_APP_URL`/`NEXT_PUBLIC_SITE_URL` and present in the route table; a plain-text part; bulk kinds carry `List-Unsubscribe: <…/api/email/unsubscribe?t=…>, <mailto:…>` and `List-Unsubscribe-Post: List-Unsubscribe=One-Click`, transactional kinds do not; no email address in the HTML except the greeting rule |
| `WEB/lib/notify/payload.test.ts` | push payload ≤ 4 KB; the click `sig` verifies with `tokens.ts`; no PII in `title`/`body` beyond the first name |
| `WEB/lib/notify/email-budget.test.ts` | reserve decision mirrors the SQL: bulk stops at 70, transactional at 90, month guard at 2,900; deferral `runAt` for bulk; transactional over budget → retry in 1 h |
| `WEB/lib/notify/trial-ending.test.ts` | `runAt = trialEndsAt − 48 h`; dedupe key per trial; send-time skip when cancelled or no longer trialing; yearly-switch copy uses the yearly price |
| `WEB/lib/account/deletion-hash.test.ts` | the deletion `emailHash` equals P4's `trialLedgerHash(email)` for 10 fixture emails (gmail dots, `+tag`, `googlemail.com`), so a deleted member can't take a second trial (consistency 10.2) |
| `WEB/worker/push.test.ts` | `push` shows the notification with tag/renotify; `notificationclick` posts the beacon, focuses an open client or opens a window; `pushsubscriptionchange` re-posts with `oldEndpoint` |
| `CT/http/profile.rules.test.ts` | the client rule functions and the zod schemas accept and reject the same 40 fixture strings |
| `WK/src/scheduler/recurring/p10-slices.test.ts` | reminders: distinct minutes → one row each, dedupe, merge rule above `REMINDER_MAX_RUNS_PER_DAY` never makes a reminder early; weekly rows only on Sunday windows; DST zones recomputed before planning; the same slices give the same rows for a 26-h window as for 26 consecutive 1-h windows |
| `WK/test/timer-audit.test.ts` | fake clock, mocked DB, 24 idle hours with no due rows → ≤ 1 DB round trip; with 3 planned reminder rows → exactly 3 wakes at their `runAt` (api-perf §5) |

### 12.2 API contract tests (`WEB/test/api/*.test.ts`, generated matrix + hand cases)

For every P10 registry entry: signed out → 401 (public `P` routes answer the public projection); non-member → 402 for `M` routes; non-owner → 404 for `O` routes; malformed JSON → 400 `invalid_json`; oversize → 413; 429 carries `Retry-After` and `retryAfterSec`; the response parses with its zod schema (`ROUTE_VALIDATE_RESPONSES=1`); `x-request-id` echoed; `Cache-Control` matches the declared tier (public tiers only on `auth:"public"` routes, no `max-age > 0` on per-user routes). Hand cases:

- `players.test.ts`: renamed handle → 308; private → limited projection and 403 on sub-resources; signed-in and signed-out bodies identical; `Vercel-CDN-Cache-Control` and no `Set-Cookie`; the handler never calls `getViewer` (spy).
- `players-me.test.ts`: blocked-by-target viewer gets `access: limited` with no hint of the block; ticket only for full access; `private, no-store`.
- `reports-user.test.ts`: user and game branches write `reports` with `reportedUserId`; self-report → 400; 24-hour duplicate → `duplicate: true`.
- `train-prefs.test.ts`: the extended W8 fields; `newPerDay` > stored cap → 400; a time-zone change recomputes `reminderUtcMinute` in the same transaction.
- `billing-refresh.test.ts`: GET membership never calls Dodo (msw asserts 0 requests); POST refresh applies an older Dodo `updated_at` as a no-op (compare-and-set).
- `me-preferences.test.ts`: stale `baseVersion` still merges and returns `version + 1`; concurrent PATCHes on different leaves both survive (two parallel requests, final GET has both).
- `me-username.test.ts`: P2002 race → 409 `username_taken`; cooldown 403 with `until`.
- `me-delete.test.ts`: without step-up → 403 `reverification_required`; wrong confirm → 400; in-game → 409; success → user row gone, `account_deletions` row present, `ACCOUNT_PURGE` job queued.
- `subscription-pause.test.ts` (Dodo mocked with `msw`): `next_billing_date` sent = `periodEnd + 1 month`; idempotency replay returns the same body; rejections map to 409 reasons.
- `billing-details.test.ts`: Dodo timeout → 200 `degraded: true`; ownership mismatch on invoice → 404.
- `webhook-dodo.test.ts`: `payment.failed` creates one `PAYMENT_FAILED` notification and emits `entitlement:changed {cause:"payment_failed"}`; `subscription.renewed` after a pause clears the window; the first trialing snapshot inserts one `TRIAL_ENDING` row at `trialEndsAt − 48 h`; a webhook older than the stored `subscriptionSourceAt` changes nothing; duplicate `webhook-id` → 200 no-op.
- `webhook-clerk.test.ts`: `user.updated` with an unverified email change is ignored; verified change updates the row and enqueues `DODO_CUSTOMER_SYNC` when Dodo fails; `user.deleted` runs the service idempotently.
- `push.test.ts`: upsert by endpoint re-assigns to the caller; `oldEndpoint` deleted; test push for a disabled subscription → 409.
- `unsubscribe.test.ts`: the GET page writes nothing; POST with a valid token flips only that channel's email; `kind=all`; tampered → 410.

### 12.3 Database integration (`WEB/test/integration/*.test.ts`, Docker Postgres 17, migrations from scratch)

- `account-deletion.int.test.ts`: seed users U (to delete) and O (opponent) with: 3 games U vs O (one analysed, with O's mistakes and cards), 5 bot games of U, 2 imported games of U, a finished tournament with both, a lobby tournament with U, a review share, push subscriptions, notifications, prefs, a P6 weakness snapshot, a P7 coach thread with usage rows, P8 lesson progress, a P9 open challenge and ratings, an open and a resolved report about U, a report made by U, a P11 consent record (when M11 exists). After `deleteAccount(U)`: O's 3 games exist with `whiteName/blackName = 'Deleted player'` on U's side and the FK columns null; O's `game_players`, reviews, mistakes and cards intact; U's bot and imported games gone (and their analyses, via cascade); finished standings row has `userId NULL, displayName 'Deleted player'`; lobby participation gone; `trial_ledger` has U's hash (equal to `trialLedgerHash(U.email)`); the open report about U is gone, the resolved one has `reportedUserId NULL`, U's own report has `reporterId NULL`; the consent record has `userId NULL`; `audit_logs` row present; `jobs` has `ACCOUNT_PURGE`; no row anywhere references U's id (query over every FK column from data-model §6). Also measures the transaction time on the `--scale` heavy persona (gate ≤ 1.5 s p95 over 5 runs).
- `notifications-claim.int.test.ts`: two concurrent drains never claim the same row (`SKIP LOCKED`); deferred `runAt` respected.
- `username.int.test.ts`: two concurrent changes to the same handle → exactly one succeeds.
- `c3-fks.int.test.ts`: after C3 + C3v, `DELETE FROM users` on a user with games leaves the games (SetNull) and `pg_constraint.convalidated = true`.
- `reminders.int.test.ts`: the planner slice inserts one row per distinct minute (dedupe on re-run); candidates exclude users who trained today and non-members.
- `email-budget.int.test.ts`: 20 concurrent bulk reservations at `total = 68` → exactly 2 succeed; transactional reservations succeed up to 90; the counter survives a connection reset (logged table).

### 12.4 Worker and socket tests

- `WK/test/jobs/notify-dispatch.test.ts` (fake `web-push`, fake Resend): 201 → SENT + `lastSuccessAt`; 410 → subscription deleted; 5 consecutive 500 → `disabledAt`; quiet-hours deferral; email budget exceeded → `WEEKLY_PROGRESS` deferred 24 h, `ACCOUNT` still sent; retries upsert future-dated `NOTIFY_DISPATCH` rows; `TRIAL_ENDING` skipped when the trial was cancelled; `NOTIFY_SENDING=off` → SKIPPED.
- `WK/test/jobs/export-build.test.ts`: fixture user → ZIP with the 8 entries; `games.pgn` parses with chess.js and every game's final FEN equals `games.fen`; streaming memory below 64 MB for 2,000 synthetic games; R2 upload mocked.
- `WK/test/jobs/account-purge.test.ts`: step machine with fakes; partial failure resumes only failed steps; `dodo_cancel` exhausts retries → Sentry fatal mock called; `completedAt` set at the end; secrets nulled after their step; the PostHog lookup and person delete are called with the old `referenceId` (mock); `lichess_revoke` is `skipped` when no token exists.
- `WK/test/jobs/milestones-evaluate.test.ts`: award once; silent mode emits nothing; `milestone:awarded` emitted via the `/internal/emit` client mock.
- `WS/test/presence.test.ts`: watch with a valid ticket → initial state; invalid/expired ticket ignored; connect/disconnect after 30 s grace → `presence:state`; coalescing; watcher cleanup on disconnect; cap 50.

### 12.5 E2E Playwright specs (`WEB/e2e/specs/account/*.spec.ts`)

Projects: `chromium-desktop` (1440×900) for all; `webkit-iphone` and `chromium-android` for the specs marked (m); billing specs run serially (`test.describe.configure({ mode: "serial" })`) against Dodo test mode and are tagged `@dev-url` when they need the real Dodo sandbox. "Lease X" = `leasePersona("X")` (§6.10).

| Spec | Users | Steps (abridged) |
|---|---|---|
| `profile-own.spec.ts` (m) `@smoke` | lease `p10-profile` | open `/@<u>` → header, rating chart has `role=img` aria → Games: search, Filter Losses + Chess.com (URL updates), Select 2 → Send to coach review → rows "Queued" → assert job rows via `GET /api/dev/jobs?mine=1` (test hook) → Export PGN → file parses with chess.js → Stats Blitz/Rapid → Milestones; `/profile` → 307 to `/@<u>`; `/profile/<ref>` → 308; page-1 response has `meta.total`, page 2 has only `nextCursor` |
| `profile-other.spec.ts` | lease `p10-profile` + `p10-rival` | presence: the rival opens a bot game in a second context → the online dot ≤ 3 s; Block → toast, menu Unblock, rival's context: `/@<u>` renders the private card with no Challenge; Unblock; Challenge → `/play?tab=friend&opponent=<rival>` shows "For @<rival>"; Report dialog → 201, repeat → `duplicate: true`; rival sets private → lock card; `GET /api/players/<rival>/games` → 403; not-found `/@doesnotexist_x` → status 404 + suggestions from `/api/me/players/search` |
| `profile-public-cache.spec.ts` | lease `p10-profile` | `GET /api/players/<u>` signed out and signed in return byte-identical bodies with `Vercel-CDN-Cache-Control` and no `Set-Cookie`; `GET /api/players/<u>/me` signed in is `private, no-store`, signed out 401; the registry lint (api-perf §5) passes |
| `profile-guest.spec.ts` | none (shared A read-only) | `/@A` signed out → marketing header, `meta[name=robots]=noindex`, `og:title`; tab Games loads public games; second `request.get('/@A')` on dev has `x-vercel-cache: HIT\|STALE` (`@dev-url`); a private persona → lock card + trial CTA → link carries `redirect_url=/@<u>` |
| `profile-edit.spec.ts` | lease `p10-profile` | invalid name lengths and characters → messages; bio with link → message; 4 MB PNG → `upload_error`; HEIC fixture → "Use a PNG or JPG."; 300 KB PNG → progress → dirty → Save (⌘S) → toast; a second tab's header avatar `src` changes ≤ 3 s; Use initials → avatar shows initials |
| `settings-shell.spec.ts` (m) | lease `p10-profile`, R (read-only) | every section reachable; summaries match prefs; phone: list → Board → Back; R (non-member) sees only the Account group; `/settings/board` and `/settings/training` as R → `/settings/account` |
| `settings-sync.spec.ts` `@smoke` | lease `p10-profile` ×2 contexts | context 1 Board → Walnut; context 2's `--board-light` CSS variable changes ≤ 3 s (socket path); same-context second tab changes ≤ 500 ms with **0 requests to `/api/me/preferences`** in that tab (BroadcastChannel + version skip, AP-24); `setOffline(true)` → change → "Saved on this device" → online → "SAVED · SYNCED"; reload preserves |
| `settings-sounds.spec.ts` | lease `p10-profile` | launch arg `--autoplay-policy=document-user-activation-required` → `autoplay_blocked` banner → [Turn sound on] → tests enabled; volume 0 → summary "Muted" |
| `settings-training.spec.ts` | lease `p10-training` | per day 15 → `PATCH /api/train/prefs` → Train hub copy changes; new per day options above the cap disabled; time zone change → `GET /api/dev/notifications` shows the recomputed reminder minute; scope change → TR-12 202 → second change → 429 countdown |
| `board-settings-sheet.spec.ts` | lease `p10-profile` | in a bot game: ⋯ › Board settings → sheet opens with `?modal=board-settings`, the game stays mounted (clock keeps ticking, a move can be played on desktop), theme change applies to the live board, Back closes the sheet; phone: modal bottom sheet, "Your clock is running." on the viewer's move |
| `notifications.spec.ts` (m) `@smoke` | lease `p10-notify` | Chromium: `grantPermissions(["notifications"])`, init script stubs `PushManager.subscribe` to return endpoint `<base>/api/dev/push-sink/<token>` → Enable push → `enabled` → Send a test → `GET /api/dev/notifications?kind=TEST` shows `pushStatus = SENT` ≤ 60 s (local worker in CI, real worker on dev); toggle channels → prefs; `tournament_new` row hidden with `tournaments-v3` off and present with it on (`FLAGS_OVERRIDE`); denied: init script sets `Notification.permission = "denied"` → `denied` + Check again; WebKit iPhone (not standalone) → `ios_install` + Show me how opens the install sheet; Install app row visible only when the P11 export reports eligible |
| `notif-prompt.spec.ts` | lease `p10-notify` | from Settings: ask → Turn on → waiting → granted toast with the next reminder time; Not now sets the 30-day dismissal |
| `reminders.spec.ts` | lease `p10-notify` | `serverNow.set()` to 10 min before the chosen minute, 1 due card → planner run (`/api/dev/jobs` shows the `rem:` row) → advance → notification row `SENT`; quiet hours: a 22:30 local send is deferred to 08:00 |
| `account-username.spec.ts` | lease `p10-username` + `p10-rival` | availability states (taken by the rival, reserved `admin`, invalid `_x`); change → profile URL updates; `/@old` → 308; second change → cooldown date; race: both claim the same free handle at once → one gets the `error` banner |
| `account-export.spec.ts` `@smoke` | lease `p10-export` | Request export → "Preparing…" → (≤ 3 min) "Your export is ready" via socket → Download (`no-store`) → ZIP has the 8 entries; second request within 24 h → inline next-allowed date |
| `account-delete.spec.ts` | throwaway `e2e-del-<runId>` + lease `p10-profile` | `POST /api/dev/fixtures/game` creates a finished human game between them; the throwaway user opens the modal → counts shown → wrong case → hint → correct → Clerk step-up (password) → Deleting → deleted → signed out on `/?account=deleted`; the persona's `/games` row vs "Deleted player" still opens the review; Clerk Backend API (test helper) returns 404 for the user; `GET /api/dev/account-deletions/latest` shows all steps `done` ≤ 5 min; the sink has `account_delete_completed` exactly once |
| `account-delete-blockers.spec.ts` | throwaway `e2e-del-<runId>-b` | live game open in another context → modal shows `in_game` banner, Delete disabled |
| `membership-states.spec.ts` (m) `@smoke` | none | `/dev/ui/account/membership?state=<13 values>`: each renders its plan line, pill, actions; visual snapshot per state on desktop and iPhone (`@demo:` tags with reason "billing states not reachable on demand") |
| `membership-trial-days.spec.ts` | lease `p10-trial` | `serverNow` at `trialEndsAt − 1 ms` shows "DAY 7 OF 7"; at `trialEndsAt` the state follows the persona; `serverNow` at `pausedFrom ± 1 ms` on `p10-paused` flips scheduled ↔ active (testing X5) |
| `membership-dodo.spec.ts` `@dev-url` | throwaway `e2e-bill-<runId>-trial`, `e2e-bill-<runId>-paid` | trial user: onboarding plan → Dodo test card → trial state with DAY n OF 7 → the `TRIAL_ENDING` row exists with `runAt = trialEndsAt − 48 h` → Switch to yearly (trial copy) → done → Cancel trial (trial_offer → reason → trial_done) → `trial_cancelled` → Keep my trial → `trial`. Paid user: monthly checkout → `active` → hover Switch prefetches preview → modal shows Dodo amount → Confirm → `active_yearly`; Switch to monthly → `switching` → Keep yearly; Cancel → offer → Pause instead → `paused (scheduled)` → Cancel pause → `active_yearly`; Cancel → Continue → reason → Confirm → `cancelling` → Resume → `active_yearly`; Manage billing opens a Dodo test portal URL in a new page |
| `membership-past-due.spec.ts` | throwaway `e2e-bill-<runId>-pastdue` | `POST /api/dev/billing/simulate?state=past_due` → state, banner, payment-failed copy without a retry date; Update payment → navigates to a Dodo test payment link host; `?payment=updated` → exactly one `POST /api/billing/refresh` |
| `account-authz.spec.ts` `@smoke` | R, guest | R: review-batch → 402 `subscription_required` → pricing; guest: `/settings` → sign-in with `redirect_url`; guest `GET /api/me/preferences` → 401; R's `/@R` renders empty states; every `/api/dev/*` route answers 404 without `x-e2e-token` |
| `shared-device-cache.spec.ts` | lease `p10-profile` + `p10-rival` | user 1 opens an invoice URL, `export.pgn`, `/api/me/export` and `/settings/membership`, signs out; user 2 signs in in the same context and requests the same URLs: every response comes from the network and is 404/403 or user 2's own data (api-perf §5, AP-04) |
| `request-budget.spec.ts` (extend P1's) | lease `p10-profile` | hard load `/u/<u>`, `/settings/board`, `/settings/membership`: 0 `/api/*` requests before `load` except `/api/billing/details` on membership; total ≤ 3; 0 GETs to Dodo-backed routes |
| `account.a11y.spec.ts` (`e2e/devices/ui/`) | lease `p10-profile` | axe in light and dark on `/@<u>` (each tab), `/settings/*` (incl. Training), every membership state on the demo route and every modal (switch, cancel steps, delete, notification prompt, board settings sheet): 0 serious/critical violations |
| `account.keyboard.spec.ts` | lease `p10-profile` | keyboard only: settings drill-in and back, delete modal (focus starts in the input, focus trap, Esc closes unless deleting, confirm field), cancel flow steps (heading receives focus on step change), Games bulk mode (Space, ⌘/Ctrl+A) |

**Telemetry asserted through the sink (X6)**, one spec each: `settings_changed {section, keys}` (keys only, never values; the PII guard checks the typed bio text is absent), `membership_action_clicked {action, state}` for switch/cancel/pause/resume, `push_permission_result {result}`, `profile_edit_saved {fields}`, server `account_delete_completed {source}` exactly once, server `notification_sent {kind, channel, lagSec}`. Server events are registered `consentExempt: true`.

### 12.6 Device × zoom suite (`WEB/e2e/devices/account/*.spec.ts`, all 40 projects)

Runs in CI against `next build && next start` with Docker Postgres (feasibility F-VER-3), nightly for all 40 projects and on PRs for the 4-project subset (X9); the deployed dev URL gets only the `@smoke` subset. Pages: `/@<u>` (each tab, with the `stress=1` long-name fixture), `/p/<u>` (guest), `/profile/edit`, `/settings`, `/settings/board`, `/settings/pieces`, `/settings/sounds`, `/settings/training`, `/settings/notifications`, `/settings/account?modal=delete-account`, `/settings/membership`, `?modal=switch-plan&to=yearly`, `?modal=cancel`, `?modal=notif-prompt`, `/game/<fixture>?modal=board-settings`. Assertions per page: `document.scrollingElement.scrollHeight <= innerHeight` (no document scroll; panels scroll internally); on `/settings/board`, `/settings/pieces` and the board-settings sheet the board's bounding box is fully inside the viewport and ≥ 220 px; dialogs and sheets fit (`max-height ≤ 90dvh`) with the primary CTA inside the viewport without scrolling the sheet at 100 % zoom; at ≤ 620 px height the profile meta line is hidden; touch targets ≥ 44 px on coarse projects; no horizontal overflow; CLS ≤ 0.05 during load (PerformanceObserver). Visual baselines (X10): profile overview, settings board (each theme), membership `active`, `trial`, `past_due`, `paused`, delete modal `typed`, notifications `enabled` — light and dark, 4 UI projects.

### 12.7 Chess-correctness fixtures

- Stats phase accuracy: fixture `game_players` rows built from P3's analysed fixture games (`prisma/seed-data/analyses/*.json`) with hand-computed expected weighted accuracies per phase (`WEB/test/fixtures/stats/*.json`).
- PGN export: for every fixture game, the exported PGN replays legally from its start FEN with chess.js, the final FEN equals `games.fen`, legend-position games carry `[SetUp "1"] [FEN "…"]`, and the Seven Tag Roster is present.
- Mini boards: milestone and game-row mini boards render the stored `games.fen` (DTO field `finalFen`; snapshot of 3 FENs including a promotion and castling position).
- Board preview: the Opera Game position after 9…b5, `rn2kb1r/p3qppp/2p2n2/1p2p1B1/2B1P3/1QN5/PPP2PPP/R3K2R w KQkq - 0 10` (copied from `DR/V4SettingsBoard.dc.html`), is a legal position per chess.js and renders with the c4 bishop highlighted; the Pieces preview uses the standard starting FEN.

### 12.8 Regression of earlier phases

- P1: shell nav tests updated (Settings visible with `account-v3`, Profile href `/@`, chords `g u`, `g s`), dead-link test passes with the new destinations, ShortcutsDialog switch now synced.
- P2: board renders identically under the default Graphite theme (visual baseline unchanged); live game sound and premove behaviour driven by prefs (premove `off` blocks premoves in a human game; bots ignore premove).
- P3: `/games` archive bulk review and export enabled; review access rules unchanged for non-players.
- P4: Connected accounts specs run at the new route inside the shell (paths updated; components unchanged).
- P5: W8's extended fields round-trip; P5's train specs green; the Train hub reflects new caps and release hour.
- P6: TR-12 scope writes go through `patchPreferences` (version bump, `prefs:updated`); weakness specs green.
- P9: bot strength pref still persisted; `/play?tab=friend&opponent=` shows the label only without a block; accept is refused across a block.
- P11 (when merged): the `sw-on` project runs `notifications.spec.ts` through the new SW.
- Billing: all `lib/billing/*.test.ts` pass; the P0 entitlement matrix test gains the pause rows; middleware gate tests include `md.paused`.

### 12.9 Manual checklist on the dev site (ego-browser, logged in as the E2E users; plus real devices)

1. Owner test script §1 steps 1–14.
2. Real iPhone (Safari, then installed PWA): profile tabs scroll horizontally; settings drill-in; Notifications shows `ios_install` in Safari and `push_off` in the installed app → Enable → test push arrives on the lock screen; tapping it opens `/train`.
3. Real Android (Chrome): push test, reminder at the next planned minute, quiet hours (set the phone's time zone so 22:00 is near) defers delivery.
4. Desktop Chrome at 80 %, 125 %, 150 % zoom on `/settings/board` and the membership modals.
5. Dark mode via OS setting with "Match system": no flash on reload; Clerk widgets follow.
6. Email: reminder email (enable email for Mistakes due), weekly digest via the dev "send now" action (`/dev/ui/account/notify?send=weekly`), unsubscribe link (one click in Gmail) flips only that channel; headers show `List-Unsubscribe-Post`.
7. Dodo test dashboard: subscription states after switch, cancel, pause, resume, delete; invoices downloadable; portal opens.
8. Clerk dev dashboard: email change applied; deleted user removed.
9. `scripts/qa/error-window.ts --since <last deploy>` over ≥ 24 h: no new Sentry issues or Vercel runtime errors, or each triaged; `x-request-id` present on errors.
10. Close every opened tab (`task.finish({ keep: [] })`) when done (CLAUDE.md "Accounts and browsers").
11. Record everything in `docs/qa/phase-10-signoff.md` (§12.11).

### 12.10 Performance checks

The §9.7 k6 scenarios run against dev before the flag flip, with results committed to `perf/results/p10-<scenario>-<sha>.json`; `EXPLAIN` captures from §9.1 committed to `docs/perf/p10-plans.md`; bundle budgets from §9.4 enforced by CI.

### 12.11 CI gates, QA record and regression scope (testing X2, X8, X11, X14, X15, X18)

- **CI.** P10's specs run in `ci.yml` (`unit`, `integration`, contracts, `e2e-smoke` with the paywall on), in `nightly.yml` (`e2e-full` and `devices-full`, all 40 projects, against `next start`), and in `post-deploy-dev.yml` (`@smoke` against the dev URL). Specs that need the local mocks (push sink with the local worker, telemetry sink, `x-rc-now`) are `@local-only`; the Dodo flows are `@dev-url`.
- **Regression = the whole suite** on the final SHA, plus a `flags-off` run with `account-v3` off that executes P1–P9's `@smoke` specs (the legacy profile and `MembershipSection` paths stay green until the parity deletion). Targeted extras in §12.8.
- **State coverage.** `state-coverage.ts` shows 0 missing states for the 39 P10 boards; demo-only states (the 13 membership states, `V4PlanSwitch` `preview_unavailable`, `V4CancelSub` `error`, `V3NotifPrompt` `denied`) each carry a reason in `design-states.overrides.json`.
- **Hooks.** Every test hook in §7.11 is in `WEB/lib/test-hooks/registry.ts`; `prod-guard.spec.ts` proves each returns 404 or is ignored in the production-mode build.
- **Defects.** Every defect found by the owner test, the ego-browser checklist or the real-device pass gets a failing test first, named `regression: <slug> (#issue)`; `quarantine.json` has no expired P10 entries.
- **Sign-off record.** `REPO/docs/qa/phase-10-signoff.md`: SHA, Vercel deployment id, OCI image tags; each owner-test row with pass/fail and the screenshot path (`docs/qa/phase-10/`); real devices (model, OS) and zoom levels; the state-coverage table; the `error-window.ts` output for ≥ 24 h after the last dev deploy; the PostHog live-view check; k6 result files; defects with their regression tests.
- **Performance results as data.** k6 writes `REPO/perf/results/p10-<scenario>-<sha>.json`; `perf/compare.ts` flags > 15 % regressions on the shared scenarios (`me`, `api-read-mix`).

---

## 13. Work breakdown

Seven packages. **WP0 runs first** (it owns every shared file and creates the stubs the others fill); **WP1–WP5 run in parallel** with strict file ownership; **WP6** integrates. A file appears in exactly one package's list; a package that needs a change in another package's file asks its owner (additive changes only, recorded in the hand-back). Stub files that WP0 creates for others (realtime handler modules, worker job modules, planner slices, the dev demo fixtures) are handed over when WP0 merges. Edits to files owned by earlier phases are listed under exactly one P10 package and kept to the lines named there.

### 13.0 Shared files across the parallel phases (feasibility §7 and §10.16; consistency R-19)

| File | Owner while P10 ∥ P11 ∥ P12 run | How the others change it |
|---|---|---|
| `WEB/components/shell/AccountMenu.tsx` | **P10 WP0** | P11 hands its "Install App" item to WP0 as a one-line addition |
| `WEB/app/api/webhook/clerk/route.ts` | **P10 WP5** | P11 WP-C's `user.created` changes go through WP5 |
| `WEB/worker/index.ts` | **P11** | P10 owns `WEB/worker/push.ts`; P11's index imports it (P10 creates a minimal index only if it merges first) |
| `WEB/app/(app)/layout.tsx` | **P11 WP0** | P10 hands over the `<PrefsBootstrap/>` line |
| `WEB/middleware.ts` | frozen after P1; route classes in `WEB/lib/routes/classes/account.ts` (P10 WP0) | — |
| `WEB/lib/api/keys/account.ts`, `WEB/lib/flags/registry/p10.ts`, `WEB/lib/cron/tasks/{membership-reconcile,trial-reminder-backstop}.ts`, `WEB/lib/realtime/handlers/{prefs,profile,membership,account,milestones,blocks}.ts`, `WEB/config/redirects/p10.mjs`, `WEB/e2e/personas/p10.ts`, `WK/src/scheduler/recurring/p10-*.ts`, `CT/http/registry/account.ts` | P10 (new files in P1's directory registries) | barrels get one line each |
| `CT/http/codes.ts` | append-only; P10 WP0 adds `reverification_required` and its reasons (or reuses P12's if P12 merged first) | — |
| `WEB/lib/r2/presign.ts`, `TournamentParticipant.displayName`, the notification kinds | first of P10/P12 to merge creates; the second reuses (`IF NOT EXISTS`) | — |
| `SCHEMA` | one steward per week (allocation) | — |

If P1 kept single-file registries, WP0 is the only P10 editor of each and rebases on P11/P12 daily.

```
day:  1   2   3   4   5   6   7   8   9   10  11  12
WP0 ███▌▎
WP1     ███████████████████ (4.75)
WP2     ████████████████ (4.0)
WP3     ██████████████ (3.5) — UI tasks after WP2.1 lands (day 3)
WP4     ██████████████ (3.5)
WP5     ████████████ (3)
WP6                                       ██████ (1.5)
```

(One developer with parallel Claude agents; calendar ≈ 9–10 working days; effort **22 dev-days** + 20 % buffer (4.4 d) for owner review, defects and the Dodo spike outcome. The +2 against the allocation's 20: AP-03 route split +0.25, Settings › Training +0.5, Board settings sheet +0.25, trial reminder + Resend setup + durable email budget +0.5, testing additions (personas, a11y, keyboard, telemetry, sign-off) +0.5; removals (second report table, prefs alias) −0.25; WP0 registry and codes work +0.25.)

### WP0 — Foundations, schema, contracts, wiring (1.75 d)

**Files (create or edit; WP0 is the only package touching them):** `SCHEMA` (M10 models, `EmailBudgetDay`, C3 relation changes); `DBP/prisma/migrations/*_m10a_job_kinds/`, `*_m10_account_area/`, `*_c3_user_fk_set_null/`, `*_c3v_validate_user_fks/`; `DBP/prisma/protected-indexes.txt`; `DBP/src/jobs.ts` (P10 `JOB_PRIORITY` names); `WEB/scripts/backfill/{usernames,prefs-derived,participant-names,milestones-initial}.ts`; `WEB/prisma/seed/{personas,fixtures}.ts` (P10 seed personas); `WEB/e2e/personas/p10.ts` (lease reset modes); `WEB/lib/profile/{username,reserved,blocked-words}.ts`; `CT/http/{players,profile,profile.rules,notifications,account,billing}.ts`, `CT/http/registry/account.ts`, `CT/http/codes.ts` (append), `CT/http/me.ts` (`MembershipState += "paused"`), `CT/socket/{user,presence}.ts` + `CT/socket/registry.ts` entries, `CT/internal/{account,kick}.ts`; `DBP/json/preferences.ts` (P10 leaves); `WEB/lib/api/keys/account.ts`; `WEB/lib/rate-limit-buckets.ts`; `WEB/lib/test-hooks/registry.ts` (P10 entries); `WEB/lib/flags/registry/p10.ts`; `WEB/lib/routes/classes/account.ts`; `WEB/config/redirects/p10.mjs`; `WEB/lib/nav/destinations.ts` (+ test); `WEB/components/shell/AccountMenu.tsx`; `WEB/lib/realtime/handlers/index.ts` + stubs `{prefs,profile,membership,account,milestones,blocks}.ts`; `WK/src/jobs/index.ts` + stub job files listed in WP3–WP5; `WK/src/scheduler/recurring/p10-*.ts` (stubs); `turbo.json`; `WEB/.env.example`, `WK/.env.example`; `WEB/vercel.json` (`supportsCancellation` for `app/api/me/games/export.pgn/route.ts`); `WEB/app/dev/ui/account/[screen]/page.tsx` + `WEB/app/dev/ui/account/fixtures.ts`.

| # | Task | Acceptance |
|---|---|---|
| 0.1 | Schema M10 + C3 relation changes; generate migrations against local Docker shadow; hand SQL §6.4/§6.7; protected-index list | `migrate deploy` from scratch on Docker PG17 green; drift check green; `prisma validate` ok (no duplicate `User` relations); C3 files present but **not applied** until owner confirmation |
| 0.2 | Apply M10a + M10 to the Neon dev branch (`migrate deploy`; never `db push`), owner-confirmed C3 + C3v after; writers stay off for one deploy (two-release rule) | `_prisma_migrations` shows the files; spot query on new tables; E2E users intact |
| 0.3 | Contracts + registries + qk keys + rate-limit buckets (with `durable` store; `rate_limit_windows` if P1 lacks it) + codes + socket schemas + test-hook entries | `check-types` green; OpenAPI regenerated; contract-test matrix generated (red until routes exist); registry tier lint green |
| 0.4 | Route classes (`/@` → `/u`/`/p`, `public-api` class without Clerk for public player GETs, non-member allow-list, `md.paused`); redirects; nav destinations + chords; account menu links | unit tests for the matcher table; flags off → no route change |
| 0.5 | Handler registry, worker job registry and planner slice stubs; socket registry entries | worker boots with stubs (no-op handlers); socket accepts the new events |
| 0.6 | Backfill scripts (B8, B12–B14) with `--dry-run`; seed personas; lease reset modes | dry-run on dev prints counts; seed and resets idempotent |
| 0.7 | Dev demo route scaffold (`/dev/ui/account/{profile,settings,training,membership,plan-switch,cancel,delete,notif-prompt,notify,board-sheet}?state=`) | placeholders that WPs replace |

### WP1 — Profile, players API, presence, edit, blocks/reports, bulk actions (4.75 d)

**Files:** `WEB/app/(app)/u/[username]/{page,loading,not-found}.tsx`; `WEB/app/(public)/p/[username]/{page,opengraph-image}.tsx`; `WEB/app/(app)/profile/page.tsx`; `WEB/app/(app)/profile/[referenceId]/page.tsx` (replace with redirect); `WEB/app/(app)/profile/edit/page.tsx`; `WEB/app/api/players/[username]/{route.ts,me/route.ts,rating-history/route.ts,games/route.ts,stats/route.ts,milestones/route.ts}`; `WEB/app/api/players/search/route.ts`; `WEB/app/api/me/players/search/route.ts`; `WEB/app/api/me/{rating-history,stats,milestones}/route.ts`; `WEB/app/api/me/profile/route.ts`; `WEB/app/api/me/avatar/upload-url/route.ts`; `WEB/app/api/me/blocks/route.ts`, `WEB/app/api/me/blocks/[username]/route.ts`; `WEB/app/api/me/games/review-batch/route.ts`; `WEB/app/api/me/games/export.pgn/route.ts`; `WEB/app/api/profile/[referenceId]/route.ts` (alias); `WEB/lib/data/{players,player-stats}.ts`; `WEB/lib/profile/{visibility,rating-history,stats,bio,display-name}.ts` (+ tests); `WEB/lib/services/profile.ts`; `WEB/lib/r2/presign.ts` (shared helper; P12 imports it); `WEB/lib/presence/ticket.ts`; `WEB/features/profile/*`; `WEB/features/profile-edit/*`; `WEB/lib/realtime/handlers/{profile,blocks}.ts`; P3 edits: `WEB/features/games/ArchiveScreen.tsx` (enable bulk toolbar), `PKG/contracts/src/http/games.ts` (`GamesQuery += src, legend`), `WEB/lib/data/games.ts` (the two filters); P5 edit: `WEB/lib/reports/reports.server.ts` + `PKG/contracts/src/http/reports.ts` (user and game branches); P9 edits: `WS/src/queue/pairer.ts` (block read + cache drop on `blocks:changed`), `WEB/app/api/challenges/[code]/accept/route.ts` (block check + `CHALLENGE` producer call), the friend tab component (`?opponent=` label); `WS/src/presence/*`; `WS/src/handlers/index.ts` (one line); tests `WEB/test/api/{players,players-me,me-profile,blocks,reports-user,review-batch}.test.ts`, `WS/test/presence.test.ts`, `WEB/e2e/specs/account/profile-*.spec.ts`, `WEB/e2e/specs/account/shared-device-cache.spec.ts`, `WEB/e2e/devices/account/profile.spec.ts`; legacy deletions `WEB/app/(app)/profile/[referenceId]/{layout,ProfileHero,StatsOverview,GameHistory,ChessComRatings,ChessComConnectModal,loading}.tsx` (after parity, in WP6's checklist).

| # | Task | Est. | Acceptance |
|---|---|---|---|
| 1.1 | `getPublicPlayer` loader + `publicProjection`/`viewerProjection` + rating history + stats CTE + h2h; PLY-1…8 and ME-19…21 routes | 1.5 d | contract tests green; public routes byte-identical signed in and out, no `Set-Cookie`; statement counts per §9.1 asserted by a Prisma query-count test; EXPLAIN captured |
| 1.2 | `/u/[username]` page (all tabs, states, keyboard), not-found with search, legacy redirects | 1.25 d | `profile-own`/`profile-other` specs green; device suite green for profile pages |
| 1.3 | Guest `/p/[username]` ISR + OG image; CDN headers and tag purges | 0.5 d | `profile-guest`, `profile-public-cache` specs; `x-vercel-cache: HIT` on dev |
| 1.4 | Profile edit (form with `profile.rules`, avatar presign + XHR upload + HEAD verify, initials) | 0.75 d | `profile-edit` spec; uploaded object public at the media host with `immutable` caching and the D11 headers |
| 1.5 | Presence (socket registry, tickets, `usePresence`, `presence:state`); blocks (API, menu, `blocks:changed`, pairer/accept checks); report dialog through P5's handler; Challenge link + P9 friend-tab label | 0.5 d | socket tests; block hides Challenge both ways; pairer test skips blocked pairs; user report lands in `reports` with `reportedUserId` |
| 1.6 | Bulk review + PGN export (profile and P3 archive, `supportsCancellation`) | 0.25 d | rows go Queued → done; exported PGN replays (fixture test); aborted download stops the DB loop |

### WP2 — Settings shell, preferences, Training, Board settings sheet (4.0 d)

**Files:** `WEB/app/(app)/settings/{layout,page,loading}.tsx`; `WEB/app/(app)/settings/{board,pieces,sounds,appearance,training}/page.tsx`; `WEB/app/(app)/settings/connected/page.tsx` (re-export P4's screen); `WEB/lib/data/settings.ts`; `WEB/lib/services/preferences.ts` (`patchPreferences`); `WEB/lib/prefs/{store,sync,merge,derived,bootstrap,apply-css,migrate-legacy,broadcast}.ts` (+ tests); `WEB/app/api/me/preferences/route.ts` (P9 file; full PATCH/GET through `patchPreferences`); P5 edits: `WEB/app/api/train/prefs/route.ts` + `WEB/lib/train/prefs.server.ts` (extended `TrainPrefsPatch`, derived recompute, `profile:updated`, reminder upsert), `PKG/contracts/src/http/train.ts` (`TrainPrefsPatch`/`TrainPrefs`); P6 edit (only if P6 merged first): `WEB/lib/services/train/weakness.ts` scope write → `patchPreferences`; P2 edits: `WEB/components/board/*` CSS-variable consumption (`Board.tsx`, `board.css`, `Piece.tsx` — whichever P2 created), the `GameMenu` "Board settings" item (one line); `WEB/app/globals.css` (board theme variable blocks under `[data-board-theme]`, `[data-motion]`, `--board-dim`); `WEB/lib/sound/{engine,voice}.ts`; `WEB/lib/hooks/useChessSound.ts` (delete; callers switched); `WEB/app/components/ThemeProvider.tsx`; `WEB/app/components/ThemeToggle.tsx` (delete); `WEB/lib/shell/prefs.ts`; `WEB/features/settings/*` (incl. `TrainingSection`, `BoardSettingsSheet`); `WEB/lib/realtime/handlers/prefs.ts`; tests `WEB/test/api/{me-preferences,train-prefs}.test.ts`, `WEB/e2e/specs/account/settings-{shell,sync,sounds,training}.spec.ts`, `WEB/e2e/specs/account/board-settings-sheet.spec.ts`, `WEB/e2e/devices/account/settings.spec.ts`.

| # | Task | Est. | Acceptance |
|---|---|---|---|
| 2.1 | Shell layout (list + detail, phone drill-in, iPad default Board, summaries incl. Training, non-member filtering, save pill) | 0.75 d | shell spec; device suite for `/settings` |
| 2.2 | `patchPreferences` (merge/derived, version, emit), PATCH/GET, P5 W8 extension, P6 scope path | 0.5 d | API tests incl. concurrent leaves; derived fixtures; TR-12 bumps `prefsVersion` |
| 2.3 | `usePrefs` store, debounce sync, BroadcastChannel with the version skip, offline pending, legacy migration, `PrefsBootstrap` (no flash) | 0.75 d | sync spec ≤ 3 s cross-device and 0 same-device requests; no theme/board flash on reload (Playwright screenshot of the first frame) |
| 2.4 | Board + Pieces sections with live preview; board consumers (CSS vars, coords, legal, last move, input, tap-confirm, auto-queen, premove, orientation, animation, material diff); in-game Board settings sheet | 1.0 d | visual baselines per theme; premove/auto-queen honoured in a P2 game spec; sheet spec |
| 2.5 | Sounds (engine singleton, autoplay detection, tests, voice) + Appearance (theme, motion, dim, language) | 0.5 d | sounds spec; reduced-motion respected; Clerk theme follows |
| 2.6 | Settings › Training (§4.18) | 0.5 d | training spec; P5's Train hub reflects the new values |

### WP3 — Notifications, push, email, milestones (3.5 d)

**Files:** `WEB/app/(app)/settings/notifications/page.tsx`; `WEB/features/notifications/*` (`NotificationsSection`, `ChannelTable`, `PushBanner`, `NotifPromptDialog`, `TimeZoneMismatchBanner`, `InstallAppRow`, `usePushState`, `subscribe.ts`); `WEB/worker/push.ts` (+ test); `WEB/app/api/me/push-subscriptions/route.ts`, `…/[id]/route.ts`, `…/[id]/test/route.ts`; `WEB/app/api/push/clicked/route.ts`; `WEB/app/email/unsubscribe/page.tsx`; `WEB/app/api/email/unsubscribe/route.ts`; `WEB/app/api/dev/{push-sink,notifications}/route.ts`; `WEB/lib/notify/{schedule,quiet-hours,dispatch-rules,tokens,producers,email-budget,trial-ending}.ts` (+ tests); `WEB/lib/cron/tasks/trial-reminder-backstop.ts`; `WEB/lib/milestones/definitions.ts` (+ test); `WEB/lib/realtime/handlers/milestones.ts`; P4 edit: the `onEntitlementApplied()` hook point (one call to `scheduleTrialEnding()`); P5 edit: `POST /api/train/sessions/:ref/end` (W4) `after()` → `MILESTONES_EVALUATE` (one line); `WK/src/jobs/notify/{dispatch,reminders,weekly}.ts`; `WK/src/notify/{webpush,email,budget}.ts`; `WK/src/notify/email/templates/{layout,reminder,weekly,trial-ending,export-ready,export-failed,account-deleted,payment-failed,email-changed}.ts`; `WK/src/jobs/account/{milestones-evaluate,after-analysis}.ts`; `WK/src/scheduler/recurring/p10-{reminders,weekly,dst,milestones}.ts`; `WK/src/jobs/analyze-game.ts` (P3; one hook line); tests `WEB/test/api/{push,unsubscribe}.test.ts`, `WK/test/jobs/{notify-dispatch,milestones-evaluate}.test.ts`, `WK/test/timer-audit.test.ts`, `WEB/test/integration/{notifications-claim,reminders,email-budget}.int.test.ts`, `WEB/e2e/specs/account/{notifications,notif-prompt,reminders}.spec.ts`.

| # | Task | Est. | Acceptance |
|---|---|---|---|
| 3.0 | Resend set-up: domain `playchess.tech` verified, DKIM/SPF/DMARC DNS-only in Cloudflare, API keys per environment, `mail-tester` ≥ 9 | 0.25 d | test email from the dev worker lands in Gmail inbox with DKIM pass |
| 3.1 | Push subscription API, `worker/push.ts`, `usePushState`, Notifications section states incl. `tournament_new`, Install app row, time-zone banner, NotifPrompt | 1 d | notifications + prompt specs on Chromium and WebKit iPhone |
| 3.2 | Worker dispatcher (web-push, Resend, durable budget, quiet hours, failure policy, future-dated retries), templates, unsubscribe page + POST, click endpoint | 1 d | dispatch tests; real push to a desktop Chrome and an Android device on dev |
| 3.3 | Planner slices (reminders with the wake cap, weekly, DST, milestone backstop), web-side reminder upserts, REVIEW_READY, CHALLENGE (accept path) and TRIAL_ENDING producers + backstop task | 0.75 d | reminder integration test; timer-audit test; a real reminder arrives within 2 min on dev with no idle query in between |
| 3.4 | Milestones definitions (incl. `TOURNAMENT_PODIUM`), evaluate job, analysis and session-end hooks, toast handler, B14 run | 0.5 d | evaluate tests; award toast in the profile spec |

### WP4 — Membership (3.5 d)

**Files:** `WEB/app/(app)/settings/membership/page.tsx`; `WEB/features/membership/*` (`MembershipScreen`, `PlanCard`, `TrialStrip`, `IncludedList`, `BillingCard`, `InvoiceTable`, `PlanSwitchDialog`, `CancelFlowDialog`, `useMembershipActions`, `openPortal.ts`); `WEB/lib/billing/{membership-view,pause-rules,proration-estimate,billing-details,format,refresh}.ts` (+ tests); `WEB/lib/billing/{entitlement-rules,subscription-action-rules,subscription-actions,entitlement}.ts` (edits) + their tests; `WEB/app/api/billing/{membership,details,portal,refresh}/route.ts`, `WEB/app/api/billing/invoices/[paymentId]/route.ts`; `WEB/app/api/subscription/{pause,payment-method}/route.ts`; `WEB/app/api/subscription/{cancel,resume,change-plan,change-plan/preview}/route.ts` (edits); `WEB/app/api/customer-portal/route.ts` (alias); `WEB/app/api/webhook/dodo-payments/route.ts` (edit); `WEB/lib/cron/tasks/membership-reconcile.ts`; `WEB/app/api/internal/billing/{pause-edge,customer-sync}/route.ts`; `WEB/app/api/dev/billing/simulate/route.ts`; `WK/src/jobs/account/{pause-edge,dodo-customer-sync}.ts`; `WEB/lib/realtime/handlers/membership.ts`; `CT/socket/user.ts` `entitlement:changed` extension (with P4's owner); deletions `WEB/app/(app)/profile/[referenceId]/{MembershipSection,MembershipModal}.tsx`; tests `WEB/test/api/{billing-*,subscription-pause,webhook-dodo}.test.ts`, `WEB/e2e/specs/account/membership-*.spec.ts`, `WEB/e2e/devices/account/membership.spec.ts`.

| # | Task | Est. | Acceptance |
|---|---|---|---|
| 4.0 | **Dodo test-mode spike** for D6 (`next_billing_date` update) and immediate cancel (`status:"cancelled"`); record results in this spec's §14 | 0.25 d | written outcome; `PAUSE_MODE` default chosen |
| 4.1 | `deriveMembershipView` + `isEntitled` pause window + formats + estimate (pure, fully tested) | 0.5 d | §12.1 unit tests green |
| 4.2 | Membership read APIs (DB-only membership, details, invoices `no-store`, portal), `POST /api/billing/refresh`, webhook additions (CAS, `entitlement:changed` with `cause`), reconcile task | 0.75 d | API tests; webhook tests; reconcile dry run on dev; no GET reaches Dodo (spy) |
| 4.3 | Pause, cancel-pause, resume-now, payment-method; action routes envelope + `membership` responses + codes; pause edge jobs + INT-P2 | 0.75 d | pause tests; edge job flips claims on dev (`serverNow`-driven persona) |
| 4.4 | Membership page (13 states), Billing card, switch dialog (9 states), cancel dialog (8 states + pause) | 1.25 d | states spec; trial-days spec; Dodo e2e; device suite incl. sheets on phones |

### WP5 — Account: email, password, username, export, delete (3 d)

**Files:** `WEB/app/(app)/settings/account/page.tsx`; `WEB/features/account/*` (`AccountSection`, `EmailChange`, `PasswordDialog`, `UsernameField`, `VisibilityControl`, `PrivacyGroup`, `ExportRow`, `DeleteAccountDialog`); `WEB/app/api/usernames/availability/route.ts`; `WEB/app/api/me/username/route.ts`; `WEB/app/api/me/export/route.ts`, `WEB/app/api/me/export/download/route.ts`; `WEB/app/api/me/deletion-preview/route.ts`; `WEB/app/api/me/route.ts` (P1 file; add DELETE); `WEB/app/api/internal/account-purge/[deletionId]/[step]/route.ts`; `WEB/app/api/webhook/clerk/route.ts` (edits; P10 owns it during P10∥P11); `WEB/app/api/dev/{fixtures/game,account-deletions,jobs}/route.ts`; `WEB/lib/services/{account-deletion,username,export}.ts`; `WEB/lib/account/deletion-plan.ts` (+ test); `WEB/lib/realtime/handlers/account.ts`; `WK/src/jobs/account/{export-build,account-purge}.ts`; `WK/src/r2/{client,multipart}.ts`; `WK/src/scheduler/recurring/p10-housekeeping.ts` (prunes, R2 sweep row); `WK/src/jobs/account/r2-sweep.ts`; `docs/runbooks/account-deletion.md`; C3 null-safety edits in readers of `game.creator`, `game.opponent`, `participant.user`, `tournament.createdBy` (grep list committed in the PR); tests `WEB/test/api/{me-username,me-delete,me-export}.test.ts`, `WEB/test/integration/{account-deletion,username,c3-fks}.int.test.ts`, `WK/test/jobs/{export-build,account-purge}.test.ts`, `WEB/e2e/specs/account/{account-username,account-export,account-delete,account-delete-blockers,account-authz}.spec.ts`, `WEB/e2e/devices/ui/account.a11y.spec.ts`, `WEB/e2e/specs/account/account.keyboard.spec.ts`.

| # | Task | Est. | Acceptance |
|---|---|---|---|
| 5.1 | Account page: email change and password via Clerk, Google row, visibility, Privacy group, username field + availability + change + history redirect | 0.75 d | username spec; Clerk email change reflected in DB via webhook on dev |
| 5.2 | Export: API, worker build (ZIP streaming to R2), email, socket, download redirect, sweep | 0.75 d | export spec; worker test memory bound |
| 5.3 | Delete: preview, typed modal, step-up, `deleteAccount` transaction (reports, consent line, tag purge), purge job + INT routes, Clerk `user.deleted`, runbook | 1.25 d | deletion integration test; delete e2e; heavy-fixture timing gate met |
| 5.4 | C3 readers audit (null-safe) | 0.25 d | `check-types` with the nullable relations; P2/P3/P12 specs still green |

### WP6 — Integration, QA, launch to dev (1.5 d)

**Files:** `docs/implementation-plan.md` (pointer to this spec); `perf/k6/src/scenarios/{account-reads,guest-profile,prefs-write,notify-burst,delete-heavy}.ts`; `docs/perf/p10-plans.md`; `docs/qa/phase-10-signoff.md` + `docs/qa/phase-10/`; `design-states.overrides.json` P10 entries; removal of legacy profile files listed in WP1 after the parity check.

| # | Task | Acceptance |
|---|---|---|
| 6.1 | Run backfills on dev (`--apply`), enable `account-v3` for owner + A–P + pool users | B8 verification query 0 rows; flags on |
| 6.2 | Device × zoom suite triage; request-budget, shared-device-cache, a11y and keyboard specs; bundle budgets; state coverage 0 missing | all green |
| 6.3 | k6 scenarios and EXPLAIN captures; result JSON files | thresholds met; files committed |
| 6.4 | Owner test script on dev with ego-browser + real iPhone and Android; sign-off record | all 14 steps pass; tabs closed; `phase-10-signoff.md` committed |
| 6.5 | Legacy removal (profile page parts, `MembershipSection`, `MembershipModal`, `ThemeToggle`, `useChessSound`) once parity holds; kept one release behind `account-v3` off first (feasibility §9 rule 3) | grep finds no imports; build green |

### Launch A thin slice (feasibility §8)

If the owner picks the "Launch A" cut (P1–P5, P7, a thin P10 and P11, P13), P10 ships this subset first (≈ 7.5 dev-days; feasibility estimated ≈ 6 before the trial reminder and the durable email budget moved here) and the rest after launch:

| In the thin slice | Package tasks | Notes |
|---|---|---|
| Settings shell with Account, Connected, Membership only | WP2.1 (reduced) | Play/App sections stay on today's local settings |
| Membership: 13 states, switch, cancel + pause, payment update, refresh, webhook additions, reconcile | WP4 (all) | billing truth must be right before charging |
| Account: email, password, export, delete (C3 + transaction + purge) | WP5.1 (no username), 5.2, 5.3, 5.4 | deletion and export are legal requirements |
| Trial-ending email + Resend setup + email budget | WP3.0, part of 3.2, trial producer from 3.3 | a card-on-file trial needs the reminder |
| Schema | M10 subset: `data_export_jobs`, `account_deletions`, `notifications`, `email_budget_days`, billing columns; C3 | the rest of M10 later (additive) |

Deferred: public profiles and `/@username`, presence, Play/App/Training settings sync, push, reminders, weekly digest, milestones.

---

## 14. Risks, open questions and owner decisions

### 14.1 Risks

| # | Risk | Likelihood / impact | Mitigation |
|---|---|---|---|
| R1 | Dodo rejects or mis-handles `next_billing_date` updates (D6), or prorates them | medium / high (billing truth) | Task 4.0 spike before building; `PAUSE_MODE=dodo` fallback (Dodo `pause` + edge jobs); `PAUSE_MODE=off` hides the offer |
| R2 | `subscriptions.update({status:"cancelled"})` on deletion schedules instead of cancelling now, or refunds | medium / high | spike 4.0; the purge step records the resulting status and alerts if not terminal; runbook covers manual cancel |
| R3 | Resend free quota (100/day) exhausted by weekly digests | high at ~100 members / medium | daily email budget with transactional reserve (§9.6); owner decision Q6 |
| R4 | iOS push needs an installed PWA (iOS 16.4+); most iPhone members won't install | high / medium | email channel defaults for reminders on iOS (`mistakes_due.email` suggested on in the prompt when `ios_install`), install sheet; measure opt-in by platform |
| R5 | C3 makes `creator`/`participant.user` nullable; legacy readers crash | medium / medium | typed relations make TypeScript flag every reader; WP5 task 5.4; regression specs |
| R6 | Deletion transaction too slow for heavy users (statement timeout 15 s on `replay_app`) | low / medium | `SET LOCAL statement_timeout = '25s'`; heavy-fixture gate; tombstone fallback (D7) |
| R7 | Username backfill yields offensive or confusing handles from real names | low / low | blocked-words list; generated handles include the code suffix; users can change once immediately (null `usernameChangedAt`) |
| R8 | `invalidateByTag` for CDN JSON unavailable on Hobby | medium / low | 60 s TTL bounds staleness; visibility changes also `revalidatePath('/p/'+u)`; verify on dev |
| R9 | next-pwa custom worker bundling conflicts (or P11 moves to Serwist mid-phase) | medium / medium | P11 owns `WEB/worker/index.ts`; P10 ships plain-TS handlers in `WEB/worker/push.ts` with a unit test, imported by whichever bundler P11 picks |
| R10 | `@clerk/nextjs` ^6.33 lacks `has({ reverification })` / `useReverification` in the installed minor | low / medium | verify on day 1; fallback: require a fresh session (`sessionClaims.iat` < 10 min) and prompt re-sign-in |
| R11 | Email deliverability (SPF/DKIM/DMARC for `playchess.tech` on the new Cloudflare zone) | medium / medium | Resend domain records added DNS-only in the replaychess007 Cloudflare account; test with mail-tester before enabling weekly emails |
| R12 | Cross-phase edits (P2 board, P3 worker hook, P9 pairer/challenges) conflict with in-flight work | medium / low | edits listed per file in §13; each is small and owned by one WP |
| R13 | Prefs merge races across devices (two devices change the same leaf) | low / low | last write wins per leaf by design; per-leaf `dirtyAt` prevents a stale server doc overwriting a newer local change |
| R14 | Presence ticket leakage lets someone watch a profile they could see once | low / low | 10-minute expiry; tickets bound to the viewer's socket identity |
| R15 | Reminder volume concentrated at 19:00 IST spikes the 1-OCPU box | low / low | dispatcher concurrency 10, I/O lane only; k6 `notify-burst` checks socket lag |
| R16 | P10 is now 22 dev-days against 20 allocated; the owner's review time is the real bottleneck (feasibility §8) | high / medium | 20 % buffer line; the Launch A thin slice (§13) as the fallback order; decisions batched weekly with "default applies after 3 days" |
| R17 | Reminder minutes become the main Neon wake cost if members spread over many zones | low / medium | `REMINDER_MAX_RUNS_PER_DAY` merge rule (never early); weekly CU-h report from P1's ops workflow; owner can drop the 13:00 option |
| R18 | P10, P11 and P12 edit shared files at the same time (middleware, keys, flags, cron, account menu, Clerk webhook, SW, schema) | high / medium | §13.0 ownership table and P1's directory registries; daily rebase of the single-file fallbacks |
| R19 | P3 ships `HOURLY_TICK` instead of a daily planner (consistency R-05 vs feasibility F-NEON-2) | medium / low | the planner-slice API works with either window; if `HOURLY_TICK` lands, its 24 wakes are P3's cost, not P10's |
| R20 | The public profile JSON is CDN-cached, so a privacy change takes up to the purge (or 60 s) to reach every edge | low / medium | `invalidateByTag` in `after()` on visibility, rename and deletion; `revalidateTag` for the ISR page and OG image; 60 s worst case documented in the privacy copy |

### 14.2 Open questions and decisions needed from the owner

| # | Question | Default in this spec |
|---|---|---|
| Q1 | Access matrix (D14): non-members see only Account, Connected, Membership; public profiles readable by everyone (signed out included, noindex) | as stated |
| Q2 | Pause semantics (D6): starts at period end, one month, once per 12 months, "Resume now" keeps the next charge on the original date (free remaining days) | as stated, pending task 4.0 |
| Q3 | Imported Chess.com/Lichess games on other people's view of your profile | hidden (Replay games only); owner sees all |
| Q4 | What another player's game row opens | read-only finished game `/game/{ref}`; reviews stay private to players |
| Q5 | Headline rating for imported-only players | linked rating labelled with the provider ("CHESS.COM 1179") |
| Q6 | Email provider plan: Resend free (100/day) vs Pro (~$20/month) before launch; weekly digest email default on? | free plan with the budget guard; weekly digest email on (design default) |
| Q7 | **C3 confirmation** (CLAUDE.md rule 5): deleting a user anonymises shared games instead of deleting them | requested before task 0.2 applies C3 |
| Q8 | Milestone catalogue v1 copy (§8.9, 8 definitions, one lit up in P12) | ship as listed |
| Q9 | Piece sets B/C placeholders and the disabled language options | placeholders hidden; languages shown disabled "(later)" |
| Q10 | Board themes vs the DS rule "the board is neutral grey, never brand-tinted" | DS amendment: user-chosen themes allowed, Graphite (neutral) stays the default |
| Q11 | Delete copy "no refund for the rest of this month" (EU/India consumer law) and cancel-now on deletion | keep the copy pending a legal check; cancel now |
| Q12 | Backup retention so "Backups clear within 30 days" is true (architecture ≤ 30 days vs data-model 14 daily + 8 weekly) | 30 days (drop the weekly tier or cap it at 4) |
| Q13 | Case-insensitive usernames; copy changed to "Usernames are not case-sensitive." | yes |
| Q14 | Coach voice via the browser's `speechSynthesis` (free) | yes; paid TTS later |
| Q15 | Copy: "Coach questions (fair use)" instead of "Unlimited coach questions"; "Analysis of your Chess.com and Lichess games" | yes |
| Q16 | Past-due copy without "We will retry on {date}" (Dodo doesn't expose it) | yes |
| Q17 | Reports collected with no moderation UI until P12 | yes; the owner gets a weekly count in the admin email until then |
| Q18 | D3 deviation (no `player_stats` table) | accept, with the k6 gate |
| Q19 | `paused` as a 13th membership state (no board exists) | yes, rendered with the `cancelling` layout and the copy in §4.15 |
| Q20 | 24-hour undo window before account deletion (feasibility §9) | off (as designed: "Can't be undone"); §8.12 has the 0.5-day variant |
| Q21 | Settings › Training and the in-game Board settings sheet have no board; build them from the kit with the copy in §4.18–§4.19 | yes, owner signs off the copy |
| Q22 | Add a "New tournaments" notification row that `V4SettingsNotifications` does not have, so P12's "Tell me when one opens" works (coverage C-14) | add it, off by default, lit with `tournaments-v3` |
| Q23 | "Challenges from friends" means "a friend accepted your challenge link" (P9 has no direct challenges) | yes; row description "When a friend accepts your challenge link" |
| Q24 | Trial-ending email: 48 h before the first charge, copy in §8.17; no separate "trial started" email (Dodo's receipt) | yes |
| Q25 | Optional Cloudflare cache purge of a deleted user's avatar URLs (`CLOUDFLARE_PURGE_TOKEN`) | off; UUID URLs age out |

### 14.3 Rollback (feasibility §9)

| What | How to roll back | Limits |
|---|---|---|
| UI and routes | turn `account-v3` off: legacy profile, `MembershipSection` in the shell, no P10 jobs enqueued; legacy files stay one release after the parity gate | Vercel Hobby rolls back only to the previous deployment on dev |
| M10a / M10 | additive; old clients ignore the new tables and columns; enum values were deployed one release before any writer, so rolling back the writer release is safe | do not roll back across the `m10a` release |
| C3 | the FKs can be put back to `CASCADE`/`NOT NULL` only while no `NULL` exists; after the first deletion C3 is effectively one-way, which is why it needs the owner's confirmation | — |
| Worker jobs | job payloads and `progress` carry `v: 1`; an older worker skips kinds it does not know (`kind = ANY($lane)`) and leaves the rows queued | — |
| Notifications | `NOTIFY_SENDING=off` stops every send at once (rows become `SKIPPED`) | — |
| Billing actions | `PAUSE_MODE=off` hides pause; the action routes are the existing ones with a new envelope (old field kept one release) | Dodo state changes are not rolled back by a deploy |
| Account deletion | irreversible by design (D7); the outbox makes partial external failures retryable, not reversible | Q20 if the owner wants an undo window |
| Service worker push handlers | the emergency kill-switch SW build that feasibility §9 asks P11 to ship also removes P10's handlers | push stops until the next SW |

---

## 15. Definition of done

- [ ] M10a, M10 applied to the Neon dev branch with `prisma migrate deploy` (never `db push`, never `migrate dev`); writers enabled one deploy later; C3/C3v applied after the owner's written confirmation; drift check green; protected-index list updated; index-existence gate green for §6.5.
- [ ] Backfills B8, B12, B13, B14 run with `--apply` on dev; verification queries return 0 offending rows; `audit_logs` rows written.
- [ ] Every route in §7.1 implemented through `route()`, registered in `CT/http/registry/account.ts`, OpenAPI regenerated, contract-test matrix green; the registry lint shows no per-user route with a `public-*` tier or `max-age > 0` and no non-durable window > 300 s; no GET writes or calls Dodo.
- [ ] Public player routes return byte-identical bodies signed in and out with no `Set-Cookie`; viewer bits only from `GET /api/players/{u}/me` (`no-store`).
- [ ] Every board state reachable: `state-coverage` shows 0 missing for the 39 boards (real data or `/dev/ui/account/{screen}?state=` with a recorded reason); `paused` reachable from the `p10-paused` persona; the two kit-built screens (§4.18, §4.19) signed off by the owner.
- [ ] Device × zoom suite green on all 40 projects in CI for the pages in §12.6 (no document scroll; boards inside the viewport; dialogs and sheets fit); visual baselines committed.
- [ ] Unit, integration, worker, socket and e2e specs in §12 green in CI with `BILLING_PAYWALL=on` (`ci.yml` smoke, nightly full and device suites, post-deploy smoke on the dev URL); billing specs green against Dodo test mode; request-budget and shared-device-cache specs within limits; `check-test-globs` green.
- [ ] No spec deletes or mutates a shared letter user; state-changing specs lease personas; destructive specs use throwaway `e2e-*` users; the sweeper leaves none older than 2 h.
- [ ] Every P10 test hook is registered, uses `isNonProd()` + `x-e2e-token`, and is proven 404 or ignored by `prod-guard.spec.ts`.
- [ ] Axe (light and dark) and keyboard-only runs clean on the §12.5 pages and modals.
- [ ] The trial-days and pause-boundary e2e use `serverNow`; email template and header tests green; the push payload test green.
- [ ] Settings sync measured ≤ 3 s across devices with 0 same-device requests; no theme or board flash on reload; legacy localStorage keys migrated; Settings › Training writes P5's columns and P6's scope.
- [ ] Push works on desktop Chrome, Android Chrome and an installed iPhone PWA on dev; the reminder arrives within 2 minutes of the chosen time and never in quiet hours; the timer-audit test shows no idle DB round trips; unsubscribe works in Gmail one-click and from the footer page without a GET write; the trial-ending email arrives 48 h before the first charge on a test trial.
- [ ] Membership: all 13 states render with correct actions; switch preview amount comes from Dodo; pause/cancel/resume/payment-update verified in Dodo test mode; webhook additions, `entitlement:changed {cause}`, `POST /api/billing/refresh` and the daily reconcile task deployed.
- [ ] Delete account: opponent keeps games (integration + e2e); the deletion hash equals the trial-ledger hash; open reports about the user removed and consent records unlinked; purge steps complete (Dodo cancelled, Clerk user gone, R2 objects gone, PostHog person deletion asserted in the worker test and checked by hand, confirmation email received); runbook `docs/runbooks/account-deletion.md` committed.
- [ ] Export ZIP contains the 8 entries; PGN replays legally; link expires after 7 days; downloads are `private, no-store`.
- [ ] Performance: k6 thresholds in §9.7 met with result JSON files committed; EXPLAIN plans committed; bundle budgets in §9.4 met; guest profile CDN hit ratio ≥ 90 % in the k6 run.
- [ ] Telemetry: every §10.1 event is in the event registry and asserted through the sink (server events exactly once, `consentExempt` marked); PII guard green; PostHog live view on dev checked by hand; Sentry spans, metrics, alerts and cron monitors configured.
- [ ] Security: access matrix (§11.1) covered by `account-authz.spec.ts`; secrets only where §7.10 says; upload, unsubscribe and push-click endpoints verified against tampering; media host headers (`nosniff`, CSP) verified with `curl -I`.
- [ ] Flag `account-v3` on for the owner, E2E users A–P and the pool users on dev; legacy profile parts, `MembershipSection`, `MembershipModal`, `ThemeToggle`, `useChessSound` deleted after parity (kept one release behind the flag first); nav shows Settings.
- [ ] Owner test script (§1) passes on the dev URL with ego-browser and on a real iPhone and Android phone; all opened tabs closed; `docs/qa/phase-10-signoff.md` committed with the SHA, screenshots, devices, coverage table, error-window output (≥ 24 h, 0 new issues or each triaged) and k6 files; every defect found has a regression test.
- [ ] `docs/implementation-plan.md` points to this spec; owner decisions Q1–Q25 recorded with their answers; P11 and P12 told about the §13.0 ownership and §2.4 light-ups.

---

## Appendix A. Critique dispositions

Every finding in the five critiques that names P10 (or a shared item P10 must act on) is listed. **Fixed** = changed in this revision, with the section. **Handoff** = the fix belongs to another phase and P10 now states the contract it relies on. **Rejected** = not applied, with a one-line reason. Line numbers in the "Finding" column refer to the pre-revision file.

### A.1 `critique-coverage.md`

| ID | Finding | Disposition | Where |
|---|---|---|---|
| C-11 | [Challenge] links to the non-existent `/play/friend?opponent=@u` | **Fixed**: `/play?tab=friend&opponent={username}`, P9's friend tab shows "For @{u}"; P10 WP1 owns the one-line P9 edit | D18, §4.2, §2.3 (P9), §13 WP1 |
| C-12 | Settings › Training (P5:108) and P6's scope editor (P6:102) have no P10 section | **Fixed**: new kit-built section writing P5's W8 and P6's TR-12; owner sign-off for the missing board | D15, §4.18, §13 WP2.6, §14 Q21 |
| C-13 | P11 expects "Cookie settings" and "Install app" rows | **Fixed**: Privacy group in Account and Install app row in Notifications, each rendered only when P11's export exists | §4.10, §4.12, §2.4 |
| C-14 | "Tell me when one opens" (P12) targets a row that does not exist | **Fixed**: `tournament_new` row and prefs leaf (anchor `#tournament_new`), lit with `tournaments-v3`; producer stays P12's | §4.10, §7.2, §8.10, §14 Q22 |
| C-16 | In-game ⋯ "Board settings" not in P10's light-ups | **Fixed, differently**: a Board settings sheet over the game instead of navigating to `/settings/board`, because navigation would unmount a live game | D19, §4.19, §2.4 |
| C-19 | LLM `statLine` handed to P7, which never picks it up | **Fixed**: handoff dropped; template sentence only, LLM version not scheduled | §2.2, §7.2, §8.15 |
| C-21 | B26 open; some states only reachable by demo routes (shared with P10) | **Rejected for P10**: P10's `expired` state is reachable with real data (lapsed persona) under either B26 option; the decision is the owner's before P3 | — |
| C-22 | P11 never adds the v3 header to `/p/{u}` | **Handoff**: P10 states that P11 must add the `(public)/p/[username]` group to its chrome swap | §2.2, §2.4 |
| C-23 | `TOURNAMENT_PODIUM` assigned to P12, which never mentions milestones | **Fixed**: P10 defines and evaluates it from `finalRank`; P12 adds one `after()` enqueue line, the daily backstop covers a missing hook | §8.9, §7.8, §2.4 |
| C-24 | "Tournament starting" row "hidden until P12" and nobody un-hides it | **Fixed**: both tournament rows render on `flag('tournaments-v3')`, so P12's flag flip lights them; P12 DoD note | §4.10, §2.4 |

### A.2 `critique-consistency.md`

| ID | Finding | Disposition | Where |
|---|---|---|---|
| §0 #2 / 10.1 | Second report table `UserReport` and a second `POST /api/reports`; duplicate `User.reportsMade` breaks Prisma validation | **Fixed**: P5's `reports` + handler with `targetType` user/game; `UserReport`, its enums and relations deleted; reconciliation row corrected | D16, §0.2, §6.1–6.4, §7.1 SYS-6, §7.2, §7.3 |
| §0 #3 / R-04 | `audit_logs` written before M12 creates it | **Fixed**: P10 cites `audit_logs` from M4 (P4) | §2.3 (P4), §6 head |
| §0 #4 / R-03 | `User.timeZone` has no creator; spelling drift | **Fixed**: `User.timeZone` from M4 is the only stored zone; the prefs mirror is removed | §0.2, §6.2, §8.10 |
| §0 #5 / R-05 | `jobs."fairSeq"` and `HOURLY_TICK` used without an owner | **Fixed**: `fairSeq` cited from M3; P10 no longer depends on `HOURLY_TICK` (planner slices work with either P3 scheduler); `JOB_PRIORITY` names | §0.2, §6.1, §7.8, §14 R19 |
| §0 #6 / R-06 | Codes used before they exist, conflicting statuses | **Fixed**: `upstream_unavailable {kind}`, `subscription_required {reason:"paused"}`, `reverification_required` added by P10, `CONFLICT_REASONS` registered | §5.6, §7.1, §7.2 |
| §0 #7 / R-07 | Old `/internal/emit` body | **Fixed**: P2's `targets` body everywhere | §5.2, §5.3, §7.4 |
| §0 #8 / R-08 | Internal auth: one hop, three schemes | **Fixed (neutral)**: P10 calls only `internalFetch()` from `CT/internal/auth.ts`; the scheme is P2's decision | §0.2 |
| §0 #9 / 10.2 | Deletion hashes with `EMAIL_HASH_PEPPER`, the ledger with another pepper | **Fixed**: `trialLedgerHash()` from P4 with `HASH_PEPPER`; equality unit test | §8.12, §7.10, §12.1 |
| §0 #15 / R-12 / 10.21 | Two R2 presign helpers | **Fixed**: shared `WEB/lib/r2/presign.ts`; first of P10/P12 creates it | §0.2, D12, §13.0 |
| 10.3 | Re-adds `membershipEndedAt`, `lastPaymentFailedAt`, `lastPaymentFailureReason` | **Fixed**: removed; cited from M4 | §6.2, §6 head |
| 10.4 | `UserSettings` block drops `consent` | **Fixed**: `consent Json?` kept (P9); only `pushOptIns` is new | §6.2 |
| 10.5 | `/api/train/prefs` alias rewrites into a `train` section `PreferencesV1` doesn't have | **Fixed (option a)**: alias removed; P5's W8 stays the writer, extended by P10 | D15, §0.2, §7.1, §7.2 |
| 10.6 | Dependency on a non-existent `RatingEvent` | **Fixed**: rating history from `game_players."ratingAfter"` + `PlayerRating` | §0.2, §8.14, §6.5 |
| 10.7 | `/worker/wake`, `GamePlayer.analysisStatus` | **Fixed**: `POST /internal/analysis/kick`; `Game.analysisStatus` joined in every query | §2.3 (P3), §8.9, §8.15, §7.3 |
| 10.8 | `m10a` re-adds three M3 values | **Fixed**: six values only | §6.1, §6.8 |
| 10.9 | `402 membership_ended {reason:"paused"}` | **Fixed**: `402 subscription_required {reason:"paused"}`; `paused` added to `SUBSCRIPTION_REASONS` and P1's `MembershipState` | §5.6, §11.1, §11.4, §7.2 |
| 10.10 | `upstream_timeout`, `refresh_failed` | **Fixed**: `upstream_unavailable {kind}`. **Deviation**: a card decline on change-plan is 409 `payment_declined`, because a decline is an answer from Dodo, not an outage | §5.6, §7.1 |
| 10.11 | `reverification_required` missing from the code list | **Fixed**: added by P10 WP0 (or reused from P12) | §5.6, §13 WP0 |
| 10.12 / 2.10 | Watcher event named `presence:update` like P2's game-room event | **Fixed**: `presence:state` | §0.2, §5.4, §7.4, §8.8 |
| 10.13 | Old emit body; register `blocks:changed`, `prefs:updated`, `profile:updated`, `membership:updated`, `export:ready`, `milestone:awarded` | **Fixed**, with two changes: `membership:updated` is folded into `entitlement:changed` (api-perf drift register), and `blocks:changed` goes only to the blocker's own room so the block is never revealed | §5.4, §7.4 |
| 10.14 | D4 claims `opponentUserId` doesn't exist | **Fixed**: h2h uses `opponentUserId` + P9's `game_players_h2h_idx` | D4, §6.5 |
| 10.15 | Wrong index names `games_white_user_idx` | **Fixed**: `games_white_player_idx` / `games_black_player_idx` | §6.5 |
| 10.16 | `TournamentParticipant.displayName` declared by P10 and P12 | **Fixed**: P10 owns it; `ADD COLUMN IF NOT EXISTS` | §6.2, §6.8, §13.0 |
| 10.17 / 4.16 / 13.6 | P4 builds no trial reminder or Resend set-up | **Fixed**: `TRIAL_ENDING` at `trialEndsAt − 48 h` from the webhook, daily backstop task, Resend set-up task | §8.17, §7.5, §7.7, §13 WP3.0 |
| 10.18 | `APP_URL` | **Fixed**: `NEXT_PUBLIC_SITE_URL` (web), `WEB_APP_URL` (OCI) | §7.3, §7.10, §8.13 |
| 10.19 / R-13 | Token-bucket rate-limit wording | **Fixed**: `limit / windowSec` everywhere | §7.1 |
| 10.20 / R-20 | "`db push` only while iterating" | **Fixed**: never `db push` on a Neon branch | §6 head, §13 WP0, §15 |
| R-09 | `WK_ENV_FILE`, `LINKED_ACCOUNT_KEY` | **Fixed**: `WORKER_ENV_FILE`/`WORKER_DEV_ENV_FILE`, `LINK_TOKEN_KEYS`; `R2_PRIVATE_BUCKET` flagged for P13's manifest | §7.10 |
| R-19 | P10 ∥ P11 ∥ P12 share items | **Fixed**: §13.0 ownership table and "first to merge creates" rule | §2.3, §13.0 |
| R-01 (P10 rows) | `finalFen`, `endReason` in P10 SQL | **Fixed**: `games.fen`, `games."endMethod"` | §8.9, §8.13, §12.4, §12.7 |
| 1.9 | `MembershipState` gains `paused` | **Fixed** (P10 WP0 edits `CT/http/me.ts`); P10's own enum renamed `MembershipViewState` to stop the name clash found in this pass | §0.2, §7.2 |

### A.3 `critique-feasibility.md`

| ID | Finding | Disposition | Where |
|---|---|---|---|
| §0 #4 / F-NEON-2 / §10.16.2 | `HOURLY_TICK` has no owner and costs 24 wakes a day; reminders, weekly, DST pass and milestone sweep should be planned future-dated rows | **Fixed**: planner slices + future-dated jobs + web-side enqueue with `runAt`; wake cap | D9, §7.8, §8.11, §9.6 |
| §0 #12 / F-NEON-3 / §10.16.1 | Email budget in the UNLOGGED rate-limit table | **Fixed**: logged `email_budget_days` with an atomic reserve | D17, §6.3, §8.11 |
| §2.5 | Keep the 20-email transactional reserve; decide Resend Pro before P13 | **Fixed** (kept) | §8.11, §9.6, §14 Q6 |
| SEC-9 / §10.16.3 | Media host `nosniff` + restrictive CSP; signed content-type; same-origin mutations | **Fixed**: D11 headers via a Cloudflare Transform Rule, webp/png/jpeg only, [V] signed-header enforcement; same-origin check cited from P1 | D11, §7.3 ME-8, §7.9, §2.3 (P1) |
| F-VER-4 | Image transformation quota | **Fixed**: avatars pre-sized and `unoptimized` | D11, §9.6 |
| F-VER-3 | Device matrix against the deployed dev URL burns Hobby quotas | **Fixed**: full matrix in CI against `next start`; dev URL gets `@smoke` only | §12.6, §12.11 |
| F-API-3 | Don't keep the Lichess token at rest | **Handoff**: P4's decision; P10's `lichess_revoke` step and `lichessTokenEnc` become `skipped`/absent if P4 adopts it | §7.9, §7.10, §8.12 |
| §6 (worker wake row) | `/worker/wake` in P10 | **Fixed** | §2.3, §0.2 |
| §6 (internal auth row) | HMAC from P2 | **Fixed (neutral)**: shared helper; scheme is P2's | §0.2 |
| §7 / §10.16.4 | Cross-phase file clashes; P10 owns `AccountMenu.tsx` and the Clerk webhook, P11 owns `worker/index.ts` and `(app)/layout.tsx` | **Fixed** | §13.0, §7.5, §7.6, §5.2 |
| §8 | Calendar realism, 20 % buffer, "Launch A" with a thin P10 | **Fixed**: 22 d + 4.4 d buffer, R16, Launch A thin slice | header, §13, §14 R16 |
| §9 / §10.16.5 | Rollback subsection; 24 h deletion undo as an owner decision | **Fixed** | §14.3, §8.12, §14 Q20 |
| §9 rules 1–3 | Enum values take two releases; versioned payloads; legacy kept one release | **Fixed** | §6 head, §14.3, §13 WP6.5 |
| §9 rule 1 (alternative) | Use `text` + zod instead of Postgres enums for fast-growing sets (notification kinds) | **Rejected for P10**: `NotificationKind` is declared once in M10 with every kind P10–P12 need, so it does not grow; the two-release rule covers rollback | §6.1 |
| §2.4 F-NEON-1, SEC-3 | Dev/prod Neon split, dev environment protection | **Not P10's** (P1/P13); P10 says "the Neon dev branch named in CLAUDE.md" and relies on P1's bypass header in e2e | §6 head |

### A.4 `critique-testing.md`

| ID | Finding | Disposition | Where |
|---|---|---|---|
| P10 · shared-user deletion (X4) | `account-delete.spec.ts` deletes shared user F; `…-blockers` uses G | **Fixed**: throwaway `e2e-del-<runId>` users | §6.10, §12.5 |
| P10 · letter collisions (X4) | "fresh S/T/U" collide with P1's S and P12's admin | **Fixed**: throwaway `e2e-bill-<runId>-*` users; leased personas for every state-changing spec (found in this pass: the username, export, block, visibility and prefs specs also mutated shared users) | §6.10, §12.5, §1 |
| P10 · hook guards (X12) | `APP_ENV=dev`-only hooks fail in CI | **Fixed**: `isNonProd()` + `x-e2e-token`, registry, prod-guard proof | §7.1 (`T`), §7.11, §12.11 |
| P10 · unit additions | `templates.test.ts`, `payload.test.ts` | **Fixed** (path `/api/email/unsubscribe`, P10's route, instead of the critique's `/api/unsubscribe`) | §12.1 |
| P10 · a11y | no axe run | **Fixed**: `account.a11y.spec.ts` light and dark | §12.5 |
| P10 · keyboard | no keyboard-only run | **Fixed**: `account.keyboard.spec.ts` | §12.5 |
| P10 · server time (X5) | trial days and pause boundaries need `serverNow` | **Fixed**: `membership-trial-days.spec.ts`, `requestNow()` in the RSC | §12.5, §5.2 |
| P10 · PostHog person deletion | assert the delete call | **Fixed**, with the endpoint corrected: PostHog deletes persons by person id after a `distinct_id` lookup (or the bulk endpoint), not `DELETE …/persons/:distinct_id` [V] | §7.9, §12.4 |
| P10 · telemetry (X6) | assert `settings_changed{section,key}`, `membership_action{action}`, `push_enable_result{result}`, server `account_deleted{source}` | **Fixed** with P10's existing event names; **renames rejected**: `membership_action_clicked`, `push_permission_result` and `account_delete_completed` (now with `source`) already carry those properties, and renaming would break the §10.1 funnels | §12.5, §10.1 |
| P10 · regression | full suite; seed U with P6, P7, P8, P9 rows in the deletion test | **Fixed** | §12.3, §12.11 |
| P10 · DoD additions | six checks | **Fixed** | §15 |
| X1 | one runner, one layout, globs | **Fixed** (layout and `check-test-globs`) | §12 intro |
| X2 | CI e2e on `dev` | **Fixed** | §12.11 |
| X3 | paywall on in e2e | **Fixed** | §12 intro, §7.11 |
| X6.5 | consent changes break telemetry assertions | **Handoff** to P11 (default consent cookie in the fixture); P10 marks server events `consentExempt` | §12.5, §7.9 |
| X7 | console guard | **Fixed** (inherited, stated) | §12 intro |
| X8 | design-state manifest | **Fixed**: `@state`/`@demo` tags, overrides with reasons | §12 intro, §12.11 |
| X9 | tiered device matrix, stress data | **Fixed** | §12.6 |
| X10 | visual baselines | **Fixed**: 8 key states × light/dark × 4 projects | §12.6 |
| X11 | regression = whole suite + `flags-off` | **Fixed** | §12.11 |
| X14, X15, X18 | defects get tests; sign-off record; perf results as data | **Fixed** | §12.11, §15 |
| X16 | CI databases | **Fixed** (Docker Postgres in CI; only `@dev-url` specs touch Neon dev) | §12.11 |
| P11 section | P10's push handlers must survive P11's SW rewrite | **Fixed**: handlers in `worker/push.ts` with a unit test; P11's `sw-on` project runs `notifications.spec.ts` | §7.6 |

### A.5 `critique-api-perf.md`

| ID | Finding | Disposition | Where |
|---|---|---|---|
| AP-03 / §4.15.1 | `P+` routes CDN-cached "when signed out" leak or mis-serve; P1's wrapper refuses them | **Fixed**: public routes read no session; viewer bits on `GET /api/players/{u}/me` (`no-store`); own data on `/api/me/*`; signed-in search on `/api/me/players/search` | D1, §5.1, §5.2, §7.1, §7.3 |
| AP-03 (sub-option) | Filter blocked users on the client using `qk.me().blockedBy` | **Rejected**: sending a list of who blocked the viewer to the client reveals the blocks; a `no-store` member search does the filtering server-side | §7.1 PLY-8 |
| AP-04 / §4.15.2 | Invoice PDF with `max-age=86400`; nothing per-user may be browser-cached | **Fixed**: `private, no-store` + attachment for invoice, PGN, export; no per-user `max-age > 0`; `shared-device-cache.spec.ts`; `Clear-Site-Data` cited from P1 | §7.1, §9.2, §12.5 |
| AP-07 | Schema names drift; per-user index winner is `playedAt` | **Fixed** for every P10 name, **but the `playedAt` rename is rejected for P10**: P2 shipped `"endedAt"` and its index, and consistency R-01 makes P2's names canonical; if the owner adopts AP-07, the four P10 queries change mechanically | §0.2, §6.5 |
| AP-08 / §4.15.5 | `HOURLY_TICK` and other timers keep Neon awake | **Fixed**: future-dated jobs only; timer-audit test | D9, §7.8, §9.6, §12.1 |
| AP-11 / §4.15.6 | Long rate-limit windows on the UNLOGGED table reset on suspend | **Fixed**: every window > 300 s is `durable`; exports use the source row. The critique's option (b) for reports (count by `reporterId`) has no index in P5's table, so reports also use the durable store | §7.1 |
| AP-31 / §4.15.2 | `GET …membership?refresh=1` calls Dodo and writes | **Fixed**: `POST /api/billing/refresh`; GETs are DB-only; the 6-hour heal moves to the reconcile task | §0.2, §7.1, §7.7 |
| AP-38 / §4.15.3 | `meta.total` on every page | **Fixed**: page 1 only, `limit=0` for counts | §7.1, §5.2, §9.1 |
| AP-24 / §4.15.4 | Same-device tabs refetch on `prefs:updated` | **Fixed**: version skip + BroadcastChannel carries the server version | D5, §5.2, §5.3 |
| §1 drift (bank and membership events) / §4.15.5 | `membership:updated` duplicates `entitlement:changed` | **Fixed**: folded, with `subscriptionUpdatedAt` and `cause` | §0.2, §5.4, §7.5 |
| §1 drift (rate limiter, cache tiers, worker wake) | token-bucket wording, T-tier names, `/worker/wake` | **Fixed** | §7 intro, §7.1 |
| §1 drift (internal auth) / AP-44 | HMAC mandatory from P3; caller-scoped emit targets | **Fixed (neutral)**: shared helper; P10 lists the two worker-emitted events for caller scoping | §0.2, §7.4 |
| AP-02 | `supportsCancellation` also for the PGN export | **Fixed** | §7.1 P10-2, §7.3, §13 WP0 |
| AP-06 | Billing compare-and-set | **Fixed** (P10 writes go through P1 F4b with provider event times) | §7.5, §7.3 BIL-15, §7.7 |
| AP-09 / §5 GET purity | GETs must not write or enqueue | **Fixed**; one more found in this pass: the unsubscribe footer link wrote on GET, now a confirmation page + POST | §7.1 ME-17a/b, §7 intro |
| AP-10 | Invalidation storm during backlogs | **Fixed** on the P10 side: throttled handlers, bulk jobs below the progress band | §5.1, §5.2 |
| AP-12 | zod in client bundles | **Fixed**: `profile.rules.ts` for form validation | §7.2, §9.4 |
| AP-15 | SLOs measured with consent-gated client events | **Fixed**: lab gates (e2e) and server events carry the SLOs; client samples are indicative only | §9.5 |
| AP-19 | Whole-archive ETag | **Fixed** where P10 owns the route (ME-19…21 use `gamesVersion` if P3 adopts it) | §7.3 |
| AP-20 | `fallbackInterval` never stops | **Fixed** (start time in `query.meta`) | §5.2, §5.5 |
| AP-22 | `no-store` + ETag cannot revalidate | **Fixed**: `private-etag` = `private, no-cache` | §0.2, §7 intro |
| AP-25 | Reconnect resync burst | **Fixed** on the P10 side (resync only on a `bootId`/`useq` gap, P2's rule) | §5.4 |
| AP-39 | `router.refresh()` in every tab | **Fixed** (visible tab, gate flip only; P4's handler) | §5.2 |
| §5 CI gates | registry tier lint, index existence, GET purity, timer audit, shared-device cache | **Fixed** (P10 entries) | §6.5, §9.1, §12.1, §12.5 |
| §3 DB-09 | Cascade deletes opponents' games | Already covered (C3 + anonymise); kept | §6.7, §8.12 |
