# Phase 11 · Public site, auth, system screens, PWA: detailed plan

Status: **final plan**, 2026-11-02, written against branch `dev` @ `0848b76` (Phase 0 done) and revised after the five critiques (`SP/plan/critique-{coverage,consistency,feasibility,testing,api-perf}.md`; every finding that concerns P11 is answered in Appendix A). Budget: **20 dev-days** (allocation §0) plus a 4-day buffer the owner decides on (§13.4). Boards: **41** (allocation §4, all rows marked **P11**). **Starts after P7 and P10 have merged** (consistency R-19); §2.3 says what changes if the calendar keeps P10 in parallel.

**Path shorthands**

| Short | Path |
|---|---|
| `REPO` | `/Users/rohitpandit/open_source/chess-battle-turbo` |
| `WEB`, `WS` | `REPO/apps/web`, `REPO/apps/web-socket` |
| `PKG`, `CT` | `REPO/packages`, `REPO/packages/contracts/src` (imported as `@repo/contracts/{http,socket,internal}/<file>`, consistency R-10) |
| `SP` | `/private/tmp/claude-501/-Users-rohitpandit-open-source-chess-battle-turbo/8433de47-73d2-466e-945c-3c2450748123/scratchpad` |
| `DR` | `SP/design-ref/project/v2` (every board below is `DR/<file>.dc.html`) |
| plan docs | `SP/plan/{allocation,architecture,data-model,api-design,client-data-layer,optimization}.md`; inventories `SP/plan/inv-pub.md` (pub), `SP/plan/inv-sys.md` (sys); audits `SP/plan/audit-*.md`; critiques `SP/plan/critique-*.md`; Phase 1 spec `SP/phase1/SPEC.md` |

**Line numbers** are from `dev@0848b76`. P1–P10 change several of these files before P11 starts (P1 rewrites `middleware.ts`, adds `/api/health`, fixes the SW `/api/*` caching; P2 ships `/internal/broadcast`, the restart chip and the deploy-time restart notice; P4 builds onboarding, `/checkout/activating` and `lib/navigation/return-to.ts`; P8 moves the catalogues to ISR with tagged loaders; P9 creates `UserSettings` with its `consent` column; P10 creates `worker/index.ts`, the Settings sections and `/p/[username]`). The "fate" columns state what P11 does to whatever those phases leave behind. Paths are relative to `WEB` unless they start with `REPO`, `WS`, `PKG` or `CT`. Other phase docs are cited by section, not line, because they are still being revised.

**Board-state source.** Every state list below is the `data-props.state.enum` of the board file, read with `SP/tools-p11/dump.py` (output in `SP/tools-p11/out/*.txt`). Copy quoted in "quotes" is taken from the board. The coverage critique re-checked all 41 boards and 148 enum values against this file (0 missing).

**What changed in this revision** (details and the rejected findings in Appendix A):
- Cross-phase names now follow the consistency rulings: `402 payment_update_required`, `rc-outbox`, `x-internal-token` + `INTERNAL_API_SECRET`, `game_players."endedAt"`, `CT/...` contract paths, P8 loader names, P2's `server:restarting {restartAt, resumes}` payload, `RATE_LIMIT_IP_PEPPER`, `NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA`.
- P2 already owns `/internal/broadcast`, the in-game restart chip and the deploy pre-announce; P11 only adds the `notice` message type and the socket-side maintenance refusal.
- `QueryProvider` leaves the root layout with `ClerkProvider`; marketing pages are excluded from the middleware matcher; the root 404 is static; `/api/search` reads only cached catalogue loaders; `GET /api/consent` replaces adding `consent` to the hot `/api/me` payload.
- Rate limits longer than 60 s no longer live on the UNLOGGED table: contact limits count `support_requests` rows; consent and feedback use burst windows.
- Service-worker page cache is per user (`rc-pages:u:<ref>`), with an emergency kill-switch build and a rollback runbook.
- New items: Pricing → Help link (edge E3), `/help#fair-use`, `/licenses` (Stockfish GPL, asset credits), the v3 header on `/p/{u}`, the queue's "Play vs bot offline" row, the P10 Settings rows, Speed Insights at 20 % on Hobby, adaptive Edge Config memo with a read counter.
- Testing follows the testing critique's shared tools: `node:test` everywhere, `WEB/test/api/`, paywall on, leased personas and throwaway users, consent-aware telemetry sink, `sw-on` project, both auth-flag values, state-coverage tags, sign-off record; CI suites run against `next start`, the deployed dev site gets the smoke subset only.

---

## 0. Decisions this plan makes (P11-D*)

