// Domain `billing`: membership reads and billing mutations.
export const billingKeys = {
  billing: {
    all: () => ["billing"] as const,
    /** Mutation key of POST /api/billing/refresh (P1); its response is merged into qk.me(). */
    refresh: () => ["billing", "refresh"] as const,
    membership: () => ["billing", "membership"] as const,
    preview: (plan: "monthly" | "yearly") => ["billing", "preview", plan] as const,
    activation: (sessionId: string) => ["billing", "activation", sessionId] as const,
  },
};
