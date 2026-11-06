// `live:list` (phase-02 plan 7.4.4, 5.2.8): up to 20 watchable games in `playing`, from memory (never the DB),
// ordered by average rating, then spectators. Members only.
import { dataOf, fail, nowSec, type CommandTable } from "./context";

export const liveCommands: CommandTable = {
  "live:list"(ctx, socket, { timeClass }) {
    if (!(ctx.ents.get(dataOf(socket).userRef) > nowSec(ctx))) return fail("not_member");
    return { ok: true, games: ctx.registry.liveCards(timeClass) };
  },
};
