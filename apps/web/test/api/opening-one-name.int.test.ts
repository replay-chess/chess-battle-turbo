/**
 * FIX-6 (item 3, D-P6-FIX6-3) on a real Postgres: one opening name per game on every surface that shows one. A real
 * CC0 game, graded and named as the worker names it (weakness-world.ts, the deepest book line of its moves), started
 * from a named opening preset (`games.meta.position` "Open Game", no players, event or year, as P2 writes it):
 *   regression: opening-one-name — the archive row (G1), the review payload (and its header's documented short form,
 *   `reviewMeta`: ECO + the family name of the same match) and Home's Continue card name the same opening; the archive
 *   showed the preset's title instead ("Open Game" beside Home's "King's Pawn Game: Mengarini's Opening").
 * Skipped unless TEST_DATABASE_URL is set (local only).
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { GamesListResponse, type GameRowDTO } from "@repo/contracts/http/games";
import { Prisma } from "@repo/db";
import { reviewMeta, shortOpening } from "@/features/review/copy";
import type { RouteHandler } from "@/lib/api/route";
import { getHomeData } from "@/lib/home/home.server";
import { getReview } from "@/lib/services/analysis/read";
import { trainDeps } from "@/lib/train/db.server";
import { installTestDeps, jsonOf, noParams, request } from "../helpers/route-harness";
import { weaknessWorld, WEAKNESS_ENV, WORLD_NOW, type Member } from "./weakness-world";

const url = process.env.TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
const LOCAL = new Set(["localhost", "127.0.0.1", "::1", "postgres"]);

describe("P6 FIX-6 one opening name per game (Postgres, real games)", { skip: url && LOCAL.has(new URL(url).hostname) ? false : "TEST_DATABASE_URL (local) not set" }, () => {
  const w = weaknessWorld(url ?? "");
  let M: Member;
  let ref = "";

  before(async () => {
    await w.setup();
    M = await w.member("onename", { timeZone: "UTC" });
    const opp = await w.member("onename-opp");
    // An opening preset's title, as P2's metaForPosition writes it (no legend side, event or year).
    const position = { name: "Open Game", event: null, year: null, legendSide: null as unknown as "w", moveNumber: 1 };
    ref = (await w.playCc0(M, opp, { count: 1, newestDaysAgo: 0.1, position }))[0]!;
  });

  after(async () => {
    await w.teardown();
  });

  it("regression: opening-one-name — archive, review and Home name the game's opening alike", async () => {
    const [g] = await w.db.$queryRaw<{ name: string | null; eco: string | null; title: string | null }[]>(Prisma.sql`
      SELECT "openingName" AS name, "ecoCode" AS eco, meta->'position'->>'name' AS title FROM games WHERE "referenceId" = ${ref}`);
    assert.ok(g?.name && g.eco, `the worker's naming stored an opening: ${JSON.stringify(g)}`);
    assert.equal(g.title, "Open Game");

    // Archive (G1).
    const G1 = (await import("@/app/api/me/games/route")).GET as RouteHandler;
    const t = installTestDeps({ userId: `user_${M.ref}`, viewer: { ...w.viewerOf(M), gamesVersion: 3 } as ReturnType<typeof w.viewerOf>, env: { ROUTE_VALIDATE_RESPONSES: "1", ...WEAKNESS_ENV }, clock: WORLD_NOW.getTime() });
    let row: GameRowDTO | undefined;
    try {
      const res = await G1(request("/api/me/games"), noParams());
      assert.equal(res.status, 200, await res.clone().text());
      row = (GamesListResponse.parse(((await jsonOf(res)) as { data: unknown }).data) as GameRowDTO[]).find((r) => r.ref === ref);
    } finally {
      t.restore();
    }
    assert.ok(row, "the archive lists the game");

    // Review (A1's payload) and Home's Continue card.
    const review = await getReview(trainDeps().db as never, w.viewerOf(M), ref, WORLD_NOW.getTime());
    const home = await getHomeData(w.viewerOf(M), WORLD_NOW);

    const name = review.dto.game.opening?.name ?? null;
    assert.ok(name, "the review names the opening");
    assert.equal(row.opening?.name ?? null, name, "the archive row names the same opening");
    assert.equal(row.positionTitle, null, "the preset's title does not replace the opening's name (it read \"Open Game\")");
    assert.equal(home.continue?.gameRef, ref, "Home's Continue card is this game");
    assert.equal(home.continue?.openingName ?? null, name, "Home names the same opening");
    // The header's documented short form is derived from the same match.
    assert.equal(reviewMeta("Blitz", review.dto.game.opening, "1–0"), `Blitz · ${review.dto.game.opening!.eco} ${shortOpening(name)} · 1–0`);
  });
});
