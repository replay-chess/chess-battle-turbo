/**
 * B-W1 weakness inputs backfill (phase-06 plan 6.6, 8.3.2): every analysed game side without inputs
 * (`game_players.accuracy IS NOT NULL AND "weaknessInputsV" = 0`) gets its STATS_V1, ERROR_LOG_V1 and theme occurrences
 * computed from the stored rows, exactly as the worker's final batch and its heal compute them
 * (`@repo/chess-analysis/weakness-inputs` computeSideInputs with the P5 tagger). CPU only, no engine.
 *
 *   cd apps/web
 *   npx tsx scripts/backfill/backfill-weakness-inputs.ts                 # dry run: candidates, members, sample errors
 *   npx tsx scripts/backfill/backfill-weakness-inputs.ts --apply         # writes in keyset batches of 500
 *   npx tsx scripts/backfill/backfill-weakness-inputs.ts --verify        # nothing left + 10 stored rows recomputed
 *   … --member <email>                                                   # only that member's games
 *
 * Per keyset batch over `(gameId, userId)`: one read (game_players ⋈ games ⋈ game_analyses), computeSideInputs per row
 * in TypeScript, then ONE `UPDATE game_players … FROM jsonb_to_recordset($1)` setting the five columns and
 * `"weaknessInputsV" = 1`, guarded by `"weaknessInputsV" = 0` so a concurrent worker write is never overwritten. A
 * second --apply finds nothing (the predicate). A row whose stored arrays do not fit together (a corrupt or partial
 * analysis) is counted and left at 0; the weakness job's heal and the logs show it. `updatedAt` is not touched: the
 * inputs are not part of any payload or ETag.
 *
 * FIX-2 (docs/decisions.md D-P6-FIX2-8): stored data holds a full line only for the review's pass-2 moments; every
 * other error is tagged from its best move alone, where the J5 band was tagged from a full pass-1 PV (multi-move
 * motifs read far below the band). Each game with a side tagged that way (computeSideInputs `report.partial`) gets one
 * `weakness_lines` ANALYZE_GAME row (@repo/db weaknessLinesSql: its own dedupe key, HOUSEKEEPING, no userId; the game's
 * analysis status, review and analysis job untouched): the worker searches every member error's line and refutation
 * and rewrites the inputs fully tagged. The backfill makes profiles available at once; the refreshes make them
 * unbiased as the engine lane gets to them.
 *
 * Rules: ./p04-common.ts (host guard, tripwire, dry run by default) and ./p06-common.ts (one audit row per apply).
 * Release rule (plan 6.6 step 6): run --apply after M6 is deployed; the worker heals missing rows at run time anyway,
 * so this is a speed-up, not a correctness requirement. Runs on the Neon dev branch in stage B (owner action), never in
 * stage A; on production in P13.
 */
import { Prisma } from "@repo/db";
import { weaknessLinesSql } from "@repo/db/weakness-jobs";
import {
  WEAKNESS_INPUTS_VERSION,
  computeSideInputs,
  type SideInputs,
  type SideInputsSide,
} from "@repo/chess-analysis/weakness-inputs";
import {
  BATCH_SIZE,
  isEntryPoint,
  openBackfillDb,
  parseBackfillArgs,
  reportFailure,
  type BackfillDb,
} from "./p04-common";
import { splitMemberArg } from "./enqueue-mistake-extraction";
import { memberIdsOf, memberScopeSql, recordP6Backfill } from "./p06-common";

export interface InputsScope {
  /** Only these members (the CLI's --member; tests). */
  userIds?: readonly bigint[] | null;
}

/** The predicate of plan 6.6 B-W1 (and the verification's "0 left"). */
export function inputsEligibleSql(s: InputsScope): Prisma.Sql {
  return Prisma.sql`gp.accuracy IS NOT NULL AND gp."weaknessInputsV" = 0 ${memberScopeSql("gp", s.userIds)}`;
}

/** Dry run: how many analysed sides lack inputs, for how many members. */
export async function countInputCandidates(db: BackfillDb, s: InputsScope = {}): Promise<{ sides: number; members: number }> {
  const rows = await db.$queryRaw<{ sides: number; members: number }[]>(Prisma.sql`
    SELECT count(*)::int AS sides, count(DISTINCT gp."userId")::int AS members
      FROM game_players gp
     WHERE ${inputsEligibleSql(s)}`);
  return rows[0] ?? { sides: 0, members: 0 };
}

/** One candidate with everything computeSideInputs reads. */
export interface InputsRow {
  gameId: bigint;
  userId: bigint;
  color: string;
  result: string | null;
  startingFen: string;
  startPly: number;
  moves: string;
  moveClocksMs: number[] | null;
  initialTimeSeconds: number | null;
  timeClass: string | null;
  evals: number[];
  best: number[];
  judgements: number[];
  lines: Record<string, { pv: string }> | null;
  middlegamePly: number | null;
  endgamePly: number | null;
  /** games."referenceId" (the regrade's payload). */
  gameRef?: string;
}

