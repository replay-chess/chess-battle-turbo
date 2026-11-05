// Webhooks (phase-01 plan §7.7, §12.3; 1B·F4b). @p1 @local-only
//
// No browser. Signs real payloads itself with the local test secrets in .env.test
// (DODO_PAYMENTS_WEBHOOK_KEY: Standard Webhooks; CLERK_WEBHOOK_SIGNING_SECRET: Svix), which must
// equal the dev server's (.env.development.local). Against a deployed site the secrets differ,
// hence @local-only.
//
// Works only on throwaway rows it creates (e2e-webhook*-<run>@chessbattle.dev, fake Clerk ids) and
// removes them afterwards with their webhook_events rows.
//
//   cd apps/web && set -a && source .env.test && set +a && PW_REUSE_SERVER=1 npx playwright test e2e/specs/webhooks.spec.ts
import { randomBytes } from "node:crypto";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { Webhook } from "standardwebhooks";
import type { PrismaClient } from "../../app/generated/prisma";
import { throwawayEmail } from "../fixtures/users";

const DODO_KEY = process.env.DODO_PAYMENTS_WEBHOOK_KEY ?? "";
const CLERK_SECRET = process.env.CLERK_WEBHOOK_SIGNING_SECRET ?? "";

const run = `${Date.now().toString(36)}${randomBytes(3).toString("hex")}`;
const DAY = 86_400_000;

type Reply = { status: number; body: { data?: { received?: boolean; duplicate?: boolean }; error?: { code?: string } } };

async function post(request: APIRequestContext, path: string, body: string, headers: Record<string, string>): Promise<Reply> {
  const res = await request.post(path, { data: body, headers: { "content-type": "application/json", ...headers } });
  return { status: res.status(), body: (await res.json().catch(() => ({}))) as Reply["body"] };
}

function dodoHeaders(id: string, body: string, secret = DODO_KEY): Record<string, string> {
  const at = new Date();
  return {
    "webhook-id": id,
    "webhook-timestamp": String(Math.floor(at.getTime() / 1000)),
    "webhook-signature": new Webhook(secret).sign(id, at, body),
  };
}

function svixHeaders(id: string, body: string, secret = CLERK_SECRET): Record<string, string> {
  const at = new Date();
  return {
    "svix-id": id,
    "svix-timestamp": String(Math.floor(at.getTime() / 1000)),
    "svix-signature": new Webhook(secret).sign(id, at, body),
  };
}

function userCode(): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  return Array.from(randomBytes(6), (b) => alphabet[b % alphabet.length]).join("");
}

