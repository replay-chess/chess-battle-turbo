// T7 (phase-02 plan 1.2, 8.4, 12.6): G-LOWTIME (0:15 + 0). After both first moves White's clock runs; under 10 s it
// shows tenths and `low_time`, then White flags: over_timeout_loss / over_timeout_win. The clock is the server's
// (never page.clock); the wait is the real 15 s.
import { byColor, expect, finishedSnapshot, startSeeded, test } from "../../fixtures/games";
import { gameTags, p2 } from "./tags";

test.describe("low time and flag", { tag: p2("@local-only") }, () => {
  test(
    "tenths under 10 s, then timeout",
    { tag: gameTags("state", ["low_time", "over_timeout_loss", "over_timeout_win"]) },
    async ({ seat, seedGame }) => {
      test.setTimeout(240_000);
      const a = await seat("K");
      const b = await seat("L");
      const g = await seedGame("G-LOWTIME", a, b);
      await startSeeded(a, b, g.ref);
      const s = await byColor(a, b);
      await s.w.move("e2e4");
      await s.b.move("e7e5");
      // White's clock now runs (15 s minus what the first move took).
      await s.w.waitPhase("low_time", 20_000);
      await expect(s.w.page.locator('[data-testid="clock-w"]:visible').first()).toHaveText(/^0:0\d\.\d$/, { timeout: 10_000 });
      await s.w.waitPhase("over_timeout_loss", 30_000);
      await s.b.waitPhase("over_timeout_win", 15_000);
      const snap = await finishedSnapshot(s.w, g.ref);
      expect(snap.result).toMatchObject({ method: "timeout", winner: "b" });
    },
  );

  test(
    "flag against a bare king is a draw",
    { tag: gameTags("state", ["over_timeout_insufficient"]) },
    async ({ seat, seedGame }) => {
      test.setTimeout(240_000);
      const a = await seat("M");
      const b = await seat("N");
      // G-INSUFF: White K+P vs a bare king, 0:20 + 0. White flags; Black cannot mate → draw.
      const g = await seedGame("G-INSUFF", a, b);
      await startSeeded(a, b, g.ref);
      const s = await byColor(a, b);
      await s.w.move("e1d1");
      await s.b.move("e5e4");
      await s.w.waitPhase("over_timeout_insufficient", 45_000);
      await s.b.waitPhase("over_timeout_insufficient", 15_000);
      expect((await finishedSnapshot(s.w, g.ref)).result?.method).toBe("timeout_vs_insufficient");
    },
  );
});
