// The database world of the P5 Train route tests (phase-05 plan §12.2): members on a throwaway Docker Postgres after
// `prisma migrate deploy`, put into the plan's persona states by the real persona writer (`@repo/db/seed/p05-personas`
// with the real domain functions, `scripts/dev/p05-deps.ts`), and the route handlers called through route() with the
// injected auth seam (lib/api/context.ts) and the request clock pinned (`ctx.now`). Never Neon: TEST_DATABASE_URL only.
import { randomBytes, randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@repo/db";
import { writeP05Persona, type P05PersonaReport } from "@repo/db/seed/p05-personas";
import type { TrainingDeps } from "@repo/db/seed/p05-persona-states";
import type { Viewer } from "@/lib/auth/viewer";
import type { RouteHandler } from "@/lib/api/route";
import { loadTrainingDeps } from "../../../scripts/dev/p05-deps";
import { installTestDeps, jsonOf, noParams, request, viewerFixture, type Recorded } from "../../helpers/route-harness";

/** Thursday 2026-11-12 19:00 UTC (the contract fixtures' clock): the personas' "now". */
export const WORLD_NOW = new Date("2026-11-12T19:00:00.000Z");

export type Member = { id: bigint; ref: string; email: string; name: string; timeZone: string };

export type Handlers = { GET?: RouteHandler; POST?: RouteHandler; PATCH?: RouteHandler; DELETE?: RouteHandler };

export const ROUTE_FILES = {
  today: "app/api/train/today/route",
  bank: "app/api/train/bank/route",
  themes: "app/api/train/themes/route",
  attempts: "app/api/train/attempts/route",
  prefs: "app/api/train/prefs/route",
  sessions: "app/api/train/sessions/route",
  session: "app/api/train/sessions/[ref]/route",
  extend: "app/api/train/sessions/[ref]/extend/route",
  end: "app/api/train/sessions/[ref]/end/route",
  card: "app/api/train/cards/[ref]/route",
  skip: "app/api/train/cards/[ref]/skip/route",
  home: "app/api/home/route",
  badges: "app/api/me/badges/route",
  reports: "app/api/reports/route",
  review: "app/api/review/[ref]/route",
  status: "app/api/review/[ref]/status/route",
  moment: "app/api/review/[ref]/moments/[ply]/route",
} as const;

export type RouteName = keyof typeof ROUTE_FILES;

export type CallInit = {
  body?: unknown;
  rawBody?: string;
  headers?: Record<string, string>;
  params?: Record<string, string>;
  query?: Record<string, string>;
  /** The request clock (`ctx.now`); default WORLD_NOW. */
  now?: Date;
  /** Another viewer state for the same member (a non-member, a lapsed trial). */
  viewer?: Viewer | null;
  signedOut?: boolean;
  env?: Record<string, string | undefined>;
  /** The real fixed-window limiter (rate_limit_buckets) instead of the always-allow stub. */
  realRateLimit?: boolean;
  /** The limiter's answer (default: allowed). */
  rateLimit?: { allowed: boolean; retryAfterSec: number; bucket?: string };
};

export function trainWorld(url: string) {
  let db!: PrismaClient;
  let deps!: TrainingDeps;
  const run = `${Date.now().toString(36)}${randomBytes(3).toString("hex")}`;
  let n = 0;
  const H = {} as Record<RouteName, Handlers>;

  async function setup() {
    process.env.DATABASE_URL = url;
    db = new PrismaClient({ datasourceUrl: url });
    deps = await loadTrainingDeps();
    for (const [name, file] of Object.entries(ROUTE_FILES)) H[name as RouteName] = (await import(`@/${file}`)) as Handlers;
  }

  async function teardown() {
    await db.$disconnect();
  }

  /** A users row (the persona writer and the routes read it); `@test.invalid`, so the seed tripwire ignores it. */
  async function member(label: string, opts: { timeZone?: string } = {}): Promise<Member> {
    n += 1;
    const ref = `c${run}${String(n).padStart(4, "0")}`.slice(0, 25).padEnd(25, "0");
    const name = `${label}_${n}`.slice(0, 40);
    const email = `p5e-${label}-${run}-${n}@test.invalid`;
    const tz = opts.timeZone ?? "UTC";
    const rows = await db.$queryRaw<{ id: bigint }[]>(Prisma.sql`
      INSERT INTO users ("referenceId", code, "googleId", email, name, "timeZone", "updatedAt")
      VALUES (${ref}, ${`p5e${run}${n}`.slice(0, 20)}, ${`google-p5e-${run}-${n}`}, ${email}, ${name}, ${tz}, now())
      RETURNING id`);
    await db.$executeRaw(Prisma.sql`INSERT INTO user_stats ("referenceId", "userId", "updatedAt") VALUES (${`s${ref}`.slice(0, 30)}, ${rows[0]!.id}, now())`);
    return { id: rows[0]!.id, ref, email, name, timeZone: tz };
  }

  /** Puts the persona state on the member (relative to `now`), exactly as the e2e lease does. */
  async function persona(m: Member, name: string, now: Date = WORLD_NOW): Promise<P05PersonaReport> {
    const report = await writeP05Persona(db, m.email, name, { now, deps });
    const tz = await db.$queryRaw<{ tz: string }[]>(Prisma.sql`SELECT "timeZone" AS tz FROM users WHERE id = ${m.id}`);
    m.timeZone = tz[0]!.tz;
    return report;
  }

  function viewerOf(m: Member, overrides: Parameters<typeof viewerFixture>[0] = {}): Viewer {
    const v = viewerFixture({ id: m.id, ref: m.ref, ...overrides, user: { ref: m.ref, name: m.name, timeZone: m.timeZone, ...overrides.user } });
    return { ...v, accounts: v.accounts ?? [] };
  }

  async function call(name: RouteName, method: keyof Handlers, path: string, m: Member | null, init: CallInit = {}) {
    const realLimiter = init.realRateLimit ? (await import("@/lib/rate-limit-db")).checkRateLimit : undefined;
    const t = installTestDeps({
      userId: init.signedOut || !m ? null : `user_${m.ref}`,
      viewer: init.signedOut || !m ? null : init.viewer === undefined ? viewerOf(m) : init.viewer,
      env: { ROUTE_VALIDATE_RESPONSES: "1", ...init.env },
      clock: (init.now ?? WORLD_NOW).getTime(),
      ...(init.rateLimit ? { rateLimit: init.rateLimit } : {}),
      ...(realLimiter ? { overrides: { checkRateLimit: realLimiter } } : {}),
    });
    try {
      const handler = H[name][method];
      if (!handler) throw new Error(`${name} has no ${method}`);
      const qs = init.query ? `?${new URLSearchParams(init.query).toString()}` : "";
      const body = init.rawBody ?? (init.body === undefined ? undefined : JSON.stringify(init.body));
      const res = await handler(
        request(`${path}${qs}`, { method, headers: { "content-type": "application/json", ...init.headers }, body }),
        noParams(init.params ?? {}),
      );
      return { res, recorded: t.recorded, json: async () => (res.status === 204 ? null : jsonOf(res)) };
    } finally {
      t.restore();
    }
  }

  /** Runs the request's `after()` tasks the way Next does: after the response, with the same route deps. */
  async function runAfter(recorded: Recorded, now: Date = WORLD_NOW) {
    const tasks = recorded.afterTasks.splice(0);
    const t = installTestDeps({ clock: now.getTime(), env: { NODE_ENV: "test", NEXT_PUBLIC_APP_ENV: "test" } });
    try {
      for (const task of tasks) await task();
    } finally {
      t.restore();
    }
  }

  return {
    setup,
    teardown,
    member,
    persona,
    viewerOf,
    call,
    runAfter,
    H,
    get db() {
      return db;
    },
    get deps() {
      return deps;
    },
    uuid: () => randomUUID(),
  };
}

export type TrainWorld = ReturnType<typeof trainWorld>;

/** A non-member viewer of each 402 reason (P1's matrix). */
export function nonMember(world: TrainWorld, m: Member): Viewer {
  return world.viewerOf(m, { entitlement: { member: false, state: "lapsed", trial: { used: true, eligible: false }, neverPaid: false } });
}

export async function count(db: PrismaClient, sql: Prisma.Sql): Promise<number> {
  const rows = await db.$queryRaw<{ n: bigint | number }[]>(sql);
  return Number(rows[0]?.n ?? 0);
}
