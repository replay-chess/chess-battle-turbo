/**
 * purge-imports (phase-04 plan §14.4 "Imported data"): the data rollback of imports, the same IMPORT_PURGE job as
 * "Disconnect and delete games", queued for every member who has imported games of one provider (or for one member).
 *
 *   npx tsx scripts/ops/purge-imports.ts --provider chesscom|lichess [--user <users.referenceId>] [--apply]
 *
 * Dry run by default: prints the members and game counts it would purge. `--apply` queues one IMPORT_PURGE per
 * member (`importpurge:<userId>:<provider>`, priority IMPORT_PURGE, the requeue policy: a purge already queued is
 * reset, one already running is left to finish), writes one `audit_logs` row (SYSTEM `ops.purge_imports`, counts only)
 * and kicks the worker when ANALYSIS_WORKER_URL and INTERNAL_API_SECRET are set (otherwise the worker's next-due sweep
 * picks the jobs up). The worker removes the games and their reviews; links stay (unlink them in the app if wanted).
 *
 * Target guard: the same as the P4 backfills (scripts/backfill/p04-common.ts): a local Postgres, the Neon dev
 * endpoint, or a host listed in BACKFILL_ALLOWED_HOSTS (the production direct host, for a rollback window only).
 * Prints hosts and counts, never a URL or a username.
 */
import { JOB_MAX_ATTEMPTS, JOB_PRIORITY, importPurgeDedupeKey } from "@repo/contracts/internal/jobs";
import { Prisma } from "@repo/db";
import { enqueueJobSql } from "@repo/db/jobs";
import { audit } from "../../lib/audit";
import { isEntryPoint, openBackfillDb, reportFailure } from "../backfill/p04-common";

export type PurgeProvider = "chesscom" | "lichess";
export type PurgeTarget = { userId: bigint; userRef: string; games: number };

export interface PurgeDb {
  $queryRaw<T = unknown>(query: Prisma.Sql): PromiseLike<T>;
  $executeRaw(query: Prisma.Sql): PromiseLike<number>;
}

export type PurgeArgs = { provider: PurgeProvider; userRef: string | null; apply: boolean };

export function parsePurgeArgs(argv: readonly string[]): PurgeArgs {
  let provider: PurgeProvider | null = null;
  let userRef: string | null = null;
  let apply = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--apply") apply = true;
    else if (a === "--provider") {
      const v = argv[++i];
      if (v !== "chesscom" && v !== "lichess") throw new Error("--provider must be chesscom or lichess");
      provider = v;
    } else if (a === "--user") {
      const v = argv[++i];
      if (!v || !/^c[a-z0-9]{20,31}$/.test(v)) throw new Error("--user takes a users.referenceId");
      userRef = v;
    } else throw new Error(`unknown argument ${a}`);
  }
  if (!provider) throw new Error("--provider is required");
  return { provider, userRef, apply };
}

const sourceOf = (p: PurgeProvider) => (p === "chesscom" ? "CHESSCOM" : "LICHESS");

/** Members with imported games of the provider (game_players_userId_endedAt_gameId_idx per member). */
export function purgeTargetsSql(provider: PurgeProvider, userRef: string | null): Prisma.Sql {
  return Prisma.sql`SELECT u.id AS "userId", u."referenceId" AS "userRef", count(*)::int AS games
  FROM game_players gp JOIN users u ON u.id = gp."userId"
 WHERE gp.source = ${sourceOf(provider)}::"GameSource" ${userRef ? Prisma.sql`AND u."referenceId" = ${userRef}` : Prisma.empty}
 GROUP BY u.id, u."referenceId"
 ORDER BY u.id`;
}

export async function planPurge(db: PurgeDb, args: Pick<PurgeArgs, "provider" | "userRef">): Promise<PurgeTarget[]> {
  const rows = await db.$queryRaw<{ userId: bigint; userRef: string; games: number }[]>(purgeTargetsSql(args.provider, args.userRef));
  return rows.map((r) => ({ userId: BigInt(r.userId), userRef: r.userRef, games: Number(r.games) }));
}

/** Queues one IMPORT_PURGE per target. Returns how many jobs were queued (a running purge is left alone). */
export async function applyPurge(db: PurgeDb, provider: PurgeProvider, targets: readonly PurgeTarget[], now: Date): Promise<number> {
  const source = sourceOf(provider);
  let queued = 0;
  for (const t of targets) {
    const rows = await db.$queryRaw<unknown[]>(
      enqueueJobSql({
        kind: "IMPORT_PURGE",
        priority: JOB_PRIORITY.IMPORT_PURGE,
        dedupeKey: importPurgeDedupeKey(t.userId, source),
        userId: t.userId,
        payload: { v: 1, userId: t.userId.toString(), provider: source, requestedAt: now.toISOString() },
        runAt: now,
        maxAttempts: JOB_MAX_ATTEMPTS.IMPORT_PURGE,
        onConflict: "requeue",
      }),
    );
    queued += rows.length;
  }
  return queued;
}

export async function main(argv: readonly string[], log: (line: string) => void = (l) => console.log(l)): Promise<void> {
  const args = parsePurgeArgs(argv);
  const { db } = await openBackfillDb(log);
  try {
    const targets = await planPurge(db, args);
    const games = targets.reduce((n, t) => n + t.games, 0);
    log(`purge    ${args.provider}${args.userRef ? ` for ${args.userRef}` : ""}: ${targets.length} member(s), ${games} imported game(s)`);
    for (const t of targets.slice(0, 20)) log(`  ${t.userRef}  ${t.games}`);
    if (!args.apply) {
      log("dry run: nothing queued (pass --apply)");
      return;
    }
    const queued = await applyPurge(db, args.provider, targets, new Date());
    await audit(db, {
      category: "SYSTEM",
      action: "ops.purge_imports",
      actorKind: "SYSTEM",
      targetType: "provider",
      targetId: args.provider,
      meta: { members: targets.length, games, queued, single: args.userRef !== null },
    });
    log(`queued   ${queued} IMPORT_PURGE job(s)`);
    if (process.env.ANALYSIS_WORKER_URL && process.env.INTERNAL_API_SECRET) {
      const { kickImports } = await import("../../lib/jobs/import");
      const kick = await kickImports("import");
      log(`kick     ${kick.ok ? "sent" : `not sent (${kick.reason})`}`);
    } else {
      log("kick     skipped (no worker URL / secret in this shell): the worker's next sweep picks the jobs up");
    }
  } finally {
    await db.$disconnect();
  }
}

if (isEntryPoint(import.meta.url)) {
  main(process.argv.slice(2)).catch((err) => reportFailure("purge-imports", err));
}
