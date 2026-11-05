/**
 * Cron task `webhook-retention`: Dodo webhook rows are kept 180 days (their payload
 * is the billing audit trail), Clerk rows 30 days (no payload, ids only). Plan §6.3;
 * add an index on `receivedAt` only if the table passes 50k rows.
 */
import type { CronTask } from "./index";
import { defaultExecuteRaw, type ExecuteRaw } from "./rate-limit-sweep";

export const WEBHOOK_RETENTION_DAYS = { dodo: 180, clerk: 30 } as const;

export const WEBHOOK_RETENTION_SQL = `DELETE FROM "webhook_events"
WHERE ("provider" = 'dodo' AND "receivedAt" < (now() AT TIME ZONE 'UTC') - interval '${WEBHOOK_RETENTION_DAYS.dodo} days')
   OR ("provider" = 'clerk' AND "receivedAt" < (now() AT TIME ZONE 'UTC') - interval '${WEBHOOK_RETENTION_DAYS.clerk} days')`;

export function createWebhookRetention(exec: ExecuteRaw = defaultExecuteRaw): CronTask {
  return {
    name: "webhook-retention",
    async run() {
      return { count: await exec(WEBHOOK_RETENTION_SQL) };
    },
  };
}

export const webhookRetention = createWebhookRetention();
