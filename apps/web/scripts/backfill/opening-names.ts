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

export async function runOpeningNames(db: BackfillDb, apply: boolean, log: (line: string) => void): Promise<{ scanned: number; changed: number; ecoChanged: number }> {
  let scanned = 0;
  let changed = 0;
  let ecoChanged = 0;
  const examples: string[] = [];
  await eachBatch(async (cursor, limit) => {
    const rows = await db.$queryRaw<StoredOpening[]>(batchSql(cursor, limit));
    const fixes: { id: bigint; openingName: string; ecoCode: string | null }[] = [];
    for (const row of rows) {
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
  log(`imported games with a name ${scanned}; ${apply ? "rewritten" : "would rewrite"} ${changed} (ECO changed on ${ecoChanged})`);
  for (const e of examples) log(e);
  return { scanned, changed, ecoChanged };
}

async function main(): Promise<void> {
  const cli = parseBackfillArgs(process.argv.slice(2));
  const log = (line: string) => console.log(line);
  const { db } = await openBackfillDb(log);
  try {
    const counts = await runOpeningNames(db, cli.apply, log);
    if (cli.apply) {
      await audit(db, { category: "SYSTEM", action: "backfill.opening_names", actorKind: "SYSTEM", targetType: "backfill", targetId: "opening_names", meta: counts });
    } else {
      log("dry run: nothing written (pass --apply to write)");
    }
  } finally {
    await db.$disconnect();
  }
}

if (isEntryPoint(import.meta.url)) main().catch((err: unknown) => reportFailure("opening-names", err));
