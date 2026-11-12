// The /r/[code] route (plan §4.4, §5.5, AP-47; FIX-2: a route handler answering plain HTML). Checked on the source
// where Next's static analysis decides (the cache exports must be literals, a dynamic API anywhere would turn the cache
// off), and on the output where the HTML decides (masking, escaping, the island's size, no framework script).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { SHARE_REVALIDATE_SEC } from "@repo/contracts/http/share";
import type { ShareSnapshotV1 } from "@repo/db/json";
import { esc, islandScript, noticePage, scriptJson, sharePage } from "./html";
import { shareViewOf } from "./share-view";

const here = (f: string) => readFileSync(fileURLToPath(new URL(f, import.meta.url)), "utf8");

const SNAPSHOT: ShareSnapshotV1 = {
  v: 1,
  startFen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
  moves: "e2e4 e7e5 g1f3 b8c6 f1c4 g8f6",
  j: "kkkkXI",
  players: {
    w: { name: `knight<owl>"88"`, rating: 1184, isYou: true },
    b: { name: "Opponent", rating: 1203, isYou: false },
  },
  accuracy: { you: 85.4, opp: 89.2 },
  result: "0-1",
  endLabel: "0–1 resigned",
  tcLabel: "Rapid 10+0",
  playedOn: "2026-11-09",
  summary: ["You played at 85 accuracy; your opponent at 89.", "</script><script>alert(1)</script>"],
  moment: { ply: 4, judgement: 12, arrow: ["f1", "e2"], caption: "Key moment: 3.Bc4. A blunder & a <lesson>." },
} as unknown as ShareSnapshotV1;

const ISLAND = { sink: false, posthogKey: null, appEnv: "test" };

describe("/r/[code] route", () => {
  const route = here("./route.ts");

  it("caches like the page did: hourly, no prerendered codes, force-static", () => {
    assert.match(route, new RegExp(`export const revalidate = ${SHARE_REVALIDATE_SEC};`));
    assert.match(route, /export const dynamic = "force-static";/);
    assert.match(route, /export const dynamicParams = true;/);
    assert.match(route, /export function generateStaticParams\(\): \{ code: string \}\[\] \{\s*return \[\];/);
  });

  it("never reads headers, cookies or flags", () => {
    for (const f of ["./route.ts", "./html.ts", "./island.ts", "./board-svg.ts", "./share-view.ts", "./share-css.ts"]) {
      const src = here(f);
      assert.doesNotMatch(src, /from "next\/headers"/, f);
      assert.doesNotMatch(src, /getFlags|useFlag|getViewer/, f);
    }
  });

  // regression: share-code-as-distinct-id (FIX-1). The render sent `share:<code>` as the PostHog distinct id.
  it("reports the page view under the constant anonymous id, never the code", () => {
    assert.match(route, /captureReviewServerEvent\("share_page_viewed",[^;]*ANONYMOUS_SERVER_DISTINCT_ID\)/s);
    assert.doesNotMatch(route, /`share:\$\{code\}`/);
  });

  // regression: share-page-lighthouse (FIX-2, review round 2): the React page loaded the root layout's JS (~265 kB
  // gzipped) and Lighthouse held it at 83–86 against G5's 95. The document now has one inline script, the island.
  it("one inline script (the island, ≤ 6 kB gzipped) and no framework or external script", () => {
    const html = sharePage(shareViewOf(SNAPSHOT), { image: "https://x.test/r/abcdefgh/og?v=1", island: ISLAND });
    const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
    assert.equal(scripts.filter((m) => !/type="application\/json"/.test(m[1]!)).length, 1);
    assert.doesNotMatch(html, /<script[^>]+src=/, "no external script");
    assert.doesNotMatch(html, /_next\/static/, "no Next runtime or chunk");
    const island = islandScript(ISLAND);
    assert.ok(gzipSync(island).length <= 6_000, `island ${gzipSync(island).length} B gzipped`);
    assert.doesNotMatch(island, /require\(|import\(|__webpack|_interop/, "self-contained");
    // It runs from its text alone (`__name` is tsx's keepNames helper; Next's SWC build emits none).
    assert.doesNotThrow(() => new Function("__name", "document", "window", island));
  });

  it("escapes every snapshot value (names, summary, caption) in the document and in the island's JSON", () => {
    const html = sharePage(shareViewOf(SNAPSHOT), { image: "https://x.test/r/abcdefgh/og?v=1", island: ISLAND });
    assert.doesNotMatch(html, /knight<owl>/);
    assert.match(html, /knight&lt;owl&gt;&quot;88&quot;/);
    assert.doesNotMatch(html, /<\/script><script>alert/);
    assert.match(html, /&lt;\/script&gt;&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.match(html, /A blunder &amp; a &lt;lesson&gt;\./);
    assert.equal(scriptJson({ a: "</script>" }), `{"a":"\\u003c/script\\u003e"}`);
    assert.equal(esc(`<a href="x">'&`), "&lt;a href=&quot;x&quot;&gt;&#39;&amp;");
  });

  it("the ok page: noindex, the share image, the testids the e2e and device suites read, the opening frame", () => {
    const view = shareViewOf(SNAPSHOT);
    const html = sharePage(view, { image: "https://x.test/r/abcdefgh/og?v=2", island: ISLAND });
    assert.match(html, /<meta name="robots" content="noindex, nofollow">/);
    assert.match(html, /<meta property="og:image" content="https:\/\/x.test\/r\/abcdefgh\/og\?v=2">/);
    for (const id of ["share-page", "share-nav", "share-body", "share-board", "share-stepper", "share-strip", "share-prev", "share-next", "share-position", "share-facts", "share-title", "share-accuracy", "share-moment", "share-summary", "share-signup", "share-badge", "share-arrow"]) {
      assert.match(html, new RegExp(`data-testid="${id}"`), id);
    }
    assert.match(html, /data-testid="share-page" data-state="ok"/);
    assert.match(html, new RegExp(`data-testid="share-stepper" data-index="${view.startIndex}"`));
    assert.match(html, /aria-current="true"/);
  });

  it("gone and not found: the same chrome around one notice, no script", () => {
    const gone = noticePage("gone");
    assert.match(gone, /data-state="gone"/);
    assert.match(gone, /data-testid="share-gone"/);
    assert.doesNotMatch(gone, /<script/);
    const nf = noticePage("not_found");
    assert.match(nf, /data-state="not_found"/);
    assert.match(nf, /data-testid="share-not-found"/);
    assert.match(nf, /<meta name="robots" content="noindex, nofollow">/);
  });
});
