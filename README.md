<div align="center">
  <img src="https://github.com/user-attachments/assets/ab28a501-4fea-4ffd-9b90-0da975317073" alt="ReplayChess Demo" width="800" />

  # ReplayChess

  **Master Chess Through Legendary Games**

  Replay iconic positions from the greatest chess games ever played. Inspired by Agadmator's "pause the video, find the best move" format — but interactive, competitive, and real-time.

  [![Live Site](https://img.shields.io/badge/Live-playchess.tech-blue?style=for-the-badge)](https://playchess.tech)

  ![Next.js](https://img.shields.io/badge/Next.js_15-black?style=flat-square&logo=next.js)
  ![React](https://img.shields.io/badge/React_19-61DAFB?style=flat-square&logo=react&logoColor=black)
  ![Socket.IO](https://img.shields.io/badge/Socket.IO-010101?style=flat-square&logo=socket.io)
  ![Prisma](https://img.shields.io/badge/Prisma-2D3748?style=flat-square&logo=prisma)
  ![Tailwind](https://img.shields.io/badge/Tailwind_v4-06B6D4?style=flat-square&logo=tailwindcss&logoColor=white)
  ![Clerk](https://img.shields.io/badge/Clerk-6C47FF?style=flat-square&logo=clerk&logoColor=white)
  ![Stockfish](https://img.shields.io/badge/Stockfish-589636?style=flat-square)
</div>

---

## What is ReplayChess?

Chess history has always been passive — videos, books, databases. You watch a legendary game, but you never *play* it.

ReplayChess changes that. Pick a famous game from chess history, start from the critical position, and try to find the same moves the legend played. Then see how your moves compare in post-game analysis.

- Play as **Bobby Fischer** in his immortal Game of the Century
- Replay **Kasparov vs. Deep Blue** from the decisive position
- Challenge friends to see who plays more like **Tal** under pressure

It's chess meets interactive history, with real-time multiplayer, ELO matchmaking, and browser-side Stockfish analysis.

---

## Features

### Core Gameplay
- **Play as a Legend** — Start from famous historical positions and try to match the legend's moves
- **Play from Openings** — ECO-coded openings encyclopedia; play from any opening position
- **Real-time Multiplayer** — Socket.IO matchmaking with ELO-based pairing and time controls
- **Challenge Friends** — Private invite links for head-to-head games
- **Play the Machine** — Browser-side Stockfish with four difficulty levels (easy, medium, hard, expert)

### Analysis & Learning
- **Post-game Analysis** — Compare your moves vs the legend's, match rate percentage, move-by-move navigation
- **Practice Mode** — Replay from any position against Stockfish after analysis
- **Divergence Detection** — See exactly where your moves diverged from the legend's line

### Content
- **Chess Legends Database** — Grouped by era, playing style, achievements, and famous games
- **Openings Encyclopedia** — ECO-coded (A–E groups), play from any opening position
- **Chess.com Integration** — Import your ratings and stats

### Platform
- **PWA** — Installable on mobile and desktop with offline support
- **Sound Design** — Distinct audio cues for moves, captures, checks, castling, game end, and time warnings
- **Sentry Tracing** — Distributed tracing across web and websocket for full game lifecycle visibility

---

## Tech Stack

| Technology | Version | Role |
|---|---|---|
| **Next.js** | 15.5 | App Router, SSR, API routes |
| **React** | 19.1 | UI with React Compiler (auto-memoization) |
| **Tailwind CSS** | 4.x | Styling |
| **Motion** | 12.x | Animations (framer-motion) |
| **Socket.IO** | 4.8 | Real-time multiplayer |
| **chess.js** | 1.4 | Board logic and move validation |
| **Stockfish.js** | 10.0 | Browser-side AI engine |
| **PostgreSQL + Prisma** | 6.17 | Database and ORM |
| **Clerk** | 6.33 | Authentication |
| **Sentry** | 10.38 | Error tracking and distributed tracing |
| **Zustand** | 5.0 | Client state management |
| **Zod** | 4.1 | Schema validation |
| **Docker** | — | Containerized deployment |

---

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                        Client (Browser)                       │
│  Next.js App (React 19 + Compiler) ──── Stockfish.js (WASM)  │
└───────────────┬──────────────────────────────┬───────────────┘
                │ HTTP/SSR                     │ WebSocket
                ▼                              ▼
┌───────────────────────┐      ┌───────────────────────────────┐
│    apps/web            │ ◄──►│     apps/web-socket            │
│    Next.js 15          │ HTTP│     Express + Socket.IO        │
│    API Routes          │     │     GameManager                │
│    Prisma ORM          │     │     GameSession (per game)     │
│    Clerk Auth          │     │     ClockManager (per game)    │
└───────────┬────────────┘     └───────────────────────────────┘
            │
            ▼
┌───────────────────────┐
│     PostgreSQL         │
│     (Neon / local)     │
└────────────────────────┘
```

**Key design decisions:**
- The WebSocket server is **database-free** — all DB operations go through HTTP calls to the web app
- Matchmaking uses `FOR UPDATE SKIP LOCKED` for lock-free, concurrent queue processing
- React Compiler handles all memoization — no manual `React.memo`, `useMemo`, or `useCallback`

### Socket Event Flow

```
Client                    Server
  │                         │
  ├── join_game ──────────► │
  │                         ├── waiting_for_opponent
  │                         ├── analysis_phase_started
  │                         ├── analysis_tick (countdown)
  │                         ├── game_started
  │                         │
  ├── make_move ──────────► │
  │                         ├── move_made
  │                         ├── clock_update
  │                         │
  ├── resign / offer_draw ► │
  │                         ├── game_over
  │                         │
```

---

## Getting Started

### Prerequisites

- **Node.js** >= 22
- **pnpm** >= 9
- **PostgreSQL** (local or hosted, e.g. Neon)

### Setup

```bash
# Clone
git clone https://github.com/your-username/chess-battle-turbo.git
cd chess-battle-turbo

# Install dependencies
pnpm install

# Set up environment variables (see Environment Variables section below)
cp apps/web-socket/.env.example apps/web-socket/.env
# Create apps/web/.env.local with required variables

# Generate Prisma client and run migrations
pnpm --filter web prisma:generate
pnpm --filter web prisma:migrate:deploy

# Seed the database
pnpm --filter web prisma:seed
pnpm --filter web prisma:seed:openings

# Start development servers
pnpm dev
```

This starts:
- **Web app** on `http://localhost:3000`
- **WebSocket server** on `http://localhost:3002`

### Docker Alternative

```bash
docker-compose up
```

Runs both services with internal networking. The WebSocket server communicates with the web app via Docker's internal network.

---

## Project Structure

```
chess-battle-turbo/
├── apps/
│   ├── web/                          # Next.js 15 application
│   │   ├── app/
│   │   │   ├── page.tsx              # Landing page
│   │   │   ├── play/                 # Game creation (modes, legends, openings)
│   │   │   ├── queue/                # Matchmaking queue
│   │   │   ├── game/[gameId]/        # Live game + sub-components
│   │   │   ├── analysis/[gameId]/    # Post-game analysis
│   │   │   ├── legends/              # Legends database
│   │   │   ├── openings/             # Openings encyclopedia
│   │   │   ├── join/[gameReferenceId]/ # Private game invite
│   │   │   └── api/                  # API routes
│   │   │       ├── chess/            # Game CRUD, moves, AI games
│   │   │       ├── matchmaking/      # Queue management
│   │   │       ├── analysis/         # Post-game analysis data
│   │   │       ├── legends/          # Legends CRUD + search
│   │   │       ├── openings/         # Openings data
│   │   │       ├── chess-positions/  # Historical positions
│   │   │       ├── user/             # User sync, profiles, Chess.com
│   │   │       └── scraper/          # Position import (API key auth)
│   │   ├── components/               # Shared UI components
│   │   ├── lib/
│   │   │   ├── hooks/                # Custom hooks
│   │   │   ├── stores/               # Zustand stores
│   │   │   ├── types/                # TypeScript types
│   │   │   └── prisma.ts             # Prisma singleton
│   │   └── prisma/
│   │       └── schema.prisma         # Database schema
│   │
│   └── web-socket/                   # Socket.IO game server
│       ├── index.ts                  # Express + Socket.IO setup
│       ├── GameManager.ts            # Orchestrates all games
│       ├── GameSession.ts            # Individual game state
│       ├── ClockManager.ts           # Per-game timer management
│       └── types.ts                  # Socket event payloads
│
├── packages/
│   ├── eslint-config/                # Shared ESLint configs
│   ├── typescript-config/            # Shared tsconfig
│   └── ui/                           # Shared component library
│
├── docker-compose.yml
├── turbo.json
└── pnpm-workspace.yaml
```

---

## Environment Variables

### `apps/web/.env.local`

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk publishable key |
| `CLERK_SECRET_KEY` | Clerk secret key |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL` | Sign-in redirect path (e.g. `/sign-in`) |
| `NEXT_PUBLIC_WEBSOCKET_URL` | WebSocket server URL (e.g. `ws://localhost:3002`) |
| `NEXT_PUBLIC_SENTRY_DSN` | Sentry DSN for error tracking |
| `SENTRY_AUTH_TOKEN` | Sentry auth token (build-time, for source maps) |
| `SCRAPER_API_KEY` | API key for `/api/scraper/*` routes |
| `DODO_PAYMENTS_API_KEY` | Dodo Payments API key (billing) |
| `DODO_PAYMENTS_ENVIRONMENT` | `test_mode` or `live_mode` |
| `DODO_PAYMENTS_WEBHOOK_KEY` | Signing secret for `/api/webhook/dodo-payments` |
| `DODO_PAYMENTS_RETURN_URL` | Where Dodo sends users after checkout (e.g. `https://www.playchess.tech/pricing?checkout=success`) |
| `DODO_PRODUCT_ID_MONTHLY` | Player plan, $4.99/month. Create with `pnpm --filter web dodo:setup-products` |
| `DODO_PRODUCT_ID_YEARLY` | Player plan, $50/year. Create with `pnpm --filter web dodo:setup-products` |
| `DODO_LEGACY_PLAYER_PRODUCT_ID` | Original $8/month product, kept so existing subscribers stay active |
| `BILLING_PAYWALL` | `on` (default) requires an active Player plan to play; `off` lets every signed-in user play. See [Billing & paywall](#billing--paywall) |

### `apps/web-socket/.env`

| Variable | Description |
|---|---|
| `PORT` | Server port (default: `3002`) |
| `NODE_ENV` | Environment (`development` / `production`) |
| `WEB_APP_URL` | Web app URL for HTTP API calls (e.g. `http://localhost:3000`) |

---

## Database Schema

Key models in the Prisma schema:

| Model | Purpose |
|---|---|
| `User` | Player accounts (synced from Clerk) |
| `Game` | Game records with FEN, moves, results |
| `Legend` | Chess legends (era, style, achievements, famous games) |
| `Opening` | ECO-coded chess openings |
| `ChessPosition` | Historical positions from legendary games |
| `MatchmakingQueue` | Real-time matchmaking queue |
| `UserStats` | Player statistics and ELO rating |
| `ChessComProfile` | Imported Chess.com ratings |
| `Wallet` | Player wallet balance |
| `Transaction` | Wallet transaction history |

Enums: `GameStatus`, `GameResult`, `MatchmakingStatus`, `TransactionType`, `TransactionStatus`

---

## Billing & paywall

ReplayChess is pay-to-play: signed-in users need an active **Player** plan ($4.99/month or $50/year, billed through [Dodo Payments](https://dodopayments.com)) to create or join games. The catalog lives in `apps/web/lib/billing/plans.ts`; the pricing page is `apps/web/app/pricing`.

### Products

Create the two subscription products once per Dodo environment and copy the printed IDs into your env:

```bash
pnpm --filter web dodo:setup-products            # test mode
pnpm --filter web dodo:setup-products -- --live  # live mode
```

The script is idempotent: it reuses products whose `metadata.replaychess_plan` matches instead of creating duplicates.

### Environment variables

| Variable | Purpose |
|---|---|
| `DODO_PAYMENTS_API_KEY` | Server-side API key |
| `DODO_PAYMENTS_ENVIRONMENT` | `test_mode` or `live_mode` |
| `DODO_PAYMENTS_WEBHOOK_KEY` | Signing secret for `POST /api/webhook/dodo-payments` |
| `DODO_PAYMENTS_RETURN_URL` | Only its origin is used; checkout returns to an allowlisted app path on that origin (`lib/billing/return-url.ts`) |
| `DODO_PRODUCT_ID_MONTHLY` / `DODO_PRODUCT_ID_YEARLY` | Player plan products from `dodo:setup-products` |
| `DODO_LEGACY_PLAYER_PRODUCT_ID` | The original $8/month product, so existing subscribers stay entitled |
| `BILLING_PAYWALL` | `on` (default) enforces the gate; `off` is the kill switch, useful while products are being configured and in CI |

### Entitlement

Subscription state is persisted on the `users` row (`plan`, `planInterval`, `subscriptionId`, `subscriptionStatus`, `subscriptionProductId`, `currentPeriodEnd`, `cancelAtPeriodEnd`, `subscriptionUpdatedAt`, plus `dodoCustomerId`) and is only written through `apps/web/lib/billing/entitlement.ts`. Two sources keep it fresh:

- **Webhook** — `POST /api/webhook/dodo-payments` (signature verified by `@dodopayments/nextjs`). Every `subscription.*` event carries the full subscription and is applied as a snapshot; `shouldApplySnapshot` in `lib/billing/entitlement-rules.ts` ignores stale or out-of-order deliveries, so redeliveries are safe. `payment.succeeded` links the Dodo customer ID to the user by email.
- **API** — `GET /api/subscription` re-reads the subscription from Dodo, persists it, and returns the client summary: `{ entitled, plan, planKey, interval, priceCents, status, subscriptionId, currentPeriodEnd, cancelAtPeriodEnd, customerId?, paywall, subscription? }`.

The rules (`lib/billing/entitlement-rules.ts`, pure and unit-tested) are:

- `active` → entitled.
- `on_hold`, `past_due` → entitled until `currentPeriodEnd` (the customer keeps the time they paid for).
- `cancelled` → entitled until `currentPeriodEnd` only when `cancelAtPeriodEnd` is true (a period-end cancellation). An immediate cancellation is not entitled.
- `pending`, `paused`, `expired`, `failed`, or no subscription → not entitled.

### The 402 contract

Game-starting routes (`/api/chess/create-game`, `/api/chess/create-ai-game`, `/api/chess/join`, `/api/matchmaking/create-match-request`, `/api/tournament/join`, `/api/tournament/find-match`) call `requireSubscribedUser` from `apps/web/lib/auth/require-subscription.ts`. A signed-out caller gets `401`; a signed-in caller without an entitlement gets:

```http
HTTP/1.1 402 Payment Required
{ "error": "An active ReplayChess Player plan is required to play",
  "code": "subscription_required",
  "upgradeUrl": "/pricing?reason=required" }
```

The client treats `code: "subscription_required"` as a redirect to `upgradeUrl`. The gate is bypassed for `BILLING_PAYWALL=off`, internal service calls from the socket server (`INTERNAL_API_SECRET`), the perf-test auth bypass, and users with role `ADMIN`.

### Checkout

`POST /api/checkout` with `{ plan: "monthly" | "yearly", returnPath?, theme? }` creates a Dodo checkout session and returns `{ checkoutUrl, sessionId }` (`401` signed out, `409 already_subscribed`, `503` when the product env var is missing). `returnPath` must be an app path on the allowlist in `lib/billing/return-url.ts`; anything else falls back to `/pricing`. Every checkout returns through `/pricing?redirect_url=<gated path>` (the homepage uses `/play`) so one page owns the activation polling: Dodo appends `checkout=success`, the pricing page polls `GET /api/subscription` until the plan is active, then sends the user on to `redirect_url`. A `409 payment_update_required` is returned when the customer has an on-hold or past-due subscription; the client sends them to `/api/customer-portal` to update the card instead of creating a second subscription.

### Applying the migration

The entitlement columns ship as an additive migration (`prisma/migrations/20260910000000_add_subscription_entitlement`). Apply it with one of:

```bash
pnpm --filter web prisma:migrate:deploy   # prisma migrate deploy: records the migration, never resets
pnpm --filter web exec prisma db push     # additive push when migration history is out of sync
```

**Never run `prisma migrate dev` against a shared database.** It resets the schema when it detects drift and will destroy data (see `CLAUDE.md`).

### Testing

- Unit: `pnpm --filter web test:unit` covers the plan catalog, entitlement rules, and return-URL allowlist.
- E2E: `e2e/specs/pricing.spec.ts` covers the pricing page and paywall banner signed out. The gameplay suites run with `BILLING_PAYWALL=off` because the test accounts hold no subscription; to run them with the paywall on, entitle the fixture accounts first with `npx tsx e2e/scripts/provision-test-users.ts --entitle` (or `E2E_ENTITLE_USERS=true`) against the E2E database.

---

## Deployment

| Component | Platform | Trigger |
|---|---|---|
| **Web** | Vercel | Auto-deploy from `main` |
| **WebSocket** | AWS EC2 | GitHub Actions on `apps/web-socket/**` changes |
| **Database** | Neon PostgreSQL | Managed |

Docker images are available for self-hosting:
- `sasuke0007/replay-chess-web`
- `sasuke0007/replay-chess-websocket`

---

## Scripts Reference

```bash
pnpm dev                              # Run all apps in development
pnpm --filter web dev                 # Web app only (port 3000)
pnpm --filter web-socket dev          # WebSocket server only (port 3002)
pnpm --filter web build               # Production build (runs prisma generate)
pnpm --filter web check-types         # TypeScript type checking
pnpm --filter web lint                # ESLint (zero warnings)
pnpm format                           # Prettier across repo
pnpm --filter web prisma:generate     # Generate Prisma client
pnpm --filter web prisma:migrate:deploy  # Run migrations
pnpm --filter web prisma:seed         # Seed database
pnpm --filter web prisma:seed:openings   # Seed openings data
```

---

<div align="center">

**[playchess.tech](https://playchess.tech)**

Built by [Rohit Pandit](https://github.com/sasuke0007) | [replay-chess](https://github.com/replay-chess)

</div>
