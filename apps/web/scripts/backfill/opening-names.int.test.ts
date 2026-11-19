/**
 * FIX-6 (item 4, D-P6-FIX6-5) on a real Postgres: imported Chess.com games as the batch writer writes them (the real
 * mapper over the repo's Chess.com fixture games and the two staging cases, encoded as Chess.com serves them), with the
 * opening name the build before FIX-5 stored (the ECOUrl slug's words: "Queens Indian Defense Spassky System 4...Bb7
 * 5.Bd3 Bb4"). Through the real archive route (G1):
 *   - regression: archive-search-displayed — a search for the name the archive shows ("Queen's Indian") finds the game
 *     before any rewrite (it found nothing: search read the stored slug words), and "Queens Indian" still does;
 *   - the backfill (scripts/backfill/opening-names.ts): the dry run writes nothing, --apply rewrites each imported row
 *     to exactly the name the archive displays (and nothing else changes), one audit row, a second --apply rewrites 0,
 *     --verify is OK; afterwards every row is found by its displayed name.
 * Skipped unless TEST_DATABASE_URL is set (a local Postgres; never Neon).
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { GamesListResponse, type GameRowDTO } from "@repo/contracts/http/games";
import { mapChessComGame, openingNameFromEcoUrl } from "@repo/chess-import/chesscom/map";
import { encodeChessComGame } from "@repo/chess-import/testing/encode";
import type { ImportedGame } from "@repo/chess-import/types";
import { Prisma, PrismaClient } from "@repo/db";
import type { RouteHandler } from "@/lib/api/route";
import { installTestDeps, jsonOf, noParams, request, viewerFixture } from "../../test/helpers/route-harness";
import { openingNamesRun } from "./opening-names";

const url = process.env.TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
const LOCAL = new Set(["localhost", "127.0.0.1", "::1", "postgres"]);
const FX = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../packages/chess-fixtures/import/chesscom/knightowl_88");
const DAY = 86_400_000;
const T0 = Date.UTC(2026, 9, 1, 12, 0, 0);

/** The two staging names, as Chess.com encodes such games (moves from the opening book's lines, then the slug's). */
const STAGING = [
  {
    id: 900001,
    sans: ["d4", "Nf6", "Nf3", "g6", "g3", "Bg7", "Bg2", "O-O", "O-O", "d6", "c3", "c6", "Nbd2"],
    ecoUrl: "https://www.chess.com/openings/Indian-Game-East-Indian-Przepiorka-Variation...5.O-O-O-O-6.c3-c6-7.Nbd2",
  },
  {
    id: 900002,
    sans: ["d4", "Nf6", "c4", "e6", "Nf3", "b6", "e3", "Bb7", "Bd3", "Bb4+"],
    ecoUrl: "https://www.chess.com/openings/Queens-Indian-Defense-Spassky-System-4...Bb7-5.Bd3-Bb4",
  },
] as const;

