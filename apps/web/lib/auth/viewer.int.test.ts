/**
 * The raw viewer statement against a real Postgres after `prisma migrate deploy` (plan §12.1): one row with the
 * chess.com ratings through the LEFT JOIN, the same row by id (the provisioning re-read), no row for an unknown
 * googleId; P4 (phase-04 §7.2): the onboarding columns, the linked accounts and the active run through the LATERALs.
 * A renamed or dropped column fails here, not in production.
 *
 * Skipped unless TEST_DATABASE_URL is set: Docker in CI; locally a throwaway container or the Neon dev branch
 * (it creates and deletes one throwaway user). Never production.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { PrismaClient } from "@repo/db";
import { VIEWER_COLUMNS, queryViewerRecord, readViewerRecordById, toViewer } from "./viewer";

const url = process.env.TEST_DATABASE_URL;

describe("viewer statement (Postgres)", { skip: url ? false : "TEST_DATABASE_URL not set" }, () => {
  let db: PrismaClient;
  const run = Date.now().toString(36);
  const googleId = `user_viewerint_${run}`;
  const email = `viewer-int-${run}@example.test`;
  let userId: bigint;

  before(async () => {
    db = new PrismaClient({ datasourceUrl: url });
    const user = await db.user.create({
      data: {
        googleId,
        email,
        name: "Viewer Int",
        code: run.slice(-6).toUpperCase().padStart(6, "V"),
        subscriptionId: `sub_viewerint_${run}`,
        subscriptionStatus: "past_due",
        currentPeriodEnd: new Date(Date.now() + 30 * 3_600_000),
        dodoCustomerId: `cus_viewerint_${run}`,
        chessComProfile: { create: { chessComHandle: `viewerint_${run}`, blitzRating: 1184, rapidRating: 1320 } },
      },
      select: { id: true },
    });
    userId = user.id;
  });

  after(async () => {
    await db.user.deleteMany({ where: { email } });
    await db.$disconnect();
  });

  it("one row with the profile ratings, every column typed as the record says", async () => {
    const record = await queryViewerRecord(db, googleId);
    assert.ok(record);
    for (const column of VIEWER_COLUMNS) assert.ok(column in record, column);
    assert.equal(record.id, userId);
    assert.equal(typeof record.id, "bigint");
    assert.equal(record.role, "USER");
    assert.equal(record.isActive, true);
    assert.equal(record.gamesVersion, 0);
    assert.ok(record.currentPeriodEnd instanceof Date);
    assert.equal(record.subscriptionSourceAt, null);
    assert.equal(record.blitzRating, 1184);
    assert.equal(record.rapidRating, 1320);

    const v = toViewer(record, { now: new Date(), paywallEnabled: true, catalog: {} });
    assert.equal(v.user.ratingLabel, "Blitz 1184");
    assert.equal(v.entitlement.state, "grace");
    assert.equal(v.entitlement.paymentIssue?.state, "last_day");
  });

  it("the provisioning re-read (VIEWER_SELECT by id) returns the same row", async () => {
    const raw = await queryViewerRecord(db, googleId);
    const byId = await readViewerRecordById(db, userId);
    assert.deepEqual(byId, raw);
  });

  it("P4: onboarding columns, the linked accounts (link order) and the newest active run, one statement", async () => {
    await db.$executeRawUnsafe(
      `UPDATE users SET "onboardingStep" = 'GOALS', goals = '{STOP_BLUNDERING,LEARN_OPENINGS}', "timeZone" = 'Asia/Kolkata', "ratingBand" = 'R800_1200' WHERE id = $1::bigint`,
      userId.toString(),
    );
    const now = new Date();
    const accounts = await db.$queryRawUnsafe<{ id: bigint }[]>(
      `INSERT INTO linked_accounts ("userId", provider, "externalId", username, "usernameLower", "importState", "lastSyncAt", "updatedAt")
       VALUES ($1::bigint, 'CHESSCOM', '9001', 'Knight_${run}', 'knight_${run}', 'RUNNING', $2::timestamptz AT TIME ZONE 'UTC', now()),
              ($1::bigint, 'LICHESS', 'li${run}', 'Li_${run}', 'li_${run}', 'IDLE', NULL, now())
       RETURNING id`,
      userId.toString(),
      now.toISOString(),
    );
    await db.$executeRawUnsafe(
      `INSERT INTO import_runs ("referenceId", "userId", "linkedAccountId", provider, trigger, status, phase, imported, total, "updatedAt")
       VALUES ($1, $2::bigint, $3::bigint, 'CHESSCOM', 'INITIAL', 'RUNNING', 'saving', 212, 480, now())`,
      `cviewerint${run}`.padEnd(25, "0").slice(0, 25),
      userId.toString(),
      accounts[0]!.id.toString(),
    );
    const record = await queryViewerRecord(db, googleId);
    assert.equal(record?.onboardingStep, "GOALS");
    assert.deepEqual(record?.goals, ["STOP_BLUNDERING", "LEARN_OPENINGS"]);
    assert.equal(record?.timeZone, "Asia/Kolkata");
    assert.equal(record?.ratingBand, "R800_1200");
    assert.equal(record?.linkedAccounts.length, 2);
    assert.equal(record?.linkedAccounts[0]?.provider, "CHESSCOM");
    assert.equal(record?.linkedAccounts[0]?.lastSyncAt?.toISOString(), now.toISOString());
    assert.equal(record?.linkedAccounts[1]?.lastSyncAt, null);
    assert.deepEqual(record?.importRun, {
      referenceId: `cviewerint${run}`.padEnd(25, "0").slice(0, 25),
      provider: "CHESSCOM",
      status: "RUNNING",
      phase: "saving",
      imported: 212,
      total: 480,
    });
    assert.deepEqual(await readViewerRecordById(db, userId), record);
    await db.$executeRawUnsafe(`DELETE FROM linked_accounts WHERE "userId" = $1::bigint`, userId.toString());
  });

  it("no row for an unknown googleId; a user without a profile has null ratings", async () => {
    assert.equal(await queryViewerRecord(db, `user_nobody_${run}`), null);
    await db.chessComProfile.deleteMany({ where: { userId } });
    const record = await queryViewerRecord(db, googleId);
    assert.equal(record?.blitzRating, null);
    assert.equal(record?.rapidRating, null);
  });
});
