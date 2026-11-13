// The onboarding happy path (phase-04 plan §12.4 `onboarding/happy-path.spec.ts`; owner test §1.1 rows 1–9). @p4
//
// Persona `onboarding-fresh` (a fresh sign-up at Welcome) → Welcome → Link a Chess.com handle the upstream mock serves
// from the knightowl_88 fixture (a per-run handle: the mock renames the fixture, so parallel runs never share games or
// lookup-cache rows) → found → Confirm (5 recent games, initials avatar) → That's Me → Level prefilled 800–1200 from
// "Chess.com: Rapid 1184" with "Puzzles start near 1150" → Goals defaults → Plan monthly → Start trial (the checkout
// POST says `source: "onboarding"`, every onboarding PATCH uses the lowercase wire values) → the mock's hosted checkout
// returns to /onboarding/activating with the subscription id → the signed `subscription.active` webhook
// (fixtures/dodo-webhook.ts) → success → Continue → Done importing → imported → Go to Home → /games with the Chess.com
// tab, every importable fixture game in it and the trialist's 20 eager reviews queued.
//
// Telemetry (testing X6): one `onb_step_viewed` per step in order, the lookup result, `checkout_started`,
// `checkout_activation_succeeded`, `onb_completed`; from the server sink `account_linked`, `import_started` and
// `import_finished` with the imported count. The handle is forbidden in every property.
//
// The fixture account has 48 games, 3 of which the import skips by design (a parse error, an unrated and a chess960
// game: packages/chess-fixtures/import/README.md), so "Imported N games" shows FIXTURE_IMPORTABLE (45), not 48.
//
// Projects (plan §12.4): desktop-1440 and iphone on every PR (`@smoke`), ipad-portrait in the full run.
import type { Page, Request } from "@playwright/test";
import { sendDodoWebhook, trialSubscription } from "../../fixtures/dodo-webhook";
import {
  DEVICES,
  FAMILY_DEVICE,
  FIXTURE_IMPORTABLE,
  clickReady,
  expect,
  expectStep,
  gotoStep,
  importRuns,
  noDocumentScroll,
  skipOtherEngines,
  stage,
  stateTag,
  test,
  tid,
  uniqueHandle,
  userRow,
  type Family,
} from "./_lib/p04";

test.describe.configure({ mode: "serial" });

const STEPS = ["welcome", "link", "confirm", "level", "goals", "plan", "activating", "done"] as const;

function tagsFor(family: Family): string[] {
  return [
    "@p4",
    "@local-only",
    ...(family === "ipad" ? [] : ["@smoke"]),
    stateTag(family, "welcome", "default"),
    stateTag(family, "link", "default"),
    stateTag(family, "link", "validating"),
    stateTag(family, "link", "found"),
    stateTag(family, "confirm", "default"),
    stateTag(family, "level", "prefilled"),
    stateTag(family, "goals", "default"),
    stateTag(family, "plan", "default"),
    stateTag(family, "plan", "loading"),
    `@state:${family === "desktop" ? "V3" : family === "iphone" ? "V3iPhone" : "V3iPad"}OnbPlan.plan=monthly`,
    stateTag(family, "activating", "polling"),
    stateTag(family, "activating", "success"),
    stateTag(family, "done", "importing"),
    stateTag(family, "done", "imported"),
  ];
}

/** Bodies of every onboarding PATCH and checkout POST the page sends. */
function recordWrites(page: Page) {
  const patches: Record<string, unknown>[] = [];
  const checkouts: Record<string, unknown>[] = [];
  page.on("request", (req: Request) => {
    const path = new URL(req.url()).pathname;
    if (path === "/api/me/onboarding" && req.method() === "PATCH") patches.push(req.postDataJSON() as Record<string, unknown>);
    if (path === "/api/checkout" && req.method() === "POST") checkouts.push(req.postDataJSON() as Record<string, unknown>);
  });
  return { patches, checkouts };
}

/**
 * The requests that are Vercel function invocations, from Welcome to Done `imported` (plan §5.9 "Request budget",
 * signed-in user, socket up): step renders (document or RSC), router prefetches and our /api calls, counted on their
 * responses. Static files, images and the socket are not invocations; a 3xx hop (Clerk's cross-origin handshake on a
 * return from another origin, a guard redirect) is listed but is middleware, not a render.
 */
