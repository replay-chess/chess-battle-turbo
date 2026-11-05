# Phase 8 detailed plan: Learn (legends, legend practice, openings, lessons)

Status: plan, revision 2, 2026-11-02. Written against branch `dev` at `0848b76` (Phase 0 done).

**Revision 2** applies every finding about P8 in the five critiques (`PLAN/critique-{coverage,consistency,feasibility,testing,api-perf}.md`) and re-aligns P8 with the phase docs that were revised before it (P2 rev 2, P4 rev 2, P5 final). The largest changes:

- P8 splits into **P8a** (catalogues, SEO, legend practice; starts after P3) and **P8b** (lessons, the opening deck, every lights-up slot; starts after P5). That is consistency R-19.
- Public pages no longer revalidate on a timer. Every public read comes from a small set of cached **catalogue volumes**, so crawlers can never wake Neon.
- Every lesson slot that earlier phases hand to P8 is now specified. That covers the Train hub row, plan step 3, the session-summary card (flow edge E60), the bank's caught-up card and P6's `resolveLessonForPattern` (coverage C-05, C-06, C-07).
- Names are aligned with the consistency rulings: `rematchOfId`, `endMethod`, `rc-outbox`, `qk.review.status`, `engine_init`, `subscription_required`, `INTERNAL_API_SECRET`, the six cache tiers and `JOB_PRIORITY`.
- Popularity comes from the Lichess CC0 dump, because the explorer now needs OAuth.
- Legend portraits move to R2 with a licence record, and there is a policy for living players.
- Redirects are 307 on dev and 308 only in production.
- The spoiler check is now an automated spec. The phase adds visual baselines, telemetry assertions through the sink, leased personas and server-time control.

**Appendix A** lists every finding and what happened to it (applied, or rejected with a one-line reason).

**Budget.** About 25.5 dev-days (P8a 17.0, P8b 8.5; §13.3), against 24 in allocation §0. The phase also carries a recommended 20 % buffer line (an owner decision, feasibility §8). The content track (WP-C, about 7 days) goes into the **owner calendar**, not the dev-day count.

**Path shorthands** (same as `allocation.md`, with consistency R-10):

| Short | Path |
|---|---|
| `REPO` | `/Users/rohitpandit/open_source/chess-battle-turbo` |
| `WEB` | `REPO/apps/web` |
| `WS` | `REPO/apps/web-socket` |
| `WK` | `REPO/apps/analysis-worker` |
| `PKG` | `REPO/packages` |
| `DB` | `PKG/db` (Prisma schema and migrations since P2) |
| `CT` | `PKG/contracts/src` (imported as `@repo/contracts/http/<file>`) |
| `GC` | `PKG/game-core/src` |
| `TRN` | `PKG/chess-training/src` |
| `SP` | the planning session's scratchpad, archived scratch inputs that are not in the repo and may no longer exist (see [99-open-decisions.md](99-open-decisions.md) A12) |
| `DR` | `SP/design-ref/project/v2` (board files `*.dc.html`) |
| `PLAN` | `SP/plan` (`allocation`, `architecture`, `data-model`, `api-design`, `client-data-layer`, `optimization`, the phase specs and the critiques); P5 final is `REPO/docs/plan/phase-05-mistake-bank-puzzles-train-and-home.md` |
| inventories | `PLAN/inv-play-b.md` (legend practice, F2–F5), `PLAN/inv-rct-b.md` (Learn, L1–L9), `PLAN/inv-pub.md` (public catalogues, §1.3, §1.10, §2.2–2.3, §2.29–2.33) |

**Cross-references.**
- "play-b F4" and "rct-b Q11" point into those inventories.
- `C-xx` = critique-coverage, `R-xx` / `8.x` = critique-consistency, `F-xxx` / `LIC-x` / `SEC-x` = critique-feasibility, `Xn` = critique-testing, `AP-xx` = critique-api-perf.
- "P2:1648" means line 1648 of `PLAN/phase-02.md` as it stands today.
- Endpoint ids (`CAT-*`, `LRN-*`, `PLAY-*`, `ADM-*`) are the ones in `api-design.md` §4.11 (`api-design.md:952-959`). §7.0 maps the inventories' older ids.

---

## 0. Decisions this plan makes (read first)

The inputs disagree in a few places. These choices bind every work package below, and each one names what it supersedes.

