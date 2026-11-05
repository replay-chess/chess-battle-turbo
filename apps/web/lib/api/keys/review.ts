// Domain `review`: game review and legend comparison (P3).
export const reviewKeys = {
  review: {
    all: () => ["review"] as const,
    detail: (ref: string) => ["review", ref] as const,
    legend: (ref: string) => ["review", ref, "legend"] as const,
  },
};