const ROW_COLUMNS = Prisma.sql`
  gp."gameId", gp."userId", gp.color, gp.result::text AS result, g."startingFen", g."startPly", g.moves,
  g."referenceId" AS "gameRef", g."moveClocksMs", g."initialTimeSeconds", g."timeClass"::text AS "timeClass", ga.evals, ga.best, ga.judgements,
  ga.lines, ga."middlegamePly", ga."endgamePly"`;

/** One keyset batch of candidates after `(gameId, userId)`. Sides without a stored analysis row are not candidates. */
export function candidatesSql(after: { gameId: bigint; userId: bigint }, limit: number, s: InputsScope = {}): Prisma.Sql {
  return Prisma.sql`
    SELECT ${ROW_COLUMNS}
      FROM game_players gp
      JOIN games g ON g.id = gp."gameId"
      JOIN game_analyses ga ON ga."gameId" = gp."gameId"
     WHERE ${inputsEligibleSql(s)}
       AND (gp."gameId", gp."userId") > (${after.gameId.toString()}::bigint, ${after.userId.toString()}::bigint)
     ORDER BY gp."gameId", gp."userId"
     LIMIT ${limit}`;
}

/** The pure step: one row → its five column values (throws on rows that do not fit together). */
export function inputsOf(r: InputsRow, report?: { partial: number }): SideInputs {
  if (r.color !== "w" && r.color !== "b") throw new RangeError(`colour ${JSON.stringify(r.color)}`);
  return computeSideInputs(
    {
      startingFen: r.startingFen,
      startPly: r.startPly,
      moves: r.moves,
      moveClocksMs: r.moveClocksMs ?? [],
      initialTimeSeconds: r.initialTimeSeconds,
      timeClass: r.timeClass,
    },
    {
      evals: r.evals,
      best: r.best,
      judgements: r.judgements,
      lines: r.lines,
      middlegamePly: r.middlegamePly,
      endgamePly: r.endgamePly,
    },
    { color: r.color, result: r.result as SideInputsSide["result"] },
    report ? { report } : {},
  );
}

/** The batch write: the five columns + the version, only on rows still at version 0. Returns rows changed. */
export function writeInputsSql(rows: readonly { gameId: bigint; userId: bigint; inputs: SideInputs }[]): Prisma.Sql {
  const doc = JSON.stringify(
    rows.map((r) => ({
      gameId: r.gameId.toString(),
      userId: r.userId.toString(),
      stats: r.inputs.stats,
      errorThemes: r.inputs.errorThemes,
      errorLog: r.inputs.errorLog,
      errorThemeN: r.inputs.errorThemeN,
    })),
  );
  return Prisma.sql`
    UPDATE game_players gp
       SET stats = x.stats, "errorThemes" = x."errorThemes", "errorLog" = x."errorLog", "errorThemeN" = x."errorThemeN",
           "weaknessInputsV" = ${WEAKNESS_INPUTS_VERSION}::smallint
      FROM jsonb_to_recordset(${doc}::jsonb)
           AS x("gameId" bigint, "userId" bigint, stats smallint[], "errorThemes" text[], "errorLog" smallint[], "errorThemeN" smallint[])
     WHERE gp."gameId" = x."gameId" AND gp."userId" = x."userId" AND gp."weaknessInputsV" = 0`;
}

export interface InputsOutcome {
  batches: number;
  seen: number;
  written: number;
  /** Rows left at 0 because their stored arrays do not fit together. */
  failed: number;
  /** Up to 10 `gameId:userId (error)` samples of those rows (ids only). */
  failures: string[];
  /** FIX-2: `weakness_lines` refreshes armed for sides tagged without a full line (one per game). */
  regrades: number;
}

/** --apply: every keyset batch until the predicate is exhausted. */
export async function runWeaknessInputs(
  db: BackfillDb,
  opts: InputsScope & {
    limit?: number;
    log?: (line: string) => void;
    /** Arm the `weakness_lines` refreshes (default on; the web route tests' world, which runs no worker, turns it off). */
    regrade?: boolean;
  } = {},
): Promise<InputsOutcome> {
  const limit = opts.limit ?? BATCH_SIZE;
  const out: InputsOutcome = { batches: 0, seen: 0, written: 0, failed: 0, failures: [], regrades: 0 };
  let after = { gameId: 0n, userId: 0n };
  for (;;) {
    const rows = await db.$queryRaw<InputsRow[]>(candidatesSql(after, limit, opts));
    if (rows.length === 0) break;
    const ok: { gameId: bigint; userId: bigint; inputs: SideInputs }[] = [];
    const partial = new Map<string, string>();
    for (const r of rows) {
      try {
        const report = { partial: 0 };
        ok.push({ gameId: r.gameId, userId: r.userId, inputs: inputsOf(r, report) });
        if (report.partial > 0 && r.gameRef) partial.set(String(r.gameId), r.gameRef);
      } catch (err) {
        out.failed++;
        if (out.failures.length < 10) out.failures.push(`${r.gameId}:${r.userId} (${(err as Error).message.slice(0, 80)})`);
      }
    }
    const written = ok.length > 0 ? await db.$executeRaw(writeInputsSql(ok)) : 0;
    if (opts.regrade !== false && partial.size > 0) {
      const [armed] = await db.$queryRaw<{ armed: number }[]>(weaknessLinesSql([...partial].map(([gameId, gameRef]) => ({ gameId, gameRef }))));
      out.regrades += Number(armed?.armed ?? 0);
    }
    out.batches++;
    out.seen += rows.length;
    out.written += written;
    opts.log?.(`  batch ${out.batches}: ${rows.length} side(s), ${written} written, ${rows.length - ok.length} left (inconsistent rows), ${partial.size} lines refresh(es) armed`);
    const last = rows[rows.length - 1] as InputsRow;
    after = { gameId: BigInt(last.gameId), userId: BigInt(last.userId) };
    if (rows.length < limit) break;
  }
  return out;
}

