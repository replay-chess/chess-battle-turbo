import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  CLAIM_SQL,
  ERROR_MAX,
  FINISH_SQL,
  WebhookHandlerError,
  claimParams,
  finishParams,
  processWebhook,
  recordWebhook,
  safeErrorMessage,
  webhookProcessedProps,
  type WebhookOutcome,
  type WebhookSql,
} from "./record";

type Row = {
  provider: string;
  eventId: string;
  type: string;
  eventTime: string | null;
  payload: string | null;
  status: string | null;
  userId: bigint | null;
  error: string | null;
  receivedAt: number;
};

/** In-memory `webhook_events` with the claim statement's semantics (plan §7.7). */
class FakeTable implements WebhookSql {
  rows = new Map<string, Row>();
  clock = Date.parse("2026-11-05T10:00:00Z");
  statements: string[] = [];
  async query(sql: string, ...p: unknown[]): Promise<unknown[]> {
    assert.equal(sql, CLAIM_SQL);
    this.statements.push("claim");
    const [provider, eventId, type, eventTime, payload] = p as [string, string, string, string | null, string | null];
    const key = `${provider}|${eventId}`;
    const row = this.rows.get(key);
    if (!row) {
      this.rows.set(key, { provider, eventId, type, eventTime, payload, status: null, userId: null, error: null, receivedAt: this.clock });
      return [{ claimed: 1 }];
    }
    const stuck = row.status === null && row.receivedAt < this.clock - 2 * 60_000;
    if (row.status === "error" || stuck) {
      Object.assign(row, { receivedAt: this.clock, status: null, error: null });
      return [{ claimed: 1 }];
    }
    return [];
  }
  async execute(sql: string, ...p: unknown[]): Promise<number> {
    assert.equal(sql, FINISH_SQL);
    this.statements.push("finish");
    const [provider, eventId, status, userId, error] = p as [string, string, string, bigint | null, string | null];
    const row = this.rows.get(`${provider}|${eventId}`);
    if (!row) return 0;
    Object.assign(row, { status, userId, error });
    return 1;
  }
}

const NOW = new Date("2026-11-05T10:00:01Z");
const EVENT_TIME = new Date("2026-11-05T10:00:00Z");

function harness(table: FakeTable) {
  const tasks: Array<() => unknown> = [];
  const captured: Array<{ props: unknown; id: string | null | undefined }> = [];
  return {
    tasks,
    captured,
    run<O extends WebhookOutcome>(eventId: string, handle: () => Promise<O>, extra: { onProcessed?: (o: O) => unknown; provider?: "dodo" | "clerk"; payload?: unknown } = {}) {
      return processWebhook<O>({
        provider: extra.provider ?? "dodo",
        eventId,
        type: "subscription.active",
        eventTime: EVENT_TIME,
        payload: extra.payload ?? { type: "subscription.active" },
        receivedAt: NOW,
        handle,
        after: (task) => void tasks.push(task),
        onProcessed: extra.onProcessed,
        userRefOf: () => "ref_1",
        sql: table,
        capture: async (props, id) => void captured.push({ props, id }),
      });
    },
    async flush() {
      for (const t of tasks.splice(0)) await t();
    },
  };
}

