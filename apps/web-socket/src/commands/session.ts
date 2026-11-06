// `session:refresh_token` (phase-02 plan 7.4.1 step 5, 7.4.4): a live socket outlives its token; after a refresh the
// client sends the new token so the server sees the newest `ent` (rematch, spectating, live list). The token must
// verify and name the same user, else the ack is `unauthorized` and the socket is closed.
import { verifySocketTokenDetailed } from "@repo/contracts/socket/token";
import { dataOf, fail, type CommandTable } from "./context";

export const sessionCommands: CommandTable = {
  "session:refresh_token"(ctx, socket, { token }) {
    const data = dataOf(socket);
    const verified = verifySocketTokenDetailed(token, ctx.env.socketKeys, ctx.now(), ctx.env.appEnv);
    if (!verified.ok || verified.claims.sub !== data.userRef) {
      ctx.metrics.count("ws.refresh_token.refused", { reason: verified.ok ? "other_user" : verified.reason });
      setTimeout(() => socket.disconnect(true), 50);
      return fail("unauthorized");
    }
    const c = verified.claims;
    data.ent = c.ent;
    data.tokenExp = c.exp;
    data.name = c.name;
    data.role = c.role;
    ctx.ents.set(data.userRef, c.ent);
    return { ok: true, ent: c.ent };
  },
};
