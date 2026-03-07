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
