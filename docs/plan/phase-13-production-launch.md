# Phase 13 · Production launch: detailed plan

Status: **final plan (revision 2)**, 2026-11-02, written against branch `dev` @ `0848b76`. Revision 2 folds in the five critiques (`SP/plan/critique-{coverage,consistency,feasibility,testing,api-perf}.md`). Every finding that concerns P13 is either applied in place or rejected with a one-line reason in Appendix A "Critique dispositions". Where a critique conflicted with a phase spec that has already been finalised (P2, P3, P4, P5, P7, P11), this plan follows the finalised spec and says so; where two finalised specs disagree (P2 and P3 on the HMAC wire format), Appendix A.3 hands the fix to them.

Budget in the allocation: **8 dev-days** (allocation §0, §3 P13). This spec measures **11.25 dev-days, plus a 20 % buffer line (2.25 d), plus about 1.25 owner-days**. §13.4 lists the cuts that bring it back to about 8. Boards: **0** (allocation §4.1). Schema step: **M13a** (one enum value), plus the production roll-out of every earlier migration M1 … M12 and the contract pair C3/C3v. Flags: none new; every earlier rollout flag goes to 100 % in production.

**Path shorthands** (as in the other phase specs)

| Short | Path |
|---|---|
| `REPO` | `/Users/rohitpandit/open_source/chess-battle-turbo` |
| `WEB`, `WS`, `WK` | `REPO/apps/web`, `REPO/apps/web-socket`, `REPO/apps/analysis-worker` (P3) |
| `PKG`, `DB`, `CT` | `REPO/packages`, `REPO/packages/db` (schema moved there in P2), `REPO/packages/contracts/src` (imported as `@repo/contracts/{http,socket,internal}/<file>`, consistency R-10) |
| `SP` | `/private/tmp/claude-501/-Users-rohitpandit-open-source-chess-battle-turbo/8433de47-73d2-466e-945c-3c2450748123/scratchpad` |
| `DR` | `SP/design-ref/project/v2` (board files `*.dc.html`) |
| ALLOC, ARCH, DM, API, CDL, OPT | `SP/plan/allocation.md`, `architecture.md`, `data-model.md`, `api-design.md`, `client-data-layer.md`, `optimization.md` |
| ADB, AQ, AS, AA, AC | `SP/plan/audit-db.md`, `audit-quality.md`, `audit-socket.md`, `audit-api.md`, `audit-client.md` |
| P1 … P12 | the phase specs. Finalised ones live in `REPO/docs/plan/` (`phase-02-board-and-live-game.md`, `phase-05-mistake-bank-puzzles-train-and-home.md`, `phase-07-ai-coach.md`, …); the others are `SP/plan/phase-NN.md` until they are finalised. |
| `<vercel.json>` | the `vercel.json` that project `replay-chess` actually reads. Today there is one at `REPO/vercel.json`; P1 §7.8 checks the project's Root Directory and P7 D19 edits whichever file it is. P13 never assumes the path. |

**Facts observed while writing this spec (2026-11-02, read-only checks)**

| Fact | Evidence | Why it matters for P13 |
|---|---|---|
| `www.playchess.tech` is served by Vercel, but **not** by the replaychess007 team. That team (`team_eJNd4yjYgPdxeNoZaO8YZoze`) has exactly one project, `replay-chess-dev` (Node 24.x; `latestDeployment.target = "production"`; no SSO or password protection). The apex `playchess.tech` → 307 → `www`. | `mcp__vercel__list_projects`, `get_project`; `curl -I https://www.playchess.tech` → `server: Vercel`, `x-vercel-id: bom1::…` | The web cutover is a **Vercel domain move between two accounts**, not a DNS change (D2). |
| The live site already takes money (the grandfathered $8 plan) from a project on the old account's **Hobby** plan, which is "non-commercial, personal use only". | feasibility F-VER-1 (Hobby docs, verified) | D17 (Pro before the window) is a hard blocker, not a preference. |
| The zone has `_vercel` TXT records `vc-domain-verify=playchess.tech,…` and `vc-domain-verify=www.playchess.tech,…`, two of each. | `dig @1.1.1.1 _vercel.playchess.tech TXT` | Ownership verification for the move is half-staged. Keep both values (one is needed for a rollback move). |
| `clerk.playchess.tech` → `frontend-api.clerk.services`, `accounts.playchess.tech` → `accounts.clerk.services`, `clk._domainkey` → `dkim1.t0wy2xb4vvpw.clerk.services`, `clkmail` → `mail.t0wy2xb4vvpw.clerk.services`. | `dig` | A Clerk **production instance (id `t0wy2xb4vvpw`) already owns the domain**. Clerk allows one production instance per domain, so a second instance cannot be verified while this one holds it (D1). |
| The Clerk key committed in `REPO/k8s/secrets.yaml` (public repo) is an `sk_test_…` key, i.e. a **development** instance key, not the production instance's. | feasibility SEC-1 (`git` on `dev` HEAD) | P1 H5 rotates it; P13 only verifies the rotation and that no `sk_live_` key was ever committed (§11.2). |
| `playchess.tech` is registered at Hostinger with **auto-renew off; it expires on 2027-02-02**, which is before the planned launch. | `REPO/CLAUDE.md` "Environments"; feasibility fix 1 | A lapse takes down the site, the Clerk production instance and Email Routing. Renewal is a P1 owner task; P13 preflight blocks on it (D21). |
| `ws-chess.playchess.tech` resolves to **44.222.7.147 (AWS)** and answers `{"status":"ok",…}`; the OCI prod box 132.226.190.10 does **not** answer on 80 or 443. | `dig`, `curl` | The live socket is still the old EC2 stack. The OCI prod box must be brought up and the `ws-chess` A record flipped in the window (D3). |
| `media.playchess.tech` has no record. `NEXT_PUBLIC_MEDIA_URL` is unset on `replay-chess-dev`. | `dig`, `mcp__vercel__filter_project_envs` | The R2 custom domain is a P13 prerequisite unless P5/P8 created it earlier (P5 D-17). |
| MX = Cloudflare Email Routing (`route{1,2,3}.mx.cloudflare.net`); DMARC `p=none` with a Cloudflare `rua`; no SPF on the apex; no Resend records. | `dig` | Resend sending-domain records go on `send.playchess.tech` + `resend._domainkey`, so they do not collide with Email Routing (§7.8). |
| Delegation is `jacqueline/jimmy.ns.cloudflare.com` at the `.tech` registry; some resolvers still cache the old `anuj/love` pair. | `dig @ns01.trs-dns.net` | Make every DNS edit in the **replaychess007** Cloudflare zone only; check results with `dig @jacqueline.ns.cloudflare.com`. DNSSEC waits until the old pair has gone (§7.8). |
| OCI tenancy (ap-mumbai-1, AD-1): `replay-chess` 1 OCPU / 6 GB and `replay-chess-dev` 1 OCPU / 6 GB, boot volumes 50 + 50 GB; one VCN `a1-clean-vcn` 10.42.0.0/16 with one public subnet `a1-egress-subnet` 10.42.0.0/24. | `oci compute instance list`, `oci network vcn/subnet list`, `oci bv boot-volume list` | Exactly 2 OCPU / 12 GB / 150 GB of the Always Free pool is left, which is what the prod worker VM needs (D7). After D7 the pool is full: any further growth costs money (Stage C, §14.4). |
| The live site's `sw.js` has `skipWaiting` + `clientsClaim` and 18 Workbox caches (`apis`, `pages`, `pages-rsc`, `pages-rsc-prefetch`, `start-url`, `next-data`, `next-image`, `next-static-js-assets`, `static-{js,style,font,image,audio,video,data}-assets`, `cross-origin`, `google-fonts-{stylesheets,webfonts}`). | `curl https://www.playchess.tech/sw.js` | Every returning browser has an old service worker and old caches; they are evicted on the first visit to the new app (D13). |
| Live sitemaps: `sitemap.xml` 20 URLs, `sitemap-legends.xml` 20 (`/legends/<uuid>`), `sitemap-openings.xml` 3,641 (`/openings/<cuid>`). | `curl` | 3,681 indexed URLs must answer 200 or one 301/308 to a 200 after the switch (§8.7). |
| Vercel Hobby includes 3 WAF custom rules. | feasibility §1 (Hobby docs) | The old project's freeze needs 2 rules (D6); whether Hobby rules can **redirect** is still [V] (Q2). |

---

## 0. Decisions this plan makes (P13-D*)

