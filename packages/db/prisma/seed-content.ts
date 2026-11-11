// Dev-DB content seed (SPEC §11, 05 §4). Guarded, idempotent, dry run by default.
//
//   pnpm --filter @repo/db seed:content [-- --apply] [--source fixtures|json|db]
//        [--from-json <file>] [--retire-placeholders] [--with-tournament-fixtures]
//
// Guards (all before any write; see prisma/seed-guards.ts):
//   1. Loads only apps/web/.env.development.local (never .env.local = old prod) and
//      says whether DIRECT_URL came from that file or the shell.
//   2. The target is DIRECT_URL, and its host must be the dev endpoint. No override flag. The design fixtures
//      (`--source fixtures`, the default) may also go to a loopback Postgres (a local Docker or CI service
//      database, which needs the legends for the legend specs); copies of old prod content never do.
//   3. Writes go through its own PrismaClient on that URL, never lib/prisma.ts.
//   4. A `db` source host must be neither the target nor a dev host.
//   5. Tripwire: the target must have at most MAX_TARGET_USERS (seed-guards.ts) users.
//   6. Writes only with --apply, in ONE transaction covering every row.
//   7. Never runs prisma migrate / db push.  8. Prints hosts only, never credentials.
//
// `--source json|db` copy content from old prod (05 §4.4/§4.7). They need the
// owner's approval to read old prod (05 §7.1) and are not part of the Phase 1 run.

import { readFileSync } from "node:fs";
import path from "node:path";
import { config as loadEnv, parse as parseEnv } from "dotenv";
import { Prisma, PrismaClient } from "#generated";
import {
  DB_NULL,
  countActions,
  fixtureSnapshot,
  hasWrites,
  isPendingLegend,
  isPendingTournament,
  mediaHosts,
  normalizeExport,
  planContent,
  planRetirePlaceholders,
  planTournamentFixtures,
  TOURNAMENT_FIXTURE_OWNER_EMAIL,
  TOURNAMENT_FIXTURE_PARTICIPANT_EMAILS,
  type PlanRow,
  type SourceKind,
  type SourceSnapshot,
  type TargetSnapshot,
} from "./seed-content-plan";
import {
  DEV_ENV_FILE,
  MAX_TARGET_USERS,
  SeedGuardError,
  assertDevTarget,
  assertFixtureContentTarget,
  assertSourceNotTarget,
  assertUserTripwire,
  resolveEnvVar,
} from "./seed-guards";

interface Options {
  apply: boolean;
  source: SourceKind;
  fromJson: string | null;
  retirePlaceholders: boolean;
  withTournamentFixtures: boolean;
}

function parseArgs(argv: string[]): Options {
  const args = argv.filter((a) => a !== "--");
  const opts: Options = {
    apply: false,
    source: "fixtures",
    fromJson: null,
    retirePlaceholders: false,
    withTournamentFixtures: false,
  };
  let sourceGiven = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    const value = (): string => {
      const v = a.includes("=") ? a.slice(a.indexOf("=") + 1) : args[++i];
      if (!v) throw new Error(`${a} needs a value`);
      return v;
    };
    if (a === "--apply") opts.apply = true;
    else if (a === "--retire-placeholders") opts.retirePlaceholders = true;
    else if (a === "--with-tournament-fixtures") opts.withTournamentFixtures = true;
    else if (a === "--source" || a.startsWith("--source=")) {
      const v = value();
      if (v !== "fixtures" && v !== "json" && v !== "db") throw new Error(`--source must be fixtures, json or db (got ${v})`);
      opts.source = v;
      sourceGiven = true;
    } else if (a === "--from-json" || a.startsWith("--from-json=")) opts.fromJson = value();
    else throw new Error(`unknown argument ${a}`);
  }
  if (opts.fromJson && !sourceGiven) opts.source = "json";
  if (opts.source === "json" && !opts.fromJson) throw new Error("--source json needs --from-json <file>");
  if (opts.source !== "json" && opts.fromJson) throw new Error("--from-json only goes with --source json");
  return opts;
}

/** Maps planner values to Prisma inputs (DB_NULL → Prisma.DbNull). */
function toPrisma(data: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v === DB_NULL ? Prisma.DbNull : v]));
}

function shortKey(key: string): string {
  return key.length > 60 ? key.slice(0, 57) + "..." : key;
}

