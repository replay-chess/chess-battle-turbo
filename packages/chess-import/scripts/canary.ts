/**
 * Provider canary (phase-04 plan §12.5b; a job in `nightly.yml`, WP-H). Read-only, through the same clients, gates
 * and User-Agent as the worker, serial and polite (one request at a time per provider, 1 s apart):
 *
 *   - Chess.com: one public account's profile, stats, archives and current-month archive (the newest earlier month
 *     with games as well when the current one is still empty, so the mappers see real games);
 *   - Lichess: one user's public profile and last 5 games as NDJSON (anonymous).
 *
 * Every document is parsed with the provider schemas in **strict** mode (a new or a missing field fails), every game
 * goes through the `CI` mappers, and every mapped game is replayed with chess.js. Variants and unrated games are
 * expected skips; `parse_error`, `not_participant`, a malformed NDJSON line or any schema failure fails the run.
 * It never writes to a database. Exit 0 = pass, 1 = drift or failure, 2 = usage.
 *
 *   pnpm --filter @repo/chess-import canary --chesscom <handle> --lichess <username> [--report <file.json>]
 *
 * `CHESSCOM_API_BASE`, `LICHESS_BASE_URL` and `UPSTREAM_CONTACT` apply as in the worker. The nightly job passes the
 * two handles from repository variables and opens a `provider-drift` issue after two failures in a row.
 */
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { Chess } from "chess.js";
import { ChessComClient, compareMonthKeys } from "../src/chesscom/client";
import { mapChessComGame } from "../src/chesscom/map";
import { chessComSchemas, type MonthKey } from "../src/chesscom/types";
import { describeIssues, isProviderError } from "../src/errors";
import { ProviderGate } from "../src/gate";
import type { Clock, FetchLike } from "../src/http";
import { LichessClient } from "../src/lichess/client";
import { mapLichessGame } from "../src/lichess/map";
import { lichessSchemas } from "../src/lichess/types";
import type { ImportedGame, MapResult } from "../src/types";
import { monthKeyOf } from "../src/window";

export interface CanaryOptions {
  chesscomUser: string;
  lichessUser: string;
  chesscomBase?: string;
  lichessBase?: string;
  contact?: string;
  fetch?: FetchLike;
  clock?: Clock;
  nowMs?: number;
  /** Gap between two requests to the same provider (default 1 s). */
  minIntervalMs?: number;
}

export interface CanaryCheck {
  provider: "chesscom" | "lichess";
  step: string;
  ok: boolean;
  detail?: string;
}

export interface CanaryReport {
  ok: boolean;
  at: string;
  checks: CanaryCheck[];
  games: { chesscom: Record<string, number>; lichess: Record<string, number> };
}

const EXPECTED_SKIPS = new Set(["variant", "unrated", "aborted", "unfinished", "too_short"]);

function replayOk(g: ImportedGame): string | null {
  const c = new Chess(g.startingFen);
  for (const u of g.moves ? g.moves.split(" ") : []) {
    try {
      c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });
    } catch {
      return `illegal ${u}`;
    }
  }
  if (c.fen() !== g.fen) return "final FEN differs";
  if (g.endMethod === "CHECKMATE" && !c.isCheckmate()) return "CHECKMATE game is not mate";
  return null;
}

/** Field paths of the first few strict-schema issues (never values: no personal data in the report). */
const issuePaths = (issues: readonly { path: readonly PropertyKey[]; code: string }[]) => describeIssues(issues);

