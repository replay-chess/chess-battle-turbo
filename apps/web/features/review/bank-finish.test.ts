// Regression: first-add-finish-race (browser pass, staging 8bc24d3). The member ticked "Add this position to my Mistake
// Bank" on a game whose side was never extracted, saw no toast for a few seconds, and pressed Finish Review: Finish
// waited only for the A5 batches, so A7 counted the bank before the A6 switch had answered ("nothing added to your
// Mistake Bank"), and the switch's own toast and rollback were mutate() callbacks that TanStack drops once the
// review unmounts (or once a newer switch was sent). Now the switch is a review write Finish waits for, and its answer is
// handled by the mutation itself, mounted or not.
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { MutationObserver } from "@tanstack/react-query";
import type { MomentBankResponse } from "@repo/contracts/http/review";
import { makeQueryClient } from "@/lib/api/query-client";
import { momentBankMutationOptions, type MomentBankToggleInput } from "@/lib/api/mutations/review";
import { runFinish } from "./useMomentWalkthrough";
import { settleReviewProgress, trackReviewWrite } from "./useReviewProgressSync";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const CARD: MomentBankResponse = { ply: 2, inBank: true, card: { ref: "m_abc", dueAt: "2026-11-15T02:30:00.000Z", dueLabel: "Today" } };

/** fetch stub: each A6 PATCH waits for `release()`, then answers `status` (200 with CARD, else an error envelope). */
function slowA6(log: string[], status = 200) {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((r) => (release = r));
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(url), "http://localhost").pathname;
    log.push(`${init?.method} ${path}`);
    await gate;
    log.push(`answered ${path}`);
    if (status === 200) return new Response(JSON.stringify({ data: CARD }), { status: 200, headers: { "content-type": "application/json" } });
    return new Response(JSON.stringify({ error: { code: "internal", message: "Something went wrong" } }), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return () => release();
}

/** The toggle's mutation as MomentBankToggle builds it, subscribed like a mounted component; returns `unmount`. */
function mountToggle(ref: string, log: string[]) {
  const qc = makeQueryClient();
  const observer = new MutationObserver(
    qc,
    momentBankMutationOptions(qc, ref, {
      track: (settled) => trackReviewWrite(ref, settled),
      onSuccess: (res, input) => log.push(`toast added (ply ${input.ply}, ${res.card?.dueLabel})`),
      onError: (_e, input: MomentBankToggleInput) => log.push(`rollback ply ${input.ply} to ${!input.inBank}; toast failed`),
    }),
  );
  const unsubscribe = observer.subscribe(() => undefined);
  return {
    toggle: (input: MomentBankToggleInput) => void observer.mutate(input).catch(() => undefined),
    unmount: unsubscribe,
    meta: observer.options.meta,
  };
}

describe("A6 switch and Finish Review", () => {
  it("Finish pressed while a slow first add is on the wire: A7 waits for A6, and the switch still answers after the review unmounts", async () => {
    const log: string[] = [];
    const release = slowA6(log);
    const t = mountToggle("r-race", log);
    t.toggle({ ply: 2, inBank: true });
    await new Promise((r) => setImmediate(r));
    const finished = runFinish("r-race", {
      flush: () => undefined,
      settle: () => settleReviewProgress("r-race"),
      complete: async () => void log.push("A7"),
      navigate: () => {
        log.push("navigate");
        t.unmount(); // the review screen goes away with the route change
      },
    });
    await new Promise((r) => setTimeout(r, 30));
    assert.deepEqual(log, ["PATCH /api/review/r-race/moments/2"], "A7 is not sent while A6 is on the wire");
    release();
    await finished;
    assert.deepEqual(log, ["PATCH /api/review/r-race/moments/2", "answered /api/review/r-race/moments/2", "toast added (ply 2, Today)", "A7", "navigate"]);
  });

  it("a switch that fails after the member left still rolls back and toasts once (no generic 'Failed to save changes')", async () => {
    const log: string[] = [];
    const release = slowA6(log, 500);
    const t = mountToggle("r-gone", log);
    assert.deepEqual(t.meta, { errorUi: "inline" }, "the switch shows its own error toast; the global one stays off");
    t.toggle({ ply: 6, inBank: true });
    await new Promise((r) => setImmediate(r));
    t.unmount(); // moved to the next moment, or left the review
    release();
    await settleReviewProgress("r-gone");
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(log, ["PATCH /api/review/r-gone/moments/6", "answered /api/review/r-gone/moments/6", "rollback ply 6 to false; toast failed"]);
  });
});