function recordInvocations(page: Page) {
  const seen: string[] = [];
  let origin: string | null = null;
  page.on("response", (res) => {
    if (!origin) return;
    const req = res.request();
    const u = new URL(req.url());
    if (u.origin !== origin || u.pathname.startsWith("/_next/") || u.pathname.startsWith("/socket.io")) return;
    const h = req.headers();
    const doc = h["rsc"] === "1" || req.resourceType() === "document";
    const kind = h["next-router-prefetch"] === "1" ? "prefetch" : res.status() >= 300 && res.status() < 400 ? "redirect" : doc ? "render" : "api";
    if (kind === "api" && !u.pathname.startsWith("/api/")) return;
    seen.push(`${kind} ${req.method()} ${u.pathname}`);
  });
  return {
    start: () => void (origin = new URL(page.url()).origin),
    stop: () => void (origin = null),
    count: (re: RegExp) => seen.filter((s) => re.test(s)).length,
    seen,
  };
}

/**
 * The page's in-flight GET /api/import/status reads. Continue on Activating is a document navigation
 * (leaveActivation); a read the import's `import:finished` started a moment earlier is cut by it, and WebKit reports
 * the cut fetch as an uncaught "…/api/import/status due to access control checks." page error (Linux WebKit, the CI
 * browser). The member loses nothing (Done reads the status again); the spec lets the read finish first, as the
 * sign-in fixture does for /api/me (regression: webkit-signin-me-abort, webkit-activating-status-abort).
 */
function pendingStatusReads(page: Page) {
  const pending = new Set<Request>();
  const isStatus = (r: Request) => new URL(r.url()).pathname === "/api/import/status";
  page.on("request", (r) => void (isStatus(r) && pending.add(r)));
  page.on("requestfinished", (r) => void pending.delete(r));
  page.on("requestfailed", (r) => void pending.delete(r));
  return {
    async settled(timeoutMs = 15_000) {
      const until = Date.now() + timeoutMs;
      while (pending.size > 0 && Date.now() < until) await page.waitForTimeout(50);
    },
  };
}

/** Every string value a PATCH carries for an enum field is lowercase (D4-25: the wire values). */
function wireValuesOf(body: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const key of ["step", "ratingBand", "ratingBandSource", "goals"]) {
    const v = body[key];
    if (typeof v === "string") out.push(v);
    if (Array.isArray(v)) out.push(...v.filter((x): x is string => typeof x === "string"));
  }
  return out;
}