describe("P6 FIX-6 opening names: archive search on displayed names, the backfill (Postgres)", { skip: url && LOCAL.has(new URL(url).hostname) ? false : "TEST_DATABASE_URL (local) not set" }, () => {
  let db!: PrismaClient;
  const run = `${Date.now().toString(36)}${randomBytes(3).toString("hex")}`;
  let me!: { id: bigint; ref: string };
  let G1!: RouteHandler;
  /** ref → the name the pre-FIX-5 build stored. */
  const stored = new Map<string, string>();
  const refs: { spassky: string; przepiorka: string } = { spassky: "", przepiorka: "" };

  /** G1 pages (all of them) for a search (or none). */
  async function search(q: string): Promise<GameRowDTO[]> {
    const out: GameRowDTO[] = [];
    let cursor: string | null = null;
    do {
      const t = installTestDeps({ userId: "user_on", viewer: viewerFixture({ id: me.id, ref: me.ref, gamesVersion: 3 }), env: { ROUTE_VALIDATE_RESPONSES: "1" }, clock: Date.now() });
      try {
        const qs = new URLSearchParams();
        if (q) qs.set("q", q);
        if (cursor) qs.set("cursor", cursor);
        const res = await G1(request(`/api/me/games?${qs.toString()}`), noParams());
        assert.equal(res.status, 200, await res.clone().text());
        const body = (await jsonOf(res)) as { data: unknown; meta: { nextCursor?: string | null } };
        out.push(...(GamesListResponse.parse(body.data) as GameRowDTO[]));
        cursor = body.meta.nextCursor ?? null;
      } finally {
        t.restore();
      }
    } while (cursor);
    return out;
  }
  async function all(): Promise<GameRowDTO[]> {
    return search("");
  }
  const storedNames = async () =>
    new Map(
      (await db.$queryRaw<{ ref: string; name: string | null }[]>(Prisma.sql`
        SELECT "referenceId" AS ref, "openingName" AS name FROM games WHERE "creatorId" = ${me.id}`)).map((r) => [r.ref, r.name]),
    );

  /** One imported game, the columns the batch writer sets (games.source + game_players.source, mode IMPORTED). */
  async function addImported(g: ImportedGame, oldName: string, i: number): Promise<string> {
    const endedAt = new Date(T0 + i * DAY);
    const row = await db.game.create({
      data: {
        creatorId: me.id,
        opponentId: null,
        status: "COMPLETED",
        startingFen: g.startingFen,
        startPly: 0,
        initialTimeSeconds: 180,
        incrementSeconds: 0,
        creatorTimeRemaining: 0,
        opponentTimeRemaining: 0,
        expiresAt: endedAt,
        mode: "IMPORTED",
        timeClass: "BLITZ",
        whitePlayerId: me.id,
        blackPlayerId: null,
        moves: g.moves,
        plyCount: g.plyCount,
        outcome: "WHITE",
        endMethod: "OTHER",
        completedAt: endedAt,
        analysisStatus: "NONE",
        source: "CHESSCOM",
        externalId: `on-${run}-${i}`,
        whiteName: "me",
        blackName: `opp_${i}`,
        ecoCode: g.ecoCode,
        openingName: oldName,
      },
      select: { id: true, referenceId: true },
    });
    await db.gamePlayer.create({
      data: { gameId: row.id, userId: me.id, color: "w", mode: "IMPORTED", timeClass: "BLITZ", result: "WIN", endedAt, source: "CHESSCOM", opponentUserId: null, opponentName: `opp_${i}`, opponentRating: 1500, momentsCount: 0, ecoCode: g.ecoCode },
    });
    stored.set(row.referenceId, oldName);
    return row.referenceId;
  }

  before(async () => {
    db = new PrismaClient({ datasourceUrl: url });
    const u = await db.user.create({
      data: { googleId: `user_on_${run}`, email: `on-${run}@test.invalid`, name: "Openings", code: `ON${run.slice(-6)}`.toUpperCase() },
      select: { id: true, referenceId: true },
    });
    me = { id: u.id, ref: u.referenceId };
    let i = 0;
    for (const s of STAGING) {
      const raw = encodeChessComGame({
        id: s.id,
        sans: s.sans,
        white: { username: "knightowl_88", rating: 1500, result: "win" },
        black: { username: `opp${s.id}`, rating: 1500, result: "resigned" },
        timeClass: "blitz",
        timeControl: "180",
        endTime: Math.floor((T0 + i * DAY) / 1000),
        ecoUrl: s.ecoUrl,
      } as Parameters<typeof encodeChessComGame>[0]);
      const r = mapChessComGame(raw, { usernameLower: "knightowl_88" });
      assert.ok(r.ok, JSON.stringify(r));
      if (!r.ok) continue;
      const ref = await addImported(r.game, openingNameFromEcoUrl(s.ecoUrl)!, i++);
      if (s.id === 900002) refs.spassky = ref;
      else refs.przepiorka = ref;
    }
    // The repo's real Chess.com fixture games (every one the mapper accepts), with the slug words as the old name.
    for (const m of ["2026-08", "2026-09", "2026-10"]) {
      const games = (JSON.parse(readFileSync(path.join(FX, `${m}.json`), "utf8")) as { games: { pgn?: string }[] }).games;
      for (const raw of games) {
        const r = mapChessComGame(raw, { usernameLower: "knightowl_88" });
        const eco = /\[ECOUrl "([^"]+)"\]/.exec(raw.pgn ?? "")?.[1] ?? null;
        const old = openingNameFromEcoUrl(eco);
        if (!r.ok || !old) continue;
        await addImported(r.game, old, i++);
      }
    }
    assert.ok(stored.size >= 10, `${stored.size} imported games`);
    G1 = (await import("@/app/api/me/games/route")).GET as RouteHandler;
  });

  after(async () => {
    await db.$executeRaw(Prisma.sql`DELETE FROM games WHERE "creatorId" = ${me.id}`);
    await db.$executeRaw(Prisma.sql`DELETE FROM users WHERE id = ${me.id}`);
    await db.$disconnect();
  });

  it("regression: archive-search-displayed — the displayed name finds the game before any rewrite", async () => {
    const rows = await all();
    const spassky = rows.find((r) => r.ref === refs.spassky)!;
    assert.equal(spassky.opening?.name, "Queen's Indian Defense: Spassky System", "the archive shows the book's name");
    assert.equal(stored.get(refs.spassky), "Queens Indian Defense Spassky System 4...Bb7 5.Bd3 Bb4", "stored as the old build did");
    assert.ok((await search("Queen's Indian")).some((r) => r.ref === refs.spassky), "\"Queen's Indian\" finds it (it found nothing)");
    assert.ok((await search("Queens Indian")).some((r) => r.ref === refs.spassky), "and the apostrophe-less spelling too");
  });

  it("the backfill rewrites exactly the displayed names; a second apply 0; --verify OK; every row found by its name", async () => {
    const log: string[] = [];
    const shown = new Map((await all()).map((r) => [r.ref, r.opening?.name ?? null]));
    const dry = await openingNamesRun(db, "dry", (l) => log.push(l));
    assert.deepEqual(await storedNames(), new Map([...stored]), "the dry run writes nothing");
    const mineToChange = [...stored].filter(([ref, old]) => shown.get(ref) !== null && shown.get(ref) !== old).length;
    assert.ok(mineToChange >= 2 && dry.counts.changed >= mineToChange, `dry run predicts ${dry.counts.changed} (${mineToChange} of these)`);
    const audits0 = await db.$queryRaw<{ n: number }[]>(Prisma.sql`SELECT count(*)::int AS n FROM audit_logs WHERE action = 'backfill.opening_names'`);
    await openingNamesRun(db, "apply", (l) => log.push(l));
    const audits1 = await db.$queryRaw<{ n: number }[]>(Prisma.sql`SELECT count(*)::int AS n FROM audit_logs WHERE action = 'backfill.opening_names'`);
    assert.equal(audits1[0]!.n, audits0[0]!.n + 1, "one audit row");
    const after1 = await storedNames();
    const rows = await all();
    for (const r of rows) {
      const name = shown.get(r.ref) ?? null;
      assert.equal(r.opening?.name ?? null, name, `${r.ref}: the display did not change`);
      if (name !== null) assert.equal(after1.get(r.ref), name, `${r.ref}: stored = displayed`);
    }
    const second = await openingNamesRun(db, "apply", (l) => log.push(l));
    assert.equal(second.counts.changed, 0, "a second apply rewrites nothing");
    assert.deepEqual(await storedNames(), after1);
    const verify = await openingNamesRun(db, "verify", (l) => log.push(l));
    assert.equal(verify.ok, true, log.join("\n"));
    // A search is at most 40 characters (GAMES_SEARCH_MAX): the name's head.
    for (const [ref, name] of after1) if (name) assert.ok((await search(name.slice(0, 40).trim())).some((r) => r.ref === ref), `${ref} found by "${name}"`);
    assert.ok((await search("Przepiorka")).some((r) => r.ref === refs.przepiorka));
  });
});
