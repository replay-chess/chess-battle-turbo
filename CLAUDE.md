# CLAUDE.md — Project Instructions for Claude Code

## Database Safety Rules (CRITICAL)

### NEVER use `prisma migrate dev` against the production database.
On 2026-03-08 we ran `prisma migrate dev --name add-tournament-description` on a production Neon database that had schema drift (changes applied via `db push` that weren't in the migration history). Prisma detected the drift, **dropped all tables**, and recreated them from scratch — destroying all production data (104 users, 378 games, 3,641 openings, 51 legends, 18 tournaments, and more). The data was recovered from a Neon preview branch snapshot, but it was a close call.

**Rules to prevent this from ever happening again:**

1. **Schema changes on prod/shared databases**: Use `prisma db push` — it applies additive changes without resetting.
2. **`prisma migrate dev`**: ONLY for local development databases that can be safely reset. NEVER on prod, staging, or any database with real data.
3. **`prisma migrate deploy`**: The safe command for applying pending migrations to prod. It never resets.
4. **Syncing migration history**: If migrations are out of sync with the actual schema, use `prisma migrate resolve --applied <name>` to mark them as applied — never `migrate dev`.
5. **Before ANY destructive database command**: Always ask the user for explicit confirmation. State clearly: "This command may reset/drop your database. Are you sure?"

### Neon Database Details
**New account (replaychess007@gmail.com), project `replay-chess` (`withered-cake-82837167`, AWS us-east-1)** — the database Replay Chess is moving to:
- `production` branch (`br-shiny-shape-b8lvr0f5`, default): the future prod database. All migrations applied with `prisma migrate deploy`. Empty of user data until the old prod data is copied over.
- `dev` branch (`br-misty-dew-b8wy3a8w`, child of production): local development and E2E. Seeded with `prisma/seed.ts` and `prisma/opening-seed.ts`. Safe to change; `prisma db push` / `migrate dev` are allowed here only.
- MCP: `neon-replaychess` (local scope, project-scoped API key "claude-code-mcp").

**Old account (pandit.rohit0007@gmail.com), project `chess_battle`** — still serves the live site today:
- Project: `shy-morning-50748774`
- Main branch: `br-still-brook-a5nutqwh`
- Database name: `prisma_migrate_shadow_db_696341e6-c32e-46e7-8f09-b53758dedd0f`
- Data recovery dump: `/tmp/chess_battle_data_fixed.sql` (may not persist across reboots)

## Monorepo Structure
- `apps/web` — Next.js frontend + API routes
- `packages/` — shared packages
- `perf/k6/` — k6 performance tests

## Build & Test
- Build: `pnpm --filter web build`
- Type check: `pnpm --filter web check-types`
- E2E tests: `cd apps/web && set -a && source .env.test && set +a && npx playwright test`
- Perf tests: see `perf/k6/README.md`

## Tech Stack
- Next.js 15 + React 19, Tailwind CSS 4, Prisma ORM, Clerk auth
- React Compiler enabled — no manual memoization needed
- Socket.io for real-time, Zustand for state

## Accounts and browsers
- Service accounts for Replay Chess are owned by **replaychess007@gmail.com**: Clerk, PostHog, Cloudflare (R2), Sentry, Vercel, and the new Neon account. Use **ego-browser** (ego-lite), which is logged in as that account, for any dashboard work on them.
- **Dodo Payments** belongs to the owner's main email (pandit.rohit0007@gmail.com). Use **Claude in Chrome** for the Dodo dashboard.
- Test the app in a browser with **ego-browser**. Playwright (`apps/web/e2e`) is for the automated e2e regression suite.
- When a browser task is done, close what you opened: in ego-browser call `task.finish({ keep: [] })` (or `page.close()` for extra pages); in Claude in Chrome close your tabs. Idle tabs waste memory.

## Local development and testing
- `apps/web/.env.development.local` (gitignored) overrides `.env.local` for `next dev`: the new account's Neon `dev` branch (safe to change), the Clerk development instance, and Dodo **test mode**. Never point local dev at the prod database.
- `apps/web/.env.test` (gitignored) holds the same plus E2E users A–P (members), Q (used its trial in manual testing) and R (non-member, never had a trial; used by the nonMemberPage fixture). Re-create users with `E2E_LETTERS=... npx tsx e2e/scripts/provision-test-users.ts [--entitle]`.
- Signed-out e2e specs only: `E2E_PUBLIC_ONLY=1 npx playwright test`.
- Implementation plan: `docs/implementation-plan.md`.

## MCP servers
- User scope (already connected): `neon` (old main account, live prod project `shy-morning-50748774`), `vercel` (replaychess007), `dodopayments`.
- Local scope: `neon-replaychess` (new account, project `withered-cake-82837167`).
- Project scope (`.mcp.json`): `sentry`, `posthog`, `cloudflare-bindings` (R2), `cloudflare-observability`. They authenticate with OAuth on first use via `/mcp`; sign in as replaychess007@gmail.com.

## Environments
Work happens on the `dev` branch; `main` is production. Test on dev, then merge to main.

| | dev | production |
|---|---|---|
| Web (Vercel, replaychess007) | project `replay-chess-dev`, builds the `dev` branch → https://replay-chess-dev-replaychess007-1069.vercel.app | separate `replay-chess` project for `main` (to be created at go-live) |
| WebSocket (OCI, ap-mumbai-1) | instance `replay-chess-dev` 80.225.200.210 → `wss://ws-dev.80-225-200-210.sslip.io` | instance `replay-chess` 132.226.190.10 → `ws-chess.playchess.tech` |
| Database (Neon, replaychess007) | `dev` branch | `production` branch |
| Clerk | development instance | production instance |
| Dodo | test mode (webhook → dev URL) | live mode |
| Telemetry tag | `NEXT_PUBLIC_APP_ENV` / `APP_ENV` = `dev` | `production` |

- OCI: both instances are VM.Standard.A1.Flex, 1 OCPU / 6 GB, 50 GB boot — inside the Always Free allowance (4 OCPU / 24 GB / 200 GB total). Never resize or add instances beyond that; nothing on Oracle should cost money. The `oci` CLI on this machine is configured (API key) for the tenancy.
- WebSocket deploys: `.github/workflows/deploy-oci.yml` — push to `dev` deploys the dev server (secrets `OCI_DEV_HOST`, `WS_DEV_ENV_FILE`), push to `main` deploys prod (`OCI_HOST`, `WS_ENV_FILE`). SSH: `ssh -i ~/.ssh/oci_deploy deploy@<ip>`.
- DNS for playchess.tech is moving from the old Cloudflare account (pandit.rohit0007) to the replaychess007 Cloudflare account (zone already created, nameservers jacqueline/jimmy.ns.cloudflare.com). Registrar: Hostinger.
