/**
 * The P5 hot-query gate (phase-05 plan §9.1, §6.5, §12.2 "Index existence"; optimization §3.5.4). The web-side half of
 * REPO/scripts/explain-hot-queries.ts (P2/P3's gate): it plans the production statements of the Train, Home, review
 * bank fields and report services themselves (their `Prisma.Sql` builders, imported from lib/train, lib/home and
 * lib/reports, which resolve the web's `@/` imports, hence this file lives in apps/web).
 *
 *   cd apps/web && DATABASE_URL=postgresql://…@localhost:5432/replay npx tsx scripts/explain-hot-queries.ts [--check-indexes]
 *
 * 1. Every P5 index of docs/indexes.json (phase "P5") exists in pg_indexes, after `prisma migrate deploy` from scratch.
 *    `--check-indexes` stops here (the migration job's fast check).
 * 2. Every hot query below is EXPLAINed with `enable_seqscan` and `enable_sort` off (a throwaway CI database is nearly
 *    empty; a Seq Scan or a Sort that survives has no index path at all): the gate fails on a Seq Scan over a P5 table
 *    or `game_players`, and on a Sort over `training_cards`, `training_attempts`, `mistakes`, `mistake_occurrences` or
 *    `game_players`. The keyset orders `(due, id)` (bank list, due queue, preview) read training_cards_userId_deck_due
 *    in `due` order and break ties on `id` with an Incremental Sort over the rows of one `due` instant (presorted key
 *    `due`): that node is allowed for the queries that declare `tieBreak`, a full Sort never is.
 *
 * Plain EXPLAIN (never executed), so the writes are planned safely; still, only a local or CI Postgres is accepted.
 * Exit 0 = pass; 1 = a missing index or a bad plan (printed); 2 = setup error.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPrismaClient, Prisma } from "@repo/db";
import { VIEWER_SQL } from "@/lib/auth/viewer";
import { continueGamesSql, recentGamesSql, startHereSql, topThemeSql, weekGamesSql, weekPuzzlesSql } from "@/lib/home/home.server";
import { recentReportsSql, reportTargetSql } from "@/lib/reports/reports.server";
import { reviewReadSql } from "@/lib/services/analysis/review-sql";
import { dayAttemptsSql, lockProfileSql, w1ReadSql, w1WriteSql } from "@/lib/train/attempts.server";
import { dueSummarySql } from "@/lib/train/badges.server";
import { bankFacetsSql, bankRowsSql, dueCardsSql, lastGameSql, themeMasterySql, upcomingDuesSql } from "@/lib/train/bank.server";
import { recentDaysSql } from "@/lib/train/day.server";
import { momentLinkSql } from "@/lib/train/links.server";
import { profileSql } from "@/lib/train/profile.server";
import {
  cardsByKeySql,
  duePuzzleCardsSql,
  gameCardsSql,
  recentPuzzlesSql,
  reuseSql,
  sessionAttemptsByRefSql,
  sessionAttemptsSql,
  sessionSql,
} from "@/lib/train/sessions.server";
import { duePreviewSql, todaysAttemptsSql } from "@/lib/train/today.server";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = path.resolve(WEB, "../..");
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "postgres"]);

/** The P5 tables, and the ones a hot query may never Sort. */
export const P5_TABLES = [
  "mistakes",
  "mistake_occurrences",
  "training_cards",
  "training_attempts",
  "training_sessions",
  "training_days",
  "theme_mastery",
  "training_profiles",
  "reports",
] as const;
const NO_SEQ = [...P5_TABLES, "game_players"];
const NO_SORT = ["training_cards", "training_attempts", "mistakes", "mistake_occurrences", "game_players"];

export type P5HotQuery = {
  name: string;
  sql: Prisma.Sql | string;
  tieBreak?: boolean;
  /** Tables whose Sort this statement may keep (P3's own rules for its reads; see the entries). */
  allowSort?: string[];
};

