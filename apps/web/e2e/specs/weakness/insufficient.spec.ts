// S1 Insufficient on real data (phase-06 plan §12.4 `insufficient.spec.ts`, §4.4, §1.2 T1, T8). Personas (§6.8, all real
// CC0 Lichess games graded by the e2e worker): `weak-insufficient` (a trialist, 14 graded rapid/blitz games and the
// INSUFFICIENT snapshot the worker's first builds wrote), `weak-few` (3 graded games: no build yet), `weak-zero` (no
// game) and `bullet` (20 bullet + 6 blitz games, all graded: the default scope leaves bullet out). Every number is the
// member's own TR-5 payload. @p6
//
//   weak-insufficient  the h2 ("6 more games …"), the meter's aria-label, the preliminary rows the snapshot holds, the
//                      import CTA (/settings/connected), "Or play 6 more games here"; weakness_viewed, play CTA event
//   weak-few           the empty state ("Nothing Yet") beside the meter at 3 of 20
//   weak-zero          the zero h2, 0 of 20, the import CTA → /settings/connected and its event
//   bullet             "You have 20 bullet games from the last 6 months. Include them?" → TR-12 with bullet in the scope
//                      (202) → computing → the worker's READY → the profile, scope with bullet
import { devEmit, DEVICES, expect, openWeakness, root, test, tr5, weakStateTags } from "./_lib/weakness";

test.describe.configure({ mode: "serial" });
test.use({ ...DEVICES["desktop-1440"], timezoneId: "UTC" });

test.describe("weakness insufficient · desktop-1440@100", { tag: ["@p6", ...weakStateTags("insufficient")] }, () => {
  test("weak-insufficient: h2, meter, preliminary rows, import and play CTAs @smoke", async ({ page, weak, telemetry }) => {
    test.setTimeout(480_000);
    await weak("weak-insufficient");
    const p = await tr5(page.request);
    expect(p.status).toBe("insufficient");
    expect(p.games.analysed, "every game of the persona is graded").toBe(14);
    expect(p.preliminary.length, "the worker's first builds found patterns in the 14 games").toBeGreaterThanOrEqual(1);
    await openWeakness(page, "insufficient", "?from=nav");
    const need = 20 - p.games.analysed;
    await expect(page.getByRole("heading", { level: 2 })).toHaveText(`${need} more games and we can tell you what keeps costing you points`);
    await expect(page.getByTestId("weakness-meter")).toHaveAttribute("aria-label", `${p.games.analysed} of 20 games analysed`);
    const rows = page.getByTestId("weakness-preliminary").locator("li");
    await expect(rows).toHaveCount(p.preliminary.length);
    for (const r of p.preliminary) {
      const li = page.getByTestId("weakness-preliminary").locator(`li[data-pattern="${r.pattern}"]`);
      await expect(li).toContainText(r.label);
      await expect(li).toContainText(`Seen in ${r.seenIn} of ${r.of} games`);
    }
    await expect(page.getByTestId("weakness-import-cta")).toHaveAttribute("href", "/settings/connected");
    await expect(page.getByTestId("weakness-import-cta")).toHaveText("Import games from Chess.com or Lichess");
    await expect(page.getByTestId("weakness-play-cta")).toHaveText(`Or play ${20 - p.games.inScope} more games here`);
    await telemetry.expect("weakness_viewed", { status: "insufficient", games_analysed: p.games.analysed, entry: "nav" }, { count: 1 });
    await page.getByTestId("weakness-play-cta").click();
    await page.waitForURL(/\/play(\?|$)/);
    await telemetry.expect("weakness_play_cta_clicked", { analysed: p.games.analysed }, { count: 1 });
  });

  test("weak-few: the empty state beside the meter", async ({ page, weak }) => {
    test.setTimeout(480_000);
    await weak("weak-few");
    const p = await tr5(page.request);
    expect(p.status).toBe("insufficient");
    expect(p.games.analysed).toBe(3);
    expect(p.preliminary).toEqual([]);
    await openWeakness(page, "insufficient");
    await expect(page.getByTestId("weakness-meter")).toHaveAttribute("aria-label", "3 of 20 games analysed");
    const empty = page.getByTestId("weakness-preliminary-empty");
    await expect(empty).toContainText("Nothing Yet");
    await expect(empty).toContainText("Patterns show after 5 analysed games.");
    await expect(page.getByRole("heading", { level: 2 })).toHaveText("17 more games and we can tell you what keeps costing you points");
  });

  test("weak-zero: the zero copy and the import CTA", async ({ page, weak, telemetry }) => {
    test.setTimeout(480_000);
    await weak("weak-zero");
    const p = await tr5(page.request);
    expect(p.status).toBe("insufficient");
    expect(p.games).toMatchObject({ analysed: 0, inScope: 0 });
    await openWeakness(page, "insufficient");
    await expect(page.getByRole("heading", { level: 2 })).toHaveText("Play or import 20 games and we can tell you what keeps costing you points");
    await expect(page.getByTestId("weakness-meter")).toHaveAttribute("aria-label", "0 of 20 games analysed");
    await page.getByTestId("weakness-import-cta").click();
    await page.waitForURL(/\/settings\/connected/);
    await telemetry.expect("weakness_import_cta_clicked", { analysed: 0 }, { count: 1 });
  });

  test("bullet: the offer → TR-12 with bullet → computing → the profile", async ({ page, weak, telemetry }) => {
    test.setTimeout(600_000);
    await weak("bullet");
    const p = await tr5(page.request);
    expect(p.status).toBe("insufficient");
    expect(p.scope.timeClasses).not.toContain("BULLET");
    expect(p.offers.includeBullet, "the window's bullet games fill the gap").toEqual({ bulletGames: 20 });
    await openWeakness(page, "insufficient");
    await expect(page.getByTestId("weakness-bullet-offer")).toContainText("You have 20 bullet games from the last 6 months. Include them?");
    const post = page.waitForResponse((r) => r.url().endsWith("/api/train/weakness/recompute") && r.request().method() === "POST");
    await page.getByTestId("weakness-include-bullet").click();
    const res = await post;
    expect(res.status()).toBe(202);
    expect(res.request().postDataJSON()).toMatchObject({ timeClasses: expect.arrayContaining(["BULLET", "BLITZ"]) });
    // The worker builds it from the games it has already graded: the page turns ready on its own (the socket's
    // weakness:ready, or the fallback poll), without a reload.
    await expect(root(page)).toHaveAttribute("data-status", /computing|ready/, { timeout: 10_000 });
    await expect(page.getByTestId("weakness-see-profile").or(page.getByTestId("weakness-headline")).first()).toBeVisible({ timeout: 180_000 });
    const after = await tr5(page.request);
    expect(after.status).toBe("ready");
    expect(after.scope.timeClasses).toContain("BULLET");
    expect(after.games.analysed).toBe(26);
    await telemetry.expect("weakness_include_bullet_clicked", { bullet_games: 20 }, { count: 1 });
    await telemetry.expect("weakness_recompute_clicked", { from: "bullet_offer", result: "ok" }, { count: 1 });
    // The user-room push the specs use reaches this member only (its own room): a no-op progress on a ready page.
    expect(await devEmit(page, "weakness:progress", { v: 1, pct: 100, step: "compare", etaSec: 0, stalled: false, analysed: 26, target: 26, importDone: null, importTotal: null })).toBeGreaterThanOrEqual(0);
  });
});
