// S2 Computing, stalled (phase-06 plan §12.4 `computing-stalled.spec.ts`, §8.13). Persona `weak-computing` (§6.8, real
// CC0 games: 12 graded, 13 queued). Server time 11 minutes on (x-rc-now): queued analyses and none finished for 10
// minutes → "Taking longer than usual…" and the bar stops animating. @p6
import { serverNowHeaders } from "../../fixtures/time";
import { DEVICES, expect, openWeakness, serverClock, test, tr5, weakStateTags } from "./_lib/weakness";

test.describe.configure({ mode: "serial" });
test.use({ ...DEVICES["desktop-1440"], timezoneId: "UTC" });

test.describe("weakness computing · stalled · desktop-1440@100", { tag: ["@p6", ...weakStateTags("computing")] }, () => {
  test("stalled: no graded game for 11 minutes", async ({ page, weak, baseURL }) => {
    test.setTimeout(600_000);
    await weak("weak-computing");
    const at = new Date(Date.now() + 11 * 60_000);
    const clock = await serverClock(page, baseURL!);
    clock.set(at);
    const res = await page.request.get("/api/train/weakness", { headers: serverNowHeaders(at) });
    expect(res.status()).toBe(200);
    const p = ((await res.json()) as { data: Awaited<ReturnType<typeof tr5>> }).data;
    expect(p.progress?.stalled, "queued analyses and none finished for 11 minutes").toBe(true);
    await openWeakness(page, "computing");
    await expect(page.getByTestId("weakness-computing")).toHaveAttribute("data-stalled", "");
    await expect(page.getByTestId("weakness-stalled")).toHaveText("Taking longer than usual. We’ll keep going in the background.");
    const animated = await page.getByTestId("weakness-progress-bar").evaluate((el) =>
      [...el.querySelectorAll("*")].some((c) => getComputedStyle(c).animationName !== "none" && getComputedStyle(c).animationPlayState !== "paused"),
    );
    expect(animated, "the bar stops animating").toBe(false);
  });
});
