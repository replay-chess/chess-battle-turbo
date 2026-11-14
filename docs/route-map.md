# Replay Chess route map

Status: Phase 1 deliverable **1A·DOC**, 2026-11-05, branch `dev`. This is the canonical route table for the whole coaching app: every route, the design boards it renders, the phase that ships it, the feature flag that gates it and its auth class. It is the reference for:

- the middleware route classes in `apps/web/lib/auth/route-classes/` (`p01.ts` is written from §3 below, then hand-maintained; later phases add `pNN.ts`, plan [§7.6](plan/phase-01-design-system-app-shell-and-api-foundations.md));
- the unit test `apps/web/lib/auth/route-classes/route-classes.test.ts`, which **reads the lists in §3** and checks that `classify()` agrees with them;
- the shell destinations in `apps/web/lib/nav/destinations.ts` ([SPEC](plan/phase-01a-spec.md) §8.2).

**Sources.** Built from the canonical route proposal of the flow-map inventory (`SP/plan/inv-sys.md` §1.5, an archived scratch input of the planning session that is not in the repo; its 105 flow-map edges are reproduced in [plan/07-design-coverage.md](plan/07-design-coverage.md)), the board table of [plan/allocation.md](plan/allocation.md) §4.2, and the route sections of each phase plan in [plan/](plan/README.md). Where a phase plan is more specific than the inventory (for example `/t/[slug]` instead of `/tournaments/[slug]`), the phase plan wins, as [plan/README.md](plan/README.md) §2.3 rules. The "P1 class today" column of §4 is computed from the P1 patterns in plan §7.6, not typed by hand.

---

## 1. Auth classes