export interface InputsCheck {
  gameId: string;
  userId: string;
  matches: boolean;
}

/** --verify: up to `n` sides already at the current version, recomputed and compared with what is stored. */
export async function verifyStoredInputs(db: BackfillDb, n = 10, s: InputsScope = {}): Promise<InputsCheck[]> {
  const rows = await db.$queryRaw<(InputsRow & { stored: SideInputs })[]>(Prisma.sql`
    SELECT ${ROW_COLUMNS},
           jsonb_build_object('stats', to_jsonb(gp.stats), 'errorLog', to_jsonb(gp."errorLog"),
                              'errorThemeN', to_jsonb(gp."errorThemeN"), 'errorThemes', to_jsonb(gp."errorThemes")) AS stored
      FROM game_players gp
      JOIN games g ON g.id = gp."gameId"
      JOIN game_analyses ga ON ga."gameId" = gp."gameId"
     WHERE gp."weaknessInputsV" = ${WEAKNESS_INPUTS_VERSION} AND gp.accuracy IS NOT NULL ${memberScopeSql("gp", s.userIds)}
     ORDER BY gp."gameId" DESC, gp."userId" DESC
     LIMIT ${n}`);
  return rows.map((r) => {
    let matches = false;
    try {
      const want = inputsOf(r);
      matches =
        JSON.stringify([want.stats, want.errorLog, want.errorThemeN, want.errorThemes]) ===
        JSON.stringify([r.stored.stats, r.stored.errorLog, r.stored.errorThemeN, r.stored.errorThemes]);
    } catch {
      matches = false;
    }
    return { gameId: r.gameId.toString(), userId: r.userId.toString(), matches };
  });
}

async function main(): Promise<void> {
  const { rest, member } = splitMemberArg(process.argv.slice(2));
  const cli = parseBackfillArgs(rest, ["--verify"]);
  const { db } = await openBackfillDb((l) => console.log(l));
  try {
    const userIds = await memberIdsOf(db, member);
    const scope: InputsScope = { userIds };
    const before = await countInputCandidates(db, scope);
    console.log(`mode     ${cli.flags.has("--verify") ? "verify" : cli.apply ? "APPLY" : "dry run (pass --apply to write)"}`);
    console.log(`found    ${before.sides} analysed game side(s) without weakness inputs, ${before.members} member(s)`);
    if (cli.flags.has("--verify")) {
      const checks = await verifyStoredInputs(db, 10, scope);
      for (const c of checks) console.log(`  game ${c.gameId} user ${c.userId}: ${c.matches ? "matches" : "DIFFERS"}`);
      const ok = before.sides === 0 && checks.every((c) => c.matches);
      console.log(ok ? "\nverified: nothing left, the stored inputs match a recomputation." : "\nNOT verified: see above.");
      if (!ok) process.exitCode = 1;
      return;
    }
    if (!cli.apply) {
      // A dry run computes the first batch (no write) so a row that cannot be computed shows up before --apply.
      const sample = await db.$queryRaw<InputsRow[]>(candidatesSql({ gameId: 0n, userId: 0n }, BATCH_SIZE, scope));
      let bad = 0;
      for (const r of sample) {
        try {
          inputsOf(r);
        } catch {
          bad++;
        }
      }
      console.log(`sample   first ${sample.length} candidate(s) computed in memory: ${bad} would be left (inconsistent rows)`);
      console.log("\ndry run: no writes.");
      return;
    }
    const r = await runWeaknessInputs(db, { userIds, log: (l) => console.log(l) });
    await recordP6Backfill(db, "weakness_inputs", {
      sides: r.seen,
      written: r.written,
      failed: r.failed,
      batches: r.batches,
      regrades: r.regrades,
      version: WEAKNESS_INPUTS_VERSION,
    });
    for (const f of r.failures) console.log(`  left at 0: ${f}`);
    console.log(`\napplied: ${r.written} game side(s) written over ${r.batches} batch(es); ${r.failed} left at 0; ${r.regrades} weakness lines refresh(es) armed.`);
  } finally {
    await db.$disconnect();
  }
}

if (isEntryPoint(import.meta.url)) main().catch((err: unknown) => reportFailure("backfill/backfill-weakness-inputs", err));