describe("claimParams / finishParams", () => {
  it("never stores a Clerk payload, whatever the caller passes", () => {
    const p = claimParams("clerk", "msg_1", "user.created", null, { email_addresses: [{ email_address: "x@y.z" }] });
    assert.equal(p[4], null);
    assert.equal(claimParams("dodo", "msg_1", "subscription.active", EVENT_TIME, { a: 1 })[4], '{"a":1}');
  });

  it("sends the event time as ISO UTC and cuts the type to the column size", () => {
    const p = claimParams("dodo", "msg_1", "x".repeat(80), EVENT_TIME, null);
    assert.equal(p[3], "2026-11-05T10:00:00.000Z");
    assert.equal(p[2].length, 64);
    assert.equal(claimParams("dodo", "m", "t", new Date(Number.NaN), null)[3], null);
  });

  it("rejects an empty or over-long event id", () => {
    assert.throws(() => claimParams("dodo", "", "t", null, null));
    assert.throws(() => claimParams("dodo", "m".repeat(101), "t", null, null));
  });

  it("cuts the error to 500 characters", () => {
    const p = finishParams("dodo", "m", { status: "error", error: "e".repeat(900) });
    assert.equal(p[4]?.length, ERROR_MAX);
    assert.deepEqual(finishParams("dodo", "m", { status: "stale", userId: 7n }), ["dodo", "m", "stale", 7n, null]);
  });

  it("the claim statement is the plan's (re-admits only error or stuck rows)", () => {
    assert.match(CLAIM_SQL, /ON CONFLICT \(provider, "eventId"\) DO UPDATE/);
    assert.match(CLAIM_SQL, /webhook_events\.status = 'error'/);
    assert.match(CLAIM_SQL, /status IS NULL AND webhook_events\."receivedAt" < \(now\(\) AT TIME ZONE 'UTC'\) - interval '2 minutes'/);
    assert.match(CLAIM_SQL, /RETURNING 1/);
  });

  it("safeErrorMessage keeps no message text (it can carry payload data)", () => {
    assert.equal(safeErrorMessage(new TypeError("user a@b.c not found")), "TypeError");
    assert.equal(safeErrorMessage(Object.assign(new Error("x"), { code: "P2002" })), "Error P2002");
    assert.equal(safeErrorMessage("boom"), "Error");
  });
});

describe("processWebhook", () => {
  it("a duplicate delivery answers duplicate with one row and no handler call", async () => {
    const table = new FakeTable();
    const h = harness(table);
    let calls = 0;
    const handle = async () => (calls++, { status: "applied" as const, changed: true, userId: 1n });
    assert.deepEqual(await h.run("msg_1", handle), { duplicate: false });
    assert.deepEqual(await h.run("msg_1", handle), { duplicate: true });
    assert.equal(calls, 1);
    assert.equal(table.rows.size, 1);
    assert.equal(table.rows.get("dodo|msg_1")?.status, "applied");
    await h.flush();
    assert.deepEqual(
      h.captured.map((c) => (c.props as { outcome: string }).outcome),
      ["applied", "duplicate"],
    );
  });

  it("records a stale outcome with the user id", async () => {
    const table = new FakeTable();
    const h = harness(table);
    await h.run("msg_2", async () => ({ status: "stale" as const, changed: false, userId: 9n }));
    const row = table.rows.get("dodo|msg_2")!;
    assert.equal(row.status, "stale");
    assert.equal(row.userId, 9n);
  });

  it("a handler failure marks the row error, throws, and the provider's retry is re-admitted", async () => {
    const table = new FakeTable();
    const h = harness(table);
    await assert.rejects(
      h.run("msg_3", async () => {
        throw Object.assign(new Error("connection reset"), { code: "P1017" });
      }),
      (err: unknown) => err instanceof WebhookHandlerError && err.provider === "dodo",
    );
    assert.equal(table.rows.get("dodo|msg_3")?.status, "error");
    assert.equal(table.rows.get("dodo|msg_3")?.error, "Error P1017");
    const retry = await h.run("msg_3", async () => ({ status: "applied" as const, changed: true, userId: 1n }));
    assert.deepEqual(retry, { duplicate: false });
    assert.equal(table.rows.get("dodo|msg_3")?.status, "applied");
    assert.equal(table.rows.get("dodo|msg_3")?.error, null);
  });

  it("an `error` outcome (cas_exhausted) is stored and answered with a retryable failure", async () => {
    const table = new FakeTable();
    const h = harness(table);
    await assert.rejects(h.run("msg_4", async () => ({ status: "error" as const, error: "cas_exhausted", userId: 1n })), WebhookHandlerError);
    assert.equal(table.rows.get("dodo|msg_4")?.error, "cas_exhausted");
  });

  it("a stuck delivery (no outcome) is re-admitted after 2 minutes, not before", async () => {
    const table = new FakeTable();
    assert.equal(await recordWebhook("dodo", "msg_5", "t", null, null, table), true);
    table.clock += 60_000;
    assert.equal(await recordWebhook("dodo", "msg_5", "t", null, null, table), false);
    table.clock += 61_000;
    assert.equal(await recordWebhook("dodo", "msg_5", "t", null, null, table), true);
  });

  it("runs side effects in after(), not before the response", async () => {
    const table = new FakeTable();
    const h = harness(table);
    const effects: string[] = [];
    await h.run("msg_6", async () => ({ status: "applied" as const, changed: true, userId: 1n }), {
      onProcessed: () => void effects.push("claims"),
    });
    assert.deepEqual(effects, []);
    await h.flush();
    assert.deepEqual(effects, ["claims"]);
    assert.equal((h.captured[0]!.props as { lag_ms: number }).lag_ms, 1000);
    assert.equal(h.captured[0]!.id, "ref_1");
  });

  it("uses at most two statements (claim, finish) of its own", async () => {
    const table = new FakeTable();
    const h = harness(table);
    await h.run("msg_7", async () => ({ status: "ignored" as const, changed: false }));
    assert.deepEqual(table.statements, ["claim", "finish"]);
  });
});

