// Co-claimed Chess.com accounts (phase-04 plan §8.15, D4-10; FIX-2, import review round 2).
//
// Chess.com links are never verified, so two members may link the same Chess.com account ("link anyway",
// `account.link_coclaim`): a coach and a student, one person with two ReplayChess accounts, a typo, or someone
// squatting another player's handle. ReplayChess cannot tell which of them is the player, so the product rule
// (docs/decisions.md FX-10) is that a co-claim never takes anything from anyone and never blocks anyone: EVERY claimant
// gets the games. M2 allows one member per colour of a games row (`game_players_gameId_color_key`), so the claimant
// whose side of a games row another member already holds gets their own games row for that game, a "claim copy" keyed
// `(source, coClaimExternalId(externalId, linkedAccountId))`, with only their side and their own analysis.
//
// Before FIX-2 the batch writer skipped such a side as `taken`: the first claimant, real or not, held every side for
// good and the other claimant's import ended DONE with 0 games.
import { createHash } from "node:crypto";

/** games."externalId" is varchar(40). */
export const EXTERNAL_ID_MAX = 40;
const SEP = "~";

/**
 * The external id of `linkedAccountId`'s claim copy of the game `externalId`: `<externalId>~<linkedAccountId>`, or, when
 * that does not fit in 40 characters (a Chess.com uuid id), a sha-256 prefix of the id in its place. Never equal to a
 * provider id (those hold no `~`), and unique per (game, link).
 */
export function coClaimExternalId(externalId: string, linkedAccountId: string): string {
  const plain = `${externalId}${SEP}${linkedAccountId}`;
  if (plain.length <= EXTERNAL_ID_MAX) return plain;
  const room = EXTERNAL_ID_MAX - SEP.length - linkedAccountId.length;
  return `${createHash("sha256").update(externalId).digest("hex").slice(0, room)}${SEP}${linkedAccountId}`;
}
