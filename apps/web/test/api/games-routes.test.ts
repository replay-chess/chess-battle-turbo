// The P2 game routes through route() with an in-memory client (phase-02 plan §12.3 "HTTP"): each handler's success
// status and body parse with the contracts schemas, the registry spec matches, the cache headers are the tier's, and
// the documented error codes come back in the envelope. The happy paths of these five endpoints live here instead of
// test/api/contract.test.ts because they need game rows; the SQL itself runs in lib/games/games.int.test.ts.
import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { CompleteResponse, GameCreateResponse, GameDetailResponse, PgnText } from "@repo/contracts/http/games";
import { ErrorEnvelope, ok } from "@repo/contracts/http/envelope";
import { gamesEndpoints } from "@repo/contracts/http/registry";
import type { RouteHandler } from "@/lib/api/route";
import type { GameRow } from "@/lib/games/snapshot.server";
import { installTestDeps, jsonOf, noParams, request, viewerFixture } from "../helpers/route-harness";

const INITIAL = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const REF = "cgame000000000000000000000";
const ME = 1n; // viewerFixture().id

function gameRow(overrides: Partial<GameRow> = {}): GameRow {
  return {
    id: 10n,
    referenceId: REF,
    status: "IN_PROGRESS",
    mode: "BOT",
    rated: false,
    timeClass: "RAPID",
    creatorId: ME,
    opponentId: 2n,
    whitePlayerId: ME,
    blackPlayerId: null,
    botElo: 1200,
    chessPositionId: null,
    openingId: null,
    startingFen: INITIAL,
    startPly: 0,
    studySeconds: 0,
    moves: "",
    moveClocksMs: [],
    plyCount: 0,
    fen: INITIAL,
    initialTimeSeconds: 600,
    incrementSeconds: 0,
    whiteTimeMs: 600000,
    blackTimeMs: 600000,
    clockRunning: null,
    phase: "PLAYING",
    phaseEndsAt: null,
    lastMoveAt: new Date(0),
    endMethod: null,
    outcome: null,
    startedAt: new Date(0),
    completedAt: null,
    createdAt: new Date(0),
    updatedAt: new Date(1_000),
    meta: { v: 1, header: "", prefixSan: [], prefixStartMoveNo: 1, position: null, rev: 0 },
    whiteName: "Fixture Viewer",
    blackName: "Engine 1200",
    whiteRating: null,
    blackRating: 1200,
    rematchOfRef: null,
    wRef: "cviewer00000000000000000000",
    wName: "Fixture Viewer",
    wAvatar: null,
    bRef: null,
    bName: null,
    bAvatar: null,
    ...overrides,
  };
}

// The routes read lib/prisma, which reuses globalThis.prismaRc outside production: one fake that answers by SQL text.
let current: GameRow & { pgn?: string | null } = gameRow();
// Every web statement goes out as (text, ...values) (rawDb, lib/games/snapshot.server.ts).
(globalThis as { prismaRc?: unknown }).prismaRc = {
  $queryRawUnsafe: async (text: string, ...values: unknown[]) => {
    if (text.includes("INSERT INTO idempotency_keys")) return [{ claimed: 1 }];
    if (text.includes("FROM chess_positions p")) return [];
    if (text.includes("INSERT INTO games")) {
      current = gameRow({ referenceId: values[0] as string });
      return [{ id: 10n, ref: values[0], players: 1 }];
    }
    if (text.includes("LEFT JOIN games r")) return (values[0] === current.referenceId ? [current] : []);
    if (text.includes("g.pgn")) return (values[0] === current.referenceId ? [current] : []);
    if (text.includes("status = 'COMPLETED'")) return [{ finished: 1, players: 1, standings: 0, versions: 1 }];
    if (text.includes("status = 'ABORTED'")) return [{ aborted: 1, players: 1 }];
    throw new Error(`unexpected query: ${text.slice(0, 120)}`);
  },
  $executeRawUnsafe: async () => 1,
  $transaction: async (ops: unknown[]) => Promise.all(ops),
  chessComProfile: { findUnique: async () => null },
  user: { findUnique: async () => ({ id: 2n }) },
  chessPosition: { findUnique: async () => null, update: async () => null },
  opening: { findFirst: async () => null },
  legend: { findUnique: async () => null },
};

const ENV = { ROUTE_VALIDATE_RESPONSES: "1" };
type Handlers = { GET?: RouteHandler; POST?: RouteHandler };
let create: Handlers, detail: Handlers, checkpoint: Handlers, complete: Handlers, pgn: Handlers;

