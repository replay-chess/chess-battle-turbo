// Bot adjudication (phase-02 plan 8.16, 11.2 rule 5, 12.6): a forged mate sent to POST /api/games/<ref>/complete is
// refused with 422 illegal_moves {reason: "claim_mismatch"}; the game stays IN_PROGRESS.
import { randomUUID } from "node:crypto";
import { expect, test } from "../../fixtures/games";
import { p2 } from "./tags";

test.describe("bot complete tamper", { tag: p2("@local-only") }, () => {
  test("a fake mate is refused", async ({ seat }) => {
    const me = await seat("G");
    const created = await me.page.request.post("/api/games", {
      data: { mode: "BOT", start: { kind: "initial" }, color: "w", botElo: 800, tc: { initialSeconds: 600, incrementSeconds: 0 } },
      headers: { "Idempotency-Key": randomUUID() },
    });
    expect(created.status(), await created.text()).toBe(201);
    const ref = ((await created.json()) as { data: { game: { ref: string } } }).data.game.ref;

    // 1.e4 e5 claimed as checkmate by White.
    const res = await me.page.request.post(`/api/games/${ref}/complete`, {
      data: {
        rev: 2,
        moves: ["e2e4", "e7e5"],
        clocksMs: [599_000, 599_000],
        result: "w",
        method: "checkmate",
        assists: { hints: 0, undos: 0 },
        endedAtClient: Date.now(),
      },
    });
    expect(res.status(), await res.text()).toBe(422);
    const body = (await res.json()) as { error?: { code?: string; details?: { reason?: string } } };
    expect(body.error?.code).toBe("illegal_moves");
    expect(body.error?.details?.reason).toBe("claim_mismatch");
    const snap = await me.page.request.get(`/api/games/${ref}`);
    expect(((await snap.json()) as { data: { snapshot: { status: string } } }).data.snapshot.status).toBe("IN_PROGRESS");
  });
});
