# Open decisions: the owner's register

Status: assembled 2026-11-02 from every plan file in this folder ([README.md](README.md)). This is the single decision register that [01-architecture.md](01-architecture.md) §6.2, P4 §14.1 and P11 §14.2 call `docs/decisions.md` (see A14).

**How to use it.**

- Every row is one decision, merged from all the places it was asked. "Sources" lists the original ids so the phase files can be traced: `01 D5` = [01-architecture.md](01-architecture.md) §7.1 row D5, `02 O1` = [02-data-model.md](02-data-model.md) §14, `03 Q4` = [03-api-design.md](03-api-design.md) §11, `04 Q1` = [04-client-data-layer.md](04-client-data-layer.md) §12, `05 OD-1` = [05-optimization.md](05-optimization.md) §11, `07 C-21` = [07-design-coverage.md](07-design-coverage.md) §3, `P3-Q1` / `P5 D-4` / `P7 OQ2` … = §14 of that phase file, `SPEC U6` = [phase-01a-spec.md](phase-01a-spec.md) §13, `ALLOC B26` = [allocation.md](allocation.md) §2, `PLAN §4.3` = [docs/implementation-plan.md](../implementation-plan.md).
- **Recommended answer** is the plan's default: what gets built if no answer arrives. The rule the phase files use: the default applies unless the owner objects within 3 days; one 30-minute decision batch a week.
- **Needed by** gives the phase and the roadmap week from [README.md](README.md) §6 (week 1 = 2026-11-02; launch window ≈ Sunday 2027-05-23, so T−21 d ≈ 2027-05-02).
- Write the answer in the last column (or "default") and edit the affected phase file to match.
- §P lists destructive or irreversible steps. Each needs an explicit yes at the time it runs, whatever is answered here (CLAUDE.md rule 5: "This command may reset/drop your database. Are you sure?").
- §Q lists facts to verify before the plan relies on them. §R lists conflicts between the documents and the ruling to apply.