before(async () => {
  create = (await import("@/app/api/games/route")) as Handlers;
  detail = (await import("@/app/api/games/[ref]/route")) as Handlers;
  checkpoint = (await import("@/app/api/games/[ref]/checkpoint/route")) as Handlers;
  complete = (await import("@/app/api/games/[ref]/complete/route")) as Handlers;
  pgn = (await import("@/app/api/games/[ref]/pgn/route")) as Handlers;
});

async function call(
  handler: RouteHandler,
  path: string,
  init: { method?: string; body?: unknown; headers?: Record<string, string>; ref?: string; member?: boolean; signedOut?: boolean } = {},
) {
  const viewer = init.member === false
    ? viewerFixture({ entitlement: { member: false, entitled: false, state: "lapsed", trial: { used: true } } })
    : viewerFixture();
  const t = installTestDeps({ env: ENV, userId: init.signedOut ? null : "user_1", viewer: init.signedOut ? null : viewer });
  try {
    const body = init.body === undefined ? undefined : typeof init.body === "string" ? init.body : JSON.stringify(init.body);
    return await handler(
      request(path, { method: init.method ?? "GET", headers: { "content-type": "application/json", ...init.headers }, body }),
      noParams(init.ref ? { ref: init.ref } : {}),
    );
  } finally {
    t.restore();
  }
}

const KEY = "3f2b8c1e-9d4a-4b6f-8e2d-1a2b3c4d5e6f";

