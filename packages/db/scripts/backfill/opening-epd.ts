// Backfill `openings.epd` (phase-03 plan §6.8; M3 adds the column and the partial index openings_epd_idx).
//
//   pnpm --filter @repo/db exec tsx scripts/backfill/opening-epd.ts            # dry run: counts and mismatches
//   pnpm --filter @repo/db exec tsx scripts/backfill/opening-epd.ts --apply    # write
//
// For each opening with epd IS NULL (500 per batch, keyset on id): replay `pgn` with chess.js (the same replay the
// worker's book set uses, CA `replayOpening`) and check that the final position's EPD (the first four FEN fields)
// equals the stored `fen`'s. A mismatch, or a line that does not replay, is logged and NOT written (plan R12: a data
// error must not turn into a wrong opening name). Writes `UPDATE … SET epd = $1 WHERE id = $2 AND epd IS NULL`, so a
// second run finds nothing to do. Dev branch or a local Postgres only (seed/target.ts); prod is P13.
import { epdOf } from "@repo/chess-analysis/board";
import { replayOpening } from "@repo/chess-analysis/book";
import { Prisma } from "#generated";
import type { PrismaClient } from "#generated";
import { MAX_TARGET_USERS } from "../../prisma/seed-guards";
import { createPrismaClient } from "../../src/client";
import { checkTripwire, isEntryPoint, parseFlags, positiveInt, reportFailure, resolveWriteTarget } from "../../seed/target";

export const BATCH = 500;
/** openings.epd is VarChar(90). */
export const EPD_MAX = 90;

export type EpdCheck = { ok: true; epd: string } | { ok: false; reason: string };

/** The EPD to store for one opening, or why not. Pure. */
export function epdForOpening(pgn: string, fen: string): EpdCheck {
  let stored: string;
  try {
    stored = epdOf(fen);
  } catch {
    return { ok: false, reason: "the stored fen does not parse" };
  }
  const r = replayOpening(pgn);
  if (r.failedAt !== null) return { ok: false, reason: `the pgn stops at ${r.failedAt}` };
  const last = r.epds[r.epds.length - 1];
  if (last === undefined) return { ok: false, reason: "the pgn has no moves" };
  if (last !== stored) return { ok: false, reason: `replayed "${last}" ≠ stored "${stored}"` };
  if (last.length > EPD_MAX) return { ok: false, reason: `epd longer than ${EPD_MAX}` };
  return { ok: true, epd: last };
}

export interface OpeningEpdResult {
  scanned: number;
  written: number;
  mismatches: { id: bigint; eco: string; name: string; reason: string }[];
}

export async function runOpeningEpd(
  db: PrismaClient,
  opts: { apply: boolean; batch?: number; log?: (line: string) => void },
): Promise<OpeningEpdResult> {
  const batch = opts.batch ?? BATCH;
  const out: OpeningEpdResult = { scanned: 0, written: 0, mismatches: [] };
  let after = 0n;
  for (;;) {
    const rows = await db.$queryRaw<{ id: bigint; eco: string; name: string; pgn: string; fen: string }[]>(Prisma.sql`
      SELECT id, eco, name, pgn, fen FROM openings WHERE epd IS NULL AND id > ${after}::bigint ORDER BY id LIMIT ${batch}`);
    if (rows.length === 0) break;
    after = rows[rows.length - 1]!.id;
    out.scanned += rows.length;
    const good: { id: bigint; epd: string }[] = [];
    for (const r of rows) {
      const c = epdForOpening(r.pgn, r.fen);
      if (c.ok) good.push({ id: r.id, epd: c.epd });
      else out.mismatches.push({ id: r.id, eco: r.eco, name: r.name, reason: c.reason });
    }
    if (opts.apply && good.length > 0) {
      out.written += await db.$executeRaw(Prisma.sql`
        UPDATE openings o SET epd = v.epd
          FROM unnest(${good.map((g) => g.id.toString())}::bigint[], ${good.map((g) => g.epd)}::text[]) AS v(id, epd)
         WHERE o.id = v.id AND o.epd IS NULL`);
    }
    opts.log?.(`  batch up to id ${after}: ${rows.length} scanned, ${good.length} ${opts.apply ? "written" : "would be written"}`);
    if (rows.length < batch) break;
  }
  return out;
}

async function main() {
  const { flags, values } = parseFlags(process.argv.slice(2), { booleans: ["--apply"], values: ["--batch"] });
  const apply = flags.has("--apply");
  const batch = positiveInt("--batch", values.get("--batch"), BATCH, BATCH);
  const target = resolveWriteTarget();
  console.log(`target   ${target.host}  (${target.kind}; DIRECT_URL from ${target.origin})`);
  console.log(`mode     ${apply ? "APPLY" : "dry run (no writes; pass --apply to write)"}`);
  const db = createPrismaClient({ datasourceUrl: target.url });
  try {
    console.log(`tripwire users = ${await checkTripwire(db)} (limit ${MAX_TARGET_USERS})`);
    const r = await runOpeningEpd(db, { apply, batch, log: (l) => console.log(l) });
    for (const m of r.mismatches) console.log(`  skip   ${m.id} ${m.eco} ${m.name}: ${m.reason}`);
    console.log(
      `\n${r.scanned} opening(s) without epd; ${r.mismatches.length} mismatch(es) left as they are; ` +
        (apply ? `${r.written} written.` : `${r.scanned - r.mismatches.length} would be written.`),
    );
  } finally {
    await db.$disconnect();
  }
}

if (isEntryPoint(import.meta.url)) main().catch((err: unknown) => reportFailure("backfill/opening-epd", err));
