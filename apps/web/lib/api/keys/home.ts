// Domains `home` (HOME-1 GET /api/home) and `badges` (R8 GET /api/me/badges), phase-05 plan §5.1. `badges` is its own
// domain because a key's first segment must be the domain it is declared under (keys.test.ts); the same counts also
// live in `qk.me()` data (`MeData.badges`), which the realtime handlers patch together with this key.
export const homeKeys = {
  home: () => ["home"] as const,
  badges: () => ["badges"] as const,
};
