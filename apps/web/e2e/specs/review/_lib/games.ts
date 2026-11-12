// API helpers of the P3 specs: a bot game finished through the API (phase-03 plan §12.3 review-live: "POST /api/games
// {mode:"bot"} + /complete with a fixed 26-ply PGN"), the signed test kick that arms a worker fault (§12.3 "Per-game
// faults are armed through the signed kick body", APP_ENV=test only), and DB reads for the no-job assertions.
import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import type { PrismaClient } from "@repo/db";
import { parseKeyRing, signInternal, WEB_TO_WORKER_KID } from "@repo/contracts/internal/auth";
import { KICK_PATH, type KickBodyInput } from "@repo/contracts/internal/kick";
import { expect } from "../../../fixtures/telemetry";

/** 13 moves of the Closed Ruy Lopez (Breyer), 26 plies; White resigns after 13…Bf8. Legal from the initial position. */
export const RUY_LOPEZ_26 = [
  "e2e4", "e7e5", "g1f3", "b8c6", "f1b5", "a7a6", "b5a4", "g8f6", "e1g1", "f8e7", "f1e1", "b7b5", "a4b3",
  "d7d6", "c2c3", "e8g8", "h2h3", "c6b8", "d2d4", "b8d7", "b1d2", "c8b7", "b3c2", "f8e8", "d2f1", "e7f8",
] as const;

export type CompleteAnalysisSeed = { status: string; etaSec: number | null };

/** POST /api/games: a bot game from the initial position, the member playing White. Returns its ref. */
export async function createBotGame(page: Page, opts: { botElo?: number } = {}): Promise<string> {
  const res = await page.request.post("/api/games", {
    data: {
      mode: "BOT",
      start: { kind: "initial" },
      color: "w",
      botElo: opts.botElo ?? 1200,
      tc: { initialSeconds: 600, incrementSeconds: 0 },
    },
    headers: { "Idempotency-Key": randomUUID() },
  });
  expect(res.status(), await res.text()).toBe(201);
  return ((await res.json()) as { data: { game: { ref: string } } }).data.game.ref;
}

/** POST /api/games/<ref>/complete with the fixed line; White (the member) resigns. Returns the analysis seed. */
export async function completeBotGame(
  page: Page,
  ref: string,
  moves: readonly string[] = RUY_LOPEZ_26,
): Promise<CompleteAnalysisSeed> {
  const clocks = moves.map((_, i) => 600_000 - (i + 1) * 4_000);
  const res = await page.request.post(`/api/games/${ref}/complete`, {
    data: {
      rev: moves.length,
      moves,
      clocksMs: clocks,
      result: "b",
      method: "resignation",
      assists: { hints: 0, undos: 0 },
      endedAtClient: Date.now(),
    },
  });
  expect(res.status(), await res.text()).toBe(200);
  const body = (await res.json()) as { data: { analysis: CompleteAnalysisSeed } };
  return body.data.analysis;
}

/** A bot game created and finished through the API. */
export async function finishedBotGame(page: Page): Promise<{ ref: string; analysis: CompleteAnalysisSeed }> {
  const ref = await createBotGame(page);
  const analysis = await completeBotGame(page, ref);
  return { ref, analysis };
}

/** The worker the e2e servers kick (ANALYSIS_WORKER_URL, as the web app). */
export function workerUrl(env: Readonly<Record<string, string | undefined>> = process.env): string {
  return (env.ANALYSIS_WORKER_URL ?? "http://127.0.0.1:3003").replace(/\/+$/, "");
}

/**
 * A signed kick to the e2e worker, as the web sends it (kid `webwk`, the web's worker-only key). `fault` is honoured only by
 * an APP_ENV=test worker and is one-shot for `watch`; `hold_queue` holds every claim until a kick without it.
 */
export async function kickWorker(body: Partial<Omit<KickBodyInput, "v">>): Promise<void> {
  const keys = parseKeyRing(process.env.INTERNAL_API_SECRET);
  const raw = JSON.stringify({ v: 1, reason: body.reason ?? "test", ...body } satisfies KickBodyInput);
  const headers = signInternal({ keys, method: "POST", path: KICK_PATH, body: raw, nowMs: Date.now(), kid: WEB_TO_WORKER_KID });
  const res = await fetch(`${workerUrl()}${KICK_PATH}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: raw,
    signal: AbortSignal.timeout(5_000),
  });
  expect(res.status, `kick ${raw}`).toBe(202);
}

/** The worker's /ready body (no auth; the e2e worker listens on localhost only). */
export async function workerReady(): Promise<{ ready: boolean; engine: string }> {
  const res = await fetch(`${workerUrl()}/ready`, { signal: AbortSignal.timeout(5_000) });
  return (await res.json()) as { ready: boolean; engine: string };
}

/** `jobs` rows of one game (by games.referenceId). */
export async function jobsOfGame(db: PrismaClient, gameRef: string): Promise<{ kind: string; status: string; dedupeKey: string | null }[]> {
  return db.$queryRaw`
    SELECT j.kind::text AS kind, j.status::text AS status, j."dedupeKey" AS "dedupeKey"
      FROM jobs j JOIN games g ON g.id = j."gameId"
     WHERE g."referenceId" = ${gameRef}
     ORDER BY j.id`;
}

/** games."analysisStatus" of one game. */
export async function analysisStatusOf(db: PrismaClient, gameRef: string): Promise<string | null> {
  const rows = await db.$queryRaw<{ s: string }[]>`SELECT "analysisStatus"::text AS s FROM games WHERE "referenceId" = ${gameRef}`;
  return rows[0]?.s ?? null;
}
