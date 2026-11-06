"use client";

// Creates the tab's realtime connection and seeds the socket token minted by the server render (P2 plan 5.1,
// client-data-layer 5.1). It never connects: the first `acquire()` does (the game screen holds "game"), so pages
// without a live feature open no socket. On a `session:hello` that says user-room events may have been missed
// (new bootId or a useq gap) it marks the user-level queries stale; only active ones refetch.

import { useContext, useEffect } from "react";
import { QueryClientContext } from "@tanstack/react-query";
import { bootRealtime, fetchSocketToken, type SocketToken } from "./connection";
import { RESYNC_QUERY_KEYS } from "./resync";

export type RealtimeBootProps = {
  /** Minted in the server render; null when it could not be minted (the client then fetches one on connect). */
  token: SocketToken | null;
  buildId: string;
  /** Defaults to NEXT_PUBLIC_WEBSOCKET_URL. */
  url?: string;
};

export function RealtimeBoot({ token, buildId, url }: RealtimeBootProps): null {
  const wsUrl = url ?? process.env.NEXT_PUBLIC_WEBSOCKET_URL ?? "";
  // Idempotent: the first render creates the singleton, later renders only seed a newer token. Doing it during
  // render (not in an effect) lets the game screen's first effect acquire the socket in the same commit.
  const rt = typeof window === "undefined" ? null : bootRealtime({ url: wsUrl, buildId, fetchToken: fetchSocketToken }, token);
  const client = useContext(QueryClientContext);

  useEffect(() => {
    if (!rt || !client) return;
    return rt.onHello((_hello, resync) => {
      if (!resync) return;
      for (const queryKey of RESYNC_QUERY_KEYS) void client.invalidateQueries({ queryKey, refetchType: "active" });
    });
  }, [rt, client]);

  return null;
}
