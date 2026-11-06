// The ndjson journal (phase-02 plan 7.6), filesystem only: a new file starts with `open` (format version) and a
// snapshot that folds back to the session's progress; lines are fsynced in batches; a torn last line is skipped; a
// newer format is reported unreadable; finished games are deleted 1 h after the commit and any file after 24 h; the
// lines of a game still in `waiting` are not written.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, existsSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JOURNAL_VERSION, createGame, foldJournal, progressFromJournal, restoreGame, type ServerGame } from "@repo/game-core";
import { Journal, parseJournal, snapshotLines } from "../src/persist/journal";
import { SILENT_LOGGER, createMemoryMetrics } from "../src/ports";
import { INITIAL_FEN, ref } from "./helpers";

function game(moves: string[] = []): ServerGame {
  const base = createGame(
    {
      ref: ref(),
      mode: "FRIEND",
      rated: false,
      tc: { initialMs: 300_000, incrementMs: 2_000 },
      startFen: INITIAL_FEN,
      studySeconds: 0,
      startKind: "initial",
      headerLeft: "",
      position: null,
      prefix: { sans: "", startMoveNo: 1, startsBlack: false },
      seats: {
        w: { ref: ref(), name: "w", avatarUrl: null, rating: null },
        b: { ref: ref(), name: "b", avatarUrl: null, rating: null },
      },
      rematchOf: null,
      createdAt: Date.now(),
    },
    Date.now(),
  );
  const r = restoreGame(
    { ...base, startKind: "initial", headerLeft: "", position: null, prefix: base.prefix, createdAt: base.createdAt } as never,
    { moves, clocksMs: moves.map((_, i) => 300_000 - i * 1000), phase: "playing", phaseEndsAt: null, clocks: { w: 290_000, b: 280_000, run: "w" }, savedAt: Date.now() },
    Date.now(),
    60_000,
  );
  assert.ok(r.ok);
  return { ...r.state, frozen: null, phase: "playing" };
}

const journal = (dir: string, now = () => Date.now()) =>
  new Journal({ dir, now, log: SILENT_LOGGER, metrics: createMemoryMetrics(), fsyncEveryMs: 5 });

