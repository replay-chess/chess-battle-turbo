// Domain `tournaments` (P12).
export const tournamentKeys = {
  tournaments: {
    all: () => ["tournaments"] as const,
    list: (tab: "live" | "upcoming" | "finished") => ["tournaments", "list", tab] as const,
    detail: (slug: string) => ["tournaments", slug] as const,
    standings: (slug: string) => ["tournaments", slug, "standings"] as const,
    participants: (slug: string, q: string) => ["tournaments", slug, "participants", q] as const,
  },
};
