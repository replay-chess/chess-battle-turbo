// The database world of the P4 accounts / import route tests (phase-04 plan §12.3): members M (active) and O (another
// member, for ownership conflicts), N (never subscribed, trial available) and L (lapsed), the Chess.com fixture
// account (knightowl_88's data under a per-process handle, CC_HANDLE) behind a fake Chess.com, a fake Lichess OAuth
// server that records every token call, and fake
// worker / kick transports. Throwaway Docker Postgres only (TEST_DATABASE_URL): it creates and deletes its own rows.
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { PrismaClient } from "@repo/db";
import type { Viewer } from "@/lib/auth/viewer";
import type { RouteHandler } from "@/lib/api/route";
import { installTestDeps, noParams, request, viewerFixture } from "../helpers/route-harness";

const require = createRequire(import.meta.url);
const fixture = (rel: string) => JSON.parse(readFileSync(require.resolve(`@repo/chess-fixtures/import/${rel}`), "utf8"));
/**
 * The fixture account under a handle and player id of this test process: other int test files (and other suites on
 * the same database) link `knightowl_88` and its player id too, so a fixed handle made the co-claim audit and
 * `linked_elsewhere` depend on whatever ran before or alongside (INTEGRATE-2: ACC-3 saw `account.link_coclaim`).
 */
export const CC_HANDLE = `ko${randomBytes(5).toString("hex")}`;
const renameMember = (raw: string) => raw.replace(/knightowl_88/gi, CC_HANDLE);
export const CC_PROFILE = {
  ...(JSON.parse(renameMember(JSON.stringify(fixture("chesscom/knightowl_88/profile.json")))) as Record<string, unknown>),
  player_id: 900_000_000 + randomBytes(3).readUIntBE(0, 3),
} as { player_id: number; username: string };
export const CC_STATS = fixture("chesscom/knightowl_88/stats.json");
export const CC_ARCHIVES = JSON.parse(renameMember(JSON.stringify(fixture("chesscom/knightowl_88/archives.json"))));
export const CC_OCT = JSON.parse(renameMember(JSON.stringify(fixture("chesscom/knightowl_88/2026-10.json"))));
export const LI_ACCOUNT = fixture("lichess/knightowl88/account.json") as { id: string; username: string };

export type Who = "m" | "o" | "n" | "l";
export type Handlers = { GET?: RouteHandler; POST?: RouteHandler; PATCH?: RouteHandler; DELETE?: RouteHandler };

export const SECRET = "c".repeat(64);
export const ENV = {
  ROUTE_VALIDATE_RESPONSES: "1",
  SIGNED_COOKIE_SECRET: SECRET,
  CHESSCOM_API_BASE: "http://upstream.test/chesscom",
  LICHESS_BASE_URL: "http://upstream.test/lichess",
  LICHESS_CLIENT_ID: "replay-chess-test",
  ANALYSIS_WORKER_URL: "http://worker.test",
  INTERNAL_API_SECRET: `webwk:${"w".repeat(64)}`,
};

export type LichessCall = { method: string; path: string; auth: string | null; body: string | null };