/** P3's review reads pick the member row with a LATERAL `ORDER BY … LIMIT 1` over the ≤ 2 rows of one game (P3's gate: noSort []). */
const P3_REVIEW_SORT = ["game_players"];

const U = 1n;
const NOW = new Date("2026-11-12T19:00:00.000Z");
const REL = new Date("2026-11-13T08:00:00.000Z");
const REF = "cxxxxxxxxxxxxxxxxxxxxxxxx";
const IDS = Array.from({ length: 500 }, (_, i) => `p${String(i).padStart(4, "0")}`);
const KEYS = ["m_aaaaaaaaaaaa", "m_bbbbbbbbbbbb", "p_00abc"];

/** Every P5 hot statement (§9.1), built by the services' own builders with sample binds. */
export function p5HotQueries(): P5HotQuery[] {
  return [
    // R1 / R2 / HOME / W1 response: statement (a) and the training state batch.
    { name: "R1 (a) due summary (training_cards_userId_deck_due_idx)", sql: dueSummarySql(U, NOW, REL) },
    { name: "R1 (b) week + today's training_days (PK range)", sql: recentDaysSql(U, "2026-11-12") },
    { name: "R1 (c) due preview ≤ 4 (due idx + mistakes_pkey)", sql: duePreviewSql(U, NOW), tieBreak: true },
    { name: "R1 (d) theme mastery (PK prefix)", sql: themeMasterySql(U) },
    { name: "R1 (e) training profile (PK)", sql: profileSql(U) },
    { name: "R1 plan: today's graded attempts (userId, reviewedAt)", sql: todaysAttemptsSql(U, NOW, REL) },
    // R2
    { name: "R2 complete page ≤ 301 rows (due idx + mistakes_pkey + games_pkey)", sql: bankRowsSql(U, { now: NOW, limit: 301 }), tieBreak: true },
    {
      name: "R2 paged, cursor + filters (due idx, keyset)",
      sql: bankRowsSql(U, { now: NOW, filter: { view: "due", theme: "fork", phase: "middlegame", source: "own" }, after: { due: NOW, id: 9n }, limit: 51 }),
      tieBreak: true,
    },
    { name: "R2 facets (GROUPING SETS over the user's range)", sql: bankFacetsSql(U) },
    { name: "R2 upcoming histogram (due idx range)", sql: upcomingDuesSql(U, NOW) },
    { name: "R2 empty bank: the newest analysed game", sql: lastGameSql(U) },
    // Review bank fields (A1 / A2 under `train`), A6.
    { name: "A1 review read with bank fields (one statement)", sql: reviewReadSql("review", { viewerId: U, ref: REF, admin: false, bank: true }), allowSort: P3_REVIEW_SORT },
    { name: "A2 status read with bank fields (one statement)", sql: reviewReadSql("status", { viewerId: U, ref: REF, admin: false, bank: true }), allowSort: P3_REVIEW_SORT },
    { name: "A1/A2 probe with the bank token", sql: reviewReadSql("probe", { viewerId: U, ref: REF, admin: false, bank: true }), allowSort: P3_REVIEW_SORT },
    { name: "A6 moment link (games ref → player → occurrence → mistake → card)", sql: momentLinkSql(U, REF, 36) },
    // W2 / W3 / W4 / R3
    { name: "W2 due queue ≤ 50 (due idx)", sql: dueCardsSql(U, NOW, { theme: "fork" }), tieBreak: true },
    { name: "W2 reuse + durable session limit (userId, startedAt)", sql: reuseSql(U, NOW, "BANK", "f".repeat(32)) },
    { name: "W2 explicit cards by key (userId, itemKey)", sql: cardsByKeySql(U, KEYS) },
    { name: "W2 a game's moment cards (PK / unique lookups)", sql: gameCardsSql(U, REF) },
    { name: "W2 due PUZZLE cards of a theme (due idx)", sql: duePuzzleCardsSql(U, NOW, "fork"), tieBreak: true },
    { name: "W2/W3 recently seen puzzles ≤ 500 ids (training_attempts_puzzle_idx)", sql: recentPuzzlesSql(U, IDS, NOW) },
    { name: "R3/W3/W4 session by ref (referenceId key)", sql: sessionSql(U, REF) },
    { name: "R3/W4 a session's attempts (userId, reviewedAt)", sql: sessionAttemptsSql(U, 5n, NOW) },
    { name: "R3/W4 summary: a session's attempts by its ref (referenceId key → userId, reviewedAt)", sql: sessionAttemptsByRefSql(U, REF) },
    // W1
    {
      name: "W1 locked read: profile, cards, sessions, themes FOR UPDATE + duplicates, graded items, day rows (one statement)",
      sql: w1ReadSql(U, { keys: KEYS, refs: [REF], ids: ["6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b"], dayFrom: "2026-11-10", dayTo: "2026-11-14" }),
    },
    { name: "W1 profile lock after a first write (PK)", sql: lockProfileSql(U) },
    { name: "W1 open plans' earlier graded attempts (userId, reviewedAt)", sql: dayAttemptsSql(U, [{ day: "2026-11-12", from: NOW, to: REL }]) },
    {
      name: "W1 batch write (one statement: cards, new cards, attempts, days, themes, sessions, profile)",
      sql: w1WriteSql(U, {
        cards: [{ id: "1", repsBefore: 0, due: NOW.toISOString(), s: 4, d: 5, ed: 0, sd: 4, ls: 0, reps: 1, lapses: 0, state: "REVIEW", lr: NOW.toISOString(), m: 1 }],
        newCards: [],
        attempts: [],
        days: [{ day: "2026-11-12", br: 1, ni: 0, pd: 0, ms: 1000, bits: 0, tz: "UTC", dsh: 4 }],
        themes: [],
        sessions: [{ id: "5", total: 1, solved: 1, firstTry: 1, withHint: 0, items: null }],
        profile: { r: 1500, rd: 200, vol: 0.06, n: 1, ss: 1, ds: 1, dsb: 1, lad: "2026-11-12" },
      }),
    },
    // HOME-1
    { name: "HOME h1 newest 3 games (userId, endedAt DESC, gameId DESC)", sql: continueGamesSql(U) },
    { name: "HOME h4 recent 8 games", sql: recentGamesSql(U) },
    { name: "HOME h3 this week's games", sql: weekGamesSql(U, NOW) },
    { name: "HOME h3 this week's puzzles", sql: weekPuzzlesSql(U, NOW) },
    { name: "HOME h2 top bank theme", sql: topThemeSql(U) },
    { name: "HOME h6 featured legend position", sql: startHereSql() },
    // /api/me with the badge facts (one statement), W7.
    { name: "/api/me viewer statement with the badge facts", sql: VIEWER_SQL.replace(/\$1/g, "'user_explain'") },
    { name: "W7 the viewer's reports of 24 h (reporterId, createdAt)", sql: recentReportsSql(U, NOW, { targetType: "mistake", targetRef: REF }) },
    { name: "W7 mistake target by card key (userId, itemKey) → mistakes_pkey", sql: reportTargetSql(U, { targetType: "mistake", targetRef: "m_abc" }) },
    { name: "W7 puzzle target visible to the viewer", sql: reportTargetSql(U, { targetType: "puzzle", targetRef: "00abc" }) },
  ];
}

