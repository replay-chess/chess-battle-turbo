// Daily-sync scheduling (phase-04 plan §8.10, D4-27): the one rule lives in @repo/contracts/internal/import-schedule
// (the web's auto-import PATCH, the backlog SQL and this worker share it; interface check §0.8). The worker uses it
// to reschedule the account's reusable `import:<id>` row after every sync: next local 03:00 in users."timeZone" +
// (id % 60) min, snapped to HH:05 UTC (so all of an hour's syncs share one Neon wake), never sooner than 12 h after
// the last successful sync (R-CC-05). schedule.test.ts beside this file holds the §12.1 DST cases.
export {
  AUTO_SYNC_MIN_GAP_MS,
  DAILY_SYNC_LOCAL_HOUR,
  DAILY_SYNC_UTC_MINUTE,
  backlogSlotAt,
  nextAutoSyncAt,
  syncJitterMinutes,
} from "@repo/contracts/internal/import-schedule";
