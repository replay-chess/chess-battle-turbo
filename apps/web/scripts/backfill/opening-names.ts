/**
 * Opening-name repair (phase-6 fix-5 item C). Imported games stored before the fix carry the Chess.com ECOUrl slug as
 * their `openingName` ("Indian Game East Indian Przepiorka Variation...5.O-O O-O 6.c3 c6 7.Nbd2"). The read paths
 * already show them by the shared rule (@repo/chess-import/opening-name `openingOfGame`); this rewrites the stored
 * rows to what the fixed mapper stores, so search (`q` reads `games."openingName"`) and the weakness Openings tab
 * (`game_players."ecoCode"`) agree with what is shown.
 *
 *   cd apps/web
 *   npx tsx scripts/backfill/opening-names.ts            # dry run: rows that would change, and a few examples
 *   npx tsx scripts/backfill/opening-names.ts --apply    # rewrites them in keyset batches of 500 games
 *   npx tsx scripts/backfill/opening-names.ts --verify   # read only: 0 to rewrite and every stored name displayed as is
 *
 * Rows: `games` with source CHESSCOM or LICHESS and an `openingName` (Replay Chess games are named by the worker from
 * the book and never change). Per row: `openingOfGame` on the stored name, ECO, start and the first 220 chars of
 * `moves`; a row whose name or ECO differs gets `games."openingName"` (≤ 80 chars, cut between words),
 * `games."ecoCode"` and its `game_players."ecoCode"` rewritten. Idempotent: a fixed row is a proper name, so a second
 * run finds nothing. After an --apply that changed ECO codes, run enqueue-weakness-recompute.ts (B-W3) so the
 * Openings tab is rebuilt. Guards (host allowlist, user tripwire, dry run by default): ./p04-common.ts. Prints counts
 * and opening names only.
 */
import { clipWords, OPENING_NAME_MAX } from "@repo/chess-import/types";
import { openingOfGame } from "@repo/chess-import/opening-name";
import { Prisma } from "@repo/db";
import { audit } from "../../lib/audit";
import { eachBatch, isEntryPoint, openBackfillDb, parseBackfillArgs, reportFailure, type BackfillDb } from "./p04-common";

/** The head of `moves` read per game (≥ the book's longest line, 36 plies). */
const MOVES_HEAD = 220;

export interface StoredOpening {
  id: bigint;
  openingName: string;
  ecoCode: string | null;
  startingFen: string;
  moves: string;
}

/** The repaired name and ECO of one row, or null when it is already what the mapper stores now (pure). */
export function repairedOpening(row: Omit<StoredOpening, "id">): { openingName: string; ecoCode: string | null } | null {
  const o = openingOfGame({ name: row.openingName, eco: row.ecoCode, startingFen: row.startingFen, moves: row.moves });
  const openingName = o ? clipWords(o.name, OPENING_NAME_MAX) : null;
  const ecoCode = o?.eco && /^[A-E]\d\d$/.test(o.eco) ? o.eco : row.ecoCode;
  if (!openingName) return null; // nothing left of the name: keep the row as it is
  return openingName === row.openingName && ecoCode === row.ecoCode ? null : { openingName, ecoCode };
}

function batchSql(after: bigint, limit: number): Prisma.Sql {
  return Prisma.sql`
    SELECT id, "openingName", "ecoCode", "startingFen", left(moves, ${MOVES_HEAD}::int) AS moves
      FROM games
     WHERE id > ${after.toString()}::bigint AND source IN ('CHESSCOM', 'LICHESS') AND "openingName" IS NOT NULL
     ORDER BY id LIMIT ${limit}`;
}

async function applyBatch(db: BackfillDb, fixes: { id: bigint; openingName: string; ecoCode: string | null }[]): Promise<void> {
  if (fixes.length === 0) return;
  const rows = JSON.stringify(fixes.map((f) => ({ id: f.id.toString(), name: f.openingName, eco: f.ecoCode })));
  await db.$executeRaw(Prisma.sql`
    WITH fix AS (SELECT * FROM jsonb_to_recordset(${rows}::jsonb) AS r(id bigint, name text, eco text)),
    g AS (UPDATE games SET "openingName" = fix.name, "ecoCode" = fix.eco, "updatedAt" = now()
            FROM fix WHERE games.id = fix.id RETURNING games.id)
    UPDATE game_players gp SET "ecoCode" = fix.eco FROM fix
     WHERE gp."gameId" = fix.id AND gp."ecoCode" IS DISTINCT FROM fix.eco`);
}

