// Bodies of the server-timer specs (phase-02 plan 12.6, testing X5). Each runs twice: `<name>.spec.ts` on the fast
// fixture socket (TIMING_PROFILE=fast, deadlines of 2–5 s) in every run, and `<name>.real.spec.ts` @slow on the app's
// socket with the real timings, nightly. Server timers are never faked with page.clock: the specs read the
// server-sent deadline (`firstMove.deadlineAt`, `graceEndsAt`) and wait for the state change.
import type { FixtureName } from "../../../scripts/dev/seed-game-fixtures";
import { expect, byColor, expectServerEvents, finishedSnapshot, startSeeded, type Seat } from "../../fixtures/games";
import type { Telemetry } from "../../fixtures/telemetry";

type Fixtures = {
  seat: (letter: string) => Promise<Seat>;
  seedGame: (name: FixtureName, white: Seat, black: Seat) => Promise<{ ref: string; id: bigint }>;
  telemetry: Telemetry;
};

/** The newest number at `key` in any frame the seat received (e.g. "deadlineAt", "graceEndsAt"). */
export function lastFrameNumber(seat: Seat, key: string): number | null {
  const re = new RegExp(`"${key}":(\\d+)`);
  const frames = seat.link.frames();
  for (let i = frames.length - 1; i >= 0; i--) {
    const m = re.exec(frames[i]!);
    if (m) return Number(m[1]);
  }
  return null;
}

/** First-move window (plan 8.3): nobody moves → aborted on both sides, `game_aborted{reason: timeout}` per player. */
export async function firstMoveAbort({ seat, seedGame, telemetry }: Fixtures, letters: [string, string], maxWaitMs: number) {
  const a = await seat(letters[0]);
  const b = await seat(letters[1]);
  const g = await seedGame("G-THREEFOLD", a, b);
  await startSeeded(a, b, g.ref);
  const s = await byColor(a, b);
  await s.w.waitPhase("abort");
  const deadline = lastFrameNumber(s.w, "deadlineAt");
  expect(deadline, "the server sent the first-move deadline").not.toBeNull();
  expect(deadline! - Date.now()).toBeLessThanOrEqual(maxWaitMs);
  await s.w.waitPhase("over_aborted", maxWaitMs + 15_000);
  await s.b.waitPhase("over_aborted", 15_000);
  // The copy names the real window even on the fast profile.
  await expect(s.w.page.getByTestId("game-result")).toContainText(/No first move within 30 s/i);
  await expect(s.w.page.getByTestId("game-result")).toContainText(/not rated/i);
  await finishedSnapshot(s.w, g.ref, "ABORTED");
  const events = await expectServerEvents(telemetry, "game_aborted", [a, b], 2, { reason: "timeout" });
  expect(events.map((e) => e.props.by).sort()).toEqual(["opponent", "self"]);
}

/** Reconnect grace (plan 8.6): B's network drops after two plies → A sees the toast and ring, then over_abandoned. */
export async function opponentOffline({ seat, seedGame }: Omit<Fixtures, "telemetry">, letters: [string, string], maxGraceMs: number) {
  const a = await seat(letters[0]);
  const b = await seat(letters[1]);
  const g = await seedGame("G-THREEFOLD", a, b);
  await startSeeded(a, b, g.ref);
  const s = await byColor(a, b);
  await s.w.move("e2e4");
  await s.b.move("e7e5");
  await s.w.waitPly(2);

  await s.b.context.setOffline(true);
  await s.b.link.setDown(true);
  await s.w.waitPhase("opp_disconnected", 30_000);
  await expect(s.w.page.getByTestId("game-toast")).toContainText(/disconnected\. They have \d+ seconds? to reconnect/i);
  await expect(s.w.page.getByTestId("zone-disc")).toBeVisible();
  const graceEndsAt = lastFrameNumber(s.w, "graceEndsAt");
  expect(graceEndsAt, "presence:update carried graceEndsAt").not.toBeNull();
  expect(graceEndsAt! - Date.now()).toBeLessThanOrEqual(maxGraceMs);
  await s.w.waitPhase("over_abandoned", maxGraceMs + 15_000);
  await expect(s.w.page.getByTestId("game-result")).toContainText(/left the game/i);
  const snap = await finishedSnapshot(s.w, g.ref);
  expect(snap.result).toMatchObject({ method: "abandoned", winner: "w" });
}
