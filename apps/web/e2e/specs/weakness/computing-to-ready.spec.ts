// S2 Computing → ready on real data (phase-06 plan §12.4 `computing-to-ready.spec.ts`, §4.5, §5.5; §1.2 T2). Persona
// `weak-computing` (§6.8): 25 real CC0 games in scope, the 12 newest graded by the e2e worker (its first builds wrote the
// INSUFFICIENT snapshot), the 13 older ones queued for analysis. Its step `weak-computing:ready` lets those jobs run: the
// worker grades the 13 games, RECOMPUTE_WEAKNESS writes the READY snapshot and the worker's own `weakness:ready` reaches
// the member's room (and its server events reach the PostHog sink). Milestones are pushed through POST /api/dev/emit to the member's own room (the test hook), so the
// announcements are deterministic. @p6
//
//   "Analysing 25 games", the steps, the milestones announced once each (50 → 75 %); Home (a client navigation); the
//   persona step; the Train dot (badges weaknessReady); Back → the ready flash → "See your weakness profile" → the
//   profile; TR-13 once; the dot cleared; weakness_ready_seen exactly once
import type { Request } from "@playwright/test";
import { badgesOf, devEmit, DEVICES, expect, openWeakness, root, test, tr5, weakDb, progressEvent, weakStateTags } from "./_lib/weakness";

test.describe.configure({ mode: "serial" });
test.use({ ...DEVICES["desktop-1440"], timezoneId: "UTC" });

test.describe("weakness computing → ready · desktop-1440@100", { tag: ["@p6", ...weakStateTags("computing")] }, () => {
  test("milestones, the dot on Home, the ready flash, seen once", async ({ page, weak, weakStep, telemetry, reviewDb }) => {
    test.setTimeout(900_000);
    const lease = await weak("weak-computing");
    const p = await tr5(page.request);
    expect(p.status).toBe("computing");
    expect(p.games).toMatchObject({ analysed: 12, inScope: 25 });
    expect(p.progress).toMatchObject({ analysed: 12, target: 25, stalled: false, orphaned: false });
    expect((await badgesOf(page)).weaknessReady ?? false, "no profile to see yet").toBe(false);
    await openWeakness(page, "computing", "?from=nav");
    await expect(page.getByRole("heading", { level: 2 })).toHaveText("Analysing 25 games");
    await expect(page.getByTestId("weakness-steps")).toBeVisible();
    await telemetry.expect("weakness_computing_viewed", { target: 25, stalled: false, orphaned: false }, { count: 1 });

    // Milestones: once per threshold, through the member's own room.
    const milestone = page.getByTestId("weakness-milestone");
    for (const [pct, analysed, text] of [
      [50, 15, "Profile 50% built"],
      [62, 17, "Profile 50% built"],
      [80, 20, "Profile 75% built"],
    ] as const) {
      expect(await devEmit(page, "weakness:progress", progressEvent(pct, analysed, "grade"))).toBe(1);
      await expect(page.getByTestId("weakness-eta")).toContainText(`${pct}%`);
      await expect(milestone).toHaveText(text);
    }

    // Away on Home (a client navigation: the page's cache keeps the computing profile) while the worker finishes.
    await page.getByTestId("nav-item-home").click();
    await page.waitForURL(/\/home(\?|$)/);
    await expect(page.getByTestId("app-shell")).toBeVisible({ timeout: 120_000 });
    await expect(page.getByTestId("nav-dot-train")).toHaveCount(0);
    await weakStep("weak-computing:ready");
    await expect(page.getByTestId("nav-dot-train"), "the worker's weakness:ready turned the Train dot on").toBeVisible({ timeout: 30_000 });
    // The worker's own server events for the build (PostHog capture through the sink, PII-checked). Which READY builds
    // there are depends on the worker's order: the `first_build` trigger at 20 analysed games can run before the last
    // five analyses, and the settling recompute at 25 then writes READY again (bumping the version only if the profile
    // changed materially, §8.16), or the first READY build already sees all 25. Asserting one {games_analysed: 25,
    // bumped: true} event failed whenever the build at 20 won (REGRESSION-6 r3, r4, r6 under the full suite's load;
    // regression: weakness-first-ready-at-20). Every READY build saw 20 to 25 games, at least one bumped the version,
    // and the last one saw all 25, as the stored snapshot does.
    expect((await badgesOf(page)).weaknessReady).toBe(true);
    const userId = await weakDb(reviewDb).userId(lease.email);
    const ref = (await reviewDb.$queryRaw<{ ref: string }[]>`SELECT "referenceId" AS ref FROM users WHERE id = ${userId}`)[0]!.ref;
    await telemetry.expect("weakness_snapshot_computed", { status: "ready", games_analysed: 25 }, { source: "server", distinctId: ref });
    const ready = (await telemetry.events("server")).filter((e) => e.event === "weakness_snapshot_computed" && e.distinctId === ref && e.props.status === "ready");
    test.info().annotations.push({ type: "ready builds", description: ready.map((e) => `${String(e.props.games_analysed)} games, bumped ${String(e.props.bumped)}`).join("; ") });
    for (const e of ready) expect(Number(e.props.games_analysed), "a READY build had the required games").toBeGreaterThanOrEqual(20);
    expect(ready.filter((e) => e.props.bumped === true).length, "a READY build bumped the version").toBeGreaterThanOrEqual(1);
    expect((await weakDb(reviewDb).snapshots(userId))[0], "this week's snapshot").toEqual({ status: "READY", gamesAnalysed: 25 });
    const seenBefore = await weakDb(reviewDb).seen(userId);
    expect(seenBefore!.version).toBeGreaterThan(seenBefore!.seen);

    // Back to the page: it saw the build computing, so the ready flash, then the profile.
    const seen: Request[] = [];
    page.on("request", (r) => {
      if (r.url().endsWith("/api/train/weakness/seen") && r.method() === "POST") seen.push(r);
    });
    await page.goBack();
    await page.waitForURL(/\/train\/weakness/);
    await expect(page.getByTestId("weakness-ready-flash")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("weakness-ready-flash")).toContainText("Your profile is ready");
    await page.getByTestId("weakness-see-profile").click();
    await expect(root(page)).toHaveAttribute("data-status", "ready");
    await expect(page.getByTestId("weakness-headline")).toBeVisible();
    await expect.poll(() => seen.length, { timeout: 15_000 }).toBe(1);
    await expect(page.getByTestId("nav-dot-train")).toHaveCount(0, { timeout: 15_000 });
    expect((await badgesOf(page)).weaknessReady).toBe(false);
    const seenAfter = await weakDb(reviewDb).seen(userId);
    expect(seenAfter!.seen).toBe(seenAfter!.version);
    await page.waitForTimeout(1_500);
    expect(seen.length, "TR-13 sent once").toBe(1);
    await telemetry.expect("weakness_ready_seen", { version: seenAfter!.version }, { count: 1 });
  });

});
