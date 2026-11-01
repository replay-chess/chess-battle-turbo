/**
 * Free-trial rules. Pure functions, no database or network access, so they can
 * be unit tested and imported from client or server code.
 *
 * The offer: 7 days free, card required at checkout, first charge on day 8.
 * Each person gets one trial. Anyone who has started a trial before, or who
 * has ever held a subscription, checks out without one.
 */

export const TRIAL_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface TrialRecord {
  trialStartedAt: Date | null;
  trialEndsAt: Date | null;
  /** Any subscription ever attached to the user, trial or paid. */
  subscriptionId: string | null;
}

/** True when the next checkout should include the free trial. */
export function isTrialEligible(record: TrialRecord): boolean {
  return !record.trialStartedAt && !record.subscriptionId;
}

/** True while the user is inside their trial window. */
export function isInTrial(record: Pick<TrialRecord, "trialStartedAt" | "trialEndsAt">, now: Date = new Date()): boolean {
  return (
    !!record.trialStartedAt &&
    !!record.trialEndsAt &&
    record.trialStartedAt.getTime() <= now.getTime() &&
    now.getTime() < record.trialEndsAt.getTime()
  );
}

/** Whole days left in the trial, rounded up (so the last day reads "1 day left"). */
export function trialDaysLeft(trialEndsAt: Date | null, now: Date = new Date()): number {
  if (!trialEndsAt) return 0;
  const ms = trialEndsAt.getTime() - now.getTime();
  return ms <= 0 ? 0 : Math.ceil(ms / DAY_MS);
}

/**
 * Whether a Dodo subscription is still inside its free trial: it was created
 * with trial days and the trial window has not passed yet.
 */
export function isSubscriptionInTrial(
  subscription: { trial_period_days?: number | null; created_at?: string | Date | null },
  now: Date = new Date(),
): boolean {
  const days = subscription.trial_period_days ?? 0;
  if (days <= 0 || !subscription.created_at) return false;
  const start = subscription.created_at instanceof Date ? subscription.created_at : new Date(subscription.created_at);
  if (Number.isNaN(start.getTime())) return false;
  return now.getTime() < start.getTime() + days * DAY_MS;
}

export interface TrialSnapshot {
  trial_period_days?: number | null;
  created_at?: string | Date;
  next_billing_date: string | Date;
}

function toDate(value: string | Date | undefined | null): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Trial fields to write for an incoming subscription snapshot, or null when
 * nothing should change. Only the first trial is ever recorded; later
 * snapshots never move the dates, which keeps "one trial per person" true
 * even if Dodo redelivers or a second trial subscription slips through.
 */
export function trialFieldsFromSnapshot(
  current: Pick<TrialRecord, "trialStartedAt">,
  snapshot: TrialSnapshot,
): { trialStartedAt: Date; trialEndsAt: Date } | null {
  if (current.trialStartedAt) return null;
  const days = snapshot.trial_period_days ?? 0;
  if (days <= 0) return null;
  const start = toDate(snapshot.created_at) ?? new Date();
  // Dodo's first billing date is the end of the trial; fall back to start + days.
  const end = toDate(snapshot.next_billing_date) ?? new Date(start.getTime() + days * DAY_MS);
  return { trialStartedAt: start, trialEndsAt: end };
}
