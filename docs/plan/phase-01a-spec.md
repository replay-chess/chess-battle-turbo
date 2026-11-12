> **Frozen copy** of the session scratch file `SP/phase1/SPEC.md` (revision 2, 2026-11-02), committed by the plan assembly so the repo never depends on `/private/tmp` (P1 work package 1A·DOC names this path). This is **Phase 1 track 1A** (design system, app shell, one-viewport layout); `phase-01-design-system-app-shell-and-api-foundations.md` adds tracks 1B and 1Q. Phase numbers inside this file that say "Phase 8/9" for offline, settings and system screens use the old 10-phase numbering: read them as P10/P11 (crosswalk in `01-architecture.md` §6.1). Its research reports (`SP/phase1/01-code-map.md` … `05-data.md`) were not copied; where they disagree with this spec, this spec wins. Index: [README.md](README.md).

# Phase 1 implementation spec: design system, app shell, one-viewport layout

## Executive summary

1. Phase 1 ships the v3 tokens and Geist fonts, the `components/ui` kit, the app shell (sidebar/rail/tab bar, account menu, ⌘K palette, shortcuts, banners) and the one-viewport primitives. It then wraps the 11 signed-in route families in the shell, for members only.
2. Non-members and signed-out visitors keep today's marketing chrome. The `(app)` layout decides the chrome once, and pages read that decision from context (`MarketingOnly`, `ChromeBox`), so the two chromes can never mix.
3. There are two scroll modes. Legacy pages run in **flow** mode: the document scrolls and the bars stick. One-viewport screens opt into **lock** mode with `data-rc-lock`. This removes the clipping the critiques found on `/play` and `/position`.
4. Shell modes are CSS-only: a 220px sidebar above 1100px wide on fine pointers; a 64px rail at ≤1100px or on coarse pointers; a top bar plus tab bar at ≤600px, or ≤900px in portrait. A SubNav strip keeps Tournaments and Openings reachable in rail and tab-bar modes.
5. The nav shows only Play (with Tournaments), Learn (Legends, Openings) and Profile. Home, Train, Review and Settings stay hidden. Help, Privacy and Terms go in the account menu.
6. Toasts use the V3 placement only inside the shell: top-right, or bottom-centre above the tab bar on phones. Everywhere else they keep today's top-centre position and get the new look.
7. Seven packages with disjoint file ownership: P0 foundation, P1 controls kit, P2 overlays and toasts, P3 shell, P4 route integration (stage a: moves; stage b: chrome), P5 layout primitives and the device × zoom suite, P6 dev-DB seed.
8. Order: P0 alone, then P4a alone, then restart the shared dev server with telemetry blanked, then the P0 browser gate, then P1, P2, P3, P4b, P5 and P6 in parallel, then integration (§12).
9. P0 placeholders are behaviour-complete (Tooltip, Banner, Dialog, Sheet, Menu, Switch, Checkbox, and AppShellView with real nav slots), so every parallel package can verify its own work. Checks that can only go green at integration are listed in §4.4.
10. P0 also fixes the critiques' blockers: `cn()` keeps the custom type and shadow utilities; ESLint ignores generated code and gates against a baseline; `tsconfig.json` pre-lists the custom build dirs; PWA `reloadOnOnline` is off.
11. Testing: `node:test` units per package; Playwright gallery and shell specs on 4 UI projects plus 2 motion projects; 40 device × zoom layout projects; axe in both themes; the main regression suite plus a new authed `shell.spec.ts`.
12. Dev routes (`/dev/ui`, `/dev/ui/shell`, `/dev/ui/stage`) fail closed. They render only when `NEXT_PUBLIC_APP_ENV` is `dev` or `test`, or in local `next dev` with the variable unset.
13. The dev-DB seed adds 6 legends and 5 legend positions from design fixtures only. It is guarded to the dev Neon branch, idempotent and written in one transaction. Nothing reads old prod.
14. No Prisma schema change. Nobody runs `prisma migrate` or `prisma db push` in this phase.
15. Open decisions for the user are in §13: the iOS status-bar style, the PWA start URL, Android bar heights, copying content from old prod, and the listed design deviations.

---

Status: final spec for the implementing agents, revision 2 (2026-11-02), after the completeness and feasibility critiques. Branch `dev` @ `0848b76`.
Scope: `docs/implementation-plan.md` Phase 1 (lines 74–80), a dev-only UI gallery and the dev-DB content seed.

Paths: `WEB` = `/Users/rohitpandit/open_source/chess-battle-turbo/apps/web`. A path that isn't absolute is relative to `WEB`. `SP` = the planning session's scratchpad, archived scratch inputs that are not in the repo and may no longer exist (see [99-open-decisions.md](99-open-decisions.md) A12).

Research reports. Where they disagree with this spec, this spec wins.
- `SP/phase1/01-code-map.md` (current code, line numbers)
- `SP/phase1/02-tokens-components.md` (token audit, exact CSS, component class lists)
- `SP/phase1/03-shell.md` (shell modes, nav, palette, shortcuts, toasts)
- `SP/phase1/04-viewport.md` (ViewportStage, BoardStage, zoom, Playwright matrix)
- `SP/phase1/05-data.md` (dev-DB seed)
- `SP/phase1/critique-completeness.md` and `SP/phase1/critique-feasibility.md`. How each point was handled is in Appendix A.

Design references (data only): `SP/design-ref/ds/project/README.md`, `SP/design-ref/project/ds/replaychess/tokens.json`, `SP/design-ref/project/v2/*.dc.html`.

---

## 0. Decisions in one screen

| # | Decision | Why / source |
|---|---|---|
| D1 | **Route group `app/(app)/`** holds every signed-in route plus the dual-chrome catalogue pages: play, queue, challenge, join, join-tournament, position, tournaments, tournament, legends, openings, profile. URLs don't change. One `app/(app)/layout.tsx` picks the chrome. | The shell persists across Play → Learn → Profile (03 §7.2). |
| D2 | **The chrome rule.** A signed-in **member** gets the shell. A member is entitled, or an admin, or anyone at all when `BILLING_PAYWALL=off`. Everyone else gets the page's existing marketing markup, unchanged. **One decision per layout render:** `app/(app)/layout.tsx` computes the mode and puts it in `ChromeProvider`. Pages never look up the session themselves. Client pages call `useChrome()`/`chromeClass()`. Server pages wrap chrome in `<MarketingOnly>` and offsets in `<ChromeBox>`. | No free tier. If a membership lapses mid-session, the persisted layout and the pages still agree (C §3.8). |
| D3 | **Outside the shell in Phase 1:** `/`, `/pricing`, blog, learn articles, legal, `/onboarding`, `/sign-in`, `/admin/**`, `/game/[id]`, `/analysis/[id]`, error pages. | Game and analysis move into the shell in Phases 2 and 3. |
| D4 | **Destinations shown in Phase 1:** Play (sub: Tournaments), Learn (subs: Legends, Openings), Profile. **Hidden**, not disabled: Home, Train, Review, Settings. The logo goes to `/play`. The gear (sidebar/rail) and the avatar (phone top bar) open the **account menu**, which also holds Help, Privacy and Terms. In rail and tab-bar modes a **SubNav** strip shows the subs. On phone detail routes the top bar shows **Back**. | 03 §0, §6. No dead links and no dead ends (C B2, H5, H12). |
| D5 | **Shell modes are CSS-only:** sidebar 220px (width > 1100, fine pointer); rail 64px (width ≤ 1100, or `(hover:none) and (pointer:coarse)`); tab bar (width ≤ 600, or ≤ 900 in portrait). | 03 §2, 04 §4.2 |
| D6 | **The board is sized from its stage with container-query units** (`BoardStage`, `container-type:size`), not by subtracting from `dvh/dvw`. `ChessBoard` gains `squareSize="fill"`. Its arrows keep the ResizeObserver path in Phase 1; the viewBox rewrite is Phase 2. | 04 §5. Lower regression risk. |
| D7 | **Zoom is emulated in Playwright** with `viewport = screen ÷ zoom` and `deviceScaleFactor = dpr × zoom`. The matrix is 8 base devices × zooms 80/100/110/125/150% = 40 projects, plus 4 UI projects and 2 motion projects. | 04 §8.1, confirmed by F §5. |
| D8 | **Fonts:** Geist and Geist Mono move to `next/font/google`. The generated family names are then literally `'Geist'` and `'Geist Mono'`, so the 741 existing inline `fontFamily: "'Geist'"` styles start resolving. The font variables go on `<html>`. | 01 §0.1, 02 §3.7, confirmed by F §1. The whole app visibly switches from Helvetica/system UI to Geist. That is intended. |
| D9 | Token decisions from 02 §8: input border **0.45**; fluid title **`clamp(1.75rem, 4.9vh, 2.75rem)`**; board coordinate and arrow values deferred to Phase 2. The accent fills primary actions **and** selected/on states (02 C9; needs sign-off, §13). | |
| D10 | Icons are **lucide-react** only, at 18px with `strokeWidth={1.75}` in nav and 16px with stroke 2 in controls. No bespoke SVG paths. | Task constraint; overrides 03 §3. |
| D11 | **`/dev/**` fails closed.** It renders only when `NEXT_PUBLIC_APP_ENV` is `dev` or `test`, or when it is unset and `NODE_ENV === "development"`. Otherwise `app/dev/layout.tsx` calls `notFound()`. The routes also carry `robots: noindex` and are disallowed in `robots.ts`. | C §5, F M12. A production deployment that forgets the variable stays safe. |
| D12 | The dev seed uses **design fixtures only** (6 legends, 5 legend positions). Copying content from old prod is coded behind `--source json\|db` but **not run**: it needs the user's explicit approval (05 §0). | The user allowed seeding dev only. |
| D13 | Unit tests stay on `node:test` via `tsx`, for logic modules only. Component behaviour is tested in Playwright against the gallery and demo routes. No new test runner. | |
| D14 | No Prisma schema changes in Phase 1. Nobody runs `prisma migrate` or `prisma db push`. | CLAUDE.md |
| D15 | **Two scroll modes.** *Flow* is the default: the document scrolls, the nav, top bar and tab bar are `position: sticky`, and legacy pages behave as they do today. *Lock* applies when the page contains `[data-rc-lock]`: `100dvh`, the document never scrolls, and `main` holds a `minmax(0,1fr)` grid. `BoardStage` and every `/dev/ui/shell` and `/dev/ui/stage` page set `data-rc-lock`. | C B1 (option A). Native scroll restoration, iOS status-bar tap and Safari toolbar collapse keep working on legacy pages. |
| D16 | **Toast placement depends on the chrome.** Inside the shell: top-right on desktop and tablet landscape; bottom-centre above the tab bar on phones and iPad portrait (440px wide there). Outside the shell: today's `top-center`. The new visual style applies everywhere. | C H7. No toast moves onto `/game` controls or the marketing Navbar. |
| D17 | **P4 runs in two stages.** P4a (the route moves) runs alone right after P0, before the shared dev server starts. P4b (chrome edits) runs in the parallel phase. | F B6. |
| D18 | **PWA:** `reloadOnOnline: false` (the OnlineChip replaces the reload); manifest `"id": "/"`, `"start_url": "/play"`; `appleWebApp.statusBarStyle: "default"`. | C H2/H4, F B5, C §3.7. User sign-off in §13. |
| D19 | **Lint gates are baseline deltas.** New files have 0 warnings. Edited legacy files have no more warnings than before. The whole app has no more than the baseline recorded by P0. | F B2. `next lint --max-warnings 0` fails on today's code. |
| D20 | **Shortcuts.** ⌘K/Ctrl+K works everywhere: on every pointer type, inside editable fields, and while a shell dialog is open. `/`, `?` and the `g` chords work only on fine pointers, outside editable fields, with no modal open, and only while the "Single-Key Shortcuts" switch is on. | C H10/H11/§3.6, WCAG 2.1.4. |

---

## 1. Scope

**In scope**
1. Tokens ported into `app/globals.css`, Tailwind 4 CSS-first, keeping the existing `--cb-*` names.
2. The `components/ui` kit:
   - **Controls:** Button, IconButton, Kbd, Spinner, CountBadge, Chip/ChipGroup, Segmented, Tabs, Field/Input/Textarea/Select/Slider, Switch, Checkbox, RadioCard.
   - **Display:** Banner, Tag, Card, Divider/Overline/Eyebrow, Disclosure, Avatar, Skeleton, ProgressBar/StackedBar, ActionBar, EmptyState, PageHeader.
   - **Overlays:** Tooltip, Popover, InfoButton, FilterPopover, Menu (with checkbox and radio items), Dialog/AlertDialog, Sheet/ResponsiveDialog.
   - **Toast:** `notify`, plus the restyled Toaster.
3. The app shell:
   - **Navigation:** sidebar/rail, top bar (with Back on phone detail routes), tab bar, SubNav, account menu.
   - **Keyboard:** command palette (⌘K, `/`), shortcuts dialog (`?`) with a single-key switch, G-chords.
   - **Status:** payment-failed banner, online chip, route hairline, skip link.
   - **Wiring:** onto the existing signed-in pages.
4. One-viewport primitives: `ViewportStage` (flow and lock modes), `BoardStage`, `ScrollRegion`, and ChessBoard `fill`.
5. Zoom-safe sizing and the Playwright device × zoom suite (`playwright.devices.config.ts`).
6. Dev-only routes:
   - `/dev/ui` (gallery index);
   - `/dev/ui/sections/<id>` (one route per gallery section);
   - `/dev/ui/shell` (shell demo);
   - `/dev/ui/stage` (ViewportStage + board demo).
7. Dev-DB content seed (fixtures).

**Out of scope.** Don't start any of these:
- The game page rewrite, the `GamePageContent` split, Review/`/review`, coach, import, Mistake Bank.
- `/home`, `/settings` and `/train` routes; the middleware `entitled` claim (plan §1.2).
- Migrating the 9 hand-rolled modals to Radix. P4 and P3 only add `role="dialog" aria-modal="true" data-rc-modal` to the three that can open inside the shell.
- The `fontFamily` inline-style codemod.
- The offline fallback page, the 404 redesign, `(app)/not-found.tsx`, the Clerk restyle, profile/settings redesigns.
- ChessBoard colours, arrows and coordinates (Phase 2).

Legacy pages inside the shell scroll the document (flow mode, D15). The one-viewport assertions apply to lock-mode routes only: `/dev/ui/shell` and `/dev/ui/stage`.

**Constraints** (all packages):
- No free tier anywhere in copy or links.
- Tailwind 4 CSS-first. `tailwind.config.ts` is ignored; don't touch it.
- React 19 + React Compiler: no `useMemo`, `useCallback`, `React.memo` or `forwardRef` in new code, and don't write those words in comments either (the §12.2 grep gate matches comments). `ref` is a prop.
- Square shapes: no `rounded-*` except `rounded-full` on avatars, dots, spinners, switch tracks/thumbs, radio indicators, the sheet grabber and count badges.
- Hit targets: at least 44 CSS px **effective** for every interactive element in new code (README "hit targets stay at least 44 CSS px"). Dense controls drawn smaller (36/38/40px) add `tap-target`.
- No emoji. Visible button, menu, nav and tab labels are in **Title Case**. Descriptions, shortcut row labels and toasts are sentence case. Uppercase comes from CSS only.
- `lucide-react` icons with `aria-hidden`.
- Every interactive `components/ui` and `components/shell` module starts with `"use client"`. Server pages never pass function props across the boundary.
- **Class merging:** always `cn()` from `lib/utils.ts` (P0's extended tailwind-merge). `text-overline` carries its own colour, so never combine it with a `text-cb-*` colour class.
- Keep every existing `data-testid` (01 §14 lists them) and the `[data-square]`, `.rounded-full` legal-dot and `rgba(220, 80, 80` capture selectors used by `e2e/fixtures/chess-board.ts:51-60`.

---

## 2. Architecture

### 2.1 Tree

```
app/layout.tsx (P0)  html.light + font vars · ThemeProvider · TooltipProvider (P2 export) · ClerkProvider
│                    · ThemeColorSync (P0) · ThemeAwareToaster (P2) · UserSync
├── app/(app)/layout.tsx (P4b)  getShellSession() → ChromeProvider(mode)
│     mode=shell     → <AppShellView user> (P3) → <ViewportStage nav topbar tabbar banner> (P0)
│     mode=marketing → children as today (pages render <Navbar/>/<Footer/> inside <MarketingOnly>)
│     ├── play, queue, challenge/new, join/[ref], join-tournament/[ref], position/[ref],
│     │   tournaments, tournament/[ref]          (members-only; middleware-protected)
│     └── legends(/[ref]), openings(/[ref]), profile/[ref]   (public, dual chrome)
├── app/dev/layout.tsx (P0)   notFound() unless devRoutesEnabled()
│     ├── ui/page.tsx (P0)                gallery index: all five sections + links
│     ├── ui/sections/<id>/page.tsx (P0)  one section each (foundations, controls, overlays, shell, layout)
│     ├── ui/shell/page.tsx (P3)          AppShellView with demo users and content (lock mode)
│     └── ui/stage/page.tsx (P5)          AppShellView + BoardStage + ChessBoard fill (lock mode)
└── everything else unchanged (marketing Navbar/Footer, game, analysis, admin, onboarding)
```

### 2.2 Shell modes (`components/layout/viewport.css`, P0)

| CSS viewport | Mode | `--nav` | Top bar | Tab bar | SubNav (when the current destination has subs) |
|---|---|---|---|---|---|
| width > 1100, fine pointer | sidebar | 220px | none | none | none (the sidebar shows subs) |
| width ≤ 1100, or `(hover:none) and (pointer:coarse)` | rail | 64px | none | none | shown in the banner slot |
| width ≤ 600, or width ≤ 900 and portrait | tabbar | 0 | 44px (+safe-top) | 56px (+safe-bottom) | shown, except on detail routes (Back shows instead) |
| 601–900 wide and portrait (iPad portrait) | tabbar | 0 | 52px, hairline below | 64px | same as tabbar |

### 2.3 Scroll modes (D15)

| | Flow (default) | Lock (`.rc-vs:has([data-rc-lock])`) |
|---|---|---|
| Who | Every legacy page in `(app)` | `BoardStage`; every `/dev/ui/shell` and `/dev/ui/stage` page; future one-viewport screens |
| Document | scrolls | `html, body { height:100%; overflow:hidden }` |
| `.rc-vs` | `min-height:100dvh`, `overflow-x:clip` | `height:100dvh`, `overflow:clip` |
| Nav / top bar / tab bar | `position: sticky` | the same rules (sticky is inert, since nothing scrolls) |
| `main` and `.rc-vs__page` | `display:block` | `main` is a grid `auto minmax(0,1fr)` that scrolls only as a fallback; the page is a `minmax(0,1fr)` grid |
| Legacy `min-h-screen`/`h-screen` | sized to the space between the bars by an unlayered override in `globals.css` | not used |

---

## 3. Shared contracts

Every package may rely on everything in this section. Only the listed owner may change a contract, and only additively (new optional props, new exports). Report any addition in the hand-back.

### 3.1 File ownership matrix (shared and cross-package files)

| File | Owner | Others may |
|---|---|---|
| `package.json`, `pnpm-lock.yaml` (repo root lock) | P0 | read only. Need a dependency? Ask in your hand-back. |
| `app/globals.css` | P0 | use its tokens, variants and utilities |
| `app/layout.tsx` | P0 | — |
| `next.config.js` | P0 | — |
| `tsconfig.json` (only the `include` list changes) | P0 | — |
| `eslint.config.js` (`apps/web`) | P0 | — |
| `.gitignore` (`apps/web/.gitignore`) | P0 | — |
| `public/manifest.json`, `app/robots.ts` | P0 | — |
| `lib/utils.ts`, `lib/utils.test.ts` | P0 | import `cn` |
| `playwright.config.ts` | P0 (one change: `PW_REUSE_SERVER`) | add specs under `e2e/specs/` (P4 only) |
| `playwright.devices.config.ts`, `e2e/devices/{matrix,zoom,helpers,a11y}.ts`, `e2e/devices/ui/{foundations,a11y}.spec.ts`, `e2e/devices/layout/probe.spec.ts` | P0 | add own spec files under `e2e/devices/ui/` (P1, P2, P3) or `e2e/devices/layout/` (P5) |
| `components/layout/ViewportStage.tsx`, `components/layout/viewport.css` | P0 | import |
| `components/ui/{button,icon-button,kbd,spinner,count-badge}.tsx`, `components/ui/use-media-query.ts` | P0 (final) | import |
| `lib/shell/presence.ts` | P0 (final) | import |
| `app/components/ThemeColorSync.tsx` | P0 | — |
| `components/ui/{avatar,tag,banner,skeleton,empty-state,switch,checkbox,page-header}.tsx` | P0 creates a **placeholder**, then **P1 owns** it | import (API fixed in §3.5) |
| `components/ui/{tooltip,dialog,sheet,menu}.tsx` | P0 placeholder → **P2 owns** | import (API fixed in §3.5) |
| `components/shell/AppShellView.tsx` | P0 placeholder → **P3 owns** | import (API fixed in §3.4) |
| `app/dev/ui/_sections/{controls,overlays,shell,layout}.tsx` | P0 placeholder → P1 / P2 / P3 / P5 | — |
| `app/dev/ui/page.tsx`, `app/dev/ui/sections/*/page.tsx`, `app/dev/ui/_sections/foundations.tsx`, `app/dev/ui/_components/*`, `app/dev/layout.tsx` | P0 | import `Specimen`, `GallerySection` |
| `lib/env.ts`, `lib/layout/media-queries.ts`, `lib/shell/types.ts` | P0 | import |
| `app/components/ThemeAwareToaster.tsx`, `components/ui/toast.css` | P2 | — |
| `instrumentation-client.ts`; `app/components/IOSInstallModal.tsx` (root a11y attributes only) | P3 | — |
| `app/components/ChessBoard.tsx` | P5 | — |
| `app/components/Navbar.tsx` (one `data-testid`), `app/components/Hero.tsx` (safe-area padding on the l.155 bar) | P4b | — |
| `app/game/[gameId]/GamePageContent.tsx` (import line + safe-area padding), `app/analysis/[gameId]/AnalysisShareModal.tsx` (import line) | P4a | — |
| everything under `app/(app)/**`, `app/components/ShareLinkModal.tsx` | P4 (both stages) | — |
| `middleware.ts`, `app/components/UserSync.tsx`, `tailwind.config.ts`, `prisma/schema.prisma`, repo-root `turbo.json` | **nobody** | — |

**Placeholder hand-over rule.** P0 creates each placeholder with the exact exports and prop types from §3.4/§3.5 and a **behaviour-complete, visually minimal** body (§5.2). Once P1–P6 start, P0 never touches it again. The owner rewrites the body, keeps every export name and prop type, and may add optional props.

### 3.2 CSS variables (defined by P0 in `components/layout/viewport.css` and `app/globals.css`)

| Variable | Where | Value / meaning | Consumers |
|---|---|---|---|
| `--safe-top/right/bottom/left` | `:root` | `env(safe-area-inset-*, 0px)`; tests override them | everyone |
| `--hit` | `:root` | `max(44px, 2.75rem)` | targets |
| `--nav`, `--topbar`, `--tabbar` | `.rc-vs` | per §2.2; `--topbar`/`--tabbar` drop to 0 when that slot isn't rendered | P3, P5, the legacy `min-h-screen` override |
| `--rc-top-bar` | `:root` | 44px; 52px at 601–900 portrait (the tab-bar-mode top bar height, readable outside `.rc-vs`) | hairline (P3), scroll padding |
| `--rc-bottom-bar` | `:root` | 56px; 64px at 601–900 portrait | — |
| `--rc-nav-w` | `html` | width of the visible nav column (220 / 64 / 0); 0 when there is no shell | legacy `fixed` bars (P4), hairline and online chip (P3) |
| `--rc-fixed-bottom` | `html` | in tabbar mode with a tab bar or control bar: `calc(var(--rc-bottom-bar) + var(--safe-bottom))`; else 0 | legacy `fixed bottom-0` CTA bars (P4) |
| `--rc-fixed-pad-bottom` | `html` | `var(--safe-bottom)`; 0 when `--rc-fixed-bottom` is non-zero (the bar already sits above the inset) | legacy fixed bars' bottom padding (P4) |
| `--rc-overlay-bottom` | `html` | default `calc(16px + var(--safe-bottom))`; in tabbar mode with a bottom bar: `calc(var(--rc-bottom-bar) + var(--safe-bottom) + 8px)` | phone toasts (P2) |
| `--rc-board` | `.rc-stage__in` | board edge in px (container-query maths) | P5 only |
| `--rc-mode` | `.rc-stage__in` | `side` or `stack` (readable from JS, after hydration only) | P5 |
| tokens | `globals.css` | see P0 §5.2: `--cb-text-soft`, `--cb-fill`, `--cb-good`/`-bg`, `--cb-warn`/`-bg`, `--cb-bad`/`-bg`, `--cb-danger`/`-hover`, `--cb-accent-hover`, `--cb-scrim`, `--cb-scrim-modal`, `--cb-border-subtle`, `--cb-border-input`, `--cb-border-dashed`, `--cb-text-disabled`, `--cb-skeleton-shine`, `--cb-shadow-{pop,toast,dialog,modal,board}`, `--cb-z-{nav,popover,dialog,toast}`, `--board-*`, `--highlight-*`, `--pv-1..5`, `--arrow-default`, `--mq-*` | all |

Attribute contract: **`data-rc-lock`** on any element inside `.rc-vs` switches that shell to lock mode (D15). Only one-viewport pages set it.

### 3.3 Tailwind variants, utilities and media queries (P0, in `globals.css`)

| Name | Definition | Typical use |
|---|---|---|
| `dark:` | `&:where(.dark, .dark *)` (follows next-themes, not the OS) | everything |
| `vh760:` / `vh700:` / `vh640:` / `vh620:` | `@media (max-height: 760/700/640/620px)` | density steps |
| `rail:` | `@media (max-width: 1100px), (hover: none) and (pointer: coarse)`, **except** inside `[data-shell-form="sidebar"]`, **plus always** inside `[data-shell-form="rail"]` (multi-slot form, §5.2) | sidebar collapse; SubNav visibility; the gallery's forced previews |
| `narrow:` | `@media (max-width: 1100px)` | toast width, shortcuts grid |
| `tabbar:` | `@media (max-width: 600px), (max-width: 900px) and (orientation: portrait)` | phone/iPad-portrait tweaks |
| `tablet-portrait:` | `@media (min-width: 601px) and (max-width: 900px) and (orientation: portrait)` | iPad portrait top bar 52px |
| `pointer-coarse:` / `pointer-fine:` | built into Tailwind 4.1 as `(pointer: coarse)` / `(pointer: fine)` | 44px promotion, 16px inputs |
| `forced-colors:`, `motion-reduce:`, `aria-*:`, `group-open:` | built in | — |
| `text-overline` | 11px Geist Mono 500, 0.12em, uppercase, colour `--cb-text-soft` (`.lbl`) | labels |
| `text-eyebrow` | marketing only (02 §3.6) | — |
| `tap-target` | `position:relative` plus an `::after` hit box growing to `var(--hit)` without changing the drawn size. It can't be combined with another `::after` use (Tabs' bold-width reservation, Skeleton shimmer), and an `overflow:hidden` ancestor clips it. | 36/38/40px dense controls, 32px avatar buttons |
| type tokens | `text-2xs`, `text-label`, `text-ui`, `text-body`, `text-heading`, `text-title`, `text-wordmark` (02 §3.3) | — |
| motion | `ease-rc`, `animate-rc-{spin,shimmer,fade,pop,in-top,in-bottom,sheet,pulse,glow,hair}` | — |
| shadows | `shadow-{pop,toast,dialog,modal,board,square-light,square-dark,badge,mq,promo}` | — |
| colours | `bg-cb-fill`, `text-cb-text-soft`, `border-cb-border-input`, `bg-cb-good-bg`, `text-cb-good`, … plus `board-*`, `highlight-*`, `pv-*`, `mq-*` (02 §3.2) | — |

Media-query strings as TS constants (P0, `lib/layout/media-queries.ts`). Each must appear in the CSS exactly as written here:
```ts
export const RAIL_MQ = "(max-width: 1100px), (hover: none) and (pointer: coarse)";
export const TABBAR_MQ = "(max-width: 600px), (max-width: 900px) and (orientation: portrait)";
export const TABLET_PORTRAIT_MQ = "(min-width: 601px) and (max-width: 900px) and (orientation: portrait)";
export const NARROW_MQ = "(max-width: 1100px)";
/** Shell-mode logic: touch-first devices (rail, no single-key shortcuts, no search button). */
export const COARSE_MQ = "(hover: none) and (pointer: coarse)";
/** Tap-target logic: matches Tailwind's `pointer-coarse:` exactly. */
export const COARSE_POINTER_MQ = "(pointer: coarse)";
```
Use them only after hydration: toaster placement, the analytics surface, the sheet-vs-dialog choice on open, keyboard registration. Never use them to choose the first render.

### 3.4 Shell TypeScript contracts

