// Domain `me`: the signed-in viewer (GET /api/me). Seeded by (app)/layout.tsx after 1B·J.
export const meKeys = {
  me: () => ["me"] as const,
};