type PlanNode = { "Node Type": string; "Relation Name"?: string; "Presorted Key"?: string[]; Plans?: PlanNode[] };

function walk(node: PlanNode, out: { type: string; relations: string[]; presorted: string[] }[]): string[] {
  const below = (node.Plans ?? []).flatMap((child) => walk(child, out));
  const relations = node["Relation Name"] ? [node["Relation Name"], ...below] : below;
  out.push({ type: node["Node Type"], relations, presorted: node["Presorted Key"] ?? [] });
  return relations;
}

/** The plan problems of one P5 query (empty = fine). Exported for the unit test. */
export function p5PlanProblems(plan: PlanNode, q: Pick<P5HotQuery, "tieBreak" | "allowSort">): string[] {
  const nodes: { type: string; relations: string[]; presorted: string[] }[] = [];
  walk(plan, nodes);
  const problems: string[] = [];
  for (const n of nodes) {
    if (n.type === "Seq Scan" && NO_SEQ.includes(n.relations[0] ?? "")) problems.push(`Seq Scan on ${n.relations[0]}`);
    const sorted = n.relations.filter((r) => NO_SORT.includes(r) && !(q.allowSort ?? []).includes(r));
    if (!sorted.length) continue;
    if (n.type === "Sort") problems.push(`Sort over ${sorted.join(", ")}`);
    if (n.type === "Incremental Sort" && !(q.tieBreak && n.presorted.some((k) => /\bdue\b/.test(k)))) {
      problems.push(`Incremental Sort over ${sorted.join(", ")} (presorted ${n.presorted.join(", ") || "nothing"})`);
    }
  }
  return problems;
}