`lib/shell/types.ts` (P0, final):
```ts
export type DestinationKey =
  | "home" | "play" | "tournaments" | "train" | "learn" | "legends" | "openings" | "review" | "profile" | "settings";

export type ChromeMode = "shell" | "marketing";

export type ShellUser = {
  referenceId: string;
  name: string;
  avatarUrl: string | null;
  isAdmin: boolean;
  /** "Blitz 1184" (Chess.com blitz, else rapid); uppercased by CSS. null hides the line. */
  ratingLabel: string | null;
  /** Whole days left in an active trial, rounded up, so always >= 1. null when not trialling. */
  trialDaysLeft: number | null;
  /** Subscription status is past_due or on_hold: show the payment-failed banner. */
  paymentFailed: boolean;
  /** ISO timestamp that access lasts until (currentPeriodEnd). */
  paymentFailedUntil: string | null;
  /** The same date preformatted on the server in UTC ("Nov 12"), so SSR and hydration agree. */
  paymentFailedUntilLabel: string | null;
  /** The user has a Dodo customer id, so "Manage Billing" (/api/customer-portal) works. */
  hasBillingPortal: boolean;
};
```

`components/shell/AppShellView.tsx` (P0 placeholder → P3). A `"use client"` module with the named export `AppShellView`:
```ts
export type AppShellViewProps = {
  user: ShellUser;
  children: React.ReactNode;
  /** Game screens: no phone tab bar (the BoardStage footer replaces it). Default false. */
  hideTabBar?: boolean;
  /** /dev routes: Clerk actions disabled, analytics off, hairline off, profile hrefs become hashes. */
  demo?: boolean;
  /** Overrides the pathname-derived current destination (demo routes only). */
  currentKey?: DestinationKey | null;
  /** Overrides the pathname-derived Back target (demo routes only). */
  backTo?: DestinationKey | null;
  /** Extra banner rows above the page, rendered after the shell's own rows (SubNav, payment, offline). */
  banner?: React.ReactNode;
};
export function AppShellView(props: AppShellViewProps): React.JSX.Element;
```
On mount, AppShellView calls `markShellMounted()` (§3.6) and releases it on unmount.

`components/layout/ViewportStage.tsx` (P0, final; server-compatible, no hooks):
```ts
export type ViewportStageProps = {
  nav?: React.ReactNode;        // sidebar/rail; its column is var(--nav) wide
  topbar?: React.ReactNode;     // shown in tabbar mode (or always with topbarAlways)
  tabbar?: React.ReactNode;     // phone tab bar; pass nothing on game screens
  banner?: React.ReactNode;     // rows above the page; they shrink the page and never overlay it
  topbarAlways?: boolean;       // 64px top bar on desktop too (48px at ≤640 tall)
  children: React.ReactNode;    // exactly one page child
  className?: string;
  "data-testid"?: string;
};
export function ViewportStage(props: ViewportStageProps): React.JSX.Element;
```
DOM contract (tests rely on it):
- Root `div.rc-vs[data-rc-viewport]`, plus `[data-has-nav]` when `nav` is set and the class `rc-vs--topbar-always` when `topbarAlways` is set.
- `a.rc-skip[data-testid="skip-link"][href="#main"]` "Skip to Content" as the first child, only when `nav` or `topbar` is set.
- `div.rc-vs__nav[data-rc-nav]` **only when `nav` is set**.
- `div.rc-vs__top[data-rc-topbar]` **only when `topbar` is set**.
- `main#main.rc-vs__main[data-rc-main][tabindex="-1"]` holding `div.rc-vs__banner[data-rc-banner]` (always present, possibly empty) and `div.rc-vs__page`.
- `div.rc-vs__tab[data-rc-tabbar]` **only when `tabbar` is set**.

### 3.5 UI-kit placeholder contracts (P0 creates; P1/P2 own)

All of these live in `components/ui/`, use named exports and take `className?: string`.

```ts
// avatar.tsx (P1)
export type AvatarProps = {
  name: string; src?: string | null;
  size?: 28 | 32 | 36 | 56 | 72;                 // default 32
  variant?: "neutral" | "ink" | "gradient";       // default "gradient"
  seed?: string;                                  // gradient hash seed, default name
  decorative?: boolean;                           // default true → aria-hidden; false → role="img" aria-label={name}
  className?: string;
};
export function Avatar(p: AvatarProps): React.JSX.Element;

// tag.tsx (P1)
export type TagProps = React.ComponentProps<"span"> & {
  tone?: "neutral" | "good" | "warn" | "bad" | "ink";   // default neutral
  size?: "sm" | "md";                                   // .tag | .pill, default sm
  variant?: "outline" | "tint" | "metric";              // default outline
  icon?: React.ReactNode;
};
export function Tag(p: TagProps): React.JSX.Element;

// banner.tsx (P1)
export type BannerProps = {
  tone?: "info" | "good" | "warn" | "bad"; layout?: "bar" | "note";
  icon?: React.ReactNode | false; title?: React.ReactNode; action?: React.ReactNode;
  onDismiss?: () => void; dismissLabel?: string;        // default "Dismiss for this session"
  live?: "polite" | "assertive" | "off";                // role status | alert | none; default polite
  className?: string; "data-testid"?: string; children: React.ReactNode;
};
export function Banner(p: BannerProps): React.JSX.Element;

// skeleton.tsx (P1)
export type SkeletonProps = React.ComponentProps<"span"> & { shape?: "rect" | "circle" };
export function Skeleton(p: SkeletonProps): React.JSX.Element;
export function SkeletonText(p: { lines?: number; className?: string }): React.JSX.Element;
export function SkeletonRow(p: { className?: string }): React.JSX.Element;
export function SkeletonRegion(p: { label?: string; className?: string; children: React.ReactNode }): React.JSX.Element; // aria-busy + sr-only "Loading…"

// empty-state.tsx (P1)
export type EmptyStateProps = {
  title: string; body?: React.ReactNode; icon?: React.ReactNode;
  ghostRows?: number;                      // dashed ghost rows of the filled state; default 3 (page), 0 (card)
  size?: "page" | "card";                  // default page
  primary?: React.ReactNode; secondary?: React.ReactNode;
  headingLevel?: 2 | 3; className?: string; "data-testid"?: string;
};
export function EmptyState(p: EmptyStateProps): React.JSX.Element;

// switch.tsx (P1) — Radix Switch
export type SwitchProps = Omit<React.ComponentProps<typeof SwitchPrimitive.Root>, "children">;
export function Switch(p: SwitchProps): React.JSX.Element;
export function SwitchRow(p: {
  label: React.ReactNode; description?: React.ReactNode;
  checked: boolean; onCheckedChange: (v: boolean) => void; disabled?: boolean;
  id?: string; className?: string; "data-testid"?: string;
}): React.JSX.Element;                     // whole min-h-14 row is a <label htmlFor>

// checkbox.tsx (P1) — Radix Checkbox
export type CheckboxProps = Omit<React.ComponentProps<typeof CheckboxPrimitive.Root>, "children">;
export function Checkbox(p: CheckboxProps): React.JSX.Element;     // 18px square; checked | "indeterminate"
export function CheckboxRow(p: {
  label: React.ReactNode; description?: React.ReactNode;
  checked: boolean | "indeterminate"; onCheckedChange: (v: boolean) => void; disabled?: boolean;
  id?: string; className?: string; "data-testid"?: string;
}): React.JSX.Element;                     // min-h-11 label row

// page-header.tsx (P1)
export type PageHeaderProps = {
  overline?: React.ReactNode; title: React.ReactNode;
  info?: React.ReactNode;                  // slot for <InfoButton> (P2); README: the description lives there
  actions?: React.ReactNode; headingLevel?: 1 | 2;   // default 1
  className?: string; "data-testid"?: string;
};
export function PageHeader(p: PageHeaderProps): React.JSX.Element;

// tooltip.tsx (P2). P0 mounts TooltipProvider once in app/layout.tsx; Tooltip needs it.
export function TooltipProvider(p: { children: React.ReactNode }): React.JSX.Element; // delayDuration 300, skipDelayDuration 300
export type TooltipProps = {
  content: React.ReactNode; side?: "top" | "right" | "bottom" | "left"; align?: "start" | "center" | "end";
  delayDuration?: number; disabled?: boolean; children: React.ReactElement;
};
export function Tooltip(p: TooltipProps): React.JSX.Element;

// dialog.tsx (P2) — Radix Dialog + AlertDialog from "radix-ui"
export const Dialog: typeof DialogPrimitive.Root;
export const DialogTrigger: typeof DialogPrimitive.Trigger;
export const DialogClose: typeof DialogPrimitive.Close;
export type DialogContentProps = Omit<React.ComponentProps<typeof DialogPrimitive.Content>, "title"> & {
  title: React.ReactNode;                 // required, rendered as DialogTitle
  description?: React.ReactNode;          // absent → aria-describedby={undefined} (no Radix warning)
  hideTitle?: boolean;                    // VisuallyHidden title + description
  hideClose?: boolean;
  size?: "sm" | "md" | "lg" | "xl";       // 440 / 560 / 640 / 1040 px
  align?: "center" | "top";               // top = 12vh (command palette)
  titleVariant?: "serif" | "sans";        // serif text-heading (default) | sans 600 (in-game confirms)
  overlayClassName?: string;
};
// DialogContent always sets aria-modal="true" and forwards every Content prop, including
// onOpenAutoFocus/onCloseAutoFocus (composed with any internal handler).
export function DialogContent(p: DialogContentProps): React.JSX.Element;
export function DialogBody(p: React.ComponentProps<"div">): React.JSX.Element;
export function DialogFooter(p: React.ComponentProps<"div">): React.JSX.Element;
export const AlertDialog: typeof AlertDialogPrimitive.Root;
export const AlertDialogTrigger: typeof AlertDialogPrimitive.Trigger;
export function AlertDialogContent(p: { title: React.ReactNode; description?: React.ReactNode; size?: "sm" | "md"; children?: React.ReactNode; className?: string }): React.JSX.Element;
export function AlertDialogCancel(p: React.ComponentProps<typeof AlertDialogPrimitive.Cancel>): React.JSX.Element;
export function AlertDialogAction(p: React.ComponentProps<typeof AlertDialogPrimitive.Action> & { tone?: "primary" | "danger" }): React.JSX.Element;

// sheet.tsx (P2) — Radix Dialog anchored to the bottom; same aria-modal and prop-forwarding rules
export const Sheet: typeof DialogPrimitive.Root;
export const SheetTrigger: typeof DialogPrimitive.Trigger;
export const SheetClose: typeof DialogPrimitive.Close;
export type SheetContentProps = Omit<React.ComponentProps<typeof DialogPrimitive.Content>, "title"> & {
  title: React.ReactNode; hideTitle?: boolean;
  label?: React.ReactNode;                // overline header text; defaults to title
  height?: "auto" | "60" | "90";          // default auto (max 90dvh)
};
export function SheetContent(p: SheetContentProps): React.JSX.Element;

// menu.tsx (P2) — Radix DropdownMenu
export const Menu: typeof DropdownMenuPrimitive.Root;
export const MenuTrigger: typeof DropdownMenuPrimitive.Trigger;
export type MenuContentProps = React.ComponentProps<typeof DropdownMenuPrimitive.Content> & { minWidth?: number }; // default 240; align "end", sideOffset 8, collisionPadding 16; forwards onCloseAutoFocus
export function MenuContent(p: MenuContentProps): React.JSX.Element;
export type MenuItemProps = React.ComponentProps<typeof DropdownMenuPrimitive.Item> & { icon?: React.ReactNode; tone?: "default" | "danger"; shortcut?: string };
export function MenuItem(p: MenuItemProps): React.JSX.Element;
export function MenuLinkItem(p: { href: string; icon?: React.ReactNode; external?: boolean; children: React.ReactNode; "data-testid"?: string; onSelect?: () => void }): React.JSX.Element; // Item asChild + next/link (or <a target=_blank rel=noopener> when external)
export function MenuCheckboxItem(p: React.ComponentProps<typeof DropdownMenuPrimitive.CheckboxItem> & { icon?: React.ReactNode }): React.JSX.Element;
export const MenuRadioGroup: typeof DropdownMenuPrimitive.RadioGroup;
export function MenuRadioItem(p: React.ComponentProps<typeof DropdownMenuPrimitive.RadioItem>): React.JSX.Element;
export function MenuSeparator(p: { className?: string }): React.JSX.Element;
export function MenuLabel(p: { children: React.ReactNode; className?: string }): React.JSX.Element;
```
Import Radix from the unified package: `import { Dialog as DialogPrimitive, AlertDialog as AlertDialogPrimitive, DropdownMenu as DropdownMenuPrimitive, Tooltip as TooltipPrimitive, Switch as SwitchPrimitive, Checkbox as CheckboxPrimitive, VisuallyHidden, Slot } from "radix-ui";`. Use Slot as `<Slot.Root>`.

### 3.6 Base primitives (P0, final)

```ts
// button.tsx — replaces the unused shadcn file (zero consumers today)
export type ButtonProps = React.ComponentProps<"button"> & {
  variant?: "primary" | "secondary" | "text" | "danger" | "danger-outline" | "control"; // default primary
  size?: "sm" | "md" | "lg";          // min-height 36 + tap-target (coarse → 44) / 44 / 48; default md
  block?: boolean;                    // w-full
  loading?: boolean;                  // Spinner + aria-busy + aria-disabled; clicks ignored; width held
  loadingLabel?: React.ReactNode;
  pressed?: boolean;                  // aria-pressed
  iconStart?: React.ReactNode; iconEnd?: React.ReactNode;
  asChild?: boolean;                  // Slot.Root (radix-ui) for next/link
};
export function Button(p: ButtonProps): React.JSX.Element;
export const buttonVariants: (opts?: { variant?: ButtonProps["variant"]; size?: ButtonProps["size"]; block?: boolean }) => string; // cva

// icon-button.tsx
export type IconButtonProps = Omit<React.ComponentProps<"button">, "children"> & {
  label: string;                      // required → aria-label
  icon: React.ReactNode;
  variant?: "outline" | "ghost" | "solid"; // default outline
  size?: "sm" | "md" | "lg";          // 36 (tap-target, coarse → 44) / 44 / 48 square; default md
  pressed?: boolean; asChild?: boolean;
};
export function IconButton(p: IconButtonProps): React.JSX.Element;

// kbd.tsx
export function Kbd(p: React.ComponentProps<"kbd">): React.JSX.Element;
export function ModKey(): React.JSX.Element;   // "Ctrl" on the server and first paint, then "⌘" after mount on Apple platforms (useSyncExternalStore, so no hydration mismatch)

// spinner.tsx
export function Spinner(p: { size?: "sm" | "md"; label?: string; className?: string }): React.JSX.Element; // 12 / 14 px; label → role="status" + sr-only. Under reduced motion the spin freezes; the label carries the meaning.

// count-badge.tsx
export function CountBadge(p: { count: number; max?: number /* 99 → "99+" */; label?: string /* sr-only text; omitted → aria-hidden */; tone?: "accent" | "neutral"; className?: string }): React.JSX.Element | null; // null when count <= 0
//  → span.inline-flex.h-4.min-w-4.items-center.justify-center.rounded-full.px-1.font-mono.text-[10px].leading-none.tabular-nums
//    accent: bg-cb-accent text-cb-accent-fg · neutral: bg-cb-fill text-cb-text border border-cb-border-strong

// use-media-query.ts (moved from P2 to P0; F B7)
export function useMediaQuery(query: string): boolean;   // useSyncExternalStore, server snapshot false

// lib/shell/presence.ts — "is an app shell mounted?" store, used by the toaster (D16)
export function markShellMounted(): () => void;          // increments; the returned cleanup decrements
export function isShellPresent(): boolean;               // pure snapshot, unit-testable
export function useShellPresent(): boolean;              // useSyncExternalStore, server snapshot false

// lib/utils.ts — cn() with an extended tailwind-merge (F B1)
export function cn(...inputs: ClassValue[]): string;
```
Class lists: 02 §5.1 (Button), §5.2 (IconButton; **without** the `tooltip` prop: wrap it in `<Tooltip>` instead), §5.16 (Spinner), §5.18 (Kbd). Button sizes: `sm` = `min-h-9 pointer-coarse:min-h-11 tap-target`, `md` = `min-h-11`, `lg` = `min-h-12`. No ink-sweep hover in the app kit (02 C2; sign-off in §13). Buttons and links in the kit also get `[-webkit-tap-highlight-color:transparent]`.

### 3.7 Gallery helpers and routes (P0, `app/dev/ui/_components/Specimen.tsx`)

```ts
export function GallerySection(p: { id: "foundations" | "controls" | "overlays" | "shell" | "layout"; title: string; children: React.ReactNode }): React.JSX.Element;
//  → <section id={id} data-testid={`gallery-${id}`} aria-labelledby={`gallery-${id}-title`} className="flex flex-col gap-6">
//      <h2 id=... className="font-serif text-heading">{title}</h2>{children}</section>
export function Specimen(p: { title: string; testId: string; note?: string; children: React.ReactNode; className?: string }): React.JSX.Element;
//  → <figure data-testid={testId} className="flex flex-col gap-3 border border-cb-border bg-cb-surface p-4">
//      <figcaption className="text-overline">{title}</figcaption><div className="flex flex-wrap items-start gap-3">{children}</div>…</figure>
export function GalleryFrame(p: { title: string; children: React.ReactNode }): React.JSX.Element; // header + ThemeSwitch + main, shared by /dev/ui and /dev/ui/sections/*
```
Section files export `FoundationsSection`, `ControlsSection`, `OverlaysSection`, `ShellSection` and `LayoutSection`. Each root is a `GallerySection`, and a section may be `"use client"`.

**Per-section routes** (F M8): `app/dev/ui/sections/{foundations,controls,overlays,shell,layout}/page.tsx` each render `<GalleryFrame>` plus **one** section, so one package's half-finished section can't break another package's spec. Each package's ui spec visits its own route. `/dev/ui` stays the index for people.

### 3.8 data-testid registry

| Area | testids | Owner |
|---|---|---|
| Gallery | `ui-gallery`, `gallery-theme-toggle` (buttons `gallery-theme-light`, `gallery-theme-dark`), `gallery-{foundations,controls,overlays,shell,layout}` | P0 + section owners |
| Specimens | `ui-<component>[-<variant>]`, e.g. `ui-button-primary`, `ui-chip-group`, `ui-dialog-trigger` (full lists per package) | owners |
| Viewport | `skip-link`; attributes `data-rc-viewport`, `data-rc-nav`, `data-rc-topbar`, `data-rc-main`, `data-rc-banner`, `data-rc-tabbar`, `data-rc-lock` | P0 |
| Shell | see the list below | P3 |
| Toasts | each sonner `li` gets `data-testid="toast-<type>"` (`success`, `info`, `error`, `warning`, `achievement`, `undo`) | P2 |
| Stage | `chess-board` (+ `data-size`) on the ChessBoard container; `data-rc-stage`, `data-rc-bar="top\|bottom"`, `data-rc-board-slot`, `data-rc-aside`, `data-rc-controls`, `data-rc-scroll` | P5 |
| Routes | `marketing-navbar` on the root `<nav>` of `app/components/Navbar.tsx` | P4 |

Shell testids (P3):
- Frame: `app-shell` (the ViewportStage root), `shell-sidebar`, `shell-topbar`, `shell-tabbar`, `subnav`.
- Nav items: `nav-item-<key>` (sidebar/rail links, including the subs `nav-item-tournaments`, `nav-item-legends` and `nav-item-openings`), `tab-item-<key>`, `subnav-item-<key>`.
- Top-level controls: `shell-brand`, `shell-back`, `shell-search-button`, `shell-account-button` (gear), `shell-account-avatar` (top bar), `shell-me-link`, `shell-rating`, `shell-trial-tag`.
- Account: `account-menu`, `account-sheet`, `account-item-{membership,billing,account,theme,install,admin,help,privacy,terms,signout}`.
- Palette: `command-palette`, `command-palette-input`, `palette-item-<id>`, `palette-empty`, `palette-legends-loading`, `palette-legends-offline`.
- Shortcuts: `shortcuts-dialog`, `shortcuts-single-key-switch`.
- Status: `shell-payment-banner`, `shell-online-chip` (floating), `shell-online-chip-inline` (tab-bar mode), `route-hairline`.
- Demo only: `shell-demo-input`.

Current destination items carry `aria-current="page"`. When an item isn't current the attribute is **omitted**, never set to `"false"`.

### 3.9 Dev routes and their query parameters

| Route | Owner | Params |
|---|---|---|
| `/dev/ui` | P0 | `#<section id>` anchors |
| `/dev/ui/sections/<id>` | P0 (the page) / section owner (its content) | per section: `/dev/ui/sections/overlays?placement=page` turns the shell-placement toggle off (§7.2) |
| `/dev/ui/shell` | P3 | `user=member\|trial\|admin\|norating\|payment` (default member); `content=page\|list\|empty` (default page); `current=play\|tournaments\|legends\|openings\|profile` (default none); `back=play\|tournaments\|legends\|openings` (default none) |
| `/dev/ui/stage` | P5 | `layout=game\|hub\|list\|empty` (default game); `banner=payment\|offline`; `chrome=shell\|none` (default shell); `flip=1`; `debug=1` |

Every `/dev/ui/shell` and `/dev/ui/stage` URL is a lock-mode page and must pass the one-viewport assertions (P5 §10.6) at every matrix project. That is also a requirement on P3's demo content.

### 3.10 Events and telemetry (P3)

- `window` CustomEvent **`rc:navigation-start`** with `detail: { url: string, navigationType: "push" | "replace" | "traverse" }`. P3 dispatches it from `onRouterTransitionStart` in `instrumentation-client.ts`.
- PostHog events go through `trackShell()` in `lib/analytics/shell-events.ts`. It no-ops when `posthog.__loaded` is false or `demo` is set, and never sends query text:
  - `shell_nav_click` `{ dest: DestinationKey, surface: "sidebar" | "rail" | "tabbar" | "subnav" | "back" | "palette" | "chord" }`
  - `shell_palette_opened` `{ via: "shortcut" | "slash" | "button" }`
  - `shell_palette_command` `{ id: string, group: "goto" | "actions" | "legends", queryLength: number }`
  - `shell_shortcuts_opened` `{ via: "key" | "palette" }`
  - `shell_shortcuts_toggled` `{ enabled: boolean }`
  - `shell_account_action` `{ action: "membership" | "billing" | "account" | "theme" | "install" | "admin" | "help" | "privacy" | "terms" | "signout" }`

### 3.11 Copy rules (checked by `lib/shell/copy.test.ts`)

- **Title Case** (minor words: a, an, the, to, of, for, and, or, in, on, at): destination labels, SubNav labels, Back labels, palette row titles, account item labels, button and switch labels, dialog titles, shortcut **section titles**.
- **Sentence case** (first letter capital, not all caps): shortcut row labels ("Command palette and search"), descriptions, toasts, banner text.
- No `\p{Extended_Pictographic}`. `⌘ ↑ ↓ ↵ · … ⋯ → ✓ ★ ⏎` are allowed. `↩ ↔ © ™ ✔` match the pattern and must not be used as glyphs (F §9).

---

## 4. Execution order and rules for parallel work

### 4.1 Order

0. **Orchestrator preflight.**
   - Record listeners: `lsof -nP -iTCP:3000 -sTCP:LISTEN`, and the same for 3002 and 3100.
   - If a `next dev` from this repo is listening on 3000, stop it. One was running with dev widgets on and old-prod telemetry (F B8). Note the restart command for the user (`cd WEB && pnpm dev`).
   - Leave the socket server on 3002 running. It is already configured for `http://localhost:3000`.
1. **P0 runs alone.** Exit gate A:
   - `pnpm --filter web check-types` and `pnpm --filter web test:unit` pass.
   - The lint gates pass (§4.3).
   - `SP/phase1/lint-baseline.json` exists.
2. **P4a runs alone** (§9.1): the moves, the import rewrites, `npx next typegen`, and `check-types` green.
3. **The orchestrator starts the shared dev server** in the background, then warms it:
   ```
   cd WEB && NEXT_PUBLIC_DEV_WIDGETS=0 NEXT_PUBLIC_POSTHOG_KEY= NEXT_PUBLIC_SENTRY_DSN= SENTRY_DSN= NEXT_PUBLIC_GA_MEASUREMENT_ID= pnpm dev > SP/phase1/devserver.log 2>&1
   ```
   Warm `/dev/ui`, `/dev/ui/sections/{foundations,controls,overlays,shell,layout}`, `/dev/ui/shell`, `/dev/ui/stage`, `/play` and `/legends` with `curl -s -o /dev/null`. A cold compile can exceed the 30s test timeout.
4. **P0 browser gate B** (the orchestrator runs it; anything red goes back to P0 before step 5):
   - `foundations.spec.ts` and `a11y.spec.ts --grep foundations` on the 4 UI projects.
   - `layout/probe.spec.ts` on `ipad-landscape@110`, `iphone@110`, `android@110` and `ui-iphone`. Record the output (DPR, `(pointer: coarse)`, `(hover: none)`, `innerWidth`) in `SP/phase1/probe.json` for P1–P5.
   - Playwright screenshots of `/`, `/pricing`, `/legends` and `/sign-in` at 1440×900 in light and dark into `SP/phase1/screens/`.
5. **P1, P2, P3, P4b, P5 and P6 run in parallel** in the same working tree.
6. **Integration and the end-to-end test plan (§12)** run after all six hand back.

### 4.2 The shared dev server

There is exactly one, started in step 3. Packages never start, stop or restart it. `next dev` has PWA disabled, so service-worker behaviour is checked only on the production builds in §12.

### 4.3 Rules for P1–P6