| # | Decision | Why / source | Overrides |
|---|---|---|---|
| D1 | **Clerk: keep the existing production instance `t0wy2xb4vvpw` (Path T).** Transfer its application into the replaychess007 Clerk workspace with Clerk's "Transfer ownership" (keys, domains, users and settings are unchanged by a transfer). `users.googleId` (the Clerk user id) stays valid, so **no user is re-keyed**, Google sign-in keeps its linked accounts and passwords keep working. The replaychess007 *development* instance (`loving-martin-7959.clerk.accounts.dev`) stays the dev environment. Path N (a brand-new production instance, user import with `external_id`, email relink on first sign-in) is the fallback only if the owner cannot transfer or reuse the app (OD-1). | The domain already belongs to that instance (facts table); Clerk refuses a second production instance on the same domain; a transfer "does not cause disruptions; API keys, settings, domains and other configurations remain unchanged" ([Clerk: transferring your app](https://clerk.com/docs/guides/transferring-your-app)) | ALLOC P13 item 3 ("existing users get new Clerk ids"), DM §12.1 step 11 |
| D2 | **Web cutover = move `www.playchess.tech` and `playchess.tech` from the old Vercel account's project to the new `replay-chess` project** (Vercel ownership verification by the `_vercel` TXT record), done with the Vercel MCP (`add_project_domain`, `verify_project_domain`) or the dashboard. The A/CNAME records stay on Vercel's anycast addresses. Rollback is the reverse move from the old account (rehearsed, §8.9). [V: the move mechanics are proven on `next.playchess.tech` in R#2 before they are used on `www`] | Both projects sit behind the same Vercel edge; Vercel routes by host | ALLOC P13 window step 5 ("apex and `www` → the new Vercel project" as a DNS edit) |
| D3 | **Socket hostname stays `ws-chess.playchess.tech`.** A second name, `ws-next.playchess.tech` → 132.226.190.10, is added at T−10 d for rehearsals and removed at T+30 d. In the window, the `ws-chess` A record flips from 44.222.7.147 to 132.226.190.10 (DNS only, TTL 60 s), then Caddy is restarted so it obtains the certificate at once. | `NEXT_PUBLIC_WEBSOCKET_URL` (ARCH X17), CSP `connect-src` (ARCH §3.2.5) and CLAUDE.md already name `ws-chess` | — |
| D4 | **A production-identical staging lane: `next.playchess.tech`.** It is a domain of the **production** Vercel project `replay-chess`, assigned to the Git branch `launch` (Preview), with branch-scoped Preview env vars: the production Clerk keys (a production instance accepts subdomains of its domain), Dodo **test** keys, the rehearsal Neon branch, `wss://ws-next.playchess.tech`. Middleware lets only admins and an allow-list of Clerk user ids in (§7.1 R3); every response carries `X-Robots-Tag: noindex`. [V: Clerk sessions on a subdomain of the production domain are checked on day 1 of R#1; if they do not work, signed-in checks move to the window's admin smoke behind the maintenance gate (§8.3 step 15) and the lane is used for signed-out checks only] | Clerk production keys only work on `playchess.tech` and its subdomains, so a `*.vercel.app` URL cannot test sign-in; the owner must test with real accounts and real data before the window | — |
| D5 | **Data path:** the old data is restored **data-only** into `production` while it is still at migration 17, then `prisma migrate deploy` applies M1 … M12 (+ C3/C3v), then the ordered backfills run (§6.5). If the old schema has drift that the data-only `COPY` cannot load, the dump goes through a local Docker "transit" Postgres 17 first (§8.4). | DM §12.1; `pg_restore --data-only` writes explicit column lists, so a target that is a superset of the old schema loads cleanly | — |
| D6 | **Freeze of the old site without code:** two Vercel Firewall custom rules on the old project (deny `/api/*`, redirect documents to `https://status.playchess.tech`). Hobby includes 3 custom rules; if Hobby rules cannot redirect (Q2), the second rule becomes a deny and the status page is announced by email instead. Dodo deliveries that hit the deny are retried by Dodo and land on the new app after the domain move. A hotfix on `main` is the last fallback. | No deploy of legacy code in the window; reversible in seconds | DM §12.1 step 3 ("maintenance mode on the old site", which the old code does not have) |
| D7 | **Prod analysis worker on its own VM `replay-chess-worker`** (VM.Standard.A1.Flex, 2 OCPU / 12 GB / 50 GB boot, private IP 10.42.0.30 in `a1-egress-subnet`, ephemeral public IP for egress only). It has no public ingress except SSH; web reaches it through the socket box's Caddy over the VCN; it reaches the socket's `/internal/emit` over the VCN. Totals: 4 OCPU / 24 GB / 150 GB of 4 / 24 / 200, so the free pool is full. **There is no Stage B** (ARCH §1.8.3 resize) after D7; growth beyond it is **Stage C (paid)**, with triggers and prices in §14.4, and needs the owner's yes. If the owner took feasibility F-OCI-5's option and the VM was created in P3 to host the dev worker, P13 re-points that VM to production instead of creating it (OD-22). | ALLOC §1.5, OPT D11, P3 ("prod: its own A1 VM, created in P13"); feasibility F-OCI-1 and F-OCI-3; the 1-OCPU socket box keeps the clocks | ARCH X1 (co-location on prod) and ARCH §1.8.3 (Stage B) |
| D8 | **Production migrations only with `prisma migrate deploy`** (CLAUDE.md rule 3), run once by the launch runner in the window and afterwards by `release-prod.yml` behind the GitHub `production` environment approval. Runtime roles cannot run DDL. **No `prisma db push` against any Neon branch** (consistency R-20: it drops the hand-written partial indexes and `UNLOGGED` storage). CLAUDE.md rule 1 is reworded accordingly (OD-13). | ADB §4.2, DM §11.1, ARCH §4.6, consistency R-20 | CLAUDE.md rule 1 wording |
| D9 | **Backups:** the prod worker's `BACKUP` job streams `pg_dump -Fc` (role `replay_backup`) through `age` to R2 `replay-backups/neon/production/daily/YYYY-MM-DD.dump.age` every day at **21:00 UTC** (02:30 IST), the same minute as P3's `HOUSEKEEPING` (P3-D22), so both run in one drain and one Neon wake (api-perf AP-08). Its next row comes from a P13 slice in P3's `WK/src/scheduler/recurring/` directory, collected by `DAILY_PLAN`. On Sundays it also writes `weekly/YYYY-Www.dump.age` by server-side copy. Retention **14 daily + 2 weekly**, so nothing is older than 28 days. The R2 token is an Object R/W token scoped to `replay-backups`, and an R2 bucket-lock rule (14 d daily, 28 d weekly) stops a compromised worker from deleting copies early [V availability]. `BACKUP` is **disabled on dev** (`BACKUP_ENABLED=false`); a manual run on dev writes to `replay-backups-dev`. | ARCH §2.3.9 and D14; P3-D22; P10 Q12 ("Backups clear within 30 days" must be true); feasibility F-NEON-5, SEC-7 | ALLOC P13 and DM §10.4 (8 weekly copies, up to 56 days); ARCH §2.4 (`BACKUP` on a 20:00 `HOURLY_TICK`) |
| D10 | **Every rollout flag is 100 % in production at launch.** The registry defaults get `production: true`, the PostHog flags get a 100 % `app_env = production` condition, kill switches get their production values (§7.10). Flag code is removed one release later (ALLOC §1.6). | Each phase deleted its legacy screens after parity (ALLOC §1.1 item 2), so a flag that is off in production would only hide finished features | P1 `shell-v3` "off in production until P13" |
| D11 | **Monitoring stack:** Sentry (errors, traces, metrics, alert rules; cron monitors for P3's daily `housekeeping` check-in and P13's `worker-backup`), UptimeRobot free (5-minute HTTP monitors and the public status page `status.playchess.tech`) and **SQL freshness checks in the daily cron** for the backup and the queue (no third heartbeat vendor). Alert rules are created by scripts so dev and prod match (§10). UptimeRobot's free-plan commercial terms are [V]; if they forbid this use, the fallback is Better Stack free (monitors + status page with a custom domain) or Sentry Uptime for the monitors and Upptime on GitHub Pages for the page (OD-9). | ARCH §3.4.4, OPT §9.8; P3-D22 (no `HOURLY_TICK`); feasibility §2.5 | consistency 13.7 (`HOURLY_TICK` check-in) |
| D12 | **Rollback ladder R0–R4** with a declared point of no return: the first real charge on the new stack or T+72 h, whichever comes first (OD-11). Before it, a full return to the old stack is rehearsed and takes ≤ 15 minutes; after it, only forward fixes and the in-stack rollbacks (Vercel, image tags, the emergency service worker, Neon restore). | ALLOC P13 "rehearsed rollback" | ALLOC "within 72 h DNS can go back" (the web is not a DNS switch, D2) |
| D13 | **Legacy browsers are evicted, not tolerated:** the new service worker deletes the 18 legacy caches and activates at once when it finds them; `lib/storage/migrate.ts` (CDL §6.5) deletes the old Zustand keys; the old client's API calls get **410 `gone`** tombstones for 30 days so they fail fast and quietly (§7.1 R4). | Old `sw.js` with `skipWaiting` + 18 caches (facts table); P11 D11 keeps `skipWaiting: false` for normal updates | P11 D11 for the one legacy upgrade only |
| D14 | **Legacy games are analysed only for entitled users**, at `JOB_PRIORITY.BACKLOG` (consistency R-05), newest first, capped by the P4 D4-09 budget: 50 for members (including the grandfathered $8 plan), 20 for trialists. Everyone else's games are analysed on first open (P3 A1, `JOB_PRIORITY.USER_OPENED`). | 378 games × ≈ 40 s / 2 lanes ≈ 2 h of worker time if all; the same budget rule as imports keeps the worker inside its ceiling (feasibility F-OCI-3) | P3 ("prod's old games: P13, priority 10, newest first") |
| D15 | **Launch emails go through Resend from `hello@playchess.tech`, ≤ 70 a day, counted in P10's durable daily email budget**, so P10's 20-a-day transactional reserve (trial reminders, payment failed) is never starved (feasibility §2.5, F-NEON-3). Two days per campaign for the 104+ users. With Resend Pro for the launch month (OD-20), the cap becomes 500 a day and each campaign goes out in one run. | Resend free: 100 a day, 3,000 a month [V] | — |
| D16 | **Neon Launch for the production project** before the window, with a spend alert and the **instant-restore (history) window set explicitly to 7 days** ($0.20 per GB-month). Dev and E2E already run in their own Free project since P1 (1B·H10, api-perf AP-01, feasibility F-NEON-1); P13 only verifies that, and runs the split itself (§6.7) only if P1 slipped. | ADB DB-01/§10.3: the Free 100 CU-h runs out with real traffic, which suspends the site; "restore to a new branch from history" (ARCH §4.7) is only useful if the window exists (feasibility F-NEON-5) | DM §10.3 ("ship on Free"); P13 rev 1 (dev split at T−14 d) |
| D17 | **Vercel Pro** for the replaychess007 team before the window, with Skew Protection and a spend cap. **Hard blocker:** preflight fails while the team is on Hobby and Dodo live keys are set (feasibility F-VER-1, LIC-1). The dev project may stay on Hobby (test mode, no real charges). | AQ PLAT-01 (Hobby is non-commercial); ARCH D1 | — |
| D18 | **OCI tenancy on Pay-As-You-Go with a $1 budget alert and compartment quotas** that cap A1 at 4 OCPU / 24 GB and zero every other shape, so idle reclamation cannot take the mostly idle worker VM and nothing can cost money. This is a **P1 owner task** (feasibility F-OCI-5, P2 Q13); P13 verifies it in preflight and does it only if it was skipped. | ARCH §1.8.4 (idle reclamation of Always Free instances); CLAUDE.md "nothing on Oracle should cost money" | P13 rev 1 (PAYG at launch) |
| D19 | **Internal service auth is the HMAC helper in `CT/internal/auth.ts`, with separate production keys per caller.** P2 ships the helper (`x-rc-kid` / `x-rc-ts` / `x-rc-sig`, key sets in the one env var `INTERNAL_API_SECRET` as `kid:base64[,kid:base64]`, per-kid path and event allow-lists, a 2-minute replay set, a Caddy pre-check that refuses unsigned `/internal/*` and `/engine/*`). P3 rev 2 describes the same file with an `x-rc-caller` header and per-caller keys derived from one root, and defers "separate per-caller secrets and rotation" to P13 (P3-Q16). Before launch the two must be one wire format (handoff H13-6: P2's, because it ships first; P3's caller names become the kids). P13 then delivers P3-Q16: production has **fresh, separate** keys for the four callers `web` (Vercel), `ops` (the signing CLI inside the containers), `worker` (worker → socket; P2 writes `wk`) and `socket` (socket → worker kicks), and each service holds only the keys it signs with or accepts (§7.9). The static-token compatibility switch `INTERNAL_TOKEN_COMPAT` (P3) is absent in production. | P2 §0.2 / §7.5.1; P3-D21, P3-Q16; feasibility SEC-4, SEC-8; api-perf AP-44 | consistency R-08 (static `x-internal-token`); P13 rev 1 (`INTERNAL_HMAC_SECRET` / `RC_INTERNAL_KEYS` aliases) |
| D20 | **Three launch variants, one runbook.** *Full* (P1–P12), *Early* (without P12, ALLOC M5) and *Launch A* (P1–P5, P7, a thin P10 and a thin P11; feasibility §8). §2.4 lists, per variant, which migrations, backfills, flags, URL expectations and smoke rows apply. The variant is fixed at T−21 d (OD-21) and recorded in `REPO/launch/variant.json`, which `preflight.ts`, `backfill-all.ts`, `url-parity.ts` and the smoke specs read. | ALLOC M5; feasibility fix 15 | P13 rev 1 (early launch only) |
| D21 | **The domain is renewed for at least 2 years, with auto-renew on, the registrar lock on and 2FA on the Hostinger account, before T−21 d** (a P1 owner task, feasibility fix 1). Preflight P0 fails otherwise. A transfer to Cloudflare Registrar is optional and never inside T−30 d … T+30 d (OD-23). | expiry 2027-02-02 with auto-renew off (facts table) | — |
| D22 | **The enum two-release rule at launch** (feasibility §9 rule 1, P5 §6): production receives every enum value with the launch SHA, and no production image older than the launch SHA ever exists, so rollbacks inside the new stack (R2, R3) always land on images that know every value. Preflight asserts that `deploy-oci.yml`'s production rollback targets and Vercel's production deployments are all ≥ the launch SHA's migration head. From launch + 1, `release-prod.yml` enforces the rule (§7.11). | feasibility §9, 10.19 item 7 | — |

---

## 1. Goal and user-visible outcome

**Goal.** `https://www.playchess.tech` serves the new coaching app on the replaychess007 accounts (Vercel `replay-chess`, Neon `withered-cake-82837167/production`, the transferred Clerk production instance, Dodo live, OCI socket 132.226.190.10 and worker 10.42.0.30), with every row of the old production database migrated and upgraded, monitoring and alerting live, encrypted nightly backups with a tested restore, and a rollback that has been rehearsed end to end.

**What users see.**

- Returning users sign in with the same Google account or password as before and land in the new app. Members (including the grandfathered $8 "Player" subscribers) see their old games in `/games`, their Chess.com link in Settings › Connected accounts, their username on `/@username` and a Home that fills as the worker analyses their newest games. Non-members land on onboarding and the 7-day trial.
- New visitors get the P11 marketing site; sign-up, the trial checkout in Dodo **live** mode, import, review, bank, train, coach, play, tournaments, all on the same domain. Under the Early and Launch A variants (§2.4) the surfaces those variants leave out stay on their legacy pages inside the v3 shell.
- During the window (≤ 60 minutes planned, 90 budgeted) old-site visitors are sent to `status.playchess.tech` ("Replay Chess is moving to its new coaching app"); after the domain moves, signed-in non-admin visitors of app routes see `V3Maintenance` until the owner opens the gate. Marketing pages stay up throughout.
- Old bookmarks keep working: `/analysis/*` → `/review/*`, `/profile/*` → `/@username`, `/try/*` → `/pricing`, `/legends/<uuid>` and `/openings/<cuid>` → their slug URLs (or unchanged under Launch A), all as single 301/308 hops.

**Owner test at the end of P13** (production, ego-browser as replaychess007 for the dashboards, Claude in Chrome for Dodo and the old Vercel account, then a real iPhone and a real Android phone):

1. `https://www.playchess.tech/api/health` shows `env: "production"` and `buildId` = the launch SHA; `https://ws-chess.playchess.tech/ready` shows `ready: true` and `https://ws-chess.playchess.tech/worker/ready` answers 200; `status.playchess.tech` is green.
2. Sign in with the owner's existing Google account: `/home` loads in the v3 shell; `/games` lists the owner's pre-launch games (the same count as the old profile page); open one → Review starts analysing and shows badges.
3. `/admin` shows Users ≥ 104, Games ≥ 378, Positions 3,641, Legends 51, Tournaments 18 (the same numbers `V4Admin` was drawn with), and the activity feed has a "System · Nightly backup OK" row the morning after launch.
4. Start the Coaching monthly trial with a real card, see `/checkout/activating` turn into "Trial · 7 days left"; Claude moves the subscription's first billing date to now (Dodo live API), the $4.99 charge appears in the Dodo dashboard and the membership screen shows the active plan; refund it in the Dodo dashboard and watch the membership screen change within a minute (webhook). Start a trial on the smoke account with the same card and cancel it at once: the membership screen says "Trial ends on <date>. You won't be charged."
5. Play a rated friend game between the two accounts on phone and desktop; restart the socket from GitHub Actions mid-game (`deploy-oci.yml`, production, same tag): the game resumes.
6. Open five old URLs from Google results (an `/openings/<cuid>`, a `/legends/<uuid>`, `/analysis/<id>`, `/profile/<ref>`, `/try/x`): each lands on the right new page in one redirect.
7. Rollback was rehearsed: the launch report `REPO/launch/reports/rehearsal-2.json` shows the timed domain move back and forth on `next.playchess.tech`, the `ws-next` DNS flip, a Vercel instant rollback, an OCI image rollback with a journal-compatible restore, the emergency service-worker build, and a Neon snapshot restore, each within its budget (§8.9).
8. A restore drill from the first nightly backup into a scratch branch passed (`REPO/launch/reports/restore-drill-<date>.json`); the P1 interim backup workflow is disabled; `/tmp/chess_battle_data_fixed.sql` is gone from CLAUDE.md, and CLAUDE.md in the public repo holds rules only.
9. PostHog's "Launch hypercare" dashboard shows production events only (`app_env = production`, internal and synthetic users excluded), and the RDAP record for `playchess.tech` shows an expiry at least two years out with the registrar lock on.

---

## 2. Scope

### 2.1 In scope

| Area | Items |
|---|---|
| Accounts and plans | Vercel Pro (D17); Neon Launch for the production project with the 7-day history window (D16); Clerk app transfer and production instance settings (D1); Dodo live readiness: KYC check, live products, live webhook, return URLs; Anthropic production workspaces and spend limits (P7 OQ6, OQ10); Resend domain verification (P11 Q19) and the Resend plan decision (OD-20); R2 production buckets, lifecycle and bucket-lock rules, the `media.playchess.tech` custom domain and its response-header Transform Rule; Vercel Edge Config store `replay-ops` (production); Sentry projects and alert rules; PostHog production flags, dashboards and the internal-users filter; UptimeRobot monitors and status page (or the D11 fallback); a Cloudflare API token scoped to DNS edits on the zone. **Verified, not done, by P13** (P1 owner tasks): domain renewal and lock (D21), OCI PAYG and quotas (D18), the dev/E2E Neon project (D16), `CLAUDE.local.md` (SEC-2) |
| Infrastructure | Vercel project `replay-chess` (production branch `main`, Preview branch `launch` for `next.playchess.tech`); OCI prod socket box brought up with protocol v2, the HMAC kids and the Caddy allow-list; OCI worker VM created (or re-pointed, OD-22) and deployed; private VCN paths between them; DNS records (§7.8) |
| Data | Old-DB probe and drift check; rehearsals on child branches of `production`; final dump; data-only restore; `migrate deploy` of every migration up to the launch SHA; Postgres roles and grants (`replay_app`, `replay_realtime`, `replay_worker`, `replay_backup`) and `pg_stat_statements` on production; the ordered backfills from P1–P12 plus three P13 scripts; Clerk claims sync; Dodo reconcile; PostHog alias; legacy-game analysis enqueue |
| Code | `M13a` (`JobKind.BACKUP`); the worker `BACKUP` handler and its planner slice in P3's `WK/src/scheduler/recurring/`; the daily-cron `ops-freshness` task; middleware for the `next.` lane, canonical hosts and legacy tombstones; the service-worker legacy eviction; `/api/health?deep=1` reporting the schema head; the Caddy `/worker/ready` route; launch scripts in `WEB/scripts/launch/` and ops scripts in `REPO/scripts/ops/`; `release-prod.yml` with the enum and journal gates; the `deploy-oci.yml` production split (socket box + worker VM); the production extension of P1's `ops-weekly.yml`; `prod-smoke-schedule.yml`; Node 24 in the remaining workflows; a production smoke Playwright config |
| Ops | Window runbook, rollback runbook (including the emergency service worker), restore runbook, incident runbook; hypercare (T+0 … T+14 d); retirement of the P1 interim backup workflow and of the old stack after 30 stable days with owner confirmation |
| SEO and comms | URL parity check against the 3,681 live sitemap URLs; sitemaps submitted in Google Search Console; IndexNow `scope=all`; launch emails; status page announcements |
| Legal and licences (checks) | Final legal texts (OD-16); Chess.com User Agreement review (P4 OD-2, feasibility F-API-4); the third-party asset audit (feasibility LIC-5, LIC-6); the Stockfish GPL files P2 ships (LIC-2) |
| Docs | CLAUDE.md rules and `CLAUDE.local.md` environments (OD-13), `docs/implementation-plan.md`, `docs/runbooks/*.md`, `docs/qa/phase-13-signoff.md`, deletion of the AWS/Amplify/EC2 leftovers |

### 2.2 Explicitly out of scope

- Any new product screen or feature. P13 builds no board; it only operates P11's `V3Maintenance` and adds rows to P12's `V4Admin` activity feed.
- Contract migrations other than C3/C3v: C1 (P13 + 30 d), C2 (one release after `play-hub-v3` is at 100 % in production, P9 D19), C4, C5, C12 (P13 + 1 release), C6/C7 (later). Each one is a separate owner-confirmed release after launch (§6.6). Their migration folders must **not** be in `DB/prisma/migrations` at the launch SHA.
- Removing flag code (P13 + 1 release).
- Any paid OCI shape (Stage C, §14.4) without the owner's explicit yes. Stage B no longer exists (D7).
- Load tests against production (k6 stays on dev, OPT §9.6), except the pre-launch runs against the not-yet-live prod OCI boxes on the rehearsal branch (§9.5).
- A custom status page (a hosted one is used, OD-9) and paid uptime features.
- Writing the legal texts: P13 only blocks the launch until the owner's final text is in (P11 R11, OD-16).
- The P1 items P13 verifies: the dev Neon project, OCI PAYG, the domain renewal, `ops-weekly.yml`, `nightly.yml`, the test tooling (testing §4). If one is missing at T−21 d, the WP that needs it does it first and the slip is recorded in the sign-off.

### 2.3 Dependencies on earlier phases

| Phase | What P13 needs | If it is missing on launch day |
|---|---|---|
| P1 | Route wrapper, envelope, `getViewer()`, middleware claims gate with the `MIDDLEWARE_MEMBER_GATE` switch, `/api/health`, `/api/cron/daily` (task registry, ideally `lib/cron/tasks/<task>.ts` + an ordered array, feasibility §7), Clerk webhook, `scripts/backfill/sync-clerk-claims.ts`, the flag registry, `ci.yml`, `nightly.yml`, `post-deploy-dev.yml`, `lib/storage/migrate.ts`, roles SQL for `replay_app`; the test tools of testing §4 (unified globs and `check-test-globs`, the test-hook registry and `prod-guard.spec.ts`, `quarantine.json`, the telemetry sink, k6 result files); **owner tasks** 1B·H10 (dev Neon project), PAYG + quotas (D18), the domain renewal (D21), `CLAUDE.local.md`; 1B·H11 (the interim nightly backup of the live database, api-perf DB-02); `ops-weekly.yml` (feasibility F-VER-2, api-perf AP-01) | No launch |
| P2 | Socket v2 with direct Neon writes (`replay_realtime`), journal volume with a format version, drain, `/ready` `{ ready, draining, restored, outboxOldestMs, dbOkAt }`, `server:restarting { restartAt, resumes }`, the HMAC helper and kids, the signing CLI `dist/cli/internal.js`, the Caddy pre-check, `ws.persist.reconnect` vs `ws.persist.fail`; `backfill-play-columns.ts` (B1 + B2); `deploy-oci.yml` drain step and `image_tag` input | No launch |
| P3 | Worker image, queue (`Job.fairSeq`, `Job.lastKickAt`, `jobs_ready_idx`), `JOB_PRIORITY` in `CT/internal/jobs.ts` (re-exported by `DB/src/jobs.ts`), the daily `HOUSEKEEPING` at 21:00 UTC with `DAILY_PLAN` and the `WK/src/scheduler/recurring/` slice directory (P3-D22, no `HOURLY_TICK`), its Sentry check-in `housekeeping`, the signed `/internal/analysis/kick`, worker `GET /ready` without a DB call, `game_analyses."readyMs"` and `worker.review_ready_ms`, the cron task `worker-alive.ts`; `opening-epd.ts`, `enqueue-analysis.ts`; `replay_worker` grants | No launch |
| P4 | Onboarding and checkout with the live trial; `/checkout/activating`; the D4-09 analysis budget; `AuditLog` (M4, consistency R-04) and `WEB/lib/audit.ts`; `HASH_PEPPER`; B5, B6, B9, B12; P4 OD-2 cleared for Chess.com terms | No launch (chargeable core, ALLOC M2) |
| P5 | Mistake Bank, puzzles (R2 shards `puzzles/v1/**` uploaded to the **production** media bucket), Train, Home; `enqueue-mistake-extraction.ts` (B-M5-1) | No launch (chargeable core) |
| P6, P7 | Weakness (`WEAKNESS_JOBS_ENABLED`), coach (Anthropic prod keys, `CT/limits.ts` caps, the member-scaled breaker, `supportsCancellation` on the two streaming routes) | P7: no launch (Launch A keeps it). P6: launch possible with its kill switch off and the flag absent (Launch A) |
| P8 | Catalogue slugs and the cuid/uuid → slug 308s, B3, B4, B11, J7, J8, sitemaps | Full/Early: no launch (SEO regression). Launch A: the legacy legend and opening pages stay; their URLs stay 200 and the 308s ship after launch (§2.4) |
| P9 | Socket matchmaking, challenges, ratings, `seed-player-ratings.ts` | Full/Early: no launch. Launch A: the legacy play hub stays in the shell |
| P10 | Account area (thin under Launch A), the trial-reminder backstop in the daily cron, the durable daily email budget (F-NEON-3), B8, B12, B13, B14, contract C3/C3v | No launch |
| P11 | Marketing site, auth flows (or the prebuilt Clerk pages behind `auth_custom_flows` under Launch A), maintenance gate with the adaptive memo, `notice:set` / `notice:clear` CLI (`scripts/system/notice.ts`) and `ops-broadcast.yml`, SW rewrite (`WEB/worker/index.ts`) with the `SW_KILL_SWITCH` emergency build, consent, legal page templates | No launch (the window needs the maintenance gate) |
| P12 | Tournaments v3 + admin (`V4Admin` activity feed from `audit_logs`, `/api/admin/health`), B7 | **Early** and **Launch A** variants: launch without P12; skip M12/B7; the legacy tournament pages stay in the shell; `/admin` is the legacy admin behind `requireAdmin()`. `audit_logs` still exists (M4), so P13's audit rows are written either way |

### 2.4 Launch variants (D20)

| Item | Full | Early (no P12) | Launch A |
|---|---|---|---|
| Phases on the launch SHA | P1–P12 | P1–P11 | P1–P5, P7, thin P10 (membership, plan switch, cancel, delete, export, connected accounts), thin P11 (pricing, legal, prebuilt Clerk auth behind `auth_custom_flows`, error and maintenance pages) |
| Migrations (§6.2) | rows 1–16 | rows 1–14, 16 | rows 1–7, 9, the thin-P10 subset of row 12 + C3/C3v (row 13), the P11 subset of row 14, row 16 |
| Backfills (§6.5) | all | all but 12 | 1–6, 11 (only the scripts the thin P10 ships), 13, 14, 15 (the P5 part only), 17–19 |
| Flags at 100 % (§7.10) | all | all but `tournaments-v3`, `admin-v3` | `shell-v3`, `live-protocol-v2`, `game-v3`, `review-v3`, `import-v3`, `onboarding-v3`, `train`, `home`, `coach`, `account-v3`; the others do not exist yet |
| URL parity (§8.7) | uuid/cuid → slug 308s | same | catalogue URLs stay **200 on the same path** (class `ok`); the 308s ship with P8 after launch |
| Smoke rows (§4 S6, §12.3) | all | without `/tournaments` v3 | without `/weakness`, `/learn/*`, `/play` v3, `/tournaments` v3; legacy pages checked for 200 and the one-viewport fixture only where they have a board |
| `/admin` | `V4Admin` | legacy admin | legacy admin |

---

## 3. Current code touched

Line numbers are for `dev` @ `0848b76`. Files that earlier phases rewrite are listed with the phase that owns the rewrite; P13 edits only the lines named in the "P13 change" column.

### 3.1 Web app (`WEB`)

| File (today) | What it does today | Fate in P13 | P13 change |
|---|---|---|---|
| `WEB/middleware.ts` (46 lines; rewritten by P1 1B and P11 §7.4) | Clerk middleware, protected-route list `:16-26`, matcher `:41-45` | **Rework (small)** | Three early steps before P11's maintenance gate: `prelaunchGate()` for host `next.playchess.tech`, `nonCanonicalNoindex()` for any host other than `www.playchess.tech`, and `legacyTombstone()` for the old client's API paths (§7.1 R3–R5). If P1 froze middleware code and moved route classes into `lib/routes/classes/<area>.ts` (feasibility §7), P13 adds `lib/routes/classes/launch.ts` instead of editing `middleware.ts`. No change to the P1 claims matrix. Middleware budget stays ≤ 100 kB (ARCH §4.3) |
| `WEB/next.config.js:82-88` | `has: host playchess.tech` → 308 to `www` | **Keep** | The Vercel domain setting also redirects the apex (308); both agree |
| `WEB/next.config.js:90-91` | `/try`, `/try/*` → `/pricing` | **Keep** | Checked by URL parity (§8.7) |
| `WEB/next.config.js:41-46, 92-97` | `MEDIA_PATHS` redirect to `NEXT_PUBLIC_MEDIA_URL` when set | **Keep** | Production sets `NEXT_PUBLIC_MEDIA_URL=https://media.playchess.tech` after `media:upload` (§7.9) |
| `WEB/next.config.js:53` | `USE_STANDALONE` (Amplify/Docker leftover, AQ §3.3) | **Remove** if no earlier phase did | — |
| `WEB/next.config.js:73-80` | `remotePatterns hostname "**"` (open image proxy, AQ SEC-14) | **Verify** the P1/P11 allow-list landed | Add `media.playchess.tech` to the allow-list if absent |
| `WEB/next.config.js:182-189` | `withSentryConfig({ tunnelRoute: "/monitoring", automaticVercelMonitors: true })` | **Keep** | `automaticVercelMonitors` creates the Sentry cron monitor for `/api/cron/daily`; source maps need `SENTRY_AUTH_TOKEN` on the prod project |
| `<vercel.json>` (today `REPO/vercel.json`, 5 lines: `buildCommand`, `outputDirectory`, `framework`, `installCommand` with corepack pnpm 9; P1/P3 add `regions`, `crons`; P7 D19 adds `functions` with `supportsCancellation`) | Read by both Vercel projects (whichever file the Root Directory selects, P1 §7.8) | **Edit** | Add `"git": { "deploymentEnabled": { "main": false } }` so a merge to `main` never deploys before the migration step; production deploys come from `release-prod.yml` (`vercel deploy --prebuilt --prod`). `dev` and preview branches keep auto-deploy. Preflight P21 checks that P7's `functions` block is in this file and that the deployed abort test passes (api-perf AP-02) |
| `REPO/turbo.json:4` (`globalEnv`, 13 names) | Turbo cache key | **Edit** | Every name in the env manifest (§7.9), so a cached build can never carry another environment's public keys (AQ B-03) |
| `WEB/app/api/health/route.ts` (P1 A1) | `{ok, buildId, env, time}`; `?deep=1` adds `db: {ok, ms}` | **Edit** | `deep=1` also returns `schema: { head, applied }` from `_prisma_migrations` (one extra `SELECT` in the same round trip; `replay_app` gets `SELECT` on that table, §6.3) so the release smoke can assert the schema head |
| `WEB/app/api/cron/daily/route.ts` (P1, tasks added by P4, P10, P11) | Daily backstop | **Edit (one line)** | Register `opsFreshness` (§7.5) in P1's ordered task list (`lib/cron/tasks/index.ts` if P1 made the registry a directory, feasibility §7) |
| `WEB/lib/flags-registry.ts` (P1, keys added by each phase; or `lib/flags/registry/<phase>.ts`) | Per-env defaults | **Edit** (or one new file `lib/flags/registry/p13-production.ts` that overrides the production defaults) | `default.production = true` for every rollout flag of the chosen variant except `review-lapsed-read` (OD in P3, B26), `analysis-live-prewarm` and `csp-enforce` (§7.10) |
| `WEB/worker/index.ts` (P11 §7.6) | Custom SW entry: update, purge, maintenance, sync, push | **Edit (1 import)** | `import "./legacy-evict"` (new file, §7.6) |
| `WEB/lib/storage/migrate.ts` (P1/CDL §6.5) | One-time removal of `chess-user-store`, `chess-data-store`, `games_completed`, `twitter_share_prompted`, `twitter_share_snoozed_at`; moves theme/mute prefs | **Keep**, verify on prod | Emits PostHog `system_legacy_migrated` (consent-gated, §10.1) |
| `WEB/app/api/profile/[referenceId]/route.ts` (P10 alias, `Deprecation: true`) | Old profile API for old bundles | **Keep through launch** | Deleted in the first post-launch release (P10 said "delete in P13", but production's first new release *is* P13, so the alias must survive it for the old tabs) |
| `WEB/scripts/dodo-setup-products.ts` (idempotent; `--live`) | Creates or finds the plan products | **Run** with the live key | Prints `DODO_PRODUCT_ID_MONTHLY/YEARLY` for live; owner verifies prices $4.99 / $50 |
| `WEB/scripts/upload-media.ts` (`R2_BUCKET`, `:58`) | Uploads `public/` media to R2 | **Run** against `replay-chess-media` (prod) | — |
| `WEB/scripts/indexnow.mjs`, `REPO/.github/workflows/indexnow.yml:28` | IndexNow daily | **Edit** (Node 24) and **run** `scope=all` after the switch | — |
| `WEB/prisma/seed.ts`, `WEB/prisma/opening-seed.ts`, `WEB/prisma/seed/index.ts` (DM §13.3) | Dev seeds | **Verify the guard** | Refuse unless `SEED_TARGET=dev` **and** the host is in `DEV_DB_HOSTS`; a P13 unit test runs the guard with the production host |
| `WEB/e2e/scripts/provision-test-users.ts` (`:171` Prisma; or P1's `e2e/personas/` directory) | Creates Clerk test users A–R and the leased pool | **Edit (guard)** | Exit 1 when `CLERK_SECRET_KEY` starts with `sk_live_` or the DB host is not a dev host (P1 `seed-guards.ts` if it exists) |
| `WEB/app/api/e2e/*` cleanup route (P12 R) | Dev-only | **Verify** | 404 when `APP_ENV=production`; `E2E_CLEANUP_SECRET` absent from the prod project (P12 note) |
| `WEB/public/_redirects` | Amplify routing file, unused on Vercel | **Remove** | — |
| `WEB/Dockerfile` | Docker web image (ARCH App. B "removed") | **Remove** if still present | — |
| `WEB/lib/seo.ts:3` (`BASE_URL = "https://www.playchess.tech"`) | Canonical URLs, sitemaps | **Keep** | — |

### 3.2 Socket server, worker and OCI

| File (today) | Today | Fate | P13 change |
|---|---|---|---|
| `REPO/deploy/oci/docker-compose.yml` (45 lines; P2 adds journal and grace, P3 adds the `analysis-worker` service under profile `worker`) | One stack per box | **Edit** | `websocket.ports: ["${WS_PRIVATE_BIND:-127.0.0.1}:3002:3002"]` so the prod worker VM can reach `/internal/emit` over the VCN (prod sets `WS_PRIVATE_BIND` to the socket box's private IP); the `worker` profile stays dev-only |
| `REPO/deploy/oci/worker/docker-compose.yml` | — | **New** | The worker VM stack (§7.7) |
| `REPO/deploy/oci/Caddyfile` (9 lines today; P2 adds the allow-list, the `/internal/{broadcast,drain,metrics}` 404 and the unsigned-request 401; P3 adds the worker routes) | `{$WS_HOST} { reverse_proxy websocket:3002 }` `:7-9` | **Edit** | Site address `{$WS_HOST} {$WS_ALT_HOST}` (the alt host is `ws-next.playchess.tech` until T+30 d, empty on dev); the worker routes proxy to `{$WORKER_UPSTREAM}` (dev `analysis-worker:3003`, prod `10.42.0.30:3003`); new `/worker/ready` → the worker's `/ready` (§7.7). P2's rules stay first |
| `REPO/deploy/oci/setup-server.sh:16-22` (iptables 80/443) | One-time box setup | **Edit** | `ROLE=socket` or `ROLE=worker`. Worker: no 80/443; `iptables -I INPUT -p tcp -s 10.42.0.0/24 --dport 3003 -j ACCEPT`; same `deploy` user, Docker, swap, sshd hardening. Socket: also `-s 10.42.0.0/24 --dport 3002` |
| `REPO/deploy/oci/.env.example` | Socket env template | **Split** | `.env.socket.example`, `.env.worker.example` listing every production name with a description, no values |
| `REPO/.github/workflows/deploy-oci.yml` (`:18-24` triggers on `main` and `dev`; `:76-84` bundle; `:89, :102` hosts; `:105-115` pull/up) | Push to `main` restarts the prod socket | **Rework** | `on: push: dev` + `workflow_dispatch` + `workflow_call` (inputs `environment`, `image_tag`, `targets: socket,worker`, `start` (true or false), `force`). Production targets two hosts: `OCI_HOST` (socket bundle) and `OCI_WORKER_HOST` (worker bundle). The push-to-`main` trigger goes away; `release-prod.yml` calls it (ARCH §4.3). The drain uses P2's signing CLI (`ops` kid) inside the container; no internal key is ever passed on the command line |
| `WS/spotInterruption.ts`, `WS/deploy/*`, `WS/docker-compose.yml` | AWS leftovers (AQ §9, ARCH App. B) | **Remove** if still present | — |
| `WK/src/handlers/backup.ts`, `WK/src/backup/*` | — | **New** | `BACKUP` job (§7.6) with its Sentry cron check-ins |
| `WK/src/scheduler/recurring/backup.ts` (P3's slice directory) | — | **New** | the `backup` slice: `plan(window)` returns the next `BACKUP` row (`runAt` 21:00 UTC, `dedupeKey backup:<date>`) when `BACKUP_ENABLED=true`, else nothing; `DAILY_PLAN` inserts it (P3-D22). P3's `housekeeping` Sentry check-in already exists, so `HOUSEKEEPING` itself is not edited |
| `REPO/deploy/oci/worker/.env` (rendered from `WORKER_ENV_FILE`) | — | **New** | the `worker` key (signs emits and `/internal/load`), the `web` and `socket` keys (accepted); `BACKUP_ENABLED=true` on prod only |
| `WEB/scripts/launch/seed-recurring.ts` | — | **New** | window step 12: inserts today's first `HOUSEKEEPING` and `BACKUP` rows (21:00 UTC) with `ON CONFLICT ("dedupeKey") DO NOTHING`, then a signed kick, so the first night does not depend on a boot path; a no-op if P3's boot already planned them |
| `WK/Dockerfile` (P3: Stockfish build stage + Node runtime) | Worker image | **Edit** | Add `postgresql-client-17` (from the PGDG apt repo, pinned) and `age` (pinned release) to the runtime stage; ≈ +12 MB |

### 3.3 Repository, CI and docs

| File | Fate | Notes |
|---|---|---|
| `REPO/k8s/` | **Verify removed** (P1 H5) | The committed `sk_test_` key (a development instance's) must already be revoked; preflight also runs gitleaks over the full history to prove no `sk_live_` key was ever committed (§11.2) |
| `REPO/docker-compose.yml`, `REPO/build-and-push.sh`, `REPO/amplify.yml`, `REPO/deployment.md` | **Remove** | Docker/Amplify/EC2 instructions that no longer describe production; `docs/runbooks/launch.md` replaces `deployment.md` |
| `REPO/perf/{deploy-ec2,setup-ec2,ssh-ec2,logs-ec2,status,seed-perf-db,cleanup-perf-db}.sh`, `REPO/perf/README.md` | **Remove** the scripts, **rewrite** the README | OPT §9.6 retires the EC2 perf rig |
| `REPO/.github/workflows/e2e-tests.yml:22`, `perf-tests.yml:18`, `indexnow.yml:28` | **Edit** | `node-version: 24` (ARCH X13) |
| `REPO/.github/workflows/release-prod.yml`, `prod-smoke-schedule.yml` | **New** | §7.11 |
| `REPO/.github/workflows/ops-weekly.yml` (created in P1, feasibility F-VER-2) | **Edit** (production section only) | production Vercel, Neon, Anthropic, Sentry, PostHog, OCI rows; the Stage C triggers (§14.4); the quarterly restore-drill issue |
| `REPO/CLAUDE.md` | **Edit** (OD-13) | Rules only: migration rule 1 reworded (no `db push` on any Neon branch), the recovery line removed; the Environments, accounts and Neon-details sections live in the gitignored `REPO/CLAUDE.local.md` (feasibility SEC-2, moved there in P1), which P13 updates on the owner's machine (prod project, worker VM, `next.` lane during launch, old project retired, R2 backups) |
| `REPO/docs/qa/phase-13-signoff.md` | **New** | the sign-off record (testing X15, §12.6) |
| `WEB/THIRD_PARTY.md` (P9 creates it) | **Verify** | every asset in `public/sounds`, `public/chess-icons`, legend portraits and the Stockfish files has a recorded source and licence (feasibility LIC-5, LIC-6); `public/board_icons` are the owner's own |
| `REPO/docs/implementation-plan.md` | **Edit** | Points to this spec; marks Phase 0's leftover bullets (prod Vercel, DNS, data dump) as done in P13 |
| `REPO/launch/` (new folder) | **New**, committed | `url-inventory.json`, `reports/*.json` (counts and timings only, never row data); `.gitignore` adds `launch/**/*.dump*` and `launch/**/*.sql` as a safety net, although dumps live outside the repo in `~/replay-launch/` |

---

## 4. Screens

P13 owns **no boards** (ALLOC §4.1: "P13 has no boards"). It operates four existing screens and checks the rest. The layouts below are the earlier phases' builds; P13 only adds copy, data and the conditions that show them.

### S1 · Maintenance during the window (`V3Maintenance`, built in P11 S20)

- **Route:** any member, onboarding or checkout document while the production Edge Config `notice` is `active` with `affects: ["all"]`; middleware rewrites to `app/(system)/maintenance/page.tsx` with status 503, `Retry-After`, `Cache-Control: no-store`, `X-Robots-Tag: noindex` (P11 §7.4 step 2). Marketing, legal, auth, `/offline` stay up. Admins (`claims.md.role === "ADMIN"`) bypass, which is how the owner tests production before opening it.
- **Boards:** desktop `DR/V3Maintenance.dc.html` (states `page`, `in_game`). No device boards: below 760 px the page stacks to one column (P11). One-viewport: the page is `ViewportStage` lock mode; no board on it; the in-game chip never covers the board (P11).
- **States in the window:**

| Time | `notice` (prod Edge Config `replay-ops`) | What a signed-in member sees |
|---|---|---|
| T−24 h … T+0 | `{ mode: "scheduled", startsAt: T, endsAt: T+60 min, affects: ["all"], message: L1 }` | Nothing: the new app is not public yet. (Set early: P11's adaptive memo holds a `scheduled` value for 120 s, an `active` one for 60 s.) |
| T+38 (step 14, **120 s** before the domain move) | `mode: "active"` | Still the old site's status redirect: the domain has not moved. The 120 s wait covers isolates still holding the `scheduled` value |
| T+41 … T+55 (domain moved, admin smoke) | `active` | `V3Maintenance` `page` with the countdown to `endsAt` ("Back around 04:30 UTC (10:00 your time)") |
| Past `endsAt`, still active | `active` | "Taking longer than planned. Check the status page." (P11; never a negative countdown) |
| T+55 `notice:clear` | `resolved`, then `null` after 10 min | Countdown replaced by **Reload**; auto-reload only when the tab is hidden (P11 S20) |

- **Copy notes (L1, ≤ 160 characters, owner approves):** "Replay Chess is moving to its new coaching app. Your account, games and membership come with you. Back in about an hour." The status-page link uses `NEXT_PUBLIC_STATUS_URL=https://status.playchess.tech` (P11 hides it while empty).
- **Keyboard:** P11's (Tab order: Status page, Play vs bot offline). No new shortcuts.

### S2 · Old-site freeze page (UptimeRobot status page, not a board)

- **Route:** `https://status.playchess.tech` (CNAME `stats.uptimerobot.com`, DNS only). The old project's firewall rule redirects every old document there during the freeze (D6).
- **Content:** monitors "Website" (`/api/health`), "Game server" (`ws-chess …/ready`), "Coaching engine" (`ws-chess …/worker/ready`, §10.3), plus an announcement. Copy L2: "Planned move to the new Replay Chess, <date> 04:00–05:00 UTC. Sign-in, games and memberships carry over. Follow progress here." Resolved copy L3: "Done. Welcome to the new Replay Chess."
- **Devices:** UptimeRobot's own responsive page; nothing to build.

### S3 · `next.playchess.tech` gate (pre-launch lane)

- **Route:** every path on host `next.playchess.tech`. Allowed viewers: `claims.md.role === "ADMIN"` or a Clerk user id in `PRELAUNCH_ALLOWLIST` (the owner's two accounts and the smoke account, §7.9). Everyone else, signed in or not, gets the **404** page (rewrite to the not-found route with status 404) so the lane reveals nothing; `/sign-in` and `/sso-callback` are reachable so the owner can sign in.
- **Boards:** `DR/V3Error404.dc.html` (desktop, states `signed_out`, `signed_in`, `missing_game`), `DR/V3iPhoneError404.dc.html`, `DR/V3iPadPError404.dc.html` (P11 S16). One-viewport compliant (P11).
- **Copy:** the P11 404 copy unchanged; no hint that a staging site exists.

### S4 · Admin dashboard activity (`V4Admin`, built in P12)

- **Route:** `/admin` (P12 `(admin)` group, `requireAdmin()`); desktop-only compact layout, board `DR/V4Admin.dc.html` (states `default`, `forbidden`).
- **What P13 adds:** rows written to `audit_logs` (category `SYSTEM`, actor `SYSTEM` or `WORKER`; the table and `WEB/lib/audit.ts` ship in M4, consistency R-04) by the launch runner and the worker. The P12 feed renders them under the Full variant; under Early and Launch A the rows are still written and read by `opsFreshness`, and the legacy admin does not show them:

| `action` | Row text (P12 feed format "HH:MM · System · …") | Writer |
|---|---|---|
| `launch.data_migrated` | "Production data migrated · 104 users · 378 games · 3,641 openings" | `WEB/scripts/launch/verify-counts.ts` |
| `launch.opened` | "New app opened to everyone" | `WEB/scripts/launch/open.ts` |
| `backup.completed` | "Nightly backup OK · 18.2 MB · 41 s" | `WK/src/handlers/backup.ts` |
| `backup.failed` | "Nightly backup failed · retry 2 of 3" | same |
| `backup.restore_drill` | "Restore drill passed · 52 tables match" | `REPO/scripts/ops/restore-drill.sh` (through `WEB/scripts/launch/audit-note.ts`) |

- The "Socket server · OCI · N games live · Healthy" and "Analysis queue · Median 8 s · Normal" tiles (P12 `AdminHealth`, ADM-11) need an OCI metrics path that P2's Caddy rules allow; that is P12's to settle (handoff H13-2). Until then they show `unknown`, which P12 renders, and P13's launch checks use `/ready`, `/worker/ready` and `opsFreshness` instead. The tile numbers in the board (Users 104, Games 378, Positions 3,641, Legends 51, Tournaments 18) are the real old-prod counts, so they double as the post-migration check (owner test item 3).

### S5 · Returning legacy browser

- **No board.** A browser with the old service worker loads the new `sw.js` (served `max-age=0, must-revalidate`, `WEB/next.config.js:170-178`); `legacy-evict` activates it at once, deletes the 18 legacy caches and posts `LEGACY_EVICTED`; the page reloads once if it is not an immersive route (guarded by `sessionStorage["rc:legacy-reloaded"]`).
- After the reload, P1's `Toast` (`V3Toasts`, kind `info`, 6 s, top-right on desktop, bottom-centre on phones) shows once per device: "Replay Chess has a new look. Your account and games came with you." Shown only when `migrate.ts` or `legacy-evict` actually removed something.

### S6 · Production smoke matrix (screens checked, not built)

Every board-bearing route is asserted by the P1 one-viewport fixture on the prod-smoke project set (§12.3). The signed-in rows run only on `next.playchess.tech` before the window and by hand on production after it.

| Area | Routes | Devices × zoom |
|---|---|---|
| Public | `/`, `/pricing`, `/how-we-grade`, `/legends`, `/legends/<slug>`, `/openings/<slug>`, `/learn/*`, `/blog`, `/help`, `/contact`, `/terms`, 404 | desktop-1440 @ 80/100/125/150 %, desktop-1280, ipad-landscape, ipad-portrait, iphone, android @ 100 % |
| Auth | `/sign-in`, `/sign-up`, `/reset-password` | same |
| Member (next. lane, then manual on prod) | `/home`, `/games`, `/review/<ref>`, `/train`, `/train/bank/session`, `/weakness`, `/play`, `/game/<ref>`, `/tournaments`, `/@<username>`, `/settings/membership` (the variant's subset, §2.4) | desktop-1440 @ 100/125 %, iphone, android, ipad-portrait |
| System | `/maintenance` (with a dev notice), `/offline`, `/too-many-requests` | desktop-1440, iphone |

---

## 5. UI ↔ API data flow

P13 adds no query key and no mutation hook. These are the flows it relies on or changes, written against CDL and P1's `qk` factory.

### 5.1 Maintenance gate in the window

```
owner laptop: pnpm --filter web notice:set --env production --mode active --ends "<T+60m>" --affects all --message "<L1>" --via ssh
   └─► Vercel API PATCH Edge Config replay-ops (prod) { notice }            (P11 scripts/system/notice.ts; 1 of the Edge Config writes)
   └─► ssh deploy@132.226.190.10 'docker compose exec -T websocket node dist/cli/internal.js broadcast --type notice --body -'
          → POST /internal/broadcast { v: 1, type: "notice", notice }, signed with the ops kid (P2 §7.5.1; Caddy-blocked from outside)
          → currentNotice = notice; io.emit("system:notice", notice)        (P11 §7.5; the socket refuses new pairings while active)
       fallback without the laptop's SSH key: gh workflow run ops-broadcast.yml -f target=production -f body=<json>   (P11; environment approval)
middleware (document request to an (app) route) ── getOps().notice, adaptive memo per isolate: 300 s none · 120 s scheduled · 60 s active (P11 D10)
   └─ active & affects "all" & not ADMIN → rewrite /maintenance, 503, Retry-After = endsAt − now (min 60 s)
route wrapper (any non-exempt /api/*) ── same notice → 503 { error: { code: "maintenance", retryAfterSec, details: { notice } } }
client QueryProvider onError 503 maintenance → setQueryData(qk.system.notice(), notice) → shell banner / page   (P1 F3, P11)
socket clients ── "system:notice" → setQueryData(qk.system.notice(), …); every socket connect invalidates qk.system.notice()   (CDL §5.6, P11)
```

- **Freshness:** `qk.system.notice()` is served `public, s-maxage=30, stale-while-revalidate=60` (API SYS-2). Setting `active` reaches every isolate within 120 s (the `scheduled` memo), so step 14 waits 120 s before the domain move. After `notice:clear`, documents open within the 60 s `active` memo; open tabs learn it at once from the socket broadcast, else within ≤ 90 s. The runbook waits 90 s before declaring "open".
- **Exempt from the gate** (P11 §7.3): `/api/webhook/*`, `/api/internal/*`, `/api/cron/*`, `/api/health`, `/api/system/notice`, `/api/consent`, `/api/contact`, `/api/feedback`, `/api/return-target`, `/api/search`. Dodo retries therefore process during the admin smoke (T+40 …).
- **Errors:** an Edge Config read failure keeps the last value, else the env fallback `MAINTENANCE_MODE` (`off` in prod). The runbook sets `MAINTENANCE_MODE=on` as a second lock only if the Edge Config write fails twice.

### 5.2 First visit of a returning user after the switch (Path T)

```
browser (old Clerk session cookie on playchess.tech is still valid: same instance)
 → GET /home  (middleware: Clerk handshake; session JWT carries md/ini/usn claims after its ≤ 60 s refresh)
     md present (claims sync ran, §6.5 step 13) → member? render : redirect /pricing?reason=required
     md missing → MIDDLEWARE_MEMBER_GATE is still "off" during step 13 → page-level getViewer() decides   (P1)
 → RSC: getViewer() (1 query by googleId = Clerk user id, unchanged) → (app)/layout prefetch qk.me()
 → HydrationBoundary; no client fetch on first paint (CDL §2.4)
 → lib/storage/migrate.ts once; SW update → legacy-evict → reload once (S5)
```

- `qk.me()` `staleTime` 30 s (P1). `GET /api/me` is the only client read after hydration; 401 → `SessionExpiredModal`, 402 → `/pricing?reason=…` (P1 F3).
- Path N variant (fallback only): the old cookie is for the old instance; the user signs in again, Clerk creates or matches the imported user, `provisionUser()` relinks by **verified** email and writes an `audit_logs` row `account.relinked` (P1 §7 provisionUser), PostHog `auth_relinked` (§10.1).

### 5.3 Checkout in live mode (P4 flow, production values)

- `POST /api/checkout { plan, returnPath, source }` + `Idempotency-Key` → Dodo live session (trial only when `TrialLedger` and `trialStartedAt` allow, P4) → Dodo hosted page → return to `https://www.playchess.tech/checkout/activating?…` → the page waits for `entitlement:changed` on `user:{ref}` (socket) and falls back to `GET /api/billing/activation` every 2 s × 6, then 5 s × 12, then 15 s, even while the socket is live and the tab is hidden, until a final state or 180 s (P4 §5 `useActivation`, `activation-machine.ts`). The Dodo live webhook (`/api/webhook/dodo-payments`) applies the snapshot and pushes the event through `POST /internal/emit`.
- **What P13 changes:** only env values (`DODO_PAYMENTS_ENVIRONMENT=live_mode`, live product ids, `DODO_PAYMENTS_RETURN_URL`) and the webhook secret. The live checkout is first exercised at T+56 (the owner's trial with a forced first charge and a refund, §8.3 step 18).

### 5.4 `next.playchess.tech` lane

- Same code, same query keys and stale times as production; only the Preview env of branch `launch` differs (§7.9). The socket URL is `wss://ws-next.playchess.tech` (Caddy serves both names on the prod socket box). Analysis kicks go to `ANALYSIS_WORKER_URL=https://ws-next.playchess.tech` (the same Caddy route).
- Dodo **test** mode: checkouts return to `https://next.playchess.tech/checkout/activating`; the Dodo test webhook endpoint `https://next.playchess.tech/api/webhook/dodo-payments` has its own secret (`DODO_PAYMENTS_WEBHOOK_KEY` in the `launch` Preview env).
- Clerk production: a temporary webhook endpoint `https://next.playchess.tech/api/webhook/clerk` (own signing secret) feeds the rehearsal branch; it is deleted in the window (§8.3 step 14).

### 5.5 Legacy clients (old bundles in open tabs)

| Old call (from the live bundle) | New answer | Effect in the old tab |
|---|---|---|
| `POST /api/user/sync`, `GET /api/user/email/*`, `GET /api/chess/game-by-ref/*`, `POST /api/chess/{move,game-state,game-over,create-game,join,cancel-game,create-ai-game}`, `GET\|POST /api/matchmaking/*`, `GET /api/analysis/*`, `GET /api/legends/search`, `GET /api/position/*`, `GET /api/tournament/*` | **410** `{ error: { code: "gone", message: "Replay Chess has been updated. Reload the page.", requestId } }`, `Cache-Control: no-store`, `x-rc-reload: 1` (§7.1 R4) | The old UI shows its generic error; the next navigation gets new HTML. No 500s in Sentry, no DB work |
| `GET /api/subscription` (kept by P1, DB-first) | 200 in the new shape | Old store may mis-read it; harmless (the storage migration clears it on the next load) |
| `GET /api/profile/<ref>` | 200 from the P10 alias with `Deprecation: true` | Works until P13 + 1 release |
| Old socket protocol v1 to `ws-chess` after the flip | `connect_error { message: "upgrade_required" }` (AS §17.1.7) | Old game page shows its reconnect UI; reload gets the new app |

Tombstones are counted by a Sentry metric `legacy.api_call{path}`; they are removed at T+30 d or when the count is under 5 a day for 7 days.

### 5.6 Admin and monitoring reads

- `/admin` RSC prefetches `qk.admin.metrics()`, `qk.admin.health()` and `qk.admin.activity({ category: "all" })` (P12 §5). P13 rows appear on the next fetch (P12 stale times; refetch on window focus). No push channel is added.
- UptimeRobot calls `GET /api/health` every 5 minutes (no DB, `no-store`, outside middleware, P1 A1), `GET https://ws-chess.playchess.tech/ready` and `GET https://ws-chess.playchess.tech/worker/ready`. None of these wakes Neon (OPT §9.8): the socket's `/ready` probes the DB only while games are live (P2), and the worker's `/ready` checks the engine and the eval cache only (P3).
- The daily cron's `opsFreshness` runs four small indexed reads in one round trip (§7.5) while the cron has Neon awake anyway. It is the only scheduled DB read P13 adds; `BACKUP` adds no wake of its own (it runs in the 21:00 UTC `HOUSEKEEPING` drain, P3-D22).

### 5.7 Error, 401, 402 and 503 handling

Unchanged from P1/P11: 401 → session modal, 402 → pricing with `reason` (or the P7 `RenewSheet` for `trial_used`/`expired` on `(app)` pages, P11 D18), 429 → `RetryCountdown`, 503 `maintenance` → maintenance hook, other 5xx → toast with the `requestId`. The tombstones reuse the `gone` code that P3 added to `CT/http/codes.ts`; the new client never receives it, because it never calls those paths.

---
## 6. Data model

### 6.1 Prisma change introduced by P13: migration M13a

```prisma
// DB/prisma/schema.prisma — enum JobKind (P3 created it; P4–P10 appended values)
enum JobKind {
  // … existing values …
  BACKUP          // P13: nightly pg_dump → age → R2 (WK/src/handlers/backup.ts)
}
```

```sql
-- DB/prisma/migrations/2026MMDDhhmmss_m13a_jobkind_backup/migration.sql
-- kind: expand
SET lock_timeout = '5s';
ALTER TYPE "JobKind" ADD VALUE IF NOT EXISTS 'BACKUP';
```

- **Own file** (DM §11.1 rule 3): the value cannot be used in the transaction that adds it.
- **Write order** (DM §11.1 rule 6): migration → web and worker images that know the value → the worker's boot bootstrap inserts the first `BACKUP` row. On production all of this happens in the window, before any worker starts (§8.3 steps 7 and 12).
- **Two-release rule** (feasibility §9 rule 1, P5 §6): on dev, M13a merges one release before the handler that writes `BACKUP` rows is enabled (`BACKUP_ENABLED` stays `false` on dev anyway). On production the rule holds by construction, because no production image older than the launch SHA exists (D22).
- **No other table or column is added by P13.** Launch bookkeeping goes into `audit_logs` (M4, P4; consistency R-04), job state into `jobs` (P3), and everything else into files under `REPO/launch/reports/`.
- Indexes: none new. The `BACKUP` rows use P3's `jobs_ready_idx (priority DESC, "fairSeq", "runAt") WHERE status = 'QUEUED'` (claim; consistency R-05) and the freshness check uses `audit_logs_category_at_idx (category, at DESC)` from M4 (§7.5).

### 6.2 The migration set production receives in the window

`production` (branch `production` of project `withered-cake-82837167`; ids live in `CLAUDE.local.md`, consistency R-20) is at the 17 repo migrations today (ADB §0). At the launch SHA, `prisma migrate deploy` applies every folder not yet in `_prisma_migrations`, in timestamp order. Expected set (folder names from the phase specs as finalised; timestamps set when written; contents per consistency R-01, R-02, R-04, R-05):

| # | Folder suffix | Phase | Kind | Contents that matter for production |
|---|---|---|---|---|
| 1 | `_m1_rate_limits_webhook_events` | P1 | expand | `rate_limit_buckets` UNLOGGED (emptied on compute restart; only limits that are safe to reset live there, feasibility F-NEON-3), `webhook_events`, `idempotency_keys` (unless M2i creates it) |
| 2 | `_m2a_game_status_aborted` | P2 | expand (enum) | own file |
| 3 | `_m2_play_model` | P2 | expand | `games` play columns incl. the display snapshot (`whiteName` … `blackTitle`), `source GameSource`, `externalId`, `externalUrl`, unique `(source, "externalId")`; `GameMode.IMPORTED`, `GameEndMethod.OTHER`; `game_players` (PK `(gameId, userId)`, `endedAt`, `ratingBefore/After/Delta`, `opponent*`, `source`); `users."gamesVersion"`; `games_open_idx`, `game_players_userId_endedAt_gameId_idx` |
| 4 | `_m2i_idempotency_keys` | P2 | expand | only if P1 did not create the table |
| 5 | `_m3_analysis_review` | P3 | expand | `jobs` with `fairSeq` and `jobs_ready_idx (priority DESC, "fairSeq", "runAt")`; `Job.lastKickAt`; `JobKind` incl. `REVIEW_TEXT` (no `HOURLY_TICK`, P3-D22); `game_analyses."readyMs"`; `game_analyses`, `player_reviews` (key moments live in `content.moments[]`, no `key_moments` table), `legend_comparisons`, `shares`, `openings.epd`; `games."ecoCode"`, `"openingName"`, `game_players."ecoCode"` |
| 6 | `_m4a_game_enum_safety`, `_m4_import_onboarding`, `_m4v_validate_linked_account_fk` | P4 | expand + validate | `linked_accounts`, `import_cursors`, `import_runs`, `trial_ledger`, **`audit_logs`** with `AuditCategory`/`AuditActor` (R-04), `users."timeZone"`, onboarding and billing columns, `game_players."linkedAccountId"` (`NOT VALID` FK, validated in m4v) |
| 7 | `_m5a_jobkind_extract_mistakes`, `_m5_training` | P5 | expand | `training_cards`, `training_attempts`, `reports`, `mistake_occurrences`, `game_players."bankVersion"`; **no** `_m5v_validate_key_moment_fk` (removed, consistency 13.2) |
| 8 | `_m6a_jobkind_weakness` (only if written), `_m6_weakness` | P6 | expand | `game_players.stats`, `"errorThemes"`, `errorLog`, `errorThemeN`, `weaknessInputsV` |
| 9 | `_m7_coach` (no `m7a`: `REVIEW_TEXT` ships in M3) | P7 | expand | `coach_threads`, `coach_messages`, `coach_usage_days`, `coach_spend_days` |
| 10 | `_m8a_session_kind_openings`, `_m8_learn` | P8 | expand | catalogue slugs, lessons, `games."seriesNo"` |
| 11 | `_m9_play_challenges_ratings` | P9 | expand | challenges, `player_ratings`, `game_players_h2h_idx` |
| 12 | `_m10a_job_kinds`, `_m10_account_area` | P10 | expand | the P10 job kinds, account tables, `tournament_participants."displayName"` |
| 13 | `_c3_user_fk_set_null`, `_c3v_validate_user_fks` | P10 | **contract** | FK semantics change to `SET NULL`. **Owner confirmation required** before the window's `migrate deploy` (OD-14, CLAUDE.md rule 5): "This command changes delete behaviour on four foreign keys of the production database. Are you sure?" |
| 14 | `_m11_consent_support` | P11 | expand | `support_requests`, consent fields |
| 15 | `_m12a_position_status_archived`, `_m12_tournaments_admin`, `_m12v_validate_tournament_host_fk` | P12 | expand + validate | the tournament per-game columns (`games."tournamentPositionOrder"`, `game_players."tournamentPoints"`, `"tournamentFire"`) **unconditionally**; `chess_positions.status`; no conditional `audit_logs` part any more (it is in M4). **Skipped** under the Early and Launch A variants |
| 16 | `_m13a_jobkind_backup` | P13 | expand (enum) | |

Under Launch A (§2.4) rows 8, 10, 11 and 15 are absent and rows 12 and 14 contain only what the thin P10 and P11 ship; `launch/variant.json` lists the exact expected folders and preflight compares against it.

Rules checked by `WEB/scripts/launch/preflight.ts` (§7.12) before the window:

1. Every folder expected by `launch/variant.json` exists and **no other `-- kind: contract` file** is present (C1, C2, C4, C5, C12 must not be merged yet). No folder or SQL statement mentions `key_moments`.
2. `pnpm --filter @repo/db exec tsx scripts/db/check-drift.ts` (P2's drift gate with `PKG/db/prisma/protected-indexes.txt`; consistency R-10) is clean against a local Docker shadow.
3. A from-scratch `migrate deploy` on a Docker Postgres 17 seeded with the **old production dump** (data-only restore at 17 first, exactly as in the window) succeeds, and the backfills' dry runs report the expected counts. This is rehearsal 0, on the owner's laptop, before any Neon branch is used.
4. Every file that `ALTER`s an existing table starts with `SET lock_timeout = '5s';`.
5. Every `ALTER TYPE … ADD VALUE` sits in its own file (DM §11.1 rule 3).

**Timing on production data sizes:** every table is below 10,000 rows (old prod: 104 users, 378 games, 3,641 openings), so each statement runs in milliseconds; the whole set is about 30 statements per round trip at ≈ 15 ms from a US runner, under 1 minute in total. Measured in rehearsals 1 and 2 (§8.9).

### 6.3 Roles, grants and extensions (ops SQL, not migrations)

Roles are cluster objects and the shadow and CI databases lack them, so they live outside `prisma/migrations` (P3 §6.3, ADB §5.4). P13 consolidates the per-phase files into one ordered set and runs it on production.

| File (new, P13) | Contents | Consolidates |
|---|---|---|
| `DB/sql/roles/00_create.sql` | `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'replay_app') THEN … END IF; END $$;` for the four roles. On Neon the roles are created with the API (`create_postgres_role`, which generates the password) and this file only asserts they exist | P1 `scripts/db/replay-app-role.sql`, P2 `DB/sql/roles.sql`, P3 `DB/scripts/roles/replay-worker.sql` |
| `DB/sql/roles/10_settings.sql` | `ALTER ROLE … SET` timeouts (below) | same |
| `DB/sql/roles/20_default_privileges.sql` | `ALTER DEFAULT PRIVILEGES FOR ROLE neondb_owner IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO replay_app; … GRANT USAGE, SELECT ON SEQUENCES TO replay_app; … GRANT SELECT ON TABLES TO replay_worker, replay_backup;` | ADB §5.4, P3 |
| `DB/sql/grants/replay_app.sql`, `replay_realtime.sql`, `replay_worker.sql`, `replay_backup.sql` | The explicit table and column grants from P2 §6.7, P3 §6.3 and each later phase's additions; plus P13's own: `GRANT SELECT ON "_prisma_migrations" TO replay_app` (health `deep`, §7.1); `GRANT INSERT ON audit_logs TO replay_worker` and `GRANT USAGE ON SEQUENCE audit_logs_id_seq TO replay_worker` (the backup rows, §7.6); `GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO replay_backup` (`pg_dump` reads sequence values) | every phase |
| `DB/sql/grants.matrix.json` | Expected privileges: `{ "<table>": { "replay_app": "SIUD", "replay_realtime": "SU", "replay_worker": "S", "replay_backup": "S" }, "<table>.<column>": { … } }` | — |
| `DB/sql/extensions.sql` | `CREATE EXTENSION IF NOT EXISTS pg_stat_statements;` | ADB §5.4, ARCH §1.12.1 |
| `REPO/scripts/db/check-grants.ts` | Reads the matrix and runs `has_table_privilege` / `has_column_privilege` for every cell; fails on any missing **or extra** privilege; also asserts that no runtime role has `CREATE` on `public` or owns a table | — |

| Role | Used by | Connection | Settings | Must never |
|---|---|---|---|---|
| `neondb_owner` | `migrate deploy`, roles SQL, the launch restore | **direct** host, only in the launch shell and the GitHub `production` environment secret `PROD_DIRECT_URL` | — | Appear in any runtime env file |
| `replay_app` | web (Vercel) | pooled, `?sslmode=require&channel_binding=require&connection_limit=5&pool_timeout=15&connect_timeout=15` | `statement_timeout 15s`, `idle_in_transaction_session_timeout 30s`, `lock_timeout 5s` | `TRUNCATE`, DDL |
| `replay_realtime` | socket (OCI prod box) | pooled, `?pgbouncer=true&connection_limit=3&pool_timeout=10&connect_timeout=15` | `statement_timeout 5s`, `lock_timeout 3s`, `idle_in_transaction_session_timeout 10s` (P2 §6.7) | Read emails, billing columns or `gameData` |
| `replay_worker` | worker VM | pooled | `statement_timeout 60s` (P3) | Write billing fields |
| `replay_backup` | `BACKUP` job | **direct** host (`pg_dump` needs a session) | `statement_timeout 0`, `idle_in_transaction_session_timeout 0` (dump sessions only) | Any DML |

Order on production: create the roles, settings and default privileges at **T−3 d** (the branch is still empty, nothing is destructive); the explicit grants and `check-grants.ts` run in the window **after** `migrate deploy` (§8.3 step 8), because column grants need the tables. `pg_stat_statements` is installed at T−3 d and reset (`SELECT pg_stat_statements_reset();`) at T+55 so the T+24 h review sees only real traffic.

### 6.4 Old production → new production: data path

Source: account pandit.rohit0007, project `shy-morning-50748774`, branch `br-still-brook-a5nutqwh`, database `prisma_migrate_shadow_db_696341e6-c32e-46e7-8f09-b53758dedd0f`. Target: account replaychess007, project `withered-cake-82837167`, branch `production`, database `neondb`. Reads of the source need the owner's approval (ADB §0); every write to the target is confirmed (CLAUDE.md rule 5).

| Step | Command (from `~/replay-launch/`, `pg_dump`/`pg_restore` 17.x from `brew install postgresql@17`) | Check |
|---|---|---|
| Probe (read-only, T−14 d and in each rehearsal) | `psql "$OLD_DIRECT_URL" -f REPO/launch/sql/old-db-probe.sql > probe-<ts>.txt` (ADB Appendix A queries 1–7 plus `SELECT version();` and `SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations ORDER BY 1;`) | 16 or 17 names, none rolled back; server version ≤ 17 |
| Drift check | `pnpm --filter @repo/db exec prisma migrate diff --from-url "$OLD_DIRECT_URL" --to-migrations prisma/migrations-at-17 --shadow-database-url postgresql://postgres:pw@localhost:55433/postgres --exit-code` (a checkout of the 17 migrations in a temp folder) | Exit 0, or a list of drifted objects → §8.4 transit path |
| Full dump (archive) | `pg_dump -Fc --no-owner --no-privileges -f old-full-<ts>.dump "$OLD_DIRECT_URL"` then `age -r <owner key> -o old-full-<ts>.dump.age old-full-<ts>.dump` and upload to `r2://replay-backups/legacy/` | `pg_restore --list` succeeds; sha256 recorded |
| Data-only dump | `pg_dump -Fc --data-only --no-owner --no-privileges --exclude-table-data=_prisma_migrations --exclude-table-data=matchmaking_queue -f old-data-<ts>.dump "$OLD_DIRECT_URL"` | — |
| Target check | `psql "$PROD_DIRECT_URL" -f REPO/launch/sql/target-check.sql`: the 17 migration names; `count(*) = 0` for every table except `_prisma_migrations` | Any non-zero count → **stop and ask** |
| Restore **[confirm]** | `pg_restore --data-only --no-owner --no-privileges --single-transaction --exit-on-error -d "$PROD_DIRECT_URL" old-data-<ts>.dump` | Exit 0 |
| Verify | `pnpm --filter web exec tsx scripts/launch/verify-counts.ts --old "$OLD_DIRECT_URL" --new "$PROD_DIRECT_URL"` (§8.5) | Every check passes; report written |

`--disable-triggers` and `session_replication_role` need superuser, which Neon does not grant, and are not needed: `pg_dump` orders table data by foreign-key dependency (DM §12.1 step 7).

**Table mapping** (DM §12.2, updated for Path T): `users` (Clerk ids unchanged), `games` (+ `game_players` by B1/B2), `user_stats` (read-only until C4), `chess_com_profiles` (→ `linked_accounts` by B5, dropped in C4), `chess_positions`, `legends`, `openings`, `tournaments`, `tournament_participants` (+ B7) are copied; `matchmaking_queue` and `_prisma_migrations` are not. Dodo customers and subscriptions stay in the same Dodo account. R2 media stays.

### 6.5 Backfills on production, in order

Every script follows DM §11.6: `--dry-run` is the default, `--apply` writes, batches of 500 by id, idempotent predicate, refuses unless the `DATABASE_URL` host is in `BACKFILL_ALLOWED_HOSTS` (set in the launch shell to the production **direct** host only for the window, then unset), one `audit_logs` row each. `WEB/scripts/launch/backfill-all.ts` runs them in this order, prints each dry-run count, asks for `apply? (yes)`, runs the verification query, and stops at the first failure.

| Step | ID | Script (owner phase) | External calls | Verification (must hold before the next step) | Expected on prod |
|---|---|---|---|---|---|
| 1 | B-L1 | `WEB/scripts/launch/system-users.ts` (P13) | — | `DEMO_PLAYER_001.isActive = false`; both system users have `googleId LIKE 'system:%'` (P10 B8 excludes them by this prefix) | 2 rows touched at most |
| 2 | B1 + B2 | `WEB/scripts/backfill-play-columns.ts` (P2) | — | Every non-empty `moves` replays legally from `startingFen` with chess.js; `plyCount` = token count; every `endMethod = CHECKMATE` row ends in mate; `count(game_players)` = completed games × member sides with known colour; counts of `meta.colorUnknown`, `meta.backfillTruncated` and appended mating moves are printed (ADB App. A query 7 predicts the last) | 378+ games; `mode IS NULL` = 0 afterwards |
| 3 | B6 | `WEB/scripts/backfill/onboarding.ts` (P4) | — | 0 rows with `onboardingStep = 'WELCOME' AND onboarded` | |
| 4 | B9 | `WEB/scripts/backfill/trial-ledger.ts` (P4; hashes with `trialLedgerEmailHash()` and the production `HASH_PEPPER`) | — | ledger rows = users with `trialStartedAt` | probably 0–few (trials started 2026-11-01) |
| 5 | B5 | `WEB/scripts/backfill/linked-accounts.ts` (P4), **without** `--queue-imports` in the window | — | one `CHESSCOM` link per `chess_com_profiles` row | = old `chess_com_profiles` count |
| 6 | — | `DB/scripts/backfill/opening-epd.ts` (P3) | — | `epd IS NULL` = mismatches only (logged, not written) | 3,641 rows |
| 7 | B3 | `WEB/scripts/backfill/catalog-keys.ts` (P8) | — | unique indexes hold; every active legend, position and opening has a slug; `count(*) WHERE "isMainline"` = distinct names | 51 legends, 3,641 openings |
| 8 | B4 | `WEB/scripts/backfill/explanations-to-r2.ts` (P8) | R2 `replay-chess-media` (objects already uploaded in the rehearsals, so only the DB columns change) | SHA-256 of the DB JSON = SHA-256 of the R2 object for every row; `count(hasExplanation)` = `count(explanation IS NOT NULL)` | |
| 9 | B11, J7, J8 | `WEB/scripts/backfill/legend-practice-seed.ts`, `WEB/scripts/lessons/*.ts`, `WEB/scripts/openings/*.ts` (P8) | — | the 7 practice positions verified (`verifiedAt` set) or written inactive and reported; lessons count = `content/lessons/*.json`; openings enrichment counts | |
| 10 | — | `WEB/scripts/backfill/seed-player-ratings.ts` (P9) | — | ≤ 3 rows per user, `games = 0`, ratings clamped 400–2800 | ≤ 3 × users |
| 11 | B8, B12, B13 | `WEB/scripts/backfill/{usernames,prefs-derived,participant-names}.ts` (P10) | — | 0 null `usernameKey` (non-system); all match `^[a-z0-9][a-z0-9_]{2,19}$`; 0 null participant names with a user | 104+ usernames |
| 12 | B7 | `WEB/scripts/backfill/tournaments.ts` (P12; skipped under Early and Launch A) | — | ranks by `score` = old ranks by `points` | 18 tournaments |
| 13 | — | `scripts/backfill/sync-clerk-claims.ts` (P1) + `WEB/scripts/backfill/clerk-onboarded-claims.ts` (P4 B12) | Clerk BAPI (production), 120 ms between calls | 20 sampled users show `md` (entitled, onboarded, role) in a fresh session token | 104+ users ≈ 15 s |
| 14 | B-L2 | `WEB/scripts/launch/reconcile-billing.ts` (P13) | Dodo **live** `subscriptions.retrieve`, ≤ 5 requests a second | for every user with `subscriptionId`: the stored status, `currentPeriodEnd` and `cancelAtPeriodEnd` equal Dodo's; differences applied through `applySubscriptionSnapshot(…, { source: "reconcile" })` and listed | all live subscribers, including the legacy $8 product |
| 15 | B6-W, B-M5-1 | P6 `backfill-weakness-inputs.ts` and `backfill-mistake-timepressure.ts` (not under Launch A), P5 `WEB/scripts/backfill/enqueue-mistake-extraction.ts` (`JOB_PRIORITY.BACKLOG`) | — | each reports 0 rows (production has no analyses yet); run to prove the predicates | 0 |
| — | **after opening (T+60 min … T+2 h)** | | | | |
| 16 | B14 | `WEB/scripts/backfill/milestones-initial.ts` (P10) | — | job count = users with ≥ 1 `game_players` row; jobs `silent: true` | |
| 17 | D14 | `DB/scripts/backfill/enqueue-analysis.ts --entitled-only --budget p4` (P3 script; P13 adds the two flags): `JOB_PRIORITY.BACKLOG`, newest first, `fairSeq` = per-user rank so users interleave, per-user cap = P4 D4-09 `eager` (50 members, 20 trialists) minus what the user already has analysed | signed worker kick (caller `web`) | jobs = Σ min(cap, completed games) over entitled users | ≤ a few hundred |
| 18 | OD-8 | `WEB/scripts/backfill/linked-accounts.ts --queue-imports --entitled-only` then `releaseWaitingImports()` throttled 1 user/s (P4) | Chess.com (serial, provider gate) | one `ImportRun` per entitled linked member; analysis of the imported games follows P4's budget (the backlog beyond `eager` waits for the first paid charge) | |
| 19 | B-L3 | `WEB/scripts/launch/posthog-alias.ts` (P13) | PostHog capture API (`alias`, `$set`) | one alias per non-system user: `distinctId = referenceId`, `alias = googleId` (the old site's distinct id), `$set { legacy_user: true, legacy_joined_at }` | 104+ |

### 6.6 Contract steps after launch (owner confirms each; fresh dump to R2 first)

| Step | Earliest | Precondition | Content (DM §5.11, P9, P12) |
|---|---|---|---|
| C1 | T+30 d | B1 verified; every reader on typed columns for 30 days | drop duplicate and low-value indexes; strip `gameData.moveHistory`/`traceContext` (B10) |
| C2 | one release after `play-hub-v3` is at 100 % in production (P9 D19) | `max("createdAt")` of `matchmaking_queue` older than 7 days | drop `matchmaking_queue`, `MatchmakingStatus` |
| C4 | P13 + 1 release | stats read `game_players`, links read `linked_accounts` | drop `user_stats`, `chess_com_profiles` |
| C5 | P13 + 1 release | B4's SHA check passed on production | drop `chess_positions.explanation`, `openings.explanation` |
| C12 | P13 + 1 release | all tournaments have slugs | `tournaments.slug SET NOT NULL`; drop `isSearching`, `searchingSince` |
| C6, C7 | later | no reader | DM §5.11 |

### 6.7 Dev environment split and seed data

P13 adds no seed rows. Dev and E2E left the production project in **P1** (1B·H10; api-perf AP-01, feasibility F-NEON-1; the finalised P2 makes it an entry precondition). Preflight P17 verifies it: the dev branch, the E2E branch and every dev connection string (`replay-chess-dev` env, `WS_DEV_ENV_FILE`, `WORKER_DEV_ENV_FILE`, `apps/web/.env.development.local`, `apps/web/.env.test`, `DEV_DB_HOSTS`) point at the separate dev project, and project `withered-cake-82837167` holds only `production` (plus rehearsal branches while they exist).

**Fallback, only if P1 slipped** (WP-A runs it before R#0):

1. Create Neon project `replay-chess-dev` (replaychess007, Free, AWS us-east-1, Postgres 17, max autoscaling 0.5 CU) with branches `dev`, `e2e` and `perf`.
2. `pg_dump -Fc` the current dev branch of `withered-cake-82837167` (synthetic users A–R, personas, seeds; no production data, because `production` is still empty) and `pg_restore` it into the new `dev`; `prisma migrate status` must be clean.
3. Re-point `replay-chess-dev` (`DATABASE_URL` with `replay_app`, `DIRECT_URL`), GitHub secrets `WS_DEV_ENV_FILE`, `WORKER_DEV_ENV_FILE`, `PERF_DATABASE_URL`, `apps/web/.env.development.local`, `apps/web/.env.test`, `DEV_DB_HOSTS`, `BACKFILL_ALLOWED_HOSTS` (dev value), the local MCP `neon-replaychess` scope, and the environments table in `CLAUDE.local.md` (owner confirms).
4. Run the dev smoke (`E2E_PUBLIC_ONLY=1` + one signed-in spec) on the new project.
5. **[confirm]** delete the old dev branch of `withered-cake-82837167` ("This command deletes the Neon branch `dev` of the production project. Are you sure?"). From then on nothing can `reset_from_parent` production data into a dev branch (DM §13.1).

Phase specs refer to "the Neon dev branch (CLAUDE.md environments table)" rather than branch ids (consistency R-20); P13 does the same.

---

## 7. API

### 7.1 Routes and middleware rules

| ID | Method · path / rule | Auth | Request → response `data` | Errors | Cache | Rate limit | Idempotency |
|---|---|---|---|---|---|---|---|
| R1 | `GET /api/health` (P1 A1, **edit**) | public | `query { deep?: "1" }` → `HealthData { ok: true, buildId, env, time }`; `deep=1` adds `db { ok, ms }` and **`schema { head: string, applied: number }`** | `unavailable` 503 (deep DB failure, JSON) | `no-store` | P1 `health-deep` 6 / 60 s per IP on `deep` only | GET |
| R2 | `GET /api/cron/daily` (P1, **edit**) | cron bearer (`CRON_SECRET`, timing-safe) | → existing summary + **`opsFreshness: { backupAgeH, backupBytes, backupsTotalBytes, dbSizeMb, queueOldestSec, alerts: string[] }`** | `unauthorized` 401 | `no-store` | — | natural (reads only, plus Sentry messages) |
| R3 | middleware `prelaunchGate` (**new**, `WEB/lib/launch/prelaunch-gate.ts`) | host `next.playchess.tech` only | Allows `/sign-in(.*)`, `/sso-callback`, `/_next/*`, static, `/api/health`, `/api/webhook/*` (rehearsal endpoints) and `/api/internal/*`; otherwise allowed only when `claims.md.role === "ADMIN"` or the session's Clerk user id (`sub`) is in `PRELAUNCH_ALLOWLIST` (comma list of Clerk user ids: the owner's two accounts and the smoke account). Both values are already in the session token, so the gate needs no lookup (§11.3) | denied document → rewrite to the not-found route, **404**; denied API → 404 JSON `not_found` | `no-store`, `X-Robots-Tag: noindex, nofollow` | Vercel Firewall rule on the host (30 / min per IP) | — |
| R4 | middleware `legacyTombstone` (**new**, `WEB/lib/launch/legacy-tombstones.ts`) | public | The path list in §5.5 (exact prefixes, compiled once) → **410** `{ error: { code: "gone", message, requestId } }`, header `x-rc-reload: 1` | — | `no-store` | none (no DB) | — |
| R5 | middleware `nonCanonicalNoindex` (**new**, `WEB/lib/launch/canonical-host.ts`) | public | Host ≠ `www.playchess.tech` and ≠ `playchess.tech` → response header `X-Robots-Tag: noindex, nofollow` (covers `next.`, `*.vercel.app`); `playchess.tech` is redirected by Vercel before it reaches the app | — | unchanged | — | — |

```ts
// CT/http/health.ts (edit)
export const HealthData = z.strictObject({
  ok: z.literal(true), buildId: z.string(), env: z.enum(["local", "test", "dev", "production"]), time: IsoDate,
  db: z.strictObject({ ok: z.boolean(), ms: z.number() }).optional(),
  schema: z.strictObject({ head: z.string().max(200), applied: z.number().int() }).optional(),   // P13
});
// WEB/lib/cron/tasks/ops-freshness.ts
export const OpsFreshness = z.strictObject({
  backupAgeH: z.number().nullable(), backupBytes: z.number().int().nullable(),
  backupsTotalBytes: z.number().int().nullable(), dbSizeMb: z.number(), queueOldestSec: z.number().nullable(),
  alerts: z.array(z.enum(["backup_stale", "backup_shrunk", "backup_storage_high", "db_size_warn", "db_size_high",
    "queue_stale", "scheduler_gap"])),
});
```

Middleware order (P11 §7.4 gains three steps in front): 1 skip list → **2 `nonCanonicalNoindex` (header only)** → **3 `prelaunchGate`** → **4 `legacyTombstone`** → 5 P11 maintenance gate → 6 auth-page rule → 7 P1 matrix. (P11's auth kill switch is read by the auth pages, not by middleware, P11 §7.4.) Steps 2–4 read no Edge Config and no network; tombstones run before Clerk so they cost no handshake. If P1 turned route classes into data (feasibility §7), the three steps are registered from `lib/routes/classes/launch.ts` in the same order.

### 7.2 Socket events and OCI HTTP used (one new Caddy route, no new events)

Names and shapes are P2's final ones (`REPO/docs/plan/phase-02-board-and-live-game.md` §7.4–7.5) and P11's `notice` extension.

| Item | Owner | P13 use |
|---|---|---|
| `POST /internal/broadcast { v: 1, type: "notice", notice }` → `system:notice` | P2 endpoint, P11 type | the window's notice (§5.1). Caddy-blocked; reached only through `docker compose exec websocket node dist/cli/internal.js broadcast …` (signed with the `ops` kid), run by P11's `ops-broadcast.yml` (`-f target=production`) or `notice.ts --via ssh` |
| `POST /internal/broadcast { v: 1, type: "restart", inSeconds }` → `server:restarting { restartAt, resumes: true }` | P2 | every production socket deploy from `deploy-oci.yml` (signed CLI) |
| `POST /internal/drain { v: 1 }` | P2 | manual use only, never in the window |
| `entitlement:changed` on `user:{ref}` | P4 | live checkout and refund checks (§8.3 step 18) |
| `GET /ready` (socket) `{ ready, draining, restored, outboxOldestMs, dbOkAt }` | P2 | uptime, deploy gate, window steps 12–13. No DB probe while idle (it would wake Neon) |
| `GET /worker/ready` (**new Caddy route**, socket box) → worker `GET /ready` (P3: 200 when the engine answers `readyok` and the eval cache is open; no DB call) | P13 route, P3 endpoint | UptimeRobot "Coaching engine" monitor; window step 12; replaces rev 1's metrics read for "worker reachable" |
| Worker `POST /internal/analysis/kick`, `POST /engine/analyse` (P7), `GET /internal/metrics` | P3, P7 | kick and engine: through the socket box's Caddy to `10.42.0.30:3003`, signed by caller `web` (Vercel), and over the VCN by caller `socket` (after a finish). Metrics: the worker's `/internal/metrics` shares its path with the socket's Caddy-blocked one, so production exposes it as the signed `GET /worker/metrics` (§7.7), which the worker serves as an alias of `/internal/metrics` (the signature covers the path, so Caddy must not rewrite it), for P3's `worker-alive.ts` cron task and P12's ADM-11 (handoff H13-7) |
| Worker → socket `POST /internal/emit` | P2/P3 | over the VCN to `$WS_PRIVATE_IP:3002`, caller `worker` (P2's kid `wk`; allow-list `analysis:*`, `import:*`, `weakness:*`, `bank:*`, `compare:*`, `review:*`, `games:changed`, `export:ready`, P2 §7.5.1) |
| Socket and worker `GET /internal/metrics` | P2, P3, read by P12 ADM-11 | P2 blocks `/internal/metrics` at Caddy and lets only the `ops` kid call it. P13's own checks do **not** depend on it (§7.5). P12 must settle how ADM-11 reads it in production (handoff H13-2, Appendix A.3); until then the `V4Admin` health tiles show `unknown`, which P12 already renders |

### 7.3 Webhooks

| Provider | Endpoint (production) | Events | Secret (Vercel prod env) | Set up |
|---|---|---|---|---|
| Clerk (instance `t0wy2xb4vvpw`) | `https://www.playchess.tech/api/webhook/clerk` | `user.created`, `user.updated`, `user.deleted`, `session.revoked`, `session.ended` (API §8.3) | `CLERK_WEBHOOK_SIGNING_SECRET` | Created **in the window** right after the domain move (§8.3 step 14), so no event lands on the old site; Svix retries cover the minute in between. The rehearsal endpoint `https://next.playchess.tech/api/webhook/clerk` is deleted in the same step |
| Dodo (live) | `https://www.playchess.tech/api/webhook/dodo-payments` | `subscription.*`, `payment.succeeded`, `payment.failed`, `refund.*`, `dispute.*` (API §8.2) | `DODO_PAYMENTS_WEBHOOK_KEY` (the **existing** live endpoint's secret, copied, not regenerated) | The path is unchanged, so the endpoint is not edited; preflight checks in the Dodo dashboard that it targets `www` (a webhook does not follow the apex 307) and lists those events |
| Dodo (test, rehearsal) | `https://next.playchess.tech/api/webhook/dodo-payments` | same | `launch` Preview env only | Deleted at T+30 d |

Deliveries refused during the freeze (D6, 403 from the old project's firewall) are retried by Dodo with back-off [V: Dodo's retry schedule and whether 403 is retried; preflight sends one test-mode event to a 403 endpoint to observe it]. Step 14 of §6.5 reconciles every subscription from Dodo anyway, so a lost delivery cannot leave a wrong state.

### 7.4 Cron and scheduled work in production

| Schedule | Runner | Work | New in P13 |
|---|---|---|---|
| `0 4 * * *` UTC (P1 value in `<vercel.json>`) | Vercel cron on project `replay-chess` | P1 prune, P4 reconcile, the **P10** trial-reminder backstop, P10 and P11 tasks | `opsFreshness` |
| future-dated `jobs` rows (`runAt`), planned once a day by `DAILY_PLAN` | worker VM scheduler (P3-D22: in-memory `nextRunAt`, sleep until it or a kick; ≤ 1 fixed wake a day) | analysis, imports, reminders, `HOUSEKEEPING` daily 21:00 UTC (P3) … | `BACKUP` daily 21:00 UTC, `dedupeKey backup:<YYYY-MM-DD>`, planned by the `backup` slice (§7.6). It runs in the `HOUSEKEEPING` drain, so it adds no Neon wake (api-perf AP-08) |
| `17 6 * * *` | GitHub Actions `indexnow.yml` | IndexNow recent URLs | Node 24 |
| Monday 06:00 UTC | GitHub Actions `ops-weekly.yml` (**created in P1**, feasibility F-VER-2) | Quota and cost report (§9.6) | P13 adds the production sources (§7.11) |
| first Monday of Jan/Apr/Jul/Oct | `ops-weekly.yml` | opens a "Quarterly restore drill" issue with the runbook link | yes |
| every 6 h for T … T+14 d (best effort) | GitHub Actions `prod-smoke-schedule.yml` (new) | `@prod-smoke` against `www` (testing §2 P13) | yes; disabled at T+14 d |

### 7.5 `opsFreshness` (daily cron task)

`WEB/lib/cron/tasks/ops-freshness.ts`, registered in P1's ordered task list (one line). Every read is against Postgres, which the cron has already woken; it calls no OCI endpoint, so it does not depend on the metrics path (H13-2).

```sql
-- (1) backup freshness and size trend: audit_logs_category_at_idx (category, at DESC), M4 (consistency R-04)
SELECT at, (meta->>'plainBytes')::bigint AS bytes, (meta->>'backupsTotalBytes')::bigint AS total
FROM audit_logs WHERE category = 'SYSTEM' AND action = 'backup.completed'
ORDER BY at DESC LIMIT 2;
-- (2) storage
SELECT pg_database_size(current_database()) / 1048576.0 AS mb;
-- (3) oldest waiting job a user is waiting for: jobs_ready_idx (priority DESC, "fairSeq", "runAt") WHERE status = 'QUEUED' (P3, R-05)
SELECT extract(epoch FROM now() - min("runAt")) AS sec
FROM jobs WHERE status = 'QUEUED' AND priority >= $1 AND "runAt" <= now();   -- $1 = JOB_PRIORITY.GAME_ENDED
-- (4) recurring rows exist (a dead scheduler shows up as a missing next row)
SELECT count(*) FILTER (WHERE kind = 'BACKUP') AS backup_next, count(*) FILTER (WHERE kind = 'HOUSEKEEPING') AS hk_next
FROM jobs WHERE status = 'QUEUED' AND kind IN ('BACKUP', 'HOUSEKEEPING') AND "runAt" > now();
```

The four statements run in one `$transaction([...])` round trip. Alerts (each a `Sentry.captureMessage` with a level and a fingerprint `ops.<alert>`, so the Sentry rule in §10.2 pages once):

| Alert | Condition |
|---|---|
| `backup_stale` (error) | newest `backup.completed` older than **26 h**, or none at all |
| `backup_shrunk` (error) | newest plain size < 70 % of the previous one (the worker also refuses to delete old copies in that case, §8.6) |
| `backup_storage_high` (warning) | `backupsTotalBytes` > 4 GB (R2 free storage is 10 GB in total, shared with media; feasibility §2.5) |
| `db_size_warn` / `db_size_high` | > 500 MB / > 700 MB (DM §10.3; matters only if production were on Free) |
| `queue_stale` (error) | the oldest job at priority ≥ `JOB_PRIORITY.GAME_ENDED` waiting > 10 min |
| `scheduler_gap` (error) | no future `BACKUP` or no future `HOUSEKEEPING` row |

### 7.6 Background job `BACKUP` (worker)

| Field | Value |
|---|---|
| Kind / lane / priority | `BACKUP` / I (I/O) / `JOB_PRIORITY.HOUSEKEEPING` (0) |
| Trigger | a future-dated `jobs` row with `runAt` = 21:00 UTC, planned by the `backup` slice in `WK/src/scheduler/recurring/backup.ts` when `DAILY_PLAN` (the last step of `HOUSEKEEPING`, P3-D22) collects the next 26 h. The handler's final batch also inserts tomorrow's row (`INSERT … ON CONFLICT ("dedupeKey") DO NOTHING`), so a failed `HOUSEKEEPING` does not stop backups; launch day's first row comes from `seed-recurring.ts` (§8.3 step 12). Manual run: `docker compose exec analysis-worker node dist/cli.js run-job BACKUP --now` (writes a row with `dedupeKey backup:manual:<ts>`) |
| Enabled | `BACKUP_ENABLED=true` on the prod worker only; `false` on dev (feasibility F-NEON-5). With `false` the slice plans nothing and a manual run writes to `replay-backups-dev` |
| `dedupeKey` | `backup:<YYYY-MM-DD>` (P3's `housekeeping:<date>` format) |
| Budget | ≤ 10 min; `nice 19`, `ionice -c3` on the child processes |
| Retries | 3 at 15 min, then terminal `FAILED`, `audit_logs backup.failed`, `Sentry.captureException` (alerted, §10.2); the Sentry cron check-in for `BACKUP` reports `error` |
| Inputs | `BACKUP_DATABASE_URL` (direct, `replay_backup`), `BACKUP_AGE_RECIPIENT` (public key), `R2_BACKUP_*` (an **Object R/W** token scoped to bucket `replay-backups`; R2 has no write-only token, feasibility SEC-7) |
| Steps | §8.6 |
| Writes | R2 object; `audit_logs` row (`category SYSTEM`, `actorKind WORKER`, `action backup.completed`, `meta { key, plainBytes, cipherBytes, sha256, tocEntries, schemaHead, durationMs, backupsTotalBytes }`); `jobs` row `DONE`; tomorrow's row |
| Events | none to users; PostHog none (infrastructure only); Sentry cron check-ins `in_progress` → `ok`/`error` for monitor slug `worker-backup` |

Restore runbook and drill: `REPO/scripts/ops/restore-drill.sh <YYYY-MM-DD>` (owner laptop, private key from the password manager): download → `age -d -i ~/.age/replay-backups.key` → create branch `drill-<date>` from `production` at its oldest available point **[confirm]** (or a scratch branch in the dev project with the owner's explicit OK, since it holds PII) → `pg_restore --clean --if-exists --no-owner` → `verify-counts.ts --mode drill` against production (counts within ±1 % for growing tables, exact for catalogue tables) → delete the branch **[confirm]** → `audit-note.ts backup.restore_drill`.

### 7.7 OCI production topology

| Box | Shape | Private IP | Public | Containers | Ingress |
|---|---|---|---|---|---|
| `replay-chess` (socket) | A1.Flex 1 OCPU / 6 GB / 50 GB | `$WS_PRIVATE_IP` (read with `oci compute instance list-vnics`) | 132.226.190.10 | `websocket` (Node 24, protocol v2, journal volume, `stop_grace_period 30s`), `caddy` | 80, 443/tcp+udp from anywhere; 22 key-only; 3002 from 10.42.0.0/24 (worker → `/internal/emit`, `/internal/load`) |
| `replay-chess-worker` (new, or re-pointed from P3, OD-22) | A1.Flex **2 OCPU / 12 GB / 50 GB** | **10.42.0.30** | ephemeral (egress only) | `analysis-worker` (`ENGINE_POOL=2`, `ENGINE_THREADS=1`, `ENGINE_HASH_MB=256`, `cpus: "1.9"`, `mem_limit: 8g`, `LAG_PAUSE_MS=0`, volumes `evalcache`, `tmp`) | 22 key-only; 3003 from 10.42.0.0/24 only (security list **and** iptables) |
| `replay-chess-dev` | unchanged (1/6/50, websocket + caddy + worker profile; the `worker-idle.slice` cgroup rule is dev-only, feasibility F-OCI-2) | — | 80.225.200.210 | — | — |

Caddy on the socket box (prod values in the bundle `.env`; P2's rules plus P13's two hosts, the worker upstream and `/worker/ready`):

```
{$WS_HOST} {$WS_ALT_HOST} {              # ws-chess.playchess.tech ws-next.playchess.tech (alt removed at T+30 d)
  request_body { max_size 64KB }
  @blocked path /internal/broadcast /internal/drain /internal/metrics      # P2: ops calls go through docker compose exec
  handle @blocked { respond 404 }
  @unsigned { path /internal/* /engine/* /worker/metrics
              not header X-Rc-Sig * }                                       # P2 §7.5.1, feasibility SEC-8
  handle @unsigned { respond 401 }
  @socket path /socket.io/*
  handle @socket { reverse_proxy websocket:3002 }
  @health path /health /ready
  handle @health { reverse_proxy websocket:3002 }
  @workerReady path /worker/ready
  handle @workerReady { rewrite * /ready
                        reverse_proxy {$WORKER_UPSTREAM} }                 # P13: UptimeRobot "Coaching engine"
  @workerMetrics { path /worker/metrics
                   header X-Rc-Sig * }                                       # signed only (the worker verifies caller web)
  handle @workerMetrics { reverse_proxy {$WORKER_UPSTREAM} }   # no rewrite: the HMAC covers the path, so the worker serves
                                                               # the alias GET /worker/metrics (H13-7); P3 worker-alive.ts, P12 ADM-11
  @emit path /internal/emit                  # web → socket fan-out (HMAC verified in the app)
  handle @emit { reverse_proxy websocket:3002 }
  @worker path /internal/analysis/* /engine/*
  handle @worker { reverse_proxy {$WORKER_UPSTREAM} }   # prod 10.42.0.30:3003, dev analysis-worker:3003
  handle { respond 404 }
}
```

Creation script `REPO/scripts/ops/oci-create-worker.sh` (owner runs it; it only creates resources inside the free allowance and refuses otherwise):

```bash
oci compute instance launch --compartment-id "$TENANCY" --availability-domain "tbEj:AP-MUMBAI-1-AD-1" \
  --shape VM.Standard.A1.Flex --shape-config '{"ocpus":2,"memoryInGBs":12}' \
  --display-name replay-chess-worker --image-id "$UBUNTU_2404_ARM_IMAGE" --subnet-id "$A1_EGRESS_SUBNET" \
  --assign-public-ip true --private-ip 10.42.0.30 --boot-volume-size-in-gbs 50 \
  --ssh-authorized-keys-file ~/.ssh/oci_deploy.pub --wait-for-state RUNNING
# Pre-checks: sum of A1 OCPUs after launch ≤ 4, memory ≤ 24 GB, boot volumes ≤ 200 GB, else exit 1.
# "Out of host capacity" → retry every 10 min for up to 48 h (ap-mumbai-1 A1 capacity is often short).
# --existing <ocid>: the VM was created in P3 for the dev worker (OD-22); skip the launch, re-run setup, wipe nothing but the env file.
```

Then `ssh ubuntu@<ip> 'sudo ROLE=worker bash -s' < REPO/deploy/oci/setup-server.sh`; the security list gets the 3003 rule from 10.42.0.0/24. The quotas (D18) are checked, not applied, by `REPO/scripts/ops/oci-quotas.sh --check` (`standard-a1-core-count` = 4, `standard-a1-memory-count` = 24 in the tenancy, every other compute family zeroed); `--apply` exists only for the case where P1 skipped them.

If the worker VM was the dev worker until P13 (OD-22), the dev box gets its co-located worker back first (compose profile `worker`, `WORKER_UPSTREAM=analysis-worker:3003` on dev), so dev keeps analysing while the VM switches to production at T−12 d.

### 7.8 DNS and domains (Cloudflare zone `playchess.tech`, replaychess007; DNS only unless noted)

| When | Record | Value | Note |
|---|---|---|---|
| before T−21 d (P1) | registrar (Hostinger) | renewed ≥ 2 years, auto-renew on, registrar lock on, 2FA on the account | D21; preflight P0 reads the expiry from RDAP (`https://rdap.org/domain/playchess.tech`) |
| keep | `@` A / `www` CNAME | Vercel (216.198.79.1 / `…vercel-dns-017.com`) | the web switch is a Vercel domain move (D2) |
| keep | `clerk`, `accounts`, `clkmail`, `clk._domainkey`, `clk2._domainkey` | Clerk (instance `t0wy2xb4vvpw`) | Path T: unchanged. Path N: new values from the new instance, set in the window |
| keep | MX `route{1,2,3}.mx.cloudflare.net`, `_dmarc` | Email Routing | DMARC to `p=quarantine` at T+30 d if reports are clean (OD) |
| keep | `_vercel` TXT ×4 | ownership tokens | needed for the move and the rollback move |
| T−10 d | `ws-next` A | 132.226.190.10, TTL 300 | rehearsal socket name |
| T−10 d | `next` CNAME | the value Vercel shows for the `replay-chess` project | `next.playchess.tech` lane (D4) |
| T−10 d | `status` CNAME | `stats.uptimerobot.com` (or the D11 fallback's target) | status page (OD-9) |
| T−10 d (unless P5 did it) | `media` | created by R2 custom-domain setup on bucket `replay-chess-media` (**proxied**: R2 custom domains require it), plus a Cloudflare **Transform Rule** on host `media.playchess.tech` adding `X-Content-Type-Options: nosniff` and `Content-Security-Policy: default-src 'none'; img-src 'self'; media-src 'self'` (feasibility SEC-9) | the "never proxy" rule is for Vercel and Clerk records |
| T−10 d | `send` MX 10 `feedback-smtp.us-east-1.amazonses.com`; `send` TXT `v=spf1 include:amazonses.com ~all`; `resend._domainkey` TXT `p=…` | from the Resend dashboard | Resend sending domain; no collision with Email Routing on the apex |
| T−1 d | `ws-chess` A | lower TTL to 60 s (still 44.222.7.147) | — |
| window | `ws-chess` A | **132.226.190.10**, TTL 60 | `REPO/scripts/ops/dns.ts set ws-chess A 132.226.190.10 --ttl 60` (Cloudflare API token scoped to Zone.DNS:Edit on this zone, kept on the owner's laptop) |
| T+3 d | `ws-chess` A | TTL back to 300 | — |
| T+30 d | remove `ws-next`, `next` | — | after the old stack is retired |
| T+30 d or later | DNSSEC | enable in Cloudflare, then add the DS record at Hostinger | only once `dig @ns01.trs-dns.net playchess.tech NS` has shown the Cloudflare pair only for 14 days; never during the launch month, because a wrong DS takes the whole zone down [V Hostinger DS support] |

Vercel project `replay-chess` domains: `www.playchess.tech` (production, primary), `playchess.tech` (308 → `www`), `next.playchess.tech` (Git branch `launch`) until T+30 d.

HSTS is already `max-age=63072000; includeSubDomains; preload` (`WEB/next.config.js` headers), so every new subdomain must serve HTTPS from its first request: Vercel, Caddy, R2 and UptimeRobot all issue certificates automatically; preflight checks each with `curl -sS https://<host>`.

### 7.9 Environment variables (production)

`REPO/ops/env/manifest.ts` (new, WP-B) is the single list: name, services, environments, secret or public, required in production, value source. `WEB/scripts/launch/check-env.ts` builds the **required** set by scanning the code (`process.env.X` in `apps/web`, `apps/web-socket`, `apps/analysis-worker`, `packages/*`), compares it with the manifest, then with the Vercel production env names (Vercel API, names only, never values) and with the names in the rendered OCI env files (checked on the box with `cut -d= -f1`). **One name per secret** (consistency R-09); the manifest lists the retired aliases (`INTERNAL_HMAC_SECRET`, `RC_INTERNAL_KEYS`, `INTERNAL_API_TOKEN`, `TRIAL_LEDGER_PEPPER`, `EMAIL_HASH_PEPPER`, `LINKED_ACCOUNT_KEY`, `TOKEN_ENC_KEY`, `LINK_TOKEN_KEYS`, `WORKER_INTERNAL_URL`, `WORKER_BASE_URL`, `APP_URL`, `POSTHOG_KEY`) so `check-env.ts` **fails** if one appears anywhere. Every production secret is generated fresh (`openssl rand -base64 32`); no dev value is ever reused (ARCH §3.2.3).

| Name | Vercel prod | Socket box | Worker VM | Value / source |
|---|---|---|---|---|
| `NEXT_PUBLIC_APP_ENV`, `APP_ENV` | ✓ | ✓ | ✓ | `production` (required at boot, P1 `lib/env.ts`) |
| `DATABASE_URL` | `replay_app` pooled | `replay_realtime` pooled (`pgbouncer=true&connection_limit=3&pool_timeout=10&connect_timeout=15`) | — | Neon production |
| `WORKER_DATABASE_URL`, `BACKUP_DATABASE_URL` | — | — | `replay_worker` pooled; `replay_backup` direct | Neon production |
| `CLERK_SECRET_KEY`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | `sk_live_…`, `pk_live_…` | — | — | instance `t0wy2xb4vvpw` (a fresh secret key created for `replay-chess`, §11.2) |
| `CLERK_WEBHOOK_SIGNING_SECRET` | ✓ | — | — | prod endpoint (§7.3) |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL`, `…_SIGN_UP_URL`, `…_SIGN_IN_FALLBACK_REDIRECT_URL`, `…_SIGN_UP_FALLBACK_REDIRECT_URL`, `NEXT_PUBLIC_AUTH_APPLE` | `/sign-in`, `/sign-up`, `/home`, `/onboarding`, `off` | — | — | P11 §7.9 |
| `DODO_PAYMENTS_API_KEY`, `DODO_PAYMENTS_WEBHOOK_KEY` | live | — | live API key (account purge, P10) | Dodo live |
| `DODO_PAYMENTS_ENVIRONMENT` | `live_mode` | — | `live_mode` | the SDK defaults to live when unset; set it explicitly anyway |
| `DODO_PRODUCT_ID_MONTHLY`, `…_YEARLY`, `DODO_LEGACY_PLAYER_PRODUCT_ID` | live ids | — | — | `pnpm dodo:setup-products -- --live`; the legacy id is the existing $8 product |
| `DODO_PAYMENTS_RETURN_URL` | `https://www.playchess.tech/checkout/activating` (the P4 path) | — | — | — |
| `BILLING_PAYWALL` | `on` | — | — | — |
| `SOCKET_TOKEN_SECRET` (`kid:base64,…`, first signs) | sign | verify | — | fresh; never shared with `INTERNAL_API_SECRET` (P2, ARCH X16) |
| `INTERNAL_API_SECRET` (key set `kid:base64[,…]`, first entry signs; D19) | `web` (signs) | `web`, `worker`, `ops` (accepted); `socket` (signs kicks); `ops` (the CLI signs with it) | `worker` (signs emits); `web`, `socket` (accepted) | **separate fresh key per caller** (P3-Q16); each service holds only the keys it signs with or accepts; rotation through the kid list (§11.1) |
| `CRON_SECRET` | ✓ | — | — | fresh |
| `NEXT_PUBLIC_WEBSOCKET_URL` | `wss://ws-chess.playchess.tech` | — | — | ARCH X17 |
| `ANALYSIS_WORKER_URL` | `https://ws-chess.playchess.tech` | `http://10.42.0.30:3003` | — | Caddy route / VCN |
| `WS_INTERNAL_URL` | `https://ws-chess.playchess.tech` (emit through Caddy) | — | `http://$WS_PRIVATE_IP:3002` | VCN for the worker |
| `WEB_APP_URL`, `ALLOWED_ORIGINS`, `PROTOCOL_V1` | — | `https://www.playchess.tech`; `https://www.playchess.tech,https://playchess.tech,https://next.playchess.tech` (drop `next` at T+30 d); `off` | `WEB_APP_URL` only | — |
| `NEXT_PUBLIC_SITE_URL` | `https://www.playchess.tech` | — | — | the web origin (R-09) and the canonical host (`WEB/lib/seo.ts:3`); P3 wrote the apex, but `www` saves a redirect hop on every shared link; `NEXT_PUBLIC_SHARE_ORIGIN` no longer exists (P3) |
| `NEXT_PUBLIC_MEDIA_URL`, `PUZZLE_SHARD_BASE_URL` | `https://media.playchess.tech`, `https://media.playchess.tech/puzzles` | — | — | after `media:upload` and the puzzle shard upload (P5 D-17) |
| `R2_ACCOUNT_ID`, `R2_PRIVATE_BUCKET`, R2 keys and bucket names | uploads, exports (read), private bucket | — | backups (`R2_BACKUP_*`, Object R/W on `replay-backups`), exports (write), media | one scoped token per bucket (ARCH §1.12.2); `R2_PRIVATE_BUCKET` listed per consistency 13.1 |
| `BACKUP_ENABLED`, `BACKUP_AGE_RECIPIENT` | — | — | `true`; `age1…` (public key) | private key offline (owner) |
| `ANTHROPIC_API_KEY` | workspace `replay-prod-web` | — | workspace `replay-prod-worker` | P7 OQ6; monthly limits ≈ 2× the expected spend (P7, F-LLM-4) |
| `COACH_DAILY_BUDGET_FLOOR_USD`, `COACH_BUDGET_PER_MEMBER_USD`, `COACH_DAILY_BUDGET_MAX_USD` | `5`, `0.08`, owner's choice | — | same (the worker recomputes the breaker daily) | P7 D6 (replaces rev 1's flat `COACH_DAILY_BUDGET_USD=25`) |
| `COACH_SYSTEM_CACHE_TTL` | `5m` | — | — | P7 (feasibility F-LLM-2) |
| `REVIEW_LLM_TEXT`, `WEAKNESS_JOBS_ENABLED`, `BANK_EXTRACT_ENABLED` | — | — | `on`, `true` (`false` under Launch A), `true` | P7, P6, P5 kill switches |
| `ENGINE_*`, `EVAL_CACHE_*`, `WORKER_ID`, `LAG_PAUSE_MS` | — | — | P3 values, `ENGINE_POOL=2`, `prod-worker`, `0` | separate box, no lag pause |
| `LICHESS_CLIENT_ID` | `playchess.tech` | — | — | P4 D4-20 (no token is stored, P4 D4-21) |
| `SIGNED_COOKIE_SECRET`, `HASH_PEPPER`, `RATE_LIMIT_IP_PEPPER` | ✓ | — | `HASH_PEPPER` (deletion path) | fresh; `HASH_PEPPER` is never rotated (P4: rotation forgets every trial) |
| `RESEND_API_KEY`, `EMAIL_FROM`, `SUPPORT_INBOX` | ✓, `ReplayChess <hello@playchess.tech>`, `hello@playchess.tech` | — | ✓, same | P11 §7.9 |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | public | — | private | fresh pair |
| `NEXT_PUBLIC_POSTHOG_KEY` (web), `POSTHOG_PROJECT_KEY` (OCI, same value), `POSTHOG_FEATURE_FLAGS_KEY`, `POSTHOG_HOST` | ✓ (same project, `app_env` separates) | `POSTHOG_PROJECT_KEY` | `POSTHOG_PROJECT_KEY`; `POSTHOG_PERSONAL_API_KEY` (person delete) | consistency R-09 |
| `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_DSN`, `SENTRY_AUTH_TOKEN` (build) | `replay-chess-web` | `SENTRY_DSN` = `replay-chess-websocket` | `SENTRY_DSN` = `replay-chess-worker` | one name per service env file (R-09) |
| `EDGE_CONFIG` | production store `replay-ops` | — | — | — |
| `MAINTENANCE_MODE`, `NEXT_PUBLIC_STATUS_URL`, `NEXT_PUBLIC_BUILD_ID`, `NEXT_PUBLIC_CONSENT_BAR` | `off`, `https://status.playchess.tech`, from `VERCEL_GIT_COMMIT_SHA`, `on` | — | — | P11 (D15: the consent bar is deploy-scoped, consistency R-14) |
| `MIDDLEWARE_MEMBER_GATE`, `EDGE_DOC_LIMIT` | `off` until §6.5 step 13 passes, then `on`; `off` | — | — | P1 kill switches |
| `PRELAUNCH_ALLOWLIST` | **Preview `launch` only** | — | — | comma list of Clerk user ids |
| **Must be absent in production** | `PERF_AUTH_BYPASS`, `PERF_TOKEN`, `FLAGS_OVERRIDE`, `OPS_OVERRIDE`, `ALLOW_TEST_HOOKS`, `E2E_CLEANUP_SECRET`, `COACH_FAKE_UPSTREAM`, `COACH_FAKE_LLM`, `COACH_LLM_PROVIDER=mock`, `COACH_FAULT_INJECTION`, `CONTACT_EMAIL_DRY_RUN`, `WORKER_FAULT`, `ENGINE=fake`, `R2_PRESIGN_MODE`, `ROUTE_VALIDATE_RESPONSES`, `INTERNAL_TOKEN_COMPAT` (P3 transition switch), `SW_KILL_SWITCH` (except in an emergency build, §8.10), `NEXT_PUBLIC_GA_MEASUREMENT_ID`, `NEXT_PUBLIC_DODO_PLAYER_PRODUCT_ID` (legacy), every retired alias above | | | `check-env.ts` fails if any is set |

The `launch` Preview env differs only in: `DATABASE_URL` (rehearsal branch, `replay_app`), Dodo **test** keys, products and webhook secret, `DODO_PAYMENTS_ENVIRONMENT=test_mode`, `DODO_PAYMENTS_RETURN_URL` on `next.`, `NEXT_PUBLIC_WEBSOCKET_URL=wss://ws-next.playchess.tech`, `ANALYSIS_WORKER_URL` and `WS_INTERNAL_URL` = `https://ws-next.playchess.tech`, `NEXT_PUBLIC_SITE_URL=https://next.playchess.tech`, the rehearsal Clerk webhook secret, `PRELAUNCH_ALLOWLIST`. During rehearsals the OCI prod boxes run with the rehearsal branch's `replay_realtime`/`replay_worker` URLs and `BACKUP_ENABLED=false`; they are switched to production at T−1 d with the containers stopped (§8.2).

GitHub: environment `production` (required reviewer: the owner; deployment branch `main` only) holds `PROD_DIRECT_URL`, `NEON_API_KEY` (snapshots), `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID_PROD`, `OCI_HOST`, `OCI_WORKER_HOST`, `OCI_SSH_KEY`, `WS_ENV_FILE`, `WORKER_ENV_FILE`, `SENTRY_AUTH_TOKEN`, `POSTHOG_PERSONAL_API_KEY` (release annotation). The `ops` kid lives only inside `WS_ENV_FILE`/`WORKER_ENV_FILE`; no workflow or laptop holds it in plain text.

### 7.10 Feature flags and kill switches at launch

| Name | Kind | Production at T+55 | Later |
|---|---|---|---|
| `shell-v3`, `live-protocol-v2`, `game-v3`, `review-v3`, `import-v3`, `onboarding-v3`, `train`, `home`, `weakness`, `coach`, `learn-v3`, `play-hub-v3`, `account-v3`, `tournaments-v3`, `admin-v3` (the variant's subset, §2.4) | PostHog rollout | **100 %** (registry default `production: true` and a PostHog `app_env = production` 100 % condition, so a PostHog outage cannot hide them) | code removed in P13 + 1 release (ALLOC §1.6) |
| `review-share` | PostHog | per owner decision P3-Q2 | — |
| `review-lapsed-read` | PostHog | per B26 (default **off**) | — |
| `analysis-live-prewarm` | PostHog | off | P3 stretch |
| `csp-enforce` | PostHog | off (CSP report-only on production for 7 days) | on at T+7 d if the Sentry CSP report count is explained |
| `auth_custom_flows` (`auth-v3`) | Edge Config `replay-ops.flags` | `true` (`false` under Launch A if the thin P11 ships the prebuilt pages) | — |
| `NEXT_PUBLIC_CONSENT_BAR` (`consent`) | env, deploy-scoped (P11 D15) | `on` | — |
| `notice` | Edge Config | `null` after `notice:clear` | — |
| `MIDDLEWARE_MEMBER_GATE` | env | `on` after the claims check | — |
| `REVIEW_LLM_TEXT`, `WEAKNESS_JOBS_ENABLED`, `BANK_EXTRACT_ENABLED`, `BACKUP_ENABLED` | env (worker) | on / true / true / true | — |
| coach breaker (`COACH_DAILY_BUDGET_FLOOR_USD`, `COACH_BUDGET_PER_MEMBER_USD`) | env (web + worker) | 5 / 0.08 | reviewed at T+7 d against real spend |

### 7.11 CI/CD

**`.github/workflows/release-prod.yml` (new).** Trigger: push to `main` and `workflow_dispatch { mode: release|launch, image_tag? }`. Concurrency group `release-prod`, never cancelled.

| Job | Needs | Environment | Steps |
|---|---|---|---|
| `gate` | — | — | `ci.yml` green on the SHA (`gh api` check-runs); the latest `nightly.yml` run (P1) on `dev` at the same tree is green and `WEB/e2e/quarantine.json` has no expired entry; no `-- kind: contract` migration unless the PR has the `db-contract` label; **enum two-release rule** `tsx WEB/scripts/launch/check-enum-staging.ts --since <last production tag>` (D22: a value added by a migration in this release must not be written by TS code in this release unless the label `enum-staged` attests it is not written yet); **journal compatibility** `pnpm --filter web-socket test:int -- journal-compat` with the previous production tag's fixtures (P2 §7.6, feasibility §9) |
| `db-migrate` | gate | `production` (owner approval) | skipped when `mode = launch` (the window runner migrates); else Neon snapshot via API (`NEON_API_KEY`), `prisma migrate status`, `prisma migrate deploy` with `PROD_DIRECT_URL`, `psql -f DB/sql/grants/*.sql`, `tsx scripts/db/check-grants.ts`, `prisma migrate status` must say up to date |
| `deploy-oci` | db-migrate | `production` | `uses: ./.github/workflows/deploy-oci.yml` with `environment: production`, `targets: socket,worker`, `start: ${{ mode != 'launch' }}`, drain enabled |
| `deploy-web` | deploy-oci | `production` | `vercel pull --yes --environment=production`, `vercel build --prod`, `vercel deploy --prebuilt --prod` (when `mode = launch` the project has no domain yet, so this only builds the deployment the domain will attach to) |
| `smoke` | deploy-web | — | `pnpm --filter web exec playwright test -c playwright.prod.config.ts --grep @prod-smoke` (including `prod-guard` and `telemetry-prod`) against `https://www.playchess.tech` (or the deployment URL in launch mode); `curl` health with `deep=1` and assert `schema.head` = the newest migration folder; `curl https://ws-chess…/ready` and `/worker/ready` |
| `finalize` | smoke | — | `sentry-cli releases finalize web@$SHA` and `deploys new -e production`; PostHog annotation "Release <sha>" |

**`deploy-oci.yml` (rework):** `workflow_call` and `workflow_dispatch` inputs `environment` (`dev`/`production`), `image_tag` (default the SHA; rollback = an older tag), `targets`, `start`, `force` (deploy during a live tournament). Builds `replay-chess-websocket` and `replay-chess-analysis-worker` arm64 images on `ubuntu-24.04-arm` once per SHA; for production it copies `deploy/oci/{docker-compose.yml,Caddyfile}` + `.env` (from `WS_ENV_FILE`) to the socket box and `deploy/oci/worker/docker-compose.yml` + `.env.worker` (from `WORKER_ENV_FILE`) to the worker VM, drains the socket (P2), `docker compose pull`, `up -d` when `start`, polls `/ready` for 2 minutes, and re-deploys the previous tag on failure. The direct push-to-`main` trigger is removed (ARCH §4.3); push to `dev` still deploys dev.

**`prod-smoke-schedule.yml` (new):** `schedule: '0 */6 * * *'` plus `workflow_dispatch`; runs the `@prod-smoke` tag against `www` (no secrets beyond the read-only smoke account's `storageState` for the one signed-in probe); a failure opens an issue labelled `prod-smoke`. Enabled at T+60 min, disabled at T+14 d (testing §2 P13). GitHub schedules are best effort; a missed run is not an alert.

**`ops-weekly.yml` (P1's file; P13 edits the production section):** adds the production Vercel project, the Neon production branch (consumption API: compute seconds, storage, egress; alert at 50 % pro-rata as in api-perf §5 and at 70 % as in OPT §9.4), the two Anthropic production workspaces, Sentry and PostHog usage, OCI CPU p95 for both prod boxes, the Edge Config read counter, total R2 storage from the Cloudflare analytics API [V], and the Stage C triggers of §14.4; plus the quarterly restore-drill issue.

**Repository settings:** branch protection on `main` (PR required, `ci.yml` required, linear history); environment `production` as above; Dependabot (ARCH); the old Vercel project's Git connection is **disconnected** before the first merge to `main` (§8.2 T−1 d), so a merge can never rebuild the old site with new code and old secrets.

### 7.12 Launch and ops scripts (new)

| Script | Purpose | Guards |
|---|---|---|
| `WEB/scripts/launch/preflight.ts` | One table of green/red checks (§8.1): env manifest, DNS answers (`dig @jacqueline.ns.cloudflare.com`), TLS on every host, Clerk instance (token template has `md`, `ini`, `usn`; webhook list), Dodo live products and prices, R2 buckets and lifecycle rules, Edge Config items, Neon roles and grants, migration folder rules (§6.2), OCI `/ready`, Sentry DSNs, UptimeRobot monitors | read-only; prints, never fixes |
| `WEB/scripts/launch/verify-counts.ts` | Old vs new verification (§8.5); writes `launch/reports/<label>.json` and the `launch.data_migrated` audit row | read-only on old |
| `WEB/scripts/launch/backfill-all.ts` | §6.5 orchestrator | `BACKFILL_ALLOWED_HOSTS`; asks before each `--apply` |
| `WEB/scripts/launch/system-users.ts`, `reconcile-billing.ts`, `posthog-alias.ts` | B-L1, B-L2, B-L3 | dry run default |
| `WEB/scripts/launch/url-parity.ts` | §8.7 | GET only, 5 requests a second |
| `WEB/scripts/launch/announce.ts` | Launch emails (§8.8) | dry run default; ≤ 70 per run and per day through P10's email budget; suppression list |
| `WEB/scripts/launch/open.ts` | `notice:clear` + broadcast + `audit_logs launch.opened` + PostHog annotation | asks |
| `WEB/scripts/launch/audit-note.ts` | Writes one `audit_logs` SYSTEM row (drills, milestones) | — |
| `WEB/scripts/launch/warm-cache.ts` | Requests the ISR pages after the switch (§9.3) | GET only |
| `WEB/scripts/launch/check-enum-staging.ts` | The enum two-release gate (D22, §7.11) | read-only (git diff) |
| `REPO/scripts/ops/dns.ts` | Cloudflare record get/set with a diff and a confirmation | token scoped to the zone |
| `REPO/scripts/ops/oci-create-worker.sh`, `oci-quotas.sh` | §7.7 | free-tier arithmetic check |
| `REPO/scripts/ops/restore-drill.sh` | §7.6 | asks before branch create/delete |
| `REPO/scripts/ops/sentry-alerts.ts`, `uptimerobot.ts` | Idempotent creation of the alert rules and monitors in §10 | dry run default |
| `REPO/launch/sql/{old-db-probe,target-check}.sql` | read-only SQL | — |
| `REPO/launch/variant.json` | `{ variant: "full" \| "early" \| "launchA", migrations: string[], backfills: string[], flags: string[] }` (D20) | read by preflight, backfill-all, url-parity and the smoke specs |

---
## 8. Domain logic: the launch procedure

No chess formula or threshold changes in P13: legacy games are graded by the production worker with P3's engine profile `sf18-v1` and the current `GRADING_VERSION`, exactly as on dev, so their labels are comparable with every other game (ARCH X5, research R-DET in `inv-research`). P13's "algorithms" are the launch procedure itself: the gates, the ordered window steps, the verification maths, the backup pipeline, the URL check and the rollback ladder. Every step names its actor: **O** = owner (dashboards with ego-browser as replaychess007; the old Vercel account and Dodo with Claude in Chrome; every destructive step is the owner's explicit "yes"), **C** = Claude running a script on the owner's laptop, **GA** = GitHub Actions.

### 8.1 Preflight (`WEB/scripts/launch/preflight.ts`, run at T−21 d (P0, P16–P20 only), T−7 d, T−1 d and T−15 min)

27 checks. P0 and P16 are **hard blockers**: preflight exits non-zero and G0 cannot pass while either is red.

| # | Check | Pass |
|---|---|---|
| P0 | **Domain** (D21): RDAP for `playchess.tech` shows an expiry ≥ T + 365 d, status `clientTransferProhibited` (registrar lock); the owner ticks auto-renew on and 2FA on the Hostinger account | all true (hard blocker) |
| P1 | Env manifest vs code vs Vercel prod / `launch` Preview / OCI env files (§7.9) | no missing name; no forbidden name |
| P2 | Migration folders (§6.2 rules 1–5) against `launch/variant.json` | as listed; no unexpected contract file; no `key_moments` |
| P3 | `production` branch: 17 migrations, all user tables empty, roles exist with settings, default privileges set, `pg_stat_statements` installed; the project is on Launch with a spend alert | exact |
| P4 | Old DB probe (read-only): migration list, server version, ADB App. A sizes, drift result | recorded; drift → §8.4 decided |
| P5 | Clerk instance `t0wy2xb4vvpw`: in the replaychess007 workspace (Path T), session token template = `{"md": "{{user.public_metadata}}", "ini": "{{user.first_name}}", "usn": "{{user.username}}"}`, paths `/sign-in`, `/sign-up`, after sign-in `/home`, after sign-up `/onboarding`, email verification by code, bot and attack protection on, Google OAuth with production credentials, allowed origins `https://www.playchess.tech`, `https://playchess.tech`, `https://next.playchess.tech`; webhook endpoints: only the rehearsal one before the window | all true |
| P6 | Dodo live: KYC and business verification approved; products "Coaching monthly" $4.99 and "Coaching yearly" $50 (USD, recurring, tax category `saas`) with ids equal to the env; the legacy $8 product exists and is not purchasable from the new pricing page; the live webhook endpoint targets `https://www.playchess.tech/api/webhook/dodo-payments` with the events in §7.3; a live checkout session with `subscription_data.trial_period_days = 7` can be **created** (not paid) from the `launch` lane with live keys in a one-off script | all true |
| P7 | R2: buckets `replay-chess-media` (custom domain `media.playchess.tech` active, puzzle shards and media uploaded, `HEAD` on 5 sample objects = 200 with `Cache-Control: public, max-age=31536000, immutable`), `replay-backups` (private; lifecycle: `neon/production/daily/` 14 d, `neon/production/weekly/` 28 d, `legacy/` 30 d), `replay-uploads`, `replay-exports` (lifecycle 7 d) | all true |
| P8 | Edge Config production store `replay-ops` connected to `replay-chess`: `{ notice, flags: { auth_custom_flows: true } }` (per the variant); `NEXT_PUBLIC_CONSENT_BAR=on` in the Vercel production env (P11 D15, consistency R-14) | — |
| P9 | DNS answers from `jacqueline.ns.cloudflare.com` for every row of §7.8; HTTPS on `next`, `ws-next`, `status`, `media` | — |
| P10 | OCI: both prod boxes `RUNNING`; `https://ws-next.playchess.tech/ready` → `ready: true` and `/worker/ready` → 200; a signed kick through Caddy → 202, an unsigned one → 401 from Caddy, `/internal/metrics` → 404 from outside; the production kids (`web`, `ops`, `wk`, `ws`) differ from every dev key (compared as SHA-256 fingerprints, never values); A1 totals 4 OCPU / 24 GB, boot volumes 150 GB; quotas set; PAYG budget alert active | — |
| P11 | Sentry: three projects with DSNs in place; alert rules from `sentry-alerts.ts --check`; UptimeRobot monitors and status page from `uptimerobot.ts --check` | — |
| P12 | Resend: domain `playchess.tech` verified; a test email to replaychess007@gmail.com passes SPF, DKIM and DMARC (Gmail "Show original") | — |
| P13 | Legal: Terms, Privacy (processors and retention), Cookies and refund text final on `next.` (OD-16) | owner ticks |
| P14 | Old Vercel project: Git integration disconnected; firewall rules prepared (disabled); its cron jobs listed (to disable at step 1); the second `_vercel` token for the rollback move exists. New project: cron jobs disabled until step 19 (from T−1 d) | — |
| P15 | No live or scheduled tournament on the old site inside the window (old admin page) | — |
| P16 | **Vercel plan** (D17): the replaychess007 team is on Pro, Skew Protection on, spend cap set; preflight fails if the team is on Hobby while `DODO_PAYMENTS_ENVIRONMENT=live_mode` is set on `replay-chess` | hard blocker |
| P17 | **Neon** (D16): production history window = 7 days (Neon API `history_retention_seconds = 604800`); the dev and E2E branches live in their own project (§6.7); no `rehearsal-*` branch older than its rehearsal | all true |
| P18 | **Licences and assets** (feasibility LIC-2, LIC-5, LIC-6): `WEB/THIRD_PARTY.md` lists a source and licence for every file under `public/sounds/`, `public/chess-icons/`, the engine files and the legend portraits (or the portrait shows initials); `COPYING` and `SOURCE.txt` answer 200 next to the hashed Stockfish files; `license-checker --failOn "AGPL;GPL"` over production npm dependencies is green with `stockfish` allow-listed | all true |
| P19 | **Chess.com terms** (P4 OD-2, feasibility F-API-4): the owner's legal review of the User Agreement is recorded; until then `images.chesscomfiles.com` is absent from CSP `img-src` and `remotePatterns` and avatars render as initials (P4 D4-26) | owner ticks |
| P20 | **Public repo hygiene** (feasibility SEC-1, SEC-2): `REPO/CLAUDE.md` on `main` contains no IPs, registrar or account emails, Neon ids or dev URLs (they are in the gitignored `CLAUDE.local.md`); gitleaks with `--log-opts=--all` finds no live secret; the `sk_test_` key from `k8s/` is revoked | all true |
| P21 | **Coach cancellation** (api-perf AP-02, P7 D19): `<vercel.json>` the project reads has `supportsCancellation: true` and `maxDuration: 60` for the two coach streaming routes; the deployed abort test on the `launch` deployment passed | both true |
| P22 | **Enum two-release rule** (D22): no Vercel production deployment and no production image tag older than the launch SHA's migration head exists; `check-enum-staging.ts` passes on the launch SHA against `dev`'s previous release | true |
| P23 | **Journal compatibility** (feasibility §9): `journal-compat.int.test.ts` green for the launch tag against the R#1 tag's journals, both directions | true |
| P24 | **Variant** (D20): `launch/variant.json` matches the merged phases (every expected folder, flag and backfill script exists; nothing outside the variant is enabled) | exact |
| P25 | **Test and CI tooling from P1** (testing §4): latest `nightly.yml` green; `quarantine.json` empty; `prod-guard.spec.ts` passes against the `launch` deployment; P1's interim backup workflow (api-perf DB-02) green for the last 7 nights | all true |
| P26 | **Supporting phase settings**: P10's durable email budget reports today's count; P7's breaker env set (`COACH_DAILY_BUDGET_FLOOR_USD`, `COACH_BUDGET_PER_MEMBER_USD`); the Anthropic production workspaces have monthly limits; OCI PAYG with the $1 budget alert and quotas verified (`oci-quotas.sh --check`, D18) | all true |

### 8.2 Calendar before the window

| When | Actor | Task |
|---|---|---|
| T−21 d | O + C | OD-1 … OD-24 answered (§14.3), including the variant (OD-21), written to `launch/variant.json`. Preflight P0, P16–P20 (domain, Vercel Pro, Neon Launch + history, licences, Chess.com terms, repo hygiene). Vercel Pro, Neon Launch. Verify the P1 owner tasks (PAYG + quotas, dev Neon project, `CLAUDE.local.md`). Clerk app transfer (Path T) or Path N decision. Start the worker-VM retry loop unless it exists (OD-22) |
| T−14 d | C + O | Dev split fallback (§6.7) only if P1 slipped. Old-DB probe and drift check (§6.4); the real counts go into the window checklist and decide OD-20 (Resend plan). **Rehearsal 0** on a local Docker Postgres 17 (restore + `migrate deploy` + backfill dry runs) |
| T−12 d | O + C | OCI worker VM created, or re-pointed from dev with `oci-create-worker.sh --existing` after the dev box got its co-located worker back (§7.7, OD-22); prod socket box set up (`ROLE=socket`, iptables, security list 80/443 + 3002 from the VCN); both deployed from `deploy-oci.yml` (`environment: production`, `start: true`) against a throwaway rehearsal branch |
| T−10 d | O + C | DNS adds (§7.8): `ws-next`, `next`, `status`, `media`, Resend records. Vercel project `replay-chess` created (root directory, install and build commands, Node 24.x, region `iad1`, ignored-build-step: build only `main` and `launch`, Skew Protection on, spend cap), its env (§7.9), `next.playchess.tech` on branch `launch`. Edge Config production store. Sentry projects and alerts, UptimeRobot monitors and status page. Anthropic production workspaces with spend limits. Dodo live products (`pnpm dodo:setup-products -- --live`) |
| T−7 d | O + C | **Code freeze** on `dev` for the launch SHA (only launch fixes, each with a rehearsal re-run of the touched step). Clerk production settings (P5) and the rehearsal webhook. Create the fresh Clerk secret key for `replay-chess` (§11.2). Capture the R#1 socket image's journals as fixtures for P23. **Rehearsal 1** (§8.9) |
| T−5 d | O | Privacy policy and terms final on `next.` (OD-16); announcement email batch A sent (§8.8): "On <date> 04:00 UTC Replay Chess moves to its new coaching app" |
| T−4 d | O | Announcement batch B |
| T−3 d | O + C | **Rehearsal 2** including every rollback drill (§8.9). Roles, default privileges and `pg_stat_statements` on `production` (§6.3). Status page maintenance scheduled for T…T+60 min. Release PR `dev` → `main` opened (R16) |
| T−1 d | O + C | Preflight. Release PR `dev` → `main` merged (expected conflicts in the P1 hot-fix files resolve to `dev`); `release-prod.yml` in `mode: launch`: OCI images pulled on both prod boxes with **containers stopped** (`start: false`), env files now point at `production`; the Vercel production deployment built (no domain). `ws-chess` TTL → 60 s. **Cron jobs disabled on `replay-chess`** (Settings › Cron Jobs), because the production deployment exists from now on and its daily cron would otherwise run against a database that is still at migration 17. Prod Edge Config `notice` = `scheduled`. Final old full dump taken as an extra safety copy (read-only) |
| T−60 min | O | Go/no-go G0 (§8.12) |

### 8.3 The window (target 60 minutes, budget 90; planned Sunday 04:00 UTC unless PostHog shows a quieter hour, OD-5)

| Step | T+ | Actor | Action | Success check | If it fails |
|---|---|---|---|---|---|
| 1 | 0 | O | Old Vercel project → Firewall → enable rule **freeze-api** (`path starts with /api/` → Deny) and **freeze-pages** (every other non-asset path → Redirect 307 `https://status.playchess.tech`); disable the old project's cron jobs, if it has any, so nothing writes to the old database after the final dump. Status page announcement "in progress" | `curl -s -o /dev/null -w '%{http_code}' -X POST https://www.playchess.tech/api/user/sync` → 403; `curl -sI https://www.playchess.tech/pricing` → 307 to the status page | Fallback hotfix on the old project (D6), +10 min |
| 2 | 2 | C | Final dumps (§6.4): full (archive, age-encrypted, to R2 `legacy/`) and data-only | `pg_restore --list` OK; sha256 recorded in the report | Retry; abort → R0 |
| 3 | 6 | C | `target-check.sql`; Neon snapshot `prelaunch-empty` of `production` (API) | 17 migrations, zero rows | **Stop and ask** |
| 4 | 8 | O **[confirm]** / C | Data-only restore into `production` | exit 0 | Neon restore from `prelaunch-empty`, retry once; else R0 |
| 5 | 10 | C | `verify-counts.ts --stage restored` (§8.5) | all checks pass | Restore from snapshot; investigate; else R0 |
| 6 | 12 | O **[confirm C3]** | — | the owner says yes to the contract pair | Without it the launch SHA cannot deploy (the folders are in history) → R0 |
| 7 | 12 | C | `prisma migrate deploy` (direct URL, owner role) then `prisma migrate status` | "Database schema is up to date"; `schema.head` = `…_m13a_jobkind_backup` | Read the failing migration; fix forward with a new migration only if trivial (lock timeout → retry); else restore `prelaunch-empty` + R0 |
| 8 | 15 | C | `psql -f DB/sql/grants/*.sql`; `check-grants.ts` | 0 missing, 0 extra | Fix the grant file; re-run |
| 9 | 17 | O + C | `backfill-all.ts` steps 1–15 (§6.5): dry run, then apply each | every verification passes | Stop at the failing step; fix data with a reviewed one-off SQL **[confirm]** or skip if the owner accepts (recorded); a structural failure → R0 |
| 10 | 30 | C | `verify-counts.ts --stage upgraded` (counts unchanged, new tables as expected); `audit_logs launch.data_migrated` | pass | as 9 |
| 11 | 34 | C | Neon snapshot `postlaunch-ready` (Launch keeps both snapshots; if production were still on Free, which keeps one manual snapshot, `prelaunch-empty` is deleted first, feasibility F-NEON-5) | — | — |
| 12 | 36 | GA/C | `deploy-oci.yml` `workflow_dispatch` (production, launch tag, `start: true`) on both boxes; then `seed-recurring.ts` inserts today's first `HOUSEKEEPING` and `BACKUP` rows (21:00 UTC) and kicks the worker | `curl https://ws-next.playchess.tech/ready` → `ready: true`; `curl https://ws-next.playchess.tech/worker/ready` → 200; `SELECT kind, "runAt" FROM jobs WHERE status = 'QUEUED' AND kind IN ('BACKUP','HOUSEKEEPING')` → one future row each | Fix env; else R0 (nothing public yet) |
| 13 | 38 | C | `dns.ts set ws-chess A 132.226.190.10 --ttl 60`; `ssh deploy@132.226.190.10 'cd /opt/replay-chess && docker compose restart caddy'` | `dig @1.1.1.1 ws-chess.playchess.tech` → 132.226.190.10; `curl https://ws-chess.playchess.tech/ready` (valid certificate) → ready | Re-run the restart; DNS back to 44.222.7.147 → R0 |
| 14 | 38–40 | O / C | `notice:set --env production --mode active --via ssh` (already `scheduled`; the Edge Config write plus the signed `system:notice` broadcast, §5.1); wait **120 s** (P11's `scheduled` memo). **Domain move** at T+40: Vercel `replay-chess` → add `www.playchess.tech` and `playchess.tech` (308 → `www`) → verify with the `_vercel` TXT (MCP `add_project_domain` + `verify_project_domain`). Clerk: create the production webhook endpoint (§7.3), delete the rehearsal endpoint, apply Path N DNS only if Path N | `curl -s https://www.playchess.tech/api/health` → `buildId` = launch SHA, `env: production`; signed-out `/` is the new landing; app routes → `V3Maintenance` (503) | Domain not moving after 10 min → R1 (move back is a no-op if it never left; unfreeze) |
| 15 | 43 | O | Admin smoke on production (owner's existing account, ADMIN bypass): sign in with Google → `/home`; `/games` = the old count; open a legacy game → analysis runs; `/admin` counts; `/@<username>`; `/settings/membership` (owner's state); a bot game → review; a friend game between owner and the smoke account on phone + desktop; `/pricing` live prices; open the live checkout page (do not pay yet) | every item | Fix forward with a Vercel deploy if ≤ 15 min, else R1 |
| 16 | 50 | C | `reconcile-billing.ts` re-run (catches webhook retries that arrived after step 9); `MIDDLEWARE_MEMBER_GATE=on` (Vercel env + redeploy of the same build, ≈ 2 min) after the 20-user claims sample passes | 0 differences; gate on | Keep the gate off (page-level checks still hold) and fix later |
| 17 | 55 | O | Go/no-go G2 → `open.ts` (`notice:clear` through `notice.ts --via ssh`: Edge Config `resolved` and the signed `system:notice` broadcast; `audit_logs launch.opened`; PostHog annotation); enable `prod-smoke-schedule.yml`; `pg_stat_statements_reset()`. O stops the old socket process on the AWS box (`ssh` to 44.222.7.147, `docker stop` / `systemctl stop`, whichever the old box uses), so stale resolvers cannot reach a live v1 server; R1 starts it again | after 90 s an incognito member sees `/home`, not maintenance | `notice:set` again; investigate |
| 18 | 56 | O | Real money path: the owner starts the Coaching monthly **trial** with a real card on their own account → `/checkout/activating` → trial member. C moves that subscription's `next_billing_date` to now + 5 min with the Dodo live API (`subscriptions.update`, the documented way to force a renewal) → the $4.99 charge runs → `payment.succeeded` / renewal webhook → active. O refunds it in the Dodo dashboard → refund webhook → access per the P10/ARCH rule (refund revokes) → cancels. The smoke account starts its trial with the same card and cancels at once ("Trial ends on <date>. You won't be charged.") | each webhook processed < 1 min (Sentry span, `webhook_events` row); the charge and refund appear in the Dodo live dashboard | Checkout or webhooks broken > 30 min → R1 before the point of no return (OD-11) |
| 19 | 60 | O / C | Status page "resolved"; **cron jobs re-enabled on `replay-chess`** (the next `0 4 * * *` run is tomorrow's, so `opsFreshness` first reports after the first backup); old project firewall stays on; IndexNow `scope=all` (`gh workflow run indexnow.yml -f scope=all`); Google Search Console: submit `sitemap.xml`, `sitemap-legends.xml`, `sitemap-openings.xml`; `warm-cache.ts` | — | — |
| 20 | 60–120 | C | After-opening backfills 16–19 (§6.5); launch email "We're live" to the members first (≤ 70 inside P10's budget, D15) | job counts as predicted; the worker drains; `queue_stale` silent | Pause the jobs (kill switch) if the queue starves live games |

### 8.4 Transit path when the old schema drifted

If the drift check (§6.4) lists objects the target at 17 does not have:

1. `docker run -d --name rc-transit -e POSTGRES_PASSWORD=pw -p 55434:5432 postgres:17-alpine`.
2. `pg_restore --no-owner --no-privileges -d postgresql://postgres:pw@localhost:55434/postgres old-full-<ts>.dump` (schema + data).
3. Apply a reviewed `REPO/launch/sql/transit-fixups.sql` that makes the transit schema equal to migration 17 (for example `ALTER TABLE … DROP COLUMN <drifted>` after copying anything worth keeping into a report). Only the transit copy is touched.
4. `prisma migrate diff --from-url <transit> --to-migrations <17> --exit-code` → 0.
5. `pg_dump --data-only …` from the transit database replaces `old-data-<ts>.dump` in step 2 of the window. The full original dump stays the archive.

The fix-up file is written and reviewed in rehearsal 0, so the window never improvises SQL.

### 8.5 Verification maths (`verify-counts.ts`)

For every table `t` in the old database except `_prisma_migrations` and `matchmaking_queue`:

1. **Counts:** `count_old(t) = count_new(t)`.
2. **Identity digest:** `md5(string_agg("referenceId", ',' ORDER BY id))` equal (tables without `referenceId` use `id`). Detects a missing or shifted row, not only a count change.
3. **Content digest** on catalogue tables (`openings`, `legends`, `chess_positions`): `md5(string_agg(md5(row(t.*)::text), ',' ORDER BY id))` over the columns that exist in both schemas at 17. `openings` must also equal the TSVs in `WEB/public/openings/{a..e}.tsv` (3,641 rows by `(eco, name, pgn)`).
4. **Sequences:** for each serial column, `last_value ≥ max(id)` (`pg_sequences`), so the first insert never collides.
5. **Foreign keys:** every FK in the target schema has zero orphans (`LEFT JOIN … WHERE parent.id IS NULL`), plus `games."chessPositionId"` orphans counted (no FK there before M2, DM B0).
6. **Billing fields:** for every user with `subscriptionId`, the tuple (`subscriptionStatus`, `currentPeriodEnd`, `cancelAtPeriodEnd`, `plan`, `dodoCustomerId`) equal old vs new (before step 14 of §6.5 changes them on purpose).
7. **Stage `upgraded`** (after migrations and backfills): (1)–(2) still hold for the copied tables; `count(game_players)` = completed games × member sides with a known colour; `count(linked_accounts WHERE provider = 'CHESSCOM')` = `count(chess_com_profiles)`; every non-system user has a username; `count(tournaments WHERE slug IS NULL)` = 0 (Full variant only). The checks that apply follow `launch/variant.json` (§2.4).
8. **Report:** `REPO/launch/reports/<label>.json` = `{ label, at, sourceProject, targetBranch, tables: { name: { old, new, digestOk } }, sequencesOk, orphans, billingDiffs, durationMs }`. No row values are ever written to the report.

Expected floor values (CLAUDE.md, the `V4Admin` board): users ≥ 104, games ≥ 378, openings = 3,641, legends = 51, tournaments = 18. The real numbers come from the T−14 d probe and are pasted into the window checklist.

### 8.6 Backup pipeline (`WK/src/backup/pgdump.ts`)

```
pg_dump --format=custom --compress=6 --no-owner --no-privileges --dbname="$BACKUP_DATABASE_URL"
   │ (nice 19, ionice -c3)
   ├─tee─► pg_restore --list  → count TOC entries; require one TABLE DATA entry per table in DB/sql/grants.matrix.json
   └─────► age -r "$BACKUP_AGE_RECIPIENT"  → sha256 (in-stream)  → R2 multipart PutObject
                                            key  neon/production/daily/<YYYY-MM-DD>.dump.age
                                            meta sha256, plain-bytes, toc-entries, schema-head, pg-dump-version
```

- **Weekly copy:** on Sundays (UTC), `CopyObject` daily → `neon/production/weekly/<YYYY>-W<ww>.dump.age` (ISO week).
- **Retention:** R2 lifecycle rules (14 d daily, 28 d weekly) do the deleting. The handler also lists both prefixes and deletes anything older than the rule (belt and braces), **except** when today's plain size is below 70 % of yesterday's: then it deletes nothing, writes `backup.completed` with `meta.suspectShrink = true` and raises `backup_shrunk` (ARCH §2.3.9). Max age of any copy: 28 days, which keeps "Backups clear within 30 days" true (D9).
- **Storage total:** the retention listing also sums every object under `neon/production/` into `backupsTotalBytes` (written to the audit row; `opsFreshness` warns above 4 GB, §7.5).
- **Bucket lock** [V availability, Q12]: R2 bucket-lock rules on `replay-backups` (prefix `neon/production/daily/` 14 d, `weekly/` 28 d, `legacy/` 30 d) make early deletes fail even with the worker's token; the handler's own deletes only ever target copies older than the lock, so they succeed. The lock never exceeds 28 days for live data, which keeps "Backups clear within 30 days" true.
- **Failure modes:** `pg_dump` non-zero, TOC check short, upload error → the job fails and retries (15 min × 3); nothing partial stays (`AbortMultipartUpload`). Each attempt sends Sentry cron check-ins for `worker-backup` (`in_progress`, then `ok` or `error`), so a run that never starts is also caught (missed check-in).
- **Next row:** `DAILY_PLAN` plans tomorrow's `backup:<date>` row through the `backup` slice; the handler's final batch (the audit row, `jobs` DONE) inserts it too, and a failed run does the same, so neither one bad night nor one failed `HOUSEKEEPING` stops the schedule (§7.6).
- **Neon cost:** a dump reads the whole database once; at about 50 MB that is ≈ 1.5 GB of egress a month, inside the Launch allowance [V] (on Free it would use ≈ 30 % of the 5 GB, another reason for D16).

### 8.7 URL parity (`url-parity.ts`)

1. **Inventory (T−10 d, from the live site):** fetch `https://www.playchess.tech/sitemap.xml`, `/sitemap-legends.xml`, `/sitemap-openings.xml` (20 + 20 + 3,641 URLs), add the fixed legacy patterns (`/analysis/<sample id>`, `/profile/<sample ref>`, `/position/<sample ref>`, `/try/<x>`, `/game/<sample ref>`, `/join/<sample ref>`, `/tournament/<sample ref>`), save `REPO/launch/url-inventory.json`.
2. **Check (rehearsals on `next.`, then production at T+60 min and T+24 h):** for each URL on the target host, `GET` with redirects off, follow at most 2 hops.

| Class | Rule | Pass |
|---|---|---|
| `ok` | 200 on the same path | — |
| `moved` | one 301/308 to a 200 page whose `<link rel="canonical">` equals the final URL | — |
| `gated` | members-only legacy paths (`/game/*`, `/join/*`) → 307 to `/sign-in?redirect_url=…` | allowed |
| `chain` | more than one redirect hop | **fail** |
| `soft404` | 200 with the not-found template, or a redirect to `/` | **fail** |
| `gone` | 404/410 | **fail** for sitemap URLs; allowed only for the documented removals (none expected) |

Pass criterion: 0 failures among the 3,681 sitemap URLs. Rate: 5 requests a second (≈ 13 minutes on `next.`, where the catalogue is ISR and warms as it goes).

### 8.8 Launch emails (`announce.ts`)

- Recipients: `users WHERE "isActive" AND email IS NOT NULL AND "googleId" NOT LIKE 'system:%'`, minus a suppression list (`REPO/launch/email-suppress.txt`, hashed), ordered members first, then by `createdAt`.
- Batching: ≤ 70 per run and per UTC day, taken from P10's durable daily email budget (the logged counter of feasibility F-NEON-3), so P10's 20-a-day transactional reserve stays free (D15; Resend free: 100 a day [V]). With Resend Pro for the launch month (OD-20) the cap is the budget's Pro value. The script stores the last sent `id` in `REPO/launch/reports/announce-<campaign>.json` and resumes from it; 250 ms between sends; a full budget stops the run without error.
- Content: plain text (P11's email rules), from `ReplayChess <hello@playchess.tech>`, reply-to `hello@playchess.tech` (Cloudflare Email Routing forwards it). Campaign A (T−5/−4 d): date, "sign-in, games and membership carry over", link to the new privacy policy; campaign B (T+60 min, members first): "We're live", what's new, how to link Chess.com and Lichess. Copy files `WEB/content/emails/launch-{a,b}.txt`.
- Legal basis: a service notice about the account the user already has (no marketing opt-in needed); it carries the privacy policy change notice.

### 8.9 Rehearsals and rollback drills

| Rehearsal | Where | What | Budget / pass |
|---|---|---|---|
| R#0 (T−14 d) | owner laptop, Docker Postgres 17 | §6.4 restore at 17 → `migrate deploy` → `backfill-all.ts --dry-run` and `--apply` → `verify-counts.ts` against the old DB | runs end to end; produces the expected counts and the transit fix-ups if any |
| R#1 (T−7 d) | Neon branch `rehearsal-1` (child of `production`, empty at 17); Vercel `launch` → `next.playchess.tech`; OCI prod boxes on `rehearsal-1`; `ws-next` | Window steps 2–12 and 15–16 exactly, with a fresh **read-only** dump of the live DB (no freeze); then the e2e `rehearsal` project (§12.3, including `rehearsal-legacy-client.spec.ts`), the manual checklist (§12.6), `url-parity.ts`, the pre-launch k6 runs (§9.5), the deployed coach-abort test (P21); the R#1 socket image's journals are saved as P23 fixtures | steps 2–11 ≤ 35 min; all checks green |
| R#2 (T−3 d) | `rehearsal-2` (R#1's branch deleted **[confirm]** first: it holds PII) | Same as R#1, timed, plus the drills below | steps 2–11 ≤ 30 min; every drill within budget |

| Drill (in R#2) | How | Budget |
|---|---|---|
| D-web-move | Move `next.playchess.tech` from `replay-chess` to the old Vercel project and back with the `_vercel` TXT (the same mechanics as D2 and R1) | each direction ≤ 5 min |
| D-dns | `dns.ts` flip `ws-next` to 44.222.7.147 and back, `docker compose restart caddy`, until `curl https://ws-next…/ready` passes with a valid certificate | ≤ 5 min |
| D-vercel | Instant Rollback of `replay-chess` between two production deployments (Pro allows any earlier one) | ≤ 1 min |
| D-oci | `deploy-oci.yml` with the previous `image_tag` (the R#1 tag) on both prod boxes during a live game on `next.`, then forward again; the older reader skips the newer journal and restores from the DB, the newer reader restores the older journal (P2 §7.6) | ≤ 4 min each way, 0 plies lost |
| D-neon | Restore `rehearsal-2` from its snapshot taken after step 11 | ≤ 10 min |
| D-freeze | Enable and disable the two freeze rules on the old project for 60 s at a quiet hour (announced on the status page) | rules act within 30 s |
| D-sw | Build the P11 emergency service worker (`SW_KILL_SWITCH=1`) as a `launch` Preview deployment; a browser with the normal SW on `next.` loads it, every cache is deleted and the SW unregisters; redeploy the normal build | ≤ 10 min to a clean browser |
| D-notice | `notice.ts --via ssh` against the prod socket box with `ws-next`: `system:notice` reaches an open `next.` tab, and `queue:join` acks `maintenance` (P11) | broadcast ≤ 5 s |

Each rehearsal writes `REPO/launch/reports/rehearsal-<n>.json` (`{ steps: [{ id, startedAt, durationMs, ok, note }], drills: [...], counts, k6, urlParity }`).

### 8.10 Rollback ladder

| Level | Trigger (any one) | Steps | Time | Data consequence |
|---|---|---|---|---|
| **R0 abort** (before step 14) | a failed check that cannot be fixed inside the 90-minute budget | Disable the old firewall rules; status page "postponed"; leave `production` as is (it is not public) | ≤ 2 min | none: the old DB was never written to after the freeze; production is emptied later from `prelaunch-empty` **[confirm]** before the next attempt |
| **R1 back to the old stack** (after step 14, before the point of no return) | sign-in broken > 10 min; checkout broken > 30 min; 5xx > 5 % for 10 min that an R2 cannot fix; a data-integrity error; socket down > 15 min | 1 `notice:set` active on the new app. 2 Old Vercel account: add `www` and apex back, verify with its `_vercel` token (drilled, D-web-move). 3 `dns.ts` `ws-chess` → 44.222.7.147 and start the old socket process on the AWS box again (stopped at step 17). 4 Disable the old firewall rules. 5 Clerk: re-point nothing (Path T: same instance; delete the new webhook endpoint). 6 Dodo: no change (same path); trigger "resend" for events since T+40 in the Dodo dashboard so the old site applies them. 7 Status page note | ≤ 15 min | Writes made on the new stack after T+55 are lost to the old site: new sign-ups (they can sign in again; the old `user/sync` creates their row), games played, and subscriptions bought (re-applied from Dodo by step 6 and the old site's refresh). The new production branch is kept for analysis |
| **R2 web rollback** (any time) | a bad web deploy | Vercel Instant Rollback to the previous production deployment (Pro: any earlier one, all ≥ the launch SHA, D22) | ≤ 1 min | none |
| **R2b emergency service worker** (any time) | a broken service worker keeps serving a bad shell (feasibility §9, P11) | Deploy the `SW_KILL_SWITCH=1` build (drilled, D-sw): `skipWaiting`, delete every cache, unregister, reload clients; then deploy the fixed normal build | ≤ 10 min plus each browser's next visit | none (caches only) |
| **R3 OCI rollback** (any time) | a bad socket or worker image | `deploy-oci.yml` `workflow_dispatch` with the previous `image_tag` (journals keep live games; the journal format version makes an older image skip newer files, P2 §7.6); never during a live P12 arena: roll forward or cancel the arena | ≤ 4 min | none |
| **R4 data restore** (any time, owner confirms) | data corruption | Neon instant restore of `production` to a timestamp inside the 7-day history window (D16), or restore `postlaunch-ready`, or the latest R2 dump into a new branch and switch the connection strings (`docs/runbooks/restore-from-backup.md`) | 30–60 min | everything after the restore point is replayed from Dodo (billing) or lost (games) |

**Point of no return (OD-11):** the first real charge on the new stack that is not a refunded test (owner purchase at step 18 is refunded) **or** T+72 h, whichever is first. After it, R1 is retired: rotate the old Neon project's role passwords (read-only from then), stop the AWS socket instance, keep the old Vercel project with the firewall rules on.

### 8.11 Hypercare and retirement

| When | Who | Check |
|---|---|---|
| T+0 … T+2 h | O + C, continuously | Sentry production issues (new = 0 unexplained), 5xx rate, `/ready` and `/worker/ready`, `queue_stale`, webhook deliveries, Neon compute (no runaway), Vercel function errors (`get_runtime_errors`) |
| T+2 h, T+6 h, T+24 h | C | `url-parity.ts` on production; Speed Insights and the PostHog hypercare dashboard; `pg_stat_statements` top 20 (§9.2); Anthropic spend against the breaker; `prod-smoke-schedule.yml` runs green; the first `BACKUP` run at 21:00 UTC on launch day and its `worker-backup` check-in |
| T+24 h | O + C | Restore drill from the first backup (§7.6) → report; then disable P1's interim backup workflow (api-perf DB-02) **[confirm]**, keeping its last dump of the old database in `legacy/`; remove the CLAUDE.md recovery line (DB-02). **Production telemetry check** (testing §2 P13): a PostHog query over the first 24 h shows no event with `app_env ∈ {dev, test}` in the production dashboards, none from CI (blank key), and none from users with `is_internal` or `is_synthetic` in the funnels; the result goes into the sign-off record |
| T+3 d | O | `ws-chess` TTL → 300; point of no return passed → old Neon passwords rotated, AWS instance **stopped** **[confirm]** |
| T+7 d | O | `csp-enforce` on if the CSP reports are explained; Neon compute back to scale-to-zero after the always-on week (§9.1); coach breaker values reviewed against real spend; Cloudflare DNS token revoked or expired; flag-removal release planned |
| T+14 d | C | `prod-smoke-schedule.yml` disabled; first `ops-weekly.yml` reports with production rows reviewed against §14.4 |
| T+30 d | O **[confirm each]** | Delete the old Neon project `shy-morning-50748774` (after one last encrypted archive that itself expires with `legacy/` lifecycle); delete the old Vercel project; terminate the AWS EC2 instance; remove `next`, `ws-next` DNS and `next.` from Clerk allowed origins and `ALLOWED_ORIGINS`; delete the Dodo test endpoint for `next.`; remove the tombstones; run C1 (§6.6); consider DNSSEC (§7.8) and the registrar transfer (OD-23) |

### 8.12 Go/no-go gates

| Gate | When | Go only if |
|---|---|---|
| G0 | T−60 min | preflight all 27 checks green (P0 domain and P16 Vercel Pro are hard blockers); R#2 passed with every drill; owner available for 4 hours; old site has no live tournament; Dodo, Clerk, Vercel, Neon, Cloudflare status pages show no incident |
| G1 | after step 10 | `verify-counts` passed at both stages; every backfill verification passed or was waived by the owner in writing (the report records it) |
| G2 | step 17 | the step 15 smoke and `@prod-smoke` passed on desktop and one phone; Sentry shows no new production issue except known ones; `/ready` and `/worker/ready` green for 10 minutes |
| G3 | point of no return | no R1 trigger fired; billing reconciled; first backup present |

---

## 9. Performance and optimisation

### 9.1 Launch-specific hot paths

| Path | Risk at launch | Measure |
|---|---|---|
| Neon compute | Cold wakes on every first request after 5 idle minutes (+≈ 1 s, OPT §2.1 "Cold"); an analysis backlog (§6.5 step 17) and returning users arrive together | During hypercare (T … T+7 d) set the production compute to **always on at 0.25 CU, autoscaling to 1 CU** (Launch plan setting; ≈ 0.25 CU × 168 h × $0.106 ≈ $4.5 for the week [V]); then back to scale-to-zero after 5 minutes |
| Vercel cold starts | The first visitors hit cold function instances (+≈ 800 ms, OPT §2.1) | Fluid compute reuses warm instances; `warm-cache.ts` (below) touches the dynamic shell routes once after step 17 so the first real users mostly land on warm instances; no synthetic keep-alive traffic afterwards |
| ISR catalogues | Every catalogue page is a MISS on the new deployment; Googlebot recrawls after the sitemap submission | `warm-cache.ts` renders `/`, `/pricing`, `/how-we-grade`, `/legends`, the 51 legend pages, `/openings` and the letter indexes, `/learn/*`, `/blog/*` at 2 requests a second (≈ 100 pages, < 1 minute); the 3,641 opening pages render on demand (one indexed read each, R1 class) |
| Worker backlog | Legacy analyses and first imports compete with live games | Legacy jobs at `JOB_PRIORITY.BACKLOG` within the P4 budget (D14); `fairSeq` interleaves users; `GAME_ENDED` and `USER_OPENED` jobs pre-empt between positions (P3); `ENGINE_POOL=2`; enqueue starts at T+60 min; the ceiling and Stage C are in §14.4 |
| Socket box | 1 OCPU, now without the worker | Capacity proven before launch (§9.5) |
| Webhook burst | Dodo retries from the freeze arrive together after step 14 | dedupe by `webhook_events`; < 1 s each (API §8.1); a few dozen at most |

### 9.2 Query plans on real data

- Run `REPO/scripts/explain-hot-queries.ts` (OPT §3.5.4, with api-perf §5's index-existence check) on `rehearsal-2` and on production at T+24 h. Expected: index scans for the viewer (`users_googleId_key`), the archive and Home keyset (`game_players_userId_endedAt_gameId_idx (userId, endedAt DESC, gameId DESC)`, P2; consistency R-01), due counts (`training_cards_userId_deck_due_idx`, P5), the job claim (`jobs_ready_idx (priority DESC, "fairSeq", "runAt") WHERE status = 'QUEUED'`, P3; R-05), the live-game restore (`games_open_idx`, P2) and the opsFreshness read (`audit_logs_category_at_idx (category, at DESC)`, M4; R-04). The check first asserts that every named index exists in `pg_indexes`. Tables below 10,000 rows may plan sequential scans; the OPT gate's exception list gets those tables with their row counts, so the weekly job flags them once they grow.
- `pg_stat_statements` top 20 by `total_exec_time` and by `calls` at T+24 h and T+7 d, compared with the dev baseline; any new statement in the top 5 is investigated (OPT §9.4).

### 9.3 Caching layers touched

| Layer | P13 action |
|---|---|
| Vercel CDN (ISR, `s-maxage`) | warm-up (§9.1); `revalidateTag` from the B3/B4/B11 backfills (P8 scripts call `POST /api/internal/revalidate`) so pages rendered during rehearsals never leak into production (they are a different project anyway) |
| Service worker | legacy eviction (D13); P11's precache budget (≤ 600 KB) unchanged |
| Edge Config | production store; P11's adaptive memo (300 / 120 / 60 s); reads are documents-only, within the Pro allowance [V]; the read counter is in `ops-weekly.yml` |
| R2 / `media.playchess.tech` | immutable paths, `max-age=31536000, immutable` verified in preflight P7 |
| Worker eval cache | starts cold on the new VM; seeded from the P3 seed URL (`EVAL_CACHE_SEED_URL`) at boot |

### 9.4 Payload and bundle impact

- Middleware: + ≈ 1.5 KB (three helpers, one prefix list); budget ≤ 100 KB (ARCH §4.3) unchanged.
- Service worker: + ≈ 0.8 KB (`legacy-evict`).
- Pages: 0 bytes. The CI bundle report (P1 F7) must show ≤ 2 KB of total change on the launch SHA versus the P12 merge.
- `/api/health?deep=1`: + ≈ 60 bytes.

### 9.5 Pre-launch capacity runs on the production boxes (rehearsal branch, not live)

| Run | Target | Load | Pass (OPT §2.5, §2.6, §9.6) |
|---|---|---|---|
| `ws-ramp` (k6, protocol v2) | `wss://ws-next.playchess.tech` | 250 → 2,000 sockets, one move per 5 s per game, 15 min | server `ws.move_latency_ms` p95 < 50 ms; `ws.loop_lag_ms` p99 < 20 ms; RSS < 1 GB; 0 lost plies; checkpoint writes to `rehearsal-2` p95 < 500 ms end to end |
| `analysis-throughput` (`perf/analysis/enqueue.ts`) | worker VM, 2 lanes | 200 fixture games at `JOB_PRIORITY.BACKLOG` + 5 just-finished games at `JOB_PRIORITY.GAME_ENDED` (80; higher runs first, P3-D7) | games per hour recorded (target ≥ 150); `GAME_ENDED` first badges ≤ 3 s p95, complete ≤ 22 s p95 under the backlog (`worker.review_ready_ms`) |
| `boot-cold` (k6) | `next.playchess.tech` after 10 idle minutes | 50 VUs × 1 | first request p99 ≤ 2.5 s |
| Lighthouse CI (mobile) | `next.` `/`, `/pricing`, `/openings/<slug>`, `/legends` | — | Performance ≥ 90, LCP ≤ 2.5 s, CLS ≤ 0.05, TBT ≤ 200 ms (OPT §2.3) |

The k6 runs use the smoke accounts' Clerk sessions (production instance; no `PERF_AUTH_BYPASS`, which production refuses). Each run's thresholds abort on failure; the JSON summaries go to `REPO/perf/results/p13-<scenario>-<sha>.json` and `perf/compare.ts` flags a > 15 % regression against P12's results for the shared scenarios (testing X18); the rehearsal report links them.

### 9.6 SLOs in production and how they are measured

Server-side sources come first (api-perf AP-15): P11 loads PostHog only after consent, which defaults to deny, so PostHog client events are kept for funnels and as secondary numbers, never as the SLO source.

| SLO (OPT §2) | Target | Source and formula |
|---|---|---|
| API availability (non-5xx, excluding planned maintenance) | ≥ 99.5 % a month | (all requests − 5xx − Vercel `function_timeout` − edge 504) ÷ all requests, from the Vercel usage API plus Sentry `api.status`; Sentry alone sees only completed requests (api-perf AP-35) |
| R1 / R2 server p95 | < 100 / 160 ms | `Server-Timing` → Sentry `api.duration{class}` |
| CWV p75 (marketing, board pages) | LCP ≤ 2.0 / 2.5 s mobile, INP ≤ 150 / 100 ms, CLS ≤ 0.05 / 0.02 | Speed Insights (cookieless), `sampleRate` set so the month's events stay inside the plan's included amount [V Pro billing] (feasibility F-VER-5); CLS at 80–150 % zoom is a lab gate in the device matrix, not a field SLO |
| Socket `/ready` | ≥ 99.5 % a month | UptimeRobot (or the D11 fallback) |
| Move ack | `ws.move_latency_ms` p95 < 50 ms server-side | socket metrics → Sentry (P2) |
| Review ready (`GAME_ENDED` band) | first badges ≤ 3 s p95, complete ≤ 22 s p95 | `game_analyses."readyMs"` (= the `analysis:done` emit time − `games."completedAt"`, P3) as a daily SQL percentile, and the Sentry metric `worker.review_ready_ms{band}` (P3, api-perf AP-15); PostHog `perf_review_ready` as a secondary view |
| Coach first sentence | P7's target | P7's server-side `firstSentenceMs` column, p95 per day from SQL |
| Backup | one successful backup per 24 h; restore drill quarterly | `opsFreshness`, the `worker-backup` cron monitor, drill reports |
| RPO / RTO | RPO ≤ 24 h from R2 (≤ minutes with the 7-day Neon history); RTO ≤ 60 min | runbook drill timings |
| Vercel invocations per active member per day | ≤ 65 | weekly: Vercel usage `functionInvocations` ÷ (7 × DAU). DAU = distinct members with a server-side session record from `getViewer()` (P1; the ref hash only, so it counts non-consenting users too) |
| Edge requests per active member per day | ≤ 120 | Vercel usage `edgeRequests` ÷ (7 × the same DAU) |
| Neon CU-h (prod) | ≤ 70 % of the month at the pro-rata point (warn at 50 %, api-perf §5) | Neon consumption API `compute_time_seconds` ÷ 3600 × CU, in `ops-weekly.yml` |

**Quota and cost report** (`.github/workflows/ops-weekly.yml`, P1's workflow with P13's production section, Monday 06:00 UTC): Vercel usage (API), Neon consumption (`/consumption_history/projects`, compute seconds, storage, egress), Sentry and PostHog usage, Anthropic cost report, OCI CPU p95 per instance (monitoring API, idle-reclamation watch), Edge Config reads, R2 storage, the Stage C triggers (§14.4) → a GitHub issue labelled `ops-report` with red items over 70 % pro-rata (OPT §9.4).

| Monthly cost at launch (est., [V] at signup) | |
|---|---|
| Vercel Pro (1 seat) | $20 |
| Neon Launch (0.25 CU mostly asleep after hypercare, ≈ 1 GB, plus the 7-day history at $0.20 per GB-month) | $5–25 |
| Clerk, R2, OCI (PAYG with Always Free only), Resend, UptimeRobot, Sentry, PostHog (free tiers) | $0 (Resend Pro $20 for the launch month if OD-20 says yes) |
| Anthropic | ≤ the workspace limits (P7: typical $0.25–0.40 per member a month) |
| Dodo | per-transaction fees only |

---

## 10. Telemetry

### 10.1 PostHog

| Event / property | Where | Properties | Notes |
|---|---|---|---|
| `system_legacy_migrated` (new, in P1's event registry `packages/analytics/src/events.ts` or its directory form) | client, once per device, after consent; asserted through P1's telemetry sink in `legacy-sw.spec.ts` (testing X6) | `had_legacy_sw` (bool), `legacy_caches_deleted_count`, `legacy_keys_deleted_count` | measures how many returning browsers carried the old app |
| `auth_relinked` (Path N only) | server, `provisionUser()` | `method: "email"` | — |
| Person properties `legacy_user`, `legacy_joined_at` | `posthog-alias.ts` | — | segments returning users in every funnel |
| Person properties `is_internal: true` (owner accounts), `is_synthetic: true` (the smoke account, ARCH §3.4.3) | `posthog-alias.ts` (`$set`) and `save-session.ts` | — | excluded by the project's internal-users filter and by every production dashboard (testing §2 P13) |
| Annotations | `open.ts`, rollback runbook, `release-prod.yml` | "Launch freeze", "Launch opened", "Rollback R1", "Release <sha>" | on every chart |

Dashboard **"Launch hypercare"** (PostHog MCP or UI): sign-ins split by `legacy_user`; onboarding completion; `onb_plan_checkout_started` → `trial_started` / `subscription_activated`; 402 responses by `reason`; `perf_review_ready` p95; `coach_message_completed` cost; socket reconnects (`perf_socket_connect.reconnect`); `system_legacy_migrated` count. Funnels from ARCH §3.4.3 (acquisition, trial conversion, activation) filtered to `app_env = production`, excluding `is_internal` and `is_synthetic` users. The SLO numbers on the dashboard are the Sentry server-side ones (§9.6); the PostHog `perf_*` events are labelled "consenting users only". CI builds have a blank PostHog key, so they send nothing.

### 10.2 Sentry

- **Releases:** `web@<sha>` (Vercel build uploads source maps with `SENTRY_AUTH_TOKEN`), `websocket@<sha>`, `worker@<sha>` (image tags); `release-prod.yml` finalises them and records a `production` deploy.
- **Alert rules** (`REPO/scripts/ops/sentry-alerts.ts`, idempotent, owner email as the action):

| Rule | Project | Condition |
|---|---|---|
| New production issue | all | first seen, `environment:production` |
| Error spike | web | > 50 events in 10 min |
| Webhook errors | web | any error with `transaction:/api/webhook/*` |
| 5xx rate | web | `api.status` 5xx share > 1 % over 15 min |
| R1 latency | web | `api.duration{class:R1}` p95 > 200 ms for 15 min |
| Ops freshness | web | message fingerprint `ops.*` (`backup_stale`, `backup_shrunk`, `backup_storage_high`, `queue_stale`, `scheduler_gap`, `db_size_*`) |
| Daily cron missed | web | the automatic Vercel cron monitor for `/api/cron/daily` |
| Socket health | websocket | `ws.persist.fail` > 0 for 5 min (**excluding** `ws.persist.reconnect`, the transient Neon-suspend class `P1017`/`57P01`/`08006`, P2 §6.7, api-perf AP-18); `ws.outbox.oldest_ms` > 60 s; `ws.loop_lag_ms` p99 > 100 ms for 5 min |
| Worker | worker | any `backup` job final failure; `worker.queue.oldest_age_ms{priority≥80}` > 600 s; `worker.review_ready_ms{band:GAME_ENDED}` p95 > 30 s daily; analysis failure rate > 5 % per hour (ARCH §2.5) |
| Coach | web | first-token p95 > 4 s for 1 h; daily spend > 80 % of the day's member-scaled breaker budget (P7 D6) |
| Legacy traffic (info) | web | `legacy.api_call` > 200 per hour (tells whether old tabs are still around) |

- **Cron monitors** (D11): `worker-backup` (daily at 21:00 UTC, margin 60 min, check-ins from the `BACKUP` handler) and P3's existing `housekeeping` monitor (same schedule), plus Vercel's automatic monitor for `/api/cron/daily`. If the free plan allows only these two custom monitors or fewer (Q7), keep `worker-backup` first; `scheduler_gap` and `queue_stale` cover housekeeping within a day, and the `/worker/ready` uptime monitor covers a dead worker within 5 minutes.
- PII rules unchanged (P1: `sendDefaultPii: false`, `setUser({ id: referenceId })`).

### 10.3 Uptime (UptimeRobot, `REPO/scripts/ops/uptimerobot.ts`)

| Monitor | URL | Check | Interval |
|---|---|---|---|
| Website | `https://www.playchess.tech/api/health` | keyword `"ok":true` | 5 min |
| Landing | `https://www.playchess.tech/` | HTTP 200 | 5 min |
| Game server | `https://ws-chess.playchess.tech/ready` | keyword `"ready":true` | 5 min |
| Coaching engine | `https://ws-chess.playchess.tech/worker/ready` (Caddy → `10.42.0.30:3003/ready`, no DB call) | HTTP 200 | 5 min |
| Media | `https://media.playchess.tech/health.txt` | HTTP 200 | 15 min |
| Dev website, dev game server | the dev URLs (P1 may already have added the dev socket monitor, api-perf F-17) | same | 15 min |

Status page `status.playchess.tech`: Website, Game server, Coaching engine, Media; the maintenance window is scheduled there (T−3 d). None of the monitors wakes Neon (`/api/health` without `deep`, OPT §9.8). If UptimeRobot's terms or custom-domain support fail (Q9, Q10), `uptimerobot.ts` has a sibling `betterstack.ts` with the same monitor list (D11).

---

## 11. Security, privacy, paywall and authorisation

### 11.1 Secrets

- **Fresh per environment** (ARCH §3.2.3): every production secret is generated new (`openssl rand -base64 32`), entered once into Vercel (marked Sensitive) or a GitHub environment secret, never pasted into chat, issues or files. `check-env.ts` compares names only.
- **Where they live:** Vercel `replay-chess` Production env; Vercel Preview env scoped to branch `launch`; GitHub environment `production`; the OCI `.env` files written at deploy with mode 600 (existing `chmod 600`); the `age` private key and the Cloudflare DNS token only in the owner's password manager.
- **Rotation:** 180 days, and at once on exposure (`docs/runbooks/rotate-secrets.md`). `INTERNAL_API_SECRET` and `SOCKET_TOKEN_SECRET` rotate without downtime through their kid lists (add the new key second, deploy, move it first, deploy, drop the old one; P2 §7.5.1). `HASH_PEPPER` is never rotated (P4). No Lichess token key exists (P4 D4-21).

### 11.2 Clerk key exposure check (P1 H5)

The Clerk key committed in `REPO/k8s/secrets.yaml:12` (public repo, AQ SEC-03) is an `sk_test_…` key (feasibility SEC-1), so it belongs to a **development** instance, not to `t0wy2xb4vvpw`. P1 H5 rotates it in the instance that issued it and deletes `k8s/`. P13 preflight P20 verifies three things:

1. The leaked key's id (prefix, from git history, never printed in full) is no longer listed as active in any Clerk instance the owner controls.
2. `gitleaks detect --log-opts=--all` over the whole history finds no `sk_live_` key and no other live secret; a hit means "rotate first, then continue".
3. `replay-chess` uses a **fresh** `sk_live_` key created for it at T−7 d, distinct from the key the old Vercel project uses, so the old project's key can be deleted at T+30 d without touching production. Clerk allows several secret keys at once, so neither site goes down.

### 11.3 The `next.playchess.tech` lane

- Real production data and the production Clerk instance, so it is treated as production: allow-list by Clerk user id or the `ADMIN` role, 404 for everyone else (no oracle), `X-Robots-Tag: noindex, nofollow`, robots `Disallow: /` for that host, a Vercel Firewall rate rule on the host.
- Other branches of the `replay-chess` project do not build (ignored-build-step); the `launch` deployment's generated `*.vercel.app` URL cannot sign in (production keys are domain-bound), so the gate shows 404.
- `ALLOWED_ORIGINS` on the socket and Clerk's allowed origins include `next.` only until T+30 d.

### 11.4 Data in transit during the launch

- Dumps are written into an encrypted disk image on the owner's laptop (`hdiutil create -size 2g -encryption AES-256 -type SPARSE -fs APFS -volname replay-launch ~/replay-launch.sparseimage`), age-encrypted before any upload, and the plaintext files are deleted once `verify-counts` passes (the image is detached after the window).
- Rehearsal branches hold real PII: each one is deleted right after its rehearsal **[confirm]**, never copied to the dev project, never used by CI. Production data never enters dev or CI (ARCH §5.11).
- `pg_dump`/`pg_restore` connect with `sslmode=require&channel_binding=require`.

### 11.5 Privacy

- The privacy policy published at launch (OD-16) lists the processors (Vercel, Neon, Clerk, Dodo Payments, Cloudflare R2 and Email Routing, Oracle Cloud, Sentry, PostHog, Anthropic, Resend, UptimeRobot or the D11 fallback), the retention table (ARCH §3.3.5) with **backups ≤ 28 days**, the trial ledger (P4 OD-2) and the Lichess token handling; campaign A tells existing users about it before the move.
- Cookie consent defaults to deny (P11 D6); PostHog loads only after consent, so the alias script's `$set` affects only person profiles that already exist.
- The legacy archive dump (`r2://replay-backups/legacy/`) expires after 30 days by lifecycle rule and is deleted with the old project (§8.11). Bucket-lock periods (§8.6) never exceed 28 days for production copies and 30 days for `legacy/`, so a lock can never keep personal data past the published retention.
- Account deletion during hypercare works as in P10; the deletion copy "Backups clear within 30 days" holds (D9).

### 11.6 Paywall and authorisation in production

- The P1 authorisation matrix runs against production at launch with the actors available there: anonymous (401 on member APIs, 307 on member pages), the smoke account before its trial (402 with `reason: trial_available`), the smoke account as a trial member (200), the owner as admin (200 on `/api/admin/*`), a forged internal signature (401 on `/api/internal/*`).
- Every registered test hook is absent in production: `prod-guard.spec.ts` in `@prod-smoke` iterates P1's registry (routes 404, headers ignored, env hooks refuse to boot or are ignored; testing X12). Hooks are gated on `isNonProd()` + `ALLOW_TEST_HOOKS=1`, never on `VERCEL_ENV` (feasibility fix 3), and `ALLOW_TEST_HOOKS` is on the forbidden list (§7.9). `/api/openapi.json` → 404 (API SYS-9); `PERF_AUTH_BYPASS` refused at module load.
- Legacy $8 subscribers stay entitled through `DODO_LEGACY_PLAYER_PRODUCT_ID` (Phase 0). Lapsed members follow B26 (default: hard redirect to `/pricing?reason=ended`, data kept).
- Admin role: the owner's production `users.role = 'ADMIN'` comes over with the data; preflight lists every admin row and the owner confirms the list.

### 11.7 Platform hardening checklist

- 2FA on every owner account (replaychess007 Google, Vercel, Clerk, Neon, Cloudflare, GitHub, Sentry, PostHog, UptimeRobot, Resend, Anthropic; pandit.rohit0007 for Dodo, the old Vercel and the old Neon; the Hostinger registrar account).
- Registrar: auto-renew on, registrar lock on (`clientTransferProhibited`), renewal ≥ 2 years (D21); the registrar account email and the domain expiry live only in `CLAUDE.local.md`, not in the public repo (feasibility SEC-2).
- OCI: SSH key-only, no root login (setup script), security lists as in §7.7, quotas and the $1 budget alert (D18); Caddy refuses unsigned `/internal/*` and `/engine/*` and 404s the ops-only paths (§7.7).
- Vercel: P11's three Firewall rules plus the `next.` host rule; Attack Challenge Mode documented in `docs/runbooks/incident.md`; Deployment Protection "Standard" on previews.
- Cloudflare: the DNS token scoped to Zone.DNS:Edit on `playchess.tech`, expiring at T+7 d.
- GitHub: branch protection, the `production` environment approval, Dependabot and gitleaks (ARCH).

---

## 12. Testing

Runners and layout follow testing X1 and P1 SPEC D13: **`node:test` via `tsx --test`** for unit tests beside the source (`*.test.ts`); DB-backed and container-backed tests are `*.int.test.ts` (Docker Postgres 17, MinIO); route and contract tests live under `WEB/test/{api,integration,authz}/`. `check-test-globs` must show every P13 test file running in CI (`WEB/scripts/**` and `WEB/worker/**` are in P1's unified globs). Every defect found in a rehearsal, the window or hypercare gets a failing test first, named `regression: <slug> (#issue)` (testing X14).

### 12.1 Unit and integration tests (CI `unit` and `integration` jobs)

| File | Cases |
|---|---|
| `WEB/lib/launch/legacy-tombstones.test.ts` | every legacy prefix in §5.5 matches; the new routes with similar names do **not** (`/api/me`, `/api/games`, `/api/tournaments/…` plural vs legacy `/api/tournament/…`, `/api/review/…`, `/api/players/…`, `/api/accounts/…`); the response parses with `ErrorEnvelope` (code `gone`), status 410, `Cache-Control: no-store`, `x-rc-reload: 1` |
| `WEB/lib/launch/prelaunch-gate.test.ts` | host (`www`, apex, `next.`, `*.vercel.app`) × viewer (anonymous, allow-listed id, admin, other member) × path (`/sign-in`, `/sso-callback`, `/`, `/home`, `/api/health`, `/api/webhook/clerk`, `/api/me`) → allow or 404; the gate never runs on `www` |
| `WEB/lib/launch/canonical-host.test.ts` | `X-Robots-Tag` on `next.` and `*.vercel.app`, never on `www` |
| `WEB/worker/legacy-evict.test.ts` (fake `caches`, `self`, `clients`) | with any legacy cache: `skipWaiting()` during `install`, all 18 names deleted on `activate`, `clients.claim()`, one `LEGACY_EVICTED` message; without legacy caches: no `skipWaiting` (P11 deferral preserved); unknown cache names untouched; the P11 `SW_KILL_SWITCH` build path is not affected |
| `WEB/lib/cron/tasks/ops-freshness.test.ts` (fake clock, fake rows) | backup age 25.9 h ok / 26.1 h `backup_stale`; no backup row → `backup_stale`; size 71 % ok / 69 % `backup_shrunk`; total 3.9 / 4.1 GB → `backup_storage_high`; DB 499 / 501 / 701 MB; queue 599 / 601 s at `JOB_PRIORITY.GAME_ENDED` → `queue_stale`, a `BACKLOG` job of any age → nothing; no future `BACKUP` row → `scheduler_gap`; the four statements go in one `$transaction` (query-count spy = 1 round trip) |
| `WK/src/backup/keys.test.ts` | daily key from the UTC date; Sunday weekly key by ISO week (2027-01-03 → `2026-W53`); retention selection deletes daily > 14 d and weekly > 28 d; the shrink guard deletes nothing; `backupsTotalBytes` sums the listing |
| `WK/src/scheduler/recurring/backup.test.ts` and `WK/src/backup/schedule.test.ts` | the slice's `plan()` returns exactly one row for 21:00 UTC inside a 26 h window with `dedupeKey backup:<date>` and none when `BACKUP_ENABLED=false`; the handler's final batch inserts tomorrow's row once (a second insert is a no-op, `ON CONFLICT`); `seed-recurring.ts` is idempotent; P3's 24-simulated-hour timer audit still shows ≤ 1 fixed wake a day with the slice registered (api-perf §5) |
| `WK/src/backup/pgdump.int.test.ts` (Docker Postgres 17 + MinIO) | the pipeline writes an object that decrypts with the test identity and lists every table; a short TOC fails the job; an upload error aborts the multipart upload; metadata keys present; the Sentry check-in sequence is `in_progress` → `ok` (and `error` on failure) |
| `WEB/scripts/launch/verify-counts.int.test.ts` (two Docker databases) | identical → pass; one row deleted → count and digest fail; a changed `referenceId` → digest fails; a sequence behind `max(id)` → fail; an orphan FK → fail; a billing field difference → listed |
| `WEB/scripts/launch/backfill-all.test.ts` | the step order equals §6.5 for each variant in `launch/variant.json` (§2.4); a dry run issues no write (Prisma spy); the first failing verification stops the run; a host outside `BACKFILL_ALLOWED_HOSTS` exits 1 |
| `WEB/scripts/launch/url-parity.test.ts` (local fixture server) | `ok`, `moved`, `gated`, `chain` (fail), `soft404` (fail), `gone` (fail for sitemap URLs); under Launch A a catalogue URL that answers 200 on the same path passes and a 308 is also accepted |
| `WEB/scripts/launch/announce.test.ts` | ≤ 70 per run and per UTC day through P10's budget helper (a full budget → the run stops, nothing sent); resumes after the stored cursor; suppression list; system and inactive users excluded; plain-text body without CR/LF in the subject |
| `WEB/scripts/launch/check-env.test.ts` | the code scan finds `process.env.X` in TS and JS; forbidden names in production fail; every retired alias fails wherever it appears |
| `WEB/scripts/launch/check-enum-staging.test.ts` | a migration adding `ALTER TYPE … ADD VALUE 'X'` with a TS literal `'X'`/`"X"`/`Kind.X` outside `prisma/` in the same release → fail; the same value already in the previous release's migrations → pass; the label `enum-staged` → pass with a warning |
| `REPO/scripts/db/check-grants.int.test.ts` | a missing privilege fails; an **extra** privilege fails; column grants checked |
| `REPO/scripts/ops/caddyfile.int.test.ts` (Caddy in Docker with stub upstreams) | `/internal/emit` without `X-Rc-Sig` → 401 before the upstream; `/internal/broadcast`, `/internal/drain`, `/internal/metrics` → 404 even when signed; `/worker/ready` → the worker stub's `/ready`; `/worker/metrics` unsigned → 401, signed → the stub sees the path `/worker/metrics` unchanged; `/engine/analyse` unsigned → 401; an unknown path → 404; a 65 KB body → 413 |
| `WEB/prisma/seed/index.test.ts` | the seed refuses the production host and a missing `SEED_TARGET` |
| `WEB/e2e/scripts/provision-test-users.test.ts` (or `e2e/personas/` guard if P1 made it a directory) | refuses `sk_live_` keys and non-dev hosts |
| `REPO/scripts/ops/dns.test.ts` | the diff for set / no-op / delete; refuses proxied=true for Vercel and Clerk names |
| `WS/test/journal-compat.int.test.ts` (P2's file; P13 adds the fixture set) | journals written by the **previous** production-candidate tag (`WS/test/fixtures/journals/<tag>/*.ndjson`, captured in R#1) restore on the launch tag; the previous tag's reader skips a launch-tag journal with a newer `v` and restores from the DB (P2 §7.6) |

### 12.2 API contract tests (CI `contracts` job)

- `CT/http/health.test.ts`: `HealthData` with and without `db`/`schema`; the route handler with a mocked Prisma returns `schema.head` from `_prisma_migrations` and 503 `unavailable` on a DB error.
- `WEB/test/api/cron-daily.contract.test.ts`: the summary includes `opsFreshness` that parses `OpsFreshness`; 401 without the bearer.
- The P1 generated **authorisation matrix** gains rows for the three middleware rules (tombstones are public 410; the `next.` gate 404s non-allowed actors; noindex header).
- The OpenAPI diff (`oasdiff breaking`) must show only the additive `schema` field.

### 12.3 End-to-end (Playwright)

`WEB/playwright.prod.config.ts` (new): `baseURL = process.env.PROD_SMOKE_BASE_URL ?? "https://www.playchess.tech"` (`https://next.playchess.tech` in rehearsals); no `webServer`; `retries: 1`; projects from P1's device list: `prod-desktop-1440` (Chromium, zoom 80 / 100 / 125 / 150 through P1's `withZoom`), `prod-desktop-1280`, `prod-ipad-landscape`, `prod-ipad-portrait` (WebKit), `prod-iphone` (WebKit), `prod-android` (Chromium). Every page with a board uses P1's one-viewport fixture (`WEB/e2e/fixtures/one-viewport.ts`). Rows that do not exist in the chosen variant (§2.4) are skipped by tag.

| Spec (`WEB/e2e/prod/`) | Tag | Steps |
|---|---|---|
| `public-smoke.spec.ts` | `@prod-smoke` | `/` hero and price cards; `/pricing` shows $4.99 and $50 and "Start 7-day free trial"; `/legends` → first legend → board inside the viewport; `/openings/<slug>` board inside the viewport; `/sign-in` renders (custom flow or prebuilt, per `auth_custom_flows`); `/nope` 404 template; response headers include HSTS and the CSP (report-only); `/api/health` → `env: production` and `buildId` = the expected SHA |
| `telemetry-prod.spec.ts` | `@prod-smoke` | consent **rejected**: no request to `/ingest/*` on `/`, `/pricing`, a legend page; consent **accepted**: the first `/ingest/e` body carries `app_env: "production"` and `$current_url` on host `www.playchess.tech`, and no person property or event property holds an email (P1 PII guard rules); the smoke run's own events carry `is_synthetic: true` (testing §2 P13) |
| `prod-guard.spec.ts` (P1's spec, added to `@prod-smoke`) | `@prod-smoke` | iterates P1's test-hook registry (`WEB/lib/test-hooks/registry.ts`, ≈ 20 hooks): every hook route (`/dev/*`, `/api/dev/*`, `/api/test/*`, `/api/e2e/*`) → 404; every hook header (`x-rc-now`, `x-rc-fault`, `x-e2e-token`) is ignored (the response equals the one without it); `/api/openapi.json` → 404 |
| `redirects.spec.ts` | `@prod-smoke` | 12 URLs sampled from `REPO/launch/url-inventory.json` (3 openings, 3 legends, `/analysis/x`, `/profile/x`, `/try/x`, `/position/x`, `/game/x`, apex) → one hop to the expected class (variant-aware, §2.4) |
| `authz-probes.spec.ts` (request context) | `@prod-smoke` | anonymous `GET /api/me` → 401 envelope; `GET /api/review/x` → 401; `POST /api/user/sync` → 410 `gone`; `POST /api/internal/revalidate` with a forged signature → 401; `GET /api/cron/daily` without the bearer → 401; `POST https://ws-chess…/internal/emit` unsigned → 401, signed with a wrong key → 401; `GET https://ws-chess…/internal/metrics` → 404; `GET https://ws-chess…/worker/metrics` unsigned → 401; `GET https://ws-chess…/worker/ready` → 200 |
| `rehearsal-member.spec.ts` | `@rehearsal` (`next.` only; `storageState` from `WEB/scripts/launch/save-session.ts`, a manual sign-in of the smoke account) | `/home` → `/games` (count = `EXPECTED_LEGACY_GAMES` from the probe) → open a legacy game → badges stream (socket) → summary → key moments → bank toggle → `/train/bank/session` grade → `/play` bot game to the end → review; `/pricing` → Dodo **test** checkout with card 4242 4242 4242 4242 → `/checkout/activating` → member; `/tournaments`; `/settings/membership`; one-viewport checks on `/game`, `/review`, `/train/bank/session` at desktop 100 % and 125 %, iPhone and Android |
| `rehearsal-live.spec.ts` | `@rehearsal` | two browser contexts (owner + smoke) on `wss://ws-next…`: challenge → accept → 10 moves each → draw offer declined → resign → rematch with colours swapped |
| `rehearsal-legacy-client.spec.ts` (new, testing §2 P13) | `@rehearsal` | serves the saved pre-launch `main` web bundle (`WEB/e2e/fixtures/legacy-bundle/`, captured with the live `sw.js` at T−10 d) from a local static server, pointed at `wss://ws-next.playchess.tech` (the protocol-v2 server): the old game page shows its reconnect UI on `connect_error "upgrade_required"`; an old API call to the `next.` host gets 410 `gone`; a reload on `next.` lands on the new app and deregisters the old SW (shared helper with `legacy-sw.spec.ts`) |
| `WEB/e2e/specs/legacy-sw.spec.ts` (runs in CI against the local production build) | — | serve the saved live `sw.js` and its precache list from `WEB/e2e/fixtures/legacy-sw/` (copied from production at T−10 d), register it and fill its 18 caches; switch the server to the new build; reload → `caches.keys()` has none of the 18; exactly one reload happened; the toast shows once; on `/game/<ref>` no automatic reload; with consent accepted, P1's telemetry sink records exactly one `system_legacy_migrated` (testing X6) |

### 12.4 Chess-correctness fixtures

- R#0 runs B1/B2 on all legacy games locally and reports each anomaly class: missing final mating move (DB-03), `draw_agreement` that is really threefold or fifty-move, unknown colours, truncated or illegal histories. For each class P13 adds a **synthetic** reproduction (no real game is copied) to `packages/chess-fixtures/pgn/legacy-shapes/*.json` (a hand-made `gameData` blob plus the expected `moves`, `endMethod`, `outcome`, colour) and a test in `WEB/scripts/backfill-play-columns.test.ts` (P2's file; P13 adds cases only).
- In R#1, ten legacy games of the owner are analysed by the production worker on the rehearsal branch: every ply has a label, accuracy ∈ [0, 100], no worker error, review text verified or template (P7). The nightly golden-determinism and label-stability jobs (P3, testing X13) run on the launch image tag before T−1 d.

### 12.5 Regression of earlier phases

| Gate | When | Pass |
|---|---|---|
| `ci.yml` (lint, types, unit, contracts, integration, `e2e-smoke` with `BILLING_PAYWALL=on`, drift, bundle budgets, `check-test-globs`) | on the launch SHA | green |
| `nightly.yml` full main suite and device × zoom matrix (P1, 40 projects, run against `next start` in CI, feasibility F-VER-3), visual regression, axe, `flags-off`, `sw-on` (P11) | on the launch tree on `dev` | green; `WEB/e2e/quarantine.json` **empty** (testing X14) |
| `@rehearsal` specs | R#1 and R#2 on `next.` | green |
| `@prod-smoke` specs | at step 15 (against production with the maintenance gate on: public pages are not gated), at T+60 min, in every `release-prod.yml` run, and every 6 h for 14 days (`prod-smoke-schedule.yml`) | green |
| k6 `api-read-mix` and `train-session` on dev (OPT §9.6) | launch SHA | thresholds met; results written to `REPO/perf/results/p13-<scenario>-<sha>.json` and compared by `perf/compare.ts` (testing X18) |
| Webhook contract tests with recorded **live-shaped** Dodo payloads (ARCH §5.3.4) | launch SHA | green |
| Coach abort on the deployed preview (api-perf §5, P7 `coach-abort.deployed.spec.ts`) | on the `launch` deployment in R#1 | Stop after the first sentence → `ABORTED` row within 2 s (proves `supportsCancellation` is in the `<vercel.json>` the project reads, api-perf AP-02) |

### 12.6 Manual checklist (ego-browser on dev and `next.`, then production; real iPhone and Android phone)

1. Signed out: landing, pricing toggle, blog post, help search, contact form (real send on production goes to `hello@` → replaychess007 inbox), legal pages, the third-party licences page (Stockfish `COPYING` and `SOURCE.txt` reachable next to the engine files), cookie bar (no PostHog before a choice).
2. Sign in with Google (owner) and with email + password (smoke account); a wrong password message; password reset email arrives from Clerk (`clkmail` DKIM passes).
3. `/home` populated; `/games` legacy games; open one → analysing → summary; `/@username`; Settings › Connected accounts shows the backfilled Chess.com link (initials, no Chess.com avatar until P4 OD-2 clears, P4 D4-26) and "Sync now" imports.
4. Train: bank session from a freshly analysed game; puzzles load from `media.playchess.tech` shards; the media response carries `nosniff` and the media CSP (§7.8).
5. Coach: ask one question on a reviewed game; the answer streams; Stop stops it; the usage counter moves (Anthropic production workspace).
6. Play: bot game; friend challenge accepted by the smoke account on the phone; quick match with bot fallback; tap-to-move and drag on the real phones.
7. Tournaments list, a legacy tournament's results (B7) (or the legacy pages under Early / Launch A).
8. Membership: trial state, cancel flow copy, legacy $8 member view (if any live legacy subscriber agrees, or the `legacy` persona on dev).
9. Admin dashboard counts and the activity feed; positions FEN check opens.
10. PWA: install on Android Chrome and iOS Safari from `www`; reopen offline → `/offline`; deploy a no-op build during a bot game → update chip waits for the game end.
11. Maintenance: `notice:set` on `next.`'s store copy → page and in-game chip; `notice:clear`.
12. Old bookmarks from a browser that had the old site installed: the first load cleans the old caches and shows the welcome toast once.
13. Close every ego-browser page at the end (`task.finish({ keep: [] })`).

Results go into `REPO/docs/qa/phase-13-signoff.md` (testing X15): the launch SHA, the Vercel deployment id, both OCI image tags, each owner-test row with pass/fail and a screenshot path, **the real devices (model and OS version), browsers and zoom levels**, the error-window output, the PostHog production check (§10.1), k6 result files, and every defect with its regression test.

### 12.7 Performance checks

§9.5 pre-launch runs (rehearsal), Lighthouse CI on production public pages at T+60 min, Speed Insights p75 at T+24 h and T+7 d against OPT §2.3, `pg_stat_statements` at T+24 h, Neon compute and storage at T+24 h, Vercel usage at T+7 d against the plan, Sentry `api.duration{class}` p95 and `worker.review_ready_ms` p95 at T+24 h.

---

## 13. Work breakdown

Strict file ownership: a file is created or edited by exactly one work package (WP). Shared files earlier phases own are edited only in the lines named in §3. Where P1 turned a shared registry into a directory (feasibility §7), P13 **adds a file** instead of editing the shared one; both forms are named below. Estimates are Claude dev-days; owner time is listed separately.

### 13.1 Packages

| WP | Scope | Files it owns (creates or edits) | Depends on | Estimate | Acceptance |
|---|---|---|---|---|---|
| **A · Accounts and platform** | Vercel Pro and the `replay-chess` project; Neon Launch, spend alert and the 7-day history window; Clerk transfer and settings (P5 check); Dodo live (products, webhook, KYC check); R2 buckets, lifecycle and bucket-lock rules, `media` domain and Transform Rule; Edge Config prod store; Resend domain (and plan, OD-20); Anthropic workspaces; UptimeRobot (or the D11 fallback); Cloudflare DNS token. **Verify** the P1 owner tasks (domain, PAYG + quotas, dev Neon project, `CLAUDE.local.md`) and do any that slipped | `REPO/docs/runbooks/accounts.md` (what was set where, no secrets) | OD-1, OD-2, OD-3, OD-20, OD-21 | 0.75 (+ owner 0.75 d) | preflight P0, P5–P8, P10–P12, P16, P17, P20 green |
| **B · Env and config** | Env manifest, the env checker, turbo, `<vercel.json>`, env examples, production flag defaults | `REPO/ops/env/manifest.ts`, `WEB/scripts/launch/check-env.ts` (+ test), `REPO/turbo.json`, `<vercel.json>` (the `git.deploymentEnabled` key only; P7 owns `functions`), `REPO/deploy/oci/.env.socket.example`, `REPO/deploy/oci/.env.worker.example` (delete `.env.example`), `WEB/lib/flags-registry.ts` defaults (or `lib/flags/registry/p13-production.ts`) | — | 0.75 | `check-env.ts` passes against the prod project and both OCI env files; a forbidden name or a retired alias makes it fail; `turbo.json` lists every manifest name |
| **C · OCI production infrastructure** | Socket box bring-up, worker VM (create or re-point), compose and Caddy, kids, deploy workflow | `REPO/deploy/oci/docker-compose.yml`, `REPO/deploy/oci/Caddyfile` (P13's hosts, `/worker/ready`, `WORKER_UPSTREAM`), `REPO/deploy/oci/worker/docker-compose.yml`, `REPO/deploy/oci/setup-server.sh`, `REPO/.github/workflows/deploy-oci.yml`, `REPO/scripts/ops/oci-create-worker.sh`, `REPO/scripts/ops/oci-quotas.sh`, `REPO/scripts/ops/caddyfile.int.test.ts`, `REPO/docs/runbooks/{socket-restart,worker-down,queue-backlog}.md` | A, P2, P3 | 1.25 | `https://ws-next.playchess.tech/ready` and `/worker/ready` green; worker reachable only from the VCN (an outside `curl :3003` times out); a signed kick through Caddy → 202, unsigned → 401 at Caddy; `deploy-oci.yml` production run with `start: false` leaves containers stopped; a rollback by `image_tag` works (D-oci) |
| **D · Data migration tooling and preflight** | Probe and target SQL, verification, backfill orchestration, roles and grants, guards, preflight with the revision-2 checks | `REPO/launch/sql/{old-db-probe,target-check,transit-fixups}.sql`, `REPO/launch/variant.json`, `WEB/scripts/launch/{preflight,verify-counts,backfill-all,system-users,reconcile-billing,posthog-alias,audit-note,check-enum-staging}.ts` (+ tests), `WEB/scripts/launch/lib/**`, `DB/sql/roles/*.sql`, `DB/sql/grants/*.sql`, `DB/sql/grants.matrix.json`, `DB/sql/extensions.sql`, `REPO/scripts/db/check-grants.ts` (+ int test), `DB/scripts/backfill/enqueue-analysis.ts` (flags `--entitled-only`, `--budget p4` only), `WEB/e2e/scripts/provision-test-users.ts` (guard only), `WEB/prisma/seed/index.test.ts` | P1–P12 backfills | 2.0 | R#0 runs end to end on the real dump; `verify-counts` reports exact matches; `check-grants` green on Docker after `migrate deploy`; preflight prints all 27 checks |
| **E · Backups and ops jobs** | `BACKUP` job and its planner slice, M13a, opsFreshness, health `schema`, restore drill, first-night seeding | `DB/prisma/schema.prisma` (the one enum line), `DB/prisma/migrations/<ts>_m13a_jobkind_backup/migration.sql`, `WK/src/handlers/backup.ts` (or wherever P3 registers job handlers), `WK/src/backup/**` (+ tests), `WK/src/scheduler/recurring/backup.ts` (+ test; P3's slice directory), `WEB/scripts/launch/seed-recurring.ts`, the job registration line, `WK/Dockerfile`, `WEB/lib/cron/tasks/ops-freshness.ts` (+ test), the cron task list (one line), `CT/http/health.ts`, `WEB/app/api/health/route.ts`, `REPO/scripts/ops/restore-drill.sh`, `REPO/docs/runbooks/restore-from-backup.md` | P3 worker, P4 `audit_logs` | 1.0 | On dev with `BACKUP_ENABLED=false`: no row is scheduled; a manual `run-job BACKUP` writes a decryptable object to `replay-backups-dev` and an `audit_logs` row; the dev drill restores it into a scratch dev-project branch and `verify-counts --mode drill` passes; `opsFreshness` alerts in a test with a stale row |
| **F · Release pipeline and prod smoke** | `release-prod.yml` with the enum and journal gates, the production part of `ops-weekly.yml`, `prod-smoke-schedule.yml`, Node 24 in workflows, the prod Playwright config and specs | `REPO/.github/workflows/{release-prod,prod-smoke-schedule}.yml`, `REPO/.github/workflows/ops-weekly.yml` (the production sources and the restore-drill issue only; P1 owns the file), `REPO/.github/workflows/{e2e-tests,perf-tests,indexnow}.yml` (Node version lines), `WEB/playwright.prod.config.ts`, `WEB/e2e/prod/**`, `WEB/e2e/fixtures/legacy-bundle/**`, `WS/test/fixtures/journals/**`, `WEB/scripts/launch/save-session.ts` | C (deploy-oci inputs), E (health schema), D (`check-enum-staging`) | 1.5 | `release-prod.yml` in `mode: launch` on a test SHA (against `next.`/rehearsal) builds, deploys OCI stopped, deploys web, runs `@prod-smoke` green (including `prod-guard` and `telemetry-prod`); `rehearsal-legacy-client.spec.ts` green on `next.`; `ops-weekly.yml` opens a report issue with the production rows |
| **G · Cutover web code** | Middleware rules, legacy SW eviction, robots for `next.`, the legacy toast hook | `WEB/lib/launch/{prelaunch-gate,legacy-tombstones,canonical-host}.ts` (+ tests), `WEB/middleware.ts` (three calls; or a route-class file under `lib/routes/classes/launch.ts` if P1 froze middleware as data), `WEB/worker/legacy-evict.ts` (+ test), `WEB/worker/index.ts` (one import), `WEB/app/robots.ts` host-aware `Disallow: /` on `next.` (or `lib/seo/robots-rules/p13.ts`), `WEB/lib/storage/migrate.ts` (event and toast hook only), `packages/analytics/src/events.ts` (one event; or its registry directory), `WEB/e2e/specs/legacy-sw.spec.ts`, `WEB/e2e/fixtures/legacy-sw/**` | P1, P11 | 0.75 | unit tests and `legacy-sw.spec.ts` green; on `next.` a non-allowed account gets 404; middleware bundle delta ≤ 2 KB |
| **H · SEO, comms and DNS** | URL inventory and parity, emails, open script, cache warm-up, DNS helper | `WEB/scripts/launch/{url-parity,announce,open,warm-cache}.ts` (+ tests), `REPO/launch/url-inventory.json`, `REPO/launch/email-suppress.txt`, `WEB/content/emails/launch-{a,b}.txt`, `REPO/scripts/ops/dns.ts` (+ test) | G (for `next.`), P10 (email budget helper) | 0.75 | inventory of 3,681 URLs saved; parity on `next.` 0 failures; announce dry run lists the right recipients in batches of ≤ 70; `dns.ts` dry run shows the planned diff |
| **I · Monitoring configuration** | Sentry rules and cron monitors, UptimeRobot monitors and status page, PostHog dashboard and internal-users filter | `REPO/scripts/ops/{sentry-alerts,uptimerobot}.ts`, `REPO/ops/posthog/launch-hypercare.json`, `REPO/docs/runbooks/monitoring.md` | A | 0.5 | `--check` modes green in preflight P11; a forced test error in each project emails the owner; a missed `worker-backup` check-in alerts |
| **J · Docs and clean-up** | Runbooks, CLAUDE.md and `CLAUDE.local.md`, plan pointer, deletions, the sign-off record | `REPO/docs/runbooks/{launch,rollback,incident,rotate-secrets,neon-quota}.md`, `REPO/CLAUDE.md` (rules only), `REPO/CLAUDE.local.md` (environments; gitignored, so it is edited on the owner's machine, never committed), `REPO/docs/implementation-plan.md`, `REPO/docs/qa/phase-13-signoff.md`, `REPO/.gitignore`, `REPO/perf/README.md`; deletes `REPO/{amplify.yml,build-and-push.sh,docker-compose.yml,deployment.md}`, `WEB/public/_redirects`, `WEB/Dockerfile`, `REPO/perf/*.sh` (whichever P1 left) | all | 0.5 | the launch runbook is the window table (§8.3) with commands; CLAUDE.md edits approved by the owner (OD-13) |
| **K · Rehearsals, window, hypercare** | R#0, R#1, R#2 with drills, the window, T+24 h restore drill, T+3 d / T+7 d / T+14 d / T+30 d steps | `REPO/launch/reports/**` only | all | 1.5 (+ owner 0.5 d) | the reports exist; §15 ticked |

**Total: 11.25 Claude dev-days + a 20 % buffer line of 2.25 d (used only with the owner's OK, feasibility §8) + about 1.25 owner-days.** Revision 1 measured 10.75. Revision 2 adds the testing additions (+0.5: prod-guard and telemetry in the smoke, the legacy-client spec, the schedule, journal fixtures), the extra preflight checks (+0.25) and the Caddy test (+0.1, inside C), and removes work P1 now does (−0.25 in A: the dev split and PAYG are verify-only; −0.1 in F: `ops-weekly.yml` is extended, not created).

### 13.2 Order and parallelism

```
Wave 1 (days 1–3, parallel):  A (owner-led) · B · C · D · E · G · I
Wave 2 (days 3–5):            F (needs C, E, D) · H (needs G) · R#0 (needs D)
Wave 3 (days 5–8):            R#1 (needs A–I) → fixes → J (docs from the real timings)
Wave 4 (days 8–11):           R#2 with drills → T−1 d merge and launch-mode release → window → hypercare (K)
```

Merge-conflict hot spots: `WEB/middleware.ts` (G only), `REPO/deploy/oci/*` (C only), `WK/src/scheduler/recurring*` (E only), `REPO/turbo.json` and `<vercel.json>` (B only; P7's `functions` block is not touched), `ops-weekly.yml` (F only, the production section).

### 13.3 Task list per package

| Task | WP | Done when |
|---|---|---|
| A1 Vercel Pro, project `replay-chess`, env, domains `next.` | A | `next.playchess.tech` serves the `launch` branch |
| A2 Neon Launch, spend alert, history 7 d; verify the dev project from P1 (else §6.7) | A | preflight P3, P17 |
| A3 Clerk transfer + settings + rehearsal webhook | A | preflight P5 |
| A4 Dodo live products, webhook check, KYC check | A | preflight P6 |
| A5 Verify domain renewal and lock, OCI PAYG + quotas, `CLAUDE.local.md` | A | preflight P0, P10, P20 |
| A6 R2 buckets, lifecycle, bucket lock, `media` domain + Transform Rule, `media:upload`, puzzle shards | A | preflight P7 |
| A7 Edge Config prod store; Resend domain and plan; Anthropic workspaces; UptimeRobot account | A | preflight P8, P12 |
| B1 Manifest + scanner + checker | B | test green |
| B2 turbo.json, `<vercel.json>`, env examples, flag defaults | B | CI green |
| C1 Socket box setup + deploy against a throwaway branch | C | `ws-next` `/ready` |
| C2 Worker VM create or re-point + setup + deploy | C | `/worker/ready` through Caddy |
| C3 deploy-oci.yml rework (inputs, two hosts, start flag, rollback) | C | D-oci drill passes |
| C4 Caddyfile + its int test | C | test green |
| D1 Probe, target, transit SQL; dumps scripted; `variant.json` | D | R#0 |
| D2 verify-counts | D | test + R#0 |
| D3 backfill-all + B-L1/B-L2/B-L3 | D | test + R#0 |
| D4 roles/grants consolidation + check-grants | D | Docker check green |
| D5 preflight (27 checks) + `check-enum-staging` | D | prints all checks |
| E1 M13a + backup handler + `backup` planner slice + `seed-recurring.ts` + Dockerfile tools | E | dev manual backup object; slice test green |
| E2 opsFreshness + health `schema` | E | contract tests |
| E3 restore drill script + runbook | E | dev drill report |
| F1 release-prod.yml + ops-weekly production rows + prod-smoke-schedule | F | launch-mode dry run |
| F2 Prod Playwright config + specs (incl. telemetry, prod-guard, legacy-client) | F | green on `next.` |
| G1 middleware helpers + tests | G | unit green |
| G2 legacy SW eviction + e2e | G | spec green |
| H1 inventory + parity | H | 0 failures on `next.` |
| H2 announce + emails + open + warm-cache + dns | H | dry runs |
| I1 Sentry rules and cron monitors, UptimeRobot, PostHog dashboard and filter | I | `--check` green |
| J1 Runbooks, CLAUDE.md / `CLAUDE.local.md`, deletions, sign-off template | J | owner review |
| K1 R#0 · K2 R#1 · K3 R#2 + drills · K4 window · K5 hypercare to T+30 d | K | reports |

### 13.4 Getting back to the 8-day allocation (owner's choice)

| Cut | Saves | Cost |
|---|---|---|
| Configure Sentry rules and UptimeRobot by hand (skip WP-I scripts) | 0.5 | dev and prod alerts can drift |
| Skip R#2 when R#1 ran clean and the drills are done inside R#1 (not recommended) | 0.75 | less confidence in timings |
| Launch with a manual migration runbook and build `release-prod.yml` in the first post-launch release | 0.75 | the first post-launch release must not ship before it; the enum gate is manual until then |
| Drop the legacy tombstones (old tabs get HTML 404s for 30 days) | 0.25 | Sentry noise |
| Drop `warm-cache.ts` | 0.25 | first visitors see a few cold ISR renders |
| Drop `rehearsal-legacy-client.spec.ts` and test the v1 tab by hand in R#1 | 0.25 | one manual check instead of a repeatable one |
| Drop `prod-smoke-schedule.yml` (run `@prod-smoke` by hand twice a day in hypercare) | 0.1 | relies on the owner |
| Skip the transit fix-up preparation when the T−14 d probe shows no drift | 0.25 | none if the probe is clean |
| **Total** | **3.1** | **8.15 dev-days** (the buffer line stays separate) |

---

## 14. Risks, open questions and owner decisions

### 14.1 Risks

| # | Risk | Likelihood / impact | Mitigation |
|---|---|---|---|
| R1 | The Clerk app cannot be transferred (account type, billing requirement on the receiving workspace) | M / H | Reuse it in place (the old account keeps ownership; only keys move); Path N only as a last resort (+1.5 d: user import with `external_id`, password digests if exportable, else reset emails) |
| R2 | The cross-account Vercel domain move stalls (verification, certificate issuance) | L / H | `_vercel` tokens pre-staged; drilled on `next.` (D-web-move); 10-minute limit then R1 |
| R3 | ap-mumbai-1 has no A1 capacity for the worker VM | M / M | Start the retry loop at T−21 d, or create the VM in P3 (OD-22). **Plan W:** run the worker co-located on the prod socket box with the dev limits (`cpus: 0.75`, the `worker-idle.slice` cgroup rule, lag pause on) by setting `WORKER_UPSTREAM=analysis-worker:3003` and the `worker` compose profile on prod; move it when the VM exists |
| R4 | Oracle reclaims the mostly idle worker VM (Always Free idle rule) | M / H | D18 (PAYG + quotas, done in P1); the weekly report watches CPU p95; `setup-server.sh` + `deploy-oci.yml` rebuild a box in < 30 min |
| R5 | Old-schema drift breaks the data-only restore | M / M | Probe at T−14 d; transit path (§8.4) prepared in R#0 |
| R6 | Dodo deliveries lost during the freeze | L / H | Two reconcile passes (§6.5 step 14, window step 16); Dodo "resend"; dedupe |
| R7 | Live trial behaviour differs from test mode (`trial_period_days`, card authorisation, forced renewal) | M / H | Preflight P6 creates a live session; window step 18 exercises the real money path and the refund |
| R8 | Dodo KYC or business verification not approved in time | L / H | Checked at T−21 d; the launch date moves, nothing else does |
| R9 | Old service workers keep serving stale shells | M / M | D13 eviction + `legacy-sw.spec.ts`; tombstones keep old API calls cheap; the P11 emergency SW build (R2b) as the last resort |
| R10 | Neon compute or storage exhaustion | L (Launch) / H | D16 Launch; `opsFreshness` size alerts; quota report |
| R11 | Search ranking dip after the URL changes | M / M | 308s in one hop, parity at 0 failures, sitemaps submitted, IndexNow `scope=all`, canonical tags (P8) |
| R12 | HSTS `includeSubDomains` makes any new subdomain without TLS unreachable | L / M | Preflight P9 checks TLS on every host before use |
| R13 | Stale resolvers keep sending sockets to the old AWS box after the flip | L / M | TTL 60 s a day ahead; the old socket process is **stopped** at step 17 (restarted only in R1); new clients connect with `proto: 2` tokens the old server cannot use |
| R14 | Anthropic spend spike from launch curiosity | M / M | Per-member and trial caps and the member-scaled daily breaker (P7 D6); spend limits on the production workspaces |
| R15 | PII left in rehearsal branches or on the laptop | L / H | Delete each rehearsal branch **[confirm]**; encrypted disk image; preflight counts branches and flags any `rehearsal-*` |
| R16 | Release PR `dev` → `main` conflicts with the P1 hotfix picks | M / L | Open the release PR at T−3 d; resolve to `dev`; CI must pass by T−1 d |
| R17 | One operator for a long window | M / M | Scripted steps, explicit abort criteria, window at a morning hour for the owner (04:00 UTC = 09:30 IST) |
| R18 | P12 (or P6, P8, P9) not done by the date | M / L | Early and Launch A variants (§2.4) |
| R19 | Resend limits (100 a day on the free plan) collide with transactional email | certain / M | D15: ≤ 70 a day inside P10's durable budget, or Resend Pro for the launch month (OD-20) |
| R20 | **The domain lapses** (expires 2027-02-02, auto-renew off) | M without action / **critical** (site, Clerk instance, Email Routing) | D21: renewed and locked in P1; preflight P0 blocks; registrar 2FA (§11.7) |
| R21 | **Charging on Hobby** continues past launch or the new team stays on Hobby | certain today on the old account / H (terms) | D17 hard blocker (preflight P16); the old project stops charging when the domain moves; the owner may move the old account to Pro before launch (feasibility F-VER-1) |
| R22 | The prod worker saturates after launch (no free headroom left) | M / M | P4 D4-09 budgets (20 eager for trialists, 50 for members, backlog released after the first paid charge over 7 days); Stage C triggers (§14.4) watched by `ops-weekly.yml` |
| R23 | UptimeRobot's free plan forbids commercial use | M / L | D11 fallback (Better Stack free or Sentry Uptime + Upptime); Q9, Q10 |
| R24 | The repository goes private before launch (CI minutes) | L / M | Assumption recorded (Q11): the nightly matrix and the arm64 runners are free only for a public repo; budget for CI if it changes |
| R25 | `V4Admin` health tiles stay `unknown` because P2 blocks `/internal/metrics` at Caddy | M / L | P13's own checks do not need metrics (§7.5, `/worker/ready`); handoff H13-2 to P12 |
| R26 | A post-launch release writes a new enum value in the release that adds it, then needs a rollback | L / H | D22; `check-enum-staging.ts` gate in `release-prod.yml` |

### 14.2 Open questions (answer before WP-A starts)

| # | Question | Default if unanswered |
|---|---|---|
| Q1 | Which Clerk account holds instance `t0wy2xb4vvpw` today, and is its application the same one as the dev instance `loving-martin-7959`? | Assume the old account; transfer (D1) |
| Q2 | Can a Hobby-plan Vercel Firewall custom rule **redirect**, or only deny/challenge? (Hobby has 3 custom rules.) | Deny-only rules, plus the email and status-page announcement; the hotfix fallback only for a branded page |
| Q3 | Real size, migration level and drift of the old database (probe) | Plan for ≤ 200 MB and 16 or 17 migrations |
| Q4 | How many live Dodo subscriptions exist, and on which products (legacy $8 vs Coaching)? | Reconcile all |
| Q5 | Does Dodo retry deliveries answered with 403, and on what schedule? | Rely on the reconcile |
| Q6 | Does Neon Launch billing apply per organisation (so the dev project from P1 becomes paid)? | Accept near-zero usage cost, or keep dev in a separate Free org |
| Q7 | Sentry free-plan limits for cron monitors (P13 wants `worker-backup` next to P3's `housekeeping` and Vercel's automatic one for `/api/cron/daily`) and the Sentry metrics API quota (feasibility V4) | Keep `worker-backup` and P3's `housekeeping`; drop the Vercel cron monitor if needed (the daily cron's own errors still alert) |
| Q8 | Edge Config read quotas on Pro | Ample at P11's adaptive memo |
| Q9 | Does UptimeRobot's free status page allow the custom domain `status.playchess.tech`? | Else the D11 fallback |
| Q10 | Do UptimeRobot's free-plan terms allow commercial use? (feasibility V5) | Else the D11 fallback |
| Q11 | Does the repository stay public through launch? | Yes (the CI cost model assumes it) |
| Q12 | Is R2 bucket lock available on the account's plan for `replay-backups`? (feasibility V6) | Else rely on the scoped token and the encrypted copies |

### 14.3 Owner decisions

| # | Decision | Recommendation | Needed by |
|---|---|---|---|
| OD-1 | Clerk path: keep and transfer the production instance (Path T) or a new instance (Path N) | **Path T** | T−21 d |
| OD-2 | Vercel Pro before charging customers (Hobby is non-commercial) | **Yes** (hard blocker, D17), with Skew Protection and a spend cap; consider moving the old account to Pro now, since it already charges | T−21 d |
| OD-3 | Neon Launch for production with a 7-day history window | **Yes** | T−21 d |
| OD-4 | OCI tenancy on Pay-As-You-Go with a $1 budget alert and quotas | **Yes, in P1** (P13 verifies) | P1 |
| OD-5 | Window date and hour | A Sunday 04:00 UTC unless PostHog shows a quieter hour | T−14 d |
| OD-6 | Backup retention | **14 daily + 2 weekly (≤ 28 days)** (overrides ALLOC's 8 weekly) | T−14 d |
| OD-7 | Legacy analysis scope | Entitled users, within the P4 D4-09 budget (50 members, 20 trialists) | T−7 d |
| OD-8 | Automatic first import for backfilled Chess.com links (P4 OD-1 `--queue-imports`) | Yes, entitled users only, 1 user/s | T−7 d |
| OD-9 | Status page and uptime provider | UptimeRobot free if Q9 and Q10 say yes; else Better Stack free | T−10 d |
| OD-10 | Launch emails to every user (service notice) or members only | Every active user, ≤ 70 a day | T−7 d |
| OD-11 | Point of no return | First real charge kept, or T+72 h | T−7 d |
| OD-12 | `DEMO_PLAYER_001` | Deactivate, do not delete | T−7 d |
| OD-13 | CLAUDE.md edits: rule 1 reworded to "No `prisma db push` against any Neon branch; `prisma migrate deploy` on dev and production; `prisma migrate dev` only on a local Docker Postgres" (consistency R-20); environments, Neon details and the recovery line move to `CLAUDE.local.md` (feasibility SEC-2) | Approve | T−3 d |
| OD-14 | Run contract C3/C3v on production inside the launch `migrate deploy` (CLAUDE.md rule 5) | Approve | the window (asked again at step 6) |
| OD-15 | Price ($4.99 / $50) and coach caps, given LLM cost (P7 OQ1, OQ4, ARCH D6) | Keep | T−7 d |
| OD-16 | Final legal texts (Terms, Privacy with processors and retention, Cookies, refund, third-party licences) | Required to launch | T−5 d |
| OD-17 | Retire the old stack at T+30 d (old Neon project, old Vercel project, AWS EC2, old Clerk dev instance if any) | Yes, each confirmed separately | T+30 d |
| OD-18 | A staff/comp access mechanism | None: staff use real subscriptions or trials | — |
| OD-19 | A banner on the old site before the move (one hotfix to old code on `main` before the release merge) | No: emails and the status page are enough | T−7 d |
| OD-20 | Resend Pro for the launch month (P10 Q6, feasibility §2.5) | Yes if the user count at T−14 d exceeds 140 (two days per campaign at 70); else free | T−14 d |
| OD-21 | Launch variant (D20): Full, Early or Launch A | Full if P12 is merged by T−21 d; Early if only P12 is late; Launch A if the calendar slips by more than a month | T−21 d |
| OD-22 | Create the 2-OCPU worker VM in P3 and use it for the dev worker until P13 (feasibility F-OCI-5 option) | Yes if ap-mumbai-1 has capacity when P3 starts (it removes R3); P13 then re-points it | P3 |
| OD-23 | Transfer the domain to Cloudflare Registrar | Optional; never between T−30 d and T+30 d | after T+30 d |
| OD-24 | Stage C (paid capacity) when a §14.4 trigger fires | Decide at the time; the default is the free mitigations first | when triggered |

### 14.4 Stage C: capacity beyond the free pool (feasibility F-OCI-3)

After D7 the Always Free A1 pool is full (4/4 OCPU, 24/24 GB). P13 records the triggers and options; no spend happens without OD-24.

| Trigger (watched by `ops-weekly.yml` from the worker and socket metrics, and by `opsFreshness`) | Free mitigation first | Paid option [V current OCI price list] |
|---|---|---|
| Backlog older than 24 h on 3 consecutive days | lower the P4 budgets (eager 20 → 10), turn `analysis-live-prewarm` off, P3-D9's 80k pass-1 fallback | +1 OCPU / 6 GB A1 on PAYG for the worker VM ≈ $14 a month |
| `queue_stale` (priority ≥ `GAME_ENDED` waiting > 10 min) more than twice a week | pause backlog slices during the evening peak | same |
| Socket `ws.loop_lag_ms` p99 > 20 ms at peak, or RSS > 4 GB | cap arenas at 64 players (P12 R3) | resize the socket box to 2 OCPU / 12 GB ≈ $14 a month |
| Neon CU-h > 70 % pro-rata on Launch | check `pg_stat_statements` and the wake sources | raise the autoscaling cap; cost at $0.106 per CU-h |

---

## 15. Definition of done

**Platform and accounts**

- [ ] The domain renewed for ≥ 2 years, auto-renew and registrar lock on, registrar 2FA on (D21).
- [ ] Vercel Pro active; project `replay-chess` serves `www.playchess.tech` (primary) and `playchess.tech` (308) from the launch SHA; Skew Protection and a spend cap on.
- [ ] Neon production on Launch with a spend alert and a 7-day history window; dev and E2E on their own project (from P1); the old `dev` branch of the production project deleted.
- [ ] Clerk instance `t0wy2xb4vvpw` in the replaychess007 workspace with the P5 settings; production webhook live; the rehearsal endpoint deleted; the leaked `sk_test_` key revoked and no `sk_live_` key ever committed.
- [ ] Dodo live: products, prices and ids verified; webhook processing; a real charge and its refund done and visible.
- [ ] OCI: socket box and worker VM running v2 images with fresh HMAC kids; totals 4 OCPU / 24 GB / 150 GB; PAYG + quotas + budget alert verified (or the owner declined in writing).
- [ ] R2 buckets with lifecycle (and bucket-lock where available) rules; `media.playchess.tech` live with `nosniff` and the media CSP; Edge Config production store; Resend domain verified; Anthropic production workspaces with limits.
- [ ] `<vercel.json>` the project reads has `supportsCancellation` for the two coach streaming routes, proven by the deployed abort test.

**Data**

- [ ] `verify-counts` passed at `restored` and `upgraded`; report committed (`launch/reports/window.json`).
- [ ] `prisma migrate status` on production: up to date at `…_m13a_jobkind_backup`; C3/C3v confirmed by the owner; no `_m5v_validate_key_moment_fk` anywhere.
- [ ] Every backfill in §6.5 (for the chosen variant) ran with its verification passing (or a written waiver in the report); billing reconciled with 0 differences.
- [ ] Roles and grants match `grants.matrix.json`; `pg_stat_statements` installed; Vercel uses `replay_app`, the socket `replay_realtime`, the worker `replay_worker`, backups `replay_backup`; no runtime env holds the owner role.

**Monitoring, backups, rollback**

- [ ] Sentry releases for web, websocket and worker; every alert rule in §10.2 exists in production and was test-fired once; the `worker-backup` cron monitor reports `ok`.
- [ ] Uptime monitors green (website, landing, game server, coaching engine, media); `status.playchess.tech` live.
- [ ] The first nightly `BACKUP` object exists; a restore drill from it passed; the P1 interim backup workflow disabled after that; CLAUDE.md no longer lists `/tmp/chess_battle_data_fixed.sql`.
- [ ] R#2 report shows every drill within budget (including D-sw and the journal-compatible D-oci); `docs/runbooks/{launch,rollback,restore-from-backup,incident,monitoring}.md` exist and match what was done.

**Product checks**

- [ ] `@prod-smoke` green on production across the six device projects (desktop at 80/100/125/150 %), including `prod-guard` (every registered test hook 404 or ignored) and `telemetry-prod`; one-viewport assertions pass on public board pages.
- [ ] `rehearsal-legacy-client.spec.ts` passed on `next.`.
- [ ] Owner test (§1) items 1–9 passed, including the real iPhone and Android phone checks, with device models and OS versions in `docs/qa/phase-13-signoff.md`.
- [ ] URL parity: 0 failures over the 3,681 legacy sitemap URLs at T+24 h; sitemaps submitted; IndexNow `scope=all` run.
- [ ] All rollout flags of the variant at 100 % in production (§7.10); flag-removal release planned for P13 + 1.
- [ ] Production telemetry verified: events carry `app_env = production`; the internal and synthetic users are excluded; no `dev`/`test` events in the production dashboards at T+24 h.
- [ ] `prod-smoke-schedule.yml` ran every 6 h from T to T+14 d and was then disabled; `WEB/e2e/quarantine.json` is empty.
- [ ] No new unexplained production issue in Sentry and 5xx < 0.5 % over the first 24 h; Speed Insights p75 within OPT §2.3 at T+7 d.

**Legal and hygiene**

- [ ] Legal texts final (OD-16); the Chess.com terms review cleared (P4 OD-2); the third-party asset audit in `WEB/THIRD_PARTY.md` has no asset without a licence; the Stockfish `COPYING` and `SOURCE.txt` are served.
- [ ] Rehearsal branches and laptop plaintext dumps deleted; the encrypted image detached; the Cloudflare DNS token revoked or expired by T+7 d.
- [ ] `CLAUDE.md` in the public repo holds rules only; environments live in the gitignored `CLAUDE.local.md`.
- [ ] `docs/implementation-plan.md` points to this spec; ALLOC §5.1 contract steps C1, C2, C4, C5, C12 scheduled with dates.
- [ ] T+30 d: old Neon project, old Vercel project and the AWS instance retired with the owner's confirmation; `next`/`ws-next` removed; tombstones removed.

---

## Appendix A. Critique dispositions

Revision 2 read the five critiques in `SP/plan/` (coverage, consistency, feasibility, testing, api-perf) and took every finding that names P13 or a contract P13 operates. "Applied" means the change is in the section named. Findings that belong to other phases are fixed there; the ones P13 hands over are in A.3.

### A.1 Applied

| Critique · ID | Finding | Where in this plan |
|---|---|---|
| coverage (phase-13 section) | No boards; S1–S6 reuse earlier boards; no gaps | nothing to change (§4 unchanged in substance) |
| consistency 13.1 / R-08, R-09 | One env name per secret; `R2_PRIVATE_BUCKET` missing; drop the kick-token note | §7.9 (one name each, retired aliases fail `check-env.ts`), D19 |
| consistency 13.2 / R-02 | `_m5v_validate_key_moment_fk` in the production set | §6.2 (removed), §15 |
| consistency 13.3 / R-01, R-04, R-05 | Missing M-items in the production set; M12's conditional `audit_logs` | §6.2 table rows 3, 5, 6, 8, 10, 11, 15 |
| consistency 13.4 / R-04 | Freshness check cites a P12 `audit_logs (category, "createdAt")` index | §6.1, §7.5 (`audit_logs_category_at_idx (category, at DESC)` from M4, column `at`), §9.2 |
| consistency 13.5 / R-14 | `consent_bar` listed as Edge Config | §7.9, §7.10, preflight P8 (`NEXT_PUBLIC_CONSENT_BAR=on`) |
| consistency 13.6 / 4.16 | Trial-reminder backstop attributed to P4 | §7.4 (P10) |
| consistency 13.8 | P2 path points at `p2parts` | path table (final P2 in `REPO/docs/plan/`) |
| consistency R-04 | `AuditLog` ships in M4, which makes the early-launch option safe | §2.3 P12 row, §2.4, §6.2 |
| consistency R-05 | `JOB_PRIORITY` names; `BACKUP` in m13a | D14, §6.5 step 17, §7.5, §7.6, §9.5 |
| consistency R-07 | `system:notice`; one `/internal/emit` body | §5.1, §7.2 |
| consistency R-10 | `CT` = `packages/contracts/src` | path table |
| consistency R-20 | No `db push` on any Neon branch; no hard-coded dev branch ids | D8, OD-13, §6.7 |
| feasibility fix 1 / 10.19 #1 | Domain renewal, registrar lock, optional transfer, DNSSEC | D21, §7.8, preflight P0, R20, OD-23, §11.7, §15 |
| feasibility 10.19 #2 / F-NEON-1 / F-NEON-5.3 | Dev split in P1; Neon history 7 days | D16, §2.3, §6.7, preflight P17 |
| feasibility 10.19 #3 / F-OCI-5 | PAYG in P1; option to create the VM in P3 | D18, D7, OD-4, OD-22, §7.7 |
| feasibility 10.19 #4 / F-OCI-1, F-OCI-3 | Stage C triggers and prices; no Stage B | D7, §2.2, §14.4, R22 |
| feasibility 10.19 #5 / F-NEON-5.1, SEC-7, §2.5 R2 | `BACKUP` off on dev; bucket lock; size alert | D9, §7.5 `backup_storage_high`, §7.6, §8.6 |
| feasibility 10.19 #6 / §2.5 | UptimeRobot terms; alternatives | D11, Q9, Q10, OD-9, R23 |
| feasibility 10.19 #7 | Preflight: Pro, asset audit, Chess.com terms, enum two-release rule, journal compatibility, Neon history, `CLAUDE.local.md` | §8.1 P0, P16–P26, D22 |
| feasibility 10.19 #8 / F-VER-1 / LIC-1 | The live site already charges on Hobby; D17 is a hard blocker | facts table, D17, R21, OD-2 |
| feasibility fix 4 / F-NEON-2 | `HOURLY_TICK` has no owner and costs wakes | §7.4, §7.6, §3.2 (a `backup` slice in P3's daily planner, running in the 21:00 `HOUSEKEEPING` drain), D9, D11 |
| feasibility F-NEON-5.2 | Free keeps one snapshot | §8.3 step 11 note |
| feasibility F-VER-2 | `ops-weekly.yml` moves to P1 | §2.3, §7.4, §7.11, WP-F |
| feasibility F-VER-5 | Speed Insights quota | §9.6 note |
| feasibility F-API-4 / P4 OD-2 | Chess.com terms review blocks launch; no avatars until then | §2.1, preflight P19, §12.6 item 3, §15 |
| feasibility F-LLM-4 | Flat $25 breaker | §7.9, §7.10 (P7's member-scaled breaker) |
| feasibility §2.5 Resend | Launch emails must not starve transactional email | D15, §8.8, OD-20, R19 |
| feasibility §2.5 GitHub Actions | Public-repo assumption | Q11, R24 |
| feasibility LIC-2, LIC-5, LIC-6 | GPL files, asset provenance, portraits | preflight P18, §12.6 item 1, §15 |
| feasibility SEC-1 | The committed key is `sk_test_` | facts table, §11.2 |
| feasibility SEC-2 | `CLAUDE.md` maps the attack surface | OD-13, preflight P20, WP-J, §15 |
| feasibility SEC-4, SEC-8 | HMAC; Caddy refuses unsigned requests | D19, §7.2, §7.7, §12.1 Caddy test |
| feasibility SEC-9 (media part) | `nosniff` and a strict CSP on the media host | §7.8 Transform Rule, §12.6 item 4 |
| feasibility §7 | Registries as directories | §13 intro and WP file lists (both forms named) |
| feasibility §8 / fix 15 | 20 % buffer; Launch A | header, §13.1 total, D20, §2.4, OD-21 |
| feasibility §9 (P13 row) | Rollback additions: domain, Neon history, enum rule, journal compatibility | D21, D16, D22, §8.9 D-oci, §12.1 journal test |
| feasibility §9 (P11 row) | Emergency service worker | §8.10 R2b, §8.9 D-sw |
| testing X1 | Runner wording; test layout | §12 intro, §12.1 file names |
| testing (P13) legacy v1 client | `upgrade_required` path untested | §12.3 `rehearsal-legacy-client.spec.ts`, §15 |
| testing (P13) / X12 | Test hooks absent in production | §12.3 `prod-guard.spec.ts` in `@prod-smoke`, §15 |
| testing (P13) production telemetry | `app_env`, consent, internal users, T+24 h check | §10.1, §12.3 `telemetry-prod.spec.ts`, §8.11, §15 |
| testing (P13) post-launch cadence | `@prod-smoke` every 6 h for 14 days | §7.4, §7.11 `prod-smoke-schedule.yml`, §15 |
| testing (P13) real devices | Record models and OS versions | §12.6 sign-off record, §15 |
| testing X2 | `nightly.yml` must exist (P1) | §2.3 P1 row, §12.5 |
| testing X6 | Event asserted through the sink | §12.3 `legacy-sw.spec.ts` |
| testing X14 | `quarantine.json` empty; regression test per defect | §12 intro, §12.5, §15 |
| testing X15 | Sign-off record | §12.6, WP-J, §15 |
| testing X18 | k6 results as data | §9.5, §12.5 |
| api-perf AP-01 / 4.18 #1 | D16 done in P1; P13 verifies | D16, §2.3, §6.7 |
| api-perf AP-02 / 4.18 #6 | `supportsCancellation` pre-launch check | preflight P21, §12.5, §15 |
| api-perf AP-07 (index names) | Stale index names in §9.2 | §9.2 (`jobs_ready_idx` with `fairSeq`, `audit_logs_category_at_idx`, `training_cards_userId_deck_due_idx`, `game_players_userId_endedAt_gameId_idx`) |
| api-perf §1 priority row / 4.18 #3 | "priority 0" for live games in the capacity run | §9.5 (`JOB_PRIORITY.GAME_ENDED`) |
| api-perf AP-08 | Timers that keep Neon awake | §7.4, §7.6 (`BACKUP` runs in the `HOUSEKEEPING` drain; no timer of its own) |
| api-perf AP-15, AP-35 / 4.18 #4 | Server-side SLO sources; budget formulas; timeouts in availability | §9.6 |
| api-perf AP-18 / 4.18 #5 | `ws.persist.fail` alert must exclude reconnects | §10.2 |
| api-perf DB-02 (audit cross-check) | Interim backup until the worker job exists | §2.3 P1 row, §8.11 T+24 h, §15 |
| api-perf AP-44 | Static internal token | D19 |

### A.2 Rejected or changed (one-line reasons)

| Critique · ID | Finding | Disposition and reason |
|---|---|---|
| consistency R-08 | Keep `x-internal-token`; HMAC unscheduled | **Rejected:** the finalised P2 ships HMAC with kids (P2 §7.5.1, its Appendix A rejects R-08 too), and P13 must deploy what P2 built. |
| consistency 13.1 (`LINK_TOKEN_KEYS`) | List `LINK_TOKEN_KEYS` as the one token-key name | **Changed:** P4 rev 2 D4-21 stores no Lichess token, so the variable does not exist; it is on the retired-alias list instead. |
| consistency 13.3 (`HOURLY_TICK` in M3) | Add `HOURLY_TICK` to the production M3 row | **Rejected:** P3 rev 2 (P3-D22) adopted feasibility F-NEON-2's daily planner and creates no `HOURLY_TICK`; the rest of 13.3 is applied (§6.2). |
| consistency 13.7 | Keep the `HOURLY_TICK` cron monitor once P3 builds it | **Changed:** there is no `HOURLY_TICK` (P3-D22); P13 monitors P3's `housekeeping` check-in and its own `worker-backup` (D11, §10.2). |
| consistency 13.9 | Add a P13 WP task for the dev split | **Changed:** feasibility F-NEON-1 and api-perf AP-01 move it to P1 (1B·H10), as the finalised P2 also assumes; P13 verifies and keeps §6.7 only as a fallback. |
| api-perf AP-07 (rename part) | Rename `game_players."endedAt"` to `playedAt` | **Rejected:** consistency R-01 and the finalised P2, P5 and P7 keep `endedAt`; P13 uses P2's index name. |
| api-perf §1 (name `PRIORITY.LIVE_END`) | Use `PRIORITY.LIVE_END` | **Changed:** the canonical constant is `JOB_PRIORITY.GAME_ENDED` (80) from `CT/internal/jobs.ts`, re-exported by `DB/src/jobs.ts` (consistency R-05, P3-D7, P5, P7); same value. |
| feasibility SEC-4 (`packages/internal-auth`) | Build HMAC in a new package | **Changed:** P2 put the helper in `CT/internal/auth.ts`; P13 uses it as is. |
| feasibility F-OCI-4 | `pool.on('error')` and a suspend test | **Not a P13 item:** P2 §6.7 and P3 own the clients; P13's rehearsal k6 run and D-oci drill exercise them on the production boxes. |
| feasibility fix 1 (DNSSEC now) | Enable DNSSEC with the renewal | **Changed:** deferred to T+30 d or later; enabling it while resolvers still cache the old NS pair, or with a wrong DS at the registrar, takes the zone down in the launch month. |
| feasibility fix 1 (Cloudflare Registrar) | Optionally transfer the domain | **Changed:** allowed only outside T−30 d … T+30 d (OD-23); a transfer locks registrar changes for 60 days and adds risk to the window. |
| feasibility F-OCI-5 option | Create the worker VM in P3 for dev | **Owner decision (OD-22):** P13 supports both paths (`oci-create-worker.sh --existing`). |
| feasibility SEC-9 (CSRF part) | Require `Sec-Fetch-Site: same-origin` on mutations | **Not a P13 item:** the route wrapper rule belongs to P1; P13 applies only the media-host headers it sets up. |
| feasibility LIC-7 | Public MIT repo for a paid product | **No P13 change:** an allocation-level owner decision; P13 records the CI-cost assumption (Q11). |
| feasibility SEC-3 | Dev environment is a free copy of the paid product | **Not a P13 item:** P1 (Vercel Authentication on `replay-chess-dev`); the `next.` lane already has its own gate (§11.3). |
| testing X16 | Split the Neon project in P2 | **Changed:** P1 per feasibility and api-perf; P13 verifies. |
| api-perf AP-15 (client metrics via Sentry) | Anonymous client performance metrics through Sentry | **Not decided here:** that is P11's consent decision; P13's SLOs use the server-side sources and treat client numbers as secondary. |

### A.3 Handoffs to other phases (found while revising P13)

| ID | To | Item |
|---|---|---|
| H13-1 | P1 | Owner tasks P13 now verifies instead of doing: 1B·H10 (dev Neon project), PAYG + quotas, domain renewal and lock, `CLAUDE.local.md`; 1B·H11 interim backup; `ops-weekly.yml` with the Neon CU-h alert at 50 % pro-rata (api-perf §5). |
| H13-2 | P12 (with P2) | ADM-11 reads `WS_INTERNAL_URL/internal/metrics` and a worker `/worker/health`, but P2 blocks the socket's `/internal/metrics` at Caddy and lets only the `ops` key call it, and P3 has no `/worker/health`. P12 should read the worker through the signed `GET /worker/metrics` route P13 adds (H13-7), and pick a socket path P2 allows (for example a `web`-signed read-only summary endpoint) or show the socket tile from `/ready`; and rename `WORKER_INTERNAL_URL` / `INTERNAL_HMAC_SECRET` to `ANALYSIS_WORKER_URL` / `INTERNAL_API_SECRET` (consistency R-09). |
| H13-3 | P3 | Nothing to settle any more (P3-D22 chose the daily planner); P13 adds the `backup` slice file to `WK/src/scheduler/recurring/` and relies on P3's `housekeeping` Sentry check-in and the worker's `GET /ready` without a DB call. |
| H13-4 | P11 | `ops-broadcast.yml` gains `target=production` (GitHub environment `production`) and runs P2's signing CLI rather than a `wget` with `x-internal-token`. |
| H13-5 | P10 | Export the durable daily email budget helper (F-NEON-3) so `announce.ts` can share it (D15). |
| H13-6 | P2 + P3 | One wire format in `CT/internal/auth.ts` before launch: P2 ships `x-rc-kid` with key sets in `INTERNAL_API_SECRET`; P3 rev 2 describes `x-rc-caller` with keys derived from one root. P2's format wins (it ships first); P3's callers `web`, `socket`, `worker` become kids (P2's `wk` becomes `worker`), plus P2's `ops`. P13 then sets the separate production keys P3-Q16 asks for (D19). |
| H13-7 | P3 (and P12) | The worker's `GET /internal/metrics` collides with the socket's Caddy-blocked path. P3 adds the alias route `GET /worker/metrics` (same handler, `verifyInternal({allow:["web"]})`), and `worker-alive.ts` calls `${ANALYSIS_WORKER_URL}/worker/metrics`; P13's production Caddyfile proxies it unchanged (no rewrite, because the signature covers the path). P3's dev Caddyfile should add the same route so dev and prod match. |
