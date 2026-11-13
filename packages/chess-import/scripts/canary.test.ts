// The provider canary, hermetic (phase-04 plan §12.5b): served from the import fixtures through a fake fetch, it
// passes on clean data, reads one earlier month when the current one is empty, and fails on a new field (strict
// schema), a game the mapper cannot read, a malformed NDJSON line and an upstream error. Serial per provider.
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import type { FetchLike } from "../src/http";
import { runCanary } from "./canary";

const FX = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../chess-fixtures/import");
const read = (rel: string) => readFileSync(path.join(FX, rel), "utf8");
const NOW = Date.UTC(2026, 9, 20, 3, 0, 0); // current month 2026/10

type Month = { games: Record<string, unknown>[] };
const october = (): Month => {
  const m = JSON.parse(read("chesscom/knightowl_88/2026-10.json")) as Month;
  const exp = JSON.parse(read("chesscom/knightowl_88/2026-10.expected.json")) as { games: { skip?: string }[] };
  // The canary treats parse_error as drift; the fixture month carries one deliberately (the fen-mismatch case).
  return { games: m.games.filter((_, i) => exp.games[i]!.skip !== "parse_error") };
};
const lichessLines = () =>
  read("lichess/knightowl88/games.ndjson")
    .split("\n")
    .filter((l) => l.startsWith('{"id":"Kn'))
    .slice(0, 5);

function fixtureFetch(over: { month?: (url: string) => Month | null; lines?: string[]; status?: number } = {}) {
  const urls: string[] = [];
  let active = 0;
  let maxActive = 0;
  const fetch: FetchLike = async (url) => {
    urls.push(url);
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((r) => setImmediate(r));
    try {
      const u = new URL(url);
      const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
      if (over.status) return new Response("", { status: over.status });
      if (u.pathname === "/pub/player/knightowl_88") return json(JSON.parse(read("chesscom/knightowl_88/profile.json")));
      if (u.pathname.endsWith("/stats")) return json(JSON.parse(read("chesscom/knightowl_88/stats.json")));
      if (u.pathname.endsWith("/games/archives")) return json(JSON.parse(read("chesscom/knightowl_88/archives.json")));
      const m = /\/games\/(\d{4})\/(\d{2})$/.exec(u.pathname);
      if (m) return json(over.month ? (over.month(url) ?? { games: [] }) : october());
      if (u.pathname === "/api/user/knightowl88") {
        const acct = JSON.parse(read("lichess/knightowl88/account.json")) as Record<string, unknown>;
        return json(acct);
      }
      if (u.pathname === "/api/games/user/knightowl88") return new Response(`${(over.lines ?? lichessLines()).join("\n")}\n`);
      return new Response("", { status: 404 });
    } finally {
      active -= 1;
    }
  };
  return {
    fetch,
    urls,
    get maxActive() {
      return maxActive;
    },
  };
}

const opts = (fetch: FetchLike) => ({
  chesscomUser: "knightowl_88",
  lichessUser: "knightowl88",
  fetch,
  nowMs: NOW,
  minIntervalMs: 0,
});

describe("runCanary", () => {
  it("passes on clean provider data, in strict mode, one request at a time per provider", async () => {
    const f = fixtureFetch();
    const report = await runCanary(opts(f.fetch));
    assert.equal(report.ok, true, JSON.stringify(report.checks.filter((c) => !c.ok)));
    assert.ok((report.games.chesscom.imported ?? 0) > 10);
    assert.equal(report.games.lichess.imported, 5);
    assert.equal(f.maxActive, 1, "the two providers run one after the other");
    assert.ok(f.urls.some((u) => u.endsWith("/games/2026/10")));
    const li = new URL(f.urls.find((u) => u.includes("/api/games/user/"))!);
    assert.equal(li.searchParams.get("max"), "5");
  });

  it("reads the newest earlier month when the current month is still empty", async () => {
    const f = fixtureFetch({ month: (url) => (url.endsWith("/2026/10") ? { games: [] } : october()) });
    const report = await runCanary(opts(f.fetch));
    assert.equal(report.ok, true);
    assert.ok(f.urls.some((u) => u.endsWith("/games/2026/09")));
  });

  it("fails on a new field (strict schema) and names only the field path", async () => {
    const f = fixtureFetch({
      month: () => {
        const m = october();
        m.games[0] = { ...m.games[0], brand_new_field: true };
        return m;
      },
    });
    const report = await runCanary(opts(f.fetch));
    assert.equal(report.ok, false);
    const bad = report.checks.find((c) => !c.ok)!;
    assert.equal(bad.step, "game schema (strict)");
    assert.match(bad.detail ?? "", /unrecognized_keys/);
  });

  it("fails on a game the mapper cannot read (parse_error)", async () => {
    // The fixture's fen-mismatch game, wherever the builder placed it.
    const broken = ["2026-08", "2026-09", "2026-10"].flatMap((m) => {
      const src = JSON.parse(read(`chesscom/knightowl_88/${m}.json`)) as Month;
      const exp = JSON.parse(read(`chesscom/knightowl_88/${m}.expected.json`)) as { games: { skip?: string }[] };
      return src.games.filter((_, i) => exp.games[i]!.skip === "parse_error");
    });
    assert.equal(broken.length, 1);
    const f = fixtureFetch({ month: () => ({ games: [...october().games, broken[0]!] }) });
    const report = await runCanary(opts(f.fetch));
    assert.equal(report.ok, false);
    assert.ok(report.checks.some((c) => c.step === "map game" && /parse_error/.test(c.detail ?? "")));
  });

  it("fails on a malformed NDJSON line and on an upstream error", async () => {
    const lines = lichessLines();
    lines.splice(2, 0, '{"id":"broken');
    const r1 = await runCanary(opts(fixtureFetch({ lines }).fetch));
    assert.equal(r1.ok, false);
    assert.ok(r1.checks.some((c) => c.provider === "lichess" && /malformed/.test(c.detail ?? "")));
    const r2 = await runCanary(opts(fixtureFetch({ status: 503 }).fetch));
    assert.equal(r2.ok, false);
    assert.ok(r2.checks.some((c) => c.provider === "chesscom" && /upstream 503/.test(c.detail ?? "")));
  });
});
