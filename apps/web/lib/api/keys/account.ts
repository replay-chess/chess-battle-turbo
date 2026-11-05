// Account domains: public player profiles, linked accounts, imports and notifications (P4, P10).
import { norm } from "./norm";
import type { GamesFilter } from "./game";

export const accountKeys = {
  players: {
    detail: (username: string) => ["players", username] as const,
    games: (username: string, f: GamesFilter) => ["players", username, "games", norm(f)] as const,
  },
  accounts: () => ["accounts"] as const,
  imports: () => ["imports"] as const,
  notifications: () => ["notifications"] as const,
};
