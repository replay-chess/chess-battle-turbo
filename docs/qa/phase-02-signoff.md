# Phase 2 sign-off record

<!--
Phase 2 record, from the template docs/qa/phase-NN-signoff.md (plan §12.11, CT X15).
Owner tests are plan §1.2 T1–T18. Screenshots go to docs/qa/phase-02/.
The test window runs from the phase's last dev deploy to sign-off, at least 24 h.
Every defect found here gets a failing automated test first, named
`regression: <slug> (#issue)` (CT X14).
-->

| | |
|---|---|
| Phase | 2 · Board and live game |
| Tested `dev` SHA | **`8b4b953`** (pass 2, 2026-11-11 14:36–14:56 UTC): `5009248` + `b1e6e97` (CI config, design legends in CI, PGN Site from the configured site URL) + `8b4b953` (e2e fixtures). Pass 1 (13:30–13:55 UTC) tested `5009248` on its deployment URL |
| Vercel deployment (replay-chess-dev) | pass 2: the dev alias `https://replay-chess-dev-replaychess007-1069.vercel.app`, `/api/health` buildId `8b4b953b73f626a30073d2abeedc882690661931` (checked 14:36 UTC before starting). Pass 1: `dpl_5hhEn6CtRn2KRNuLPWpMHdgbkeC5` (5009248) on its deployment URL, because of D1 |
| OCI socket image tag (dev) | `ghcr.io/replay-chess/replay-chess-websocket:b1e6e97d1456bf6b33048fd78df9b12fb56ab783` (deploy-oci run 43033886671, green, 13:57 UTC; pass 1 saw `de4020c…`). `docker compose ps` in `/opt/replay-chess`: services `websocket` (`replay-chess-websocket-1`, healthy) and `caddy`; `stop_grace_period: 30s` |
| Test window | first dev pass 2026-11-11 13:30 UTC; pass 2 14:36–14:56 UTC. The ≥ 24 h window has **not** elapsed |
| Signed off by | not signed off (owner items in §9) |

**How the passes ran.**
- Pass 1: ego-browser task space 1 was handed to the user at about 13:35 UTC (a hard stop for the agent; it was left alone). The rest of pass 1 ran in headless Chromium (Playwright 1.58.2 from `apps/web`) on the 5009248 deployment URL, because the dev alias had been moved to `a8798c9` (D1). No live game was possible then.
- Pass 2: **ego-browser** task space 2 (a new space) for member A in the main friend game (T1–T5, T8, T10, T12 and the PGN download). Headless Chromium contexts (Playwright) for B, C, R, and for both players in the 1-minute game, the three T11 runs and T18. Everyone signed in with Clerk tickets as the E2E users from `apps/web/.env.test`. Space 2 was closed with `task.finish({ keep: [] })` and every Playwright context was closed.

## 1. CI evidence

| Run | Link | Result |
|---|---|---|
| `ci.yml` on `de4020c` | run 43028028860 | red at verify / gitleaks (3 test-only values); fixed in `5009248` |
| `ci.yml` on `5009248` | run 43028681438 | verify and integration green. devices-game red: every `page.goto http://localhost:3100` → `net::ERR_NAME_NOT_RESOLVED`, 204 failed. e2e-smoke red: `friend-full` needs a legend (CI DB had none); `membership.spec.ts:90` checkout → 503 `BillingNotConfiguredError` (no `DODO_PRODUCT_ID_MONTHLY`). Addressed by `b1e6e97` / `8b4b953` |
| `ci.yml` on `8b4b953` | run 43037495714 | **green**: verify, integration, devices-game, e2e-smoke |
| `deploy-oci.yml` (dev socket) | runs 43028028872 (`de4020c`), 43033886671 (`b1e6e97`) | green |
| `post-deploy-dev.yml` | — | skipped (P1 D4 still open) |
| `nightly.yml` | — | not run (scheduled workflows run from `main` only) |
| Quarantine (`apps/web/e2e/quarantine.json`) | — | unchanged by this pass |

Vercel build of 5009248: it runs `node scripts/build-engine-assets.mjs && pnpm --filter @repo/db generate && next build`. The log shows "engine assets: wrote public/workers/sf18-1a3515d5bd9d/ (7.3 MB wasm)" and "✔ Generated Prisma Client (v6.17.1)". `/game/[ref]` First Load is 600 kB, the owner-approved budget.

