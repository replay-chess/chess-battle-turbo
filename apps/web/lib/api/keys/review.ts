// Domain `review`: game review and legend comparison (P3, phase-03 plan §5.1).
export const reviewKeys = {
  review: {
    all: () => ["review"] as const,
    /** ReviewDTO (A1). */
    detail: (ref: string) => ["review", ref] as const,
    /** ReviewStatusDTO (A2): the fallback poller, the game-over card, the legend block (P3-D2). */
    status: (ref: string) => ["review", ref, "status"] as const,
    /** LegendCompareDTO (A9); `[...legend(ref), "explanation"]` holds the `?include=explanation` variant. */
    legend: (ref: string) => ["review", ref, "legend"] as const,
    /** ShareDTO | null (mutation results only; seeded by the share page). */
    share: (ref: string) => ["review", ref, "share"] as const,
  },
};