test.describe("webhooks @p1 @local-only", () => {
  test.describe.configure({ mode: "serial" });
  test.skip(!DODO_KEY || !CLERK_SECRET, "DODO_PAYMENTS_WEBHOOK_KEY / CLERK_WEBHOOK_SIGNING_SECRET not in .env.test");

  let db: PrismaClient;
  const dodoEmail = throwawayEmail("webhook", run);
  const clerkEmail = throwawayEmail("webhookc", run);
  const clerkId = `user_e2ewh_${run}`;
  const customerId = `cus_e2ewh_${run}`;
  const subscriptionId = `sub_e2ewh_${run}`;
  const eventId = (n: string) => `msg_e2ewh_${run}_${n}`;
  let userId: bigint;

  test.beforeAll(async () => {
    const { PrismaClient } = await import("../../app/generated/prisma/index.js");
    db = new PrismaClient();
    const user = await db.user.create({
      data: { googleId: `user_e2ewh_dodo_${run}`, email: dodoEmail, name: "Webhook E2E", code: userCode() },
      select: { id: true },
    });
    userId = user.id;
  });

  test.afterAll(async () => {
    if (!db) return;
    await db.$executeRawUnsafe(`DELETE FROM webhook_events WHERE "eventId" LIKE $1`, `msg_e2ewh_${run}_%`);
    await db.user.deleteMany({ where: { email: { in: [dodoEmail, clerkEmail] } } });
    await db.$disconnect();
  });

  const subscriptionEvent = (type: string, status: string, timestamp: Date) =>
    JSON.stringify({
      business_id: "bus_e2e",
      type,
      timestamp: timestamp.toISOString(),
      data: {
        subscription_id: subscriptionId,
        product_id: process.env.DODO_PRODUCT_ID_MONTHLY || "pdt_e2e_webhook",
        status,
        next_billing_date: new Date(Date.now() + 30 * DAY).toISOString(),
        cancel_at_next_billing_date: false,
        created_at: new Date(Date.now() - DAY).toISOString(),
        payment_frequency_interval: "Month",
        trial_period_days: 0,
        customer: { customer_id: customerId, email: dodoEmail, name: "Webhook E2E" },
      },
    });

  test("Dodo: applied once, a replay is a duplicate with one row, an older event is stale", async ({ request }) => {
    const t2 = new Date(Date.now() - 60_000);
    const body = subscriptionEvent("subscription.active", "active", t2);

    const first = await post(request, "/api/webhook/dodo-payments", body, dodoHeaders(eventId("1"), body));
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body.data).toEqual({ received: true, duplicate: false });

    const applied = await db.user.findUniqueOrThrow({ where: { id: userId } });
    expect(applied.subscriptionStatus).toBe("active");
    expect(applied.subscriptionId).toBe(subscriptionId);
    expect(applied.dodoCustomerId).toBe(customerId);
    expect(applied.subscriptionSourceAt?.getTime()).toBe(t2.getTime());

    const replay = await post(request, "/api/webhook/dodo-payments", body, dodoHeaders(eventId("1"), body));
    expect(replay.status).toBe(200);
    expect(replay.body.data).toEqual({ received: true, duplicate: true });
    const rows = await db.webhookEvent.findMany({ where: { provider: "dodo", eventId: eventId("1") } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe("applied");
    expect(rows[0]!.userId).toBe(userId);
    expect(rows[0]!.payload).not.toBeNull();

    // An older event for the same subscription arrives late: nothing is written.
    const t1 = new Date(t2.getTime() - 3_600_000);
    const older = subscriptionEvent("subscription.on_hold", "on_hold", t1);
    const late = await post(request, "/api/webhook/dodo-payments", older, dodoHeaders(eventId("2"), older));
    expect(late.status).toBe(200);
    expect(late.body.data).toEqual({ received: true, duplicate: false });
    const stale = await db.webhookEvent.findUniqueOrThrow({
      where: { provider_eventId: { provider: "dodo", eventId: eventId("2") } },
    });
    expect(stale.status).toBe("stale");
    const unchanged = await db.user.findUniqueOrThrow({ where: { id: userId } });
    expect(unchanged.subscriptionStatus).toBe("active");
    expect(unchanged.subscriptionUpdatedAt?.getTime()).toBe(applied.subscriptionUpdatedAt?.getTime());
    expect(unchanged.subscriptionSourceAt?.getTime()).toBe(t2.getTime());
  });

  test("Dodo: a bad signature is 401 and claims nothing", async ({ request }) => {
    const body = subscriptionEvent("subscription.active", "active", new Date());
    const forged = dodoHeaders(eventId("bad"), body, `whsec_${randomBytes(32).toString("base64")}`);
    const res = await post(request, "/api/webhook/dodo-payments", body, forged);
    expect(res.status).toBe(401);
    expect(res.body.error?.code).toBe("unauthorized");
    const tampered = await post(request, "/api/webhook/dodo-payments", body.replace('"active"', '"expired"'), dodoHeaders(eventId("bad2"), body));
    expect(tampered.status).toBe(401);
    expect(await db.webhookEvent.count({ where: { eventId: { in: [eventId("bad"), eventId("bad2")] } } })).toBe(0);
  });

  const clerkUser = (firstName: string) => ({
    id: clerkId,
    object: "user",
    first_name: firstName,
    last_name: "Hook",
    image_url: "https://img.clerk.com/e2e.png",
    primary_email_address_id: `idn_${run}`,
    email_addresses: [{ id: `idn_${run}`, email_address: clerkEmail, verification: { status: "verified" } }],
    public_metadata: {},
  });
  const clerkEvent = (type: string, data: unknown) =>
    JSON.stringify({ object: "event", type, timestamp: Date.now(), instance_id: "ins_e2e", data });

  test("Clerk: user.created provisions once with the payload stored as NULL; updated; deleted", async ({ request }) => {
    const created = clerkEvent("user.created", clerkUser("Web"));
    const first = await post(request, "/api/webhook/clerk", created, svixHeaders(eventId("c1"), created));
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body.data).toEqual({ received: true, duplicate: false });

    const row = await db.user.findUniqueOrThrow({ where: { googleId: clerkId }, include: { stats: true } });
    expect(row.email).toBe(clerkEmail);
    expect(row.name).toBe("Web Hook");
    expect(row.code).toMatch(/^[A-Z0-9]{6}$/);
    expect(row.stats).not.toBeNull();

    const replay = await post(request, "/api/webhook/clerk", created, svixHeaders(eventId("c1"), created));
    expect(replay.body.data).toEqual({ received: true, duplicate: true });
    const events = await db.webhookEvent.findMany({ where: { provider: "clerk", eventId: eventId("c1") } });
    expect(events).toHaveLength(1);
    expect(events[0]!.payload).toBeNull();
    expect(events[0]!.status).toBe("applied");
    expect(events[0]!.userId).toBe(row.id);
    expect(await db.user.count({ where: { email: clerkEmail } })).toBe(1);

    const updated = clerkEvent("user.updated", clerkUser("Renamed"));
    expect((await post(request, "/api/webhook/clerk", updated, svixHeaders(eventId("c2"), updated))).status).toBe(200);
    expect((await db.user.findUniqueOrThrow({ where: { googleId: clerkId } })).name).toBe("Renamed Hook");

    const deleted = clerkEvent("user.deleted", { id: clerkId, object: "user", deleted: true });
    expect((await post(request, "/api/webhook/clerk", deleted, svixHeaders(eventId("c3"), deleted))).status).toBe(200);
    expect((await db.user.findUniqueOrThrow({ where: { googleId: clerkId } })).isActive).toBe(false);

    const other = clerkEvent("session.created", { id: "sess_x" });
    expect((await post(request, "/api/webhook/clerk", other, svixHeaders(eventId("c4"), other))).status).toBe(200);
    const ignored = await db.webhookEvent.findUniqueOrThrow({
      where: { provider_eventId: { provider: "clerk", eventId: eventId("c4") } },
    });
    expect(ignored.status).toBe("ignored");
    expect(ignored.payload).toBeNull();
  });

  test("Clerk: a bad signature is 401", async ({ request }) => {
    const body = clerkEvent("user.deleted", { id: clerkId, deleted: true });
    const forged = svixHeaders(eventId("cbad"), body, `whsec_${randomBytes(32).toString("base64")}`);
    const res = await post(request, "/api/webhook/clerk", body, forged);
    expect(res.status).toBe(401);
    expect(await db.webhookEvent.count({ where: { eventId: eventId("cbad") } })).toBe(0);
  });
});
