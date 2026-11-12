// Backfill: legend comparison facts for finished legend games that have none (phase-03 plan §6.8, §8.9, P3-D24).
//
//   pnpm --filter @repo/db exec tsx scripts/backfill/legend-facts.ts            # dry run: counts per outcome
//   pnpm --filter @repo/db exec tsx scripts/backfill/legend-facts.ts --apply
//   … --member <email>   only that member's games
//
// Candidates: COMPLETED games from a chess position (games."chessPositionId") with moves stored, one row per member
// side without a legend_comparisons row; 500 per batch (keyset on gameId, userId). For each, the one pure rule every
// writer uses (CA `legendFactsOf`: the member side's linked legend record name, else the position's player name;
// the legend line sliced at the game's start; its result), validated with ComparisonFactsV1, inserted as FACTS_READY
// with `ON CONFLICT ("gameId", "userId") DO NOTHING`. No engine work: the evals at the divergence stay null until
// the worker or A9b fills them. A second run finds no candidates left.
//
// Not written (counted and reported instead, CA's reasons): no historical name on the member's side, a position
// without a PGN, a game without moves, a PGN that never reaches the game's start position, a legend line that ends at
// the start position (nothing to compare), an unknown legend result, stored moves that do not replay.
import type { ComparisonFacts } from "@repo/chess-analysis/legend/compare";
import { legendFactsOf, type LegendFactsSkip } from "@repo/chess-analysis/legend/facts";
import { Prisma } from "#generated";
import type { PrismaClient } from "#generated";
import { MAX_TARGET_USERS } from "../../prisma/seed-guards";
import { createPrismaClient } from "../../src/client";
import { buildComparisonFacts } from "../../src/json/legend";
import { checkTripwire, isEntryPoint, parseFlags, positiveInt, reportFailure, resolveWriteTarget } from "../../seed/target";
import { memberIdOf } from "./enqueue-analysis";

export const BATCH = 500;

export interface LegendCandidate {
  gameId: bigint;
  userId: bigint;
  color: string;
  startingFen: string;
  startPly: number;
  moves: string;
  positionId: bigint;
  pgn: string | null;
  gameMetadata: unknown;
  moveNumber: number | null;
  whiteLegendName: string | null;
  blackLegendName: string | null;
  whitePlayerName: string | null;
  blackPlayerName: string | null;
}

export type FactsOutcome = { ok: true; facts: ComparisonFacts } | { ok: false; reason: LegendFactsSkip };

/** The facts for one member side of a legend game, or why there are none. Pure. */
export function legendFactsFor(c: LegendCandidate): FactsOutcome {
  const out = legendFactsOf({
    names: c,
    pgn: c.pgn,
    gameMetadata: c.gameMetadata,
    moveNumber: c.moveNumber,
    startFen: c.startingFen,
    startPly: c.startPly,
    moves: c.moves.trim() === "" ? [] : c.moves.trim().split(/\s+/),
    member: c.color === "b" ? "b" : "w",
  });
  return out.ok ? { ok: true, facts: buildComparisonFacts(out.facts) } : out;
}

export interface LegendFactsResult {
  scanned: number;
  written: number;
  skipped: Record<string, number>;
}