export function accountsWorld(url: string) {
  let db!: PrismaClient;
  const run = `${Date.now().toString(36)}${randomBytes(3).toString("hex")}`;
  const users = {} as Record<Who, { id: bigint; ref: string; clerk: string }>;
  const kicks: unknown[] = [];
  const lichessCalls: LichessCall[] = [];
  const chesscomCalls: string[] = [];
  const tags: string[] = [];
  /** Per-test Lichess behaviour. */
  const lichess = {
    token: { status: 200 as number },
    account: { status: 200 as number, body: { ...LI_ACCOUNT, count: { rated: 340 } } as Record<string, unknown> },
    revoke: { status: 204 as number },
    issued: 0,
  };
  const restores: (() => void)[] = [];

  const viewerOf = (who: Who, overrides: Parameters<typeof viewerFixture>[0] = {}): Viewer => {
    const base = { id: users[who].id, ref: users[who].ref, clerkUserId: users[who].clerk };
    if (who === "n") {
      return viewerFixture({ ...base, entitlement: { member: false, entitled: false, state: "none", trial: { used: false, eligible: true } }, ...overrides });
    }
    if (who === "l") {
      return viewerFixture({ ...base, entitlement: { member: false, entitled: false, state: "lapsed", trial: { used: true, eligible: false } }, ...overrides });
    }
    return viewerFixture({ ...base, ...overrides });
  };

  async function call(
    h: Handlers,
    method: "GET" | "POST" | "PATCH" | "DELETE",
    path: string,
    who: Who | null,
    init: {
      body?: unknown;
      headers?: Record<string, string>;
      params?: Record<string, string>;
      viewer?: Viewer | null;
      realRateLimit?: boolean;
      rateLimit?: { allowed: boolean; retryAfterSec: number; bucket?: string };
    } = {},
  ) {
    const realLimiter = init.realRateLimit ? (await import("@/lib/rate-limit-db")).checkRateLimit : undefined;
    const t = installTestDeps({
      userId: who ? users[who].clerk : null,
      viewer: who ? (init.viewer === undefined ? viewerOf(who) : init.viewer) : null,
      env: ENV,
      clock: Date.now(),
      ...(init.rateLimit ? { rateLimit: init.rateLimit } : {}),
      ...(realLimiter ? { overrides: { checkRateLimit: realLimiter } } : {}),
    });
    try {
      const body = init.body === undefined ? undefined : JSON.stringify(init.body);
      const res = await h[method]!(
        request(path, { method, headers: { "content-type": "application/json", ...init.headers }, body }),
        noParams(init.params ?? {}),
      );
      return { res, recorded: t.recorded };
    } finally {
      t.restore();
    }
  }

  async function runAfter(recorded: { afterTasks: (() => unknown)[] }) {
    const tasks = recorded.afterTasks.splice(0);
    const t = installTestDeps({ clock: Date.now(), env: ENV });
    try {
      for (const task of tasks) await task();
      return t.recorded;
    } finally {
      t.restore();
    }
  }

  async function chesscomFetch(url: string): Promise<Response> {
    const path = new URL(url).pathname.replace(/^\/chesscom/, "");
    chesscomCalls.push(path);
    const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
    switch (path) {
      case `/pub/player/${CC_HANDLE}`:
        return json(CC_PROFILE);
      case `/pub/player/${CC_HANDLE}/stats`:
        return json(CC_STATS);
      case `/pub/player/${CC_HANDLE}/games/archives`:
        return json(CC_ARCHIVES);
      case `/pub/player/${CC_HANDLE}/games/2026/10`:
        return json(CC_OCT);
      case "/pub/player/other_handle":
        return json({ ...CC_PROFILE, username: "Other_Handle", player_id: CC_PROFILE.player_id + 1, "@id": "x", url: "x" });
      case "/pub/player/other_handle/stats":
        return json(CC_STATS);
      case "/pub/player/closed_one":
        return json({ ...CC_PROFILE, username: "closed_one", player_id: 1, status: "closed:fair_play_violations" });
      default:
        return json({ code: 0, message: "not found" }, 404);
    }
  }

  async function lichessFetch(url: string, init: RequestInit): Promise<Response> {
    const u = new URL(url);
    const path = u.pathname.replace(/^\/lichess/, "");
    const headers = new Headers(init.headers);
    lichessCalls.push({ method: init.method ?? "GET", path, auth: headers.get("authorization"), body: typeof init.body === "string" ? init.body : null });
    if (path === "/api/token" && init.method === "POST") {
      if (lichess.token.status !== 200) return new Response(JSON.stringify({ error: "invalid_grant" }), { status: lichess.token.status });
      lichess.issued += 1;
      return new Response(JSON.stringify({ token_type: "Bearer", access_token: `lio_secret_${run}_${lichess.issued}`, expires_in: 31536000 }), { status: 200 });
    }
    if (path === "/api/account") {
      return new Response(JSON.stringify(lichess.account.body), { status: lichess.account.status, headers: { "content-type": "application/json" } });
    }
    if (path === "/api/token" && init.method === "DELETE") return new Response(null, { status: lichess.revoke.status });
    return new Response("{}", { status: 404 });
  }

  async function setup() {
    process.env.DATABASE_URL = url;
    Object.assign(process.env, { ANALYSIS_WORKER_URL: ENV.ANALYSIS_WORKER_URL, INTERNAL_API_SECRET: ENV.INTERNAL_API_SECRET });
    db = new PrismaClient({ datasourceUrl: url });
    for (const who of ["m", "o", "n", "l"] as const) {
      const code = randomBytes(4).toString("hex").slice(0, 6).toUpperCase();
      const u = await db.user.create({
        data: { googleId: `user_acc_${who}_${run}`, email: `acc-${who}-${run}@example.test`, name: `Acc ${who.toUpperCase()}`, code },
        select: { id: true, referenceId: true },
      });
      users[who] = { id: u.id, ref: u.referenceId, clerk: `user_acc_${who}_${run}` };
    }
    const { setChessComFetch } = await import("@/lib/accounts/chesscom");
    const { setLichessFetch } = await import("@/lib/accounts/lichess");
    const { setImportFlag } = await import("@/lib/accounts/flag");
    const { setRevalidateTag } = await import("@/lib/accounts/effects");
    const { setKickTransport } = await import("@/lib/services/analysis/kick");
    const { setAccountsEventSink } = await import("@/lib/accounts/telemetry");
    restores.push(
      setChessComFetch((u) => chesscomFetch(u)),
      setLichessFetch((u, i) => lichessFetch(u, i)),
      setImportFlag(async () => true),
      setRevalidateTag((tag) => {
        tags.push(tag);
      }),
      setKickTransport(async (_u, init) => {
        kicks.push(JSON.parse(String(init.body)));
        return new Response(null, { status: 202 });
      }),
      setAccountsEventSink(() => undefined),
    );
  }

  async function teardown() {
    for (const r of restores.reverse()) r();
    const ids = Object.values(users).map((u) => u.id);
    await db.$executeRawUnsafe(`DELETE FROM jobs WHERE "userId" = ANY($1::bigint[])`, ids.map(String));
    await db.$executeRawUnsafe(`DELETE FROM idempotency_keys WHERE "userId" = ANY($1::bigint[])`, ids.map(String));
    await db.$executeRawUnsafe(`DELETE FROM audit_logs WHERE "actorUserId" = ANY($1::bigint[])`, ids.map(String));
    await db.user.deleteMany({ where: { id: { in: ids } } });
    await db.$disconnect();
  }

  /** Removes every link / run / job of a member (between tests). */
  async function reset(who: Who) {
    const id = users[who].id.toString();
    await db.$executeRawUnsafe(`DELETE FROM jobs WHERE "userId" = $1::bigint`, id);
    await db.$executeRawUnsafe(`DELETE FROM linked_accounts WHERE "userId" = $1::bigint`, id);
    await db.$executeRawUnsafe(`DELETE FROM chess_com_profiles WHERE "userId" = $1::bigint`, id);
    await db.$executeRawUnsafe(`DELETE FROM idempotency_keys WHERE "userId" = $1::bigint`, id);
    await db.$executeRawUnsafe(`DELETE FROM audit_logs WHERE "actorUserId" = $1::bigint`, id);
    await db.$executeRawUnsafe(
      `UPDATE users SET "onboardingStep" = 'WELCOME', "ratingBand" = NULL, "ratingBandSource" = NULL, "initialRating" = NULL, "timeZone" = 'UTC' WHERE id = $1::bigint`,
      id,
    );
  }

  return {
    users,
    kicks,
    lichessCalls,
    chesscomCalls,
    tags,
    lichess,
    run,
    get db() {
      return db;
    },
    viewerOf,
    call,
    runAfter,
    setup,
    teardown,
    reset,
  };
}