function printTable(name: string, rows: PlanRow[], verbose: boolean) {
  const c = countActions(rows);
  console.log(
    `  ${name.padEnd(24)} insert ${c.insert}  update ${c.update}  unchanged ${c.unchanged}  conflict ${c.conflict}`,
  );
  if (!verbose) return;
  for (const r of rows) {
    if (r.action === "unchanged") continue;
    const detail = r.action === "update" ? ` [${r.changed?.join(", ")}]` : r.reason ? ` (${r.reason})` : "";
    console.log(`      ${r.action.padEnd(8)} ${shortKey(r.key)}${detail}`);
  }
}

async function readOldProd(sourceUrl: string): Promise<unknown> {
  const src = new PrismaClient({ datasourceUrl: sourceUrl });
  try {
    // One REPEATABLE READ, READ ONLY transaction: a consistent snapshot, and the server rejects writes.
    // Explicit column lists; only legends, chess_positions and openings are named. sourceMetadata is not read.
    return await src.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY");
        const legends = await tx.$queryRaw`SELECT "referenceId", name, era, "profilePhotoUrl", "peakRating", nationality,
          "shortDescription", "playingStyle", "birthYear", "deathYear", achievements, "famousGames", "isActive", "isVisible", "createdAt"
          FROM legends ORDER BY id`;
        const positions = await tx.$queryRaw`SELECT p."referenceId", p.fen, p."sideToMove", p.pgn, p."moveNumber",
          p."whitePlayerName", p."blackPlayerName", p."whitePlayerMetadata", p."blackPlayerMetadata", p."tournamentName",
          p."eventDate", p."gameMetadata", p."positionType", p."positionContext", p.explanation, p."explanationAudioUrl",
          p."sourceType", p."popularityScore", p.featured, p."isActive", p."createdAt",
          wl."referenceId" AS "whiteLegendRef", bl."referenceId" AS "blackLegendRef"
          FROM chess_positions p
          LEFT JOIN legends wl ON wl.id = p."whitePlayerId"
          LEFT JOIN legends bl ON bl.id = p."blackPlayerId"
          ORDER BY p.id`;
        const openings = await tx.$queryRaw`SELECT "referenceId", eco, name, pgn, fen, "sideToMove", "moveCount", "isActive",
          explanation, "explanationAudioUrl", "createdAt" FROM openings
          WHERE explanation IS NOT NULL OR "explanationAudioUrl" IS NOT NULL ORDER BY id`;
        const openingKeys = await tx.$queryRaw`SELECT "referenceId", eco, name, pgn, fen, "sideToMove", "moveCount", "createdAt"
          FROM openings ORDER BY id`;
        return { legends, positions, openings, openingKeys };
      },
      { timeout: 120_000, maxWait: 20_000 },
    );
  } finally {
    await src.$disconnect();
  }
}

