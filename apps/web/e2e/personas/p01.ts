// Phase 1 personas (phase-01 plan §6.5, §8.2). A persona is an exact account
// state that `scripts/dev/personas.ts --reset <pool user|S> --persona <name>`
// writes, and that `leasePersona(name)` (e2e/fixtures/lease.ts) asks for.
//
// Later phases add e2e/personas/pNN.ts with their own names (bank-empty,
// coach-capped, onboarding-fresh, …) and one line in scripts/dev/personas.ts.
// Pure module: no Prisma import, so unit tests and Playwright can load it.

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** The billing columns of `users` a persona sets (every one, so a reset is exact). */
export type BillingColumns = {
  plan: string | null;
  planInterval: string | null;
  subscriptionStatus: string | null;
  subscriptionProductId: string | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  subscriptionUpdatedAt: Date | null;
  trialStartedAt: Date | null;
  trialEndsAt: Date | null;
  /** true → `e2e_persona_<email>`; false → null. Kept unique per user. */
  hasSubscription: boolean;
};

export type Persona = {
  name: string;
  phase: number;
  description: string;
  /** The design state this persona reaches on a real route, if any (`@state:` tag). */
  state?: string;
  billing: (now: Date) => BillingColumns;
};

const FIXTURE_PRODUCT = "e2e-fixture";

const none: BillingColumns = {
  plan: null,
  planInterval: null,
  subscriptionStatus: null,
  subscriptionProductId: null,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
  subscriptionUpdatedAt: null,
  trialStartedAt: null,
  trialEndsAt: null,
  hasSubscription: false,
};

function subscribed(now: Date, status: string, periodEndMs: number, extra: Partial<BillingColumns> = {}): BillingColumns {
  return {
    ...none,
    plan: "player",
    planInterval: "month",
    subscriptionStatus: status,
    subscriptionProductId: FIXTURE_PRODUCT,
    currentPeriodEnd: new Date(now.getTime() + periodEndMs),
    subscriptionUpdatedAt: now,
    hasSubscription: true,
    ...extra,
  };
}

export const P01_PERSONAS = {
  member: {
    name: "member",
    phase: 1,
    description: "Active paid member, 30 days left in the period, trial long used",
    billing: (now) => subscribed(now, "active", 30 * DAY, { trialStartedAt: new Date(now.getTime() - 60 * DAY), trialEndsAt: new Date(now.getTime() - 53 * DAY) }),
  },
  trial5: {
    name: "trial5",
    phase: 1,
    description: "In the free trial with 5 days left (trial.daysLeft = 5)",
    billing: (now) => {
      const ends = new Date(now.getTime() + 5 * DAY - HOUR);
      return subscribed(now, "active", 5 * DAY - HOUR, { trialStartedAt: new Date(ends.getTime() - 7 * DAY), trialEndsAt: ends });
    },
  },
  trial_last_day: {
    name: "trial_last_day",
    phase: 1,
    description: "Last trial day: 3 hours left (trial.daysLeft = 1)",
    billing: (now) => {
      const ends = new Date(now.getTime() + 3 * HOUR);
      return subscribed(now, "active", 3 * HOUR, { trialStartedAt: new Date(ends.getTime() - 7 * DAY), trialEndsAt: ends });
    },
  },
  payment_banner: {
    name: "payment_banner",
    phase: 1,
    description: "Renewal failed (past_due), 4 days of paid access left: payment banner",
    state: "V3PaymentFailed.banner",
    billing: (now) => subscribed(now, "past_due", 4 * DAY),
  },
  payment_last_day: {
    name: "payment_last_day",
    phase: 1,
    description: "Renewal failed (past_due), 30 hours left (≤ 36 h): last-day banner",
    state: "V3PaymentFailed.last_day",
    billing: (now) => subscribed(now, "past_due", 30 * HOUR),
  },
  payment_expired: {
    name: "payment_expired",
    phase: 1,
    description: "Renewal never recovered (on_hold), period ended 2 days ago: expired banner, 402 payment_failed",
    state: "V3PaymentFailed.expired",
    billing: (now) => subscribed(now, "on_hold", -2 * DAY),
  },
  lapsed: {
    name: "lapsed",
    phase: 1,
    description: "Paid member whose subscription ended 10 days ago: 402 expired, /pricing?reason=ended",
    billing: (now) =>
      subscribed(now, "expired", -10 * DAY, {
        plan: null,
        trialStartedAt: new Date(now.getTime() - 70 * DAY),
        trialEndsAt: new Date(now.getTime() - 63 * DAY),
      }),
  },
  none: {
    name: "none",
    phase: 1,
    description: "Signed-in user with no subscription and the trial still available",
    billing: () => ({ ...none }),
  },
} satisfies Record<string, Persona>;

export type P01PersonaName = keyof typeof P01_PERSONAS;
