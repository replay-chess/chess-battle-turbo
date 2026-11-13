// Lichess in onboarding (phase-04 plan §12.4 `onboarding/lichess.spec.ts`; §7.3.4–7.3.5, D4-21). @p4 @local-only
//
// Connect Lichess → the mock's consent page → Approve (a username unique to the run: a verified Lichess account
// belongs to one member) → /onboarding/confirm?provider=lichess → That's Me → Level prefilled from the Lichess account
// (the Lichess offset applied); the callback revoked the token it obtained exactly once and stored none. Second run:
// Deny → back on Link with the `lichess_denied` copy. Projects: desktop-1440 and iphone (`@smoke`).
import {
  DEVICES,
  FAMILY_DEVICE,
  clickReady,
  expect,
  expectStep,
  gotoStep,
  lichessConsent,
  noDocumentScroll,
  skipOtherEngines,
  stage,
  stateTag,
  test,
  tid,
  uniqueLichess,
  userRow,
} from "./_lib/p04";

test.describe.configure({ mode: "serial" });

for (const family of ["desktop", "iphone"] as const) {
  test.describe(`lichess · ${family}`, () => {
    test.use(DEVICES[FAMILY_DEVICE[family]]);

    test(
      `approve → confirm → level prefilled; the token is revoked once (${family})`,
      { tag: ["@p4", "@local-only", "@smoke", stateTag(family, "confirm", "default"), stateTag(family, "level", "prefilled")] },
      async ({ page, leasePersona, telemetry, upstream, p4db }, testInfo) => {
        const skip = skipOtherEngines(testInfo, family);
        test.skip(skip !== null, skip ?? "");
        test.setTimeout(240_000);
        const me = await leasePersona("onboarding-fresh");
        const username = uniqueLichess("Owl", testInfo);
        telemetry.forbid(username);
        await gotoStep(page, "");
        await clickReady(page, "onb-get-started");
        await expectStep(page, "link");

        await clickReady(page, "onb-connect-lichess");
        await lichessConsent(page, { approve: true, username });
        await expect(page).toHaveURL(/\/onboarding\/confirm\?(.*&)?provider=lichess/, { timeout: 60_000 });
        await expect(stage(page, "confirm")).toHaveAttribute("data-state", "default", { timeout: 30_000 });
        await expect(tid(page, "onb-profile-card")).toContainText(username);
        await noDocumentScroll(page);
        expect(await upstream.revokesFor(username), "the callback revoked the token it obtained, once").toBe(1);
        // The link is verified (OAuth proves ownership) and no token is stored anywhere (D4-21).
        const [link] = await p4db.$queryRaw<{ verified: boolean; provider: string }[]>`
          SELECT la."verifiedAt" IS NOT NULL AS verified, la.provider::text AS provider
            FROM linked_accounts la JOIN users u ON u.id = la."userId" WHERE u.email = ${me.email}`;
        expect(link).toEqual({ verified: true, provider: "LICHESS" });

        await clickReady(page, "onb-thats-me");
        await expectStep(page, "level");
        await expect(stage(page, "level")).toHaveAttribute("data-state", "prefilled");
        await expect(tid(page, "onb-level-banner")).toContainText("From Lichess");
        expect((await userRow(p4db, me.email)).step).toBe("LEVEL");
        await telemetry.expect("account_linked", { provider: "lichess", context: "onboarding", is_verified: true }, { source: "server", distinctId: me.ref, count: 1 });
        await telemetry.expect("onb_link_lichess_clicked", {}, { source: "client" });
      },
    );

    test(
      `deny on Lichess → Link with the denied copy (${family})`,
      { tag: ["@p4", "@local-only", "@smoke", stateTag(family, "link", "lichess_denied")] },
      async ({ page, leasePersona, telemetry, upstream }, testInfo) => {
        const skip = skipOtherEngines(testInfo, family);
        test.skip(skip !== null, skip ?? "");
        test.setTimeout(180_000);
        await leasePersona("onboarding-fresh");
        const username = uniqueLichess("Deny", testInfo);
        await gotoStep(page, "");
        await clickReady(page, "onb-get-started");
        await expectStep(page, "link");
        await clickReady(page, "onb-connect-lichess");
        await lichessConsent(page, { approve: false, username });
        await expect(page).toHaveURL(/\/onboarding\/link\?(.*&)?lichess=denied/, { timeout: 60_000 });
        await expect(tid(page, "onb-lichess-denied")).toBeVisible();
        await expect(stage(page, "link")).toHaveAttribute("data-state", "lichess_denied");
        await noDocumentScroll(page);
        expect(await upstream.revokesFor(username), "no token was issued, so none is revoked").toBe(0);
        await telemetry.expect("onb_link_lichess_result", { result: "denied" }, { source: "client" });
      },
    );
  });
}
