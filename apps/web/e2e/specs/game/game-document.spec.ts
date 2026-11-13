// /game/[ref] puts the game screen in the document's shell, never in a streamed Suspense segment (bot and live).
//
// regression: CI runs 43211562326, 43226863882 and 43438531034 (webkit-iphone, bot-game.spec): a second, hidden copy of
// the game screen (`div[hidden]#S:2`) next to React's after a reload. The route's loading.tsx boundary and the lazy bot
// screen / move input streamed the screen as segments; when React client-rendered such a boundary before its reveal
// ran (the reveal waits for an animation frame), the server's copy stayed in the document. With the screen in the
// shell there is nothing to leave behind (bot-resume-starved-frames.spec.ts checks the page itself while frames are
// starved). This spec reads the documents: the board container is in the shell and no segment carries a test id.
import type { Page } from "@playwright/test";
import { createFriendGame, expect, seatLetters, test } from "../../fixtures/games";
import { p2 } from "./tags";

async function documentParts(page: Page, path: string) {
  const res = await page.request.get(path, { headers: { accept: "text/html" } });
  const html = await res.text();
  const marker = '<div hidden id="S:';
  const first = html.indexOf(marker);
  const segments = first < 0 ? [] : html.slice(first + marker.length).split(marker).map((part) => ({ id: `S:${part.slice(0, part.indexOf('"'))}`, html: part.split("<script")[0]! }));
  return { status: res.status(), shell: first < 0 ? html : html.slice(0, first), segments };
}

test.describe("game documents", { tag: p2("@smoke", "@local-only") }, () => {
  test("a bot game and a live game render their screen in the shell, with nothing streamed after it", async ({ seat }, testInfo) => {
    test.setTimeout(240_000);
    // N and O: the starved-frames spec's users (neither counts server events).
    const [letter] = seatLetters(testInfo, ["N"], ["O"]);
    const me = await seat(letter);
    await me.page.goto("/play", { timeout: 180_000 });
    await me.page.getByTestId("start-game-button").click();
    await me.page.waitForURL(/\/game\//, { timeout: 120_000 });
    const bot = new URL(me.page.url()).pathname;
    const live = `/game/${await createFriendGame(me)}`;
    for (const path of [bot, live]) {
      const doc = await documentParts(me.page, path);
      expect(doc.status, path).toBe(200);
      expect((doc.shell.match(/data-testid="game-board-container"/g) ?? []).length, `${path}: the board container is in the shell, once`).toBe(1);
      const streamed = doc.segments.filter((s) => s.html.includes("data-testid=")).map((s) => s.id);
      expect(streamed, `${path}: no part of the screen streams as a hidden segment`).toEqual([]);
    }
  });
});
