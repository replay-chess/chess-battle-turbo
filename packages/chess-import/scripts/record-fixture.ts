/**
 * Records one real public Chess.com month as an anonymised fixture (phase-04 plan §12.5 "recorded", V-3: `%clk`
 * presence and field names). Polite and serial: the same client, gate and User-Agent as the worker, one request at
 * a time with a 1.5 s gap, at most four requests (archives + up to three months back to find one with games).
 *
 *   pnpm --filter @repo/chess-import record-fixture --user <chess.com handle> [--month 2026/10] [--limit 25]
 *       [--input <saved raw month.json>] [--out <dir>]
 *
 * Writes `<out>/chesscom/recorded/<YYYY-MM>.json` (the anonymised month) and `<YYYY-MM>.meta.json` (mapper totals,
 * the number of games with `%clk`, the union of field names). `--input` anonymises a month saved earlier instead of
 * fetching. `CHESSCOM_API_BASE` and `UPSTREAM_CONTACT` apply as in the worker.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ChessComClient, compareMonthKeys } from "../src/chesscom/client";
import { mapChessComGame } from "../src/chesscom/map";
import type { MonthKey } from "../src/chesscom/types";
import { ProviderGate } from "../src/gate";
import { anonymiseMonth, FIXTURE_MEMBER } from "./lib/anonymise";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const arg = (name: string) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};

async function main(): Promise<void> {
  const user = arg("--user");
  if (!user) {
    console.error("usage: record-fixture --user <chess.com handle> [--month YYYY/MM] [--limit N] [--input file] [--out dir]");
    process.exit(2);
  }
  const out = path.resolve(arg("--out") ?? path.resolve(HERE, "../../chess-fixtures/import"));
  const limit = Number(arg("--limit") ?? "40");
  let month = arg("--month") as MonthKey | undefined;
  let games: unknown[];

  const input = arg("--input");
  if (input) {
    if (!month) throw new Error("--input needs --month");
    games = (JSON.parse(readFileSync(input, "utf8")) as { games: unknown[] }).games;
  } else {
    const client = new ChessComClient({
      baseUrl: process.env.CHESSCOM_API_BASE || undefined,
      contact: process.env.UPSTREAM_CONTACT || undefined,
      gate: new ProviderGate({ provider: "chesscom", minIntervalMs: 1_500 }),
      caller: "worker",
    });
    const candidates: MonthKey[] = [];
    if (month) candidates.push(month);
    else {
      const a = await client.getArchives(user);
      if (a.status !== 200) throw new Error("archives: unexpected 304");
      candidates.push(...[...a.months].sort((x, y) => compareMonthKeys(y, x)).slice(0, 3));
    }
    games = [];
    for (const m of candidates) {
      const r = await client.getMonth(user, m);
      if (r.status === 200 && r.games.length > 0) {
        month = m;
        games = r.games;
        break;
      }
    }
    if (!month || games.length === 0) throw new Error("no month with games among the newest three");
  }

  const { games: anon, droppedHeaders } = anonymiseMonth(games, user, limit);
  const totals: Record<string, number> = {};
  let clkGames = 0;
  const fields = new Set<string>();
  for (const g of anon) {
    for (const k of Object.keys(g)) fields.add(k);
    if (/\{\[%clk [^\]]+\]\}/.test((g.pgn as string).split("\n\n")[1] ?? "")) clkGames += 1;
    const r = mapChessComGame(g, { usernameLower: FIXTURE_MEMBER });
    const key = r.ok ? "imported" : r.reason;
    totals[key] = (totals[key] ?? 0) + 1;
  }
  const file = month!.replace("/", "-");
  const dir = path.join(out, "chesscom/recorded");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `${file}.json`), `${JSON.stringify({ games: anon }, null, 2)}\n`);
  writeFileSync(
    path.join(dir, `${file}.meta.json`),
    `${JSON.stringify(
      {
        $comment:
          "A real public Chess.com month, anonymised by packages/chess-import/scripts/record-fixture.ts (usernames, game ids, uuids and links replaced; moves, %clk, ratings and times as recorded). V-3: %clk presence and field names.",
        recordedAt: new Date().toISOString().slice(0, 10),
        month: month,
        member: FIXTURE_MEMBER,
        games: anon.length,
        totals,
        clkGames,
        fields: [...fields].sort(),
        droppedPgnHeaders: droppedHeaders,
      },
      null,
      2,
    )}\n`,
  );
  console.log(`recorded ${anon.length} games of ${month}: ${JSON.stringify(totals)}, %clk in ${clkGames}`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? `${e.name}: ${e.message}` : e);
  process.exit(1);
});
