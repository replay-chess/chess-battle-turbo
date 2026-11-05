# scripts/db

Database runbooks and scripts that are not Prisma migrations. Read `CLAUDE.md` "Database Safety Rules" first:
never `prisma db push`, never `prisma migrate dev` against Neon, and ask the owner before anything destructive.

| File | What | Run by |
|---|---|---|
| `replay-app-role.sql` | Creates the DML-only runtime role `replay_app` (phase-01 plan 1B·F9, audit-db §5.4 DB-17) | the owner, once per Neon branch, after confirming Q-05 |
| `restore-check.sh` | Restores the nightly live-database dump into a throwaway Postgres and checks it (1B·H11) | `backup-live.yml` |

## `replay_app`: the runtime role (1B·F9)

### Why

Today the app connects as the branch owner (`neondb_owner`), which can `DROP`, `TRUNCATE` and run migrations.
On 2026-03-08 a `migrate dev` with an owner URL dropped every table in production. With `replay_app` behind
`DATABASE_URL`, the running app (and anyone who copies its URL) can only read and write rows:

- `SELECT, INSERT, UPDATE, DELETE` on every table in `public`, now and in the future (default privileges for
  the owner role), `USAGE, SELECT` on sequences;
- no `TRUNCATE`, no DDL (`CREATE`/`DROP`/`ALTER`), no access to `_prisma_migrations`;
- no role attributes and no role memberships (in particular not `neon_superuser`);
- `statement_timeout = 15s`, `idle_in_transaction_session_timeout = 30s`, `lock_timeout = 5s`.

`DIRECT_URL` stays the owner role, and only migration tooling uses it (`prisma migrate deploy`, seeds that need
it, the e2e global setup). A mistaken `prisma migrate dev` or `db push` with the runtime URL then fails instead
of resetting the database.

### Where (P1)

Only the Neon **dev** database: today branch `dev` (`br-misty-dew-b8wy3a8w`, endpoint `ep-fancy-dust-b8b3dp81`)
of project `withered-cake-82837167`; after H10 the separate `replay-chess-dev` project. **Not** the `production`
branch (P13 does that, 02-data-model.md §go-live) and never the old project `shy-morning-50748774`. Neon keeps
roles per branch, and a branch created from another inherits its roles.

### Steps (owner; each step is safe to repeat)

1. **Preconditions.** M1 is applied on the target (`prisma migrate status` is clean), so the grants cover
   every current table; later migrations are covered by the default privileges.
2. **Check the target.** Use the owner's *direct* (non-pooler) URL and confirm the host before running anything:

   ```bash
   OWNER_DIRECT_URL='postgresql://neondb_owner:<owner-password>@ep-fancy-dust-b8b3dp81.c-14.us-east-1.aws.neon.tech/neondb?sslmode=require'
   node -e 'const u=new URL(process.argv[1]); if(!/^ep-fancy-dust-b8b3dp81\./.test(u.hostname)) { console.error("not the dev endpoint:", u.hostname); process.exit(1) } console.log("target:", u.hostname, u.pathname, "as", u.username)' "$OWNER_DIRECT_URL"
   ```

3. **Create the role and grants.** Generate the password locally; do not paste it into chat, tickets or git.

   ```bash
   APP_PASSWORD="$(openssl rand -hex 24)"
   psql "$OWNER_DIRECT_URL" -v ON_ERROR_STOP=1 -v app_password="$APP_PASSWORD" -f scripts/db/replay-app-role.sql
   ```

   The script prints eight checks; every `ok` must be `t`. It is idempotent: a second run keeps the password and
   re-applies grants and timeouts (no `app_password` needed then). If Neon rejects the password, generate a
   longer one. Create the role with SQL, not in the Neon console: console- and API-created roles join
   `neon_superuser`, which the "member of no other role" check reports as `f`.

4. **Build the runtime URL.** Same host as the owner's *pooled* URL (`…-pooler…`), user `replay_app`:

   ```
   postgresql://replay_app:<APP_PASSWORD>@ep-fancy-dust-b8b3dp81-pooler.c-14.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require
   ```

5. **Verify as `replay_app`** before switching anything:

   ```bash
   psql "$APP_URL" -Atc 'SELECT current_user'                  # replay_app
   psql "$APP_URL" -Atc 'SELECT count(*) FROM users'           # a number
   psql "$APP_URL" -c 'DROP TABLE users'                       # ERROR: must be owner of table users
   psql "$APP_URL" -c 'TRUNCATE rate_limit_buckets'            # ERROR: permission denied
   ```

6. **Switch** (owner confirms, Q-05): set `DATABASE_URL` on the Vercel project `replay-chess-dev` (all
   environments) to the runtime URL and redeploy; locally, change `DATABASE_URL` in
   `apps/web/.env.development.local` and `apps/web/.env.test`. Leave every `DIRECT_URL` on the owner role.
7. **Acceptance (plan §13.3 1B·F9):** on the dev site `/api/me` answers 200 for a member, a bot game completes,
   and a Dodo test-mode webhook is processed; `DROP TABLE` as `replay_app` fails (step 5). The DB-backed test
   suites (`pnpm --filter web test:int`, `lib/webhooks/record.test.ts`) pass with `TEST_DATABASE_URL` set to a
   `replay_app` URL on a throwaway database, which is how 1B·F9 checked the script.

### Rotate the password

```bash
psql "$OWNER_DIRECT_URL" -c "ALTER ROLE replay_app PASSWORD '$(openssl rand -hex 24)'"   # then update DATABASE_URL everywhere
```

### Roll back

Point `DATABASE_URL` back at the owner URL (Vercel + local env files), redeploy, then optionally:

```sql
DROP OWNED BY replay_app;   -- removes its grants and default privileges (it owns no objects)
DROP ROLE replay_app;
```

### Later

- P3: the analysis worker gets its own role `replay_worker` (`statement_timeout = 60s`), created the same way.
- P13: run this script on the production branch, then switch the production `DATABASE_URL`.
