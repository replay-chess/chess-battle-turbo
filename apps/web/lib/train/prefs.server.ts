// W8 `PATCH /api/train/prefs` (phase-05 plan §7.3 W8; consistency 10.5 a: the only writer of training prefs). One
// transaction: the time zone goes to `users."timeZone"` (P4's column; validated against the runtime's IANA list by
// the contract's TimeZone schema), the rest to the training profile (created with the seed when missing, only the
// fields present change). `newPerDay` above the cap (after merging with the stored row) is 400
// `new_per_day_above_cap`. A `dayStartHour` change applies from the next local day (today's row keeps its key); a
// `releaseHour` change re-snaps nothing retroactively.
import { Prisma } from "@repo/db";
import type { TrainPrefs, TrainPrefsPatch } from "@repo/contracts/http/train";
import type { Viewer } from "@/lib/auth/viewer";
import { DataError } from "@/lib/data/errors";
import { timeZoneOf } from "./day.server";
import { NOW_UTC, trainDeps, type TrainDeps } from "./db.server";
import { insertProfileSql, profileOfRow, profileSql, readProfile } from "./profile.server";

export async function updatePrefs(viewer: Viewer, patch: TrainPrefsPatch, deps: TrainDeps = trainDeps()): Promise<TrainPrefs> {
  const seeded = await readProfile(deps.db, viewer);
  return deps.tx(async (db) => {
    if (!seeded.exists) await db.$executeRaw(insertProfileSql(viewer.id, seeded));
    const rows = await db.$queryRaw<Parameters<typeof profileOfRow>[0][]>(Prisma.sql`${profileSql(viewer.id)} FOR UPDATE`);
    const current = rows[0] ? profileOfRow(rows[0]) : seeded;
    const next = {
      dayStartHour: patch.dayStartHour ?? current.dayStartHour,
      releaseHour: patch.releaseHour ?? current.releaseHour,
      bankDailyCap: patch.bankDailyCap ?? current.bankDailyCap,
      newPerDay: patch.newPerDay ?? current.newPerDay,
      autoGrade: patch.autoGrade ?? current.autoGrade,
    };
    if (next.newPerDay > next.bankDailyCap) {
      throw new DataError("validation_failed", {
        fields: { newPerDay: `At most the daily cap (${next.bankDailyCap})` },
        details: { reason: "new_per_day_above_cap" },
      });
    }
    let timeZone = timeZoneOf(viewer);
    if (patch.timeZone) {
      await db.$executeRaw(Prisma.sql`UPDATE users SET "timeZone" = ${patch.timeZone}, "updatedAt" = ${NOW_UTC} WHERE id = ${viewer.id}`);
      timeZone = patch.timeZone;
    }
    const sets: Prisma.Sql[] = [];
    if (patch.dayStartHour !== undefined) sets.push(Prisma.sql`"dayStartHour" = ${next.dayStartHour}::smallint`);
    if (patch.releaseHour !== undefined) sets.push(Prisma.sql`"releaseHour" = ${next.releaseHour}::smallint`);
    if (patch.bankDailyCap !== undefined) sets.push(Prisma.sql`"bankDailyCap" = ${next.bankDailyCap}::smallint`);
    if (patch.newPerDay !== undefined) sets.push(Prisma.sql`"newPerDay" = ${next.newPerDay}::smallint`);
    if (patch.autoGrade !== undefined) sets.push(Prisma.sql`"autoGrade" = ${next.autoGrade}`);
    if (sets.length) {
      await db.$executeRaw(Prisma.sql`UPDATE training_profiles SET ${Prisma.join(sets, ", ")}, "updatedAt" = ${NOW_UTC} WHERE "userId" = ${viewer.id}`);
    }
    return { timeZone, ...next };
  });
}
