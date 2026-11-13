/**
 * The onboarding DAL's statements against a real Postgres after `prisma migrate deploy` (phase-04 plan §7.2, §8.1):
 * the state read with its linked-accounts lateral, the monotonic step PATCH (a later step wins, an earlier one never
 * moves it back, a replay changes nothing), the enum arrays and casts, clearing the band with null, the zone, and the
 * complete write (onboarded, the first onboardedAt kept, step DONE).
 *
 * Skipped unless TEST_DATABASE_URL is set: Docker in CI; locally a throwaway container. Creates and deletes its own
 * throwaway users. Never production.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { PrismaClient } from "@repo/db";
import {
  completeOnboardingSql,
  levelBackHref,
  levelSuggestion,
  onboardingStateSql,
  patchOnboardingSql,
  runOnboardingWrite,
  toOnboardingState,
  type OnboardingStateRow,
} from "./onboarding";

const url = process.env.TEST_DATABASE_URL;

describe("onboarding statements (Postgres)", { skip: url ? false : "TEST_DATABASE_URL not set" }, () => {
  let db: PrismaClient;
  const run = Date.now().toString(36);
  const emails = [`onb-int-a-${run}@example.test`, `onb-int-b-${run}@example.test`];
  let userId: bigint;
  let otherId: bigint;

  const read = async (id: bigint) => {
    const rows = await db.$queryRaw<OnboardingStateRow[]>(onboardingStateSql(id));
    assert.equal(rows.length, 1);
    return toOnboardingState(rows[0]!);
  };

  before(async () => {
    db = new PrismaClient({ datasourceUrl: url });
    const mk = async (email: string, n: number) =>
      (
        await db.user.create({
          data: { googleId: `user_onbint_${run}_${n}`, email, name: "Onb Int", code: `${run.slice(-5).toUpperCase()}${n}`.padStart(6, "O") },
          select: { id: true },
        })
      ).id;
    userId = await mk(emails[0]!, 1);
    otherId = await mk(emails[1]!, 2);
  });

  after(async () => {
    await db.user.deleteMany({ where: { email: { in: emails } } });
    await db.$disconnect();
  });

  it("a new user reads as WELCOME with no answers, UTC and no links", async () => {
    const s = await read(userId);
    assert.equal(s.step, "WELCOME");
    assert.equal(s.onboarded, false);
    assert.equal(s.onboardedAt, null);
    assert.equal(s.ratingBand, null);
    assert.deepEqual(s.goals, []);
    assert.equal(s.dailyMinutes, null);
    assert.equal(s.timeZone, "UTC");
    assert.equal(s.pendingCheckoutAt, null);
    assert.deepEqual(s.accounts, []);
  });

  it("the step moves forward, never back; a replay changes nothing", async () => {
    let r = await runOnboardingWrite(db, patchOnboardingSql(userId, { step: "LINK", timeZone: "Asia/Kolkata" }));
    assert.equal(r?.view.step, "link");
    assert.equal(r?.timeZone, "Asia/Kolkata");
    r = await runOnboardingWrite(db, patchOnboardingSql(userId, { step: "GOALS" }));
    assert.equal(r?.view.step, "goals");
    r = await runOnboardingWrite(db, patchOnboardingSql(userId, { step: "LEVEL" }));
    assert.equal(r?.view.step, "goals", "an earlier step never moves it back");
    r = await runOnboardingWrite(db, patchOnboardingSql(userId, { step: "GOALS" }));
    assert.equal(r?.view.step, "goals", "a replay is a no-op");
    assert.equal(r?.timeZone, "Asia/Kolkata", "an absent zone keeps the stored one");
  });

  it("fields: the band (and clearing it with null), its source and rating, goals, minutes", async () => {
    let r = await runOnboardingWrite(
      db,
      patchOnboardingSql(userId, { step: "PLAN", ratingBand: "R800_1200", ratingBandSource: "chesscom:rapid", initialRating: 1184 }),
    );
    assert.equal(r?.view.ratingBand, "r800_1200");
    assert.equal(r?.view.ratingBandSource, "chesscom:rapid");
    assert.equal(r?.view.initialRating, 1184);
    r = await runOnboardingWrite(db, patchOnboardingSql(userId, { goals: ["STOP_BLUNDERING", "LEARN_OPENINGS"], dailyMinutes: 20 }));
    assert.deepEqual(r?.view.goals, ["stop_blundering", "learn_openings"]);
    assert.equal(r?.view.dailyMinutes, 20);
    assert.equal(r?.view.ratingBand, "r800_1200", "an absent band keeps the stored one");
    r = await runOnboardingWrite(db, patchOnboardingSql(userId, { ratingBand: null }));
    assert.equal(r?.view.ratingBand, null, "null clears it");
    r = await runOnboardingWrite(db, patchOnboardingSql(userId, { goals: [] }));
    assert.deepEqual(r?.view.goals, [], "an empty list is a value, not 'absent'");
    const other = await read(otherId);
    assert.equal(other.step, "WELCOME", "another user's row is untouched");
  });

  it("complete: onboarded, step DONE, the first onboardedAt kept on a repeat", async () => {
    const first = await runOnboardingWrite(db, completeOnboardingSql(userId));
    assert.equal(first?.view.done, true);
    assert.equal(first?.view.step, "done");
    assert.ok(first?.view.onboardedAt);
    const again = await runOnboardingWrite(db, completeOnboardingSql(userId, "Europe/London"));
    assert.equal(again?.view.onboardedAt, first?.view.onboardedAt);
    assert.equal(again?.timeZone, "Europe/London");
    const r = await runOnboardingWrite(db, patchOnboardingSql(userId, { step: "LINK" }));
    assert.equal(r?.view.step, "done", "a late step PATCH never reopens onboarding");
  });

  it("an unknown user id writes nothing", async () => {
    assert.equal(await runOnboardingWrite(db, patchOnboardingSql(-1n, { step: "LINK" })), null);
    assert.equal(await runOnboardingWrite(db, completeOnboardingSql(-1n)), null);
  });

  it("the state read carries the linked accounts (oldest first) with ratings; Level reads its suggestion from them", async () => {
    await db.$executeRaw`
      INSERT INTO linked_accounts ("userId", provider, "externalId", username, "usernameLower", ratings, "totalRatedGames", "verifiedAt", "updatedAt", "linkedAt")
      VALUES (${otherId}, 'CHESSCOM', ${`cc_${run}`}, 'KnightOwl_88', 'knightowl_88',
              '{"v":1,"rapid":{"rating":1184,"best":1243,"games":312},"blitz":{"rating":1032,"best":null,"games":141}}'::jsonb, 480, NULL,
              (now() AT TIME ZONE 'UTC'), (now() AT TIME ZONE 'UTC') - interval '1 minute'),
             (${otherId}, 'LICHESS', ${`li_${run}`}, 'DrNykterstein', 'drnykterstein', NULL, 12, (now() AT TIME ZONE 'UTC'),
              (now() AT TIME ZONE 'UTC'), (now() AT TIME ZONE 'UTC'))`;
    await runOnboardingWrite(db, patchOnboardingSql(otherId, { step: "LEVEL", ratingBand: "R800_1200", ratingBandSource: "chesscom:rapid", initialRating: 1184 }));
    const s = await read(otherId);
    assert.deepEqual(
      s.accounts.map((a) => [a.provider, a.username, a.status, a.verified, a.totalRatedGames]),
      [
        ["CHESSCOM", "KnightOwl_88", "ACTIVE", false, 480],
        ["LICHESS", "DrNykterstein", "ACTIVE", true, 12],
      ],
    );
    assert.deepEqual(s.accounts[0]!.ratings, { rapid: { rating: 1184, games: 312 }, blitz: { rating: 1032, games: 141 } });
    assert.equal(s.accounts[1]!.ratings, null);
    const suggestion = levelSuggestion(s);
    assert.equal(suggestion?.provider, "chesscom");
    assert.equal(suggestion?.band, "R800_1200");
    assert.equal(suggestion?.displayRating, 1184);
    assert.equal(levelBackHref(s), "/onboarding/confirm?provider=chesscom&u=KnightOwl_88");
  });
});
