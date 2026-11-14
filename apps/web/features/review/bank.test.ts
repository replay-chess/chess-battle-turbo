// bank.ts: the optimistic A1 patch of the key-moment bank toggle (phase-05 plan §4.8, T3).
import assert from "node:assert/strict";
import { test } from "node:test";
import { reviewFixture } from "@repo/contracts/http/fixtures/review";
import type { ReviewDTO } from "@repo/contracts/http/review";
import { qk } from "@/lib/api/keys";
import { BANK_TOGGLE_COPY, BANK_TOGGLE_STALE_KEYS, momentCardOf, withMomentBank } from "./bank";

const dto = reviewFixture("done") as ReviewDTO;
const ply = dto.review!.moments[1]!.ply;

test("the patch replaces one moment's inBank and card, nothing else", () => {
  const off = withMomentBank(dto, ply, false, null);
  assert.notEqual(off, dto);
  assert.equal(off.review!.moments[1]!.inBank, false);
  assert.equal(off.review!.moments[1]!.card, null);
  assert.deepEqual(off.review!.moments[0], dto.review!.moments[0]);
  assert.equal(off.game, dto.game);
  const on = withMomentBank(off, ply, true, { ref: "m_Ab12", dueLabel: "tomorrow" });
  assert.deepEqual(on.review!.moments[1]!.card, { ref: "m_Ab12", dueLabel: "tomorrow" });
});

test("no change, an unknown ply or no review: the same object", () => {
  const same = withMomentBank(dto, ply, dto.review!.moments[1]!.inBank, dto.review!.moments[1]!.card ?? null);
  assert.equal(same, dto);
  assert.equal(withMomentBank(dto, 99_999, true, null), dto);
  assert.equal(withMomentBank({ ...dto, review: null }, ply, true, null).review, null);
});

test("copy and stale keys", () => {
  assert.equal(BANK_TOGGLE_COPY.added("tomorrow"), "Added to Mistake Bank · next review tomorrow");
  assert.equal(BANK_TOGGLE_COPY.added(null), "Added to Mistake Bank");
  assert.equal(BANK_TOGGLE_COPY.removed, "Removed from Mistake Bank");
  assert.deepEqual(momentCardOf({ card: { ref: "m_Ab12", dueAt: "2026-11-13T08:00:00.000Z", dueLabel: "tomorrow" } }), { ref: "m_Ab12", dueLabel: "tomorrow" });
  assert.equal(momentCardOf({ card: null }), null);
  assert.deepEqual(BANK_TOGGLE_STALE_KEYS, [qk.train.all(), qk.home(), qk.badges()]);
});
