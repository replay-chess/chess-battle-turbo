// Compare with the legend on real data (phase-03 plan §12.3 `legend-compare.spec.ts`; owner tests T13, T21). Member A's
// seeded legend games:
// - LEGEND (Morphy's Opera position, comparison READY): "You vs Morphy", the four tabs through keys 1–4, the Your Moves
//   table marks the split, Practice from Move 12 opens /practice at the position before the divergent move;
// - hovering the ⋯ "Compare" item on the review creates no job and sends no A9b (AP-09, T21);
// - LEGEND_KT (FACTS_READY, the game never analysed): the evals wait for the game's analysis and the page itself
//   queues nothing; opening the review analyses the game (A3), after which Compare shows the win chances with at most
//   one A9b (`pending_evals` resolves).
// Audio: the dev content has no narrated explanation for these positions on a CI database; the abort → audio_failed
// path is in demo/compare.demo.spec.ts.
import { blur, boardInView, clickUntil, DEVICES, expect, gotoOk, noDocumentScroll, openReview, retryUntil, test } from "./_lib/review";

/** The Opera position after 11…Nbd7 (White to play the divergent 12th move), board and side to move. */
const OPERA_BEFORE_12 = /^r3kb1r\/p2nqppp\/5n2\/1B2p1B1\/4P3\/1Q6\/PPP2PPP\/R3K2R w /;

