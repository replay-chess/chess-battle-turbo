// V3MoveBoard input contract (P2 plan §4.5.3, §13.1 row F) on /dev/ui/board, on the 4 UI projects:
// ui-desktop (Chromium), ui-iphone and ui-ipad (WebKit, touch), ui-android (Chromium, touch).
// Keyboard and the CPU-throttled drag trace run on Chromium only (F M6; CDP throttling is Chromium-only).
// Run against the shared dev server: DEVICES_BASE_URL=http://localhost:3000 npx playwright test -c playwright.devices.config.ts ui/board.spec.ts
import type { Locator, Page, TestInfo } from "@playwright/test";
import { ChessBoardHelper } from "../../fixtures/chess-board";
import { expectNoAxeViolations } from "../a11y";
import { expect, isChromium, isCoarse, test, waitForStable } from "../helpers";

async function gotoBoard(page: Page, query = "") {
  const res = await page.goto(`/dev/ui/board${query ? `?${query}` : ""}`);
  expect(res?.status(), "/dev/ui/board status").toBe(200);
  await waitForStable(page);
  await expect(page.locator(`[data-testid="chess-board"] [data-square]`)).toHaveCount(64);
}

const cell = (page: Page, sq: string): Locator => page.locator(`[data-testid="chess-board"] [data-square="${sq}"]`);
const lastEvent = (page: Page) => page.getByTestId("board-last-event");
const events = (page: Page) => page.getByTestId("board-events");

