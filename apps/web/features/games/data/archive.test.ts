import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { gameRowFixtures, gamesPageMetaFixture } from "@repo/contracts/http/fixtures/review";
import { GamesPageMeta } from "@repo/contracts/http/games";
import { qk } from "@/lib/api/keys";
import { patchRow } from "../model/rows";
import {
  ARCHIVE_MAX_PAGES,
  ARCHIVE_STALE_MS,
  archiveCountsKey,
  archiveCountsQuery,
  archiveListKey,
  archiveListQuery,
  fetchArchivePage,
  patchArchivePages,
  readPageMeta,
  rowsOf,
  sourceCountsOf,
  totalsOf,
  type ArchiveData,
} from "./archive";
import { trailingThrottle } from "./useArchiveLive";

const rows = gameRowFixtures();
const data = (): ArchiveData => ({
  pages: [
    { rows: rows.slice(0, 4), meta: gamesPageMetaFixture("first") },
    { rows: rows.slice(4), meta: gamesPageMetaFixture("last") },
  ],
  pageParams: [null, "WzEsIjIwMjYtMTEtMDVUMTI6MDA6MDAuMDAwWiIsIjQyIl0"],
});

describe("archive query options", () => {
  it("keys live under ['games', 'list'] and ['games', 'counts'], one per normalised filter", () => {
    assert.deepEqual(archiveListKey({ tc: ["blitz", "rapid"] }), qk.games.list({ tc: "blitz,rapid" }));
    assert.deepEqual(archiveCountsKey({}).slice(0, 2), ["games", "counts"]);
    assert.notDeepEqual(archiveCountsKey({ moments: true }), archiveCountsKey({}));
    assert.deepEqual(archiveCountsKey({ result: ["win"] }), archiveCountsKey({ result: ["win"] }));
  });

  it("the list is infinite, 60 s fresh, at most 10 pages, and pages by meta.nextCursor", () => {
    const o = archiveListQuery({ q: "tal" });
    assert.equal(o.staleTime, ARCHIVE_STALE_MS);
    assert.equal(ARCHIVE_STALE_MS, 60_000);
    assert.equal(o.maxPages, ARCHIVE_MAX_PAGES);
    assert.equal(o.initialPageParam, null);
    const next = (meta: GamesPageMeta) => {
      const page = { rows: [], meta };
      return o.getNextPageParam(page, [page], null, [null]);
    };
    assert.equal(next(gamesPageMetaFixture("first")), gamesPageMetaFixture("first").nextCursor);
    assert.equal(next(gamesPageMetaFixture("last")), undefined);
    assert.equal(archiveCountsQuery({}).staleTime, 60_000);
  });
});

describe("archive pages", () => {
  it("reads G1 meta: counts on page 1 only, nothing else trusted", () => {
    assert.deepEqual(readPageMeta(gamesPageMetaFixture("first")), gamesPageMetaFixture("first"));
    assert.deepEqual(readPageMeta(gamesPageMetaFixture("later")), { nextCursor: gamesPageMetaFixture("later").nextCursor });
    assert.deepEqual(readPageMeta(undefined), { nextCursor: null });
    assert.deepEqual(readPageMeta({ nextCursor: 3, counts: { all: "x" }, total: 9 }), { nextCursor: null });
    GamesPageMeta.parse(readPageMeta(gamesPageMetaFixture("first")));
  });

  it("flattens pages in order and takes totals from page 1", () => {
    assert.deepEqual(
      rowsOf(data()).map((r) => r.ref),
      rows.map((r) => r.ref),
    );
    assert.deepEqual(totalsOf(data()), { all: 37, filtered: 37 });
    assert.deepEqual(totalsOf(undefined), { all: null, filtered: null });
    assert.deepEqual(rowsOf(undefined), []);
  });

  it("patches one row in place and keeps every other object", () => {
    const before = data();
    const target = rows[5]!.ref;
    const after = patchArchivePages(before, target, (r) => patchRow(r, { analysisStatus: "done", accuracy: 77 }))!;
    assert.notEqual(after, before);
    assert.equal(after.pages[0], before.pages[0], "untouched page keeps its identity");
    assert.equal(after.pages[1]!.rows.find((r) => r.ref === target)!.accuracy, 77);
    assert.equal(patchArchivePages(before, "cnotinthecache0000000000000", (r) => patchRow(r, { accuracy: 1 })), before);
    assert.equal(patchArchivePages(undefined, target, (r) => r), undefined);
  });
});

describe("trailing throttle", () => {
  it("runs at once, then once at the end of the window for any number of calls", async () => {
    let now = 0;
    let calls = 0;
    const t = trailingThrottle(() => calls++, 50, () => now);
    t.call();
    assert.equal(calls, 1);
    now = 10;
    t.call();
    t.call();
    t.call();
    assert.equal(calls, 1);
    await new Promise((r) => setTimeout(r, 70));
    assert.equal(calls, 2);
    t.cancel();
  });

  it("cancel drops a pending trailing call", async () => {
    let calls = 0;
    const t = trailingThrottle(() => calls++, 30);
    t.call();
    t.call();
    t.cancel();
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(calls, 1);
  });
});

describe("fetchArchivePage through api()", () => {
  it("regression: archive-meta-dropped (FIX-1): a client fetch of page 1 keeps filteredTotal and the per-source counts", async () => {
    const meta = { nextCursor: null, filteredTotal: 46, counts: { all: 46, replay: 1, chesscom: 45, lichess: 0 } };
    const saved = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ data: [], meta }), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;
    try {
      const page = await fetchArchivePage({}, null);
      assert.deepEqual(page.meta, meta);
      const data: ArchiveData = { pages: [page], pageParams: [null] };
      assert.deepEqual(totalsOf(data), { all: 46, filtered: 46 });
      assert.deepEqual(sourceCountsOf(data), { replay: 1, chesscom: 45, lichess: 0 }, "the source tabs' counts survive a refetch");
    } finally {
      globalThis.fetch = saved;
    }
  });
});
