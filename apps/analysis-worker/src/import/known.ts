// "Already imported for this member" (phase-04 plan §8.8 "Known-game filter first"): one read per ≤ 500 candidate
// ids (index `games_source_externalId_key` + the `game_players` primary key), run before anything is written, so a
// daily sync of a month that already holds 40 games writes only the new ones and `imported` counts only genuinely
// new rows. A game this member holds through another link (both providers can never share an external id: the
// source is part of the key) or a game ANOTHER member imported is not "known": the batch writer attaches it. A game
// this member holds through their claim copy (co-claim.ts, FIX-2) is known too: the copy's id maps back to the game's.
import { stmt, type Db, type Statement } from "../db/client";
import { coClaimExternalId } from "./co-claim";
import type { ProviderDb } from "./context";

/** Candidate ids per known-filter query (§8.8). */
export const KNOWN_BATCH = 500;

/** `copyIds[i]` is the claim copy id of `externalIds[i]` (same order); both arrays go through the unique index. */
export function knownStatement(
  userId: string,
  source: ProviderDb,
  externalIds: readonly string[],
  copyIds: readonly string[] = [],
): Statement {
  return stmt(
    `SELECT g."externalId"
       FROM games g
       JOIN game_players gp ON gp."gameId" = g.id AND gp."userId" = $1::bigint
      WHERE g.source = $2::"GameSource" AND (g."externalId" = ANY($3::text[]) OR g."externalId" = ANY($4::text[]))`,
    [userId, source, [...externalIds], [...copyIds]],
  );
}

/** The ids of `externalIds` this member already holds (on the game's row or their claim copy). ⌈n / 500⌉ round trips. */
export async function knownExternalIds(
  db: Db,
  userId: string,
  source: ProviderDb,
  externalIds: readonly string[],
  linkedAccountId: string,
): Promise<Set<string>> {
  const known = new Set<string>();
  for (let i = 0; i < externalIds.length; i += KNOWN_BATCH) {
    const ids = externalIds.slice(i, i + KNOWN_BATCH);
    const baseOfCopy = new Map(ids.map((id) => [coClaimExternalId(id, linkedAccountId), id]));
    const rows = await db.query<{ externalId: string }>(knownStatement(userId, source, ids, [...baseOfCopy.keys()]));
    for (const r of rows) {
      const id = String(r.externalId);
      known.add(baseOfCopy.get(id) ?? id);
    }
  }
  return known;
}