export async function runCanary(opts: CanaryOptions): Promise<CanaryReport> {
  const checks: CanaryCheck[] = [];
  const tally = { chesscom: {} as Record<string, number>, lichess: {} as Record<string, number> };
  const add = (c: CanaryCheck) => checks.push(c);
  const count = (p: "chesscom" | "lichess", k: string) => (tally[p][k] = (tally[p][k] ?? 0) + 1);
  const gap = opts.minIntervalMs ?? 1_000;

  const cc = new ChessComClient({
    baseUrl: opts.chesscomBase,
    contact: opts.contact,
    fetch: opts.fetch,
    clock: opts.clock,
    gate: new ProviderGate({ provider: "chesscom", clock: opts.clock, minIntervalMs: gap }),
    caller: "worker",
    schemaMode: "strict",
  });
  const li = new LichessClient({
    baseUrl: opts.lichessBase,
    contact: opts.contact,
    fetch: opts.fetch,
    clock: opts.clock,
    gate: new ProviderGate({ provider: "lichess", clock: opts.clock, minIntervalMs: gap }),
    schemaMode: "strict",
  });

  const step = async (provider: "chesscom" | "lichess", name: string, fn: () => Promise<string | void>) => {
    try {
      const detail = await fn();
      add({ provider, step: name, ok: true, ...(detail ? { detail } : {}) });
      return true;
    } catch (e) {
      const detail = isProviderError(e) ? `${e.kind}${e.status ? ` ${e.status}` : ""}: ${e.message}` : String(e);
      add({ provider, step: name, ok: false, detail });
      return false;
    }
  };

  /** One game: the strict-schema issues (or null) and the mapper's result. */
  const judge = (provider: "chesscom" | "lichess", r: MapResult, strictIssues: string | null) => {
    if (strictIssues) return add({ provider, step: "game schema (strict)", ok: false, detail: strictIssues });
    const key = r.ok ? "imported" : r.reason;
    count(provider, key);
    if (!r.ok && !EXPECTED_SKIPS.has(r.reason))
      add({ provider, step: "map game", ok: false, detail: `${r.reason}: ${r.detail}` });
    if (r.ok) {
      const bad = replayOk(r.game);
      if (bad) add({ provider, step: "replay game", ok: false, detail: `${r.game.externalId}: ${bad}` });
    }
  };

  // Chess.com
  const user = opts.chesscomUser;
  const profileOk = await step("chesscom", "profile (strict)", async () => void (await cc.getProfile(user)));
  if (profileOk) {
    await step("chesscom", "stats (strict)", async () => void (await cc.getStats(user)));
    let months: MonthKey[] = [];
    const archivesOk = await step("chesscom", "archives (strict)", async () => {
      const a = await cc.getArchives(user);
      if (a.status !== 200) throw new Error("unexpected 304");
      months = a.months;
      return `${a.months.length} months`;
    });
    if (archivesOk) {
      const current = monthKeyOf(opts.nowMs ?? Date.now());
      const newestFirst = [...months].sort((a, b) => compareMonthKeys(b, a));
      const toRead: MonthKey[] = [current];
      let seen = 0;
      for (const m of toRead) {
        await step("chesscom", `month ${m}`, async () => {
          const r = await cc.getMonth(user, m);
          if (r.status !== 200) throw new Error("unexpected 304");
          for (const raw of r.games) {
            const s = chessComSchemas("strict").game.safeParse(raw);
            judge("chesscom", mapChessComGame(raw, { usernameLower: user.toLowerCase() }), s.success ? null : issuePaths(s.error.issues));
          }
          seen += r.games.length;
          return `${r.games.length} games`;
        });
        if (seen === 0 && toRead.length === 1) {
          const older = newestFirst.find((k) => compareMonthKeys(k, current) < 0);
          if (older) toRead.push(older);
        }
      }
      if (seen === 0) add({ provider: "chesscom", step: "games seen", ok: false, detail: "no games to check" });
    }
  }

  // Lichess
  await step("lichess", "user (strict)", async () => void (await li.getUser(opts.lichessUser)));
  await step("lichess", "last 5 games (strict NDJSON)", async () => {
    const stats = { lines: 0, invalid: 0 };
    let n = 0;
    for await (const raw of li.streamGames(opts.lichessUser, { max: 5 }, { stats })) {
      n += 1;
      const s = lichessSchemas("strict").game.safeParse(raw);
      judge("lichess", mapLichessGame(raw, { userId: opts.lichessUser.toLowerCase() }), s.success ? null : issuePaths(s.error.issues));
    }
    if (stats.invalid > 0) throw new Error(`${stats.invalid} malformed NDJSON lines`);
    if (n === 0) throw new Error("no games to check");
    return `${n} games`;
  });

  return {
    ok: checks.every((c) => c.ok),
    at: new Date(opts.nowMs ?? Date.now()).toISOString(),
    checks,
    games: tally,
  };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const arg = (name: string) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const chesscomUser = arg("--chesscom");
  const lichessUser = arg("--lichess");
  if (!chesscomUser || !lichessUser) {
    console.error("usage: canary --chesscom <handle> --lichess <username> [--report <file.json>]");
    process.exit(2);
  }
  const report = await runCanary({
    chesscomUser,
    lichessUser,
    chesscomBase: process.env.CHESSCOM_API_BASE || undefined,
    lichessBase: process.env.LICHESS_BASE_URL || undefined,
    contact: process.env.UPSTREAM_CONTACT || undefined,
  });
  for (const c of report.checks) console.log(`${c.ok ? "ok  " : "FAIL"} ${c.provider} ${c.step}${c.detail ? ` (${c.detail})` : ""}`);
  console.log(`games: ${JSON.stringify(report.games)}`);
  const out = arg("--report");
  if (out) writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
  console.log(report.ok ? "canary: pass" : "canary: PROVIDER DRIFT OR FAILURE");
  process.exit(report.ok ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e: unknown) => {
    console.error(e instanceof Error ? `${e.name}: ${e.message}` : e);
    process.exit(1);
  });
}