| # | Decision | Why / source | Overrides |
|---|---|---|---|
| D1 | **Route groups.** `app/(marketing)/` (landing, pricing, how-we-grade, about, blog, help, contact, legal incl. `/licenses`, press, careers, community, and P10's guest profile `/p/[username]`), `app/(auth)/` (sign-in, sign-up, verify, reset, sso-callback), `app/(system)/` (offline, maintenance, too-many-requests). URLs do not change. | optimization §7.2 OPT-13, client-data-layer §2.1 | — |
| D2 | **`ClerkProvider` and `QueryProvider` leave the root layout together.** Both are mounted by `components/providers/AppProviders.tsx` in the `(app)`, `(auth)`, onboarding, `checkout`, `(admin)`, `dev` and `(marketing)/pricing` layouts. The root keeps only `ThemeProvider`, `ConsentRoot`, the P1 `Toaster` and `SpeedInsights`. Signed-out marketing pages load no clerk-js (≈ 90 KB) and no TanStack Query (≈ 16 kB). A day-1 spike proves soft navigation across the boundary; if it fails, both providers stay at the root and the marketing budget is re-measured (R1). | optimization §7.2; audit-client #15; api-perf AP-48 | SPEC D1 tree (root `ClerkProvider`) |
| D3 | **Signed-in hint on static pages without a request.** `lib/auth/auth-hint.ts` reads Clerk's non-HttpOnly `__client_uat` cookie (`> 0` = signed in; the suffixed `__client_uat_<suffix>` form is matched too, verified in the WP0 spike) and decodes (does not verify) the `__session` JWT payload for the new `ini`/`usn` claims. Islands use it through `useAuthHint()`; pages that draw two different chromes (the root 404) also get a 300-byte pre-paint inline script that sets `html[data-rc-auth="in"]`, so CSS shows the right chrome with no flash. The landing keeps its designed `signed_in` state; `/` is **not** redirected to `/home`. | `V3Landing` has a `signed_in` state; optimization §7.2 | client-data-layer §2.5 ("signed-in visitors on `/` → `/home`") |
| D4 | **Auth = Clerk custom flows** behind one wrapper `lib/auth/clerk-flows.ts`. The prebuilt `<SignIn>`/`<SignUp>` survive only as the catch-all fallback for steps we do not design (second factor) and as the kill-switch target. | pub §1.4 | — |
| D5 | **Static by default.** Auth pages are dynamic server shells (they read `redirect_url` and resolve the destination board through P8's tagged loaders: no DB on a cache hit). Every other public page, **including the root 404**, is static or ISR, and the static marketing paths are **outside the middleware matcher** (no edge run, no Clerk handshake redirect on a stale token). | client-data-layer §2.2; api-perf AP-33 | — |
| D6 | **Consent defaults to deny, worldwide.** PostHog is **not loaded at all** before analytics consent (dynamic import, not just opt-out). Google Analytics is deleted. Vercel Web Analytics is dropped; Speed Insights (cookieless) stays. Sentry error capture without PII and without Replay is treated as essential; Replay is lazy-loaded only after "Error replay" consent. | sys §3.9, architecture §3.3.3, optimization §7.2 | inv-pub §1.11 "init PostHog opted-out" |
| D7 | **Consent storage.** The `rc_consent` cookie is the client's source of truth. `PUT /api/consent` writes the proof row (`consent_records`) and, for signed-in users, `user_settings.consent` (the column P9 created, R-02). Anonymous **rejections are not stored** (nothing to prove); anonymous opt-ins are stored with an `anonId`. A signed-in user on a new device gets the stored choice from `GET /api/consent`, called only when the cookie is missing, so the hot `GET /api/me` payload does not grow. | data-model §5.10 (ConsentRecord), GDPR proof of consent | sys §3.9 ("anonymous calls only logged as aggregate"); draft "Viewer.consent" |
| D8 | **Consent endpoint path is `PUT /api/consent`** (api-design ME-5), not `/api/me/consent` (allocation text, data-model §9), because anonymous callers are allowed. | api-design §4.2, alias table | allocation P11 server list |
| D9 | **Contact messages are durable.** `POST /api/contact` writes a `support_requests` row, then sends through Resend in `after()`; the daily cron retries failed sends. This table is **an addition to data-model.md** (consistency R-02 lists it). | V3Contact "nothing was lost", "Reference #RC-20418" | data-model (no table) |
| D10 | **Maintenance** is driven by Edge Config store `replay-ops`, key `notice`, read through `getOps()` with an **adaptive memo** (300 s while there is no notice, 120 s while one is `scheduled`, 60 s while `active`), env fallback `MAINTENANCE_MODE`. Middleware rewrites `(app)`, onboarding and checkout **documents** to `/maintenance`; the P1 route wrapper answers `503 maintenance` for affected APIs; the socket refuses new pairings during an `online` window. Open tabs learn of a notice through `system:notice` (P2's `/internal/broadcast` gains a `notice` type). The in-game restart chip and the deploy pre-announce are P2's and need no P11 work. | sys §3.5, architecture §3.5.1; feasibility F-VER-6 (100k reads a month on Hobby) | draft (fixed 60 s memo, new broadcast endpoint, deploy hook) |
| D11 | **Service worker:** keep `@ducanh2912/next-pwa` 10.2.9 with `customWorkerSrc: "worker"` (the entry P10 created). Precache ≤ 600 KB (shell, `/offline`, `/maintenance`, fonts, pieces, SVG move icons). `NetworkOnly` for `/api/**`, RSC requests and `(app)` documents outside the offline allow-list; the allow-list is cached **per user** in `rc-pages:u:<ref>` and bypassed when the SW knows no current user; `StaleWhileRevalidate` for public marketing and catalogue documents (max 30 entries); `CacheFirst` for hashed engine files. An emergency `SW_KILL_SWITCH=1` build unregisters the worker and clears every cache. Serwist is the fallback if the plugin blocks a rule (≈ 1 d, R7). | client-data-layer §7.1, optimization §4.8; api-perf AP-34; feasibility §9 | client-data-layer §7.1 (one `rc-pages` cache) |
| D12 | **Offline data** lives only in IndexedDB `rc-offline` under `u:<userRef>:*`; the offline page hides rows whose data is missing. A "Download lesson" control is **out of scope** (no board shows it; sys Q4). | sys §3.4, client-data-layer §7.5 | — |
| D13 | **Update prompt:** detected from the waiting SW, a `buildId` poll on `/api/health` compared with the bundle's `NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA` (P1's build id), a socket `upgrade_required` or a `ChunkLoadError`. Deferred while a game is live (`useActivity().liveGameRef`); "Later" applies on the next hard navigation, never mid-game. | sys §3.11, client-data-layer §7.6 | — |
| D14 | **Install prompt** shows only inside the `(app)` shell (members). Persistent entry points: the account menu ("Install App") and Settings › Notifications (the P10 row, lit by P11). Marketing pages show none. | `V3PwaInstall` is drawn over `V3Home`/`V3PlayHub` | old Navbar install button |
| D15 | **Flags.** `auth-v3` is an **Edge Config kill switch** (`replay-ops.flags.auth_custom_flows`), read by the already-dynamic auth pages through `getOps()`. `consent` is a **deploy-scoped** switch (`NEXT_PUBLIC_CONSENT_BAR`), because reading Edge Config in the root layout would make every static page dynamic; it fails closed (no bar → nobody consents → no analytics). `public-v3` is **deploy-scoped**: static pages cannot be evaluated per visitor before consent, so parity is checked against the live old site on `main` and the legacy marketing pages are deleted in this phase. | allocation §1.6, architecture §3.5.1, consistency R-14 | allocation (PostHog flags) |
| D16 | **Search** has two paths (api-perf AP-03): `GET /api/search` is public, cookie-free, outside the middleware matcher and CDN-cached 300 s; it filters the **cached** P8 catalogue loaders in memory (0 DB statements on a data-cache hit) plus a static page and help index. `GET /api/me/search` is `auth: "user"`, `no-store`, and adds the member's own games. No trigram indexes (data-model §8). | data-model §8, api-design SYS-3, P8 §9.3 | sys §3.1 (pg_trgm) |
| D17 | **Event names** `system:notice` (P11, `CT/socket/system.ts`) and `server:restarting` (P2, payload `{ restartAt, resumes: true }`, `CT/socket/game.ts`), both in P2's registry `CT/socket/registry.ts` (B20 `domain:event`; consistency R-07). | allocation B20 | allocation §5.2 (`notice`) |
| D18 | **402 mapping** uses the P1 code list (`CT/http/codes.ts`, consistency R-06): `subscription_required` with `reason: trial_available` → `/pricing?reason=required`; `reason: trial_used`, `expired` or `paused` → the in-place `RenewSheet` (P7) on `(app)` pages, `/pricing?reason=ended` elsewhere; **`402 payment_update_required`** or `reason: payment_failed` → the sheet with the payment row first, which links to the portal. If P7's `RenewSheet` is missing when WP-A starts, the `trial_used`/`expired` branch goes to `/pricing?reason=ended` everywhere. | allocation F2, B26; consistency 11.1, 11.4 | api-design `membership_ended` code |
| D19 | **Internal auth** for the socket hop is P2's helper (`CT/internal/auth.ts`): `x-internal-token`, timing-safe against `INTERNAL_API_SECRET` (consistency R-08). If the plan set later adopts HMAC (api-perf AP-44, feasibility SEC-4), the helper changes for every hop at once and P11 code does not change. | consistency R-08 | draft (`RC_INTERNAL_KEYS` HMAC) |
| D20 | **Rate-limit windows longer than 60 s are durable.** The UNLOGGED `rate_limit_buckets` table empties whenever Neon scales to zero, so P11 uses it only for windows ≤ 60 s. Contact's hourly limits are counted from `support_requests` rows (one indexed statement); consent and feedback use burst windows of 60 s; public search and return-target rely on the Vercel Firewall and the CDN. | api-perf AP-11 | api-design §2.10 hourly buckets |
| D21 | **Field performance comes from Speed Insights at `sampleRate={0.2}` on Hobby** (10,000 events per 30 days, team-wide) plus Lighthouse CI in the lab. PostHog is consent-gated and is used for funnels, never for SLOs. | feasibility F-VER-5; api-perf AP-15 | optimization §9.3 (`sampleRate={1}`) |
| D22 | **Coach fair-use numbers have one source**, `CT/limits.ts` (feasibility F-LLM-3): members 30 a day and 150 a month; trial 10 a day and 40 over the trial. The pricing row reads "About any move, fair use applies" and links to `/help#fair-use`, whose answer renders the numbers from that file. | feasibility F-LLM-3, architecture X11; coverage C-19 | `V3Pricing` "Unlimited questions"; P7 D6 (300 a month) |
| D23 | **Return targets never describe private resources** (api-perf AP-29): `kind` is `legend_position`, `legend`, `opening`, `challenge` (P9's public preview) or `page`; `/game/<ref>`, `/review/<ref>` and tournaments map to fixed `page` labels with no lookup and no FEN; the cache key is the normalised path without a query string. | api-perf AP-29 | api-design SYS-4 (`game`, `tournament` kinds) |
| D24 | **Third-party licences page** `/licenses` uses the legal template: Stockfish (GPL-3.0, source tag link and written offer), the NNUE net, CC0 data credits (Lichess puzzles, games, `chess-openings`), fonts, sounds and piece art from `WEB/THIRD_PARTY.md`. | feasibility LIC-2, LIC-5 | — |
| D25 | **Tests run where they cost nothing.** The 40-project device × zoom suite, the `sw-on` project and Lighthouse CI run in CI against `next build && next start` (Docker Postgres, socket from source); the deployed dev URL gets only the `@smoke` subset nightly and after each dev deploy. A Hobby overage pauses the feature for up to 30 days, so test traffic stops at 60 % of any quota. | feasibility F-VER-2, F-VER-3; testing X2, X16 | draft (device suite against dev) |

---

## 1. Goal and user-visible outcome

**Goal.** Every logged-out page and every Clerk auth flow is rebuilt to the v3 boards, and every system screen exists: 404, 500, global error, offline, maintenance, cookie consent, PWA install and PWA update. Analytics and session replay only run after consent. The marketing site is static, small and fast.

**What a visitor sees at the end.**

- A coaching-first marketing site (landing, pricing with the 7-day trial, about, blog, help with search, a working contact form, legal pages) in one consistent v3 look on every device, fitting one viewport where the boards do.
- Branded sign-in, sign-up, email verification and password reset with inline errors in our copy, a 6-box code input, a rate-limit countdown and "you'll come back to Kasparov vs Topalov" return banners.
- Errors that explain themselves: a searchable 404 (signed out, signed in, missing game), a 500 with Try again, an Event ID and a Report form, and a global error page that works even when CSS fails.
- An installable app that opens offline to a page listing what still works (Mistake Bank, bot games, last review), a maintenance page and an in-game restart chip, a cookie bar that declines by default, and an update prompt that waits for the game to end.

**Owner test on the dev site** (`https://replay-chess-dev-replaychess007-1069.vercel.app`, ego-browser, then a real iPhone and a real Android phone):

1. **Signed out:** `/` (scroll through hero, How it works, coach card, price cards, footer). `/pricing`: toggle Monthly/Yearly (price, note and trial line change; URL gets `?plan=`); open `/pricing?reason=required&redirect_url=/play/legend/kasparov-topalov-1999` (info banner names "Play · Kasparov vs Topalov"); open `/pricing?checkout=failed` (error banner, Try Again); under the FAQ, "Help Center" opens `/help#billing`. `/about`, `/blog` (switch to Endgames → "No posts in Endgames yet."), a blog post (TOC highlights while scrolling, rail CTA), `/help` (search "refund to paypal" → no results; `/` focuses search; Esc clears; `/help#fair-use` shows 30 a day / 150 a month), `/contact` (send → "Sent … Reference #RC-2xxxx"; turn DevTools offline and send → error banner, text kept), `/terms`, `/privacy`, `/cookies`, `/licenses` (the switcher entries are links; Licences names Stockfish with its source link), `/@<member>` signed out (v3 header).
2. **Pricing signed in:** as user R (never trialled) → "Start 7-day free trial" opens Dodo test checkout; as user Q (trial used) → "Start Coaching" + "Your free trial has been used. Billing starts today."; as member A → "Your membership · Manage Billing"; as the `legacy` persona → "$8 / month · Original plan"; as the `pastdue` persona → payment banner with the portal link.
3. **Auth:** sign in with a wrong password ("That password isn't right…"), with an unknown email ("No account uses this email. Sign up instead?"), with Google; trigger the rate limit (6 bad passwords) → countdown banner, controls disabled. Sign up with a new `+clerk_test` address → verify: wrong code, then wait for "Resend in 0:59" cooldown, then the right code (`424242`) → onboarding. Reset the password (code + new password) → "You're all set" → Continue lands signed in. Start from `/play/legend/kasparov-topalov-1999` signed out → sign-in shows the Kasparov–Topalov board and the return banner → after sign-in the page opens.
4. **Errors:** `/nope` signed out (marketing header, search "pricing" finds Pricing) and signed in (the shell frame, no flash of the marketing header); `/game/doesnotexist` → "Game Not Found" in the shell; `/wp-login.php` → a bare 404. `/dev/throw?where=page` → 500 with Event ID → Copy → Report → "Report sent with event …"; Try again twice → "Still not working…". `/dev/throw?where=layout` → global error (light and dark OS theme), Reload.
5. **Offline:** as a member visit `/train/bank` and `/review/<ref>`, then DevTools → Offline → open `/games` → the offline page lists Mistake Bank (6 due · saved this morning), Play vs bot, Last review; "Find an opponent" is disabled; wait 15 s (auto check) → go online → "Back online" + "Reload this page". The shell chip reads "Offline · cached pages still work".
6. **Maintenance:** run `pnpm --filter web notice:set --mode active --minutes 30 --affects all` (dev Edge Config, then `ops-broadcast.yml`): `/home` shows the maintenance page with the countdown (within the 60–300 s memo); `/` and `/pricing` still work; the Dodo test webhook still lands. With `--affects online`, "Find an opponent" shows the maintenance toast while a running friend game continues. In a live bot or friend game run `notice:restart --in 120` → P2's chip "Server restarting in 2:00 · Games in progress will resume. Keep playing." while the board stays playable. `notice:clear` restores everything.
7. **Consent:** in a fresh profile the bar shows; DevTools Network shows **no** `/ingest` (PostHog), no GA and no Sentry replay requests. Reject non-essential → toast "Only essential cookies · change it in Cookie settings" → still no PostHog. Footer "Cookie settings" → Preferences → switch Analytics on → Save choices → PostHog `/ingest/e` events start. Reload: the choice persists. Sign in on a second browser: no bar (the stored choice is fetched once).
8. **PWA:** Chrome desktop second session as a member on `/home` → popover "Install ReplayChess" anchored to the sidebar; Not now → "We'll ask again in 14 days". Android Chrome → bottom card → Install → system dialog → "ReplayChess is installed…". iPhone Safari → "Add ReplayChess to Your Home Screen" sheet with 3 steps; iPad portrait → popover pointing at Share. Deploy a new build to dev while a game is running → chip "Update ready · installs after this game"; after game over the card "A new version is ready" appears; Refresh reloads.

---

## 2. Scope

### 2.1 In scope

| Area | Items |
|---|---|
| Marketing | Landing (D, iPhone, iPad), Pricing (D, iPhone, iPad) incl. `required`, `checkout_failed`, `trial_used`, `member`, `legacy` and the payment-issue and `reason=ended` banners, Membership required (`V3PaywallHard` = pricing `?reason=required`), Membership ended (`V3PaywallSoft`: the RenewSheet wiring and, if B26 read-only is approved, the ended Play-hub row), About, Blog index and post, Help center with search (incl. the `fair-use` answer), Contact with a working form, Legal template (Terms, Privacy, Cookies, Licences), restyle of `/press`, `/careers`, `/community` with the marketing template, removal of `/docs/api` |
| Marketing chrome | `MarketingTopNav`, `MarketingFooter` (5-column and compact), `AuthHint` island; replaces the legacy `Navbar`/`Footer` on every public page, including P8's catalogue pages in their signed-out chrome, P9's shared pages and P10's guest profile `/p/{u}` |
| SEO | Root metadata and JSON-LD rewritten for coaching, pricing JSON-LD names fixed, `public/llms.txt` rewritten, robots disallow for auth/system routes (and for everything on non-production builds), noindex where listed, category pages for the blog |
| Auth | Clerk custom flows: `/sign-in`, `/sign-up`, `/sign-up/verify`, `/reset-password`, `/sso-callback`, prebuilt fallback catch-alls, `lib/auth/clerk-errors.ts`, the hardening of P4's `safeReturnPath`/`resolveReturnTarget` + `GET /api/return-target`, middleware rules for signed-in visitors on auth pages, Clerk dashboard configuration (dev instance), Google sign-in; Apple behind a flag |
| Errors | static `app/not-found.tsx` (signed out / signed in through the cookie hint), `app/(app)/not-found.tsx`, entity 404s (`missing_game`), `app/(app)/error.tsx`, `app/(marketing)/error.tsx`, `app/(auth)/error.tsx`, `app/error.tsx`, `app/global-error.tsx`, `GET /api/search` + `GET /api/me/search`, `POST /api/feedback`, scanner early-return, chunk-error recovery |
| Offline and SW | SW rewrite (precache budget, runtime rules, per-user page cache, emergency kill-switch build), `/offline` (D, iPhone, iPad P), `useOnline()` with a health probe, `OnlineChip` "Back online", IndexedDB snapshots and their writers, offline bot-game sync (outbox kind `botGames`), the queue's offline "Play vs bot offline" row |
| Maintenance | `/maintenance` page, middleware gate, API gate in the route wrapper, `GET /api/system/notice`, the `notice` type on P2's `POST /internal/broadcast` and `system:notice`, the socket's refusal of new pairings during an `online` window, scheduled-maintenance info banner in the shell banner slot, ops CLI + `ops-broadcast.yml` (P2 already ships the in-game restart chip) |
| Consent | Bar and preferences (D, iPhone, iPad P), `PUT`/`GET /api/consent`, `ConsentRecord` + `user_settings.consent` (column from P9), PostHog/Sentry Replay gating, GA removal, Sentry PII off, Cookie settings entry in both footers and the P10 Settings › Privacy row, the consent-aware telemetry fixture |
| PWA | Manifest rewrite, icons and screenshots, install prompt (desktop popover, Android card, iOS sheet, iPad P popover), update prompt (card, phone card, in-game chip), account-menu "Install App" item, the P10 Settings › Notifications "Install app" row and "Show me how" |
| Schema | Migration **M11**: `consent_records`, `support_requests` (+ 2 enums, 2 indexes) |
| Quality | Device × zoom specs for every P11 screen, Lighthouse CI on marketing and auth routes, bundle and precache budgets, axe checks, dev demo routes `/dev/ui/p11/*` for every board state, the `sw-on` and `auth-prebuilt` Playwright projects, the sign-off record |

### 2.2 Explicitly out of scope

- Onboarding screens, `/checkout/activating`, `POST /api/checkout`, `GET /api/billing/activation` (P4). P11 only links into them.
- Legend positions catalogue/detail, legends, openings, learn guides (P8), How we grade content (P3). P11 only swaps their marketing chrome and moves `/how-we-grade` into `(marketing)`.
- Rate-limited (`V3RateLimited`), session-expired (`V3SessionExpired`), payment-failed banner (`V3PaymentFailed`), toasts, palette, shortcuts, skeletons, empty states (P1). P11 reuses them.
- Notification permission prompt (`V3NotifPrompt`), Settings sections, push (P10). P11 lights up two of their rows (§2.4).
- The in-game restart chip, `server:restarting`, the drain and the deploy-time restart notice (P2). P11 verifies the chip against `V3Maintenance` `in_game`.
- A "Download lesson" control, a notification inbox, an in-app status page, a Lichess/Chess.com marketing integration, the landing autoplay demo video (pub Q3), A/B tests.
- Production deploy, prod Clerk instance, Resend domain verification on the production zone, DNS (P13). P11 works on dev only.

### 2.3 Dependencies on earlier phases

| Phase | What P11 needs from it | If missing |
|---|---|---|
| P1 | UI kit (`components/ui/*`: Button, IconButton, Spinner, Banner, Tag, Field/Input/Textarea/Select, Switch, Checkbox, Segmented, Tabs, Dialog, Sheet/ResponsiveDialog, Popover, Skeleton, ProgressBar, EmptyState, Toast `notify`); shell (`components/shell/*`, `AppShellView`, `OnlineChip`, `ShellBanners`, `AccountMenu`, `InGameStatusChip`); `ViewportStage` lock mode (`data-rc-lock`); `lib/api/{route,client,errors,schema}.ts` (`devSchema`), `lib/api/keys`; `QueryProvider`; the fixed-window limiter; `lib/flags.ts`; `lib/env.ts` (`isNonProd()`, `devRoutesEnabled()`); middleware claims gating; `GET /api/health` (`HealthData`); `/too-many-requests`; `SessionExpiredModal`; `lib/overlays/store.ts`; `signOutEverywhere()`; `playwright.devices.config.ts` (40 projects); the shared test tools of testing §4 (user registry and leases, telemetry sink, console guard, state coverage, visual tooling, test-hook registry, `ci.yml`/`nightly.yml`) | P11 cannot start |
| P2 | `components/board/MiniBoard.tsx` (static SVG board), the game client store and `features/game/screen/InGameChips.tsx`, `server:restarting {restartAt, resumes}` and its chip, `POST /internal/broadcast` (`WS/src/http/broadcast.ts`, `x-internal-token`, Caddy-blocked), the deploy-time restart notice in `deploy-oci.yml`, the client-run bot runner, `EngineProvider` with hashed WASM, `idempotency_keys`, `CT/socket/registry.ts`, the drift gate `scripts/db/check-drift.ts` | offline bot play and the in-game update chip are blocked |
| P3 | `/how-we-grade` page + constants; the review page (writer of `review:last`) | 404 "pick up" card hides the review |
| P4 | `POST /api/checkout {plan, returnPath, source}`, `/checkout/activating`, onboarding resolver, `GET /api/me` with `accounts`/`import`, Clerk webhook copying `unsafeMetadata.signupSource` → `User.signupSource`, `TrialLedger`, `lib/navigation/return-to.ts` (`safeReturnPath`, `resolveReturnTarget`; P9's dependency table says P4 creates it, P4's checkout-activation screen assumes P1), `components/billing/{PlanToggle,PlanCta,TrialTermsLine}` (if built for the onboarding plan step), `lib/email/send.ts` if Resend was chosen for trial reminders | WP-C creates `return-to.ts` and `GET /api/return-target` with the exports P4/P9 expect (R15); WP-A creates the billing components; WP-B creates `lib/email/send.ts` |
| P5 | `/home`, Train hub, Mistake Bank session payload, outbox `rc-outbox` (`lib/offline/outbox.ts`, consistency R-16), `/train/session/[ref]/summary` | offline page shows no bank row |
| P7 | `components/billing/RenewSheet.tsx`; `CT/limits.ts` (coach caps) | D18 fallback: `trial_used`/`expired` go to `/pricing?reason=ended`; WP0 creates `CT/limits.ts` |
| P8 | catalogue pages and `lib/data/catalog.ts` tagged loaders (`getLegendCards`, `getLegendDetail`, `listPracticePositions`, `getPosition`, `searchOpenings`, `getOpeningDetail`; tags per P8 §8.10), slugs | return-target falls back to `kind: "page"` labels; search shows only pages and help |
| P9 | Play hub (`V3PaywallSoft` `limit_reached` row lives there if B26 read-only is approved), the queue's `offline` state (`V3Queue`), `/join/[code]` and `/s/[code]` with their `resolveReturnTarget` entries, `UserSettings` with `consent Json?` (consistency R-02), `WEB/THIRD_PARTY.md` | entity 404 for challenges is skipped; queue CTA row skipped |
| P10 (**before P11**, R-19) | `worker/index.ts` + `worker/push.ts` (custom SW entry), `features/account/AccountSection.tsx` (Privacy), `features/notifications/*` (incl. `V3NotifPrompt` "Show me how", today on `IOSInstallModal`), `app/(public)/p/[username]` guest profile, edits to `AccountMenu.tsx` and the Clerk webhook, the account-deletion transaction | if P10 runs in parallel instead: §13.3 fallback split |

### 2.4 Lights up (P11 turns on slots that earlier phases left unrendered)

| Slot | Owner phase | What P11 does |
|---|---|---|
| `OnlineChip` "Back online" state, captive-portal detection | P1 | `useOnline()` with `/api/health` probe feeds the chip and TanStack `onlineManager` |
| V3TryCatalogue `offline` state ("Positions you've opened before still work") | P8 | SW runtime-caches visited public catalogue documents (`rc-public`) |
| In-game restart chip (`V3Maintenance` `in_game`) and "Back online · game resumed" toast | P2 (built) | nothing to build; the maintenance spec checks the copy |
| Update chip in game (`V3PwaUpdate` `in_game`) | P2 | `UpdateChip` mounted in P2's `InGameChips.tsx` |
| "Cookie settings" row in Settings › Account › Privacy (coverage C-13) | P10 | exports `openCookieSettings()`; P10's row is lit; if P10 did not add it, WP-G adds it to `AccountSection.tsx` |
| "Install app" row in Settings › Notifications; `V3NotifPrompt` `ios_install_first` → "Show me how" (C-13) | P10 | exports `openInstallPrompt({ source })` and the iOS steps sheet; WP-H re-points P10's "Show me how" from `IOSInstallModal` and adds the row if absent |
| RenewSheet on any 402 (`trial_used`/`expired`/`paused`) | P7 (coach only) | global wiring in `reactToApiError` |
| `V3Queue` `offline` "Play vs bot offline" (C-10) | P9 | link to `/play?tab=bot` (the cached Play document, `ignoreSearch`), shown only when `engine:ready` and Q15 = yes |
| v3 marketing header on the guest profile `/p/{u}` (C-22) | P10 | page moves into `(marketing)`; `MarketingTopNav` + full footer replace the legacy `Navbar` |
| Edge E2 How we grade → Pricing (C-18) | P3 | `/how-we-grade` gets the top-nav Pricing link and the footer's Product › Pricing |
| Edge E3 Pricing → Help (C-20) | — | "More questions? Help Center" under the pricing FAQ → `/help#billing` |
| `/help#fair-use` anchor used by the coach (C-19) | P7 | the `fair-use` Q&A in `content/help.ts` (D22) |
| Account menu "Install App" item | P1 | added when `canInstall` |

---

## 3. Current code touched

| File (dev@0848b76) | Today | P11 fate |
|---|---|---|
| `app/layout.tsx:16-31` | `next/font/local` WOFF Geist (never applied, audit-quality PERF-01) + Instrument Serif | **Rework** (if P1 has not): P1 D8 moved Geist to `next/font/google`; P11 sets `preload:false` on Geist Mono and Instrument Serif except in `(marketing)` |
| `app/layout.tsx:33-37` | `themeColor: "#171717"` | **Rework**: `[{media:"(prefers-color-scheme: light)",color:"#FAF9F6"},{media:"(prefers-color-scheme: dark)",color:"#000000"}]` |
| `app/layout.tsx:39-96` | metadata "Master Chess Through Legendary Games" | **Replace** with `lib/seo/site-metadata.ts` (coaching positioning, pub §1.10) |
| `app/layout.tsx:107-108` | `dns-prefetch img.clerk.com`, `preconnect googletagmanager` | **Remove** both (GA deleted; Clerk images only in `(app)`) |
| `app/layout.tsx:128-149` | dev-only third-party scripts (react-scan, react-grab, pingchat) | **Keep** dev-only; add `process.env.NEXT_PUBLIC_APP_ENV !== "production"` guard and exclude from CSP prod |
| `app/layout.tsx:154-163` | `ThemeProvider > ThemeAwareClerkProvider > GoogleAnalytics, Analytics, SpeedInsights, UserSync, PostHogIdentify, Toaster` | **Rework**: root = `ThemeProvider > ConsentRoot, Toaster, SpeedInsights sampleRate={0.2}`; `ClerkProvider`, `QueryProvider` and `OverlayHost` move to `AppProviders` in the group layouts, and `InstallPromptRoot`, `UpdatePromptRoot`, `SystemNoticeRoot` to the `(app)` layout (D2, AP-48); GA and `<Analytics/>` removed; `PostHogIdentify` replaced by `lib/analytics/identify.ts` |
| `app/components/ThemeAwareClerkProvider.tsx:1-19` | client wrapper so appearance follows theme | **Keep** as `components/auth/ClerkScope.tsx` (used by every group layout that needs Clerk); appearance only matters for the prebuilt fallback |
| `app/components/GoogleAnalytics.tsx:1-26` | GA tag, unconditional | **Remove** (D6); remove `NEXT_PUBLIC_GA_MEASUREMENT_ID` from Vercel and `turbo.json` |
| `app/components/PostHogIdentify.tsx:14-21` | identifies by Clerk id, before consent | **Replace** with `lib/analytics/identify.ts`: `identify(referenceId)` only after opt-in (architecture X14) |
| `instrumentation-client.ts:8-32` | Sentry with `replayIntegration()` at init, `tracesSampleRate: 1`, `replaysSessionSampleRate: 0.1`, `sendDefaultPii: true` | **Rework** (WP-G): no Replay at init, `tracesSampler`, `sendDefaultPii:false`, `beforeSend` scrubber, lazy Replay after consent |
| `instrumentation-client.ts:36-48` | `posthog.init` unconditional | **Replace** with `lib/analytics/posthog-client.ts` (dynamic import after consent + `requestIdleCallback`) |
| `sentry.server.config.ts:13,20`, `sentry.edge.config.ts:14,21` | `tracesSampleRate: 1`, `sendDefaultPii: true` | **Rework**: sampler (§10.2), `sendDefaultPii:false` (architecture §3.3.2) |
| `middleware.ts:1-48` (P1 rewrites it) | Clerk, protects play routes only | **Extend** (WP0 wiring): scanner early-return, auth-page rules, maintenance gate, matcher exclusions for `monitoring`, `ingest`, `og`, `workers`, `sw.js`, `swe-worker-*`, `workbox-*`, `manifest.json`, `robots.txt`, `sitemap*`, the public cookie-free APIs and the static marketing documents (§7.4) |
| `app/page.tsx:1-55` | `Hero`, `HowToPlay`, `AgadmatorFeature`, `PricingSection`, `Footer`; `WebApplication` JSON-LD `:20-34` | **Replace** by `app/(marketing)/page.tsx` + `app/(marketing)/_landing/*`; `SoftwareApplication` JSON-LD |
| `app/components/{Hero,HowToPlay,AgadmatorFeature,PricingSection,Testimonials}.tsx` (198/142/231/218/177 lines) | old landing sections (`Hero` is `"use client"` + `motion`) | **Remove** after `grep` shows no importers |
| `app/pricing/page.tsx:19-30` | dynamic: reads `searchParams` server-side | **Replace**: `force-static` page + `PricingStateIsland` (`useSearchParams` in `<Suspense>`) |
| `app/pricing/PricingContent.tsx` (716 lines; default yearly `:93-95`, forced refresh `:130-149`, payment-issue banner `:536-565`) | client page | **Remove** after parity; keep the payment-issue copy and the "force a fresh `me` before trusting entitled on `reason=required`" rule in `lib/billing/pricing-state.ts` |
| `app/pricing/layout.tsx:37,46` | JSON-LD offers "Player Monthly/Yearly" | **Rework**: names from `PLAN_NAME` + interval ("Coaching Monthly", "Coaching Yearly"); adds `AppProviders` (D2) |
| `lib/billing/copy.ts:44,52-79` | `MONEY_BACK_COPY`, `SALES_FAQS` (6 Q&As, 30-day guarantee) | **Rework**: `SALES_FAQS` becomes the 4 design questions + the refund answer decided by the owner (Q6); `PLAN_FEATURES` aligned with the design's 7 rows |
| `lib/billing/return-url.ts:10-25,50-57` | allowlist prefixes + `isAllowedReturnPath` | **Refactor** (if P4 has not): delegates to `lib/navigation/return-to.ts` `safeReturnPath()`; prefix list gains `/home`, `/train`, `/review`, `/games`, `/learn`, `/checkout`, `/settings`, `/t`, `/s` |
| `lib/billing/client.ts:120-133` (`isSubscriptionRequiredResponse`) | 402 check | **Keep** (P1 adapter); P11 adds `reason` routing in `reactToApiError` (D18) |
| `app/sign-in/[[...sign-in]]/page.tsx:1-80`, `layout.tsx:1-13` | prebuilt `<SignIn>` in a decorative shell | **Replace**: `app/(auth)/sign-in/page.tsx` (custom flow) + `app/(auth)/sign-in/[...rest]/page.tsx` (prebuilt fallback for `factor-one`/`factor-two`/SSO steps) |
| `lib/clerk-theme.ts` | appearance objects for prebuilt components | **Keep** only `getClerkAppearance()` for the fallback; delete `getClerkSignInAppearance` |
| `app/not-found.tsx:1-97` | "Off the Board", links Home/Play, no search | **Replace** with a static page (§4 S16, AP-33) |
| `app/error.tsx:1-149` | "Position Lost", `motion`, digest only | **Replace** by `app/(app)/error.tsx`, `app/(marketing)/error.tsx`, `app/error.tsx` (§4 S17) |
| `app/global-error.tsx:1-370` (`next/font` `:4-24`, `var(--cb-*)` `:44`) | depends on fonts and tokens that may have failed | **Replace**: inline styles, system fonts, `prefers-color-scheme` (§4 S18) |
| `next.config.js:13-35` | PWA: `cacheOnFrontEndNav`, `aggressiveFrontEndNavCaching`, `reloadOnOnline: true`, default runtime caching (P1 H8 patches `/api/*`) | **Rewrite** (WP-E, §7.6) |
| `next.config.js:88-91` | `/try/*` → `/pricing` 301 | **Keep** P8's retarget (`/legends/positions`) |
| `next.config.js:158-167` | `/workers/*` `max-age=0` | **Rework**: hashed `stockfish-<sha8>.*` → `public, max-age=31536000, immutable`; unhashed loader keeps `max-age=0` |
| `next.config.js:72-79` | `remotePatterns: hostname "**"` (open proxy, SEC-14) | **Keep P1's fix** (allowlist); P11 adds nothing |
| `public/manifest.json:2-10` | old name, `start_url "/"`, `#171717`, `portrait-primary` | **Rewrite** (§4 S22) |
| `lib/hooks/usePWAInstall.ts:50-59` | iOS detection misses iPadOS (Macintosh UA) | **Replace** by `lib/pwa/usePwaInstall.ts` + `lib/pwa/install-eligibility.ts` |
| `lib/hooks/usePWAUpdate.ts:49-76` | applies the update immediately | **Replace** by `lib/pwa/useUpdate.ts` (deferral, poll, chunk error) |
| `app/components/PWAUpdateBanner.tsx` (0 importers) | unmounted banner | **Remove** |
| `app/components/InstallAppPopover.tsx`, `IOSInstallModal.tsx` (no `role="dialog"`, A-03) | navbar install button | **Remove** (D14) |
| `app/components/Navbar.tsx` (278 lines, install button `:10-18,93`), `app/components/Footer.tsx` (256 lines, `/docs/api` link `:27`), `app/components/DirectoryBadges.tsx` (526 lines) | legacy marketing chrome | **Replace** by `components/marketing/{TopNav,Footer}.tsx`; badges move to `/press` (lazy images); delete Navbar/Footer when no importer remains |
| `app/components/LegalPageLayout.tsx` (186 lines) | legal shell | **Replace** by `components/marketing/LegalLayout.tsx` |
| `app/about/page.tsx:1` (423 lines, `"use client"`, `motion`) | client page | **Rewrite** as a server page (`V3About`) |
| `app/help/page.tsx` (139 lines, FAQ JSON-LD `:48-62`) | server page, Navbar/Footer | **Rewrite** (`V3Help`), FAQ data in `content/help.ts` |
| `app/contact/page.tsx:42,71` | `mailto:` only | **Rewrite** (`V3Contact`) + `POST /api/contact` |
| `app/{terms,privacy,cookies}/page.tsx:1` (`"use client"`) | client pages | **Rewrite** as server pages with `content/legal/*.ts` |
| `app/blog/page.tsx:15-40` (`?tag=`), `lib/blog-types.ts:1-22` (4 categories), `app/blog/[slug]/page.tsx:28` (`generateStaticParams`), `app/blog/_components/*` | blog | **Restyle**; categories relabelled (keep slugs), `endgames` added; `CategoryNav` becomes links; `InteractiveAnalysisBoard` (942 lines, Stockfish) loads only when a post opts in, via `next/dynamic` on visibility |
| `app/press`, `app/careers`, `app/community` | legacy pages | **Restyle** with the About template |
| `app/docs/api/page.tsx` | page for a non-existent public API | **Remove**; `/docs/api` → `/help` through `config/redirects/p11.mjs` (307 on dev, 308 on production, feasibility §9) |
| `app/robots.ts:12-23` | disallow list | **Extend** (through `lib/seo/robots-rules/p11.ts`): `/sign-in`, `/sign-up`, `/reset-password`, `/sso-callback`, `/offline`, `/maintenance`, `/too-many-requests`, `/dev/`; everything disallowed when `APP_ENV !== "production"` |
| `app/sitemap.ts:11-39` | static URLs | **Keep**; add `/how-we-grade` if P3 has not; remove `/docs/api`, `/learn/*` only if P8 moved them |
| `public/llms.txt` | "replay iconic positions" | **Rewrite** for coaching; `/api/healthcheck` line (`:50`) → `/api/health` |
| `app/api/healthcheck/route.ts` (P1 alias) | plain `ok` | **Remove** (P1 marks it "delete in P11") once the uptime monitor uses `/api/health` |
| `app/og/route.tsx` (151 lines) | title/subtitle/type params | **Keep** (P8 adds `type=position&fen`); P11 uses it for blog posts |
| `e2e/specs/pricing.spec.ts:9` (yearly default), `e2e/specs/paid-only.spec.ts:8,48` | Phase 0 specs | **Rewrite** for the v3 pages (§12) |
| `WS/index.ts:37,42,367-376` → P2's `WS/src/http/broadcast.ts` | P2 ships `/internal/broadcast {type:"restart"}` | **Extend**: the `notice` type, `currentNotice`, boot restore, `maintenanceGuard()` on new pairings (§7.5) |
| `REPO/.github/workflows/deploy-oci.yml:97-115` | P2 adds the drain and the restart pre-announce | **No change** (P11 adds its own `ops-broadcast.yml`) |
| P10 `app/(public)/p/[username]/page.tsx`, `features/notifications/*`, `features/account/AccountSection.tsx`, `worker/index.ts` | legacy `Navbar` on the guest profile; "Show me how" opens `IOSInstallModal`; no Cookie settings / Install app rows (coverage C-13) | **Edit** (WP-B, WP-H, WP-G, WP-E): v3 chrome, `openInstallPrompt`, the two rows if absent, the P11 SW modules |

---
## 4. Screens

**Conventions for this section.**

- Devices: **D** desktop 1440×900 (also checked at 1280×800), **IL** iPad landscape 1194×834, **IP** iPad portrait 834×1194 (v3pub boards are 820×1180), **P** iPhone 393×852 (v3pub boards are 390×844), **A** Android 412×915. v3pub has no IL or A boards: IL uses the D layout (wider than the 1100 px breakpoint), A uses the P layout plus `padding-bottom: max(16px, env(safe-area-inset-bottom))` for the 48 dp system bar (pub §3). v3sys has no IL board: IL uses the rail shell (sys §2.1).
- **Scroll mode** (DS README "Layout: one viewport"; SPEC D15): **lock** = the root is `height:100dvh; overflow:hidden` (`data-rc-lock` on the stage), only named panels scroll; **flow** = the document scrolls (marketing pages and blog articles may scroll). The device × zoom suite asserts `document.scrollingElement.scrollHeight <= innerHeight` on every lock screen and "no horizontal scroll" on every flow screen (§12.3).
- Height breakpoints used by these boards: `max-height:760px` (pricing: hide `.tall`, h1 2.5rem, table rows 34 px), `max-height:700px` (hide `.tall` secondary lines), `max-height:640px` (top nav 48 px, logo 28 px; pricing rows 30 px; v3sys `.h1d` 2.75rem and `.s5-short` hidden; sidebar subs and search hidden), `max-height:620px` (auth inputs and buttons 40 px with `tap-target`, maintenance chips). Width breakpoint 1100 px (nav padding 20 px; sidebar → 64 px rail; blog TOC hidden). 150 % zoom on 1440×900 = 960×600 CSS px, so all height rules apply at once (pub §1.13).
- Components come from the P1 UI kit (`components/ui/*`), the P1 shell (`components/shell/*`) and the new P11 modules named in §13. Every container/presentational pair is split as `XView({ state, … })` (pure, used by the dev demo route `/dev/ui/p11/<screen>?state=`) and `X` (data + effects), so every board state is reachable (allocation §1.1.4).
- Copy rules (SPEC §3.11): Title Case for buttons, nav and tabs; sentence case for descriptions; no "!" (except "You Won!"); no emoji; toasts have no trailing period.

### 4.0 Shared marketing chrome (used by S1–S10, S16 signed-out)

| Piece | Spec |
|---|---|
| `MarketingTopNav` (`components/marketing/TopNav.tsx`, server + `AuthHint` client island) | Boards: every v3pub desktop board (`.tn`). 64 px high (48 px at `max-height:640px`), padding 0 32 px (0 20 px at ≤ 1100 px), `border-bottom: 1px solid rgba(0,0,0,0.08)`, `background: rgba(250,249,246,0.85)` + backdrop blur (`cb-backdrop`). Left: logo 36 px (28 px short) + serif wordmark → `/`. `nav aria-label="Main"`: Coaching → `/#how`, Learn → `/legends`, Blog → `/blog`, Pricing → `/pricing`; `aria-current="page"` underline on the current one. Right, signed out: "Sign In" (secondary) → `/sign-in`, "Start Free Trial" (primary) → `/sign-up?source=nav`. Right, signed in (`AuthHint` reads `__client_uat`): "Play" → `/play` + avatar initials (from the `ini` session claim) → `/profile`, `aria-label="Your profile, <username>"`. Both variants reserve the same box width (no CLS). **P/A**: logo + "Sign In" text button on `/`; sub-pages use a back-arrow title bar ("Pricing") with `aria-label="Back"` → `history.back()` or `/`. **IP**: logo, "How It Works", "Pricing", "Sign In". |
| `MarketingFooter` (`components/marketing/Footer.tsx`, server) | Full variant (scrolling pages): 5 columns: brand ("ReplayChess · Chess coaching built from your own games."), **Product** (How It Works `/#how`, Pricing, How We Grade `/how-we-grade`), **Learn** (Blog, Chess Legends `/legends`, Help Center), **Company** (About, Contact), **Legal** (Terms, Privacy, Cookies, Licences `/licenses`), bottom row "♟ ReplayChess · [COMPANY NAME] · [YEAR]" (placeholder, Q5) + **Cookie settings** text button (`openCookieSettings()`, D6). Compact variant (one-viewport pages: About, Help, Contact, Legal, signed-out 404): one line "♟ ReplayChess · About · Help · Contact · Terms · Privacy · Cookie settings". `/press`, `/careers`, `/community` and the directory badges move to a "More" line in the full footer only. |
| `StaticBoard` (`components/board/StaticBoard.tsx`, server; wraps P2 `MiniBoard`) | Props `fen`, `orientation`, `variant`: `"live"` (neutral grey), `"article"` (#e9e2d4/#8f7865) or `"thumb"` (56 px article), `marks?: {last?: [from,to]; arrows?: {from,to,color}[]}`, `badge?: {square, kind}` (owner icons `public/board_icons/svg/*.svg`, B8), `label` → `role="img"` + `aria-label`. SVG, sized by its container (`width:100%; aspect-ratio:1`), no chess.js (a 40-line FEN placement parser), no JS on the client. |
| `AuthHint` (`components/marketing/AuthHint.tsx`, client; logic in `lib/auth/auth-hint.ts`) | `useAuthHint()` = `useSyncExternalStore` over `document.cookie`: `__client_uat` (or `__client_uat_<suffix>`) > 0 → signed in. Decodes the `__session` payload (base64url, no verification) for `ini` and `usn` claims. Server snapshot = signed out. Never fetches. Pages with two chromes (the root 404) also inline `AUTH_HINT_SCRIPT` in `<head>` (≈ 300 B, runs before paint) to set `html[data-rc-auth="in"]`; CSS hides the wrong chrome, so there is no flash. Used on every static marketing page, P8's signed-out catalogue chrome and the guest profile `/p/{u}`. |

### S1 · Landing `/`

- **Boards:** D `DR/V3Landing.dc.html` (states `default`, `loading`, `signed_in`); P `DR/V3iPhoneLanding.dc.html` (single state); IP `DR/V3iPadLanding.dc.html` (single state).
- **Route:** `app/(marketing)/page.tsx`, `export const dynamic = "force-static"`. JSON-LD `SoftwareApplication` (`applicationCategory: "EducationalApplication"`, two `Offer`s "Coaching Monthly" $4.99 and "Coaching Yearly" $50, trial mentioned in `description`) + the root `Organization`.
- **Layout per device** (flow mode):
  - **D/IL:** `.page{min-height:100dvh; flex column}`. Hero `height: clamp(540px, calc(100dvh - 64px), 836px)` (480 px min and `- 48px` at `max-height:640px`), grid `minmax(0,1fr) auto`, gap 56 px, max-width 1280 px. Hero board `.hboard{width:max(300px, min(calc(100dvh - 250px), 44vw, 600px))}` (`max(280px, min(calc(100dvh - 170px), …))` at short heights), so the whole hero board is on screen at every zoom (subtracting `var(--consent-h, 0px)` while the cookie bar is shown, §S21). Then `#how` (4 steps), "Learn from your mistakes" coach card, `#pricing` (2 price cards), full footer.
  - **P/A:** one screen (`.frame` 54 px top / 34 px bottom safe areas): logo + Sign In; h1 "Stop Repeating The Same Mistakes"; lead "Your Chess.com games, analysed. Your recurring mistakes, turned into daily puzzles."; board full width `min(100vw - 32px, 100dvh - 380px)`; caption "What did you miss on move 19? · YOUR GAME · WHITE TO MOVE"; primary "Start 7-day free trial"; trial terms line; "See Pricing". Below the fold (scroll): the 4 steps and the full footer.
  - **IP:** header (How It Works, Pricing, Sign In); single-column hero; board; caption card "Your game · move 19 · What did you miss here? Black's bishop on f5 has no defender. The coach asks before it explains, then saves the mistake as a puzzle." + trial line; the 4 steps in a 2×2 grid; footer.
- **States and transitions:**
  - `default` (signed out): hero CTAs "Start 7-day free trial" → `/sign-up?source=landing_hero` and "See Pricing" → `/pricing`; mono line "7 days free · then $4.99/month · cancel any time"; price-card CTAs → `/sign-up?plan=monthly|yearly&source=landing_price_<plan>`.
  - `signed_in` (`AuthHint`): header "Play" + avatar; hero CTAs "Today's Training" → `/home` and "Your Patterns" → `/train/weakness` (C8: one weakness route); the price section stays, but each card's CTA becomes "Your Plan · Manage Billing" for members — the landing cannot know entitlement without a request, so for signed-in visitors both price-card CTAs link to `/pricing` (which resolves the state) with the label "See Your Plan". The hero and the boxes keep identical dimensions in both variants.
  - `loading`: only the `<Suspense>` fallback of the hero board (skeleton `.sk`, `role="img" aria-label="Loading a position from your game"`). `StaticBoard` renders on the server, so this state appears only if the board chunk is deferred; it is reachable on `/dev/ui/p11/landing?state=loading`.
- **Content:** hero board FEN `r2r2k1/p1q2pp1/2p2n1p/5b2/8/1PNNP1bP/P1P1B1P1/R2Q1RK1 w - - 1 19`, orientation white, caption "Your game · vs pawnstorm22 · Rapid · Move 19 · White to move" (a curated static example, never a live query: pub §2.1), figcaption "What did you miss here? The coach asks before it explains, then saves it as a puzzle." + "How the Coach Works" → `/how-we-grade`. Coach card: "Moment 1 of 3 · move 19", tag "Verified" (text, not colour only), "Black's bishop on f5 had no defender. 19.Rxf5 wins a piece; you played 19.Qd2. Third loose piece you missed this month.", badge `mistake.svg` + "Mistake · loses about 10 win% points". Prices from `BILLING_PLANS` (`lib/billing/plans.ts:34-57`) and `yearlySavings()` (−16 %, "About $4.17 a month, billed once a year.").
- **Components:** `MarketingTopNav`, `StaticBoard variant="live"`, `Tag`, `Button` (link variant), `TrialTermsLine` (client, renders the date after mount: SSR text "Then $4.99/month. Cancel within 7 days and you won't be charged."; after mount "Cancel before 6 Nov …", `trialChargeDate()` in `lib/billing/copy.ts`), `MarketingFooter`. Corner brackets are decorative `aria-hidden` spans.
- **Interactions:** links only; `#how` and `#pricing` are deep-linkable; `?plan=yearly` on `/` is forwarded to the sign-up links (moves the `UserSync.tsx:42-46` behaviour here). No shortcuts.
- **Empty/loading/error:** none (static). JS disabled → the signed-out page works.
- **Copy notes:** "Ask the coach" is not claimed as unlimited anywhere on the landing (fair-use cap, architecture X11). `[COMPANY NAME] · [YEAR]` waits for Q5.

### S2 · Pricing `/pricing` (and S3 · Membership required = `?reason=required`)

- **Boards:** D `DR/V3Pricing.dc.html` (states `logged_out`, `logged_in`, `required`, `member`, `checkout_failed`, `legacy`, `trial_used`; prop `plan` `monthly|yearly`, default `monthly`); D `DR/V3PaywallHard.dc.html` (same page, default `required`; prop `plan`); P `DR/V3iPhonePricing.dc.html` and IP `DR/V3iPadPricing.dc.html` (states `logged_out`, `logged_in`, `required`, `checkout_failed`, `trial_used`; prop `plan`).
- **Route:** `app/(marketing)/pricing/page.tsx` (`force-static`), `app/(marketing)/pricing/layout.tsx` (JSON-LD `FAQPage` from `SALES_FAQS` + `Product`/`Offer` with fixed names, and `ClerkProvider` per D2). Query params, read only on the client inside `<Suspense>`: `plan=monthly|yearly`, `reason=required|ended`, `redirect_url=<safeReturnPath>`, `checkout=failed` (and legacy `status=failed`), legacy `checkout=success` → `router.replace('/checkout/activating?…')`. Canonical `/pricing` for every variant.
- **Layout per device:**
  - **D/IL** (lock): `.app{height:100dvh; flex column; overflow:hidden}`, `.stage{flex:1 1 auto; min-height:0; justify-content:safe center; overflow-y:auto (fallback only); max-width:1120px; padding:16px 32px}`. Banner row (when present) → h1 + sub → Monthly/Yearly segmented → comparison table (7 rows, `th scope`) with the price column on the right → FAQ (4 `<details>` in 2 columns) → hint line, which ends with "More questions? **Help Center**" → `/help#billing` (flow-map edge E3, coverage C-20; it adds no new element, only a link in the existing hint row). At `max-height:760px` the `.tall` lines hide and rows shrink to 34 px; at `640px` rows 30 px, h1 2rem. The page fits 1440×900 at 80–150 % zoom without scrolling (asserted).
  - **P/A** (flow): back title bar "Pricing"; banner; h1; segmented; plan card (`section aria-label="Coaching plan"`: price, note, 7 short feature rows); "How it works" card (4 steps); hint "Secure checkout by Dodo Payments. Cancel any time; you keep access until the period ends."; sticky bottom bar (`cb-backdrop`, `padding-bottom: max(12px, env(safe-area-inset-bottom))`) "Coaching · $4.99/mo" + CTA + note; `scroll-padding-bottom` equals the bar height so focused elements are never hidden.
  - **IP** (flow): as P plus Sign In in the header, the FAQ section, wider cards.
- **States** (implemented as `{ base, banner }` from `derivePricingState()`, §8.1):
  - `logged_out`: h1 "Coaching built from your own games.", sub "7 days free, then one membership with everything included. Cancel any time.", CTA "Start 7-day free trial" → `/sign-up?plan=<p>&source=pricing&redirect_url=<r>`, note = trial terms line.
  - `logged_in` (signed in, trial eligible, not a member): same copy; CTA → `POST /api/checkout {plan, source:"pricing", returnPath: redirect_url}` (P4) → Dodo; button "Opening secure checkout…" with spinner.
  - `trial_used`: sub "One membership, everything included. Cancel any time.", CTA "Start Coaching", note "Your free trial has been used. Billing starts today."
  - `required` (banner, `role="status"`): "Coaching needs a membership. Start your 7-day free trial and you'll come back to <destination> after." + "Go back" (→ the parent of `redirect_url`, else `history.back()`); P/IP copy "Coaching needs a membership. Start your 7-day free trial to keep going." Destination label from `useReturnTarget(redirect_url)` (§5). Combined with `logged_out`, `logged_in` or `trial_used`.
  - `checkout_failed` (banner, `role="alert"`): "Payment didn't go through. You weren't charged. Try again, or use another card." + "Try Again" (re-runs checkout with the same plan); P/IP "Payment didn't go through. You weren't charged."
  - `member`: h1 "Your membership"; column tag "Your plan", price, "Monthly · renews 12 Nov" (from `me.entitlement.periodEnd`, server-formatted label), "Manage Billing" → `/settings/membership`. Trial members: "Trial · 5 days left", "First charge $4.99 on 6 Nov" (`trialMembershipCopy`, `lib/billing/copy.ts:150-177`).
  - `legacy`: "$8 / month", "Original plan, billed monthly · renews 12 Nov", Manage Billing.
  - Not drawn but required: **payment issue** (`me.entitlement.paymentIssue`): warn banner "The last renewal payment failed. Update your payment method." → `/api/customer-portal` (copy kept from `PricingContent.tsx:536-565`); **ended** (`reason=ended` or `entitlement.state === "lapsed"`): info banner "Your membership ended on 12 Nov. Renew to pick up where you left off." with the `trial_used` CTA ("Start Coaching"; renewal is always at the current price, never $8).
  - Transitions: segmented toggles price, note and terms instantly and writes `?plan=` with `history.replaceState` (no RSC request); CTA → loading → Dodo redirect; checkout `409 already_subscribed` → invalidate `qk.me()` → `member`; `402 payment_update_required` → portal; other errors → inline bad banner with the envelope `message`; `503 not_configured` → "This plan is not available right now."
- **Components:** `MarketingTopNav` (Pricing current), `Banner` (info/bad/warn), `PlanToggle` (`Segmented`, "Monthly / Yearly −16%", `role="group" aria-label="Billing period"`, `aria-pressed`), `FeatureTable` (`<table aria-label="Plan comparison">`), `PlanCta`, `TrialTermsLine`, `FaqList` (native `<details>/<summary>`), `MembershipSummary`, `MobileCtaBar`, price cell `aria-live="polite"`.
- **Feature rows** (design, `V3Pricing` `v.feat`): Chess.com games · Imported and analysed automatically; Coach review · Every game, key moments explained; Mistake Bank · Every mistake saved to replay; Weakness Profile · Your recurring patterns, ranked; Puzzles from your mistakes · A new set every day; Ask the coach · **"Unlimited questions"** on the board, built as "About any move, fair use applies" with "fair use" linking to `/help#fair-use` (D22, Q11); Legend and opening lessons · The full library.
- **FAQ** (design, 4): "Can I cancel any time?", "Is there a free trial?", "Who handles payment?", "Switching monthly ↔ yearly?" — the single source is `SALES_FAQS` (`lib/billing/copy.ts`), also used for the JSON-LD and the Help "Billing" topic; the 30-day guarantee line is removed unless the owner confirms the refund policy (Q6).
- **Interactions:** Tab through the segmented buttons, Enter on the CTA, Enter/Space toggles a FAQ. No single-key shortcuts on marketing pages.
- **Loading:** the CTA area keeps a fixed height while `useMe` resolves (skeleton bar `Skeleton h-11`), so no layout shift. **Error:** if `/api/me` fails, keep the signed-out CTA (never claim "member" on error; client-data-layer §6.2 rule 2).
- **Edge cases:** `redirect_url` failing `safeReturnPath` is ignored and never echoed; signed in but not onboarded → CTA "Start 7-day free trial" → `/onboarding?plan=<p>` (pub Q18); admin or `BILLING_PAYWALL=off` → `member` view with a dev tag; a member arriving from a stale 402 → after a forced `me` refetch, "You're already a member · Continue" → `redirect_url`.

### S4 · Membership ended (`V3PaywallSoft`)

- **Board:** D `DR/V3PaywallSoft.dc.html` (states `under_limit`, `limit_reached`, `sheet_open`; default `limit_reached`). No device boards: the `RenewSheet` is a bottom sheet on P/IP/A (60 % height, drag handle `aria-hidden`, swipe down closes) and a centred dialog over a scrim on D/IL (pub §3).
- **Route:** not a page. Two delivery paths, chosen by **B26** (decided before P3):
  - B26 was due before P3 (coverage C-21); P11 builds whichever path it chose, and if it is still open when WP-A starts the default below ships (Q14).
  - **B26 default (hard redirect):** middleware sends lapsed users to `/pricing?reason=ended` (S2 ended banner). The sheet opens in place on any 402 `subscription_required` with `reason ∈ {trial_used, expired, paused}` (or `402 payment_update_required`) received on an `(app)` page (stale claims for ≤ 60 s, an `ent=false` socket ack, an outbox replay). `limit_reached` and `under_limit` exist only on `/dev/ui/p11/paywall-soft?state=…`.
  - **B26 read-only approved:** lapsed users keep `/home`, `/games`, `/review/[ref]` GET, `/profile`, `/settings`; the P9 Play hub shows the ended membership row (`limit_reached`), and every action opens the sheet.
- **States:**
  - `under_limit` → a normal member Play hub ("Coaching membership · ACTIVE · RENEWS 12 NOV", "Coaching · monthly. Every position is included."). Nothing to build.
  - `limit_reached` (renamed **ended**): membership row "ENDED 12 NOV", "Your free trial has been used. Renew to keep playing.", "Your membership includes $4.99/month" + 4 features, "One plan, everything included. Your games, reviews and Mistake Bank stay saved if your membership ends.", primary "Play · membership ended" (opens the sheet). The three usage pips are **dropped** (Phase 0 deleted the daily meter).
  - `sheet_open`: dialog (`aria-modal`, `aria-labelledby` = the h2) "Membership ended · 12 Nov", h2 "Renew to keep training.", close X, "Your free trial has been used. Your games, reviews and Mistake Bank are saved; renew and the coach picks up where you left off.", primary "Renew · $4.99 / month" (last interval; yearly: "Renew · $50 / year") + "Or $50 a year. Cancel any time.", option rows "Look back at past reviews · Saved · Reviews from before 12 Nov stay readable." → `/games` (rendered only when B26 read-only is approved), "Update payment method · If your card expired, fix it here." → `/api/customer-portal` (listed **first** when `paymentIssue` caused the end), "Not now".
- **Components:** P7 `RenewSheet` (`ResponsiveDialog` from the kit), `PlanCta source="renew"` (no trial), `Tag`.
- **Interactions:** Esc, scrim click and "Not now" close and return focus to the trigger; Enter on Renew; focus trap.
- **Data:** `me.entitlement.{state, membershipEndedAt, planKey, interval, paymentIssue, trial.eligible}`. Renew → `POST /api/checkout {plan, source:"renew", returnPath: current path}`; `402 payment_update_required` → portal. If P7 has not shipped `RenewSheet`, every branch above goes to `/pricing?reason=ended` (D18).
- **Copy notes:** legacy $8 members who lapse can only return at the current price; the sheet never shows $8.

### S5 · About `/about`

- **Board:** D `DR/V3About.dc.html` (no state enum).
- **Route:** `app/(marketing)/about/page.tsx`, server component, `force-static` (drops `"use client"` and `motion`, `app/about/page.tsx:1`). JSON-LD `AboutPage` + `Organization` + founder `Person` (Rohit Pandit, reused from `app/layout.tsx:119-123`).
- **Layout:** **D/IL** lock: `.app{height:100dvh; overflow:hidden}`, `.stage` grid `minmax(0,1.1fr) minmax(0,1fr)`, gap 56 px, centred; left: eyebrow "About ReplayChess", h1 "Your own games are the best teacher. We help you learn from them.", paragraph, `[FOUNDING STORY]` (owner, Q5), CTAs "How Coaching Works" → `/#how`, "Contact Us" → `/contact`; right: "What we believe" 4 cards (The board is sacred; One decision per screen; Explain, don't flatter; Verified, then spoken), team row `[TEAM MEMBER NAME][Role]` + "Press & partnerships" → `/contact?topic=other`; compact footer. `max-height:700px` hides `.tall` and shrinks card padding to 12 px. **P/IP/A** flow: one column.
- **States:** none. **Interactions:** links only.
- **Copy notes:** the "The board is sacred … both clocks fit on one screen" principle stays true only because of the one-viewport assertions (§12.3).

### S6 · Blog index `/blog` and `/blog/category/[category]`

- **Board:** D `DR/V3BlogIndex.dc.html` (states `default`, `loading`, `empty_category`).
- **Routes:** `app/(marketing)/blog/page.tsx` (SSG) and `app/(marketing)/blog/category/[category]/page.tsx` (SSG, `generateStaticParams` over `BLOG_CATEGORIES`). `?tag=` on the index stays but renders `robots: noindex, follow`.
- **Layout:** flow. h1 "Blog"; `nav aria-label="Category"` rendered as links styled like the segmented control (All, Legends, Openings, Training, Endgames, Product; `aria-current="page"`); featured card (article board + "Featured · Legends · 8 min read" + title + dek + "ReplayChess Editorial · Oct 24"); grid of cards `repeat(3, minmax(0,1fr))` (2 at ≤ 1100 px, 1 on P/A); full footer.
- **Category mapping** (keep URL slugs, relabel, pub Q14): `famous-games-players` → "Legends", `openings` → "Openings", `strategy-improvement` → "Training", `replaychess-news` → "Product", new `endgames` → "Endgames". Edit `lib/blog-types.ts:1-22`.
- **States:** `default`; `loading` = `app/(marketing)/blog/loading.tsx` (6 skeleton cards; only seen on slow client navigations); `empty_category` = a category with 0 posts: h2 "No posts in Endgames yet.", "The first one is in the works. Meanwhile, the Legends posts cover a few famous endgames.", "See All Posts" → `/blog`; the page gets `noindex` (sitemap rule `app/sitemap.ts:50-59` already skips categories with < 2 posts).
- **Data:** `getBlogPosts()`, `getFeaturedBlogPost()` (`lib/blog.ts`); frontmatter gains optional `fen`, `orientation`, `positionSlug` (thumb board falls back to `image`).
- **Components:** `BlogCard` (reworked `app/blog/_components/BlogCard.tsx`), `StaticBoard variant="article"`, `MarketingFooter`.

### S7 · Blog post `/blog/[slug]`

- **Board:** D `DR/V3BlogPost.dc.html` (no states).
- **Route:** `app/(marketing)/blog/[slug]/page.tsx` (SSG, exists `:28`). JSON-LD `BlogPosting` (exists) + `BreadcrumbList`; OG image `/og?type=post&title=…&fen=…`.
- **Layout:** flow. Three columns at D: left `nav aria-label="On this page"` TOC (scrollspy, `aria-current="true"` on the active heading), article (breadcrumb "Blog / Legends", h1, byline avatar "RE" + "ReplayChess Editorial · Oct 24 · 8 min read", body with `StaticBoard variant="article"` diagrams + captions, h2 sections with ids), right rail "Train this idea · Members play this position against the engine, then the coach compares their moves with Kasparov's." + CTA, "Related" links; full footer. At ≤ 1100 px: one column, max-width 760 px, TOC hidden.
- **Rail CTA** (`RailCta`, client): signed out → "Start 7-day free trial" → `/pricing?source=blog:<slug>` (the board's target); signed in (`AuthHint`) and the post has `positionSlug` → "Play This Position" → `/play/legend/<slug>` (middleware gates non-members); `positionSlug` missing or unfeatured → trial CTA.
- **Interactive boards:** `InteractiveAnalysisBoard` (942 lines, Stockfish) only when the post opts in (`<AnalysisBoard>` MDX component), loaded with `next/dynamic` + `IntersectionObserver`; never on posts that do not use it.
- **Unknown slug:** `notFound()` → S16 signed-out variant.

### S8 · Help center `/help`

- **Board:** D `DR/V3Help.dc.html` (states `default`, `no_results`).
- **Route:** `app/(marketing)/help/page.tsx` (`force-static`), `FAQPage` JSON-LD from `content/help.ts`; deep links `/help#billing` (topic) and `/help#a-<answer-id>` (opens that `<details>`).
- **Layout:** **D/IL** lock: `.stage` grid `260px minmax(0,1fr)`, rows `auto minmax(0,460px) auto`, centred. Left column: search field (`type=search`, label "Search help", placeholder "Search, e.g. “import games”") and the topic list (`role="group" aria-label="Topics"`, 5 buttons with name, description, count; `aria-pressed`). Right: answers panel (`section aria-label="Answers"`, scrolls inside its 460 px row), then "Still stuck? We answer within one working day." + "Contact Support", then "Popular articles" (3 cards). `max-height:700px` hides `.tall`. **P/IP/A** flow: search, topics as a horizontal chip row, answers, popular, contact.
- **Content** (`content/help.ts`, typed `{ id, topic, q, a, links? }`): the 30 Q&As from the board plus one, `fair-use`, under Coach & review: "Is there a limit on questions to the coach?" → "Ask about any move. To keep the coach fast for everyone there is a fair-use limit: {member.perDay} questions a day and {member.perMonth} a month; during the free trial, {trial.perDay} a day and {trial.perTrial} in total." (values from `CT/limits.ts`, D22, coverage C-19). Topic counts: Getting started (6), Training (6), Coach & review (7), Billing (6), Account (6); topic descriptions "Linking Chess.com, importing, pricing", "Puzzles, patterns, time controls", "Verified lines, grades, Mistake Bank", "Prices, cancelling, payments", "Password, email, connected accounts". **Copy fixes against decisions:** "How do I reset my password?" → "…we'll email you a 6-digit code" (the flow is a code, S14); "How long does importing take?" → "Importing starts when your trial begins and runs in the background…" (pub Q13); "What happens if I disconnect?" keeps the P2 rule (30 s) only if P2 shipped it; "Can I ask the coach about a move?" keeps "A short fair-use pause applies…"; "What happens to my data if I cancel?" follows B26.
- **States:** `default` (topic answers); `no_results`: h2 "No answers for “{q}”.", "Try fewer words, or ask us directly." + "Contact Support" → `/contact?topic=other`.
- **Interactions:** `/` focuses search (fine pointer, outside inputs; SPEC D20); Esc clears; typing filters across all topics (normalised substring, tokens AND-ed, debounce 120 ms); a topic button clears the query; result count announced in an `aria-live="polite"` region.
- **Popular articles:** "How We Grade Moves" → `/how-we-grade`; "What’s Included" → `/pricing`; "Link Chess.com" → `/settings/connected` when signed in (`AuthHint`), `/help#getting-started` otherwise.

### S9 · Contact `/contact`

- **Board:** D `DR/V3Contact.dc.html` (states `default`, `sending`, `sent`, `error`).
- **Route:** `app/(marketing)/contact/page.tsx` (`force-static`) + client `ContactForm`; query `?topic=billing|importing|coach|bug|other&ref=<sub_… or checkout ref>` (from `/checkout/activating` stalled "Get Support").
- **Layout:** **D/IL** lock: `.stage` grid `minmax(0,1fr) minmax(0,520px)`, gap 64 px. Left: h1 "Contact", "Questions about your games, billing or the coach. We reply within one working day.", details list (Email `[support@ADDRESS]` → `hello@playchess.tech` until Q5; Billing "Invoices and cards are in Manage billing" → `/settings/membership`; Answers → Help center). Right: form card "Send a message". `max-height:700px`: `.tall` hidden, textarea `min-height:84px`. Compact footer. **P/IP/A** flow, form below the details.
- **Form:** Name (`autocomplete="name"`, 1–120), Email (`type=email`, `autocomplete="email"`), Topic `Select` (Billing and membership, Importing games, The coach, A bug, Something else), Message `Textarea` (10–5,000 chars), hidden honeypot `website` (off-screen, `tabIndex=-1`, `autocomplete="off"`, `aria-hidden`), "Send Message". Inline field errors (`aria-invalid`, `aria-describedby` → `.ferr`): "Enter your name.", "Enter a valid email address.", "Write at least 10 characters." Prefill when signed in: none from the server (static page); the user types. Draft saved to `sessionStorage['rc.draft.contact']` on every change.
- **States:** `default`; `sending` ("Sending…", inputs disabled); `sent` (`role="status"`, focus to its h2): tag "Sent", h2 "Thanks. We'll reply to <email>.", "Usually within one working day. Reference #RC-20418." + "Send Another" (clears the draft); `error` (`role="alert"`): "Your message didn't send. Check your connection and try again; nothing was lost." (values kept). 429: "You've sent a few messages already. We'll get back to you; if it's urgent email hello@playchess.tech."
- **Interactions:** Enter in a single-line field submits; Cmd/Ctrl+Enter in the textarea submits.

### S10 · Legal `/terms`, `/privacy`, `/cookies`

- **Board:** D `DR/V3Legal.dc.html` (no state enum; `doc` terms|privacy|cookies).
- **Routes:** `app/(marketing)/{terms,privacy,cookies,licenses}/page.tsx`, server, `force-static`, content in `content/legal/{terms,privacy,cookies,licenses}.ts` (typed sections `{ id, title, body: Block[] }`). `/licenses` is the fourth document (D24, Q22), same template.
- **Layout:** **D/IL** lock: document switcher as `nav aria-label="Legal documents"` with four links (Terms, Privacy, Cookies, Licences) and `aria-current="page"` (the board's `role="tablist"` is wrong for links, pub §2.28); `.stage` grid `240px minmax(0,720px)`: left "Contents" TOC (Terms 8 sections: Who we are, Your account, Memberships and billing, Acceptable use, Content and games, Ending the agreement, Liability, Contact; Privacy 7: What we collect, Linked chess accounts, How we use it, Processors, Your rights, Retention, Contact; Cookies 5: What cookies are, Cookies we use, Analytics, Your choices, Contact); right: the article panel scrolls inside itself (`ScrollRegion`), h1, "LAST UPDATED [DATE] · EFFECTIVE [DATE]", numbered h2 sections with ids. **P/IP/A** flow, TOC as a collapsible `<details>`.
- **Content requirements** (counsel finalises, Q5): Privacy lists the processors (architecture §3.3.1): Vercel, Neon, Oracle Cloud, Cloudflare (DNS, R2, Email Routing), Clerk, Dodo Payments (merchant of record), Anthropic, PostHog, Sentry, Resend, Google (OAuth), plus Chess.com and Lichess as sources; linked-account data and the encrypted Lichess token; retention (§11); the trial ledger hashes; consent records. Terms: trial terms (card required, charge on day 8, one trial per person), refunds (Q6), coach fair use. Cookies: the table generated from `lib/consent/cookie-inventory.ts` (Clerk `__session`/`__client_uat`/`__clerk_db_jwt` essential; `rc_consent` essential; `rc_act`, `rc_lichess_pkce` essential; `rc_theme` preference; PostHog `ph_*` analytics; Sentry Replay none-cookie, consent; `rc_ft` first-touch, analytics) and a "Cookie settings" button.
- **Licences content** (`content/legal/licenses.ts`, generated from `WEB/THIRD_PARTY.md`): Chess engine (Stockfish 18, GPL-3.0: the upstream tag URL, the NNUE net hash, links to `COPYING` and `SOURCE.txt` next to the engine files (P2), and a written offer to provide the source); Open data (Lichess puzzles, games and evaluations, `chess-openings`: CC0, credited); Software (licences of the packages shipped to the browser, from `license-checker`); Fonts (Geist and Instrument Serif, OFL); Sounds and pieces (source and licence per file; any file without one is listed and must be replaced before P13, feasibility LIC-5); Contact.
- **Copy notes:** `e2e/specs/paid-only.spec.ts:48` is updated with the new processor list.

### S11 · Sign in `/sign-in`

- **Boards:** D `DR/V3SignIn.dc.html`, P `DR/V3iPhoneSignIn.dc.html`, IP `DR/V3iPadSignIn.dc.html` (states `default`, `loading`, `wrong_password`, `unknown_email`, `rate_limited`, `oauth_loading`; boolean prop `returnNote`).
- **Route:** `app/(auth)/sign-in/page.tsx` (dynamic server shell: reads `redirect_url`, resolves the destination with `resolveReturnTarget()`), `app/(auth)/sign-in/[...rest]/page.tsx` (prebuilt `<SignIn routing="path" path="/sign-in">` for `factor-one`, `factor-two`, `sso-callback` sub-steps), `metadata.robots: noindex`; the `X-Robots-Tag: noindex` header comes from `next.config.js` `headers()` (§7.4 step 8), because a page cannot set response headers.
- **Layout:**
  - **D/IL** (lock): `.split{height:100dvh; grid minmax(0,5fr) minmax(0,6fr); overflow:hidden}`. Left `.brand` aside (`#f5f3f0`, right hairline, padding 28 px 40 px; 24 px 28 px at ≤ 1100 px; 16 px 28 px at `max-height:620px`): logo; board `.bb{aspect-ratio:1; width:max(220px, min(calc(45.4545vw - 96px), calc(100dvh - 260px)))}` (`… - 200px` at `max-height:700px`); caption "You'll return to · Kasparov vs Topalov · Wijk aan Zee 1999 · White to move after 23…Qd6" (the destination when one resolves; otherwise the default Kasparov–Topalov board with caption "Kasparov vs Topalov · Wijk aan Zee 1999"). Right `.formcol` (centred `safe center`, `overflow-y:auto` fallback, `justify-content:flex-start` at 620 px): form ≤ 400 px.
  - **P/A:** frame with logo + close X (→ `redirect_url` parent or `/`), form only, no board.
  - **IP:** logo + close; destination board + caption on top ("Wijk aan Zee · 1999 · Kasparov vs Topalov · White to move after 23…Qd6."), form below.
- **Form:** h1 "Sign In"; "Welcome back. Your games and Mistake Bank are where you left them."; return banner (`role="note"`, only when a target resolves and not rate-limited): "Sign in to play **Kasparov vs Topalov**. You'll come back to it after."; rate-limit banner slot; OAuth buttons (Google; Apple only when `NEXT_PUBLIC_AUTH_APPLE=on`, Q4); divider "or"; Email (`autocomplete="email"`); Password (`autocomplete="current-password"`, show/hide `IconButton` with `aria-pressed` and label "Show password"/"Hide password"); "Forgot password?" → `/reset-password?email=<typed>&redirect_url=`; primary "Continue"; "No account? Start a free trial" → `/sign-up?redirect_url=…`; footer hint "Sign-in secured by Clerk"; `<div id="clerk-captcha"/>` slot (bot protection may challenge sign-in too). **"Keep me signed in" is omitted** (Clerk has no per-sign-in session length; Q8 default).
- **States and transitions:**
  - `default` → submit (client validation: both fields present) → `loading` (inputs disabled, "Signing in…" + spinner) → `signIn.create({ identifier, password })`:
    - `complete` → `setActive({ session })` → `router.replace(safeReturnPath(redirect_url) ?? "/home")` (middleware then sends a non-onboarded user to onboarding, a non-member to pricing).
    - `needs_second_factor` → `/sign-in/factor-two?redirect_url=` (prebuilt).
    - error `form_password_incorrect` → `wrong_password` (password `aria-invalid`, "That password isn't right. Try again or reset it.").
    - error `form_identifier_not_found` → `unknown_email` (email error "No account uses this email. Sign up instead?" with the email kept in the link).
    - error `too_many_requests` (HTTP 429) or `user_locked` → `rate_limited`: warn banner `role="alert"` "Too many attempts. Try again in 0:30, or reset your password." (seconds from `Retry-After` or `meta.lockout_expires_in_seconds`, default 30; mm:ss in an `aria-live="off"` span), every control disabled except "Forgot password?", return banner hidden; countdown 0 → `default`.
    - `strategy_for_user_invalid` → password error "This account uses Google. Continue with Google." (the Google button gets focus).
  - Google click → `oauth_loading` (Google button spinner, others disabled) → `signIn.authenticateWithRedirect({ strategy: "oauth_google", redirectUrl: "/sso-callback", redirectUrlComplete: target })` (full-page redirect).
  - `?oauth=cancelled` → neutral banner "Google sign-in was cancelled."
  - Clerk JS unreachable for 8 s (ad blocker on the Clerk FAPI host) → bad banner "Couldn't reach the sign-in service. Check your connection or ad blocker and try again." + Retry.
- **Components:** `AuthShell`, `AuthAside` (`StaticBoard variant="live"`), `OAuthButtons`, `Field`/`Input`, `PasswordField`, `Banner`, `Button`, `RetryCountdown` (P1).
- **Interactions:** Enter submits; password managers and passkey autofill work because inputs are real `<input>`s with `name`/`autocomplete`.

### S12 · Sign up `/sign-up`

- **Boards:** D `DR/V3SignUp.dc.html`, P `DR/V3iPhoneSignUp.dc.html`, IP `DR/V3iPadSignUp.dc.html` (states `default`, `loading`, `email_taken`, `weak_password`, `empty_fields`; the logic also has `oauth_loading`).
- **Route:** `app/(auth)/sign-up/page.tsx` (dynamic shell), `app/(auth)/sign-up/[...rest]/page.tsx` (prebuilt fallback), query `plan`, `source`, `redirect_url`, `email`.
- **Layout:** as S11. D aside: board + "Chess coaching · Analyse your Chess.com games and fix the mistakes you keep making." + 3 checks (Every Chess.com game analysed; Your recurring mistakes, found and ranked; Daily puzzles built from your mistakes). P: no board; the 3-item checklist sits above the form. IP: board + caption on top.
- **Form:** h1 "Create Your Account"; "7 days free, then $4.99 a month or $50 a year. A card is needed at checkout; one trial per person." (prices from `BILLING_PLANS`); Google (Apple flagged); "or with email"; Email; Password (`autocomplete="new-password"`, hint "8 or more characters." linked by `aria-describedby`); `<div id="clerk-captcha"/>`; "Create Account"; "By continuing you agree to the Terms and Privacy Policy." (links `/terms`, `/privacy`); "Already have an account? Sign in" (keeps `redirect_url`).
- **States:** `default`; `empty_fields` (client, on submit): "Enter your email address." / "Choose a password."; `loading` ("Creating account…"); `email_taken` (`form_identifier_exists`): "An account already uses this email. Sign in instead." (link to `/sign-in?email=`); `weak_password` (`form_password_pwned`, `form_password_length_too_short`, `form_password_validation_failed`, client length < 8): "Use 8 or more characters. Common passwords aren't allowed."; `oauth_loading`.
- **Transitions:** submit → `signUp.create({ emailAddress, password, unsafeMetadata: { signupSource, planIntent, v: 1 } })` → `signUp.prepareEmailAddressVerification({ strategy: "email_code" })` → `router.push('/sign-up/verify?redirect_url=…')`. Google → `signUp.authenticateWithRedirect({ strategy: "oauth_google", redirectUrl: "/sso-callback", redirectUrlComplete: "/onboarding", unsafeMetadata })` (OAuth emails are verified, so Google skips S13, matching the board's link to `V3OnbWelcome`).
- **Attribution:** `signupSource` = `?source` (allowlisted values: `nav`, `landing_hero`, `landing_price_monthly`, `landing_price_yearly`, `pricing`, `position:<slug>`, `challenge`, `blog:<slug>`, `other`), `planIntent` = `?plan`. The P4 Clerk webhook copies `signupSource` into `User.signupSource` (VarChar 200). UTM parameters go to PostHog person properties only after consent (the `rc_ft` first-touch cookie is set only with analytics consent).
- **Validation timing:** on blur and on submit, never on every keystroke.

### S13 · Verify email `/sign-up/verify`

- **Board:** D `DR/V3VerifyEmail.dc.html` (states `default`, `verifying`, `wrong_code`, `expired`, `resend_cooldown`). P/IP reuse the auth shell (no board).
- **Route:** `app/(auth)/sign-up/verify/page.tsx`; requires an in-progress Clerk `signUp` whose `unverifiedFields` include `email_address`, else `router.replace('/sign-up')`.
- **Layout:** as S11; aside as S12.
- **Content:** icon, h1 "Check Your Email", "We sent a 6-digit code to <signUp.emailAddress>. It expires in 10 minutes.", `fieldset` with `legend` "Verification code" and 6 `OtpInput` boxes (`aria-label="Digit n of 6"`, `inputmode="numeric"`, first box `autocomplete="one-time-code"`), "Verify", "Resend code", "Use a different email" → `/sign-up?email=<current>` + `signUp.update({ emailAddress })` on resubmit.
- **States:** `default`; `verifying` (inputs disabled, "Verifying…"); `wrong_code` (`form_code_incorrect`; all boxes `aria-invalid`; alert "That code doesn't match. Check the latest email and try again."); `expired` (`verification_expired`; alert "This code has expired. Send a new one below."; Verify `aria-disabled`); `resend_cooldown` (status "Code sent. Resend in 0:59", 60 s client cooldown, back to `default` at 0). Too many attempts (`verification_failed` or 429) → the S11 rate-limit banner.
- **Transitions:** auto-submit when the 6th digit is typed or a 6-digit string is pasted → `signUp.attemptEmailAddressVerification({ code })` → `complete` → `setActive({ session: createdSessionId })` → `/onboarding?redirect_url=<r>` (P4 resolver keeps it and Done forwards there).
- **Interactions:** typing advances, Backspace on an empty box goes back, ←/→ move between boxes, paste fills all, Enter submits.
- **Edge cases:** opened in another browser (no `signUp` in this client) → "Open the link on the device you signed up on, or sign in." + Sign in link.

### S14 · Reset password `/reset-password`

- **Board:** D `DR/V3ResetPassword.dc.html` (states `default`, `sending`, `unknown_email`, `sent`, `saving`, `done`).
- **Route:** `app/(auth)/reset-password/page.tsx`, query `email`, `redirect_url`. Signed-in visitors see a short panel "You're signed in. Change your password in Settings · Account." (no middleware redirect).
- **Layout:** as S11; aside "Your games are safe" + the Kasparov–Topalov board; back link "Back to sign in".
- **Step 1** (`default`, `sending`, `unknown_email`): h1 "Reset Password", "Enter the email you signed up with. We'll send a code.", Email, "Send Code" / "Sending code…"; unknown → "No account uses this email. Create one?" → `/sign-up?email=`. Call: `signIn.create({ strategy: "reset_password_email_code", identifier })`.
- **Step 2** (`sent`, `saving`; focus moves to the new h1): h1 "Choose a New Password", "Code sent to <email>.", "Code from the email" (single input, `autocomplete="one-time-code"`, `inputmode="numeric"`), New password (hint "8 or more characters."), "Reset Password" / "Saving…", "Didn't get it? Send again" (60 s cooldown). Calls: `signIn.attemptFirstFactor({ strategy: "reset_password_email_code", code, password })`; if the status is `needs_new_password`, `signIn.resetPassword({ password, signOutOfOtherSessions: true })`. Code wrong/expired → inline error on the code field with the S13 copy; weak password → the S12 copy.
- **`done`:** tag "Password changed", h1 "You're all set.", copy changed for truth (Clerk returns an active session, Q8): "You're signed in. Other devices have been signed out." + "Continue" → `setActive` → `redirect_url ?? /home`.
- **Edge cases:** Google-only account (`strategy_for_user_invalid` / `form_identifier_not_found` with an OAuth hint) → "This account signs in with Google. No password to reset." + Google button.

### S15 · SSO callback `/sso-callback` (no board)

- `app/(auth)/sso-callback/page.tsx`: centred spinner "Signing you in…"; calls `clerk.handleRedirectCallback({ signInFallbackRedirectUrl: "/home", signUpFallbackRedirectUrl: "/onboarding", continueSignUpUrl: "/sign-up" })` in a try/catch; on error (user cancelled at Google) → `/sign-in?oauth=cancelled&redirect_url=<r>`.

### S16 · Error 404 (generic and `missing_game`)

- **Boards:** D `DR/V3Error404.dc.html` (states `signed_out`, `signed_in`, `missing_game`); P `DR/V3iPhoneError404.dc.html` (signed in: top bar + tab bar, Home current); IP `DR/V3iPadPError404.dc.html` (signed in, plus "Or pick up where you left off": Last review thumb, Today's legend thumb, Mistake Bank "due today · 4 positions" with 4 thumbs).
- **Routes:**
  - `app/not-found.tsx` (unmatched URLs) is **static** (api-perf AP-33): built once, served from the CDN, no `auth()`. It contains both chromes: the marketing top nav + compact footer, and `StaticShellFrame` (P1 `AppShellView` in its static mode: nav links only, the account button is a plain link to `/profile`, no menu, no Clerk). The pre-paint `AUTH_HINT_SCRIPT` sets `html[data-rc-auth]` to `out`, `in` (signed in, `md.entitled` false) or `member` before first paint; CSS shows the shell frame only for `member`, so a member never sees the marketing header flash. Initials and username fill in from the `ini`/`usn` claims after hydration (the avatar box has a fixed size, no CLS).
  - `app/(app)/not-found.tsx` (`notFound()` from any `(app)` page) renders inside the real shell (dynamic, as the page that called it).
  - Entity files `app/(app)/(immersive)/game/[ref]/not-found.tsx`, `app/(app)/(immersive)/review/[ref]/not-found.tsx`; P9's `app/(shared)/join/[code]/not-found.tsx` is reused.
  - HTTP 404 on all of them, `metadata.robots: noindex`. Scanner probes never reach the page (§7.4 step 2).
- **Layout:** lock in every variant. Signed out: marketing top nav + centred column (`justify-content: safe center`) + compact footer. Signed in: inside the P1 shell (sidebar/rail/tab bar), `main` `overflow-y:auto` + `align-items: safe center`. `max-height:640px`: h1 2.75rem, `.s5-short` lines hidden.
- **States:**
  - `signed_out`: illustration (`role="img" aria-label="Illustration: a king lying on its side on a small chessboard"`; DS pieces from `public/chess-icons`, king rotated −78°), mono `404 · <pathname>` (ellipsis + `title`), h1 "Page Not Found", "The link may be old or mistyped. Search below, or head back to your training.", search "Search ReplayChess" (placeholder "Positions, legends, pages"), list (`role="list"`, `aria-label` "Popular pages" when empty, "Search results" when typing; ≤ 4 rows: 16 px lucide icon + title + secondary), no results "Nothing matches “q”. The help center has guides for every page.", actions "Go home" → `/`, "How coaching works" → `/#how`, "Help center" → `/help`.
  - `signed_in`: the same body inside the shell (the static frame on unmatched URLs, the real shell after `notFound()`); "Go home" → `/home`. Signed-in non-members (`data-rc-auth="in"`) get the marketing chrome with the signed-in `AuthHint` and "Go home" → `/`.
  - `missing_game` (inside the shell, nav current Review): mono `Game · /game/<ref>`, h1 "Game Not Found", "This game doesn’t exist or is no longer available. If a friend sent the link, it may have been cancelled before it started.", "Go to my games" → `/games`, "New game" → `/play`, "Help center". A game that exists but belongs to someone else returns the **same** 404 (no existence leak).
  - IP extra block "Or pick up where you left off" reads **only** client data (`review:last`, `bank:due` IndexedDB snapshots and `qk.train.today` if cached); hidden when empty; never a new fetch.
- **Search data:** empty query → static "Popular pages" (Play, How coaching works, Mistake Bank; signed out: Pricing "One plan, $4.99 a month" replaces Mistake Bank); typing → instant filter of the static page index (Home, Play, How coaching works, Mistake Bank, Legend Lessons, My games, Pricing, Help center, Blog) merged with `GET /api/search` results (legends, positions, openings; in the real shell `GET /api/me/search`, which adds the member's games), debounced 150 ms, `q.length ≥ 2`. The static root 404 creates a tiny `QueryClient`-free fetcher (`lib/search/fetch-search.ts`, `AbortController`, in-memory map of the last 20 queries), because TanStack is not loaded there (D2).
- **Components:** `ErrorLayout` (centred column, `justify-content: safe center`), `StaticShellFrame`, `FallenKing` (DS piece PNGs, `role="img"`), `NotFoundSearch` (`Field` `type=search` + `role="list"` result rows with lucide icons, live region "N results"), `Button` (primary, secondary, text), `StaticBoard variant="thumb"` (IP block), compact `MarketingFooter` (signed out).
- **Interactions:** autofocus the search on fine pointers only; Enter opens the first result; Esc clears; `/` focuses; ⌘K opens the palette inside the real shell and focuses the page search on the static frame.
- **Loading/empty/error:** search results show the static list instantly; server results append without a spinner (`keepPreviousData`); a search error is silent (static results remain).
- **Copy notes:** the board's example path `/legends/kasparov-topalov-1899` is just sample text. "Try a legend position" is not offered (sys Q2).

### S17 · Error 500 (route error)

- **Boards:** D `DR/V3Error500.dc.html`, P `DR/V3iPhoneError500.dc.html`, IP `DR/V3iPadPError500.dc.html` (states `default`, `retrying`, `failed_again`, `report_form`, `reported`; IP adds "Your saved work is safe" with the same three thumbnails as S16).
- **Routes:** `app/(app)/error.tsx` (inside the shell; nav keeps working), `app/(marketing)/error.tsx` and `app/(auth)/error.tsx` (marketing chrome), `app/error.tsx` (errors thrown by a group layout itself; no shell).
- **Layout:** lock; centred column; the same height rules as S16.
- **States:**
  - `default`: illustration "a fallen king", eyebrow "Error on our side", h1 "Something Went Wrong", "This page hit an error. Your games and Mistake Bank are safe. Trying again usually fixes it.", mono "Event ID 7f3c2a91e04b" + "Copy" (label "Copied" for 1.6 s; copies the full 32-hex id), buttons "Try again" (primary), "Go home", "Report" (text).
  - `retrying`: spinner + "Trying again…", `aria-disabled`.
  - `failed_again`: status (ochre `#8a5a12`) "Still not working. We’ve been notified and are looking at it."; Try again stays.
  - `report_form`: textarea "What were you doing? (optional)" (placeholder "I opened my last game review…", ≤ 2,000 chars) + "Send report" + "Cancel" (Esc).
  - `reported`: status "Report sent with event 7f3c2a91e04b. Thank you."; Report hidden.
- **Components:** `ErrorLayout`, `FallenKing`, `EventId` (mono + Copy with `navigator.clipboard.writeText`, fallback select-text, announces "Copied"), `ErrorReport` (`Textarea` with label), `Button`, `role="status"` paragraphs; focus moves to the h1 on mount.
- **Transitions:** mount → `eventId = Sentry.captureException(error, { tags: { boundary } })`; Try again → `sessionStorage['rc.err.retryAt'] = now` → `startTransition(() => { router.refresh(); reset(); })`; if the boundary mounts again within 10 s of a retry → `failed_again`; Report → `report_form` → `Sentry.captureFeedback({ message, associatedEventId })` (tunnel `/monitoring`), fallback `POST /api/feedback` → `reported`.
- **Not a 500:** `ChunkLoadError` (stale chunks after a deploy; Hobby has no skew protection) → one hard navigation to the same URL (`sessionStorage['rc.chunk.<path>']` loop guard), then S23 `ready`. 401/402 from server loaders never reach this boundary (loaders call `redirect()`/`unauthorized()`).

### S18 · Global error (root layout failed)

- **Board:** D `DR/V3ErrorGlobal.dc.html` (states `light`, `dark`, `reloading`).
- **Route:** `app/global-error.tsx`, self-contained `<html lang="en"><body>` with **inline styles only**, system font stack `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif` (no `next/font`, no `var(--cb-*)`, no DS components).
- **Content:** wordmark "ReplayChess" (Georgia 22 px), h1 "ReplayChess Couldn’t Load" (Georgia 44 px / 1.05), "Something failed before the page could start. Reloading usually fixes it. Your games and progress are safe.", "Reload" (`#3d3229` / `#fff`), "Help center" → `/help`, hairline + mono "Event ID 0b91e44d2c7a" (hidden if Sentry failed to load).
- **States:** `light`/`dark` by an inline `<style>@media (prefers-color-scheme: dark){…}</style>` (pure black, white text, focus outline `#fff`); `reloading`: spinner + "Reloading…" then `location.reload()`.
- **Loop guard:** `sessionStorage['rc.ge.count']` > 2 within 60 s → the button becomes "Clear Cached Data and Reload": unregister every SW, `caches.keys()` → delete all, then reload (recovers from a stale SW serving broken chunks). No-JS: a plain `<a href="">Reload</a>`.

### S19 · Offline `/offline` and the offline chip

- **Boards:** D `DR/V3Offline.dc.html`, P `DR/V3iPhoneOffline.dc.html`, IP `DR/V3iPadPOffline.dc.html` (states `offline`, `checking`, `back_online`; IP adds "Saved on this device · ready to review" with 4 bank thumbnails).
- **Route:** `app/(system)/offline/page.tsx`, `force-static`, precached, served by the SW as `fallbacks.document` for any document that is not cached. Rendered inside `StaticShellFrame` (the same static frame as the root 404; `user = offlineUser` read from IndexedDB `current` + `u:<ref>:shell` {initials, username}; generic avatar when missing), so it looks like the app and needs no server data. The page has no TanStack or Clerk provider; the probe is a direct `fetch`.
- **Layout:** lock. D: sidebar + centred column; P: top bar + tab bar (tab bar items navigate; uncached routes come back here); IP: tab bar + the extra thumbnails block.
- **States:**
  - `offline`: chip (`role="status"`) "Offline · cached pages still work" (P/IP "Offline"); h1 "You’re Offline"; "This page isn’t saved on this device. These still work without a connection:"; **Available offline** (`aria-label`): Mistake Bank "6 due · saved this morning" → `/train/bank` (from `bank:due` snapshot: count + `savedAt` relative label), Play vs bot "The engine runs on this device" → `/play?tab=bot` (only when `engine:ready`), Legend Lessons "3 lessons downloaded" → `/legends` (only when `lessons:index` has entries; none in P11, D12), Last review "Two Knights vs tal_fan_77 · Today" → `/review/<ref>` (from `review:last`); **Needs a connection** (`aria-label`): Find an opponent, Challenge a friend, Ask the coach — disabled rows (`aria-disabled`, not links, `aria-describedby` → "Needs a connection"); "Retry" + timer "Retrying on its own in 0:15" (`role="timer"`, `aria-live="off"`).
  - `checking`: "Checking…" button spinner, timer text "Checking the connection" (≈ 1.4 s); failure → `offline` and the 15 s timer restarts.
  - `back_online`: chip "Back online" (good), button "Reload this page", timer "Connection restored". Reached when an `online` event is followed by a successful `/api/health` probe.
- **Components:** `StaticShellFrame` (P1 `AppShellView`, `user` from the IndexedDB snapshot), `OnlineChip` (P1, upgraded), `ListRow` links, `DisabledRow` ("Needs a connection"), `Button` with spinner, `role="timer"` text, `StaticBoard variant="thumb"` (IP bank thumbnails from `bank:due` FENs).
- **Interactions:** Retry (Enter/Space); rows are links into cached routes; disabled rows are not focusable as links but expose the reason through `aria-describedby`.
- **App-wide while offline** (`useOnline()`): the shell chip shows; network-only entry points (Find opponent, Challenge, Ask coach, Import, Sync) render disabled with the tooltip "Needs a connection"; TanStack queries pause (`onlineManager`), mutations queue (outbox) or are disabled. Back online: flush outboxes, `queryClient.resumePausedMutations()`, refetch active stale queries; **no hard reload** (`reloadOnOnline:false`).
- **Copy notes:** rows with missing data are hidden, never shown empty.

### S20 · Maintenance `/maintenance` and the in-game chip

- **Board:** D `DR/V3Maintenance.dc.html` (states `page`, `in_game`). No device boards: below 760 px the page stacks to one column; the chip stays top-right in the phone game header (immersive).
- **Route:** `app/(system)/maintenance/page.tsx` (`force-static`, precached, `robots: noindex`), shown by a middleware **rewrite** (URL unchanged) with `Retry-After`, `Cache-Control: no-store`, `x-rc-maintenance: 1` and status 503 (if Next honours the rewrite status; otherwise 200 + noindex, acceptable because only noindex `(app)` routes are rewritten, R3).
- **Layout (`page`):** lock; header with logo + "Status page" link (`NEXT_PUBLIC_STATUS_URL`; hidden until Q3 is decided); left: chip "Scheduled maintenance", h1 "ReplayChess Is Getting an Upgrade", `notice.message` + "Back around 14:00 UTC (19:30 your time). Nothing you’ve played or saved is affected.", big mono countdown `mm:ss` "until we’re back" (`role="timer"`, `aria-live="off"`, polite announcement every 5 min), progress bar (elapsed / window), CTAs "Play vs Bot Offline" → `/play?tab=bot` (shown only when `engine:ready`), "Status page"; right "Still works on this device": Mistake Bank, Legend Lessons, Play vs bot "Not rated while we’re away" (same IndexedDB rules as S19); footnote "Online play, challenges and the coach come back at 14:00 UTC."
- **Components:** minimal top bar (logo + status link), `Tag` (chip), `Countdown` (`role="timer"`), `ProgressBar`, `ListRow`, `Button`; P2's restart chip (in game, already built); `Banner` info (scheduled).
- **States and transitions:**
  - `page`: countdown from `notice.endsAt` (the notice is fetched once on mount with a direct `fetch`; the static `(system)` page has no TanStack provider); at 0 → poll `GET /api/system/notice` every 15 s while visible (CDN-cached, so ≤ 2 function runs a minute per PoP); `mode === "resolved"` or no notice → "Reload" button (auto-reload only when the tab is hidden). Past `endsAt` while still active → "Taking longer than planned. Check the status page." (never a negative countdown).
  - `in_game`: the live board stays fully usable; chip top-right (`z 20`, `role="status"`, width 360 px, never over the board): "Server restarting in 2:00 · Games in progress will resume. Keep playing." from P2's `server:restarting {restartAt, resumes}`, rendered by P2's `InGameChips.tsx` (no P11 work beyond checking the copy); when the socket drops, P2's "Reconnecting…" chip takes over; on reconnect the board resyncs and the toast "Back online · game resumed" shows.
  - Scheduled (no board; sys Q6, decision Q17): `notice.mode === "scheduled"` within 24 h → info `Banner` in the P1 `ShellBanners` slot on non-immersive routes: "Scheduled maintenance today at 14:00 UTC (19:30 your time). Games in progress will resume." Dismiss per notice id.

### S21 · Cookie consent (bar, preferences, saved)

- **Boards:** D `DR/V3CookieConsent.dc.html` (in-flow bottom bar across the main column, padding 14 px 24 px, white, top border, upward shadow); P `DR/V3iPhoneCookie.dc.html` (floating card left/right 12 px, `bottom: 160px`, over the Play hub, clear of the sticky CTA and the tab bar); IP `DR/V3iPadPCookie.dc.html` (card left/right 24 px, `top: 420px`). States `bar`, `preferences`, `saved`, `gone` on all three.
- **Route:** global overlay from the root layout (`ConsentRoot`, no TanStack, no Clerk; the bar UI is a lazy chunk loaded only when needed), on every route group. Shown when the `rc_consent` cookie is absent or its version ≠ `v1`, and `NEXT_PUBLIC_CONSENT_BAR` is not `off`. When the cookie is missing but `useAuthHint().signedIn`, `ConsentRoot` first calls `GET /api/consent` (once per device); a stored choice is written to the cookie and the bar is skipped, otherwise the bar shows.
- **Placement rules:**
  - `(app)` shell on D/IL: the bar is a row of the `ViewportStage` grid (in flow), so `main` shrinks and the board resizes; never overlaps.
  - Marketing pages on D/IL: `position: fixed; bottom: 0`, and the page container gets `padding-bottom: var(--consent-h)` (ResizeObserver) so nothing is hidden behind it; the landing hero subtracts `var(--consent-h)`.
  - P/A/IP: floating card as drawn; **never** on immersive (board) routes (sys §2.7): deferred to the next non-immersive route.
- **States:**
  - `bar` (`role="region" aria-label="Cookie consent"`, placed first in the DOM after the skip link, not modal): "We use essential cookies to run ReplayChess. Analytics (PostHog) and error replay stay off unless you allow them." (GA removed from the copy, D6) + inline text button "Preferences"; two **equal-weight** primary buttons in a 2-column grid (380 px on D): "Reject non-essential", "Accept all".
  - `preferences` (`Dialog`, 520 px, `aria-modal`, close X → back to `bar`; P: bottom sheet): "Everything except essential is off until you switch it on. You can change this any time from Cookie settings in the footer."; switch rows (`role="switch"`): Essential "Sign-in, your board settings, keeping games in sync. Always on." (checked, disabled), Analytics "PostHog: which pages are used, so we fix the right things.", Error replay "A recording of the page when something breaks, without what you type.", Marketing "Measures which ads brought you here. We run none today."; three equal secondary buttons "Reject non-essential", "Save choices", "Accept all"; link "Cookie policy" → `/cookies`.
  - `saved`: toast (top right D, bottom centre P) "All cookies allowed · change it in Cookie settings" / "Only essential cookies · change it in Cookie settings" / "Your choices are saved · change it in Cookie settings", 4 s, then `gone`.
  - `gone`: no UI; "Cookie settings" (footers, Settings › Account › Privacy row from P10, the account menu) reopens `bar`.
- **Components:** `ConsentBar` (`role="region"`), `ConsentPreferences` (`Dialog` on D/IL, `Sheet` on P/A/IP), `Switch` rows, `Button` (equal widths enforced by a 2- or 3-column grid), `notify` toast, `CookieSettingsButton`.
- **Interactions:** Esc in preferences → `bar`; focus returns to the trigger; GPC (`navigator.globalPrivacyControl === true`) pre-selects reject in preferences and still shows the bar.

### S22 · Install app (desktop popover, Android card, iOS steps, iPad popover)

- **Boards:** D `DR/V3PwaInstall.dc.html` (states `prompt`, `installing`, `installed`, `snoozed`, `gone`; popover 340 px at `left: 232px; top: 72px` with a left-pointing arrow, over `V3Home`); A `DR/V3AndroidPwaInstall.dc.html` (same states; card left/right 12 px, `bottom: 176px`, over `V3AndroidPlayHub`); P `DR/V3iPhonePwaInstall.dc.html` (states `steps`, `dismissed`, `gone`; bottom sheet, hint "Share is in the bar below"); IP `DR/V3iPadPPwaInstall.dc.html` (states `steps`, `dismissed`, `gone`; popover `right: 16px; top: 88px`, 380 px, arrow up at the top-right Share button, hint "Share is at the top right of Safari").
- **Route:** overlay in the `(app)` shell only (`InstallPromptRoot`), arbitrated by `lib/overlays/store.ts` priority 6 (§8.6).
- **States:**
  - Chromium `prompt`: app icon 44 px, h2 "Install ReplayChess", "playchess.tech" (dev: the dev host), "Opens in its own window. Your Mistake Bank, downloaded lessons and bot games work offline.", "Not now" / "Install". Rail mode (IL, zoom 150 %): anchor `left: 76px`.
  - `installing`: Install shows a spinner + "Waiting for your browser…" while the native dialog is open.
  - `installed` toast "ReplayChess is installed. Open it from your apps."; `snoozed` toast "We’ll ask again in 14 days."; then `gone`.
  - iOS `steps`: h2 "Add ReplayChess to Your Home Screen", "Three taps in Safari. Needed for reminders on iPhone.", 3 step buttons (`aria-current="step"`; auto-advance every 3 s until the user picks one): 1 "Tap Share · The square with an arrow in Safari’s toolbar.", 2 "Choose Add to Home Screen · Scroll the list if you don’t see it.", 3 "Tap Add · ReplayChess appears with your other apps."; "Not now" / "Got it".
  - iOS `dismissed`: toast "You can install any time from Settings · Notifications." (true because P11 lights, or adds, that row, §2.4); then `gone`.
  - Entry from P10's Settings › Notifications `ios_install` state and `V3NotifPrompt` `ios_install_first` "Show me how": `openInstallPrompt({ source: "notifications" })` opens the `steps` sheet (P10 no longer imports `IOSInstallModal`).
  - The boards' "Show the prompt again" buttons are board-demo controls, not product UI.
- **Components:** `Popover` (desktop, iPad P; `role="dialog"`, non-modal, `aria-labelledby` the h2, focus moves into it on open and back to the previous element on close), `Sheet` (iPhone; modal, focus trap, drag handle `aria-hidden`), `Card` (Android), `Button`, `Spinner`, `notify` toasts.
- **Interactions:** Esc = "Not now" (snooze 14 days); Enter on Install; the iOS step buttons are a roving group (←/→, `aria-current="step"`); auto-advance stops on the first user interaction or under `prefers-reduced-motion`.
- **Eligibility:** §8.7.

### S23 · New version available (deferred in game)

- **Board:** D `DR/V3PwaUpdate.dc.html` (states `ready`, `refreshing`, `later`, `in_game`).
- **Placement:** `ready`/`refreshing`: card 196 px wide at `left: 12px; bottom: 16px` inside the sidebar column above the profile footer (`role="status"`, no focus steal); rail mode: a 48 px icon button with a dot in the rail footer that opens the card as a popover; P/IP/A: bottom card above the tab bar (`bottom: calc(56px + env(safe-area-inset-bottom) + 12px)`). `later`: collapses to an "Update ready" button in the same spot. `in_game`: chip top-right "Update ready · installs after this game" (P2 overlay slot).
- **States:** `ready` "A new version is ready" / "Refreshing takes a second. Nothing you’re doing is lost." + "Refresh" + "Later"; `refreshing` "Updating…" + spinner; `later` button reopens `ready`; `in_game` chip only; on `game:over` → `ready`.
- **Components:** `Card` (`role="status"`, never steals focus), `Button`, `Spinner`, `UpdateChip` (P1 `InGameStatusChip kind="update"`, `role="status"`) mounted in P2's `features/game/screen/InGameChips.tsx`.
- **Interactions:** Tab reaches the card after the main content; Enter on Refresh; no shortcut. Drafts (coach input, contact form) are written to `sessionStorage` before the reload.
- **Logic:** §8.8. Marketing pages show no update UI (their documents are network-first and refresh on navigation).

---

## 5. UI ↔ API data flow

Follows client-data-layer.md (CDL) throughout: RSC/static for first paint (D1), TanStack Query v5 as the only client cache (D3), mutations through `api()` route handlers (D4), errors through `reactToApiError()` (D5), `qk.me()` seeded never fetched on boot (D6), URL for view state (D8), push not poll (D10), SW never caches `/api/*` (D13).

### 5.1 What is new in the shared client layer (owned by WP0 unless stated)

| Item | File | Detail |
|---|---|---|
| Provider split | `components/providers/AppProviders.tsx` (WP0) | `ClerkScope > QueryProvider > OverlayHost`; mounted by the `(app)`, `(auth)`, onboarding, checkout, `(admin)`, `dev` and pricing layouts (D2). Marketing, `(system)` and the root 404 have neither Clerk nor TanStack; their islands use `useAuthHint()` and plain `fetch` helpers |
| Query keys | `lib/api/keys/system.ts` (P1 registry directory, or `lib/api/keys.ts`) | `qk.system.notice() = ["system","notice"]`, `qk.returnTarget(path) = ["returnTarget", path]` (path normalised, no query), `qk.search(scope, q)` already in the CDL factory (`scope` = `"public" \| "me"`, which picks the path) |
| Query options | `lib/api/queries/system.ts` (WP-F), `lib/api/queries/search.ts` (WP-D), `lib/api/queries/return-target.ts` (WP-C) | `queryOptions()` per CDL §3.3 rule 6; every call site passes `devSchema(Schema)` (AP-12) |
| Plain fetch helpers (no TanStack) | `lib/consent/client.ts` (WP-G), `lib/search/fetch-search.ts` (WP-D), `lib/system/fetch-notice.ts` (WP-F) | used where no `QueryProvider` exists: consent PUT/GET with 2 retries (1 s, 4 s), the static 404 search with abort and a 20-entry memo, the static maintenance page |
| 402 routing | `lib/api/errors.ts` (P1) `reactToApiError` | D18: `subscription_required` + `details.reason` (`trial_available` → `navigation.replace(paywallUrl("required", path))`; `trial_used`/`expired`/`paused` → `overlays.request("renew_sheet", { from })` on `(app)` routes, else `/pricing?reason=ended`); `402 payment_update_required` → `overlays.request("renew_sheet", { paymentFirst: true })`; without P7's sheet, both go to `/pricing?reason=ended` |
| 503 routing | same | `maintenance` → `setQueryData(qk.system.notice(), err.details.notice)` → `MaintenanceBanner`; the next document navigation gets the rewritten page; no toast |
| Overlay kinds | `lib/overlays/store.ts` (P1) | add `cookie_consent` (priority 4), `renew_sheet` (2.5), `pwa_install` (6), `pwa_update` (7), and register P2's restart chip as `maintenance_restart` (2), with the immersive-route rules of §8.6. The store is plain Zustand, so the root `ConsentRoot` and the `(app)` prompts share it without a provider |
| Online state | `lib/offline/useOnline.ts` (WP-E) | feeds `onlineManager.setEventListener` (CDL §7.3) where TanStack exists, the chip and `/offline` |
| Live-game signal | `lib/system/activity.ts` (WP-E) | `useActivity` Zustand `{ liveGameRef: string \| null }`, set by P2's game client on `phase` changes |
| SW user | `lib/pwa/sw-user.ts` (WP-E) | `postSwUser(ref \| null)`: `navigator.serviceWorker.controller?.postMessage({ type: "SET_USER", ref })`. The `(app)` layout island posts the viewer's ref on boot; every auth page posts `null` on mount and again after `setActive` (so the first navigation after a sign-in is never cached under the previous user); `signOutEverywhere()` posts `null` |
| Analytics `track()` | `PKG/analytics/src/events/*.ts` + `lib/analytics/track.ts` (WP-G) | typed against the zod registry; no-op until PostHog is loaded (D6); pushes to the test sink when `NEXT_PUBLIC_TELEMETRY_SINK=1` (testing X6) |
| Stored consent for a new device | `GET /api/consent` (WP-G) | replaces the draft's `Viewer.consent`: `GET /api/me` (the hot path every `(app)` page uses) stays unchanged, and only a signed-in visitor with no `rc_consent` cookie pays one PK read, once |

### 5.2 Per screen

| Screen | First paint | Client queries (key · staleTime · refetch) | Mutations / endpoints | Realtime / polling | Error, 401, 402, 429, 5xx | Prefetch | Function invocations per view |
|---|---|---|---|---|---|---|---|
| S1 Landing | static HTML (CDN) | none | none (links) | none | n/a | default `<Link>` viewport prefetch of static targets (`/pricing`, `/how-we-grade`, `/sign-up` is dynamic → `prefetch={false}`) | 0 |
| S2/S3 Pricing | static HTML; `PricingStateIsland` resolves after hydration | signed in only (`useAuth().isSignedIn`): `qk.me()` → `GET /api/me` · staleTime 5 min · focus refetch; **forced fresh fetch** (`refetchOnMount: "always"`) when `reason=required\|ended` or `checkout=failed`; `qk.returnTarget(redirect_url)` → `GET /api/return-target` · 1 h | `POST /api/checkout {plan, source:"pricing"\|"paywall", returnPath}` + `Idempotency-Key` (P4) → `location.assign(checkoutUrl)`; `meta: { errorUi: "inline" }` | none | checkout `409 already_subscribed` → `invalidateQueries(qk.me())` → member view; `402 payment_update_required` → portal; `503 not_configured` → inline copy; 401 → `/sign-in?redirect_url=/pricing?…`; 429 (`checkout` bucket) → `RetryCountdown` inside the CTA; 5xx → inline bad banner with `requestId` | hover on the CTA → `router.prefetch('/checkout/activating')` | 0 signed out; 1–2 signed in |
| S4 RenewSheet | n/a (overlay) | reads `qk.me()` from cache | `POST /api/checkout {source:"renew", plan: me.entitlement.interval}`; portal link `GET /api/customer-portal` | none | as S2 | none | 1 on Renew |
| S5 About, S10 Legal | static | none | none | none | n/a | default | 0 |
| S6/S7 Blog | static (SSG) | none | none | none | n/a | default | 0 |
| S8 Help | static; search runs over the embedded `content/help.ts` | none | none | none | n/a | none | 0 |
| S9 Contact | static | none | `POST /api/contact` (`useMutation`, `meta: { errorUi: "inline" }`, `Idempotency-Key` = `crypto.randomUUID()` stored with the draft, reused on retry) | none | 400 `validation_failed` → field errors from `fields`; 403 (BotID) and 5xx/network → `error` banner, values kept; 429 → the 429 copy with `retryAfterSec` | none | 1 per send |
| S11–S14 Auth | dynamic server shell: `resolveReturnTarget(redirect_url)` via P8 `unstable_cache` loaders (0 DB on hit) | none (Clerk FAPI calls only, browser → Clerk) | Clerk `signIn.*`, `signUp.*`, `setActive` | none | Clerk errors → `lib/auth/clerk-errors.ts` mapping (§8.4); FAPI 429 → `rate_limited` | none | 1 (page render) |
| S15 SSO callback | static | none | Clerk `handleRedirectCallback` | none | error → `/sign-in?oauth=cancelled` | none | 0 |
| S16 404 signed out (and signed in on an unmatched URL) | **static** HTML from the CDN; pre-paint auth hint picks the chrome | none (no TanStack): `fetch-search.ts` → `GET /api/search` (CDN `public-static` 300 s), `q.length >= 2`, debounce 150 ms, `AbortController`, 20-entry memo | none | none | search errors → static results only, silent | none | 0 (+ CDN-cached searches) |
| S16 in-shell 404 after `notFound()` / `missing_game` | dynamic inside the shell (the calling page's `getViewer()`, React `cache()`) | `qk.search("me", q)` → `GET /api/me/search` · 5 min · `keepPreviousData`; IP block reads IndexedDB only | none | none | — | none | 1 (the page itself) |
| S17 500 | client boundary | none | `Sentry.captureFeedback` (tunnel `/monitoring`), fallback `POST /api/feedback` | none | feedback failure → keep `report_form`, inline "Couldn't send the report. Try again." | none | 0–1 |
| S18 Global | inline HTML | none | `location.reload()` | none | — | none | 0 |
| S19 Offline | precached static | none (no network) | `GET /api/health` probe (direct `fetch`, `cache:"no-store"`) on Retry, every 15 s while offline and on `online` | none | probe failure → stay `offline` | none | 0 while offline |
| S20 Maintenance page | middleware rewrite to the static page | none (no TanStack): `fetch-notice.ts` → `GET /api/system/notice` once on mount, then every 15 s only after the countdown reaches 0 and only while visible | none | none on this page | — | none | 0–1 per 15 s after the countdown (CDN-cached, s-maxage 30) |
| S20 in-game chip | n/a | none | none | P2 `server:restarting {restartAt, resumes}` on the game room (P2's chip) | — | none | 0 |
| S20 scheduled banner | shell banner slot | `qk.system.notice()` fetched on mount of the `(app)` layout client, on `visibilitychange` (≥ 5 min since last) and on every socket `connect` | none | `system:notice` → `setQueryData` | — | none | ≈ 0 (CDN) |
| S21 Consent | client overlay; the `(app)` layout reads `cookies().get("rc_consent")` server-side to SSR the in-flow bar (no CLS); marketing reads `document.cookie` after mount | `GET /api/consent` only when the cookie is missing and `useAuthHint().signedIn` (once per device) | `PUT /api/consent` through `lib/consent/client.ts` (plain `fetch`, fired after the cookie is written client-side; 2 retries because PUT is idempotent; an offline choice is applied locally and re-sent on the next `online` event) | none | failures are silent (cookie already applied), Sentry breadcrumb | none | 1 per choice (+1 on a new device) |
| S22 Install | client overlay | none | none | none | — | none | 0 |
| S23 Update | client overlay | none | version poll `GET /api/health` (direct `fetch`) on `visibilitychange`, at most every 30 min | P2 socket `connect_error "upgrade_required"`; SW `updatefound`/`waiting` | — | none | ≤ 2 per hour per tab |

### 5.3 Sequences

**Sign in with a return target** (S11):

```
browser GET /play/legend/kasparov-topalov-1999 (signed out)
  → middleware (P1 rules): redirectToSignIn({ returnBackUrl }) → 307 /sign-in?redirect_url=%2Fplay%2Flegend%2Fkasparov-topalov-1999
GET /sign-in?redirect_url=…  (dynamic RSC, AppProviders in the (auth) layout)
  → safeReturnPath() ok → resolveReturnTarget() → getPosition(slug) [P8 unstable_cache, tags positions + position:<slug>, 0 DB on hit]
  → HTML: aside board FEN + caption, return banner
user submits → clerk-js → FAPI POST /v1/client/sign_ins (identifier, password)
  ← status complete → setActive({ session }) → postSwUser(null) → router.replace("/play/legend/kasparov-topalov-1999")   [the (app) boot then posts the real ref]
  → middleware: claims md.onboarded/md.entitled → page or /pricing?reason=required&redirect_url=…
```

**Pricing CTA for a signed-in, trial-eligible user** (S2):

```
static /pricing (outside the middleware matcher) → PricingStateIsland (AppProviders in the pricing layout)
  useAuth().isSignedIn → useQuery(qk.me) → GET /api/me (private-etag: private, no-cache + strong ETag) → derivePricingState() = logged_in
click "Start 7-day free trial" → POST /api/checkout {plan:"monthly", source:"pricing", returnPath:"/play/legend/…"} + Idempotency-Key
  ← { data: { checkoutUrl, trial:true, chargeDate } } → location.assign(checkoutUrl) → Dodo
Dodo → /checkout/activating?redirect_url=… (P4)
```

**Contact** (S9):

```
POST /api/contact (route(): auth optional, maxBodyBytes 16 KB, idempotent, contact-burst 2/60 s, BotID)
  → SELECT count(*) FILTER (ipHash), count(*) FILTER (email) FROM support_requests WHERE createdAt > now() - 1 h   [durable limits, D20]
  → INSERT support_requests … RETURNING id → 202 { data: { reference: "RC-2xxxx" } }
  → after(): daily budget check → Resend send(to SUPPORT_INBOX, replyTo user) + send(ack to user, while < 20 today) → UPDATE status SENT|FAILED
cron daily → retry FAILED (< 24 h, attempts < 3, inside the budget)
```

**Consent** (S21):

```
click "Accept all" → writeConsentCookie(v1,1,1,0) → applyConsent(): import("posthog-js") on idle → init(advanced_disable_feature_flags) → (app) island identify(me.user.ref) if signed in;
                                                     Sentry.lazyLoadIntegration("replayIntegration") → addIntegration
                   → lib/consent/client.ts PUT /api/consent {v:1, analytics:true, replay:true, marketing:false, method:"accept_all", source:"banner"}
                     ← Set-Cookie rc_consent (authoritative) ; INSERT consent_records ; UPSERT user_settings.consent
withdraw (Save with analytics off) → posthog.opt_out_capturing(); posthog.reset(); delete ph_* cookies/localStorage; Replay: client.getIntegrationByName("Replay")?.stop()
```

**Maintenance** (S20):

```
owner: pnpm notice:set --mode active --minutes 30 → Vercel API PATCH Edge Config replay-ops {notice}   (1 of the 100 writes a month)
       → gh workflow run ops-broadcast.yml → ssh → docker compose exec websocket wget POST /internal/broadcast
         {v:1, type:"notice", notice} (x-internal-token) → currentNotice = notice; io.emit("system:notice", notice)
next document request to /home → middleware getOps() (memo ≤ 300 s, 60 s once active) → rewrite /maintenance (503, Retry-After, x-rc-maintenance)
API mutation from an open tab → route() gate → 503 { error: { code:"maintenance", details:{ retryAt, notice } } } → reactToApiError → setQueryData(qk.system.notice)
open (app) tabs → system:notice → setQueryData(qk.system.notice) → MaintenanceBanner; the page swap happens on the next navigation
affects "online": new queue:join / find_match / challenge accept → ack { ok:false, code:"maintenance", retryAt } → toast; running games continue
deploy (P2): deploy-oci.yml → /internal/broadcast {type:"restart", inSeconds} → game rooms get server:restarting {restartAt} → P2's in-game chip
socket restart → WS boot fetches GET /api/system/notice → currentNotice restored
```

**Update** (S23): SW `waiting` → `useUpdate` state `ready` (or `in_game` when `liveGameRef` set) → Refresh → `waiting.postMessage({type:"SKIP_WAITING"})` → `controllerchange` → save drafts → `location.reload()`.

### 5.4 Invalidation and cache effects

| Trigger | Effect |
|---|---|
| Checkout `409 already_subscribed` | `invalidateQueries(qk.me())` |
| `PUT /api/consent` success | none (no query holds consent; the cookie is the client copy) |
| Contact sent | `sessionStorage` draft cleared; no query |
| `system:notice` | `setQueryData(qk.system.notice(), notice)` |
| Back online | `resumePausedMutations()`, `refetchQueries({ type: "active", stale: true })`, outbox flush (P5 `outbox.flush` + `botGames`) |
| Sign-out (`signOutEverywhere`, P1/CDL §6.6) | adds, after P1's cache-clear step: `postMessage({type:"PURGE_USER"})` and `SET_USER null` to the SW (deletes every `rc-pages:u:*`), delete `u:<ref>:*` in `rc-offline`, clear `current`; consent cookie is **kept** (device-level choice) |
| Auth page mount, `setActive` | `SET_USER null` to the SW: every `rc-pages:u:*` cache is deleted and pages are not cached until the next `(app)` boot posts `SET_USER <ref>` |
| Update applied | full reload; the query cache is rebuilt from RSC |

---

## 6. Data model (migration M11)

P11 is light on schema: two small append-mostly tables. `user_settings.consent Json?` already exists (P9 creates `UserSettings` with it, consistency R-02), so M11 does not touch `user_settings`. Conventions follow data-model.md §2 (BigInt ids, camelCase columns, snake_case tables, `VarChar` limits mirrored in zod, `onDelete` policy).

### 6.1 Prisma changes (`WEB/prisma/schema.prisma`, or `packages/db/prisma/schema.prisma` after the package move)

```prisma
/// M11 (P11). Cookie-consent proof. Append-only, 24-month retention (daily cron prune, §7.7).
/// No FK: rows outlive deleted users (data-model §6, "audit log, consent records, webhook events: kept, ids only").
model ConsentRecord {
  id        BigInt   @id @default(autoincrement())
  userId    BigInt?
  /// Random id stored in the rc_consent cookie for signed-out visitors (nanoid 16).
  anonId    String?  @db.VarChar(40)
  /// Policy version, "v1".
  version   String   @db.VarChar(8)
  analytics Boolean
  replay    Boolean
  marketing Boolean
  /// accept_all | reject | save
  method    String   @db.VarChar(16)
  /// banner | settings   (P11 addition to data-model §5.10)
  source    String   @db.VarChar(12) @default("banner")
  /// x-vercel-ip-country, 2 letters, may be null
  country   String?  @db.Char(2)
  createdAt DateTime @default(now())

  @@map("consent_records")
}

enum SupportTopic {
  BILLING
  IMPORTING
  COACH
  BUG
  OTHER
}

enum SupportStatus {
  RECEIVED
  SENT
  FAILED
  SPAM
}

/// M11 (P11). Contact-form messages (V3Contact). Holds PII: 180-day retention, deleted with the account.
/// P11 addition to data-model.md (merge into schema.target.prisma).
model SupportRequest {
  id        BigInt        @id @default(autoincrement())
  userId    BigInt?
  name      String        @db.VarChar(120)
  email     String        @db.VarChar(254)
  topic     SupportTopic
  message   String        @db.VarChar(5000)
  /// ContactContextV1 { v:1, path?, ref?, appEnv, deviceClass? } (packages/db/json/contact-context.ts)
  context   Json?
  status    SupportStatus @default(RECEIVED)
  attempts  Int           @default(0) @db.SmallInt
  /// Resend message id of the support copy
  emailId   String?       @db.VarChar(64)
  lastError String?       @db.VarChar(300)
  /// hex(sha256(RATE_LIMIT_IP_PEPPER || ip))[0:32]; durable rate limit (D20) and abuse review
  ipHash    String?       @db.Char(32)
  createdAt DateTime      @default(now())
  sentAt    DateTime?
  user      User?         @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  /// durable contact limits, cron retry, daily send budget, prune (§6.3)
  @@index([createdAt])
  @@map("support_requests")
}

// User model: add the back-relation
//   supportRequests SupportRequest[]

// UserSettings: created by P9 (M9) with `consent Json?` (consistency R-02). M11 adds nothing to it.
```

JSON registry additions (data-model §9): `user_settings.consent` = `ConsentV1 { v: 1, analytics: boolean, replay: boolean, marketing: boolean, at: string(ISO), source: "banner" | "settings" }` (≈ 120 B), written only by `PUT /api/consent`, read only by `GET /api/consent` for a signed-in user on a new device (§8.5); `support_requests.context` = `ContactContextV1` (≤ 300 B).

### 6.2 Migration file

Folder `prisma/migrations/<yyyymmddHHMMSS>_m11_consent_support/migration.sql`, generated with `prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url <local Docker postgres:17> --script` (data-model §11.2), then hand-edited:

```sql
SET lock_timeout = '5s';

CREATE TYPE "SupportTopic" AS ENUM ('BILLING', 'IMPORTING', 'COACH', 'BUG', 'OTHER');
CREATE TYPE "SupportStatus" AS ENUM ('RECEIVED', 'SENT', 'FAILED', 'SPAM');

CREATE TABLE "consent_records" (
  "id" BIGSERIAL NOT NULL,
  "userId" BIGINT,
  "anonId" VARCHAR(40),
  "version" VARCHAR(8) NOT NULL,
  "analytics" BOOLEAN NOT NULL,
  "replay" BOOLEAN NOT NULL,
  "marketing" BOOLEAN NOT NULL,
  "method" VARCHAR(16) NOT NULL,
  "source" VARCHAR(12) NOT NULL DEFAULT 'banner',
  "country" CHAR(2),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "consent_records_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "support_requests" (
  "id" BIGSERIAL NOT NULL,
  "userId" BIGINT,
  "name" VARCHAR(120) NOT NULL,
  "email" VARCHAR(254) NOT NULL,
  "topic" "SupportTopic" NOT NULL,
  "message" VARCHAR(5000) NOT NULL,
  "context" JSONB,
  "status" "SupportStatus" NOT NULL DEFAULT 'RECEIVED',
  "attempts" SMALLINT NOT NULL DEFAULT 0,
  "emailId" VARCHAR(64),
  "lastError" VARCHAR(300),
  "ipHash" CHAR(32),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sentAt" TIMESTAMP(3),
  CONSTRAINT "support_requests_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "support_requests_userId_idx" ON "support_requests"("userId");
CREATE INDEX "support_requests_createdAt_idx" ON "support_requests"("createdAt");
-- New, empty table: a validated FK is instant, so no NOT VALID step is needed.
ALTER TABLE "support_requests" ADD CONSTRAINT "support_requests_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- user_settings.consent exists since M9 (P9); nothing to add.
```

No partial indexes, no `UNLOGGED`, nothing for `prisma/protected-indexes.txt`.

### 6.3 Indexes and the queries they serve

| Index | Query | Expected plan |
|---|---|---|
| `consent_records_pkey (id)` | `INSERT INTO consent_records (…) VALUES (…)` from `PUT /api/consent` | insert only; no secondary index on purpose (data-model §5.10: append-only, read only for audits) |
| (none) | daily prune `DELETE FROM consent_records WHERE "createdAt" < now() - interval '24 months'` | seq scan of a small table (≈ 70 B/row; 10k opt-ins a month ≈ 0.7 MB/month). If the table passes 1M rows, add `BRIN ("createdAt")` (a few KB) in a later migration |
| (none) | audit lookup `SELECT … FROM consent_records WHERE "userId" = $1 ORDER BY id DESC LIMIT 20` (manual, rare) | seq scan acceptable; add `(userId)` only if support needs it often |
| `support_requests_pkey (id)` | `INSERT … RETURNING id` (reference `RC-` + `20000 + id`), `UPDATE support_requests SET status=…, "emailId"=…, "sentAt"=now() WHERE id = $1` from `after()` | PK |
| `support_requests_userId_idx` | `ON DELETE CASCADE` from `users` during account deletion (P10 transaction) | index scan, keeps the delete transaction short |
| `support_requests_createdAt_idx` | durable limits (D20): `SELECT count(*) FILTER (WHERE "ipHash" = $1)::int AS by_ip, count(*) FILTER (WHERE email = $2)::int AS by_email, min("createdAt") AS oldest FROM support_requests WHERE "createdAt" > (now() AT TIME ZONE 'UTC') - interval '1 hour' AND ("ipHash" = $1 OR email = $2)` | index range scan over the last hour (tens of rows at most), filter; ≈ 1 ms |
| `support_requests_createdAt_idx` | daily send budget: `SELECT count(*) FROM support_requests WHERE status = 'SENT' AND "createdAt" >= date_trunc('day', now() AT TIME ZONE 'UTC')` | index range scan over today |
| `support_requests_createdAt_idx` | cron retry `SELECT id FROM support_requests WHERE status = 'FAILED' AND attempts < 3 AND "createdAt" > (now() AT TIME ZONE 'UTC') - interval '24 hours' ORDER BY id LIMIT 20` | index range scan over 24 h, filter |
| `support_requests_createdAt_idx` | cron prune `DELETE FROM support_requests WHERE "createdAt" < (now() AT TIME ZONE 'UTC') - interval '180 days'` | index range scan, daily |
| `user_settings_pkey (userId)` | `INSERT INTO user_settings ("userId", consent, "updatedAt") VALUES ($1, $2, now()) ON CONFLICT ("userId") DO UPDATE SET consent = EXCLUDED.consent, "updatedAt" = now()` (lazy create, data-model §5.2) | PK upsert |
| `rate_limit_buckets_pkey (key)` (P1, UNLOGGED, windows ≤ 60 s only) | one upsert per limited request, P1 key format: `rl:contact-burst:ip:<h16>`, `rl:consent-burst:ip:<h16>`, `rl:feedback-burst:c:<clerkId>` + `…:ip:<h16>`, `rl:search-user:c:<clerkId>` (no bucket on the public search) | PK upsert, ≈ 2–5 ms in-region, in parallel with the viewer read |
| `idempotency_keys_pkey (key)` (P2) | `POST /api/contact`: `INSERT … ON CONFLICT DO NOTHING` with key `<userRef \| "anon:"+iphash16>:contact:<uuid>` | PK |

Read paths added by P11 that touch existing tables (no new index):

| Endpoint | SQL shape | Tables / sizes |
|---|---|---|
| `GET /api/search` (public) | none on a data-cache hit: `getLegendCards()` (51 rows) and `listPracticePositions()` (≤ 30 featured) are P8 `unstable_cache` loaders filtered in memory; openings go through P8's `searchOpenings(q)`, cached per normalised `q` (on a miss one `WHERE name ILIKE $pattern OR eco ILIKE $prefix ORDER BY popularity DESC, name LIMIT 4` over 3,641 rows, 1–2 ms per data-model §8) | legends, chess_positions, openings |
| `GET /api/me/search` (member) | adds `SELECT g."referenceId", gp."opponentName", gp."endedAt" FROM game_players gp JOIN games g ON g.id = gp."gameId" WHERE gp."userId" = $me AND gp."endedAt" IS NOT NULL AND gp."opponentName" ILIKE $pattern ORDER BY gp."endedAt" DESC, gp."gameId" DESC LIMIT 4` (P2's columns, consistency R-01) | `game_players_userId_endedAt_gameId_idx` (P2) prefix scan, filter, stop at 4 (≤ 2,000 rows per member); 4 PK lookups on `games` |
| `GET /api/return-target` | P8 tagged loaders `getPosition`, `getLegendDetail`, `getOpeningDetail` and P9's challenge loader (`unstable_cache`): 0 statements on a hit, 1 on a miss; private paths: none (D23) | legends, chess_positions, openings, challenges |
| `GET /api/consent` (signed in, new device) | `SELECT consent FROM user_settings WHERE "userId" = $1` | `user_settings_pkey` |
| `(app)/not-found.tsx` | none of its own (the calling page already ran `getViewer()`, React `cache()`); the root 404 is static | — |

### 6.4 Safety, order and environments

- Additive only (two new tables, two new enum types, three indexes). No contract step. Nothing touches production in P11: production gets M11 in P13 through `prisma migrate deploy` after the child-branch rehearsal (allocation §1.3, data-model §11).
- The Neon **dev** branch named in CLAUDE.md (consistency R-20: phase specs name the branch, not its ids, because P13 may move dev to its own project): apply with `prisma migrate deploy` using the dev `DIRECT_URL`. P11 never runs `prisma migrate dev` or `prisma db push` against any Neon branch (R-20; `db push` would drop hand-written indexes); `migrate dev` runs only against a local Docker Postgres 17 (CLAUDE.md rules 1–2). If a tool ever suggests a reset, stop and ask the owner (CLAUDE.md rule 5).
- Order: migration → deploy web (the new client knows both enums) → start writing rows. The enums are new types, so no `ALTER TYPE … ADD VALUE` ordering issue.
- CI drift gate (`scripts/db/check-drift.ts`, created by P2, consistency R-10) must pass with M11 included; CI applies M11 to Docker Postgres 17 (testing X16).
- Account deletion (P10 ME-15 transaction): `support_requests` rows go with the user (cascade); `consent_records` keep `userId` as a plain number (no FK) and are anonymised by setting `userId = NULL` in the same transaction (one `UPDATE consent_records SET "userId" = NULL WHERE "userId" = $1`; seq scan acceptable at this size). P11 hands this one line to P10's deletion code (§13.3).

### 6.5 Backfills and seed data

- **Backfills:** none.
- **Dev DB seed:** none for the new tables. The screens use the personas from data-model §13.4 (`new`, `trial`, `member`, `lapsed`, `legacy`, `pastdue`) through P1's lease pool, and E2E users A–R from `apps/web/.env.test` (Q and R read-only, testing X4).
- **Content seed (code, not DB):** `content/help.ts` (31 Q&As), `content/legal/{terms,privacy,cookies,licenses}.ts` (drafts with `[DATE]`/entity placeholders, Q5), blog MDX frontmatter `fen`/`orientation`/`positionSlug` on the existing posts, `lib/search/page-index.ts` (static page index), `lib/consent/cookie-inventory.ts`.
- **Edge Config seed (dev store `replay-ops`, replaychess007 Vercel account):** `{ "notice": null, "flags": { "auth_custom_flows": true } }`. Production store items are created in P13.
- **Clerk dev instance seed:** shared users through `e2e/scripts/provision-test-users.ts`; the sign-up, verify and reset specs create throwaway `e2e-<flow>-<runId>+clerk_test@example.com` users (code `424242`) that `sweep-throwaway-users.ts` deletes, so no shared user's password ever changes.

---

## 7. API

All new HTTP routes use `route()` from `WEB/lib/api/route.ts` (P1 §7.2, B18) with a stable `id`, the envelope `{ data, meta? }` / `{ error: { code, message, fields?, details?, retryAfterSec?, requestId } }` (B16), zod schemas in `CT/http/*` (B17, imported as `@repo/contracts/http/<file>`), `x-request-id` from middleware where middleware runs, and P1's fixed-window limiter for windows ≤ 60 s (D20). Error codes come from `CT/http/codes.ts` (consistency R-06). **P11 adds no new HTTP code**: it uses `validation_failed` (400), `unauthorized` (401), `forbidden` (403), `payload_too_large` (413), `idempotency_key_reused` (422, added by P2), `rate_limited` (429), `maintenance` (503, reserved by P1 for this phase) and `unavailable` (503). Every 4xx/5xx is `Cache-Control: private, no-store`; every 429 carries `Retry-After`. Auth modes are P1's: `public` reads no session, `optional` loads a viewer when there is one.

On the client, `api()` parses responses with the zod schema **only in dev and test**: every call site passes `devSchema(Schema)` (`lib/api/schema.ts`, P1), so the schema modules drop out of production chunks (api-perf AP-12). Forms that validate on the client (contact) import `zod/mini`.

### 7.1 Route catalogue

| # | Method · path | Route `id` · auth | Purpose | Cache tier | Rate limit (D20) | Idempotency | Body limit | DB statements |
|---|---|---|---|---|---|---|---|---|
| A1 | `GET /api/search` | `search.public` · `public` | 404 search, palette for non-members | `public-static` (`sMaxAge: 300`, `swr: 86400`, tags `catalog`); outside the middleware matcher | Vercel Firewall 60/min per IP; none in the function | n/a | n/a | 0 on a data-cache hit; ≤ 1 (`searchOpenings` miss) |
| A1m | `GET /api/me/search` | `search.me` · `user` | palette and in-shell 404 for members | `no-store` | `search-user` 60 / 60 s by user | n/a | n/a | A1 + 1 |
| A2 | `GET /api/return-target?path=` | `returnTarget.get` · `public` | destination label + board for auth asides, pricing banner, checkout activation | `public-static` (`sMaxAge: 3600`, `swr: 86400`, tags `catalog`); 204 also cached 3600 s; outside the matcher | Vercel Firewall rule only | n/a | n/a | 0 on a hit, ≤ 1 on a miss |
| A3 | `POST /api/contact` | `contact.create` · `optional` | contact form | `no-store` | `contact-burst` 2 / 60 s by IP, then durable 5 / h per IP hash and 3 / h per email counted from `support_requests`; BotID | `Idempotency-Key` required | 16 KB | 4 (+ 2 in `after()`) |
| A4 | `PUT /api/consent` | `consent.put` · `optional` | consent proof + cookie | `no-store` | `consent-burst` 10 / 60 s by IP | natural (PUT, last write wins) | 1 KB | 0–2 + limiter |
| A4g | `GET /api/consent` | `consent.get` · `optional` | stored choice for a signed-in user on a new device | `no-store` | none (called once per device) | n/a | n/a | 1 (signed in), 0 (signed out → `{ consent: null }`) |
| A5 | `POST /api/feedback` | `feedback.create` · `optional` | 500 "Report" fallback | `no-store` | `feedback-burst` 3 / 60 s by `user+ip` | n/a | 8 KB | limiter only |
| A6 | `GET /api/system/notice` | `system.notice` · `public` | maintenance notice for open tabs and the socket server at boot | `public-static` (`sMaxAge: 30`, `swr: 60`); outside the matcher | none (CDN) | n/a | n/a | 0 (Edge Config) |
| A7 | `GET /api/health` (P1 A1) | `health.get` · `public` | offline probe, version poll | `no-store`; outside the matcher | P1 `health-deep` for `?deep=1` | n/a | n/a | 0 |
| — | `GET /api/healthcheck` (P1 A2 alias) | — | **deleted** in P11 (P1 marks it "delete in P11"), after the uptime monitor and `public/llms.txt` point at `/api/health` | — | — | — | — | — |
| W1 | `POST /api/webhook/clerk` (P1; P10 edited) | `webhook.clerk` · `webhook` | P11 confirms the `signupSource` copy and moves `account_created` into `provisionUser()` | — | — | `WebhookEvent` dedupe | 256 KB | — |
| C1 | `GET /api/cron/daily` (P1) | `cron.daily` · `cron` | P11 adds 3 tasks (`lib/cron/tasks/{support,consent}.ts`) | — | — | idempotent | — | ≤ 4 per day |
| S1 | `POST {WS}/internal/broadcast` (**P2**, `WS/src/http/broadcast.ts`) | `x-internal-token` (D19); Caddy blocks it from outside, reached through `docker compose exec` | P11 adds the `notice` type next to P2's `restart` | — | — | — | 4 KB | 0 |

### 7.2 Contracts (zod 4, `CT/`)

```ts
// CT/http/search.ts
export const SearchType = z.enum(["page", "help", "legend", "position", "opening", "game"]);
export const SearchQuery = z.object({
  q: z.string().trim().min(2).max(64).transform((s) => s.toLowerCase().replace(/\s+/g, " ")),
  types: z.string().optional()                   // csv of SearchType; default: all allowed for the path
    .transform((s) => (s ? s.split(",") : undefined)).pipe(z.array(SearchType).max(6).optional()),
  limit: z.coerce.number().int().min(1).max(10).default(4),
});
export const SearchResult = z.object({
  type: SearchType, ref: z.string().max(80), title: z.string().max(120),
  subtitle: z.string().max(160), href: z.string().startsWith("/").max(200),
  fen: z.string().max(100).optional(),            // catalogue positions only (thumb)
});
export const SearchResponse = z.object({ results: z.array(SearchResult).max(30) });
// /api/search: 400 validation_failed (q length, unknown type, "game" requested) · /api/me/search: + 401 unauthorized, 429 rate_limited

// CT/http/return-target.ts
export const ReturnTargetQuery = z.object({ path: z.string().min(1).max(512) });
export const ReturnTarget = z.object({
  kind: z.enum(["legend_position", "legend", "opening", "challenge", "page"]),   // D23: no "game", no "tournament"
  label: z.string().max(80),                      // "Kasparov vs Topalov"
  detail: z.string().max(120).optional(),         // "Wijk aan Zee 1999 · White to move after 23…Qd6"
  verb: z.enum(["play", "open", "review", "join"]),
  fen: z.string().max(100).optional(),            // only for legend_position, opening and challenge
  orientation: z.enum(["white", "black"]).optional(),
});
// 200 { data: ReturnTarget } | 204 (unsafe or unknown path); never 4xx for an unsafe path (no oracle)

// CT/http/contact.ts
export const ContactTopic = z.enum(["billing", "importing", "coach", "bug", "other"]);
export const ContactRequest = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().toLowerCase().email().max(254),
  topic: ContactTopic,
  message: z.string().trim().min(10).max(5000),
  website: z.string().max(200).optional(),        // honeypot; must be empty
  context: z.object({ path: z.string().startsWith("/").max(200).optional(),
                      ref: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).optional() }).optional(),
});
export const ContactResponse = z.object({ reference: z.string().regex(/^RC-\d{5,}$/) });
// 202 { data } · 400 validation_failed + fields{name|email|topic|message} · 403 forbidden (BotID) ·
// 413 payload_too_large · 422 idempotency_key_reused · 429 rate_limited (+retryAfterSec)

// CT/http/consent.ts
export const ConsentV1 = z.object({ v: z.literal(1), analytics: z.boolean(), replay: z.boolean(),
  marketing: z.boolean(), at: z.string().datetime(), source: z.enum(["banner", "settings"]) });
export const ConsentRequest = z.object({
  v: z.literal(1),
  analytics: z.boolean(), replay: z.boolean(), marketing: z.boolean(),
  method: z.enum(["accept_all", "reject", "save"]),
  source: z.enum(["banner", "settings"]),
  anonId: z.string().regex(/^[A-Za-z0-9_-]{16}$/).optional(),   // from the cookie when signed out
});
export const ConsentResponse = z.object({ consent: ConsentV1.nullable() });   // PUT and GET
// PUT 200 + Set-Cookie: rc_consent=v1:<a>:<r>:<m>:<unixSec>:<anonId>; Max-Age=31536000; Path=/; SameSite=Lax; Secure
// 400 validation_failed · 429 rate_limited

// CT/http/feedback.ts
export const FeedbackRequest = z.object({
  eventId: z.string().regex(/^[0-9a-f]{32}$/).optional(),
  message: z.string().trim().max(2000).default(""),
  path: z.string().startsWith("/").max(200),
});
// 204 · 400 · 429

// CT/http/system.ts (P1 file: HealthData stays as P1 wrote it; P11 appends)
export const NoticeArea = z.enum(["all", "online", "coach", "import"]);
export const SystemNoticeV1 = z.object({
  v: z.literal(1),
  id: z.string().max(40),                         // "2026-11-20-db-move"
  mode: z.enum(["scheduled", "active", "resolved"]),
  startsAt: z.string().datetime(), endsAt: z.string().datetime(),
  message: z.string().max(200),                   // "We're moving games to faster servers."
  affects: z.array(NoticeArea).min(1),
  statusUrl: z.string().url().optional(),
});
export const NoticeResponse = z.object({ notice: SystemNoticeV1.nullable() });
// 503 maintenance body: details { retryAt: ISO, notice: SystemNoticeV1 } (P1 reserved `retryAt`)

// CT/limits.ts (D22; created here if P7 has not): COACH_LIMITS = { member: { perDay: 30, perMonth: 150 }, trial: { perDay: 10, perTrial: 40 } }
```

```ts
// CT/socket/system.ts (registered in P2's CT/socket/registry.ts as "system:notice", server → client, broadcast)
export const SystemNoticeEvent = SystemNoticeV1.nullable();          // null = cleared
// CT/internal/broadcast.ts (P2 file, extended by P11)
export const BroadcastBody = z.discriminatedUnion("type", [
  z.object({ v: z.literal(1), type: z.literal("restart"), inSeconds: z.number().int().min(5).max(600) }),  // P2
  z.object({ v: z.literal(1), type: z.literal("notice"), notice: SystemNoticeV1.nullable() }),             // P11
]);
// Socket ack code added by P11 to P2's ack list: "maintenance" (queue:join, tournament:find_match, challenge accept during an online window)
```

### 7.3 Route behaviour

**A1 / A1m search** (`app/api/search/route.ts`, `app/api/me/search/route.ts`, both thin; logic in `lib/data/search.ts`)

```ts
// app/api/search/route.ts
export const GET = route({ id: "search.public", auth: "public", query: SearchQuery, cache: "public-static",
  publicStatic: { sMaxAge: 300, swr: 86400, tags: ["catalog"] } },
  async ({ query }) => ({ results: await searchCatalog(query, { member: null }) }));

// app/api/me/search/route.ts
export const GET = route({ id: "search.me", auth: "user", query: SearchQuery,
  rateLimit: { bucket: "search-user", limit: 60, windowSec: 60, by: "user" } },
  async ({ query, viewer }) => ({ results: await searchCatalog(query, { member: viewer }) }));

// lib/data/search.ts
export async function searchCatalog(q: SearchQuery, { member }: { member: Viewer | null }) {
  const types = allowedTypes(q.types, !!member);                  // "game" only with a member
  const [legends, positions, openings, games] = await Promise.all([
    types.has("legend")   ? getLegendCards() : [],               // P8 unstable_cache, tag legends (51 rows)
    types.has("position") ? listPracticePositions() : [],        // P8 unstable_cache, tag positions (≤ 30 featured)
    types.has("opening")  ? searchOpenings(q.q, undefined) : [], // P8 unstable_cache keyed on the normalised q
    types.has("game") && member ? searchMyGames(member.id, q.q, q.limit) : [],
  ]);
  return rank(q.q, [searchStaticIndex(q.q, types), filterLegends(legends, q.q), filterPositions(positions, q.q),
                    openings, games], q.limit);                  // §8.10
}
```

- The public route reads no cookies and is excluded from the middleware matcher, so a CDN MISS runs no edge middleware and a cached response can never vary by user (api-perf AP-03). P1's wrapper already refuses `public-static` with any auth other than `public`.
- No DB limiter on the public route: a MISS costs at most one `searchOpenings` statement, and a limiter upsert would cost as much as the work it protects. The Firewall rule caps a scraper at 60/min per IP.
- The palette (P1 `CommandPalette.tsx`) and the in-shell 404 call `/api/me/search`; the static root 404 and signed-out visitors call `/api/search`.

**A2 `GET /api/return-target`** (`app/api/return-target/route.ts`; created here if P4 did not, §2.3). The handler normalises `path` (drops `?…` and `#…` before resolving, so the CDN key and the answer agree), runs `safeReturnPath()` (§8.2) → `null` → 204, else `resolveReturnTarget()` (§8.3) → 200 or 204. Private resources get fixed labels without a lookup (D23). Clients call it with the normalised pathname only, so repeated destinations share one CDN entry.

**A3 `POST /api/contact`** (`app/api/contact/route.ts`, `lib/support/contact.server.ts`)

1. `route({ id: "contact.create", auth: "optional", body: ContactRequest, maxBodyBytes: 16_384, idempotent: true, rateLimit: { bucket: "contact-burst", limit: 2, windowSec: 60, by: "ip" } })`. The idempotency key scope is `<viewer.ref | "anon:" + ipHash16>:contact:<uuid>` in P2's `idempotency_keys`.
2. `const { isBot } = await checkBotId()` (package `botid`; the client `initBotId({ protect: [{ path: "/api/contact", method: "POST" }] })` lives in `instrumentation-client.ts`). `isBot` → 403 `forbidden` "Your message didn't send." (no detail).
3. Durable limits, one statement on `support_requests_createdAt_idx` (§6.3): `by_ip ≥ 5` or `by_email ≥ 3` in the last hour → 429 `rate_limited`, `retryAfterSec` = seconds until the oldest counted row is an hour old. SPAM rows count too, so a bot that fills the honeypot limits itself.
4. Honeypot `website` non-empty → insert with `status: SPAM`, return 202 with a real-looking reference, send nothing.
5. `INSERT support_requests (… status RECEIVED, context: { v:1, path, ref, appEnv, deviceClass }, "ipHash", "userId": viewer?.id ?? null) RETURNING id` → `reference = "RC-" + (20000n + id)`.
6. Response 202 `{ data: { reference } }`.
7. `after()`: daily send budget check (§9.5: count of rows `SENT` today, one statement on the same index); then `sendEmail({ to: SUPPORT_INBOX, replyTo: email, subject: "[RC-…] <Topic>: <first 60 chars>", text })` and, while today's count is under 20, the acknowledgement `sendEmail({ to: email, subject: "We got your message (RC-…)", text })` through `lib/email/send.ts` (Resend REST, `AbortSignal.timeout(8000)`); success → `UPDATE … SET status='SENT', "emailId"=$id, "sentAt"=now(), attempts=attempts+1`; failure → `status='FAILED', "lastError"=<code>, attempts=attempts+1` + `Sentry.captureException` (no body content). `CONTACT_EMAIL_DRY_RUN=1` (non-production only, test-hook registry) skips the send and marks SENT.
8. Email bodies are plain text only, subjects have CR/LF stripped, and `replyTo` is the zod-validated address.

**A4 `PUT /api/consent`** and **A4g `GET /api/consent`** (`app/api/consent/route.ts`, `lib/data/consent.server.ts`)

1. PUT: `route({ id: "consent.put", auth: "optional", body: ConsentRequest, maxBodyBytes: 1024, rateLimit: { bucket: "consent-burst", limit: 10, windowSec: 60, by: "ip" } })`.
2. `anonId` = body value, else from the existing cookie, else a new `nanoid(16)` (signed-out only).
3. Proof: signed in → `INSERT consent_records ("userId", version 'v1', …, method, source, country)` and `INSERT INTO user_settings … ON CONFLICT ("userId") DO UPDATE SET consent = EXCLUDED.consent` in one `$transaction([…])` batch; signed out → insert only when any category is `true` (D7).
4. `Set-Cookie: rc_consent=v1:<a>:<r>:<m>:<unixSec>:<anonId>` (`Max-Age=31536000; Path=/; SameSite=Lax; Secure`; not HttpOnly, the client reads it).
5. Response `{ data: { consent } }`; `after()` records the Sentry metric `consent.choice{method}` (no ids).
6. GET: `route({ id: "consent.get", auth: "optional" })` → signed out `{ consent: null }` with no DB work; signed in → `SELECT consent FROM user_settings WHERE "userId" = $1` (PK). Called by `ConsentRoot` only when `rc_consent` is missing and `useAuthHint().signedIn`.

**A5 `POST /api/feedback`**: `route({ id: "feedback.create", auth: "optional", body: FeedbackRequest, maxBodyBytes: 8192, rateLimit: { bucket: "feedback-burst", limit: 3, windowSec: 60, by: "user+ip" } })` → `Sentry.captureFeedback({ message, associatedEventId: eventId, url: path, name: viewer?.ref })` server-side; 204. No DB row: api-design SYS-5's `AdminActivity` write is dropped (that table does not exist, consistency R-02), and `optional` replaces SYS-5's `user` because signed-out marketing visitors hit 500s too.

**A6 `GET /api/system/notice`** (`app/api/system/notice/route.ts`): `getNotice()` from `lib/system/notice.server.ts` (Edge Config `get("notice")` through `getOps()`, parsed with `SystemNoticeV1.safeParse`, adaptive memo D10, env fallback). Returns `{ data: { notice } }`; `notice` is `null` when absent, invalid, or `resolved` more than 10 minutes ago. The socket server calls it once at boot (`WEB_APP_URL` + this path) to restore the current notice after a restart.

**A7 `GET /api/health`** (P1): `{ data: { ok: true, buildId, env, time } }` where `buildId` is `NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA` (P1 §7.9). No DB call by default; excluded from middleware and from the SW (`NetworkOnly`).

**Maintenance gate in the route wrapper** (the only P11 edit to P1's `lib/api/route.ts`, as step 3a after auth): every route spec may declare `area?: "all" | "online" | "coach" | "import"` (default `"all"`); exempt ids: `webhook.*`, `internal.*`, `cron.*`, `health.get`, `system.notice`, `consent.*`, `contact.create`, `feedback.create`, `returnTarget.get`, `search.*`. When `notice.mode === "active"`, `notice.affects` includes `"all"` or the route's area, and the viewer's DB role is not admin → `503 { error: { code: "maintenance", message: "ReplayChess is getting an upgrade.", retryAfterSec, details: { retryAt, notice } } }` + `Retry-After: max(60, seconds to endsAt)`. The notice comes from the same memoised `getOps()` (Node runtime, one Edge Config read per instance per memo window).

### 7.4 Middleware (`WEB/middleware.ts`; rule bodies in `lib/auth/access-rules.ts`, `lib/system/maintenance-gate.ts`, `lib/routes/scanner.ts`; route classes as data in `lib/routes/classes/{marketing,auth,system}.ts` if P1 adopted the registry directories of feasibility §7)

1. **Matcher exclusions** (no edge run at all): `_next`, static files, `ingest`, `monitoring`, `og`, `workers`, `sw.js`, `swe-worker-*`, `workbox-*`, `manifest.json`, `robots.txt`, `sitemap*.xml`, `llms.txt`, `/api/health`, `/api/system/notice`, `/api/search`, `/api/return-target`, and the **static marketing documents**: `/` (the matcher pattern requires at least one path character), `/about`, `/help`, `/contact`, `/terms`, `/privacy`, `/cookies`, `/licenses`, `/blog/*`, `/press`, `/careers`, `/community`, `/how-we-grade`, `/offline`, `/maintenance`. `/pricing` is excluded too: its signed-in state comes from clerk-js on the client, never from server `auth()`. `/api/webhook/*`, `/api/internal/*`, `/api/cron/*` stay in the matcher but return before any Clerk work (as `middleware.ts:29-31` does today for Dodo).
2. **Scanner early-return** (`lib/routes/scanner.ts`, before Clerk): `/\.(php|env|git|aspx?|bak|sql)$|^\/(wp-|\.well-known\/(?!security\.txt|apple-app-site-association))|^\/(cgi-bin|vendor|phpmyadmin)\b/i` → `new Response(null, { status: 404, headers: { "Cache-Control": "public, max-age=3600" } })`. Probes cost one edge run and no Clerk work (api-perf AP-33). A matching Vercel Firewall rule is added if one of the 3 Hobby custom rules is free (§7.8).
3. **Maintenance gate** (`maintenanceGate(req, claims)`): document requests only (`sec-fetch-dest: document`, or `accept` contains `text/html`) to `(app)`, onboarding and checkout routes; `notice.mode === "active"` + `affects` includes `"all"` + `claims.md.role !== "ADMIN"` → `NextResponse.rewrite(new URL("/maintenance", req.url), { status: 503, headers: { "Retry-After": s, "Cache-Control": "no-store", "x-rc-maintenance": "1", "X-Robots-Tag": "noindex" } })`. Marketing, legal, auth, `/offline` and `/maintenance` stay up. Only this branch reads Edge Config in middleware (memo D10).
4. **Auth kill switch** (`auth-v3`) is **not** in middleware: `app/(auth)/sign-in/page.tsx` and `sign-up/page.tsx` read `getOps().flags.auth_custom_flows` and, when it is `false`, render the prebuilt `<SignIn routing="path" path="/sign-in" />` / `<SignUp routing="path" path="/sign-up" />` inside the same `AuthShell`.
5. **Auth-page rule** (`authPageRule(req, auth)`): signed in on `/sign-in`, `/sign-up` (exact paths; not `/sign-up/verify`, not `/sign-in/factor-*`) → 307 to `safeReturnPath(redirect_url)` if allowed, else `md.onboarded ? (md.entitled ? "/home" : "/pricing") : "/onboarding"`.
6. **P1 matrix** (unchanged): signed-out → `redirectToSignIn({ returnBackUrl })`, onboarding redirect, paywall redirect, admin.
7. **Public allow-list additions** (paths still inside the matcher): `/sign-in(.*)`, `/sign-up(.*)`, `/reset-password`, `/sso-callback`, `/too-many-requests`, `/p/(.*)` (P10), `/api/contact`, `/api/consent`, `/api/feedback` (these three read an optional viewer, so they stay inside the matcher).
8. **Response headers** for noindex routes are not set from pages (an RSC page cannot set response headers, api-perf AP-14): `X-Robots-Tag: noindex` comes from `next.config.js` `headers()` for `/sign-in/:path*`, `/sign-up/:path*`, `/reset-password`, `/sso-callback`, `/offline`, `/maintenance`, `/too-many-requests`, `/dev/:path*`, and for **every path when `APP_ENV !== "production"`** (the dev site must never be indexed, feasibility SEC-3). Pages also set `metadata.robots`.

### 7.5 Socket server (`WS`; P2 owns the files, P11 adds two small pieces)

| Item | Detail |
|---|---|
| `POST /internal/broadcast` `type:"notice"` | In P2's `WS/src/http/broadcast.ts`: parse `BroadcastBody`; `notice` → keep `currentNotice` in memory and `io.emit("system:notice", notice)` to every socket (including `ent=false` user-room-only sockets). Auth and Caddy rules unchanged (P2: `x-internal-token`, blocked from outside, reached through `docker compose exec`). 202 `{ ok: true, sockets }`. |
| Boot restore | On start, `WS/src/system/notice.ts` fetches `${WEB_APP_URL}/api/system/notice` once (CDN-cached, no secret) to fill `currentNotice`, so a restart during a window keeps refusing pairings. Failure → `null`, logged. |
| Maintenance refusal | While `currentNotice.mode === "active"` and `affects` includes `"all"` or `"online"`: `queue:join` (P9), `tournament:find_match` (P12) and challenge accept (P9) ack `{ ok: false, code: "maintenance", retryAt }`; running games, reconnects and game commands are untouched. The P9/P12 clients map the code to the shell toast "Online play is paused for maintenance. Back around 14:00 UTC." |
| `system:notice` client effect | `setQueryData(qk.system.notice(), notice)` (client-data-layer §5.6); on every socket `connect` the client invalidates `qk.system.notice()` (a CDN-cached GET), so a tab that missed the broadcast catches up. |
| `server:restarting` | **P2's** event and chip (`InGameChips.tsx` with P1's `InGameStatusChip`), payload `{ restartAt, resumes: true }`. P11 only verifies its copy against `V3Maintenance` `in_game`. |
| Deploy pre-announce | **P2's** `deploy-oci.yml` step (broadcast `restart` → wait → `up -d`). P11 does not edit `deploy-oci.yml`. |
| Ops path | `scripts/system/notice.ts` (owner laptop) writes Edge Config through the Vercel API, then runs `gh workflow run ops-broadcast.yml -f target=dev -f body=<json>`. The new `REPO/.github/workflows/ops-broadcast.yml` (`workflow_dispatch` only) reuses the deploy secrets (`OCI_DEV_HOST`, the deploy key) and runs the same `docker compose exec websocket wget … /internal/broadcast` line P2's deploy step uses, with `x-internal-token: $INTERNAL_API_SECRET` expanded inside the container. `--via ssh` does the same over `ssh -i ~/.ssh/oci_deploy` for an emergency without GitHub. |

### 7.6 Service worker (`WEB/next.config.js:13-35` + `WEB/worker/*`)

```js
const KILL = process.env.SW_KILL_SWITCH === "1";            // emergency build, §14.3
const withPWA = withPWAInit({
  dest: "public",
  register: true,
  disable: process.env.NODE_ENV === "development",
  cacheOnFrontEndNav: false,
  aggressiveFrontEndNavCaching: false,
  reloadOnOnline: false,
  cacheStartUrl: false,
  customWorkerSrc: KILL ? "worker-kill" : "worker",       // worker/index.ts (P10 entry) or worker-kill/index.ts
  fallbacks: KILL ? undefined : { document: "/offline" },
  extendDefaultRuntimeCaching: false,
  publicExcludes: ["!**/*", "fonts/**/*", "chess-icons/*.png", "board_icons/svg/*.svg",
                   "icons/icon-192x192.png", "icons/icon-512x512.png", "icons/icon-maskable-512.png"],
  workboxOptions: {
    skipWaiting: KILL, clientsClaim: KILL,
    exclude: [/\.wasm$/, /\/admin\//, /\.map$/, /board_icons\/(256x|1024x)\//, /\.ps1$/],
    // Precache only the shell: framework/main/webpack chunks, the root and (system) layouts, /offline and /maintenance.
    manifestTransforms: [keepOnly(KILL ? [] : PRECACHE_KEEP)],
    // PRECACHE_KEEP = [/\/_next\/static\/chunks\/(framework|main|webpack|polyfills)/, /app\/layout-/, /app\/\(system\)\//, /\/_next\/static\/css\//, /\/_next\/static\/media\/.*\.woff2$/]
    additionalManifestEntries: KILL ? [] : [{ url: "/offline", revision: BUILD_SHA }, { url: "/maintenance", revision: BUILD_SHA }],
    runtimeCaching: KILL ? [] : [
      { urlPattern: ({ url }) => url.pathname.startsWith("/api/") || url.pathname.startsWith("/monitoring") || url.pathname.startsWith("/ingest"), handler: "NetworkOnly" },
      { urlPattern: ({ request, url }) => request.headers.get("RSC") === "1" || url.searchParams.has("_rsc"), handler: "NetworkOnly" },
      { urlPattern: /\/workers\/stockfish-[0-9a-f]{8}\.(js|wasm)$/, handler: "CacheFirst",
        options: { cacheName: "rc-engine", expiration: { maxEntries: 4 } } },
      { urlPattern: /\/_next\/static\//, handler: "CacheFirst", options: { cacheName: "rc-static", expiration: { maxEntries: 200 } } },
      { urlPattern: /\/sounds\//, handler: "CacheFirst", options: { cacheName: "rc-assets", expiration: { maxEntries: 20 } } },
      // the offline allow-list is registered in worker/pages.ts (per-user cache names cannot be static here)
      { urlPattern: ({ request, url }) => request.mode === "navigate" && isPublicDocument(url.pathname),
        handler: "StaleWhileRevalidate", options: { cacheName: "rc-public", expiration: { maxEntries: 30, maxAgeSeconds: 7 * 86400 } } },
    ],
  },
});
// isPublicDocument = /, /pricing, /how-we-grade, /about, /help, /contact, /terms, /privacy, /cookies, /licenses, /blog/**, /legends/**, /openings/**, /learn/** (public pages only)
```

`worker/index.ts` (created by P10 with `./push`) gains these imports:

| Module | Behaviour |
|---|---|
| `./user` | Current user ref, persisted in Cache Storage (`rc-meta` → `/__rc/user`, JSON `{ ref }`) because SW globals die when the worker is stopped. Set by `message {type:"SET_USER", ref}` (posted by `lib/pwa/sw-user.ts`: the viewer's ref from the `(app)` layout on every boot; `null` from every auth page on mount, after `setActive` in `lib/auth/clerk-flows.ts`, and from `signOutEverywhere()`). When the ref changes, every other `rc-pages:u:*` cache is deleted. Where `self.cookieStore` exists (Chromium), a navigation also checks `__client_uat`; `0` or missing → treated as no user. A SW cannot read the `Cookie` request header (forbidden header), so the message is the primary signal. |
| `./pages` | `registerRoute(({ request, url }) => request.mode === "navigate" && OFFLINE_ALLOW.includes(url.pathname), handler)`: no current user → plain `fetch` (never cached); else a `NetworkFirst` per ref (`cacheName: "rc-pages:u:" + ref`, `networkTimeoutSeconds: 4`, `matchOptions: { ignoreSearch: true }` so `/play?tab=bot` hits the cached `/play`, plugins `[maintenanceAsFailure]`). `OFFLINE_ALLOW = ["/train/bank", "/train/bank/session", "/play"]`. |
| `./update` | `message SKIP_WAITING` → `self.skipWaiting()` |
| `./purge` | `message PURGE_USER` → delete every `rc-pages:u:*` cache and `/__rc/user` |
| `./maintenance` | `maintenanceAsFailure` plugin: `fetchDidSucceed` throws when `response.status === 503 && response.headers.get("x-rc-maintenance") === "1"`, so `NetworkFirst` serves the user's cached allow-listed page during maintenance and never overwrites it with the maintenance HTML |
| `./sync` | Background Sync tag `rc-outbox` → `clients.matchAll()` → `postMessage({ type: "FLUSH_OUTBOX" })` |
| `./push` | P10's handlers (`push`, `notificationclick`), unchanged |

`worker-kill/index.ts` (the emergency build): `install` → `skipWaiting()`; `activate` → delete every cache, `self.registration.unregister()`, then `clients.matchAll({ type: "window" })` → `client.navigate(client.url)`. `/sw.js` and `swe-worker-*.js` are served with `Cache-Control: no-cache` (`next.config.js` `headers()`), so browsers pick up a new worker on their next navigation. Runbook: `docs/runbooks/rollback.md` §"Service worker".

`next.config.js:158-167` headers: `/workers/stockfish-:hash.(js|wasm)` → `public, max-age=31536000, immutable`; everything else under `/workers/*` keeps `max-age=0, must-revalidate`.

### 7.7 Webhooks, cron, background jobs

| Item | Change |
|---|---|
| `account_created` server event | Moves into `provisionUser()` (P1 `lib/auth/viewer.ts`), emitted in `after()` **only when the `INSERT … ON CONFLICT DO NOTHING RETURNING id` actually created the row**, so the Clerk webhook and the first `GET /api/me` (architecture §5.10 race) produce it exactly once. Properties `{ method: "password" \| "google" \| "apple", signup_source }`, `distinct_id = referenceId`, registry flag `consentExempt: true` (Q10). The Clerk webhook (P1 file, edited by P10) keeps copying `unsafeMetadata.signupSource` (allowlisted, ≤ 200 chars) into `User.signupSource` (P4). |
| Clerk session token template (dev instance; P13 prod) | `{ "md": "{{user.public_metadata}}", "ini": "{{user.first_name}}", "usn": "{{user.username}}" }` (P1 set `md`; P11 adds `ini`, `usn`; the cookie stays far under Clerk's 1.2 KB guidance) |
| `GET /api/cron/daily` | new task files `lib/cron/tasks/support.ts` (`supportRetry`: FAILED, attempts < 3, last 24 h, ≤ 20 rows, inside the daily send budget; `supportPrune`: older than 180 days) and `lib/cron/tasks/consent.ts` (`consentPrune`: older than 24 months), appended to the ordered task array; each task is idempotent and logs counts in the JSON response |
| OCI worker | nothing new |

### 7.8 Third-party integrations

| Service | Use in P11 | Setup (dev) | Notes |
|---|---|---|---|
| Clerk (dev instance, replaychess007) | custom flows; email+password, email code verification, Google OAuth; bot protection (Smart CAPTCHA, needs `#clerk-captcha`); user lockout; session token claims; paths `/sign-in`, `/sign-up` | dashboard via ego-browser: Paths → sign-in `/sign-in`, sign-up `/sign-up`, after sign-in `/home`, after sign-up `/onboarding`; Email verification "code"; Attack protection on; Google OAuth dev credentials (already used) | Apple off (Q4); enumeration protection per Q9; dev-instance user cap checked by the e2e sweeper (testing X4) |
| Resend | contact support copy + acknowledgement | API key in `replay-chess-dev` env; dev sender `onboarding@resend.dev` (the sandbox can email only the account owner, so the ack reaches only replaychess007@gmail.com on dev) | free tier 100/day shared with P10's emails: P11's own daily budget §9.5; domain `playchess.tech` verification is a P13 owner action |
| Vercel BotID | `checkBotId()` on `/api/contact` | `initBotId` client call; package already a dependency | basic mode on Hobby |
| Vercel Edge Config | `replay-ops` store: `notice`, `flags.auth_custom_flows` | create the store on the replaychess007 account, connect it to `replay-chess-dev` (adds `EDGE_CONFIG`) | Hobby: **100k reads and 100 writes a month** (verified, feasibility §1); adaptive memo D10; read counter in the weekly ops report (§9.5) |
| Vercel Firewall | the 3 Hobby custom rules: (1) `/api/search` + `/api/return-target` 60/min per IP; (2) `/sign-*` documents 30/min per IP → challenge; (3) scanner paths (§7.4 step 2) → deny, or `/og` 60/min per IP if P8 already uses a rule for it | dashboard | api-design §2.10 layer 1; if P1 already spent a rule, the scanner rule stays in middleware only |
| Vercel Authentication on `replay-chess-dev` (if P1 turns it on, feasibility SEC-3) | Lighthouse CI, k6 and the dev-URL Playwright smoke send `x-vercel-protection-bypass: $VERCEL_AUTOMATION_BYPASS_SECRET` | secret in GitHub Actions only | — |
| Sentry | `captureFeedback`, lazy Replay, `tracesSampler`, `sendDefaultPii:false`, CSP report endpoint | existing project `replay-chess-web` | tunnel `/monitoring` |
| PostHog | lazy client after consent; server events from `after()` | existing key | `/ingest` proxy; `advanced_disable_feature_flags: true` (flags come from `qk.me().flags`, P1-12) |
| Speed Insights | CWV field data for the SLOs (D21) | `<SpeedInsights sampleRate={0.2}/>` | cookieless; 10,000 events per 30 days on Hobby |
| Google Analytics | **removed** | delete `NEXT_PUBLIC_GA_MEASUREMENT_ID` | D6 |
| Status page | link target only | `NEXT_PUBLIC_STATUS_URL` empty → links hidden | Q3 |

### 7.9 Environment variables

| Variable | Where | Value (dev) | Read by |
|---|---|---|---|
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL`, `NEXT_PUBLIC_CLERK_SIGN_UP_URL` | Vercel `replay-chess-dev`, `.env.development.local`, `.env.test` | `/sign-in`, `/sign-up` | Clerk SDK |
| `NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL`, `NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL` | same | `/home`, `/onboarding` | Clerk SDK |
| `NEXT_PUBLIC_AUTH_APPLE` | same | `off` | `OAuthButtons` |
| `RESEND_API_KEY` | Vercel (Sensitive) | dev key | `lib/email/send.ts` |
| `EMAIL_FROM` | Vercel | `ReplayChess <onboarding@resend.dev>` (prod `ReplayChess <hello@playchess.tech>`) | same |
| `SUPPORT_INBOX` | Vercel | `replaychess007@gmail.com` (prod `hello@playchess.tech`, forwarded by Cloudflare Email Routing) | contact |
| `CONTACT_EMAIL_DRY_RUN` | CI, `.env.test` (test-hook registry; ignored when `APP_ENV=production`) | `1` | contact |
| `EDGE_CONFIG` | Vercel (added by the Edge Config connection) | connection string | `@vercel/edge-config` |
| `MAINTENANCE_MODE`, `MAINTENANCE_ENDS_AT` | Vercel | `off`, empty | `notice.server.ts` fallback |
| `MAINTENANCE_SOURCE` | Vercel | `edge` (`env` = read only the fallback; the switch if Edge Config reads near the quota, §9.5) | `getOps()` |
| `OPS_OVERRIDE` | CI and local e2e only (test-hook registry; ignored unless `isNonProd()`) | JSON, e.g. `{"flags":{"auth_custom_flows":false}}` | `getOps()` |
| `NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA` (P1, system env) | Vercel | — | update check, Sentry `release` |
| `NEXT_PUBLIC_SITE_URL` (consistency R-09) | Vercel | the dev URL | canonical URLs, sitemap, OG |
| `NEXT_PUBLIC_STATUS_URL` | Vercel | empty | maintenance, 500 |
| `NEXT_PUBLIC_CONSENT_BAR` | Vercel | `on` | `ConsentRoot` (D15) |
| `RATE_LIMIT_IP_PEPPER` (P1) | Vercel | — | `support_requests."ipHash"`, limiter keys |
| `SW_KILL_SWITCH` | build env, emergency only | unset | `next.config.js` (§7.6) |
| `VERCEL_API_TOKEN`, `EDGE_CONFIG_ID` | owner laptop / GitHub Actions only | — | `scripts/system/notice.ts` |
| `INTERNAL_API_SECRET` (P2, socket env file) | OCI `.env`, never on the laptop | — | `/internal/broadcast` (expanded inside the container by `ops-broadcast.yml`) |
| `WEB_APP_URL` (socket, R-09) | OCI `.env` | the dev URL | boot notice fetch |
| removed: `NEXT_PUBLIC_GA_MEASUREMENT_ID` | Vercel, `turbo.json` | — | — |

All new names go into `REPO/turbo.json` `globalEnv` (audit-quality B-03). The CI check that no `NEXT_PUBLIC_*` name contains `SECRET|TOKEN|KEY` (architecture §3.2.3) passes (`NEXT_PUBLIC_POSTHOG_KEY` and the Clerk publishable key are on its allowlist already).

### 7.10 Feature flags and kill switches

| Name | Kind | Default dev | Default prod (P13) | Effect off |
|---|---|---|---|---|
| `auth-v3` → Edge Config `flags.auth_custom_flows` | kill switch (≤ 300 s to take effect, the memo) | on | on | `/sign-in` and `/sign-up` render the prebuilt Clerk components inside `AuthShell` (§7.4 step 4); return banners stay (server-rendered), custom error states disappear, verify/reset run inside the prebuilt flow |
| `consent` → env `NEXT_PUBLIC_CONSENT_BAR` | deploy-scoped switch (a redeploy, ≈ 2 min) | on | on | the bar never shows **and analytics stay off** (fail closed: nobody consents) |
| `public-v3` | deploy-scoped (D15) | always on | always on | not a runtime switch; the old marketing pages remain live on `main` until P13 and are deleted from `dev` in this phase after the parity check |
| `NEXT_PUBLIC_AUTH_APPLE` | env | off | Q4 | Apple button hidden |
| `MAINTENANCE_MODE`, `MAINTENANCE_SOURCE` | env (fallback) | off, `edge` | off, `edge` | — |
| `SW_KILL_SWITCH` | build-time emergency | unset | unset | §14.3 |

---
## 8. Domain logic

### 8.1 Pricing state (`lib/billing/pricing-state.ts`, pure, unit-tested)

```ts
type Base = "logged_out" | "logged_in" | "trial_used" | "member" | "legacy";
type BannerKind = null | "required" | "checkout_failed" | "payment_issue" | "ended" | "already_member";
export function derivePricingState(i: {
  signedIn: boolean; me: Viewer | null; meStatus: "idle" | "loading" | "error" | "success";
  query: { reason?: string; checkout?: string; status?: string; plan?: string };
}): { base: Base; banner: BannerKind; plan: "monthly" | "yearly"; resolving: boolean }
```

| Input | `base` | `banner` |
|---|---|---|
| not signed in | `logged_out` | `required` if `reason=required`; `checkout_failed` if `checkout=failed` or `status=failed`; `ended` never (needs a session) |
| signed in, `me` loading | previous or `logged_out`, `resolving: true` (CTA skeleton) | as above |
| signed in, `me` error | `logged_out` CTA (never claim "member" on error, CDL §6.2 rule 2) | as above |
| `me.entitlement.planKey === "legacy"` and entitled | `legacy` | `payment_issue` if `paymentIssue` |
| entitled (`state ∈ member, trial, grace, cancelling`) | `member` | `already_member` if `reason=required\|ended` (stale 402), `payment_issue` if `paymentIssue` |
| not entitled, `trial.eligible === false` | `trial_used` | `ended` if `state === "lapsed"` or `reason=ended`; `required` if `reason=required`; `checkout_failed` |
| not entitled, `trial.eligible === true` | `logged_in` | `required`; `checkout_failed` |

`plan` = `query.plan` if valid, else the design default **monthly** (the e2e spec `pricing.spec.ts:9` changes from yearly; if P4 decided otherwise for the onboarding plan step, both use the same constant `DEFAULT_PLAN` in `lib/billing/plans.ts`). Admin and `BILLING_PAYWALL=off` map to `member`.

### 8.2 `safeReturnPath(raw)` (`lib/navigation/return-to.ts`, P4's file, hardened by WP-C)

Returns a same-origin app path or `null`. P4 and P9 already call it; WP-C keeps the signature and replaces the body with these rules (R15 if the file is missing):

1. `typeof raw === "string"`, length 1–512 after one `decodeURIComponent` (a second decode is not attempted; a `%25` sequence after the first decode → reject).
2. Must start with exactly one `/`; reject `//`, `/\`, `\`, any ASCII control character or whitespace (`/[\u0000-\u001f\u007f\s]/`), `@` before the first `/` segment boundary, and any `:` before the first `/` after position 0.
3. `new URL(raw, "https://rc.invalid")` must keep origin `https://rc.invalid` (catches tab/backslash tricks the browser normalises).
4. The pathname must start with an allowlisted prefix: `/home`, `/play`, `/queue`, `/game`, `/review`, `/games`, `/train`, `/learn`, `/legends`, `/openings`, `/profile`, `/u/`, `/@`, `/settings`, `/tournaments`, `/t/`, `/join`, `/s/`, `/r/`, `/p/`, `/challenge`, `/coach`, `/pricing`, `/onboarding`, `/checkout`, `/help`, `/blog`; never `/api`, `/sign-in`, `/sign-up`, `/reset-password`, `/sso-callback`, `/dev`, `/admin` (admin is reached through the shell).
5. Strip `checkout`, `status`, `subscription_id`, `email`, `redirect_url` query params (no nesting); return `pathname + search + hash`.

`lib/billing/return-url.ts` `isAllowedReturnPath` delegates to it, so checkout return URLs and auth return URLs share one rule.

### 8.3 `resolveReturnTarget(path)` (server, cached; D23)

The input is the normalised pathname (query and hash dropped). Only public catalogue rows and P9's public challenge preview are looked up; everything private gets a fixed label with no lookup and no FEN, so the public, CDN-cached `GET /api/return-target` can never reveal whether a private resource exists or what it contains (api-perf AP-29).

| Path pattern | Result | Source |
|---|---|---|
| `/play/legend/<slug>`, `/legends/positions/<slug>` | `{ kind:"legend_position", verb:"play", label:"<White> vs <Black>", detail:"<Event> <year> · <Side> to move after <lastSAN>", fen, orientation: sideToMove }` | P8 `getPosition(slug)` (`unstable_cache`, tags `positions`, `position:<slug>`) |
| `/legends/<slug>` | `{ kind:"legend", verb:"open", label:"<Legend name>" }` | P8 `getLegendDetail(slug)` |
| `/openings/<slug>` | `{ kind:"opening", verb:"open", label:"<ECO> <Name>", fen }` | P8 `getOpeningDetail(slug)` |
| `/join/<code>`, `/s/<code>` | P9's entries: `{ kind:"challenge", verb:"join", label:"Accept martin_k's challenge", fen, orientation }` / `{ kind:"challenge", verb:"play", label:"Play Kasparov vs Topalov, 1999", fen }` | P9's public challenge/share loader (the same data the public `/join/<code>` page shows; the code is the secret) |
| `/game/<ref>`, `/review/<ref>` | `{ kind:"page", verb: path starts /review ? "review" : "open", label:"your game" }` | none |
| `/t/<slug>` | `{ kind:"page", verb:"join", label:"a tournament" }` | none |
| `/home` "Home", `/train` "Today's training", `/train/bank` "your Mistake Bank", `/games` "your games", `/settings/*` "Settings", `/pricing` "Pricing" … | `{ kind:"page", verb:"open", label }` | static map |
| anything else that passed `safeReturnPath` | `null` (204) | — |

Banner sentence: `verb` play → "Sign in to play **{label}**. You'll come back to it after."; open → "Sign in to open **{label}**…"; review → "Sign in to see **{label}**…"; join → "Sign in to join **{label}**…". Pricing `required`: "…you'll come back to Play · {label} after." Aside board: `fen` when present, else the default Kasparov–Topalov position `b2r3r/k4p1p/p2q1np1/NppP4/3p1Q2/P4PPB/1PP4P/1K1RR3 w - - 1 24` (white to move after 23…Qd6; the same FEN as the blog index board).

### 8.4 Clerk error mapping (`lib/auth/clerk-errors.ts`)

`mapClerkError(err, screen) → { field?: "email" | "password" | "code"; banner?: "rate_limited" | "service" | "info"; state: BoardState; message: string; retryAfterSec?: number }`

| Clerk code / status | Screen | Board state | Field | Copy |
|---|---|---|---|---|
| `form_password_incorrect` | sign-in | `wrong_password` | password | "That password isn't right. Try again or reset it." |
| `form_identifier_not_found` | sign-in | `unknown_email` | email | "No account uses this email." + link "Sign up instead" |
| `form_identifier_not_found` | reset | `unknown_email` | email | "No account uses this email." + link "Create one" |
| `strategy_for_user_invalid` | sign-in, reset | `default` | password / email | "This account uses Google. Continue with Google." / "This account signs in with Google. No password to reset." |
| `form_identifier_exists` | sign-up | `email_taken` | email | "An account already uses this email. Sign in instead." |
| `form_password_pwned`, `form_password_length_too_short`, `form_password_validation_failed`, `form_password_size_in_bytes_exceeded` | sign-up, reset | `weak_password` | password | "Use 8 or more characters. Common passwords aren't allowed." |
| `form_param_nil` / client empty check | sign-up | `empty_fields` | both | "Enter your email address." / "Choose a password." |
| `form_code_incorrect` | verify, reset | `wrong_code` | code | "That code doesn't match. Check the latest email and try again." |
| `verification_expired` | verify, reset | `expired` | code | "This code has expired. Send a new one below." |
| `verification_failed` (too many code attempts) | verify, reset | `rate_limited` | — | "Too many attempts. Send a new code and try again." |
| HTTP 429 / `too_many_requests` | any | `rate_limited` | — | "Too many attempts. Try again in {mm:ss}, or reset your password." (`retryAfterSec` from `Retry-After`, default 30) |
| `user_locked` | sign-in | `rate_limited` | — | same, `retryAfterSec = meta.lockout_expires_in_seconds` (capped display 59:59) |
| `session_exists`, `identifier_already_signed_in` | sign-in, sign-up | — | — | no message; navigate to the target |
| `captcha_invalid`, `captcha_missing_token` | sign-up | `default` | — | banner "We couldn't confirm you're not a robot. Try again." |
| network error / clerk-js not loaded in 8 s | any | `default` | — | banner "Couldn't reach the sign-in service. Check your connection or ad blocker and try again." |
| anything else | any | `default` | — | banner "Something went wrong. Try again." + Sentry breadcrumb (code only, never the identifier) |

### 8.5 Consent cookie and application (`lib/consent/*`)

- **Cookie:** `rc_consent=v1:<a>:<r>:<m>:<unixSec>:<anonId>` (`a`,`r`,`m` ∈ {0,1}). Policy version constant `CONSENT_VERSION = "v1"`; a different version means "no choice yet" (the bar shows again when the policy changes materially).
- **Parse:** `parseConsent(cookieString) → { v, analytics, replay, marketing, at, anonId } | null`; malformed → `null`.
- **Server read:** only in already-dynamic layouts (`(app)`, `(auth)`, onboarding): `cookies().get("rc_consent")` → SSR the in-flow bar or nothing; static pages never read cookies (that would make them dynamic).
- **New device for a signed-in user:** if the cookie is absent and `useAuthHint().signedIn`, `ConsentRoot` calls `GET /api/consent` once (the bar waits up to 1.5 s for the answer); a stored choice is written to the cookie client-side and applied, and the bar is skipped. `GET /api/me` does not carry consent (D7).
- **apply(consent):** analytics → `loadPostHog()` (idle callback, `import("posthog-js")`, `init(key, { api_host:"/ingest", ui_host, persistence:"localStorage+cookie", capture_pageview:"history_change", capture_pageleave:true, person_profiles:"identified_only", disable_session_recording:true, advanced_disable_feature_flags: true })` (flags come from `qk.me().flags`, P1-12), `register(superProps)`; `identify(me.user.ref)` is called by the `(app)` layout island once PostHog has loaded, because the root has no `me`); replay → `Sentry.lazyLoadIntegration("replayIntegration")` → `Sentry.addIntegration(replay({ maskAllText:true, blockAllMedia:true, maskAllInputs:true }))` with `replaysSessionSampleRate: 0`, `replaysOnErrorSampleRate: 1.0`; marketing → nothing (no ad tags exist); first-touch cookie `rc_ft` (utm_*, landing path, 30 days) only with analytics.
- **withdraw:** `posthog.opt_out_capturing(); posthog.reset();` delete `ph_*` cookies and `ph_*` localStorage keys; stop and remove Replay (`getReplay()?.stop()`); delete `rc_ft`.
- **GPC:** `navigator.globalPrivacyControl === true` → preferences open with everything off; "Accept all" still allowed (an explicit choice).
- **Default:** everything off until a choice. Sentry error capture runs regardless (`sendDefaultPii:false`, no Replay; Q2).

### 8.6 Overlay arbitration (additions to `lib/overlays/store.ts`, sys §2.7)

| Priority | Kind | Immersive (board) routes | While another prompt is open | Frequency |
|---|---|---|---|---|
| 1 | `session_expired` (P1) | chip in game | pre-empts all | n/a |
| 2 | `maintenance_restart` chip (P2's `server:restarting` chip, registered here) | yes (chip only) | yes | per restart |
| 2.5 | `renew_sheet` | after the game ends; in game a chip "Membership ended · renew after this game" | pre-empts 4–7 | per 402 |
| 4 | `cookie_consent` | phones/IP: never (deferred); D/IL: in-flow bar allowed | blocks 5–7 until answered | until a choice is stored |
| 6 | `pwa_install` | never | no | §8.7 |
| 7 | `pwa_update` | yes, as the `in_game` chip | yes | until applied |

Immersive = the `(app)/(immersive)` group (`/game/*`, `/review/*`, `/train/bank/session`, `/train/puzzles`, `/learn/lessons/*`, `/practice`, `/queue` matched).

### 8.7 Install eligibility (`lib/pwa/install-eligibility.ts`, pure, unit-tested)

```
eligible = !standalone                                   // matchMedia("(display-mode: standalone)") || navigator.standalone
        && route is in (app) and not immersive
        && overlays has no open prompt of priority ≤ 6
        && now >= snoozeUntil                              // rc:dismissed:v1.pwaInstallSnoozeUntil; snooze = 14 days
        && (visits >= 2 || firstGameDone)                  // rc:visits:v1 incremented once per browser session (sessionStorage marker);
                                                           // rc:dismissed:v1.firstGameDone set by P2 game-over
        && !inAppBrowser                                   // /FBAN|FBAV|Instagram|Line\/|GSA\/|Gmail|LinkedInApp|Twitter/i
        && platform !== "unsupported"
platform = beforeinstallprompt captured ? (pointer:coarse ? "android" : "chromium")
         : isIOSSafari ? (minWidth >= 768 ? "ipad" : "ios")
         : "unsupported"                                   // Firefox desktop, Safari macOS: show nothing
isIOSSafari = (/iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) && /WebKit/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua)
```

Chromium: `deferredPrompt.prompt()` → `userChoice` `accepted` → wait for `appinstalled` → `installed`; `dismissed` → snooze 14 days → `snoozed`. iOS "Got it"/"Not now" → `iosStepsDismissedAt` + snooze 14 days → `dismissed`. Opening from the account menu or Settings bypasses visits and snooze (explicit).

### 8.8 Update state machine (`lib/pwa/useUpdate.ts`)

```
idle --(sw waiting | updatefound+installed with controller | health.data.buildId != NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA | socket upgrade_required | ChunkLoadError)-->
   liveGameRef ? in_game : ready
in_game --(game:over, liveGameRef → null)--> ready
ready --(Refresh)--> refreshing: save drafts to sessionStorage → waiting ? postMessage SKIP_WAITING : location.reload()
refreshing --(controllerchange)--> location.reload()   (one reload per tab; other tabs with a live game show in_game instead of reloading)
ready --(Later)--> later  (sessionStorage rc.update.later = 1; applied silently on the next hard navigation, never while liveGameRef)
later --(button)--> ready
```

The `buildId` poll runs on `visibilitychange → visible` at most every 30 min (`lastCheckAt` in memory), `fetch("/api/health", { cache: "no-store" })`.

### 8.9 `useOnline()` (`lib/offline/useOnline.ts`)

- `navigator.onLine === false` → `offline` immediately.
- On `online` and every 15 s while offline: probe `fetch("/api/health", { cache: "no-store", signal: AbortSignal.timeout(4000) })`; `r.ok && json.data.ok` (P1's envelope) → `online` (emit `back_online` for 4 s if we were offline); failure → stay `offline`.
- Captive portal: `onLine === true` but two consecutive probes fail (triggered by a failed query with `network` error) → `offline`.
- Feeds `onlineManager.setOnline`, the shell chip, `/offline` page state and the disabled-entry-point helper `useNeedsConnection()`.

### 8.10 Search ranking (`lib/data/search.ts`)

Per type, results are scored `3` for a prefix match on the title, `2` for a word-prefix match, `1` for a substring match; ties by type order (page, legend, position, opening, help, game) then by title. The final list interleaves types so that at most 2 of the same type lead (`limit` default 4 for the 404 page, up to 10 for the palette). The static index lives in memory (module scope, ≈ 9 pages + 31 help entries). Legends and featured positions are filtered in memory from P8's cached loaders with the same scoring; openings arrive pre-ranked from `searchOpenings` and are re-scored on the title only.

### 8.11 Contact reference and limits

`reference = "RC-" + String(20000n + id)` (5+ digits, sequential; it reveals only message volume and is never an access key). Limits (D20): a burst bucket of 2 per 60 s per IP on P1's limiter, then 5 per hour per IP hash and 3 per hour per email, counted from `support_requests` rows in one indexed statement (§6.3), so they survive Neon scaling to zero; SPAM rows count. BotID + honeypot + same-origin check (P1 CSRF rule) + Vercel Firewall make automated abuse expensive.

### 8.12 Countdown and local time (S20)

`left = max(0, Date.parse(endsAt) - now)`; `mm:ss` when < 1 h, else `h:mm:ss`; `pct = clamp((now - startsAt) / (endsAt - startsAt), 0, 1)`; "Back around 14:00 UTC (19:30 your time)" = `Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" })` + the same in the user's zone (`Intl.DateTimeFormat().resolvedOptions().timeZone`). The `Retry-After` header is `max(60, ceil(left / 1000))`.

### 8.13 Trial copy (S1, S2, S12)

`TRIAL_DAYS = 7` (`lib/billing/trial-rules.ts`), `trialChargeDate(now) = now + 7 × 24 h` → "Cancel before 6 Nov" (day 8 charge, card-network rule in inv-research §16: copy states the price and the cancel-by date). The date is rendered after mount in the visitor's locale (static HTML would otherwise bake in the build date, pub §1.3); SSR placeholder "Cancel within 7 days".

### 8.14 How we grade numbers referenced by marketing copy

The landing coach card says "loses about 10 win% points" (a Mistake). It must match P3's grading constants (inv-research §3.1, R-EVAL: Win% = `50 + 50·(2/(1+e^(−0.00368208·cp)) − 1)`; Inaccuracy/Mistake/Blunder at 5/10/15 Win% points). The copy is generated from `packages/chess-analysis` `THRESHOLDS.mistake` so it cannot drift (pub §2.5).

### 8.15 Coach fair-use copy (D22)

`CT/limits.ts` exports `COACH_LIMITS = { member: { perDay: 30, perMonth: 150 }, trial: { perDay: 10, perTrial: 40 } }` (feasibility F-LLM-3). The pricing row, the Help `fair-use` answer and P7's "fair-use pause" copy all render from it; `content/help.test.ts` fails on a hard-coded number. If P7 ships different numbers, P7 changes the constant and every surface follows.

---

## 9. Performance and optimisation

### 9.1 Budgets for this phase (optimization §2.3, §5.6, §5.7)

| Route / asset | Budget | How it is measured | Today |
|---|---|---|---|
| `/`, `/about`, `/help`, `/contact`, legal, blog First Load JS | ≤ 180 kB gz, no `chess.js`, no `socket.io-client`, no `posthog-js`, no clerk-js, no `@tanstack/query-core`, no `ZodError` (AP-12, AP-48) | `scripts/check-bundle-budgets.mjs` on the `next build` route table plus a chunk grep (CI fails) | `/` 473 kB |
| `/pricing` First Load JS | ≤ 200 kB gz (includes `@clerk/nextjs` React bindings) | same | 473 kB |
| `/sign-in`, `/sign-up`, `/sign-up/verify`, `/reset-password` | ≤ 210 kB gz | same | prebuilt Clerk page |
| `/offline`, `/maintenance`, root 404 | ≤ 150 kB gz, no TanStack, no clerk-js | same | — |
| Marketing document (HTML + flight) | ≤ 60 KB compressed | `curl --compressed -so /dev/null -w '%{size_download}'` in CI against `next start` | — |
| SW precache on install | ≤ 600 KB | `scripts/check-sw-precache.mjs` parses `public/sw.js` after build | 4.8 MB |
| Marketing CWV (p75 field) | LCP ≤ 2.0 s mobile / 1.5 s desktop, INP ≤ 150 ms, CLS ≤ 0.05, TTFB ≤ 400 ms | Speed Insights per route (`sampleRate` 0.2, D21) | — |
| Auth CWV | LCP ≤ 2.5 s / 1.8 s, TTFB ≤ 600 ms | Speed Insights | — |
| Lighthouse (mobile, lab) on `/`, `/pricing`, `/sign-in`, `/blog/<featured>`, `/help` | Performance ≥ 90, TBT ≤ 200 ms, LCP ≤ 2.5 s, CLS ≤ 0.05, Accessibility ≥ 95 | `@lhci/cli` in CI against `next start` (`lighthouserc.json`), weekly against the dev URL (D25) | — |
| CLS at 80–150 % zoom, 5 devices | ≤ 0.05 | Playwright `PerformanceObserver('layout-shift')` sum in the device suite | — |
| `GET /api/search` | CDN HIT ≤ 120 ms; MISS p95 ≤ 150 ms server with warm loaders, ≤ 250 ms cold; 0 DB statements on a data-cache hit | k6 `perf/k6/scenarios/p11.js` (dev), Sentry span `api search.public`, contract test statement count | — |
| `GET /api/return-target` | HIT ≤ 120 ms; MISS p95 ≤ 200 ms | k6 | — |
| `POST /api/contact` | p95 ≤ 400 ms (email in `after()`) | Sentry span | — |
| `PUT /api/consent` | p95 ≤ 250 ms (W1 class) | Sentry span | — |
| Root 404 | CDN HIT, 0 function invocations on a repeat | `x-vercel-cache` in `errors.spec.ts` | dynamic today |
| Edge Config reads | ≤ 60 % of 100k a month pro-rata (D10, D25) | weekly ops report from the Vercel usage API | — |
| Speed Insights events | ≤ 60 % of 10k per 30 days | same | — |
| `GET /api/system/notice` | HIT ≤ 120 ms; MISS ≤ 150 ms (Edge Config, no DB) | k6 | — |
| Middleware bundle | ≤ 150 kB (Clerk floor ≈ 140 kB) | build output | 143 kB |

### 9.2 What makes the marketing site fast

1. **Static everything** (`force-static`/SSG): CDN HITs cost 0 function invocations and 0 Neon wake-ups, so crawlers and launch spikes are free (optimization §1.1, Hobby budget).
2. **No clerk-js and no TanStack on signed-out marketing pages** (D2): the header uses the cookie hint (D3); clerk-js and `QueryProvider` load only on pricing, auth and app routes; the static marketing paths are outside the middleware matcher, so they also skip the edge run and any Clerk handshake redirect.
3. **No analytics before consent** (D6): −105 kB PostHog chunk from the shared bundle (audit-client §10.1), no GA, no Replay (≈ 50 kB) at init; Sentry with errors + `browserTracingIntegration` at 0.1 only.
4. **No `motion` on marketing**: the DS motion (button sweep, fades) is CSS transitions; `Hero.tsx` and `AgadmatorFeature` go.
5. **Server-rendered SVG boards** (`StaticBoard`): no chess.js, no Stockfish, no `ResizeObserver`; sized by CSS, so no CLS.
6. **Fonts:** `next/font` woff2 (P1 D8), only Geist Sans preloaded; Instrument Serif loaded with `display: swap` + `adjustFontFallback` on marketing (display headings), Geist Mono `preload: false`.
7. **Images:** directory badges move to `/press` with `loading="lazy" fetchPriority="low"`; the OG image is never loaded by the page.
8. **Islands only where needed:** `AuthHint`, `TrialTermsLine`, `PricingStateIsland`, `HelpSearch`, `ContactForm`, `Toc`, `RailCta`, `ConsentRoot`, `NotFoundSearch`. Everything else is server HTML. Islands outside the provider layouts use plain `fetch` helpers (§5.1).
9. **Lazy chunks:** cookie preferences dialog, install prompts, update card, RenewSheet, `InteractiveAnalysisBoard` load through `next/dynamic` on intent or idle.
10. **Edge middleware work bounded:** static marketing documents and the public cookie-free APIs are outside the matcher; scanner probes return before Clerk; only gated `(app)` document requests read Edge Config, through the adaptive memo.
11. **Search costs no database work in the common case** (D16): it filters P8's cached catalogue loaders in memory and the CDN absorbs repeated queries.
12. **The 404 is static** (AP-33): typos and crawler misses are CDN HITs; the signed-in chrome is chosen by a pre-paint script, not by `auth()`.

### 9.3 Query plans for P11's hot paths

| Path | Statements | Plan | Notes |
|---|---|---|---|
| `/api/search` MISS | 0 with warm P8 loaders; 1 (`searchOpenings` miss) | in-memory filter; on a miss the openings statement is a seq scan of 3,641 rows | ≈ 1–2 ms (data-model §8); `EXPLAIN (ANALYZE, BUFFERS)` attached to the sign-off record |
| `/api/me/search` | + 1 join + limiter | `game_players_userId_endedAt_gameId_idx` prefix scan → filter `"opponentName" ILIKE` → stop at 4 → `games_pkey` | ≤ 2,000 rows per member |
| `PUT /api/consent` signed in | 2 (`INSERT consent_records`, `UPSERT user_settings`) + limiter upsert | PK only | one transaction batch |
| `POST /api/contact` | burst limiter, idempotency insert, durable count, `INSERT support_requests`; `after()`: budget count + 1 `UPDATE` | PK + `support_requests_createdAt_idx` range scans | — |
| `/api/return-target` MISS | 0–1 (`unstable_cache` miss) | PK/unique slug lookup | tags shared with P8 |
| root `not-found.tsx` | 0 (static) | — | in-shell 404 reuses the calling page's viewer read |
| `GET /api/consent` | 0 signed out, 1 signed in (once per device) | `user_settings_pkey` | — |
| `/api/system/notice`, `/api/health` | 0 | — | never wake Neon (uptime checks hit `/api/health` without `?deep`) |

### 9.4 Caching layers used in P11

| Layer | Holds | TTL / invalidation |
|---|---|---|
| L0 browser HTTP | `_next/static` (immutable), fonts, pieces, SVG icons, hashed engine | hash change |
| L1 SW | precache (shell, `/offline`, `/maintenance`, fonts, pieces, icons); `rc-public` (marketing/catalogue documents, SWR, 30 entries, 7 days); `rc-pages:u:<ref>` (offline allow-list, current user only, purged at sign-out and on user change); `rc-meta` (current user ref); `rc-engine`; `rc-static` | new SW version; `PURGE_USER` |
| L2 Vercel CDN | static/SSG pages (until deploy); `/api/search` public (300 s + SWR 1 day); `/api/return-target` (1 h); `/api/system/notice` (30 s + SWR 60 s) | time; deploy |
| L3 Next data cache | P8 catalogue loaders used by `resolveReturnTarget` and by search (`getLegendCards`, `listPracticePositions`, `searchOpenings`) | `revalidateTag` from admin writes (P8/P12) |
| L4 React `cache()` | the viewer read reused by the in-shell 404, auth-page target resolution | request |
| L5 module scope | static page index, help index, `getOps()` memo (300 s idle, 120 s scheduled, 60 s active) for the notice and the kill switch; the socket's `currentNotice` | deploy / memo |
| L7 TanStack | `qk.me()` (5 min), `qk.search` (5 min), `qk.returnTarget` (1 h), `qk.system.notice()` (60 s) | socket / focus |
| Cookies | `rc_consent` (1 year), `rc_ft` (30 days, consent) | user action |
| IndexedDB | `rc-offline` snapshots, `rc-outbox` | sign-out purge; iOS may evict after 7 days |

### 9.5 Hobby-plan accounting

| Resource | P11 cost | Control |
|---|---|---|
| Function invocations | marketing 0 (HIT); auth pages 1 per view; pricing signed in 1–2; contact 1; consent 1 per choice (+1 per new device); search MISS only; 404 0 (static); feedback rare | static rendering, CDN tiers, no polling |
| Edge middleware executions | `(app)`, auth, onboarding, checkout, member APIs, unmatched URLs | matcher exclusions remove assets, `monitoring`, `ingest`, `og`, `workers`, SW files, the public cookie-free APIs and every static marketing document |
| Edge Config reads (Hobby: 100k reads and 100 writes a month, verified) | middleware: only gated document requests to `(app)`/onboarding/checkout; Node: the auth pages (kill switch) and the route wrapper (gate); `/api/system/notice` MISS ≤ 2/min per PoP; all through `getOps()` with the adaptive memo (D10). Worst case ≈ instances × 288 reads a day while there is no notice | a daily counter in the weekly ops report (feasibility F-VER-6); at 60 % pro-rata set `MAINTENANCE_SOURCE=env` (R4); writes: ≈ 2 per maintenance window |
| Neon compute | P11 adds no timers; consent and contact writes are user-driven; search MISSes are CDN-bounded | no wake-ups from health/notice routes |
| Resend free tier (100/day, shared with P10's emails) | 2 emails per contact message | durable 3/h per email + 5/h per IP limits; P11's own daily budget counted from `support_requests` (not the UNLOGGED table, feasibility #12): acknowledgements stop at 20 messages a day, support copies at 40, the rest wait as FAILED for the next day's retry; Sentry metric `contact.sent`, alert at 80 % |
| Sentry | Replay only after consent and only on error; traces 0.1 default, 0 for `/api/health` and `/api/system/notice` | `tracesSampler` |
| PostHog (1M events/month) | only consenting visitors | sampling for `blog_read_depth` (25 %) |
| Speed Insights (10k events per 30 days, team-wide) | marketing + app views at 20 % | `sampleRate={0.2}` (D21) |
| CDN requests, Fast Data Transfer | test traffic would dominate | suites run against `next start` in CI; the deployed dev site gets `@smoke` only (D25) |

### 9.6 Payload sizes

| Response | Budget |
|---|---|
| `GET /api/search` | ≤ 2 KB (≤ 10 results × ≈ 150 B) |
| `GET /api/return-target` | ≤ 400 B |
| `GET /api/system/notice` | ≤ 600 B |
| `PUT`/`GET /api/consent` | ≤ 300 B |
| `POST /api/contact` | ≤ 120 B |
| `GET /api/me` (P1) on pricing | ≤ 2 KB, ETag 304 on focus |

### 9.7 Bundle impact by package

| Change | Effect |
|---|---|
| Remove PostHog from the shared chunk (dynamic import) | −≈ 105 kB gz on every route |
| Remove Replay from Sentry init | −≈ 50 kB gz on every route |
| Remove `motion` from marketing (`Hero`, About, legal pages) | −≈ 20–30 kB on those routes |
| ClerkProvider and QueryProvider off marketing | −`@clerk/nextjs` client bindings and −≈ 16 kB TanStack on marketing routes, −90 KB clerk-js transfer |
| `devSchema()` at every `api()` call site | zod schema modules drop out of production chunks (AP-12) |
| New: `idb-keyval` (≈ 1 kB, offline pages only), `@vercel/edge-config` (middleware/server only), the pre-paint auth hint (≈ 300 B inline on two-chrome pages) | small |

---
## 10. Telemetry

### 10.1 PostHog (client, consent-gated; registry `PKG/analytics/src/events/<area>.ts`, one zod schema per event with a closed property set, testing X6)

Naming `area_object_action`, snake-case properties, no PII, no free text, no FEN (architecture §3.4.3). Events fire only after analytics consent (D6); before that `track()` is a no-op. Super properties (registered on load): `app_env`, `app_build`, `device_class` (`desktop|ipad_l|ipad_p|phone`), `viewport_w_bucket`, `zoom_bucket`, `signed_in`, `member_state`, `is_pwa`.

| Event | Properties | Where |
|---|---|---|
| `landing_viewed` | `signed_in` | S1 mount |
| `landing_cta_clicked` | `cta: hero_trial\|hero_pricing\|price_monthly\|price_yearly\|how_coach_works\|how_we_grade\|today_training\|your_patterns`, `signed_in` | S1 |
| `landing_section_viewed` | `section: how\|coach\|pricing` (once each, IntersectionObserver) | S1 |
| `pricing_viewed` | `state`, `banner`, `plan_default`, `has_redirect` | S2 |
| `pricing_plan_toggled` | `plan` | S2 |
| `pricing_cta_clicked` | `state`, `plan` | S2 |
| `pricing_faq_opened` | `question_id` | S2 |
| `checkout_start_failed` (**reused**, owned by P4; consistency R-18) | `code` (P4's props; P11 adds none) | S2, S4 |
| `paywall_shown` | `reason: required\|ended`, `destination_kind` | S2/S3 |
| `renew_sheet_opened` | `from: play\|coach\|api_402\|dev`, `payment_first` | S4 |
| `renew_cta_clicked` | `plan` | S4 |
| `renew_option_clicked` | `option: past_reviews\|update_payment` | S4 |
| `renew_sheet_dismissed` | `method: esc\|scrim\|not_now\|close` | S4 |
| `about_viewed`, `about_cta_clicked` | `cta` | S5 |
| `blog_index_viewed` | `category` | S6 |
| `blog_category_clicked` | `category` | S6 |
| `blog_post_card_clicked` | `slug`, `position` | S6 |
| `blog_post_viewed` | `slug`, `category` | S7 |
| `blog_read_depth` | `slug`, `pct: 25\|50\|75\|100` (25 % sampled) | S7 |
| `blog_toc_clicked` | `slug`, `heading_id` | S7 |
| `blog_rail_cta_clicked` | `slug`, `signed_in`, `target: trial\|play` | S7 |
| `blog_related_clicked` | `from`, `to` | S7 |
| `help_viewed` | — | S8 |
| `help_topic_selected` | `topic` | S8 |
| `help_searched` | `q_len`, `results` (debounced 1 s; never the query text) | S8 |
| `help_no_results` | `q_len` | S8 |
| `help_answer_opened` | `answer_id` | S8 |
| `help_contact_clicked` | `from: no_results\|still_stuck` | S8 |
| `contact_viewed` | `topic_param` | S9 |
| `contact_submitted` | `topic`, `signed_in` | S9 (on 202) |
| `contact_failed` | `code` | S9 |
| `auth_signin_viewed` | `has_return_target`, `target_kind` | S11 |
| `auth_signin_submitted` | `method: password\|google\|apple` | S11 |
| `auth_signin_failed` | `code` (Clerk code, never the identifier) | S11 |
| `auth_signin_completed` | `method` | S11 |
| `auth_reset_clicked` | — | S11 |
| `auth_signup_viewed` | `source`, `plan` | S12 |
| `auth_signup_started` | `method` | S12 |
| `auth_signup_failed` | `code` | S12 |
| `auth_signup_completed` | `method`, `source`, `plan` | S12/S13 |
| `auth_verify_viewed`, `auth_verify_failed {code: incorrect\|expired\|too_many}`, `auth_verify_resent`, `auth_verify_completed` | | S13 |
| `auth_reset_started`, `auth_reset_code_sent`, `auth_reset_failed {code}`, `auth_reset_completed` | | S14 |
| `auth_oauth_returned` | `provider`, `outcome: ok\|cancelled\|error` | S15 |
| `error_404_viewed` | `path_template`, `variant: signed_out\|signed_in\|missing_game`, `referrer_host` | S16 |
| `error_404_search` | `q_len`, `results` | S16 |
| `error_404_result_clicked` | `type`, `rank` | S16 |
| `error_500_viewed` | `boundary: app\|marketing\|root`, `route_template`, `digest_present` | S17 |
| `error_500_retry` | `attempt`, `succeeded` | S17 |
| `error_500_report_sent` | `has_message`, `via: sentry\|api` | S17 |
| `offline_viewed` | `path_template` | S19 (queued, sent when online) |
| `offline_item_opened` | `kind: bank\|bot\|lessons\|review` | S19 |
| `offline_back_online` | `offline_ms_bucket` | S19 |
| `maintenance_viewed` | `mode`, `affects` | S20 |
| `maintenance_offline_action` | `kind` | S20 |
| `server_restart_notice_shown` (**reused**, owned by P2) | `in_game` (P2's props) | S20 |
| `maintenance_refused_action` | `action: queue\|find_match\|challenge` | client toast on a `maintenance` ack |
| `consent_choice` | `analytics`, `replay`, `marketing`, `method`, `source` (only fires when analytics becomes true, after `opt_in_capturing`) | S21 |
| `consent_settings_opened` | `from: footer\|settings\|menu` | S21 |
| `pwa_prompt_shown` | `platform: chromium\|android\|ios\|ipad`, `trigger: visit2\|first_game\|menu\|settings` | S22 |
| `pwa_install_result` | `outcome: accepted\|dismissed\|snoozed\|steps_done` | S22 |
| `pwa_installed` | — (`appinstalled`) | S22 |
| `pwa_launch` | `source: pwa` (from `start_url=/home?source=pwa`) | app boot |
| `pwa_update_shown` | `source: sw\|poll\|chunk\|socket`, `deferred_in_game` | S23 |
| `pwa_update_applied` | `deferred_in_game`, `waited_ms_bucket` | S23 |
| `pwa_update_later` | — | S23 |

### 10.2 Server-side events (posthog-node in `after()`, `distinct_id = referenceId`, no device properties)

`account_created { method, signup_source }` (from `provisionUser()`, only when the row was really inserted, so the Clerk webhook and the first `/api/me` cannot both send it, §7.7), plus the billing truths already defined by P4 (`trial_started`, `subscription_activated`). These run without browser consent as part of operating the service (architecture §3.3.3 [OD], Q10) and carry `consentExempt: true` in the registry, so `consent-reject.spec.ts` can tell them apart from client events.

### 10.3 Sentry

| Item | Setting |
|---|---|
| Client init (`instrumentation-client.ts`) | `dsn`, `environment` (`NEXT_PUBLIC_APP_ENV`), `release` (`NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA`), `integrations: [browserTracingIntegration()]`, `tracesSampler`: 0 for `/api/health`, `/api/system/notice`, polls; 1.0 dev; 0.1 default prod; `sendDefaultPii: false`; `beforeSend` drops `request.cookies`, strips the query params `redirect_url`, `email`, `token`, `code` and `session_id`, drops events whose message contains an `@`-email pattern; `replaysSessionSampleRate: 0`, `replaysOnErrorSampleRate: 1.0` (effective only after the Replay integration is lazily added) |
| Server/edge init | same sampler, `sendDefaultPii: false` (`sentry.server.config.ts:20`, `sentry.edge.config.ts:21`) |
| Error boundaries | `captureException(error, { tags: { boundary, route_template }, contexts: { digest } })`; returns the Event ID shown in S17/S18 |
| Feedback | `Sentry.captureFeedback({ message, associatedEventId })` (S17) |
| Spans | `api search`, `api contact` (+ child `email.send` in `after()`), `api consent`, `mw maintenance_gate`, `edge_config.get` |
| Metrics | `contact.sent`, `contact.failed`, `contact.spam`, `consent.choice{method}`, `maintenance.gate_hit{kind: document\|api}`, `pwa.update_applied`, `sw.precache_bytes` (from CI) |
| User context | `Sentry.setUser({ id: referenceId })` in the `(app)` layout client; never email; cleared at sign-out |
| Field performance | Speed Insights at 20 % (D21); no anonymous Sentry performance metrics without consent unless the owner says yes to Q21 |
| Alerts (architecture §3.4.4) | add: any error in `/api/contact` or `after()` email send for 10 min; `contact.failed` > 3/h; error spike on `boundary:root` (global error) > 5 in 10 min |
| CSP reports | `report-to` the Sentry CSP endpoint during the report-only week (architecture §3.2.5) |

---

## 11. Security, privacy, paywall and authorisation

| Topic | Rule |
|---|---|
| Open redirect | Every `redirect_url`, `returnPath` and `?next` goes through `safeReturnPath()` (§8.2) on the server **and** the client; unsafe values are dropped silently, never echoed into HTML. Unit-tested against `//evil.com`, `/\evil.com`, `/%2F%2Fevil.com`, `/%5Cevil`, `/\tevil`, `javascript:alert(1)`, `https://evil.com`, `/@evil.com`, `/sign-in?redirect_url=/sign-in…` (loop), 600-char paths |
| Return-target oracle | `GET /api/return-target` never reveals whether a private game, review or tournament exists or what it contains: fixed `page` labels, no lookup, no FEN (D23); only public catalogue rows and P9's public challenge preview are resolved; the cache key is the normalised path |
| Auth credentials | Passwords and codes go browser → Clerk FAPI only; never logged, never sent to our API, never in telemetry (event props carry Clerk error codes only). Inputs use correct `autocomplete`; no custom credential storage |
| Bot and brute force | Clerk bot protection (Smart CAPTCHA, `#clerk-captcha` in custom sign-up), Clerk user lockout and FAPI rate limits, Vercel Firewall rule on `/sign-*` bursts; the UI shows the countdown and never retries automatically |
| Account enumeration | Default: accept Clerk's behaviour (`unknown_email`, `email_taken` as drawn). If the owner enables enumeration protection (Q9), `mapClerkError` switches to one generic message "Check your email and password." and the `unknown_email` state becomes unreachable (dev route only) |
| Session after reset | `signOutOfOtherSessions: true` |
| CSRF | P1 middleware rejects non-GET `/api/*` unless `Sec-Fetch-Site: same-origin` or `Origin` equals the app origin (feasibility SEC-9; covers contact, consent, feedback). `PUT /api/consent` and `POST /api/contact` are inside the matcher for this reason |
| Contact abuse | BotID, honeypot, a 60 s burst bucket plus durable per-IP and per-email hourly counts from `support_requests` (D20), `Idempotency-Key`, 16 KB body cap, plain-text email (no HTML), CR/LF stripped from subjects, zod-validated reply-to, a daily send budget. The support inbox never receives an attacker-controlled `From` |
| Consent | default deny; equal-weight buttons; no pre-ticked boxes; withdraw as easy as accept (footer, settings, menu); proof stored (who/what/when/version/method); GPC honoured; the bar never hides behind a scroll on phones (floating card) and never covers a board |
| Telemetry minimisation | no email, name, FEN, PGN or free text in PostHog or Sentry; ids are `referenceId`; Sentry `sendDefaultPii:false` and a scrubber; Replay masks all text and inputs |
| PII retention | `support_requests` 180 days, deleted with the account; `consent_records` 24 months, `userId` nulled on deletion; both disclosed on `/privacy` |
| Service worker | no `/api/**`, no RSC, no authenticated `(app)` documents outside the 3-route allow-list; the allow-list cache is per user (`rc-pages:u:<ref>`), used only while the SW knows the current user (`SET_USER`, persisted in `rc-meta`), cleared on every auth page, at sign-out and on a user change (api-perf AP-34); `rc-public` holds only public pages; the SW never reads IndexedDB auth state; an emergency kill-switch build exists (§14.3) |
| IndexedDB | per-user keys `u:<ref>:*`, purged at sign-out; treated as a cache, never as a source of truth; offline writes are re-authorised on sync (402 for lapsed members → "Your membership ended; these results weren't saved") |
| Error pages | never show `error.message`, stacks or digests to users; only the Sentry Event ID; 404 for entities the viewer may not see (no 403 leak) |
| Maintenance | webhooks, internal, cron and health are never blocked; admins bypass (claim `md.role === "ADMIN"` in middleware, re-checked from the DB role by the route wrapper); `/internal/broadcast` requires `x-internal-token` (D19) and is blocked at Caddy, reached only through `docker compose exec` from `ops-broadcast.yml` or SSH |
| Kill switches | Edge Config values are read-only from the app; written only by the ops CLI with a Vercel token held by the owner |
| Test hooks (`/dev/ui/p11/*`, `/dev/throw`, `CONTACT_EMAIL_DRY_RUN`, `OPS_OVERRIDE`, the fake-SW hook) | registered in `lib/test-hooks/registry.ts`, guarded by `isNonProd()` (fails closed when `APP_ENV` is unset in a production build), `noindex`, disallowed in robots; `prod-guard.spec.ts` proves each is 404 or ignored in the production-mode build (testing X12) |
| CSP | marketing policy (static, `'unsafe-inline'` scripts, no nonce) adds nothing third-party: PostHog `/ingest`, Sentry `/monitoring` and BotID are same-origin; Clerk FAPI host and `challenges.cloudflare.com` (Smart CAPTCHA) appear only in the auth/pricing policy (architecture §3.2.5); GA hosts removed |
| Paywall | Pricing and the RenewSheet only shape UX: checkout (`POST /api/checkout`) and every member API decide from the DB (402/409). Middleware claims are a convenience (architecture §3.1.2 L1); `requireMemberPage()` and `route({auth})` are the boundary. The landing's signed-in hint is display-only and grants nothing |
| Robots | `metadata.robots: noindex` plus `X-Robots-Tag: noindex` from `next.config.js` `headers()` (pages cannot set headers) on `/sign-*`, `/reset-password`, `/sso-callback`, `/offline`, `/maintenance`, `/too-many-requests`, `/dev/*`, 404/500, blog tag views and empty categories; **every path on non-production builds** and `robots.txt` `Disallow: /` there (the dev site is public, feasibility SEC-3); robots.txt disallow list extended on production |
| Dev environment exposure | the dev deployment is a free copy of the paid product (feasibility SEC-3); P11 keeps it out of search engines (above) and sends `x-vercel-protection-bypass` from every automated client so that P1 can turn on Vercel Authentication without breaking Lighthouse CI, k6 or the dev-URL smoke |
| Licences | Stockfish is served to browsers as a separate GPL-3.0 file with `COPYING`, `SOURCE.txt` and a written offer linked from `/licenses` (D24); assets with no recorded licence are flagged for replacement before P13 |

---

## 12. Testing

### 12.0 Conventions (the shared tools come from P1; testing critique X1–X18)

| Topic | Rule for P11 |
|---|---|
| Runner and layout (X1) | `node:test` via `tsx` in every package, **including `WS`** (no Vitest). Unit tests sit beside the source as `*.test.ts`; DB-backed tests are `*.int.test.ts`; route and contract tests live in `WEB/test/api/`. |
| Where suites run (D25, X2, X16) | CI: `ci.yml` (unit, integration on Docker Postgres 17, contracts, `e2e-smoke`), `nightly.yml` (full main suite sharded ×4, the 40 device × zoom projects, visual, state coverage, `sw-on`, `auth-prebuilt`), all against `next build && next start` with the socket server from source. The deployed dev URL gets only `@smoke` (nightly and from `post-deploy-dev.yml`) with the Vercel bypass header when protection is on. |
| Paywall (X3) | `BILLING_PAYWALL=on` in every P11 job; pricing specs depend on it. |
| Users (X4) | Shared members A–P only gain data; **Q (trial used) and R (never trialled) are read-only**. Exact states (`lapsed`, `legacy`, `pastdue`, `trial` with days left, admin) come from `leasePersona(name)`. Sign-up, verify and reset create a **throwaway** user `e2e-<flow>-<runId>+clerk_test@example.com` (code `424242`) that the sweeper deletes; reset never touches a shared user's password. |
| Server time (X5) | The maintenance countdown and `Retry-After` maths read `ctx.now`; specs set `x-rc-now` through `serverNow.set(iso)` instead of waiting. |
| Telemetry (X6) | Every §10.1 event is a zod schema in `PKG/analytics/src/events/<area>.ts`; the client sink (`NEXT_PUBLIC_TELEMETRY_SINK=1`, test builds only) and the PostHog server sink (`e2e/mocks/posthog-sink.ts`) record events; the PII guard runs after every spec. **WP-G changes `WEB/e2e/fixtures/telemetry.ts` to set `rc_consent=v1:1:1:0:<now>:<anonId>` by default**, so every P1–P10 telemetry assertion keeps passing once client events are consent-gated; only `consent.spec.ts` and `consent-reject.spec.ts` opt out. Server events that run without consent are marked `consentExempt: true` in the registry (`account_created`, the P4 billing truths). |
| Console guard (X7) | auto-use; P11 allowlists nothing new. |
| State coverage (X8) | Specs carry `@state:<Board>.<value>` (real data) or `@demo:<Board>.<value>` (dev route); `scripts/qa/state-coverage.ts` must show 0 missing for the 41 P11 boards; demo-only states need a reason in `design-states.overrides.json` (e.g. `V3SignIn.oauth_loading`: "the Google redirect is aborted in CI"). |
| Device tiers (X9) | PR: `desktop-1440@100`, `desktop-1280@125`, `iphone@100`, `ipad-portrait@100`; nightly: all 40. P11 adds its real routes to `e2e/devices/layout/routes.real.ts`. |
| Visual (X10) | `toHaveScreenshot`, `maxDiffPixelRatio: 0.002`, fixed clock, `reducedMotion: "reduce"`, `[data-vr-mask]` on relative dates and avatars, light and dark. |
| Tags and regression (X11) | Every P11 spec is tagged `@p11` (and `@smoke` for 6 of them); the regression gate is the whole suite plus `flags-off`. |
| Test hooks (X12) | Registered in `lib/test-hooks/registry.ts`, all guarded by `isNonProd()` (+ `x-e2e-token` for headers): `/dev/throw`, `/dev/ui/p11/*`, `CONTACT_EMAIL_DRY_RUN`, `MAINTENANCE_MODE` (env fallback, also real in prod, so it is listed as `kind: "ops"`), `OPS_OVERRIDE`, the fake waiting-SW hook `window.__rcTestSw` (only in builds with `NEXT_PUBLIC_TELEMETRY_SINK=1`). `prod-guard.spec.ts` proves each is 404 or ignored in the production-mode build. |
| Defects (X14) | Every defect from the owner test or the device pass gets `regression: <slug> (#issue)` first; `quarantine.json` has no expired entry at sign-off. |
| Record (X15) | `REPO/docs/qa/phase-11-signoff.md`: SHA, Vercel deployment id, OCI image tag, owner-test rows with screenshots (`docs/qa/phase-11/`), devices and zooms, the state-coverage table, `scripts/qa/error-window.ts` output for ≥ 24 h after the last dev deploy, PostHog live-view result, k6 files. |
| Perf data (X18) | k6 summaries to `REPO/perf/results/p11-<scenario>-<sha>.json`; thresholds `abortOnFail` for the hard SLOs. |

### 12.1 Unit tests (`tsx --test`)

| File | Cases |
|---|---|
| `lib/navigation/return-to.test.ts` | `safeReturnPath`: the 12 attack strings in §11 → `null`; allowlisted paths keep query and hash; stripped params removed; length cap; double-encoding rejected. `resolveReturnTarget`: each pattern in §8.3 with mocked P8 loaders; `/game`, `/review`, `/t` never call a loader and never return a `fen`; `kind` never `game` or `tournament`; unknown slug → `null`; query string ignored |
| `lib/auth/clerk-errors.test.ts` | every row of §8.4 maps to the right `state`/`field`/copy; `Retry-After` parsing (seconds and HTTP date), default 30, lockout seconds; unknown codes → generic banner; no identifier ever appears in the returned message |
| `lib/auth/auth-hint.test.ts` | `__client_uat` plain and suffixed names; `0`, missing, malformed; `__session` payload decode for `ini`/`usn`; expired JWT still decodes (display only) |
| `lib/auth/access-rules.test.ts` | auth-page rule: signed out passes; signed in on `/sign-in` → `redirect_url` when safe, else `/home` / `/pricing` / `/onboarding` by claims; `/sign-up/verify` and `/sign-in/factor-two` never redirected |
| `lib/routes/scanner.test.ts` | 20 probe paths match (`/wp-login.php`, `/.env`, `/.git/config`, `/phpmyadmin`); 20 real routes do not (`/`, `/help`, `/.well-known/security.txt`, `/legends/kasparov`, `/@martin_k`) |
| `lib/system/maintenance-gate.test.ts` | document vs API vs asset; `active`+`all` rewrites `(app)` documents only; marketing/auth/offline/maintenance pass; admin bypass; `online`/`coach`/`import` areas; webhooks/internal/cron/health exempt; `Retry-After` maths; invalid notice JSON ignored; env fallback; `MAINTENANCE_SOURCE=env` never calls Edge Config |
| `lib/system/ops.test.ts` | adaptive memo: 300 s with no notice, 120 s `scheduled`, 60 s `active` (fake timers); one Edge Config call per window; `OPS_OVERRIDE` honoured only when `isNonProd()` |
| `lib/system/notice.test.ts` | `SystemNoticeV1` parsing; `resolved` older than 10 min → `null`; countdown/pct/negative handling (§8.12); local-time label with a fixed zone |
| `lib/billing/pricing-state.test.ts` | every row of §8.1 incl. loading/error, legacy, admin, paywall-off, invalid `plan`, `status=failed` alias, `paused` reason |
| `lib/consent/cookie.test.ts` | serialise/parse round trip; malformed → `null`; version mismatch → `null`; `anonId` format |
| `lib/consent/apply.test.ts` | with mocked loaders: analytics on → PostHog loader called once; off → never; withdraw clears `ph_*` keys and calls `opt_out_capturing` + `reset`; replay on → `lazyLoadIntegration` once; GPC pre-selects off |
| `lib/pwa/install-eligibility.test.ts` | standalone, snooze, visits, first game, immersive, in-app browsers (6 UA strings), iPadOS-as-Macintosh, Firefox desktop → unsupported, CriOS/FxiOS excluded |
| `lib/pwa/update-machine.test.ts` | every transition in §8.8; `in_game` → `ready` on game over; `later` never applies while `liveGameRef`; poll throttle 30 min |
| `worker/user.test.ts`, `worker/pages.test.ts` (pure cores) | `SET_USER` change deletes other users' caches; no user → no cache read or write; `ignoreSearch`; a 503 with `x-rc-maintenance` is treated as a failure and never stored |
| `lib/offline/onlineReducer.test.ts` | offline event, probe success/failure (`json.data.ok`), captive portal (2 failures), `back_online` for 4 s |
| `lib/data/search.test.ts` | ranking (§8.10), interleaving, `game` only with a member, static index hits for "pricing", "bank", "help", "fair use"; public path never calls `searchMyGames` |
| `lib/support/contact.test.ts` | reference format, honeypot → SPAM without send, dry-run mode, subject CR/LF stripping, plain-text body escaping, daily budget: ack skipped at 20, support copy skipped at 40 |
| `components/board/StaticBoard.test.ts` (chess fixtures) | FEN → 64 squares for the landing, auth default, blog index and help/about FENs; orientation flips; invalid FEN → text fallback + Sentry; every FEN in `content/**` and blog frontmatter is legal (`chess.js` `validateFen` in the test only) |
| `lib/overlays/store.test.ts` (P1 file, new cases) | the §8.6 table: consent blocks install/update; renew sheet deferred in game; P2's restart chip coexists |
| `content/help.test.ts` | ids unique; `fair-use` answer renders `COACH_LIMITS` values (never hard-coded numbers); every `links[].href` is a known route |

### 12.2 API contract tests (`WEB/test/api/*.test.ts`, route handlers on Docker Postgres per architecture §5)

| Route | Cases |
|---|---|
| `GET /api/search` | 400 for `q` length 1 and 65; 400 for `types=game`; response matches `SearchResponse`; `public-static` headers; no `Set-Cookie`; **0 DB statements** with warm loaders (Prisma statement counter); never reads cookies (request with a `__session` cookie gives byte-identical output) |
| `GET /api/me/search` | 401 signed out; `no-store`; includes the member's games via `opponentName`; 429 after 60 in a minute |
| `GET /api/return-target` | 204 for unsafe paths (no 4xx); 200 shape; `/game/<ref>` → `page` label, no `fen`, 0 DB statements; `?path=/play/legend/x?utm=1` and `?path=/play/legend/x` give the same body; cache headers |
| `POST /api/contact` | 202 + reference; 400 field map; honeypot → 202 and row SPAM; BotID `isBot` (mocked) → 403; 413 over 16 KB; idempotent replay with the same key returns the same reference; different body + same key → 422; 4th message from one email within an hour → 429 **even after `TRUNCATE rate_limit_buckets`** (durable count, D20); 6th from one IP → 429; maintenance active → still 202 (exempt) |
| `PUT /api/consent`, `GET /api/consent` | signed-out reject → 200, cookie set, **no** row; signed-out accept → row with `anonId`; signed-in → row with `userId` + `user_settings.consent` upserted; GET signed in returns it, signed out `null` with 0 statements; 429 after 10 in 60 s; cookie attributes |
| `POST /api/feedback` | 204 signed in and signed out; 400 bad `eventId`; 429 after 3 in 60 s |
| `GET /api/system/notice` | `null` without Edge Config; parsed notice; invalid JSON → `null`; cache header |
| Route-wrapper maintenance gate | an `area:"online"` route returns 503 `maintenance` with `Retry-After` and `details.retryAt` when `affects:["online"]`; webhooks pass; admin passes |
| Socket broadcast (`WS/test/broadcast.test.ts`, `node:test`) | missing or wrong `x-internal-token` → 401; `notice` reaches a user-room-only socket; `restart` (P2) unchanged; boot restore from a stubbed `/api/system/notice`; during an `online` window `queue:join` acks `maintenance` while a running game's `move` is accepted |

Contract zod schemas are shared with the client (`api()` parses with `devSchema()` in dev and test only), and the OpenAPI diff in CI (architecture §5.3.1) covers the new routes.

### 12.3 E2E Playwright

Projects: P1's `playwright.devices.config.ts` (8 base devices × zoom 80/100/110/125/150 % = 40 projects; tiered per §12.0) for layout specs; `playwright.config.ts` desktop Chromium for flow specs; WebKit iPhone and iPad for the iOS install and auth specs; **`sw-on`** (production build, `serviceWorkers: "allow"`, runs every phase's `@smoke` plus the P11 SW specs; nightly and in P11's CI); **`auth-prebuilt`** (its own `webServer` with `OPS_OVERRIDE='{"flags":{"auth_custom_flows":false}}'`, runs `sign-in.spec.ts` and `sign-up.spec.ts` against the prebuilt components). Clerk: `@clerk/testing/playwright` `setupClerkTestingToken()` (bypasses bot protection on the dev instance). `CONTACT_EMAIL_DRY_RUN=1`. Signed-out specs run with `E2E_PUBLIC_ONLY=1`.

| Spec | Steps (assertions) |
|---|---|
| `e2e/specs/public/landing.spec.ts` | `/` signed out: h1 text, hero CTAs hrefs carry `source`, `#how` and `#pricing` anchors scroll, trial line shows a date after hydration, price cards ($4.99 / $50, −16 %); signed in (user A storage state): header shows Play + initials, hero CTAs "Today's Training"/"Your Patterns"; JSON-LD `SoftwareApplication` with "Coaching Monthly"/"Coaching Yearly"; signed out: **no request** to `/ingest`, `googletagmanager`, `clerk.` and no `/_next/static` chunk containing `@tanstack/query-core`; with the default consent fixture `landing_viewed` arrives exactly once |
| `e2e/specs/public/pricing.spec.ts` (rewrites `e2e/specs/pricing.spec.ts`) | default **monthly**; toggle yearly updates price, note, trial line and `?plan=yearly` without a navigation; `?reason=required&redirect_url=/play/legend/kasparov-topalov-1999` banner names "Kasparov vs Topalov"; unsafe `redirect_url` ignored; `?checkout=failed` alert + Try Again; FAQ 4 items open with keyboard; "Help Center" link → `/help#billing` (edge E3); "fair use applies" → `/help#fair-use`; JSON-LD names; user R → CTA posts `/api/checkout` (route intercepted, asserts body `{plan, source:"pricing", returnPath}`); user Q → "Start Coaching" + "Your free trial has been used. Billing starts today."; member A → "Your membership", "Manage Billing" → `/settings/membership`; leased `legacy` → "$8 / month"; leased `pastdue` → payment banner link `/api/customer-portal`; `409 already_subscribed` (intercepted) → member view; `402 payment_update_required` (intercepted) → portal |
| `e2e/specs/public/marketing.spec.ts` | `/about` principles; `/blog` category links change URL to `/blog/category/<slug>`; `/blog/category/endgames` empty state + noindex meta; a post: TOC `aria-current` changes on scroll, rail CTA href by sign-in state; `/help`: `/` focuses search, "refund to paypal" → no results + Contact Support, Esc clears, `/help#a-how-do-i-cancel` and `/help#fair-use` open their answers; legal: four links with `aria-current`, TOC anchors, privacy lists every processor in architecture §3.3.1 (replaces `paid-only.spec.ts:48`); `/licenses` lists Stockfish with a source link and the written offer; `/docs/api` → 307 `/help` on the dev build (308 in production); `/how-we-grade` has the top-nav Pricing link (edge E2); `/@A` signed out shows `MarketingTopNav` (C-22); on the dev build every response carries `X-Robots-Tag: noindex` and `robots.txt` disallows `/` |
| `e2e/specs/public/contact.spec.ts` | empty submit → 3 field errors; valid send → "Sent" + `RC-\d{5,}`; offline (`context.setOffline(true)`) send → error banner, values kept, retry online reuses the same `Idempotency-Key` (request header asserted) and succeeds; 4th message from the same email within an hour → 429 copy; honeypot filled via DOM → still "Sent" (and DB row SPAM, through the test DB helper) |
| `e2e/specs/auth/sign-in.spec.ts` (also in `auth-prebuilt`) | custom: wrong password → `wrong_password` copy, `aria-invalid`; unknown email → `unknown_email` + link carries the email; FAPI 429 (route-intercept `**/v1/client/sign_ins**` → 429 `Retry-After: 5`) → countdown 0:05 → controls re-enable; Google click → `oauth_loading` then navigation to `accounts.google.com` (aborted); valid sign-in for user A with `redirect_url=/train` lands on `/train`; signed-in visit to `/sign-in` redirects to `/home`; `?oauth=cancelled` banner; return target board (`[role=img]` label contains "Kasparov vs Topalov"). Prebuilt: the Clerk component renders inside `AuthShell`, the return banner is still there, sign-in succeeds |
| `e2e/specs/auth/sign-up.spec.ts` (also in `auth-prebuilt`) | empty → both errors; weak password `password1` → `weak_password`; existing email (user A) → `email_taken`; throwaway address → `/sign-up/verify`; `source` and `plan` stored (Clerk Backend API: `unsafeMetadata.signupSource`); after verify the server sink shows **exactly one** `account_created` for the new ref even though the webhook and the first `/api/me` both ran |
| `e2e/specs/auth/verify.spec.ts` | wrong code `000000` → `wrong_code`; paste `424242` auto-submits → `/onboarding…`; Resend → "Resend in 0:5x" and the button disabled; Backspace/arrow navigation across boxes; opening `/sign-up/verify` without a sign-up → `/sign-up` |
| `e2e/specs/auth/reset.spec.ts` | unknown email → `unknown_email`; throwaway user → step 2 focus on h1; wrong code → inline error; code `424242` + new password → `done` → Continue lands signed in on `/home`; a second browser context with the old session is signed out |
| `e2e/specs/system/errors.spec.ts` | `/nope` signed out: **status 404**, marketing header, search "pricing" lists Pricing, Enter navigates; `/nope` signed in: status 404, shell frame visible with no marketing header flash (first paint screenshot), Go home → `/home`; an `(app)` page that calls `notFound()` (`/train/session/<bad-ref>/summary`, P5) → the generic in-shell 404 (status 404); `/game/doesnotexist` → "Game Not Found" in the shell, status 404, and the same for a game of two other users; `/wp-login.php` → 404 with no `x-clerk-*` headers; `/dev/throw?where=page` → **status 500**, Event ID (12 hex) + Copy → clipboard has 32 hex; Try again twice → "Still not working…"; Report → textarea → Send → "Report sent with event …" (Sentry envelope intercepted at `/monitoring`); `/dev/throw?where=marketing` and `?where=auth` → status 500 in marketing chrome; `/dev/throw?where=layout` → global error renders with stylesheets blocked (route-intercept `*.css` → 404); `prefers-color-scheme: dark` → black background; after 3 reloads → "Clear Cached Data and Reload" |
| `e2e/specs/system/offline.spec.ts` (`sw-on`) | as member A visit `/train/bank` and a review; wait for SW `activated`; `setOffline(true)`; navigate `/games` → offline page lists Mistake Bank, Play vs bot, Last review; "Find an opponent" not a link; visit `/train/bank` and `/play?tab=bot` offline → cached pages; `/play/online` offline → `V3Queue` `offline` with "Play vs bot offline" → `/play?tab=bot` (C-10); `setOffline(false)` + Retry → "Back online"; sign out → `caches.keys()` has no `rc-pages:u:*`, IndexedDB `rc-offline` has no `u:<ref>:*` |
| `e2e/specs/system/sw-shared-device.spec.ts` (`sw-on`, api-perf gate) | user A opens `/train/bank` (cached), signs out; user B signs in in the same context; with the network throttled to 6 s per document, B's `/train/bank` never shows A's content (`response.fromServiceWorker()` false or B's cache) |
| `e2e/specs/system/sw-kill.spec.ts` (`sw-on`, a CI job builds once with `SW_KILL_SWITCH=1`) | install the normal SW, then serve the kill build → after one navigation `navigator.serviceWorker.getRegistrations()` is empty and `caches.keys()` is `[]` |
| `e2e/specs/system/maintenance.spec.ts` | `MAINTENANCE_MODE=active` on a dedicated local server: `/home` → maintenance page (status 503 or 200 + `x-rc-maintenance: 1`), countdown text (server time fixed with `x-rc-now`); `/`, `/pricing` normal; `POST /api/webhook/dodo-payments` reaches the handler (signature failure 400/401, **not** 503); member API → 503 `maintenance`; in a P2 bot game a `restart` broadcast to the fixture socket server → P2's chip text, the board still accepts a move; with `affects:["online"]` the queue shows the maintenance toast |
| `e2e/specs/system/consent.spec.ts` | fresh context with the fixture's consent cookie removed: bar visible; `page.on("request")` sees no `/ingest`, no `googletagmanager`, no Sentry replay envelope (`replay_event`); Reject → toast → still none, cookie `v1:0:0:0`; reload → no bar; open Cookie settings from the footer → Preferences → Analytics on → Save → `/ingest/e` (or `/ingest/i/v0/e`) requests start; signed in (user B): `PUT /api/consent` returns 200 and a second device context gets no bar after sign-in (`GET /api/consent`); Esc closes preferences back to bar; focus returns to the trigger; buttons have equal width (bounding boxes); Settings › Account › Privacy "Cookie settings" opens preferences (C-13) |
| `e2e/specs/system/consent-reject.spec.ts` | consent `v1:0:0:0`: run a P5 drill (shared member, adds data only) → the client sink holds **zero** events; the server sink holds only `consentExempt` events |
| `e2e/specs/system/pwa-install.spec.ts` (WP-H) and `pwa-update.spec.ts` (WP-E) | manifest JSON: `id "/"`, `start_url "/home?source=pwa"`, `orientation "any"`, colours, icons incl. maskable, shortcuts, screenshots; Chromium: dispatch a synthetic `beforeinstallprompt` on the second session → popover with `role=dialog`; Not now → snooze stored; iPhone WebKit project: UA Safari → steps sheet with 3 steps, auto-advance (fake clock), Got it → toast; iPad P project: popover anchored top-right; in-app browser UA → nothing; Settings › Notifications "Install app" and the P10 `ios_install` "Show me how" open the same sheet (C-13); update: `window.__rcTestSw.waiting()` during a P2 bot game → chip "Update ready · installs after this game"; end the game → card; Refresh → reload |
| `e2e/specs/paid-only.spec.ts` (update) | `/try/x` → 301 to P8's target; landing sells the trial; sitemap still has no `/try` |
| `e2e/devices/layout/p11-viewport.spec.ts` (tiered device × zoom) | **lock screens** (`/pricing` on D/IL, `/about` D/IL, `/help`, `/contact`, `/terms`, `/licenses`, `/sign-in`, `/sign-up`, `/sign-up/verify` (dev route), `/reset-password`, `/nope`, `/dev/ui/p11/error-500`, `/offline`, `/maintenance` (dev route)): `scrollHeight <= innerHeight`; auth aside board fully inside the viewport; **flow screens** (`/`, `/blog`, a post, pricing on P/IP/A, `/@A` guest): no horizontal scroll, landing hero board fully inside the first viewport on D/IL; CLS sum ≤ 0.05 during load; hit targets ≥ 44 px (or `tap-target`) for every button and link in the main content; cookie bar visible: the board never intersects the bar or card on `(app)` pages |
| `e2e/devices/ui/p11-states.spec.ts` | visits every `/dev/ui/p11/<screen>?state=<s>` for every enum value in §4 (41 boards), tagged `@demo:<Board>.<value>`, and takes a visual snapshot per base device at 100 % |
| axe (`@axe-core/playwright`) | on every page above: no serious/critical violations; roles: `region` consent, `dialog` preferences/install, `status`/`alert` banners, `timer` countdowns |

### 12.4 Regression of earlier phases

The gate is the **whole** main and devices suites plus `flags-off` and `sw-on` on the final SHA (testing X11). These targeted checks are run and recorded in addition, because P11 changes code they depend on:

| Phase | What to re-run | Why |
|---|---|---|
| P1 | shell specs (`e2e/devices/layout/probe.spec.ts`, palette, shortcuts, toasts, session-expired, rate-limited); `prod-guard.spec.ts` | providers moved into group layouts; overlay store changed; new hooks |
| P2 | bot game and friend game happy paths, `restart-resume.spec.ts`, reconnect | in-game update chip; SW no longer caches RSC; `liveGameRef` hook; broadcast handler extended |
| P3 | review page, how-we-grade | page moved into `(marketing)`; `review:last` writer |
| P4 | onboarding end to end for a throwaway user with the Dodo test card; `/checkout/activating` | new sign-up flow feeds onboarding; return URLs use the hardened `safeReturnPath` |
| P5 | offline outbox journey (grade offline, sync online) under `sw-on` | SW rules, per-user caches and `useOnline` changed |
| P6 | `weakness/computing-fallback-poll.spec.ts` and the `(app)` weakness pages under `sw-on` | SW rewrite; consent-gated telemetry |
| P7 | `coach-ask-stream.spec.ts`, `coach-stop.spec.ts` under `sw-on` | the SSE stream must stay `NetworkOnly` and abortable through the new SW |
| P8 | catalogue pages signed out and signed in; `V3TryCatalogue` offline state | marketing chrome swapped; `rc-public` cache; search reads its loaders |
| P9 | challenge accept signed out → sign-up → back to the challenge; queue offline state | auth return flow; maintenance ack on `queue:join` |
| P10 | `notifications.spec.ts` (push test through the new SW), settings privacy row, notifications install row, `profile-guest.spec.ts` | `worker/index.ts` extended; lit rows; guest header |
| P12 (if merged) | arena `find_match` during an `online` maintenance window acks `maintenance` | socket refusal |

### 12.5 Manual checklist on the dev site (ego-browser, then a real iPhone and Android)

1. Every owner-test step in §1, on desktop 1440×900 at 100 % and 150 % zoom, 1280×800, iPad portrait (real device or ego-browser emulation), iPhone and Android.
2. Lighthouse in ego-browser DevTools (mobile) on `/`, `/pricing`, `/sign-in`, a blog post, `/help`: scores and LCP element (hero headline or board) recorded in the sign-off record.
3. Network panel on `/` signed out: no clerk-js, no PostHog, no GA, no TanStack chunk; total transfer recorded.
4. Clerk dashboard (dev): paths, bot protection, email-code verification, session token claims (`md`, `ini`, `usn`) saved; screenshots attached.
5. Vercel `replay-chess-dev`: env vars present; Edge Config connected; Firewall rules listed; Edge Config read count for the test window noted; runtime errors for the test window are empty (Vercel MCP `get_runtime_errors`).
6. Sentry: a test 500 shows the Event ID that the page displayed; the feedback item is linked; no PII in the event.
7. PostHog: with consent, `landing_viewed` arrives with `app_env=dev`; without consent, nothing for that session.
8. Install the PWA on Android and iPhone; launch from the home screen → `/home?source=pwa`; airplane mode → offline page.
9. Fill `docs/qa/phase-11-signoff.md`; close every ego-browser task and tab when done (CLAUDE.md).

### 12.6 Performance checks

- CI: bundle budgets (§9.1, blocking), `ZodError` and `@tanstack/query-core` absent from marketing chunks, SW precache ≤ 600 KB, document size ≤ 60 KB on `/`, Lighthouse CI budgets against `next start` in CI (and once per week against the dev URL).
- k6 (`perf/k6/scenarios/p11.js`, dev only, never prod, inside the 60 % quota rule of D25): `/api/search` 20 rps for 2 min with 50 distinct queries (expect > 90 % `x-vercel-cache: HIT` after warm-up, MISS p95 ≤ 250 ms), `/api/return-target` 10 rps, `/api/system/notice` 10 rps (HIT), `/` and `/pricing` documents 20 rps (HIT). Results to `perf/results/`.
- `EXPLAIN (ANALYZE, BUFFERS)` of the contact limit count, the support retry query and the member search on the perf branch (`--scale 100`), attached to the sign-off record.
- Speed Insights review after one week on dev (CWV p75 per route against §9.1, at the 20 % sample).

---

## 13. Work breakdown

### 13.1 Order and lanes

```
Day 1–1.5   WP0 Foundation (lead, sequential): route groups, provider split + Clerk/cookie spike, chrome, stubs, M11, registries, package.json
Day 2–8     Lane 1: WP-A Landing+Pricing+Walls  →  WP-B Templates+Content+Contact+Licences
            Lane 2: WP-C Auth                   →  WP-D Errors+Search
            Lane 3: WP-G Consent+Telemetry      →  WP-H PWA install+Manifest
            Lane 4: WP-E Offline+SW+Update      →  WP-F Maintenance
Day 8–9     WP-I QA, perf gates, cleanup, dev deploy, owner test, sign-off record (lead)
```

Effort 20 dev-days; with four lanes the calendar is about 9 working days, plus the owner's decision and test time (feasibility §8: the owner, not Claude, is the bottleneck). **Placeholder hand-over rule** (as SPEC §3.1): WP0 creates every cross-package module as a typed stub with its final exports; the owning package then rewrites the body, keeps the exports and may add optional props. Nobody edits a file owned by another package; requests go through the lead. **Registries** follow P1's directory layout when P1 adopted feasibility §7 (`lib/api/keys/<area>.ts`, `lib/flags/registry/<phase>.ts`, `lib/routes/classes/<area>.ts`, `lib/cron/tasks/<task>.ts`, `lib/seo/robots-rules/<phase>.ts`, `config/redirects/<phase>.mjs`, `e2e/personas/<phase>.ts`); otherwise the same entries go into the single files and the lead serialises the edits.

### 13.2 Packages

**WP0 · Foundation and integration** (lead · 1.5 d)

| Creates | Edits | Moves / deletes |
|---|---|---|
| `app/(marketing)/layout.tsx` (marketing shell, no Clerk, no TanStack), `app/(system)/layout.tsx` (static, no Clerk, no shell), `app/(auth)/layout.tsx` (stub → WP-C), `components/providers/AppProviders.tsx` (`ClerkScope` + `QueryProvider` + `OverlayHost`), `components/marketing/{TopNav,Footer,AuthHint}.tsx`, `lib/auth/auth-hint.ts` (+ test) and its pre-paint script string, `components/auth/ClerkScope.tsx` (from `ThemeAwareClerkProvider`), `components/board/StaticBoard.tsx` (+ test), `lib/system/ops.ts` (`getOps()` with the adaptive memo, env fallback, `OPS_OVERRIDE`; + test), stubs: `lib/auth/access-rules.ts#authPageRule` (→ WP-C), `lib/system/maintenance-gate.ts` (→ WP-F), `lib/routes/scanner.ts` (→ WP-D), `lib/offline/snapshots.ts` (→ WP-E), `lib/pwa/sw-user.ts` (→ WP-E), `components/consent/ConsentRoot.tsx` (→ WP-G), `components/pwa/InstallPromptRoot.tsx` (→ WP-H), `components/system/{UpdatePromptRoot,SystemNoticeRoot}.tsx` (→ WP-E, WP-F), `CT/http/{search,return-target,contact,consent,feedback}.ts` + the P11 block of `CT/http/system.ts` + `CT/socket/system.ts` + the `notice` arm of `CT/internal/broadcast.ts` (final schemas from §7.2), `CT/limits.ts` if P7 has not created it, `PKG/analytics/src/events/{landing,pricing,marketing,auth,errors,offline,maintenance,consent,pwa}.ts` (empty zod registries → owners), `PKG/db/json/{consent,contact-context}.ts`, `prisma/migrations/<ts>_m11_consent_support/migration.sql`, `lib/api/keys/system.ts`, `lib/flags/registry/p11.ts` (documents the three P11 switches; none are PostHog flags) | `app/layout.tsx` (root keeps `ThemeProvider`, `ConsentRoot`, `Toaster`, `SpeedInsights sampleRate={0.2}`; removes root Clerk, GA, `<Analytics/>`, `UserSync` remnants; `themeColor`; metadata from `lib/seo/site-metadata.ts`), `app/(app)/layout.tsx` (+ `AppProviders`, `UpdatePromptRoot`, `InstallPromptRoot`, `SystemNoticeRoot`), `app/onboarding/layout.tsx`, `app/checkout/layout.tsx`, `app/dev/layout.tsx`, `app/(admin)/layout.tsx` if present, `app/(marketing)/pricing/layout.tsx` (wrap with `AppProviders`), `middleware.ts` (order of §7.4, matcher), `prisma/schema.prisma` (§6.1), `lib/overlays/store.ts` (§8.6), P1 `MarketingOnly` chrome (new TopNav/Footer for signed-out catalogue and guest pages), `apps/web/package.json` (deps `idb-keyval`, `@vercel/edge-config`, `@lhci/cli` dev; scripts `notice:*`, `lhci`), `REPO/turbo.json` `globalEnv`, `docs/decisions.md` (the §14.2 rows with their defaults) | `git mv` into `app/(marketing)/`: `page.tsx`, `pricing/`, `how-we-grade/`, `about/`, `help/`, `contact/`, `privacy/`, `terms/`, `cookies/`, `blog/`, `press/`, `careers/`, `community/`, `docs/`, and P10's `app/(public)/p/` (URL unchanged); into `app/(auth)/`: `sign-in/`; into `app/(system)/`: `too-many-requests/` |

Acceptance: (1) **Spike** on a preview build: `/` signed out loads no `clerk.*` script and no TanStack chunk; soft navigation `/` → `/sign-in` → sign in → `/home` → logo → `/` → `/pricing` (Clerk loads, `useAuth` resolves, checkout POST works with `/pricing` outside the matcher) has no console errors on Chromium and WebKit; the Clerk dev instance's cookie names (`__client_uat`, `__session`, suffixed or not) are recorded in `lib/auth/auth-hint.ts`; otherwise revert to the root providers and record R1. (2) Every existing route still renders (P1 smoke + device probe green). (3) M11 applied to the Neon dev branch with `prisma migrate deploy`; drift gate green; `prisma validate` passes. (4) Stubs compile with their final signatures; `check-types` green.

**WP-A · Landing, pricing, membership walls** (2.5 d) — boards `V3Landing`, `V3iPhoneLanding`, `V3iPadLanding`, `V3Pricing`, `V3iPhonePricing`, `V3iPadPricing`, `V3PaywallHard`, `V3PaywallSoft`

| Creates | Edits | Deletes |
|---|---|---|
| `app/(marketing)/page.tsx` (rewrite), `app/(marketing)/_landing/{Hero,HowItWorks,CoachCard,PriceCards,LandingCtas}.tsx`, `app/(marketing)/pricing/{page,layout}.tsx` (rewrite), `app/(marketing)/pricing/_components/{PricingStateIsland,PricingBanner,PlanColumn,FeatureTable,PricingFaq,MobileCtaBar,MembershipSummary}.tsx`, `lib/billing/pricing-state.ts` (+ test), `components/billing/{PlanToggle,PlanCta,TrialTermsLine}.tsx` (only if P4 has not created them), `components/billing/RenewSheet.tsx` (only if P7 has not; D18 fallback otherwise), `app/dev/ui/p11/{landing,pricing,paywall-soft}/page.tsx`, `e2e/specs/public/{landing,pricing}.spec.ts` | `lib/billing/copy.ts` (`SALES_FAQS`, `PLAN_FEATURES` incl. the fair-use row from `CT/limits.ts`, trial copy), `lib/billing/plans.ts` (`DEFAULT_PLAN`), `lib/api/errors.ts` (D18 402 routing), `components/billing/RenewSheet.tsx` (P7: option order, B26 row), P9 Play hub ended row (only if B26 read-only), `PKG/analytics/src/events/{landing,pricing}.ts` (`checkout_start_failed` marked reused from P4), `e2e/specs/paid-only.spec.ts` | `app/components/{Hero,HowToPlay,AgadmatorFeature,PricingSection,Testimonials}.tsx`, `app/(marketing)/pricing/PricingContent.tsx`, `app/components/billing/BillingToggle.tsx` |

Acceptance: every state of the 8 boards reachable (real data for `logged_out`, `logged_in`, `trial_used`, `member`, `legacy`, `required`, `checkout_failed`, `sheet_open` via a forced 402; dev routes for the rest, tagged); `/` ≤ 180 kB and `/pricing` ≤ 200 kB First Load JS; Lighthouse ≥ 90 on both; pricing and landing e2e green on desktop and iPhone projects; lock assertion for pricing on D/IL at all zooms; the Help link (E3) and the fair-use link present.

**WP-B · Marketing templates, content, SEO, contact, licences** (2.75 d) — boards `V3About`, `V3BlogIndex`, `V3BlogPost`, `V3Help`, `V3Contact`, `V3Legal`

| Creates | Edits | Deletes |
|---|---|---|
| `app/(marketing)/about/page.tsx`, `app/(marketing)/blog/{page,loading}.tsx`, `blog/category/[category]/page.tsx`, `blog/_components/{BlogCard,CategoryNav,Toc,RailCta,Related}.tsx`, `app/(marketing)/help/page.tsx`, `help/_components/HelpSearch.tsx`, `content/help.ts` (31 Q&As incl. `fair-use`; + test), `app/(marketing)/contact/page.tsx`, `contact/_components/ContactForm.tsx`, `app/api/contact/route.ts`, `lib/support/contact.server.ts` (+ test), `lib/email/send.ts` (only if P4 has not), `lib/email/templates/{support-request,support-ack}.ts`, `components/marketing/LegalLayout.tsx`, `app/(marketing)/{terms,privacy,cookies,licenses}/page.tsx`, `content/legal/{terms,privacy,cookies,licenses}.ts`, `app/(marketing)/press/_components/DirectoryBadges.tsx` (moved, lazy images), `lib/seo/site-metadata.ts`, `lib/seo/robots-rules/p11.ts`, `config/redirects/p11.mjs` (`/docs/api` → `/help`, 308 on prod, 307 on dev per feasibility §9), `lib/cron/tasks/support.ts`, `app/dev/ui/p11/{blog-index,help,contact,legal}/page.tsx`, `e2e/specs/public/{marketing,contact}.spec.ts` | `app/(marketing)/blog/[slug]/page.tsx`, `lib/blog-types.ts`, `lib/blog.ts` (frontmatter), existing MDX frontmatter (`fen`, `orientation`, `positionSlug`), `app/(marketing)/{press,careers,community}/page.tsx` (restyle), `app/(marketing)/p/[username]/page.tsx` (P10: swap the legacy `Navbar` for `MarketingTopNav` + full footer, C-22), `app/robots.ts` (reads the rule files; disallow all when `APP_ENV !== "production"`), `app/sitemap.ts`, `public/llms.txt`, `WEB/THIRD_PARTY.md` (P9 created it; P11 adds the missing asset rows from LIC-5 as "unknown — replace before P13" when no source is recorded), the cron task array (registers WP-B and WP-G tasks), `PKG/analytics/src/events/marketing.ts` | `app/components/LegalPageLayout.tsx`, `app/components/DirectoryBadges.tsx` (after the move), `app/(marketing)/docs/api/page.tsx` |

Acceptance: S5–S10 states reachable; contact e2e green (validation, offline retry with the same `Idempotency-Key`, durable 429, honeypot); help search and deep links incl. `#fair-use`; legal privacy lists every processor; `/licenses` lists Stockfish with the source tag and offer; guest profile shows the v3 header; `robots.txt` and sitemap assertions (dev disallows everything); Lighthouse ≥ 90 on a blog post and `/help`; lock assertion for About, Help, Contact, Legal on D/IL.

**WP-C · Auth** (3 d) — boards `V3SignIn`, `V3iPhoneSignIn`, `V3iPadSignIn`, `V3SignUp`, `V3iPhoneSignUp`, `V3iPadSignUp`, `V3VerifyEmail`, `V3ResetPassword`

| Creates | Edits | Deletes |
|---|---|---|
| `app/(auth)/layout.tsx` (takes over the stub; `AppProviders`), `app/(auth)/sign-in/page.tsx`, `app/(auth)/sign-in/[...rest]/page.tsx`, `app/(auth)/sign-up/page.tsx`, `app/(auth)/sign-up/[...rest]/page.tsx`, `app/(auth)/sign-up/verify/page.tsx`, `app/(auth)/reset-password/page.tsx`, `app/(auth)/sso-callback/page.tsx`, `components/auth/{AuthShell,AuthAside,OAuthButtons,PasswordField,OtpInput,AuthBanner,SignInForm,SignUpForm,VerifyForm,ResetForm}.tsx`, `lib/auth/clerk-flows.ts` (posts `SET_USER` after `setActive`), `lib/auth/clerk-errors.ts` (+ test), `lib/auth/access-rules.ts#authPageRule` (+ test), `app/api/return-target/route.ts` and `lib/api/queries/return-target.ts` (if P4 did not create them), `app/dev/ui/p11/{sign-in,sign-up,verify,reset}/page.tsx`, `e2e/specs/auth/{sign-in,sign-up,verify,reset}.spec.ts`, the `auth-prebuilt` Playwright project | `lib/navigation/return-to.ts` (P4's file: §8.2 hardening, §8.3 kinds per D23, P8 loader names), `lib/billing/return-url.ts` (delegate to `safeReturnPath`), `lib/clerk-theme.ts`, `lib/auth/viewer.ts` `provisionUser()` (P1: `account_created` on real insert only), `app/api/webhook/clerk/route.ts` (P1/P10 file: `signupSource` check only), `e2e/personas/p11.ts` (throwaway sign-up/reset helpers), `PKG/analytics/src/events/auth.ts`; **dashboards:** Clerk dev instance (paths, email code, bot protection, lockout, session token `ini`/`usn`), Vercel env vars (§7.9) | `app/sign-in/[[...sign-in]]/{page,layout}.tsx` (after the move) |

Acceptance: all 6 + 5 + 5 + 6 states reachable (real flows plus FAPI intercepts for `rate_limited`; dev routes for every state); auth e2e green on Chromium and WebKit (iPhone, iPad P) **and in the `auth-prebuilt` project**; open-redirect unit tests green; kill switch flips `/sign-in` to the prebuilt component within one memo window (≤ 300 s); lock assertion on all auth pages at 80–150 %; auth LCP ≤ 2.5 s mobile lab; `account_created` exactly once.

**WP-D · Errors and search** (2 d) — boards `V3Error404`, `V3iPhoneError404`, `V3iPadPError404`, `V3Error500`, `V3iPhoneError500`, `V3iPadPError500`, `V3ErrorGlobal`

| Creates | Edits | Deletes |
|---|---|---|
| `app/not-found.tsx` (rewrite: static, both chromes + pre-paint hint), `app/(app)/not-found.tsx`, `app/(app)/(immersive)/game/[ref]/not-found.tsx`, `app/(app)/(immersive)/review/[ref]/not-found.tsx`, `app/(shared)/join/[code]/not-found.tsx` only if P9 has none, `app/(app)/error.tsx`, `app/(marketing)/error.tsx`, `app/(auth)/error.tsx`, `app/error.tsx` (rewrite), `app/global-error.tsx` (rewrite), `components/system/{ErrorLayout,FallenKing,NotFoundBody,NotFoundSearch,ErrorBody,EventId,ErrorReport,PickUpWhereYouLeftOff,StaticShellFrame}.tsx`, `lib/routes/scanner.ts` (takes over the stub, + test), `lib/errors/chunk-reload.ts`, `app/api/search/route.ts`, `app/api/me/search/route.ts`, `lib/data/search.ts` (+ test), `lib/search/page-index.ts`, `lib/api/queries/search.ts`, `app/api/feedback/route.ts`, `app/dev/throw/page.tsx` (`where=page\|marketing\|auth\|layout`), `app/dev/ui/p11/{error-404,error-500,error-global}/page.tsx`, `e2e/specs/system/errors.spec.ts` | `PKG/analytics/src/events/errors.ts`; the P1 palette (`components/shell/CommandPalette.tsx`) switches to `qk.search(…)` on `/api/me/search` (one import change, owned by WP-D for this edit) | old `app/error.tsx`, `app/not-found.tsx`, `app/global-error.tsx` bodies |

Acceptance: every state of the 7 boards reachable; status 404 on every 404 variant and 500 on every boundary; `missing_game` identical for foreign and missing games; root 404 served from the CDN (0 function invocations on a repeat, checked with `x-vercel-cache`); `/api/search` HIT on repeat and 0 DB statements on a MISS with warm loaders; `/api/me/search` `no-store`; global error renders with stylesheets blocked.

**WP-E · Offline, service worker, update prompt** (2.75 d) — boards `V3Offline`, `V3iPhoneOffline`, `V3iPadPOffline`, `V3PwaUpdate`

| Creates | Edits | Deletes |
|---|---|---|
| `worker/{user,pages,update,purge,maintenance,sync}.ts` (+ pure-core tests), `worker-kill/index.ts`, `app/(system)/offline/page.tsx`, `components/system/{OfflineView,OfflineRows}.tsx`, `lib/offline/{useOnline,onlineReducer,idb}.ts` (+ tests), `lib/offline/snapshots.ts` and `lib/pwa/sw-user.ts` (take over the stubs), `lib/pwa/{useUpdate,update-machine}.ts` (+ test), `components/system/{UpdatePromptRoot,UpdateCard,UpdateChip}.tsx`, `lib/system/activity.ts`, `scripts/check-sw-precache.mjs`, `docs/runbooks/rollback.md` (§"Service worker"), the `sw-on` Playwright project and its CI job (+ the one-off `SW_KILL_SWITCH=1` build job), `app/dev/ui/p11/{offline,pwa-update}/page.tsx`, `e2e/specs/system/{offline,sw-shared-device,sw-kill,pwa-update}.spec.ts` | `next.config.js` (PWA block §7.6, `/workers` and `/sw.js` headers), `worker/index.ts` (P10's entry: add the imports), `components/shell/OnlineChip.tsx` (P1: `useOnline`, "Back online"), `lib/offline/outbox.ts` (P5: `botGames` kind, only if P2's runner supports local games), P5 Train hub/bank client (write `bank:due`), P3 review client (write `review:last`), P2 `EngineProvider` (write `engine:ready`), P2 game client (set `liveGameRef`, `firstGameDone`), P2 `features/game/screen/InGameChips.tsx` (mount `UpdateChip`), P9 queue `offline` state (render "Play vs bot offline" → `/play?tab=bot` when `engine:ready` and Q15 = yes, C-10), P1 `signOutEverywhere` (`PURGE_USER`, `SET_USER null`, IndexedDB purge, after P1's cache-clear step), `(app)` layout client island (write `current` + `shell` snapshot, post `SET_USER`), `PKG/analytics/src/events/offline.ts` | `lib/hooks/usePWAUpdate.ts`, `app/components/PWAUpdateBanner.tsx` |

Acceptance: precache ≤ 600 KB (CI); Cache Storage never contains `/api/` or `_rsc` entries and only the current user's `rc-pages:u:*` (spec); offline, shared-device and kill-switch specs green under `sw-on`; update deferred in a live bot game and applied after game over; `ChunkLoadError` recovers with one reload; `V3TryCatalogue` `offline` state works for a previously opened position; the queue's offline CTA reaches the bot tab offline.

**WP-F · Maintenance** (1 d) — board `V3Maintenance`

| Creates | Edits | Deletes |
|---|---|---|
| `lib/system/{notice,notice.server}.ts` (+ tests), `lib/system/maintenance-gate.ts` (takes over the stub, + test), `app/api/system/notice/route.ts`, `lib/api/queries/system.ts`, `lib/system/useSystemNotice.ts`, `app/(system)/maintenance/page.tsx`, `components/system/{MaintenanceView,MaintenanceBanner}.tsx`, `components/system/SystemNoticeRoot.tsx` (takes over the stub), `WS/src/system/notice.ts` (boot restore + `currentNotice`; + test), `scripts/system/notice.ts` (`set`, `clear`, `restart`, `--via gh\|ssh`), `REPO/.github/workflows/ops-broadcast.yml`, `app/dev/ui/p11/maintenance/page.tsx`, `e2e/specs/system/maintenance.spec.ts`, `docs/runbooks/maintenance.md` | `lib/api/route.ts` (P1: step 3a maintenance gate and the `area` option only), `components/shell/ShellBanners.tsx` (P1: scheduled banner slot), `WS/src/http/broadcast.ts` (P2: `notice` arm), the P2 socket command handlers for `queue:join` and challenge accept, and P12's `tournament:find_match` if merged (one `maintenanceGuard()` call each), P2 ack-code list (`maintenance`), `PKG/analytics/src/events/maintenance.ts` (`server_restart_notice_shown` marked reused from P2), the weekly ops report (Edge Config read counter); **dashboards:** Vercel Edge Config store `replay-ops` (dev), connection to `replay-chess-dev` | — |

Acceptance: S20 `page` reachable for real and `in_game` verified on P2's chip; webhooks, cron, health never blocked (spec); a new `queue:join` acks `maintenance` during an `online` window while a running game continues; Edge Config reads measured over a day on dev and recorded with the chosen memo; broadcast rejects a bad token; `notice:set|clear|restart` documented in `docs/runbooks/maintenance.md`.

**WP-G · Consent and telemetry gating** (2 d) — boards `V3CookieConsent`, `V3iPhoneCookie`, `V3iPadPCookie`

| Creates | Edits | Deletes |
|---|---|---|
| `lib/consent/{cookie,apply,store,cookie-inventory,client}.ts` (+ tests; `client.ts` is the plain-`fetch` PUT/GET with retry, no TanStack), `components/consent/{ConsentBar,ConsentPreferences,CookieSettingsButton}.tsx`, `components/consent/ConsentRoot.tsx` (takes over the stub), `app/api/consent/route.ts` (PUT + GET), `lib/data/consent.server.ts`, `lib/analytics/{posthog-client,identify,track,super-props}.ts`, `lib/cron/tasks/consent.ts`, `app/dev/ui/p11/consent/page.tsx`, `e2e/specs/system/{consent,consent-reject}.spec.ts` | `instrumentation-client.ts` (§10.3, BotID `initBotId`), `sentry.server.config.ts`, `sentry.edge.config.ts`, `components/layout/ViewportStage.tsx` (P1: optional bottom `consentSlot` grid row), `WEB/e2e/fixtures/telemetry.ts` (P1: default consent cookie, X6.5), the event registry `consentExempt` flag, `features/account/AccountSection.tsx` (P10: the "Cookie settings" row under Privacy, only if P10 did not add it, C-13), `PKG/analytics/src/events/consent.ts`; hand-off line for P10's deletion transaction (`UPDATE consent_records SET "userId" = NULL …`) | `app/components/GoogleAnalytics.tsx`, `app/components/PostHogIdentify.tsx` |

Acceptance: consent e2e network assertions green (no PostHog/GA/Replay before consent); `consent-reject.spec.ts` green; the **whole** suite green with the consent-aware fixture; proof rows as specified (signed-out reject writes none); withdraw clears PostHog storage; shared First Load JS drops by ≥ 100 kB versus the pre-P11 build; the bar never overlaps a board on any device × zoom project.

**WP-H · Install prompt and manifest** (1 d) — boards `V3PwaInstall`, `V3AndroidPwaInstall`, `V3iPhonePwaInstall`, `V3iPadPPwaInstall`

| Creates | Edits | Deletes |
|---|---|---|
| `public/manifest.json` (rewrite), `public/icons/{icon-maskable-512.png,apple-touch-icon-180.png}`, `public/screenshots/{wide-1280x800.png,narrow-390x844.png}`, `lib/pwa/{install-eligibility,usePwaInstall}.ts` (+ test; exports `isIOS()`, `isStandalone()` for P10), `components/pwa/{InstallPopover,InstallCard,IosInstallSheet}.tsx`, `components/pwa/InstallPromptRoot.tsx` (takes over the stub; exports `openInstallPrompt`), `app/dev/ui/p11/pwa-install/page.tsx`, `e2e/specs/system/pwa-install.spec.ts` | `components/shell/AccountMenu.tsx` (P1/P10: "Install App" item), P10 `features/notifications/{NotificationsSection,NotifPromptDialog,usePushState}.tsx` ("Show me how" → `openInstallPrompt({ source: "notifications" })`; imports `isIOS`/`isStandalone` from `lib/pwa/install-eligibility.ts`; the "Install app" row if P10 did not add it, C-13), `lib/hooks/index.ts:13` (drop the old export), `PKG/analytics/src/events/pwa.ts`; values for `app/layout.tsx` `appleWebApp` and icons handed to WP0 | `lib/hooks/usePWAInstall.ts`, `app/components/{InstallAppPopover,IOSInstallModal}.tsx` (after P10's imports move) |

Manifest: `{"id":"/","name":"ReplayChess: Chess Coaching From Your Own Games","short_name":"ReplayChess","description":"Your Chess.com and Lichess games, analysed. Your recurring mistakes, turned into daily puzzles.","start_url":"/home?source=pwa","scope":"/","display":"standalone","orientation":"any","background_color":"#FAF9F6","theme_color":"#FAF9F6","categories":["education","games"],"icons":[…existing any-purpose icons…, {"src":"/icons/icon-maskable-512.png","sizes":"512x512","type":"image/png","purpose":"maskable"}],"shortcuts":[{"name":"Train","url":"/train?source=pwa"},{"name":"Play","url":"/play?source=pwa"},{"name":"Mistake Bank","url":"/train/bank?source=pwa"}],"screenshots":[{"src":"/screenshots/wide-1280x800.png","sizes":"1280x800","form_factor":"wide"},{"src":"/screenshots/narrow-390x844.png","sizes":"390x844","form_factor":"narrow"}]}`.

Acceptance: Chrome installability check passes (DevTools Application panel, no manifest warnings); all 4 platform prompts reachable; eligibility unit tests green; no prompt on immersive routes or in in-app browsers; P10's notifications spec still green with the new install sheet.

**WP-I · QA, performance gates, cleanup, dev deploy** (lead · 1.5 d)

| Creates | Edits | Deletes |
|---|---|---|
| `lighthouserc.json`, `e2e/devices/layout/p11-viewport.spec.ts`, `e2e/devices/ui/p11-states.spec.ts`, `perf/k6/scenarios/p11.js`, `docs/qa/phase-11-signoff.md`, the P11 rows of `docs/qa/design-states.overrides.json` | `.github/workflows/{ci,nightly}.yml` (Lighthouse CI against `next start`, precache check, `sw-on`, `auth-prebuilt`), `scripts/check-bundle-budgets.mjs` (P11 route budgets, `ZodError`/`@tanstack/query-core` absent from marketing), `lib/test-hooks/registry.ts` (P11 hooks), `e2e/devices/layout/routes.real.ts` (P11 real routes), `docs/implementation-plan.md` (pointer to this plan) | `app/components/{Navbar,Footer}.tsx`, `app/api/healthcheck/route.ts` and any other legacy marketing component with zero importers (checked with `grep -r`) |

Acceptance: §15 Definition of done.

### 13.3 Shared files and their single P11 owner

P11 runs after P7 and P10 (R-19), so files those phases created are edited, not co-owned. If the calendar keeps P10 in parallel, feasibility §10.16 item 4 applies: P10 owns `AccountMenu.tsx` and `app/api/webhook/clerk/route.ts`, P11 owns `worker/index.ts` and `app/(app)/layout.tsx`, and every other overlap goes through the registries.

| File (phase that created it) | P11 owner | Other packages |
|---|---|---|
| `app/layout.tsx` (P1), `app/(app)/layout.tsx` (P1) | WP0 | hand values to WP0 |
| `middleware.ts` (P1) | WP0 (wiring); rule bodies in `access-rules.ts` (WP-C), `maintenance-gate.ts` (WP-F), `scanner.ts` (WP-D) | — |
| `next.config.js` | WP-E | WP-B uses `config/redirects/p11.mjs` and `lib/seo/robots-rules/p11.ts` instead of editing it |
| `apps/web/package.json`, `REPO/turbo.json` | WP0 | request additions from the lead |
| `prisma/schema.prisma`, M11 | WP0 | — |
| `lib/api/route.ts` (P1) | WP-F (maintenance gate only) | — |
| `lib/api/errors.ts` (P1) | WP-A | — |
| `lib/api/keys/system.ts`, `lib/overlays/store.ts` (P1) | WP0 | — |
| `components/shell/{AccountMenu,OnlineChip,ShellBanners,CommandPalette}.tsx` (P1; AccountMenu edited by P10) | WP-H, WP-E, WP-F, WP-D respectively | — |
| `components/layout/ViewportStage.tsx` (P1) | WP-G | — |
| `e2e/fixtures/telemetry.ts` (P1) | WP-G | — |
| P2 game client, `InGameChips.tsx`, `WS/src/http/broadcast.ts`, socket command handlers | WP-E (client), WP-F (socket) | — |
| `lib/navigation/return-to.ts` (P4, extended by P9) | WP-C | — |
| `lib/offline/outbox.ts`, Train hub client (P5) | WP-E | — |
| `components/billing/RenewSheet.tsx` (P7) | WP-A | — |
| `worker/index.ts`, `features/notifications/*`, `features/account/AccountSection.tsx`, `app/(public)/p/*` (P10) | WP-E, WP-H, WP-G, WP0 → WP-B respectively | — |
| cron task array, `lib/cron/tasks/*` | WP-B | WP-G supplies `lib/cron/tasks/consent.ts` |
| `app/api/webhook/clerk/route.ts`, `lib/auth/viewer.ts` (P1, edited by P10) | WP-C | — |
| `instrumentation-client.ts` | WP-G | WP-B's BotID init line is added by WP-G |
| `CT/http/index.ts`, `PKG/analytics/src/events/index.ts` | WP0 | each WP owns its own module file |
| `.github/workflows/deploy-oci.yml` (P2) | **not edited by P11** (the P11 × P12 clash in feasibility §7 disappears) | — |
| **Parallel P12** `(admin)` layout, `tournament:find_match` handler | P12 | WP0 tells P12 to wrap the layout in `AppProviders`; WP-F adds the one-line guard if P12 merged first, else P12 adds it |

### 13.4 Estimates

| Package | Dev-days |
|---|---|
| WP0 Foundation | 1.5 |
| WP-A Landing, pricing, walls | 2.5 |
| WP-B Templates, content, SEO, contact, licences | 2.75 |
| WP-C Auth | 3.0 |
| WP-D Errors and search | 2.0 |
| WP-E Offline, SW, update | 2.75 |
| WP-F Maintenance (P2 already ships the chip and the deploy step) | 1.0 |
| WP-G Consent and telemetry | 2.0 |
| WP-H Install and manifest | 1.0 |
| WP-I QA, gates, cleanup | 1.5 |
| **Total** | **20.0** |
| Buffer (20 %, feasibility §8; outside the allocation, owner decision Q23) | 4.0 |

### 13.5 "Launch A" cut (feasibility §8, if the owner picks it)

If the owner launches before P6, P8, P9 and P12, a thin P11 of about **8 dev-days** ships first and the rest follows after launch:

| Ships before launch | From | Days |
|---|---|---|
| Route groups, provider split, `MarketingTopNav`/`MarketingFooter`, M11 | WP0 | 1.5 |
| Pricing (S2–S4) with every state; the landing keeps its current content in the new chrome | WP-A (part) | 1.5 |
| Legal pages incl. `/licenses`, contact with `support_requests` | WP-B (part) | 1.5 |
| Auth through the **prebuilt** Clerk components inside `AuthShell` (`auth_custom_flows=false`), return banners | WP-C (part) | 0.5 |
| 404, 500, global error | WP-D (part, no search) | 1.0 |
| Maintenance page and gate | WP-F | 1.0 |
| Consent bar, preferences, PostHog/Replay gating | WP-G (part) | 1.0 |

The SW rules and the kill switch (≈ 0.5 d of WP-E) also move before launch, because P1's interim SW must never cache authenticated pages for paying users. Everything else (custom auth flows, landing redesign, blog/help/about templates, search, offline page, install and update prompts) ships after launch.

---

## 14. Risks, open questions and owner decisions

### 14.1 Risks

| # | Risk | Likelihood / impact | Mitigation |
|---|---|---|---|
| R1 | Providers in group layouts misbehave on soft navigation (duplicate clerk-js init, `useAuth` never loads, handshake loops), or Clerk's cookie names differ from what `auth-hint.ts` reads | medium / medium | day-1 spike (WP0 acceptance 1); fallback: keep the root providers, keep the cookie hint, re-measure marketing budgets (clerk-js is a CDN script and does not count in First Load JS; Lighthouse TBT is the gate) |
| R2 | Clerk custom-flow API changes (a future `@clerk/nextjs` major changes `signIn.create`/`attemptFirstFactor`) | medium / medium | pin `@clerk/nextjs` `^6.33`; every Clerk call lives in `lib/auth/clerk-flows.ts`; prebuilt fallback + `auth_custom_flows` kill switch, tested both ways (`auth-prebuilt` project) |
| R3 | Next 15.5 ignores the `status: 503` on a middleware rewrite | medium / low | accept 200 + `noindex` + `Retry-After` + `x-rc-maintenance` (only noindex `(app)` routes are rewritten); the SW plugin keys on the header, not the status |
| R4 | Edge Config reads exceed Hobby's 100k a month (middleware isolates × memo windows) | medium / medium | adaptive memo (300/120/60 s), reads only on gated document requests and in Node instances, a daily read counter in the weekly ops report; at 60 % pro-rata switch `MAINTENANCE_SOURCE=env` (maintenance by env + redeploy) |
| R5 | Resend sandbox can only email the account owner on dev; acknowledgement emails to real users wait for the P13 domain verification | certain / low | dev ack goes to replaychess007@gmail.com; support copy works; P13 adds SPF/DKIM in the Cloudflare zone (owner action, DNS only) |
| R6 | Consent lowers analytics coverage (typical opt-in 30–60 %), so funnels undercount | certain / medium | server-side events for the key steps (`account_created`, `trial_started`, `subscription_activated`); funnels built from server events; SLOs from Speed Insights and server timestamps (D21) |
| R7 | `@ducanh2912/next-pwa` cannot express a rule (precache transform, the custom per-user route) | low / medium | switch to Serwist (`@serwist/next`, same model, ≈ 1 d, inside WP-E's buffer) |
| R8 | iOS Safari evicts IndexedDB after 7 days unused; iPadOS reports Macintosh | certain / low | snapshots are caches only; detection uses `maxTouchPoints` |
| R9 | P10/P12 work overlaps P11 files (`worker/*`, AccountMenu, layouts, socket handlers) | low (P11 after P10) / low | §13.3 ownership table, the registries, lead-mediated requests |
| R10 | Stale chunks after deploys (Hobby has no skew protection) cause errors mid-session | medium / medium | `ChunkLoadError` → one hard reload + update prompt; immutable `_next/static`; update deferred in games |
| R11 | Legal copy (Terms, Privacy, Cookies, refund, licences) not final at the end of P11 | high / medium (blocks P13, not P11) | ship drafts with placeholders on dev; P13 checklist blocks launch until counsel text lands; assets without a recorded licence are listed in `THIRD_PARTY.md` as "replace before P13" |
| R12 | 20 days is tight for 41 boards plus SW, consent and auth | medium / medium | four lanes; offline bot-game sync is conditional on P2's runner; status page and lesson downloads out of scope; 4-day buffer (Q23); Launch-A cut (§13.5) |
| R13 | Vercel Hobby is non-commercial (architecture §1.13.1, feasibility F-VER-1) | known | P13 decision; P11 changes lower Pro usage anyway |
| R14 | A broken service worker is the slowest thing to roll back | low / high | `SW_KILL_SWITCH=1` build, `no-cache` on `/sw.js`, rehearsed in `sw-kill.spec.ts` and once on dev (§14.3) |
| R15 | `lib/navigation/return-to.ts` and `GET /api/return-target` have no agreed creator (P4 assumes P1, P9 assumes P4) | medium / low | WP-C creates whatever is missing at the start of P11 and keeps the exports P4 and P9 import; the consistency owner should record P4 as the creator |
| R16 | A Hobby overage pauses a feature for up to 30 days and would block development | low / high | D25: suites against `next start`, deployed smoke only, test traffic stops at 60 % of any quota; the weekly ops report watches CDN requests, Edge Config reads and Speed Insights events |

### 14.2 Open questions and decisions needed from the owner

Defaults below are what the plan builds if no answer arrives before the package starts. All rows go into `docs/decisions.md`, where a default applies unless the owner objects within 3 days (feasibility §8).

| # | Question | Default | Needed by |
|---|---|---|---|
| Q1 | Cookie bar worldwide, or only EU/UK/CH (`x-vercel-ip-country`)? (sys Q9) | **Worldwide** (simpler; copy is benign) | WP-G start |
| Q2 | Is Sentry error capture without PII and without Replay "essential" (no consent needed)? (sys Q10) | **Yes**, disclosed in the cookie policy | WP-G start |
| Q3 | Status page for `status.playchess.tech`: UptimeRobot free status page (commercial-use terms to verify, feasibility V5), Better Stack free, or the Sentry uptime monitor? (sys Q5) | none in P11; links hidden until set (`NEXT_PUBLIC_STATUS_URL`); prefer the Sentry uptime monitor if UptimeRobot's free terms exclude commercial use | P13 |
| Q4 | Apple sign-in at launch? | **Off** (flag `NEXT_PUBLIC_AUTH_APPLE`); needs an Apple developer account | WP-C |
| Q5 | Legal entity name, `[COMPANY NAME] · [YEAR]`, support address (`hello@playchess.tech`?), founding story, team row, SLA "one working day" | `hello@playchess.tech`, footer "ReplayChess · 2026", placeholders kept on About and legal pages | P13 |
| Q6 | Refund policy: keep the "30-day money-back guarantee" in `lib/billing/copy.ts:44,63` or drop it? (pub Q6) | **Drop the claim** from FAQ and copy until the Terms state one; Help answers "Contact us within 14 days…" only if confirmed | WP-A |
| Q7 | Keep Google Analytics behind consent, or delete it? (pub Q17) | **Delete** (PostHog covers it; copy names PostHog only) | WP-G |
| Q8 | "Keep me signed in" checkbox (no Clerk equivalent) | **Omit** | WP-C |
| Q9 | Accept Clerk's account-enumeration behaviour (`unknown_email`, `email_taken`) or enable enumeration protection with a generic error? | **Accept** (matches the boards) | WP-C |
| Q10 | Server-side PostHog events without browser consent (`account_created`, billing truths, marked `consentExempt`) | **Yes**, as service operation, disclosed in Privacy | WP-C |
| Q11 | Pricing row "Ask the coach · Unlimited questions" vs the fair-use cap | **"About any move, fair use applies"**, numbers from `CT/limits.ts`: members 30/day and 150/month, trial 10/day and 40 total (feasibility F-LLM-3; P7 D6's 300/month must change to match) | WP-A |
| Q12 | `support_requests` table (D9, addition to data-model) vs email-only contact | **Add the table** (durable, retryable, 180-day retention) | WP0 |
| Q13 | Default billing interval on pricing: design **monthly** vs code/e2e yearly (pub Q5) | **Monthly** unless P4 already fixed `DEFAULT_PLAN` | WP-A |
| Q14 | B26 lapsed read-only access (decided before P3, coverage C-21) — confirms which `V3PaywallSoft` path ships | as decided; if still open at WP-A start, the default hard redirect ships | WP-A |
| Q15 | Offline bot games: allowed, unrated, synced on reconnect and rejected for lapsed members (sys C4) | **Yes** if P2's runner supports local games; else the offline rows and the queue's offline CTA are hidden | WP-E |
| Q16 | Scheduled-maintenance info banner in the shell (no board, sys Q6) | **Ship** with the `Banner` info style | WP-F |
| Q17 | Anonymous consent rejections are not stored (D7) | **Not stored** | WP-G |
| Q18 | Help copy fixes (reset by code, import timing, disconnect rule, fair use) | apply as listed in S8 | WP-B |
| Q19 | Resend domain verification for `playchess.tech` (adds SPF/DKIM records to the production Cloudflare zone, DNS only) | P13 owner action | P13 |
| Q20 | Database procedure wording (consistency R-20: no `db push` on any Neon branch; CLAUDE.md still allows it on dev) | P11 uses only `migrate deploy` on the dev branch; the CLAUDE.md wording is the owner's call | WP0 |
| Q21 | May Sentry record anonymous client performance metrics (`{ route_class, device_class }`, no user id) without consent, like error capture? (api-perf AP-15) | **No** in P11; SLOs use Speed Insights (cookieless) and server timestamps | WP-G |
| Q22 | `/licenses` as a fourth link in the legal document switcher (the board shows three) | **Yes** | WP-B |
| Q23 | Add the 4-day buffer to P11, and adopt the Launch-A cut (§13.5)? | buffer **yes**; Launch-A is the owner's calendar decision | before WP0 |

### 14.3 Rollback

| What | How | Time to effect |
|---|---|---|
| Service worker | build and deploy with `SW_KILL_SWITCH=1` (§7.6): the new worker unregisters itself, deletes every cache and reloads open tabs; then fix forward and redeploy without the flag | next navigation of each client (`/sw.js` is `no-cache`) |
| Custom auth flows | Edge Config `flags.auth_custom_flows=false` | ≤ 300 s (memo) |
| Consent bar | `NEXT_PUBLIC_CONSENT_BAR=off` + redeploy (fails closed: no analytics) | ≈ 2 min |
| Maintenance stuck on | `pnpm --filter web notice:clear` (Edge Config + broadcast); if Edge Config is unreachable, `MAINTENANCE_SOURCE=env`, `MAINTENANCE_MODE=off` + redeploy | ≤ 300 s / ≈ 2 min |
| Web deploy | Vercel Instant Rollback (Hobby reaches only the previous deployment, feasibility §9) | seconds |
| M11 | additive; no rollback needed; the old client ignores the new tables | — |
| Marketing pages | the old site stays live on `main` until P13 | — |

Runbooks: `docs/runbooks/rollback.md` (§"Service worker", §"Auth"), `docs/runbooks/maintenance.md`.

---

## 15. Definition of done

- [ ] **Deployed** to `dev`: Vercel `replay-chess-dev` green; the Neon dev branch (CLAUDE.md) on M11 via `prisma migrate deploy` (no `migrate dev`, no `db push`); OCI dev socket redeployed with the `notice` broadcast and the maintenance guard; Clerk dev instance configured (paths, email code, bot protection, session token claims); Edge Config `replay-ops` connected with `notice: null` and `flags.auth_custom_flows: true`; `NEXT_PUBLIC_CONSENT_BAR=on`; Speed Insights at 0.2.
- [ ] **Boards:** all 41 boards have a reachable route; `state-coverage` shows 0 missing states for them, and every demo-only state has a written reason (testing X8).
- [ ] **Routes:** `/`, `/pricing` (all states and banners), `/about`, `/blog`, `/blog/category/*`, `/blog/[slug]`, `/help`, `/contact`, `/terms`, `/privacy`, `/cookies`, `/licenses`, `/press`, `/careers`, `/community`, `/sign-in`, `/sign-up`, `/sign-up/verify`, `/reset-password`, `/sso-callback`, `/offline`, `/maintenance`, 404 (3 variants, status 404), 500 (3 boundaries, status 500), global error; `/docs/api` → `/help`; `/api/healthcheck` removed; `/p/{u}` in the v3 chrome.
- [ ] **Lit slots:** the queue's "Play vs bot offline" (C-10), Settings › Privacy "Cookie settings" and Settings › Notifications "Install app" (C-13), `/help#fair-use` (C-19), Pricing → Help (E3, C-20), How we grade → Pricing (E2, C-18), guest profile header (C-22).
- [ ] **APIs:** `GET /api/search`, `GET /api/me/search`, `GET /api/return-target`, `POST /api/contact`, `PUT`/`GET /api/consent`, `POST /api/feedback`, `GET /api/system/notice` implemented with `route()`, zod contracts, the envelope, cache tiers and the limits of §7 (no window > 60 s on the UNLOGGED table); contract tests green; OpenAPI diff reviewed.
- [ ] **Middleware:** matcher exclusions (static marketing, public APIs), scanner early-return, auth-page rule, maintenance gate; unit tests green; webhooks/internal/cron/health never blocked.
- [ ] **Consent:** no PostHog, GA or Replay network traffic before consent (spec); GA removed; Sentry `sendDefaultPii:false` on client, server and edge; proof rows written as specified; Cookie settings reachable from both footers and Settings; the consent-aware telemetry fixture is merged and the **whole** suite is green with it; `consent-reject.spec.ts` green.
- [ ] **SW/PWA:** precache ≤ 600 KB; no `/api` or RSC entries in Cache Storage; page cache per user; offline page and allow-list work; update deferred during a live game; kill-switch build rehearsed on dev; manifest passes Chrome installability; install prompts on desktop, Android, iPhone and iPad P.
- [ ] **Legacy removed:** `PricingContent.tsx`, old landing sections, `Navbar`/`Footer`/`LegalPageLayout`/`DirectoryBadges` (moved), `GoogleAnalytics`, `PostHogIdentify`, `PWAUpdateBanner`, `InstallAppPopover`, `IOSInstallModal`, `usePWAInstall`, `usePWAUpdate`, old sign-in, old error pages, `/api/healthcheck` — after the parity check against the live site on `main`.
- [ ] **CI green** on the final `dev` SHA with `BILLING_PAYWALL=on`: lint (0 new warnings), `check-types`, `test:unit`, `test:int`, drift gate, bundle budgets (§9.1, blocking), SW precache check, Lighthouse CI budgets, Playwright flow specs (§12.3), the device × zoom suite with the lock/flow assertions and CLS ≤ 0.05, axe with no serious/critical violations, `sw-on` (every phase's `@smoke` plus the P11 SW specs), `auth-prebuilt` (both auth-flag values), `prod-guard.spec.ts` with the P11 hooks; post-deploy `@smoke` against the dev URL green.
- [ ] **Regression:** the whole suite plus `flags-off`, and the targeted P1–P10 (and P12 if merged) checks of §12.4, including coach SSE, push and weakness under the new SW.
- [ ] **Owner test** (§1) passed on the dev URL with ego-browser and on a real iPhone and a real Android phone; every defect has a regression test; `docs/qa/phase-11-signoff.md` committed; browser tabs closed afterwards.
- [ ] **No new errors:** `scripts/qa/error-window.ts` shows no new Sentry issue and no Vercel runtime error for ≥ 24 h after the last dev deploy (or each is triaged in the sign-off); no PII in P11 events.
- [ ] **Telemetry:** every event in §10.1 registered with a zod schema, asserted through the sink in at least one spec, arriving in PostHog with `app_env=dev` only after consent; server event `account_created` exactly once per sign-up.
- [ ] **Performance:** k6 P11 scenario within §9.1 on dev with results in `perf/results/`; `EXPLAIN` plans attached; Edge Config read usage recorded against the 100k quota.
- [ ] **Docs:** this file linked from `docs/implementation-plan.md`; `docs/runbooks/{maintenance,rollback}.md`; owner decisions Q1–Q23 recorded in `docs/decisions.md` with their answers or the defaults used.

---

## Appendix A. Critique dispositions

Every finding in the five critiques that concerns P11. "Fixed" names where this file now answers it; "Rejected" gives the reason in one line; "Partly" says which part is kept.

### A.1 Coverage (`critique-coverage.md`)

| ID | Finding | Disposition |
|---|---|---|
| C-10 | Queue `offline` "Play vs bot offline" has no owner | **Fixed**: §2.4 row, WP-E edit to P9's queue state, `offline.spec.ts` |
| C-13 | P11 expects Settings rows (Cookie settings, Install app) that P10 does not specify | **Fixed**: P11 lights them and adds them to P10's sections if absent (WP-G, WP-H), specs in §12.3 |
| C-18 | Edge E2 (How we grade → Pricing) missing until P11 | **Fixed** from P11's side: `/how-we-grade` moves into `(marketing)` with the top-nav Pricing link and the full footer (§2.4, `marketing.spec.ts`); the interim P3 fix stays P3's |
| C-19 | `/help#fair-use` anchor not defined | **Fixed**: S8 Q&A `fair-use` rendering `CT/limits.ts` (D22) |
| C-20 | Edge E3 (Pricing → Help) has no link | **Fixed**: S2 "More questions? Help Center" → `/help#billing` |
| C-21 | B26 still open; S4 wording | **Fixed** (wording): S4 builds both paths, Q14 says the default ships if B26 is still open; the decision itself is the owner's |
| C-22 | v3 header on `/p/{u}` never mentioned | **Fixed**: D1, §4.0, WP0/WP-B move and chrome swap, spec |
| §5 deviation `V3Pricing` "Unlimited questions" | confirm with the owner | **Fixed**: Q11 with the numbers |
| §5 deviation `V3PaywallSoft` usage pips | confirm with the owner | Kept as documented in S4 (Phase 0 removed the meter) |

### A.2 Consistency (`critique-consistency.md`)

| ID | Finding | Disposition |
|---|---|---|
| 11.1 | `409 payment_update_required` | **Fixed**: 402 everywhere (S2, S4, §5.2, D18) |
| 11.2 | outbox `rc-train-outbox` | **Fixed**: `rc-outbox` (§2.3) |
| 11.3 | `RC_INTERNAL_KEYS` | **Fixed**: `x-internal-token` + `INTERNAL_API_SECRET` (D19, §7.5, §7.9) |
| 11.4 | P7 and P10 dependencies; fallback | **Fixed**: header, §2.3, D18 fallback, §13.3 |
| 11.5 | `SupportRequest` must be merged into data-model | Noted: D9; the data-model edit is the data-model owner's (consistency §3 lists it) |
| 11.6 | M11 name | Consistent, no change |
| R-01 | `game_players."playedAt"` (4 occurrences) | **Fixed**: `"endedAt"` and P2's `game_players_userId_endedAt_gameId_idx`; member search uses `"opponentName"` |
| R-02 | `user_settings.consent` exists (P9) | **Fixed**: M11 no longer adds it (§6.1, §6.2) |
| R-06 | code ledger, `codes.ts`, statuses | **Fixed**: §7 intro lists the codes P11 uses; none added |
| R-07 | `system:notice` in the registry; `server:restarting` payload | **Fixed**: D17, §7.2 (`{ restartAt, resumes }`) |
| R-09 | env names (`HASH_PEPPER` for IPs, `NEXT_PUBLIC_SITE_URL`, `WEB_APP_URL`) | **Fixed**: `RATE_LIMIT_IP_PEPPER` for IP hashes; §7.9 |
| R-10 | `CT/` paths; drift gate owner | **Fixed**: shorthand table, §7.2, §6.4 (P2's `scripts/db/check-drift.ts`) |
| R-13 | limits as `limit / windowSec` | **Fixed**: §7.1 |
| R-14 | P11 flag mechanisms | Consistent; the P13 `consent_bar` fix is P13's |
| R-16 | storage names | **Fixed** |
| R-18 | `checkout_start_failed` (P4) and `server_restart_notice_shown` (P2) re-declared | **Fixed**: §10.1 marks both "reused" |
| R-19 | P11 depends on P7 and P10 | **Fixed**: header, §2.3 |
| R-20 | no `db push`; dev branch IDs | **Fixed**: §6.4, Q20 |

### A.3 Feasibility (`critique-feasibility.md`)

| ID | Finding | Disposition |
|---|---|---|
| §10.17 #1, F-LLM-3, #7 | one coach-cap number plus trial caps | **Fixed**: D22, Q11 |
| §10.17 #2, §9 | emergency kill-switch SW build and runbook | **Fixed**: D11, §7.6, §14.3, `sw-kill.spec.ts` |
| §10.17 #3, F-VER-6 | Edge Config 100k reads, counter in the weekly report | **Fixed**: D10 adaptive memo, R4, §9.5, WP-F |
| §10.17 #4, LIC-2, LIC-5 | third-party licences page | **Fixed**: D24, S10, WP-B |
| §10.17 #5, V5 | status-page terms | **Fixed**: Q3 |
| §10.17 #6, §10.16 #4, §7 | ownership split with P10; registries as directories | **Fixed**: §13.3 (P11 after P10, fallback split), §13.1 registries |
| F-VER-2, F-VER-3 | overage pause; test traffic on the deployed dev site | **Fixed**: D25, R16, §12.0 |
| F-VER-5 | Speed Insights 10k events per 30 days | **Fixed**: D21 (`sampleRate={0.2}`) |
| SEC-3 | dev site is public | **Partly**: P11 makes the dev site `noindex`/disallowed and sends the bypass header from automation; turning on Vercel Authentication is P1's |
| SEC-4, AP-44 (HMAC from P2) | static token has no replay protection | **Rejected for P11**: P11 follows consistency R-08 (what P2 ships); a switch to HMAC changes P2's shared helper for every hop and needs no P11 change (D19) |
| SEC-9 | CSRF same-origin | **Fixed** in §11's CSRF row (P1 implements the rule) |
| §8 buffer, "Launch A" | 20 % buffer; thin P11 | **Fixed**: §13.4 buffer line, §13.5 cut, Q23 |
| #6 phase crosswalk | architecture docs use old phase numbers | Not P11's file; P11 cites the new numbers |

### A.4 Testing (`critique-testing.md`)

| ID | Finding | Disposition |
|---|---|---|
| P11 / X6.5 | consent breaks earlier telemetry assertions | **Fixed**: §12.0 telemetry row, WP-G edits the fixture, `consent-reject.spec.ts`, `consentExempt` |
| P11 regression scope | misses P6, P7, P10 | **Fixed**: §12.4 (whole suite + targeted coach SSE, push, weakness under `sw-on`) |
| P11 `sw-on` project | SWs blocked in devices config | **Fixed**: §12.3 projects, WP-E |
| P11 auth flag both ways | only unit-tested | **Fixed**: `auth-prebuilt` project |
| P11 telemetry | `landing_viewed` after consent; `account_created` once | **Fixed**: §7.7 (`provisionUser()`), landing and sign-up specs |
| P11 error statuses | assert HTTP status per variant | **Fixed**: `errors.spec.ts` |
| P11 DoD additions | four lines | **Fixed**: §15 |
| X1 | `WS` Vitest; `WEB/tests/api` | **Fixed**: `node:test`; `WEB/test/api/` |
| X2, X16 | CI e2e on `dev`; Docker Postgres | **Fixed**: §12.0 |
| X3 | paywall off in CI | **Fixed**: §12.0 |
| X4 | shared users and Clerk churn | **Fixed**: leased personas, throwaway sign-up/reset users, Q/R read-only |
| X5 | server time | **Fixed**: `x-rc-now` in the maintenance spec |
| X8, X9, X10, X11, X12, X14, X15, X18 | state tags, tiers, visual settings, full-suite regression, hook registry, defect rule, sign-off record, perf data | **Fixed**: §12.0 rows, WP-I, §15 |

### A.5 API and performance (`critique-api-perf.md`)

| ID | Finding | Disposition |
|---|---|---|
| §4.16 #1, AP-34 | `rc-pages` shared across users | **Partly**: per-user `rc-pages:u:<ref>`, `SET_USER` persisted in Cache Storage, no cache without a known user (§7.6). **Rejected part**: "the SW reads `__client_uat` from the request's `Cookie` header" — `Cookie` is a forbidden header a SW cannot read; `self.cookieStore` is used where it exists |
| §4.16 #2, AP-33 | root 404 dynamic; scanner probes | **Fixed**: static root 404 with the pre-paint hint (S16), scanner early-return (§7.4) |
| §4.16 #3, AP-48 | `QueryProvider` in the root layout | **Fixed**: D2 |
| §4.16 #4, AP-12 | "`api()` parses responses" in production | **Fixed**: §7 intro (`devSchema()`), bundle gate |
| §4.16 #5, AP-11 | hourly windows on the UNLOGGED table | **Fixed**: D20, §7.1, contract test with a truncated bucket table |
| AP-29 | return-target leaks private game labels/FENs | **Fixed**: D23. `challenge` kind kept because P9's challenge preview is public by design (the code is the secret) |
| AP-15 | SLOs from consent-gated PostHog | **Fixed** for P11's SLOs (D21); the anonymous-Sentry-metrics question is Q21 |
| AP-03 | `P+` routes on the CDN | Consistent: search is split into two paths (D16) |
| AP-14 | headers from RSC pages | **Fixed** for P11's `X-Robots-Tag` (§7.4 step 8) |
| AP-07 | `playedAt` as the one per-user column | **Rejected for P11**: P11 follows consistency R-01 (`endedAt`, which P2's M2 already ships); whichever name the plan set settles on changes one `ORDER BY` here |
| AP-04 | sign-out must clear the browser HTTP cache | Consistent: P11's `signOutEverywhere` additions run after P1/CDL's cache-clear step; P11 adds no per-user `max-age` |