| Class | Who gets the page | Enforced by | Signed-out visitor |
|---|---|---|---|
| `public` | everyone | nothing (page may still personalise when signed in) | sees the page |
| `public_static` | everyone | nothing, and Clerk does not run (the page reads no session: ISR snapshots such as P3's `/r/<code>`) | sees the page |
| `public (dev only)` | everyone in dev and test; **404** in a production-mode build | `devRoutesEnabled()` (SPEC D11) and the test-hook registry (`prod-guard.spec.ts`) | sees the page on dev |
| `signed_in` | any signed-in user, member or not (onboarding, checkout, account and membership settings) | middleware (`redirectToSignIn`) | → `/sign-in?redirect_url=…` |
| `member` | an entitled member or trialist (and admins) | middleware sign-in redirect; member gate on the `md.entitled` claim when `MIDDLEWARE_MEMBER_GATE=on` (plan §7.6 step 6); the page-level `requireMemberPage()` decides when the claim is missing | → `/sign-in`; non-member → `/pricing?reason=required`, lapsed → `/pricing?reason=ended` |
| `admin` | `role = ADMIN` | middleware treats it as `signed_in`; `requireAdmin()` in the `(admin)` layout | → `/sign-in` |
| `api` / `api_no_clerk` | API routes; middleware never redirects them. `api_no_clerk` (webhooks, cron, health, `/api/openings`) skips Clerk entirely. `/api/scraper/*` stays `api`: its admin-session fallback calls Clerk's `auth()`, which needs the middleware | handlers answer 401/402/403 | — |
| `scanner` | probe paths (`.php`, `.env`, `.git`, `wp-*`, …) | middleware answers 404 before Clerk | 404 |

A page that matches no list is treated as signed-in-only by middleware (it redirects every non-public page, plan §7.6 step 5); §4 shows it as `signed_in (default)`.

## 2. Route groups (IS §1.5, P11 D1)

| Group | Holds | Chrome |
|---|---|---|
| `app/(marketing)` (with `(learn)` inside it from P8) | landing, pricing, how-we-grade, about, blog, help, contact, legal, press, careers, community, and from P8 the public learn catalogue | marketing header and footer, scrolling pages |
| `app/(auth)` | sign-in, sign-up, verify, reset password | branded Clerk shell |
| `app/(onboarding)` | `/onboarding/*`, `/checkout/activating` | focused, no shell |
| `app/(app)` | every members-only page (one-viewport app shell: sidebar, rail or tab bar) | v3 shell (`shell-v3`) |
| `app/(app)/(immersive)` | board-first routes that hide the phone tab bar (game, review, puzzles, lessons, practice) | shell without tab bar |
| `app/(shared)` (P9), `app/(public)` (P10) | links opened by anyone: challenge `/join/[code]`, shared position `/s/[code]`, guest profile `/p/[username]` | shell chosen by session |
| `app/(admin)` (P12) | `/admin/*` | compact desktop layout |
| `app/(system)` and root | `/offline`, `/maintenance` (P11), `/too-many-requests` (P1), the review snapshot `/r/[code]` (P3), `not-found`, `error`, `global-error` | static frame |
| `app/dev` | `/dev/ui/**` demo and gallery routes | dev only |

In Phase 1 the existing signed-in pages (play, queue, challenge, join, join-tournament, legends, openings, position, profile, tournament, tournaments) were moved into `app/(app)` by 1A·P4 without changing their URLs. `/legends` and `/openings` move to `(marketing)/(learn)` in P8.

## 3. Phase 1 route classes (machine-readable)

These lists are **concrete paths** (not patterns) that the Phase 1 classifier must place in each class. `route-classes.test.ts` parses them; when a later phase changes a class (see §5), it edits the list here in the same PR as its `pNN.ts`.

**Format, for parsers.** Each list is the first fenced `text` block after a marker line `<!-- route-classes:p01:<class> -->`, where `<class>` is one of `public`, `member`, `signed_in`, `api_no_clerk`, `scanner`. One path per line; blank lines and lines starting with `#` are ignored. A parser should fail when a marker is missing or its list is empty, so the test can never pass vacuously:

```ts
// apps/web/lib/auth/route-classes/route-classes.test.ts (sketch)
const doc = readFileSync(join(REPO_ROOT, "docs/route-map.md"), "utf8");
function listFor(cls: string): string[] {
  const at = doc.indexOf(`<!-- route-classes:p01:${cls} -->`);
  assert.ok(at >= 0, `route-map.md has no ${cls} list`);
  const body = /```text\n([\s\S]*?)```/.exec(doc.slice(at))?.[1] ?? "";
  const paths = body.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
  assert.ok(paths.length > 0, `${cls} list is empty`);
  return paths;
}
for (const p of listFor("public")) assert.equal(classify(p), "public", p);
```

<!-- route-classes:p01:public -->
```text
# Marketing and company pages (P11 restyles them; public from day one)
/
/about
/blog
/blog/some-post
/blog/category/openings
/blog/author/x
/blog/editorial-policy
/blog/rss.xml
/careers
/community
/contact
/cookies
/docs/api
/help
/press
/pricing
/privacy
/terms
# Public, indexable catalogue (P8 rebuilds it)
/learn/legends
/learn/openings
/legends
/legends/paul-morphy
/openings
/openings/italian-game
/og
# Legacy public profile (P10 replaces it with /@username)
/profile/x
# Auth (Clerk)
/sign-in
/sign-in/factor-one
/sign-up
# System
/too-many-requests
# Dev-only routes (404 in production builds through devRoutesEnabled(), not through middleware)
/dev/ui
/dev/ui/shell
/dev/ui/stage
/dev/ui/skeletons
/dev/ui/data
# Crawler and PWA files
/sitemap.xml
/sitemap-legends.xml
/sitemap-openings.xml
/robots.txt
/manifest.json
```

<!-- route-classes:p01:member -->
```text
/play
/queue
/challenge/new
/join/x
/join-tournament/x
/position/x
/tournaments
/tournament/x
/game/x
/analysis/x
```

<!-- route-classes:p01:signed_in -->
```text
/onboarding
/admin
/admin/legends
/checkout/activating
```

<!-- route-classes:p01:api_no_clerk -->
```text
/api/webhook/dodo-payments
/api/webhook/clerk
/api/cron/daily
/api/health
/api/healthcheck
/api/openings
# /api/scraper/* is class `api`, not here: its requireAdmin() fallback calls Clerk's auth()
```

<!-- route-classes:p01:scanner -->
```text
/wp-login.php
/x/.env
/index.php
/legends/x.php
/.git/config
```

The test also keeps the boundary cases of plan §11 (route-classes row): `/playlist` is not `/play`; `/join-tournament/x` is member through its own pattern, not through `/join`.

## 4. Whole-app route table

One row per route (or family of routes that share boards and class). **Boards** are the v3 board names of [allocation.md](plan/allocation.md) §4.2 (files `DR/<Name>.dc.html`; "+N devices" counts the iPhone, Android, iPad landscape and iPad portrait boards of the same screen). **Flag** is the PostHog flag of [allocation.md](plan/allocation.md) §1.6 that switches the route to its v3 version; "—" means the route has no v3 switch. **Auth class (target)** is the class the route has once its phase ships; **P1 class today** is what the Phase 1 classifier returns for a sample path, so a difference means the owning phase must add a pattern (§5).

| Route | Boards (ALLOC §4.2) | Phase | Flag | Auth class (target) | P1 class today | Group | Notes |
|---|---|---|---|---|---|---|---|
| `/dev/ui`, `/dev/ui/sections/[id]` | — (kit gallery, SPEC §3.7) | P1 | — | public (dev only) | public | root `app/dev` | fails closed outside dev/test (`devRoutesEnabled()`, SPEC D11) |
| `/dev/ui/shell` | V3Nav, V3PaymentFailed, V3Toasts (+2 devices), V3CommandPalette, V3Shortcuts | P1 | — | public (dev only) | public | root `app/dev` | 1A·P3, 1A·P7 users |
| `/dev/ui/stage` | — (BoardStage demo) | P1 | — | public (dev only) | public | root `app/dev` | 1A·P5 |
| `/dev/ui/skeletons` | V3Skeletons, V3EmptyStates | P1 | — | public (dev only) | public | root `app/dev` | 1A·P7 |
| `/dev/ui/data` | V3RateLimited, V3SessionExpired | P1 | — | public (dev only) | public | root `app/dev` | 1B·F8 data-layer demo |
| `/too-many-requests` | V3RateLimited | P1 | — | public | public | root (static system) | `noindex`; middleware rewrite target for the optional document limiter |
| (every `(app)` page) | V3Nav (shell), V3Toasts, V3CommandPalette, V3Shortcuts, V3Skeletons, V3EmptyStates, V3PaymentFailed, V3SessionExpired | P1 | `shell-v3` | — | — | `(app)` | the shell wraps the legacy pages moved into `(app)` by 1A·P4 |
| `/game/[ref]` | V3Game (+4 devices), V3StudyPhase, V3GamePrototype, V3GameTheirMove, V3GameBot, V3Spectate, V3GamePremove, V3GameCheck, V3GameIllegal, V3GamePromotion, V3GameLowTime, V3GameDrawOffer (+4), V3GameResign, V3GameOppDisconnected, V3GameReconnecting, V3GameOver, V3GameOverLoss, V3GameOverDraw, V3GameOverTimeout, V3RematchOffer, V3iPhone/Android/iPadL/iPadPGameOver, V3MoveBoard | P2 | `game-v3`, `live-protocol-v2` | member | member | `(app)/(immersive)` | P12 adds V4TournamentGame, V4TournamentGameOver; P3 adds V3GameOverLegend |
| `/review/[ref]` | V3ReviewAnalysing, V3ReviewFailed, V3ReviewClean, V3ReviewSummary, V3KeyMoments, V3iPhone/iPadL/iPadP/AndroidReview | P3 | `review-v3` | member | signed_in (default) | `(app)/(immersive)` | players only; `/analysis/[gameId]` → 308 here |
| `/review/[ref]/complete` | V3RvComplete, V3RvCompleteClean | P3 | `review-v3` | member | signed_in (default) | `(app)` |  |
| `/review/[ref]/share` | V3RvShare | P3 | `review-v3`, `review-share` | member | signed_in (default) | `(app)` |  |
| `/review/[ref]/legend` | V3LegendCompare, V3TryCompare, V3GameOverLegend (teaser) | P3 | `review-v3` | member | signed_in (default) | `(app)` |  |
| `/r/[code]` | V3RvShare (public snapshot) | P3 | `review-share` | public_static | signed_in (default) | root `app/r` (a route handler, `route.ts`) | plain HTML with one inline island, no root layout or Next client runtime (Lighthouse G5); ISR (`force-static`, `revalidate = 3600`); no Clerk in middleware |
| `/games` | V3GamesArchive, V3GamesArchiveFilters, V3GamesArchiveEmpty | P3 | `review-v3` | member | member | `(app)` | nav item Review |
| `/practice` | V3Practice | P3 | `review-v3` | member | signed_in (default) | `(app)/(immersive)` |  |
| `/how-we-grade` | V3HowWeGrade | P3 | — | public | signed_in (default) | `(marketing)` | indexable |
| `/onboarding`, `/onboarding/{welcome,link,confirm,level,goals,plan,activating,done}` | V3OnbWelcome, V3OnbLink, V3OnbPreview, V3OnbRating, V3OnbGoals, V3OnbPlan, V3OnbActivating, V3OnbDone (each +iPhone, iPad) | P4 | `onboarding-v3`, `import-v3` | signed_in | signed_in | `(onboarding)` | lapsed → `/pricing?reason=ended` |
| `/checkout/activating` | V3CheckoutActivating | P4 | `onboarding-v3` | signed_in | signed_in | `(onboarding)` |  |
| `/settings/connected` | V4SettingsConnected, V4SettingsConnectedError | P4 | `import-v3` | signed_in | signed_in (default) | `(app)` | signed in, not member (IS §1.5) |
| `/home` | V3Home, V3HomeNewUser, V3HomeLoading | P5 | `home` | member | signed_in (default) | `(app)` | signed-in visitors on `/` go here (IS §1.5) |
| `/train` | V3TrainHub (+4 devices), V3TrainHubDone, V3TrainHubLoading | P5 | `train` | member | signed_in (default) | `(app)` |  |
| `/train/bank` | V3MistakeBank (+4 devices), V3BankEmpty, V3BankCaughtUp, V3BankLoading, V3iPhone/iPadL/iPadP/AndroidBank | P5 | `train` | member | signed_in (default) | `(app)` |  |
| `/train/bank/session` | V3BankSession | P5 | `train` | member | signed_in (default) | `(app)/(immersive)` |  |
| `/train/puzzles` | V3PuzzleSolve, V3PuzzleHint, V3PuzzleWrong, V3PuzzleCorrect, V3PuzzleSolution, V3PuzzleThemes, V3iPhone/iPadL/iPadP/AndroidPuzzle | P5 | `train` | member | signed_in (default) | `(app)/(immersive)` |  |
| `/train/session/[ref]/summary` | V3SessionSummary, V3SessionPerfect | P5 | `train` | member | signed_in (default) | `(app)` |  |
| `/train/weakness` | V3WeaknessInsufficient, V3WeaknessComputing, V3WeaknessProfile (+4 devices) | P6 | `weakness` | member | signed_in (default) | `(app)` | `/weakness` → `/train/weakness` |
| `/train/weakness/[pattern]` | V3WeaknessDrill | P6 | `weakness` | member | signed_in (default) | `(app)` | sheet over the profile on phones and iPad P |
| `/review/[ref]/coach` | V3CoachSuggested, V3CoachExplain, V3CoachTyping, V3CoachStreaming, V3CoachError, V3CoachRateLimit, V3CoachPaywall, V3iPhone/iPadL/iPadP/AndroidCoach | P7 | `coach` | member | signed_in (default) | `(app)` | players only |
| `/coach` | (same boards, general scope) | P7 | `coach` | member | signed_in (default) | `(app)` | `?q=`; ⌘K Ask mode |
| `/legends` | V3LegendsCatalogue, V3LegendsEmpty | P8 | `learn-v3` (member slots only) | public | public | `(marketing)/(learn)` | indexable, static |
| `/legends/[slug]` | V3LegendDetail, V3LegendGameOpera, V3LegendGameAnderssen, V3LegendGamePaulsen | P8 | `learn-v3` (member slots only) | public | public | `(marketing)/(learn)` | a cuid param redirects to the slug |
| `/legends/positions` | V3TryCatalogue | P8 | — | public | public | `(marketing)/(learn)` | `/try`, `/try/*` and `/position/[ref]` → here |
| `/legends/positions/[slug]` | V3TryPosition (+iPhone, iPad) | P8 | — | public | public | `(marketing)/(learn)` | play is members only |
| `/play/legend/[slug]` | V3TryGame, V3TryGameKT, V3TryGameBF, V3TryGameAK, V3TryGameTS (each +4 devices), V3TryGameOver | P8 | `learn-v3` | member | member | `(app)` | then P2's `/game/[ref]` |
| `/openings` | V3OpeningsCatalogue | P8 | — | public | public | `(marketing)/(learn)` | `/openings?eco=X` → `/openings/eco/x` |
| `/openings/eco/[letter]` | V3OpeningsCatalogue (`family`) | P8 | — | public | public | `(marketing)/(learn)` |  |
| `/openings/[slug]` | V3OpeningDetail | P8 | — | public | public | `(marketing)/(learn)` |  |
| `/learn/openings` | V3LearnOpenings | P8 | — | public | public | `(marketing)/(learn)` | `/learn` → `/legends` |
| `/learn/openings/drill/[slug]` | V3LearnOpenings (drill) | P8 | `learn-v3` (saving) | public | public | `(marketing)/(learn)` | saves for members only |
| `/learn/legends` | V3LearnLegends | P8 | — | public | public | `(marketing)/(learn)` |  |
| `/learn/lessons/[slug]` | V3LessonPlayer (+4 devices), V3LessonGuess | P8 | `learn-v3` | member | public | `(app)/(immersive)` | **P8 must add a member pattern**: P1's `/learn(.*)` is public |
| `/learn/lessons/[slug]/complete` | V3LessonComplete | P8 | `learn-v3` | member | public | `(app)` | same note |
| `/play` | V3PlayHub (+4 devices) | P9 | `play-hub-v3` | member | member | `(app)` | flag off → legacy play page |
| `/play/online` | V3Queue (+4 devices), V3NoOpponent, V3MatchFound (+4 devices) | P9 | `play-hub-v3` | member | member | `(app)` | `/queue`, `/play/queue` → here |
| `/play/friend/[code]` | V3ChallengeShare | P9 | `play-hub-v3` | member | member | `(app)` | `/challenge/new`, `/play/friend` → `/play?tab=friend` |
| `/join/[code]` | V3ChallengeAccept, V3ChallengeAcceptGuest | P9 | `play-hub-v3` | public | member | `(shared)` | **P9 must move it to public** (P1: member); legacy `/join/<cuid>` served by the same page |
| `/s/[code]` | V3PositionShare | P9 | `play-hub-v3` | public | signed_in (default) | `(shared)` | `noindex` |
| `/@[username]` | V4ProfileOther, V4ProfileOtherGuest, V4ProfilePrivate | P10 | `account-v3` | public | signed_in (default) | rewrite | middleware rewrite: signed in → `/u/[username]`, guest → `/p/[username]` |
| `/u/[username]` | V4Profile (+4 devices), V4ProfileGames, V4ProfileStats, V4ProfileOther | P10 | `account-v3` | signed_in | signed_in (default) | `(app)` | `/profile` → 307 `/@{me}`; `/profile/[referenceId]` legacy |
| `/p/[username]` | V4ProfileOtherGuest, V4ProfilePrivate | P10 | `account-v3` | public | signed_in (default) | `(public)` | ISR, `noindex` |
| `/profile/edit` | V4ProfileEdit | P10 | `account-v3` | signed_in | public | `(app)` | P1 classifies `/profile/(.*)` public; P10 adds the pattern |
| `/settings`, `/settings/{board,pieces,sounds,training,appearance,notifications}` | V4Settings (+4), V4SettingsBoard (+4), V4SettingsPieces, V4SettingsSounds, V4SettingsAppearance, V4SettingsNotifications, V3NotifPrompt | P10 | `account-v3` | member | signed_in (default) | `(app)` |  |
| `/settings/account` | V4SettingsAccount, V4DeleteAccount | P10 | `account-v3` | signed_in | signed_in (default) | `(app)` | signed in, not member (IS §1.5) |
| `/settings/membership` | V4Membership (+4 devices), V4MembershipTrial, V4MembershipCancelling, V4MembershipPastDue, V4MembershipFree, V4PlanSwitch, V4CancelSub | P10 | `account-v3` | signed_in | signed_in (default) | `(app)` | signed in, not member (IS §1.5) |
| `/` | V3Landing (+iPhone, iPad) | P11 | `public-v3` | public | public | `(marketing)` | signed-in visitors → `/home` (cheap Clerk check) |
| `/pricing` | V3Pricing (+iPhone, iPad), V3PaywallHard (`?reason=required`), V3PaywallSoft (`?reason=ended`) | P11 | `public-v3` | public | public | `(marketing)` | member gate target |
| `/about`, `/press`, `/careers`, `/community` | V3About | P11 | `public-v3` | public | public | `(marketing)` |  |
| `/blog`, `/blog/[slug]`, `/blog/category/[category]`, `/blog/author/[id]` | V3BlogIndex, V3BlogPost | P11 | `public-v3` | public | public | `(marketing)` |  |
| `/help` | V3Help | P11 | `public-v3` | public | public | `(marketing)` |  |
| `/contact` | V3Contact | P11 | `public-v3` | public | public | `(marketing)` |  |
| `/terms`, `/privacy`, `/cookies`, `/licenses` | V3Legal | P11 | `public-v3` | public | public | `(marketing)` | **`/licenses` is not in P1's public list**; P11 adds it |
| `/sign-in`, `/sign-in/[...rest]` | V3SignIn (+iPhone, iPad) | P11 | `auth-v3` | public | public | `(auth)` |  |
| `/sign-up`, `/sign-up/[...rest]` | V3SignUp (+iPhone, iPad) | P11 | `auth-v3` | public | public | `(auth)` |  |
| `/sign-up/verify` | V3VerifyEmail | P11 | `auth-v3` | public | public | `(auth)` |  |
| `/reset-password` | V3ResetPassword | P11 | `auth-v3` | public | signed_in (default) | `(auth)` | **not in P1's public list**; P11 adds it |
| `/offline` | V3Offline (+iPhone, iPadP) | P11 | — | public | signed_in (default) | `(system)` | SW document fallback; **P11 adds it to the public list** |
| `/maintenance` | V3Maintenance | P11 | — | public | signed_in (default) | `(system)` | middleware rewrite target (503); **P11 adds it** |
| (not-found, error boundaries) | V3Error404 (+iPhone, iPadP), V3Error500 (+iPhone, iPadP), V3ErrorGlobal | P11 | — | — | — | each group | `not-found.tsx`, `error.tsx`, `global-error.tsx` |
| (global overlays) | V3CookieConsent (+iPhone, iPadP), V3PwaInstall (+3 devices), V3PwaUpdate | P11 | `consent` | — | — | root / `(app)` | no route |
| `/tournaments` | V4Tournaments (+4 devices), V4TournamentsEmpty | P12 | `tournaments-v3` | public | member | `(app)` (dual chrome) | **P12 must move it to public** (P1: member); `/tournaments/:slug` → `/t/:slug` |
| `/t/[slug]` | V4TournamentLobby, V4TournamentLive (+4 devices) | P12 | `tournaments-v3` | public | signed_in (default) | `(app)` (dual chrome) | `/tournament/:ref` → here |
| `/t/[slug]/join` | V4TournamentJoin | P12 | `tournaments-v3` | public | signed_in (default) | `(app)` (dual chrome) | join needs membership; `/join-tournament/:code` → here |
| `/t/[slug]/results` | V4TournamentResults | P12 | `tournaments-v3` | public | signed_in (default) | `(app)` (dual chrome) |  |
| `/admin`, `/admin/{positions,legends,tournaments,tournaments/new,tournaments/[slug]/edit,reports}` | V4Admin, V4AdminPositions, V4AdminLegends, V4AdminTournaments, V4AdminTournamentCreate | P12 | `admin-v3` | admin | signed_in | `(admin)` | middleware: signed in; `requireAdmin()` in the layout |
| (no route) | V3FlowMap | P1 | — | — | — | — | this document |

Dev demo routes added by later phases (`/dev/ui/play/*` P9, `/dev/ui/learn/*` P8, `/dev/ui/weakness` P6, `/dev/ui/tournaments` P12, `/dev/import` P4, …) are all `public (dev only)` through P1's `/dev(.*)` pattern and must be entries in the test-hook registry (`lib/test-hooks/registry.ts`).

## 5. Class changes later phases must make

The P1 classifier is deliberately narrow: it only knows today's URLs. Each row below is a route whose target class differs from what P1 returns. The owning phase adds the pattern in its own `lib/auth/route-classes/pNN.ts` (and one import line in `index.ts`; `middleware.ts` is frozen after P1), then updates the §3 lists and this table in the same PR.

| Phase | Route(s) | P1 returns | Must become | Why it matters |
|---|---|---|---|---|
| P3 | `/how-we-grade`, `/r/[code]` | signed-in (default) | public | public, linked from marketing; `/r/` snapshots are shared links |
| P3, P5, P6, P7 | `/review/*`, `/games`, `/practice`, `/home`, `/train/*`, `/coach` | signed-in (default) | member | otherwise a non-member reaches the page shell and only the page gate stops them. **Done for P3 and P5 as `signedInPages`** (`p03.ts`, `p05.ts`: `/home(.*)`, `/train(.*)`): the class stays signed-in and every page runs `requireMemberPage()`, so a later lapsed-read rule (B26, D-19) needs no edge change |
| P8 | `/learn/lessons/*` | **public** (P1 `/learn(.*)`) | member | the P1 public pattern is broader than the target; P8 must add a member pattern that wins over `/learn(.*)` |
| P9 | `/join/[code]` | **member** | public | the accept page has a signed-out state (`V3ChallengeAcceptGuest`) and an OG preview |
| P9 | `/s/[code]` | signed-in (default) | public | shared positions open signed out |
| P10 | `/@[username]`, `/p/[username]` | signed-in (default) | public | guest profile (rewrite) |
| P10 | `/profile/edit` | **public** (P1 `/profile/(.*)`) | signed-in | the legacy public-profile pattern must narrow to `/profile/[referenceId]` |
| P10 | `/settings` sections other than account, connected and membership | signed-in (default) | member | settings for paying features |
| P11 | `/reset-password`, `/licenses`, `/offline`, `/maintenance` | signed-in (default) | public | system and auth pages must render signed out |
| P12 | `/tournaments`, `/t/*` | **member** / signed-in (default) | public | tournaments are visible to everyone (P12 D12-9); joining needs membership |

## 6. Redirects and legacy routes

Static redirects live in `apps/web/config/redirects/pNN.mjs` (one file per phase); redirects that need a lookup are route handlers. On dev every redirect is **307**; 308 only in production from the P13 cut-over (browsers cache 308s permanently).

| From | To | Phase | How |
|---|---|---|---|
| `/analysis/[gameId]` | `/review/[gameRef]` | P3 | page route → 308 (`/analysis/*`) |
| `/weakness` | `/train/weakness` | P6 | redirect |
| `/try`, `/try/*` | `/legends/positions` | P8 | `next.config.js` redirect, retargeted |
| `/position/[referenceId]` | `/legends/positions/<slug>` (lookup) | P8 | `app/position/[referenceId]/route.ts` |
| `/openings?eco=X` | `/openings/eco/x` | P8 | redirect with `has: query eco` |
| `/legends/<cuid>`, `/openings/<cuid>` | the slug URL | P8 | from the `[slug]` page |
| `/learn` | `/legends` | P8 | redirect |
| `/queue` | `/play/online?tc=…&pos=…` | P9 | `app/queue/route.ts` |
| `/challenge/new`, `/play/friend` | `/play?tab=friend` | P9 | `config/redirects/p9.mjs` |
| `/play/queue` | `/play/online` | P9 | `config/redirects/p9.mjs` |
| `/join/<cuid>` (legacy game invite) | `/game/[ref]` or the accept page | P9 | same `/join/[code]` page |
| `/profile` | `/@{me.username}` | P10 | 307 |
| `/profile/[referenceId]` | `/@{username}` | P10 | legacy 308 |
| `/tournaments/:slug` | `/t/:slug` | P12 | `config/redirects/p12.mjs` |
| `/tournament/:ref` | `/t/<slug>` | P12 | `app/tournament/[ref]/route.ts` |
| `/join-tournament/:code` | `/t/<slug>/join?c=…&i=…` | P12 | `app/join-tournament/[code]/route.ts` |
| `/admin/chess-positions` | `/admin/positions` | P12 | `config/redirects/p12.mjs` |
| `/admin/tournaments/create` | `/admin/tournaments/new` | P12 | `config/redirects/p12.mjs` |
| `/` (signed in) | `/home` | P5/P11 | middleware, Clerk check only |

Off the app: `https://status.playchess.tech` (UptimeRobot status page, P13) and the prelaunch host `next.playchess.tech` (admins and the allowlist only, P13).

## 7. Keeping this file correct

- A phase that adds, moves or reclassifies a route edits §4 (and §5/§6 when they apply) in the same PR that ships the route, and edits §3 when the change affects a P1 list.
- `route-classes.test.ts` fails when §3 and the classifier disagree, so a class change without a doc change (or the reverse) cannot merge.
- Board names must match [allocation.md](plan/allocation.md) §4.2 / [07-design-coverage.md](plan/07-design-coverage.md); a board moved between phases there moves here.