- **Edit only files you own** (§3.1 plus your package's file list). Need a change elsewhere? Put it in your hand-back under "Requests for <owner>" and don't edit the file.
- **Never run during the parallel phase:** `pnpm install` or `pnpm add`; `next build`/`pnpm build`/`next start`/`next typegen`; `prisma generate`/`migrate`/`db push`; starting or stopping servers; `git mv` (P4a is done); `git commit/stash/checkout/reset/restore/push`.
- **Typecheck:** `pnpm --filter web check-types`. Your files must have zero errors. Report errors in other packages' files; don't fix them.
- **Lint (D19):**
  - New files: `cd WEB && npx eslint --max-warnings 0 <your new files>`.
  - Edited legacy files: `node SP/phase1/scripts/lint-delta.mjs <files>` must report no file above its baseline.
- **Unit tests:** `cd WEB && npx tsx --test <your test files>`, then `pnpm --filter web test:unit`.
- **Browser specs against the shared dev server:**
  ```
  cd WEB && DEVICES_BASE_URL=http://localhost:3000 npx playwright test -c playwright.devices.config.ts \
    --project=ui-desktop --project=ui-iphone --project=ui-android --project=ui-ipad --workers=2 ui/<your spec>
  ```
  Add `ui/a11y.spec.ts --grep <your section>` for your gallery section. If the server isn't reachable, say so in the hand-back; don't start one.

### 4.4 Checks expected to stay red until integration (F B7)

Report these as "expected red" rather than fixing around them:

| Package | Check | Turns green when |
|---|---|---|
| P3 | DemoContent one-viewport on all 40 projects | P5's suite runs in integration |
| P4 | `shell.spec.ts` items that need the real nav, account menu, palette or SubNav (2–8, 13, 14) | P3 lands |
| P5 | Soft golden board sizes, and tap-target checks on `/dev/ui/shell` | P3's real rail and bars land |
| P1, P2, P3, P5 | axe `landmark-unique` and colour contrast on other packages' sections | integration |
| P2 | Legacy-toast checks on pages inside the shell | P3 + P4 land |

### 4.5 Hand-back format

Files created/edited/deleted; contract additions; commands run, with results; expected-red checks; open issues; requests for other owners.

---

## 5. P0 Foundation (sequential, runs first)

**Goal:** tokens, fonts, dependencies, the root viewport primitive (flow and lock), base primitives, `cn`, lint and tsconfig hygiene, dev-route plumbing, the device-test harness, and behaviour-complete placeholders for every cross-package module.

### 5.1 Files

| Action | File |
|---|---|
| edit | `package.json`, root `pnpm-lock.yaml` (through `pnpm add`), `app/globals.css`, `app/layout.tsx`, `next.config.js`, `tsconfig.json`, `eslint.config.js`, `.gitignore`, `public/manifest.json`, `app/robots.ts`, `playwright.config.ts`, `lib/utils.ts` |
| replace | `components/ui/button.tsx` |
| create (final) | `components/ui/icon-button.tsx`, `kbd.tsx`, `spinner.tsx`, `count-badge.tsx`, `use-media-query.ts`; `components/layout/ViewportStage.tsx`, `components/layout/viewport.css`; `lib/utils.test.ts`, `lib/env.ts`, `lib/env.test.ts`, `lib/layout/media-queries.ts`, `lib/layout/media-queries.test.ts`, `lib/shell/types.ts`, `lib/shell/presence.ts`, `lib/shell/presence.test.ts`; `app/components/ThemeColorSync.tsx`; `app/dev/layout.tsx`, `app/dev/ui/page.tsx`, `app/dev/ui/sections/{foundations,controls,overlays,shell,layout}/page.tsx`, `app/dev/ui/_components/Specimen.tsx`, `app/dev/ui/_components/ThemeSwitch.tsx`, `app/dev/ui/_sections/foundations.tsx`; `playwright.devices.config.ts`, `e2e/devices/matrix.ts`, `zoom.ts`, `zoom.test.ts`, `helpers.ts`, `a11y.ts`, `e2e/devices/ui/foundations.spec.ts`, `e2e/devices/ui/a11y.spec.ts`, `e2e/devices/layout/probe.spec.ts` |
| create outside the repo | `SP/phase1/lint-baseline.json`, `SP/phase1/scripts/lint-delta.mjs` |
| create (placeholder → owner) | `components/ui/{avatar,tag,banner,skeleton,empty-state,switch,checkbox,page-header}.tsx` → P1; `components/ui/{tooltip,dialog,sheet,menu}.tsx` → P2; `components/shell/AppShellView.tsx` → P3; `app/dev/ui/_sections/controls.tsx` → P1, `overlays.tsx` → P2, `shell.tsx` → P3, `layout.tsx` → P5 |

### 5.2 Implementation notes

**Dependencies.**
1. `cd WEB && npm view radix-ui version && npm view cmdk version && npm view @axe-core/playwright version`.
2. `pnpm --filter web add --save-exact radix-ui@<v> cmdk@<v>` (01 §6 and F §1 list 1.8.1 and 1.1.1).
3. `pnpm --filter web add -D --save-exact @axe-core/playwright@<v>`.
4. `cd WEB && npx playwright install chromium webkit`. Only `chromium_headless_shell` is installed today.
5. Keep `@radix-ui/react-label` and `@radix-ui/react-slot`; removing them is later cleanup.

**`package.json` scripts** (exact):
```json
"test:unit": "tsx --test \"app/**/*.test.ts\" \"lib/**/*.test.ts\" \"components/**/*.test.ts\" \"prisma/**/*.test.ts\" \"e2e/devices/**/*.test.ts\"",
"test:devices": "playwright test -c playwright.devices.config.ts",
"test:layout": "playwright test -c playwright.devices.config.ts layout/",
"test:ui-gallery": "playwright test -c playwright.devices.config.ts ui/",
"prisma:seed:content": "tsx prisma/seed-content.ts"
```
Node 26 expands the quoted globs itself, and an empty glob is not an error (checked locally, F §1).

**`lib/utils.ts`** (F B1). Replace the default `twMerge` with:
```ts
import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: ["2xs", "label", "ui", "body", "heading", "title", "wordmark"] }],
      "rc-type": ["text-overline", "text-eyebrow"],
      shadow: [{ shadow: ["pop", "toast", "dialog", "modal", "board", "square-light", "square-dark", "badge", "mq", "promo"] }],
      animate: [{ animate: [(v: string) => v.startsWith("rc-")] }],
    },
  },
});
export function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)); }
```

**`eslint.config.js`** (F B2):
```js
import { nextJsConfig } from "@repo/eslint-config/next-js";
/** @type {import("eslint").Linter.Config[]} */
export default [
  ...nextJsConfig,
  { ignores: ["app/generated/**", ".next-*/**", "playwright-report*/**", "test-results/**", "public/sw.js", "public/workbox-*.js", "public/swe-worker-*.js"] },
  { files: ["e2e/**", "playwright*.ts", "prisma/**", "next.config.js", "scripts/**"], rules: { "turbo/no-undeclared-env-vars": "off" } },
];
```
Then record the baseline:
1. `cd WEB && npx eslint -f json . > SP/phase1/lint-baseline.json`.
2. Write the warning and error totals into the hand-back. The critique measured 37 warnings and 0 errors after the ignore; the 2 `no-sync-scripts` warnings in `app/layout.tsx` stay in the baseline.
3. `SP/phase1/scripts/lint-delta.mjs <files…>` runs `eslint -f json` on the given files and exits 1 when any file has more warnings or errors than in the baseline. Files not in the baseline must have 0.

**`tsconfig.json`** (F B9): append `".next-devices/types/**/*.ts"` and `".next-prodcheck/types/**/*.ts"` to `include`. Next then finds them present and doesn't rewrite the file. Nothing else changes.

**`app/globals.css`.** Every change is additive except the shadcn re-pointing, the focus rule and the cursor-rule move.
1. Line 1 stays `@import "tailwindcss";`. Line 2: `@import "../components/layout/viewport.css";`. Then the variants:
   ```css
   @custom-variant dark (&:where(.dark, .dark *));
   @custom-variant vh760 { @media (max-height: 760px) { @slot; } }
   @custom-variant vh700 { @media (max-height: 700px) { @slot; } }
   @custom-variant vh640 { @media (max-height: 640px) { @slot; } }
   @custom-variant vh620 { @media (max-height: 620px) { @slot; } }
   @custom-variant narrow { @media (max-width: 1100px) { @slot; } }
   @custom-variant rail {
     @media (max-width: 1100px), (hover: none) and (pointer: coarse) {
       &:not(:where([data-shell-form="sidebar"], [data-shell-form="sidebar"] *)) { @slot; }
     }
     &:where([data-shell-form="rail"], [data-shell-form="rail"] *) { @slot; }
   }
   @custom-variant tabbar { @media (max-width: 600px), (max-width: 900px) and (orientation: portrait) { @slot; } }
   @custom-variant tablet-portrait { @media (min-width: 601px) and (max-width: 900px) and (orientation: portrait) { @slot; } }
   ```
   Do **not** add 02 §3.1's `compact/short/xshort`.
2. Inside the existing `@theme inline` (after line 125), paste 02 §3.2 verbatim: fonts, v3 neutrals, status, result plates, chess colours, `--radius-xs`, shadows.
3. After the `@theme inline` block, paste 02 §3.3 verbatim: the static `@theme` with the type scale, tracking, `--ease-rc`, `--animate-rc-*` and keyframes.
4. In `:root` (before line 207), paste 02 §3.4 **without** its `/* sizes */` block (`--cb-control-*`, `--cb-header-h`, `--cb-sidebar-w`, `--cb-rail-w`, `--cb-tabbar-h`, and the one-line `--cb-z-*`). Add instead: `--cb-z-nav: 10; --cb-z-popover: 40; --cb-z-dialog: 50; --cb-z-toast: 60;`.
5. In `.dark` (before line 287), paste 02 §3.5 verbatim.
6. **Re-point the shadcn tokens to the brand tokens.**
   - In `:root` set: `--background: var(--cb-bg); --foreground: var(--cb-text); --card: var(--cb-surface); --card-foreground: var(--cb-text); --popover: var(--cb-surface); --popover-foreground: var(--cb-text); --border: var(--cb-border); --input: var(--cb-border-input); --ring: var(--cb-text);`.
   - In `.dark`, **delete** the same nine declarations, or `.dark` overrides them.
   - This fixes the opaque `oklch(0.922)` colour of a bare `border` (01 §15) and the pure-white `bg-background`.
7. In the existing `@layer base`, after the `*` rule:
   - `:focus-visible { outline: 2px solid var(--cb-text); outline-offset: 2px; }`
   - `::placeholder { color: var(--cb-text-soft); opacity: 1; }`
   - `:disabled, [aria-disabled="true"] { cursor: not-allowed; }`
8. **Move the cursor rule** (lines 28–34, `a, button, [role="button"], .cursor-pointer, [onclick] { cursor: pointer; }`) into `@layer base`, unchanged. Unlayered, it beats every utility, including `disabled:cursor-not-allowed` (C §3.1).
9. Top-level utilities from 02 §3.6: `text-overline`, `text-eyebrow`, and `tap-target`. Use `max(44px, 2.75rem)` in place of `2.75rem` (`inset-block: min(0px, calc((100% - max(44px, 2.75rem)) / 2))`, and the same for `inset-inline`). Put the §3.3 caveats in a comment.
10. **After line 315** (unlayered, on purpose: it must beat the `100dvh` override above it):
    ```css
    /* Inside the app shell, a legacy full-height root fills the space between the bars. */
    .rc-vs .min-h-screen { min-height: calc(100dvh - var(--topbar) - var(--tabbar) - var(--safe-top) - var(--safe-bottom)); }
    .rc-vs .h-screen { height: calc(100dvh - var(--topbar) - var(--tabbar) - var(--safe-top) - var(--safe-bottom)); }
    ```
11. Accessibility preferences (append at the end; unlayered):
    ```css
    @media (prefers-reduced-motion: reduce) { html, body { scroll-behavior: auto; } }
    @media (prefers-contrast: more) {
      :root { --cb-border: rgba(0, 0, 0, 0.3); }
      .dark { --cb-border: rgba(255, 255, 255, 0.35); }
    }
    ```
    Don't set `color-scheme` anywhere. next-themes already sets it.
12. Leave lines 3–26, 36–58 and 306–352 otherwise untouched: the `.min-h-screen → 100dvh` override, the reduced-motion rule and the marquee.

**`components/layout/viewport.css`** (final; the whole file sits in `@layer components`):
```css
@layer components {
  :root {
    --safe-top: env(safe-area-inset-top, 0px);
    --safe-right: env(safe-area-inset-right, 0px);
    --safe-bottom: env(safe-area-inset-bottom, 0px);
    --safe-left: env(safe-area-inset-left, 0px);
    --hit: max(44px, 2.75rem);
    --rc-top-bar: 44px;
    --rc-bottom-bar: 56px;
    --rc-nav-w: 0px;
    --rc-fixed-bottom: 0px;
    --rc-fixed-pad-bottom: var(--safe-bottom);
    --rc-overlay-bottom: calc(16px + var(--safe-bottom));
  }
  @media (min-width: 601px) and (max-width: 900px) and (orientation: portrait) {
    :root { --rc-top-bar: 52px; --rc-bottom-bar: 64px; }
  }

  html:has(.rc-vs[data-has-nav]) { --rc-nav-w: 220px; }
  @media (max-width: 1100px), (hover: none) and (pointer: coarse) { html:has(.rc-vs[data-has-nav]) { --rc-nav-w: 64px; } }
  @media (max-width: 600px), (max-width: 900px) and (orientation: portrait) {
    html:has(.rc-vs[data-has-nav]) { --rc-nav-w: 0px; }   /* same specificity as the 220/64 rules, later in source, so it wins */
    html:has(.rc-vs > [data-rc-tabbar]), html:has(.rc-vs [data-rc-controls]) {
      --rc-fixed-bottom: calc(var(--rc-bottom-bar) + var(--safe-bottom));
      --rc-fixed-pad-bottom: 0px;
      --rc-overlay-bottom: calc(var(--rc-bottom-bar) + var(--safe-bottom) + 8px);
    }
    html:has(.rc-vs > [data-rc-topbar]) { scroll-padding-top: calc(var(--rc-top-bar) + var(--safe-top)); }
  }

  /* Lock mode (D15): a one-viewport page is present, so the document never scrolls. Flow pages still scroll. */
  html:has(.rc-vs [data-rc-lock]), html:has(.rc-vs [data-rc-lock]) body { height: 100%; overflow: hidden; overscroll-behavior: none; }

  /* Flow mode is the default. */
  .rc-vs {
    --nav: 220px; --topbar: 0px; --tabbar: 0px;
    box-sizing: border-box; position: relative; width: 100%;
    min-height: 100dvh;
    display: grid;
    grid-template-areas: "nav top" "nav main" "nav tab";
    grid-template-columns: var(--nav) minmax(0, 1fr);
    grid-template-rows: auto minmax(0, 1fr) auto;
    padding: var(--safe-top) var(--safe-right) var(--safe-bottom) var(--safe-left);
    overflow-x: clip;                     /* clip, not hidden: no scroll container, so sticky still works */
    background: var(--cb-bg); color: var(--cb-text);
  }
  .rc-vs__nav  { grid-area: nav; position: sticky; top: var(--safe-top); align-self: start;
                 height: calc(100dvh - var(--safe-top) - var(--safe-bottom)); min-height: 0;
                 overflow-y: auto; overscroll-behavior: contain; z-index: var(--cb-z-nav); }
  .rc-vs__top  { grid-area: top; min-width: 0; display: none; height: var(--topbar);
                 position: sticky; top: 0; z-index: var(--cb-z-nav); }
  .rc-vs__main { grid-area: main; min-width: 0; position: relative; display: block; }
  .rc-vs__main:focus { outline: none; }
  .rc-vs__banner { min-width: 0; }
  .rc-vs__page { min-width: 0; }
  .rc-vs__tab  { grid-area: tab; display: none; position: sticky; bottom: 0; z-index: var(--cb-z-nav); }

  /* Lock mode. */
  .rc-vs:has([data-rc-lock]) { height: 100dvh; min-height: 0; overflow: clip; }
  .rc-vs:has([data-rc-lock]) > .rc-vs__main {
    min-height: 0; display: grid; grid-template-rows: auto minmax(0, 1fr);
    overflow: auto; overscroll-behavior: contain; }
  .rc-vs:has([data-rc-lock]) .rc-vs__page { min-height: 0; display: grid; grid-template: minmax(0, 1fr) / minmax(0, 1fr); }
  .rc-vs:has([data-rc-lock]) .rc-vs__page > * { min-width: 0; }

  .rc-skip { position: absolute; left: 8px; top: calc(8px + var(--safe-top)); z-index: 70; transform: translateY(-200%);
             padding: 0 14px; min-height: 44px; display: inline-flex; align-items: center;
             background: var(--cb-accent); color: var(--cb-accent-fg); font-size: 0.875rem; }
  .rc-skip:focus { transform: none; }

  @media (max-width: 1100px), (hover: none) and (pointer: coarse) { .rc-vs { --nav: 64px; } }
  .rc-vs--topbar-always { --topbar: 64px; }
  .rc-vs--topbar-always > .rc-vs__top { display: block; }
  @media (max-height: 640px) { .rc-vs--topbar-always { --topbar: 48px; } }

  @media (max-width: 600px), (max-width: 900px) and (orientation: portrait) {
    .rc-vs { --nav: 0px; --topbar: 44px; --tabbar: 56px;
             grid-template-areas: "top" "main" "tab"; grid-template-columns: minmax(0, 1fr);
             padding-top: 0; padding-bottom: 0; }
    .rc-vs__nav { display: none; }
    .rc-vs__top { display: block; height: calc(var(--topbar) + var(--safe-top)); padding-top: var(--safe-top); }
    .rc-vs__tab { display: block; height: calc(var(--tabbar) + var(--safe-bottom)); padding-bottom: var(--safe-bottom); }
  }
  @media (min-width: 601px) and (max-width: 900px) and (orientation: portrait) { .rc-vs { --topbar: 52px; --tabbar: 64px; } }

  /* Slots render only when passed (M10). These selectors are 0,2,0, so they beat the 0,1,0 media rules above. */
  .rc-vs:not([data-has-nav]) { --nav: 0px; }
  .rc-vs:not(:has(> .rc-vs__top)) { --topbar: 0px; }
  .rc-vs:not(:has(> .rc-vs__tab)) { --tabbar: 0px; }
}
```
In tab-bar mode with no top bar (stage `chrome=none`), the safe-top padding is lost. That route is a test fixture, so this is acceptable. Banner rows (SubNav, payment) add to a flow page's height, so a short legacy page can scroll by the banner height; this is accepted for Phase 1.

**`components/layout/ViewportStage.tsx`.** Implement §3.4 using 04 §4.2's TSX, with:
- the `data-has-nav` attribute;
- the skip link (`<a className="rc-skip" href="#main" data-testid="skip-link">Skip to Content</a>`) as the first child, only when `nav || topbar`;
- the nav, top-bar and tab-bar slots **only when passed**;
- `tabIndex={-1}` on `main`;
- the `data-testid` passthrough.

**`app/layout.tsx`:**
- Lines 2 and 16–23: `import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";`, with `const geistSans = Geist({ subsets: ["latin"], variable: "--font-geist-sans", display: "swap" });` and `const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono", display: "swap" });`. Drop the `localFont` import. Leave `app/fonts/*.woff` in place, because `global-error.tsx` uses them.
- Line 104: `<html lang="en" className={`light ${geistSans.variable} ${geistMono.variable} ${instrumentSerif.variable}`} suppressHydrationWarning>`. Line 152: `<body className="bg-cb-bg">`.
- Lines 33–37 (H3: one colour; ThemeColorSync follows the app theme):
  ```ts
  export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#FAF9F6" };
  ```
  Never set `maximumScale`/`userScalable` or `interactiveWidget` (04 §4.2).
- Line 80: `statusBarStyle: "default"` (D18, H4; sign-off U6 in §13).
- Wrap the app's children (inside `ThemeProvider`) in `<TooltipProvider>` from `@/components/ui/tooltip`, and render `<ThemeColorSync/>` next to `ThemeAwareToaster`.
- Line 128: the dev widgets render only when `process.env.NODE_ENV === "development" && process.env.NEXT_PUBLIC_DEV_WIDGETS !== "0"`.

**`app/components/ThemeColorSync.tsx`** (client): reads `resolvedTheme` from next-themes and sets `content` on `meta[name="theme-color"]`: `#000000` in dark, `#FAF9F6` in light. It renders null.

**Other shared edits:**
- `next.config.js`:
  - `withPWAInit({ … })`: `reloadOnOnline: false` (it is `true` at l.17 today; D18).
  - `nextConfig`: `distDir: process.env.NEXT_DIST_DIR || ".next",` and `devIndicators: process.env.NEXT_PUBLIC_DEV_WIDGETS === "0" ? false : undefined,` (04 §8.6).
- `.gitignore` (apps/web): add `/.next-*/`, `/prisma/.seed-cache/`, `/playwright-report*/`, `/public/swe-worker-*.js.map`. The tracked `public/swe-worker-5c72df51bb1f6ee0.js.map` stays tracked; §12.1 restores it if a build touches it.
- `public/manifest.json`: `"id": "/"` (added first, so existing installs keep their identity), `"start_url": "/play"`, `"orientation": "any"`, `"background_color": "#FAF9F6"`, `"theme_color": "#FAF9F6"`.
- `app/robots.ts`: add `"/dev/"` to `disallow`.
- `playwright.config.ts`: both `webServer` entries get `reuseExistingServer: process.env.PW_REUSE_SERVER === "1"`. The default stays `false`.

**`lib/env.ts`** (fail closed, D11):
```ts
/** Inlined at build time: "dev" on replay-chess-dev, "production" on prod, "test" in the devices build, unset locally. */
export function appEnv(value: string | undefined = process.env.NEXT_PUBLIC_APP_ENV): string | null { return value || null; }
export function isProductionApp(value: string | undefined = process.env.NEXT_PUBLIC_APP_ENV): boolean { return value === "production"; }
export function devRoutesEnabled(
  value: string | undefined = process.env.NEXT_PUBLIC_APP_ENV,
  nodeEnv: string | undefined = process.env.NODE_ENV,
): boolean {
  return value === "dev" || value === "test" || (!value && nodeEnv === "development");
}
```
Read `process.env.NEXT_PUBLIC_APP_ENV` and `process.env.NODE_ENV` literally, as above, so Next inlines them.

**`app/dev/layout.tsx`:** `export const metadata: Metadata = { title: "Dev", robots: { index: false, follow: false } };` and `if (!devRoutesEnabled()) notFound(); return children;`.

**`app/dev/ui/page.tsx`** and **`GalleryFrame`.** Server components. The root is `div[data-testid="ui-gallery"].min-h-screen.bg-cb-bg.text-cb-text`. A sticky header (`sticky top-0 z-10 flex flex-wrap items-center justify-between gap-4 border-b border-cb-border bg-cb-bg px-4 py-3 sm:px-8`) holds:
- the `h1` "UI Gallery" (`font-serif text-heading`);
- an anchor nav: Foundations, Controls, Overlays, Shell, Layout, plus the links "Shell Demo" (`/dev/ui/shell`) and "Stage Demo" (`/dev/ui/stage`), all `min-h-11`;
- `<ThemeSwitch/>`.

Then `main.mx-auto.flex.max-w-7xl.flex-col.gap-16.px-4.py-10.sm:px-8` holds the five sections in order. The page scrolls the document normally; there is no `.rc-vs` on it. Each `sections/<id>/page.tsx` renders `<GalleryFrame title="UI Gallery · <Title>">` with only that section.

`ThemeSwitch` (client): two P0 `Button variant="secondary" size="sm"`, "Light" and "Dark", with `pressed`, testids `gallery-theme-light`/`gallery-theme-dark`, wrapper `gallery-theme-toggle`. It uses next-themes `setTheme`, with a mounted guard.

**`_sections/foundations.tsx`** (testids):
- `ui-tokens-neutrals`: swatches of every `cb-*` neutral plus the new v3 neutrals, each labelled with its token name
- `ui-tokens-status`: good/warn/bad text on their tints
- `ui-tokens-chess`: board, highlight, pv and mq swatches
- `ui-type-scale`: title, heading, body, ui, label, 2xs, overline, eyebrow, wordmark, mono
- buttons: `ui-button-primary`, `ui-button-secondary`, `ui-button-text`, `ui-button-danger`, `ui-button-danger-outline`, `ui-button-control`, `ui-button-sizes`, `ui-button-loading` (a button with `loading` and `loadingLabel="Creating Game…"`), `ui-button-disabled`, `ui-button-pressed`
- `ui-icon-button`: outline/ghost/solid × sm/md/lg, with aria-labels
- `ui-kbd`: `⌘K`/`Ctrl K` via `ModKey`, `Esc`, `?`
- `ui-spinner`, `ui-count-badge` (counts 1, 12 and 120)
- `ui-focus-demo`: three buttons on `cb-bg`, `cb-surface` and an accent fill, to show the ring

**Placeholders: behaviour-complete and visually minimal** (F B7). Each has the §3.4/§3.5 signature.
- `Avatar`: initials in a sized `span`.
- `Tag`: a `span` with icon and children.
- `Banner`:
  - maps `live` to `role="status"`/`role="alert"`;
  - renders `title`, `children` and `action`;
  - when `onDismiss` is set, renders a P0 `IconButton size="sm" variant="ghost"` with `label={dismissLabel ?? "Dismiss for this session"}` and a lucide `X`.
- `Skeleton` family: `aria-hidden` spans in `bg-cb-fill`; `SkeletonRegion` sets `aria-busy` and an sr-only "Loading…".
- `EmptyState`: heading, body, primary and secondary.
- `Switch`/`SwitchRow`: Radix Switch Root and Thumb with a label row.
- `Checkbox`/`CheckboxRow`: Radix Checkbox Root and Indicator with a label row.
- `PageHeader`: overline, `h1`, info and actions in a flex row.
- `Tooltip`: real `TooltipPrimitive.Root`/`Trigger asChild`/`Portal`/`Content` showing `content`; `TooltipProvider` set to 300/300.
- `Dialog`/`AlertDialog`/`Sheet`: Radix with `aria-modal="true"`.
  - Dialog honours `size` (`--w`), `align`, `hideTitle` (VisuallyHidden) and `hideClose`.
  - Sheet Content is `fixed inset-x-0 bottom-0 max-h-[90dvh]` and honours `height`.
- `Menu`: every export works, including the checkbox and radio items.
- `AppShellView`: `"use client"`.
  - It calls `markShellMounted()` in an effect.
  - It renders `<ViewportStage data-testid="app-shell" nav={<nav aria-label="Main navigation" data-testid="shell-sidebar"/>} topbar={<header data-testid="shell-topbar"/>} tabbar={hideTabBar ? undefined : <nav aria-label="Main navigation" data-testid="shell-tabbar"/>} banner={banner}>{children}</ViewportStage>`.
  - It accepts and ignores the other props.
- Each section placeholder renders `<GallerySection id=… title=…><p className="text-cb-text-soft">Pending.</p></GallerySection>`.

**Device-test harness.**
- `e2e/devices/zoom.ts` (pure, no imports): `zoomViewport(base: {width,height}, zoom) → {width: Math.round(w/zoom), height: Math.round(h/zoom)}`, `zoomDpr(dpr, zoom)`, `zoomInsets(insets, zoom)`.
- `e2e/devices/matrix.ts`:
  - 04 §8.3 `BASE_DEVICES` (8 devices; browser per 04 §8.2: desktops and Android on chromium, iPads and iPhones on webkit).
  - `ZOOMS` from env `LAYOUT_ZOOMS`, default `0.8,1,1.1,1.25,1.5`, with `zoomed()` built on `zoom.ts`.
  - `UI_PROJECTS` (zoom 1): `ui-desktop` → `desktop-1440`, `ui-iphone` → `iphone`, `ui-android` → `android`, `ui-ipad` → `ipad-landscape`.
  - `MOTION_PROJECTS`: `ui-desktop-motion` → `desktop-1440` and `ui-iphone-motion` → `iphone`, both with `reducedMotion: "no-preference"`.
- `playwright.devices.config.ts` (04 §8.3 with these changes):
  - `testDir: "./e2e/devices"`;
  - matrix projects named `` `${id}@${zoom%}` `` with `testMatch: "layout/**/*.spec.ts"`;
  - UI projects with `testMatch: "ui/**/*.spec.ts"`; motion projects with `testMatch: "ui/overlays.spec.ts"`;
  - top-level `use: { baseURL: process.env.DEVICES_BASE_URL ?? "http://localhost:3100", reducedMotion: "reduce", serviceWorkers: "block", trace: "retain-on-failure", screenshot: "only-on-failure" }`, `expect: { timeout: 10_000 }`, `timeout: 30_000`, `retries: 0`, `workers: process.env.CI ? 4 : "50%"`;
  - load `.env.test` with `override: true` (dev DB, Clerk dev);
  - `webServer` only when `DEVICES_BASE_URL` is unset: `{ command: "pnpm build && pnpm start --port 3100", port: 3100, timeout: 600_000, reuseExistingServer: !process.env.CI, env: { NEXT_DIST_DIR: ".next-devices", NEXT_PUBLIC_DEV_WIDGETS: "0", NEXT_PUBLIC_APP_ENV: "test", NEXT_PUBLIC_POSTHOG_KEY: "", NEXT_PUBLIC_SENTRY_DSN: "", SENTRY_DSN: "", NEXT_PUBLIC_GA_MEASUREMENT_ID: "" } }`.

  The blank keys matter. `next build`/`next start` load `.env.local`, which holds the **old-prod** PostHog, Sentry and GA keys and the old-prod DB URL. `.env.test` overrides the DB, and the blanks stop test traffic reaching prod telemetry. `@next/env` doesn't overwrite a defined-but-empty key (F §1).

  The header comment lists F §5's caveats:
  - WebKit's fractional DSF and pointer/hover media are taken from the P0 probe;
  - the Safari dynamic toolbar is approximated by `iphone-safari` 393×659;
  - headless scrollbars are overlay scrollbars;
  - insets are emulated only in the layout fixtures.
- `e2e/devices/helpers.ts`:
  - `waitForStable(page)`: `waitForLoadState("load")`, then `document.fonts.ready`, then 2 animation frames, then `page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {})` (F M11).
  - `isCoarse(page)`: `matchMedia(COARSE_POINTER_MQ)`, for tap targets. `isTouchShell(page)`: `matchMedia(COARSE_MQ)`, for shell-mode expectations.
  - `expectTapTargets(page, { root = "body", primaryMin = 44, otherMin = 24, all44 = false })`: 04 §8.5's version scoped to `root`. It measures the effective hit box, including a `tap-target` `::after`. With `all44`, every target under `root` must be ≥ 44 on every project.
  - `isChromium(testInfo)`: keyboard-driven tests skip elsewhere (F M6).
  - `gotoSection(page, id)`: opens `/dev/ui/sections/<id>` and waits for stability.
  - Import app code with relative paths (`../../lib/layout/media-queries`), not `@/`, so the Playwright TS loader doesn't depend on tsconfig `paths`.
- `e2e/devices/a11y.ts`: `expectNoAxeViolations(page, { include?: string, theme: "light" | "dark" })`. It uses `@axe-core/playwright` with tags `wcag2a, wcag2aa, wcag21a, wcag21aa`, and must cover `color-contrast`, `landmark-unique`, `aria-*` and `button-name`.
- `e2e/devices/ui/a11y.spec.ts`: for each section route, plus `/dev/ui/shell` and `/dev/ui/stage` (skipped with a message while the route returns 404), runs `expectNoAxeViolations` in light and in dark. Tests are titled `a11y <id> <theme>`, so packages can `--grep` their own.
- `e2e/devices/layout/probe.spec.ts`: on every project, opens `/dev/ui` and attaches `{ project, innerWidth, innerHeight, dpr, coarsePointer, hoverNone, portrait, dvh }`. It asserts only that the page loads.

### 5.3 Acceptance criteria

- Type check, `test:unit` and the D19 lint gates pass. `pnpm --filter web dev` starts. `/dev/ui` and every `/dev/ui/sections/<id>` return 200 locally.
- `devRoutesEnabled("production") === false` and `devRoutesEnabled(undefined, "production") === false`.
- The body's computed `font-family` starts with `Geist`, and `(await document.fonts.load("500 16px Geist")).length > 0` on `/pricing` and `/dev/ui` (F M4: `fonts.check` proves nothing). Instrument Serif still renders on the Navbar wordmark.
- Toggling `.dark` on `<html>` changes `getComputedStyle(body).backgroundColor` to `rgb(0, 0, 0)` and the `theme-color` meta to `#000000`.
- `cn("text-ui text-cb-text-soft") === "text-ui text-cb-text-soft"`.
- No visual regression beyond the font change and the hairline-colour change: the step-4 screenshots of `/`, `/pricing`, `/legends` and `/sign-in` in both themes.
- Every placeholder compiles with its final signature and behaves as listed above. The gallery shows five sections.

### 5.4 Tests

- Unit:
  - `lib/env.test.ts`: `("production","development")` → false; `("dev","production")` → true; `("test","production")` → true; `(undefined,"development")` → true; `("","development")` → true; `(undefined,"production")` → false; `("staging","development")` → false.
  - `lib/layout/media-queries.test.ts`: each constant except `COARSE_POINTER_MQ` appears verbatim in `components/layout/viewport.css` or `app/globals.css`. Resolve the paths from `import.meta.url`, not the cwd.
  - `e2e/devices/zoom.test.ts`: 1440×900@1.25 → 1152×720 at DPR 2.5; 1280×800@1.5 → 853×533 at DPR 3; insets ÷ zoom.
  - `lib/utils.test.ts`: `cn("text-ui text-cb-text-soft")` keeps both; `cn("text-ui text-body") === "text-body"`; `cn("text-overline text-cb-text")` keeps both; `cn("shadow-pop shadow-modal") === "shadow-modal"`; `cn("bg-cb-accent text-cb-accent-fg text-ui px-2")` keeps all four.
  - `lib/shell/presence.test.ts`: `markShellMounted()` makes `isShellPresent()` true; the cleanup makes it false; two marks need two cleanups.
- E2E `e2e/devices/ui/foundations.spec.ts` (UI projects, `/dev/ui/sections/foundations` unless noted):
  - `/dev/ui` → 200; all five `gallery-*` sections present; `<meta name="robots" content*="noindex">` present.
  - `gallery-theme-dark` → `html` has class `dark`, and the `ui-tokens-neutrals` swatch `cb-bg` computes to black.
  - `ui-button-primary` button: `border-radius: 0px`, height ≥ 44, background equal to the `--cb-accent` value.
  - `expectTapTargets(page, { root: '[data-testid="ui-button-sizes"]', all44: true })`.
  - Chromium only: Tab onto the `ui-focus-demo` buttons gives `outline-style: solid` and `outline-width: 2px`.
  - The loading button has `aria-busy="true"` and `aria-disabled="true"`, and a click doesn't fire.
  - The Geist font loads (as in §5.3).

---

## 6. P1 UI kit: controls, data display, feedback

**Goal:** every non-overlay component in `components/ui`, built to 02 §5 with the conflict resolutions in 02 §6.

### 6.1 Files

- Own (placeholders): `components/ui/avatar.tsx`, `tag.tsx`, `banner.tsx`, `skeleton.tsx`, `empty-state.tsx`, `switch.tsx`, `checkbox.tsx`, `page-header.tsx`, `app/dev/ui/_sections/controls.tsx`.
- Create: `components/ui/chip.tsx`, `segmented.tsx`, `tabs.tsx`, `field.tsx`, `radio-card.tsx`, `card.tsx`, `divider.tsx`, `disclosure.tsx`, `progress.tsx`, `action-bar.tsx`, `components/ui/avatar-gradient.ts`, `components/ui/avatar-gradient.test.ts`, `components/ui/field-a11y.ts`, `components/ui/field-a11y.test.ts`, `e2e/devices/ui/controls.spec.ts`.
- Delete: `components/ui/label.tsx` (zero consumers; `field.tsx` uses Radix `Label` directly).

### 6.2 Implementation notes

Conventions for every component:
- `cva` + `cn`, the React 19 `ref` prop, no memo hooks. Radix comes from `radix-ui`.
- Focus comes from the global ring. Flush rows (segments, tabs) use `focus-visible:-outline-offset-2`.
- Selected/on states add `forced-colors:outline forced-colors:outline-2 forced-colors:-outline-offset-2`, so they survive Windows forced colours.
- Touch feedback on neutral (non-accent) controls: `[-webkit-tap-highlight-color:transparent] active:bg-cb-fill`.

| Component | Radix | Spec source | Required details |
|---|---|---|---|
| `Chip`, `ChipGroup`, `RemovableChip` (`chip.tsx`) | Toggle, ToggleGroup | 02 §5.3, C5 | `min-h-10 pointer-coarse:min-h-11 tap-target px-3.5 border border-cb-border-strong bg-cb-surface text-sm hover:bg-cb-fill data-[state=on]:bg-cb-accent data-[state=on]:text-cb-accent-fg data-[state=on]:border-cb-accent`. `ChipGroup type="single"` never deselects (`onValueChange={(v) => v && set(v)}`). `columns` → `grid grid-cols-{n} gap-1 pointer-coarse:gap-1.5`. `mono` chips: `font-mono text-ui justify-center px-1`. RemovableChip is a plain button, `aria-label="Remove filter: {text}"`, with a 14px `X`. |
| `Segmented` (`segmented.tsx`) | **RadioGroup** (F M2: arrows select) | 02 §5.4, C13 | Props `{ value, onValueChange, items: {value,label,icon?,disabled?}[], "aria-label", fill? }`. Item: `min-h-[2.375rem] pointer-coarse:min-h-11 tap-target px-3.5 border-r border-cb-border-strong last:border-r-0 text-ui text-cb-text-soft data-[state=checked]:bg-cb-accent data-[state=checked]:text-cb-accent-fg`. Never `role="tab"`. |
| `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent` (`tabs.tsx`) | Tabs | 02 §5.5 | `variant: "underline" \| "overline" \| "segmented"` on `Tabs` (read through context or `data-variant`); `fit: "fill" \| "auto"` on the list. Use the underline classes exactly as in 02 §5.5, with the bold-width reservation (`after:content-[attr(data-label)]`), so no `tap-target` on triggers. Triggers are `min-h-11`. **Overflow:** `TabsList` is `overflow-x-auto scrollbar-hide`, and the active trigger runs `scrollIntoView({ block: "nearest", inline: "nearest" })` on change. |
| `Field`, `Input`, `Textarea`, `Select`, `Slider` (`field.tsx`) | Label | 02 §5.9, C15, C16 | `Field` injects `id`, `aria-describedby` (hint id, then error id), `aria-invalid` (only while an error shows) and `aria-required` into its single child via `cloneElement`. The id logic lives in the pure `field-a11y.ts`. **Input:** `h-11 px-3 border border-cb-border-input bg-cb-surface text-body pointer-coarse:text-base focus:outline-2 focus:outline-cb-text focus:-outline-offset-1 aria-invalid:border-cb-bad aria-invalid:shadow-[inset_0_0_0_1px_var(--cb-bad)] disabled:bg-cb-fill disabled:text-cb-text-secondary`; `leadingIcon` → `pl-9`. **Error row:** `CircleAlert` 14px + `text-ui text-cb-bad`. **Hint:** `text-xs leading-[1.4] text-cb-text-soft`. **Textarea:** `h-auto py-2.5 resize-none`. **Select:** native, with the input classes plus `appearance-none rounded-none pr-9`, and an absolutely positioned 16px `ChevronDown` (`pointer-events-none`). **Slider:** native range, `w-full h-8 accent-cb-accent`; WebKit keeps a round thumb, which is accepted and noted in JSDoc. |
| `Switch`, `SwitchRow` (`switch.tsx`) | Switch | 02 §5.10 | 44×26 track, 18px thumb, accent when checked. `SwitchRow` makes the whole `min-h-14` row a `<label htmlFor>`, with an optional description line. |
| `Checkbox`, `CheckboxRow` (`checkbox.tsx`) | Checkbox | README disclosure patterns (C §3.1) | `size-[18px] border border-cb-border-strong bg-cb-surface data-[state=checked]:bg-cb-accent data-[state=checked]:border-cb-accent data-[state=indeterminate]:bg-cb-accent`. The indicator is a 14px `Check` or `Minus` in `text-cb-accent-fg`. It has no rounding. `CheckboxRow` is a `min-h-11` `<label>` row. |
| `RadioCardGroup`, `RadioCard` (`radio-card.tsx`) | RadioGroup | 02 §5.11 | `variant: "row" \| "swatch"`. |
| `Banner` | — | 02 §5.6, C11 | V4 tinted tones: `good` = `bg-cb-good-bg border-cb-good/45` with a `CircleCheck` icon in `text-cb-good`; warn (`TriangleAlert`) and bad (`CircleAlert`) follow the same pattern. `info` uses `bg-cb-surface border-cb-border` with an `Info` icon. Body text stays `cb-text`. `live` maps to `role="status"`/`role="alert"`, **never** `role="banner"`. Dismiss: P0 `IconButton size="sm" variant="ghost"` with an `X`. |
| `Tag` | — | 02 §5.7 | `.tag`/`.pill`/`.s5-chip`/`.stat` variants. The shell's trial tag is `<Tag tone="warn" variant="tint" size="sm">`: `#8a5a12` on `#fbf6ec`, border warn/45. |
| `Card`, `CardHeader`, `CardBody` (`card.tsx`) | — | 02 §5.8 | `as`; `padding: none\|sm\|md\|lg\|xl` (0 / 14 / 18×16 / 20 / 28 px); `interactive` → `hover:bg-cb-fill`. |
| `Divider`, `Overline`, `Eyebrow` (`divider.tsx`) | — | 02 §5.18 | `Overline as="h2"\|"h3"\|"span"\|"label"\|"legend"`. `Eyebrow` is marketing only (JSDoc warning). |
| `Disclosure` (`disclosure.tsx`) | none (native `<details>`) | 02 §5.18 | Summary `min-h-11 font-medium`. `ChevronDown` rotates with `group-open:rotate-180 motion-reduce:transition-none`. |
| `Avatar` (+ the pure `avatar-gradient.ts`) | — | 02 §5.18 | The 6 gradient pairs from 02 §4 (`#ddd6e2→#82748f`, `#d6dde2→#6f8796`, `#e6dcc2→#a98a43`, `#e4d3cf→#a06f62`, `#d8ddcf→#7c8a6a`, `#e2d6c6→#a88c6d`), picked by a stable string hash of `seed`. `initials(name)`: up to 2 letters, uppercase. Gradient initials use the serif font with `[text-shadow:0_1px_1px_rgba(0,0,0,0.18)]`. `neutral` = `bg-cb-fill border border-cb-border-strong font-mono text-label text-cb-text-soft`; `ink` = accent. When `src` is set, render **`next/image`** with `unoptimized`, `width`/`height` = size, `alt=""` (decorative) or the name, and `object-cover`; fall back to initials `onError`. That satisfies `@next/next/no-img-element`. |
| `Skeleton` family | — | 02 §5.15, 03 §11 | Shimmer `after:` classes exactly as in 02 §5.15. Every skeleton is `aria-hidden`. `SkeletonRegion` sets `aria-busy="true"` with one `sr-only` "Loading…". Under reduced motion the shimmer is static. |
| `ProgressBar`, `StackedBar` (`progress.tsx`) | Progress | 02 §5.17 | `label` is required; `getValueLabel` → "212 of 480 games". |
| `ActionBar` (`action-bar.tsx`) | — | 02 §5.18 | `role="alert"` for incoming offers, `role="status"` for outgoing. Buttons are P0 `Button variant="control"`/`"primary"` at `min-h-10 pointer-coarse:min-h-11 tap-target`. |
| `EmptyState` | — | 03 §12.1 | Ghost rows: `h-11 border border-dashed`, with opacity stepping 0.22 → 0.16 → 0.10 through `border-cb-border-dashed` and `opacity-*`. The title is serif, `text-[2.25rem]/[1.05]` (page) or `text-2xl/[1.1]` (card), in Title Case. The body is `text-body text-cb-text-soft`. One primary and at most one secondary text link, centred in the region. |
| `PageHeader` (`page-header.tsx`) | — | 03 §7.2, README "Use space wisely" | Root `flex items-end justify-between gap-4 px-8 pt-7 pb-6 narrow:px-6 vh700:px-6 vh700:pt-4 vh700:pb-3.5 tabbar:px-4`. The overline uses `text-overline`. The title is `font-serif text-title` (the D9 clamp) followed by the `info` slot inline. `actions` sit on the right with `flex gap-2.5`. |

**Gallery section `controls.tsx`** (testids; each specimen shows the default, hover-able, disabled and error states where they apply):
- `ui-chip`; `ui-chip-group` (time controls `1+0 3+2 5+3 10+0 15+10 30+0`, `columns={3}`, mono); `ui-chip-removable`
- `ui-segmented` (Colour: White / Random / Black); `ui-segmented-fill`
- `ui-tabs-underline` (Coach / Moves / Engine, with panels); `ui-tabs-overline`; `ui-tabs-segmented`; `ui-tabs-overflow` (Overview · Games · Stats · Milestones · Openings in a 320px box)
- `ui-field-default`; `ui-field-error` (label "Username", error "Username is taken."); `ui-field-hint`; `ui-field-disabled`; `ui-input-search`; `ui-textarea`; `ui-select`; `ui-slider`
- `ui-switch`, `ui-switch-row`, `ui-checkbox`, `ui-checkbox-row` (including an indeterminate one), `ui-radio-card`, `ui-radio-swatch`
- `ui-banner-info`, `ui-banner-good`, `ui-banner-warn`, `ui-banner-bad`, `ui-banner-note`, `ui-banner-dismiss` (dismissing hides it)
- `ui-tag-neutral|good|warn|bad|ink`, `ui-tag-pill`, `ui-tag-tint`, `ui-tag-metric`
- `ui-card`, `ui-card-interactive`, `ui-divider`, `ui-overline`, `ui-eyebrow`, `ui-disclosure`, `ui-page-header` (overline "Train", title "Mistake Bank", a plain `IconButton` in the info slot, a secondary action)
- `ui-avatar-sizes`, `ui-avatar-variants`, `ui-avatar-image-fallback` (a broken `src`)
- `ui-skeleton-text`, `ui-skeleton-row`, `ui-skeleton-region`
- `ui-progress`, `ui-stacked-bar`, `ui-action-bar`
- `ui-empty-state-page` ("No Games Yet" / "Your games appear here after you play or import them.", with the primary "Play a Game" as a `Link` to `/play`); `ui-empty-state-card` ("All Caught Up")

### 6.3 Acceptance criteria

- All exports follow §3.5 (placeholders) and the props above. No `rounded-*` other than the allowed `rounded-full` uses.
- Light and dark both render with tokens only. `rg "#[0-9a-fA-F]{3,6}|rgba\(" components/ui/{chip,segmented,tabs,field,switch,checkbox,radio-card,banner,tag,card,divider,disclosure,avatar,skeleton,progress,action-bar,empty-state,page-header}.tsx` may match only the avatar gradient table and the switch border pair from 02 §5.10.
- Every interactive specimen has an effective hit box ≥ 44 on every project.
- Contrast: banner icons and text pass AA in both themes (axe, `a11y controls light|dark`).

### 6.4 Tests

- Unit:
  - `avatar-gradient.test.ts`: the same seed gives a stable index; all 6 pairs are reachable over 100 seeds; `initials("Bobby Fischer") === "BF"`; `initials("knightowl_88") === "K"`; empty → `"?"`.
  - `field-a11y.test.ts`: `aria-describedby` order is hint, then error; no `aria-invalid` without an error.
- E2E `e2e/devices/ui/controls.spec.ts` (UI projects, `/dev/ui/sections/controls`; keyboard steps on Chromium only):
  - ChipGroup: a click sets `data-state="on"`; ArrowRight moves focus (roving); clicking the selected chip keeps it on.
  - Segmented: items are `role="radio"`; ArrowRight changes `aria-checked` to the next item.
  - Tabs: `role="tablist"` / `tab` / `tabpanel`; ArrowRight activates the next tab; `aria-selected` updates; the panel content changes. On `ui-iphone`, clicking the last tab in `ui-tabs-overflow` keeps its box inside the list box.
  - `ui-field-error`: the input has `aria-invalid="true"`; `aria-describedby` resolves to elements containing the hint and "Username is taken."; the border colour equals `--cb-bad`.
  - The input `font-size` computes to `16px` when `matchMedia("(pointer: coarse)")` matches and `15px` otherwise.
  - `ui-select`: `appearance` computes to `none` and `border-radius` to `0px`.
  - Switch: `role="switch"` toggles `aria-checked`; clicking the row label toggles it.
  - Checkbox: Space toggles `aria-checked`; the indeterminate one reports `aria-checked="mixed"`; `border-radius: 0px`.
  - RadioCard: arrow keys move the selection.
  - Disclosure: Enter on the summary toggles `open`.
  - Banner: `role="status"`; the dismiss button's name is "Dismiss for this session"; dismissing removes the `ui-banner-dismiss` content.
  - `expectTapTargets(page, { root: '[data-testid="gallery-controls"]', all44: true })`.
  - With `gallery-theme-dark`, the `ui-banner-good` background computes to `rgb(26, 30, 23)` (`#1a1e17`).
  - axe: `a11y controls light` and `a11y controls dark` pass.

---

## 7. P2 UI kit: overlays and toasts

**Goal:** Tooltip, Popover, InfoButton, FilterPopover, Menu, Dialog/AlertDialog, Sheet, ResponsiveDialog, and Toast (the `notify` API plus the restyled global Toaster).

### 7.1 Files

- Own (placeholders): `components/ui/tooltip.tsx`, `dialog.tsx`, `sheet.tsx`, `menu.tsx`, `app/dev/ui/_sections/overlays.tsx`.
- Create: `components/ui/popover.tsx`, `info-button.tsx`, `filter-popover.tsx`, `responsive-dialog.tsx`, `toast.tsx`, `toast.css`, `toast-config.ts`, `toast-config.test.ts`, `e2e/devices/ui/overlays.spec.ts`.
- Edit: `app/components/ThemeAwareToaster.tsx`.
- Import, don't create: `use-media-query.ts`, `count-badge.tsx` and `lib/shell/presence.ts` (P0); the `checkbox.tsx` placeholder (P1).

### 7.2 Implementation notes

- **Tooltip** (§3.5). `TooltipProvider` is mounted once by P0 in `app/layout.tsx`; `Tooltip` doesn't wrap its own. Content: `z-(--cb-z-popover) bg-cb-accent text-cb-accent-fg text-ui px-2 py-1 data-[state=delayed-open]:animate-rc-fade motion-reduce:animate-none`, with `sideOffset={8}`. It opens on hover and focus. Radix doesn't open tooltips on touch, so never put essential information in one.
- **Popover** (`popover.tsx`): `Popover`, `PopoverTrigger`, `PopoverContent({ width = 340, title?, align = "end", sideOffset = 8, collisionPadding = 16 })`.
  - Content classes from 02 §5.12: `p-4 flex flex-col gap-3.5 w-[var(--w)] max-w-[calc(100vw-32px)] bg-cb-surface border border-cb-border-strong shadow-pop`.
  - `title` → `aria-label` on the content plus a visible `<p className="text-overline">`. Don't use P1's `Overline` (F B7).
- **InfoButton** (`info-button.tsx`): `{ label?: string /* default "About This Page" */; title?: React.ReactNode; children: React.ReactNode; side?; align? }`.
  - It renders `IconButton variant="ghost" size="sm" icon={<Info/>}` with a Popover that opens on click or tap (README: "the screen's description lives there").
- **FilterPopover** (`filter-popover.tsx`): `{ count: number; chips?: React.ReactNode; children: React.ReactNode; onClearAll?: () => void; showLabel?: string; onShow?: () => void; width?: number }`.
  - Trigger: `Button variant="secondary" size="sm" iconStart={<SlidersHorizontal/>}` "Filter", plus `<CountBadge count={count}/>`. Its `aria-label` is "Filter, {n} active" when n > 0.
  - Content: the active `chips` row, then `children`, then a footer `flex items-center justify-between border-t border-cb-border pt-3` with a text button "Clear All" and a primary `size="sm"` button (`showLabel`, e.g. "Show 24 Games") that calls `onShow` and closes.
  - README Filter pattern; V4Profile.
- **Menu** (§3.5).
  - Item classes from 02 §5.12: `flex items-center gap-2.5 min-h-11 px-3.5 text-sm text-cb-text outline-none cursor-pointer data-[highlighted]:bg-cb-fill data-[disabled]:text-cb-text-disabled data-[disabled]:cursor-not-allowed [&_svg]:size-4 focus-visible:-outline-offset-2`.
  - `tone="danger"` → `text-cb-bad`. `shortcut` → right-aligned `font-mono text-xs text-cb-text-soft`.
  - `MenuCheckboxItem`/`MenuRadioItem` use the same row, with a trailing 16px `Check` indicator when checked.
  - `MenuLabel`: `text-overline px-3.5 pt-2.5 pb-1`.
  - `MenuContent` forwards `onCloseAutoFocus`.
- **Dialog / AlertDialog** (§3.5, 02 §5.13):
  - Overlay: `fixed inset-0 z-(--cb-z-dialog) bg-cb-scrim-modal data-[state=open]:animate-rc-fade`.
  - Content: `fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-(--cb-z-dialog) flex flex-col max-h-[calc(100dvh-48px)] w-[min(var(--w),calc(100vw-32px))] bg-cb-surface border border-cb-border-strong shadow-modal data-[state=open]:animate-rc-pop motion-reduce:animate-rc-fade`, with `--w` = 440/560/640/1040.
  - **Always** `aria-modal="true"` (F M1: Radix sets only `role`). Without a `description`, pass `aria-describedby={undefined}`.
  - `align="top"` → `top-[12vh] translate-y-0` and `max-h-[calc(88dvh-24px)]`.
  - Header: `flex items-start justify-between gap-3 px-6 pt-5`. Title: serif `font-serif text-heading` or sans `font-semibold text-body`. Close: `IconButton variant="ghost" size="sm" label="Close"`.
  - `DialogBody` = `flex-1 min-h-0 overflow-y-auto p-6 flex flex-col gap-4`. `DialogFooter` = `flex flex-wrap items-center justify-end gap-2.5 px-6 py-3.5 border-t border-cb-border`.
  - AlertDialog focuses Cancel by default in Radix 1.2.1 (F §1); keep that and add no ref plumbing. `AlertDialogAction tone="danger"` uses `Button variant="danger"`.
  - Compose any internal `onOpenAutoFocus`/`onCloseAutoFocus` with the caller's (call the caller's first; respect `defaultPrevented`).