async function readTarget(prisma: PrismaClient, withOpenings: boolean): Promise<TargetSnapshot> {
  const [legends, positions, openings] = await Promise.all([
    prisma.legend.findMany({
      select: {
        id: true,
        referenceId: true,
        name: true,
        era: true,
        profilePhotoUrl: true,
        peakRating: true,
        nationality: true,
        shortDescription: true,
        playingStyle: true,
        birthYear: true,
        deathYear: true,
        achievements: true,
        famousGames: true,
        isActive: true,
        isVisible: true,
      },
      orderBy: { id: "asc" },
    }),
    prisma.chessPosition.findMany({
      select: {
        id: true,
        referenceId: true,
        fen: true,
        sideToMove: true,
        pgn: true,
        moveNumber: true,
        whitePlayerName: true,
        blackPlayerName: true,
        whitePlayerMetadata: true,
        blackPlayerMetadata: true,
        whitePlayerId: true,
        blackPlayerId: true,
        tournamentName: true,
        eventDate: true,
        gameMetadata: true,
        positionType: true,
        positionContext: true,
        explanation: true,
        explanationAudioUrl: true,
        sourceType: true,
        sourceMetadata: true,
        popularityScore: true,
        featured: true,
        isActive: true,
      },
      orderBy: { id: "asc" },
    }),
    withOpenings
      ? prisma.opening.findMany({
          select: { id: true, eco: true, name: true, pgn: true, isActive: true, explanation: true, explanationAudioUrl: true },
          orderBy: { id: "asc" },
        })
      : Promise.resolve([]),
  ]);
  return { legends, positions, openings } as TargetSnapshot;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  // The dev env file lives with the web app (apps/web/.env.development.local).
  const webDir = path.resolve(import.meta.dirname, "..", "..", "..", "apps", "web");
  const envPath = path.join(webDir, DEV_ENV_FILE);

  // Guard 1: only .env.development.local. Capture the shell value before dotenv (which never overrides it).
  const shellDirect = process.env.DIRECT_URL;
  let fileEnv: Record<string, string> = {};
  try {
    fileEnv = parseEnv(readFileSync(envPath));
  } catch {
    console.log(`note: ${DEV_ENV_FILE} not found; using the shell environment only`);
  }
  loadEnv({ path: envPath, quiet: true });
  const direct = resolveEnvVar("DIRECT_URL", shellDirect, fileEnv.DIRECT_URL);

  const origin = direct.origin === "file" ? DEV_ENV_FILE : direct.origin;
  if (direct.origin !== "file") console.log(`note     DIRECT_URL comes from the ${origin}, not ${DEV_ENV_FILE}`);

  // Guard 2: the dev endpoint only (the design fixtures: or a loopback Postgres).
  const targetHost = opts.source === "fixtures" ? assertFixtureContentTarget(direct.value) : assertDevTarget(direct.value);
  console.log(`target   ${targetHost}  (DIRECT_URL from ${origin})`);
  console.log(`mode     ${opts.apply ? "APPLY (one transaction)" : "dry run (no writes; pass -- --apply to write)"}`);
  console.log(`source   ${opts.source}${opts.fromJson ? ` (${opts.fromJson})` : ""}`);

  // Guard 4 and the source read.
  let snapshot: SourceSnapshot;
  const notes: string[] = [];
  if (opts.source === "fixtures") {
    snapshot = fixtureSnapshot();
  } else {
    let raw: unknown;
    if (opts.source === "json") {
      raw = JSON.parse(readFileSync(path.resolve(process.cwd(), opts.fromJson!), "utf8"));
    } else {
      const sourceHost = assertSourceNotTarget(process.env.OLD_PROD_DATABASE_URL, targetHost);
      console.log(`reading  ${sourceHost} (REPEATABLE READ, READ ONLY)`);
      raw = await readOldProd(process.env.OLD_PROD_DATABASE_URL!);
    }
    const normalized = normalizeExport(raw);
    snapshot = normalized.snapshot;
    if (normalized.droppedColumns.length > 0) notes.push(`dropped source columns: ${normalized.droppedColumns.join(", ")}`);
    const hosts = Object.entries(mediaHosts(snapshot));
    if (hosts.length > 0) {
      notes.push("media URLs are copied verbatim and still point at the source (prod) bucket:");
      for (const [k, n] of hosts) notes.push(`  ${k}: ${n}`);
    }
  }

  // Guard 3: our own client on the guarded URL.
  const prisma = new PrismaClient({ datasourceUrl: direct.value });
  try {
    // Guard 5: the tripwire.
    const users = await prisma.user.count();
    assertUserTripwire(users);
    console.log(`tripwire users = ${users} (limit ${MAX_TARGET_USERS})`);

    const target = await readTarget(prisma, snapshot.openings.length > 0);
    const plan = planContent(snapshot, target);
    const retire = opts.retirePlaceholders ? planRetirePlaceholders(target.positions) : [];

    let tournaments: PlanRow[] = [];
    let participants: PlanRow[] = [];
    if (opts.withTournamentFixtures) {
      const emails = [TOURNAMENT_FIXTURE_OWNER_EMAIL, ...TOURNAMENT_FIXTURE_PARTICIPANT_EMAILS];
      const seedUsers = await prisma.user.findMany({ where: { email: { in: emails } }, select: { id: true, email: true } });
      const idOf = (e: string) => seedUsers.find((u) => u.email === e)?.id ?? null;
      const ownerId = idOf(TOURNAMENT_FIXTURE_OWNER_EMAIL);
      const existing = ownerId
        ? await prisma.tournament.findMany({ where: { createdByUserId: ownerId }, select: { id: true, name: true, createdByUserId: true } })
        : [];
      const existingParts = existing.length
        ? await prisma.tournamentParticipant.findMany({
            where: { tournamentId: { in: existing.map((t) => t.id) } },
            select: { tournamentId: true, userId: true },
          })
        : [];
      ({ tournaments, participants } = planTournamentFixtures(
        {
          ownerId,
          participantIds: TOURNAMENT_FIXTURE_PARTICIPANT_EMAILS.map(idOf),
          tournaments: existing,
          participants: existingParts,
        },
        new Date(),
      ));
    }

    console.log("\nplan");
    printTable("legends", plan.legends, true);
    printTable("chess_positions", plan.positions, true);
    if (snapshot.openings.length > 0) printTable("openings", plan.openings, plan.openings.length <= 50);
    if (opts.retirePlaceholders) printTable("retire placeholders", retire, true);
    if (opts.withTournamentFixtures) {
      printTable("tournaments", tournaments, true);
      printTable("tournament_participants", participants, false);
    }
    for (const l of [...plan.log, ...notes]) console.log(`  ${l}`);

    const all = [...plan.legends, ...plan.positions, ...plan.openings, ...retire, ...tournaments, ...participants];
    const conflicts = all.filter((r) => r.action === "conflict");

    if (!opts.apply) {
      console.log(`\ndry run: no writes.${hasWrites(all) ? "" : " Every row is unchanged."}`);
      return;
    }
    if (conflicts.length > 0) {
      throw new SeedGuardError(`refusing to apply: ${conflicts.length} conflict row(s); fix the data first`);
    }
    if (!hasWrites(all)) {
      console.log("\nnothing to write: every row is unchanged.");
      return;
    }

    // Guard 6: one transaction for every row.
    const started = Date.now();
    await prisma.$transaction(
      async (tx) => {
        assertUserTripwire(await tx.user.count());
        const legendIds = new Map<string, bigint>();
        for (const r of plan.legends) {
          if (r.action === "insert") {
            const row = await tx.legend.create({ data: toPrisma(r.data) as Prisma.LegendUncheckedCreateInput, select: { id: true } });
            legendIds.set(r.key, row.id);
          } else if (r.action === "update") {
            await tx.legend.update({ where: { id: r.id! }, data: toPrisma(r.data) as Prisma.LegendUncheckedUpdateInput });
          }
        }
        const resolveFks = (data: Record<string, unknown>) => {
          const out = { ...data };
          for (const col of ["whitePlayerId", "blackPlayerId"]) {
            const v = out[col];
            if (isPendingLegend(v)) {
              const id = legendIds.get(v.pendingLegend);
              if (id === undefined) throw new Error(`internal: pending legend ${v.pendingLegend} was not inserted`);
              out[col] = id;
            }
          }
          return toPrisma(out);
        };
        for (const r of plan.positions) {
          if (r.action === "insert") {
            await tx.chessPosition.create({ data: resolveFks(r.data) as Prisma.ChessPositionUncheckedCreateInput });
          } else if (r.action === "update") {
            await tx.chessPosition.update({ where: { id: r.id! }, data: resolveFks(r.data) as Prisma.ChessPositionUncheckedUpdateInput });
          }
        }
        for (const r of plan.openings) {
          if (r.action === "insert") {
            await tx.opening.create({ data: toPrisma(r.data) as Prisma.OpeningUncheckedCreateInput });
          } else if (r.action === "update") {
            await tx.opening.update({ where: { id: r.id! }, data: toPrisma(r.data) as Prisma.OpeningUncheckedUpdateInput });
          }
        }
        for (const r of retire) {
          if (r.action === "update") await tx.chessPosition.update({ where: { id: r.id! }, data: { isActive: false } });
        }
        const tournamentIds = new Map<string, bigint>();
        for (const r of tournaments) {
          if (r.action !== "insert") continue;
          const row = await tx.tournament.create({ data: r.data as Prisma.TournamentUncheckedCreateInput, select: { id: true } });
          tournamentIds.set(r.key, row.id);
        }
        for (const r of participants) {
          if (r.action !== "insert") continue;
          const tid = r.data.tournamentId;
          const tournamentId = isPendingTournament(tid) ? tournamentIds.get(tid.pendingTournament) : (tid as bigint);
          if (tournamentId === undefined) throw new Error(`internal: tournament for ${r.key} was not inserted`);
          await tx.tournamentParticipant.create({
            data: { ...r.data, tournamentId } as Prisma.TournamentParticipantUncheckedCreateInput,
          });
        }
      },
      { timeout: 120_000, maxWait: 20_000 },
    );
    console.log(`\napplied in one transaction (${Date.now() - started} ms). Run again without --apply: every row should be unchanged.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  // Prisma and guard errors carry hosts at most, never credentials.
  const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  console.error(`\nseed-content failed: ${msg}`);
  process.exitCode = 1;
});