/**
 * The name the archive, the review and Home display for a stored row (`openingOfGame`, as `gameRowOf` calls it):
 * after an --apply every imported row stores exactly this (FIX-6 item 4: search reads the stored name).
 */
export function displayedName(row: Omit<StoredOpening, "id">): string | null {
  return openingOfGame({ name: row.openingName, eco: row.ecoCode, startingFen: row.startingFen, moves: row.moves })?.name ?? null;
}

export async function runOpeningNames(
  db: BackfillDb,
  apply: boolean,
  log: (line: string) => void,
): Promise<{ scanned: number; changed: number; ecoChanged: number; displayedDiffers: number }> {
  let scanned = 0;
  let changed = 0;
  let ecoChanged = 0;
  // FIX-6 (--verify): rows whose stored name is not the displayed one, before any rewrite of this run.
  let displayedDiffers = 0;
  const examples: string[] = [];
  await eachBatch(async (cursor, limit) => {
    const rows = await db.$queryRaw<StoredOpening[]>(batchSql(cursor, limit));
    const fixes: { id: bigint; openingName: string; ecoCode: string | null }[] = [];
    for (const row of rows) {
      const shown = displayedName(row);
      if (shown !== null && clipWords(shown, OPENING_NAME_MAX) !== row.openingName) displayedDiffers++;
      const fix = repairedOpening(row);
      if (!fix) continue;
      fixes.push({ id: row.id, ...fix });
      if (fix.ecoCode !== row.ecoCode) ecoChanged++;
      if (examples.length < 5) examples.push(`  ${JSON.stringify(row.openingName)} → ${JSON.stringify(fix.openingName)} (${fix.ecoCode ?? "-"})`);
    }
    scanned += rows.length;
    changed += fixes.length;
    if (apply) await applyBatch(db, fixes);
    return { last: rows.at(-1)?.id ?? null, size: rows.length };
  });
  log(`imported games with a name ${scanned}; ${apply ? "rewritten" : "would rewrite"} ${changed} (ECO changed on ${ecoChanged}); stored ≠ displayed ${displayedDiffers}`);
  for (const e of examples) log(e);
  return { scanned, changed, ecoChanged, displayedDiffers };
}

/**
 * One run as the CLI does it: `dry` reports, `apply` rewrites and writes one audit row, `verify` (read only) is OK when
 * nothing would change and every stored name is the displayed one.
 */
export async function openingNamesRun(db: BackfillDb, mode: "dry" | "apply" | "verify", log: (line: string) => void): Promise<{ counts: Awaited<ReturnType<typeof runOpeningNames>>; ok: boolean }> {
  const counts = await runOpeningNames(db, mode === "apply", log);
  if (mode === "apply") {
    await audit(db, { category: "SYSTEM", action: "backfill.opening_names", actorKind: "SYSTEM", targetType: "backfill", targetId: "opening_names", meta: counts });
    return { counts, ok: true };
  }
  if (mode === "verify") {
    const ok = counts.changed === 0 && counts.displayedDiffers === 0;
    log(ok ? "verify: OK (every imported name is the displayed one)" : "verify: NOT DONE (run --apply)");
    return { counts, ok };
  }
  log("dry run: nothing written (pass --apply to write)");
  return { counts, ok: true };
}

async function main(): Promise<void> {
  const cli = parseBackfillArgs(process.argv.slice(2), ["--verify"]);
  const log = (line: string) => console.log(line);
  const { db } = await openBackfillDb(log);
  try {
    const mode = cli.flags.has("--verify") ? "verify" : cli.apply ? "apply" : "dry";
    if (mode === "verify" && cli.apply) throw new Error("pass --verify alone");
    const r = await openingNamesRun(db, mode, log);
    if (!r.ok) process.exitCode = 1;
  } finally {
    await db.$disconnect();
  }
}

if (isEntryPoint(import.meta.url)) main().catch((err: unknown) => reportFailure("opening-names", err));