Contents: [A. Before P1 starts](#a-before-p1-starts-owner-actions-about-3-hours) · [B. P1](#b-during-p1-weeks-13) · [C. P2](#c-p2-weeks-46) · [D. P3](#d-before-p3-starts-week-7-and-during-p3) · [E. P4](#e-p4-weeks-1215) · [F. P5](#f-p5-weeks-1619) · [G. P6](#g-p6-weeks-2021) · [H. P7](#h-p7-weeks-2224) · [I. P8](#i-p8-p8a-weeks-1214-p8b-weeks-2122) · [J. P9](#j-p9-weeks-1517) · [K. P10](#k-p10-weeks-1820) · [L. P11](#l-p11-weeks-2526) · [M. P12](#m-p12-weeks-2324) · [N. P13](#n-p13-launch-t21-d--t30-d) · [O. After launch](#o-after-launch-or-when-triggered) · [P. Destructive steps](#p-destructive-or-irreversible-steps-confirm-each-one-when-it-runs) · [Q. Facts to verify](#q-facts-to-verify-before-relying-on-them) · [R. Conflicts](#r-conflicts-between-the-documents-and-the-ruling-to-apply)

---

## A. Before P1 starts (owner actions, about 3 hours)

| ID | Decision | Recommended answer | Needed by | Sources | Answer |
|---|---|---|---|---|---|
| A1 | Renew `playchess.tech` | **Now**: renew for ≥ 2 years at Hostinger, auto-renew on, registrar lock on, 2FA on the registrar account. It expires **2027-02-02** (roadmap week 14, before launch); a lapse takes down the live site, Clerk production and email. A move to Cloudflare Registrar is optional and never between T−30 d and T+30 d | P1 day 0 (week 1) | 01 D17; P1 Q-13; P13 D21, OD-23 | |
| A2 | Rotate the Clerk secret committed in `k8s/secrets.yaml:12` (public repo) | **Today**, before P1 H5 deletes `k8s/`; then gitleaks with a full-history baseline | P1 day 0 | P1 Q-02; 06 Q SEC-03 | |
| A3 | Reword CLAUDE.md database rule 1 (it says `db push` on shared databases; rule 3 and the environments section say `migrate deploy`) | "**No `prisma db push` and no `prisma migrate dev` against any Neon branch. Migration files applied with `prisma migrate deploy` on dev and production. `migrate dev` / `migrate diff` only against a local Docker Postgres shadow.**" Rules 2–5 unchanged. `db push` silently drops the plan's hand-written partial indexes, `NOT VALID` foreign keys and `UNLOGGED` storage | P1 day 1 (before M1 is applied on dev) | 01 D5, CR-35; 02 O1; 03 Q14; 05 OD-6; P1 Q-01; P2 Q15; P4 OD-11; P5 D-18; P11 Q20; P13 OD-13, D8; ALLOC §1.3 | |
| A4 | Move dev and E2E to their own Neon Free project `replay-chess-dev` (autoscaling max 0.5 CU) | **Yes, day 0–1** (≈ 1 h with Claude: dump the `dev` branch, restore into the new project, repoint `.env.development.local`, `.env.test`, Vercel `replay-chess-dev`, `WS_DEV_ENV_FILE`). Until then dev, E2E, k6 and backfills spend production's 100 CU-h. Keep the old `dev` branch 14 days (see P1). The owner then updates CLAUDE.md "Neon Database Details" and the environments table | P1 day 1 (task H10) | 01 D2, X21; 06 DB-01; P1 Q-15; P3-Q19; P13 D16 | |
| A5 | Move the "Environments" and "Accounts" sections of the public CLAUDE.md (IPs, registrar account, domain expiry, SSH user, dev URLs) to a gitignored `CLAUDE.local.md` | **Yes**; the owner makes the edit, CLAUDE.md keeps only the rules | P1 | 01 D18; P1 Q-17; P13 OD-13 | |
| A6 | Upgrade the OCI tenancy to Pay-As-You-Go | **Yes, in P1**, with a $1 budget alert and compartment quotas that cap A1 at 4 OCPU / 24 GB and every other shape at 0. PAYG accounts are not subject to Always Free idle reclamation; the quotas keep the bill at $0 | P1 (before the P2 k6 week) | 01 D4; 05 OD-5; P1 Q-14; P2 Q13; P13 OD-4, D18 | |
| A7 | Back up the live database now (P1 H11) | **Yes, day 0**: a read-only role (`pg_read_all_data`) on the old project `shy-morning-50748774`, an `age` key pair (identity kept offline and in the `BACKUP_AGE_IDENTITY` secret), a nightly encrypted `pg_dump` kept 14 days as a GitHub artifact, and a weekly restore check into Docker Postgres. Today the only backup is `/tmp/chess_battle_data_fixed.sql` and Neon Free keeps 6 hours of history | P1 day 0 | P1 Q-19; 06 DB-02; 01 D14 | |
| A8 | Clerk dev: session-token template `{"md": "{{user.public_metadata}}"}` and the webhook endpoint | **Yes, day 0** (Claude can do it in the Clerk dashboard through ego-browser while the owner watches) | P1 day 0 (F4b, F4c) | P1 Q-06 | |
| A9 | Repository visibility | **Keep it public through launch** (the CI cost model assumes free runners and free arm64 runners). That makes A2 and A5 mandatory and exposes prompts, the verifier and constants | P1 (CI design) | 01 D20; P13 Q11 | |
| A10 | Accept the revision-2 estimates and the 20 % buffer lines | **Accept**: 283 dev-days of effort (+ ≈ 56 buffer ≈ 339) against the allocation's 244. Per phase: P1 33.5 (+6.5), P2 32.25 (+6.5), P3 30.75 (+≈ 6), P4 17.5 (+3.5), P5 28 (+5.5), P6 9 (+1.8), P7 17.5 (+3.5), P8 25.5 (+5.1, plus ≈ 7 owner-days of content), P9 17.5 (+3.5), P10 22 (+4.4), P11 20 (+4.0), P12 18.25 (+3.75), P13 11.25 (+2.25, plus ≈ 1.25 owner-days). Buffers are spent only with the owner's OK, recorded in the sign-off. Each phase §13 lists trims if the owner holds the allocation number (never trim P1's H10, the nightly dump or the billing compare-and-set) | P1 day 1 for P1; each phase at its start | P1 Q-07; P2 Q16, §13.4; P3-Q15; P4 OD-9; P5 D-21; P8 OD-13; P11 Q23; P13 §13.4; 01 §6.2 | |
| A11 | Stream plan and launch variant | **Plan for Full with two streams after P3** (launch ≈ week 29). Confirm at P3 sign-off whether the owner can test two phases in the same weeks; if not, choose **Launch A** (P1–P5, P7, a thin P10 and P11, P13; ≈ week 27, the rest after launch) rather than Full on one stream (≈ week 42). The final variant (Full, Early = without P12, or Launch A) is fixed at T−21 d in `launch/variant.json` | Preliminary now; confirm at P3 sign-off (week 11); final T−21 d | 01 D19, §6.2; P6 D-P6-16; P8 OD-13; P9 D22; P11 Q23, §13.5; P12 §14.5; P13 D20, OD-21; ALLOC §0 M5 | |
| A12 | Archive the planning inputs that live only in the session scratchpad (`/private/tmp/…/scratchpad`: the design canvas `design-ref/` with `INDEX.md`, the 360 boards, DS README, tokens and component READMEs; the inventories, audits and critiques in `plan/`; the Phase 1 research reports in `phase1/`) | **Now**, to a durable **private** location (a private repo or the private R2 bucket; not this public repo, since the boards are the owner's design work), and record the path in [README.md](README.md) §2.4. `/private/tmp` can be wiped on reboot, and every phase file points at `DR/*.dc.html` boards. This assembly already copied [allocation.md](allocation.md) and [phase-01a-spec.md](phase-01a-spec.md) | P1 day 0 | README §2.4; 07 §0; every phase file's path table | |
| A13 | CLAUDE.md "Implementation plan: `docs/implementation-plan.md`" | **Point it at `docs/plan/README.md`** (the owner edits CLAUDE.md) | P1 day 0 | assembly | |
| A14 | Where decisions are recorded | **This file** is the register. P1 1A·DOC creates `docs/decisions.md` as a one-line pointer here, so there is one list | P1 | 01 §6.2; P4 §14.1; P11 §14.2 | |
| A15 | Vercel Pro for the **old** account now | **Consider now**: the live site already charges grandfathered $8 members on Hobby, which is licensed for non-commercial use. (The new team must be on Pro before its first charge: N3) | owner's call, any time | 01 D1; P13 OD-2 | |

## B. During P1 (weeks 1–3)

| ID | Decision | Recommended answer | Needed by | Sources | Answer |
|---|---|---|---|---|---|
| B1 | Flip `SOCKET_AUTH_REQUIRED=true` on the prod socket (`WS_ENV_FILE`) | **Yes**, after 48 h clean on dev and a check of the prod socket logs for "token missing" counts; flip at a low-traffic hour | P1 H6 (prod) | P1 Q-04, R1 | |
| B2 | Switch the dev `DATABASE_URL` to the DML-only `replay_app` role | **Yes** on dev; production in P13 | P1 F9 | P1 Q-05 | |
| B3 | Ship `IdempotencyKey` in M1 or M2 | **M2**, with its first consumer `POST /api/games` | P2 WP-A | P1 Q-03; P2 §6 | |
| B4 | Vercel Firewall on Hobby: is a rate-limit rule (with a redirect to `/too-many-requests`) available among the 3 custom rules, and can a custom rule redirect at all? | **Check in the dashboard in P1.** If not: keep the in-isolate `EDGE_DOC_LIMIT` on `/api/openings*` and `/api/positions*` and rely on CDN caching (P8 variant B); in the P13 freeze, a deny rule plus the email and status-page announcement | P1 (P8 WP-5 and P13 D6 use the answer) | P1 Q-08; 03 Q8; P8 OD-14; P13 Q2, D6; 06 Q SEC-09 | |
| B5 | Protect the dev site (`replay-chess-dev`) | **Yes**: Vercel Authentication with a Protection Bypass for Automation secret, on P1 day 11 after V2 (Q2) is verified and the Dodo/Clerk webhooks pass through the bypass; also consider restricted sign-up on the Clerk dev instance (Q3). Open Clerk dev sign-up plus Dodo test cards otherwise make the dev site a free copy of the product | P1 day 11 | 01 D21; P1 Q-16, R14 | |
| B6 | Uptime monitoring | **Yes**: a free UptimeRobot account with the two monitors of P1 §7.8 (dev socket `/health` included), subject to Q5 | P1 | P1 Q-20; 01 D15 | |
| B7 | Copy deviation: Title Case buttons on system screens ("Sign In Again", "Try Again in 0:30"); the payment `last_day` copy drops "tomorrow" (time zone unknown until P4) | **Accept** | P1 | P1 Q-10 | |
| B8 | Phase 1 track-1A items, one pass: U2 retire the 6 "Various" placeholder seed positions; U3 land members on `/play` after sign-in; U4 fluid page-title clamp (README 28–36 px vs boards 44 px); U5 `NEXT_PUBLIC_APP_ENV=production` on prod; U6 iOS standalone status bar `default` instead of `black-translucent`; U7 PWA start URL `/play` (`"id": "/"` keeps installs); U8 `reloadOnOnline` off; R7 Android bars use the iPhone heights (44/56) for now; S1 no ink-sweep hover; S2 toast placement per V3 (update the DS README); S3 accent fills selected states; S4 phone avatar opens the account sheet; S5 Title Case palette rows | **As SPEC recommends**: U2 off; U3 in P2 (members land on `/home` from P5); U4, U6, U7, U8, R7, S1–S5 accept; U5 goes on the P13 checklist | P1 1A | P1 Q-11; SPEC §13 | |
| B9 | Read old production once (read-only role) to copy legends, positions with explanations and opening explanations into dev | **Yes, once**, with a read-only role. It makes the owner tests realistic (51 legends, 3,641 openings) | P1 1A·P6 seed (optional), P8 WP-0 at the latest (week 12) | SPEC U1; P8 OD-6; 02 §13.2 | |
| B10 | Where the payment banner's "Update Payment" goes for `on_hold` trials whose grace end differs from `currentPeriodEnd` | **Dodo portal**; the copy "You keep access until …" uses `currentPeriodEnd` until P10 verifies Dodo's grace semantics (Q35) | P1 | P1 Q-12 | |
| B11 | Consent policy for error capture and performance metrics | **Error capture without PII and without Replay is strictly necessary** (no consent needed, disclosed in the cookie policy). **Anonymous Sentry performance metrics** (`{route_class, device_class}`, no user id) **also run without consent**, disclosed the same way, so the client part of the review and training SLOs stays measurable. Session Replay and PostHog only after consent. If the owner says no to the metrics, the client SLOs fall back to Speed Insights (cookieless) and the Playwright lab gates. The four specs disagree today (§R6) | P3 F2 (week 8); P11 WP-G confirms the copy | 01 D11; P3-Q17; P5 D-22; P7 OQ15; P11 Q2, Q21 | |

## C. P2 (weeks 4–6)

| ID | Decision | Recommended answer | Needed by | Sources | Answer |
|---|---|---|---|---|---|
| C1 | Internal service auth: HMAC from P2, or keep the static `x-internal-token` | **HMAC from P2** (`x-rc-kid`, `x-rc-ts` ± 60 s, `x-rc-sig` over method, path and body hash; key set in `INTERNAL_API_SECRET`; per-kid path and event allow-lists; 2-minute replay set; Caddy refuses unsigned `/internal/*` and `/engine/*`). User socket tokens use the separate `SOCKET_TOKEN_SECRET`. Fresh, separate per-caller production keys at P13. Fallback if P2 runs out of time: the static token, changing only `CT/internal/auth.ts` | P2 WP-C/D/E (week 4) | 01 D22, CR-16, X20; P1 Q-18; P2 Q17; P3-Q16; P4 OD-10; P13 D19; ALLOC B20 | |
| C2 | Spectating rules | **Members only.** Any live human game is watchable by URL with a one-ply delay (friend games too); bot games are private; tournament games are public. From P10, a game is watchable only when neither player's profile is private (01 D8 "both players public") | P2 (spectate states) | 01 D8; 03 Q2; P2 Q3, Q8; P9 D16 | |
| C3 | Bot games run in the browser | **Accept**: client-run and unrated, adjudicated on completion (replay, legality, claim check). Forging one only affects the forger's own coaching data | P2 | 01 D16, X9 | |
| C4 | Study phase scope | **30 s only when the start position is not the initial position**, else 0 | P2 | P2 Q1; 03 Q15 | |
| C5 | Abort rights in the first-move window | **Only the side whose first move is pending** | P2 | P2 Q2 | |
| C6 | Opponent-disconnected copy | **Two variants by side to move**; clocks are never paused for a disconnect | P2 | P2 Q4 | |
| C7 | Keep the legacy fallback after a parity gate | **Yes, one release** (the deletion PR is merged in the next phase's week 1). The same rule applies to every phase's legacy screens | P2 gate | P2 Q5; 01 §4.7 rule 3 | |
| C8 | Bot games: pause the human's clock while the page is hidden | **Yes** (unrated, friendly) | P2 | P2 Q6 | |
| C9 | Stale games | **Live:** abort after 30 min with < 2 plies, abandon (side to move loses) after 2 h. **Bot:** abort after 7 days | P2 | P2 Q7 | |
| C10 | Viewing history when your turn comes | **Stay on the viewed ply**, flash "Back to live", play the sound | P2 | P2 Q9 | |
| C11 | Premove against the bot | **Off** | P2 | P2 Q10 | |
| C12 | Bot draw acceptance | **Plies ≥ 60 and \|eval\| < 30 cp** | P2 | P2 Q11 | |
| C13 | Drain notice length on socket deploys | **30 s on dev, 120 s on production** | P2 (prod value at P13) | P2 Q12 | |
| C14 | Game images (`/og/game`) | **Dropped**; share images come only from P3's shares | P2 | P2 Q14 | |
| C15 | The hand-off ledger (slots later phases light up) | **Each receiving phase adds its row**; an unpicked row leaves a designed slot unrendered | P2 onwards | P2 Q18; 07 §3 | |
| C16 | Move `schema.prisma` into `packages/db` | **Yes**, P2 WP-A, its own PR before M2 | P2 WP-A | 02 O12 | |
| C17 | DS README says "Game over is a centred card on the final board"; the v3 boards replace the panel top and never cover the board | **Follow the boards**; the owner updates the DS README on the design canvas | P2 | P2 §14.3 | |

## D. Before P3 starts (week 7) and during P3

| ID | Decision | Recommended answer | Needed by | Sources | Answer |
|---|---|---|---|---|---|
| D1 | **Lapsed members ("past reviews stay readable"):** can a member whose membership ended still read past reviews, the archive, the bank and the weakness profile? | **Default: no.** Hard redirect to `/pricing?reason=ended`, data kept 12 months. The flag `review-lapsed-read` and `requireMember({ allowLapsedRead: true })` on review, archive and bank GETs are ready if the answer is yes, which also makes 6 designed states and flow edges E41, E78, E80 reachable with real data | **Before P3 starts (week 7)** | ALLOC B26; 01 D7; 02 O8; 03 Q1; 04 Q1; P1 Q-09; P3-Q1; P5 D-19; P6 D-P6-13; P7 OQ5, D18; P11 Q14; 07 C-21; PLAN §1.7 | |
| D2 | Public review share links `/r/…` under "analysis is private to players" | **Yes, opt-in per game**: 30 days, `noindex`, revocable, member opponents masked when "show my username" is off; the page is built from the share preview card (no board exists) | Before `review-share` goes beyond the owner | P3-Q2; 03 Q12 | |
| D3 | Number of key moments | **3**, filled with inaccuracies at ≥ 7 Win % when there are fewer than 3 mistakes | P3 A5 | P3-Q3 | |
| D4 | Dev worker CPU and the fallback | **0.75 CPU in a `cpu.idle` slice on the dev box.** If the C1 bench or the co-location gate fails twice, create the 2-OCPU / 12-GB worker VM now (after A6) and run the dev worker there until P13, still inside 4 OCPU / 24 GB (P13 then re-points it) | P3 C1 (week 7) | P3-Q4; P13 OD-22; 01 V1 | |
| D5 | Analysing copy "usually in under 10 seconds" | **Keep only if the dev p50 is ≤ 10 s for 40 plies**; otherwise "usually within half a minute" | P3 F2 | P3-Q5 | |
| D6 | Badge art | **The owner's `public/board_icons`** with the `mq-*` colours; Interesting uses `sharp.svg` | P3 F3 | P3-Q6; ALLOC B8 | |
| D7 | VERIFIED tag on P3's template text | **No tag in P3**; it arrives with P7's verifier | P3 F3 | P3-Q7 | |
| D8 | Eval graph and bar orientation | **The user's side up** | P3 F3 | P3-Q8 | |
| D9 | Worker image registry | **Private on GHCR** (it contains GPL Stockfish) | P3 C7 | P3-Q9 | |
| D10 | Create the `replay_worker` role on the Neon dev database | **Yes** (non-destructive) | P3 B1/C2 | P3-Q10 | |
| D11 | "How we grade" page content: the Lichess "+1" in the formula, a `#failures` section, the engine version and date, a Pricing link | **Yes** | P3 G4 | P3-Q11; 07 C-18 | |
| D12 | Copy for states with no design (queued, finding key moments, too short, no turning points, terminal, share error/revoked, the public page and its gone view, the legend menu entry, complete on phones, the game-over coach-line templates) | **Accept the strings in P3 §4 and §8.7** | P3 F2–F6, E3 | P3-Q12 | |
| D13 | Backfill analysis for existing dev games | **Yes, the newest 200**, at `BACKLOG` priority, after A4 | P3 B3 | P3-Q13 | |
| D14 | Games that predate P3 in `/games` | **"Not reviewed yet"**, analysed on open | P3 G1 | P3-Q14 | |
| D15 | Game-over review CTA | **As designed**: disabled "Analysing · n %" while analysing, then "See What the Coach Thinks" | P3 E3 | P3-Q18 | |
| D16 | If the dev Neon split (A4) is not done by P3 week 3 | **Slip the backfill and the k6 run** (do not spend production's CU-h) | P3 week 3 | P3-Q19 | |
| D17 | `JobKind` as a Postgres enum or `text` + zod | **Closed: P3 ships a Postgres enum in M3** with the two-release rule (every value ships in M3's release; no later phase adds a kind P3 writes) | P3 M3 | 02 O14; 01 §1.10.1; P3 §6 | default |

## E. P4 (weeks 12–15)

| ID | Decision | Recommended answer | Needed by | Sources | Answer |
|---|---|---|---|---|---|
| E1 | Import scope and analysis volume | **12 months, newest 2,000 games; eager analysis for 50 games per member and 20 per trialist; at most 200 unopened analyses per member; the backlog in 7 daily slices after the first paid charge.** At launch, backfilled Chess.com links get an automatic first import (entitled users only, 1 user/s), and legacy games are analysed for entitled users within the same budget | P4 start | P4 OD-1; P13 D14, OD-7, OD-8; P6 D-P6-3 (see §R7) | |
| E2 | Privacy policy text for the trial ledger and imported game data (opponents' public names and ratings); legal review of Chess.com's User Agreement | **Required before launch** (a P13 preflight blocker). Until it clears: no Chess.com avatars, provider names as plain text only. No blocker on dev | Before T−5 d (N13) | P4 OD-2; P13 OD-16 | |
| E3 | Copy changes against the onboarding boards ("Importing starts as soon as your trial begins"; all-time "rated games" counts; rewritten `private_games` banner; "Confirmation sent to …" omitted; "Go to Home" hidden while activating; initials instead of avatars) | **Accept as written in P4 §4** | P4 F | P4 OD-3 | |
| E4 | Chess.com handle ownership | **No verification in P4**: unverified handles are allowed and do not block trials; a verified owner takes the handle over; build the profile-location check in P10 only if squatting shows up (`RELINK_REQUIRED` is reserved) | P4 | P4 OD-4; 02 O10; 03 Q13 | |
| E5 | Default billing interval | **Monthly**, on the onboarding plan step and on the pricing page (the code and e2e use yearly today) | P4 F (pricing in P11) | P4 OD-5; P11 Q13 | |
| E6 | Does "Play friends" take minutes in the day preview? | **No** ("ANYTIME") | P4 F | P4 OD-6 | |
| E7 | Lichess OAuth | **Client ids `replay-chess-dev` and `playchess.tech`, no scopes, store no token**: use it once to confirm the account, revoke it in the callback, import anonymously (≈ 20 games/s) | P4 C | P4 OD-7; 02 O13; 01 §2.3.2 | |
| E8 | Trial ledger after account deletion | **Keep the hashed email and handles** (one trial per person), disclosed in the privacy policy | P4 (M4 creates `TrialLedger`); policy text by T−5 d | 01 D13; P10 §8 | |
| E9 | Trial-started and trial-ending emails | **P10 owns both**; P4 builds no email (Dodo's receipt covers "trial started") | P4 | P4 OD-8; P10 Q24 | |

## F. P5 (weeks 16–19)

| ID | Decision | Recommended answer | Needed by | Sources | Answer |
|---|---|---|---|---|---|
| F1 | Inaccuracies in the Mistake Bank | **Yes**, when ΔWin ≥ 7 in an undecided position, inside the 4-per-game cap | P5 | P5 D-1 | |
| F2 | "Remove from bank" (no design exists) | **Ship behind the `bank-remove` flag** (row ⋯ + Undo toast 6 s); a design board is needed before the flag reaches members | P5 (design before members) | P5 D-2 | |
| F3 | Puzzle rating seed | **Linked blitz/rapid + 300, clamped 800–2200, RD 250**, "provisional" under 20 attempts | P5 | P5 D-3 | |
| F4 | Streak definition | **≥ 1 graded item a day; one missed day forgiven** ("resets if you skip 2 days") | P5 | P5 D-4 | |
| F5 | New-user Train hub (no board) | **Ship the default**: step 1 "Review your last game" / "Import games", step 2 puzzles at the seeded rating, an empty state in the due strip; ask Design for `V3TrainHubNew` | P5 | P5 D-5 | |
| F6 | Puzzle cards for clean first-try solves | **No**: a card only on Again or Hard; clean solves are logged (≈ 60 % fewer rows) | P5 | P5 D-6; 02 O6 | |
| F7 | FSRS library version | **`ts-fsrs@^5.4.2` behind `fsrs.ts`**; v6 later is a wrapper-only change plus the golden tests (see §R14) | P5 | P5 D-7; 01 X13 | |
| F8 | "Hard 2 days" on new cards | **Custom again-only learning steps** (Hard graduates); fallback: default steps with the button truthfully showing "15 min" | P5 | P5 D-8 | |
| F9 | Which mistakes become cards | **Key-moment plies only** (≤ 3 per game); up to 4 `Mistake` rows per game for stats | P5 | P5 D-9 | |
| F10 | Grade override after Show Solution | **Allow any grade, track `overridden`**; if overrides after the solution exceed 30 %, consider disabling Good/Easy there | P5 | P5 D-10 | |
| F11 | Nav due badge | **None** (not in the design); `badges.bankDue` exists for later | P5 | P5 D-11 | |
| F12 | Home device layouts (no boards exist) | **Derived from the Train hub device pattern**; a design pass before the `home` flag reaches members | P5 (design before members) | P5 D-12; 07 §6 | |
| F13 | Client-side Glicko preview on the puzzle chip | **Show the deterministic preview**, replaced silently when the batch flushes | P5 | P5 D-13 | |
| F14 | Where training preferences live | **`TrainingProfile` columns**, written only through `PATCH /api/train/prefs` | P5 | P5 D-14 | |
| F15 | Reports | **One `Report` table and `POST /api/reports`** (extended by P10, moderated in P12) | P5 | P5 D-15 | |
| F16 | Puzzle shard URL | **The existing `replay-chess-media` R2 bucket's public URL now**; `media.playchess.tech` when the owner confirms the custom domain (a P13 prerequisite at the latest) | P5 | P5 D-17; P13 §2 | |
| F17 | Keep `training_attempts` | **24 months**, then delete (after the FSRS optimiser is fitted) | P5 (pruning job in P10) | 02 O7 | |
| F18 | Smaller open questions (no default needed to start): "Drill These 3" from Review and the daily cap; Lichess games with `%eval` but no pass 2; "Continue with puzzles" theme; stop after N misses | **Not counted** toward the cap; **wait for pass 2** before becoming a puzzle; the session's **top theme**; **no stop** in P5 (track `train_wrong_move` and revisit) | P5 | P5 §14.3 | |

## G. P6 (weeks 20–21)

| ID | Decision | Recommended answer | Needed by | Sources | Answer |
|---|---|---|---|---|---|
| G1 | Default scope | **Rapid + blitz, the last 6 months, ≤ 300 games** | P6 | P6 D-P6-1 | |
| G2 | Full-profile threshold | **20 analysed games; preliminary patterns from 5** (the design's number, not the old plan's 10) | P6 | P6 D-P6-2; 01 X15; 02 O4 | |
| G3 | Analyses spent on a profile | **Up to 100 per member and 20 per trialist**, always inside P4's caps (E1), the first 20 at import-newest priority (P6's text says the trialist cap is 40: §R7) | P6 | P6 D-P6-3 | |
| G4 | Phase or opening gaps as top-3 rows | **No in v1**; they appear in the headline clause and the tabs | P6 | P6 D-P6-4 | |
| G5 | Chess.com → Lichess rating offset for the baseline | **0 in v1**, labelled "on Lichess"; revisit with data | P6 | P6 D-P6-5 | |
| G6 | Do bot games count? | **No**; "play N more games here" counts friend, online and tournament games only | P6 | P6 D-P6-6 | |
| G7 | Time-pressure drills | **Untimed, own positions only**, no matched puzzles | P6 | P6 D-P6-7 | |
| G8 | Time-pressure drill items | **Every bank item tagged `rc:timePressure`** (every error under 1 minute) | P6 | P6 D-P6-8 | |
| G9 | Phone drill start | **A config sheet with defaults** (10, mix): one extra tap | P6 | P6 D-P6-9 | |
| G10 | Strengths on the public profile | **Own profile only** | P6 (P10 renders) | P6 D-P6-10 | |
| G11 | When a ready profile updates | **Silent refresh with an "Updating…" chip**, a toast only when the top pattern changes | P6 | P6 D-P6-11 | |
| G12 | Nav dot rule | **First READY, or a new pattern in the top 3** | P6 | P6 D-P6-12 | |
| G13 | Inaccuracies in weakness stats | **Excluded** (mistakes, blunders and misses only) | P6 | P6 D-P6-14 | |
| G14 | Baseline dump month and refresh cadence | **One 2026 month; quarterly refresh**, with an `ALGO_VERSION` bump only when the formulas change | P6 | P6 D-P6-15 | |
| G15 | Recompute debounce | **240 s** (inside Neon's 5-minute suspend window) | P6 | P6 D-P6-18 | |

## H. P7 (weeks 22–24)

| ID | Decision | Recommended answer | Needed by | Sources | Answer |
|---|---|---|---|---|---|
| H1 | Coach fair-use caps and copy | **Members: burst 5 a minute, 30 a day, 150 a month, $1.50 of model cost a month. Trial: 10 a day, 40 in total, $0.40.** One file `CT/limits.ts`. The board's "Unlimited questions" becomes "About any move, fair use applies", with a `/help#fair-use` answer generated from the limits | P7 day 1 (copy by day 10; pricing copy in P11) | 01 D6, CR-33, X11; 02 O5; 03 Q4; 05 OD-7; P7 OQ1, D6; P11 Q11; PLAN §4.5 | |
| H2 | Coach models | **`claude-sonnet-5-5` for chat, `claude-haiku-5-5` for review text** (ids in env); Opus 5.5 would roughly double the chat cost | P7 day 4 | P7 OQ2; 03 Q11 | |
| H3 | "What would Tal play?" chip (legend-style claims cannot be verified) | **Off** (flag `coach-legend-chip`) | P7 day 10 | P7 OQ3 | |
| H4 | Anthropic account set-up | **Create workspaces `replay-dev` and `replay-ci` now** and `replay-prod-web` / `replay-prod-worker` in P13; spend limits dev $20/month, CI $10/month, prod ≈ 2× expected spend; keys in Vercel `replay-chess-dev`, `WORKER_DEV_ENV_FILE` and GitHub Actions (`ANTHROPIC_API_KEY_CI`) | P7 day 1 (blocks live testing) | P7 OQ6 | |
| H5 | Coach privacy | **Name Anthropic as a subprocessor; keep coach messages 180 days; zero data retention not needed** | Before the P11 legal pages | P7 OQ7 | |
| H6 | "Report a wrong answer" (no design board) | **Flag on for dev, off at launch** unless approved | P7 day 10 | P7 OQ8 | |
| H7 | "Ask the coach" in the Review ⋯ menu (not in `V3ReviewSummary`) | **Add it** | P7 day 10 | P7 OQ9; 07 §6 | |
| H8 | Global daily cost breaker | **`max($5, $0.08 × entitled members)`**, ceiling $5 on dev and $50 on prod | P7 (prod value at P13) | P7 OQ10; 01 CR-33 | |
| H9 | What the coach may discuss | **Any ply of the member's game, including the opponent's moves, never during a live game** | P7 day 4 | P7 OQ12 | |
| H10 | Eval numbers in answers | **White's view ("+2.7")**, with "for you" when relative | P7 day 4 | P7 OQ13 | |
| H11 | Bot-zone coach card for plain BOT games (`V3GameBot` `bot`) | **Dropped**; LEGEND_BOT keeps P8's authored line; revisit after launch as a template-only note (O4) | P7 | P7 OQ14, D25(d); 07 C-09 | |
| H12 | LLM `statLine` on the profile Stats tab | **Dropped**; P10 keeps its template sentence | P7 | P7 OQ16, D25(e); 07 C-19 | |
| H13 | Prompt-cache TTL for the system block | **5 minutes**; switch to 1 hour once the p50 reaches 4 or more coach requests an hour (monthly review) | P7, then monthly | P7 OQ17, D21; 01 §1.11 | |
| H14 | Coach thinking mode (adaptive vs `between_tools`) | **Decide by the A/B result** | P7 | 05 OD-8 | |
| H15 | Voice | **Browser `speechSynthesis` now** (free); a paid TTS provider later. Lessons are text-first (no audio in v1) | P7 (coach voice), P8 (lessons), P10 (settings) | 01 D10; P8 OD-4; P10 Q14 | |

## I. P8 (P8a weeks 12–14, P8b weeks 21–22)

| ID | Decision | Recommended answer | Needed by | Sources | Answer |
|---|---|---|---|---|---|
| I1 | Legend visibility threshold | **≥ 8 positions in production** once the content copy has run (`LEGEND_MIN_POSITIONS`), 1 on dev; legends with lessons only are always visible | P8 WP-3 | P8 OD-1 | |
| I2 | URLs | **Slugs are canonical with redirects from the cuid URLs; legend slugs are full names** (`paul-morphy`) | P8 WP-0, WP-5 | P8 OD-2; ALLOC B25 | |
| I3 | Learn catalogue chrome for signed-in members | **The marketing header with the Play + avatar island** (static, free, matches the boards), not the app shell | P8 WP-2, WP-3 | P8 OD-3 | |
| I4 | Legend practice rules | **Study 30 s on the first game of a series only; no first-move abort; clocks pause while hidden; Hint/Takeback opt-in and recorded; Restart discards an unfinished game** | P8 WP-6 | P8 OD-5 | |
| I5 | Lesson accuracy review | **The owner reviews; Claude drafts** narration and opening notes. The content track is ≈ 7 owner-days (8 lessons, opening notes, bios, portraits and sources), entered in the owner's calendar | P8 WP-C (from P8a day 1) | P8 OD-7, §13.2 | |
| I6 | Where due opening lines are drilled | **A Train hub row "Opening lines · n due"** with its own `OPENINGS` session, never counted in the bank cap | P8b WP-8 | P8 OD-8 | |
| I7 | Copy | **Drop the "Included" tag** on the positions catalogue; one name for the Opera Game opponents: "Duke of Brunswick & Count Isouard" | P8 WP-3, WP-0 | P8 OD-9 | |
| I8 | Openings popularity source | **The Lichess CC0 dump** (the explorer now needs OAuth); the owner's token only if the dump run fails | P8 WP-J8 | P8 OD-10 | |
| I9 | "Next lesson" order | **Legend order** when entered from a legend page, the five-game path otherwise | P8b WP-7 | P8 OD-11 | |
| I10 | Living legends and portraits | **Keep living players in the catalogue** with factual copy and "Play This Position" (nothing implies endorsement); no outreach in v1. **Portraits only with a recorded source and licence** (public domain, CC with attribution, own or permission; `portraitSource`, `portraitLicence`); initials otherwise. The admin upload form records both | P8 WP-3 (P12 admin form) | 01 D23; P8 OD-12; P12 O12-16 | |

## J. P9 (weeks 15–17)

| ID | Decision | Recommended answer | Needed by | Sources | Answer |
|---|---|---|---|---|---|
| J1 | Ratings | **Internal Glicko-2 per pool** (Bullet / Blitz / Rapid by `initial + 40 × increment`; 30+0 is Rapid), seeded from the linked or onboarding rating. Online games always rated; friend games rated by default with a Rated switch; tournament games rated in their pool | P9 WP-A | P9 D1; 02 O3; 03 Q3; P12 O12-7 | |
| J2 | Must a challenge invitee be a member? | **Yes** (paid-only); the guest path goes through the 7-day trial | P9 | P9 D2 | |
| J3 | Does Decline close a challenge link? | **No**: notify the creator, keep the link open for someone else | P9 | P9 D3 | |
| J4 | Challenge code length (the design shows 4) | **8 Crockford characters** | P9 | P9 D4 | |
| J5 | Online legend pool | **One position per UTC day for every bucket** | P9 | P9 D5 | |
| J6 | Balanced-position threshold for rated legend games | **±150 cp with the handicap**; positions beyond are never rated | P9 | P9 D6 | |
| J7 | Default rating when nothing is known | **1500 / RD 350** | P9 | P9 D7 | |
| J8 | Lichess → Replay offsets | **Bullet −250, Blitz −200, Rapid −150**, recalibrated after 4 weeks (O5) | P9 | P9 D8 | |
| J9 | Rated games per pair per 24 h | **3** finished, non-aborted games | P9 | P9 D9 | |
| J10 | Default colour | **White** on Legend (hero side), Bot and Friend; **Random** on Online | P9 | P9 D10 | |
| J11 | Public preview of `/s/<code>` for signed-out visitors | **Yes**, with the trial CTA | P9 | P9 D11 | |
| J12 | View counts on the owner's share view | **None**; PostHog has the numbers | P9 | P9 D12 | |
| J13 | Queue error copy "Nothing was charged" | **"No game was started."** | P9 | P9 D13 | |
| J14 | Match found: own screen or the game page? | **Its own state of `/play/online`** | P9 | P9 D15 | |
| J15 | Phone back arrow on match found | **Goes to `/play`**; the game ends as a no-show and counts toward the abort limit | P9 | P9 D17 | |
| J16 | Bot persona names and quotes (400, 800, 1600, 2000) | **The drafts in P9 §8.11** | P9 | P9 D18 | |
| J17 | Merge time controls of the same group after 20 s of waiting | **On** (`MERGE_PRESETS_AT_MS = null` turns it off); the widened banner and the match card say so | P9 | P9 D20 | |
| J18 | Legend pool on Online at launch (`online-legend-pool`) | **On**; turn it off for a week when the legend buckets' `queue_timeout` rate stays above 50 % while the standard buckets' is below it | P9; reviewed after launch | P9 D21 | |
| J19 | Glicko parameters for play | **τ 0.75, RD floor 45, one inactivity period per 7 days** (preset name: §R10) | P9 | P9 D24; 01 CR-28 | |

## K. P10 (weeks 18–20)

| ID | Decision | Recommended answer | Needed by | Sources | Answer |
|---|---|---|---|---|---|
| K1 | Account-area access matrix | **Non-members see only Account, Connected accounts and Membership; public profiles are readable by everyone** (signed out included, `noindex`) | P10 | P10 Q1, D14 | |
| K2 | Pause membership | **Build it**: pause starts at period end, lasts one month, once per 12 months; "Resume now" keeps the next charge on the original date; `paused` is a 13th membership state (no board: the `cancelling` layout with P10 §4.15 copy). Pending the Dodo spike (task 4.0) | P10 task 4.0 | P10 Q2, Q19, D6; 03 Q6 | |
| K3 | Imported Chess.com/Lichess games on other people's view of a profile | **Hidden** (Replay games only); the owner sees all | P10 | P10 Q3; 03 Q9 | |
| K4 | What another player's game row opens | **The read-only finished game `/game/{ref}`** (moves only, no engine data); reviews stay private to the players | P10 | P10 Q4; 02 O11 | |
| K5 | Headline rating for imported-only players | **The linked rating labelled with the provider** ("CHESS.COM 1179") | P10 | P10 Q5 | |
| K6 | Email provider | **Resend from `hello@playchess.tech`**, free plan (100 a day) with the budget guard and a 20-a-day transactional reserve; weekly digest email on by default (design default). Resend Pro for the launch month: N16 | P10 start (week 18) | 01 D9; P10 Q6; P4 OD-8; PLAN §1.5 | |
| K7 | Milestone catalogue v1 copy (8 definitions, one lit up by P12) | **Ship as listed** in P10 §8.9 | P10 | P10 Q8 | |
| K8 | Piece sets B/C and languages | **Placeholders hidden; languages shown disabled "(later)"** | P10 | P10 Q9; 07 §6 | |
| K9 | Board themes vs the DS rule "the board is neutral grey, never brand-tinted" | **Amend the DS**: user-chosen themes allowed, Graphite (neutral) stays the default | P10 | P10 Q10 | |
| K10 | Delete-account copy "no refund for the rest of this month" (EU/India consumer law) and cancelling on deletion | **Keep the copy pending a legal check; cancel the subscription immediately** on deletion | P10 (legal check by T−5 d) | P10 Q11 | |
| K11 | Usernames | **Case-insensitive**; copy "Usernames are not case-sensitive." | P10 | P10 Q13 | |
| K12 | Membership copy | **"Coach questions (fair use)"** instead of "Unlimited coach questions"; "Analysis of your Chess.com and Lichess games"; past-due copy without "We will retry on {date}" (Dodo does not expose it) | P10 | P10 Q15, Q16 | |
| K13 | Reports before P12's moderation UI | **Collect them**; the owner gets a weekly count in the admin email until P12 | P10 | P10 Q17 | |
| K14 | No `player_stats` table (stats computed from `game_players`) | **Accept**, guarded by the k6 gate | P10 | P10 Q18, D3 | |
| K15 | 24-hour undo window before account deletion | **Off** (as designed: "Can't be undone"); P10 §8.12 has the 0.5-day variant | P10 | P10 Q20 | |
| K16 | Settings › Training and the in-game Board settings sheet (no boards) | **Build both in P10 from the UI kit** with the copy in P10 §4.18–§4.19 (training cap, new per day, release hour, day start, auto-grade, time zone, weakness scope), writing through P5's `PATCH /api/train/prefs` and P6's recompute route; the owner signs off the copy. P5 and P6 ship defaults only | P10 | P10 Q21; P5 D-20; P6 D-P6-17; 07 C-12 | |
| K17 | "Tell me when one opens" on the empty tournament list, and a "New tournaments" notification row | **Not built at launch**: the empty state ends at "New arenas open most evenings." Revisit after launch (≈ 0.5 d: a push-only `tournament_new` channel, off by default, at most one alert a day, plus a settings row that needs design sign-off). P10's draft default (add the row) conflicts: §R8 | P10 / P12 | P10 Q22; P12 O12-14, D12-19; 07 C-14 | |
| K18 | "Challenges from friends" notification meaning | **"A friend accepted your challenge link"** (P9 has no direct challenges) | P10 | P10 Q23 | |
| K19 | Trial-ending email | **48 h before the first charge**, copy in P10 §8.17, sent by a future-dated `NOTIFY_DISPATCH` job with the daily cron as backstop; no separate "trial started" email | P10 | P10 Q24; 01 X10 | |
| K20 | Cloudflare cache purge of a deleted user's avatar URLs | **Off**; UUID URLs age out | P10 | P10 Q25 | |
| K21 | `users.dateOfBirth` | **Stop reading it and drop it** (contract C7) unless an age gate is planned | P10 (drop later, §P) | 01 D12; 02 §5.11 C7 | |

## L. P11 (weeks 25–26)

| ID | Decision | Recommended answer | Needed by | Sources | Answer |
|---|---|---|---|---|---|
| L1 | Cookie bar region | **Worldwide** (simpler; benign copy) | P11 WP-G | P11 Q1 | |
| L2 | Apple sign-in at launch | **Off** (flag `NEXT_PUBLIC_AUTH_APPLE`); it needs an Apple developer account | P11 WP-C | P11 Q4; PLAN §4.4 | |
| L3 | Legal entity name, footer, support address, founding story, team row, support SLA | **`hello@playchess.tech`, footer "ReplayChess · 2026"**, placeholders kept on About and the legal pages until the owner supplies them | Before T−5 d | P11 Q5; PLAN §4.6 | |
| L4 | "30-day money-back guarantee" claim (`lib/billing/copy.ts:44,63`) | **Drop it** from the FAQ and copy until the Terms state a refund policy | P11 WP-A | P11 Q6 | |
| L5 | Google Analytics | **Delete it** (PostHog covers it; the copy names PostHog only) | P11 WP-G | P11 Q7 | |
| L6 | "Keep me signed in" checkbox (no Clerk equivalent) | **Omit** | P11 WP-C | P11 Q8 | |
| L7 | Clerk account-enumeration behaviour (`unknown_email`, `email_taken`) | **Accept** (matches the boards) | P11 WP-C | P11 Q9 | |
| L8 | Server-side PostHog events without browser consent (`account_created`, billing truths, marked `consentExempt`) | **Yes**, as service operation, disclosed in the privacy policy | P11 WP-C | P11 Q10 | |
| L9 | Contact form storage | **Add a `support_requests` table** (durable, retryable, 180-day retention) | P11 WP0 | P11 Q12 | |
| L10 | Offline bot games under paid-only | **Yes** if P2's runner supports local games: unrated, synced on reconnect, rejected for lapsed members; else the offline rows and the queue's offline CTA are hidden | P11 WP-E | P11 Q15; 04 Q2; P9 D14; 07 C-10 | |
| L11 | Scheduled-maintenance info banner in the shell (no board) | **Ship** with the `Banner` info style | P11 WP-F | P11 Q16 | |
| L12 | Anonymous consent rejections | **Not stored** | P11 WP-G | P11 Q17 | |
| L13 | Help copy fixes (reset by code, import timing, disconnect rule, fair use) | **Apply as listed** in P11 S8 | P11 WP-B | P11 Q18 | |
| L14 | `/licenses` as a fourth link in the legal switcher | **Yes** | P11 WP-B | P11 Q22 | |
| L15 | Clerk session lifetime (how often "You've Been Signed Out" appears) | **Keep Clerk's default**; review the `V3SessionExpired` rate in PostHog a month after P11 and lengthen it if members see the dialog often | P11 WP-C | 04 Q3 | |

## M. P12 (weeks 23–24)

| ID | Decision | Recommended answer | Needed by | Sources | Answer |
|---|---|---|---|---|---|
| M1 | Who can host tournaments | **Admins** create, start and end; an optional featured host (`hostUserId`) set through the API only; member-hosted invite-only arenas later behind a flag | P12 | P12 O12-1; 03 Q7 | |
| M2 | Auto-navigate into the paired game | **Yes**, when the 5 s "study starts in" count reaches 0; "Go to Game" navigates at once; other tabs get a toast | P12 | P12 O12-2 | |
| M3 | Lobby window and minimum players | **Lobby opens 60 min before the start; with fewer than 2 players the start moves 10 min once**, then the arena is cancelled and participants are told in the app | P12 | P12 O12-3 | |
| M4 | Time-sliced positions | **Yes**: duration ÷ number of positions; everyone in a slice plays the same position | P12 | P12 O12-4 | |
| M5 | Arena scoring | **Lichess rules**: 2/1/0, on fire after two wins (4/2/0), a draw before ply 20 scores 0, rank by score, then fewer games, then join order. The draw-streak rule is **not** included (≈ 0.5 d to add) | P12 | P12 O12-5 | |
| M6 | Public read access | **Signed-out visitors and lapsed members can see lists, lobbies, live arenas and results**; join, Find Match and spectating need membership; lobby, live and join pages are `noindex`, results are indexable | P12 | P12 O12-6 | |
| M7 | Deviations from api-design and allocation (no `TournamentPairing`, `TournamentInvite` or `AdminActivity` tables; no HTTP find-match fallback; folded routes; `/t/[slug]`; rooms by slug; the B4 exception for lifecycle writes; the `matched` state instead of `V3MatchFound`) | **Approve** | P12 | P12 O12-8; 07 §6 | |
| M8 | Reports moderation scope | **Dismiss, mark actioned, suspend/unsuspend** (with a Clerk ban so sessions end); rename only once P10 usernames exist | P12 | P12 O12-9 | |
| M9 | Clerk reverification on admin archive, cancel-with-players and suspend | **Yes** (within 10 minutes) | P12 | P12 O12-10 | |
| M10 | Limits | **2–64 players** (256 after M13); 1–10 positions; start at least 10 min and at most 60 days ahead | P12 | P12 O12-11 | |
| M11 | "New Game" on the tournament game-over card while the arena is live | **Keep it as a text link** | P12 | P12 O12-12 | |
| M12 | Join copy before P10's push and email ship | **"We'll remind you here five minutes before the start."** until P10 is live | P12 | P12 O12-13 | |
| M13 | Raise the arena cap to 256 | **After the 256-player run passes on the 1-OCPU dev box**; otherwise keep 64 (a paid socket box is a Stage C decision) | After P12's §9.7 run | P12 O12-15 | |
| M14 | Open questions with no decision needed to start: keep more than 256 `finalStandings` rows; worker queue-health transitions in the admin feed; a public tournament archive page | **No; not now (the health card covers it); not now (the Finished tab serves it)** | — | P12 §14.6 | |

## N. P13 launch (T−21 d … T+30 d)

With the roadmap in README §6, T−21 d ≈ 2027-05-02, T−14 d ≈ 2027-05-09, T−7 d ≈ 2027-05-16, the window ≈ Sunday 2027-05-23 04:00 UTC, T+30 d ≈ 2027-06-22.

| ID | Decision | Recommended answer | Needed by | Sources | Answer |
|---|---|---|---|---|---|
| N1 | Which Clerk account holds the production instance `t0wy2xb4vvpw`, and is its application the same one as the dev instance `loving-martin-7959`? | **Assume the old account**; answer before P13 WP-A starts | Before WP-A (≈ T−28 d) | P13 Q1 | |
| N2 | Clerk path | **Path T: keep the production instance and transfer its application** to the replaychess007 workspace (no user re-keyed; Google sign-in and passwords keep working) | T−21 d | P13 OD-1, D1 | |
| N3 | Vercel Pro for the new `replay-chess` team | **Yes, before any customer is charged** (hard blocker: preflight fails while the team is on Hobby and Dodo live keys are set), with Skew Protection and a spend cap. The dev project may stay on Hobby (test mode) | T−21 d | 01 D1; 03 Q5; 05 OD-1; P5 D-16; P7 OQ11; P13 OD-2, D17 | |
| N4 | Neon plan for production | **Launch** before the window, with a spend alert, the instant-restore window set explicitly to 7 days, and scale-to-zero off once there are paying members. Check whether Launch billing applies per organisation (the dev project would become paid): accept near-zero cost or keep dev in a separate Free org | T−21 d | 01 D2; 02 O2; 05 OD-2; P13 OD-3, D16, Q6 | |
| N5 | Production analysis worker | **Its own VM `replay-chess-worker`** (A1.Flex 2 OCPU / 12 GB / 50 GB, private IP 10.42.0.30, no public ingress except SSH). Totals 4 / 24 / 150 of 4 / 24 / 200: the free pool is full. Created in P3 if ap-mumbai-1 has capacity (D4), else at T−12 d | T−12 d (or P3) | 01 D3, X1; 05 OD-3; P13 D7, OD-22 | |
| N6 | Window date and hour | **A Sunday 04:00 UTC** unless PostHog shows a quieter hour | T−14 d | P13 OD-5 | |
| N7 | Backup retention | **14 daily + 2 weekly, encrypted with `age`, nothing older than 30 days** (so "Backups clear within 30 days" is true); the P13 worker `BACKUP` job replaces P1's interim GitHub workflow | T−14 d | 01 D14; 02 O9; P10 Q12; P13 OD-6, D9 | |
| N8 | Status page and uptime provider | **UptimeRobot free** if its terms allow commercial use and a custom domain (`status.playchess.tech`); else Better Stack free or the Sentry uptime monitor | T−10 d | 01 D15; P11 Q3; P13 OD-9, Q9, Q10 | |
| N9 | Launch emails | **Every active user** (service notice), ≤ 70 a day through Resend | T−7 d | P13 OD-10, D15 | |
| N10 | Point of no return | **The first real charge on the new stack, or T+72 h**, whichever comes first | T−7 d | P13 OD-11, D12 | |
| N11 | `DEMO_PLAYER_001` | **Deactivate, do not delete** | T−7 d | P13 OD-12 | |
| N12 | Price ($4.99 / $50) given the LLM cost (typical ≈ $0.25–0.45 a member a month; caps $1.50 member, $0.40 trial) | **Keep** | T−7 d | P13 OD-15; P7 OQ4; PLAN §4.3 | |
| N13 | Final legal texts: Terms, Privacy (processors incl. Dodo, PostHog, Sentry, R2, Resend and Anthropic; retention; trial ledger; imported game data), Cookies (B11), refund policy (L4), third-party licences; legal review of Chess.com's User Agreement | **Required to launch** | T−5 d | P13 OD-16; P4 OD-2; P7 OQ7; P10 Q11; P11 Q5, Q6 | |
| N14 | Staff or comp access | **None**: staff use real subscriptions or trials | — | P13 OD-18 | |
| N15 | A banner on the old site before the move | **No**: emails and the status page are enough | T−7 d | P13 OD-19 | |
| N16 | Resend Pro for the launch month | **Yes if the user count at T−14 d exceeds 140** (two days per campaign at 70 a day); else free | T−14 d | P13 OD-20; P10 Q6 | |
| N17 | Resend domain verification for `playchess.tech` (SPF/DKIM records in the Cloudflare zone, DNS only) | **Owner action in P13** | T−10 d | P11 Q19; P13 §8.2 | |
| N18 | Third-party asset provenance | **Record origin and licence of `public/sounds/*.webm`, `public/chess-icons/*.png`, the engine files and legend portraits in `WEB/THIRD_PARTY.md` before charging** (`public/board_icons` are the owner's own) | T−21 d (preflight P18) | 01 D24; P13 §8 P18 | |
| N19 | Live Dodo subscriptions (legacy $8 vs Coaching) | **Reconcile all** at the cut-over | T−14 d | P13 Q4 | |
| N20 | Dodo retries for deliveries answered with 403 during the freeze | **Rely on the reconcile** if Dodo does not retry | T−7 d | P13 Q5 | |
| N21 | Sentry free-plan limits for cron monitors (`worker-backup`, P3's `housekeeping`, Vercel's `/api/cron/daily`) | **Keep `worker-backup` and `housekeeping`**; drop the Vercel cron monitor if needed | T−14 d | P13 Q7 | |
| N22 | Edge Config read quotas on Pro | **Assume ample** with P11's adaptive memo; verify (§Q) | T−21 d | P13 Q8 | |

## O. After launch, or when triggered

| ID | Decision | Recommended answer | When | Sources | Answer |
|---|---|---|---|---|---|
| O1 | Stage C: paid capacity beyond the Always Free pool | **Decide at the time; free mitigations first** (lower the P4 budgets, turn `analysis-live-prewarm` off, pause backlog slices at peak, cap arenas at 64). Paid options ≈ $14 a month per 1 OCPU / 6 GB on PAYG; nothing on Oracle costs money without this yes | When a P13 §14.4 trigger fires (watched by `ops-weekly.yml`) | 01 D3; P13 OD-24, §14.4 | |
| O2 | Region strategy if most members are in South Asia (Neon Singapore + Vercel `sin1`) | **Decide from 30 days of geo data** | Launch + 30 d | 05 OD-4, §12 | |
| O3 | Personalised legend-compare narration | **Later** (no owner phase); P3's `no_explanation` copy stays | Post-launch | 07 §6, C-04; P7 D25(c); P8 D8-20 | |
| O4 | A template-only "coach note" for plain BOT games | **Revisit after launch** | Post-launch | P7 OQ14 | |
| O5 | Rating and ladder calibration | **After 4 weeks of data**: human check of the bot ladder; recalibrate the Lichess → Replay offsets; revisit the Chess.com → Lichess baseline offset | Launch + 4 weeks | P9 D8, D23; P6 D-P6-5 | |
| O6 | Chess.com ownership verification | **Build the profile-location check only if squatting shows up** | When triggered | P4 OD-4 | |
| O7 | "Tell me when one opens" | **Revisit** (K17) | Post-launch | P12 O12-14 | |
| O8 | Transfer the domain to Cloudflare Registrar | **Optional, after T+30 d** | After T+30 d | P13 OD-23 | |
| O9 | Ship the phases left out by an Early or Launch A variant | **Each carries its own production rollout** (child-branch rehearsal, `migrate deploy`, flags to admins first, legacy routes deleted a release later) | After launch | P12 §14.5; P9 §0; P13 D20 | |

## P. Destructive or irreversible steps (confirm each one when it runs)

Each step needs the owner's explicit yes at the time, after the question "This command may reset/drop your database. Are you sure?", and a fresh dump first (CLAUDE.md rule 5).

| ID | Step | When | Precondition | Sources |
|---|---|---|---|---|
| P1 | Delete the old Neon `dev` branch after the dev project split (A4) | ≥ 14 days after H10 | Row counts and `prisma migrate status` verified on the new project | P1 R19, §14.3 |
| P2 | Contract C3/C3v: account deletion anonymises shared games (foreign-key change) | Dev: P10 task 0.2. Production: inside the launch `migrate deploy` (window step 6) | P10's deletion flow and tests | P10 Q7, §6.7; P13 OD-14 |
| P3 | Data-only restore of the old production database into the new `production` branch, then `prisma migrate deploy` M1 … M13 | P13 window steps 4–7 | Rehearsals 0–2 passed; snapshot `prelaunch-empty` taken; `target-check.sql` shows 17 migrations and zero rows | P13 §8.3, D5, D8 |
| P4 | Any one-off data fix during the launch backfills | P13 window step 9 | A reviewed SQL statement | P13 §8.3 |
| P5 | Production backfills with `--apply` (P8's B3/B4/B11/B12, J7/J8 and the rest of `backfill-all.ts`) | P13 window | Dry run printed and checked | P8 §14.4; P13 §6.5 |
| P6 | C1: drop the 14 duplicate and the low-value indexes; strip `gameData.moveHistory` / `traceContext` | T+30 d | B1 verified; every reader on typed columns for 30 days | 02 §5.11; P13 §6.6 |
| P7 | C2: drop `matchmaking_queue` and `MatchmakingStatus`; remove `/api/matchmaking/*` | One release after `play-hub-v3` is at 100 % in production | `max("createdAt")` older than 7 days | P9 D19, §6.7; P13 §6.6 |
| P8 | C4: drop `user_stats` and `chess_com_profiles` | P13 + 1 release | Stats read `game_players`, links read `linked_accounts` | 02 §5.11; P13 §6.6 |
| P9 | C5: drop `chess_positions.explanation` and `openings.explanation` | P13 + 1 release | B4's byte-for-byte R2 copy check passed on production | 02 §5.11; P8 §14.4; P13 §6.6 |
| P10 | C12: `tournaments.slug SET NOT NULL`; drop `isSearching`, `searchingSince` | P13 + 1 release | Every tournament has a slug | P12 §6.7; P13 §6.6 |
| P11 | C6 and C7: drop `games."gameData"`, the two time-remaining columns, `games.result`, `winnerId`, `GameResult`, `users."dateOfBirth"`, `tournament_participants.points` | Later | No reader left | 02 §5.11; K21 |
| P12 | P8's slug redirects become permanent 308s in production | At the production cut-over (307 on dev until then) | URL parity check | 01 §4.7 rule 4; P8 §14.4 |
| P13 | Retire the old stack: old Neon project `shy-morning-50748774`, old Vercel project, AWS EC2, old Clerk dev instance if any | T+30 d, each confirmed separately | Point of no return passed; final legacy dump in R2 | P13 OD-17 |

## Q. Facts to verify before relying on them

| ID | Check | How | Needed by | Sources |
|---|---|---|---|---|
| Q1 | The `cpu.idle` slice works on the OCI Ubuntu 24.04 kernel with Docker `cgroup_parent` | Create `worker-idle.slice` with `CPUWeight=idle` on the dev box, run the worker, k6 with a backfill, watch loop-lag p99 | P3 C1 | 01 V1 |
| Q2 | Vercel Authentication covers the dev project's production alias on Hobby, and the automation bypass works for webhooks | Dashboard plus `curl` with and without the bypass header | P1 day 11 (B5) | 01 V2; P1 R14 |
| Q3 | Clerk restricted sign-up on the dev instance's plan, and the dev instance's user cap (24 personas + throwaway users) | Clerk dashboard | P1 | 01 V3; P1 R21 |
| Q4 | Sentry metrics API and free quota (SDK v10); cron-monitor limits | Sentry docs; one test metric from dev | P3 (metrics), T−14 d (monitors) | 01 V4; P13 Q7 |
| Q5 | UptimeRobot free plan: commercial use and a custom-domain status page | Their terms page | P1 (monitors), T−10 d (status page) | 01 V5; P13 Q9, Q10 |
| Q6 | R2 token permission types; bucket lock for `replay-backups` | Cloudflare dashboard | P1 (backups), T−21 d | 01 V6; P13 Q12 |
| Q7 | Current OCI A1 PAYG price | OCI price list | When O1 is considered | 01 V7 |
| Q8 | scalachess licence before porting `Divider` | `LICENSE` in the scalachess repo | P3 | 01 V8 |
| Q9 | `pgn` storage size after TOAST on real PGNs | 02 §10.1 method with real CC0 games | P2 WP-A | 01 V9; P2 §14.3 |
| Q10 | Prisma migration transactions with `ALTER TYPE … ADD VALUE` on PG 17 | Docker PG 17 test in CI | P3 (M3) | 01 V10 |
| Q11 | GitHub `ubuntu-24.04-arm` availability and minutes if the repo becomes private | GitHub billing docs | A9 | 01 V11 |
| Q12 | Dodo fees on a $4.99 charge | Dodo pricing page or dashboard | Before N12 | 01 V12 |
| Q13 | Speed Insights pricing on Pro | Vercel pricing page | T−21 d | 01 V13 |
| Q14 | Vercel CDN requests and fast data transfer for one night of the deployed smoke run | Vercel usage API before and after | P1 | 01 V14 |
| Q15 | The `functions` path-key format for App Router routes in `vercel.json` (`supportsCancellation` on the coach) | Deploy to dev, abort a stream, check the row | P7 | 01 V15 |
| Q16 | Stockfish 18 NNUE nodes per second on one A1 core | `stockfish bench` + the fixture game on the dev box | P3 C1 (freezes the engine budget) | 05 §12; 01 CR-34 |
| Q17 | Exact Vercel Hobby allowances, and whether edge requests count cached static assets | Usage tab after a week of dev traffic; Vercel limits page | P1 (`ops-weekly.yml`) | 05 §12 |
| Q18 | Fluid compute on `replay-chess-dev`, and which `vercel.json` it reads | Project settings; `vercel inspect` | P1 | 05 §12 |
| Q19 | How Vercel treats `s-maxage` vs `Vercel-CDN-Cache-Control` from route handlers | `x-vercel-cache` checks on dev (P1 owner test T20) | P1 | 05 §12 |
| Q20 | Real coach first-token time on Sonnet 5.5 at effort `low` with a cached prefix | `coach-real.ts` (≤ $1) | P7 | 05 §12 |
| Q21 | Live production row counts, JSON sizes, migration level and drift of the old database | Probe with a read-only role (owner approval) | T−14 d | 05 §12; P13 Q3 |
| Q22 | User geography | Speed Insights and PostHog | Launch + 30 d (O2) | 05 §12 |
| Q23 | Prisma Rust-free client cold start and warm latency on Vercel | A/B on the dev project | P1/P2 | 05 §12 (OPT-41) |
| Q24 | The anonymous Lichess export streams at ≈ 20 games/s; `/api/account` works with an empty-scope token that is revoked right after | One OAuth on dev with the owner's Lichess account; time a 1,000-game export | P4 day 1–2 | P4 V-1 |
| Q25 | How private or unlisted Chess.com games appear in archives | Inspect the owner's archives | P4 day 1–2 | P4 V-2 |
| Q26 | `%clk` presence in Chess.com archive PGNs | The recorded fixture | P4 day 1–2 | P4 V-3 |
| Q27 | Dodo test-mode events for a trial checkout, a declined card on a $0 authorisation, and the first charge | One test checkout each (Dodo dashboard in Claude in Chrome); renewal simulation | P4 day 1–2 | P4 V-4 |
| Q28 | `unstable_cache` caches the discriminated `not_found` result on Vercel | Contract test plus two lookups on dev | P4 day 1–2 | P4 V-5 |
| Q29 | Middleware can set `rc_onb_next` on redirects and on `next()` under `clerkMiddleware` | One dev request; unit test | P4 day 1–2 | P4 V-6 |
| Q30 | The P4 preconditions (M2/M3 columns) | `DB/scripts/check-p4-preconditions.ts` on a fresh local `migrate deploy` | P4 day 1 | P4 V-7 |
| Q31 | Edge Config read quotas on Pro | Vercel docs | T−21 d | P13 Q8 |
| Q32 | Whether Neon Launch billing applies per organisation | Neon billing docs | T−21 d (N4) | P13 Q6 |
| Q33 | Whether Dodo retries deliveries answered with 403, and on what schedule | Dodo docs / test | T−7 d (N20) | P13 Q5 |
| Q34 | Dodo's grace semantics for `on_hold` and past-due subscriptions | Test mode | P10 (B10) | P1 Q-12; P10 Q16 |

## R. Conflicts between the documents, and the ruling to apply

Found while assembling this folder. The ruling follows the precedence in [README.md](README.md) §2.3; rows marked **open** need the owner.

| ID | Conflict | Ruling |
|---|---|---|
| R1 | Total effort: [01-architecture.md](01-architecture.md) §6.2 says the phase specs total ≈ 255.5 dev-days and Launch A ≈ 162; the phase files' §13 add up to **283** (Launch A ≈ **183**) | Use the phase §13 numbers ([README.md](README.md) §5) |
| R2 | CLAUDE.md rule 1, [allocation.md](allocation.md) §1.3 and 05 OD-6 allow `prisma db push` (on prod or on dev "while iterating"); CR-35, 02, P1, P2, P4, P5, P11 and P13 forbid it on every Neon branch | CR-35 applies until the owner rewords rule 1 (**open: A3**) |
| R3 | Coach caps: 03 §11 Q4 says 30 a day + 300 a month; P11 Q11 says "P7 D6's 300/month must change"; PLAN §4.5 says 200 a day; CR-33 and P7 D6 now say 150 a month | CR-33 (H1); the 03 §11 row and the P11 note are stale |
| R4 | 03 §11 Q10 says live-game persistence goes through internal web routes; B4, CR-17 and 03 §0 (revision 2) say the socket writes Neon directly | CR-17; the 03 §11 row is stale. Likewise 03 §11 Q1 names a `LAPSED_READ` env, where CR-29 and P3 use the flag `review-lapsed-read` |
| R5 | Internal HMAC wire format: P3's code sketch uses `x-rc-caller`, per-caller keys derived from one root and an `INTERNAL_TOKEN_COMPAT` switch; CR-16 and P2 use `x-rc-kid` with a key set in `INTERNAL_API_SECRET` (kids `web`, `wk`, `ops`, `ws`); P13 names the callers `worker` and `socket` | CR-16 and P2's format (P13 hand-off H13-6): P3's caller names become kids (`worker` → `wk`, `socket` → `ws`); fresh separate keys at P13 |
| R6 | Anonymous Sentry performance metrics without consent: P3-Q17 and P5 D-22 default yes, P7 OQ15 "server sources only", P11 Q21 default no | One decision (**open: B11**; recommended yes) |
| R7 | Analysis caps: P4 OD-1 and P13 D14 say eager 50 per member and 20 per trialist (200 unopened per member); P6 D-P6-3 says "inside P4's eager cap (200 / 40)" and assumes a trialist cap of 40 | P4's numbers (it ships first); P6's "40" should read 20 (G3) |
| R8 | "Tell me when one opens": P10 Q22 defaults to adding a "New tournaments" notification row; P12 O12-14, D12-19 and 07 §6 say not built | One decision (**open: K17**; recommended not built at launch) |
| R9 | Spectating: 01 D8 (public games only), 03 Q2 (friend games private), P2 Q3/Q8 (any live human game by URL, delay for friend games too), P9 D16 (P2's rule) | One decision (**open: C2**; recommended P2's rule now, P10's privacy predicate later) |
| R10 | Glicko preset names: CR-28 says `TRAINING` (P5) and `PLAY` (P9); P5 says `PUZZLE`, P9 and P12 say `GAME` | Precedence makes CR-28 binding; P5, P9 and P12 use `TRAINING` and `PLAY` when they are built (or 01 §0.3 is amended in the P5 PR) |
| R11 | Backup retention: P10 Q12 quotes "data-model 14 daily + 8 weekly" and the allocation 8 weekly; 01 D14, 02 O9 and P13 OD-6 say 14 daily + 2 weekly | 14 daily + 2 weekly (N7) |
| R12 | Interim backup workflow name: P1 (T24, DoD) `backup-live.yml`; 01 §6.2, Appendix B and 06 §2 `backup-prod.yml` | P1 owns the file: `backup-live.yml` (it backs up the live old project); rename the references in 01 and 06 when P1 lands |
| R13 | Contract step C3: 02 §5.11 says "C3 (merged into M9)"; P10 §6.7 defines C3 (deletion anonymises shared games) and P13 runs C3/C3v at launch | P10's C3 (a phase spec is authoritative for its own migrations); the 02 row is stale |
| R14 | 01 X13 moves every runtime to Node 24 before P5 so ts-fsrs v6 can run; P5 D-7 ships ts-fsrs v5 | Not blocking: P1 still moves to Node 24; P5 uses v5 (F7) |
| R15 | CLAUDE.md names the `dev` branch of `withered-cake-82837167` as the dev and E2E database; P1 H10 moves dev and E2E to a new Free project `replay-chess-dev` | The plan (A4); the owner updates CLAUDE.md after H10 |
| R16 | P2's hand-off H-04 says P7 adds the bot-zone coach card; P7 D25(d) and 07 C-09 drop it for plain BOT games | Dropped (H11); P2's row should read "dropped" |
| R17 | DS README: "Game over is a centred card on the final board"; the v3 boards put the result card in the panel | The boards (C17) |
| R18 | Phase numbering: [docs/implementation-plan.md](../implementation-plan.md) has Phases 0–10 and ≈ 13 weeks; this plan has P1–P13. [phase-01a-spec.md](phase-01a-spec.md) still says "Phase 9" for the offline page, settings and Clerk deletion | This plan; crosswalk in 01 §6.1 (old 8 → P8 + P9 + P12, old 9 → P10 + P11, old 10 → every phase's DoD + P13) |
| R19 | [allocation.md](allocation.md) still shows shapes that 01 §0.3 later changed: B5's index without `fairSeq` (CR-08), B6's `KeyMoment` table (CR-06), B19's single `keys.ts` (P1-07 directory), B20's `{room, event, data}` body with `x-internal-token` (CR-15, CR-16), §1.5's dev split "before P13" (P1 H10) | 01 §0.3 (stated in the banner of the copied allocation.md) |
| R20 | P12:774 says P8 filters on `status`; P8 says the archive must set `"isActive" = false` together with `status = 'ARCHIVED'` | P8's rule (both columns) |
| R21 | Every plan file cites scratch inputs under `SP/` (inventories, audits, critiques, the design canvas, Phase 1 research reports) that live in `/private/tmp`; only allocation.md and SPEC.md were copied into the repo | **Open: A12** |
| R22 | Board count: the planning brief's INDEX lists 360 boards; 07 §1 counts 361 rows (314 v3 + 46 v1/v2 + 1 off-canvas draft) | Not resolved; no effect on scope (all 314 v3 boards are assigned) |
| R23 | PLAN §1.5 sends the trial reminder from a daily Vercel cron (`/api/cron/trial-reminders`); 01 X10 uses a future-dated `NOTIFY_DISPATCH` job at `trialEndsAt − 48 h` with the daily cron as backstop | 01 X10 (K19) |