test.describe("compare with the legend", { tag: ["@p3"] }, () => {
  test.use(DEVICES["desktop-1440"]);

  test(
    "READY: four tabs (1–4), the split, Practice from Move 12",
    { tag: ["@state:V3LegendCompare.state=default", ...["explanation", "your_moves", "legend_moves", "practice"].map((t) => `@state:V3LegendCompare.tab=${t}`), "@state:V3TryCompare.default"] },
    async ({ member, page, seeded, telemetry }) => {
      test.setTimeout(240_000);
      await member("A");
      await gotoOk(page, `/review/${seeded.LEGEND}/legend`);
      const screen = page.getByTestId("compare-screen");
      await expect(screen).toBeVisible({ timeout: 120_000 });
      await expect(page.getByTestId("compare-title")).toHaveText("You vs Morphy");
      await telemetry.expect("legend_compare_opened", { status: "ready" }, { source: "client" });
      await boardInView(page, "compare-board");
      await noDocumentScroll(page);

      await blur(page);
      await retryUntil(
        () => page.keyboard.press("2"),
        () => expect(screen).toHaveAttribute("data-tab", "your_moves", { timeout: 2_000 }),
      );
      await expect(page.getByTestId("compare-split-divider").first()).toHaveText("Paths split here");
      await telemetry.expect("compare_tab_viewed", { tab: "your_moves", comparison_status: "ready" }, { source: "client" });
      await page.keyboard.press("3");
      await expect(screen).toHaveAttribute("data-tab", "legend_moves");
      await page.keyboard.press("1");
      await expect(screen).toHaveAttribute("data-tab", "explanation");
      await page.keyboard.press("4");
      await expect(screen).toHaveAttribute("data-tab", "practice");
      const from = page.getByTestId("compare-practice-from");
      await expect(from).toHaveText("Practice from Move 12");
      await from.click();
      await page.waitForURL(/\/practice\?game=[a-z0-9]+&ply=\d+&from=compare/, { timeout: 60_000 });
      await expect(page.getByTestId("practice-board")).toHaveAttribute("data-fen", OPERA_BEFORE_12, { timeout: 60_000 });
      await telemetry.expect("practice_started", { from: "compare" }, { source: "client" });
    },
  );

  test("hovering ⋯ Compare on the review queues nothing (no job, no A9b)", async ({ member, page, reviewDb, seeded }) => {
    test.setTimeout(180_000);
    await member("A");
    // LEGEND is seeded unanalysed, so opening its review enqueues it (A3 on mount, by design): the baseline is taken
    // once that analysis is done, and only what the hover itself causes is counted. Jobs are matched by creation time,
    // not by a before/after diff of the game's jobs: another Playwright worker's seed fixture may rewrite LEGEND
    // meanwhile (regression: compare-hover-baseline).
    await openReview(page, seeded.LEGEND);
    await expect(page.getByTestId("review-screen")).toHaveAttribute("data-status", "done", { timeout: 90_000 });
    await clickUntil(page.getByTestId("review-menu").filter({ visible: true }).first(), () =>
      expect(page.getByTestId("menu-compare")).toBeVisible({ timeout: 2_000 }),
    );
    const since = (await reviewDb.$queryRaw<{ at: Date }[]>`SELECT CURRENT_TIMESTAMP::timestamp AS at`)[0]!.at;
    const posts: string[] = [];
    page.on("request", (r) => {
      if (r.method() === "POST") posts.push(new URL(r.url()).pathname);
    });
    await page.getByTestId("menu-compare").hover();
    await page.waitForTimeout(1_500);
    expect(posts.filter((p) => p.startsWith("/api/review/"))).toEqual([]);
    const jobs = await reviewDb.$queryRaw<{ kind: string; status: string }[]>`
      SELECT j.kind::text AS kind, j.status::text AS status
        FROM jobs j JOIN games g ON g.id = j."gameId"
       WHERE g."referenceId" = ${seeded.LEGEND} AND j."createdAt" >= ${since}`;
    expect(jobs).toEqual([]);
    await page.getByTestId("menu-compare").click();
    await page.waitForURL(new RegExp(`/review/${seeded.LEGEND}/legend`), { timeout: 60_000 });
    await expect(page.getByTestId("compare-screen")).toBeVisible({ timeout: 60_000 });
  });

  test(
    "FACTS_READY: evals wait for the analysis; once it is done, exactly one A9b → compare:ready → the win chances",
    { tag: ["@state:V3LegendCompare.state=loading"] },
    async ({ member, page, reviewDb, seeded }) => {
      test.setTimeout(300_000);
      await member("A");
      const computes: string[] = [];
      page.on("request", (r) => {
        if (r.method() === "POST" && r.url().includes("/legend/compute")) computes.push(r.url());
      });
      await gotoOk(page, `/review/${seeded.LEGEND_KT}/legend`);
      await expect(page.getByTestId("compare-screen")).toBeVisible({ timeout: 120_000 });
      await expect(page.getByTestId("compare-title")).toHaveText("You vs Kasparov");
      const status = async () =>
        (await reviewDb.$queryRaw<{ s: string }[]>`SELECT "analysisStatus"::text AS s FROM games WHERE "referenceId" = ${seeded.LEGEND_KT}`)[0]?.s;
      if ((await status()) !== "DONE") {
        await expect(page.getByTestId("compare-eval-pending")).toContainText("appear when the game’s analysis finishes");
        expect(computes).toEqual([]);
        await openReview(page, seeded.LEGEND_KT);
        await expect(page.getByTestId("review-screen")).toHaveAttribute("data-status", "done", { timeout: 180_000 });
      }
      expect(await status()).toBe("DONE");
      // regression: legend-compute-e2e (FIX-1): the analysis fills the evals in its pass 2, so this path never ran A9b.
      // Arrange the state pass 2 leaves when its 60 s budget runs out before the legend positions: the analysis DONE,
      // the comparison FACTS_READY with no evals, the divergence the member's. The page must then send exactly one
      // A9b, the worker's LEGEND_COMPARE job fills the evals, `compare:ready` arrives and the client refetches.
      await reviewDb.$executeRaw`
        UPDATE legend_comparisons lc
           SET status = 'FACTS_READY', facts = jsonb_set(lc.facts, '{evalAtDivergence}', 'null'::jsonb), attempts = 0,
               "updatedAt" = CURRENT_TIMESTAMP
          FROM games g
         WHERE g.id = lc."gameId" AND g."referenceId" = ${seeded.LEGEND_KT}`;
      const since = (await reviewDb.$queryRaw<{ at: Date }[]>`SELECT CURRENT_TIMESTAMP::timestamp AS at`)[0]!.at;
      computes.length = 0;
      await gotoOk(page, `/review/${seeded.LEGEND_KT}/legend`);
      await expect(page.getByTestId("compare-eval")).toContainText("Win chances after the split", { timeout: 180_000 });
      expect(computes).toHaveLength(1);
      const jobs = await reviewDb.$queryRaw<{ kind: string; status: string }[]>`
        SELECT j.kind::text AS kind, j.status::text AS status
          FROM jobs j JOIN games g ON g.id = j."gameId"
         WHERE g."referenceId" = ${seeded.LEGEND_KT} AND COALESCE(j."finishedAt", j."createdAt") >= ${since}`;
      // One LEGEND_COMPARE run (a new row, or the game's earlier compute row requeued by its dedupe key).
      expect(jobs).toEqual([{ kind: "LEGEND_COMPARE", status: "DONE" }]);
      const row = (
        await reviewDb.$queryRaw<{ status: string; evals: unknown }[]>`
          SELECT lc.status::text AS status, lc.facts->'evalAtDivergence' AS evals
            FROM legend_comparisons lc JOIN games g ON g.id = lc."gameId"
           WHERE g."referenceId" = ${seeded.LEGEND_KT}`
      )[0];
      expect(row?.status).toBe("READY");
      expect(row?.evals).not.toBeNull();
      // No second compute after the refetch that compare:ready triggered.
      await page.waitForTimeout(1_500);
      expect(computes).toHaveLength(1);
    },
  );
});