describe("journal", () => {
  test("a new file: open (versioned) + snapshot; it folds back to the same plies, phase and clocks", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rc-j-"));
    const j = journal(dir);
    await j.init();
    const s = game(["e2e4", "e7e5", "g1f3"]);
    j.append({ ref: s.ref, state: s }, { t: "ply", n: 3, uci: "g1f3", san: "Nf3", clk: 298_000, spent: 1000, at: Date.now() });
    await j.sync();
    const lines = parseJournal(readFileSync(join(dir, `${s.ref}.ndjson`), "utf8"));
    assert.equal(lines[0]!.t, "open");
    assert.equal((lines[0] as { v: number }).v, JOURNAL_VERSION);
    const f = foldJournal(lines);
    assert.deepEqual(f.moves, ["e2e4", "e7e5", "g1f3"], "the duplicate ply line is ignored by the fold");
    assert.equal(f.phase, "playing");
    const p = progressFromJournal(f, 300_000);
    assert.equal(p.clocks.run, "b");
    await j.close();
  });

  test("waiting games are not journaled; snapshotLines carries draw cooldowns and the open offer", () => {
    const dir = mkdtempSync(join(tmpdir(), "rc-j-"));
    const j = journal(dir);
    const s = { ...game(), phase: "waiting" as const };
    j.append({ ref: s.ref, state: s }, { t: "pres", at: 1, side: "w", online: true });
    assert.equal(j.pendingLines, 0);
    const p = { ...game(["e2e4", "e7e5", "d2d4", "d7d5"]), drawOffer: { by: "w" as const, ply: 4 }, canOfferAtPly: { w: 0, b: 8 } };
    const f = foldJournal(snapshotLines(p, Date.now()));
    assert.deepEqual(f.drawOffer, { by: "w", ply: 4 });
    assert.deepEqual(f.canOfferAtPly, { w: 0, b: 8 });
  });

  test("readAll: a torn last line is skipped; a newer version is unreadable", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rc-j-"));
    const a = ref();
    const b = ref();
    writeFileSync(join(dir, `${a}.ndjson`), `${JSON.stringify({ t: "open", v: 1, at: 1, ref: a, startFen: INITIAL_FEN, tc: null, colors: { w: null, b: null }, studyS: 0 })}\n{"t":"ply","n":1,"uci":"e2e4","san":"e4","clk":null,"spent":0,"at":2}\n{"t":"ply","n":2,"uc`);
    writeFileSync(join(dir, `${b}.ndjson`), `${JSON.stringify({ t: "open", v: JOURNAL_VERSION + 1, at: 1 })}\n`);
    writeFileSync(join(dir, "../escape.ndjson"), "x");
    const files = await journal(dir).readAll();
    const fa = files.find((f) => f.ref === a)!;
    assert.equal(fa.readable, true);
    assert.deepEqual(foldJournal(fa.lines).moves, ["e2e4"]);
    assert.equal(files.find((f) => f.ref === b)!.readable, false);
  });

  test("cleanup: committed games after 1 h, any file after 24 h, never a live one", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rc-j-"));
    let now = Date.now();
    const j = journal(dir, () => now);
    await j.init();
    const done = game(["e2e4"]);
    j.append({ ref: done.ref, state: done }, { t: "end", at: now, method: "resignation", winner: "w", ply: 1 });
    await j.sync();
    j.committed(done.ref, now);
    await j.sync();
    const old = ref();
    const live = ref();
    for (const r of [old, live]) writeFileSync(join(dir, `${r}.ndjson`), "{}\n");
    const dayAgo = (now - 25 * 3600_000) / 1000;
    utimesSync(join(dir, `${old}.ndjson`), dayAgo, dayAgo);
    utimesSync(join(dir, `${live}.ndjson`), dayAgo, dayAgo);
    assert.equal(await j.cleanup(new Set([live])), 1, "only the 24 h old file that nobody writes");
    assert.ok(existsSync(join(dir, `${done.ref}.ndjson`)), "kept for 1 h after the commit");
    now += 3600_000 + 1;
    assert.equal(await j.cleanup(new Set([live])), 1);
    assert.ok(!existsSync(join(dir, `${done.ref}.ndjson`)));
    assert.ok(existsSync(join(dir, `${live}.ndjson`)));
    // Lines after the commit (rematch offers) are not journaled.
    j.append({ ref: done.ref, state: done }, { t: "rematch", at: now, by: "w", what: "offered" });
    assert.equal(j.pendingLines, 0);
    await j.close();
  });

  test("a restored file is continued (appended), any other is rewritten with a snapshot", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rc-j-"));
    const s = game(["d2d4"]);
    const path = join(dir, `${s.ref}.ndjson`);
    writeFileSync(path, "STALE\n");
    const j = journal(dir);
    j.append({ ref: s.ref, state: s }, { t: "pres", at: 1, side: "w", online: true });
    await j.sync();
    assert.ok(!readFileSync(path, "utf8").includes("STALE"), "rewritten");
    await j.close();
    const s2 = game(["d2d4"]);
    const path2 = join(dir, `${s2.ref}.ndjson`);
    writeFileSync(path2, "KEEP\n");
    const j2 = journal(dir);
    j2.continueFile(s2.ref);
    j2.append({ ref: s2.ref, state: s2 }, { t: "pres", at: 1, side: "w", online: true });
    await j2.sync();
    const text = readFileSync(path2, "utf8");
    assert.ok(text.startsWith("KEEP\n") && text.includes('"pres"'), "appended");
    appendFileSync(path2, "");
    await j2.close();
  });
});