async function center(page: Page, sq: string) {
  const box = await cell(page, sq).boundingBox();
  if (!box) throw new Error(`no box for ${sq}`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** A real mouse drag (pointer events with pointerType mouse on every project). */
async function drag(page: Page, from: string, to: string, button: "left" | "right" = "left", modifiers: string[] = []) {
  const a = await center(page, from);
  const b = await center(page, to);
  for (const m of modifiers) await page.keyboard.down(m);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down({ button });
  await page.mouse.move(a.x + (b.x - a.x) / 4, a.y + (b.y - a.y) / 4, { steps: 3 });
  await page.mouse.move(b.x, b.y, { steps: 6 });
  await page.mouse.up({ button });
  for (const m of modifiers) await page.keyboard.up(m);
}

/** Click or tap (touch projects tap, so the touch → pointer path is covered too). */
async function press(page: Page, sq: string, testInfo: TestInfo) {
  if (testInfo.project.use.hasTouch) await cell(page, sq).tap();
  else await cell(page, sq).click();
}

const pieceAlt = (page: Page, sq: string) => cell(page, sq).locator("img").getAttribute("alt");

test.describe("V3MoveBoard @p2 @demo:V3MoveBoard", () => {
  test("keeps the e2e fixture selectors working (ChessBoardHelper)", async ({ page }) => {
    await gotoBoard(page);
    const board = page.getByTestId("chess-board");
    await expect(board).toHaveAttribute("data-size", "fill");
    const helper = new ChessBoardHelper(page);
    await helper.waitForBoard();
    await helper.waitForGameStarted();
    expect(await helper.detectPlayerColor()).toBe("w");
    expect(await helper.getCurrentTurn()).toBe("w");
    await helper.expectPieceOnSquare("e2");
    const [from, to] = await helper.playValidMove("w");
    await expect(lastEvent(page)).toHaveText(`move ${from}${to}`);
    await helper.expectPieceOnSquare(to);
    await helper.waitForTurn("b");
  });

  test("click-click and tap-tap: dots on targets, corners on captures, slide on a click move", async ({ page }, testInfo) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await gotoBoard(page, "preset=castle");
    await press(page, "f3", testInfo);
    await expect(cell(page, "f3")).toHaveAttribute("data-selected", "");
    await expect(lastEvent(page)).toHaveText("select f3");
    await expect(cell(page, "g5").locator(".rounded-full")).toHaveCount(1);
    await expect(cell(page, "e5").locator('[style*="rgba(220, 80, 80"]')).toHaveCount(1);
    await expect(cell(page, "e5").locator(".rounded-full")).toHaveCount(0);
    // A second press on the selected piece deselects.
    await press(page, "f3", testInfo);
    await expect(lastEvent(page)).toHaveText("select null");
    await expect(page.locator(".rounded-full")).toHaveCount(0);

    await press(page, "f3", testInfo);
    await press(page, "e5", testInfo);
    await expect(lastEvent(page)).toHaveText("move f3e5");
    const knight = cell(page, "e5").locator("img");
    await expect(knight).toHaveAttribute("alt", "White knight");
    await expect(knight).toHaveAttribute("data-slide", "");
    await expect(cell(page, "f3").locator("img")).toHaveCount(0);
    await expect(cell(page, "f3")).toHaveAttribute("data-last", "");
    await expect(cell(page, "e5")).toHaveAttribute("data-last", "");
  });

  test("castling slides the rook; en passant removes the passed pawn", async ({ page }, testInfo) => {
    await gotoBoard(page, "preset=castle");
    await press(page, "e1", testInfo);
    await press(page, "g1", testInfo);
    await expect(lastEvent(page)).toHaveText("move e1g1");
    expect(await pieceAlt(page, "g1")).toBe("White king");
    expect(await pieceAlt(page, "f1")).toBe("White rook");
    await expect(cell(page, "h1").locator("img")).toHaveCount(0);

    await gotoBoard(page, "preset=enpassant");
    await press(page, "d5", testInfo);
    await expect(cell(page, "e6").locator(".rounded-full")).toHaveCount(1);
    await press(page, "e6", testInfo);
    await expect(lastEvent(page)).toHaveText("move d5e6");
    await expect(cell(page, "e5").locator("img")).toHaveCount(0);
    expect(await pieceAlt(page, "e6")).toBe("White pawn");
  });

  test("drag: lifts after 4 px, drops on a target without a slide, shakes back elsewhere", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await gotoBoard(page);
    // Lift: the piece follows the pointer at scale 1.06 above the other pieces.
    const a = await center(page, "g1");
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(a.x + 2, a.y - 2);
    await expect(cell(page, "g1")).not.toHaveAttribute("data-lift", "");
    await page.mouse.move(a.x + 10, a.y - 40, { steps: 4 });
    await expect(cell(page, "g1")).toHaveAttribute("data-lift", "");
    await expect(page.getByTestId("chess-board")).toHaveAttribute("data-dragging", "");
    await expect
      .poll(() => cell(page, "g1").locator("img").evaluate((el) => (el as HTMLElement).style.transform))
      .toContain("scale(1.06)");
    const b = await center(page, "f3");
    await page.mouse.move(b.x, b.y, { steps: 4 });
    await expect(cell(page, "f3")).toHaveAttribute("data-drop", "");
    await page.mouse.up();
    await expect(lastEvent(page)).toHaveText("move g1f3");
    const knight = cell(page, "f3").locator("img");
    await expect(knight).toHaveAttribute("alt", "White knight");
    await expect(knight, "a dropped piece lands without a slide").not.toHaveAttribute("data-slide", "");
    await expect(page.getByTestId("chess-board")).not.toHaveAttribute("data-dragging", "");

    // Black drags e7 to e4 (not a target): it shakes back and the parent hears about it.
    await drag(page, "e7", "e4");
    await expect(lastEvent(page)).toHaveText("illegal e7e4");
    await expect(cell(page, "e7").locator("img")).toHaveAttribute("data-shake", /^[ab]$/);
    expect(await pieceAlt(page, "e7")).toBe("Black pawn");
    await expect(cell(page, "e7").locator("img")).not.toHaveAttribute("data-shake", /./, { timeout: 2000 });
    await expect.poll(() => cell(page, "e7").locator("img").evaluate((el) => (el as HTMLElement).style.transform)).toBe("");

    // The pawn stays selected after the shake; a click on an enemy piece that is not a target is illegal too.
    await expect(cell(page, "e7")).toHaveAttribute("data-selected", "");
    await cell(page, "f3").click();
    await expect(lastEvent(page)).toHaveText("illegal e7f3");
  });

  test("promotion: the picker waits for a piece; Esc puts the pawn back; a pick sends it", async ({ page }, testInfo) => {
    await gotoBoard(page, "preset=promotion");
    await press(page, "b7", testInfo);
    await press(page, "b8", testInfo);
    const menu = page.getByRole("menu", { name: "Choose a promotion piece" });
    await expect(menu).toBeVisible();
    await expect(lastEvent(page)).toHaveText("promotion-open b7b8");
    await expect(menu.getByRole("menuitem")).toHaveCount(5);
    await expect(menu.getByRole("menuitem", { name: "Promote to queen" })).toBeFocused();
    await expect(page.getByTestId("board-status")).toHaveText("Choose a piece · Esc puts the pawn back");
    // The picker sits on the b-file, from the promotion square towards the centre.
    const mb = (await menu.boundingBox())!;
    const b8 = (await cell(page, "b8").boundingBox())!;
    expect(Math.abs(mb.x - b8.x)).toBeLessThan(2);
    expect(Math.abs(mb.y - b8.y)).toBeLessThan(2);

    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(lastEvent(page)).toHaveText("promotion-cancel");
    expect(await pieceAlt(page, "b7")).toBe("White pawn");
    await expect(cell(page, "b8").locator("img")).toHaveCount(0);

    // Drag onto the last rank this time, then pick a knight.
    await drag(page, "b7", "b8");
    await expect(menu).toBeVisible();
    await menu.getByRole("menuitem", { name: "Promote to knight" }).click();
    await expect(menu).toBeHidden();
    await expect(lastEvent(page)).toHaveText("move b7b8n");
    expect(await pieceAlt(page, "b8")).toBe("White knight");
  });

  test("promotion keys: Q R B N pick, the ESC item cancels", async ({ page }, testInfo) => {
    test.skip(!isChromium(testInfo), "keyboard steps run on Chromium (F M6)");
    await gotoBoard(page, "preset=promotion");
    await cell(page, "b7").click();
    await cell(page, "b8").click();
    const menu = page.getByRole("menu", { name: "Choose a promotion piece" });
    await menu.getByRole("menuitem", { name: "Esc, cancel promotion" }).click();
    await expect(menu).toBeHidden();
    await expect(lastEvent(page)).toHaveText("promotion-cancel");
    await cell(page, "b7").click();
    await cell(page, "b8").click();
    await page.keyboard.press("ArrowDown");
    await expect(menu.getByRole("menuitem", { name: "Promote to rook" })).toBeFocused();
    await page.keyboard.press("r");
    await expect(lastEvent(page)).toHaveText("move b7b8r");
  });

  test("premove: ghost and tinted squares; right-click and a click on its square cancel; it plays on the reply", async ({
    page,
  }, testInfo) => {
    await gotoBoard(page, "preset=premove&botDelay=0");
    await press(page, "e2", testInfo);
    await press(page, "e4", testInfo);
    await expect(lastEvent(page)).toHaveText("move e2e4");
    await expect(page.getByTestId("board-mover")).toHaveText("premove (w)");

    const queue = async () => {
      await press(page, "g1", testInfo);
      await press(page, "f3", testInfo);
      await expect(lastEvent(page)).toHaveText("premove g1f3");
      await expect(cell(page, "f3").locator('[data-mark="ghost"]')).toHaveAttribute("data-piece", "wn");
      await expect(cell(page, "g1")).toHaveAttribute("data-premove", "");
      await expect(cell(page, "f3")).toHaveAttribute("data-premove", "");
    };
    await queue();
    if (!testInfo.project.use.hasTouch) {
      const c = await center(page, "d4");
      await page.mouse.click(c.x, c.y, { button: "right" });
      await expect(lastEvent(page)).toHaveText("premove null");
      await expect(page.locator('[data-mark="ghost"]')).toHaveCount(0);
      await queue();
    }
    await press(page, "g1", testInfo);
    await expect(lastEvent(page)).toHaveText("premove null");
    await expect(page.locator("[data-premove]")).toHaveCount(0);

    await queue();
    await page.getByTestId("board-bot-move").click();
    await expect(events(page)).toContainText("bot a7a5");
    await expect(events(page)).toContainText("premove-played g1f3");
    expect(await pieceAlt(page, "f3")).toBe("White knight");
    await expect(page.locator('[data-mark="ghost"]')).toHaveCount(0);
  });

  test("check glow on the king; locked study board reports presses", async ({ page }, testInfo) => {
    await gotoBoard(page, "preset=check");
    await expect(cell(page, "e1")).toHaveAttribute("data-check", "");
    await expect(cell(page, "e1").locator('[data-mark="check"]')).toBeVisible();

    await gotoBoard(page, "preset=study");
    await expect(page.getByTestId("board-mover")).toHaveText("locked");
    await press(page, "e4", testInfo);
    await expect(lastEvent(page)).toHaveText("locked");
    await expect(page.getByTestId("board-status")).toHaveText("Moves are locked during the study phase.");
    await expect(page.locator(".rounded-full")).toHaveCount(0);
  });

  test("right-drag draws arrows (Shift red), right-click marks, a left click clears; arrows use the fixed viewBox", async ({
    page,
  }, testInfo) => {
    test.skip(!!testInfo.project.use.hasTouch, "right-drag is a mouse gesture; touch long-press has its own test");
    await gotoBoard(page, "preset=study");
    const svg = page.locator('[data-testid="chess-board"] svg.rc-bd-arrows');
    await expect(svg).toHaveAttribute("viewBox", "0 0 800 800");
    await drag(page, "e2", "e4", "right");
    await expect(svg.locator('[data-arrow="e2e4"][data-source="drawn"]')).toHaveCount(1);
    await drag(page, "g1", "f3", "right", ["Shift"]);
    const knight = svg.locator('[data-arrow="g1f3"] path');
    await expect(knight).toHaveAttribute("d", /^M \S+ \S+ L 650 550 L /);
    expect(await knight.evaluate((el) => getComputedStyle(el).stroke)).not.toBe(
      await svg.locator('[data-arrow="e2e4"] path').evaluate((el) => getComputedStyle(el).stroke),
    );
    // Drawing the same arrow again removes it.
    await drag(page, "e2", "e4", "right");
    await expect(svg.locator('[data-arrow="e2e4"]')).toHaveCount(0);
    const d5 = await center(page, "d5");
    await page.mouse.click(d5.x, d5.y, { button: "right" });
    await expect(cell(page, "d5").locator('[data-mark="hl"]')).toHaveCount(1);
    await cell(page, "a5").click();
    await expect(svg.locator("[data-arrow]")).toHaveCount(0);
    await expect(cell(page, "d5").locator('[data-mark="hl"]')).toHaveCount(0);
  });

  test("touch: long-press then drag draws an arrow while moves are locked", async ({ page }, testInfo) => {
    test.skip(!testInfo.project.use.hasTouch, "touch projects only");
    await gotoBoard(page, "preset=study");
    const a = await center(page, "e2");
    const b = await center(page, "e4");
    const board = page.getByTestId("chess-board");
    const init = { pointerType: "touch", pointerId: 7, isPrimary: true, bubbles: true, button: 0, buttons: 1 };
    await board.dispatchEvent("pointerdown", { ...init, clientX: a.x, clientY: a.y });
    await page.waitForTimeout(450);
    await board.dispatchEvent("pointermove", { ...init, clientX: (a.x + b.x) / 2, clientY: (a.y + b.y) / 2 });
    await board.dispatchEvent("pointermove", { ...init, clientX: b.x, clientY: b.y });
    await board.dispatchEvent("pointerup", { ...init, buttons: 0, clientX: b.x, clientY: b.y });
    await expect(page.locator('svg.rc-bd-arrows [data-arrow="e2e4"]')).toHaveCount(1);
  });

  test("keyboard: arrows move focus on the visual grid, Enter picks up and drops", async ({ page }, testInfo) => {
    test.skip(!isChromium(testInfo), "keyboard steps run on Chromium (F M6)");
    await gotoBoard(page);
    const grid = page.getByRole("grid", { name: "Board. You are White." });
    await expect(grid).toBeVisible();
    await expect(grid.getByRole("row")).toHaveCount(8);
    await expect(grid.getByRole("gridcell")).toHaveCount(64);
    await expect(page.locator('[data-square][tabindex="0"]')).toHaveCount(1);
    await cell(page, "a1").focus();
    await page.keyboard.press("ArrowUp");
    for (let i = 0; i < 4; i++) await page.keyboard.press("ArrowRight");
    await expect(cell(page, "e2")).toBeFocused();
    await expect(cell(page, "e2")).toHaveAttribute("aria-label", "e2, white pawn");
    // The focus ring is drawn by ::after (two-tone, visible on both square colours).
    expect(await cell(page, "e2").evaluate((el) => getComputedStyle(el, "::after").boxShadow)).toContain("inset");
    await page.keyboard.press("Enter");
    await expect(lastEvent(page)).toHaveText("select e2");
    await expect(cell(page, "e4")).toHaveAttribute("aria-describedby", /.+/);
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("ArrowUp");
    await expect(cell(page, "e4")).toHaveAttribute("aria-label", "e4, empty");
    await page.keyboard.press("Space");
    await expect(lastEvent(page)).toHaveText("move e2e4");
    await expect(cell(page, "e4")).toBeFocused();
    await expect(cell(page, "e4")).toHaveAttribute("aria-label", "e4, white pawn");
    // Esc drops a selection.
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("ArrowUp");
    await expect(cell(page, "e7")).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(lastEvent(page)).toHaveText("select e7");
    await page.keyboard.press("Escape");
    await expect(lastEvent(page)).toHaveText("select null");
  });

  test("text move entry: SAN and UCI, with the reason when refused", async ({ page }, testInfo) => {
    test.skip(await isCoarse(page), "desktop only (hidden on touch-first devices)");
    test.skip(!isChromium(testInfo), "keyboard steps run on Chromium (F M6)");
    await gotoBoard(page);
    const input = page.getByLabel("Type a move");
    await input.focus();
    await expect(input).toBeVisible();
    await input.fill("Nf3");
    await input.press("Enter");
    await expect(lastEvent(page)).toHaveText("move g1f3");
    await input.fill("e7e5");
    await input.press("Enter");
    await expect(lastEvent(page)).toHaveText("move e7e5");
    await input.fill("Ke3");
    await input.press("Enter");
    await expect(page.getByTestId("move-input").getByRole("status")).toHaveText("That move isn't legal: Ke3.");
  });

  test("flipped board: h1 at the top left, coordinates on the player's edges", async ({ page }) => {
    await gotoBoard(page, "orient=b");
    const first = page.locator("[data-square]").first();
    await expect(first).toHaveAttribute("data-square", "h1");
    await expect(page.getByRole("grid")).toHaveAttribute("data-orientation", "b");
    const coords = page.locator('[data-testid="chess-board"] .rc-bd-coords');
    await expect(coords.locator('[data-coord="h8"][data-kind="rank"]')).toHaveText("8");
    await expect(coords.locator('[data-coord="h8"][data-kind="file"]')).toHaveText("h");
    await expect(coords.locator('[data-kind="rank"]')).toHaveText(["1", "2", "3", "4", "5", "6", "7", "8"]);
    await page.getByTestId("board-flip").click();
    await expect(page.locator("[data-square]").first()).toHaveAttribute("data-square", "a8");
  });

  test("badges: the owner's icons with labels, inside the board on the edges", async ({ page }) => {
    await gotoBoard(page, "preset=badges");
    const board = page.getByTestId("chess-board");
    await expect(board.locator("[data-badge]")).toHaveCount(16);
    const mate = board.getByRole("img", { name: "Checkmated king" });
    await expect(mate.locator("img")).toHaveAttribute("src", "/board_icons/svg/checkmate_black.svg");
    await expect(board.getByRole("img", { name: "Winning king" }).locator("img")).toHaveAttribute("src", "/board_icons/svg/winner.svg");
    await expect(board.getByRole("img", { name: "Miss" }).locator("img")).toHaveAttribute("src", "/board_icons/svg/missed_win.svg");
    await expect(board.getByRole("img", { name: "Interesting" })).toHaveText("!?");
    const bb = (await board.boundingBox())!;
    for (const name of ["Excellent", "Draw", "Brilliant"]) {
      const b = (await board.getByRole("img", { name }).boundingBox())!;
      expect(b.x + b.width, `${name} inside on the right`).toBeLessThanOrEqual(bb.x + bb.width + 0.5);
      expect(b.y, `${name} inside at the top`).toBeGreaterThanOrEqual(bb.y - 0.5);
      expect(b.width / (bb.width / 8), `${name} is 34% of a square`).toBeGreaterThan(0.3);
    }
    // Thumb and MiniBoard render statically.
    await expect(page.getByTestId("chess-board-thumb")).toHaveAttribute("role", "img");
    await expect(page.getByTestId("mini-board")).toHaveCount(3);
  });

  test("board root: touch-action none, no callout, no selection; reduced motion snaps", async ({ page }, testInfo) => {
    await gotoBoard(page);
    const board = page.getByTestId("chess-board");
    const style = await board.evaluate((el) => {
      const cs = getComputedStyle(el);
      return {
        touchAction: cs.touchAction,
        // -webkit-touch-callout exists in iOS WebKit only; Playwright's WebKit build may not parse it.
        callout: CSS.supports("-webkit-touch-callout", "none") ? cs.getPropertyValue("-webkit-touch-callout") : "unsupported",
        userSelect: cs.userSelect || cs.getPropertyValue("-webkit-user-select"),
      };
    });
    expect(style.touchAction).toBe("none");
    expect(style.userSelect).toBe("none");
    expect(["none", "unsupported"]).toContain(style.callout);
    // The UI projects run with prefers-reduced-motion: reduce: moves are instant.
    await press(page, "e2", testInfo);
    await press(page, "e4", testInfo);
    await expect(lastEvent(page)).toHaveText("move e2e4");
    expect(await cell(page, "e4").locator("img").evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
    // Squares stay at least 44 px on phones (tap-tap is the primary path).
    const sq = (await cell(page, "a1").boundingBox())!;
    if (testInfo.project.use.hasTouch) expect(sq.width).toBeGreaterThanOrEqual(44);
  });

  for (const theme of ["light", "dark"] as const) {
    test(`axe: no violations (${theme})`, async ({ page }) => {
      await gotoBoard(page, "preset=badges");
      await cell(page, "e4").click();
      await expectNoAxeViolations(page, { include: '[data-testid="board-demo"]', theme });
      await gotoBoard(page, "preset=promotion");
      await cell(page, "b7").click();
      await cell(page, "b8").click();
      await expect(page.getByRole("menu")).toBeVisible();
      await expectNoAxeViolations(page, { include: '[data-testid="board-demo"]', theme });
    });
  }

  test("drag holds >= 50 fps and a drop paints within budget at 4x CPU throttle", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "ui-desktop", "CDP CPU throttling: desktop Chromium");
    await gotoBoard(page);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    try {
      const a = await center(page, "g1");
      const b = await center(page, "c6");
      // Pointer events are generated inside the page, one per frame, so the trace measures the board and
      // not the CDP round trip. The drag never re-renders React after the lift.
      const result = await page.evaluate(
        async ({ a, b }) => {
          const root = document.querySelector('[data-testid="chess-board"]') as HTMLElement;
          const init = { pointerId: 1, pointerType: "mouse", isPrimary: true, bubbles: true, button: 0, buttons: 1 };
          root.dispatchEvent(new PointerEvent("pointerdown", { ...init, clientX: a.x, clientY: a.y }));
          await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
          const frames: number[] = [];
          let mid = "";
          const duration = 1500;
          await new Promise<void>((resolve) => {
            const t0 = performance.now();
            const tick = (t: number) => {
              frames.push(t);
              const k = Math.min(1, (t - t0) / duration);
              const x = a.x + (b.x - a.x) * k + Math.sin(k * 40) * 12;
              const y = a.y + (b.y - a.y) * k;
              root.dispatchEvent(new PointerEvent("pointermove", { ...init, clientX: x, clientY: y }));
              if (!mid && k > 0.5) mid = (document.querySelector('[data-square="g1"] img') as HTMLElement | null)?.style.transform ?? "";
              if (t - t0 < duration) requestAnimationFrame(tick);
              else resolve();
            };
            requestAnimationFrame(tick);
          });
          root.dispatchEvent(new PointerEvent("pointerup", { ...init, buttons: 0, clientX: b.x, clientY: b.y }));
          const gaps = frames.slice(1).map((t, i) => t - frames[i]!);
          const elapsed = frames[frames.length - 1]! - frames[0]!;
          return {
            fps: ((frames.length - 1) * 1000) / elapsed,
            worst: Math.max(...gaps),
            long: gaps.filter((g) => g > 34).length,
            mid,
          };
        },
        { a, b },
      );
      testInfo.annotations.push({ type: "drag-fps", description: JSON.stringify(result) });
      console.log(`drag trace at 4x CPU: ${JSON.stringify(result)}`);
      expect(result.mid, "the piece followed the pointer").toContain("scale(1.06)");
      expect(result.fps, JSON.stringify(result)).toBeGreaterThanOrEqual(50);

      // Drop → painted (plan §12.8 budget 33 ms at 4x, a production build): pointerup on a target to the first
      // frame that shows the piece on its new square.
      const e2 = await center(page, "e2");
      const e4 = await center(page, "e4");
      const dropMs = await page.evaluate(
        async ({ a, b }) => {
          const root = document.querySelector('[data-testid="chess-board"]') as HTMLElement;
          const init = { pointerId: 2, pointerType: "mouse", isPrimary: true, bubbles: true, button: 0, buttons: 1 };
          root.dispatchEvent(new PointerEvent("pointerdown", { ...init, clientX: a.x, clientY: a.y }));
          for (let i = 1; i <= 6; i++) {
            await new Promise((r) => requestAnimationFrame(r));
            root.dispatchEvent(new PointerEvent("pointermove", { ...init, clientX: a.x, clientY: a.y + ((b.y - a.y) * i) / 6 }));
          }
          await new Promise((r) => requestAnimationFrame(r));
          const t0 = performance.now();
          root.dispatchEvent(new PointerEvent("pointerup", { ...init, buttons: 0, clientX: b.x, clientY: b.y }));
          for (;;) {
            await new Promise((r) => requestAnimationFrame(r));
            if (document.querySelector('[data-square="e4"] img')) return performance.now() - t0;
            if (performance.now() - t0 > 2000) return Infinity;
          }
        },
        { a: e2, b: e4 },
      );
      console.log(`drop to paint at 4x CPU: ${dropMs.toFixed(1)} ms`);
      testInfo.annotations.push({ type: "drop-paint-ms", description: dropMs.toFixed(1) });
      // next dev runs React's development build; the 33 ms budget applies to production builds (no DEVICES_BASE_URL).
      expect(dropMs).toBeLessThanOrEqual(process.env.DEVICES_BASE_URL ? 100 : 33);
    } finally {
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
    }
  });
});
