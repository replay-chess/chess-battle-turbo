// Domain `learn`: lesson progress (P8).
export const learnKeys = {
  learn: {
    all: () => ["learn"] as const,
    progress: (scope: string) => ["learn", "progress", scope] as const,
  },
};