describe("P2 game routes (in-memory client)", () => {
  it("route specs are the registry entries", () => {
    assert.equal(create.POST!.spec.id, gamesEndpoints.create.id);
    assert.equal(detail.GET!.spec.id, gamesEndpoints.detail.id);
    assert.equal(checkpoint.POST!.spec.id, gamesEndpoints.checkpoint.id);
    assert.equal(complete.POST!.spec.id, gamesEndpoints.complete.id);
    assert.equal(pgn.GET!.spec.id, gamesEndpoints.pgn.id);
  });

  it("POST /api/games → 201 GameCreateResponse with Location; no-store", async () => {
    const res = await call(create.POST!, "/api/games", {
      method: "POST",
      body: { mode: "BOT", start: { kind: "initial" }, color: "w" },
      headers: { "Idempotency-Key": KEY },
    });
    assert.equal(res.status, 201, await res.clone().text());
    assert.equal(res.headers.get("cache-control"), "private, no-store");
    const { data } = ok(GameCreateResponse).parse(await res.json());
    assert.equal(res.headers.get("location"), `/game/${data.game.ref}`);
    assert.equal(data.game.bot?.elo, 1200);
  });

  it("POST /api/games: 402 for a non-member, 400 without the key, 400 mode_not_available", async () => {
    const nonMember = await call(create.POST!, "/api/games", { method: "POST", body: { mode: "BOT" }, headers: { "Idempotency-Key": KEY }, member: false });
    assert.equal(nonMember.status, 402);
    const noKey = await call(create.POST!, "/api/games", { method: "POST", body: { mode: "BOT" } });
    assert.equal(noKey.status, 400);
    assert.equal(ErrorEnvelope.parse(await jsonOf(noKey)).error.fields?.["Idempotency-Key"], "Required");
    const legend = await call(create.POST!, "/api/games", { method: "POST", body: { mode: "LEGEND_BOT" }, headers: { "Idempotency-Key": KEY } });
    assert.equal(legend.status, 400);
    assert.equal(ErrorEnvelope.parse(await jsonOf(legend)).error.details?.reason, "mode_not_available");
  });

  it("GET /api/games/[ref] → 200 GameDetailResponse; no-store while live, private ETag + 304 once finished; 404 unknown", async () => {
    current = gameRow();
    const live = await call(detail.GET!, `/api/games/${REF}`, { ref: REF });
    assert.equal(live.status, 200);
    assert.equal(live.headers.get("cache-control"), "private, no-store");
    assert.equal(ok(GameDetailResponse).parse(await live.json()).data.snapshot.ref, REF);

    current = gameRow({ status: "COMPLETED", phase: "ENDED", endMethod: "RESIGNATION", outcome: "BLACK", completedAt: new Date(2_000) });
    const done = await call(detail.GET!, `/api/games/${REF}`, { ref: REF });
    assert.equal(done.status, 200);
    assert.equal(done.headers.get("etag"), `"g-${REF}-1000-p"`);
    assert.match(done.headers.get("cache-control") ?? "", /^private/);
    const snap = ok(GameDetailResponse).parse(await done.json()).data.snapshot;
    assert.deepEqual(snap.result && { winner: snap.result.winner, method: snap.result.method }, { winner: "b", method: "resignation" });
    const again = await call(detail.GET!, `/api/games/${REF}`, { ref: REF, headers: { "if-none-match": `"g-${REF}-1000-p"` } });
    assert.equal(again.status, 304);

    const unknown = await call(detail.GET!, "/api/games/cunknownunknownunknown00", { ref: "cunknownunknownunknown00" });
    assert.equal(unknown.status, 404);
    const bad = await call(detail.GET!, "/api/games/nope", { ref: "nope" });
    assert.equal(bad.status, 400);
  });

  it("GET /api/games/[ref] (plan 11.1): a lapsed player may load an IN_PROGRESS game; otherwise a non-member gets 402", async () => {
    current = gameRow();
    const live = await call(detail.GET!, `/api/games/${REF}`, { ref: REF, member: false });
    assert.equal(live.status, 200);
    current = gameRow({ status: "COMPLETED", phase: "ENDED", endMethod: "RESIGNATION", outcome: "BLACK", completedAt: new Date(2_000) });
    const done = await call(detail.GET!, `/api/games/${REF}`, { ref: REF, member: false });
    assert.equal(done.status, 402);
    assert.equal(ErrorEnvelope.parse(await jsonOf(done)).error.code, "subscription_required");
    const unknown = await call(detail.GET!, "/api/games/cunknownunknownunknown00", { ref: "cunknownunknownunknown00", member: false });
    assert.equal(unknown.status, 402);
  });

  it("checkpoint → 204 (also as text/plain from sendBeacon); 413 over 8 KB", async () => {
    current = gameRow();
    const body = { rev: 1, moves: ["e2e4"], clocksMs: [599000], assists: { hints: 0, undos: 0 } };
    const res = await call(checkpoint.POST!, `/api/games/${REF}/checkpoint`, { method: "POST", ref: REF, body });
    assert.equal(res.status, 204);
    const beacon = await call(checkpoint.POST!, `/api/games/${REF}/checkpoint`, {
      method: "POST",
      ref: REF,
      body: JSON.stringify(body),
      headers: { "content-type": "text/plain;charset=UTF-8" },
    });
    assert.equal(beacon.status, 204);
    const big = await call(checkpoint.POST!, `/api/games/${REF}/checkpoint`, {
      method: "POST",
      ref: REF,
      body: JSON.stringify({ ...body, pad: "x".repeat(9_000) }),
    });
    assert.equal(big.status, 413);
  });

  it("complete → 200 CompleteResponse; an already finished game replays with Idempotent-Replayed", async () => {
    current = gameRow();
    const body = { rev: 1, moves: ["e2e4", "e7e5"], clocksMs: [], result: "b", method: "resignation", assists: { hints: 0, undos: 0 }, endedAtClient: 0 };
    const res = await call(complete.POST!, `/api/games/${REF}/complete`, { method: "POST", ref: REF, body });
    assert.equal(res.status, 200, await res.clone().text());
    assert.deepEqual(ok(CompleteResponse).parse(await res.json()).data, {
      status: "COMPLETED",
      outcome: "BLACK",
      method: "resignation",
      analysis: { status: "none" },
    });
    current = gameRow({ status: "COMPLETED", endMethod: "RESIGNATION", outcome: "BLACK" });
    const replay = await call(complete.POST!, `/api/games/${REF}/complete`, { method: "POST", ref: REF, body });
    assert.equal(replay.status, 200);
    assert.equal(replay.headers.get("idempotent-replayed"), "true");
  });

  it("PGN → 200 text/x-chess-pgn attachment, private no-store; 409 not_finished while live; 402 for a lapsed member", async () => {
    current = { ...gameRow({ status: "COMPLETED", endMethod: "RESIGNATION", outcome: "BLACK", moves: "e2e4 e7e5" }), pgn: '[Event "x"]\n\n1. e4 e5 0-1' };
    const res = await call(pgn.GET!, `/api/games/${REF}/pgn`, { ref: REF });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "text/x-chess-pgn; charset=utf-8");
    assert.equal(res.headers.get("cache-control"), "private, no-store");
    assert.equal(res.headers.get("content-disposition"), `attachment; filename="replaychess-${REF}.pgn"`);
    PgnText.parse(await res.text());

    current = { ...gameRow({ status: "ABORTED", endMethod: "ABORTED", outcome: "NONE" }), pgn: null };
    const built = await call(pgn.GET!, `/api/games/${REF}/pgn`, { ref: REF });
    assert.equal(built.status, 200);
    assert.match(await built.text(), /\[Result "\*"\]/);

    current = gameRow();
    const live = await call(pgn.GET!, `/api/games/${REF}/pgn`, { ref: REF });
    assert.equal(live.status, 409);
    assert.equal(ErrorEnvelope.parse(await jsonOf(live)).error.details?.reason, "not_finished");
    const lapsed = await call(pgn.GET!, `/api/games/${REF}/pgn`, { ref: REF, member: false });
    assert.equal(lapsed.status, 402);
  });
});