- **Sheet** (§3.5, 02 §5.14):
  - Overlay: `bg-cb-scrim`.
  - Content: `fixed inset-x-0 bottom-0 z-(--cb-z-dialog) flex flex-col max-h-[90dvh] bg-cb-surface border-t border-cb-border pb-[var(--safe-bottom)] data-[state=open]:animate-rc-sheet motion-reduce:animate-rc-fade`, with `aria-modal="true"`. `height="60"` → `h-[60dvh]`; `"90"` → `h-[90dvh]`.
  - The grabber `mx-auto mt-2 h-1 w-9 rounded-full bg-cb-border-strong` is **decorative** (`aria-hidden`); there is no swipe gesture in Phase 1. The sheet closes from the close button, a scrim tap or Esc.
  - Header `px-4 pt-1` with a `<p className="text-overline">` label. Close button top-right: `IconButton ghost sm label="Close"`.
  - Body: `flex-1 min-h-0 overflow-y-auto px-4 pt-2 pb-3 flex flex-col gap-2.5`.
- **ResponsiveDialog** (`responsive-dialog.tsx`): `{ open, onOpenChange, title, trigger?, children, size? }`. It renders a Sheet when `useMediaQuery(TABBAR_MQ)` is true at open time, and a Dialog otherwise.
- **Toasts** (F M3 and D16). sonner 2.0.7 applies `classNames.toast` to every `li`, including custom ones, so the box styles live **only** there.
  - `toast-config.ts` (pure):
    - `TOAST_TYPES = { success: { duration: 3000, icon: "Check", tone: "good" }, info: { 3000, "Info", "text" }, error: { 8000, "TriangleAlert", "bad" }, warning: { 8000, "WifiOff", "warn" }, achievement: { 6000, "Trophy", "accent" }, undo: { 6000, "Undo2", "text" } }`.
    - `toasterPlacement({ inShell, tabbar, tabletPortrait, narrow })` → `{ position, offset, mobileOffset, visibleToasts, width }`:
      - **outside the shell:** `{ position: "top-center", offset: undefined, mobileOffset: undefined, visibleToasts: 3, width: narrow ? 320 : 380 }` (today's position);
      - **shell, not tabbar:** `{ position: "top-right", offset: { top: "calc(16px + var(--safe-top))", right: "calc(24px + var(--safe-right))" }, mobileOffset: <same>, visibleToasts: 3, width: narrow ? 320 : 380 }`;
      - **shell, tabbar:** `{ position: "bottom-center", offset: { bottom: "var(--rc-overlay-bottom)", left: 16, right: 16 }, mobileOffset: <same>, visibleToasts: 1, width: tabletPortrait ? 440 : 380 }`.
      - `offset` and `mobileOffset` are always equal: sonner's mobile CSS is `max-width: 600px`, not `TABBAR_MQ`, so iPad portrait uses `offset`.
  - `toast.tsx`: `notify.success|info|error|warning|achievement|undo(text, opts?)`, where `opts = { action?: { label: string; onClick: () => void }, onUndo?, id? }`.
    - Each call is `toast[sonnerType](<ToastBody text={text} duration={d}/>, { icon, action, duration, id, testId: \`toast-${type}\` })`.
    - `sonnerType` is `success|info|error|warning` for those types and the plain `toast()` for `achievement` and `undo`.
    - Undo's action label is "Undo".
    - Copy is one sentence, object first, no trailing period (V3Toasts).
  - `ToastBody`: the text (`flex-1 min-w-0`) plus the timer bar `rc-toast-timer absolute left-0 bottom-0 h-0.5 w-full bg-cb-accent/50 origin-left`, animated `scaleX(1 → 0)` over the duration with `motion-reduce:hidden`. Dismissal always comes from sonner's JS timer, never from `animationend`.
  - `ThemeAwareToaster.tsx`:
    - `theme` from `resolvedTheme`.
    - Placement from `toasterPlacement({ inShell: useShellPresent(), tabbar: useMediaQuery(TABBAR_MQ), tabletPortrait: useMediaQuery(TABLET_PORTRAIT_MQ), narrow: useMediaQuery(NARROW_MQ) })`.
    - `style={{ "--width": \`${width}px\` } as React.CSSProperties}`.
    - `expand`, `gap={8}`.
    - Toast classes:
      ```
      toastOptions={{ unstyled: true, classNames: {
        toast: "group relative flex w-full items-center gap-2.5 min-h-12 py-1.5 pr-2 pl-3.5 bg-cb-surface border border-cb-border-strong shadow-toast font-sans text-sm leading-[1.4] text-cb-text",
        title: "flex-1 min-w-0", description: "text-ui text-cb-text-soft",
        actionButton: "min-h-9 pointer-coarse:min-h-11 tap-target px-2.5 border border-cb-border-strong text-ui font-medium",
        closeButton: "order-last <IconButton ghost sm classes>",
        success: "[&_[data-icon]]:text-cb-good", error: "[&_[data-icon]]:text-cb-bad",
        warning: "[&_[data-icon]]:text-cb-warn", info: "[&_[data-icon]]:text-cb-text" } }}
      ```
    - The toast root has **no** `overflow-hidden`, so the action's `tap-target` isn't clipped. `font-sans` beats sonner's unlayered `font-family`.
    - The 23 legacy `toast.success`/`toast.error` call sites pick up the v3 look with no code changes.
    - Remove the hard-coded hex styles (01 §7.5). Keep sonner's default z-index.
    - Keep sonner's Alt+T hotkey (focuses the toast region; listed in the shortcuts dialog).
    - Set `html[data-rc-doc-hidden]` on `visibilitychange`.
  - `toast.css` (P2, imported by `ThemeAwareToaster.tsx`; plain CSS, unlayered):
    ```css
    :where([data-sonner-toaster]:hover, [data-sonner-toaster]:focus-within, html[data-rc-doc-hidden]) .rc-toast-timer { animation-play-state: paused; }
    @media (max-width: 600px), (max-width: 900px) and (orientation: portrait) {
      [data-sonner-toast] [data-close-button] { display: none; }
      html:has([data-rc-controls]) [data-sonner-toast] [data-button] { display: none; }  /* in a game: text only */
    }
    ```
    Before relying on `data-close-button`/`data-button`, check the attribute names in `sonner/dist/index.mjs` and adjust if they differ.
  - Accessibility: `ToastBody` has **no** `role`. sonner's section is already `aria-live="polite"`, so an extra role would announce twice (C §3.9).
  - Under reduced motion sonner removes its own transitions, so there's no fade. Accepted.
- Don't migrate any existing hand-rolled modal (out of scope).

**Gallery section `overlays.tsx`.** Triggers are P0 Buttons. Testids:
- `ui-toast-shell-toggle`: pressed by default. While pressed, it calls `markShellMounted()` so the gallery previews shell placement. `?placement=page` starts it unpressed.
- `ui-toast-controls-toggle`: renders `<div data-rc-controls hidden/>` while pressed, to preview in-game toasts.
- `ui-tooltip-trigger`: an IconButton whose tooltip says "Flip Board".
- `ui-popover-trigger`: a "Display" button; the content holds two P1 `CheckboxRow`s and a "Clear" text button.
- `ui-info-button`: content "Mistakes from your games, ready to replay."
- `ui-filter-popover`: count 2; chips as P0 `Button variant="secondary" size="sm" iconEnd={<X/>}` "Blitz" and "Lost"; Clear All resets the count to 0; "Show 24 Games".
- `ui-menu-trigger`: a ⋯ IconButton with the items Offer Draw, Flip Board, a `MenuCheckboxItem` "Sound" (`ui-menu-sound`), a separator, "Resign…" (danger), and a disabled "Abort".
- `ui-dialog-trigger`: title "Rename Position", a `DialogBody` with an input, footer Cancel/Save.
- `ui-dialog-xl-trigger`
- `ui-alert-dialog-trigger`: title "Resign This Game?", Cancel "Keep Playing", Action "Resign" (danger).
- `ui-sheet-trigger`: title "Moves", height 60, 40 rows.
- `ui-responsive-dialog-trigger`
- Toast triggers: `ui-toast-success`, `ui-toast-info`, `ui-toast-error` (action "Retry"), `ui-toast-warning`, `ui-toast-achievement`, `ui-toast-undo`, and `ui-toast-legacy`, which calls sonner `toast.success("Legacy toast styled")` directly.

Content testids: `ui-tooltip`, `ui-popover`, `ui-info-popover`, `ui-filter-content`, `ui-menu`, `ui-dialog`, `ui-alert-dialog`, `ui-sheet`.

### 7.3 Acceptance criteria

- Overlays portal to `body`. Opening one never changes `document.scrollingElement.scrollTop` or shifts layout.
- Esc and outside click close them, and focus returns to the trigger.
- Copy is Title Case. Both themes work.
- Outside the shell (`?placement=page`), toasts sit top-centre exactly as today, with the new look.

### 7.4 Tests

- Unit `toast-config.test.ts`:
  - durations and tones per type;
  - `toasterPlacement({ inShell: false, … }).position === "top-center"`;
  - in the shell on desktop: `top-right`, 3 visible, offset strings as specified;
  - in the shell in tabbar mode: `bottom-center`, `visibleToasts === 1`, `offset` deep-equals `mobileOffset`;
  - `tabletPortrait` → width 440; `narrow` desktop → 320.
- E2E `e2e/devices/ui/overlays.spec.ts` (UI projects plus the 2 motion projects; keyboard steps on Chromium only; on motion projects, measure after `animationend`):
  - Dialog:
    - open → `role="dialog"` with `aria-modal="true"` and the accessible name "Rename Position";
    - focus is inside, and Tab cycles within;
    - Esc closes, and focus returns to `ui-dialog-trigger`;
    - on `ui-desktop` the content width is 560 ± 1;
    - no console warning mentioning `Description`.
  - AlertDialog: initial focus is on "Keep Playing"; `role="alertdialog"`.
  - Sheet on `ui-iphone`: the box bottom equals the viewport height (±1); the height is about 60% of the viewport; the grabber is present; Esc closes.
  - Menu: ArrowDown moves the highlight; the disabled item is skipped; Enter selects; "Sound" toggles `aria-checked`; Esc closes and focus returns.
  - Tooltip: focusing the trigger shows `ui-tooltip` with "Flip Board".
  - Popover, InfoButton and FilterPopover:
    - each opens on click (tap on phones), has an aria-label and closes on Esc;
    - the Filter badge reads "2", and Clear All makes it disappear;
    - "Show 24 Games" closes the popover.
  - Toasts, `ui-desktop`, shell placement:
    - four rapid `ui-toast-info` clicks leave ≤ 3 `[data-sonner-toast][data-visible="true"]`;
    - the newest box has `right ≈ vw − 24` (±2), `top ≈ 16` (±4) and width 380 ± 1;
    - with `?placement=page`, the box centre x ≈ vw/2 (±2) and top ≈ sonner's default.
  - Toasts, `ui-iphone`/`ui-android`:
    - one visible, horizontally centred, `bottom ≤ vh − 16`;
    - no visible close button;
    - the `ui-toast-error` "Retry" action is visible with an effective height ≥ 44;
    - with `ui-toast-controls-toggle` pressed, the action is hidden.
  - Toasts, `ui-ipad` at `setViewportSize(834, 1194)`: bottom-centre, width 440 ± 1.
  - `ui-toast-legacy` renders with `border-radius: 0px`, the `cb-surface` background and a Geist `font-family`.
  - In dark mode, the toast background equals `--cb-surface` in dark.
  - `expectTapTargets(page, { root: '[data-testid="gallery-overlays"]', all44: true })`.
  - axe: `a11y overlays light|dark`.

---

## 8. P3 App shell

**Goal:** the real `AppShellView`:
- sidebar/rail, top bar with Back, tab bar, SubNav;
- the account menu and sheet;
- palette, shortcuts dialog, chords;
- banners, online chip, hairline.

Also the destination config, the `/dev/ui/shell` demo and the gallery section.

### 8.1 Files

- Own (placeholders): `components/shell/AppShellView.tsx`, `app/dev/ui/_sections/shell.tsx`.
- Create:
  - `components/shell/Sidebar.tsx`, `TopBar.tsx`, `TabBar.tsx`, `SubNav.tsx`, `AccountMenu.tsx`, `useAccountActions.ts`, `useDeferredAction.ts`, `CommandPalette.tsx`, `ShortcutsDialog.tsx`, `useShellKeys.ts`, `ShellBanners.tsx`, `OnlineChip.tsx`, `RouteHairline.tsx`, `Brand.tsx`
  - `lib/nav/destinations.ts`, `lib/nav/destinations.test.ts`
  - `lib/shell/keys.ts`, `keys.test.ts`, `palette.ts`, `palette.test.ts`, `hairline.ts`, `hairline.test.ts`, `prefs.ts`, `prefs.test.ts`, `nav-history.ts`, `pwa.ts`, `copy.test.ts`
  - `lib/analytics/shell-events.ts`
  - `app/dev/ui/shell/page.tsx`, `app/dev/ui/shell/demo-users.ts`, `app/dev/ui/shell/DemoContent.tsx`
  - `e2e/devices/ui/shell.spec.ts`
- Edit:
  - `instrumentation-client.ts`: replace the `onRouterTransitionStart` export with a function that calls `Sentry.captureRouterTransitionStart(url, navigationType)` and then dispatches `rc:navigation-start` (§3.10).
  - `app/components/IOSInstallModal.tsx`: add `role="dialog" aria-modal="true" aria-label="Install ReplayChess" data-rc-modal` to the modal root. Nothing else changes.

### 8.2 Implementation notes

**`lib/nav/destinations.ts`** (single source of truth; 03 §6.2):
```ts
export type Destination = {
  key: DestinationKey; label: string;            // Title Case
  href: (me: { referenceId: string }) => string;
  icon: LucideIcon; parent?: DestinationKey; chord?: string;  // "g p"
  match: (pathname: string, me: { referenceId: string }) => boolean;
  enabled: boolean;                               // Phase 1: static
  showInTabBar: boolean;
};
export const DESTINATIONS: Destination[];
export function enabledDestinations(): Destination[];
export function currentDestinations(pathname: string, me): Set<DestinationKey>;      // parent + child both current
export function subnavFor(current: Set<DestinationKey>): { group: "play" | "learn"; label: string; items: Destination[] } | null;
export function backTarget(pathname: string, me): { key: DestinationKey; href: string; label: string } | null;
export type ShellMode = "sidebar" | "rail" | "tabbar";
export function visibleKeys(mode: ShellMode, current: Set<DestinationKey>, isDetail: boolean): Set<DestinationKey>; // for the reachability test
```

| key | label | href | icon | parent | chord | match | enabled | tab bar |
|---|---|---|---|---|---|---|---|---|
| home | Home | `/home` | House | — | g h | `/home` | **false** | — |
| play | Play | `/play` | Play | — | g p | `/play`, `/queue`, `/challenge/*`, `/join/*`, `/position/*`, and every tournaments match | true | yes |
| tournaments | Tournaments | `/tournaments` | — | play | — | `/tournaments`, `/tournament/*`, `/join-tournament/*` | true | — |
| train | Train | `/train` | Crosshair | — | g m | — | **false** | — |
| learn | Learn | `/legends` | BookOpen | — | — | `/legends*`, `/openings*` | true | yes |
| legends | Legends | `/legends` | — | learn | g l | `/legends`, `/legends/*` | true | — |
| openings | Openings | `/openings` | — | learn | — | `/openings`, `/openings/*` | true | — |
| review | Review | `/review` | RotateCcw | — | g r | — | **false** | — |
| profile | Profile | `/profile/{ref}` | UserRound | — | — | `/profile/{own ref}` only | true | yes |
| settings | Settings | `/settings` | Settings | — | — | — | **false** | — |

- Subs: Play › Tournaments always shows in the sidebar. Learn subs show in the sidebar only while Learn is current.
- Match on path segments exactly: `/play` must not match `/playlist`, and `/join/x` must not match `/join-tournament/x`.
- `subnavFor`:
  - Play current → `{ group: "play", label: "Play sections", items: [Play, Tournaments] }`. The Play item is current only when Tournaments isn't.
  - Learn current → `{ group: "learn", label: "Learn sections", items: [Legends, Openings] }`.
- `backTarget` (detail routes; C H5):
  - `/tournament/*`, `/join-tournament/*` → Tournaments `/tournaments`
  - `/legends/<x>` → Legends `/legends`
  - `/openings/<x>` → Openings `/openings`
  - `/queue`, `/challenge/new`, `/join/*`, `/position/*` → Play `/play`
  - `/profile/<other ref>` → Play `/play`
  - everything else → null

**`AppShellView`** (client; 03 §3–§5, V3Nav values):
```tsx
<ViewportStage data-testid="app-shell"
  nav={<Sidebar …/>} topbar={<TopBar back={back} …/>} tabbar={hideTabBar ? undefined : <TabBar …/>}
  banner={<><SubNav nav={subnav} hideInTabbar={!!back}/><ShellBanners user={user} demo={demo}/><OnlineChip placement="inline"/>{banner}</>}>
  {children}
</ViewportStage>
<CommandPalette …/> <ShortcutsDialog …/> <OnlineChip placement="floating"/> {!demo && <RouteHairline/>}
```
- `usePathname()` gives the current destinations unless `currentKey` is set. `back` = `backTo` (demo) or `backTarget(pathname, me)`.
- One `useShellKeys()` per shell. `useEffect(() => markShellMounted(), [])`.
- In `demo`, hrefs built from `me.referenceId` (Profile, Me link, Membership) become `#profile` / `#membership`, so the demo has no 404 links.

**Sidebar** (`<nav aria-label="Main navigation" data-testid="shell-sidebar">`). Tailwind classes; `rail:` gives the 64px form. `variant?: "auto" | "sidebar" | "rail"` (default auto) sets `data-shell-form` on the root, which forces the form through the multi-slot `rail:` variant (§3.3), and `previewLabel?: string` replaces the `aria-label` in gallery previews.
- Root: `flex h-full flex-col gap-4 border-r border-cb-border bg-cb-bg px-3 py-4 rail:px-2.5 rail:py-3`.
- Top row: `flex items-center justify-between gap-2 rail:flex-col rail:justify-center`.
  - Brand link (`shell-brand`, href `/play`): `flex min-h-11 items-center gap-2.5`, with `next/image` `/chess-logo-bnw.png` at 32×32 (alt "ReplayChess home") and the wordmark `font-serif text-wordmark rail:hidden`.
  - Search: `IconButton variant="outline" label="Search (press /)"` (`shell-search-button`), `text-cb-text-soft vh640:hidden pointer-coarse:hidden`. It opens the palette.
- Links: `flex flex-col gap-0.5`.
  - Item `Link` (`nav-item-<key>`): `flex min-h-11 items-center gap-3 px-3 text-sm text-cb-text-soft hover:bg-cb-fill hover:text-cb-text aria-[current=page]:bg-cb-accent aria-[current=page]:font-medium aria-[current=page]:text-cb-accent-fg forced-colors:aria-[current=page]:outline forced-colors:aria-[current=page]:outline-2 focus-visible:-outline-offset-2 [-webkit-tap-highlight-color:transparent] active:bg-cb-fill rail:justify-center rail:px-0 rail:pointer-coarse:min-h-12`.
  - Icon: `size={18} strokeWidth={1.75}` (20 on the coarse rail).
  - Label: `<span className="rail:sr-only">`. Use `sr-only`, not `hidden`: the label is the accessible name. Don't add a redundant `aria-label`.
  - In rail mode, each item is wrapped in `<Tooltip content={label} side="right">`.
- Subs: `flex flex-col pt-0.5 pb-1 pl-[42px] rail:hidden vh640:hidden`. Sub link: `flex min-h-9 tap-target items-center text-ui text-cb-text-soft hover:text-cb-text aria-[current=page]:font-medium aria-[current=page]:text-cb-text pointer-coarse:min-h-11 focus-visible:-outline-offset-2`, with no fill.
- Footer: `mt-auto flex items-center gap-1.5 border-t border-cb-border pt-3 rail:flex-col`.
  - Me link (`shell-me-link`; own profile; `aria-current` on the own profile, with no fill): `flex min-h-12 min-w-0 flex-1 items-center gap-2.5 px-1.5 hover:bg-cb-fill rail:flex-none rail:justify-center rail:p-0`.
    - `Avatar size={32} variant="gradient"`, with src = `avatarUrl`.
    - Text block `min-w-0 rail:hidden`:
      - the name, `truncate text-ui`;
      - the rating (`shell-rating`), `font-mono text-[0.6875rem] tracking-[0.08em] uppercase text-cb-text-soft`, hidden when `ratingLabel` is null;
      - the trial tag (`shell-trial-tag`), `Tag tone="warn" variant="tint"`, with text from `trialLabel(daysLeft)`: "Trial · 5 days left" or "Trial · 1 day left". The value is rounded up and never 0, so there is no "ends today" copy (C §6).
  - Gear: `IconButton variant="outline" label="Account Menu" icon={<Settings/>}` (`shell-account-button`) → `AccountMenu` as a `Menu` with `side="right" align="end"` (`account-menu`).

**TopBar** (`<header data-testid="shell-topbar">`; the ViewportStage CSS shows it in tabbar mode only):
- Root: `flex h-full items-center gap-2 px-4 tablet-portrait:gap-2.5 tablet-portrait:px-6 tablet-portrait:border-b tablet-portrait:border-cb-border bg-cb-bg`.
- **Default:** the brand (logo 28px, 30px in tablet portrait) plus the wordmark `font-serif text-wordmark flex-1`.
- **Back mode** (`back` set; replaces the brand):
  - `<a href={back.href} data-testid="shell-back" aria-label={\`Back to ${back.label}\`}>` with classes `-ml-2 inline-flex min-h-11 flex-1 items-center gap-1 px-2 text-ui font-medium focus-visible:-outline-offset-2` and contents `ChevronLeft` 20px + `back.label`.
  - `onClick`: when `inAppNavCount() > 0` (`lib/shell/nav-history.ts`), call `preventDefault()` and `router.back()`; otherwise let the link navigate.
- Avatar button (`shell-account-avatar`, `aria-label="Account Menu"`, `tap-target`, 32px `Avatar variant="neutral"`) → `AccountMenu` as a `Sheet` (`account-sheet`, title "Account", height auto).

**TabBar** (`<nav aria-label="Main navigation" data-testid="shell-tabbar">`):
- Root: `grid h-full border-t border-cb-border bg-cb-bg`, with `style={{ gridTemplateColumns: \`repeat(${n}, minmax(0, 1fr))\` }}`, where n = destinations with `showInTabBar && enabled` (3 in Phase 1).
- Item (`tab-item-<key>`): `flex flex-col items-center justify-center gap-0.5 text-[0.6875rem] text-cb-text-soft aria-[current=page]:font-semibold aria-[current=page]:text-cb-text focus-visible:-outline-offset-2 [-webkit-tap-highlight-color:transparent] active:bg-cb-fill`. Icon 20px, stroke 1.75. No fill.

**SubNav** (`<nav aria-label={subnav.label} data-testid="subnav">`; C B2):
- Root: `hidden rail:flex min-h-11 items-stretch gap-6 border-b border-cb-border px-4 tablet-portrait:px-6 narrow:px-6 tabbar:px-4`. Add `tabbar:hidden` when `hideInTabbar` is set.
- Item `Link` (`subnav-item-<key>`): `relative inline-flex min-h-11 items-center text-ui text-cb-text-soft hover:text-cb-text aria-[current=page]:font-medium aria-[current=page]:text-cb-text after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 aria-[current=page]:after:bg-cb-accent focus-visible:-outline-offset-2 [-webkit-tap-highlight-color:transparent]`. This is the underline look of 02 §5.5, but real links, not `role="tab"`.
- It renders nothing when `subnavFor()` is null.

**Account actions** (`useAccountActions(user, { demo })`). One ordered list drives both the Menu and the Sheet. Labels are Title Case; icons are lucide.

| id (testid `account-item-<id>`) | Label | Shown when | Does |
|---|---|---|---|
| (header, non-interactive) | name + rating line | always | — |
| membership | Membership | always | `/profile/{ref}#membership` (`#membership` in demo) |
| billing | Manage Billing | `hasBillingPortal` | `window.open("/api/customer-portal", "_blank", "noopener")`; on the next `visibilitychange` to visible, `router.refresh()` once, so the entitlement isn't stale |
| account | Account | always; disabled in demo and until `useClerk().loaded` | Clerk `useClerk().openUserProfile()`, **after the menu/sheet has closed** (deferred) |
| theme | "Switch to Dark Theme" / "Switch to Light Theme" | always | next-themes `setTheme` |
| install | Install App | `usePWAInstall()` gives `canInstall && !isInstalled` | `install()`, or on iOS the existing `IOSInstallModal`, deferred |
| admin | Admin | `isAdmin` | `/admin` |
| (separator) | | | |
| help | Help | always | `/help` |
| privacy | Privacy | always | `/privacy` |
| terms | Terms | always | `/terms` |
| (separator) | | | |
| signout | Sign Out | always (disabled in demo) | `await purgeRuntimeCaches()` (`lib/shell/pwa.ts`: delete every `caches` key that doesn't start with `workbox-precache`, inside try/catch), then `signOut({ redirectUrl: "/" })`. The existing `UserSync` and `PostHogIdentify` cleanup runs on sign-out; add no second reset. |

Each action calls `trackShell({ name: "shell_account_action", … })`.

**Deferred actions** (`useDeferredAction()`; C H9). It returns `{ defer(fn), onCloseAutoFocus(e) }`:
- Menu items call `defer(fn)` in `onSelect`; Radix closes the menu.
- `MenuContent`/`SheetContent`/`DialogContent` get `onCloseAutoFocus={onCloseAutoFocus}`. When an action is pending, it calls `e.preventDefault()` and runs it.

Use this for Account, Install, and the palette's "Keyboard Shortcuts" row. A modal opened that way is then clickable and keeps focus. `body` must not be left with `pointer-events: none`.

**CommandPalette** (03 §8): cmdk inside `DialogContent size="lg" align="top" hideTitle title="Command Palette" hideClose`, `data-testid="command-palette"`.
- **Rendered on every device** (C H11). It is opened by:
  - ⌘K/Ctrl+K, as a toggle, everywhere;
  - `/` outside editable targets on fine pointers, with `preventDefault`;
  - the search button (hidden on coarse pointers).
- Input row `flex items-center gap-2.5 px-4 border-b border-cb-border`:
  - an 18px `Search` icon in `text-cb-text-soft`;
  - `Command.Input` (`command-palette-input`): `h-14 flex-1 border-0 bg-transparent p-0 text-base focus:outline-none`, placeholder "Search pages, legends, actions…";
  - a trailing `<Kbd>Esc</Kbd>`.
- `Command` with `shouldFilter={false}` and `loop={false}`. Filtering lives in `lib/shell/palette.ts`: `filterRows(rows, query)` does a case-insensitive substring match on `title + " " + hint` and keeps group order.
- Group heading: `text-overline px-4 pt-2.5 pb-1`.
- Item (`palette-item-<id>`): `flex items-center gap-3 min-h-12 px-4 py-1 text-body data-[selected=true]:bg-cb-fill forced-colors:data-[selected=true]:outline forced-colors:data-[selected=true]:outline-2 focus-visible:-outline-offset-2`. Icon 16px soft; right-hand hint `font-mono text-xs text-cb-text-soft`.
- Empty (`palette-empty`): "No pages or actions match." (`px-4 py-5 text-cb-text-soft`).
- Hint footer: `flex gap-4 px-4 py-2 border-t border-cb-border text-xs text-cb-text-soft vh640:hidden`, text "↑ ↓ move · ↵ open · Esc close".
- **Rows** (Phase 1; these are the only ones):
  - Go To: Play (G then P), Tournaments, Legends (G then L), Openings, Profile, Membership (`/profile/{ref}#membership`).
  - Actions: Find an Opponent · 5+3 (`/queue?time=300&increment=3`), Challenge a Friend (`/challenge/new`), Keyboard Shortcuts (?), Switch to Dark/Light Theme, Admin (admins only), Sign Out (not in demo).
  - Legends: live results from `GET /api/legends/search?name=<q>` for `q.length ≥ 2`.
    - Debounce 150ms, with a stale-request guard.
    - The response is `{ success, data: { query, count, legends } }`: read `json.data.legends` and **keep only `isVisible`**, since the API already filters `isActive` and a hidden legend's link 404s.
    - At most 5 rows. Title = legend name, hint "Legend", target `/legends/{referenceId}`.
    - While fetching, show `palette-legends-loading` "Searching legends…".
    - When `navigator.onLine` is false or the fetch fails, show `palette-legends-offline` "Search needs a connection" in place of the group.
- **No** Home, My Games, Mistake Bank, Review or Ask-the-Coach rows, and no Tab/Ask mode.
- Selecting a row closes the palette, then navigates (`router.push`) or runs the action (deferred if it opens a dialog), and fires `shell_palette_command`.
- After a palette navigation, once the pathname changes, call `document.getElementById("main")?.focus({ preventScroll: true })`. Radix's focus restore to the stale trigger is prevented with `onCloseAutoFocus` → `e.preventDefault()`.

**ShortcutsDialog** (`shortcuts-dialog`, title "Keyboard Shortcuts", `titleVariant="serif"`, description "Press ? any time"):
- It is rendered from a registry in `lib/shell/keys.ts`: `SHORTCUT_SECTIONS: { title: string; scope: "global" | "board" | "review"; rows: { id: string; label: string; keys: string[][] }[] }[]`.
- Phase 1 registers only **Everywhere** (`scope: "global"`). Row labels are sentence case (§3.11):
  - "Command palette and search": ⌘K / `/`
  - "This list": `?`
  - "Go to Play": G P
  - "Go to Legends": G L
  - "Jump to notifications": Alt T (sonner's hotkey)
  - "Close a menu or sheet": Esc
- Size `sm` for 1 section, `lg` for 2, `xl` for 3 or more (a 4-column grid, `narrow:grid-cols-2`).
- Rows: `flex justify-between gap-3 min-h-11 vh700:min-h-[34px] border-b border-cb-border-subtle` (non-interactive). Keys use `<Kbd>`.
- Footer:
  - `SwitchRow` (`shortcuts-single-key-switch`) with the label "Single-Key Shortcuts" and the description "/, ? and G shortcuts. ⌘K always works."
  - Under it: "Single-letter keys are off while you type in a field."
  - The switch reads and writes `lib/shell/prefs.ts`: `localStorage["rc-single-key-shortcuts"]` (`"0"`/`"1"`, default on), inside try/catch, via `useSyncExternalStore` with server snapshot `true`. Toggling fires `shell_shortcuts_toggled`. Phase 9 moves the switch to Settings › Board.

**Keys** (`lib/shell/keys.ts`, pure, plus `useShellKeys`; D20, C §3.6, F M14):
- `isEditableTarget(el)`: input, textarea, select, contenteditable, or inside `[role=combobox]`.
- `isApplePlatform(nav)`.
- `MODAL_OPEN_SELECTOR = '[aria-modal="true"], [role="dialog"]:not([data-state="closed"]), [role="alertdialog"]:not([data-state="closed"]), .cl-modalBackdrop, [data-rc-modal]'`.
- `classifyKeydown(e, ctx: { coarse: boolean; singleKeyEnabled: boolean; modalOpen: boolean; shellDialogOpen: boolean; editable: boolean }) → "palette" | "slash" | "help" | "chord-key" | "ignore"`:
  - ignore when `e.defaultPrevented`, `e.repeat`, `e.isComposing` or `e.key === "Process"`;
  - **⌘K/Ctrl+K** (`e.code === "KeyK"` or `e.key` k/K, with `metaKey` or `ctrlKey`) → `"palette"` regardless of `editable`, `coarse` or `shellDialogOpen`; ignored when a **non-shell** modal is open (`modalOpen && !shellDialogOpen`);
  - single keys require `!coarse && singleKeyEnabled && !editable && !modalOpen` and no Ctrl/Meta/Alt. Alt and Ctrl count as not held when `e.getModifierState("AltGraph")` is true. `/` (by `e.key`) → `"slash"`; `?` → `"help"`; other keys → `"chord-key"`.
- `createChordMachine({ timeoutMs: 1000, chords: { KeyP: "/play", KeyL: "/legends" } })` → `{ press(code, key, now) → { navigate?: string } }`. `g` (`KeyG`, or `e.key` "g" as a fallback) arms the machine; the next key resolves by `e.code`, falling back to `e.key`, or disarms; the timeout disarms.
- `findCollisions(sections)` returns duplicate bindings within one scope (and `global` against every scope). Phase 2's F, D, M, N, B, A, E, H, R, S and V must register here.
- `useShellKeys` attaches **one** `keydown` listener on `window`.
  - "palette" toggles the palette. If the ShortcutsDialog is open, it closes it first and then opens the palette, so modals never stack.
  - `modalOpen` = `document.querySelector(MODAL_OPEN_SELECTOR)` excluding the shell's own palette and shortcuts dialogs; `coarse` = `matchMedia(COARSE_MQ)`.
  - No single-letter shortcuts other than the `g` chords (F, D and M are Phase 2, page-scoped).

**ShellBanners** (`shell-payment-banner`): when `user.paymentFailed`, render `<Banner tone="warn" live="polite" action={<Button size="sm" variant="secondary">Update Payment</Button>} onDismiss>`.
- Copy: "Your last payment failed. You keep access until {paymentFailedUntilLabel}." The label is preformatted on the server (§9.3), so there is no client date formatting.
- "Update Payment" opens `/api/customer-portal` in a new tab (it does nothing in demo mode), then refreshes on return, as in the billing row.
- Dismissal: `sessionStorage["rc-payment-banner-dismissed"]`, read through `useSyncExternalStore` (server snapshot "not dismissed") inside try/catch.

**OnlineChip** (`role="status"`): `useSyncExternalStore` on the `online`/`offline` events, server snapshot `true`.
- `placement="floating"` (`shell-online-chip`):
  - classes `flex tabbar:hidden fixed top-[calc(var(--safe-top)+12px)] z-(--cb-z-popover) left-[calc(var(--rc-nav-w,0px)+(100vw-var(--rc-nav-w,0px))/2)] -translate-x-1/2` (visible in sidebar and rail modes, hidden in tab-bar mode);
  - Offline: `Tag tone="warn" variant="tint"` with `WifiOff`, "Offline · new pages need a connection" (V3Offline's "Offline · cached pages still work" returns with the Phase 11 offline shell; until then the service worker caches static assets only, so no page is cached).
- `placement="inline"` (`shell-online-chip-inline`): `hidden tabbar:flex justify-center py-1.5`, rendered in the banner slot, with the text "Offline" (V3iPhoneOffline).
- On reconnect both show `Tag tone="good" variant="tint"` "Back online" for 3s. They render nothing while online.
- PWA `reloadOnOnline` is off (P0), so the chip is visible in production builds.

**RouteHairline** (`route-hairline`):
- On `rc:navigation-start` it shows after a **200ms** delay, and only when `shouldStartHairline(currentUrl, nextUrl)` (`lib/shell/hairline.ts`) is true: same origin, and a different pathname or search. Hash-only changes don't count.
- It hides on a pathname/searchParams change (`usePathname`, `useSearchParams` inside a `<Suspense>`) and after a 10s safety timeout.
- Classes: `fixed right-0 left-[var(--rc-nav-w,0px)] top-[var(--safe-top)] tabbar:top-[calc(var(--safe-top)+var(--rc-top-bar))] h-0.5 bg-cb-accent z-50 animate-rc-hair motion-reduce:animate-none motion-reduce:w-[70%]`.

**Navigation history** (`lib/shell/nav-history.ts`): a module-level counter. It increments on `rc:navigation-start` with `push`, decrements (not below 0) on `traverse`, and resets on a full page load. `inAppNavCount()` exposes it.

**Analytics** (`lib/analytics/shell-events.ts`): `trackShell(event)` per §3.10. `surface` comes from `matchMedia(TABBAR_MQ)` / `matchMedia(RAIL_MQ)` at click time, or `"subnav"`/`"back"` from the component that fired it.

**`/dev/ui/shell`** (`app/dev/ui/shell/page.tsx`; a server page that reads `searchParams`):
- `demo-users.ts` exports `DEMO_USERS: Record<"member"|"trial"|"admin"|"norating"|"payment", ShellUser>`:
  - member: "Knight Owl", `ratingLabel: "Blitz 1184"`, referenceId `demo-knightowl`, gradient avatar
  - trial: `trialDaysLeft: 5`
  - admin: `isAdmin: true`
  - norating: `ratingLabel: null`
  - payment: `paymentFailed: true`, `paymentFailedUntil: "2026-11-12T00:00:00.000Z"`, `paymentFailedUntilLabel: "Nov 12"`
- It renders `<AppShellView user={…} demo currentKey={current} backTo={back}>` with `<DemoContent content=…/>`.
- **DemoContent** sets `data-rc-lock` on its root and must fit one viewport at every matrix project (P5 checks this):
  - `page`: a P1 `PageHeader` (overline "Demo", title "Shell Demo"). Under it, a native `<input aria-label="Demo search" data-testid="shell-demo-input">` with the classes `h-11 w-full max-w-sm px-3 border border-cb-border-input bg-cb-surface text-body pointer-coarse:text-base`. Then a 3-card grid that collapses to 1 column under `tabbar:` and hides at `vh620:hidden`.
  - `list`: the header plus a `flex-1 min-h-0 overflow-y-auto` region (`data-rc-scroll`, `tabIndex={0}`, `role="region"`, `aria-label="Demo list"`) with 60 rows of 56px.
  - `empty`: `EmptyState` "No Tournaments Right Now", centred.

**Gallery section `shell.tsx`**. Specimens:
- `ui-shell-sidebar`: Sidebar `variant="sidebar" previewLabel="Sidebar Preview"` in a 220×640 frame;
- `ui-shell-rail`: `variant="rail" previewLabel="Rail Preview"`, 64×640;
- `ui-shell-topbar`: 393×44, plus the back-mode variant;
- `ui-shell-tabbar`: 393×56, `previewLabel="Tab Bar Preview"`;
- `ui-shell-subnav`: shown in a `data-shell-form="rail"` box;
- `ui-shell-account-menu`: a static open menu list;
- links "Open Shell Demo" → `/dev/ui/shell` and "Open Trial Demo" → `/dev/ui/shell?user=trial`.

Previews use demo users, use `#` hrefs, and **must not** render `ViewportStage` (that would lock gallery scroll). Their landmark labels are unique (axe `landmark-unique`).

### 8.3 Acceptance criteria

- No link in the shell points at a missing route (static test plus e2e). Hidden destinations appear nowhere: sidebar, tab bar, SubNav, palette, chords, shortcuts.
- Every enabled destination is reachable in ≤ 2 activations from any other in every mode, including the coarse rail (`visibleKeys` unit test plus e2e).
- Exactly one **Main navigation** landmark is visible in each mode. The rail keeps accessible names, and tooltips work on keyboard focus.
- Copy follows §3.11, checked by `lib/shell/copy.test.ts`.
- The palette and single-key shortcuts don't fire:
  - while typing in inputs, including inputs on legacy pages such as the `/play` legend search (⌘K does fire there);
  - while a legacy modal, the Clerk modal or the iOS install modal is open;
  - on coarse pointers (except ⌘K);
  - while the switch is off.
- The payment banner, trial tag and rating behave per the demo users. There are no hydration warnings in a non-UTC time zone.
- `/dev/ui/shell` passes P5's one-viewport assertions on all 40 projects for every `content`, `current` and `back` value in P5's ROUTES.

### 8.4 Tests

- Unit:
  - `destinations.test.ts`:
    - the enabled set is exactly `{play, tournaments, learn, legends, openings, profile}`;
    - matching: `/tournament/abc` → play + tournaments; `/join-tournament/x` → tournaments, **not** join; `/profile/other` → none; `/playlist` → none;
    - `subnavFor` for play and learn;
    - `backTarget` for every detail pattern, and null for `/play`, `/legends` and the own profile;
    - **reachability:** for each mode (`sidebar`, `rail`, `tabbar`) and each starting destination, a BFS over `visibleKeys` reaches every enabled key in ≤ 2 steps.
  - **Route-existence test:** for each enabled destination's href (`me.referenceId = "ref"`) and the Help, Privacy and Terms links, some `app/**/page.tsx` path matches once `(group)` segments are stripped and `[param]` becomes `[^/]+`. It passes whether or not P4 has moved the folders.
  - `keys.test.ts`:
    - `g` then `p` within 1000ms navigates to `/play`; at 1001ms nothing happens; `g` then `x` disarms;
    - code-based matching: `{ code: "KeyP", key: "п" }` resolves;
    - `classifyKeydown`: `repeat`, `isComposing` and `"Process"` → ignore; ⌘K in an editable → palette; `/` in an editable → ignore; `/` on coarse → ignore; `/` with the switch off → ignore; `/` with AltGraph+Ctrl+Alt → slash; ⌘K with a non-shell modal open → ignore; ⌘K with the shortcuts dialog open → palette;
    - `isApplePlatform`;
    - `findCollisions` flags a duplicate key in one scope, and passes on the Phase 1 registry.
  - `palette.test.ts`: "tour" → Tournaments only; "" → curated order; the admin row appears only for admins; legend rows filter `isVisible` and cap at 5.
  - `hairline.test.ts`: the same path with a different hash → false; a different search → true.
  - `prefs.test.ts`: `parseSingleKeyPref(null) === true`, `("0") === false`, `("garbage") === true`.
  - `copy.test.ts`: reads the source files as **text** (it doesn't import Clerk or Prisma modules) and applies §3.11 to destination, SubNav, Back, palette, account and switch labels, shortcut section titles and dialog titles. Shortcut row labels must be sentence case. No `\p{Extended_Pictographic}` anywhere in `components/shell/**`, `lib/nav/**` or `lib/shell/**`.
- E2E `e2e/devices/ui/shell.spec.ts` (UI projects; signed out; the demo route; keyboard steps on Chromium only):
  - `ui-desktop`, `/dev/ui/shell`:
    - `shell-sidebar` width is 220 ± 1;
    - the visible nav item testids are exactly play, tournaments, learn, profile (legends and openings only with `current=legends`);
    - "Home", "Train", "Review" and "Settings" don't appear as links;
    - `subnav` isn't visible.
  - `?current=tournaments`: `nav-item-play` and `nav-item-tournaments` both have `aria-current="page"`.
  - `?user=trial`: `shell-trial-tag` reads "Trial · 5 days left".
  - `?user=norating`: no `shell-rating`.
  - `?user=payment`:
    - `shell-payment-banner` is visible and reads "Nov 12";
    - after dismiss and reload it stays hidden;
    - with `test.use({ timezoneId: "America/Los_Angeles" })`, no console message contains "Hydration".
  - `?user=admin`: `account-item-admin` is present; for member it's absent.
  - Gear → `account-menu` with the items membership, account, theme, help, privacy, terms and signout. Account and signout are `aria-disabled` in demo. Esc returns focus to the gear. The theme item toggles `html.dark`.
  - `ControlOrMeta+K` opens `command-palette`. Typing "tour" leaves `palette-item-tournaments` as the only Go To row, and Enter → `waitForURL(/\/tournaments|\/sign-in/)`.
  - `/` with focus on body opens the palette.
  - In `shell-demo-input`:
    - `/` doesn't open the palette, and the input's value becomes "/";
    - `g` then `p` doesn't navigate;
    - `ControlOrMeta+K` **does** open the palette.
  - `?` opens `shortcuts-dialog`. `ControlOrMeta+K` then leaves exactly one open dialog: the palette.
  - Switch `shortcuts-single-key-switch` off, then: `/` and `g p` do nothing, and ⌘K still works. After a reload it's still off. Turn it back on at the end.
  - `g` then `p` → `waitForURL(/\/play|\/sign-in/)`.
  - The first Tab from a fresh load focuses `skip-link`, and Enter moves focus to `#main`.
  - `page.setViewportSize({ width: 1000, height: 700 })`:
    - the sidebar width is 64 ± 1, and the wordmark is hidden;
    - focusing `nav-item-play` shows the tooltip "Play";
    - with `?current=legends`, `subnav` shows `subnav-item-legends` and `subnav-item-openings`.
  - `ui-iphone`, `ui-android`:
    - `shell-tabbar` is visible with exactly 3 `tab-item-*`;
    - `shell-sidebar` isn't visible;
    - `shell-topbar` height is 44 ± 1;
    - `shell-account-avatar` opens `account-sheet`, anchored to the bottom;
    - `shell-search-button` isn't visible;
    - `?current=play`: tapping `subnav-item-tournaments` → `waitForURL(/\/tournaments|\/sign-in/)`;
    - `?back=legends`: `shell-back` is visible with the text "Legends" and href `/legends`, and `subnav` isn't visible.
  - `ui-ipad`:
    - read `matchMedia(COARSE_MQ)`; when coarse, expect the rail (64 ± 1);
    - `?current=play` shows `subnav`;
    - `ControlOrMeta+K` opens the palette;
    - `shell-search-button` is hidden on coarse pointers;
    - `/` does nothing on coarse pointers.
  - `context.setOffline(true)`:
    - tabbar projects: `shell-online-chip-inline` contains "Offline";
    - otherwise: `shell-online-chip` contains "Offline · new pages need a connection";
    - `setOffline(false)` → "Back online", with no page reload (a `window.__rcMarker` set before going offline survives).
  - **Palette legend search** (`ui-desktop`):
    - typing "morphy" makes the row "Paul Morphy" appear. This needs the P6 seed: `test.skip` with a clear message if `(await (await request.get("/api/legends/search?name=morphy")).json()).data.legends.length === 0`;
    - offline → `palette-legends-offline`.
  - **Dead links:** every `a[href]` under `[data-rc-nav]`, `[data-rc-tabbar]`, `[data-testid="subnav"]`, `account-menu` and `shell-back`, except `#…` hashes, returns < 400 via `page.request.get` and doesn't contain "Off the Board".
  - Dark: after `html.dark`, the `aria-current` nav item's background equals the dark `--cb-accent`.
  - axe: `a11y shell light|dark` and `a11y /dev/ui/shell light|dark`.

---

## 9. P4 Route integration (wrap the existing signed-in pages)

**Goal:** move the routes into `app/(app)/`, choose the chrome once per layout render, keep every legacy page working inside the shell in flow mode, and add the authed shell e2e spec.

### 9.1 Stage a: route moves (sequential, step 2 of §4.1; no dev server running)

1. `git mv` the 40 files under `app/{play,queue,challenge,join,join-tournament,position,tournaments,tournament,legends,openings,profile}` to `app/(app)/…`. List them first with `find app/play app/queue app/challenge app/join app/join-tournament app/position app/tournaments app/tournament app/legends app/openings app/profile -type f`.
2. `git mv app/(app)/play/ShareLinkModal.tsx app/components/ShareLinkModal.tsx`.
3. Rewrite the ShareLinkModal imports to `@/app/components/ShareLinkModal`:
   - the five alias importers: `app/game/[gameId]/GamePageContent.tsx:21`, `app/analysis/[gameId]/AnalysisShareModal.tsx:10`, `(app)/position/[referenceId]/PositionPageClient.tsx:13`, `(app)/legends/[referenceId]/ChallengeLegendButton.tsx:13`, `(app)/challenge/new/page.tsx:7`;
   - `(app)/play/page.tsx:17`, which uses `./ShareLinkModal`.
4. Rewrite every `../` import inside the moved files to an `@/app/components/...` alias: `play/page.tsx:7-9`, `legends/page.tsx:4-5`, `legends/[referenceId]/page.tsx:5-6`, `openings/page.tsx:4-5`, `openings/[referenceId]/page.tsx:5-6`, `openings/[referenceId]/OpeningBoardPreview.tsx:4`, `profile/[referenceId]/ChessComConnectModal.tsx:9`, `profile/[referenceId]/page.tsx:9-10`. There are no dynamic `import("../…")` calls (F B6).
5. Re-run `grep -rnE "@/app/(play|queue|challenge|join|join-tournament|position|tournaments|tournament|legends|openings|profile)/" app lib components e2e`. It must return nothing.
6. `GamePageContent.tsx`: add `pb-[var(--safe-bottom,0px)]` to the `lg:hidden` mobile action row at l.1217, or to its `h-[100dvh]` container at l.903 if that row isn't the last child (C §3.4, a `viewportFit: cover` consequence). Nothing else changes.
7. `npx next typegen`, then `pnpm --filter web check-types` must be green. Typegen regenerates `.next/types/validator.ts`, which imports the old paths.

### 9.2 Stage b: files (parallel phase)

**Create:** `app/(app)/layout.tsx`, `lib/shell/get-shell-session.ts`, `lib/shell/shell-user.ts`, `lib/shell/shell-user.test.ts`, `components/shell/chrome-context.tsx`, `e2e/specs/shell.spec.ts`.

**Edit:**
- The moved pages listed in §9.3.
- `app/components/Navbar.tsx`: add `data-testid="marketing-navbar"` to the root `<nav>` at line 37. Nothing else changes.
- `app/components/Hero.tsx:155`: `p-3` → `p-3 pb-[max(0.75rem,var(--safe-bottom,0px))]`.
- `app/components/ShareLinkModal.tsx` and `(app)/profile/[referenceId]/ChessComConnectModal.tsx`: add `role="dialog" aria-modal="true" data-rc-modal` and an `aria-label` (or `aria-labelledby` to its heading) on the modal root. Nothing else changes.

### 9.3 Implementation notes

**`lib/shell/shell-user.ts`** (pure; imports only `../billing/entitlement-rules`, type-only `../billing/plans`, and `./types`; C B3, F B3):
```ts
toShellSession(record, { now, paywallEnabled, catalog }: { now: Date; paywallEnabled: boolean; catalog: ProductCatalog })
  → { user: ShellUser; member: boolean }
```
- `summary = summarizeEntitlement(record, catalog, now)`.
- `member = !paywallEnabled || record.role === "ADMIN" || summary.entitled`.
- `ratingLabel`: `blitzRating ? \`Blitz ${blitz}\` : rapidRating ? \`Rapid ${rapid}\` : null`.
- `trialDaysLeft = summary.trial.active ? summary.trial.daysLeft : null`.
- `paymentFailed = summary.status === "past_due" || summary.status === "on_hold"`.
- `paymentFailedUntil = summary.currentPeriodEnd`. `paymentFailedUntilLabel` = the same date via `toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })`, or null.
- `hasBillingPortal = Boolean(record.dodoCustomerId)`. `/api/customer-portal` needs `dodoCustomerId` and redirects to `/pricing` without it (F B3).
- `isAdmin = role === "ADMIN"`.

**`lib/shell/get-shell-session.ts`** (server; don't import `server-only`, which isn't installed):
```ts
export const getShellSession = cache(async () => {
  const { userId } = await auth();                           // @clerk/nextjs/server
  if (!userId) return null;
  const record = await prisma.user.findUnique({ where: { googleId: userId },   // same lookup as lib/auth/resolve-user.ts:109
    select: { referenceId: true, name: true, profilePictureUrl: true, role: true, dodoCustomerId: true, ...ENTITLEMENT_SELECT,
              chessComProfile: { select: { blitzRating: true, rapidRating: true } } } });
  return record ? toShellSession(record, { now: new Date(), paywallEnabled: isPaywallEnabled(), catalog: getProductCatalog() }) : null;
});
```
- `isPaywallEnabled` comes from `lib/auth/require-subscription.ts:19`, `ENTITLEMENT_SELECT` from `lib/billing/entitlement.ts`, and `getProductCatalog` from `lib/billing/products.ts`. All three are server modules, which is fine here.
- No Clerk API call: the lookup is `googleId` = the Clerk user id.
- A missing DB row (first sign-in, before `UserSync`) returns null, so the page gets marketing chrome.

**`components/shell/chrome-context.tsx`** (client; the single source for pages, D2):
- `ChromeProvider({ mode, children })` and `useChrome(): ChromeMode`. Without a provider the mode is `"marketing"`.
- `MarketingOnly({ children })` and `ShellOnly({ children })` return the children or null.
- `chromeClass(mode, { marketing, shell }): string` returns the string for the mode.
- `ChromeBox({ as = "div", className, marketing, shell, ...rest })` renders `<as className={[className, mode === "shell" ? shell : marketing].filter(Boolean).join(" ")}>`. Use a plain join, **not** `cn`, so the marketing class set stays exactly as today.

**`app/(app)/layout.tsx`** (server):
```tsx
export default async function AppGroupLayout({ children }: { children: React.ReactNode }) {
  const session = await getShellSession();
  const mode: ChromeMode = session?.member ? "shell" : "marketing";
  return (
    <ChromeProvider mode={mode}>
      {mode === "shell" && session ? <AppShellView user={session.user}>{children}</AppShellView> : children}
    </ChromeProvider>
  );
}
```

**Page edits.**
- The rule: in `marketing` mode the output has the same DOM and the same class set as today. In `shell` mode the page renders no Navbar and no Footer, and no fixed-navbar `pt-*` offsets.
- `min-h-screen` and `overflow-hidden` **stay** in both modes. Flow mode (D15) plus P0's unlayered `.rc-vs .min-h-screen` override size them correctly, and the roots aren't stretched, so nothing is clipped.
- Client pages use `useChrome()` with `{chrome === "marketing" && <Navbar/>}` and `chromeClass`. Server pages use `<MarketingOnly>` and `<ChromeBox>`. No page calls `getShellSession()`.
- **Fixed CTA bars** (in both modes; the vars are 0 outside the shell, and `--rc-fixed-pad-bottom` is the safe inset):
  - `fixed bottom-0 left-0 right-0` → `fixed bottom-[var(--rc-fixed-bottom,0px)] left-[var(--rc-nav-w,0px)] right-0`;
  - `p-3` gets `pb-[max(0.75rem,var(--rc-fixed-pad-bottom,0px))]`, and `md:p-5` gets `md:pb-[max(1.25rem,var(--rc-fixed-pad-bottom,0px))]`;
  - the existing `lg:p-0`/`sm:p-0` still wins at those widths.

| File (under `app/(app)/`) | Lines today | Shell-mode change |
|---|---|---|
| `play/page.tsx` | 256, 258, 581 (224/674 spinners unchanged) | Navbar l.256 marketing-only. l.258: `pt-16 sm:pt-18 md:pt-24` marketing → shell `pt-6 lg:pt-8`; the rest of the class string is unchanged. l.581: the fixed-bar rule. |
| `position/[referenceId]/PositionPageClient.tsx` | 174/175, 197/198, 251/252, 429 | Navbar ×3 marketing-only; `pt-16 (sm:pt-18) md:pt-24` → shell `pt-6`; l.429 fixed bar. |
| `queue/page.tsx` | 314, 315 (297/397 spinners unchanged) | Navbar l.314; l.315 `pt-16 sm:pt-18 md:pt-24` → shell `pt-6`. |
| `challenge/new/page.tsx` | 68, 69 | Navbar l.68; l.69 `pt-16 md:pt-24` → shell `pt-6`. |
| `join/[gameReferenceId]/page.tsx` | 153/154, 173/174, 229/230, 248/249 | Navbar ×4; `pt-16 md:pt-24` (and `sm:pt-20`) → shell `pt-6`. |
| `join-tournament/[tournamentReferenceId]/page.tsx` | 149/150, 169/170, 219/220 | Navbar ×3; offsets → shell `pt-6`. |
| `tournaments/page.tsx` | 103, 104 | Navbar l.103; `pt-20 md:pt-28` → shell `pt-6`. |
| `tournament/[tournamentReferenceId]/page.tsx` | 41/42, 52/53, 135/136 | Navbar ×3; `pt-20 md:pt-28` → shell `pt-6`. |
| `profile/[referenceId]/page.tsx` | 171, 182 | Navbar l.171; l.182 `pt-20 sm:pt-24 md:pt-28` → shell `pt-6 sm:pt-8`. Keep `ThemeToggle`, `#membership` and `scrollIntoView`. |
| `profile/[referenceId]/MembershipSection.tsx` | 173, 301, 318, 355, 565 | `scroll-mt-24` → `chromeClass(mode, { marketing: "scroll-mt-24", shell: "scroll-mt-4" })`. l.173: `behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth"`. |
| `legends/page.tsx` (server) | 86, 107, 240 | `<MarketingOnly><Navbar/></MarketingOnly>` and the same for `<Footer/>`; l.107 → `<ChromeBox as="section" className="relative pb-12 sm:pb-16 px-6" marketing="pt-32 sm:pt-40" shell="pt-8 sm:pt-10">`. |
| `legends/[referenceId]/page.tsx` (server) | 94, 114, 146, 388 | same pattern; l.114 `pt-28 sm:pt-36` → shell `pt-8 sm:pt-10` (`pb-28 sm:pb-16` stays in both); l.146 fixed bar. |
| `openings/page.tsx` (server) | 66, 78, 216 | same as `legends/page.tsx`. |
| `openings/[referenceId]/page.tsx` (server) | 78, 98, 149, 314 | Navbar l.78 and Footer l.314 marketing-only; l.98 `pt-28 sm:pt-36` → shell `pt-8 sm:pt-10`; l.149 fixed bar. |

Don't touch `loading.tsx`, metadata layouts or JSON-LD. Don't restyle anything else; the legacy pages are redesigned in Phases 8–9. Keep each page's `<title>`: Next's route announcer reads it.

Notes:
- The `fixed inset-0 opacity-[0.015]` faint grids and the hand-rolled `fixed inset-0 z-50` modals stay as they are. They're fixed-position, so they still cover the viewport inside the shell.
- No middleware change: URLs are unchanged, and `/profile`, `/legends` and `/openings` stay public. `/dev` isn't protected.
- R4: `/legends` and `/openings` are already `force-dynamic`. `/legends/[ref]`, `/openings/[ref]` and `/profile/[ref]` become dynamic because the layout calls `auth()`.

### 9.4 Acceptance criteria

- Signed-out `/legends`, `/legends/<ref>`, `/openings`, `/openings/<ref>` and `/profile/<ref>` have the same DOM structure and class sets as today: Navbar (with `marketing-navbar`), Breadcrumbs JSON-LD, Footer, the same padding.
- A member sees `app-shell` on all 11 route families. A non-member sees today's chrome, and the existing client gate redirects to `/pricing?reason=required`.
- On every family in shell mode, the document scrolls to the page's last element, and that element sits above the tab bar or CTA bar.
- `/game/*` and `/analysis/*` are unchanged apart from the import line and the safe-area padding.
- Every regression testid from 01 §14 still resolves. `start-game-button` on phones sits above the tab bar.
- `pnpm --filter web check-types` is clean across the moved tree. Edited legacy files pass `lint-delta`.

### 9.5 Tests

- Unit `shell-user.test.ts` (catalog `{ monthly: "pdt_m", yearly: "pdt_y", legacy: ["pdt_old"] }` and a fixed `now`, built the way `lib/billing/entitlement-rules.test.ts` builds records):
  - an active member → member true;
  - an admin without a subscription → member true, `hasBillingPortal` false;
  - `dodoCustomerId` set → `hasBillingPortal` true;
  - paywall off → member true;
  - no subscription → member false;
  - a trial with 5 days left → `trialDaysLeft` 5; 3 hours left → 1;
  - past_due inside the period → member true, `paymentFailed` true, `paymentFailedUntilLabel` "Nov 12" for `2026-11-12T03:00:00Z`;
  - blitz 1184 → "Blitz 1184"; rapid only → "Rapid …"; neither → null.
- E2E `e2e/specs/shell.spec.ts`. It uses `test` from `../fixtures` (`authedPage` = member A, `nonMemberPage` = R). Tests aren't `@public` unless noted.
  1. Member `/play` → `app-shell` is visible, `marketing-navbar` count is 0, `nav-item-play` has `aria-current="page"`, and `mode-quick` and `start-game-button` are visible and enabled.
  2. Member `/tournaments` → `nav-item-play` and `nav-item-tournaments` are both current.
  3. Member `/legends` → `app-shell`, with `nav-item-learn` current and `nav-item-legends` visible.
  4. Clicking `nav-item-profile` → URL `/profile/<ref>` with `aria-current`. `#membership` is reachable via `account-item-membership`, and the section's top is ≥ 0 and ≤ 120 px from the viewport top.
  5. Account menu: `shell-account-button` → `account-menu`. Theme toggles `html.dark` and the `app-shell` background becomes `rgb(0, 0, 0)` (switch back afterwards). Esc returns focus.
  6. Palette: `ControlOrMeta+K`, type "tour", Enter → `/tournaments`. `g` then `p` → `/play`. `?` → `shortcuts-dialog`.
  7. **No dead links:** collect every `a[href]` under `[data-rc-nav]`, `[data-rc-tabbar]` and `[data-testid="subnav"]`, the account menu links (membership, help, privacy, terms, admin when shown) and the palette "Go To" targets. `page.request.get(href)` returns < 400 for each, and no response contains the 404 page's "Off the Board" text.
  8. Phone block, `test.use({ ...devices["Pixel 7"] })`:
     - member `/play` → `shell-tabbar` is visible;
     - after `window.scrollTo(0, document.scrollingElement.scrollHeight)`, the `start-game-button` box bottom ≤ the `shell-tabbar` box top + 1;
     - `shell-account-avatar` opens `account-sheet`;
     - `subnav-item-tournaments` → `/tournaments` in one tap;
     - on `/legends`, `subnav-item-openings` → `/openings` in one tap;
     - on `/legends/<ref>`, `shell-back` is visible and goes to `/legends`.
  9. Sign Out (its own test): `account-item-signout` → URL `/`, `marketing-navbar` visible.
  10. `nonMemberPage` `/legends` → `marketing-navbar` visible, `app-shell` count 0.
  11. `@public` signed-out `/legends` → `marketing-navbar`, `footer` and a `script[type="application/ld+json"]` containing `BreadcrumbList` are all present.
  12. **Scroll and clip** (C B1, F B4):
      - Projects: Pixel 7, and desktop with `viewport: { width: 853, height: 533 }, deviceScaleFactor: 3` (1280×800 at 150%).
      - Pages: member `/play`, `/legends/<ref>` and `/position/<ref>`. Find the refs by following the first legend link on `/legends` and that page's first position link, and skip with a message if there are none.
      - Scroll the document to the end. The page root's last element and the fixed CTA bar are fully inside the viewport; the last element's bottom is ≤ the CTA bar or tab bar top + 1; `mode-quick` can be clicked after `scrollIntoViewIfNeeded()`.
  13. **Legacy modal blocks shortcuts** (C H1): on member `/play`, open `ShareLinkModal` through the friend flow, the way `play-with-friend.spec.ts` does. Pressing `/`, `?`, `g`+`p` and `ControlOrMeta+K` opens no `command-palette` or `shortcuts-dialog`, and the URL doesn't change.
  14. **Clerk from the sheet** (C H9; Pixel 7): avatar → `account-item-account` → `.cl-userProfile-root` is visible, `getComputedStyle(document.body).pointerEvents !== "none"`, and its first button can be focused. Esc closes it.
  15. **Scroll restoration** (soft, `expect.soft`): scroll `/legends` to the bottom, open a legend, go Back; `scrollY` is within 4px of the old value. Record the result. Today's behaviour is the baseline.
  16. No console message containing "Hydration" on member `/play` and `/legends`.
- Self-verify during the parallel phase against the shared dev server: `cd WEB && set -a && source .env.test && set +a && PW_REUSE_SERVER=1 npx playwright test e2e/specs/shell.spec.ts --workers=2`. The socket server on 3002 is already running. Items 1, 10, 11 and 12 should pass against the P0 placeholder shell; the rest are expected red until P3 lands (§4.4).

---

## 10. P5 Layout primitives, board fill, device × zoom suite

**Goal:** `BoardStage` and `ScrollRegion`, ChessBoard `fill`, the `/dev/ui/stage` demo, the gallery layout section, and the full layout spec suite over 40 projects.

### 10.1 Files

- Own (placeholder): `app/dev/ui/_sections/layout.tsx`.
- Create:
  - `components/layout/BoardStage.tsx`, `components/layout/ScrollRegion.tsx`, `components/layout/board-stage.css`
  - `app/dev/ui/stage/page.tsx`, `app/dev/ui/stage/demo-data.ts`, `app/dev/ui/stage/DemoPlayerBar.tsx`, `app/dev/ui/stage/DebugReadout.tsx`
  - `e2e/devices/layout/fixtures.ts`, `assertions.ts`, `routes.ts`, `modes.ts`, `modes.test.ts`
  - specs `e2e/devices/layout/{one-viewport,board,resize,ssr,text-zoom,focus,reflow}.spec.ts`
- Edit: `app/components/ChessBoard.tsx`.

### 10.2 BoardStage and ScrollRegion

- Implement 04 §4.3 (`ScrollRegion`, `.rc-scroll`) and §4.4 (`BoardStage` TSX and CSS) **verbatim**, with these changes:
  - The CSS goes in `components/layout/board-stage.css` inside `@layer components { … }`, imported at the top of both `BoardStage.tsx` and `ScrollRegion.tsx` (`import "./board-stage.css";`). Don't edit `globals.css`.
  - The `BoardStage` root also carries **`data-rc-lock`**, which switches the enclosing shell to lock mode (D15).
  - `ScrollRegion` adds the `data-rc-scroll` attribute (already in 04).
  - The BoardStage TSX keeps `style={{ "--rc-nbars": bars } as React.CSSProperties}` (React Compiler-safe).
- Keep the names and data attributes from 04: `.rc-stage` (`container: rc-stage / size`, `min-height: 18.5rem`), `.rc-stage__in`, the `--rc-board` formula, the 590px stack threshold, the ≤620px density step, stack mode with `--rc-foot` 56/64 + safe-bottom, `data-rc-stage`, `data-rc-bar`, `data-rc-board-slot`, `data-rc-aside`, `data-rc-controls`.
- JSDoc on `BoardStage`:
  - the 04 §5.2 gotchas: don't register `--rc-board`; the container needs a definite size; never read `--rc-board` inside ChessBoard;
  - `container-type` makes `.rc-stage` and the fill board a **containing block for `position: fixed` descendants**, so `PromotionPopup` (`fixed inset-0`, `PromotionPopup.tsx:32,41`) and other overlays must portal to `body` when Phase 2 puts them inside a stage.

### 10.3 ChessBoard `fill` (`app/components/ChessBoard.tsx`)

Follow 04 §6.1–§6.2, **minus the arrow viewBox rewrite (§6.3), which waits for Phase 2**:
- `sizeConfig` gains `fill: "min-w-0 min-h-0"`, with `const isFill = squareSize === "fill"`.
- l.399–406: no `-inset-4` frame in fill mode; the wrapper is `w-full`.
- The board container (the `boardContainerRef` element) gets `data-testid="chess-board"` and `data-size={squareSize}` for **all** sizes. In fill mode it also gets `@container/board grid w-full aspect-square grid-cols-8 grid-rows-8`.
- l.426 rows: `isFill ? "contents" : "flex"`. The DOM stays the same: 8 row divs, 64 `[data-square]`.
- Fill-mode decorations from the 04 §6.2 table:
  - coordinates `text-[clamp(7px,2cqw,12px)]` with an inset of `0.6cqw`;
  - legal dot `size-[clamp(10px,3cqw,18px)]`, **keeping `rounded-full`**;
  - capture corners `border-[clamp(6px,1.6cqw,14px)]`, **keeping the inline `rgba(220, 80, 80, 0.45)`**;
  - badge `size-[4.25cqw]`, offset `-1.1cqw`, clamped to a 0 offset on the top rank and the h-file (relative to board orientation).
- Every other size renders exactly as today. The six call sites are untouched (04 §6.1).
- The ResizeObserver path for slide, drag ghost and arrows is unchanged. In fill mode it reports the grid's content width. In development, `console.warn` once if the observed width is 0.

### 10.4 `/dev/ui/stage`

`app/dev/ui/stage/page.tsx` is a server page that reads `searchParams` (§3.9). Every layout root carries `data-rc-lock` (BoardStage sets it itself).
- **Chrome.**
  - `chrome=shell` (default): `<AppShellView user={STAGE_USER} demo hideTabBar={layout === "game"} banner={banner === "offline" ? <Banner tone="warn">You are offline. Cached pages still work.</Banner> : undefined}>`. `STAGE_USER` is a local `ShellUser` (member "Knight Owl"), with `paymentFailed: true` and `paymentFailedUntilLabel: "Nov 12"` when `banner=payment`.
  - `chrome=none` → `<ViewportStage>` only.
- `layout=game`: `BoardStage label="Board"`.
  - `top` and `bottom` are `DemoPlayerBar`s: 48px high, a 32px Avatar, name and rating `truncate`, and a mono `tabular-nums` clock `5:00` in an 84×34 box.
  - `board` = `ChessBoard squareSize="fill"` with a middlegame FEN from `demo-data.ts` (`r1bq1rk1/pp2bppp/2n1pn2/3p4/2PP4/2N1PN2/PP3PPP/R2QKB1R w KQ - 0 9`) and `lastMove`. Add two arrows and an h8 annotation badge only if the ChessBoard props allow it; check the props and don't invent them. `flip=1` flips the board. The board stays non-interactive.
  - `aside`: P1's Tabs aren't available to P5, so use a plain header row (`text-overline` "Moves"), a `ScrollRegion label="Moves"` with 120 plies (`column-reverse`), and a footer row of P0 `Button variant="control"` (Offer Draw, Resign).
  - `footer`: 4 P0 `IconButton`s (Previous, Next, Flip Board, More) in a `flex justify-around` bar.
- `layout=hub`: `asideWidth="hub"`. The aside is a form: native radios styled as a segmented row, a label + native select, and a 48px `Button size="lg" block` "Start Game" in the panel footer. The tab bar is shown.
- `layout=list`: a page title row, a `ScrollRegion` with 80 rows of 56px, and a "Filter" `Button variant="secondary"`.
- `layout=empty`: `EmptyState` "Your Bank Is Empty", centred.
- `debug=1`: `DebugReadout` (client, after mount; `fixed bottom-2 right-2`, `data-rc-allow-overflow`) shows the CSS viewport, `devicePixelRatio`, `--rc-mode` and the board px.

### 10.5 Gallery section `layout.tsx`

- `ui-chessboard-fill-220`, `-320`, `-480`: fixed-width boxes (`w-[220px]` etc.), each holding a `ChessBoard squareSize="fill"`.
- `ui-scroll-region`: a 240px-tall box with 40 rows.
- `ui-board-stage-mini`: a 640×400 bordered box containing a `BoardStage` with bars and an aside. It proves container sizing inside a non-viewport parent. (There's no `.rc-vs` on the gallery, so its `data-rc-lock` doesn't lock the gallery.)
- "Open Stage Demo" links for each `layout` value.

### 10.6 Layout specs (`e2e/devices/layout/`, all 40 matrix projects)

- `fixtures.ts`: 04 §8.4 (inset emulation through `--safe-*` from `testInfo.project.metadata.insets`).
- `assertions.ts`: 04 §8.5 `snapshotLayout`, `inside` and `expectOneViewport`. `expectOneViewport` also asserts `html` matches `:has(.rc-vs [data-rc-lock])`, so a route that forgot `data-rc-lock` fails loudly. Reuse `expectTapTargets` and `waitForStable` from `../helpers`.
- `modes.ts`:
  ```ts
  export function expectedShellMode(vw: number, vh: number, touchShell: boolean): "sidebar" | "rail" | "tabbar" {
    const portrait = vh >= vw;
    if (vw <= 600 || (vw <= 900 && portrait)) return "tabbar";
    if (vw <= 1100 || touchShell) return "rail";
    return "sidebar";
  }
  ```
  `touchShell` is read from the page with `matchMedia(COARSE_MQ)` (04 §8.2 iPad note; the P0 probe records it).
- `routes.ts`:
  ```ts
  export const ROUTES = [
    { path: "/dev/ui/stage?layout=game", board: true },
    { path: "/dev/ui/stage?layout=game&banner=payment", board: true },
    { path: "/dev/ui/stage?layout=hub", board: true },
    { path: "/dev/ui/stage?layout=list", board: false },
    { path: "/dev/ui/stage?layout=empty", board: false },
    { path: "/dev/ui/shell", board: false },
    { path: "/dev/ui/shell?content=list", board: false },
    { path: "/dev/ui/shell?content=empty&user=payment", board: false },
    { path: "/dev/ui/shell?current=legends", board: false },          // SubNav row in rail/tabbar
    { path: "/dev/ui/shell?back=legends&current=legends", board: false },
  ] as const;
  ```
- Specs, from 04 §8.5:
  - `one-viewport.spec.ts`: every route through `expectOneViewport` + `expectTapTargets`.
    - Mode check via `expectedShellMode`: sidebar → `[data-rc-nav]` width 220±1; rail → 64±1; tabbar → `[data-rc-tabbar]` visible. On `layout=game`, tabbar mode instead requires a visible `[data-rc-controls]` and no tab bar.
    - Exactly one `Main navigation` landmark visible (none on tabbar-mode game).
  - `board.spec.ts`:
    - side vs stack by geometry; in side mode the aside's height equals the column height ±1;
    - the board is ≥ 220px and square;
    - its corners and centre are not occluded;
    - soft golden sizes from 04 §5.4: `desktop-1440@100` → 760, `desktop-1440@150` → 496, `desktop-1280@125` → 500, `ipad-portrait@100` → 760, `iphone-safari@150` → about 259, each `expect.soft(…).toBeCloseTo(x, -1)`. Recompute with the real rail and bars if they differ, and document any constant change.
  - `resize.spec.ts`: on `iphone-safari@100`, `desktop-1440@100` and `desktop-1280@125`, `setViewportSize` 393×659 → 393×745 and 1440×900 → 960×600, with no reload. The board stays inside and changes size. `banner=payment` makes the board smaller on height-limited projects.
  - `ssr.spec.ts`: projects without insets. The board box with JavaScript disabled (a new context copying the project's viewport/screen/DPR/isMobile/hasTouch/UA) equals the hydrated box ±0.5. Chromium only: CLS < 0.01 over 1.5s.
  - `text-zoom.spec.ts`: `html{font-size:20px}` on `desktop-1440@100`, `iphone@100` and `ipad-portrait@100` → `expectOneViewport` + `expectTapTargets`.
  - `focus.spec.ts` (Chromium projects only; F M6):
    - Tab into the last control in the aside; `scrollingElement.scrollTop === 0`, and the `[data-rc-viewport]` scrollTop stays 0;
    - the ScrollRegion scrolls instead;
    - a ScrollRegion with no focusable content is reachable (`tabindex=0`).
  - `reflow.spec.ts`: ad-hoc 640×400 and 197×330 contexts (200% zoom): no horizontal scroll, and the board becomes fully visible after `main` scrolls.
- Every spec waits with `waitForStable` before measuring. Occlusion checks exclude `[data-nextjs-toast]` and `[data-rc-allow-overflow]`.

### 10.7 Acceptance and tests

- Unit `modes.test.ts`: `(853,533,false)` → rail; `(1152,720,false)` → sidebar; `(1194,834,true)` → rail; `(556,796,true)` → tabbar; `(852,393,true)` → rail (phone landscape).
- The six existing ChessBoard call sites render pixel-identical at 1440×900. Check the game and analysis pages manually, or with a before/after screenshot diff on `/play` (`lg` default), `/openings/<ref>` (`md`) and the admin positions page (`sm`). The existing e2e board helpers keep working (game specs in §12).
- Self-verify against the shared dev server:
  ```
  DEVICES_BASE_URL=http://localhost:3000 LAYOUT_ZOOMS=1,1.5 npx playwright test -c playwright.devices.config.ts --workers=2 \
    --project='desktop-1440@*' --project='desktop-1280@*' --project='iphone@*' --project='ipad-portrait@*' layout/
  ```
  The full 40-project run happens in integration on a production build.

---

## 11. P6 Dev-DB content seed

**Goal:** an idempotent, guarded content seed for the Neon `dev` branch (also the e2e DB), applied with design fixtures, so `/legends`, the palette's legend search and the Play page's legend list have real content.

### 11.1 Files

Create:
- `prisma/seed-content.ts` (CLI)
- `prisma/seed-content-plan.ts` (pure planner)
- `prisma/seed-content-plan.test.ts`
- `prisma/seed-guards.ts` (pure)
- `prisma/seed-guards.test.ts`
- `prisma/fixtures/design-legend-positions.ts`
- `prisma/fixtures/design-legend-positions.test.ts`

The `package.json` script `prisma:seed:content` and the `.gitignore` entry come from P0.

### 11.2 Implementation notes

Base it on 05 §4 with these changes.
- **CLI:** `pnpm --filter web prisma:seed:content [-- --apply] [--source fixtures|json|db] [--from-json <file>] [--retire-placeholders] [--with-tournament-fixtures]`.
  - The default is `--source fixtures` and a **dry run**.
  - `--source db` reads `OLD_PROD_DATABASE_URL` inside a `REPEATABLE READ, READ ONLY` transaction (05 §4.7). `--source json` reads a 05 §4.4 export.
  - Both non-fixture paths must exist and be unit-tested on the planner, but **don't run them**: they need the user's approval to read old prod (05 §7.1). No env file defines `OLD_PROD_DATABASE_URL` today.
  - For `json`/`db`, whitelist columns (F §4.5):
    - drop `chess_positions.sourceMetadata`, or keep only known keys;
    - leave `explanationAudioUrl` and `profilePhotoUrl` values pointing at the prod R2 bucket, and note it in the run log.
- **Guards** (`seed-guards.ts`; all before any write; 05 §4.2):
  1. Load only `.env.development.local` (`dotenv` `{ path: ".env.development.local" }`), **never** `.env.local`, which points at old prod. dotenv doesn't override an already exported variable, so print whether the host came from the file or the shell.
  2. The target is `DIRECT_URL`, and its hostname must match `/^ep-fancy-dust-b8b3dp81(-pooler)?\.c-14\.us-east-1\.aws\.neon\.tech$/`. There is no override flag.
  3. **Write through the guarded URL** (F §4.1): the CLI creates its own `new PrismaClient({ datasourceUrl: directUrl })` from `../app/generated/prisma`. It never uses `lib/prisma.ts`, whose client follows `DATABASE_URL`.
  4. The source host must not equal the target host and must not match the allowlist.
  5. Tripwire: `SELECT count(*) FROM users` must be ≤ 60.
  6. Writes happen only with `--apply`, inside **one** `prisma.$transaction` covering every row, so a mid-run failure leaves dev untouched.
  7. No `prisma migrate`/`db push`.
  8. Never print credentials. Print hosts only.
- **Planner** (`seed-content-plan.ts`; pure, with **no** import of the generated client): given the source snapshot and the target keys, it returns per-table rows of `{ action: "insert" | "update" | "unchanged" | "conflict", key, data }`.
  - Legends match by `referenceId`, then `name` (`@unique`).
  - Positions match by `referenceId`, then `fen` (`@unique`). Legend FKs are remapped through legend `referenceId` → dev id, and an `orphan-legend` is logged.
  - Openings match by `(eco, name, pgn)`; content columns only.
  - JSON nulls become the sentinel `export const DB_NULL = Symbol("DbNull")`. The CLI maps it to `Prisma.DbNull`. This keeps `test:unit` independent of `prisma generate` (F §4.3).
  - Updates never touch `id`, `referenceId` or `timesPlayed`. Nothing is deleted.
- **Fixtures** (`design-legend-positions.ts`). Use exactly this data and don't add facts. The column names are the schema's (`birthYear`, `deathYear`; `shortDescription` is `VarChar(500)`).

| Legend | era | nationality | birthYear | deathYear | peakRating | playingStyle | shortDescription | achievements |
|---|---|---|---|---|---|---|---|---|
| Paul Morphy | Romantic Era | USA | 1837 | 1884 | null | Fast development and open lines | American prodigy who beat Europe's leading players in 1858 and showed how quickly development wins. | ["Won the First American Chess Congress, 1857"] |
| Adolf Anderssen | Romantic Era | GER | 1818 | 1879 | null | Sacrificial attack | German master who won London 1851, the first international tournament, and played the Immortal Game. | ["Won London 1851"] |
| Bobby Fischer | Modern Era | USA | 1943 | 2008 | 2785 | Precise, classical and relentless | 11th World Champion (1972-1975), who played the Game of the Century at 13. | ["World Champion 1972-1975", "U.S. Champion eight times"] |
| Garry Kasparov | Modern Era | RUS | 1963 | null | 2851 | Dynamic, deeply prepared attacking play | 13th World Champion (1985-2000) and world number one for most of two decades. | ["World Champion 1985-2000"] |
| Veselin Topalov | Modern Era | BUL | 1975 | null | 2816 | Aggressive, initiative-first | FIDE World Champion in 2005, known for sharp, uncompromising play. | ["FIDE World Champion 2005"] |
| Alexei Shirov | Modern Era | ESP | 1972 | null | null | Tactical and imaginative | Riga-born grandmaster famed for daring sacrifices, including 47...Bh3 against Topalov in 1998. | ["FIDE World Championship finalist, 2000"] |

  Every legend gets `isActive: true`, `isVisible: true`, `profilePhotoUrl: null`, and `famousGames` = the fixture positions they play in, as `[{ title, year, fen }]` (the shape `app/(app)/legends/[referenceId]/page.tsx:54` reads). Achievements are as above.

  The positions use 05 §5's FENs, each checked with `chess.js` in the fixture test:

| key | White (FK) | Black (FK) | tournamentName | year | sideToMove | theme | FEN |
|---|---|---|---|---|---|---|---|
| mo | Paul Morphy | "Duke Karl of Brunswick and Count Isouard" (name only) | Paris Opera | 1858 | white | Attack | `rn2kb1r/p3qppp/2p2n2/1p2p1B1/2B1P3/1QN5/PPP2PPP/R3K2R w KQkq - 0 10` |
| kt | Garry Kasparov | Veselin Topalov | Wijk aan Zee | 1999 | white | Sacrifice | `b2r3r/k4p1p/p2q1np1/NppP4/3p1Q2/P4PPB/1PP4P/1K1RR3 w - - 1 24` |
| bf | "Donald Byrne" (name only) | Bobby Fischer | Rosenwald Memorial, New York | 1956 | black | Sacrifice | `r3r1k1/pp3pbp/1qp3p1/2B5/2BP2b1/Q1n2N2/P4PPP/3R1K1R b - - 3 17` |
| ak | Adolf Anderssen | "Lionel Kieseritzky" (name only) | London | 1851 | white | Attack | `rnb1k1nr/p2p1ppp/8/1pbN1N1P/4PBP1/3P1Q2/PqP5/R4KR1 w kq - 0 18` |
| ts | Veselin Topalov | Alexei Shirov | Linares | 1998 | black | Endgame | `8/8/4kpp1/3p1b2/p6P/2B5/6P1/6K1 b - - 0 47` |

  Each position also gets:
  - `eventDate` = `Date.UTC(year, 0, 1)`, with `gameMetadata: { datePrecision: "year" }`;
  - `moveNumber` from the FEN;
  - `positionType: "legend"`, `positionContext: { theme }`, `sourceType: "design-fixture"`, `featured: true`, `isActive: true`;
  - `pgn` only for mo: `1.e4 e5 2.Nf3 d6 3.d4 Bg4 4.dxe5 Bxf3 5.Qxf3 dxe5 6.Bc4 Nf6 7.Qb3 Qe7 8.Nc3 c6 9.Bg5 b5`;
  - `sideToMove` as `"white"`/`"black"` (the `prisma/seed.ts:133` convention).
- `--retire-placeholders` and `--with-tournament-fixtures` are implemented per 05 §4.3/§6, off by default, and not run.

### 11.3 Run (P6 performs this; the user authorised seeding the dev branch)

1. Record the pre-run counts (read-only): users, games, legends, chess_positions.
2. `cd WEB && pnpm prisma:seed:content` (dry run). Print the plan counts, the target host and its source. Expected: 6 legend inserts, 5 position inserts, 0 updates.
3. `pnpm prisma:seed:content -- --apply` (one transaction).
4. Dry run again: every row reports `unchanged` (idempotent).
5. Verify with a read-only script or the 05 §4.6 queries:
   - `legends` = 6, all visible;
   - `chess_positions` = 8 + 5;
   - positions linked to legends ≥ 5;
   - `featured AND isActive` ≥ 9 (4 existing + 5);
   - `users` and `games` unchanged from step 1.
6. `curl -s 'http://localhost:3000/api/legends/search?name=morphy'` on the shared dev server returns Paul Morphy in `data.legends`.
7. Note in the hand-back: quick-match and friend games now sometimes start from these positions (`getRandomChessPosition` picks uniformly). `bf` and `ts` are black to move, `ak` is a near-mating attack, and `ts` is a sparse endgame. Investigate any new game-spec flake in §12 as seed-related first.

### 11.4 Tests

- `seed-guards.test.ts`:
  - the allowlist accepts the dev host and its `-pooler` variant;
  - it rejects `ep-noisy-cake-a55zbrl9…` (old prod) and any `withered-cake` production endpoint;
  - source == target is rejected;
  - the user tripwire is checked.
- `seed-content-plan.test.ts`:
  - an empty target → all inserts;
  - the same snapshot twice → all unchanged;
  - a FEN collision with a different referenceId → update, keeping the dev referenceId;
  - a missing legend ref → `orphan-legend` with FK null;
  - JSON null → `DB_NULL`;
  - `sourceMetadata` is dropped on the `json` path.
- `design-legend-positions.test.ts`:
  - every FEN loads in `chess.js`;
  - the side to move matches the FEN;
  - the mo PGN reaches exactly the mo FEN;
  - every legend referenced by a position exists in the legend list;
  - `shortDescription.length ≤ 500`.

---

## 12. End-to-end test plan (after all packages land)

Run these in order. Stop at the first red, fix it in the owning package's files, and record every command and result for the hand-back.

### 12.1 Integration preflight

1. All six hand-backs are in, and every "Request for owner" is resolved.
2. `git status` shows only intended changes.
   - The untracked `reports/` and `research_notes/` belong to the user: leave them alone and don't commit them.
   - If a build changed or deleted the tracked `public/swe-worker-5c72df51bb1f6ee0.js.map`, `git restore` it.
3. Stop the shared dev server and check ports 3000/3002/3100 with `lsof`. Note the restart commands in the hand-back: `pnpm --filter web dev` and `pnpm --filter web-socket dev`.

### 12.2 Static and unit

```
pnpm --filter web check-types
pnpm --filter web test:unit
pnpm --filter web lint            # warnings ≤ SP/phase1/lint-baseline.json totals, 0 errors (D19)
node SP/phase1/scripts/lint-delta.mjs $(git diff --name-only -- 'apps/web/**/*.ts' 'apps/web/**/*.tsx' | sed 's#^apps/web/##')
npx eslint --max-warnings 0 $(git ls-files --others --exclude-standard -- '*.ts' '*.tsx')   # new files
pnpm --filter web build           # Vercel parity; uses .next
```
Grep gates on new code (`components/ui components/shell components/layout lib/nav lib/shell app/dev`):
- `rg -n "useMemo|useCallback|React\.memo|forwardRef"` returns 0 (comments included).
- `rg -n "rounded-(xs|sm|md|lg|xl|2xl|3xl)\b"` returns 0.
- `rg -nP "\p{Extended_Pictographic}"` returns 0.

### 12.3 Automated browser suites

1. **Device × zoom layout + UI gallery + a11y:** `cd WEB && pnpm test:devices`.
   - It builds into `.next-devices` and serves on port 3100 with service workers blocked, then runs 40 layout projects, 4 UI projects and 2 motion projects.
   - Webkit and chromium must be installed (P0 did this). Everything is green.
   - Review soft golden-size misses; don't ignore them.
   - Then run `npx next typegen`, and check that `git diff tsconfig.json` shows only P0's two `include` lines.
2. **Main regression + shell spec** (after the P6 seed): `cd WEB && set -a && source .env.test && set +a && npx playwright test`.
   - That covers `membership`, `paid-only`, `pricing`, `play-with-bot`, `play-with-friend`, `quick-match`, `tournament` and the new `shell.spec.ts`. Everything is green.
   - If something flakes, rerun that single spec once. A second failure is a real failure; check seed positions first (§11.3.7).
3. **Public subset:** `E2E_PUBLIC_ONLY=1 npx playwright test` is green.
4. **Production guard, offline and PWA:**
   - Build and start (the start runs in the background):
     ```
     cd WEB && set -a && source .env.test && set +a && export NEXT_DIST_DIR=.next-prodcheck NEXT_PUBLIC_APP_ENV=production NEXT_PUBLIC_POSTHOG_KEY= NEXT_PUBLIC_SENTRY_DSN= SENTRY_DSN= NEXT_PUBLIC_GA_MEASUREMENT_ID= && pnpm build && pnpm start --port 3200
     ```
     `.env.test` is sourced first, so the DB is dev and the old-prod telemetry keys stay blank.
   - `curl -s -o /dev/null -w "%{http_code}" http://localhost:3200/dev/ui` → `404`. The same for `/dev/ui/shell`, `/dev/ui/stage` and `/dev/ui/sections/controls`.
   - `curl http://localhost:3200/robots.txt` lists `/dev/`.
   - `curl -s http://localhost:3200/manifest.json` shows `"id": "/"` and `"start_url": "/play"`.
   - Stop the server, `rm -rf .next-prodcheck`, then `npx next typegen`.

### 12.4 Data checks

Rerun P6's dry run: everything is `unchanged`. Rerun the §11.3 step-5 counts (read-only). `/legends` lists 6 legends, and `/legends/<Paul Morphy ref>` shows the Opera Game position.

### 12.5 Manual checks with ego-browser (local)

Setup:
- Start `cd WEB && NEXT_PUBLIC_DEV_WIDGETS=0 pnpm dev`, and `pnpm --filter web-socket dev` with `WEB_APP_URL=http://localhost:3000 ALLOWED_ORIGINS=http://localhost:3000` (as in `playwright.config.ts`), unless it's still running.
- Load the `ego-browser` skill first.
- Sign in as E2E user A, with the credentials in `.env.test`. If Clerk asks for a code, use `E2E_CLERK_TEST_CODE`.
- Close every tab you opened at the end (`task.finish({ keep: [] })`).

| # | Check | Viewports / zoom |
|---|---|---|
| M1 | `/dev/ui`: every section renders in light and dark (toggle). The type is Geist (DevTools computed font, or a visual check). No off-token colours. Focus rings are visible with Tab and aren't clipped on nav, tab and palette items. | 1440×900 |
| M2 | `/dev/ui/shell`: sidebar at 220; rail at 1100 wide; tab bar at 393 wide; SubNav in rail and tab-bar modes; Back with `back=legends` on phones; the trial, payment and admin demo users; palette ⌘K, `/`, `?`, `g p`; the single-key switch; Esc closes everything; the online chip appears when DevTools goes offline. | 1440×900, 1280×800, 1100×800, 834×1194, 393×852, 412×915 |
| M3 | `/dev/ui/stage?layout=game` and `hub`: the board, both bars and the controls are fully visible with no page scroll at browser zoom 80/100/110/125/150% (⌘− / ⌘+). The board shrinks at 150%. Flip works. The `debug=1` readout looks plausible. | 1440×900, 1280×800 |
| M4 | Member `/play`: shell; the page scrolls to the bottom; the mode cards work; Start Game reaches a bot game. `/game/<id>` has no shell and plays to resignation, and toasts there stay top-centre. `/analysis/<id>` opens as before. Leaving `/queue` through a nav link cancels the queue, as today's Navbar links do. | 1440×900, 393×852 |
| M5 | Member `/tournaments`, `/tournament/<ref>`, `/legends`, `/legends/<ref>`, `/openings`, `/openings/<ref>`, and both your own and another user's `/profile/<ref>`: the shell is present, the current item is correct, the content is intact, Back works on phones, and the legacy fixed CTA bars sit above the tab bar on phones and to the right of the rail at 960 wide. | 1440×900, 960×600, 393×852 |
| M6 | Account menu: Membership → `#membership`; Manage Billing opens the Dodo test portal (if user A has a subscription), and the shell refreshes on return; Theme switches; Account opens the Clerk profile, which is clickable from the phone sheet; Help/Privacy/Terms open; Sign Out → `/` with the marketing Navbar. | 1440×900, 393×852 (sheet) |
| M7 | Signed out: `/legends`, `/openings`, `/profile/<ref>`, `/pricing`, `/`, and one `/blog/<slug>` look exactly as before apart from the Geist font and the new focus ring. `/play` redirects to sign-in. | 1440×900, 393×852 |
| M8 | Non-member (user R): `/legends` uses the marketing chrome; `/play` redirects to `/pricing?reason=required`. | 1440×900 |
| M9 | Toasts: trigger `ui-toast-*` on `/dev/ui/sections/overlays`. Desktop: top-right, at most 3. Phones: bottom-centre, one at a time, with the action kept. Above the tab bar on `/dev/ui/shell`. Trigger a legacy toast (copy a link on `/legends/<ref>` → Challenge, if it toasts) and check its style. Outside the shell (`/pricing`) toasts are top-centre. | 1440×900, 393×852 |
| M10 | Console: no errors or hydration warnings on the M1–M8 pages. The Network tab shows no 404s for shell links. | all |
| M11 | iPhone standalone emulation (WebKit with `--safe-*` 59/34 via DevTools, or a real device if available): the top bar sits below the status-bar area, the tab bar above the home indicator; the `/` Hero CTA and `/game` action row clear the home indicator. Record any gaps in §13. | 393×852 |

### 12.6 Deploy and check the dev site

1. Commit on `dev` with the attribution trailer from the session instructions. Push to `origin dev` **only**, never `main`. The Vercel project `replay-chess-dev` auto-deploys.
2. Watch the deployment with the Vercel MCP (`list_deployments` / `get_deployment` for `replay-chess-dev`; build logs on failure) until it is READY. Check that the project env has `NEXT_PUBLIC_APP_ENV=dev` with `filter_project_envs` (names only; never decrypt values).
3. On https://replay-chess-dev-replaychess007-1069.vercel.app:
   - first unregister service workers (DevTools → Application) or hard-reload, so stale precached chunks aren't tested;
   - `/dev/ui` returns 200 (APP_ENV=dev);
   - repeat M1–M10 at 1440×900 and 393×852;
   - check `/dev/ui/stage` at 125/150% zoom;
   - go offline and back: the chip says "Back online" and the page doesn't reload.
4. Automated against the deployment: `DEVICES_BASE_URL=https://replay-chess-dev-replaychess007-1069.vercel.app LAYOUT_ZOOMS=1,1.25,1.5 pnpm --filter web test:devices`. If Vercel deployment protection blocks Playwright (401, or a redirect to vercel.com), get a bypass through the Vercel MCP (`get_access_to_vercel_url` or the protection-bypass header). Otherwise run only the manual checks and say so.
5. The live socket server (`wss://ws-dev.80-225-200-210.sslip.io`) is unaffected by this phase. Smoke-test one bot game and one friend game on the dev site.

### 12.7 Telemetry checks

- **PostHog** (project-scope MCP, or the dashboard via ego-browser as replaychess007):
  - the events `shell_nav_click`, `shell_palette_opened`, `shell_palette_command`, `shell_shortcuts_opened`, `shell_shortcuts_toggled` and `shell_account_action` arrive from the dev site with `app_env = dev`;
  - no event carries query text;
  - the shared local dev server and the devices suite send none (blank key).
- **Sentry** (environment `dev`): no new issues during the session; specifically no hydration mismatch, no `ResizeObserver loop`, and no `cmdk`/Radix errors.
- **Vercel:** `get_runtime_errors` / `get_runtime_logs` for `replay-chess-dev` over the test window show no new 5xx. Pay attention to `app/(app)/layout.tsx` (`getShellSession`) and `/api/legends/search`.
- **Web Vitals** (Speed Insights on dev): members' CLS on `/play` and `/legends` doesn't regress beyond 0.1.

### 12.8 Definition of done

Everything in 12.2–12.4 is green. M1–M11 pass locally, and M1–M10 on the dev site. Telemetry is clean. The hand-back lists:
- what changed per package;
- the commit SHA and the deployment URL;
- any soft-assert deltas (golden sizes, scroll restoration);
- the P0 probe results;
- the open decisions in §13.

---

## 13. Risks, known limitations and decisions for the user

| # | Item | Handling |
|---|---|---|
| R1 | The whole site changes font (Helvetica/system → Geist) | Intended (D8). Flag it in the hand-back with the before/after screenshots from §4.1 step 4. |
| R2 | Re-pointing the shadcn `--border`/`--background` changes some hairlines from opaque grey to `cb-border`; the global 2px focus ring now shows on every focusable element, including blog widgets | Intended. Covered by the M1/M7 visual checks. |
| R3 | Legacy pages inside the shell scroll the document (flow mode), against the README's one-viewport rule | Accepted for Phase 1. They are redesigned in Phases 8–9 and then opt into lock mode. |
| R4 | `/legends/[ref]`, `/openings/[ref]` and `/profile/[ref]` become fully dynamic because the group layout calls `auth()` (`/legends` and `/openings` already are) | Small TTFB cost. Monitor in Vercel. |
| R5 | iPad landscape at 100% may render the 220px sidebar if WebKit emulation reports a fine pointer | The tests read the real media; the P0 probe records it. Do a real-device check later. |
| R6 | `viewportFit: "cover"` is global: on landscape iPhones, marketing pages and `/game` slide under the notch on the sides | Outside the matrix. Phase 1 fixes the bottom bars (Hero, `/game` action row, legacy CTA bars); the sides wait for Phase 9. |
| R7 | Android top and tab bars use the iPhone heights (44/56); V3AndroidPlayHub shows 48/64 | Decision for the user. A `@supports (-webkit-touch-callout: none)` split can't be verified in Playwright WebKit, so it isn't done in Phase 1. |
| R8 | Banner rows (SubNav, payment) make a short legacy page scroll by their height | Accepted. Lock-mode pages are unaffected (the banner shrinks the page). |
| R9 | No offline fallback page: navigating to a new page offline shows the browser's error page | The chip copy says new pages need a connection. The offline page is Phase 11 (V3Offline). |
| R10 | The service worker caches per-user pages (`cacheOnFrontEndNav`, `aggressiveFrontEndNavCaching`) | Sign Out purges the runtime caches (P3). Excluding `(app)` RSC payloads from runtime caching is Phase 9. |
| R11 | `notFound()` inside an `(app)` page renders the root `not-found.tsx` without the shell | Accepted; `(app)/not-found.tsx` is Phase 9 (V3Error404). |
| R12 | The payment-failed banner shows only on shell pages, not on `/game`, `/analysis` or `/pricing` (plan §1 says "everything") | Accepted for Phase 1; it moves with those pages in Phases 2–3. |
| R13 | Clerk's UserProfile modal may offer "Delete account", which bypasses our cascade | Not new (the Navbar's UserButton has it too). Phase 9. |
| R14 | Phone toasts can cover the last row of an open account sheet | Accepted: toasts are short-lived and the sheet scrolls. |
| R15 | Radix `collisionPadding` takes numbers only, so menus near a landscape notch don't add the safe inset | Accepted; 16px padding. |
| R16 | Native range thumbs stay round in WebKit | Accepted (P1 JSDoc). |
| U1 | **Copy content from old prod** (legends, positions with explanations, opening explanations) into dev | Needs the user's approval to read old prod (`neon run_sql` on `shy-morning-50748774`), or the user runs `--source db` themselves. The script is ready (P6). |
| U2 | `--retire-placeholders` for the 6 "Various" seed positions | The user decides. Off by default. |
| U3 | After sign-in, land members on `/play` instead of `/` | Not done in Phase 1 (`/sign-in` defaults to `redirect_url \|\| '/'`). Suggested for Phase 2. |
| U4 | Page title size (README 28–36px vs boards 44px) | Fluid clamp adopted (D9). Confirm. |
| U5 | The production Vercel project should still set `NEXT_PUBLIC_APP_ENV=production` | No longer a leak risk, because `/dev` fails closed (D11). Add it to the go-live checklist for telemetry tagging. |
| U6 | **iOS standalone status bar:** switched from `black-translucent` to `default`, because white status text was unreadable over the light top bar (C H4). In dark theme the status bar is now a light strip. | Confirm, or choose `black-translucent` with an accent-filled safe-top strip in light theme. |
| U7 | **PWA start URL** is now `/play` (with `"id": "/"` keeping existing installs). Signed-out launches go to sign-in, and non-members to `/pricing`. | Confirm. |
| U8 | **`reloadOnOnline` turned off** (the OnlineChip replaces the reload) | Product decision; confirm. |
| S1 | Design deviation: no ink-sweep hover in the app kit (DS `Button/README.md` describes it) | Sign-off, or add an opt-in `sweep` prop later. |
| S2 | Design deviation: toast placement follows V3 (top-right, bottom-centre on phones) inside the shell; DS `Toast/README.md` says top centre | Sign-off, then update the DS README. |
| S3 | Design deviation: the accent fills selected/on states (chips, segments, current nav item); the README says primary buttons and hover only | Sign-off (D9). |
| S4 | Design deviation: the phone avatar opens the account sheet; V3 boards link it to the profile | Fine until Settings exists (Phase 9). |
| S5 | Copy deviation: palette rows in Title Case; V3CommandPalette uses sentence case | Follows the README rule; confirm. |

Plan text this spec supersedes (update `docs/implementation-plan.md` in Phase 2):
- l.80: board sizing uses container queries, and zoom coverage is 80–150%.
- l.84: the `--board` formula is `--rc-board` on a size container.
- l.205: zoom is emulated by viewport ÷ zoom and DPR × zoom; the suite exists from Phase 1; the matrix adds 150% plus the 393×659 and 412×839 real-browser heights.

---

## 14. Final work-package list

| id | Title | Files owned | Depends on |
|---|---|---|---|
| P0 | Foundation | `package.json`, root `pnpm-lock.yaml`, `app/globals.css`, `app/layout.tsx`, `next.config.js`, `tsconfig.json` (include list), `eslint.config.js`, `.gitignore`, `public/manifest.json`, `app/robots.ts`, `playwright.config.ts`, `lib/utils.ts` + test; `components/ui/{button,icon-button,kbd,spinner,count-badge}.tsx`, `components/ui/use-media-query.ts`; `components/layout/{ViewportStage.tsx,viewport.css}`; `lib/env.ts` + test, `lib/layout/media-queries.ts` + test, `lib/shell/types.ts`, `lib/shell/presence.ts` + test; `app/components/ThemeColorSync.tsx`; `app/dev/layout.tsx`, `app/dev/ui/page.tsx`, `app/dev/ui/sections/*/page.tsx`, `app/dev/ui/_components/*`, `app/dev/ui/_sections/foundations.tsx`; `playwright.devices.config.ts`, `e2e/devices/{matrix,zoom,zoom.test,helpers,a11y}.ts`, `e2e/devices/ui/{foundations,a11y}.spec.ts`, `e2e/devices/layout/probe.spec.ts`; placeholders handed over (below); `SP/phase1/lint-baseline.json`, `SP/phase1/scripts/lint-delta.mjs` | — |
| P1 | UI kit: controls, display, feedback | `components/ui/{avatar,tag,banner,skeleton,empty-state,switch,checkbox,page-header}.tsx` (from placeholders), `components/ui/{chip,segmented,tabs,field,radio-card,card,divider,disclosure,progress,action-bar}.tsx`, `components/ui/{avatar-gradient,field-a11y}.ts` + tests; delete `components/ui/label.tsx`; `app/dev/ui/_sections/controls.tsx`; `e2e/devices/ui/controls.spec.ts` | P0 |
| P2 | UI kit: overlays and toasts | `components/ui/{tooltip,dialog,sheet,menu}.tsx` (from placeholders), `components/ui/{popover,info-button,filter-popover,responsive-dialog,toast}.tsx`, `components/ui/toast.css`, `components/ui/toast-config.ts` + test; `app/components/ThemeAwareToaster.tsx`; `app/dev/ui/_sections/overlays.tsx`; `e2e/devices/ui/overlays.spec.ts` | P0 (imports P1's `checkbox` placeholder) |
| P3 | App shell | `components/shell/AppShellView.tsx` (from placeholder), `components/shell/{Sidebar,TopBar,TabBar,SubNav,AccountMenu,CommandPalette,ShortcutsDialog,ShellBanners,OnlineChip,RouteHairline,Brand}.tsx`, `components/shell/{useAccountActions,useDeferredAction,useShellKeys}.ts`; `lib/nav/destinations.ts` + test; `lib/shell/{keys,palette,hairline,prefs}.ts` + tests, `lib/shell/{nav-history,pwa}.ts`, `lib/shell/copy.test.ts`; `lib/analytics/shell-events.ts`; `app/dev/ui/shell/{page.tsx,demo-users.ts,DemoContent.tsx}`; `app/dev/ui/_sections/shell.tsx`; `instrumentation-client.ts`; `app/components/IOSInstallModal.tsx` (root attributes only); `e2e/devices/ui/shell.spec.ts` | P0 (imports P1/P2 placeholders) |
| P4 | Route integration (stage a: moves; stage b: chrome) | **a:** the 40 moved files under `app/(app)/**`, `app/components/ShareLinkModal.tsx` (moved), `app/game/[gameId]/GamePageContent.tsx` (import + safe-bottom), `app/analysis/[gameId]/AnalysisShareModal.tsx` (import). **b:** `app/(app)/layout.tsx`, the chrome edits in `app/(app)/**` per §9.3, `lib/shell/{get-shell-session,shell-user}.ts` + test, `components/shell/chrome-context.tsx`, `app/components/Navbar.tsx` (testid), `app/components/Hero.tsx` (safe-bottom), `ShareLinkModal`/`ChessComConnectModal` a11y attributes, `e2e/specs/shell.spec.ts` | a: P0. b: P0, P4a (runtime: P3 for most e2e items) |
| P5 | Layout primitives, board fill, device × zoom suite | `components/layout/{BoardStage.tsx,ScrollRegion.tsx,board-stage.css}`; `app/components/ChessBoard.tsx`; `app/dev/ui/stage/{page.tsx,demo-data.ts,DemoPlayerBar.tsx,DebugReadout.tsx}`; `app/dev/ui/_sections/layout.tsx`; `e2e/devices/layout/{fixtures,assertions,routes,modes}.ts`, `modes.test.ts`, `{one-viewport,board,resize,ssr,text-zoom,focus,reflow}.spec.ts` | P0 (runtime: P3 for final geometry) |
| P6 | Dev-DB content seed | `prisma/{seed-content,seed-content-plan,seed-guards}.ts` + tests, `prisma/fixtures/design-legend-positions.ts` + test; the guarded dev-DB run | P0 (scripts and `.gitignore` only) |

Placeholders P0 hands over: `components/ui/{avatar,tag,banner,skeleton,empty-state,switch,checkbox,page-header}.tsx` → P1; `components/ui/{tooltip,dialog,sheet,menu}.tsx` → P2; `components/shell/AppShellView.tsx` → P3; `app/dev/ui/_sections/{controls,overlays,shell,layout}.tsx` → P1/P2/P3/P5. Nobody owns `middleware.ts`, `app/components/UserSync.tsx`, `tailwind.config.ts`, `prisma/schema.prisma` or the repo-root `turbo.json`.

---

## Appendix A. Critique dispositions

`C` = `critique-completeness.md`, `F` = `critique-feasibility.md`. **Accepted** points name the section that now covers them. **Rejected** or **changed** points give a one-line reason.

### A.1 Completeness critique

| Point | Disposition |
|---|---|
| C B1 legacy pages clipped / padding lost | Accepted, option A → D15, §2.3, §5.2 `viewport.css`, `globals.css` item 10, §9.3, test §9.5 #12. |
| C B1 option B (`data-rc-flow` wrapper, `main` scroller) | Rejected: it keeps `main` as the scroller, which loses native scroll restoration, iOS status-bar-tap and Safari toolbar collapse; A keeps today's behaviour. |
| C B2 Tournaments/Openings unreachable in rail/tabbar | Accepted → D4, SubNav §8.2, `visibleKeys` reachability test, §8.4 and §9.5 #8. |
| C B3 `toShellSession` not unit-testable | Accepted → §9.3 (pure `summarizeEntitlement` + injected catalog + `now`). |
| C H1 shortcuts fire behind legacy/Clerk modals | Accepted → `MODAL_OPEN_SELECTOR` §8.2; modal attributes §9.2 and §8.1 (IOSInstallModal); test §9.5 #13. |
| C H2 `reloadOnOnline` defeats the chip | Accepted → D18, §5.2 `next.config.js`; checked on prod builds in §12.3 and §12.6. |
| C H3 `theme-color` follows the OS | Accepted → single `themeColor` + `ThemeColorSync` §5.2. |
| C H4 iOS status bar unreadable | Accepted as a decision with a default (`"default"`) → D18, §5.2, U6. |
| C H5 no Back on phone detail routes | Accepted → `backTarget`, TopBar back mode §8.2; tests §8.4 and §9.5 #8. |
| C H6 scroll restoration lost | Resolved by B1-A (the document scrolls), so no sessionStorage restore; a soft regression test is kept at §9.5 #15. |
| C H7 phone toasts over `/game` controls; desktop toasts over the Navbar | Accepted with a different fix → D16: outside the shell toasts keep today's top-centre, so no magic Navbar offsets are needed. |
| C H8 phone toasts drop Undo/Retry | Accepted → text-only only with `[data-rc-controls]` (`toast.css`); action kept at ≥44; tests §7.4. |
| C H9 Clerk/install/shortcuts opened from a Menu/Sheet/palette | Accepted → `useDeferredAction` §8.2; Content forwards `onCloseAutoFocus` §3.5; test §9.5 #14. |
| C H10 single-key shortcuts can't be turned off | Accepted → D20, ShortcutsDialog switch + `prefs.ts` §8.2. |
| C H11 palette on touch contradicts itself | Accepted → the palette renders everywhere; ⌘K everywhere, `/` fine pointers only (D20). |
| C H12 Help/Privacy/Terms unreachable | Accepted → account rows §8.2; route-existence and dead-link tests. |
| C §3.1 Checkbox | Accepted → P1 placeholder contract §3.5, §6.2. |
| C §3.1 InfoButton | Accepted → P2 §7.2. |
| C §3.1 FilterButton/FilterPopover | Accepted → P2 `FilterPopover` §7.2. |
| C §3.1 PageHeader | Accepted → P1 placeholder contract §3.5, §6.2; used by DemoContent. |
| C §3.1 MenuCheckboxItem/MenuRadioItem | Accepted → §3.5, §7.2. |
| C §3.1 CountBadge | Accepted → P0 final §3.6. |
| C §3.1 Tabs overflow | Accepted → §6.2, test §6.4. |
| C §3.1 native Select chevron; Slider thumb | Accepted → §6.2; the round thumb is noted in R16. |
| C §3.1 Sheet grabber implies swipe | Accepted: the grabber is decorative, with no gesture in Phase 1 → §7.2. |
| C §3.1 Avatar `<img>` lint | Accepted → `next/image unoptimized` §6.2. |
| C §3.1 touch feedback (`active:`, tap highlight) | Accepted → §3.6, §6.2, §8.2. |
| C §3.1 forced colours + `prefers-contrast` | Accepted → §6.2, §8.2, `globals.css` item 11. |
| C §3.1 unlayered cursor rule | Accepted → `globals.css` items 7–8. |
| C §3.1 `tap-target` `::after` caveats | Accepted → §3.3; no tap-target on Tabs triggers; toast root without `overflow-hidden`. |
| C §3.1 palette loading/error rows; API shape | Accepted → §8.2 Legends rows, test §8.4. |
| C §3.2 dark-mode test passes; axe both themes | Accepted → `a11y.spec.ts` §5.2; dark checks in §6.4, §7.4, §8.4, §9.5 #5. |
| C §3.2 Clerk theme note; `color-scheme` | Accepted as notes → §5.2 item 11 (don't override `color-scheme`); Clerk already follows `resolvedTheme` (no second provider). |
| C §3.3 timer bar under reduced motion | Accepted → `motion-reduce:hidden` §7.2. |
| C §3.3 spinner freeze; sonner no fade | Accepted as documented behaviour → §3.6 Spinner, §7.2. |
| C §3.3 `scroll-behavior` and `MembershipSection` smooth scroll | Accepted → `globals.css` item 11; §9.3 table. |
| C §3.3 no motion projects | Accepted → `ui-desktop-motion`, `ui-iphone-motion` §5.2. |
| C §3.3 timer pause sync | Accepted → `toast.css` §7.2. |
| C §3.4 OnlineChip placement and safe-top | Accepted → two placements §8.2. |
| C §3.4 hairline under the top bar / safe-top | Accepted → §8.2. |
| C §3.4 toast safe-area offsets | Accepted → `toasterPlacement` §7.2. |
| C §3.4 iPad portrait toast 440px | Accepted → §7.2, test §7.4. |
| C §3.4 legacy CTA bars without safe-bottom | Accepted → `--rc-fixed-pad-bottom` §3.2, §9.3. |
| C §3.4 `viewportFit` global (Hero CTA, `/game` row) | Accepted → §9.1 step 6, §9.2 Hero, M11, R6. |
| C §3.4 menus near the notch | Partly rejected: Radix `collisionPadding` is numeric and can't read `env()` → R15. |
| C §3.5 focus rings clipped on flush items | Accepted → `focus-visible:-outline-offset-2` §6.2, §7.2, §8.2. |
| C §3.5 focus after palette navigation | Accepted → focus `#main` §8.2. |
| C §3.5 stacked modals on ⌘K | Accepted → close shortcuts, then open the palette (§8.2, test §8.4). |
| C §3.5 Radix "Missing Description" | Accepted → `aria-describedby={undefined}` §3.5, test §7.4. |
| C §3.5 one Tooltip provider | Accepted with a different placement: one provider in the root layout (covers the gallery too), not in AppShellView → §3.5, §5.2. |
| C §3.5 gallery `landmark-unique` | Accepted → `previewLabel` §8.2. |
| C §3.6 `repeat`/IME, `e.code`, AltGraph, ⌘K in inputs, collision registry | Accepted → `classifyKeydown`, chord machine, `findCollisions` §8.2, tests §8.4. |
| C §3.6 list sonner Alt+T | Accepted → Everywhere row §8.2. |
| C §3.7 `start_url` `/play` with `id` | Accepted → D18, §5.2, U7. |
| C §3.7 SW per-user caching | Accepted → cache purge on Sign Out §8.2, R10. |
| C §3.7 SW testing hygiene; `.js.map` ignore | Accepted → §12.6 step 3; `.gitignore` §5.2; restore step §12.1. |
| C §3.7 stale entitlement after the billing portal | Accepted → `router.refresh()` on return §8.2. |
| C §3.8 Account disabled until Clerk loads | Accepted → §8.2 table. |
| C §3.8 reuse the sign-out cleanup | Accepted → §8.2 table. |
| C §3.8 chrome can disagree mid-session | Accepted → D2, `chrome-context.tsx` (`MarketingOnly`, `ChromeBox`, `chromeClass`) §9.3; `lib/shell/chrome.ts` dropped. |
| C §3.8 Clerk "Delete account" | Accepted as a note → R13. |
| C §3.9 duplicate toast announcements | Accepted → no `role` on `ToastBody` §7.2. |
| C §3.9 legacy toast coverage | Accepted (no change needed; noted). |
| C §3.9 toast above an open sheet | Fix rejected: moving the toast to 16px still overlaps the sheet's last row; accepted as R14. |
| C §3.9 toast copy periods in legacy game toasts | Accepted as a Phase 2 note; new copy follows the rule (§7.2). |
| C §3.10 soften chip copy to "Offline" | Rejected on desktop, but the design copy "cached pages still work" was replaced (2026-11-12) by "Offline · new pages need a connection": the service worker precaches static assets only (no documents, RSC or `/api`), so no page is cached until Phase 11. Phones use "Offline" per V3iPhoneOffline. The missing fallback page is R9. |
| C §3.10 palette offline row | Accepted → `palette-legends-offline` §8.2. |
| C §4 `/queue` leave cancels the queue | Accepted → M4. |
| C §4 tournaments/tournament Navbar lines missing | Accepted → §9.3 table. |
| C §4 openings/[ref] line numbers wrong | Accepted → §9.3 table (l.78/98/149/314). |
| C §4 profile `loading.tsx` `min-h-screen`; `scroll-mt-24` | Accepted → unlayered `.rc-vs .min-h-screen` override (no `loading.tsx` edit); `chromeClass` on `scroll-mt` §9.3. |
| C §4 404 inside `(app)` loses the shell | Accepted as a note → R11. |
| C §4 stale `.next/types` after the move | Accepted → `npx next typegen` in P4a §9.1 (it regenerates instead of deleting). |
| C §5 demo profile link 404 | Accepted → demo hrefs become `#profile`/`#membership` §8.2. |
| C §5 extend the dead-link crawl | Accepted → §8.4, §9.5 #7. |
| C §5 dev routes fail open | Accepted → D11, `lib/env.ts` §5.2. |
| C §6 ink sweep; DS toast README; accent on selected; phone avatar; palette case | Accepted as sign-off items → S1–S5. |
| C §6 hit targets below 44 | Accepted → `tap-target` on sub links, segments, chips, toast action; constraint in §1. |
| C §6 Android bar heights via `@supports` | Rejected: Playwright WebKit can't confirm iOS `-webkit-touch-callout` support, so the matrix couldn't verify either branch; R7 stays a decision. |
| C §6 payment banner shell-only | Accepted as a note → R12. |
| C §6 "ends today" unreachable | Accepted → the string is dropped; `trialDaysLeft` is documented as ≥ 1 (§3.4, §8.2). |
| C §7.1 axe missing | Accepted → `@axe-core/playwright`, `a11y.ts`, `a11y.spec.ts` §5.2. |
| C §7.2–7.9 test gaps (clip, reachability, modal keys, offline on prod, scroll restore, `/game` toasts, Clerk from sheet, dark and motion) | Accepted → §9.5 #12–#16, §8.4, §7.4, §12.3.4, M4/M9. The `/game` toast check is manual (M4) plus the `toasterPlacement` unit test, because it needs a live game. |
| C §7.10 hydration (server date label, `sessionStorage`, LA time zone) | Accepted → `paymentFailedUntilLabel` §3.4/§9.3; `useSyncExternalStore` §8.2; test §8.4. |
| C §7.11 unit tests (collision, pure catalog, fail-closed) | Accepted → §8.4, §9.5, §5.4. |
| C §8 BoardStage containing-block JSDoc | Accepted → §10.2. |

### A.2 Feasibility critique

| Point | Disposition |
|---|---|
| F B1 tailwind-merge drops the custom utilities | Accepted → `lib/utils.ts` §5.2, tests §5.4, constraint §1. |
| F B2 lint gates can't pass | Accepted → D19, `eslint.config.js`, baseline and `lint-delta.mjs` §5.2, §4.3, §12.2. |
| F B3 `server-only` import; `hasBillingPortal` signal | Accepted → §9.3 (pure module, `dodoCustomerId`). |
| F B4 `overflow-hidden` roots clipped | Accepted as a problem, but the `overflow-x-clip` fix is rejected: under flow mode (D15) the roots aren't stretched, so `overflow-hidden` clips nothing vertically, and keeping the class keeps the marketing output identical. Test §9.5 #12. |
| F B5 `reloadOnOnline`; SW in tests | Accepted → §5.2 `next.config.js`, `serviceWorkers: "block"`. |
| F B6 moves during the parallel phase | Accepted → D17, P4a §9.1, §4.1 step 2. |
| F B7 placeholders too thin; Overline and `use-media-query` contract gaps | Accepted → behaviour-complete placeholders §5.2; `<p className="text-overline">` §7.2; `use-media-query` moved to P0 §3.6; expected-red list §4.4. |
| F B8 a dev server already running with widgets and prod telemetry | Accepted → §4.1 steps 0 and 3 (any `next dev` from this repo on :3000, since the pid may have changed), `devIndicators`, route warm-up. |
| F B9 custom `distDir` rewrites `tsconfig.json`/`next-env.d.ts` | Accepted → `tsconfig.json` includes §5.2; `next typegen` after builds §12.3. The `git diff --exit-code tsconfig.json next.config.js` check is changed to "only P0's include lines", because P0 edits both files on purpose. |
| F M1 Radix Dialog has no `aria-modal` | Accepted → §3.5, §7.2. |
| F M2 Segmented arrows don't select on ToggleGroup | Accepted → Segmented on RadioGroup §6.2. |
| F M3 sonner styling and test assumptions | Accepted → §7.2 (classes only in `classNames.toast`, `--width` style, `font-sans`, `data-visible` counting, `offset` = `mobileOffset`). |
| F M4 `document.fonts.check` proves nothing | Accepted → `document.fonts.load` §5.3. |
| F M5 two coarse definitions; WebKit unverified | Accepted → `COARSE_POINTER_MQ` for tap targets, `COARSE_MQ` for shell modes (§3.3); the P0 probe §4.1 step 4. The alternative `coarse:` variant is not added (no new variant needed). |
| F M6 Tab tests on WebKit | Accepted → Chromium-only keyboard steps in every spec. |
| F M7 legend search contract | Accepted → §8.2, §8.4. |
| F M8 one gallery page couples compiles | Accepted with a different path: `/dev/ui/sections/<id>`, because `/dev/ui/shell` is already P3's demo route → §3.7. |
| F M9 load on the shared server | Accepted → `--workers=2` §4.3. |
| F M10 slots rendered only when passed | Accepted → §3.4 DOM contract; `--topbar`/`--tabbar` zeroed when absent. |
| F M11 `waitForStable` on `networkidle` | Accepted → §5.2 helpers. |
| F M12 D11 fails open | Accepted → D11. |
| F M13 gallery landmarks; forced variant | Accepted → multi-slot `rail:` variant §5.2, `previewLabel` §8.2. |
| F M14 legacy modals undetected | Accepted, merged with C H1 → §8.2. |
| F §4.1 write through the guarded URL | Accepted → §11.2 guard 3. |
| F §4.2 schema column names | Accepted → §11.2 table header, `sideToMove` convention. |
| F §4.3 keep the planner pure (`DB_NULL`) | Accepted → §11.2. |
| F §4.4 atomic apply | Accepted → §11.2 guard 6. |
| F §4.5 column whitelist for `json`/`db` | Accepted → §11.2 CLI. |
| F §4.6 seed affects game specs | Accepted → §11.3 step 7, §12.3.2. |
| F §5 zoom caveats in the config header | Accepted → §5.2. |
| F §6 CSS paths from `import.meta.url`; `copy.test` reads text | Accepted → §5.4, §8.4. |
| F §9 `--save-exact`; `Slot.Root` | Accepted → §5.2, §3.5. |
| F §9 `"use client"` everywhere interactive | Accepted → §1 constraints. |
| F §9 emoji glyph notes | Accepted → §3.11. |
| F §9 grep gate matches comments | Accepted → §1 constraints. |
| F §9 dismissal never from `animationend` | Accepted → §7.2. |
| F §9 R4 correction (`/legends`, `/openings` already dynamic) | Accepted → R4, §9.3 notes. |
| F §9 `scroll-mt-24` cosmetic | Accepted and fixed anyway via `chromeClass` → §9.3. |
| F §9 D3 note (no shell testids on `/game`) | Accepted (no change needed). |
