// The J5 sampler (phase-06 plan §7.4.5 step 3): one side per game to the cell with fewer offers, seeded Algorithm-R
// reservoirs (deterministic, resumable from the serialised state, uniform), cell closing, and the dump's chunk order.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { zstdCompressSync } from "node:zlib";
import { frameStarts, gamesOfChunk, planChunks } from "./dump";
import { bandOf, type ScreenedSide } from "./pgn";
import { Sampler, allCellKeys, cellKey, fnv1a, subsample } from "./sampler";

const side = (color: "w" | "b", elo: number, band: string | null): ScreenedSide => ({ color, elo, band });
const item = (id: string) => ({ id, tc: "BLITZ" as const, headers: {}, movetext: "" });

describe("J5 sampler", () => {
  it("has the 57 cells 600–2400 × BULLET / BLITZ / RAPID", () => {
    const keys = allCellKeys();
    assert.equal(keys.length, 57);
    assert.ok(keys.includes("600:BULLET") && keys.includes("2400:RAPID"));
  });

  it("a game gives either open side by a bit of the id's hash, never by the cells' offers; no cell, no side", () => {
    const s = Sampler.fresh(10, 1);
    s.offer(item("a0000000"), [side("w", 1510, "1500"), side("b", 1490, "1400")]);
    const first = s.offers(cellKey("1500", "BLITZ")) === 1 ? "1500" : "1400";
    assert.equal(first, (fnv1a("a0000000") & 1) === 0 ? "1500" : "1400");
    // The same pairing again: the hash of the new id decides, whatever the cells have seen.
    s.offer(item("a0000000"), [side("w", 1510, "1500"), side("b", 1490, "1400")]);
    assert.equal(s.offers(cellKey(first, "BLITZ")), 2, "the same id gives the same side");
    assert.equal(s.offer(item("c0000000"), [side("w", 590, null), side("b", 2510, null)]), null);
    const only = s.offer(item("d0000000"), [side("w", 590, null), side("b", 700, "700")]);
    assert.equal(only, "700:BLITZ");
  });

  it("regression: baseline-opponent-mix-bias — each cell's opponents are the population's, not tilted by its neighbours", () => {
    // A symmetric population (ratings N(1500, 300), the opponent the player ± N(0, 120)): every band's true mean
    // opponent − player difference is near +0 to +40 (regression to the mean). The old "fewer offers" rule tilted the
    // samples by 50–90 points (1200: +88 against a true +17).
    let r = 12345;
    const rnd = () => ((r = (r * 1664525 + 1013904223) >>> 0) / 4294967296);
    const gauss = () => Math.sqrt(-2 * Math.log(rnd() || 1e-9)) * Math.cos(2 * Math.PI * rnd());
    const s = Sampler.fresh(500, 1);
    const pop = new Map<string, { n: number; d: number }>();
    for (let i = 0; i < 300_000; i++) {
      const a = Math.round(1500 + 300 * gauss());
      const b = Math.round(a + 120 * gauss());
      const [w, bl] = rnd() < 0.5 ? [a, b] : [b, a];
      const sides = [side("w", w, bandOf(w)), side("b", bl, bandOf(bl))];
      for (const sd of sides) {
        if (!sd.band) continue;
        const p = pop.get(sd.band) ?? { n: 0, d: 0 };
        p.n += 1;
        p.d += (sd.color === "w" ? bl : w) - sd.elo;
        pop.set(sd.band, p);
      }
      s.offer({ ...item(`g${i}`), headers: { WhiteElo: String(w), BlackElo: String(bl) } }, sides);
    }
    for (const band of ["1000", "1200", "1500", "1800", "2000"]) {
      const c = s.state.cells[cellKey(band, "BLITZ")]!;
      const sampled = c.items.reduce((d, it) => d + ((it.color === "w" ? Number(it.headers.BlackElo) : Number(it.headers.WhiteElo)) - it.elo), 0) / c.items.length;
      const truth = pop.get(band)!.d / pop.get(band)!.n;
      assert.ok(Math.abs(sampled - truth) < 15, `${band}: sampled ${sampled.toFixed(1)} vs population ${truth.toFixed(1)}`);
    }
  });

  it("is deterministic and resumes exactly from its serialised state", () => {
    const run = (cut: number | null) => {
      let s = Sampler.fresh(5, 42);
      for (let i = 0; i < 400; i++) {
        if (cut !== null && i === cut) s = new Sampler(JSON.parse(JSON.stringify(s.state)) as typeof s.state);
        s.offer(item(`g${String(i).padStart(7, "0")}`), [side("w", 1200 + (i % 7), "1200"), side("b", 1300, "1300")]);
      }
      return JSON.stringify(s.state);
    };
    assert.equal(run(null), run(null));
    assert.equal(run(173), run(null));
  });

  it("every offered side is equally likely to end in the reservoir (Algorithm R, 4 000 trials)", () => {
    const hits = new Array<number>(20).fill(0);
    for (let trial = 0; trial < 4000; trial++) {
      const s = Sampler.fresh(5, 1000 + trial);
      for (let i = 0; i < 20; i++) s.offer(item(String(i).padStart(8, "x")), [side("w", 1000, "1000")]);
      for (const it of s.state.cells[cellKey("1000", "BLITZ")]!.items) hits[Number(it.id.replace(/x/g, ""))]! += 1;
    }
    // Expected 4000 × 5 / 20 = 1000 per side; ±15 % is far outside chance.
    for (const [i, h] of hits.entries()) assert.ok(h > 850 && h < 1150, `side ${i}: ${h}`);
  });

  it("a closed cell takes no more offers; its games give their other side instead", () => {
    const s = Sampler.fresh(2, 7);
    for (let i = 0; i < 8; i++) s.offer(item(`a${i}aaaaaa`), [side("w", 1500, "1500")]);
    assert.deepEqual(s.closeFull(4, 9), ["1500:BLITZ"]);
    assert.ok(s.isClosed("1500:BLITZ"));
    const before = s.state.cells["1500:BLITZ"]!.items.map((x) => x.id);
    assert.equal(s.offer(item("zzzzzzzz"), [side("w", 1500, "1500"), side("b", 1600, "1600")]), "1600:BLITZ");
    assert.equal(s.offer(item("yyyyyyyy"), [side("w", 1500, "1500")]), null);
    assert.deepEqual(s.state.cells["1500:BLITZ"]!.items.map((x) => x.id), before);
    assert.equal(s.closeAll(10).length, 56);
  });

  it("subsample is a seeded permutation prefix", () => {
    const a = Array.from({ length: 50 }, (_, i) => i);
    assert.deepEqual(subsample(a, 10, 3), subsample(a, 10, 3));
    assert.deepEqual(subsample(a, 50, 3).sort((x, y) => x - y), a);
    assert.deepEqual(subsample(a, 10, 3), subsample(a, 20, 3).slice(0, 10));
  });

  it("chunks are visited in a seeded random order covering the file once", () => {
    const order = planChunks(10 * 96 + 5, 96, 20261017);
    assert.equal(order.length, 11);
    assert.deepEqual([...order].sort((a, b) => a - b), Array.from({ length: 11 }, (_, i) => i));
    assert.deepEqual(order, planChunks(10 * 96 + 5, 96, 20261017));
    assert.notDeepEqual(order, planChunks(10 * 96 + 5, 96, 1));
  });

  it("decodes the whole frames of a chunk, dropping the partial frames and games at its edges", async () => {
    const games = Array.from({ length: 30 }, (_, i) => `[Event "Rated Blitz game"]\n[Site "https://lichess.org/game/g${String(i).padStart(7, "0")}"]\n\n1. e4 e5 1-0\n\n`);
    const frames = [games.slice(0, 10), games.slice(10, 20), games.slice(20)].map((g) => zstdCompressSync(Buffer.from(g.join(""))));
    const all = Buffer.concat(frames);
    assert.deepEqual(frameStarts(all), [0, frames[0]!.length, frames[0]!.length + frames[1]!.length]);
    // A chunk that starts inside frame 0 and ends inside frame 2: only frame 1 decodes, minus its last game.
    const chunk = all.subarray(5, all.length - 5);
    const ids: string[] = [];
    const stats = await gamesOfChunk(chunk, (gs) => ids.push(...gs.map((g) => g.headers.Site!.slice(-8))));
    assert.deepEqual(ids, Array.from({ length: 9 }, (_, i) => `g${String(10 + i).padStart(7, "0")}`));
    assert.equal(stats.bytesIn, frames[1]!.length);
    assert.equal(stats.retries, 0);
  });
});