export async function runLegendFacts(
  db: PrismaClient,
  opts: { apply: boolean; batch?: number; memberId?: bigint | null; log?: (line: string) => void },
): Promise<LegendFactsResult> {
  const member = opts.memberId ? Prisma.sql`AND gp."userId" = ${opts.memberId}::bigint` : Prisma.empty;
  const batch = opts.batch ?? BATCH;
  const out: LegendFactsResult = { scanned: 0, written: 0, skipped: {} };
  let after = { gameId: 0n, userId: 0n };
  for (;;) {
    const rows = await db.$queryRaw<LegendCandidate[]>(Prisma.sql`
      SELECT g.id AS "gameId", gp."userId", gp.color, g."startingFen", g."startPly"::int AS "startPly", g.moves, cp.id AS "positionId",
             cp.pgn, cp."gameMetadata", cp."moveNumber", wl.name AS "whiteLegendName", bl.name AS "blackLegendName",
             cp."whitePlayerName", cp."blackPlayerName"
        FROM games g
        JOIN game_players gp ON gp."gameId" = g.id
        JOIN chess_positions cp ON cp.id = g."chessPositionId"
        LEFT JOIN legends wl ON wl.id = cp."whitePlayerId"
        LEFT JOIN legends bl ON bl.id = cp."blackPlayerId"
        LEFT JOIN legend_comparisons lc ON lc."gameId" = g.id AND lc."userId" = gp."userId"
       WHERE g.status = 'COMPLETED' AND g."chessPositionId" IS NOT NULL AND lc."gameId" IS NULL ${member}
         AND (g.id, gp."userId") > (${after.gameId}::bigint, ${after.userId}::bigint)
       ORDER BY g.id, gp."userId"
       LIMIT ${batch}`);
    if (rows.length === 0) break;
    const last = rows[rows.length - 1]!;
    after = { gameId: last.gameId, userId: last.userId };
    out.scanned += rows.length;
    const good: { c: LegendCandidate; facts: ComparisonFacts }[] = [];
    for (const c of rows) {
      const r = legendFactsFor(c);
      if (r.ok) good.push({ c, facts: r.facts });
      else out.skipped[r.reason] = (out.skipped[r.reason] ?? 0) + 1;
    }
    if (opts.apply && good.length > 0) {
      const values = good.map(
        ({ c, facts }) => Prisma.sql`(${c.gameId}::bigint, ${c.userId}::bigint, ${c.positionId}::bigint, ${JSON.stringify(facts)}::jsonb)`,
      );
      out.written += await db.$executeRaw(Prisma.sql`
        INSERT INTO legend_comparisons ("gameId", "userId", "chessPositionId", status, facts, attempts, "createdAt", "updatedAt")
        SELECT v.game_id, v.user_id, v.position_id, 'FACTS_READY', v.facts, 0, (now() AT TIME ZONE 'UTC'), (now() AT TIME ZONE 'UTC')
          FROM (VALUES ${Prisma.join(values, ",\n")}) AS v(game_id, user_id, position_id, facts)
        ON CONFLICT ("gameId", "userId") DO NOTHING`);
    }
    opts.log?.(`  batch up to game ${after.gameId}: ${rows.length} side(s), ${good.length} with facts`);
    if (rows.length < batch) break;
  }
  return out;
}

async function main() {
  const { flags, values } = parseFlags(process.argv.slice(2), { booleans: ["--apply"], values: ["--batch", "--member"] });
  const apply = flags.has("--apply");
  const batch = positiveInt("--batch", values.get("--batch"), BATCH, BATCH);
  const target = resolveWriteTarget();
  console.log(`target   ${target.host}  (${target.kind}; DIRECT_URL from ${target.origin})`);
  console.log(`mode     ${apply ? "APPLY" : "dry run (no writes; pass --apply to write)"}`);
  const db = createPrismaClient({ datasourceUrl: target.url });
  try {
    console.log(`tripwire users = ${await checkTripwire(db)} (limit ${MAX_TARGET_USERS})`);
    const memberId = await memberIdOf(db, values.get("--member"));
    const r = await runLegendFacts(db, { apply, batch, memberId, log: (l) => console.log(l) });
    const skipped = Object.entries(r.skipped).map(([k, n]) => `${k} ${n}`).join(", ") || "none";
    const withFacts = r.scanned - Object.values(r.skipped).reduce((a, b) => a + b, 0);
    console.log(`\n${r.scanned} member side(s) without facts; ${withFacts} with a comparison; skipped: ${skipped}.`);
    console.log(apply ? `applied: ${r.written} row(s) inserted.` : "dry run: no writes.");
  } finally {
    await db.$disconnect();
  }
}

if (isEntryPoint(import.meta.url)) main().catch((err: unknown) => reportFailure("backfill/legend-facts", err));
