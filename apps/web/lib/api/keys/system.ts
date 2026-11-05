// System domains: search (P11 adds `system.notice()` and `returnTarget(path)` here).
export const systemKeys = {
  search: (scope: "public" | "member", q: string) => ["search", scope, q] as const,
};