/** The P5 index names of docs/indexes.json. */
export function p5IndexNames(): string[] {
  const doc = JSON.parse(readFileSync(path.join(ROOT, "docs/indexes.json"), "utf8")) as { indexes: { name: string; phase?: string }[] };
  return doc.indexes.filter((i) => i.phase === "P5").map((i) => i.name);
}

function localUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const host = new URL(url).hostname;
  if (!LOCAL_HOSTS.has(host)) throw new Error(`refusing to run against ${host}: a local or CI Postgres only`);
  return url;
}

async function main(argv: readonly string[]): Promise<number> {
  let url: string;
  try {
    url = localUrl();
  } catch (err) {
    console.error(`explain-hot-queries (P5): ${(err as Error).message}`);
    return 2;
  }
  const db = createPrismaClient({ datasourceUrl: url });
  let failed = false;
  try {
    const names = p5IndexNames();
    const rows = await db.$queryRawUnsafe<{ n: string }[]>(`SELECT indexname AS n FROM pg_indexes WHERE schemaname = 'public'`);
    const have = new Set(rows.map((r) => r.n));
    const missing = names.filter((n) => !have.has(n));
    for (const n of missing) console.error(`MISSING index ${n} (docs/indexes.json, phase P5)`);
    if (missing.length || names.length === 0) failed = true;
    else console.log(`P5 indexes: ${names.length} listed, all present`);
    if (argv.includes("--check-indexes")) return failed ? 1 : 0;

    for (const q of p5HotQueries()) {
      const plan = await db.$transaction(async (tx) => {
        await tx.$executeRawUnsafe("SET LOCAL enable_seqscan = off");
        await tx.$executeRawUnsafe("SET LOCAL enable_sort = off");
        type Explained = { "QUERY PLAN": [{ Plan: PlanNode }] }[];
        const r =
          typeof q.sql === "string"
            ? await tx.$queryRawUnsafe<Explained>(`EXPLAIN (FORMAT JSON) ${q.sql}`)
            : await tx.$queryRawUnsafe<Explained>(`EXPLAIN (FORMAT JSON) ${q.sql.text}`, ...q.sql.values);
        return r[0]!["QUERY PLAN"][0].Plan;
      });
      const problems = p5PlanProblems(plan, q);
      if (problems.length) {
        failed = true;
        console.error(`FAIL ${q.name}: ${problems.join("; ")}`);
      } else console.log(`ok   ${q.name}`);
    }
  } catch (err) {
    console.error(`explain-hot-queries (P5): ${(err as Error).message}`);
    return 2;
  } finally {
    await db.$disconnect();
  }
  return failed ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