for (const family of ["desktop", "iphone", "ipad"] as const) {
  test.describe(`onboarding happy path · ${family}`, () => {
    test.use(DEVICES[FAMILY_DEVICE[family]]);

    test(
      `fresh sign-up → Chess.com → trial → import → /games (${family})`,
      { tag: tagsFor(family) },
      async ({ page, leasePersona, telemetry, upstream, p4db, request }, testInfo) => {
        const skip = skipOtherEngines(testInfo, family);
        test.skip(skip !== null, skip ?? "");
        test.setTimeout(480_000);
        const me = await leasePersona("onboarding-fresh");
        const handle = uniqueHandle("owl", testInfo);
        telemetry.forbid(handle);
        // The mock's hosted checkout returns at once and sends no webhook for this customer: the spec sends it.
        await upstream.dodoFor(me.email, { webhook: false });
        const writes = recordWrites(page);
        const calls = recordInvocations(page);
        const statusReads = pendingStatusReads(page);

        // ── Welcome ──
        await gotoStep(page, "");
        await expectStep(page, "welcome");
        await expect(stage(page, "welcome")).toHaveAttribute("data-state", "default");
        calls.start();
        await expect(tid(page, "onb-welcome-trial-row")).toBeVisible();
        await noDocumentScroll(page);
        await clickReady(page, "onb-get-started");

        // ── Link: validating (a held lookup), then found ──
        await expectStep(page, "link");
        await expect(stage(page, "link")).toHaveAttribute("data-state", "default");
        let release: () => void = () => {};
        const held = new Promise<void>((r) => (release = r));
        await page.route("**/api/accounts/chesscom/lookup", async (route) => {
          await held;
          await route.fallback();
        });
        await tid(page, "onb-username").fill(handle);
        await clickReady(page, "onb-lookup");
        await expect(stage(page, "link")).toHaveAttribute("data-state", "validating");
        release();
        await expect(tid(page, "onb-found")).toBeVisible({ timeout: 30_000 });
        await expect(stage(page, "link")).toHaveAttribute("data-state", "found");
        await page.unroute("**/api/accounts/chesscom/lookup");
        await noDocumentScroll(page);
        await clickReady(page, "onb-continue");

        // ── Confirm ──
        await expectStep(page, "confirm");
        await expect(stage(page, "confirm")).toHaveAttribute("data-state", "default", { timeout: 30_000 });
        const card = tid(page, "onb-profile-card");
        await expect(card).toContainText(handle.toLowerCase());
        await expect(card.locator(".onb-av")).toHaveText(/^[A-Z]{1,2}$/);
        await expect(tid(page, "onb-recent-games").locator("li")).toHaveCount(5);
        await noDocumentScroll(page);
        await clickReady(page, "onb-thats-me");

        // ── Level: prefilled from the linked account ──
        await expectStep(page, "level");
        await expect(stage(page, "level")).toHaveAttribute("data-state", "prefilled");
        await expect(tid(page, "onb-level-banner")).toContainText("From Chess.com");
        await expect(tid(page, "onb-level-banner")).toContainText("Rapid 1184");
        await expect(tid(page, "onb-band-picker").getByRole("radio", { checked: true })).toContainText(/800\s*[–-]\s*1200/);
        await expect(page.getByText("Puzzles start near 1150").first()).toBeAttached();
        await noDocumentScroll(page);
        await clickReady(page, "onb-continue");

        // ── Goals: the defaults ──
        await expectStep(page, "goals");
        await expect(stage(page, "goals")).toHaveAttribute("data-state", "default");
        await noDocumentScroll(page);
        await clickReady(page, "onb-continue");

        // ── Plan: monthly, trial ──
        await expectStep(page, "plan");
        await expect(stage(page, "plan")).toHaveAttribute("data-state", "default");
        await expect(page.locator("h1").filter({ visible: true }).first()).toHaveText("Start your 7-day free trial.");
        await expect(tid(page, "onb-plan-period").getByRole("radio", { checked: true })).toContainText(/month/i);
        await expect(tid(page, "trial-terms-line")).toBeVisible();
        await noDocumentScroll(page);
        const before = await userRow(p4db, me.email);
        expect(before.step).toBe("PLAN");
        expect(before.band).toBe("R800_1200");
        // Hold the checkout POST for a moment so the loading state is observable.
        let releaseCheckout: () => void = () => {};
        const checkoutHeld = new Promise<void>((r) => (releaseCheckout = r));
        await page.route("**/api/checkout", async (route) => {
          await checkoutHeld;
          await route.fallback();
        });
        await clickReady(page, "onb-start-checkout");
        await expect(stage(page, "plan")).toHaveAttribute("data-state", "loading");
        releaseCheckout();

        // ── Activating: the hosted checkout (mock) returned with the subscription; no webhook yet ──
        await expect(page).toHaveURL(/\/onboarding\/activating\?/, { timeout: 60_000 });
        const subscriptionId = new URL(page.url()).searchParams.get("subscription_id");
        expect(subscriptionId, "the return URL carries the subscription").toBeTruthy();
        await expect(stage(page, "activating")).toBeVisible();
        await expect(stage(page, "activating")).toHaveAttribute("data-state", /polling|success/);
        if ((await stage(page, "activating").getAttribute("data-state")) === "polling") {
          // `polling` is reached before the webhook arrives; the spec sends it now.
          const sub = await upstream.subscription(subscriptionId!);
          const data = { ...trialSubscription({ clerkUserId: me.clerkUserId, customerId: sub.customer.customer_id, email: me.email, productId: String(sub.product_id), subscriptionId: subscriptionId! }) };
          const res = await sendDodoWebhook(request, "subscription.active", data);
          expect(res.status, res.body).toBe(200);
        }
        await expect(stage(page, "activating")).toHaveAttribute("data-state", "success", { timeout: 60_000 });
        // A second delivery of the same snapshot (Dodo retries) changes nothing.
        const sub = await upstream.subscription(subscriptionId!);
        const again = await sendDodoWebhook(request, "subscription.active", trialSubscription({ clerkUserId: me.clerkUserId, customerId: sub.customer.customer_id, email: me.email, productId: String(sub.product_id), subscriptionId: subscriptionId! }));
        expect(again.status).toBe(200);
        await statusReads.settled();
        await clickReady(page, "onb-activating-continue");

        // ── Done: importing → imported ──
        await expectStep(page, "done");
        const importCard = page.locator('[data-testid="import-progress-card"]:visible').first();
        await expect(importCard).toBeVisible();
        await expect(importCard).toHaveAttribute("data-state", /queued|reading|saving|imported/);
        await expect(importCard).toHaveAttribute("data-state", "imported", { timeout: 180_000 });
        await expect(importCard).toContainText(String(FIXTURE_IMPORTABLE));
        await noDocumentScroll(page);
        const runs = await importRuns(p4db, me.email);
        expect(runs).toHaveLength(1);
        expect(runs[0]).toMatchObject({ status: "DONE", trigger: "INITIAL", provider: "CHESSCOM", imported: FIXTURE_IMPORTABLE, queued: 20 });
        calls.stop();
        // ── Request budget (plan §5.9, regression: p04-request-budget) ──
        testInfo.annotations.push({ type: "invocations", description: calls.seen.join(", ") });
        expect(calls.count(/^render GET \/onboarding\//), "step renders").toBeLessThanOrEqual(8);
        expect(calls.count(/^prefetch /), `prefetches: ${calls.seen.filter((c) => c.startsWith("prefetch")).join(", ")}`).toBeLessThanOrEqual(1);
        // Done prefetches nothing on load: not the legend position (regression: p04-done-legend-prefetch).
        expect(calls.seen.filter((c) => /^prefetch GET \/position\//.test(c)), "Done's legend CTA is not prefetched").toEqual([]);
        // The return from the hosted checkout stays in the flow: no sign-in hop (regression: p04-webkit-checkout-return).
        expect(calls.seen.filter((c) => / \/sign-in/.test(c)), "the checkout return never goes through /sign-in").toEqual([]);
        expect(calls.count(/^api PATCH \/api\/me\/onboarding$/), "step PATCHes + complete").toBeLessThanOrEqual(7);
        expect(calls.count(/^api POST \/api\/accounts\/chesscom\/lookup$/), "lookups").toBe(1);
        expect(calls.count(/^api POST \/api\/accounts\/chesscom$/), "links").toBe(1);
        expect(calls.count(/^api POST \/api\/checkout$/), "checkouts").toBe(1);
        expect(calls.count(/^api GET \/api\/billing\/activation$/), "activation GETs").toBeLessThanOrEqual(2);
        // One GET at most: the confirming refetch after `import:finished` (lib/realtime/handlers/import.ts); no polls
        // and no mount refetch of the copy the page's RSC seeded.
        expect(calls.count(/^api GET \/api\/import\/status$/), "import status GETs with the socket up").toBeLessThanOrEqual(1);
        expect(calls.count(/^(render|prefetch|api) /), `invocations: ${calls.seen.join(", ")}`).toBeLessThanOrEqual(21);
        await clickReady(page, "onb-go-home");

        // ── /games: the Chess.com tab ──
        await expect(page).toHaveURL(/\/games(\?|$)/, { timeout: 60_000 });
        await expect(tid(page, "games-source-chesscom")).toContainText(String(FIXTURE_IMPORTABLE));
        await clickReady(page, "games-source-chesscom");
        await expect(page).toHaveURL(/source=chesscom/);
        await expect(page.locator('[data-testid="games-row"]:visible').first()).toBeVisible();
        const after = await userRow(p4db, me.email);
        expect(after).toMatchObject({ onboarded: true, step: "DONE", lastCheckoutSource: "onboarding" });

        // ── Wire bodies ──
        expect(writes.checkouts).toHaveLength(1);
        expect(writes.checkouts[0]).toMatchObject({ source: "onboarding", plan: "monthly" });
        expect(writes.patches.length).toBeGreaterThan(0);
        for (const body of writes.patches) {
          for (const v of wireValuesOf(body)) expect(v, `PATCH ${JSON.stringify(body)}`).toBe(v.toLowerCase());
        }

        // ── Telemetry (client, in order; then the server sink) ──
        // From the Welcome view on: the lease signs the pool user in before resetting it, so its previous state may have
        // rendered a step first.
        const allViewed = (await telemetry.events("client")).filter((e) => e.event === "onb_step_viewed").map((e) => e.props.step);
        const viewed = allViewed.slice(allViewed.indexOf("welcome"));
        const firstSeen = STEPS.map((s) => viewed.indexOf(s));
        expect(firstSeen.every((i) => i >= 0), `every step viewed: ${viewed.join(",")}`).toBe(true);
        expect([...firstSeen].sort((a, b) => a - b)).toEqual(firstSeen);
        await telemetry.expect("onb_link_lookup_result", { result: "found" }, { source: "client" });
        await telemetry.expect("checkout_started", { source: "onboarding", plan: "monthly", is_trial: true }, { source: "client", count: 1 });
        await telemetry.expect("checkout_activation_succeeded", { source: "onboarding", is_trial: true }, { source: "client" });
        await telemetry.expect("onb_completed", { is_trial: true, plan: "monthly" }, { source: "client", count: 1 });
        await telemetry.expect("account_linked", { provider: "chesscom", context: "onboarding" }, { source: "server", distinctId: me.ref, count: 1 });
        await telemetry.expect("import_started", { provider: "chesscom", trigger: "initial" }, { source: "server", distinctId: me.ref, timeout: 30_000 });
        await telemetry.expect("import_finished", { provider: "chesscom", imported: FIXTURE_IMPORTABLE }, { source: "server", distinctId: me.ref, timeout: 30_000 });
      },
    );
  });
}
