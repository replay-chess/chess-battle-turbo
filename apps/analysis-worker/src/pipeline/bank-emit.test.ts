// P5's `bankAdded` / `bankDue` on the analysis events (phase-05 plan §7.4, §7.6; interface check §0.3): read from the
// final batch's own rows, carried by `analysis:done` (per member) and the coalesced `analysis:batch`; null after a
// lost response (the batch committed earlier, its rows are unknown) and with J1 off; and never a separate
// `mistakes:added` or `bank:due_changed` on the analysis path. The SQL itself is extract-mistakes.int.test.ts.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mockGradeInput } from "@repo/chess-analysis/fixtures/labels/design-mock";
import { JOB_PRIORITY } from "@repo/contracts/internal/jobs";
import { AnalysisBatchEvent, AnalysisDoneEvent } from "@repo/contracts/socket/analysis";
import type { Row, Statement } from "../db/client";
import { harness } from "../testing/pipeline-harness";
import type { MemGameInit } from "../testing/memory-store";
import type { GameMember } from "./types";

const UCI = mockGradeInput("GAME").replay.uci;
const W: GameMember = { color: "w", userId: "11", userRef: "cuserwhite00000000000001", result: "LOSS" };
const B: GameMember = { color: "b", userId: "12", userRef: "cuserblack00000000000001", result: "WIN" };
const BANK = { enabled: true, lineNodes: 10_000 };

const game = (id = "1", ref = "cgamereference0000000001"): MemGameInit => ({
  id,
  ref,
  moves: [...UCI],
  members: [W, B],
  completedAtMs: Date.UTC(2026, 10, 11, 17, 59),
});

/** The rows a committed batch would return for the bank statements (white: 2 review + 1 new due, plies 32 and 36). */
function bankRows(s: Statement): Row[] {
  if (s.text.includes("array_agg(mo.ply")) return [{ userId: "11", plies: [32, 36] }];
  if (s.text.includes('AS "dueReview"'))
    return [
      { userId: "11", dueReview: 2, dueNew: 1, total: 5, bankReviewed: 0, newIntroduced: 0 },
      { userId: "12", dueReview: 0, dueNew: 0, total: 0, bankReviewed: 0, newIntroduced: 0 },
    ];
  if (s.text.includes("INSERT INTO training_cards")) return [{ userId: "11", cardsAdded: 2, themes: 2 }];
  return [];
}

describe("analysis events carry the bank values of the final batch", () => {
  it("analysis:done per member, from the batch's own rows; no separate bank event", async () => {
    const h = await harness({ bank: BANK, watched: ["cgamereference0000000001"] });
    h.store.extensionRows = bankRows;
    h.addGame(game());
    h.enqueue("1", "cgamereference0000000001");
    assert.equal(await h.run(), "done");
    const finish = h.store.writes.find((w) => w.kind === "finish") as { extensions: number } | undefined;
    assert.ok(finish && finish.extensions >= 3, "the bank statements rode in the final batch");
    const done = h.sent("analysis:done");
    const white = AnalysisDoneEvent.parse(done.find((d) => d.userRefs[0] === W.userRef)!.data);
    assert.deepEqual(white.bankAdded, { count: 2, plies: [32, 36] });
    assert.equal(white.bankDue, 3);
    assert.equal(white.bank, null, "P3's reserved field stays null");
    const black = AnalysisDoneEvent.parse(done.find((d) => d.userRefs[0] === B.userRef)!.data);
    assert.deepEqual(black.bankAdded, { count: 0, plies: [] });
    assert.equal(black.bankDue, 0);
    assert.equal(h.sent("mistakes:added").length, 0);
    assert.equal(h.sent("bank:due_changed").length, 0);
    const extracted = h.events.events.filter((e) => e.event === "mistakes_extracted");
    assert.equal(extracted.length, 2, "one mistakes_extracted per member side");
    assert.deepEqual(h.events.refused, [], "the event passes the registry schema and the PII guard");
  });

  it("a background analysis puts them on the member's analysis:batch frame", async () => {
    const h = await harness({ bank: BANK });
    h.store.extensionRows = bankRows;
    h.addGame(game());
    h.enqueue("1", "cgamereference0000000001", { priority: JOB_PRIORITY.BACKLOG });
    assert.equal(await h.run(), "done");
    const frames = h.sent("analysis:batch");
    const white = AnalysisBatchEvent.parse(frames.find((f) => f.userRefs[0] === W.userRef)!.data);
    assert.equal(white.bankAdded, 2);
    assert.equal(white.bankDue, 3);
    assert.equal(h.sent("analysis:done").length, 0);
  });

  it("null after a lost response (the batch committed in an earlier attempt)", async () => {
    const h = await harness({
      bank: BANK,
      watched: ["cgamereference0000000001"],
      wrapStore: (s) =>
        Object.assign(Object.create(Object.getPrototypeOf(s)) as typeof s, s, {
          finish: async (w: Parameters<typeof s.finish>[0]) => {
            await s.finish(w);
            return null;
          },
        }),
    });
    h.store.extensionRows = bankRows;
    h.addGame(game());
    h.enqueue("1", "cgamereference0000000001");
    assert.equal(await h.run(), "done");
    for (const d of h.sent("analysis:done")) {
      const ev = AnalysisDoneEvent.parse(d.data);
      assert.equal(ev.bankAdded, null);
      assert.equal(ev.bankDue, null);
    }
    assert.equal(h.events.events.filter((e) => e.event === "mistakes_extracted").length, 0, "telemetry only from rows");
  });

  it("with J1 off: no bank statement, null on the event", async () => {
    const h = await harness({ bank: { enabled: false, lineNodes: 10_000 }, watched: ["cgamereference0000000001"] });
    h.store.extensionRows = bankRows;
    h.addGame(game());
    h.enqueue("1", "cgamereference0000000001");
    assert.equal(await h.run(), "done");
    const finish = h.store.writes.find((w) => w.kind === "finish") as { extensions: number };
    assert.equal(finish.extensions, 0);
    const ev = AnalysisDoneEvent.parse(h.sent("analysis:done")[0]!.data);
    assert.equal(ev.bankAdded, null);
    assert.equal(ev.bankDue, null);
  });
});
