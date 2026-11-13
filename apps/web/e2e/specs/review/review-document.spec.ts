// The review screens are part of the document's shell, never a streamed Suspense segment (P3 plan §4.1–4.6).
//
// regression: the bot-game duplicate (CI 43211562326, 43226863882, 43438531034; e2e/specs/game/bot-resume-starved-
// frames.spec.ts). A screen inside a Suspense boundary (the route's loading.tsx, a lazy or next/dynamic piece that
// renders on the server) streams as a hidden `<div id="S:n">` that React's `$RV` reveals on an animation frame; when
// an update during hydration makes React client-render that boundary first, the server's copy stays in the document,
// hidden, until a frame runs: two copies of every test id. /review/[ref], its complete, legend and share pages had
// the same boundaries as /game/[ref] (their loading.tsx files, the lazy menu, counts table and stepper), so their
// documents are checked the same way: the screen's root in the shell, no test id inside any streamed segment.
import type { Page } from "@playwright/test";
import { DEVICES, expect, test } from "./_lib/review";

/** The document's HTML before the first streamed segment, and each segment's own HTML. */
async function documentParts(page: Page, path: string): Promise<{ status: number; shell: string; segments: { id: string; html: string }[] }> {
  const res = await page.request.get(path, { headers: { accept: "text/html" } });
  const html = await res.text();
  const marker = '<div hidden id="S:';
  const first = html.indexOf(marker);
  const segments = first < 0 ? [] : html.slice(first + marker.length).split(marker).map((part) => ({ id: `S:${part.slice(0, part.indexOf('"'))}`, html: part.split("<script")[0]! }));
  return { status: res.status(), shell: first < 0 ? html : html.slice(0, first), segments };
}

test.describe("review documents", { tag: ["@p3", "@smoke"] }, () => {
  test.use(DEVICES["desktop-1440"]);

  test("review, complete, legend and share render their screen in the shell, with nothing streamed after it", async ({ member, page, seeded }) => {
    test.setTimeout(180_000);
    await member("A");
    const pages = [
      { path: `/review/${seeded.GAME}`, root: "review-screen" },
      { path: `/review/${seeded.GAME}/complete`, root: "review-complete" },
      { path: `/review/${seeded.LEGEND}/legend`, root: "compare-screen" },
      { path: `/review/${seeded.GAME}/share`, root: "share-screen" },
    ];
    for (const p of pages) {
      const doc = await documentParts(page, p.path);
      expect(doc.status, p.path).toBe(200);
      expect(doc.shell, `${p.path}: the screen is in the document's shell`).toContain(`data-testid="${p.root}"`);
      const streamed = doc.segments.filter((s) => s.html.includes("data-testid=")).map((s) => s.id);
      expect(streamed, `${p.path}: no part of the screen streams as a hidden segment`).toEqual([]);
    }
  });
});
