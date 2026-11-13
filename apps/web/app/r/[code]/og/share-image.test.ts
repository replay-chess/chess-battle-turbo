// regression: og-addcachetag-void. `/r/<code>/og` answered 500 for every live share on Vercel: the runtime's
// `addCacheTag` returned undefined and the route called `.catch` on it. The handler runs here for a live share with a
// Vercel request context whose addCacheTag returns undefined (as the dev deployment's did), through the real
// @vercel/functions export, and must render the 1200×630 PNG; the generic card for a revoked code is unchanged.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import * as React from "react";
import type { ShareSnapshotV1 } from "@repo/db/json";
import type { PublicShare } from "@/lib/services/analysis/share";
import { shareImageResponse, tagForCdn } from "./share-image";

const SNAPSHOT = {
  v: 1,
  startFen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
  moves: "e2e4 e7e5 g1f3 b8c6 f1c4 g8f6",
  j: "kkkkXI",
  players: { w: { name: "knightowl88", rating: 1184, isYou: true }, b: { name: "Opponent", rating: 1203, isYou: false } },
  accuracy: { you: 85.4, opp: 89.2 },
  result: "0-1",
  endLabel: "0–1 resigned",
  tcLabel: "Rapid 10+0",
  playedOn: "2026-11-09",
  summary: ["You played at 85 accuracy; your opponent at 89."],
  moment: { ply: 4, judgement: 12, arrow: ["f1", "e2"], caption: "Key moment: 3.Bc4." },
} as unknown as ShareSnapshotV1;

// tsconfig has jsx: "preserve", so tsx compiles the cards' JSX to React.createElement (classic runtime).
(globalThis as { React?: typeof React }).React = React;

const LIVE: PublicShare = { state: "ok", code: "0117sq2m", snapshot: SNAPSHOT, imageVersion: 1, expiresAt: null };
const CONTEXT = Symbol.for("@vercel/request-context");
const PUBLIC = fileURLToPath(new URL("../../../../public", import.meta.url));

describe("/r/<code>/og (share image)", () => {
  const tags: string[] = [];
  const realFetch = globalThis.fetch;
  const g = globalThis as unknown as Record<symbol, unknown>;

  before(() => {
    // The Vercel runtime's request context, with an addCacheTag that returns undefined (not a Promise).
    g[CONTEXT] = { get: () => ({ addCacheTag: (tag: string) => void tags.push(tag) }) };
    // satori fetches the piece and badge images from the site origin: serve them from public/.
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      if (url.hostname === "localhost") {
        const body = await readFile(`${PUBLIC}${decodeURIComponent(url.pathname)}`);
        return new Response(new Uint8Array(body), { headers: { "content-type": url.pathname.endsWith(".svg") ? "image/svg+xml" : "image/png" } });
      }
      return realFetch(input, init);
    }) as typeof fetch;
  });
  after(() => {
    delete g[CONTEXT];
    globalThis.fetch = realFetch;
  });

  it("a live share renders the card (200 image/png) when the runtime's addCacheTag returns undefined", async () => {
    const res = await shareImageResponse("0117sq2m", false, { load: async () => LIVE, now: () => Date.parse("2026-11-13T10:00:00Z") });
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /^image\/png/);
    const png = Buffer.from(await res.arrayBuffer());
    assert.equal(png.subarray(1, 4).toString("latin1"), "PNG");
    assert.equal(png.readUInt32BE(16), 1200);
    assert.equal(png.readUInt32BE(20), 630);
    assert.deepEqual(tags, ["share:0117sq2m"]);
  });

  it("?download=1 is the same image as an attachment", async () => {
    const res = await shareImageResponse("0117sq2m", true, { load: async () => LIVE });
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-disposition") ?? "", /^attachment/);
    await res.arrayBuffer();
  });

  it("a revoked code is the generic card and tags nothing", async () => {
    tags.length = 0;
    const res = await shareImageResponse("2ftsphrf", false, { load: async () => ({ state: "gone", code: "2ftsphrf" }) });
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /^image\/png/);
    await res.arrayBuffer();
    assert.deepEqual(tags, []);
  });

  it("tagForCdn settles on a void return, a rejection and a sync throw", async () => {
    await tagForCdn("t", () => undefined);
    await tagForCdn("t", () => Promise.reject(new Error("no")));
    await tagForCdn("t", () => {
      throw new Error("no");
    });
  });
});