| # | Decision | Supersedes / reconciles | Why |
|---|---|---|---|
| D8-1 | **Public catalogue pages leave P1's dual-chrome `(app)` group.** They move to `WEB/app/(marketing)/(learn)/…` as static pages with the marketing header (`MarketingTopNav`, the component P11 owns and extends, P11:77, P11:197) and the Learn sub-nav. P8 builds the first version of `WEB/components/marketing/TopNav.tsx`. Signed-in visitors see P11's `AuthHint` island: "Play" + avatar, as on every v3pub board except `V3TryCatalogue`, which says "Home". Member-only Learn surfaces (`/play/legend/*`, `/game/*`, `/learn/lessons/*`) stay in the app shell. | P1 SPEC D1, which puts `legends` and `openings` inside `(app)` with a session-reading layout and so makes them dynamic | An `(app)` layout that reads the session turns every catalogue hit into a function invocation and a Neon read (DB-15). One header component, one owner (P11), no rename later. |
| D8-2 | **One legend-practice set, stored on `ChessPosition`** (`practiceOrder`, `availableFrom`). There are no `PositionCollection` tables. The `collection=` parameter of `CAT-5` is virtual: `legend-practice`, `featured`, `legend:<slug>`. | allocation M8 "`PositionCollection` + item", play-b R8 | data-model §1 ("there is one collection"); consistency R-02 row "Legend practice set" |
| D8-3 | **Lessons are `Lesson` + `LessonStep` rows.** The `LessonPayload` (about 6 KB) is assembled by a cached loader. | allocation/rct-b JSON `plies/checkpoints/narration` | data-model D12 |
| D8-4 | **`LessonProgress` idempotency uses `runId` + `lastSeq`.** `eventId = "<runId>:<seq>"`. | allocation "processed `eventIds`" | O(1) storage; tolerates outbox replays and out-of-order beacons |
| D8-5 | **Slugs become canonical** for legends (`paul-morphy`), positions (`kasparov-topalov-1999`, `opera-game`) and openings (`italian-game`), with redirects from the cuid URLs and the sitemaps switched in the same release. **Redirects are 307 on dev and test, and 308 only when `APP_ENV=production`** (`lib/seo/redirect.ts`). | B25 (binding), rct-b Q12 | B25. A 308 is cached by browsers and crawlers for good, so it ships only with the production cut-over in P13 (feasibility §9, P8 row). |
| D8-6 | **Every catalogue read comes from cached volumes** (§8.10): `legendsVolume`, `positionsVolume`, `openingsVolume(letter)` × 5, `openingSlugIndex`, `lessonsIndex`. Pages, `CAT-*` routes and searches pick from them in memory. Opening search is an in-memory filter over the volumes (CAT-3 `?q=`). **There is no SQL search and no `pg_trgm`.** | rev 1 D8-6 (server-side `ILIKE` per query); api-design CAT-3 trigram; architecture §1.12 `pg_trgm` | Nine statements rebuild the whole public catalogue. After that, no page view, search or crawler hit queries Neon until content changes (§9.6). optimization §4.3.1 already proposed the in-memory filter. |
| D8-7 | **Explanations move to R2** (`explanationUrl`, `hasExplanation`; backfill B4; a global Prisma `omit` of the JSON columns). The columns use `ADD COLUMN IF NOT EXISTS` because P3's M3 creates them (data-model:2385). | — | optimization OPT-59; data-model D20 |
| D8-8 | **Legend practice game rules.** <br>• A 30 s study phase on the first game of a series, entered from the catalogue, the detail page, a legend page, Home or onboarding. No study on rematch, restart or next. <br>• No first-move abort against the bot. <br>• Clocks pause while the tab is hidden. <br>• Hint and Takeback are opt-in assists, recorded in `Game.meta.assists`. <br>• **Restart** (the board's in-game button and the result card) aborts an `IN_PROGRESS` parent whatever its ply count; this extends P2's "aborted if < 2 plies" (P2:1410) for `LEGEND_BOT` only. A finished parent stays finished. <br>• P2's local runner gains the study phase (one hook, §13.2). | play-b Q4/Q5/Q14; P2 §7.1.1 restart rule (P2:1410); P2's local runner has no study (P2:721) | Every designed state is reachable from real data (`V3TryGame` `study`, Home → `V3StudyPhase`), while rematches stay fast. A practice game is unrated, so restarting is not an escape from a result. The owner confirms (OD-5). |
| D8-9 | **Bot strength for legend games**, first source that exists wins: P9's `UserSettings.prefs.play.botStrength` → P2's `defaultBotElo(viewer, timeClass)` (displayed rating, rounded to 100) → P4's `initialRating` / `ratingBand` → **1400**, the design's figure. The level can be changed in ⋯ before the first move and is stored on `Game.botElo` (400–2200, steps of 100, P2:1407). **Ladder calibration is P9's** (P2 H-06, P2:187). Until it lands, the chip keeps P2's "≈1400 · strength not yet calibrated" tooltip. | rev 1 D8-9 (`UserSettings.botStrength`); coverage C-15 | P2 rev 2 moved calibration next to bot-strength persistence (P2:187). |
| D8-10 | **Opening drill → `OPENING` card.** A clean first run is graded `GOOD`; a hint or a wrong move is graded `HARD`. A card is never created as `AGAIN`, which would bring it back in 10 minutes. The card key is `itemKey = 'o_' + sqid(openingId)` on P5's `(userId, itemKey)` unique. Due opening cards are drilled from a Train-hub row through a new session kind (`SessionKind.OPENINGS`, wire `"openings"`) in P5's runner. They never count toward the bank cap. | rct-b Q19 | P5 `TrainingCard` has `@@unique([userId, itemKey])` and no `(userId, deck, openingId)` unique. The owner confirms (OD-8). |
| D8-11 | **"Next lesson" order.** `?from=legend` follows `legendOrder` within that legend. Every other entry (`guide`, `train`, `plan`, `home`, `summary`, `bank`, `weakness`) follows `pathOrder`. | rct-b Q11 | `V3LessonComplete` shows both a legend counter and a cross-legend next lesson. |
| D8-12 | **`/position/[referenceId]` and `GET /api/position/[referenceId]` are deleted.** Every active position gets a slug, and the old URL redirects (D8-5) to `/legends/positions/<slug>`. | allocation P9 "the last redirects" | The new detail page covers every position. |
| D8-13 | **No new socket events, SSE streams, webhooks, cron entries, jobs or timers.** <br>• Practice games reuse P3's `analysis:*` and `compare:ready` events. <br>• `LEGEND_BOT` games are analysed by P3's `ANALYZE_GAME` at `JOB_PRIORITY.GAME_ENDED` (consistency R-05; rev 1 said "priority 0", which is housekeeping). <br>• Lessons and drills are plain HTTP through the `rc-outbox`. <br>• Content scripts revalidate through `POST /api/internal/revalidate`. | — | Keeps P8 off the socket box and off the Neon wake budget (AP-08, F-NEON-2). |
| D8-14 | **Lesson content ships whole to the client**, including the legend's moves. Stars are self-assessed and unranked. Legend *practice* keeps the spoiler rule: `legendMoveUci/San` never leaves the server before the game ends (§11, `learn-spoiler.spec.ts`). | — | Simplest correct model |
| D8-15 | **Legend visibility rule:** `isActive AND isVisible AND (positionsCount ≥ LEGEND_MIN_POSITIONS OR lessonsCount ≥ 1)`. `LEGEND_MIN_POSITIONS` defaults to 8 in production and 1 on dev. | rct-b Q2 | The dev seed has 6 legends and 7 positions. The owner confirms (OD-1). |
| D8-16 | **The phase splits** into P8a and P8b. <br>• **P8a** (WP-0…6, WP-10a) needs P2 and P3 only. It ships the catalogues, SEO, legend practice, the lesson *build pipeline* (lessons stay unpublished) and the J8/B12 content jobs. <br>• **P8b** (WP-7…9, WP-10b) needs P5, and P6 for C-07. It ships the lesson player, the opening deck and every lights-up slot. <br>• The migrations split the same way: M8 in P8a, M8b (`SessionKind.OPENINGS`) in P8b, because `SessionKind` is created by P5's M5. | rev 1 header "P1–P7 assumed shipped"; allocation §0 calendar | consistency R-19 ruling 1. P8a fits the calendar slot after P3; P8b waits for P5's runner, cards, outbox and hub. |
| D8-17 | **No time-based revalidation on public pages.** Every public page sets `export const revalidate = false` and `dynamicParams = true`. Pages are regenerated only by tag (`revalidateTag` from admin writes and `INT-R`). Practice positions with a future `availableFrom` are in the HTML, and the island reveals them at that time (§8.3). | rev 1 `revalidate = 86400` / `604800` | Time-based regeneration of about 3,800 crawlable URLs, spread over the day, could keep Neon awake for hours. That is the site-down risk on Free (feasibility §2.2, AP-01). |
| D8-18 | **Portraits and living players** (LIC-6). <br>• A portrait is shown only when it is public domain or CC-licensed with attribution. It is stored pre-sized on R2 (`media.playchess.tech/legends/<slug>/portrait-<hash>-{96,256}.webp`) and rendered `unoptimized`, so it costs no Vercel image transformation (F-VER-4). <br>• Otherwise the page shows initials. <br>• `Legend.portraitSource`, `portraitLicence` and `portraitCredit` record provenance. <br>• For a living legend (`deathYear IS NULL`) the CTA reads "Play This Position", never "Play as Kasparov", and the copy is factual with no quotes and no endorsement. | rev 1 §11 ("keep today's `profilePhotoUrl` sources") | Licence and right-of-publicity exposure on a paid product. The owner decides on consent for living players (OD-12). |
| D8-19 | **Opening popularity comes from the Lichess CC0 monthly dump** (J8, `--stdin`, offline). The owner's scope-less personal token against `https://explorer.lichess.org` is only the fallback. | rev 1 J8 anonymous explorer calls | The explorer requires OAuth (`security: OAuth2`, feasibility F-API-2). The dump is deterministic and CC0. |
| D8-20 | **P8 builds no coach surface.** <br>• The `V3LegendCompare` **Ask** action (→ `/review/[ref]/coach?ply=<ply>&from=compare`) belongs to P7, as the coverage critique proposes in its C-04 fix. <br>• Personalised compare narration (the `legend_comparisons` NarrationV1 column, P3:817) is recorded as **later**: until then P3 shows its static narration, and the `no_explanation` copy applies. <br>• The POSITION, LESSON and MISTAKE coach thread kinds stay unbuilt. No P8 board has a coach entry (checked: `V3LessonPlayer`, `V3LessonGuess`, `V3TryGame*` and `V3LegendGame*` contain no Ask control). <br>• The only coach-like UI is the authored `CoachLine` blurb in `LEGEND_BOT` games (P2 H-04: P7 owns the card for `BOT` games). | P7:107 ("go to P8") and rev 1 P8:106 ("narration text: P7"), which point at each other | Breaks the circular hand-off (C-04). §14.4 asks P7 to replace its line 107. |
| D8-21 | **Visitor detection needs no clerk-js on public pages.** <br>• `useVisitor()` reads the client hint that P11's `AuthHint` uses: `__client_uat` plus the unverified `md` claim decoded from the `__session` cookie, through `lib/auth/client-hint.ts`. If a `ClerkProvider` is mounted, it uses `useAuth()` instead. <br>• The member-progress island fetches `LRN-1` with the session cookie. If the cookie's `exp` has passed, it first lazy-loads headless `@clerk/clerk-js` to get a fresh token (members only, after idle). | rev 1 `useAuth().sessionClaims.md` | P11 D2 removes `ClerkProvider` from signed-out marketing pages, about 90 KB (P11:26). |

---

## 1. Goal and user-visible outcome

### 1.1 Goal

Turn the existing "replay legendary positions" pages into the Learn area of the coaching app.

1. **Public SEO catalogues**, served from the CDN, with no Neon query after the first build of each content version:
   - legends: `/legends`, `/legends/[slug]`;
   - legend positions: `/legends/positions`, `/legends/positions/[slug]`;
   - openings: `/openings`, `/openings/eco/[letter]`, `/openings/[slug]`;
   - two guides, `/learn/legends` and `/learn/openings`, plus `/learn/openings/drill/[slug]`.
2. **Members-only legend practice.** Play a legend's position against the engine from the catalogue, the position page or the legend page, with the legend's real move as the hidden target.
   - The game is saved and graded by the P3 worker.
   - It is compared with the legend (P3 compare), and its mistakes go to the Mistake Bank (P5).
   - Rematch swaps colours, Restart replays, Next position cycles through the set, and a reload resumes.
3. **Members-only legend lessons** (P8b). Watch a famous game narrated move by move, guess the legend's move at three checkpoints, earn 1–3 stars and resume where you stopped. Lessons are reachable from:
   - the legend page;
   - the guide;
   - Train (hub row and plan step 3);
   - the session summary;
   - the caught-up bank;
   - the Weakness Profile.
4. **The opening line drill.** Play one side of an opening from memory against automatic replies. Members get an `OPENING` review card (P8b) that comes back through the Train hub.

### 1.2 What the owner can test on dev at the end

Test with ego-browser on `https://replay-chess-dev-replaychess007-1069.vercel.app`, plus a real iPhone and a real Android phone. Steps 1–8 work at the end of P8a; steps 9–14 at the end of P8b.

**Signed out (incognito):**

1. These pages all render with the marketing header and the Learn sub-nav: `/legends`, `/legends/paul-morphy`, `/legends/positions`, `/legends/positions/kasparov-topalov-1999`, `/openings`, `/openings/eco/c`, `/openings/italian-game`, `/learn/legends`, `/learn/openings`.
   - A second request shows `x-vercel-cache: HIT`.
   - The Neon dev branch's query log shows no query for those hits, and none for a cold on-demand page such as `/openings/kings-gambit-accepted-bishops-gambit` once the volumes are warm (§9.6).
2. Redirects. On dev these answer **307**; the production build answers 308 (D8-5):
   - `/try` and `/try/anything` → `/legends/positions`;
   - `/legends/<old cuid>` → `/legends/paul-morphy`;
   - `/openings/<old cuid>` → `/openings/<slug>`;
   - `/openings?eco=C` → `/openings/eco/c`;
   - `/position/<old cuid>` → `/legends/positions/<slug>`.
3. Every Play button says "Start 7-day Free Trial" and leads to sign-up with a `redirect_url` back to `/play/legend/<slug>`. On a living legend's page (Kasparov) the CTA reads "Play This Position" (D8-18).
4. The Italian drill on `/learn/openings` works signed out. At the end it says "Start your free trial to get this line back tomorrow."

**As a leased member persona** (`learn-fresh`, §12.3):

5. Legend practice from the catalogue:
   - `/legends/positions` → Kasparov vs Topalov → Play vs Bot → `/game/<ref>` shows the 30 s study phase ("Study the position", arrows by right-drag), then the first move.
   - Play 24.Rxd4, then resign. The result card says "You found 24.Rxd4, the move Kasparov played."
   - Open the Full Review → `/review/<ref>` analysing → summary. Compare with Kasparov → `/review/<ref>/legend`.
6. Back on the result card:
   - Rematch · as Black: the header says "game 2", colours are swapped, there is no study.
   - Restart, pressed mid-game: same colour, the interrupted game is aborted and never shows in `/games`. Pressed on the result card, the finished game stays in `/games`.
   - Next position cycles KT → BF → AK → TS → Opera Game → KT.
7. Reload mid-game: the same position, clocks and move list come back.
8. `/legends/paul-morphy` → Positions to play → Opera Game, move 10 → the bot game from move 10, with the nav on Learn › Legends and "Back to Morphy" on the result card.

**After P8b, same persona:**

9. The lesson:
   - `/legends/paul-morphy` → Famous games → Opera Game → lesson → Play Lesson (autoplay). It stops at 13.Rxd7.
   - Use Hint once at 16.Qb8+, find 17.Rd8#, Finish Lesson.
   - "Lesson complete", 2 of 3 stars, "You found 2 of Morphy's 3 moves on the first try and used one hint on 16.Qb8+."
   - The legend page island now reads "Lessons with Morphy · 1 of N", where N is the number of published Morphy lessons on dev (1 from the seed, 5 once the WP-C content passes review, §6.6).
10. Leave a lesson at move 12 and reopen it: it resumes at move 12. A replay for 3 stars keeps "Best: 3 stars" if the replay scores fewer.
11. The opening stepper and drill:
    - `/openings/italian-game` stepper: Next, Previous, Play the Line (auto-step 900 ms), Home/End keys.
    - Drill the Line → play 1.e4 2.Nf3 3.Bc4 4.c3 5.d4 with one deliberate wrong move (it slides back) → "Line complete" with "In your review queue · Fri 08:00" (the real date).
    - `/train` shows "Opening lines · 0 due".
    - To see "1 due" and drill it in the runner, use the persona `learn-opening-due`, or set the server clock with `x-rc-now` through the time fixture (§12.3).
12. `/train`:
    - the "Legend lessons · Morphy 1 of N" row;
    - on a day with no lesson done, plan step 3 "Legend lesson: …";
    - Home's "Play the Opera Game" opens `/play/legend/opera-game` with the study phase;
    - ⌘K "morphy" lists Paul Morphy and opens `/legends/paul-morphy`.
13. Finish a bank session with a fork in it: the summary shows "Legend lesson: forks in Morphy's Opera Game" (edge E60). Clear the bank for the day: the caught-up page shows "Legend lesson on your top theme · Morphy's Opera Game · 6 min".
14. With P6 merged: `/train/weakness` top rows and the drill config show "Legend lesson: …" links to the matching lesson.

**As user R** (signed in, never subscribed): Play and lessons go to `/pricing?reason=required&redirect_url=…`. The drill completes but shows the trial CTA instead of saving.

**On devices:** steps 5, 8, 9 and 11 on iPhone 393×852, Android 412×915, iPad portrait 834×1194 and landscape 1194×834, and on desktop at 80 / 100 / 110 / 125 / 150 % zoom. The board, both player bars and the primary controls are always on screen without scrolling.

---

## 2. Scope

### 2.1 In scope

| Area | Features | Sub-phase |
|---|---|---|
| Public catalogues | Legends catalogue (search, era filter, empty state); legend detail (bio, famous games = lessons, positions to play, member progress island); legend positions catalogue (featured board, theme filter, visitor-aware CTA, loading / error / offline states); position detail (preview board with both player bars, not found); openings catalogue (popular, per-family static pages, in-memory search, load more); opening detail stepper; legends guide; openings guide with the embedded Italian drill; the generic drill page | P8a |
| SEO | Tag-only ISR, slugs + 307/308, sitemaps (legends and openings on slugs; a new positions sitemap), JSON-LD per page type, OG images with a drawn board, `noindex` on member pages, `scripts/seo-check.ts` updated | P8a |
| Legend practice (members) | <br>• Entry route `/play/legend/[slug]` (resume or start). <br>• `POST /api/games` `LEGEND_BOT` (P2 body + `reason: next`, `entry`), series numbering. <br>• Legend presentation inside the P2 game screen: header strip, "as Kasparov" chips, prefix moves with a "Game starts here" divider, the authored coach blurb, the study card. <br>• Result-card teaser from `complete`; Rematch / Restart / Next / All positions / Back to legend; analysing → review hand-off | P8a |
| Legend-detail games | The three `V3LegendGame*` entries: the same runtime, entered with `entry=legend` | P8a |
| Lessons | <br>• Authoring pipeline (J7 build script and validation): P8a. <br>• Lesson player (watch, guess, wrong, hint, show, story, speed, resume), lesson complete (stars, milestone line, next lesson, replay, play it out), progress API: P8b | P8a (pipeline) / P8b |
| Openings drill | `LineDrill` component (guide, generic drill page) with local completion: P8a. `LRN-3` card creation, `OPENINGS` session kind, the Train runner item and the hub row: P8b | P8a / P8b |
| Data and content | Schema M8 (P8a) and M8b (P8b); backfills B3 (slugs, eras, `isMainline`, `prefixSans`), B4 (explanations → R2), B11 (practice-set seed with verification), B12 (portraits → R2 with licence); J7 (lessons); J8 (popularity from the dump, notes); dev seed extension; `ADM-5` verify route; the content revalidation route | P8a |
| Lights up (§4 S13, S16) | <br>• P5 Train hub "Legend lessons" row and plan step 3. <br>• P5 session summary lesson card (`SessionSummary.next.lesson`, C-05, edge E60). <br>• P5 bank caught-up lesson card (`BankPage.lesson`, C-06). <br>• P6 `resolveLessonForPattern` (C-07). <br>• P5 Home "Play the Opera Game" target. <br>• P1 ⌘K legends on slugs. <br>• P3 compare "Another Position" → `/legends/positions`. <br>• P4 onboarding Done "Play Your First Legend Position" | P8b (⌘K, compare and onboarding may land in P8a) |
| Legacy retirement | `force-dynamic` catalogue pages, `/api/chess-positions/featured`, `lib/featured-positions.ts`, `/position/[ref]` + `/api/position/[ref]`, `ChallengeLegendButton`, the cuid canonicals, the persisted catalogue store, P1's `OpeningsIndexData` contract and `qk.catalog.openingsIndex()` (consistency 8.9). Each legacy page is deleted **one release after** its parity gate (feasibility §9 rule 3). | P8a |

### 2.2 Explicitly out of scope (and who owns it)

| Out | Owner |
|---|---|
| Play hub and its Legend tab (search over `CAT-5`), bot-strength persistence (`UserSettings.prefs.play.botStrength`), **bot ladder calibration (`scripts/calibrate-bots.ts`, P2 H-06)**, "Challenge a friend from this position", shared positions `/s/[code]` and `SP-1…3` | P9 |
| Compare page, practice-from-position, `V3GameOverLegend` and its **"Replay from move N" CTA** (P2 H-03, C-03), `LegendComparison` facts, `/review/*` | P3 |
| The compare page's **Ask** action, any coach thread kind for positions, lessons or mistakes | P7 (D8-20) |
| Personalised narration of the compare page | later (D8-20) |
| Admin screens for positions, legends and lessons (`V4Admin*`, the `ADM-3/4/6/7` reworks), `ChessPosition.status` / `PositionStatus` | P12. P8 adds only `ADM-5` (verify), the GET half of `ADM-6`, and tag revalidation inside the existing admin write routes that P1 hardened. |
| Persisted milestones (`UserMilestone`), the `MATE_LIKE_LEGEND` and `LEGEND_SET` milestones that read P8 data (P10:1666-1667) | P10. P8 shows a derived "first legend lesson finished" line. |
| Full marketing header (pricing banner, footer, Blog/Coaching nav items beyond Learn and Pricing), landing, blog | P11. P8 builds `MarketingTopNav` v1 and the Learn sub-nav (D8-1), which P11 extends. |
| Lesson audio, karaoke alignment, offline lesson download (`rc-lessons`, client-data-layer §7.5) | later (OD-4). The columns are nullable. |
| Maia / human-like bots, the Interesting badge | later (research R-MAIA-01) |
| Guest play of any kind | dropped by Phase 0 (`over_guest` states are not built) |
| Production rollout (migrations on `production`, content export to prod, 308s live) | P13 |

### 2.3 Dependencies (verify on day 1 of each sub-phase)

| From | What P8 needs | Where it should exist | Sub-phase | If missing |
|---|---|---|---|---|
| P1 | <br>• `route()` wrapper with the six cache tiers `public-immutable`, `public-static`, `public-short`, `private-etag`, `no-store`, `sse` (api-perf drift register; P1:625 has three today), plus `after()`, `ctx.now` / `x-rc-now` (X5). <br>• `api()` client and the `devSchema()` helper (AP-12). <br>• Registry **directories** (feasibility §7): `lib/api/keys/*`, `lib/flags/registry/*`, `lib/routes/classes/*`, `config/redirects/*`, `lib/seo/robots-rules/*`, `e2e/personas/*`. <br>• `getViewer()`, `requireMember()`, `requireMemberPage()`, `requireAdmin()`. <br>• `RateLimitBucket` with `store: "burst" \| "durable"` (AP-11). <br>• `lib/env.ts` `isProductionApp()` / `isNonProd()`. <br>• The UI kit, `ViewportStage`, `BoardStage`, `ScrollRegion`, the `/dev/ui` gallery. <br>• The device suite (40 projects). <br>• Shared test tools (critique-testing §4): the event registry `PKG/analytics/src/events/`, the sinks, the persona lease pool, `state-coverage`, visual tooling, the console guard, the test-hook registry, `post-deploy-dev.yml`. <br>• The `WEB/prisma/seed-content.ts` content seed | `WEB/lib/api/*`, `WEB/lib/auth/*`, `WEB/components/ui/*`, `WEB/middleware.ts` | P8a | A missing tier or registry directory is added by P8 as a one-hook edit, reviewed by P1's owner. A missing shared test tool blocks the matching DoD line, not the phase. |
| P2 | <br>• `GC` local runner (`createLocalGame`), `bot/strength.ts` ladder, `defaultBotElo()`, `explainIllegal`, `draw-policy`. <br>• `Board` (the `V3MoveBoard` contract), `MiniBoard`, `PlayerBar`, `MoveStrip`, `GameActions`, `GameOverCard` with named slots, `ResultSheet`, `StudyBanner`, `EngineProvider` with `prefetchEngine()`. <br>• `/game/[ref]` RSC with `getGameSnapshot()`. <br>• `POST /api/games` (`GameCreateBody`, P2:1389-1414), `/checkpoint`, `/complete`, `GET /api/games/[ref]`. <br>• `Game` columns `mode` (`LEGEND_BOT` exists, P2:898), `startPly`, `studySeconds`, `botElo`, `rematchOfId`, `meta` (`GameMetaV1`, P2:1024), `chessPositionId`. <br>• `games_open_idx` (P2:1052) and `game_players_userId_endedAt_gameId_idx` (P2:1074). <br>• The wire `prefix: {sans: string, …}` (P2:1648) | `GC`, `WEB/features/game/*`, `WEB/lib/games/*` | P8a | Blocker for WP-6 |
| P3 | `ANALYZE_GAME` (analysis from `startPly`; under 6 plies or aborted → `SKIPPED`, P3:1293), `JOB_PRIORITY` (`PKG/db/src/jobs.ts`, R-05), `LegendComparison` facts at `complete`, `/review/[ref]` and `/review/[ref]/legend`, `GET /api/review/[ref]/status` with `qk.review.status(ref)` (P3-D2), the `V3GameOverLegend` slot, `Opening.epd`, `hasExplanation` / `explanationUrl` (M3) | `WK`, `WEB/app/(app)/(immersive)/review/**` | P8a | Practice still plays; the teaser falls back to "The coach has graded every move of this game." |
| P4 | `User.timeZone` and `audit_logs` (M4, R-03 / R-04), `initialRating` / `ratingBand`, the onboarding Done CTA slot (D4-14, P4:45) | `WEB/app/onboarding/done/page.tsx` | P8a | Bot level falls back to 1400; the Done CTA stays hidden |
| P5 | <br>• `TrainingCard` (`deck=OPENING`, `kind=OPENING_LINE`, `openingId`, `(userId, itemKey)` unique), `TrainingAttempt` (`clientAttemptId`, `hintsUsed`, `wrongTries`, `solutionShown`, `timeMs`, `grade`, `suggestedGrade`, `reviewedAt`). <br>• `TrainingSession`, `TrainingDay` (`lessonsDone`, `plan`, `planDone` bitmask), `TrainingProfile` (streak), `SessionKind` (M5). <br>• `TRN` (`fsrs.ts`, release snapping, `touchStreak()`, `buildSession()`, `labels.ts`). <br>• The runner; the outbox `lib/offline/outbox.ts` on `rc-outbox` with `Kind` (client-data-layer:1511); `/train`, `/home`. <br>• The two lesson slots `SessionSummary.next.lesson` and `BankPage.lesson` (`LessonCard = {slug, title, minutes, href} \| null`, rendered by `components/train/slots/LessonCardSlot.tsx`; P5 final §2.2 row "Lesson plan step…") | `TRN`, `WEB/features/train/*`, `WEB/lib/train/*`, `WEB/components/train/slots/*` | **P8b** | P8b does not start |
| P6 | `resolveLessonForPattern(pattern)` stub in `WEB/lib/data/lessons-for-weakness.ts` and the slots that render its value (P6:1164) | `WEB/lib/data/weakness.ts` | P8b | If P8b merges first, it creates `lessons-for-weakness.ts` with the real body, and P6 imports it (first to merge creates) |
| P7 | none | — | — | — |
| P11 | none required. `MarketingTopNav` is created by P8 if P11 has not yet; P11 extends it. `lib/auth/client-hint.ts` is created by whichever merges first. | `WEB/components/marketing/TopNav.tsx` | P8a | — |

### 2.4 Hand-offs this phase receives (the receiving side of every "lights up later" row)

| Source | Slot / work | P8 section |
|---|---|---|
| P2 §2.4 / H-03 | Legend block on the game-over card: P3 builds it, and P8 fills the `LEGEND_BOT` teaser and actions slots | S3 |
| P2 H-04 | Coach card in the bot zone: P8 builds the authored `CoachLine` for `LEGEND_BOT` only | S3 |
| P2 §2.2 | `LEGEND_BOT` enabled on `POST /api/games` (until P8: `400 validation_failed {reason: mode_not_available}`) | §7.3 PLAY-1 |
| P4 D4-14 | Done page "Play Your First Legend Position" → `/play/legend/kasparov-topalov-1999?entry=onboarding` | S13 |
| P5 §2.2 | Plan step 3; "Legend lessons" hub row; summary lesson card (E60, **C-05**); caught-up lesson card (**C-06**); OPENING deck; Home "Play the Opera Game" | S13 |
| P6 §7.6 | `resolveLessonForPattern` (**C-07**) | S16 |
| P1 | ⌘K legends group; `OpeningsIndexData` retirement | S13, §7.5 |
| P3 | Compare "Another Position" target | S13 |
| P10, P11, P12 | Out-going contracts: `lesson_progress` export, `MarketingTopNav`, the tagged loaders for `/api/return-target` (P11:107, P11:749), `verifyPosition()`, `revalidateCatalog()` | §14.4 |

### 2.5 Phase order and the "Launch A" option

- Allocation runs stream B (P8 → P9 → P12) after P3, alongside stream A (P4 → P7). P8a fits that slot. P8b starts when P5 has merged (D8-16).
- The feasibility critique recommends a "Launch A" cut, with P8 after launch (feasibility §8). That is an owner decision (OD-13).
  - If it is taken, P8a and P8b both move after launch.
  - P13 §2.3 must then accept the legacy `/legends` and `/openings` pages inside the shell.
  - The slug redirects ship in the first post-launch release.
  - Nothing in this plan depends on the order beyond §2.3.

---

## 3. Current code touched

Line numbers are at `0848b76`.
- "P1 moves" means P1 track 1A has already moved the file into `WEB/app/(app)/` (SPEC D1) by the time P8 starts. P8 moves it again, into `WEB/app/(marketing)/(learn)/` (D8-1).
- Legacy files are deleted one release after their parity gate (§13.4).

### 3.1 Pages

| File (today) | What it does today | Problem | P8 action |
|---|---|---|---|
| `WEB/app/legends/page.tsx` (243 lines) | Server page, `export const dynamic = "force-dynamic"` (`:7`); groups by 6 free-text eras (`:9-16`); `legend.findMany` per request (`:19-33`); ItemList + Breadcrumb JSON-LD (`:50-82`); cuid links (`:61`, `:157`); raw `<img>` for photos (`:162`) | DB-15: every crawler hit wakes Neon. The design is a flat grid with 4 eras, search and filter. | **Replace** with `(marketing)/(learn)/legends/page.tsx` (static, tag-revalidated, reads `legendsVolume()`, `LegendsBrowser` island). Keep the JSON-LD; switch URLs to slugs. |
| `WEB/app/legends/layout.tsx` (19) | Static metadata | — | **Rework** into the `(learn)/legends` metadata |
| `WEB/app/legends/[referenceId]/layout.tsx` (46) | `generateMetadata` runs its own `legend.findUnique` (`:10-13`); canonical cuid (`:26`) | Double query with the page (G15) | **Delete.** Metadata moves into `[slug]/page.tsx` and shares the `cache()`d volume read. |
| `WEB/app/legends/[referenceId]/page.tsx` (391) | `findUnique` + `gamesAsWhite`/`gamesAsBlack` `take: 10` (`:17-47`); `famousGames` JSON (`:54`, `:250-283`); Play → `/play?legend=` (`:148`, `:368`); `ChallengeLegendButton` (`:158`); Person JSON-LD (`:67-90`) | No lessons; wrong Play target (play-b PB9) | **Replace** with `(learn)/legends/[slug]/page.tsx` (`V3LegendDetail`). Keep Person + Breadcrumb JSON-LD. `famousGames` is no longer read. Cuid params redirect to the slug. |
| `WEB/app/legends/[referenceId]/ChallengeLegendButton.tsx` (123) | Creates a friend game through `/api/chess/create-game` (`:55-64`); reads entitlement from the persisted store (`:27-30`) | No place in the v3 design | **Delete** (rct-b Q17: returns in P9's Friend tab) |
| `WEB/app/openings/page.tsx` (219) | `force-dynamic` (`:9`); reads `searchParams` (`:15-24`); `ILIKE` on name, eco **and pgn** (`:25-31`); loads all ≈ 3,641 rows with PGN (`:33-43`); 8.1 MB of HTML | DB-15, payload | **Replace** with `(learn)/openings/page.tsx` (the 48 most popular) + `(learn)/openings/eco/[letter]/page.tsx` (`generateStaticParams` A–E) + the `OpeningsSearch` island on `CAT-3`. `?eco=` redirects. |
| `WEB/app/openings/OpeningsSearch.tsx` (53) | `router.replace('/openings?q=')` with a 300 ms debounce (`:13-24`): one server render per keystroke | — | **Replace** with `components/learn/OpeningsSearch.tsx` (TanStack Query, abort, no navigation) |
| `WEB/app/openings/layout.tsx` (19) | Static metadata | — | Rework into `(learn)/openings` |
| `WEB/app/openings/[referenceId]/layout.tsx` (46) | Duplicate `findUnique` for metadata (`:10-13`) | G15 | **Delete** (metadata moves into the page) |
| `WEB/app/openings/[referenceId]/page.tsx` (335) | `findUnique` **without `select`**, so it reads the `explanation` JSON (`:25-27`); ECO family texts (`:10-16`); narration prose from `explanation` (`:39`); breadcrumb to `/openings?eco=` (`:49`) | Egress; no stepper | **Replace** with `(learn)/openings/[slug]/page.tsx` (`V3OpeningDetail` stepper). Keep the `ecoCategories` copy (moves to `lib/catalog/eco.ts`). The prose is read from R2 at render time. |
| `WEB/app/openings/[referenceId]/OpeningBoardPreview.tsx` (50) | Fixed-size static board | — | **Delete** (replaced by `StaticBoard` + `OpeningStepper`) |
| `WEB/app/learn/legends/page.tsx` (158), `WEB/app/learn/openings/page.tsx` (165) | Static editorial guides with Article JSON-LD (`learn/legends/page.tsx:8-31`) | Old design | **Rework** into `(learn)/learn/legends/page.tsx` (`V3LearnLegends`) and `(learn)/learn/openings/page.tsx` (`V3LearnOpenings`); reuse their prose for guide parts 1, 3 and 4 |
| `WEB/app/position/[referenceId]/page.tsx` (92) + `PositionPageClient.tsx` (527) | Member-gated client page (`middleware.ts:25`); a metadata query plus two racing client fetches (`PositionPageClient.tsx:55-84`); Play vs Bot → `create-ai-game` | No previews (PB5); fetch race (client #13) | **Replace** with a redirect resolver `WEB/app/position/[referenceId]/route.ts`: a known slug → `/legends/positions/<slug>`; `?type=opening` → `/openings/<slug>`; otherwise 404. **Delete** the client file. |
| `WEB/app/play/page.tsx` (legacy; P9 rebuilds it) | Legend picker from `useDataStore` (`:80-86`) | — | **Small change**: the legend picker links to `/play/legend/<playSlug>` from `CAT-1`; the opening picker reads `CAT-6` |
| `WEB/app/sitemap-legends.xml/route.ts` (23) | cuid URLs (`:17`) | — | **Change**: slug URLs from `legendsVolume()` |
| `WEB/app/sitemap-openings.xml/route.ts` (24) | Selects the `explanation` JSON for all rows only to test it for null (`:11`, `:21`, DB-14) | Egress | **Change**: slug URLs from the volumes, `hasExplanation`, `isMainline` priority |
| `WEB/lib/sitemaps.ts` (49) | `CATALOGUE_SITEMAPS` (`:9-12`), `s-maxage=3600` (`:42-49`) | — | **Add** `sitemap-positions.xml` |
| `WEB/app/sitemap.ts` (72) | Learn guide URLs (`:13-19`), catalogue indexes (`:26-27`) | — | **Add** `/legends/positions` |
| `WEB/app/og/route.tsx` (151) | Text-only cards; `type`, `title`, `subtitle` params (`:20-25`) | No board | **Extend** with `type=position&fen=&orient=`: a drawn 8×8 board in the `article-board-*` colours |
| `WEB/app/robots.ts` | — | — | **Add** a rule file `lib/seo/robots-rules/learn.ts`: `Disallow: /learn/lessons`, `/play/legend` |
| `WEB/scripts/seo-check.ts` | Checks `/try` as indexable (`:56`) and as a fetch (`:92`), plus `/openings`, `/legends` (`:62-63`) | `/try` now redirects | **Change**: assert the redirect map (307 on dev, 308 in prod) and add the new indexable URLs |

### 3.2 API routes and libraries

| File | Today | P8 action |
|---|---|---|
| `WEB/app/api/legends/route.ts` (84) | Public; 17 columns including `achievements`/`famousGames` JSON and `id` (`:20-42`); returns hidden legends unless the caller filters (`:9-21`) | **Change** to `CAT-1` (slim DTO, visible only, `public-immutable` with a current `v`). The three admin callers (`app/admin/page.tsx:137`, `app/admin/legends/page.tsx:78`, `app/admin/tournaments/create/page.tsx:77`) move to `GET /api/admin/legends` (`ADM-6` GET). |
| `WEB/app/api/legends/search/route.ts` (63) | Used by P1's ⌘K and the admin position editor (`app/admin/chess-positions/page.tsx:160`) | **Keep** for admin only. ⌘K moves to `CAT-1` (client filter). P12 deletes it (P12:1867). |
| `WEB/app/api/legends/create/route.ts`, `legends/[id]/route.ts`, `chess-positions/create/route.ts`, `chess-positions/[id]/route.ts`, `scraper/positions/import/route.ts` | P1 H1 added `requireAdmin()` | **Add** `after(() => revalidateCatalog(tagsFor(entity)))` (§8.11). Nothing else changes until P12 reworks them. **They keep running through the Clerk middleware** (§7.2 matcher). |
| `WEB/app/api/openings/route.ts` (53) | P1 F1 moved it onto `route()` as `A4` (`auth: "user"`, `private-etag`, `openings` bucket 30 / 60 s, `OpeningsIndexData`; P1:751, P1:771) | **Change** to `CAT-3` (public, paged, in-memory `?q=` search, no bucket; AP-28). Retire `CT/http/openings.ts` `OpeningsIndexData` and `qk.catalog.openingsIndex()` (P1:381, P1:697). The legacy-shape callers (`lib/stores/useDataStore.ts:90`, `app/admin/tournaments/create/page.tsx:76`) move to `CAT-6` in the same PR. P1's `/dev/ui/data` "Load Openings" calls `CAT-3` page 1 through `qk.catalog.openings({})`. P1's `data-layer.spec.ts` step (3) asserts "48 cards and a `nextCursor`" instead of "> 3000"; the forced 429 still works through `x-rc-fault` (consistency 8.9). |
| `WEB/app/api/position/[referenceId]/route.ts` (97) | Public position read for `PositionPageClient` | **Delete** (D8-12) |
| `WEB/app/api/chess-positions/featured/route.ts` (20) + `WEB/lib/featured-positions.ts` (32) | Dead (no callers, audit-api §5) | **Delete** if P1 has not already |
| `WEB/app/api/chess-positions/route.ts` (105) | Admin list (P1 capped `limit`) | Unchanged (P12) |
| `WEB/lib/services/chess-position.service.ts` (157) | Random position via `count` + `skip` (`:7-46`); legend lookups (`:96-157`) | **Keep** only what the legacy `/play` and tournaments still call. New code uses the volumes (`lib/data/catalog/*`). |
| `WEB/lib/stores/useDataStore.ts` (`:41-62`, `:90`) | Legends and openings persisted in localStorage for 24 h | **Change**: drop `persist` if P1 has not; fetch `CAT-1` and `CAT-6` (versioned). Deleted with the legacy `/play` page in P9. |
| `WEB/lib/hooks/useExplanationPlayer.ts` (628) | `ExplanationData` format (`:8-44`; alignment `:32-36`) | **Reuse** the type for lesson narration (no audio in v1). Position explanations are read from R2 through `getPositionExplanation()`; P3's compare loader calls it (one call site in P3's `lib/data/review.ts`). |
| `WEB/middleware.ts` | P1 rewrote it as a public allow-list with route classes (`lib/auth/route-classes.ts`, P1:1463); matcher at P1:820 | **No code edit if P1's classes are data.** P8 adds `lib/routes/classes/learn.ts` (§7.2): public, cookie-free catalogue pages and APIs that skip Clerk; member `/learn/lessons(.*)` and `/play/legend(.*)`. The matcher lines are in §7.2. |
| `WEB/next.config.js` | `/try` → `/pricing` (`:90-91`); `remotePatterns` `hostname: "**"` (`:76`) | **Add** `config/redirects/learn.mjs` (the `/try` targets and the `?eco=` redirect, 307/308 by `APP_ENV`) and the Workbox route `rc-public` for `/legends/positions/*` HTML (P11:116). The `remotePatterns` close is P1's; the portraits need only `media.playchess.tech` and are `unoptimized`. |
| `WEB/prisma/schema.prisma` → `DB/prisma/schema.prisma` | `ChessPosition` `:172-229`, `Legend` `:231-274`, `Opening` `:276-301` | **Additive** M8 and M8b (§6) |
| `WEB/prisma/opening-seed.ts` + `WEB/public/openings/{a..e}.tsv` | Lichess CC0 openings TSV import | **Keep**; J8 runs after it |
| `WEB/prisma/seed.ts` / P1 `seed-content.ts` | Bot user; 6 legends + 5 positions | **Extend** (§6.6) |

---

## 4. Screens

All 47 boards that `allocation.md` §4.2 assigns to P8 are grouped into 12 screens (S1–S12). Four more surfaces have no board of their own (S13–S16). Board paths are `DR/<file>`. Every state below is tagged in its spec as `@state:<Board>.<state>` (real data) or `@demo:<Board>.<state>` (a `/dev/ui/learn/*` route with a written reason). This feeds the P1 state-coverage check (X8).

**Device shorthand.**
- D = desktop 1440×900 (checked at 1280×800), IL = iPad landscape 1194×834, IP = iPad portrait 834×1194, P = iPhone 393×852, A = Android 412×915.
- Zoom matrix: 80 / 100 / 110 / 125 / 150 %. 150 % on a 1440×900 laptop is 960×600 CSS px.

**Shell modes** (P1 SPEC §2.2).
- App pages show the 220 px sidebar (D), the 64 px rail (IL, coarse pointer, or width ≤ 1100 px), or the top bar + tab bar (IP, P, A).
- Public Learn pages (D8-1) show `MarketingTopNav` (64 px; 48 px at `max-height: 640px`) and `LearnSubNav` (44 px; on P/A it collapses into a horizontal scroll strip). They show no app nav.

**One-viewport rule** (DS README "Layout: one viewport").
- Every page with a large board uses `ViewportStage` lock mode + `BoardStage`.
- The board side is `min(column width, 100vh − header − bars − controls)`, between 220 and 880 px.
- Lists scroll inside `ScrollRegion`, never the page.
- Public pages *without* a large board (S5, S6 on phones, S9 on phones, S12) may scroll, as the DS allows for marketing pages.

**Shared components used below.**
- From P1: `Button`, `IconButton`, `Kbd`, `Spinner`, `Tag`, `Banner`, `Skeleton`/`SkeletonRegion`, `EmptyState`, `Chip`/`ChipGroup`, `Segmented`, `Field`/`Input`, `Card`, `Overline`, `Disclosure`, `ProgressBar`, `ActionBar`, `Popover`, `FilterPopover`, `InfoButton`, `Menu`, `Dialog`/`AlertDialog`, `Sheet`/`ResponsiveDialog`, `notify` toasts, `ViewportStage`, `BoardStage`, `ScrollRegion`, `PageHeader`, `Avatar`, `RetryCountdown`.
- From P2: `Board` (`fen, orient, mover, last, hl, ring, arrows, badge, label, onMove`), `MiniBoard` (server SVG, 56 px default), `PlayerBar`, `MoveStrip`, `GameActions` (+ overflow), `GameOverCard` (named slots) / `ResultSheet`, `StudyBanner`, `GameTopBar`.
- From P3: `CoachLine` (rook "C" avatar + text + optional `VERIFIED`), `MoveBadge`.
- From P5: `TrainerShell`, `StatusLine`, `TrainerRunner`, `LessonCardSlot`.
- New in P8, under `WEB/components/learn/**`, `WEB/components/marketing/**`, `WEB/features/legend-practice/**` and `WEB/features/learn/**`: named per screen and owned in §13.

**Visitor kinds** for public CTAs come from `useVisitor()` (D8-21: the client hint, with no request and no clerk-js):
- `out` (signed out);
- `none` (signed in, never subscribed: `!md.entitled && !md.lapsed`);
- `lapsed` (`md.lapsed`);
- `member` (`md.entitled`).

The SSR HTML always renders the `out` variant. `MemberCta` swaps label and href after hydration inside a box of identical size, so there is no layout shift.

| Visitor | Play CTA label → href | Lesson card / "Lessons with …" → href |
|---|---|---|
| `out` | "Start 7-day Free Trial" → `/sign-up?redirect_url=/play/legend/<slug>` | `/sign-up?redirect_url=/learn/lessons/<slug>` |
| `none` | "Start 7-day Free Trial" → `/pricing?reason=required&redirect_url=…` | same, with the lesson URL |
| `lapsed` | "Renew · $4.99/month" → `/pricing?reason=ended&redirect_url=…` (B26 default; C-21 is still open) | same |
| `member` | "Play vs Bot" (detail, catalogue) or "Play as Morphy" / "Play This Position" for a living legend (D8-18) → `/play/legend/<slug>?entry=<surface>` | `/learn/lessons/<slug>?from=legend` |

The price string comes from `BILLING_PLANS` (`WEB/lib/billing/*`) and is never hard-coded.

### S1. Legend positions catalogue (P8a)

- **Route:** `/legends/positions` → `WEB/app/(marketing)/(learn)/legends/positions/page.tsx`. Public and indexable. Static, with `revalidate = false` and tags `positions`, `catalog-version`.
- **Boards:** D `DR/V3TryCatalogue.dc.html` (enum `default | loading | error | offline`). IL uses the D layout. IP, P and A have no board, so the single-column layout below is derived.
- **Layout:**
  - **D/IL:** `ViewportStage` (lock) → `MarketingTopNav` → `BoardStage asideWidth="hub"`.
    - Board column: header row "Wijk aan Zee · 1999 · White to move" (28 px) + the featured board (static `Board`, orientation = `heroSide`).
    - Aside (360–400 px): h1 "Legend Positions"; Filter button with count; the selected block (`{white} vs {black}`, blurb, `MemberCta` primary, "See Details" secondary, "5+3 · reviewed by the coach"); Overline "Featured positions" + count; a `ScrollRegion` list of `PositionRow`s (56 px `MiniBoard`, "Kasparov vs Topalov · Wijk aan Zee, 1999 · White to move", theme `Tag`); footnote.
    - At 960×600 (150 %) the aside narrows to 300 px and the footnote hides (`vh620:`).
  - **IP:** the board is `min(100vw − 32px, 100svh − 420px)`, centred under the header. The selected block and the list sit below it in one `ScrollRegion`. The CTA bar is pinned at the bottom (`--safe-bottom`).
  - **P/A:** header 48 px; meta line; board full width (361 px on P, 380 px on A); selected block (2 lines + blurb clamped to 3 lines); list `ScrollRegion` (at least 3 rows visible); CTA bar 64 px, pinned in the thumb zone. Budget on P: 48 + 28 + 361 + 112 + list ≥ 168 + 64 = 781 ≤ 852 − safe areas.
- **States and transitions:**

| State | Shown when | UI | Exits |
|---|---|---|---|
| `default` | static HTML rendered | first available position selected (`practiceOrder` 1, `kasparov-topalov-1999`) | row click or ↑/↓ changes the selection in place (URL `?p=<slug>` via `history.replaceState`, no RSC request) |
| `filter_open` (variant) | Filter clicked | `FilterPopover` "Filter positions": theme chips Sacrifice / Attack / Endgame (multi-select, `aria-pressed`), "Clear all", "Show {n}" | Esc or Show → the list is filtered client-side over the ≤ 50 items in the HTML; the button shows "(2)" |
| `filter_empty` (variant) | no item matches the themes | `EmptyState` card "No positions match these themes" + "Clear filters" | Clear → `default` |
| `loading` | only on client navigation into the route before the RSC payload arrives (`loading.tsx`) | board `Skeleton` square, 5 skeleton rows, count "…", CTA `aria-disabled` | payload arrives |
| `error` | the volume loader threw and there is no cached copy (segment `error.tsx`) | "Failed to fetch chess positions" / "The position server didn't answer. Your connection looks fine." + "Try Again" (`router.refresh()`); the list shows "Nothing to show yet." | Try Again |
| `offline` | `useOnline() === false` | top `Banner` (warn) "You're offline. Positions you've opened before still work; the rest need a connection." + Retry. Rows whose detail page is not in the SW cache (`caches.match('/legends/positions/<slug>')` in `rc-public`) are `aria-disabled` and say "Not available offline". Count "2 available offline". Play shows "Connect to Start a Game". | `online` event → `default` |
| `empty` | the practice set is empty (an admin removed every position) | `EmptyState` "No positions yet" + link to `/legends` | — |
| `upcoming` (variant, not in the enum) | an item's `availableFrom` is in the future | the row is in the HTML with `hidden` and `data-available-from`; the island un-hides it when the time passes (D8-17), and the count updates in an `aria-live` region | — |

- **Components:** `MarketingTopNav`, `PositionsBrowser` (client island: selection, filter, availability, offline map), `Board` (static: `mover=""`), `PositionRow`, `MiniBoard`, `FilterPopover`, `Chip`, `Tag`, `MemberCta`, `Banner`, `EmptyState`, `Skeleton`.
- **Keys:**
  - The list is a `listbox` (`aria-activedescendant`). ↑/↓ move the selection.
  - Enter = Play (member) or the CTA. Shift+Enter = See Details.
  - `F` flips the preview board. Esc closes the popover.
- **Copy:** drop the "Included" tag (a tier word in a paid-only product; OD-9). Use one display name per game ("Duke of Brunswick & Count Isouard"). The offline copy "still work" means "still open"; play needs a connection (no offline game creation in v1).

### S2. Legend position detail (P8a)

- **Route:** `/legends/positions/[slug]` → `WEB/app/(marketing)/(learn)/legends/positions/[slug]/page.tsx`.
  - Public and indexable.
  - Static, with tags `positions`, `position:<slug>`.
  - `generateStaticParams` = the practice set + featured (≤ 60); `dynamicParams = true` for every other active position.
  - The first render of an on-demand slug reads `positionsVolume()` (Data Cache), not Neon.
- **Boards:** D `DR/V3TryPosition.dc.html`, P `DR/V3iPhoneTryPosition.dc.html` (390×844), IP `DR/V3iPadTryPosition.dc.html` (820×1180). Enum `default | loading | not_found`. A uses P; IL uses D.
- **Layout:**
  - **D/IL:** `BoardStage` with
    - `top` = `PlayerBar` preview "E · Engine · as Topalov · Black · 5:00";
    - `bottom` = "You · as Kasparov · White · 5:00" (no clocks running);
    - aside = "← All positions", eyebrow "Wijk aan Zee · 1999 · Round 4", serif h1 "Kasparov vs Topalov", `Tag`s (White to move · 5+3 Blitz · vs engine), the blurb ending "You play White from here.", `MemberCta` (full width), "About This Game" secondary (→ `/legends/<heroLegendSlug>`; hidden when the hero side has no legend), and the hint "Saved to your games and reviewed by the coach."
  - **P:** header (back to positions, title "Legend Position"), chips above and below a full-width board, the panel below, and the CTA pinned in the bottom 25 %.
  - **IP:** board `min(100vw − 32px, 100svh − 360px)`, centred, with the panel under it.
- **States:**
  - `default`;
  - `loading`: client navigation only; panel skeleton, CTA `aria-disabled="true"`;
  - `not_found`: `notFound()` → segment `not-found.tsx`, HTTP 404. Dimmed board (`aria-hidden`), "Error · Position not found · This link may be old, or the position was removed. The other legend positions are still there." + "Back to Positions";
  - variant `black_to_move`: board oriented to `heroSide`, chips swapped;
  - variant `no_legend`: About This Game hidden;
  - variant `living_legend`: the member CTA reads "Play This Position" (D8-18).
- **Transitions:** CTA → `/play/legend/<slug>?entry=detail` (member) or the visitor href. About This Game → legend detail. All positions → S1.
- **Components:** `MarketingTopNav`, `Board` (static), `PlayerBar` (preview variant), `Tag`, `MemberCta`, `Button`, `Skeleton`, `EnginePrefetch` (client; members only; calls P2's `prefetchEngine()` on CTA hover or focus, or after 3 s idle).
- **Keys:** `F` flips. Enter on the page focuses the CTA.
- **SEO:** `CreativeWork` JSON-LD (`about`: both players; `dateCreated`: the event year) + `BreadcrumbList`. OG image `/og?type=position&fen=…&orient=…&title=…&v=<catalogVersion>`.
- **Copy:** the P board's title "Try a position" becomes "Legend Position" (inv-pub §2.3).

### S3. Legend practice game (P8a)

- **Routes:** entry `/play/legend/[slug]` → `WEB/app/(app)/play/legend/[slug]/page.tsx` (S14), then P2's game page `/game/[ref]` when `Game.mode = LEGEND_BOT`. Members only, the player only, `noindex` (metadata `robots`, never a `headers()` call; AP-14).
- **Boards (26):**
  - D, all states (Morphy, Opera Game): `DR/V3TryGame.dc.html` (enum `study | your_move | their_move | check | promotion | over_guest`) and `DR/V3TryGameOver.dc.html` (same enum, default `over_guest`).
  - D, one playable board per position: `DR/V3TryGameKT.dc.html`, `DR/V3TryGameBF.dc.html`, `DR/V3TryGameAK.dc.html`, `DR/V3TryGameTS.dc.html`.
  - P: `DR/V3iPhoneTryGame.dc.html`, `V3iPhoneTryGameKT`, `V3iPhoneTryGameBF`, `V3iPhoneTryGameAK`, `V3iPhoneTryGameTS`.
  - A: `DR/V3AndroidTryGame.dc.html`, `V3AndroidTryGameKT`, `V3AndroidTryGameBF`, `V3AndroidTryGameAK`, `V3AndroidTryGameTS`.
  - IP: `DR/V3iPadPTryGame.dc.html`, `V3iPadPTryGameKT`, `V3iPadPTryGameBF`, `V3iPadPTryGameAK`, `V3iPadPTryGameTS` (the result is a bottom sheet).
  - IL: `DR/V3iPadLTryGame.dc.html`, `V3iPadLTryGameKT`, `V3iPadLTryGameBF`, `V3iPadLTryGameAK`, `V3iPadLTryGameTS` (side panel like D).
  - The 16 device boards are named here one by one, rather than through a glob (C-coverage note at critique-coverage:19).
  - `over_guest` is dropped (no guest play, Phase 0). Its `signupHref` and "Back to Landing" links are not built.
- **Layout:** the P2 game screen (`BoardStage asideWidth="game"`). Additions for `LEGEND_BOT`:
  - **D/IL:** in the app shell (nav `current="play"`, or `learn/legends` when `meta.entry = "legend"`).
    - A slim `LegendPracticeStrip` row above the board area: "Legend practice · Saved to your games. The coach reviews it when you finish. · Your games" (→ `/games`), 32 px, hidden at `vh640:`.
    - The panel header: "Kasparov vs Topalov · Wijk aan Zee 1999" + "5+3 · vs Engine · game {seriesNo}".
  - **IP/P/A:** `GameTopBar` (back → `/legends/positions/<slug>`, or `/legends/<legendSlug>` when entered from the legend page; title "Kasparov vs Topalov"; subtitle "5+3 · practice · game 2"; right link "Your games" → `/games`). The tab bar is hidden (game screen). The result appears in a `ResultSheet` (bottom sheet at 60 %) on IP/P/A, and in the panel on D/IL, never over the board.
  - **Move list:** the legend prefix moves render greyed, then a "Game starts here" divider (`V3TryGame` `rows[].div`).
    - They come from P2's snapshot `prefix {sans, startMoveNo, startsBlack}` (P2:1648), filled at creation from `ChessPosition.prefixSans`.
    - P2's `GameMetaV1.prefixSan` holds at most 120 SAN (P2:1027). A longer prefix keeps the last 120 plies, with `prefixStartMoveNo` adjusted and a leading "…" cell.
    - On phones the `MoveStrip` scrolls horizontally and starts at the divider.
  - **`PlayerBar`s:** "Engine · 1400 · as Topalov" (thinking pulse on its turn; the "≈" tooltip until P9 calibrates, D8-9) and "You · as Kasparov" (`V3TryGame*`) or "knightowl_88 · 1184 · as Morphy" (`V3LegendGame*`). Each shows material balance and a clock with tenths under 10 s (P2 `useClock`).
  - **Coach blurb:** a `CoachLine` built from the position `blurb`. It is authored copy, so it never shows `VERIFIED` (P2 H-04).
- **States:** the P2 game phases that a `LEGEND_BOT` game can reach, plus P8 overlays.

| State | Enter when | What the user sees (board copy) | Exits |
|---|---|---|---|
| `starting` (S14) | `/play/legend/[slug]` with no game to resume | the position board (from the volume) with "Starting the game…" | `/game/<ref>` |
| `loading` | `/game/[ref]` mount while the engine boots | board from the RSC snapshot (no flash), chip skeletons, engine status line "Starting the engine · 34 %" (first load only: "about 7 MB, cached after this") | `study` / `your_move` / `their_move` |
| `study`, `study_last5` | `Game.studySeconds = 30` (D8-8); the local runner's study phase | clocks show STUDY; "Study the position" countdown (red and larger under 5 s); study card ("Morphy vs Duke of Brunswick & Count Isouard · Paris Opera, 1858 · White to move after 9…b5"); "Moves are locked. Draw arrows with right-drag to plan…"; "I'm Ready" button; plan arrows | `your_move` (hero to move) or `their_move`, on ready or timeout |
| first move (`your_move`, clocks not started) | no study, hero to move | coach line (the position `blurb` + "You play Kasparov from here. Clocks start once both sides have moved; Rematch swaps colours."); status "Make your first move · 5:00 · clocks start once both sides have moved"; chip sub-lines "White · clock not started" | `their_move` |
| `your_move` | hero to move | legal dots, selection wash, status ("King selected · castling long is legal"), own chip "Your move · +4 material" | `their_move`, `promotion`, `over_*` |
| `their_move` | engine to move | engine chip "Thinking" pulse; a human-like delay of 400–900 ms after `bestmove` | `your_move`, `over_*` |
| `check` (modifier) | the side to move is in check | red king glow; status "Check · block, capture or move the king" | — |
| `promotion` | a pawn reaches the last rank | picker on the square (Q/R/B/N); "Choose a piece · Esc puts the pawn back" | `your_move` (Esc) / `their_move` |
| `illegal` (transient) | illegal drop or click | red toast "That move isn't legal: your king would be in check" (P2 `explainIllegal`); the piece snaps back | `your_move` |
| `viewing` (modifier) | ←/→ or a move click | "Viewing 12.Ba4 · clock running", "Back to Live" | live |
| `draw_sent`, `draw_declined` | Offer draw (≥ 2 plies) | "Offer Sent" (disabled); after 1.5–2.5 s either `over_agreement` or the toast "The engine declined the draw." (P2 `draw-policy`) | — |
| `resign_confirm` | ⋯ → Resign… | popover "Resign this game?" Keep Playing / Resign | `over_resign_loss` |
| `restart_confirm` (P8 overlay) | Restart pressed while `IN_PROGRESS` with ≥ 2 member plies | popover "Restart from the position? This game is discarded." Keep Playing / Restart | `starting` (new game) |
| `engine_failed` (P8 overlay) | worker error, no `uciok` in 8 s, or no WebAssembly | panel `Banner` (bad) "Engine didn't start. This browser may block WebAssembly." + Retry (clears the engine cache entry) | Retry |
| `other_tab` (P8 overlay) | another tab holds the `BroadcastChannel('rc-game-<ref>')` lock | "This game is open in another tab · Use This Tab" | take over |
| `over_*` | the game ends | result block in the panel (a sheet on IP/P/A): eyebrow Victory / Defeat / Draw / Aborted; serif title ("You won by checkmate", "Engine won by checkmate", "You lost on time", "Draw by repetition", "Draw by 50-move rule", "Draw · insufficient material", "Draw by stalemate"); method line + "· practice game, unrated" ("Checkmate · move 17, just like Morphy" when the legend game also ended in mate at that move); the **Coach review** teaser (`LegendTeaser`); actions | see below |
| `over_aborted` (P2) | abort before 2 plies | "Game aborted" + Rematch / Restart only | — |
| `over_analysing` (P3) | `complete` returned `analysis.status = queued` | primary disabled "Analysing · 64 %", from `analysis:progress` | `analysis:done` → the board's label: "Open the Full Review" (`V3TryGame*`) or "See What the Coach Thinks" (`V3LegendGame*`) |
| `over_skipped` (P3) | fewer than 6 plies from `startPly` (P3:1293) | teaser only; the review CTA is hidden; "Too short to review" | — |
| `over_legend` (P3 slot) | comparison facts present | P3's legend block ("You matched 2 of 3 moves · You played 12.Ba4, Morphy played 12.O-O-O", "Compare with Morphy", and P3's "Replay from move N" per H-03) | compare page |
| `saved_offline` (P8 overlay) | `complete` queued in P2's outbox | "Saved offline · the coach will review it when you're back online" | outbox flush → normal |
| `rejected` (P2) | `complete` → `422 illegal_moves` | "We couldn't save this game. It didn't replay on our side." + "New Game" | — |

- **Teaser copy** (`LegendTeaser`, from the `complete` response `legend.teaserKey`):

| `teaserKey` | Copy |
|---|---|
| `found` | "You found 24.Rxd4, the move Kasparov played." |
| `different` | "You played 24.Qc1. Kasparov played 24.Rxd4 here." |
| `other_side` | "You played the other side this time." |
| `graded` | "The coach has graded every move of this game." |

  The body reads "The full review grades all {n} of your moves, marks the key moments and shows what to play instead." Before `complete` returns (about 300 ms), the teaser shows a one-line skeleton.
- **Result actions:**
  - Primary: the board's review CTA (→ `/review/<ref>`), disabled as "Analysing · n %" while queued.
  - "Rematch · as Black" (colours swapped).
  - "Restart" (same colour).
  - D: "All Positions" (→ S1). Devices: "Next Position".
  - `V3TryGameOver` adds "Compare with Kasparov" (→ `/review/<ref>/legend`), share (copy link to the position page; PGN download via P2's `GET /api/games/[ref]/pgn`) and "New Game".
  - Legend-detail entries replace All/Next with "Back to Morphy" (S4).
  - An aborted game shows Rematch and Restart only.
- **Transitions:**
  - **Rematch** → `PLAY-1 {reason: "rematch", parentGameRef}` → `router.replace('/game/<new>')`, with the toast "Rematch: colours swapped. You play Black."
  - **Restart** → `PLAY-1 {reason: "restart", parentGameRef}`. The server aborts an `IN_PROGRESS` parent in the same transaction (D8-8).
  - **Next** → `router.push('/play/legend/<next.slug>?entry=next')`, cycling by `practiceOrder`: KT → BF → AK → TS → Opera Game → KT.
  - Review and compare links are plain `<Link>`s. The review page is prefetched with `router.prefetch` once `analysis:done` arrives. The compare query is **not** prefetched on hover (AP-09).
- **Components:** P2's game components + `LegendPracticeStrip`, `LegendGameHeader`, `LegendTeaser`, `LegendResultActions`, `StudyCard` (wraps P2's `StudyBanner` with the legend context), `CoachLine`. All are passed through `GameOverCard`'s named slots; P8 adds no edits inside the card.
- **Keys** (P2 map + P8):
  - Drag or click-click to move. Enter with nothing focused opens move entry (SAN/UCI).
  - ←/→ step, ↑/↓ first/latest, `F` flip, `D` offer draw, `M` sound.
  - `Esc` cancels promotion or selection.
  - `H` hint and `U` takeback, only when the assist is on.
  - `R` Rematch and `N` Next on the result card; `Enter` on the result card = primary.
  - Single-letter keys are off while typing.
- **A11y:**
  - The board is `role="application"`, with the status line as `aria-describedby`.
  - Moves are announced in the polite live region ("Engine played Kxa5. Check.").
  - Clocks are `role="timer"`, with one assertive announcement at 10 s.
  - The result heading takes focus.

### S4. Legend-detail games (P8a)

- **Boards:** D `DR/V3LegendGameOpera.dc.html` (Opera Game, move 10, you White, 5+3), `DR/V3LegendGameAnderssen.dc.html` (Morphy vs Anderssen, Paris 1858 match game 9, move 14, you White, 10+0), `DR/V3LegendGamePaulsen.dc.html` (Paulsen vs Morphy, New York 1857, move 17, you Black, 5+3). Devices use the S3 device layouts.
- **Route:** `/legends/paul-morphy` "Positions to play" → `/play/legend/<slug>?entry=legend` → `/game/<ref>`.
- **Differences from S3:**
  - nav `current="learn" sub="legends"`;
  - the own chip shows the member ("knightowl_88 · 1184 · as Morphy");
  - result primary "See What the Coach Thinks", secondary "Rematch · as Black" and "Back to Morphy" (→ `/legends/paul-morphy`) instead of All/Next;
  - "Next" (devices) = the next position *of that legend* (`collection=legend:paul-morphy`, ordered `practiceOrder NULLS LAST, eventDate, id`).
- **Data note:** the Opera Game position (`opera-game`) is the same `ChessPosition` row as the practice-set Opera Game (`fen @unique`). The Anderssen and Paulsen FENs are checked by `verifyPosition()` against trusted PGNs before seeding (§8.4, §12.4).

### S5. Legends catalogue (P8a)

- **Route:** `/legends` → `WEB/app/(marketing)/(learn)/legends/page.tsx`. Public and indexable. Static, tag `legends`. `?q=&era=` are applied on the client.
- **Boards:** D `DR/V3LegendsCatalogue.dc.html` (enum `default | filtered | empty`); D `DR/V3LegendsEmpty.dc.html` (`empty`, query "Nimzowitsch"). No device boards.
- **Layout:**
  - **D:** `MarketingTopNav` (Learn current) + `LearnSubNav` (Legends current) + header (eyebrow "Learn · Chess legends", h1 "Play through the games that shaped chess", `SearchField` "Search legends", Filter button + count) + a count line + a 4-column grid of `LegendCard`s in a `ScrollRegion` (8 visible at 1440×900).
  - IL: 3 columns. IP: 2 columns. P/A: single-column 72 px rows, and the page scrolls (public page, no board).
- **States:**
  - `default`: all visible legends, ordered by `eraOrder`, then name;
  - `filtered`: era chips, e.g. Soviet → 2 cards; Filter shows "1";
  - `empty`: `h2` "No legend matches "Nimzowitsch"", then "We add legends with at least {LEGEND_MIN_POSITIONS} annotated positions. Try another name or clear the filter.", then "Clear Search";
  - `searching` is instant (client filter, no spinner).
- **Card:** the portrait (an `unoptimized` `<img>` 96 px from R2, `width`/`height` set, `loading="lazy"`) or initials `Avatar` when there is no licensed portrait (D8-18); name; "1837–1884 · Romantic · Attack" ("born 1963" when alive); "12 positions · 5 lessons" (lessons hidden when 0). The card links to `/legends/<slug>`.
- **Components:** `LegendsBrowser` (client island over the ≤ 60 cards in the HTML), `SearchField` (`Field` + `Input type=search`), `FilterPopover` "Filter legends" (era chips Romantic, Classical, Soviet, Modern; "Clear all"; "Show {n}"), `LegendCard`, `EmptyState`.
- **Keys:** `/` focuses search. Esc clears the search, then closes the popover. Arrow keys move across the grid (roving tabindex).
- **Search:** accent-insensitive (`normalize('NFD').replace(/\p{Diacritic}/gu,'')`). Every query token must be a prefix of a name token ("capa" → Capablanca, "polgar" → Polgár). The count is in an `aria-live=polite` region. The URL is updated with `history.replaceState` (no RSC fetch).

### S6. Legend detail (P8a; lesson cards light up in P8b)

- **Route:** `/legends/[slug]` → `WEB/app/(marketing)/(learn)/legends/[slug]/page.tsx`. Public and indexable. Static, tags `legends`, `legend:<slug>`, `lessons`. `generateStaticParams` = every visible legend. A cuid param redirects to the slug (D8-5).
- **Board:** D `DR/V3LegendDetail.dc.html` (no enum). Device layouts are derived.
- **Layout:**
  - **D:** `MarketingTopNav` + `LearnSubNav` + breadcrumb "Legends / Paul Morphy".
  - Hero: portrait or initials, h1, "1837–1884 · New Orleans · Romantic era · Attack", bio paragraph, CTAs "Play as Morphy" (`MemberCta` → `/play/legend/<playSlug>?entry=legend`; "Play This Position" for a living legend) and "Lessons with Morphy · 2 of 5" (`LessonProgressIsland`), stats line "12 positions · 5 lessons · Themes: development · open lines · sacrifice". The portrait credit is shown in a `figcaption` when `portraitCredit` is set.
  - Two sections, side by side above 1100 px and stacked below:
    - **Famous games** = published lessons. Each `FamousGameCard` has a 120 px `MiniBoard` at the lesson's start position, "Opera Game", "Morphy vs Duke Karl & Count Isouard · Paris 1858".
    - **Positions to play**: `PositionRow` "Opera Game, move 10 · White to move · 5+3" + Play.
  - When the sections overflow they scroll inside a `ScrollRegion`. On P/A the page scrolls.
- **States:**

| State | UI |
|---|---|
| member | Play as Morphy → legend game; island "Lessons with Morphy · {done} of {total}" → `nextSlug` (resume) or the first lesson |
| `out` / `none` / `lapsed` | CTAs per the visitor table ("Start Your 7-day Free Trial to Play"); Famous game cards → sign-up or pricing with the lesson as `redirect_url` |
| island loading | a skeleton pill in place of "2 of 5" (same width) |
| island unavailable | the session token is stale and could not be refreshed, or `LRN-1` failed: the pill is hidden, the CTA still links to the first lesson, and there is never a toast on a public page (`meta: {silent: true}`) |
| no lessons (also all of P8a: lessons stay unpublished) | the Famous games section is replaced by "Lessons Coming Soon"; the lessons CTA is hidden |
| no playable positions | Play as and "Positions to play" are hidden |
| living legend | "Play This Position", factual copy, no portrait unless licensed |
| not found / hidden legend | `notFound()` → 404 |

- **Components:** `LegendHero`, `MemberCta`, `LessonProgressIsland`, `FamousGameCard`, `PositionRow`, `MiniBoard`, `Breadcrumbs` (existing `WEB/app/components/Breadcrumbs.tsx`).
- **SEO:** keep `Person` JSON-LD (with `sameAs` Wikipedia; today `:67-90`) + `BreadcrumbList`. Canonical `/legends/<slug>`.
- **Copy:** the design's "Morphy vs Paulsen · New York 1857" famous game is really Paulsen–Morphy (Morphy had Black; verified in §12.4). The title is "Paulsen vs Morphy", and the lesson board is oriented for Black.

### S7. Legend lesson player (P8b)

- **Route:** `/learn/lessons/[slug]?from=legend|guide|train|plan|home|summary|bank|weakness` → `WEB/app/(app)/(immersive)/learn/lessons/[slug]/page.tsx`. Members only (`requireMemberPage()`), `noindex`.
- **Boards:** D `DR/V3LessonPlayer.dc.html` (`narrating`, ply 18), D `DR/V3LessonGuess.dc.html` (`guess`, ply 24), P `DR/V3iPhoneLesson.dc.html`, A `DR/V3AndroidLesson.dc.html`, IL `DR/V3iPadLLesson.dc.html`, IP `DR/V3iPadPLesson.dc.html`. Enum `narrating | guess`. Visible variants that are not in the enum: `wrong`, `answered`, `done`, story open, playing/paused.
- **Layout:**
  - **D/IL:** app shell (sidebar or rail, `current="learn" sub="legends"`) + `BoardStage asideWidth="game"`.
    - `top` `PlayerBar` "DI · Duke Karl & Count Isouard · Black · 2 of 3 stars so far"; the board; `bottom` "PM · Paul Morphy · White · you guess his moves".
    - Aside: h1 "The Opera Game" + Story toggle (`aria-pressed`); "Morphy · Paris 1858 · lesson 2 of 5"; "Challenge 1 / 3" + 3 `ChallengeChips`; narrator avatar + `NarrationText` (`aria-live=polite`); `GuessActions` (Hint, "Show Me Morphy's Move"); story text when open; `LessonMoveStrip` (`role=list` "Game moves", plies `startPly−2` … `endPly`, checkpoints marked) in a `ScrollRegion`; `LessonTransport` (Previous move, Play/Pause, Next move, Narration speed 1× / 1.5× / 2×); the primary CTA.
  - **IP:** top bar (back, "Opera Game · Challenge 1/3") + bars + board, with the aside below it scrolling inside its region.
  - **P/A:** header (back, "Opera Game · Challenge 1/3", Story icon); meta line "Morphy · Paris 1858 · 2 of 3 stars so far"; board full width; a section with the chips, text and guess actions; `LessonTransport` as the bottom control bar, replacing the tab bar. Story opens a `Sheet`.
- **States** (`useLessonPlayer` reducer, `TRN/lesson/machine.ts`):

| State | Enter when | UI | Exits |
|---|---|---|---|
| `watch_paused` | load at `startPly`, or resume at `lastPly` | intro text ("Morphy, playing White, has just seen Black push b5. Press play…"), CTA "Play Lesson" (or "Resume") | Play → `watch_playing`; Next → +1 ply |
| `watch_playing` | Play | one ply every `2000 / speed` ms; narration of the ply just played; CTA "Pause" | reaching a checkpoint ply → `guess`; Pause; `endPly` → `done` |
| `guess` | the next ply is a checkpoint | `checkpoint.prompt` ("Your turn. Black has guarded d7 twice. What did Morphy play?"), "Play Morphy's Move on the Board"; the board accepts moves for the legend's colour only; the current chip is half filled | correct → `answered`; wrong → `wrong`; Show me → `answered` (`shown++`) |
| `wrong` | a move that is neither the legend's nor in `alsoAccept` | "Not Morphy's move: {san}. {hint}", red rings on from/to; unlimited retries | correct → `answered`; Show me |
| `hinted` (modifier) | Hint (once per checkpoint) | ring on the piece to move (`rgba(3,105,161,.9)`) | — |
| `answered` | correct or shown | the move is played; badge `best` or `brilliant` on the target square; the `narration` of that ply ("Correct, because the rook removes a defender: Rxd7…"); "Also strong. Morphy played {san}" when the move matched `alsoAccept` | autoplay resumes (`watch_playing`) |
| `done` | after `endPly` | `outro` ("Rd8 is mate. Development beat material…"), "Lesson finished · 2 of 3 stars", CTA "Finish Lesson" | → S8 after the outbox flush |
| story (toggle) | Story | story text in the panel (a sheet on P/A) | Esc / toggle |
| `saving_offline` (overlay) | `done` while offline | "Lesson finished · saved on this device. We'll sync it when you're back online." | `online` → flush → S8 |

  - **Stars:** `stars = max(1, 3 − hints − shown)`. `hints` counts checkpoints solved after using Hint; `shown` counts checkpoints revealed (board logic `_rv0`, kept verbatim).
  - Prev steps back no further than `startPly` and clears `done`. Next skips one ply but never skips a guess. A resume at a checkpoint starts in `guess`. A `contentVersion` change resets the resume point.
- **Keys:** `Space` play/pause; `←`/`→` previous/next; `H` hint; `S` show me; `V` voice (only when `audioUrl`); `Esc` closes the story; `Enter` = primary CTA; `1`/`2`/`3` speed.
- **A11y:**
  - Board label "Lesson board. After 16.Qb8+".
  - Narration is announced only when paused, at checkpoints, or with "Read narration aloud" on.
  - The challenge chips group is labelled "Challenge 1 of 3".
  - Reduced motion keeps autoplay but drops the slides.
- **Loading / error:**
  - First paint is server-rendered (board + text).
  - A missing or unpublished slug → 404.
  - A content integrity failure (a step's FEN does not chain) is caught at build and never reaches the page.

### S8. Lesson complete (P8b)

- **Route:** `/learn/lessons/[slug]/complete?run=<runId>` → `WEB/app/(app)/learn/lessons/[slug]/complete/page.tsx`. Members only, `noindex`.
- **Board:** D `DR/V3LessonComplete.dc.html` (no enum). Device layouts are derived: single column, static board 200–280 px.
- **Layout:**
  - **D:** app shell + a card column + the static final board (`Board` `mover=""`, label "Final position: Rd8 is checkmate.") with "17.Rd8# · 1–0".
  - The card column: eyebrow "Legend lesson · Morphy · 2 of 5", `StarRating` (`role=img` "2 of 3 stars"), h1 "Lesson complete", the sentence, the milestone `Tag`, CTAs.
  - It fits one viewport at every zoom; the board shrinks first.
- **States:**
  - stars 1 / 2 / 3;
  - a "Best: 3 stars" line when `bestStars > stars`;
  - the milestone line "Milestone · first legend lesson finished", only when this is the member's first completed lesson (derived; persisted milestones are P10's);
  - next lesson present ("Next Lesson: Anderssen's Immortal Game", D8-11), or last lesson ("You finished every Morphy lesson" + "Back to Legend Lessons");
  - 3 stars hides "Replay for 3 Stars";
  - "Play It Out from Move 10 vs the Engine" appears only when `Lesson.chessPositionId` is set (→ `/play/legend/<positionSlug>?entry=lesson`);
  - a direct visit without a completed run → `redirect('/learn/lessons/<slug>')`.
- **Sentence builder** (`buildCompleteSentence(results, steps)`): "You found {firstTry} of {Legend}'s {n} moves on the first try" + (hints ? " and used one hint on 16.Qb8+" / " and used {k} hints") + (shown ? "; the coach showed you {list}" : "") + ".".
- **Components:** `StarRating`, `LessonCompleteCard`, `Board` (static), `Tag`, `Button`.

### S9. Openings catalogue (P8a)

- **Routes:**
  - `/openings` (popular across families) → `WEB/app/(marketing)/(learn)/openings/page.tsx`;
  - `/openings/eco/[letter]` (`a`…`e`, `generateStaticParams`) → `WEB/app/(marketing)/(learn)/openings/eco/[letter]/page.tsx`.
  - Public and indexable. Static, tags `openings`, `openings:<letter>`.
  - `?q=` is a client island. `/openings?eco=C` redirects to `/openings/eco/c`.
- **Board:** D `DR/V3OpeningsCatalogue.dc.html` (enum `default | family`, where `family` = C · Open).
- **Layout:**
  - **D:** `MarketingTopNav` + `LearnSubNav` (Openings current) + header (eyebrow "Learn · Chess openings", h1 "Openings, by family", `SearchField`, `FamilyChips` `role=group aria-label="ECO family"`: All, A · Flank, B · Semi-open, C · Open, D · Closed, E · Indian) + count + a grid of `OpeningCard`s in a `ScrollRegion`.
  - Each `OpeningCard` shows a 56 px `MiniBoard` of the opening's final position, the name, the ECO code and "1.e4 e5 2.Nf3 Nc6 3.Bc4".
  - 48 per page, with "Load More".
  - IL: 3 columns. IP: 2. P/A: one-column rows, and the page scrolls.
- **States:**
  - `default`: the 48 most popular mainline openings;
  - `family`: one ECO letter. The chips are links, so the active one has `aria-current="page"` instead of the board's `aria-pressed`;
  - `searching`: spinner in the field; previous results kept (`placeholderData`);
  - `results`: search hits across all families, or within the family page's letter;
  - `no_results`: "No opening matches "…"" + "Clear Search" (the S5 empty pattern);
  - `loading_more`: button spinner;
  - `more_error`: inline "Couldn't load more. Try Again";
  - `rate_limited`: P1's `RetryCountdown` inline on a 429.
- **Search rules:**
  - At least 2 characters.
  - An exact ECO code ("C50") ranks first.
  - A move sequence ("e4 e5 Nf3") matches the start of the normalised line.
  - Otherwise the name must contain the query (case-insensitive).
  - The query is normalised on the client (trim, lower, collapse spaces, strip accents) so that CDN hits are maximised (§8.9).
- **Components:** `OpeningsSearch` (client island), `FamilyChips` (links), `OpeningCard`, `MiniBoard` (server, for the static page), `MiniBoardClient` (for search results: the same pure SVG renderer, no chess.js).

### S10. Opening detail (stepper) (P8a)

- **Route:** `/openings/[slug]` → `WEB/app/(marketing)/(learn)/openings/[slug]/page.tsx`.
  - Public and indexable. Static, tags `openings`, `opening:<slug>`.
  - `generateStaticParams` = the top 300 by popularity; the rest are rendered on demand (`dynamicParams = true`) from the volumes.
  - A cuid param redirects.
- **Board:** D `DR/V3OpeningDetail.dc.html` (no enum; auto-steps every 900 ms).
- **Layout:**
  - **D/IL:** `BoardStage`.
    - Top bar "Black"; the board (a read-only `StaticBoard` driven by the precomputed FEN list; no chess.js on this page); bottom bar "White" + "Move {pl} of {n}".
    - Aside: breadcrumb "Openings / C50"; h1 "Italian Game"; "C50 · Open game · 1.e4 e5 2.Nf3 Nc6 3.Bc4"; the idea paragraph (`aria-live`); the line as move buttons (`role=list`, `aria-current`); "Legends who played it" (up to 3 links to legend pages); `LessonTransport`-style controls (Start position, Previous, Next, Last, "Play the Line").
    - CTAs "Play This Opening" (members → `/play?opening=<slug>`, the legacy picker, until P9's hub ships; hidden for non-members) and "Drill the Line" (→ `/learn/openings/drill/<slug>`).
  - **P/A:** board full width, the idea, a horizontal move strip, the transport bar pinned. The CTAs sit in a two-button row above the transport.
- **States:**
  - `start` (`pl = 0`; the intro idea = the family description when there are no notes);
  - `stepping`;
  - `playing` (Pause label);
  - `end`;
  - member vs non-member CTA set (Drill stays public);
  - no `moveNotes` → the ECO family text (`lib/catalog/eco.ts`, from today's `openings/[referenceId]/page.tsx:10-16`) and "Book move" per ply;
  - no legend games → the section is hidden.
- **Keys:** roving tabindex on the move list; `Home`, `End`, `←`, `→`, `Space` play/pause, `F` flip.
- **SEO:** `LearningResource` + `BreadcrumbList` JSON-LD. The narration prose from the R2 explanation is rendered as text for crawlers.

### S11. Openings guide and the line drill (P8a; saving lights up in P8b)

- **Routes:**
  - `/learn/openings` (the guide; Part 2 embeds the Italian drill) → `WEB/app/(marketing)/(learn)/learn/openings/page.tsx`;
  - `/learn/openings/drill/[slug]` (any opening with ≥ 4 plies) → `WEB/app/(marketing)/(learn)/learn/openings/drill/[slug]/page.tsx`.
  - Public. The drill saves to the review queue only for members, and only from P8b.
- **Board:** D `DR/V3LearnOpenings.dc.html` (no enum; drilling, wrong, complete).
- **Layout:**
  - **D/IL:** `MarketingTopNav` + `LearnSubNav` (Guide: openings current) + `BoardStage`.
    - Top "Black · replies automatically"; the board; bottom "You · White" + "Move {pl} of {n}".
    - Aside: eyebrow "Guide · Openings · Part 2"; h1 "Drill the Italian"; instructions ("Play White's moves from memory. Black replies by itself. A wrong move slides back."); progress "{k} of 5 White moves" (`ProgressBar`); the idea (`aria-live`); the status (`role=status`); the "In this guide" TOC (4 parts; parts 1, 3 and 4 render as panel sections on the same page, anchors `#why`, `#drill`, `#principles`, `#leave-theory`); buttons.
  - **P/A:** board full width; progress and status under it; buttons as the bottom bar; the TOC in a `Sheet` ("In This Guide").
- **States (`LineDrill`):**

| State | UI | Exits |
|---|---|---|
| `drilling` | the user's colour to move; the other side autoplays after 400 ms | correct → next ply; wrong → `wrong` |
| `wrong` | the wrong move stays for 600 ms with red squares, status "{san} is a fine move, but it isn't the Italian. {idea}", then slides back (instantly under reduced motion) | the user retries |
| `hint` | "Show the Move" draws a blue arrow (`#0369a1`) | the move is played → `drilling` |
| `complete_member` (P8b) | "Line complete. In your review queue · {dueLabel}." (after `LRN-3`), "Study the Ideas" → S10, "Again" | Again → `drilling` (practice repeat, no reschedule) |
| `complete_saving` (P8b) | button spinner while `LRN-3` runs (≤ 1 s) | → `complete_member` / `complete_save_failed` |
| `complete_save_failed` (P8b) | "Line complete. We couldn't save it to your queue." + Retry (offline: queued in the outbox, "Saved on this device") | Retry |
| `complete_out` / `complete_none` / `complete_lapsed` | "Line complete. Start your free trial to get this line back tomorrow." or the renew copy; CTA per the visitor table; `learn_paywall_hit {surface: "drill_save"}` | — |
| `complete_local` (P8a only, members) | "Line complete." + "Again" (saving arrives with P8b) | — |
| black-side line | `userColor = 'b'`: White's first move autoplays; labels swap | — |

  - A transposing move is accepted when the resulting EPD (FEN fields 1–4) equals the expected EPD (rct-b L7).
- **Components:** `LineDrill` (`plies, userColor, ideas, onComplete`), `Board` (interactive; chess.js loads only here, through `next/dynamic` when the drill section mounts), `ProgressBar`, `GuideToc`, `MemberCta`.

### S12. Guide: learning from the legends (P8a)

- **Route:** `/learn/legends` → `WEB/app/(marketing)/(learn)/learn/legends/page.tsx`. Public, static, revalidated by tag `lessons`.
- **Board:** D `DR/V3LearnLegends.dc.html` (static).
- **Layout:** a scrolling marketing page:
  - header (eyebrow "Guide · Learning from the legends", h1);
  - the 3 steps (01 Watch, 02 Guess, 03 Play it out);
  - "Four eras, four ideas" (4 rows);
  - "Start with these five games": 5 path rows with initials, title and idea. Each links to the lesson for members, or to the legend page for others and before P8b publishes lessons;
  - CTAs "Start with the Opera Game" (`MemberCta` → `/learn/lessons/morphy-opera-game?from=guide`) and "Browse All Legends".
- **States:** visitor CTA variants. Optional per-step ticks from `LRN-1` for members are not designed and are off by default.
- **SEO:** keep the `Article` JSON-LD (`learn/legends/page.tsx:8-31`).

### S13. Lights up in earlier phases' screens (P8b; no new boards)

Every row below is the receiving side of an earlier phase's "not rendered until P8" slot (§2.4). Each is hidden while `learn-v3` is off, and also when its value is `null`, so there is never a dead link (allocation §1.2).

| # | Slot (board, state) | Owner of the slot | P8 fills it with | Target |
|---|---|---|---|---|
| L1 | **Legend lessons row** on `DR/V3TrainHub.dc.html` "Legend lessons · Morphy 2 of 5 · Tal 0 of 4" | P5 hub (`TrainToday`) | `TrainToday.lessons?: [{legendSlug, legendShort, done, total, nextSlug}]` (≤ 3 legends with progress or path lessons), from `getLessonProgressSummary(viewer)` inside P5's hub batch (one extra statement, Q-L3) | row → `/learn/lessons/<nextSlug>?from=train`, or `/legends` when nothing is next |
| L2 | **Plan step 3** "Legend lesson: Morphy's Opera Game · Development beats material · ~6 min" (`V3TrainHub`) | P5 plan builder (`PlanStep.kind = "lesson"` already exists) | `nextLessonForPlan(viewer, {focusTheme})` (§8.7). The step is omitted when it returns `null`, which keeps "0 of 2". The lesson step's `planDone` bit is set in the `LRN-2` complete transaction. | `/learn/lessons/<slug>?from=plan` |
| L3 | **Session summary card** "Legend lesson: forks in Morphy's Opera Game" on `DR/V3SessionSummary.dc.html` `default` and `DR/V3SessionPerfect.dc.html` `perfect` (**C-05**, flow edge E60) | P5 `SessionSummary.next.lesson: LessonCard \| null`, rendered by `LessonCardSlot` | `lessonCardFor(viewer, {theme: summary.themes[0]?.key, from: "summary"})` (§8.7); title "Legend lesson: {theme label, plural, lower case} in {legendShort}'s {title}" when matched by theme, otherwise "Legend lesson: {legendShort}'s {title}"; `minutes` = `round(durationSec / 60)` | `/learn/lessons/<slug>?from=summary` |
| L4 | **Caught-up card** "Legend lesson on your top theme · Morphy's Opera Game · 6 min" on `DR/V3BankCaughtUp.dc.html`, the `caughtup` state of `DR/V3BankEmpty.dc.html` / `DR/V3BankLoading.dc.html`, and `DR/V3{iPhone,Android,iPadL,iPadP}Bank.dc.html` `caughtup` (**C-06**) | P5 `BankPage.lesson: LessonCard \| null` (only when `state = "caughtup"`), rendered by `LessonCardSlot` | `lessonCardFor(viewer, {theme: bank.focusTheme.key, from: "bank"})`; title "Legend lesson on your top theme" (sub "{legendShort}'s {title} · {minutes} min"), falling back to "Legend lesson" when there is no theme match | `/learn/lessons/<slug>?from=bank` |
| L5 | **Opening lines row** "Opening lines · {n} due" (D8-10) | P5 hub | `TrainToday.openingLines?: {due, total, nextDueLabel}`; visible when `total ≥ 1` | Start → P5 `W2 POST /api/train/sessions {kind: "openings"}` (`Idempotency-Key`) → the runner with `OpeningLineItem` (S15); "Next due {label}" when nothing is due |
| L6 | **Home "Play the Opera Game"** (`new_user` Start-here card) | P5 Home (until P8: `/position/[ref]`) | the target `/play/legend/opera-game?entry=home` | S14 |
| L7 | **⌘K legends group** | P1 palette | a provider file reading `qk.catalog.legends(v)` (CAT-1, client filter) | `/legends/<slug>` |
| L8 | **Compare "Another Position"** | P3 `/review/[ref]/legend` | link target | `/legends/positions` |
| L9 | **Onboarding Done "Play Your First Legend Position"** + the Welcome and Activating asides | P4 (D4-14) | target `/play/legend/kasparov-topalov-1999?entry=onboarding`. This is play, not the detail page: the label says "Play", and the member is entitled by then. | S14 |

**Wiring without editing P5 files** (P5 final §2.2: "P8 adds a component and edits no P5 file").
- P5's builders call the provider modules `WEB/lib/train/slots/{lesson-card,plan-lesson,hub-learn}.server.ts`. P5 ships them returning `null` / `[]`.
- P8 replaces their bodies.
- If P5 did not ship the stubs, P8 adds them and inserts the one-line calls in P5's `summary.server.ts`, `bank.server.ts` and `today.server.ts`, with review by P5's owner.
- The P5 contract fields `TrainToday.lessons` and `TrainToday.openingLines` are added as `.optional()`, so P5's own tests keep passing.

### S14. Starting a legend game (entry page) (P8a)

- **Route:** `/play/legend/[slug]?entry=catalogue|detail|legend|next|home|onboarding|lesson&color=w|b` → `WEB/app/(app)/play/legend/[slug]/page.tsx`. Members only. `noindex`.
- **Behaviour:**
  - The RSC resumes an unfinished game (`redirect('/game/<ref>')`, Q-G1), or renders `StartingGame`: the board from the volume, "Starting the game…", and the engine prefetch starts.
  - The client effect sends `PLAY-1` once, with an `Idempotency-Key` kept in `sessionStorage` under `rc:start:<slug>:<entry>`, then calls `router.replace('/game/<ref>')`.
- **Errors:**
  - 402 → the global paywall reaction (`/pricing?reason=<details.reason>&redirect_url=/play/legend/<slug>`);
  - 404 → "This position isn't available any more" + "All Positions";
  - 409 `in_flight` → retry once after `retryAfterSec`;
  - 429 → `RetryCountdown`;
  - 5xx → a toast with the request id and a Try Again button.
- **Links** to this route use `prefetch={false}`, because a prefetch would compute the resume redirect for nothing.

### S15. Opening line item in the Train runner (P8b; no board; derived from `V3LearnOpenings` + `V3BankSession`)

- It runs inside P5's `TrainerShell`. The `LineDrill` board is on the left. The panel shows "Opening line · Italian Game · C50", progress, the idea, and after completion P5's grade bar with the suggested grade from P5's table (wrong move → Again, "Show the move" → Again, clean → Good).
- Grades go through `W1 POST /api/train/attempts` (the outbox), like every other item.
- The item kind on the wire is `OPENING_LINE` (P5 `TrainItem.kind`).

### S16. Weakness Profile legend lesson links (P8b; lights up P6's boards; **C-07**)

- **Slots:**
  - The legend lesson button on each top-3 row of `DR/V3WeaknessProfile.dc.html` and its 4 device boards.
  - The drill config line "Legend lesson: Tal vs Smyslov, 1959" on `DR/V3WeaknessDrill.dc.html`.
  - The week-plan rows on `DR/V3WeaknessInsufficient.dc.html`, `DR/V3WeaknessComputing.dc.html` and `DR/V3WeaknessDrill.dc.html`.
  - All of them link to `V3LessonPlayer`.
- **Data:** P6's `WEB/lib/data/weakness.ts` calls `resolveLessonForPattern(pattern): Promise<{slug, title, sub} | null>` from `WEB/lib/data/lessons-for-weakness.ts` (P6:1164). P8 replaces the stub body (§8.7): a lookup in the cached `lessonsIndex()` (tag `lessons`), with no per-call query.
- **Target:** P6's slot builds `/learn/lessons/<slug>?from=weakness`.
- **Hidden** when the resolver returns `null`, which is always the case while lessons are unpublished or `learn-v3` is off.

---

## 5. UI ↔ API data flow

These conventions come from P1 (`client-data-layer.md` §2–§4, `allocation.md` §5.4):
- First paint comes from server components calling the DAL, never `fetch('/api/…')` from the server.
- Client reads go through TanStack Query with keys from `WEB/lib/api/keys/*`.
- Mutations go through `api()`. Response schemas are passed as `devSchema(X)`, so production bundles carry no zod (AP-12).
- The global 401/402/429/503/5xx reactions live in `QueryProvider`.
- There is no polling, except P3's ETag fallback while a job runs and the tab is visible.

### 5.1 Two data planes

| Plane | Who | First paint | Cache | Client after paint |
|---|---|---|---|---|
| **Public catalogue** (S1, S2, S5, S6, S9–S12) | anyone, crawlers | static page → the volumes in `WEB/lib/data/catalog/*` (`unstable_cache` + React `cache()`, tags §8.11) | CDN HTML + Vercel Data Cache; `revalidateTag` from admin writes and `INT-R`; **no time-based revalidation** (D8-17) | islands only: search (`CAT-3`), visitor CTA (client hint, no request), member progress (`LRN-1`, private, only for the `member` hint) |
| **Member Learn** (S3, S4, S7, S8, S13–S16) | members | dynamic RSC after `requireMemberPage()` → DAL (`lib/data/learn.ts`, P2's `getGameSnapshot`) | none across requests; per-request `cache()`; lesson *content* through the cached `getLessonPayload` (shared, tagged) | local state machines (game runner, lesson player, drill) + outbox writes; P3 socket/poll for analysis |

The public pages never read `cookies()`, `headers()` or `searchParams` on the server, because that would make them dynamic. Anything per visitor is a client island with a fixed-size SSR fallback.

### 5.2 Query keys (`WEB/lib/api/keys/learn.ts`, one barrel line; client-data-layer owns the tree)

```ts
// WEB/lib/api/keys/learn.ts
export const catalogKeys = {
  legends: (v: string) => ["catalog", "legends", v] as const,                                  // CAT-1
  openings: (f: { q?: string; family?: Letter; v: string }) => ["catalog", "openings", norm(f)] as const, // CAT-3 (object form; replaces CDL's positional (q, family), consistency 8.9)
  openingIndex: (family: Letter, v: string) => ["catalog", "openingIndex", family, v] as const,  // CAT-6 (replaces P1's openingsIndex())
  opening: (slug: string, v: string) => ["catalog", "opening", slug, v] as const,                 // CAT-2
  positions: (f: { collection: string; theme?: string; q?: string; v: string }) =>
    ["catalog", "positions", norm(f)] as const,                                                   // CAT-5 (P9 hub uses it)
  position: (slug: string, v: string) => ["catalog", "position", slug, v] as const,               // CAT-4
};
export const learnKeys = {
  progress: (scope: "all" | `legend:${string}`) => ["learn", "progress", scope] as const,         // LRN-1 (CDL:343 shape)
};
```

| Key | Endpoint | `staleTime` | Focus refetch | Seeded by | Invalidated by |
|---|---|---|---|---|---|
| `catalog.legends(v)` | `GET /api/legends?v=` | ∞ (versioned) | no | — (⌘K open → fetch; prefetched on palette open) | a new `v` from the next page load |
| `catalog.openings(f)` | `GET /api/openings?q&family&cursor&v` | ∞ with `v` | no | the first page is in the static HTML for the no-query case (`initialData` from props) | a new `v` |
| `catalog.openingIndex(fam, v)` | `GET /api/openings/index?family&v` | ∞ | no | — | a new `v` |
| `catalog.opening(slug, v)` | `GET /api/openings/{slug}?v=` | ∞ | no | — (runner opening item, legacy pickers) | a new `v` |
| `catalog.position(slug, v)` | `GET /api/positions/{slug}?v=` | ∞ | no | S2/S14 props | a new `v` |
| `learn.progress(scope)` | `GET /api/learn/progress?…` | 5 min | yes | S6/S12 islands fetch after hydration; S13 seeded by the hub RSC (`HydrationBoundary`) | `LRN-2` responses `setQueryData`; `stale` on `learn.progress(*)` after a completion; cross-tab broadcast |
| `review.status(ref)` (P3 key, P3-D2) | `GET /api/review/[ref]/status` (ETag) | 0 | — | the `complete` response (`setQueryData`) | socket `analysis:*` / `compare:ready` patch it |

- `v` is the **catalogue version**: `getCatalogVersion()` combines the content hashes of the volumes (§8.10). It costs no query.
- Every static page passes `v` to its islands as a prop. Client JSON URLs therefore change whenever content changes, so they can be cached as immutable (§9.3).

### 5.3 Per screen

**S1 positions catalogue.**
- Server: `positionsVolume()` → the practice set (≤ 50 `PositionCard`s, `practiceOrder` ascending, verified, including future `availableFrom` items flagged `upcoming`) + `getCatalogVersion()`.
- Client: `PositionsBrowser` keeps `selected` (`?p=`) and `themes` (`?t=sacrifice,attack`) in the URL via `history.replaceState`. No fetch.
- Offline map: `caches.match()` per row, only in the `offline` state.
- Engine: `prefetchEngine()` for members, on CTA intent.
- No writes.

**S2 position detail.**
- Server: `getPosition(slug)` (from `positionsVolume()`; `PositionDetail`, no spoilers) + the legend links from `legendsVolume()`. `notFound()` when the position is missing, inactive or unverified.
- Client: `MemberCta`, `EnginePrefetch`.
- No writes.

**S3/S4 legend practice game.**

1. **Entry** (S14): RSC `requireMemberPage()` → `findResumableLegendGame(viewer, positionId)` (one indexed read, Q-G1) → `redirect('/game/<ref>')` or `<StartingGame position={…} entry=…/>`.
2. **Create:** `useStartLegendGame()` = `useMutation(api('/api/games', {method: 'POST', body, idempotencyKey}))`.
   - The key is read from or written to `sessionStorage['rc:start:<slug>:<entry>']` before the call, so a reload resends the same key and gets the same game (`Idempotent-Replayed: true`).
   - It is not optimistic, because it creates the ref the next route needs.
   - On success it writes `usePendingBoard.set({fen, orient})` (the P2 store that feeds the next route's skeleton, client-data-layer §3.5) and calls `router.replace('/game/' + ref)`.
   - The RSC of `/game/[ref]` reads the snapshot itself, so no query-cache entry is needed. The `sessionStorage` key is deleted after navigation.
3. **Game page:** P2's RSC snapshot (`getGameSnapshot(viewer, ref)`) now includes the `legend` block (`slug`, `heroName`, `opponentName`, `legend`, `seriesNo`, `entry`, `next`). The runner (P2's local runner) is local state; nothing goes through TanStack while playing.
4. **During play:** P2's protocol, unchanged.
   - A `localStorage['rc:bot:<ref>']` journal after each move.
   - A `PLAY-3` checkpoint by `navigator.sendBeacon` on `pagehide`, on `visibilitychange:hidden` and every 10 plies.
5. **End:**
   - The result card renders from local state immediately.
   - `PLAY-4 complete` goes through P2's outbox with retries (1 s, 4 s, 15 s).
   - Its response fills `LegendTeaser` and `next`, and calls `setQueryData(qk.review.status(ref), {analysis: {status: "queued"}})`.
   - Then P3's flow takes over. `analysis:progress {gameRef, done, total}` and `analysis:done` from the `user:<ref>` socket room patch `qk.review.status(ref)`. Without a socket, P3's ETag poll of `GET /api/review/[ref]/status` runs (2 → 4 → 8 → 15 s, visible tab only, at most 3 min).
   - On `analysis:done`: `router.prefetch('/review/<ref>')`.
   - Invalidation after complete (P2/P3 rules): `stale` on `games.list(*)`, `games.counts`, `home`; cross-tab yes.
6. **Rematch / Restart:** `useStartLegendGame()` with `{reason, parentGameRef}` and a fresh `Idempotency-Key` per target (`rc:start:<parentRef>:<reason>`), so a double click returns the same new game. Restart's server-side abort of an `IN_PROGRESS` parent is atomic with the create (§7.3).
7. **Next position:** a plain navigation to `/play/legend/<next.slug>?entry=next`; S14 does the rest.
8. **Errors:**
   - 402 → global paywall;
   - 401 → session modal (P1); in-game silent refresh (P2);
   - 404 on create → S14 "isn't available any more";
   - 422 `illegal_moves` on complete → `rejected`;
   - 429 → `RetryCountdown` on the CTA.

**S5 legends catalogue.** Server: `legendsVolume()` (≤ 60 cards). Client: `LegendsBrowser` filters in memory; the URL carries `?q=&era=` through `history.replaceState`. No request after paint.

**S6 legend detail.**
- Server: `getLegendDetail(slug)`, composed in memory from `legendsVolume()`, `lessonsIndex()` (published lessons in `legendOrder`) and `positionsVolume()` (the `legend:<slug>` set). It costs no query once the volumes are cached.
- Client: `LessonProgressIsland` → `useQuery(qk.learn.progress('legend:' + slug))`.
  - Enabled only when `useVisitor() === 'member'`. The fetch carries the session cookie; if the cookie's `exp` has passed, it first calls `getFreshSessionToken()` (D8-21).
  - While pending, the skeleton pill shows.
  - Error → the pill is hidden (`meta: {silent: true}`).

**S7 lesson player.**
- Server (dynamic): `requireMemberPage()`; `getLessonPayload(slug)` (`unstable_cache(['lesson', slug, contentVersion])`, tag `lesson:<slug>`, about 6 KB); `getLessonProgress(viewer, lessonId)` (PK read, uncached); the "lesson 2 of 5" index from `lessonsIndex()`.
- The page passes `{payload, progress, from}`. The player starts at `progress.lastPly` when `progress.contentVersion === payload.contentVersion`.
- **Writes:** `useLessonEvents(slug)` appends events to the P5/CDL outbox (`rc-outbox`, kind `lessonEvents`, key `u:<userRef>:lessonEvents`; client-data-layer:1511, consistency R-16). Each item is `{slug, runId, seq, event}`:
  - `start {resume, contentVersion}` on the first Play or the first board interaction of a run;
  - `checkpoint {ply, result: first_try|after_wrong|hint|shown}` when a checkpoint resolves;
  - `position {ply}` every 5 plies watched (coalesced: only the latest is kept);
  - `complete {hints, shown, firstTry, durationMs}` at `done`.
- **Flush policy:** immediately after a `checkpoint` or `complete` is queued; on `pagehide` / `visibilitychange:hidden` via `sendBeacon` (`text/plain` JSON); otherwise after 30 s idle.
  - The flusher groups the items by slug. One flush = one `POST /api/learn/lessons/{slug}/progress` per slug, with up to 20 ordered events.
  - It uses the same Web Lock as the attempts flusher (`rc-outbox:<userRef>`).
  - It is optimistic: the UI never waits, except for "Finish Lesson", which awaits the flush of `complete` (3 s timeout) before navigating to S8 with `?run=<runId>`.
- **Response handling:** `setQueryData(qk.learn.progress('legend:' + legendSlug), merge)` and `('all')`; `stale` on `qk.train.today()` and `qk.home()`; `BroadcastChannel('rc-sync')` tells other tabs to mark the same keys stale.
- **Errors:**
  - 409 `conflict {reason: "content_version_mismatch"}` → the toast "This lesson was updated. Reloading…" and `router.refresh()`;
  - 402 → paywall, with the queued items kept (P5 outbox rule);
  - offline → the queued events stay, and the `saving_offline` overlay shows at `done`.

**S8 lesson complete.**
- Server: `requireMemberPage()`; `getLessonProgress(viewer, lessonId)`.
- If `progress.runCompletedAt` is null and `runId` matches → `redirect` to the player.
- Otherwise it renders from the row (stars, best, the checkpoints JSON for the sentence) + `nextLesson(viewer, lesson, from)` + the derived milestone (`completedLessonsCount === 1`). No client fetch.

**S9 openings catalogue.**
- Server: `/openings` → `listOpenings({popular: true, limit: 48})`; `/openings/eco/[letter]` → `listOpenings({family, limit: 48})`. Both read the volumes and return `{items, nextCursor}` + `v`.
- Client, `OpeningsSearch`:
  - **search:** `useQuery({queryKey: qk.catalog.openings({q, family, v}), queryFn: ({signal}) => api('/api/openings', {query, signal, schema: devSchema(OpeningPage)}), enabled: q.length >= 2, placeholderData: keepPreviousData, staleTime: Infinity})`. The input is debounced 200 ms (client-data-layer:621), and an `AbortSignal` cancels stale requests.
  - **load more:** `useInfiniteQuery` on the same key without `q`, with `initialData` = the static page's first 48 + `nextCursor`.
  - A 429 shows `RetryCountdown` inline (`meta: {inline429: true}`).

**S10 opening detail.**
- Server: `getOpeningDetail(slug)` = `openingSlugIndex()` → letter → the `openingsVolume(letter)` row.
- `plies {san[], uci[], fens[]}` are computed with chess.js inside the cached loader, not stored.
- Plus `moveNotes`, up to 3 "legends who played it" (in memory from `positionsVolume()`, by `ecoCode`), and the explanation prose from R2 (`fetch(explanationUrl, {next: {tags: ['opening:' + slug]}})`).
- Client: `OpeningStepper` is pure local state (no fetch). "Play This Opening" is a link.

**S11 drill.**
- Server: `getDrill(slug)` (cached): `{plies, ideas, userColor, startFen}`.
- Client: `LineDrill` runs locally. At completion:
  - **member (P8b):** `useMutation(api('/api/learn/openings/{slug}/drill', {body: {clientAttemptId, mistakes, hintsUsed, timeMs, reviewedAt}}))`, with `clientAttemptId = crypto.randomUUID()` per run.
    - Offline: the item is queued in the outbox (kind `openingDrills`, key `u:<userRef>:openingDrills`) and the UI says "Saved on this device".
    - Response → `dueLabel`; `stale` on `qk.train.today()`.
  - **`out` / `none` / `lapsed`:** no call; the CTA is shown.
  - A 402 for a member whose claim is stale is handled inline (`meta: {inline402: true}`): the page shows the CTA instead of redirecting away from a public page.

**S12 legends guide.** Static; `MemberCta` only.

**S13 lights up.** P5's hub RSC already prefetches `qk.train.today()`. The P8 provider modules (S13 wiring) add `lessons` and `openingLines` server-side in the same batch, so there is no extra request. The summary and bank pages get `lesson` inside their existing payloads.

**S15 opening line item.** P5's runner renders `OpeningLineItem` for items with `kind: "OPENING_LINE"`.
- The item's snapshot (`fen`, `solution`, `orient`) comes in the session payload.
- The ideas text comes from `qk.catalog.opening(slug, v)` (CAT-2, immutable), prefetched 2 items early with the rest of the session.
- Grades go through P5's `W1` (outbox, optimistic).

**S16 weakness links.** Server-only, inside P6's `getWeaknessProfile` (no client call).

### 5.4 Prefetching summary

| Trigger | Prefetch |
|---|---|
| Hover or focus on a member Play CTA (S1, S2, S6), or 3 s idle on S2 | `prefetchEngine()` (P2: `<link rel=prefetch>` of the hashed WASM) |
| S14 mount | `prefetchEngine()` immediately |
| Result card after `analysis:done` | `router.prefetch('/review/<ref>')` |
| Hover on "Compare with …" | **nothing.** P3's A9 GET can enqueue `LEGEND_COMPARE` (P3:631), and AP-09 bans that from hover. Once P3 moves the enqueue to a POST, `router.prefetch('/review/<ref>/legend')` may be added. |
| ⌘K open | `queryClient.prefetchQuery(qk.catalog.legends(v))` |
| Lesson complete page | `<Link prefetch>` on "Next Lesson" (RSC payload ≤ 10 KB) |
| Opening session (S15) | `qk.catalog.opening` for the next 2 items |
| Catalogue cards and rows | Next's default viewport prefetch for the static pages (free), **except** links to `/play/legend/*` (`prefetch={false}`) |

---

## 6. Data model (migrations M8 and M8b)

Everything is additive. Names follow `data-model.md` §5.9 (`data-model.md:1560-1650`, the learn part of its "M8"; its tournament part ships in P12's M12), the consistency rulings and the shipped P2/P5 schemas. Differences from data-model are marked **[P8]** with the reason.

### 6.1 Prisma changes (`DB/prisma/schema.prisma`)

```prisma
/// M8 (P8a). Lesson lifecycle per member. Created with its table; first written by P8b (two-release rule holds).
enum LessonStatus {
  NOT_STARTED
  IN_PROGRESS
  COMPLETED
}

// M8b (P8b), its own migration file, before anything writes it (P5 created the enum in M5):
// enum SessionKind { DAILY BANK PUZZLES WEAKNESS PRACTICE OPENINGS }   // [P8] D8-10; wire "openings"

model Game {
  // ...P2 columns (P2 §6.2)...
  /// M8 (P8a). Rematch/restart series number; 1 for new/next (consistency 8.2; P2:1019 lists it as M8)
  seriesNo Int @default(1) @db.SmallInt
}

model Legend {
  // ...existing columns (schema:231-274)...
  // M8 (P8a)
  slug            String?  @unique @db.VarChar(80)   // "paul-morphy" (B3)
  /// romantic | classical | soviet | modern (B3 maps the 6 free-text eras)
  eraKey          String?  @db.VarChar(16)
  /// "Attack" | "Sacrifice" | "Endgames" | "Preparation" | "Precision" | "Dynamic"
  styleTag        String?  @db.VarChar(16)
  birthPlace      String?  @db.VarChar(60)          // "New Orleans"
  bio             String?  @db.VarChar(700)         // V3LegendDetail paragraph
  /// Lichess theme keys + "development", "openLines" (research R-THM-07)
  themes          String[] @default([])
  /// [P8] D8-18 / LIC-6. profilePhotoUrl is rewritten by B12 to the R2 URL (or NULL); P12's admin keeps reading it.
  portraitSource  String?  @db.VarChar(300)         // source page URL (Wikimedia file page, …)
  portraitLicence String?  @db.VarChar(40)          // "PD" | "CC-BY-SA-4.0" | "CC-BY-2.0" …
  portraitCredit  String?  @db.VarChar(160)         // attribution line rendered in a figcaption
  lessons         Lesson[]
}

model ChessPosition {
  // ...existing columns (schema:172-229)...
  // M8 (P8a) legend practice and catalogue
  slug                String?   @unique @db.VarChar(80)   // "kasparov-topalov-1999", "opera-game"
  title               String?   @db.VarChar(80)           // "Opera Game, move 10"
  blurb               String?   @db.VarChar(280)
  year                Int?      @db.SmallInt
  eventRound          String?   @db.VarChar(24)           // "Round 4"
  /// 'w' | 'b': the side the member plays (the legend's side)
  heroSide            String?   @db.Char(1)
  /// display themes: sacrifice | attack | endgame (+ Lichess keys later)
  themes              String[]  @default([])
  ecoCode             String?   @db.VarChar(3)
  openingName         String?   @db.VarChar(80)
  defaultInitialSec   Int?      @db.SmallInt              // 300
  defaultIncrementSec Int?      @db.SmallInt              // 3
  /// SPOILER: the move played from this FEN in the real game. Never serialised before the game ends.
  legendMoveUci       String?   @db.VarChar(5)
  legendMoveSan       String?   @db.VarChar(10)
  /// [P8] full move number at which the source game ended in mate, else NULL ("just like Morphy"); computed by verify
  legendMateMove      Int?      @db.SmallInt
  /// LegendNotesV1 [{ply, text, verified}]
  legendNotes         Json?
  /// Ply number of `fen` = (fullmove − 1) × 2 + (b to move ? 1 : 0)
  startPly            Int?      @db.SmallInt
  /// [P8] space-separated SAN of plies 1..startPly, computed by verifyPosition() (never authored).
  /// Lets the positions volume and P2's game creation show "Game starts here" with no PGN replay (AP-16: one string).
  prefixSans          String?   @db.VarChar(2400)
  /// Order inside the one legend-practice set (D8-2); NULL = not in the set
  practiceOrder       Int?      @db.SmallInt
  availableFrom       DateTime?
  /// Set by verifyPosition() when the PGN replays to the FEN and the legend move is the next move
  verifiedAt          DateTime?
  verifiedById        BigInt?                             // plain column (admin user id), no FK
  /// D8-7 (ADD COLUMN IF NOT EXISTS: P3's M3 creates them)
  hasExplanation      Boolean   @default(false)
  explanationUrl      String?   @db.VarChar(300)
  lessons             Lesson[]
}

model Opening {
  // ...existing columns (schema:276-301)...
  // M8 (P8a)
  slug           String?  @unique @db.VarChar(100)   // "italian-game", "italian-game-c53" on collision (D8-5)
  /// Rated blitz+rapid games at 1600–2200 reaching this line's final EPD in the CC0 dump sample (J8, D8-19); 0 until J8 runs
  popularity     Int      @default(0)
  /// [P8] true when this row owns the bare slug for its name (shortest line); the catalogue grid lists only these
  isMainline     Boolean  @default(true)
  /// MoveNotesV1 ["1.e4 takes the centre…", …] aligned to the drill line (top ~150 openings)
  moveNotes      Json?
  /// [P8] space-separated UCI teaching line from the start position, extending `pgn`. NULL = use `pgn`.
  drillLine      String?  @db.VarChar(240)
  hasExplanation Boolean  @default(false)            // IF NOT EXISTS (M3)
  explanationUrl String?  @db.VarChar(300)           // IF NOT EXISTS (M3)
}

/// M8 (P8a). Authored legend lesson. Steps are rows (D8-3). Identical to data-model:1564 except the noted lengths.
model Lesson {
  id              BigInt           @id @default(autoincrement())
  referenceId     String           @unique @default(cuid())
  slug            String           @unique @db.VarChar(80)        // "morphy-opera-game"
  legendId        BigInt
  /// The matching "Positions to play" row, for "Play it out from move 10"
  chessPositionId BigInt?
  legendOrder     Int              @db.SmallInt                   // "lesson 2 of 5"
  pathOrder       Int?             @db.SmallInt                   // the global five-game path (V3LearnLegends)
  title           String           @db.VarChar(80)                // "The Opera Game"
  idea            String           @db.VarChar(120)               // "Development beats material"
  themes          String[]         @default([])                   // Lichess theme keys: links weakness/bank/summary → lesson
  event           String           @db.VarChar(80)
  year            Int              @db.SmallInt
  whiteName       String           @db.VarChar(40)
  blackName       String           @db.VarChar(40)
  legendColor     String           @db.Char(1)
  /// Verified full game score: the source of truth for the steps
  pgn             String           @db.Text
  startPly        Int              @db.SmallInt                   // 18 in the Opera Game
  endPly          Int              @db.SmallInt                   // 33
  playItOutPly    Int?             @db.SmallInt
  intro           String           @db.Text
  story           String           @db.Text
  outro           String           @db.Text
  audioUrl        String?          @db.VarChar(300)               // OD-4; NULL in v1
  alignmentUrl    String?          @db.VarChar(300)               // ExplanationAlignment JSON on R2
  durationSec     Int              @db.SmallInt
  isPublished     Boolean          @default(false)
  contentVersion  Int              @default(1) @db.SmallInt
  verifiedAt      DateTime?
  createdAt       DateTime         @default(now())
  updatedAt       DateTime         @updatedAt
  legend          Legend           @relation(fields: [legendId], references: [id], onDelete: Restrict)
  chessPosition   ChessPosition?   @relation(fields: [chessPositionId], references: [id], onDelete: SetNull)
  steps           LessonStep[]
  progress        LessonProgress[]

  @@unique([legendId, legendOrder])
  @@index([isPublished, pathOrder])
  @@map("lessons")
}

/// M8. [P8] One row per ply in (startPly, endPly] (data-model says [startPly, endPly]: the start position is the lesson's startFen, not a step).
model LessonStep {
  lessonId    BigInt
  ply         Int     @db.SmallInt
  san         String  @db.VarChar(10)
  uci         String  @db.VarChar(5)
  fenAfter    String  @db.VarChar(100)
  narration   String? @db.VarChar(600)
  checkpoint  Boolean @default(false)
  prompt      String? @db.VarChar(300)
  hint        String? @db.VarChar(300)
  correctText String? @db.VarChar(400)
  /// "best" | "brilliant" | "great_find" (the owner's board_icons)
  badge       String? @db.VarChar(32)
  /// Space-separated UCI also accepted at a checkpoint (build-checked within 2 Win% of the legend move)
  alsoAccept  String? @db.VarChar(60)
  lesson      Lesson  @relation(fields: [lessonId], references: [id], onDelete: Cascade)

  @@id([lessonId, ply])
  @@map("lesson_steps")
}

/// M8. PK (userId, lessonId). [P8] = data-model + contentVersion, runId, lastSeq, runCompletedAt (D8-4).
model LessonProgress {
  userId         BigInt
  lessonId       BigInt
  status         LessonStatus @default(NOT_STARTED)
  lastPly        Int?         @db.SmallInt
  contentVersion Int          @default(1) @db.SmallInt
  bestStars      Int          @default(0) @db.SmallInt
  lastStars      Int          @default(0) @db.SmallInt
  attempts       Int          @default(0) @db.SmallInt
  /// {"25":"first_try","31":"hint","33":"first_try"} for the current run
  checkpoints    Json?
  runId          String?      @db.Uuid
  lastSeq        Int          @default(0) @db.SmallInt
  runCompletedAt DateTime?
  startedAt      DateTime     @default(now())
  completedAt    DateTime?
  updatedAt      DateTime     @updatedAt
  user           User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  lesson         Lesson       @relation(fields: [lessonId], references: [id], onDelete: Cascade)

  @@id([userId, lessonId])
  @@map("lesson_progress")
}

// User gains: lessonProgress LessonProgress[]
```

**JSON registry additions** (`DB/src/json/*.ts`, zod with `v: 1`):

| File | Shape | Limit |
|---|---|---|
| `legend-notes.ts` | `LegendNotesV1` | ≤ 4 KB |
| `move-notes.ts` | `MoveNotesV1`, an array of strings of ≤ 200 chars aligned to the line | ≤ 4 KB |
| `lesson-checkpoints.ts` | `{[ply]: 'first_try'\|'after_wrong'\|'hint'\|'shown'}` | ≤ 500 B |

`game-meta.ts` (P2's `GameMetaV1`, P2:1024) gains **optional** keys only:
- `entry?: 'catalogue'|'detail'|'legend'|'next'|'home'|'onboarding'|'lesson'|'playhub'`;
- `restarted?: boolean` (a `LEGEND_BOT` parent aborted by Restart).

Older readers strip unknown keys (zod non-strict), so no reader breaks during a rollback (feasibility §9 rule 2). P8 adds **no** enum value to `abortedBy`. A restart sets `abortedBy` to the member's colour.

**Global Prisma `omit`** (`WEB/lib/prisma.ts`; data-model convention 10, optimization:298): `chessPosition.explanation`, `opening.explanation`. `lesson.pgn` is not omitted, because the build script and the payload loader read it.

**Not added by P8:** `ChessPosition.status` / `PositionStatus`. P12 owns them (P12:774). Contract with P12 (consistency R-02): every P8 catalogue query filters `"isActive"`, so P12's archive must set `status = 'ARCHIVED'` **and** `"isActive" = false` in one statement, and publishing sets both back.

### 6.2 Raw SQL and indexes (hand-added to M8; listed in `DB/prisma/protected-indexes.txt`)

```sql
SET lock_timeout = '5s';
CREATE INDEX IF NOT EXISTS chess_positions_practice_idx
  ON chess_positions ("practiceOrder") WHERE "practiceOrder" IS NOT NULL AND "isActive";
CREATE INDEX IF NOT EXISTS chess_positions_featured_recent_idx
  ON chess_positions ("createdAt" DESC) WHERE featured AND "isActive";
```

| Index | Kind | Query it serves (§9.2) |
|---|---|---|
| `legends_slug_key`, `chess_positions_slug_key`, `openings_slug_key`, `lessons_slug_key` | unique (Prisma) | slug uniqueness; `getPositionForPlay(slug)` (Q-C4); `getLessonPayload(slug)` (Q-L1) |
| `chess_positions_practice_idx` (raw, data-model:1762) | partial | the volume's practice ordering; the PLAY-1 "next" fallback |
| `chess_positions_featured_recent_idx` (raw, data-model:1761) | partial | featured ordering (the same index optimization:405 lists; `IF NOT EXISTS`) |
| existing `chess_positions_whitePlayerId_idx` / `_blackPlayerId_idx` (schema:226-227) | b-tree | the legends volume's position counts |
| `lessons_legendId_legendOrder_key` | unique | the lessons index ordering; "next lesson by legend order" |
| `lessons_isPublished_pathOrder_idx` | b-tree | Q-L4 next path lesson |
| `lesson_steps_pkey (lessonId, ply)` | PK | Q-L1 steps range scan ordered by ply |
| `lesson_progress_pkey (userId, lessonId)` | PK | Q-L2 resume; `LRN-2` row lock; Q-L3 summary (prefix `userId`) |
| P2 `games_open_idx` (P2:1052), `game_players_userId_endedAt_gameId_idx` (P2:1074) | partial / b-tree | Q-G1 resume an unfinished legend game |
| P5 `training_cards (userId, deck, due)` + `(userId, itemKey)` unique | — | Q-T1 opening-lines due count; `LRN-3` upsert on `itemKey = 'o_' + sqid(openingId)` |

**Deliberately not created** (data-model §8 policy):
- no `pg_trgm` GIN (D8-6: search is in memory);
- no index on `chess_positions.ecoCode`, `openings.popularity` or `lesson_progress (userId, status)`: volume builders scan ≤ 3,641 rows once per content version, and the PK prefix covers a member's ≤ 50 progress rows.

### 6.3 Migrations and safety

| Order | Folder (`DB/prisma/migrations/`; timestamps set when written) | Sub-phase | Contents | Notes |
|---|---|---|---|---|
| 1 | `<ts>_m8_learn` | P8a | `CREATE TYPE "LessonStatus"`; `ALTER TABLE games ADD COLUMN "seriesNo" smallint NOT NULL DEFAULT 1`; `ALTER TABLE legends ADD COLUMN …` (9); `ALTER TABLE chess_positions ADD COLUMN …` (22; the two explanation columns `IF NOT EXISTS`); `ALTER TABLE openings ADD COLUMN …` (7); `CREATE TABLE lessons, lesson_steps, lesson_progress` + FKs; unique indexes; the raw SQL above | Generated with `prisma migrate diff --from-migrations … --to-schema-datamodel … --shadow-database-url <local Docker Postgres 17>` (data-model §11.2), then hand-edited: `SET lock_timeout`, `IF NOT EXISTS`, the partial indexes. Every new NOT NULL column has a constant default (metadata-only on PG 17), so the previous deployment keeps inserting. All tables are under 10k rows, so no `CONCURRENTLY` is needed. |
| 2 | `<ts>_m8b_session_kind_openings` | P8b | `ALTER TYPE "SessionKind" ADD VALUE IF NOT EXISTS 'OPENINGS';` only | Own file (data-model §11.1 rule 3; a new value cannot be used in the same transaction). **Two-release rule** (feasibility §9 rule 1): the release that adds the value does not write it. `OPENINGS` sessions are created only from the next web release, behind `learn-v3`. |

- **Apply on the Neon dev branch (CLAUDE.md) with `prisma migrate deploy`**, using the direct URL.
  - This is CLAUDE.md rule 3. **No `prisma db push` against any Neon branch**, because it would drop the hand-written partial indexes (consistency R-20).
  - **Never `prisma migrate dev`** against dev or production (CLAUDE.md rules 1–2). The local Docker shadow database is the only place `migrate dev` or `diff` touches a database.
- `scripts/db/check-drift.ts` (P2) must pass, with the two partial indexes added to `protected-indexes.txt`.
- **Production** gets M8 + M8b only in P13, through `migrate deploy` after the child-branch rehearsal.
- **Rollback:** expand-only; redeploying the previous web build is enough. No down migration.
- **Contract step C5** (data-model §5.11): drop `chess_positions.explanation` and `openings.explanation` after B4's SHA-256 check passes on production, one release after P13. This is destructive, so **the owner confirms explicitly** (CLAUDE.md rule 5: "This command may drop data. Are you sure?"). P8 only adds the reads that make C5 safe.

### 6.4 Backfills and content scripts (`WEB/scripts/backfill/*.ts`, `WEB/scripts/{lessons,openings,content}/*.ts`)

All of them follow data-model §11.6:
- `--dry-run` by default; `--apply` writes;
- batches of 500 by id, with an idempotent predicate;
- they refuse to run unless the `DATABASE_URL` host is in `BACKFILL_ALLOWED_HOSTS`;
- one `audit_logs` row (`SYSTEM`, `backfill.<name>`). The table exists from M4 (consistency R-04, 8.11);
- after `--apply`, `POST /api/internal/revalidate` with the tags they touched.

| ID | Script | Source → target | Predicate | Verification |
|---|---|---|---|---|
| B3 (P8 part) | `backfill/catalog-keys.ts` | **Legends:** `slug = slugify(name)` ("Paul Morphy" → `paul-morphy`; collisions `-2`); `eraKey` from `era` (Romantic Era → romantic; Classical Era, Hypermodern Era → classical; Soviet Era → soviet; Modern Era, Contemporary Era → modern; unknown → NULL + report). **Positions:** the practice set comes from B11. Others get `slugify("<white> <black> <year>")` from `whitePlayerName`, `blackPlayerName`, `eventDate`, deduped with `-2`; then `verifyPosition()` with the row's own PGN fills `startPly`, `prefixSans`, `legendMove*`, `ecoCode`, `legendMateMove`, `verifiedAt`. **Openings:** group by `name`. The row with the fewest plies (`moveCount`), then the lowest `eco`, then the lowest id gets `slugify(name)` and `isMainline = true`. The others get `slugify(name)-<eco lowercase>` (then `-2`) and `isMainline = false`. | `slug IS NULL` | the unique indexes hold; every active row has a slug; `count(*) WHERE "isMainline"` = the number of distinct names |
| B4 | `backfill/explanations-to-r2.ts` | `chess_positions.explanation`, `openings.explanation` → R2 `explanations/{position\|opening}/{referenceId}.v1.json` (`Content-Type: application/json`, `Cache-Control: public, max-age=31536000, immutable`); sets `explanationUrl` and `hasExplanation = true` | `explanation IS NOT NULL AND "explanationUrl" IS NULL` | SHA-256 of the canonical DB JSON = SHA-256 of the R2 object (re-downloaded); `count(hasExplanation)` = `count(explanation IS NOT NULL)` |
| B11 | `backfill/legend-practice-seed.ts` | Upsert by `fen` the 7 design positions (§6.6) with slugs, titles, blurbs, themes, hero side, time controls, `practiceOrder` (KT 1, BF 2, AK 3, TS 4, Opera 5; legend-detail positions NULL) and legend links. Then call `verifyPosition()` with the **trusted** source PGN from `WEB/content/positions/sources/<slug>.pgn`, whose header `[Source "…"]` records where it came from. | upsert by `fen` | `verifiedAt` set for all 7; `legendMoveUci` equals the next move of the source PGN; a position failing verification is written with `isActive = false` and reported |
| B12 [P8] | `backfill/legend-portraits.ts` (D8-18) | For each visible legend, from `WEB/content/legends/portraits.json` (`{slug, sourceUrl, licence, credit}`, owner-reviewed): download the file, check the licence is in the allow-list (`PD`, `CC0`, `CC-BY-*`, `CC-BY-SA-*`), resize to 96 and 256 px WebP (sharp, laptop), upload to R2 `legends/<slug>/portrait-<sha8>-{96,256}.webp` (immutable), set `profilePhotoUrl` (the 256 URL), `portraitSource`, `portraitLicence`, `portraitCredit`. A legend with no allowed entry gets `profilePhotoUrl = NULL` (initials). | the file changed or the URL is not on the media host | every non-NULL `profilePhotoUrl` starts with `NEXT_PUBLIC_MEDIA_URL`; every one has a licence and a credit |
| J7 | `lessons/build.ts` | `WEB/content/lessons/<slug>.json` (authored: metadata, `checkpoints[{ply, prompt, hint, correctText, badge, alsoAccept?}]`, `narration{ply: text}`, intro, story, outro) + `WEB/content/lessons/sources/<slug>.pgn` → `lessons` + `lesson_steps` in one transaction per lesson (delete + insert the steps; `contentVersion + 1` when anything changed) | the computed lesson row or any computed step differs, field by field, from the stored one | the §8.6 checks; `revalidateTag('lesson:<slug>', 'lessons', 'legend:<legendSlug>')` |
| J8 | `openings/popularity.ts` + `openings/enrich.ts` (D8-19) | **Popularity:** `zstd -dc lichess_db_standard_rated_<yyyy-mm>.pgn.zst \| tsx WEB/scripts/openings/popularity.ts --stdin --max-games 3000000`. It keeps games whose `WhiteElo` and `BlackElo` are both in 1600–2200 and whose `TimeControl` is blitz or rapid (base ≥ 180 s), replays the first 24 plies, and counts each EPD hit against a hash set of every mainline's final EPD. The output `content/openings/popularity.<yyyy-mm>.json` (CC0, committed) is applied with `--apply`. Fallback (owner's choice): the owner's scope-less token against `https://explorer.lichess.org/lichess` at ≤ 1 request/s with a 60 s back-off. **Notes:** `drillLine` + `moveNotes` for the curated top openings from `WEB/content/openings/notes/<slug>.json` (an LLM draft is allowed, human-reviewed; R-CO-03: names only from the ECO table). | `popularity = 0`, or the file changed | `drillLine` starts with `pgn`'s UCI and replays legally; `moveNotes.length` = plies |

`WEB/content/**` is new and holds only public content (game scores are facts; the prose is ours). The R2 bucket is the existing media bucket (`NEXT_PUBLIC_MEDIA_URL`, `WEB/lib/media.ts`). Scripts run on a laptop or in CI, never on Vercel.

### 6.5 Storage

| Item | Size | Note |
|---|---|---|
| `lessons` + `lesson_steps` | 10 lessons × ≈ 30 steps × ≈ 700 B ≈ 0.2 MB | narration ≤ 600 chars |
| `lesson_progress` | ≈ 110 B per row; 100 members × 10 lessons ≈ 0.1 MB | — |
| new `openings` columns | 3,641 × ≈ 60 B + 150 × ≈ 3 KB of notes ≈ 0.7 MB | — |
| new `chess_positions` columns | ≤ 500 × ≈ 700 B (including `prefixSans`) ≈ 0.35 MB | — |
| `games."seriesNo"` | 2 B per row | — |
| B4 | **removes** explanation reads from Neon egress; storage drops only after C5 | — |
| R2 portraits | ≤ 60 × 2 files × ≈ 15 KB ≈ 2 MB | R2 Free 10 GB |

The total is under 2 MB of the 1 GB Neon Free budget.

### 6.6 Dev seed (`WEB/prisma/seed/content.ts`, extended; the dev branch only)

- **Legends** (P1 seeds 6): add slug, `eraKey`, `styleTag`, `birthPlace`, `bio` and `themes` for Morphy, Anderssen, Kasparov, Fischer, Tal and Capablanca. Add Shirov and Botvinnik if they are absent, so the four eras and the `filtered` state (Soviet → 2) have data.
- **Positions** (B11 data, verified with the §12.4 fixtures):

| Slug | FEN | Hero | TC | Legend move | Order | Themes |
|---|---|---|---|---|---|---|
| `kasparov-topalov-1999` | `b2r3r/k4p1p/p2q1np1/NppP4/3p1Q2/P4PPB/1PP4P/1K1RR3 w - - 1 24` | w (Kasparov) | 5+3 | 24.Rxd4 (`d1d4`) | 1 | sacrifice |
| `byrne-fischer-1956` | `r3r1k1/pp3pbp/1qp3p1/2B5/2BP2b1/Q1n2N2/P4PPP/3R1K1R b - - 3 17` | b (Fischer) | 5+3 | 17…Be6 (`g4e6`) | 2 | sacrifice |
| `anderssen-kieseritzky-1851` | `rnb1k1nr/p2p1ppp/8/1pbN1N1P/4PBP1/3P1Q2/PqP5/R4KR1 w kq - 0 18` | w (Anderssen) | 10+0 | 18.Bd6 (`f4d6`) | 3 | attack |
| `topalov-shirov-1998` | `8/8/4kpp1/3p1b2/p6P/2B5/6P1/6K1 b - - 0 47` | b (Shirov) | 3+2 | 47…Bh3 (`f5h3`) | 4 | endgame |
| `opera-game` | `rn2kb1r/p3qppp/2p2n2/1p2p1B1/2B1P3/1QN5/PPP2PPP/R3K2R w KQkq - 0 10` | w (Morphy) | 5+3 | 10.Nxb5 (`c3b5`) | 5 | attack |
| `morphy-anderssen-1858-game-9` | `r1bq1b1r/ppN2kpp/5N2/3pp3/2BnP3/4pQ2/PPP2PPP/R3K2R w KQ - 0 14` | w (Morphy) | 10+0 | from the trusted source PGN | — | attack |
| `paulsen-morphy-1857` | `4r1k1/p1pb1ppp/Qbp1r3/8/1P6/2Pq1B2/R2P1PPP/2B2RK1 b - - 0 17` | b (Morphy) | 5+3 | 17…Qxf3 (`d3f3`) | — | sacrifice |

- **Lessons:** `morphy-opera-game`, complete from the design.
  - Source: `DR/V3LessonPlayer.dc.html` `_rv0`. `GU = [24, 30, 32]` → checkpoint steps at plies 25, 31 and 33 in step numbering (the move *after* 24, 30 and 32 plies). Narration `NA`, prompts `PR`, hints `HI`, badge `brilliant` on 16.Qb8+.
  - `legendOrder 2`, `pathOrder 1`, `chessPositionId` → `opera-game`, `playItOutPly 18`.
  - It stays **unpublished in P8a**: the build runs with `--reviewed-by` but without `--publish`. It is published on dev when P8b's player ships.
  - The other Morphy lessons and the four other path lessons come from the WP-C content PRs (§13) and are published on dev as each passes J7 and the chess review.
- **Openings:** `italian-game` gets `drillLine = "e2e4 e7e5 g1f3 b8c6 f1c4 f8c5 c2c3 g8f6 d2d4 e5d4"` and the 10 `moveNotes` from `DR/V3LearnOpenings.dc.html` (`IDEAS`).
- **Persona writers** (`WEB/e2e/personas/p8.ts`, called by P1's `scripts/dev/personas.ts --reset <pool user> --persona <name>`; X4):

| Persona | State |
|---|---|
| `learn-fresh` | entitled member, no lesson rows, no opening cards, no unfinished legend game |
| `learn-lesson-progress` | Opera Game COMPLETED with 2 stars; Morphy–Anderssen IN_PROGRESS at ply 20 |
| `learn-opening-due` | one `OPENING` card for `italian-game` with `due = $now − 1 h` |
| `learn-legend-unfinished` | one `IN_PROGRESS` `LEGEND_BOT` game on `kasparov-topalov-1999` at ply +4 |
| `learn-caughtup-fork` | P5's `caughtup` bank state with `focusTheme = fork` (for L4) |

- **Old-prod content copy** (data-model §13.2 `scripts/content/export-content.ts`): P1 codes it but does not run it. Running it gives dev the 51 real legends and their positions, and needs the owner's explicit approval (OD-6).

---

## 7. API

Every route is a `route()` handler (P1 F1, api-design §2.5). Each one has:
- zod-parsed input;
- the `{data, meta?}` / `{error: {code, message, details?, retryAfterSec?, requestId}}` envelope;
- a Sentry span `api <id>`;
- `Server-Timing` with DB time and query count;
- `export const maxDuration = 10`;
- the services take `ctx.now` (X5; `x-rc-now` is honoured only in non-production builds with `x-e2e-token`).

Common errors are implied and not repeated: `invalid_json`, `validation_failed` (400), `payload_too_large`, `internal`, `unavailable`, `maintenance`, `upgrade_required`; `unauthorized` for signed-in routes; `402 subscription_required {reason: trial_available|trial_used|expired|payment_failed|paused}` for member routes (consistency R-06); `rate_limited` where a bucket applies.

Every code and conflict reason lives in `CT/http/codes.ts`. P8 registers two conflict reasons, `content_version_mismatch` and `drill_not_available`, in `CONFLICT_REASONS` (R-06). P8 uses no `bad_request` and no `membership_ended`.

Schemas live in `CT/http/{catalog,learn}.ts` (new) and `CT/http/games.ts` (P2's file; P8 adds to it). WP-1 owns the new files (§13).

### 7.0 Id map (inventory → final)

| Inventory id | Final | Path |
|---|---|---|
| play-b A1, A2; PA `/api/positions/featured`, `/search`; CDL `GET /api/positions/search` | `CAT-5` | `GET /api/positions` |
| play-b A3 | `CAT-4` | `GET /api/positions/{slug}` |
| rct-b R7; inv-pub and CDL `/api/openings/search` | `CAT-3` | `GET /api/openings` |
| optimization `/api/catalog/openings?v=`; P1 A4 `OpeningsIndexData` | `CAT-6` [P8 id] | `GET /api/openings/index` |
| optimization `/api/catalog/legends?v=` | `CAT-1` | `GET /api/legends` |
| — | `CAT-2` | `GET /api/openings/{slug}` |
| rct-b R6 / W10 / W11 | `LRN-1` / `LRN-2` / `LRN-3` | `/api/learn/…` |
| play-b A4 / A8 | `PLAY-1` / `PLAY-4` (legend extensions of P2 §7.1.1 / §7.1.4) | `POST /api/games`, `…/complete` |
| play-b A19 | `ADM-5` | `POST /api/admin/positions/{slug}/verify` |
| — | `ADM-6` (GET half only, early) | `GET /api/admin/legends` |
| — | `INT-R` [P8] | `POST /api/internal/revalidate` |

### 7.1 Shared schemas (`CT/http/catalog.ts`)

```ts
import { z } from "zod";
import { Slug, Cursor, Limit, Color, TimeControl } from "./common";

export const CatalogVersion = z.string().regex(/^[0-9a-f]{8}$/);
export const EraKey = z.enum(["romantic", "classical", "soviet", "modern"]);
export const Letter = z.enum(["a", "b", "c", "d", "e"]);
export const PositionTheme = z.string().regex(/^[a-z][a-zA-Z]{2,30}$/);   // open set: sacrifice | attack | endgame | Lichess keys

export const LegendCard = z.object({
  slug: Slug, name: z.string().max(60), initials: z.string().max(3),
  years: z.string().max(16),                 // "1837–1884" | "born 1963"
  living: z.boolean(),                       // D8-18: "Play This Position" copy
  eraKey: EraKey.nullable(), style: z.string().max(16).nullable(),
  portrait: z.object({ url96: z.string().url(), url256: z.string().url(), credit: z.string().max(160) }).nullable(),
  positionsCount: z.number().int().nonnegative(), lessonsCount: z.number().int().nonnegative(),
  playSlug: Slug.nullable(),                 // first playable position (S6 "Play as …", P9 hub)
});

export const PositionCard = z.object({
  slug: Slug, white: z.string(), black: z.string(), event: z.string().nullable(), year: z.number().int().nullable(),
  fen: z.string().max(100), sideToMove: Color, heroSide: Color,
  themes: z.array(PositionTheme).max(8), blurb: z.string().max(280).nullable(),
  tc: TimeControl, label: z.string().max(160),     // a11y: "Kasparov vs Topalov, Wijk aan Zee 1999. White to move."
  availableFrom: z.string().datetime().nullable(), // future → hidden until then (D8-17)
});

export const PositionDetail = PositionCard.extend({
  title: z.string().max(80).nullable(), round: z.string().max(24).nullable(),
  ecoCode: z.string().length(3).nullable(), openingName: z.string().max(80).nullable(),
  legendRefs: z.object({ white: z.object({ slug: Slug, name: z.string(), living: z.boolean() }).nullable(),
                         black: z.object({ slug: Slug, name: z.string(), living: z.boolean() }).nullable() }),
  prefixSans: z.string().max(2400), startPly: z.number().int().min(0),     // AP-16: one string, not an array
  hasExplanation: z.boolean(),
});
// Neither DTO has legendMoveUci/legendMoveSan/legendMateMove/pgn: catalog.test.ts asserts the keys are absent (§12.1).

export const OpeningCard = z.object({
  slug: Slug, eco: z.string().length(3), name: z.string().max(120),
  line: z.string().max(80),                       // "1.e4 e5 2.Nf3 Nc6 3.Bc4" (first 8 plies)
  placement: z.string().max(72),                  // FEN field 1, for the client MiniBoard
  sideToMove: Color,
});

export const OpeningDetail = z.object({
  slug: Slug, eco: z.string().length(3), name: z.string(), family: Letter, fen: z.string(),
  plies: z.object({ san: z.array(z.string()), uci: z.array(z.string()), fens: z.array(z.string()) }),
  ideas: z.array(z.string().nullable()), userColor: Color, explanationUrl: z.string().url().nullable(),
});

export const LessonCard = z.object({            // = P5's slot contract {slug, title, minutes, href}; P8 adds `sub`
  slug: Slug, title: z.string().max(90), sub: z.string().max(90).optional(),
  minutes: z.number().int().min(1).max(60), href: z.string().startsWith("/learn/lessons/").max(140),
});
```

### 7.2 Public catalogue routes (auth `public`, no session read, Clerk skipped)

The tiers are the six named tiers of optimization D9 (optimization:46), implemented in P1's wrapper (api-perf drift register "Cache tier names"):
- `public-immutable` = `public, max-age=31536000, immutable`, used only when the request's `v` equals the current catalogue version;
- otherwise `public-static` = `Cache-Control: public, max-age=0, must-revalidate` + `Vercel-CDN-Cache-Control: public, s-maxage=3600, stale-while-revalidate=86400` + `Vercel-Cache-Tag: <tags>`.

The wrapper option is `cache: { tier: (input, ctx) => input.v === ctx.catalogVersion ? "public-immutable" : "public-static", tags }`. If P1's wrapper lacks the resolver, WP-1 adds it as a one-hook edit reviewed by P1's owner.

| ID | Method · path | Request | Response `data` | Errors | Cache | RL |
|---|---|---|---|---|---|---|
| CAT-1 | `GET /api/legends` | `{ v?: CatalogVersion }` (strict) | `LegendCard[]` (visible legends only, D8-15; ≤ 60) | — | as above, tag `legends` | edge |
| CAT-2 | `GET /api/openings/{slug}` | `{ v? }` | `OpeningDetail` | `not_found` | tag `opening:<slug>` | edge |
| CAT-3 | `GET /api/openings` | `{ q?: string(2..64, normalised), family?: Letter, cursor?: Cursor, limit?: Limit(48, 48), v? }` | `OpeningCard[]` + `meta {nextCursor, total?}` (`total` only without `q`) | — | tag `openings`; per full URL | edge 60/min/IP (§11) |
| CAT-4 | `GET /api/positions/{slug}` | `{ v? }` | `PositionDetail` | `not_found` | tags `positions`, `position:<slug>` | edge |
| CAT-5 | `GET /api/positions` | `{ collection: "legend-practice" \| "featured" \| "legend:<slug>", theme?: PositionTheme, q?: string(2..64), cursor?, limit?: Limit(20, 50), v? }` | `PositionCard[]` + `meta {nextCursor, themes: [{key, count}], hint?: string}` | `not_found` (unknown legend slug) | tag `positions`; with `q` → `public-short` (600 s CDN) | edge 60/min/IP |
| CAT-6 | `GET /api/openings/index` | `{ family: Letter, v? }` | `{ rows: [slug, eco, name][] }` (tuples, mainline rows) | — | tags `openings`, `openings:<letter>` | edge |

- **No route reads Neon on a cache miss either.** Each handler reads the volumes (§8.10) through the Data Cache, with a per-instance memo. Its `Server-Timing` reports `dbq=0` unless the volume itself was rebuilt.
- **Path rules:** `index` is a reserved opening slug (B3 never generates it). Slug params are validated with `Slug` (api-design §2.4). An unknown slug is `404 not_found`, never a redirect (redirects live on pages).
- **Legacy shapes:** see §3.2 `api/openings` (`OpeningsIndexData` retired in the same PR).

**Middleware** (api-perf §4.13 item 2, refined). The critique proposes excluding `api/legends` from the Clerk matcher. Excluding the whole prefix would also strip Clerk from the admin routes `/api/legends/{create,[id],search}`, which still exist until P12 deletes them (P12:1867). So the exclusion is **exact**, as these lines of `WEB/middleware.ts` (P1 owns the file) show:

```ts
export const config = {
  matcher: [
    // pages: skip internals, static files, PWA files, PostHog proxy, OG images, sitemaps, robots, API (handled below)
    "/((?!_next|ingest|monitoring|og|workers|sw\\.js|workbox-.*|sitemap[^/]*\\.xml|robots\\.txt|api|trpc|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest|wasm)).*)",
    // API: everything except health/webhook/cron and the cookie-free catalogue reads.
    // legends(?![/\w]) excludes exactly /api/legends (CAT-1) and keeps /api/legends/search, /create, /[id] under Clerk.
    "/(api|trpc)/((?!health|webhook|cron|openings|positions|legends(?![/\\w])).*)",
  ],
};
```

- **Variant A (P1 Q-08: a Vercel Firewall rate-limit rule is available on Hobby).** The lines above apply as written. The public Learn **pages** are also added to the first lookahead (`legends|openings|learn/(?:legends|openings)`; `/learn/lessons` stays matched), so a catalogue hit costs no edge middleware run.
- **Variant B (no Firewall rule).** `openings|positions|legends(?![/\w])` are removed from the API lookahead. P1's middleware then takes its first branch for the route class `public-nocookie` (`lib/routes/classes/learn.ts`): it applies the `EDGE_DOC_LIMIT` in-isolate limiter and returns `NextResponse.next()` **before** `clerkMiddleware` runs. No auth cookie and no `Vary: Cookie` reaches a cacheable response, and `EDGE_DOC_LIMIT=on` covers `/api/openings*` and `/api/positions*` (api-perf SEC-09 row).
- The test `WEB/lib/routes/matcher.test.ts` (Next's `unstable_doesMiddlewareMatch` from `next/experimental/testing/server`) pins both variants:
  - `/api/legends` ✗; `/api/legends/search` ✓; `/api/legends/create` ✓;
  - `/api/openings?q=c50` ✗ (A) / ✓ + short-circuit (B);
  - `/api/learn/progress` ✓; `/learn/lessons/x` ✓; `/legends/paul-morphy` per variant.

### 7.3 Member routes

**PLAY-1 `POST /api/games` (legend extension of P2 §7.1.1).**
- Auth `member`. `Idempotency-Key` required.
- RL: P2's `create-game` bucket, 20 per 600 s (P2:1397), which P2 keeps durable (AP-11).
- Body ≤ 4 KB.
- Until `learn-v3` is on, `LEGEND_BOT` keeps P2's `400 validation_failed {details.reason: "mode_not_available"}`.

```ts
// CT/http/games.ts (P2's file). P8 widens, never forks, P2's GameCreateBody.
// mode literal follows P2 ("LEGEND_BOT"; the first phase that ships a shape fixes it, consistency §1 rule).
export const LegendEntry = z.enum(["catalogue", "detail", "legend", "next", "home", "onboarding", "lesson", "playhub"]);
// GameStart gains one variant:
//   z.object({ kind: z.literal("legend_position"), slug: Slug })        // P8; P2's {kind:"position", positionRef} still works
// GameCreateBody changes (P8):
//   reason: z.enum(["new", "rematch", "restart", "next"]).default("new")   // + "next"
//   entry: LegendEntry.optional()                                         // LEGEND_BOT only; stored in meta.entry
// refine: mode === "LEGEND_BOT" ⇒ start.kind ∈ {"legend_position","position"}; reason ∈ {rematch, restart} ⇔ parentGameRef

// GameState.mode (P2:1641) gains "LEGEND_BOT" (P2 lists BOT | FRIEND | ONLINE | TOURNAMENT).
export const LegendBlock = z.object({                    // GameSnapshot.legend, present iff mode = LEGEND_BOT
  slug: Slug,
  heroName: z.string().max(40), opponentName: z.string().max(40),     // "Kasparov", "Topalov"
  heroLiving: z.boolean(),
  legend: z.object({ slug: Slug, short: z.string().max(20) }).nullable(),
  seriesNo: z.number().int().min(1),
  entry: LegendEntry,
  next: z.object({ slug: Slug, title: z.string().max(80) }).nullable(),
});
// header, prefix {sans, startMoveNo, startsBlack} and position {name, event, year, afterLabel, legendSide}
// are P2's existing snapshot fields, filled at creation from the position (P2 §6.2 "computed once at creation").
// 201 { game: GameSnapshot } (200 with Idempotent-Replayed, or when an unstarted game is reused)
```

Server steps (`WEB/lib/games/legend.server.ts`, called from P2's `create-bot-game.server.ts` dispatch; one transaction; ≤ 5 statements, Q-G1/Q-G2):

1. `getPositionForPlay(slug)`: a cached, server-only DTO *with* `legendMoveUci`, never serialised. Returns 404 when the position is missing, inactive or unverified, or when `availableFrom > ctx.now`.
2. **Reuse** (only for `reason = "new"`): Q-G1 finds an `IN_PROGRESS` `LEGEND_BOT` game of this member on this position. If `plyCount < 2` it is returned as is (200). A started game is never reused, because S14 has already redirected to it.
3. **Rematch / restart:**
   - Load the parent with `WHERE "referenceId" = $ref AND mode = 'LEGEND_BOT' AND ("whitePlayerId" = $me OR "blackPlayerId" = $me)`. Anything else, including a parent that is not a legend game, is `404 not_found`.
   - **Restart:** `UPDATE games SET status = 'ABORTED', "endMethod" = 'ABORTED', outcome = 'NONE', "completedAt" = $now, meta = jsonb_set(meta, '{restarted}', 'true') || jsonb_build_object('abortedBy', <member colour>) WHERE id = $parent AND status = 'IN_PROGRESS'`, plus P2's `game_players.result = 'ABORTED'` and `"endedAt" = $now` (P2 §6.6.5 abort shape, without the stats clause). A completed parent stays completed.
   - `seriesNo = parent.seriesNo + 1`. Rematch colour = the opposite of the parent's member colour. Restart colour = the same.
4. **Colour:** `auto` / `hero` → `position.heroSide`. `whitePlayerId` / `blackPlayerId` = the member on their side, NULL for the engine side (B2).
5. **Insert** through P2's `createLiveGame()` with:
   - `mode LEGEND_BOT`, `startingFen = position.fen`, `startPly`, `chessPositionId`;
   - `botElo` (D8-9, snapped to the ladder), `timeClass`, `initialTimeSeconds` / `incrementSeconds` = `body.tc ?? position.default*`;
   - `studySeconds = (reason = "new" && entry ≠ "next") ? 30 : 0` (D8-8);
   - `rematchOfId = parent.id` for rematch and restart;
   - `seriesNo`;
   - `meta {v: 1, header, prefixSan (last ≤ 120 of prefixSans), prefixStartMoveNo, position {name, event, year, afterLabel, legendSide: heroSide}, entry}`;
   - `rated false`.
6. `next` = the §8.3 cycle (from the volume; no query).
7. After commit (`after()`): PostHog `bot_game_started` (P2's event; P8 adds the props `mode: "legend_bot", slug, series_no, entry, study_s`) and `legend_practice_started` (§10.1).

**PLAY-4 `POST /api/games/{ref}/complete` (legend extension of P2 §7.1.4).** The contract is unchanged from P2/P3. For `LEGEND_BOT`, the response gains `legend`:

```ts
export const LegendCompleteExtra = z.object({
  foundLegendMove: z.boolean().nullable(),           // null when the member played the non-hero side or the engine moved first
  legendMoveSan: z.string().max(10).nullable(),      // revealed now: "24.Rxd4"
  userFirstSan: z.string().max(10).nullable(),       // "24.Qc1"
  legendMateMove: z.number().int().nullable(),
  teaserKey: z.enum(["found", "different", "other_side", "graded"]),
  next: z.object({ slug: Slug, title: z.string() }).nullable(),
});
// 200 { status, outcome, method, analysis: {status}, legend?: LegendCompleteExtra }
```

- `foundLegendMove` = the member's first move from `startPly` equals `legendMoveUci`: a UCI compare with the promotion letter lower-cased, in `GC/legend/found-move.ts` (pure), computed after P2's adjudication.
- P3's `LegendComparison` facts are written by P3 in the same `complete` transaction (P3's hook).
- Analysis is P3's rule: `ANALYZE_GAME` at `JOB_PRIORITY.GAME_ENDED` from `startPly`. Under 6 plies, or aborted → `SKIPPED` (P3:1293).

**LRN-1 `GET /api/learn/progress`** (P8b). Auth `member`. Tier `no-store` (`private, no-store`). No rate limit.

```ts
export const LessonProgressQuery = z.union([
  z.strictObject({ legend: Slug }), z.strictObject({ scope: z.literal("all") }),
]);
export const LessonStatusWire = z.enum(["not_started", "in_progress", "completed"]);
export const LessonProgressSummary = z.object({
  legends: z.array(z.object({
    legendSlug: Slug, legendShort: z.string(),          // "Morphy"
    done: z.number().int(), total: z.number().int(), nextSlug: Slug.nullable(),
    lessons: z.array(z.object({ slug: Slug, status: LessonStatusWire, bestStars: z.number().int().min(0).max(3) })),
  })),
});
```

Errors: `not_found` (unknown legend slug). Query Q-L3: one statement, joined in memory with `lessonsIndex()`.

**LRN-2 `POST /api/learn/lessons/{slug}/progress`** (P8b). Auth `member`. Natural idempotency (D8-4). Beacon-capable (`text/plain` JSON). RL `train-write` = 120 / 60 s, `store: "burst"` (R-13, P5 final). `maxBodyBytes` 8 KB. Tier `no-store`.

```ts
const Seq = z.number().int().min(1).max(2000);
export const LessonEvent = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("start"), seq: Seq, resume: z.boolean(), contentVersion: z.number().int().min(1) }),
  z.strictObject({ type: z.literal("checkpoint"), seq: Seq, ply: z.number().int().min(1).max(600),
                   result: z.enum(["first_try", "after_wrong", "hint", "shown"]) }),
  z.strictObject({ type: z.literal("position"), seq: Seq, ply: z.number().int().min(0).max(600) }),
  z.strictObject({ type: z.literal("complete"), seq: Seq, hints: z.number().int().min(0).max(20),
                   shown: z.number().int().min(0).max(20), firstTry: z.number().int().min(0).max(20),
                   durationMs: z.number().int().min(0).max(14_400_000) }),
]);
export const LessonProgressBody = z.strictObject({
  runId: z.uuid(),
  events: z.array(LessonEvent).min(1).max(20),          // ordered by seq; the server sorts defensively
});
export const LessonProgressOut = z.object({
  status: LessonStatusWire, lastPly: z.number().int().nullable(),
  stars: z.number().int().min(1).max(3).nullable(),     // set once this run completed
  bestStars: z.number().int().min(0).max(3), attempts: z.number().int(),
  milestone: z.enum(["first_lesson"]).nullable(),
  next: z.object({ slug: Slug, title: z.string(), legendShort: z.string() }).nullable(),
  planDone: z.number().int(),                           // P5's bitmask after this write (the hub patches without a refetch)
});
```

Errors:
- `not_found`: an unknown or unpublished lesson;
- `validation_failed`: a checkpoint `ply` that is not a checkpoint of this lesson, or a `position.ply` outside `[startPly, endPly]`;
- `409 conflict {reason: "content_version_mismatch", details: {contentVersion}}`: `start.contentVersion` ≠ the lesson's.

**LRN-3 `POST /api/learn/openings/{slug}/drill`** (P8b). Auth `member`. Natural idempotency on `clientAttemptId` (P5 `training_attempts.clientAttemptId @unique`). RL `train-write` (burst). Tier `no-store`.

```ts
export const DrillCompleteBody = z.strictObject({
  clientAttemptId: z.uuid(),
  mistakes: z.number().int().min(0).max(50), hintsUsed: z.number().int().min(0).max(20),
  timeMs: z.number().int().min(0).max(3_600_000),
  reviewedAt: z.iso.datetime(),                        // client clock, clamped to [now − 7 d, now + 5 min] like P5
});
export const DrillCompleteOut = z.object({
  card: z.object({ ref: z.string(), due: z.iso.datetime(), dueLabel: z.string(),   // "Fri 08:00"
                   created: z.boolean(), rescheduled: z.boolean() }),
});
```

Errors: `not_found`; `409 conflict {reason: "drill_not_available"}` (fewer than 4 plies).

### 7.4 Admin and internal routes

| ID | Method · path | Auth | Request → response | Notes |
|---|---|---|---|---|
| ADM-5 | `POST /api/admin/positions/{slug}/verify` | `admin` | `{ sourcePgn?: string ≤ 20 KB, apply?: boolean }` → `{ ok, issues: string[], computed: { startPly, prefixSans, legendMoveUci, legendMoveSan, legendMateMove, ecoCode, openingName }, applied }` | Runs `verifyPosition()` (§8.4). With `apply && ok`, it writes the computed columns + `verifiedAt` / `verifiedById` and an `audit_logs` row (`ADMIN`, `position.verify`; M4), then `after()` revalidates `positions`, `position:<slug>`, `catalog-version`. Tier `no-store`. P12 keeps this route unchanged (P12:1086). |
| ADM-6 (GET only) | `GET /api/admin/legends?cursor&limit≤100` | `admin` | → `Paged<AdminLegendRow>` (the columns today's admin page reads, including hidden legends) | Built early so `CAT-1` can go slim. P12 adds POST/PATCH/DELETE. `no-store`. |
| INT-R | `POST /api/internal/revalidate` | `internal`: `x-internal-token`, compared timing-safe with `INTERNAL_API_SECRET` through `CT/internal/auth.ts` (consistency R-08; if the owner adopts HMAC per AP-44 / SEC-4, the same helper changes for every hop, and P8 needs no edit) | `{ v: 1, tags: string[] (1..20, /^[a-z-]+(:[a-z0-9-]+)?$/) }` → `{ revalidated: string[] }` | `revalidateTag(tag)` for each tag. Called by the content scripts (§6.4). No rate limit (internal). Listed in P1's `INTERNAL_ROUTE_IDS`. |
| (existing) | `POST /api/legends/create`, `PUT/DELETE /api/legends/[id]`, `POST /api/chess-positions/create`, `PUT/DELETE /api/chess-positions/[id]`, `POST /api/scraper/positions/import` | `admin` (P1 H1) / API key | unchanged | Add `after(() => revalidateCatalog(tagsFor(entity)))`. These routes stay under the Clerk matcher (§7.2). |

### 7.5 Removed, changed or redirected

Redirect status: **307** when `APP_ENV ≠ production`, **308** in production (D8-5). Pages use `catalogRedirect(url)` = `isProductionApp() ? permanentRedirect(url) : redirect(url)`. `config/redirects/learn.mjs` sets `permanent: process.env.APP_ENV === "production"`.

| Item | Fate |
|---|---|
| `GET /api/position/[referenceId]` | **Removed** (D8-12) |
| `GET /api/chess-positions/featured`, `WEB/lib/featured-positions.ts` | **Removed** (dead) |
| `GET /api/legends` | **Changed** to `CAT-1` |
| `GET /api/openings` | **Changed** to `CAT-3`. `CT/http/openings.ts` `OpeningsIndexData` and `qk.catalog.openingsIndex()` are **retired** (consistency 8.9). |
| `/position/[ref]` page | **Redirect** via `WEB/app/position/[referenceId]/route.ts` |
| `/try`, `/try/:path*` | **Redirect** → `/legends/positions` (`next.config.js:90-91` retargeted; P11:157 keeps it) |
| `/openings?eco=X` | **Redirect** → `/openings/eco/x` (`has: [{type: 'query', key: 'eco'}]`) |
| `/legends/<cuid>`, `/openings/<cuid>` | **Redirect** from the `[slug]` page when the param matches `^c[a-z0-9]{20,31}$` and resolves through `referenceId` |
| `/learn` | **Redirect** → `/legends` |

### 7.6 Socket events, SSE, webhooks, jobs, timers

- **Socket:** none new (D8-13). Consumed on the game-over card: P3's `analysis:queued`, `analysis:progress`, `analysis:writing`, `analysis:done`, `analysis:failed`, `compare:ready` and `games:changed` on room `user:{ref}` (consistency R-07).
- **SSE:** none. **Webhooks:** none. **Vercel cron:** none (Hobby, allocation §1.5).
- **Worker jobs:** none new. **Timers:** none. Nothing polls and nothing is scheduled. A future `availableFrom` is handled on the client (D8-17), and the practice-set server checks use `ctx.now`.
- **Scripts** (laptop or CI, never Vercel): B3, B4, B11, B12, J7, J8 (§6.4).

### 7.7 Third parties

| Service | Use in P8 | Limits and politeness |
|---|---|---|
| Cloudflare R2 (existing media bucket) | explanations JSON (B4), portraits (B12), future lesson audio | immutable keys; free egress |
| Lichess open database (CC0) | J8 popularity, offline, one monthly file | no API calls; attribution line "Opening popularity from the Lichess open database (CC0)" on `/openings` |
| Lichess explorer (fallback only) | J8 fallback with the owner's personal scope-less token (`LICHESS_EXPLORER_TOKEN`, laptop env) | `https://explorer.lichess.org`, OAuth required (feasibility F-API-2); ≤ 1 request/s, 60 s back-off on 429, resumable cursor |
| Wikimedia Commons (or other PD/CC sources) | portrait files for B12, owner-reviewed list | licence allow-list; credit stored and rendered |
| Clerk | session claims on public pages (client hint only; lazy headless clerk-js for the stale-token case) | no Backend API calls in P8 |
| Vercel Data Cache / CDN | tag-only ISR, `revalidateTag` | Hobby: no cron needed; image optimizer unused (portraits `unoptimized`, F-VER-4) |

### 7.8 Environment variables and flags

| Name | Where | Default | Purpose |
|---|---|---|---|
| `LEGEND_MIN_POSITIONS` | Vercel (dev, prod) | prod `8`, dev `1` | D8-15 visibility rule; also printed in the S5 empty-state copy |
| `R2_EXPLANATIONS_PREFIX` | scripts | `explanations/` | B4 key prefix |
| `BACKFILL_ALLOWED_HOSTS` | scripts | the dev branch host | data-model §11.6 |
| `INTERNAL_API_SECRET` (existing; R-08/R-09) | scripts → `INT-R`; web | — | revalidation from scripts (replaces rev 1's `INTERNAL_API_TOKEN`) |
| `LICHESS_EXPLORER_TOKEN` | laptop, J8 fallback only | unset | D8-19 fallback; never on Vercel or OCI |
| `NEXT_PUBLIC_MEDIA_URL` (existing) | web | `https://media.playchess.tech` | portrait and explanation URLs |
| PostHog flag **`learn-v3`** (`lib/flags/registry/p8.ts`) | web | on for the owner and the E2E pool on dev | gates the member surfaces (S3/S4/S7/S8/S13–S16), the lights-up slots and the ⌘K slug routes. The public pages switch at deploy; production stays on the old stack until P13 (allocation §1.4). |

---

## 8. Domain logic

Pure functions live in packages, so the server, the client and the scripts share them:
- `GC/legend/*`: verification, practice-set order, the legend-move check;
- `TRN/{lesson,opening}/*`: lesson reducer, stars, sentence, drill, grade, due label;
- `WEB/lib/catalog/*`: slugs, eras, search normalisation, version, tags;
- `WEB/lib/data/catalog/*`: the volumes (server-only).

Each has a unit test file (§12.1).

### 8.1 Slugs (`WEB/lib/catalog/slug.ts`)

- **`slugify(s)`:** NFD, strip diacritics, lower-case, `&` → `and`, every run of characters outside `[a-z0-9]` → `-`, trim `-`, cut at 80 chars on a `-` boundary. "José Raúl Capablanca" → `jose-raul-capablanca`; "Duke of Brunswick & Count Isouard" → `duke-of-brunswick-and-count-isouard`.
- **Legends:** `slugify(name)`; on a collision, `-2`, `-3`.
- **Practice positions:** editorial (the table in §6.6). **Other positions:** `slugify("<white> <black> <year>")`, falling back to `slugify(<title or tournamentName>)`; on a collision, `-2`.
- **Openings:** group active rows by exact `name`. The row with the fewest plies (`moveCount`), then the lowest `eco`, then the lowest id owns `slugify(name)` and `isMainline = true`. Every other row gets `slugify(name) + "-" + eco.toLowerCase()`, then `-2`, and `isMainline = false`. Reserved slugs: `index`, `eco`, `search`, `drill`.
- **Immutability:** a slug never changes once written (play-b Q17). A renamed record keeps its slug. A deliberate change needs a redirect row, which P8 does not build (P12 admin).
- **Cuid detection** for redirects: `^c[a-z0-9]{20,31}$` (the `Ref` regex in contracts).

### 8.2 Legend cards (`WEB/lib/catalog/legends.ts`)

- **Visibility (D8-15):** `isActive AND isVisible AND (positionsCount ≥ LEGEND_MIN_POSITIONS OR lessonsCount ≥ 1)`.
  - `positionsCount` counts active, verified positions in which the legend played either side.
  - `lessonsCount` counts published lessons.
- **Era key** (B3): Romantic Era → `romantic`; Classical Era and Hypermodern Era → `classical`; Soviet Era → `soviet`; Modern Era and Contemporary Era → `modern` (rct-b L1). Display order: romantic, classical, soviet, modern, then name. An era chip with 0 legends is hidden.
- **Years label:** `birthYear–deathYear` ("1837–1884"); alive → "born 1963"; unknown → "".
- **`living`** = `deathYear IS NULL AND birthYear IS NOT NULL AND birthYear > 1900` (D8-18).
- **Initials:** the first letter of the first and last name tokens ("Paul Morphy" → "PM"; "Judit Polgár" → "JP").
- **Portrait:** `profilePhotoUrl` on the media host **and** a `portraitLicence` → `{url96, url256, credit}`; anything else → `null` (initials).
- **`playSlug`:** the legend's first playable position: active, verified, the legend on the `heroSide`, ordered `practiceOrder NULLS LAST, eventDate, id`.
- **Search** (client): normalise both sides (NFD, strip diacritics, lower). A legend matches when every query token is a prefix of some name token ("j pol" → Judit Polgár).

### 8.3 Practice set, availability and "Next position" (`GC/legend/practice-set.ts`)

- **The set** = active, verified positions with `practiceOrder IS NOT NULL`, ordered by `practiceOrder, id`. Launch order: KT (1), BF (2), AK (3), TS (4), Opera Game (5). This is the device cycle in the boards, and it is used everywhere: the catalogue, P9's Play hub, Next (play-b Q19).
- **Availability:**
  - `available(p, now) = p.availableFrom == null || p.availableFrom ≤ now`.
  - Servers pass `ctx.now` (PLAY-1, CAT-5).
  - Static pages render every item and mark the future ones `upcoming`; `PositionsBrowser` evaluates `available()` against `Date.now()` after mount and every minute while visible (D8-17).
- **`nextInSet(slug, now)`** = the next available item, wrapping to the first; `null` when only one item is available.
  - For a position outside the set (a legend-detail position), Next uses that legend's own set: positions of the legend on the hero side, ordered `practiceOrder NULLS LAST, eventDate, id`, wrapping.
- **`CAT-5 meta.hint`** = "{Legend} positions arrive in {Month}" when a not-yet-available item exists (`V3PlayHub` `search_empty`). It comes from the earliest future `availableFrom`.

### 8.4 Position verification (`GC/legend/verify.ts`; used by `ADM-5`, B3 and B11)

Input: the row (`fen`, `pgn`, `moveNumber`, `sideToMove`, players, legend ids, `heroSide`) and an optional trusted `sourcePgn`. Steps:

1. `new Chess(fen)` must succeed. There must be exactly one king per side, and the side not to move must not be in check.
2. `startPly = (fullmove − 1) × 2 + (sideToMove = b ? 1 : 0)`, from the FEN.
3. Replay `sourcePgn ?? pgn` from the standard start with chess.js. The EPD (FEN fields 1–4) after `startPly` plies must equal the EPD of `fen`. Issue on failure: "PGN does not reach the FEN at ply {startPly}".
4. `prefixSans` = the SAN of plies 1..`startPly`, space-separated (stored; §6.1).
5. `legendMoveUci/San` = ply `startPly + 1` of the PGN. It must be legal in `fen`, and if a stored value exists it must match. Issue: "Stored legend move {x} is not the next move ({y})".
6. `legendMateMove` = the full move number of the PGN's final ply when that ply delivers mate, else NULL.
7. `heroSide` must equal the side to move at `fen` for practice positions (the member makes the first move as the legend). Legend-detail positions may start with either side to move; then the engine moves first and the teaser uses `other_side`.
8. `ecoCode` / `openingName`: the longest `openings` row whose EPD is reached along the game (book lookup through `Opening.epd`, P3); else NULL.
9. Result: `{ok: issues.length === 0, issues, computed}`. With `sourcePgn`, the stored `pgn`'s first `startPly` plies are also compared with the source ("Stored PGN differs from the source at ply n").

- B3 runs steps 1–8 on every active position with its **own** PGN (no external source), so ordinary positions become playable.
- B11 runs it with the trusted `WEB/content/positions/sources/<slug>.pgn` for the curated seven. The design FENs were replayed for this plan from known scores (§12.4), but those scores were recalled, not read from a trusted file. So B11 still requires the source PGNs, with the `[Source]` header filled (`docs/implementation-plan.md:187`).

### 8.5 Legend practice game rules (`WEB/lib/games/legend.server.ts` + P2 runner rules)

| Rule | Value | Source |
|---|---|---|
| Study | `studySeconds = 30` when `reason = new` and `entry ≠ next`; otherwise 0. "I'm Ready" ends it early. The local runner implements study as in P2's live flow (moves locked, arrows allowed, `endsAt` computed locally from `studySeconds`). | D8-8; `V3TryGame` `study`; Home → `V3StudyPhase` |
| First-move window | none against the bot: the clock simply starts after the first move of each side ("Clocks start once both sides have moved"). | play-b Q5 |
| Pause | both clocks pause while `document.hidden` (P2 `pauseOnHidden` for `BOT` and `LEGEND_BOT`), with the status "Paused while this tab was hidden" on return | play-b Q5 |
| Time control | the position's `defaultInitialSec` / `defaultIncrementSec`: KT, BF, Opera 5+3; AK 10+0; TS 3+2 | boards |
| Bot level | D8-9 order of sources, snapped to P2's ladder (400–2200, step 100); editable in ⋯ "Engine strength" until the first move. Chip: "{elo} · as {opponentName}", with P2's "≈" tooltip until P9's calibration lands. | D8-9, P2 §8.13 |
| Assists | Hint (`H`: the engine's best move at the current level + 2 ladder steps, shown as a ring on the piece, then an arrow on the second press) and Takeback (`U`: undo the last full move pair) are hidden behind ⋯ → "Assists" until switched on for the game. Each use increments `meta.assists.hints` / `undos` (P2's field). The review shows "2 hints used". P6 excludes assisted games from its weakness stats. | play-b Q14, P2 §8.14 |
| Draw offers | P2 `draw-policy` (`botAcceptsDraw(evalCpBotPov, pliesPlayed, material)`); an offer needs ≥ 2 plies | P2 |
| Reuse | `reason = new` reuses an unfinished game of this member on this position when fewer than 2 plies were played since `startPly`. S14 redirects to any unfinished game before that. | play-b A4 |
| Series | `seriesNo = parent.seriesNo + 1` for rematch and restart; 1 for new and next. The header says "game {seriesNo}". | `V3TryGameKT` `gameNo` |
| Restart | An `IN_PROGRESS` parent becomes `ABORTED` with `meta.restarted = true` (conditional update), is excluded from `/games` (P3's archive filters `COMPLETED`) and is never analysed. With ≥ 2 member plies the client confirms first (`restart_confirm`). A finished parent is untouched. | D8-8 (extends P2's < 2-ply rule for `LEGEND_BOT`) |
| Archive and analysis | P2 creates the member's `GamePlayer` row at creation. P3 analyses a completed game from `startPly` at `JOB_PRIORITY.GAME_ENDED`; under 6 plies or aborted → `SKIPPED` (P3:1293, P3:1608). | P2/P3, R-05 |
| `foundLegendMove` | `true` when the member's colour = `heroSide`, the hero was to move at `startPly`, and the member's first move UCI equals `legendMoveUci` (promotion letter lower-cased). `false` when it differs. `null` otherwise. | §7.3 |
| `teaserKey` | `found` (true) · `different` (false) · `other_side` (the member ≠ hero) · `graded` (no legend move stored) | `V3TryGameKT` `tzHead` |
| "just like Morphy" | when the member won by mate and `legendMateMove` equals the member's mating move number, the method line adds ", just like {heroName}" | `V3TryGameOver` |

### 8.6 Lesson build (`WEB/scripts/lessons/build.ts`, J7) and the payload

Checks. Any failure aborts that lesson with exit code 1, and CI records Sentry `captureMessage('lesson.build_failed')`.

1. The source PGN replays legally from the standard start, and its headers match the lesson JSON (`event`, `year`, `whiteName`, `blackName`). It also carries `[Source "…"]`.
2. `0 ≤ startPly < endPly ≤ total plies`; `legendColor` ∈ {w, b}.
3. For every step ply in `(startPly, endPly]`, `san`, `uci` and `fenAfter` are computed, never authored.
4. Every checkpoint ply is a move by `legendColor` and has a `prompt`, a `hint` and a `correctText`. `badge` ∈ {best, brilliant, great_find}.
5. Every `alsoAccept` UCI is legal at that position. With `--engine` (local Stockfish 18, 1M nodes, P3's Win% formula `winPct(cp) = 50 + 50 × (2 / (1 + e^(−0.00368208 × cp)) − 1)`), it is within **2 Win%** of the legend's move: the same tolerance P3 uses for `acceptUcis` on key moments.
6. Narration ≤ 600 chars per ply; prompts ≤ 300. A regex finds SAN-like tokens in the prose; each must be a legal move in the position before or after that ply, so "Rxd7" in step 25's text is checked.
7. Opening name mentions must equal an `openings.name` (R-CO-03).
8. `durationSec`, when not authored, defaults to `round((plies × 8 + checkpoints × 45) / 60) × 60`.
9. Writes: upsert `lessons` by slug and replace `lesson_steps` for that lesson in the same transaction. `contentVersion + 1` when anything changed. `verifiedAt = now()` only with `--reviewed-by=<name>` (the chess-accuracy sign-off). `isPublished` only with `--publish` *and* `verifiedAt` set, **and** only once the deployed web build has the P8b player (`--publish` refuses while the deployed `/api/health` `features.learnPlayer` is false).

`LessonPayload` (assembled by `getLessonPayload(slug)`; about 6 KB for the Opera Game):

```ts
type LessonPayload = {
  slug: string; title: string; idea: string; legend: { slug: string; short: string; name: string };
  event: string; year: number; whiteName: string; blackName: string; legendColor: "w" | "b";
  orient: "w" | "b";                       // = legendColor
  startPly: number; endPly: number; startFen: string;
  steps: { ply: number; san: string; uci: string; fen: string; narration: string | null;
           checkpoint: null | { prompt: string; hint: string; correctText: string; badge: string; alsoAccept: string[] } }[];
  intro: string; story: string; outro: string; durationSec: number; contentVersion: number;
  legendIndex: { order: number; total: number };       // "lesson 2 of 5"
  playItOut: { positionSlug: string; fromMove: number } | null;
};
```

### 8.7 Lesson player, progress, stars and the lesson slot resolvers

**Client reducer** (`TRN/lesson/machine.ts`; pure, unit-tested).
- State: `{pl, phase: watch|guess|wrong|answered|done, playing, speed: 1|1.5|2, story, hint, results: Record<ply, Result>, hints, shown, firstTry, runId, seq}`.
- Events: `PLAY, PAUSE, TICK, NEXT, PREV, MOVE(uci), HINT, SHOW, TOGGLE_STORY, CYCLE_SPEED`. The rules are those of S7.
- Results per checkpoint:
  - `first_try`: correct, no wrong move, no hint;
  - `after_wrong`: correct after ≥ 1 wrong move, no hint;
  - `hint`: correct after Hint;
  - `shown`: Show me.
- Counts: `hints = #hint`, `shown = #shown`, `firstTry = #first_try`.

**Stars:** `stars = max(1, 3 − hints − shown)` (board logic, verbatim; `after_wrong` costs nothing, as in the design).

**Server application of `LRN-2`** (`WEB/lib/learn/progress.server.ts`; the pure core `applyLessonEvents()` plus one interactive transaction; every timestamp is `ctx.now`):

```text
lesson   ← lessonsIndex().get(slug)                          -- cached: id, startPly, endPly, checkpointPlies, contentVersion, legendId
row      ← SELECT … FROM lesson_progress WHERE ("userId","lessonId") = ($u,$l) FOR UPDATE
           (INSERT … ON CONFLICT DO NOTHING first when absent)
for e in events sorted by seq:
  if body.runId = row.runId and e.seq ≤ row.lastSeq: continue                     -- duplicate / replay
  if e.type = start:
     if e.contentVersion ≠ lesson.contentVersion: raise conflict(content_version_mismatch)
     if body.runId ≠ row.runId: row.runId ← body.runId; row.checkpoints ← {}; row.runCompletedAt ← null
                                if not e.resume: row.attempts += 1
     row.status ← (row.status = COMPLETED) ? COMPLETED : IN_PROGRESS; row.contentVersion ← lesson.contentVersion
  else if body.runId ≠ row.runId and row.runId is not null: continue              -- a stale run's late events
  else if e.type = checkpoint: require e.ply ∈ lesson.checkpointPlies; row.checkpoints[e.ply] ← e.result; touchDay ← true
  else if e.type = position: require startPly ≤ e.ply ≤ endPly; row.lastPly ← e.ply
  else if e.type = complete and row.runCompletedAt is null:
     counts ← from row.checkpoints when it has every checkpoint, else e.{hints,shown,firstTry} clamped to #checkpoints
     stars ← max(1, 3 − counts.hints − counts.shown)
     firstEver ← row.bestStars = 0
     row.lastStars ← stars; row.bestStars ← max(row.bestStars, stars); row.status ← COMPLETED
     row.completedAt ← row.completedAt ?? $now; row.runCompletedAt ← $now; row.lastPly ← null; completed ← true
  row.lastSeq ← max(row.lastSeq, e.seq) when body.runId = row.runId
UPDATE lesson_progress SET …
if touchDay or completed: touchTrainingDay(viewer, $now)                           -- P5: TrainingDay upsert + streak (a checkpoint counts, P5 final:1588)
if completed: UPDATE training_days SET "lessonsDone" = "lessonsDone" + 1,
              "planDone" = "planDone" | $lessonStepBit       -- computed in TS: 1 << i for the plan step with kind 'lesson' and this slug, else 0
milestone ← completed and firstEver and (SELECT count(*) FROM lesson_progress WHERE "userId"=$u AND status='COMPLETED') = 1
```

**Resume:** S7 starts at `lastPly` when `progress.contentVersion = payload.contentVersion` and the status is IN_PROGRESS. A resume at a checkpoint opens in `guess`. The client sends `start {resume: true}`, and no attempt is counted.

**Next lesson (D8-11):**
- `from = legend` → the lowest `legendOrder` greater than this lesson's, within the legend; otherwise null ("You finished every Morphy lesson").
- Otherwise → the lowest `pathOrder` greater than this one. If this lesson has no `pathOrder`, the first path lesson not COMPLETED by the member (Q-L4).

**The lesson slot resolvers** (`WEB/lib/learn/slots.server.ts`; the bodies of P5's and P6's provider modules, §4 S13/S16):

| Function | Used by | Rule | Queries |
|---|---|---|---|
| `nextLessonForPlan(viewer, {focusTheme})` | P5 plan builder (L2), Q-L4 | the first published path lesson not COMPLETED; otherwise the published lesson whose `themes` include `focusTheme` and is not COMPLETED; otherwise null. Estimate "~{round(durationSec/60)} min". The step is Done when that lesson completes on the plan's local day. | 1 (anti-join on `lesson_progress`), once per local day (P5 freezes the plan) |
| `lessonCardFor(viewer, {theme, from})` | P5 summary (L3), P5 bank caught-up (L4) | candidates = published lessons whose `themes` include `theme` (from `lessonsIndex()`), ordered `pathOrder NULLS LAST, legendOrder`. The first not COMPLETED wins; otherwise the first; otherwise `nextLessonForPlan(viewer, {focusTheme: theme})`. Returns `LessonCard` with `href = /learn/lessons/<slug>?from=<from>`. | ≤ 1 (the viewer's completed slugs, PK prefix) |
| `getLessonProgressSummary(viewer)` | P5 hub row (L1), `LRN-1` | Q-L3 joined in memory with `lessonsIndex()` | 1 |
| `resolveLessonForPattern(pattern)` | P6 (S16) | `pattern` is a P6 `PatternKey` ("fork", "hangingPiece", "rc:timePressure"). An `rc:` key maps through `PATTERN_THEMES` (`WEB/lib/learn/pattern-themes.ts`, empty in v1, so null). Otherwise the published lesson with `pattern ∈ themes`, ordered `pathOrder NULLS LAST, legendOrder, id`. Returns `{slug, title, sub: "{white} vs {black}, {year}"}` or null. It is viewer-independent and cached under tag `lessons`. | 0 (cached) |

**Complete sentence** (`buildCompleteSentence`): see S8. The board's example: results `{25: first_try, 31: hint, 33: first_try}` (13.Rxd7, 16.Qb8+, 17.Rd8#) → "You found 2 of Morphy's 3 moves on the first try and used one hint on 16.Qb8+." (2 stars).

### 8.8 Opening lines (`TRN/opening/*`)

- **Line:** `drillLine ?? pgn`, as UCI from the standard start (J8 checks that `drillLine` extends `pgn`). Ideas: `moveNotes[i] ?? (i < pgnPlies ? "Book move." : null)`. The intro idea is the ECO family description (`lib/catalog/eco.ts`).
- **User colour:** the side that played the **last ply of `pgn`** (the opening's own definition), not of `drillLine`. Italian (`…3.Bc4`) → White; Sicilian (`1.e4 c5`) → Black; Queen's Gambit (`1.d4 d5 2.c4`) → White. When the user is Black, White's first move autoplays.
- **Drill availability:** a line of ≥ 4 plies.
- **Acceptance:** a user move is correct when its UCI equals the expected UCI, or when the resulting EPD equals the expected EPD (a transposition; rct-b L7). Otherwise it is wrong: the move shows for 600 ms, then reverts.
- **Replies** autoplay 400 ms after a correct move. No engine is involved: the line is the script.
- **Card creation and review (`LRN-3`, D8-10; P8b):**
  - grade = `GOOD` when `mistakes = 0 AND hintsUsed = 0`, else `HARD`;
  - no card → create it: `deck OPENING`, `kind OPENING_LINE`, `itemKey = 'o_' + sqid(openingId)`, `openingId`, `fen` = the start FEN, `solution` = the whole line (≤ 120 chars; longer lines are capped at the first 20 plies), `orient` = the user colour, `theme = "opening"`. Then apply `scheduler.repeat(newCard, $now)[grade]`. This is an `INSERT … ON CONFLICT ("userId","itemKey") DO NOTHING RETURNING`;
  - card due (`due ≤ $now`, not suspended) → a normal review with that grade;
  - card not due → practice: no reschedule (`rescheduled: false`), but the attempt is still logged;
  - due snapping: intervals ≥ 1 day move to the user's release hour (08:00 local by default; P5's `TrainingProfile.releaseHour`, DST-safe), so "Fri 08:00" is literal;
  - `dueLabel`: "Tomorrow 08:00" / weekday + time within 6 days / "Nov 6" beyond, in `User.timeZone` (R-03), formatted by `TRN/labels.ts` (P5);
  - one `training_attempts` row with P5's columns: `clientAttemptId`, `deck OPENING`, `kind OPENING_LINE`, `theme "opening"`, `solved true`, `firstTry = (mistakes = 0 AND hintsUsed = 0)`, `hintsUsed`, `wrongTries = mistakes`, `solutionShown = hintsUsed > 0`, `timeMs`, `grade` (null for practice), `suggestedGrade = grade`, the FSRS state after, `reviewedAt` (clamped). Then `touchTrainingDay()`. The bank cap is not touched (rct-b D6).
- **`OPENINGS` session** (P5's `buildSession('OPENINGS')` extension; wire `{kind: "openings"}`):
  - due OPENING cards (`due ≤ $now AND ("suspendedUntil" IS NULL OR "suspendedUntil" ≤ $now)`), ordered by `due`, at most 10;
  - none due → Start disabled, with the label "Next due {dueLabel}";
  - grades in the runner use P5's suggested-grade table (a wrong move or "Show the move" → Again; clean → Good) and P5's `W1`.

### 8.9 Opening search and browse (`WEB/lib/catalog/openings.ts`; in memory over the volumes, D8-6)

- **Normalise** (client and server): trim, lower-case, collapse whitespace, strip diacritics, and strip move numbers and dots for the move form (`"1. e4 e5 2.Nf3"` → `"e4 e5 nf3"`).
- **Classify:** `/^[a-e]\d\d$/` → exact ECO; ≥ 2 tokens that each look like SAN → move prefix; otherwise name.
- **Precomputed per volume row** (once per volume build): `nameNorm`, `movesNorm` (the normalised SAN line), `eco`, `popularity`, `isMainline`.
- **Browse** (no `q`): the rows of the letter(s), `isMainline` only, sorted `popularity DESC, slug ASC`. Pages of 48. The cursor is `base64url("v1." + offset + "." + catalogVersion)`; a cursor from another version → 400 `validation_failed {fields.cursor: "cursor_stale"}`, and the island restarts at page 1.
- **Search** (with `q`; capped at 48 results with `nextCursor = null`; the UI says "Showing the 48 best matches. Refine your search." when exactly 48 come back):

```ts
score = (eco === Q ? 1000 : 0)
      + (q.kind === "moves" && row.movesNorm.startsWith(q.moves) ? 500 : 0)
      + (q.kind === "name" && row.nameNorm.includes(q.name) ? 100 + (row.nameNorm.startsWith(q.name) ? 50 : 0) : 0)
      + (row.isMainline ? 10 : 0);
results = rows.filter(score > 10).sort(score DESC, popularity DESC, slug ASC).slice(0, 48)
```

- Cost: ≤ 3,641 rows × 3 string checks ≈ 1–2 ms on a warm instance (the volumes are memoised per instance by `v`).
- `line` = the first 8 plies of `pgn`, formatted "1.e4 e5 2.Nf3 Nc6 3.Bc4"; `placement` = FEN field 1, computed once in the volume build.

### 8.10 Catalogue volumes and the version (`WEB/lib/data/catalog/volumes.ts`, `import "server-only"`)

| Volume | Source query (on a Data Cache miss only) | Content | Size budget | Tags |
|---|---|---|---|---|
| `legendsVolume()` | 1 statement: visible-candidate legends + `count(*)` of active verified positions per side (FK indexes) + published lesson counts | ≤ 60 rows: card fields, bio, themes, `playSlug`, portrait | ≤ 80 KB | `legends`, `positions`, `lessons` |
| `positionsVolume()` | 1 statement: active positions with card fields, `prefixSans`, `practiceOrder`, `availableFrom`, `verifiedAt IS NOT NULL`, legend refs, `ecoCode`, `hasExplanation`. **No `pgn`, no `legendMove*`.** | ≤ 500 rows | ≤ 600 KB | `positions` |
| `openingsVolume(letter)` × 5 | 1 statement each: active openings of that ECO letter (slug, eco, name, pgn, `isMainline`, `popularity`, `moveNotes`, `drillLine`, `hasExplanation`, `explanationUrl`) | ≈ 400–1,100 rows each | ≤ 900 KB each | `openings`, `openings:<letter>` |
| `openingSlugIndex()` | 1 statement: `slug, eco` of active openings | 3,641 entries `slug → letter` | ≤ 180 KB | `openings` |
| `lessonsIndex()` | 1 statement: published lessons (meta only, no steps), checkpoint plies | ≤ 50 rows | ≤ 40 KB | `lessons` |

- **Each volume entry stores `{v: sha1(JSON).slice(0, 8), data}`.** `getCatalogVersion()` = `sha1(legends.v + positions.v + a..e.v + lessons.v).slice(0, 8)`, computed from the cached entries. It costs no query and only changes when content changes.
- **Per-instance memo:** a module-level LRU (8 entries) keyed by the entry's `v`, so a warm Fluid-compute instance does not re-parse JSON.
- **Size guard:** `volumes.test.ts` builds every volume from the full dev catalogue (3,641 openings after OD-6, or the TSV seed) and asserts the serialised size stays under its budget, and always under 1.5 MB. This stays below the Data Cache per-entry limit [V: confirm the current Vercel Data Cache item limit; 2 MB assumed].
- **Server-only spoiler loader:** `getPositionForPlay(slug)` is a separate `unstable_cache` entry (tag `position:<slug>`), read only by `PLAY-1` and `PLAY-4`. It is the only loader that selects `legendMoveUci` / `legendMoveSan` / `legendMateMove`.
- **Lesson payloads:** `getLessonPayload(slug)` is a per-slug entry (tag `lesson:<slug>`), read only by member pages.

### 8.11 Tags (`WEB/lib/catalog/tags.ts`)

`tagsFor(entity)`:

| Entity | Tags |
|---|---|
| legend | `legends`, `legend:<slug>`, `catalog-version` |
| position | `positions`, `position:<slug>`, `legend:<whiteSlug>`, `legend:<blackSlug>`, `legends` (counts), `catalog-version` |
| opening | `openings`, `openings:<letter>`, `opening:<slug>`, `catalog-version` |
| lesson | `lessons`, `lesson:<slug>`, `legend:<legendSlug>`, `legends` (counts), `catalog-version` |

`revalidateCatalog(tags)` dedupes them and calls `revalidateTag` for each. A failure is captured as `catalog.revalidate_failed`.

---

## 9. Performance and optimization

### 9.1 Targets (SLOs) and how each is measured

Client-side numbers come from Speed Insights (`sampleRate={0.2}` on Hobby, F-VER-5) and Sentry browser spans. PostHog client events are consent-gated after P11, so they are a secondary source only (AP-15).

| Path | Target | Measured by |
|---|---|---|
| Public catalogue pages (S1, S2, S5, S6, S9–S12) | CDN `HIT` ≥ 95 % after warm-up; **0 Neon queries per HIT and per on-demand first render**; edge TTFB p95 ≤ 100 ms; LCP p75 ≤ 2.0 s on a mid phone over 4G; CLS ≤ 0.05; INP ≤ 200 ms | `x-vercel-cache` in the k6 crawl (§9.6); the Neon query log during the crawl; Speed Insights per route |
| `CAT-*` JSON | HIT ≥ 95 %; MISS server time p95 ≤ 60 ms (volumes warm in the instance) / ≤ 250 ms (Data Cache read) | `Server-Timing: app;dur, cache;desc="hit|miss", dbq;desc="0"` (P1 wrapper); Sentry span `api cat.*` |
| `LRN-1` | server p95 ≤ 120 ms, 1 statement | Server-Timing; k6 |
| `LRN-2` | server p95 ≤ 150 ms at 20 rps, ≤ 6 statements | k6 `learn-writes.ts` |
| `LRN-3` | server p95 ≤ 250 ms, ≤ 6 statements | k6 |
| `PLAY-1` legend | server p95 ≤ 300 ms, ≤ 5 statements | k6 |
| S14 → first interactive board | ≤ 1.5 s with a cached engine; ≤ 6 s on a first load over 4G (7 MB WASM) | `route_ready_ms` (P1 §9.3) as a Sentry measurement + P2's `engine_init {cached, ms, ok}` |
| Lesson and game pages (board pages) | LCP p75 ≤ 2.5 s, INP p75 ≤ 100 ms, board never off-screen | Speed Insights; the device × zoom suite |
| Lesson autoplay timer drift | ≤ 50 ms per step | unit test with fake timers + a Playwright timing probe |

### 9.2 Hot queries and their plans (`EXPLAIN (ANALYZE, BUFFERS)` on a dev child branch, data-model §13.6)

| Id | Query | Index / plan | Runs |
|---|---|---|---|
| Q-V1 | `legendsVolume` (§8.10) | seq scan of `legends` (≤ 60) + `chess_positions_{white,black}PlayerId_idx` aggregates + `lessons_legendId_legendOrder_key` | once per content version |
| Q-V2 | `positionsVolume` | seq scan of `chess_positions` (≤ 500) with a `"isActive"` filter + PK joins to `legends` | once per content version |
| Q-V3 | `openingsVolume(letter)` | `eco >= $lo AND eco < $hi AND "isActive"` on `openings_active_eco_name_idx` (optimization:408) or a seq scan of ≤ 3,641 rows | 5 per content version |
| Q-V4 | `openingSlugIndex` | seq scan, two columns | once per version |
| Q-V5 | `lessonsIndex` | `lessons_isPublished_pathOrder_idx` + `lesson_steps` checkpoint plies (PK range) | once per version |
| Q-C4 | `getPositionForPlay(slug)` | `chess_positions_slug_key` | once per position version (members only) |
| Q-L1 | Lesson payload: `lessons WHERE slug` + `lesson_steps WHERE "lessonId" = $l ORDER BY ply` | `lessons_slug_key` + `lesson_steps_pkey` range scan | once per lesson version |
| Q-L2 | Progress row: `lesson_progress WHERE ("userId","lessonId")` | PK | every S7/S8 render; `LRN-2` (`FOR UPDATE`) |
| Q-L3 | Summary: `SELECT "lessonId", status, "bestStars" FROM lesson_progress WHERE "userId" = $u` | PK prefix (≤ 50 rows) | `LRN-1`, hub RSC, `lessonCardFor` |
| Q-L4 | Next path lesson not completed: `… lessons l WHERE l."isPublished" AND l."pathOrder" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM lesson_progress p WHERE p."userId" = $u AND p."lessonId" = l.id AND p.status = 'COMPLETED') ORDER BY l."pathOrder" LIMIT 1` | `lessons_isPublished_pathOrder_idx` + PK anti-join | plan build (once per local day), S8 |
| Q-G1 | Resume: `SELECT g."referenceId", g."plyCount" FROM game_players gp JOIN games g ON g.id = gp."gameId" WHERE gp."userId" = $u AND gp."endedAt" IS NULL AND g.mode = 'LEGEND_BOT' AND g."chessPositionId" = $p AND g.status = 'IN_PROGRESS' ORDER BY g."createdAt" DESC LIMIT 1` | `game_players_userId_endedAt_gameId_idx` prefix (`endedAt IS NULL` sorts first; P2:1074) + games PK | S14, `PLAY-1` |
| Q-G2 | Restart abort: `UPDATE games … WHERE id = $parent AND status = 'IN_PROGRESS'` + the `game_players` row | PK | restart only |
| Q-T1 | Opening lines due: `SELECT count(*) FILTER (WHERE due <= $now), count(*), min(due) FROM training_cards WHERE "userId" = $u AND deck = 'OPENING'` | P5 `training_cards_userId_deck_due_idx` | inside P5's hub batch |

There is no N+1: every loader is one statement, or a `Promise.all` of independent ones. DTO `select`s only (api-design F-18). BigInt never leaves the DAL.

### 9.3 Caching layers

| Layer | What P8 puts there | Key / invalidation |
|---|---|---|
| L0 browser HTTP | versioned `CAT-*` JSON (`public-immutable` with the current `v`), hashed engine WASM (P2), OG images (`public, immutable` with `v`), R2 portraits (immutable keys) | URL |
| L1 service worker | `StaleWhileRevalidate` cache **`rc-public`** for `/legends/positions/*` HTML (max 30 entries, 7 days) → the S1 `offline` state (P11:116). `/api/*` stays `NetworkOnly` (P1 H8). | cache-name bump |
| L2 Vercel CDN | the HTML of every public page; `CAT-*` responses (`Vercel-CDN-Cache-Control`, `Vercel-Cache-Tag`) | `revalidateTag` (pages + Data Cache) from admin writes (`after()`) and `INT-R`; versioned JSON URLs need no purge |
| L3 Next Data Cache | the volumes (§8.10), `getPositionForPlay(slug)`, `getLessonPayload(slug)`, `getDrill(slug)`, the R2 explanation fetches | tags §8.11; **no `revalidate` seconds anywhere** (D8-17) |
| L4 React `cache()` | every loader above, so `generateMetadata` and the page share one call (fixes G15: today `legends/[referenceId]/layout.tsx:10` + `page.tsx:17`, and the openings pair) | per request |
| L5 instance memo | parsed volumes, keyed by `v` (LRU 8) | process lifetime |
| L6 TanStack Query | §5.2 keys | `v` changes, mutation responses |

**ISR settings.**
- Every public page sets `export const revalidate = false` and `export const dynamicParams = true`.
- `generateStaticParams`: S2 = practice set + featured (≤ 60); S6 = visible legends (≤ 60); S9 letters = 5; S10 = the top 300 by `popularity`; S11 = curated drills (≤ 20).
- Build time stays under 2 minutes: about 450 pages × about 50 ms, every page reading the volumes. The build falls back to `[]` params when `DATABASE_URL` is absent, as the sitemaps do today.
- Pages never call `headers()` or `cookies()` (AP-14). `X-Robots-Tag` and similar response headers live in `next.config.js` `headers()`.

### 9.4 Payload budgets

| Response | Budget (raw / brotli) | Today |
|---|---|---|
| `/openings` HTML | ≤ 200 KB / ≤ 30 KB (48 cards, no PGN in the rows) | 8.1 MB / 286 KB (audit-client) |
| `/legends` HTML | ≤ 120 KB / ≤ 20 KB (≤ 60 cards) | the full page with photos |
| S1 / S2 HTML | ≤ 90 KB / ≤ 18 KB | — |
| `CAT-1` | ≤ 12 KB / ≤ 4 KB | 17 columns, including JSON, per legend |
| `CAT-3` page | ≤ 10 KB / ≤ 3 KB (48 × ≈ 190 B) | all 3,641 rows |
| `CAT-6` volume | ≤ 70 KB / ≤ 14 KB per letter | ≈ 330 KB per call, persisted in localStorage |
| `LessonPayload` in the RSC payload | ≈ 6 KB / ≈ 2 KB | — |
| Legend game snapshot | P2's snapshot + `legend` block ≤ 400 B; the prefix rides in P2's `prefix.sans` string (≤ 120 SAN ≈ 0.7 KB). P2's `GameState` size test uses the longest seeded legend prefix (TS, ply 93; AP-16). | — |
| `LRN-2` body | ≤ 2 KB typical (≤ 8 KB cap) | — |
| OG image | ≤ 80 KB PNG | text-only today |
| R2 portrait | ≤ 8 KB (96 px) / ≤ 25 KB (256 px) WebP | arbitrary remote images through the optimizer |

### 9.5 JavaScript budgets (first-load JS, gzip, from `next build`; the CI bundle report from P1 F7)

| Route | Budget | How |
|---|---|---|
| Public Learn pages (S1, S2, S5, S6, S9, S10, S12) | ≤ 180 KB total, ≤ 40 KB page-specific | server-rendered `MiniBoard` / `StaticBoard` SVG; no chess.js, no Stockfish, no socket.io, no `motion`, **no clerk-js** (D8-21); islands are small client components; TanStack Query only in islands that fetch; no zod at runtime (`devSchema`, AP-12) |
| Drill pages (S11) | ≤ 220 KB | chess.js (≈ 25 KB) and the interactive `Board` load through `next/dynamic` when the drill section mounts |
| Lesson player (S7) | ≤ 260 KB | board + chess.js + reducer; no engine |
| Legend game (S3) | P2's `/game` budget (≤ 300 KB without the engine) | legend components ≤ 10 KB |

The engine (7.3 MB WASM) is only ever *prefetched* on Learn pages, never executed (S2 and S14 intent).

### 9.6 Neon and Vercel budget

- **Crawlers cannot wake Neon** (DB-15, D8-6, D8-17).
  - There are about 3,800 indexable URLs (3,641 openings + about 60 legends + about 60 positions + the index pages).
  - Without time-based revalidation, a page is generated only at build, on first request, or after a tag revalidation, and every generation reads the volumes from the Data Cache.
  - Neon is queried **9 times per content version** (Q-V1…Q-V5), plus once per member-visited lesson or position-for-play.
  - Rev 1's daily and weekly windows could have caused up to about 3,800 scattered regenerations a day. At 5 min of 0.25 CU per isolated wake, that is the difference between about 0 and tens of CU-h a month.
- **Member Learn writes:**
  - a lesson run = 4–6 `LRN-2` calls (batched outbox);
  - a drill = 1 `LRN-3`;
  - a legend game = `PLAY-1` + ≤ 2 checkpoints + `complete` (P2), so about 4 invocations.
  - They run only while a member is active, so they add no wake of their own beyond the member's session.
- **Vercel Hobby:**
  - Portraits are `unoptimized` (0 image transformations of the 5,000 a month, F-VER-4).
  - CDN requests are dominated by crawlers on cached HTML.
  - The k6 crawl below is capped at **≤ 20,000 requests per run**, about 2 % of the 1M CDN requests, and runs once per sub-phase sign-off, never nightly. Before each run, `ops-weekly.yml`'s usage check must show every Hobby quota under 60 % (F-VER-2).
- **k6 scenarios** (dev only, `REPO/perf/k6/src/scenarios/`; results to `REPO/perf/results/p08-<scenario>-<sha>.json`, X18):
  - `learn-catalogue.ts`: 20 VUs walk the sitemaps for at most 1,000 iterations each, capped at 20k requests. It asserts `x-vercel-cache` HIT ≥ 95 % in the second half and `Server-Timing dbq=0` on every `CAT-*` response.
  - `learn-writes.ts`: `LRN-2` 20 rps, `LRN-3` 5 rps, `PLAY-1` 5 rps for 2 min, with synthetic members from the E2E pool. p95 thresholds from §9.1, with `abortOnFail`.
  - The Neon dev-branch query log and active time are captured before and after the catalogue run, and the expected Neon query count during the crawl is 0.

---

## 10. Telemetry

### 10.1 PostHog events

Conventions from architecture §3.4.3:
- names follow `area_object_action`, with snake-case properties;
- events are registered in **`PKG/analytics/src/events/learn.ts`** (P1's registry directory, X6), as zod schemas with closed property sets, so CI fails on an unregistered name or an extra key;
- super properties (`app_env`, `device_class`, `viewport_w_bucket`, `zoom_bucket`, `member_state`, `is_trial`, `signed_in`) are added automatically;
- events **never** carry a FEN, PGN, free text, the search query, or a legend-move SAN or UCI (the spoiler rule applies to analytics too);
- `visitor` ∈ `out | none | lapsed | member`;
- "S" = sent from the server in `after()` (authoritative); "C" = client (consent-gated after P11).

| Event | Properties | From | Notes |
|---|---|---|---|
| `legend_catalogue_viewed` | `count, visitor` | C S1 | once per page view |
| `legend_catalogue_filtered` | `themes_count, results` | C S1 | debounced 1 s |
| `legend_position_selected` | `slug, source: catalogue\|detail\|legend\|next\|home\|onboarding\|lesson` | C S1, S2 | |
| `legend_cta_clicked` | `surface: catalogue\|detail\|legend_detail\|guide, visitor, slug` | C | funnel from SEO to trial |
| `learn_paywall_hit` | `surface: play\|lesson\|drill_save, visitor` | C | the CTA shown to a non-member |
| `bot_game_started` (**P2, reused**) | P2's `elo, color, start_kind, reason` + P8's `mode: legend_bot, slug, series_no, entry, study_s` | S `PLAY-1` | the props are added to P2's schema in `events/game.ts` |
| `legend_practice_started` | `slug, color: hero\|opposite, bot_elo, tc_initial_s, tc_increment_s, series_no, reason: new\|rematch\|restart\|next, entry, study_s` | S `PLAY-1` | `entry` is the "from" of critique-testing's assertion |
| `legend_practice_completed` | `slug, outcome: win\|loss\|draw, method, plies, found_legend_move, assist_hints_count, assist_undos_count, duration_s, series_no` | S `PLAY-4` | |
| `legend_practice_aborted` | `slug, reason: restart, plies` | S `PLAY-1` restart | |
| `legend_compare_opened` (**P3, reused**) | P3's `from: game_over, status` | C S3 | owner P3 (R-18); P8 adds no props |
| `engine_init` (**P2, reused**) | P2's `cached, ms, ok, elo_floor` | C | replaces rev 1's `engine_load` (R-18); `failed` → `ok: false` |
| `legends_searched` | `q_len, results` | C S5 | debounced 800 ms |
| `legends_filtered` | `era` | C S5 | |
| `legend_viewed` | `slug, visitor, lessons_count, positions_count, living` | C S6 | |
| `learn_lesson_started` | `slug, resume, from, attempt_no` | S `LRN-2` start | |
| `learn_lesson_checkpoint` | `slug, ply, result` | S `LRN-2` | |
| `learn_lesson_completed` | `slug, stars, best_stars, hints_count, shown_count, first_try_count, duration_s, attempts` | S `LRN-2` complete | |
| `learn_lesson_story_toggled`, `learn_lesson_speed_changed` | `slug, open` / `speed` | C S7 | sampled 10 % (forced to 100 % under the test sink) |
| `learn_lesson_complete_viewed` | `slug, stars, has_next, milestone` | C S8 | |
| `learn_lesson_next_clicked` | `slug, target_order: legend\|path` | C S8 | |
| `learn_lesson_replay_clicked`, `learn_lesson_play_it_out_clicked` | `slug` | C S8 | |
| `learn_lesson_slot_shown` | `slot: hub_row\|plan_step\|summary\|bank_caughtup\|weakness, slug, theme_matched` | S (in the slot provider, sampled 1 per user per day) | measures C-05/C-06/C-07 reach |
| `openings_searched` | `q_len, kind: eco\|moves\|name, family, results` | C S9 | debounced |
| `openings_family_selected` | `family` | C S9 | |
| `opening_viewed` | `slug, has_notes, visitor` | C S10 | |
| `opening_line_played` | `slug, mode: step\|auto` | C S10 | once per view |
| `opening_drill_started` | `slug, visitor, surface: guide\|drill_page\|runner` | C S11, S15 | |
| `opening_drill_completed` | `slug, mistakes_count, hints_count, duration_s, visitor` | C S11 | |
| `opening_card_saved` | `slug, created, rescheduled, grade` | S `LRN-3` | |
| `train_session_started` (**P5, reused**) | P5's props with `kind: "openings"` | S (P5 `W2`) | replaces rev 1's `train_opening_session_started` |
| `guide_viewed` / `guide_cta_clicked` | `guide: legends\|openings` / `+ target` | C S11, S12 | |

**Dashboards:**
- the SEO → trial funnel: `legend_viewed` / `opening_viewed` → `learn_paywall_hit` → `auth_signup_completed` → `trial_started`;
- lesson completion rate and the stars distribution;
- the legend-practice found-move rate by position (a content-quality signal);
- slot reach (`learn_lesson_slot_shown` → `learn_lesson_started {from}`);
- drill → card → first review retention.

### 10.2 Sentry

- **Spans:**
  - the route wrapper's `api <id>` span for every P8 route (tags `route`, `auth`, `status`, `code`);
  - custom spans `catalog.volume` (tags `volume`, `cache: hit|miss`, `bytes`), `learn.progress.apply` (statements, events count), `learn.drill.schedule`, `games.legend.create`;
  - the browser measurement `route_ready_ms` on S14 → board.
- **Sampling** (`tracesSampler`, architecture §3.4.1): `CAT-*` 0.01 in production (high volume, cached); `LRN-*` and `PLAY-1` 0.2; everything 1.0 on dev.
- **Captured messages (warning):**
  - `catalog.verify_failed {slug, issues}` (B3/B11/ADM-5);
  - `lesson.build_failed {slug, check}` (J7 in CI);
  - `lesson.content_mismatch {slug, client, server}` (409s);
  - `catalog.revalidate_failed {tags}`;
  - `catalog.volume_oversize {volume, bytes}` (above 1.5 MB);
  - `legend.complete_rejected {gameRef hash}` (P2's 422 path).
- **Client:** breadcrumbs for outbox flushes (`lessonEvents`, `openingDrills`), the engine prefetch and the SW offline map. `Sentry.setUser({id: referenceId})` only, never an email.
- **Alerts:** none new beyond P1's error-spike rule. A dashboard widget shows the `catalog.volume cache=miss` rate; a sudden rise means a tag storm.

---

## 11. Security, privacy, paywall and authorisation

| Concern | Rule in P8 | Enforced by |
|---|---|---|
| Public vs member | Public: S1, S2, S5, S6, S9–S12 and `CAT-*`. Member: `/play/legend/*`, `/game/*`, `/learn/lessons/*`, `LRN-*`, `PLAY-*`. | P1's route classes (`lib/routes/classes/learn.ts`) + `requireMemberPage()` in each member page + `route({auth: 'member'})` |
| Lapsed members | B26 default (C-21 still open): a hard redirect to `/pricing?reason=ended&redirect_url=…`. Lesson progress and opening cards are kept and resume after renewal. Queued outbox items stay queued on a 402 (P5 rule). | `requireMember()` → `402 subscription_required {reason: expired}` (R-06) |
| Trial | Trial members are members (Phase 0); nothing in Learn is trial-limited. | — |
| Ownership | Games: the player only (others get 404, never 403: api-design §2.6). Lesson progress and cards: only the viewer's own rows; no route takes a user id. | DAL scoping by `viewer.id` |
| Spoilers | `legendMoveUci/San` and `legendMateMove` exist only in the server-only `getPositionForPlay()` DTO. The public DTOs, the volumes and the game snapshot are separate zod types without those keys. `PLAY-4` reveals the move only after the server has accepted the end of the game. Proven by the unit test (§12.1) and by `learn-spoiler.spec.ts` (§12.3). | contracts + tests |
| Lesson answers on the client | Acceptable by design (D8-14): stars are self-assessed and not ranked. A lesson on the same game teaches its moves; that is content, not a leak, and the spoiler spec covers the practice surfaces only. | — |
| CDN safety | `public-*` tiers only on `auth: 'public'` routes (the wrapper refuses otherwise, P1:678). Clerk never runs on the catalogue reads (exact matcher, or the `public-nocookie` short-circuit, §7.2), so no auth cookie and no `Vary: Cookie` reaches a cached response. Member data on public pages comes only from private islands (`LRN-1`, `no-store`). Admin routes under `/api/legends/*` keep Clerk. | wrapper, matcher test, header test |
| Admin and internal | `ADM-5` and `ADM-6` require `admin` (P1 `requireAdmin()`) and log to `audit_logs` (M4). `INT-R` requires `x-internal-token` = `INTERNAL_API_SECRET` (timing-safe, R-08), a tag regex and membership in `INTERNAL_ROUTE_IDS`. The legacy admin writes stay behind P1's `requireAdmin()` and now revalidate in `after()`. | route wrapper |
| Abuse | Public JSON: edge rate limits only, through the Vercel Firewall rule at 60/min/IP on `/api/openings*` and `/api/positions*` (api-design §2.10 layer 1; variant A). Without that rule, `EDGE_DOC_LIMIT=on` in the `public-nocookie` branch (variant B; SEC-09 row). The CDN absorbs scraping. Member writes: `train-write` (LRN-2/3, burst store), `create-game` (PLAY-1, P2's durable bucket). `maxBodyBytes` on every write. P8 adds **no** limiter window longer than 60 s (AP-11). | wrapper + Firewall |
| Content integrity | All text from the content files and the DB is rendered as text (React escaping). No `dangerouslySetInnerHTML`, except JSON-LD through the existing `safeJsonLd` (`WEB/lib/seo.ts`). Explanation JSON from R2 is zod-parsed before use. OG image params are length-capped (today `:20-21`) and the FEN is validated. | code review + tests |
| Portraits and living players | D8-18: only allow-listed licences, stored on R2 with a credit and rendered with attribution; initials otherwise. Living legends: "Play This Position", factual copy, no quotes, nothing that implies endorsement; the owner decides on consent (OD-12). `remotePatterns` needs only `media.playchess.tech` (P1 closes `hostname: "**"`). | B12 allow-list, `legends.test.ts` |
| Privacy | Lesson progress, attempts and practice games are personal data covered by P10's export and delete (`lesson_progress` cascades from `User`; games follow D19). PostHog properties carry no FEN, PGN or query text. Search queries are not logged server-side beyond Vercel's request log (the normalised `q` in the URL). | schema `onDelete: Cascade`, the analytics registry + PII guard (X6) |
| Third-party content | Game scores are facts; narration and notes are our text. The Lichess openings TSV and dump are CC0, with an attribution line on `/openings`. | J8 attribution |
| SEO hygiene | Member pages carry `noindex` and are disallowed in `robots.ts` (rule file `lib/seo/robots-rules/learn.ts`). Canonical URLs are slugs; one `h1` per page. The dev deployment adds `X-Robots-Tag: noindex` globally (SEC-3, P1), so specs assert the page `<meta name="robots">`, not the header. | WP-5, specs |

---

## 12. Testing

**Runners and layout** (X1):
- Unit tests use `node:test` via `tsx` and sit beside the source as `*.test.ts`, inside P1's widened glob (`app, lib, components, features, scripts, worker, prisma, e2e/devices, e2e/fixtures`). Packages have their own `test` script.
- DB-backed tests are `*.int.test.ts`.
- Route, contract and integration tests live under **`WEB/test/api/learn/`** (rev 1 said `WEB/tests/api`). They run against a Docker Postgres 17 with the migrations applied, never Neon (X16).
- Playwright runs the main config + `playwright.devices.config.ts` with `BILLING_PAYWALL=on` (X3) and P1's console guard (X7).
- k6 runs on dev only.
- `check-test-globs` proves that every new test file runs.

### 12.1 Unit tests

| File | Cases |
|---|---|
| `WEB/lib/catalog/slug.test.ts` | diacritics ("José Raúl Capablanca" → `jose-raul-capablanca`); `&` → `and`; the 80-char cut on a boundary; legend collision `-2`; opening mainline selection (fewest plies, then lowest ECO, then id); non-mainline `-<eco>` then `-2`; reserved slugs are never produced; cuid detection |
| `WEB/lib/catalog/legends.test.ts` | visibility with `LEGEND_MIN_POSITIONS` 8 and 1; a lessons-only legend is visible; the 6 → 4 era map, with unknown → null; years label (dead, alive "born 1963", unknown); `living`; initials; portrait only with a licence and the media host; accent-insensitive token-prefix search ("j pol" → Judit Polgár; "capa" → Capablanca) |
| `WEB/lib/catalog/openings.test.ts` | normalise; classify ECO / moves / name; the scoring order (exact ECO > move prefix > name prefix > name contains; mainline tie-break); `line` = first 8 plies; `placement`; cursor round trip; a stale-version cursor → `cursor_stale` |
| `WEB/lib/catalog/tags.test.ts` | `tagsFor` for each entity; dedupe |
| `WEB/lib/data/catalog/volumes.test.ts` (int) | each volume built from the full dev catalogue stays under its §8.10 budget and under 1.5 MB; `v` is stable for unchanged data and changes when one row changes; `getCatalogVersion()` makes 0 queries when the volumes are cached; **`positionsVolume` JSON contains no `legendMove`, `pgn` or `legendMateMove` key** |
| `WEB/lib/seo/redirect.test.ts` | `catalogRedirect` → 307 with `APP_ENV=dev` and `test`, 308 with `production`, 307 when `APP_ENV` is unset in a non-production build; `config/redirects/learn.mjs` `permanent` follows `APP_ENV` |
| `WEB/lib/routes/matcher.test.ts` | the §7.2 path table for both variants (`unstable_doesMiddlewareMatch`) |
| `GC/legend/verify.test.ts` | the 7 seed positions pass with their trusted PGNs; `startPly` for White and Black to move; `prefixSans` for KT (47 SAN) and TS (93 SAN); `legendMateMove` for the Opera Game (17); the EPD compare ignores counters; a PGN that never reaches the FEN; a stored legend move that is not the next move; hero side ≠ side to move for a practice position; the side not to move in check is rejected |
| `GC/legend/practice-set.test.ts` | order KT, BF, AK, TS, Opera; wrap-around; a single available item → `next = null`; a future `availableFrom` is excluded at `now` and included after it, and produces `meta.hint`; the legend set order for Morphy |
| `GC/legend/found-move.test.ts` | the hero's first move matches → true; differs → false; promotion letter case; member on the non-hero side → null; engine moved first → null |
| `WEB/lib/games/legend.server.test.ts` | the `studySeconds` matrix (reason × entry); series numbering; colour for hero/rematch/restart; ladder snap (1184 → 1200, null → 1400, 2600 → 2200); the bot-level source order (prefs > P2 default > P4 band > 1400); `teaserKey`; meta prefix capping at 120 SAN with the adjusted `prefixStartMoveNo` |
| `TRN/lesson/machine.test.ts` | every transition of S7; autoplay every `2000 / speed` ms with fake timers; Prev never goes before `startPly` and clears `done`; Next never skips a guess; a resume at a checkpoint starts in `guess`; Hint once per checkpoint; `alsoAccept` accepted with the "Also strong" text |
| `TRN/lesson/stars.test.ts` | `max(1, 3 − hints − shown)`: (0,0) → 3, (1,0) → 2, (0,1) → 2, (2,1) → 1 (the floor); `after_wrong` costs nothing |
| `TRN/lesson/sentence.test.ts` | the design sentence for results {25: first_try, 31: hint, 33: first_try}; all first try; two hints; shown |
| `WEB/lib/learn/progress.test.ts` (pure `applyLessonEvents()`) | a duplicate `seq` is ignored; a new run resets checkpoints and counts an attempt; `resume: true` does not count; a stale run's late events are ignored; `complete` twice applies once; `bestStars = max`; content mismatch → conflict; checkpoint ply validation; missing checkpoint entries → clamped client counts; milestone only on the first completed lesson; the `planDone` lesson-step bit only when the plan's lesson step has this slug |
| `WEB/lib/learn/slots.test.ts` | `nextLessonForPlan` (first path lesson not done; theme fallback; null); `lessonCardFor` (theme match first; not-completed preference; fallback; `href` carries `from`; title builder "forks in Morphy's Opera Game"); `resolveLessonForPattern` ("fork" → the Opera Game when it is tagged; `rc:timePressure` → null; unpublished lessons never returned) |
| `WEB/scripts/lessons/build.test.ts` | runs over **every** `WEB/content/lessons/*.json`, not only the Opera Game (critique-testing P8): checkpoint plies are on the legend's side; `alsoAccept` moves are legal; every SAN in the prose parses at its ply; `[Source]` is present; an unchanged file keeps its `contentVersion`. Opera Game specifics: 15 steps (plies 19–33), checkpoints 25, 31, 33, `brilliant` on 31 |
| `TRN/opening/drill.test.ts` | user colour (Italian w, Sicilian b, Queen's Gambit w); `drillLine` must extend `pgn`; acceptance by UCI and by EPD (the transposition `1.Nf3 Nc6 2.e4 e5` vs `1.e4 e5 2.Nf3 Nc6`); grade mapping; due snapping to 08:00, including the `Europe/London` DST change in late October; not-due practice does not reschedule; the `dueLabel` forms; `itemKey` = `o_` + sqid |
| `CT/http/catalog.test.ts` | `PositionCard`, `PositionDetail`, `LegendCard` and the `GameSnapshot` legend block (in progress), parsed from loader output, never contain `legendMoveUci`, `legendMoveSan`, `legendMateMove` or `pgn` (a property test over the 7 fixtures) |
| `PKG/analytics/src/events/learn.test.ts` | every P8 event parses with its schema; no event schema accepts a key named `fen`, `pgn`, `san`, `uci` or `q` |

### 12.2 API contract and integration tests (`WEB/test/api/learn/*.test.ts`)

Time-dependent cases pin the server clock with `x-rc-now` + `x-e2e-token` (X5), never a device clock.

| Route | Cases |
|---|---|
| `CAT-1` | contract parse; hidden legend excluded; `Vercel-CDN-Cache-Control` and `Vercel-Cache-Tag: legends` set; `public-immutable` only with the current `v`; **no `Set-Cookie` and no `Vary: Cookie`**; `Server-Timing dbq=0` when the volumes are cached; an unknown query param is rejected (strict) |
| `CAT-3` | browse page 1 = 48 + cursor, and page 2 has no duplicates; exact ECO ranked first ("c50"); move prefix ("e4 e5 nf3"); name; a 1-char `q` → 400; `%` and `_` match literally; family filter; a stale cursor → 400 |
| `CAT-4`, `CAT-5` | no spoiler keys; unverified and inactive excluded; `collection=legend:<unknown>` → 404; theme counts; `meta.hint` with a future `availableFrom` at `x-rc-now`; `q` → `public-short` |
| `CAT-6` | tuples; mainline rows only; per letter |
| `PLAY-1` legend | 401 signed out; 402 `subscription_required` for R; flag off → 400 `validation_failed {reason: mode_not_available}`; 404 for an unknown or unverified slug and for a future `availableFrom`; the same `Idempotency-Key` → the same ref with `Idempotent-Replayed: true`; the same key with a different body → 422 `idempotency_key_reused`; reuse of an unstarted game; rematch swaps colours, sets `rematchOfId` and `seriesNo + 1`; restart of an `IN_PROGRESS` parent aborts it (`endMethod = 'ABORTED'`, `meta.restarted`) in the same transaction; restart of a COMPLETED parent leaves it untouched; another member's parent, or a non-legend parent → 404; the `studySeconds` matrix; the 21st create in 600 s → 429 with `Retry-After` |
| `PLAY-4` legend | `foundLegendMove` true/false/null and `teaserKey`; `next`; an idempotent second call; under 6 plies → P3 `SKIPPED`, no job; `ANALYZE_GAME` enqueued at `JOB_PRIORITY.GAME_ENDED`; `meta.assists` stored |
| `LRN-1` | per legend and `scope=all`; unknown legend → 404; R → 402 |
| `LRN-2` | start → 3 checkpoints → complete returns 2 stars; the same batch twice → identical output, attempts unchanged; a `text/plain` beacon body is accepted; out-of-order events; content mismatch → 409 `conflict {reason: content_version_mismatch}`; an invalid checkpoint ply → 400; unpublished → 404; R → 402; `training_days.lessonsDone` +1 exactly once; the plan's lesson-step bit set; milestone only the first time |
| `LRN-3` | clean run → `GOOD`, due ≥ tomorrow 08:00 local (`x-rc-now` fixed); hint → `HARD`; a duplicate `clientAttemptId` → the same card and one attempt row; not due → `rescheduled: false`; R → 402; < 4 plies → 409 `conflict {reason: drill_not_available}` |
| `ADM-5`, `ADM-6`, `INT-R` | non-admin → 401/403; a passing fixture with `apply` writes `verifiedAt`, `prefixSans` and an `audit_logs` row; a failing PGN lists its issues and writes nothing; `INT-R` without the token → 401, a bad tag → 400 |
| Lesson slots (int) | the P5 summary payload has `next.lesson` with the fork card for a fork session; `BankPage.lesson` is set only in `caughtup`; the P6 resolver returns the card for "fork" and null for unpublished lessons |
| Legacy | `GET /api/position/<ref>` → 404 (removed); `GET /api/chess-positions/featured` → 404; the legacy admin writes call `revalidateTag` (spy); `/api/legends/create` still goes through Clerk (no regression from the matcher) |

### 12.3 End-to-end (Playwright)

**Users** (X4):
- Shared members A–P only **add** data, and no P8 spec asserts absolute counts on them.
- Exact states come from the **leased personas** in `WEB/e2e/personas/p8.ts` (§6.6) through `leasePersona(name)`.
- R stays the read-only non-member; a signed-out context covers `out`.

**Every spec:**
- is tagged `@p8`, plus `@state:<Board>.<state>` or `@demo:<Board>.<state>` (X8, X11);
- runs P1's telemetry fixture, whose auto-use schema check and PII guard apply (X6);
- `learn-public-catalogues`, `legend-practice`, `lesson` and `opening-drill` are tagged `@smoke` for `ci.yml` and the post-deploy dev run (X2).

Functional specs (`WEB/e2e/specs/learn/`; Desktop Chrome unless noted):

| Spec | User | Steps |
|---|---|---|
| `learn-public-catalogues.spec.ts` | signed out | Visit the 11 public URLs from §1.2: 200, one `h1`, title + description, `<meta name="robots" content="index, follow">`, the expected JSON-LD `@type`. Against the dev URL, a second request has `x-vercel-cache: HIT` (`@local-only` skips it on localhost). `CAT-*` responses carry no `Set-Cookie`. |
| `learn-redirects.spec.ts` | signed out | `/try`, `/try/x`, `/legends/<cuid>`, `/openings/<cuid>`, `/openings?eco=C`, `/position/<cuid>`, `/position/<cuid>?type=opening` and `/learn` → **307** (dev/test) to the expected slugs. The production-mode build on port 3200 answers 308 (`@prod-build`). |
| `learn-spoiler.spec.ts` (**new**, replaces manual check 10) | signed out + persona `learn-fresh` | For each of the 7 positions in `positions.json`, **before** the game ends, the legend move's UCI and SAN (with and without `+`/`#`, and in figurine form) must not appear in the page HTML of S1/S2, the RSC payload (`fetch(url, {headers: {RSC: "1"}})`), the `CAT-4`/`CAT-5` JSON, the `PLAY-1` response, `GET /api/games/<ref>`, or any captured telemetry event. After `game:ended`, the `PLAY-4` response may contain it. |
| `legends-catalogue.spec.ts` | signed out | search "morphy"; "polgar" finds Polgár; era Soviet → count; "Nimzowitsch" → the empty state; Clear; `?q=` updated without a navigation request; `/` focuses search; a living legend's card says "born 1963" |
| `positions-catalogue.spec.ts` | signed out, R, `learn-fresh` | ↑/↓ change the board and `?p=`; theme filter count; CTA label per visitor; `upcoming`: a position with `availableFrom = now + 2 min` (`page.clock`) is hidden, then appears; offline: visit the KT detail, `context.setOffline(true)`, reload the catalogue from the SW (`rc-public`) → KT enabled, the others disabled, banner shown |
| `legend-practice.spec.ts` | `learn-fresh` | catalogue → Play vs Bot → study (STUDY clocks) → I'm Ready → play `d1d4` → resign → the teaser "You found 24.Rxd4, the move Kasparov played." → Rematch (as Black, "game 2", no study) → mid-game Restart with confirm (the aborted game is absent from `/games`) → Restart on a finished game (that game is present in `/games`) → Next → BF → reload mid-game resumes moves and clocks → after a mocked `analysis:done`, the review link opens `/review/<ref>`. Telemetry: `legend_practice_started {slug, entry: "catalogue"}` once (server sink), `legend_practice_completed {found_legend_move: true}` once, and no event carries `d1d4` or `Rxd4`. |
| `legend-detail-game.spec.ts` | `learn-fresh` | `/legends/paul-morphy` → Opera Game, move 10 → nav Learn › Legends highlighted → finish → "Back to Morphy"; `/legends/garry-kasparov` CTA reads "Play This Position" |
| `legend-practice-resume.spec.ts` | `learn-legend-unfinished` | `/play/legend/kasparov-topalov-1999` redirects to the unfinished game |
| `legend-practice-offline.spec.ts` | `learn-fresh` | finish while offline → "Saved offline" → online → exactly one `complete` request |
| `lesson.spec.ts` (P8b) | `learn-fresh` | Opera lesson with `page.clock`: Play → stops before 13.Rxd7 → `d1d7` → `best` badge → Hint at 16.Qb8+ → `b3b8` → `d1d8` → Finish → 2 stars + the design sentence; the legend page island reads "1 of N"; leave at ply 22 and reopen → ply 22; a replay for 3 stars → "Best: 3 stars" kept after a 1-star replay. Telemetry: `learn_lesson_completed {stars: 2}` once. |
| `lesson-wrong.spec.ts` (P8b) | `learn-fresh` | a wrong move shows "Not Morphy's move" + red rings; Show me → `shown`; the stars reflect it |
| `lesson-resume.spec.ts` (P8b) | `learn-lesson-progress` | Morphy–Anderssen resumes at ply 20; the hub row reads "Morphy 1 of N" |
| `lesson-paywall.spec.ts` (P8b) | R, signed out | `/learn/lessons/morphy-opera-game` → pricing (R) / sign-in (out) with `redirect_url` |
| `opening-stepper.spec.ts` | signed out | Next/Previous/Home/End/Space; the idea text and `aria-current` follow; no chess.js chunk is loaded (network assertion) |
| `opening-drill.spec.ts` | signed out, `learn-fresh` (P8b), `learn-opening-due` (P8b) | out: complete → the trial CTA and no `/api/learn` request. Member: a wrong move slides back with the status text; Show the Move draws the arrow; complete → `dueLabel` with the server time fixed by `serverNow.set()`. `learn-opening-due`: the `/train` "Opening lines · 1 due" row → runner `OpeningLineItem` → grade Good. |
| `openings-search.spec.ts` | signed out | "C50" → Italian first; "e4 e5 Nf3"; the family page; Load More appends 48 unique cards; a mocked 429 (`x-rc-fault`) shows the countdown |
| `learn-lights-up.spec.ts` (P8b) | `learn-fresh`, `learn-caughtup-fork`, P6 persona (if P6 merged) | the Train hub lessons row + plan step 3; **a bank session with a fork → the summary card "Legend lesson: forks in Morphy's Opera Game" → `/learn/lessons/morphy-opera-game?from=summary` (E60, C-05)**; **caught-up bank → "Legend lesson on your top theme" card (C-06)**; **weakness profile top row "Legend lesson" → the lesson (C-07)**; Home "Play the Opera Game" → `/play/legend/opera-game` with study; ⌘K "morphy" → `/legends/paul-morphy`; P3 compare "Another Position" → `/legends/positions`; onboarding Done CTA (P4's onboarding persona). With `learn-v3` off, every slot is absent (no dead link). |

**Device × zoom suite** (`WEB/e2e/devices/learn/`; 8 devices × 80/100/110/125/150 % = 40 projects from P1; tiered per X9):
- `one-viewport.spec.ts`: for S1, S2, S3 (the KT game in `study`, `your_move`, `over`; the TS game for the longest prefix), S4 (Opera, move 10), S7 (`narrating`, `guess`, `done`), S8, S10 and S11:
  - the board's bounding box is inside the viewport;
  - both player bars and the primary control are visible;
  - `document.scrollingElement.scrollHeight ≤ innerHeight`.
  - It also runs on the `stress=1` demo data (the longest opening name "Sicilian Defense: Najdorf Variation, English Attack", a 120-ply prefix, 20-character usernames) at 150 %.
- `routes.real.ts` additions (X9 real-route layer): `/legends/positions`, `/legends/paul-morphy`, `/openings/italian-game`, `/learn/lessons/morphy-opera-game` (P8b), signed in as a shared member.
- `scroll-regions.spec.ts`: on D/IL, S5, S6 and S9 keep the document unscrolled and scroll their `ScrollRegion`. On P/A the page may scroll and the CTA bar stays pinned.
- `a11y.spec.ts`: P1's axe helper on every P8 page, plus keyboard-only runs of S1 (listbox), S7 (Space/←/→/H/S) and S11.
- **Visual baselines** (X10; `toHaveScreenshot`, P1 tooling; desktop-1440 and iPhone, light and dark):
  - `/legends`, `/legends/paul-morphy`, `/legends/positions`, `/openings`, `/openings/italian-game`, `/learn/legends`;
  - the S3 KT result card (`found` teaser);
  - after P8b, lesson `narrating`, lesson `guess` and `V3LessonComplete`.
  - Avatars and relative dates carry `data-vr-mask`.

**Demo routes** cover the states that real data cannot reach on demand. Each is listed in `design-states.overrides.json` with its reason, and all of them sit under P1's fail-closed `/dev/ui/**` guard (X12):

| Route | States |
|---|---|
| `/dev/ui/learn/catalogue?state=` | `loading`, `error`, `offline`, `empty` |
| `/dev/ui/learn/game?state=` | `engine_failed`, `other_tab`, `saved_offline`, `rejected` |
| `/dev/ui/learn/lesson?state=` | `saving_offline`, `story` |
| `/dev/ui/learn/drill?state=` | `complete_save_failed`, `complete_lapsed` |
| any of the above | `stress=1` |

### 12.4 Chess-correctness fixtures (`PKG/chess-fixtures/learn/`)

These were replayed with chess.js 1.4.0 while writing this plan (scripts `SP/p8tools/verify.cjs` and `SP/p8tools/ma9.cjs`). The replays move into a committed test: `PKG/chess-fixtures/learn/fixtures.test.ts`, alongside P2's design-FEN extraction (X13).

| Fixture | Assertion | Status |
|---|---|---|
| `positions.json` (the 7 rows of §6.6) | FEN valid; legend move legal; legal-move counts KT 47, BF 51, AK 52, TS 13, Opera 43, Morphy–Anderssen 49, Paulsen–Morphy 48 | OK; UCIs `d1d4`, `g4e6`, `f4d6`, `f5h3`, `c3b5`, (from source), `d3f3` |
| `opera-game.pgn` | ply 18 = `rn2kb1r/p3qppp/2p2n2/1p2p1B1/2B1P3/1QN5/PPP2PPP/R3K2R w KQkq - 0 10` (the board); final = `1n1Rkb1r/p4ppp/4q3/4p1B1/4P3/8/PPP2PPP/2K5 b k - 1 17`, checkmate (the `V3LessonComplete` board); checkpoint plies 25, 31, 33 = Rxd7, Qb8+, Rd8#; `legendMateMove = 17` | OK |
| `italian-drill.json` | 10 plies to `r1bqk2r/pppp1ppp/2n2n2/2b5/2BpP3/2P2N2/PP3PPP/RNBQK2R w KQkq - 0 6`; the user is White, with 5 moves | OK |
| `paulsen-morphy-card.json` | after 6…Re8 = `r1bqr1k1/pppp1ppp/2n2n2/1Bb1N3/4P3/2N5/PPPP1PPP/R1BQ1RK1 w - - 1 7` (the `V3LegendDetail` card); Morphy is Black | OK (the title is fixed in S6) |
| `morphy-anderssen-1858-9.json` | after 7…f5 = the card FEN; after 13…d5 = the move-14 board FEN | **DoD item:** confirmed against a trusted PGN, whose URL or book reference is recorded in the fixture's `source` field (B11 refuses without it) |
| `transpositions.json` | `1.Nf3 Nc6 2.e4 e5` and `1.e4 e5 2.Nf3 Nc6` reach the same EPD; `1.d4 Nf6 2.c4 e6` vs `1.c4 e6 2.d4 Nf6` | **DoD item** (rev 1: "to add") |
| `negative.json` | the side not to move is in check; a PGN that leaves the FEN path at ply 12; a stored legend move that is illegal; a checkpoint on the opponent's ply (for build.test) | **DoD item** (rev 1: "to add") |

### 12.5 Regression of earlier phases

The regression gate is **the whole suite** on the final `dev` SHA (main + devices, paywall on; nightly + one dev-URL run; X11). P1's `flags-off` project runs the earlier phases' `@smoke` specs with `learn-v3` off. Targeted extras:

| Phase | Extras |
|---|---|
| P1 | shell; palette (the legends group now `CAT-1`); session-expired; the rate-limit specs; **`data-layer.spec.ts` step (3) now asserts "48 cards + nextCursor"** (§3.2) |
| P2 | `play-with-bot.spec.ts`, the bot-game runner unit tests, the `complete` tamper test (422); a `BOT` game still has no study phase; the `GameState` size test with the TS legend prefix |
| P3 | review and compare specs, now also reached from a `LEGEND_BOT` game; analysis from `startPly` (worker integration test with a fake engine); a `SKIPPED` legend game |
| P4 | onboarding Done (the CTA targets `/play/legend/…`) |
| P5 | Train hub, bank, puzzles and outbox specs (the hub gains rows; the outbox gains the `lessonEvents` and `openingDrills` kinds); the bank cap tests (opening cards never count); `LessonCardSlot` renders nothing for `null` |
| **P6** | the weakness specs with the legend lesson slots hidden (`learn-v3` off, or no published lesson) and shown (on, lesson tagged) |
| **P7** | no coach entry during a `LEGEND_BOT` live game; the coach works on its review (`/review/<ref>/coach`) |
| **P9** (if merged before P8b) | the Play hub Legend tab still lists `CAT-5` positions and links to `/play/legend/<slug>?entry=playhub` |
| tooling | `scripts/seo-check.ts` (updated), the Prisma drift gate, `check-types`, lint, the bundle report, `check-test-globs` |

### 12.6 Manual checklist (ego-browser on the dev URL, then a real iPhone and Android)

1. Every §1.2 owner step on desktop Chrome at 100 % and 150 %.
2. Signed out: the Learn pages show the marketing header and no app nav. The CTA box does not jump on hydration (record a performance trace; CLS ≤ 0.05). No clerk-js chunk loads (network panel).
3. Signed in on a public page: the "Play" + avatar island; the Learn sub-nav links work; the lesson island shows within 2 s, including after leaving the tab idle for 2 minutes (stale token → refresh path).
4. iPhone: the S1 list scrolls inside its region while the CTA bar stays in the thumb zone; the S3 result sheet at 60 % never covers the clocks; the S7 transport bar replaces the tab bar; Story opens a sheet.
5. Android: the same as 4; the keyboard does not push the board off-screen on the S9 search.
6. iPad portrait: the S2 board formula leaves room for the panel; the S7 aside scrolls inside its region.
7. Engine first load on a throttled 4G profile: "Starting the engine · n %", then ready in ≤ 6 s; the second game in ≤ 1.5 s.
8. Kill the network mid-lesson, finish, reconnect: progress lands once (check `lesson_progress` on the dev branch).
9. Rename a legend through the admin page: the public page updates on the next request (tag revalidation), with no redeploy.
10. View the source of S2 and of `/game/<ref>` mid-game: no legend move. This repeats `learn-spoiler.spec.ts` by hand.
11. Portraits: every shown portrait has a visible credit; a living legend's page has no "Play as".
12. Close the ego-browser pages at the end (`task.finish({ keep: [] })`).

### 12.7 Performance checks

- k6 `learn-catalogue.ts` and `learn-writes.ts` (§9.6) against dev. The thresholds from §9.1 fail the run (`abortOnFail`). The results JSON is committed to `REPO/perf/results/`, and `compare.ts` flags a regression above 15 % (X18).
- **Post-deploy on dev** (P1's `post-deploy-dev.yml` gains the step `REPO/scripts/qa/post-deploy/learn-cache.ts`):
  - `curl -sI` on each `CAT-*` route and the 11 public pages, twice: `x-vercel-cache: MISS` (or `STALE`) then `HIT`;
  - the `Vercel-Cache-Tag` header is present and there is no `set-cookie`;
  - `scripts/seo-check.ts --base $E2E_BASE_URL` (both were manual in rev 1).
- Lighthouse mobile on `/legends`, `/openings`, `/openings/italian-game` and `/legends/positions/kasparov-topalov-1999`: performance ≥ 90, LCP ≤ 2.0 s (simulated 4G).
- The `next build` report: the budgets in §9.5. CI fails on a regression above 5 %.
- `EXPLAIN (ANALYZE, BUFFERS)` of Q-V1…Q-T1 on a dev child branch (data-model §13.6), attached to the PR.

### 12.8 Test hooks added by P8 (X12)

- P8 adds no new header or env hook. It uses P1's `x-rc-now`, `x-rc-fault` and `/dev/ui/**`, and P5's persona reset mode.
- The `/dev/ui/learn/*` routes are covered by P1's `/dev/ui/**` registry entry.
- `prod-guard.spec.ts` therefore needs no new row, apart from asserting that `/dev/ui/learn/catalogue` returns 404 in the production build.

---

## 13. Work breakdown

### 13.1 Order and streams

```
P8a (after P3)        day: 1   2   3   4   5   6   7   8   9  10  11  12  13  14  15  16  17
WP-0  schema/scripts/verify  █████████▒                                                     M8, B3/B4/B11/B12, verify lib, J7 build only
WP-1  contracts/volumes/CAT  ██████████                                                     contracts day 1 (frozen), volumes, CAT routes, INT-R
WP-2  public shell + kit         ████████                                                   MarketingTopNav v1, LearnSubNav, client hint, learn components
WP-3  legends + positions                ████████                                           S1, S2, S5, S6, S12
WP-4  openings + guide + drill                   ████████                                   S9, S10, S11 (local completion)
WP-5  SEO/redirects/routes/SW                            ████                               sitemaps, 307/308, route classes, matcher, rc-public
WP-6  legend practice                    ██████████████                                     S3, S4, S14, PLAY-1/4 extensions
WP-J8 popularity + notes         ██                                                         J8 dump run (laptop compute ≈ 2–3 h)
WP-10a tests/perf (P8a)      ▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒████                         spoiler spec, visuals, k6, post-deploy

P8b (after P5; P6 for S16)  day: 1   2   3   4   5   6   7   8   9
WP-7  lessons                ██████████████                                                 S7, S8, LRN-1/2, outbox kind, publish
WP-8  opening deck                         ██████                                           LRN-3, M8b, OPENINGS session, S15, hub row
WP-9  lights up                                  ██████                                     S13 L1–L9, S16, slot providers
WP-10b tests (P8b)           ▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒████                                   lesson specs, lights-up spec, visuals

WP-C  content track (owner calendar, allocation §8): ░░░ from P8a day 1 to P8b sign-off
```

- With one developer the streams run in sequence (P8a ≈ 17 d, P8b ≈ 8.5 d). Two developers split P8a's public stream (WP-2/3/4/5) and member stream (WP-6).
- `DB` (WP-0) and `CT/http/{catalog,learn}.ts` (WP-1) are written first and then frozen. Later changes go through their owner (allocation §0: "single owner per week" for the schema).

### 13.2 Work packages with strict file ownership

**Shared registries are directories** (feasibility §7; P5 final already uses them).
- P8 **adds files** and one barrel line each:
  - `WEB/lib/api/keys/learn.ts`;
  - `WEB/lib/flags/registry/p8.ts`;
  - `WEB/lib/routes/classes/learn.ts`;
  - `WEB/config/redirects/learn.mjs`;
  - `WEB/lib/seo/robots-rules/learn.ts`;
  - `WEB/e2e/personas/p8.ts`;
  - `PKG/analytics/src/events/learn.ts`;
  - `WEB/components/shell/palette/providers/legends.ts`.
- If P1 has not converted a registry yet, the edit goes into the single file under the weekly steward rule.
- `WEB/package.json` and the lockfile have one weekly steward (P1-03). `REPO/OWNERS.yml` lists P8's globs for its weeks.

**"Edit (one hook)"** means a minimal insertion into a file owned by an earlier phase. The earlier phase's owner reviews it.

**WP-0 · Schema, data scripts, verification library (P8a, 2.5 d)**

- **Creates:**
  - `DB/prisma/migrations/<ts>_m8_learn/migration.sql`;
  - `DB/src/json/{legend-notes,move-notes,lesson-checkpoints}.ts`;
  - `GC/legend/{verify,practice-set,found-move}.ts` (+ `.test.ts`);
  - `WEB/scripts/backfill/{catalog-keys,explanations-to-r2,legend-practice-seed,legend-portraits}.ts`;
  - `WEB/scripts/lessons/build.ts` (+ test) — the J7 pipeline, run without `--publish` in P8a;
  - `WEB/content/positions/sources/*.pgn` (7 files, owner-supplied, with `[Source]`);
  - `WEB/content/legends/portraits.json`;
  - `WEB/content/lessons/morphy-opera-game.json` + `sources/morphy-opera-game.pgn`;
  - `WEB/lib/catalog/{slug,eco}.ts` (+ tests);
  - `WEB/e2e/personas/p8.ts`;
  - `PKG/chess-fixtures/learn/*` + `fixtures.test.ts`.
- **Edits:** `DB/prisma/schema.prisma` (§6.1); `DB/prisma/protected-indexes.txt`; `DB/src/json/game-meta.ts` (optional `entry`, `restarted`); `WEB/lib/prisma.ts` (global `omit`); `WEB/prisma/seed/content.ts` (§6.6).
- **Acceptance:**
  - `migrate deploy` from scratch on a local Docker Postgres and on the Neon dev branch; the drift check passes;
  - B3/B4/B11/B12 `--dry-run` print the expected counts, and `--apply` is idempotent (a second run changes 0 rows);
  - B4's SHA-256 check passes; the 7 seed positions verify against trusted sources;
  - the Opera Game builds through J7 (unpublished); `check-types` is green.

**WP-1 · Contracts, catalogue volumes, public JSON, revalidation (P8a, 2.5 d)**

- **Creates:**
  - `CT/http/catalog.ts`, `CT/http/learn.ts` (every P8 schema from §7, written on day 1) + `catalog.test.ts`;
  - `WEB/lib/data/catalog/{volumes,positions-play,lessons,drill}.ts` (`import "server-only"`) + `volumes.test.ts`;
  - `WEB/lib/catalog/{legends,openings,positions,tags,revalidate,version}.ts` (+ tests);
  - `WEB/app/api/legends/route.ts` (rewritten as `CAT-1`);
  - `WEB/app/api/openings/route.ts` (rewritten as `CAT-3`);
  - `WEB/app/api/openings/[slug]/route.ts` (`CAT-2`), `WEB/app/api/openings/index/route.ts` (`CAT-6`);
  - `WEB/app/api/positions/route.ts` (`CAT-5`), `WEB/app/api/positions/[slug]/route.ts` (`CAT-4`);
  - `WEB/app/api/admin/positions/[slug]/verify/route.ts` (`ADM-5`), `WEB/app/api/admin/legends/route.ts` (`ADM-6` GET);
  - `WEB/app/api/internal/revalidate/route.ts` (`INT-R`);
  - `WEB/lib/api/keys/learn.ts`;
  - `WEB/test/api/learn/catalog.test.ts`.
- **Edits:**
  - `CT/http/games.ts` (the `GameStart` variant, `reason: "next"`, `entry`, `LegendBlock`, `LegendCompleteExtra`, `GameState.mode` + `LEGEND_BOT`);
  - `CT/http/codes.ts` (two `CONFLICT_REASONS`);
  - `WEB/lib/api/route.ts` **only if** P1 lacks the tier resolver (one hook);
  - the five legacy admin write routes (`after(() => revalidateCatalog(...))`, one line each);
  - `WEB/lib/data/review.ts` (P3: read explanations through `getPositionExplanation()`, one call site);
  - `WEB/app/admin/{page,legends/page,tournaments/create/page}.tsx` (switch to `ADM-6` / `CAT-6`, one fetch each);
  - P1's `WEB/app/dev/ui/data/DataDemo.tsx` + `e2e/specs/data-layer.spec.ts` step (3) (`qk.catalog.openings({})`);
  - `INTERNAL_ROUTE_IDS` (+ `INT-R`).
- **Deletes:** `WEB/app/api/chess-positions/featured/route.ts`, `WEB/lib/featured-positions.ts`, `WEB/lib/featured-position-types.ts` (if unused), `WEB/app/api/position/[referenceId]/route.ts`, `CT/http/openings.ts`.
- **Acceptance:**
  - every `CAT-*` route passes §12.2;
  - headers verified on the dev deployment (`MISS` then `HIT`), with no `Set-Cookie`;
  - `dbq=0` on a warm cache; the spoiler unit test is green;
  - the admin pages still list legends.

**WP-2 · Public shell and shared Learn components (P8a, 2.0 d)**

- **Creates:**
  - `WEB/app/(marketing)/(learn)/layout.tsx` (no `ClerkProvider`; fonts from P1);
  - `WEB/app/(marketing)/layout.tsx`, if P11 has not created it;
  - `WEB/components/marketing/{TopNav,AuthHint,LearnSubNav}.tsx` (the `MarketingTopNav` v1 contract from P11:197);
  - `WEB/lib/auth/client-hint.ts` (+ test; shared with P11, first to merge creates) and `WEB/lib/auth/fresh-token.ts`;
  - `WEB/components/learn/useVisitor.ts`;
  - `WEB/components/learn/{MemberCta,StaticBoard,MiniBoardClient,PositionRow,LegendCard,FamousGameCard,LegendHero,OpeningCard,FamilyChips,SearchField,StarRating,EnginePrefetch,Portrait}.tsx`;
  - `WEB/components/learn/og/board-svg.ts` (the shared 8×8 SVG renderer for `StaticBoard`, `MiniBoardClient` and the OG route);
  - the gallery sections `WEB/app/dev/ui/_sections/learn.tsx`.
- **Edits:** none outside new files.
- **Acceptance:**
  - the `/dev/ui` "Learn" section renders every component in light and dark;
  - `MemberCta` renders the four visitor variants with an identical box size (screenshot diff);
  - `useVisitor()` reads the hint without a network request and without clerk-js;
  - P11 can extend `TopNav` without breaking its props (documented in JSDoc).

**WP-3 · Legends and positions pages (P8a, 2.0 d)**

- **Creates:**
  - `WEB/app/(marketing)/(learn)/legends/{page,loading,error}.tsx`;
  - `…/legends/[slug]/{page,not-found}.tsx`;
  - `…/legends/positions/{page,loading,error}.tsx`;
  - `…/legends/positions/[slug]/{page,not-found}.tsx`;
  - `…/learn/legends/page.tsx` (S12);
  - `WEB/components/learn/{LegendsBrowser,PositionsBrowser,LessonProgressIsland,PositionPreview}.tsx`.
- **Deletes** (one release after parity, §13.4): `WEB/app/(app)/legends/**` (P1's moved copies of `app/legends/page.tsx`, `layout.tsx`, `[referenceId]/{layout,page,ChallengeLegendButton}.tsx`), `WEB/app/learn/legends/page.tsx`.
- **Acceptance:**
  - S1, S2, S5, S6 and S12 in every state of §4 on D/IL/IP/P/A;
  - JSON-LD present; `generateStaticParams` builds;
  - cuid params redirect (WP-5 owns the static redirects, WP-3 the page-level `catalogRedirect`);
  - the visual baselines are committed.

**WP-4 · Openings pages, guide and the line drill (P8a, 2.0 d)**

- **Creates:**
  - `WEB/app/(marketing)/(learn)/openings/{page,loading,error}.tsx`;
  - `…/openings/eco/[letter]/page.tsx`;
  - `…/openings/[slug]/{page,not-found}.tsx`;
  - `…/learn/openings/page.tsx`;
  - `…/learn/openings/drill/[slug]/page.tsx`;
  - `WEB/components/learn/{OpeningsSearch,OpeningStepper,LineDrill,GuideToc}.tsx`;
  - `TRN/opening/{line,accept,user-color}.ts` (+ tests).
- **Deletes** (one release after parity): `WEB/app/(app)/openings/**` (P1's moved copies of `page.tsx`, `layout.tsx`, `OpeningsSearch.tsx`, `[referenceId]/{layout,page,OpeningBoardPreview}.tsx`), `WEB/app/learn/openings/page.tsx`.
- **Acceptance:**
  - S9–S11 in every P8a state;
  - `/openings` HTML ≤ 200 KB; the stepper page loads no chess.js chunk;
  - the drill accepts the transposition fixture;
  - a signed-out completion shows the CTA with no request.

**WP-5 · SEO, redirects, route classes, service worker (P8a, 1.0 d)**

- **Creates:**
  - `WEB/app/sitemap-positions.xml/route.ts`;
  - `WEB/app/position/[referenceId]/route.ts` (the redirect resolver);
  - `WEB/lib/seo/redirect.ts` (+ test);
  - `WEB/config/redirects/learn.mjs`;
  - `WEB/lib/routes/classes/learn.ts` + `WEB/lib/routes/matcher.test.ts`;
  - `WEB/lib/seo/robots-rules/learn.ts`.
- **Edits:**
  - `WEB/middleware.ts` (the matcher lines of §7.2, with P1's owner reviewing);
  - `WEB/next.config.js` (the Workbox `rc-public` route; the redirects barrel line);
  - `WEB/app/sitemap-legends.xml/route.ts`, `WEB/app/sitemap-openings.xml/route.ts`, `WEB/lib/sitemaps.ts`, `WEB/app/sitemap.ts`;
  - `WEB/app/og/route.tsx` (`type=position`);
  - `WEB/scripts/seo-check.ts`.
- **Deletes:** `WEB/app/position/[referenceId]/{page,PositionPageClient}.tsx`.
- **Acceptance:**
  - `learn-redirects.spec.ts` (307 on dev; 308 in the production build);
  - `matcher.test.ts` passes for both variants;
  - `pnpm --filter web test:seo` passes against dev;
  - the sitemaps validate against the XML schema and list slugs only;
  - the OG image renders the KT board.

**WP-6 · Legend practice game (P8a, 3.5 d)**

- **Creates:**
  - `WEB/app/(app)/play/legend/[slug]/page.tsx`;
  - `WEB/features/legend-practice/{StartingGame,useStartLegendGame,LegendPracticeStrip,LegendGameHeader,LegendTeaser,LegendResultActions,StudyCard,RestartConfirm,legend-slots}.tsx`;
  - `WEB/lib/games/legend.server.ts` (+ test);
  - `WEB/test/api/learn/legend-games.test.ts`;
  - `WEB/e2e/specs/learn/{legend-practice,legend-detail-game,legend-practice-resume,legend-practice-offline,learn-spoiler}.spec.ts`.
- **Edits (one hook each, P2/P3 files):**
  - `WEB/lib/games/create-bot-game.server.ts` (dispatch `LEGEND_BOT` to `legend.server.ts`);
  - `WEB/lib/games/complete-bot-game.server.ts` (append `LegendCompleteExtra`);
  - `WEB/lib/games/snapshot.server.ts` (the `legend` block);
  - the game screen's slot assembly (pass the `legend-slots` components: teaser, actions, strip, header);
  - `GC/local/runner.ts` (study phase from `studySeconds`, D8-8);
  - P3's `GC/legend/compare.ts` (call `found-move.ts` if P3 did not add the fields).
- **Acceptance:**
  - S3 and S4 on all 26 + 3 boards' devices, with every state in S3 reachable (real data, or `/dev/ui/learn/game`);
  - the `legend-practice*` specs and `learn-spoiler.spec.ts` are green;
  - the PLAY-1/4 tests are green;
  - the one-viewport suite is green for the game in `study`, `your_move` and `over`.

**WP-J8 · Popularity and notes (P8a, 0.5 d + laptop compute)**

- **Creates:** `WEB/scripts/openings/{popularity,enrich}.ts` (+ tests on a 200-game CC0 sample), `WEB/content/openings/popularity.<yyyy-mm>.json`, `WEB/content/openings/notes/italian-game.json`.
- **Acceptance:** every mainline has `popularity > 0` or is reported; the top 48 on `/openings` look plausible to the owner (Sicilian, French, Italian, Queen's Gambit, …).

**WP-7 · Lessons (P8b, 3.5 d)**

- **Creates:**
  - `WEB/app/(app)/(immersive)/learn/lessons/[slug]/page.tsx`;
  - `WEB/app/(app)/learn/lessons/[slug]/complete/page.tsx`;
  - `WEB/features/learn/lesson/{LessonPlayer,NarrationText,ChallengeChips,GuessActions,StoryPanel,LessonTransport,LessonMoveStrip,LessonCompleteCard,useLessonEvents}.tsx`;
  - `TRN/lesson/{machine,stars,sentence}.ts` (+ tests);
  - `WEB/lib/data/learn.ts` (`getLessonProgress`, `getLessonProgressSummary`, `nextLesson`);
  - `WEB/lib/learn/progress.server.ts` (`applyLessonEvents`, the transaction) (+ test);
  - `WEB/app/api/learn/progress/route.ts` (`LRN-1`);
  - `WEB/app/api/learn/lessons/[slug]/progress/route.ts` (`LRN-2`);
  - `WEB/test/api/learn/lessons.test.ts`;
  - `WEB/e2e/specs/learn/{lesson,lesson-wrong,lesson-resume,lesson-paywall}.spec.ts`.
- **Edits:**
  - `WEB/lib/offline/outbox.ts` (P5: add `"lessonEvents"` to `Kind`, with its per-slug grouping flusher);
  - `WEB/app/api/health/route.ts` (`features.learnPlayer: true`, read by `build.ts --publish`).
- **Acceptance:**
  - S7 and S8 on all 6 boards' devices, in every state;
  - the lesson specs are green;
  - the Opera Game is published on dev and plays end to end;
  - an offline completion syncs once.

**WP-8 · Opening deck (P8b, 1.5 d)**

- **Creates:**
  - `DB/prisma/migrations/<ts>_m8b_session_kind_openings/migration.sql`;
  - `WEB/app/api/learn/openings/[slug]/drill/route.ts` (`LRN-3`);
  - `WEB/lib/train/opening-cards.server.ts` (+ test);
  - `TRN/opening/{grade,due-label}.ts` (+ tests);
  - `WEB/features/train/runner/items/OpeningLineItem.tsx`;
  - `WEB/test/api/learn/drill.test.ts`.
- **Edits (P5 files, one hook each):**
  - `WEB/lib/train/session.server.ts` (`buildSession('OPENINGS')`);
  - `CT/http/train.ts` (`SessionKindW` + `"openings"`; `SessionCreate` + `{kind: "openings", source}`);
  - `WEB/features/train/runner/items/index.ts` (register `OPENING_LINE`);
  - `WEB/lib/offline/outbox.ts` (`"openingDrills"` kind).
- **Acceptance:**
  - the `LRN-3` tests pass;
  - the drill → card → due (`x-rc-now`) → runner → grade loop works on dev;
  - the bank cap is untouched (P5's cap tests still green);
  - M8b deploys one release before the first `OPENINGS` session is created.

**WP-9 · Lights up and legacy repoint (P8b, 1.5 d)**

- **Creates:**
  - `WEB/lib/learn/slots.server.ts` (+ test);
  - `WEB/lib/learn/pattern-themes.ts`;
  - `WEB/components/shell/palette/providers/legends.ts`;
  - `WEB/e2e/specs/learn/learn-lights-up.spec.ts`.
- **Edits (one hook each):**
  - P5's `WEB/lib/train/slots/{lesson-card,plan-lesson,hub-learn}.server.ts` (stub bodies → calls into `slots.server.ts`) and `CT/http/train.ts` (`TrainToday.lessons?`, `TrainToday.openingLines?`);
  - P5's hub rows (`LegendLessonsRow`, `OpeningLinesRow` through P5's slot pattern);
  - P5's `WEB/components/home/*` ("Play the Opera Game" target);
  - P6's `WEB/lib/data/lessons-for-weakness.ts` (the body; first to merge creates);
  - P1's palette provider registration (one barrel line);
  - P3's `WEB/app/(app)/(immersive)/review/[ref]/legend/*` ("Another Position" → `/legends/positions`);
  - P4's `WEB/app/onboarding/done/page.tsx` + its destination constant (D4-14 target);
  - legacy `WEB/app/play/page.tsx` (legend picker → `/play/legend/<playSlug>`; opening picker → `CAT-6`) and `WEB/lib/stores/useDataStore.ts` (drop `persist`, use `CAT-1` / `CAT-6`).
- **Acceptance:**
  - `learn-lights-up.spec.ts` (L1–L9 and S16) is green;
  - the P1/P3/P4/P5/P6 regression specs are green;
  - each slot is hidden when `learn-v3` is off or the value is null (no dead links, allocation §1.2).

**WP-10a / WP-10b · Cross-cutting tests and performance (1.0 d + 1.0 d)**

- **Creates:**
  - `WEB/e2e/specs/learn/{learn-public-catalogues,learn-redirects,legends-catalogue,positions-catalogue,openings-search,opening-stepper,opening-drill}.spec.ts`;
  - `WEB/e2e/devices/learn/{one-viewport,scroll-regions,a11y}.spec.ts`;
  - the visual baselines under `WEB/e2e/__screenshots__/`;
  - `REPO/perf/k6/src/scenarios/{learn-catalogue,learn-writes}.ts`;
  - `REPO/scripts/qa/post-deploy/learn-cache.ts`;
  - `WEB/app/dev/ui/learn/{catalogue,game,lesson,drill}/page.tsx` (demo states + `stress=1`);
  - `PKG/analytics/src/events/learn.ts` (+ test);
  - `REPO/docs/qa/phase-08a-signoff.md`, `phase-08b-signoff.md`.
- **Edits:** `REPO/perf/k6/esbuild.config.mjs` (entries); `REPO/docs/qa/design-states.overrides.json` (the P8 demo-only reasons); `REPO/.github/workflows/post-deploy-dev.yml` (one step).
- **Acceptance:**
  - all suites are green in CI on the final SHA;
  - `state-coverage` shows 0 missing for the P8 boards;
  - k6 thresholds are met on dev;
  - the device × zoom matrix is green for every P8 board page;
  - the sign-off record is committed (X15).

**WP-C · Content track (owner + Claude; owner calendar, not dev-days)**

- **Creates:**
  - `WEB/content/lessons/<slug>.json` + `sources/<slug>.pgn` for the other 8 launch lessons: Morphy × 4 more, Anderssen's Immortal Game, Capablanca vs Tartakower 1924, Tal vs Smyslov 1959, Byrne vs Fischer 1956 (rct-b Q26: 9 unique), each with `themes` (this is what lights the slots);
  - `WEB/content/openings/notes/*.json` for the top ~150 openings;
  - legend bios, styles and themes for the visible legends;
  - the portrait list `content/legends/portraits.json`, with licences;
  - trusted source PGNs for the 7 positions.
- **Process:** Claude drafts narration, prompts and hints from the verified score. J7 validates. The owner (or a named reviewer) does the chess-accuracy pass and runs `build.ts --reviewed-by=<name> --publish` (from P8b).
- **Estimate:** ≈ 0.5 d per lesson (4 d) + ≈ 2 d of opening notes + ≈ 1 d of bios, portraits and sources ≈ **7 owner-days**. This is entered in the owner calendar (allocation §8, feasibility 10.14 item 3).

### 13.3 Estimate

| WP | Sub-phase | Days |
|---|---|---|
| WP-0 | P8a | 2.5 |
| WP-1 | P8a | 2.5 |
| WP-2 | P8a | 2.0 |
| WP-3 | P8a | 2.0 |
| WP-4 | P8a | 2.0 |
| WP-5 | P8a | 1.0 |
| WP-6 | P8a | 3.5 |
| WP-J8 | P8a | 0.5 |
| WP-10a | P8a | 1.0 |
| **P8a** | | **17.0** |
| WP-7 | P8b | 3.5 |
| WP-8 | P8b | 1.5 |
| WP-9 | P8b | 1.5 |
| WP-10b | P8b | 1.0 |
| buffer (dev deploy, owner test fixes) | P8b | 1.0 |
| **P8b** | | **8.5** |
| **Total** | | **25.5** (+ WP-C ≈ 7 owner-days) |
| Recommended buffer (feasibility §8; owner decision OD-13) | | + 20 % ≈ 5.1 |

The +1.5 d against rev 1 comes from:
- the spoiler spec, visual baselines, telemetry assertions and personas (+0.5, critique-testing §4);
- the lights-up rows C-05/C-06/C-07 (+0.5);
- B12 portraits and the J8 dump script (+0.5).

Bot calibration is no longer P8's (P2 H-06 → P9).

### 13.4 Legacy retirement and the parity gates

| Legacy | Parity gate | Deleted in |
|---|---|---|
| `force-dynamic` `/legends`, `/openings` pages (P1's `(app)` copies) | S5/S6/S9/S10 specs green on the dev URL + the owner test | the first P8a release after the gate (one release later, feasibility §9 rule 3) |
| `/position/[ref]` page + API | `learn-redirects.spec.ts` green | same |
| `ChallengeLegendButton`, `OpeningBoardPreview`, the old `learn/*` pages | S6, S10, S11/S12 specs green | same |
| `useDataStore` persist | the legacy `/play` picker on `CAT-1` / `CAT-6` | P8a; the store is deleted with the legacy `/play` in P9 |

---

## 14. Risks, rollback, open questions and decisions needed

### 14.1 Risks

| # | Risk | Likelihood / impact | Mitigation |
|---|---|---|---|
| R1 | **Content accuracy.** A wrong game score, or a legend move that is not the real one, breaks trust. The design already contained recalled FENs, and the old seed's "Immortal Game" had an Italian PGN (play-b PB8). | medium / high | `verifyPosition()` and J7 refuse anything that does not replay; trusted source PGNs with a `[Source]` are required for the curated set; nothing publishes without `--reviewed-by` |
| R2 | **Content volume.** 9 lessons + 150 opening notes is real authoring work; P8 could ship code with almost no content. | high / medium | WP-C starts on P8a day 1 and sits in the owner calendar; the Opera Game is complete from the design; the legend visibility rule and the lesson sections degrade gracefully ("Lessons Coming Soon"); slots stay hidden when null |
| R3 | **Dual-chrome reversal.** Moving `legends` and `openings` out of P1's `(app)` group changes what a signed-in member sees (the marketing header instead of the sidebar). | medium / low | It matches the boards; the header island links to Play; OD-3 lets the owner pick the alternative (an edge rewrite to an app-shell variant for signed-in members, at one function invocation per member view) |
| R4 | **ISR writes and invocations on Hobby.** There are many on-demand pages (3,641 openings). | low / medium | Tag-only revalidation; on-demand renders read only the Data Cache; scripts revalidate specific tags, never `openings` wholesale except J8's final run; build-time params are capped at ≈ 450. [V] the Hobby ISR write allowance, checked in the weekly usage report. |
| R5 | **Data Cache entry limit.** The volumes could exceed the per-item limit. | low / high | Split by ECO letter; budgets in §8.10, enforced by `volumes.test.ts`; `catalog.volume_oversize` alert; fallback: split the letter volume into two halves |
| R6 | **Prisma drift on partial indexes.** | low / medium | The protected-index list + the CI drift gate (data-model §11.3); no `db push` (R-20) |
| R7 | **P2/P3/P5/P6 hook points differ** from this plan's assumptions (file names, slot providers, outbox `Kind`). | medium / low | The day-1 dependency check (§2.3); hooks are one-line insertions owned by WP-6/7/8/9 and reviewed by the earlier phase's owner |
| R8 | **Engine download on phones** for practice (7.3 MB). | medium / medium | Prefetch on intent, an immutable cache (P2), the progress UI, and the board is playable for the member's first move before the engine is ready |
| R9 | **Search-engine ranking dip** from the cuid → slug switch. | low / medium | Redirects from every old URL, sitemaps updated in the same release, canonical tags; production switches only in P13 (308 there, 307 on dev) |
| R10 | **FSRS first interval vs the "Come back tomorrow" copy.** `GOOD` for a new card is ≈ 3–4 days with P5's parameters. | certain / low | The UI always prints the real `dueLabel`; the S11 copy is reworded ("In your review queue · {dueLabel}") |
| R11 | **Stale session token on public pages** (no clerk-js, D8-21). | medium / low | `fresh-token.ts` lazy-loads headless clerk-js for members with an expired cookie; otherwise the island hides silently; manual check 3 |
| R12 | **Concurrent edits** with P5/P6/P7 on shared files (`keys`, `flags`, `middleware`, `package.json`, `CommandPalette.tsx`, `onboarding/done/page.tsx`) | medium / medium | Registry directories, `OWNERS.yml`, the weekly steward; P8 edits `middleware.ts` only for the matcher lines, with P1's owner reviewing |
| R13 | **Living players' likeness and name** on a paid product. | low / high | D8-18 copy rules, portraits only with a licence; OD-12 for consent |

### 14.2 Rollback

- **Code:** revert on `dev`. All migrations are expand-only, so the previous web build keeps working against M8/M8b.
- **Flags:** `learn-v3` off hides every member surface and lights-up slot. The public pages stay. The legacy pages are not deleted until one release after their parity gate (§13.4), so a revert brings them back.
- **Redirects:** 307 on dev, so browsers and crawlers do not cache them. **308s exist only from the P13 production cut-over, and cannot be undone** (feasibility §9, P8 row). P13 lists them in its irreversible-steps table.
- **Enum:** `SessionKind.OPENINGS` is added one release before it is written (two-release rule). A rollback to the release before M8b's writer never meets the value.
- **Content:** J7 keeps `contentVersion`; republishing an earlier lesson file restores it, and progress resets cleanly through the `content_version_mismatch` path.
- **Data:** `lesson_progress` and opening cards are user data and are never rolled back; the backfills are idempotent and re-runnable.

### 14.3 Owner decisions (please answer before WP-3/WP-6/WP-7 start)

| # | Question | Recommendation | Blocks |
|---|---|---|---|
| OD-1 | Legend visibility threshold (rct-b Q2): legends with ≥ 8 positions (the design copy), or any legend with ≥ 1 position or lesson? | `LEGEND_MIN_POSITIONS = 8` in production once the content copy has run, `1` on dev; lessons-only legends always visible (D8-15) | WP-3 |
| OD-2 | Slugs canonical with redirects (B25, rct-b Q12)? Legend slugs as full names (`paul-morphy`) rather than surnames? | Yes; full names (unique, better for search) | WP-0, WP-5 |
| OD-3 | Learn catalogue chrome for signed-in members: the marketing header with the Play + avatar island (the boards, D8-1), or the app shell through an edge rewrite? | Marketing header (static, free, matches the boards) | WP-2, WP-3 |
| OD-4 | Lesson audio (rct-b Q18) in v1? | No; text first. Optional offline TTS later (the columns exist). | WP-7 |
| OD-5 | Legend practice rules: study 30 s on the first game of a series only; no first-move abort; clocks pause while hidden; Hint/Takeback opt-in and recorded; Restart discards an unfinished game (play-b Q4, Q5, Q14)? | Yes (D8-8) | WP-6 |
| OD-6 | Approve running the read-only content export from the old production project to seed dev with the 51 legends, their positions and the opening explanations (data-model §13.2)? | Yes, once, with a read-only role | WP-0 seed, a realistic owner test |
| OD-7 | Who reviews lesson chess accuracy, and may Claude draft narration and opening notes (human-reviewed)? | The owner reviews; Claude drafts | WP-C |
| OD-8 | Where due opening lines are drilled (rct-b Q19): a Train hub row "Opening lines · n due" with its own session (D8-10), or inside the daily plan? | The hub row + the `OPENINGS` session; never counted in the bank cap | WP-8 |
| OD-9 | Copy: drop the "Included" tag on the positions catalogue (play-b Q8)? One name for the Opera Game opponents, "Duke of Brunswick & Count Isouard" (play-b Q17)? | Drop "Included"; use that name everywhere | WP-3, WP-0 seed |
| OD-10 | Openings popularity source: the CC0 dump (J8, D8-19), or the owner's token against the explorer? | The dump; the token only if the dump run fails | WP-J8 |
| OD-11 | "Next lesson" order (rct-b Q11): legend order when entered from a legend page, the five-game path otherwise (D8-11)? | Yes | WP-7 |
| OD-12 | Living legends: "Play This Position" + factual copy and no portrait without a licence (D8-18)? Ask living players for consent, or keep them out of the catalogue? | Keep them, with D8-18 copy; no outreach in v1 | WP-3, WP-C |
| OD-13 | Schedule: P8a after P3 and P8b after P5 (D8-16), or the "Launch A" cut with P8 after launch (feasibility §8)? Accept the 20 % buffer line? | P8a/P8b as planned unless Launch A is adopted; accept the buffer | calendar |
| OD-14 | Firewall variant (P1 Q-08): is a Vercel Firewall rate-limit rule available on Hobby for `/api/(openings\|positions)`? | Check the dashboard; choose variant A if yes, B otherwise (§7.2) | WP-5 |

### 14.4 Open questions and hand-offs for other phases (and the cross-cutting docs)

| Doc | Ask |
|---|---|
| **P1** | Add the six cache tiers with a per-request tier resolver (api-perf drift register); make the route classes support `public-nocookie` (Clerk skipped); take the two matcher lines of §7.2 into P1 §7.6 (api-perf §4.13 item 2); run Q-08 (variant A/B). |
| **P2** | `GameState.mode` gains `LEGEND_BOT`; `GameStart` gains `{kind: "legend_position", slug}`; `reason` gains `"next"`; the local runner's study phase hook; the size test with the TS prefix (AP-16). |
| **P3** | AP-09: move the `LEGEND_COMPARE` enqueue out of the A9 GET, then P8 may prefetch the compare page on hover; P3 owns "Replay from move N" (H-03, C-03), including on `LEGEND_BOT` cards; copy: per-board review CTA ("Open the Full Review" on `V3TryGame*`, "See What the Coach Thinks" on `V3LegendGame*`/`V3GameOverLegend`). |
| **P4** | D4-14's target is `/play/legend/kasparov-topalov-1999?entry=onboarding` (play, not the detail page). |
| **P5** | Ship the three slot provider stubs `lib/train/slots/{lesson-card,plan-lesson,hub-learn}.server.ts`, so P8 edits no P5 builder; the outbox `Kind` accepts `lessonEvents` and `openingDrills`. |
| **P6** | Keep `resolveLessonForPattern(pattern)` viewer-independent (P8 caches it under `lessons`). |
| **P7** | Replace P7:107 with: "Legend-compare **Ask** → P7 §4.5 (`/review/[ref]/coach?ply=<ply>&from=compare`); personalised compare narration and the POSITION/LESSON/MISTAKE thread kinds → later" (D8-20, C-04). |
| **P9** | The Play hub Legend tab calls `CAT-5` (search with `q`) and links to `/play/legend/<slug>?entry=playhub` (already in `LegendEntry`); P9 persists `prefs.play.botStrength` and calibrates the ladder (P2 H-06), which removes the "≈" tooltip on legend games too; P9 no longer needs to retire `/position/[ref]`. |
| **P10** | Export must include `lesson_progress` (the cascade covers delete); persisted milestones may replace the derived "first lesson" line; `MATE_LIKE_LEGEND` reads `endMethod = 'CHECKMATE'` (not `endReason`, R-01). |
| **P11** | `MarketingTopNav` (`components/marketing/TopNav.tsx`) and `lib/auth/client-hint.ts` exist from P8; extend them, don't fork; the `(marketing)/(learn)` group stays; `/api/return-target` reads P8's volumes (0 queries). |
| **P12** | Admin screens reuse `verifyPosition()`, `revalidateCatalog()`, `INT-R` and `ADM-5`; the archive must set `"isActive" = false` together with `status = 'ARCHIVED'` (R-02; P12:774's claim that P8 filters on `status` is wrong); P12 deletes `/api/legends/{create,[id],search}`, after which the matcher's `legends(?![/\w])` may become `legends`. |
| **P13** | Run M8/M8b on production, then B3/B4/B11/B12 and J7/J8 with `--apply`, then C5 one release later (the owner confirms; destructive). The 308s go live with the production cut-over and belong in the irreversible-steps table. |
| client-data-layer | §3.x key rows: `qk.catalog.openings` takes the object form; `GET /api/openings/search` and `/api/positions/search` become `CAT-3` / `CAT-5` paths. |
| api-design | CAT-3 says "`pg_trgm` on `name`": replace with "in-memory over cached volumes" (D8-6); add `CAT-6`; CAT-4 `priorMovesSan[]` → `prefixSans` string. |
| architecture | §1.12 extensions: `pg_trgm` is not needed for the catalogue. |
| allocation | §0: the P8a/P8b split (R-19); §5.1 M8: no `PositionCollection`; + `LessonStep`, `Game.seriesNo`, `ChessPosition.prefixSans`, the portrait columns; M8b `SessionKind.OPENINGS`. |

---

## 15. Definition of done

Each sub-phase signs off on its own lines; P8 is done when both have.

**P8a**
- [ ] **Deployed** to every dev target: merged to `dev`; Vercel `replay-chess-dev` green; the Neon dev branch on M8 (`migrate deploy`); backfills B3, B4, B11 and B12 applied on dev; J7 built the Opera Game (unpublished); J8 popularity applied; OCI unchanged (no socket or worker changes in P8).
- [ ] **Flag:** `learn-v3` on for the owner and the E2E pool on dev; legend practice hidden when it is off.
- [ ] **Boards:** S1–S6, S9–S12 and S14 have reachable routes, and every `data-props` state is reachable from real data or `/dev/ui/learn/*?state=`:
  - S1 `default/loading/error/offline`;
  - S2 `default/loading/not_found`;
  - S3 `study/your_move/their_move/check/promotion` (+ `over_*`; `over_guest` dropped);
  - S5 `default/filtered/empty`;
  - S9 `default/family`.
  - `state-coverage` shows 0 missing for these boards (X8).
- [ ] **Public catalogues:**
  - no `force-dynamic` left (`legends/page.tsx:7`, `openings/page.tsx:9` gone) and no `revalidate` seconds on any public page;
  - a second request returns `x-vercel-cache: HIT`;
  - the k6 crawl shows ≥ 95 % HIT and **0 Neon queries** during the crawl;
  - `/openings` HTML ≤ 200 KB; Lighthouse mobile ≥ 90 on the four pages in §12.7.
- [ ] **SEO:** slugs canonical; every redirect in §7.5 returns 307 on dev and 308 in the production build; three catalogue sitemaps on slugs; JSON-LD per page type; member pages `noindex` and disallowed in `robots.ts`; `scripts/seo-check.ts` green against dev (automated post-deploy).
- [ ] **Legend practice:**
  - owner steps 5–8 pass: rematch, restart (both kinds), next, resume, offline completion;
  - the teaser comes from `PLAY-4`;
  - **`learn-spoiler.spec.ts` green**.
- [ ] **Middleware:** `matcher.test.ts` green; the admin `/api/legends/*` routes still authenticate; no `Set-Cookie` on any `CAT-*` response.
- [ ] **Portraits:** every shown portrait has a licence and a credit; living legends show "Play This Position".
- [ ] **Fixtures:** `transpositions.json` and `negative.json` committed; `morphy-anderssen-1858-9.json` confirmed against a trusted PGN, with `source` recorded.

**P8b**
- [ ] **Deployed:** M8b on the dev branch one release before the first `OPENINGS` write; the Opera Game published; WP-C lessons published as each passes review.
- [ ] **Boards:** S7 `narrating/guess` (+ variants), S8 and S11 member states reachable; `state-coverage` 0 missing for every P8 board.
- [ ] **Lessons:**
  - owner steps 9–10 pass;
  - progress is idempotent (the duplicate-batch test);
  - `training_days.lessonsDone` and the plan's lesson-step bit update;
  - **`build.test.ts` passes for every lesson file**, each published with `--reviewed-by`.
- [ ] **Opening drill:** owner step 11 passes; `LRN-3` idempotent; the bank cap unaffected; the `OPENINGS` session works with a due card (persona + `x-rc-now`).
- [ ] **Lights up:** L1–L9 and S16 all render with real data and link to the lesson: the hub row, plan step 3, **the summary card (E60, C-05)**, **the caught-up card (C-06)**, **the weakness links (C-07)**, Home, ⌘K, compare, onboarding. All of them are hidden when `learn-v3` is off or the value is null.

**Both**
- [ ] **Legacy removed** one release after each parity gate (§13.4): `/api/position/[ref]`, `PositionPageClient.tsx`, `ChallengeLegendButton.tsx`, `/api/chess-positions/featured`, `lib/featured-positions.ts`, P1's `(app)/legends` and `(app)/openings` copies, `OpeningBoardPreview.tsx`, the old `learn/*` pages, `CT/http/openings.ts`; `useDataStore` no longer persisted.
- [ ] **CI ran it** (critique-testing §3 items 9–14):
  - lint, `check-types`, unit (§12.1), route tests (§12.2), the Playwright functional specs (§12.3) and the device × zoom suite (40 projects), with the one-viewport assertion on every board page;
  - visual baselines committed for the public pages (and the lesson states in P8b);
  - the Prisma drift gate; the bundle report within §9.5; `check-test-globs` green;
  - all of it green on the final `dev` SHA with `BILLING_PAYWALL=on`: `ci.yml`, the nightly full suites and the post-deploy dev-URL smoke.
- [ ] **Regression:** the whole suite + `flags-off` + the targeted extras in §12.5 (including P6, P7 and P9 when merged).
- [ ] **Performance:** k6 `learn-catalogue` and `learn-writes` meet §9.1, with the results files committed; the `EXPLAIN` plans for Q-V1…Q-T1 attached to the PR; every Hobby quota under 60 % after the runs.
- [ ] **Telemetry:**
  - every §10.1 event registered in `PKG/analytics/src/events/learn.ts`;
  - the server events asserted exactly once through the sink, with the PII guard green and no legend-move SAN or UCI in any event;
  - PostHog dev live view checked by hand;
  - Sentry shows the `catalog.volume` spans;
  - `error-window.ts` shows 0 new issues over ≥ 24 h after the last dev deploy (or each one triaged).
- [ ] **Hooks and data clean:** no spec mutates a shared E2E letter user; exact states come from the `p8` personas; `/dev/ui/learn/*` returns 404 in the production build.
- [ ] **Owner test** (§1.2) passed on the dev URL with ego-browser, plus a real iPhone and a real Android phone; every defect has a regression test; `docs/qa/phase-08a-signoff.md` and `phase-08b-signoff.md` committed (X14, X15).
- [ ] **Docs:**
  - this file is linked from `docs/implementation-plan.md`;
  - the owner decisions in §14.3 are recorded with their answers;
  - the hand-offs in §14.4 have been sent to the P1–P13 spec writers and the cross-cutting doc owners.

---

## Appendix A. Critique dispositions

"Applied" names where the fix lives in this document. "Rejected" gives a one-line reason. Findings that concern other phases only are not listed.

### A.1 critique-coverage

| Finding | Disposition |
|---|---|
| C-04 Legend-compare **Ask** and personalised narration bounce between P7 and P8 | **Applied:** D8-20, §2.2, §14.4 (P7 row). Ask → P7; narration → later; no P8 board has a coach entry. |
| C-05 Session-summary lesson card never lit (edge E60) | **Applied:** S13 L3, §8.7 `lessonCardFor`, §12.3 `learn-lights-up.spec.ts`, §15 P8b |
| C-06 Caught-up bank lesson card never lit | **Applied:** S13 L4 (all 8 boards/states named), §8.7, §12.3, §15 |
| C-07 P6 `resolveLessonForPattern` never replaced | **Applied:** S16, §8.7 table, WP-9, §12.1 `slots.test.ts`, §12.3, §15 |
| C-15 Bot calibration handed to P8, not mentioned | **Rejected for P8:** P2 rev 2 moved it to P9 (H-06, P2:187, next to bot-strength persistence); P8 records it as out of scope (§2.2, D8-9) and keeps the "≈" tooltip until then |
| C-03 "Replay from move 12" on `V3GameOverLegend` (P3/P8) | **No change in P8:** P3 owns it (H-03); S3 `over_legend` shows P3's block on `LEGEND_BOT` cards; the copy decision (per-board review CTA) is recorded in §14.4 (P3 row) |
| C-09 Bot-zone coach card | **No change:** P8's part (an authored `CoachLine` for `LEGEND_BOT`) is in S3; `BOT` games are P7's (P2 H-04) |
| C-21 B26 still open | **Noted:** P8 follows the B26 default (the lapsed hard redirect) in the visitor table and §11; nothing else in P8 depends on it |
| Note: 16 device boards only via a glob | **Applied:** S3 names all 16 explicitly |
| Edges E59–E61 | **Applied:** E59 (S13 L1/L2), E60 (L3), E61 (S7 → S8) |

### A.2 critique-consistency

| Finding | Disposition |
|---|---|
| #13 / R-19 / 8.1 P8 runs earlier than its inputs allow | **Applied:** D8-16 (P8a after P3, P8b after P5), §2.3 per-sub-phase dependencies, §13.1, §15 |
| 8.2 / R-01 `parentGameId`, `seriesNo`, `endReason` | **Applied:** `rematchOfId` (§7.3), `Game.seriesNo` in M8 (§6.1), `endMethod = 'ABORTED'` (§7.3 restart) |
| 8.3 / R-16 `rc-train-outbox` → `rc-outbox` key `u:<userRef>:lessons` | **Applied with one change:** the store is `rc-outbox`, but the kind name is CDL's `lessonEvents` (client-data-layer:1511, which owns the `Kind` union); drills use `openingDrills` (§5.3) |
| 8.4 / R-17 `{kind:'OPENINGS'}` | **Applied:** wire `{kind: "openings"}`; Postgres `OPENINGS` (D8-10, §8.8, S13 L5) |
| R-17 applied to `POST /api/games` `mode` | **Rejected:** P2 shipped `mode: "LEGEND_BOT"` (uppercase, P2:1403); "the first phase that ships a thing fixes its name", so P8 extends P2's literal |
| 8.5 / R-15 `qk.games.status` → `qk.review.status` | **Applied:** §5.2, §5.3 |
| 8.6 / R-18 `engine_load` → `engine_init` | **Applied:** §9.1, §10.1 (`ok` replaces `failed`) |
| 8.7 / R-06 `membership_ended` | **Applied:** `402 subscription_required {reason}` (§7, §11); `bad_request` removed (a non-legend parent → 404); `content_version_mismatch` and `drill_not_available` registered in `CONFLICT_REASONS` |
| 8.8 / R-08 / R-09 `INTERNAL_API_TOKEN` | **Applied:** `INTERNAL_API_SECRET` via `CT/internal/auth.ts` (§7.4, §7.8) |
| 8.9 / R-15 retire `OpeningsIndexData`, `qk.catalog.openingsIndex`, move `/dev/ui/data` | **Applied:** §3.2, §7.5, WP-1 edits and deletes, §12.5 (P1 `data-layer.spec.ts` step 3) |
| 8.10 `UserSettings.botStrength` | **Applied:** `UserSettings.prefs.play.botStrength` (D8-9) |
| 8.11 / R-04 `audit_logs` | **Applied:** cited as M4 (§6.4, §7.4) |
| R-02 position lifecycle (`isActive` vs `status`) | **Applied:** §6.1 contract with P12; §14.4 (P12 row) |
| R-03 `User.timeZone` | **Applied:** §8.8 (rev 1 said `User.timezone`) |
| R-05 job priority literals | **Applied:** `JOB_PRIORITY.GAME_ENDED` for `LEGEND_BOT` analysis (D8-13, §7.3, §8.5); rev 1's "priority 0" removed |
| R-07 rooms and events | **Applied:** §7.6 lists P3's `analysis:*`, `compare:ready`, `games:changed` on `user:{ref}` |
| R-10 paths and shorthands | **Applied:** shorthand table (`CT` = contracts/src, `TRN` = chess-training, `GC` = game-core) |
| R-13 rate-limit spec form | **Applied:** `train-write` = 120 / 60 s (burst); `create-game` = P2's 20 / 600 s (§7.3) |
| R-14 flags | **Applied:** `learn-v3` in `lib/flags/registry/p8.ts` (§7.8) |
| R-20 `db push` wording | **Applied:** §6.3: `migrate deploy` only on Neon; no `db push`; `migrate dev` only on local Docker; "the Neon dev branch (CLAUDE.md)" instead of IDs |

### A.3 critique-feasibility

| Finding | Disposition |
|---|---|
| #10 / F-API-2 Lichess explorer needs OAuth (J8, P8:767/1052/1064, OD-10) | **Applied:** D8-19, §6.4 J8 (CC0 dump `--stdin`), §7.7, §7.8 (`LICHESS_EXPLORER_TOKEN` fallback; `LICHESS_EXPLORER_UA` removed), OD-10 |
| F-API-2 "reuse P6 J5's stream" | **Partly rejected:** P8 uses the same dump file but its own script, because P8a may run before P6 and the jobs have different cadences (one-off vs quarterly) |
| LIC-6 Portraits and living players | **Applied:** D8-18, §6.1 portrait columns, B12, S5/S6 copy, §11, OD-12; `remotePatterns` needs only the media host (P1 closes `**`) |
| 10.14 #3 WP-C owner days into the owner calendar | **Applied:** budget line, §13.2 WP-C, §13.3 |
| 10.14 #4 / §7 registry directories | **Applied:** §13.2 header (files added per registry), R12 |
| 10.14 #5 / §9 rollback (308s permanent) | **Applied:** D8-5 (307 on dev, 308 only in production), §7.5, §14.2 |
| §9 rules 1–3 (enum two releases, versioned payloads, legacy one release) | **Applied:** M8b (§6.3), `GameMetaV1` optional keys (§6.1), §13.4 |
| #15 / §8 calendar and "Launch A" | **Applied as an owner decision:** §2.5, OD-13; the 20 % buffer line in §13.3 |
| F-VER-2 / F-VER-3 test traffic and quotas | **Applied:** k6 capped at 20k requests per run, run once per sign-off, after a quota check under 60 % (§9.6); the device matrix runs in CI per P1 (X9) |
| F-VER-4 image transformations | **Applied:** pre-sized R2 portraits, `unoptimized` (D8-18, §9.6) |
| F-VER-5 Speed Insights sample rate | **Applied:** §9.1 (`sampleRate` 0.2; Sentry spans as the second source) |
| SEC-3 dev site public | **Applied for P8's specs:** they assert the page meta robots, since dev carries `X-Robots-Tag: noindex` (§11, §12.3); the dev gate itself is P1's |
| F-NEON-2 / AP-08 timers | **Applied:** D8-13, §7.6 (no jobs, timers or cron; `availableFrom` handled client-side) |
| #6 phase-numbering crosswalk | **No change in P8:** it uses the 13-phase numbering throughout; the crosswalk belongs in the five architecture docs |
| SEC-4 / AP-44 HMAC from P2 vs R-08 static token | **No P8 decision:** P8 calls the shared `CT/internal/auth.ts` helper, so whichever scheme the owner adopts applies without a P8 edit (§7.4) |

### A.4 critique-testing

| Finding | Disposition |
|---|---|
| Spoiler check automated (`learn-spoiler.spec.ts`) | **Applied:** §12.3, WP-6, §15 |
| Fixtures "to add" (`transpositions.json`, `negative.json`) and the MA9 trusted PGN | **Applied:** §12.4 as DoD items; B11 refuses without `source` |
| `build.test.ts` over every lesson | **Applied:** §12.1, §15 P8b |
| Visual baselines for the public pages and lesson states | **Applied:** §12.3 device section, WP-10a/10b |
| Post-deploy MISS→HIT and `seo-check` automated | **Applied:** §12.7 `learn-cache.ts` in `post-deploy-dev.yml` |
| Telemetry assertions through the sink; forbid the legend SAN | **Applied:** §10.1 registry, §12.3 `legend-practice.spec.ts`, `events/learn.test.ts` |
| `legend_practice_started{slug, from}` prop name | **Rejected as named:** the event's existing property is `entry` (the same meaning, matching `Game.meta.entry` and `LegendEntry`); the assertion uses `entry` |
| Regression omits P6, P7, P9 | **Applied:** §12.5 |
| X1 one test layout (`WEB/tests/api` → `WEB/test/api`) | **Applied:** §12 header, §12.2, WP files |
| X2 CI on `dev`, `@smoke` tags | **Applied:** §12.3 tags |
| X3 paywall on | **Applied:** §12 header |
| X4 leased personas; shared letters add only | **Applied:** §6.6 persona writers, §12.3 users |
| X5 server time (`x-rc-now`) instead of the device clock | **Applied:** §1.2 step 11, §7 header (`ctx.now`), §12.2, `opening-drill.spec.ts` |
| X6 event registry location and PII guard | **Applied:** `PKG/analytics/src/events/learn.ts` (rev 1 created `events.ts` itself) |
| X7 console guard | **Applied:** §12 header (P1's fixture) |
| X8 state tags and overrides | **Applied:** §4 header, §12.3 demo routes, §15 |
| X9 real-route layer and stress data | **Applied:** §12.3 `routes.real.ts` additions, `stress=1` |
| X11 whole-suite regression + `flags-off` | **Applied:** §12.5 |
| X12 test hooks registered | **Applied:** §12.8 |
| X14 / X15 regression rule and sign-off record | **Applied:** §15, WP-10 |
| X16 Docker Postgres for CI | **Applied:** §12 header |
| X18 k6 results as data | **Applied:** §9.6, §12.7 |

### A.5 critique-api-perf

| Finding | Disposition |
|---|---|
| §4.13 #1 opening drill uses `training_cards` | **No change needed:** already so; the key is now `itemKey` on P5's real unique (§8.8; rev 1 named a non-existent `(userId, deck, openingId)` unique) |
| §4.13 #2 confirm no session read on CAT-1…6; exclude `api/(legends\|openings\|positions)` from the matcher; give the exact line | **Applied with a correction:** the exact lines are in §7.2. A literal `api/legends` exclusion is **rejected**, because it would strip Clerk from the admin `/api/legends/{create,[id],search}` routes; the matcher uses `legends(?![/\w])`, pinned by `matcher.test.ts` |
| AP-09 hover prefetch enqueues engine work | **Applied:** §5.4 (no hover prefetch of the compare query), §14.4 P3 row |
| AP-16 legend prefix up to 400 SAN in the socket frame | **Applied:** `prefixSans` as one string (`ChessPosition.prefixSans`, `PositionDetail.prefixSans`); P2's `prefix.sans` string; meta capped at 120; the size test with the TS prefix (§9.4, §12.5) |
| AP-28 `GET /api/openings` not DB-free | **Applied:** CAT-3 is `public`, cached, in memory, with no bucket and no viewer read (§7.2) |
| SEC-09 row: `EDGE_DOC_LIMIT` on `/api/openings*`, `/api/positions*` until the Firewall rule exists | **Applied:** §7.2 variant B, §11 Abuse, OD-14 |
| AP-12 zod in client bundles | **Applied:** `devSchema()` at every P8 call site (§5, §9.5) |
| AP-14 response headers from RSC pages | **Applied:** no `headers()`/`cookies()` in P8 pages; robots via metadata or `next.config.js` (§9.3, S3) |
| AP-11 rate-limit windows on the UNLOGGED table | **No change needed:** P8 adds no window longer than 60 s; `create-game` is P2's durable bucket (§11) |
| AP-15 SLOs measured with consent-gated PostHog | **Applied:** §9.1 uses Speed Insights, Sentry and Server-Timing; PostHog is secondary |
| Cache-tier names (drift register) | **Applied:** the six named tiers (§7.2); rev 1's T0/T1/NS removed |
| AP-07 per-user game index name | **Applied per P2 rev 2:** Q-G1 uses `game_players_userId_endedAt_gameId_idx` + `games_open_idx` (R-01 kept `endedAt`) |
| AP-03 / AP-04 public-plus-viewer and long private caches | **No change needed:** member data on public pages comes only from `LRN-1` (`no-store`); every long cache in P8 is public content |