**R-02 (Prisma engine bundled): pass.**
- `/api/health?deep=1` returns `db ok`.
- Every game below was created, checkpointed and finished in the Neon dev DB through the app's own routes and the socket.
- Vercel runtime errors over the last 2 h: none.

## 2. Owner tests (plan §1.2)

"Live" = the dev alias on `8b4b953` with the dev socket, two signed-in members. "Demo" = `/dev/ui/game?state=…&freeze=1`.

| # | Check | Result | Screenshot | Notes |
|---|---|---|---|---|
| T1 | A: `/play` → Friend → legend → Create; waiting screen | **pass** (ego-browser) | `t1-live-waiting.jpg` | Challenge Friend, then Play as Legend: Paul Morphy, then 5 \| 5, then START GAME. "Share invitation" offers the link `/join/cmwc83sruem832wovp3497r6m?autojoin=true`. GO TO GAME lands on `waiting`: "Waiting for opponent · Send this link. The game starts with a 30 s study phase when they join. Copy · Cancel Challenge" (`copy-challenge-link`, `cancel-challenge`). There is no 5+3 in the picker (D6) |
| T2 | B joins by link; study for both; I'm ready ends it early | **pass** | `t2-live-study-A.jpg`, `t2-live-study-B.jpg` | B opens the link and lands on `/game/<ref>` as Black. Both screens are in `study`: "Study the position 0:29 · Paul Morphy vs Duke Karl of Brunswick and Count Isouard · Paris Opera · 1858 · after 9…b5 · Moves are locked…". A: I'm Ready, which shows "Waiting for TestPlayerB E2E…". B: I'm Ready, and study ended at 0:21 |
| T3 | First-move window; clocks start after both first moves | **pass** | `t3-live-A-abort.jpg`, `t3-live-B-clock-not-started.jpg` | A (side to move): `abort` "Make your first move 0:30". B: `their_move`, zone "TestPlayerA E2E's first move", sub "Clock not started". Both clocks stay at 5:00 through 10.Nxb5. After 10…cxb5, White's clock runs (4:57) |
| T4 | Premove: ghost + status, fires on the opponent's move | **pass** (click-click) | `t4-live-premove.jpg` | During B's turn A clicked e1 then c1: `data-phase=premove`, status "Premove set: Kc1. Right-click or Esc to cancel." B played 11…Nbd7 and 12.O-O-O appeared 44 ms later. **The same premove by drag in ego-browser (CDP mouse) set nothing**; drag was not retried in Playwright (D8, unconfirmed) |
| T5 | Illegal move: shake + reason | **pass** | `t5-live-pinned.jpg` | B dragged the pinned Nd7 to c5: `illegal`, "That move isn't legal: the knight on d7 is pinned to your king." No network request. (Pass 1: the bot game gave the same for a blocked rook and a king jump) |
| T6 | Promotion picker; Esc puts the pawn back; choice is sent | **pass** (live, not G-PROMO) | `t6-live-promotion-picker.jpg` | 1-minute friend game `cmwc8be2qem84222ct2m87c10`, a-pawn run. b7xa8 opens the picker with Promote to queen / rook / bishop / knight and "Esc, cancel promotion". Esc gives "Promotion cancelled · the pawn is back on b7". Choosing the knight records `8.bxa8=N` (DB `b7a8n`) |
| T7 | Low time: tenths, red chip, "Low time" | **pass** (live, 1-minute game rather than G-LOWTIME) | `t7-live-low-time-A.jpg` | A's (Black) clock showed `0:09.6`, `data-phase=low_time`, `clock-b` `data-tone="red"` `data-low`, background rgb(163, 65, 46), player sub "Low time". The single beep was not checked (headless) |
| T8 | A offers a draw; B declines; 2-move cooldown | **pass** | `t8-live-draw-received-B.jpg`, `t8-live-draw-declined-A.jpg` | A: Offer Draw puts the game in `draw_sent`. B: `draw_received`, bar "TestPlayerA E2E offers a draw · Decline · Accept". After Decline, B's toast reads "You declined the draw." A: `draw_declined`, "TestPlayerB E2E declined the draw. You can offer again in 2 moves.", and `offer-draw-button` disabled. It was still disabled after A's 1st move and enabled after the 2nd |
| T9 | ⋯ → Resign… popover, focus Keep playing, resign | **pass** | `t9-live-resign-confirm.jpg` | 1-minute game, A: ⋯ → Resign… gives Keep Playing (focused) / Resign. Resign gives A `over_resign_loss` "Defeat · You resigned · Resignation · move 8" and B `over_resign_win` "Victory · TestPlayerA E2E resigned" |
| T10 | B closes the tab: toast, ring, abandon after 30 s | **pass** | `t10-live-opp-disconnected-A.jpg`, `t10-live-over-abandoned-A.jpg` | Rematch game `cmwc88j4enggqxxfi09hjt3h5`. B's page closed at 14:42:28 UTC. A (ego-browser): `opp_disconnected` at once, toast "TestPlayerB E2E disconnected. They have 30 seconds to reconnect.", zone "Opponent disconnected · TestPlayerB E2E has 0:30 to return", counting down one per second. At 30 s: `over_abandoned` "Victory · You won · TestPlayerB E2E left the game · Opponent did not reconnect within 30 s". DB: `ABANDONED`, outcome BLACK (A) |
| T11 | Socket restart mid-game: same ply, colours, clocks | **pass ×3**, with notes | `t11-run2-*.jpg`, `t11-run3-*.jpg` | Three games, details in §2.1. Every run resumed at the same ply and colours. The clocks froze while disconnected and resumed together; no ply was lost and nothing was abandoned. From the restart command to both clients showing "Reconnected": 9.4 s, 10.5 s and about 11 s. The 30 s grace was never reached. **No "Server restarting in 0:30" chip**: a plain `docker compose restart` sends SIGTERM, the server drains in ~1.2 s and exits, and no announcement reaches the clients (the T11 script uses the deploy workflow's drain). The joiner (A) wrongly saw "TestPlayerB E2E disconnected…" and `opp_disconnected` for ~6 s in all three runs (D7) |
| T12 | Rematch; both navigate; colours swapped | **pass** | `t12-live-rematch-received-B.jpg`, `t12-live-rematch-study-A.jpg`, `t12-live-rematch-study-B.jpg` | A: Rematch puts A in `over_rematch_sent`. B: `over_rematch_received` with `accept-rematch` / `decline-rematch`. On Accept both move to `/game/cmwc88j4enggqxxfi09hjt3h5`: B `rematch_study` "Rematch · study as White"; A gets toast "TestPlayerB E2E accepted. Colours swapped: you play Black." DB: `rematchOfId` set, white = B |
| T13 | Spectator C: one ply late; controls; `over_spectator`; Watch another game | **pass** (one a11y note) | `t13-live-spectate.jpg`, `t13-live-over-spectator.jpg`, `t13-live-watch-another.jpg` | C: `spectate` "1 watching · Moves only · sound quiet". Spectator ply 19 vs 20 live, 22 vs 23, 10 vs 11, 12 vs 13: always one behind. Controls: Previous / Next move, Flip Board, ⋯ (Flip Board, Sound only). At mate: `over_spectator` "Spectating · Result · White wins by checkmate · TestPlayerA E2E vs TestPlayerB E2E · 17.Rd8# · Watch Another Game · New Game". Watch Another Game opens a dialog listing live games ("No live games to watch right now."). The ⋯ button's accessible name is "More: Resign, Flip Board, Sound" for a spectator, who has no Resign (D9). Non-member R on the live game URL → `/pricing?reason=required&redirect_url=%2Fgame%2Fcmwc83sruem832wovp3497r6m` |
| T14 | vs Computer: hint ×2, undo, finish | **pass** (pass 1, 5009248) | `t14-*.jpg` | "Hint 1 of 2: look at your pawn on e4.", then "Hint 2 of 2: play exd5." with the arrow. Undo: "Took back 4.d3 and 4…d5." Resign stores `COMPLETED` / `RESIGNATION` with a `%clk` PGN. Engine 1200 (T1 script says 1400) |
| T15 | Bot reload; same URL on a phone | **pass** (pass 1) | `t15-bot-reload.jpg`, `t15-bot-phone-resume.jpg` | Reload: back at ply 10 in 0.9 s. A fresh iPhone-emulated context also resumes at ply 10, with no tab bar and no page scroll |
| T16 | Real iPhone and real Android | **not run** | — | owner, real device |
| T17 | Non-member R opens a game URL | **pass** | `t17-nonmember-pricing.jpg` | Bot game (pass 1) and live game (pass 2) both redirect to `/pricing?reason=required&redirect_url=/game/<ref>`. `POST /api/games` → 402 |
| T18 | Desktop zoom 150 % on a live game | **pass** | `t18-live-zoom150.jpg` | Live game `cmwc8n3vdem88x510ev7qkkdf`, A's view, emulated as 1440×900 ÷ zoom with matching DPR. 80 / 125 / 150 %: `scrollHeight == innerHeight`. Board, both clocks and the action row are all in view (150 %: 960×600, board 52–548, clocks 13–41 / 559–587, actions 530–591). Move list `overflow-y: auto` |

### 2.1 T11 in detail (three runs, one per game)

Method: start a friend game (B creates from `/play` → Challenge Friend, A joins by link, both I'm Ready), play 6–7 plies, then start a 0.5 s poller on each client. The poller records `data-phase`, ply, colour, side to move, both clocks, zones, toasts and any chip/banner, and logs a line whenever anything but the clock changes. Then on the dev box (and nothing else): `cd /opt/replay-chess && docker compose restart websocket`. `/ready` was polled every second. Times are seconds from the poller start.

**Run 1** · `cmwc8f0tnem85cq00jrsjguj4` · A Black, B White, ply 12, White (B) to move and in check, clocks W 4:54 / B 5:09.
- `/ready` before: `{"ready":true,"restored":true}`, `bootId JXioVAaI3dCU`. Restart issued 14:46:46 UTC; `docker compose restart` took 1.6 s.
- Container log: `draining reason SIGTERM` at 14:46:47.38, then `drained sessions 1 flushed true ms 1236` at 14:46:48.62. `socket server listening bootId zteRFHi6Cl9K journal on` at 14:46:49.86. `restore finished candidates 4 restored 1 fromJournal 1 corrupt 0 finished 0 ms 5645` at 14:46:55.51.
- `/ready`: no answer at 14:46:48, `ready:false` 14:46:50–54, `ready:true restored:true` at 14:46:55.

| t | A (Black, joiner) | B (White, creator) |
|---|---|---|
| 0.0–4.0 | `their_move` ply 12, W clock running 4:54 → 4:50 | `check` ply 12 |
| 5.5 | `reconnecting`, "Reconnecting… reconnect within 0:30"; toast "TestPlayerB E2E disconnected. They have 30 seconds to reconnect."; clocks frozen at 4:50 / 5:09 | `reconnecting`, "Reconnecting… reconnect within 0:30" |
| 7.6 | `opp_disconnected` (same toast) | `check` (normal) |
| 12.6 | `reconnected`, toast "Back online.", clocks still 4:50 / 5:09 | `reconnected`, "Back online." |
| 13.1 | W clock running again (4:49) | same |
| 16.6 | `their_move` ply 12 | `check` ply 12 |

Then 13.gxf3 and 13…Ng4 were played normally on both screens (ply 14); A resigned. DB: `COMPLETED`, `RESIGNATION`, 8 plies stored including the two after the restart.

**Run 2** · `cmwc8hssaem8642jokror7rtc` · A White, B Black, ply 18, White (A) to move, W 4:56 / B 5:14.
- `/ready` before: ready, `bootId zteRFHi6Cl9K`. Restart 14:48:52 UTC (1.57 s).
- Log: draining 14:48:52.97, drained `sessions 1 ms 1212` 14:48:54.18, listening `bootId xcS3FUXq34Ap` 14:48:55.42, `restore finished candidates 5 restored 1 fromJournal 1 ms 6894` 14:49:02.32.
- `/ready`: `ready:false` 14:48:55–49:02, ready 14:49:03; `/health` after: `bootId xcS3FUXq34Ap`.

| t | A (White, joiner, to move) | B (Black, creator) |
|---|---|---|
| 0.0 | `your_move` ply 18 | `their_move` ply 18 |
| 5.1–5.2 | `reconnecting` + toast "TestPlayerB E2E disconnected…"; clocks frozen 4:52 / 5:14 | `reconnecting` |
| 7.2 | `opp_disconnected` | `their_move` |
| 13.4 | `reconnected` "Back online." | `reconnected` "Back online." |
| 13.9 | W clock running (4:51) | same |
| 17.5 | `your_move` ply 18 | `their_move` ply 18 |

Then 10.Qa7 and 10…Nf1 were played (ply 20); B resigned. DB: `COMPLETED`, 9 plies.

**Run 3** · `cmwc8kg4zem87rkskyup1jnvt` · A Black, B White, spectator C, ply 11, Black (A) to move, W 5:09 / B 4:51.
- `/ready` before: ready, `bootId xcS3FUXq34Ap`. Restart 14:50:59 UTC (1.68 s).
- Log: draining 14:51:00.26, drained `sessions 1 ms 1314` 14:51:01.57, listening `bootId B-wxPcmmAU3_` 14:51:02.81, `restore finished candidates 6 restored 1 fromJournal 1 ms 6675` 14:51:09.48.
- `/ready`: `ready:false` 14:51:03–08, ready 14:51:09.

| t | A (Black, joiner, to move) | B (White) | C (spectator) |
|---|---|---|---|
| 0.0 | `your_move` ply 11 | `their_move` ply 11 | `spectate` ply 10 |
| 5.5 | `reconnecting` + "TestPlayerB E2E disconnected…"; clocks frozen 5:09 / 4:47 | `reconnecting` | `spectate` + "Reconnecting… reconnect within 0:30" |
| 7.1–7.6 | `opp_disconnected` | `their_move` | `spectate` "1 watching" |
| 13.6 | `reconnected` "Back online." | `reconnected` | "Back online." |
| 14.1 | B clock running (4:46) | same | — |
| 17.2 | `your_move` ply 11 | `their_move` ply 11 | `spectate` ply 10 |

Then 6…Ng1 and 7.Bxa8 were played (C followed one ply behind); A resigned. DB: `COMPLETED`, 8 plies.

**Summary.**
- All three runs resumed with the same ply, colours and clocks, and none was abandoned.
- Timings (restart command → server listening → restore finished → clients `reconnected` → back to the normal phase):

| Run | Listening | Restore finished | Clients `reconnected` | Normal phase |
|---|---|---|---|---|
| 1 | +3.5 s | +9.2 s | +9.4 s | +13.4 s |
| 2 | +3.4 s | +10.3 s | +10.5 s | +14.6 s |
| 3 | +3.8 s | +10.5 s | ≈ +11.0 s | ≈ +14.6 s |

- Against the plan: the reconnect grace is 30 s, and every run was back about 20 s before it.
- The restore itself took 5.6–6.9 s on dev. The candidate count grew 4 → 5 → 6 while `restored` stayed 1, so restore time may grow with older candidates.
- Note for the CI flake (restart-resume: `reconnecting` → `over_abandoned`): the e2e fixture server runs `TIMING_PROFILE=fast` with a grace of a few seconds. A restore taking a few seconds there would outlast that grace. This is a hypothesis; the CI run was not inspected.
- A move queued during the outage was attempted in run 3 but not made (the helper found no legal target while A was in the stale `opp_disconnected` phase); queued-move delivery is covered by the offline test in §3.

### 2.2 Demo states (plan §12.11 item 2)

All 55 `/dev/ui/game?state=…&freeze=1` states were checked at 1440×900 and 393×852 (pass 1, 5009248). Every one rendered with no page error and the expected `data-phase`. Every one fit one viewport (`scrollHeight == innerHeight`), with the board fully in view and no visible tab bar. Screenshots: `t*-demo-*.jpg`. Side-by-side parity with the `.dc.html` boards was not done.

## 3. Cumulative pass (Phases 0–2)

| Flow | Result | Notes |
|---|---|---|
| Sign-in / sign-out | pass | Clerk ticket sign-in for A, B, C, R. Sign-out → `/`, `Clerk.user` null. Back → public `/pricing` |
| Signed-out gates | pass | `/play`, `/game/<ref>`, `/membership` → 307 sign-in. Game APIs → 401 |
| Paywall, trial, pricing | pass | R: pricing with the 7-day trial copy. Member routes → `/pricing?reason=required&redirect_url=…`. `POST /api/games` → 402 |
| Membership page | pass | On the own profile: "Membership · Active · Coaching · Billed monthly…". There is no `/membership` route |
| App shell and navigation, desktop and phone | pass | `aria-current` correct. Phone: 56 px tab bar, no horizontal scroll; no tab bar in a game |
| Friend game end to end | **pass** | `cmwc83sruem832wovp3497r6m`, a legend start, 5+5. Create, then link join, then study and ready, then first-move window (T1–T3). Premove 12.O-O-O (T4), pinned-piece reason (T5), draw offer, decline and cooldown (T8). The Opera Game line to `17.Rd8#`: A `over_checkmate_win`, B `over_checkmate_loss` "Defeat · TestPlayerA E2E won by checkmate · Checkmate · move 17" with `mate` and `win` badges. Then rematch with colours swapped (T12). DB: `COMPLETED`, `CHECKMATE`, outcome WHITE, 15 plies including `d1d8`, move clocks stored |
| Bot game | pass | T14, T15 |
| Spectating | pass | T13 (one ply behind; non-member redirected) |
| Reconnect after going offline, with a queued move | **pass** | Rematch game, B (White, to move) taken offline with `context.setOffline(true)`. After 1.5 s: `reconnecting` "Reconnecting… reconnect within 0:29 · Your clock is running." B plays Bxb5+ while offline: "…Bxb5+ is queued and will be sent when you're back.", ply stays 20. Back online after ~6 s: in under 1 s `reconnected`, toast "Back online. Bxb5+ was sent.", ply 21 on B. Normal `their_move` after 5 s. `cum-live-reconnecting-queued-B.jpg`, `cum-live-reconnected-B.jpg` |
| Opponent abandons | pass | T10 |
| Game-over card | pass | Checkmate cards for both players (`cum-live-over-checkmate-*.jpg`), resign cards (T9), abandon (T10), spectator (T13). Reopening a finished game shows `already_ended` |
| PGN download | pass | Live friend game: Share → Download PGN → `replaychess-cmwc83sruem832wovp3497r6m.pgn` with `[Site "https://replay-chess-dev-replaychess007-1069.vercel.app/game/…"]`, `SetUp`/`FEN` at ply 18, 15 moves each with `{[%clk …]}`, `17. Rd8# 1-0`. **New bot game `cmwc8o7y5em891q4qer90c7to`: `Site` is now the dev URL** (D5 fixed by `b1e6e97`) |
| Flags-off: a legacy v1 friend game still saves its moves | **not checkable on dev** | Flags come from `FLAGS_OVERRIDE` (env, test hooks only), then PostHog, then defaults (`apps/web/lib/flags/index.ts`). There is no per-user or per-request override, so it needs a Vercel env change. Covered by the `flags-off` Playwright project, not re-run here |

Observation (not filed): a plain Challenge Friend with no legend or opening chosen started from a random legend or opening position. The 1-minute game began after 3.Bb5 (Ruy Lopez) with a study phase, and another game began at Byrne–Fischer 1956. The bot game does the same. Confirm with the owner that this is the intended default.

## 4. Devices, browsers and zoom

| Device (model, OS version) | Browser (version) | Zoom levels | Result |
|---|---|---|---|
| Desktop 1440×900 (macOS host) | ego-browser (ego lite, Chromium) for A in the main friend game; headless Chromium (Playwright 1.58.2, headless shell 1208) for the others | 80, 100, 110, 125, 150 % (emulated; bot game in pass 1, live game in pass 2) | pass |
| iPhone 393×852 / iPhone 15 profile | headless Chromium, device emulation (touch) | 100 % | pass (55 demo states, bot resume, shell). Real iPhone not tested |
| iPad, Android | — | — | covered by CI devices-game (green on `8b4b953`), not by hand |
| Real iPhone, real Android (T16) | — | — | owner |

## 5. Design-state coverage

Not produced in this pass. The `reached` table needs the run reports of CI run 43037495714 (devices-game and e2e-smoke artifacts).

## 6. Error window and telemetry

- Vercel runtime errors (project, last 2 h): none.
- Sentry and PostHog MCPs are not authenticated in this session, so `error-window.ts`, the Sentry socket metrics (`ws.restore`, `ws.persist.*`) and the PostHog live view were not checked.
- Browser consoles on game pages showed only third-party noise: the Vercel Insights 404 on a deployment URL, Clerk bot-protection probes and blocked badge images.

## 7. Performance

| Item | Result |
|---|---|
| Bundle | `/game/[ref]` First Load 600 kB, at the owner-approved budget |
| Interaction latency | open: "≤ 4 ms scripting per applied move" measures 16–17 ms at 4× CPU throttle and about 4.1 ms unthrottled. The orchestrator applies the budget unthrottled, pending owner confirmation |
| k6 `ws-ramp` on the dev box | not run (open) |

## 8. Defects found

| Defect | Issue | Regression test | Status |
|---|---|---|---|
| D1 Mid pass 1 the dev alias was moved to a `redeploy` of `a8798c9` (`dpl_7skXQPykEFqcob1dEnCT5UTHiGD2`, created 13:29:49 UTC). Open game tabs then hit 404 chunks (`ChunkLoadError`, "Position Lost") | — | — | resolved before pass 2 (alias on `8b4b953`); the cause of the redeploy is still to be explained |
| D2 gitleaks on `de4020c` | — | CI green | fixed in `5009248` |
| D3 CI devices-game: `localhost` not resolved | — | CI run 43037495714 devices-game green | fixed in `b1e6e97` |
| D4 CI e2e-smoke: no legends in the CI DB; checkout 503 without a product id | — | CI run 43037495714 e2e-smoke green | fixed in `b1e6e97` / `8b4b953` |
| D5 PGN `Site` named `playchess.tech` on dev | — | — | fixed in `b1e6e97` (rechecked on a new bot game) |
| D6 Owner script T1 asks for 5+3; the `/play` picker has no 5+3 | — | — | open, script or picker |
| **D7** During a socket restart the joiner sees a false opponent-left alarm. Repro: two players in a live friend game; `docker compose restart websocket`. The joiner (A) gets "<creator> disconnected. They have 30 seconds to reconnect." together with its own `reconnecting`. About 2 s later it is in `opp_disconnected` with B's chip "Disconnected" for ~6 s, while B shows a normal phase. It clears at "Back online." Seen in 3 of 3 runs, always on A. Expected: a server restart shows the restart/reconnecting state to both players, not "opponent disconnected". Likely the presence update the draining server sends as sockets close, plus the stale room state before the restore finishes. Files: `apps/web-socket` drain/presence path; client copy in `apps/web/features/game` | — | — | open (UX, no data loss) |
| D8 A premove made by **drag** in ego-browser (CDP mouse down/move/up, 8 steps, e1→c1 during the opponent's turn) did not set a premove; click-click did. Not reproduced in Playwright; may be a test-harness artefact | — | — | open, to confirm (`components/board/useBoardInput.ts`) |
| D9 Spectator ⋯ button accessible name is "More: Resign, Flip Board, Sound", but its menu holds only Flip Board and Sound | — | — | open, a11y (the action-bar label builder in `features/game`) |
| D10 (minor) After the premove fired (12.O-O-O), A's status line still read "Premove set: c1. Right-click or Esc to cancel." at ply 24 (while A's draw offer was pending). It cleared on A's next move | — | — | open, minor |
| D11 (minor) No "Server restarting in 0:30 · Games in progress will resume" chip on a plain SIGTERM restart: the server drains in ~1.2 s with no announcement. The chip belongs to the deploy workflow's drain, which this pass did not run (the instruction was to restart only the container) | — | — | note; run T11 once through `deploy-oci.yml` to see the chip |

## 9. Definition of done (plan §15)

| Item | Status | Evidence |
|---|---|---|
| Merged to `dev`; Vercel green; dev socket redeployed with drain; Neon dev on M2a + M2 | partial | `8b4b953` on the alias; socket `b1e6e97` deployed (green). The drain step was not observed; migrations not re-checked |
| `@repo/db`, `@repo/game-core`, `@repo/contracts/socket` are the only source | not checked | — |
| Flags on for owner and A–P; parity gate; legacy deletion PR | partial | flags on via `FLAGS_OVERRIDE` (A, B, C confirmed); parity gate and PR not checked |
| `create-ai-game` deleted; legacy routes atomic | not checked | bot creation via `POST /api/games` |
| CI green on the final SHA | **yes** | run 43037495714 (verify, integration, devices-game, e2e-smoke). nightly and post-deploy not run |
| HMAC on internal hops; error codes; ROOM builders; test hooks; prod-guard | not checked | — |
| `upgrade-required`, `in-game-auth`, `optimistic-offers`, `shared-device` green | not checked | some deferred (`test.fixme`) |
| Every lit state reachable; state-coverage 0 missing | partial | 55 demo states render; most live states seen on real games (§2); coverage table not produced |
| One viewport at 80–150 % on all devices | partial | desktop live game 80–150 %, phone demo states; device matrix via CI |
| **T1–T18 pass on the dev URL; T16 on real phones** | **T1–T15, T17, T18 pass; T16 open (owner)** | §2 |
| Persistence: final move and PGN with `%clk`; deploy mid-game loses no ply | pass (as tested) | mate `d1d8` stored; PGN with 15 `%clk`; 3 restarts lost no ply. The 80-ply statement count was not measured |
| Neon idle; survives a suspend | not checked | — |
| k6 `ws-ramp`; interaction latency | **no** | §7 |
| Engine from R2 with origin fallback; licence files | partial | engine works; source not checked |
| Post-deploy socket handshake from the dev URL | pass (manual) | polling handshake from the alias origin → 200 |
| Sentry metrics / error window; PostHog events and funnels | not checked | MCPs not authenticated |
| Defects have `regression:` tests; record committed; ego-browser pages closed | open | D7–D10 have no tests yet; this file is not committed; space 2 finished, space 1 is with the user |
| Backfill on dev; seeder documented; docs items | not checked | — |

**Every owner row a browser can run now passes (T1–T15, T17, T18).** What remains before sign-off:
- **T16** on a real iPhone and a real Android phone (owner).
- The **≥ 24 h test window**, then `error-window.ts` and the Sentry/PostHog checks.
- The **flags-off** check (needs an env change, or the nightly `flags-off` project).
- **k6 `ws-ramp`** on the dev box.
- The interaction-latency budget decision.
- T11 once through `deploy-oci.yml` to see the restart chip.
- Triage of D6–D11.

### Open items carried from stage A (not defects of this pass)

- Interaction-latency budget "≤ 4 ms scripting per applied move": 16–17 ms at 4× CPU throttle, about 4.1 ms unthrottled. Orchestrator decision: apply it unthrottled, pending owner confirmation.
- Deferred from stage A:
  - server golden-transcript replay (needs transcript format v2);
  - bot-game `upgrade_required` reload and the move queue while the socket is unauthorized (`test.fixme`);
  - quick-match `e2eRun` (v1 queue);
  - three demo states (promotion picker, reconnecting countdown, study card).
- The dev-box k6 `ws-ramp` has not been run.
- The `/game` bundle budget is 600 kB by owner decision (the build sits exactly at it).

### Data left on dev by this pass (all through the app's own UI)

- Friend games:
  - `cmwc5w3gndwgopmmhgwhpxf0j` (WAITING, pass 1)
  - `cmwc83sruem832wovp3497r6m` (checkmate)
  - `cmwc88j4enggqxxfi09hjt3h5` (rematch, abandoned)
  - `cmwc8be2qem84222ct2m87c10` (1-minute, resign)
  - `cmwc8f0tnem85cq00jrsjguj4`, `cmwc8hssaem8642jokror7rtc`, `cmwc8kg4zem87rkskyup1jnvt` (T11 runs, resign)
  - `cmwc8n3vdem88x510ev7qkkdf` (T18, resign)
- Bot games: `cmwc5z0f2mk2hoj76s6ajrkwp`, `cmwc6a882mk2i7lcif60lwr1n`, `cmwc8o7y5em891q4qer90c7to`.
- All finished games are `COMPLETED`.
