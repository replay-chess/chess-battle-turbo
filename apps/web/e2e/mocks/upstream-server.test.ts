// The upstream mock speaks what the real clients send and expect (phase-04 plan §12.4): Chess.com answers per handle
// kind with ETag/304, the Lichess OAuth flow checks PKCE and records the revoke, the export filters and is newest
// first, and a Dodo checkout pays, returns and delivers a correctly signed webhook.
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import { Webhook } from "standardwebhooks";
import { chessComKindOf, chessComMonths, createUpstreamServer, handleTag, lichessGameId, lichessLines } from "./upstream-server";

const KEY = `whsec_${Buffer.from("upstream-mock-test-key-0123456789").toString("base64")}`;

function listen(server: Server): Promise<string> {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)));
}

describe("upstream mock", () => {
  let base = "";
  let webBase = "";
  const received: { body: string; ok: boolean }[] = [];
  const web = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      let ok = true;
      try {
        new Webhook(KEY).verify(body, req.headers as Record<string, string>);
      } catch {
        ok = false;
      }
      received.push({ body, ok });
      res.writeHead(200).end("{}");
    });
  });
  let upstream: ReturnType<typeof createUpstreamServer>;
  const previousKey = process.env.DODO_PAYMENTS_WEBHOOK_KEY;

  before(async () => {
    process.env.DODO_PAYMENTS_WEBHOOK_KEY = KEY;
    webBase = await listen(web);
    upstream = createUpstreamServer({ web: webBase });
    upstream.state.dodo.webhookDelayMs = 0;
    base = await listen(upstream.server);
  });
  after(() => {
    process.env.DODO_PAYMENTS_WEBHOOK_KEY = previousKey;
    upstream.server.close();
    web.close();
  });

  it("Chess.com: handle kinds, per-handle game ids, ETag and 304", async () => {
    assert.equal(chessComKindOf("NotFoundXyz"), "not_found");
    assert.equal(chessComKindOf("closed_one"), "closed");
    assert.equal(chessComKindOf("empty_one"), "empty");
    assert.equal(chessComKindOf("Magnus_e2e"), "found");
    const a = [...chessComMonths("alpha_1").values()].flat();
    const b = [...chessComMonths("beta_2").values()].flat();
    assert.equal(a.length, 48);
    assert.ok(a.every((g) => String(g.url).endsWith(handleTag("alpha_1"))));
    assert.equal(new Set([...a, ...b].map((g) => g.url)).size, a.length + b.length, "no game shared between handles");
    assert.ok(a.some((g) => (g.white as { username: string }).username === "alpha_1"));

    assert.equal((await fetch(`${base}/chesscom/pub/player/nobody_x`)).status, 404);
    const closed = (await (await fetch(`${base}/chesscom/pub/player/closed_x`)).json()) as { status: string };
    assert.match(closed.status, /^closed/);
    const archives = await fetch(`${base}/chesscom/pub/player/alpha_1/games/archives`);
    const etag = archives.headers.get("etag")!;
    assert.equal(((await archives.json()) as { archives: string[] }).archives.length, 3);
    assert.equal((await fetch(`${base}/chesscom/pub/player/alpha_1/games/archives`, { headers: { "if-none-match": etag } })).status, 304);
    const empty = (await (await fetch(`${base}/chesscom/pub/player/empty_x/games/archives`)).json()) as { archives: string[] };
    assert.deepEqual(empty.archives, []);
  });

  it("Chess.com: the plan's error handles, and `blocked…` found only through the worker's base", async () => {
    assert.equal(chessComKindOf("quiet_rook"), "gone");
    assert.equal(chessComKindOf("knightowl88xx"), "not_found");
    assert.equal((await fetch(`${base}/chesscom/pub/player/quiet_rook`)).status, 410);
    const limited = await fetch(`${base}/chesscom/pub/player/ratelimited_1`);
    assert.equal(limited.status, 429);
    assert.equal(limited.headers.get("retry-after"), "30");
    assert.equal((await fetch(`${base}/chesscom-worker/pub/player/ratelimited_1`)).status, 429, "the fallback is limited too");
    assert.equal((await fetch(`${base}/chesscom/pub/player/boom_1`)).status, 503);
    assert.equal((await fetch(`${base}/chesscom/pub/player/blocked_1`)).status, 403);
    const viaWorker = await fetch(`${base}/chesscom-worker/pub/player/blocked_1`);
    assert.equal(viaWorker.status, 200);
    assert.equal(((await viaWorker.json()) as { username: string }).username, "blocked_1");
    const months = await fetch(`${base}/chesscom-worker/pub/player/blocked_1/games/archives`);
    assert.equal(((await months.json()) as { archives: string[] }).archives.length, 3);
    const state = (await (await fetch(`${base}/__control`)).json()) as { requests: { caller: string; path: string }[]; maxConcurrency: Record<string, number> };
    assert.ok(state.requests.some((r) => r.caller === "worker" && r.path === "/pub/player/blocked_1"));
    assert.ok((state.maxConcurrency["chesscom:web"] ?? 0) >= 1);
  });

  it("Lichess: the consent page approves with a typed username or denies; the export is paced and anonymous", async () => {
    await fetch(`${base}/__mock/lichess`, { method: "POST", body: JSON.stringify({ auto: false, gamesPerSec: 20 }) });
    const redirect = "http://localhost:3000/api/accounts/lichess/callback";
    const q = new URLSearchParams({ response_type: "code", client_id: "x", redirect_uri: redirect, code_challenge_method: "S256", code_challenge: "c".repeat(43), state: "st2" });
    const page = await fetch(`${base}/lichess/oauth?${q}`, { redirect: "manual" });
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /data-testid="mock-lichess-approve"/);
    assert.match(html, /name="state" value="st2"/);
    // regression: p04-webkit-oauth-cookie — no Referer reaches the callback (Clerk's cross-origin handshake).
    assert.equal(page.headers.get("referrer-policy"), "no-referrer");
    const approve = await fetch(`${base}/lichess/oauth/decide?${q}&username=Page_Owl&approve=1`, { redirect: "manual" });
    assert.equal(approve.status, 302);
    assert.equal(approve.headers.get("referrer-policy"), "no-referrer");
    const back = new URL(approve.headers.get("location")!);
    assert.ok(back.searchParams.get("code"));
    assert.equal(back.searchParams.get("state"), "st2");
    const deny = await fetch(`${base}/lichess/oauth/decide?${q}&approve=0`, { redirect: "manual" });
    assert.equal(new URL(deny.headers.get("location")!).searchParams.get("error"), "access_denied");

    const authed = await fetch(`${base}/lichess-worker/api/games/user/page_owl`, { headers: { authorization: "Bearer lio_x" } });
    assert.equal(authed.status, 400);
    const t0 = Date.now();
    const body = await (await fetch(`${base}/lichess-worker/api/games/user/page_owl?max=10`)).text();
    assert.equal(body.trim().split("\n").length, 10);
    assert.ok(Date.now() - t0 >= 400, "10 lines at 20 games/s take about half a second");
    const state = (await (await fetch(`${base}/__mock/state`)).json()) as { authOnExport: number };
    assert.equal(state.authOnExport, 1);
    await fetch(`${base}/__mock/lichess`, { method: "POST", body: JSON.stringify({ gamesPerSec: 0 }) });
  });

  it("Lichess: consent → code → PKCE token → account → revoke; the export filters newest first", async () => {
    const verifier = randomBytes(32).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const redirect = "http://localhost:3000/api/accounts/lichess/callback";
    await fetch(`${base}/__mock/lichess`, { method: "POST", body: JSON.stringify({ username: "Owl_e2e", deny: false, auto: true, gamesPerSec: 0 }) });
    const q = new URLSearchParams({ response_type: "code", client_id: "x", redirect_uri: redirect, code_challenge_method: "S256", code_challenge: challenge, state: "st1" });
    const consent = await fetch(`${base}/lichess/oauth?${q}`, { redirect: "manual" });
    assert.equal(consent.status, 302);
    const back = new URL(consent.headers.get("location")!);
    assert.equal(back.searchParams.get("state"), "st1");
    const code = back.searchParams.get("code")!;
    const bad = await fetch(`${base}/lichess/api/token`, {
      method: "POST",
      body: new URLSearchParams({ grant_type: "authorization_code", code, code_verifier: "wrong", redirect_uri: redirect, client_id: "x" }),
    });
    assert.equal(bad.status, 400);
    const consent2 = await fetch(`${base}/lichess/oauth?${q}`, { redirect: "manual" });
    const code2 = new URL(consent2.headers.get("location")!).searchParams.get("code")!;
    const tok = (await (
      await fetch(`${base}/lichess/api/token`, {
        method: "POST",
        body: new URLSearchParams({ grant_type: "authorization_code", code: code2, code_verifier: verifier, redirect_uri: redirect, client_id: "x" }),
      })
    ).json()) as { access_token: string };
    const account = (await (await fetch(`${base}/lichess/api/account`, { headers: { authorization: `Bearer ${tok.access_token}` } })).json()) as { id: string };
    assert.equal(account.id, "owl_e2e");
    assert.equal((await fetch(`${base}/lichess/api/token`, { method: "DELETE", headers: { authorization: `Bearer ${tok.access_token}` } })).status, 204);
    assert.equal((await fetch(`${base}/lichess/api/account`, { headers: { authorization: `Bearer ${tok.access_token}` } })).status, 401);
    const state = (await (await fetch(`${base}/__mock/state`)).json()) as { revoked: string[] };
    assert.equal(state.revoked.length, 1);

    await fetch(`${base}/__mock/lichess`, { method: "POST", body: JSON.stringify({ deny: true }) });
    const denied = new URL((await fetch(`${base}/lichess/oauth?${q}`, { redirect: "manual" })).headers.get("location")!);
    assert.equal(denied.searchParams.get("error"), "access_denied");
    await fetch(`${base}/__mock/lichess`, { method: "POST", body: JSON.stringify({ deny: false }) });

    const lines = lichessLines("Owl_e2e");
    assert.ok(lines.length >= 25);
    assert.ok(lines.every((g, i) => i === 0 || Number(lines[i - 1]!.createdAt) >= Number(g.createdAt)));
    assert.ok(lines.every((g) => /^[0-9a-z]{8}$/.test(String(g.id))), "8-character ids (the export schema)");
    assert.equal(new Set(lines.map((g) => g.id)).size, lines.length);
    assert.ok(lines.every((g) => String(g.id).startsWith(lichessGameId("owl_e2e", 0).slice(0, 5))));
    const since = Number(lines[5]!.createdAt);
    const body = await (await fetch(`${base}/lichess/api/games/user/owl_e2e?since=${since}&max=3`)).text();
    const got = body.trim().split("\n").map((l) => JSON.parse(l) as { createdAt: number });
    assert.equal(got.length, 3);
    assert.ok(got.every((g) => g.createdAt >= since));
  });

  it("Dodo: per-customer control (decline, no webhook) does not touch other customers", async () => {
    await fetch(`${base}/__mock/dodo`, { method: "POST", body: JSON.stringify({ email: "Decline@Example.test", decline: true }) });
    const checkout = async (email: string) =>
      (await (
        await fetch(`${base}/dodo/checkouts`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ product_cart: [{ product_id: "pdt_m", quantity: 1 }], customer: { email }, return_url: "http://localhost:3000/checkout/activating" }),
        })
      ).json()) as { checkout_url: string };
    const declined = await fetch((await checkout("decline@example.test")).checkout_url, { redirect: "manual" });
    assert.equal(new URL(declined.headers.get("location")!).searchParams.get("status"), "failed");
    await fetch(`${base}/__mock/dodo`, { method: "POST", body: JSON.stringify({ email: "decline@example.test", clear: true }) });
    await fetch(`${base}/__mock/dodo`, { method: "POST", body: JSON.stringify({ email: "quiet@example.test", webhook: false }) });
    const before = received.length;
    const paid = await fetch((await checkout("quiet@example.test")).checkout_url, { redirect: "manual" });
    assert.equal(new URL(paid.headers.get("location")!).searchParams.get("status"), "active");
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(received.length, before, "no webhook for a customer whose webhook is off");
  });

  it("Dodo: pendingUntilWebhook keeps the subscription pending until its webhook is delivered", async () => {
    await fetch(`${base}/__mock/dodo`, { method: "POST", body: JSON.stringify({ email: "pending@example.test", pendingUntilWebhook: true, webhookDelayMs: 50 }) });
    const created = (await (
      await fetch(`${base}/dodo/checkouts`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ product_cart: [{ product_id: "pdt_m", quantity: 1 }], customer: { email: "pending@example.test" }, return_url: "http://localhost:3000/checkout/activating" }),
      })
    ).json()) as { checkout_url: string };
    const back = new URL((await fetch(created.checkout_url, { redirect: "manual" })).headers.get("location")!);
    const subId = back.searchParams.get("subscription_id")!;
    assert.equal(((await (await fetch(`${base}/dodo/subscriptions/${subId}`)).json()) as { status: string }).status, "pending");
    for (let i = 0; i < 50 && received.length === 0; i++) await new Promise((r) => setTimeout(r, 20));
    assert.equal(((await (await fetch(`${base}/dodo/subscriptions/${subId}`)).json()) as { status: string }).status, "active");
    received.length = 0;
  });

  it("a delay holds matching requests only", async () => {
    await fetch(`${base}/__mock/delay`, { method: "POST", body: JSON.stringify({ provider: "chesscom", ms: 300, match: "/pub/player/slow_one/games/" }) });
    const t0 = Date.now();
    await fetch(`${base}/chesscom/pub/player/slow_one/games/archives`);
    assert.ok(Date.now() - t0 >= 280, "the matching request waited");
    const t1 = Date.now();
    await fetch(`${base}/chesscom/pub/player/slow_one`);
    assert.ok(Date.now() - t1 < 250, "the profile is not delayed");
    await fetch(`${base}/__mock/delay`, { method: "POST", body: JSON.stringify({ provider: "chesscom", clear: true }) });
  });

  it("Dodo: a checkout pays, returns with the subscription and delivers a signed subscription.active", async () => {
    const created = (await (
      await fetch(`${base}/dodo/checkouts`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          product_cart: [{ product_id: "pdt_m", quantity: 1 }],
          customer: { email: "e2e@example.test", name: "E2E" },
          metadata: { clerkUserId: "user_1" },
          subscription_data: { trial_period_days: 7 },
          return_url: "http://localhost:3000/onboarding/activating?checkout=success&plan=monthly",
        }),
      })
    ).json()) as { session_id: string; checkout_url: string };
    assert.match(created.checkout_url, /\/dodo\/pay\/cks_mock_/);
    // The browser's round trip stays same-site with the app on http://localhost (regression: p04-webkit-checkout-return).
    assert.equal(new URL(created.checkout_url).hostname, "localhost");
    assert.equal(new URL(created.checkout_url).port, new URL(base).port);
    const paid = await fetch(created.checkout_url, { redirect: "manual" });
    assert.equal(paid.status, 302);
    const back = new URL(paid.headers.get("location")!);
    assert.equal(back.searchParams.get("status"), "active");
    const subId = back.searchParams.get("subscription_id")!;
    for (let i = 0; i < 50 && received.length === 0; i++) await new Promise((r) => setTimeout(r, 20));
    assert.equal(received.length, 1);
    assert.ok(received[0]!.ok, "the webhook verifies with the shared key");
    const event = JSON.parse(received[0]!.body) as { type: string; data: { subscription_id: string; trial_period_days: number; metadata: { clerkUserId: string } } };
    assert.equal(event.type, "subscription.active");
    assert.equal(event.data.subscription_id, subId);
    assert.equal(event.data.trial_period_days, 7);
    assert.equal(event.data.metadata.clerkUserId, "user_1");
    const session = (await (await fetch(`${base}/dodo/checkouts/${created.session_id}`)).json()) as { payment_status: string };
    assert.equal(session.payment_status, "succeeded");
    const sub = (await (await fetch(`${base}/dodo/subscriptions/${subId}`)).json()) as { customer: { customer_id: string } };
    const list = (await (await fetch(`${base}/dodo/subscriptions?customer_id=${sub.customer.customer_id}`)).json()) as { items: unknown[] };
    assert.equal(list.items.length, 1);
    const patched = (await (
      await fetch(`${base}/dodo/subscriptions/${subId}`, { method: "PATCH", body: JSON.stringify({ cancel_at_next_billing_date: true }) })
    ).json()) as { cancel_at_next_billing_date: boolean };
    assert.equal(patched.cancel_at_next_billing_date, true);
  });

  it("faults answer the configured status a set number of times", async () => {
    await fetch(`${base}/__mock/fault`, { method: "POST", body: JSON.stringify({ provider: "chesscom", status: 503, times: 1 }) });
    assert.equal((await fetch(`${base}/chesscom/pub/player/alpha_1`)).status, 503);
    assert.equal((await fetch(`${base}/chesscom/pub/player/alpha_1`)).status, 200);
  });
});