describe("webhookProcessedProps", () => {
  it("matches the analytics registry shape", () => {
    assert.deepEqual(webhookProcessedProps("clerk", "user.created", "applied", true, null, NOW), {
      provider: "clerk",
      type: "user.created",
      outcome: "applied",
      changed: true,
      lag_ms: 0,
    });
    assert.equal(webhookProcessedProps("dodo", "Weird Type!", "ignored", false, null, NOW).type, "unknown");
  });
});

// The claim statement against a real Postgres: Docker in CI (all migrations applied); locally a throwaway
// container or the Neon dev branch (rows are removed afterwards). Never production.
const url = process.env.TEST_DATABASE_URL;

describe("webhook_events claim (Postgres)", { skip: url ? false : "TEST_DATABASE_URL not set" }, () => {
  let db: import("../../app/generated/prisma").PrismaClient;
  let sql: WebhookSql;
  const run = `int-${Date.now().toString(36)}`;

  before(async () => {
    const { PrismaClient } = await import("../../app/generated/prisma");
    db = new PrismaClient({ datasourceUrl: url });
    sql = {
      query: (s, ...p) => db.$queryRawUnsafe<unknown[]>(s, ...p),
      execute: (s, ...p) => db.$executeRawUnsafe(s, ...p),
    };
  });

  after(async () => {
    await db.$executeRawUnsafe(`DELETE FROM webhook_events WHERE "eventId" LIKE $1`, `${run}%`);
    await db.$disconnect();
  });

  it("10 concurrent deliveries of one event: exactly one claims it; one row", async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, () => recordWebhook("dodo", `${run}-a`, "subscription.active", EVENT_TIME, { a: 1 }, sql)),
    );
    assert.equal(results.filter(Boolean).length, 1);
    const rows = await db.$queryRawUnsafe<Array<{ n: bigint }>>(`SELECT count(*) AS n FROM webhook_events WHERE "eventId" = $1`, `${run}-a`);
    assert.equal(Number(rows[0]!.n), 1);
  });

  it("stores the event time in UTC, a Clerk payload as NULL, and the outcome", async () => {
    await recordWebhook("clerk", `${run}-c`, "user.created", EVENT_TIME, { secret: "pii" }, sql);
    await sql.execute(FINISH_SQL, ...finishParams("clerk", `${run}-c`, { status: "applied", userId: 42n }));
    const [row] = await db.$queryRawUnsafe<Array<{ eventTime: Date; payload: unknown; status: string; userId: bigint; processedAt: Date | null }>>(
      `SELECT "eventTime", payload, status, "userId", "processedAt" FROM webhook_events WHERE provider = 'clerk' AND "eventId" = $1`,
      `${run}-c`,
    );
    assert.equal(row!.eventTime.toISOString(), EVENT_TIME.toISOString());
    assert.equal(row!.payload, null);
    assert.equal(row!.status, "applied");
    assert.equal(row!.userId, 42n);
    assert.ok(row!.processedAt);
  });

  it("re-admits an errored event, not an applied one", async () => {
    await recordWebhook("dodo", `${run}-e`, "t", null, null, sql);
    await sql.execute(FINISH_SQL, ...finishParams("dodo", `${run}-e`, { status: "error", error: "x" }));
    assert.equal(await recordWebhook("dodo", `${run}-e`, "t", null, null, sql), true);
    await sql.execute(FINISH_SQL, ...finishParams("dodo", `${run}-e`, { status: "applied" }));
    assert.equal(await recordWebhook("dodo", `${run}-e`, "t", null, null, sql), false);
  });
});
