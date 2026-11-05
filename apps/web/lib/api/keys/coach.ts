// Domain `coach`: AI coach context and threads (P7).
export const coachKeys = {
  coach: {
    all: () => ["coach"] as const,
    context: (gameRef: string, ply: number | null) => ["coach", "context", gameRef, ply] as const,
    thread: (threadId: string) => ["coach", "thread", threadId] as const,
  },
};
