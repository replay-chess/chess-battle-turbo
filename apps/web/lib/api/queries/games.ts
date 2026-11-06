// Game queries (phase-02 plan §5.4). The live game itself is NOT in the query cache (it lives in the per-game store fed
// by the socket); `qk.games.detail(ref)` holds the snapshot for bot games and other-device resumes, seeded by
// useCreateBotGame / useCompleteBotGame and on `game:ended`. No polling anywhere in P2.
import { GameDetailResponse, type GameSnapshot } from "@repo/contracts/http/games";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { api } from "../client";
import { endpoints } from "../endpoints";
import { qk } from "../keys";

/** `"/api/games/{ref}/…"` → the path for one game (refs are cuids: nothing to escape, encoded anyway). */
export function gamePath(path: string, ref: string): string {
  return path.replace("{ref}", encodeURIComponent(ref));
}

/** The PGN download link (`<a href download>`, `private, no-store`). No image link in P2 (§7.1.6). */
export function gamePgnHref(ref: string): string {
  return gamePath(endpoints.gamePgn, ref);
}

const LIVE_STATUSES: ReadonlySet<string> = new Set(["WAITING_FOR_OPPONENT", "IN_PROGRESS"]);

/** True while the snapshot can still change (staleTime 0); a finished game is immutable in P2 (Infinity). */
export function isLiveSnapshot(snapshot: Pick<GameSnapshot, "status"> | undefined): boolean {
  return !snapshot || LIVE_STATUSES.has(snapshot.status);
}

export async function fetchGameSnapshot(ref: string, signal?: AbortSignal): Promise<GameSnapshot> {
  const schema = process.env.NODE_ENV === "production" ? undefined : GameDetailResponse;
  const { data } = await api(gamePath(endpoints.gameDetail, ref), { schema, signal });
  return (data as GameDetailResponse).snapshot;
}

export function gameDetailQuery(ref: string) {
  return queryOptions({
    queryKey: qk.games.detail(ref),
    queryFn: ({ signal }): Promise<GameSnapshot> => fetchGameSnapshot(ref, signal),
    staleTime: (query) => (isLiveSnapshot(query.state.data as GameSnapshot | undefined) ? 0 : Infinity),
    meta: { object: "the game" },
  });
}

/** The snapshot of one game (bot games and resumes; live human games read the socket store instead). */
export function useGameSnapshot(ref: string, options: { enabled?: boolean } = {}) {
  return useQuery({ ...gameDetailQuery(ref), enabled: options.enabled ?? true });
}
