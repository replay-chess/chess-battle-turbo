// T17 (phase-02 plan 1.2, 11.1, 11.2 rule 11, 12.6) @smoke: the non-member R is kept out of games: the game page
// redirects to /pricing?reason=…&redirect_url=/game/<ref>, POST /api/games answers 402 subscription_required, and the
// socket refuses `spectate:join` with not_member.
import { randomUUID } from "node:crypto";
import { expect, socketCommand, startSeeded, test } from "../../fixtures/games";
import { p2 } from "./tags";

test.describe("paywall", { tag: p2("@smoke", "@local-only") }, () => {
  test("non-member: page, create and spectate are refused", async ({ seat, seedGame, nonMemberPage: page }) => {
    const a = await seat("P");
    const b = await seat("F");
    const g = await seedGame("G-THREEFOLD", a, b);
    await startSeeded(a, b, g.ref);

    await page.goto(`/game/${g.ref}`, { timeout: 180_000 });
    await page.waitForURL(/\/pricing\?/, { timeout: 60_000 });
    const url = new URL(page.url());
    // Plan 11.2 rule 11 names trial_available | trial_used | expired | payment_failed; the page gate sends a reason
    // the pricing page understands (P1 sends `required` for a never-trialled user; noted in the WP-I hand-back).
    expect(url.searchParams.get("reason")).toBeTruthy();
    expect(url.searchParams.get("redirect_url")).toBe(`/game/${g.ref}`);

    const create = await page.request.post("/api/games", {
      data: { mode: "BOT", start: { kind: "initial" }, color: "w", tc: { initialSeconds: 600, incrementSeconds: 0 } },
      headers: { "Idempotency-Key": randomUUID() },
    });
    expect(create.status()).toBe(402);
    expect(((await create.json()) as { error: { code: string } }).error.code).toBe("subscription_required");

    // spectate:join with R's own socket token (a socket.io client in the test process).
    const tokenRes = await page.request.get("/api/socket-token");
    expect(tokenRes.status()).toBe(200);
    const token = ((await tokenRes.json()) as { data: { token: string } }).data.token;
    const answer = await socketCommand(token, "spectate:join", { ref: g.ref });
    expect(answer).toMatchObject({ ok: false, code: "not_member" });
  });
});
