"use client";

// "Watch another game" (plan 2.4, 5.2.8): the `live:list` socket command (≤ 20 watchable games in `playing`, from
// the socket server's memory), cached as the query `["games", "live"]` for 15 s and fetched only while open.

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import type { CommandOk } from "@repo/contracts/socket/commands";
import { ResponsiveDialog } from "@/components/ui/responsive-dialog";
import { qk } from "@/lib/api/keys";
import { getRealtime } from "@/lib/realtime/connection";

type LiveCard = CommandOk<"live:list">["games"][number];


async function fetchLive(): Promise<LiveCard[]> {
  const rt = getRealtime();
  if (!rt) return [];
  const ack = await rt.command("live:list", {});
  return ack.ok ? ack.games : [];
}

export function LiveGamesSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const q = useQuery({ queryKey: qk.games.live(), queryFn: fetchLive, staleTime: 15_000, enabled: open });
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} title="Watch Another Game" size="sm" sheetHeight="60">
      {q.isPending ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }} aria-busy="true">
          <span className="g-sk" style={{ height: 44 }} />
          <span className="g-sk" style={{ height: 44 }} />
          <span className="g-sk" style={{ height: 44 }} />
        </div>
      ) : q.data && q.data.length > 0 ? (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column" }} data-testid="live-games">
          {q.data.map((g) => (
            <li key={g.ref} style={{ borderBottom: "1px solid var(--cb-border)" }}>
              <Link
                href={`/game/${g.ref}?from=live`}
                onClick={() => onOpenChange(false)}
                style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, minHeight: 52, textDecoration: "none", color: "inherit" }}
              >
                <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                  <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {g.white.name}
                    {g.white.rating ? ` ${g.white.rating}` : ""} vs {g.black.name}
                    {g.black.rating ? ` ${g.black.rating}` : ""}
                  </span>
                  <span className="g-mono g-soft" style={{ fontSize: "0.75rem" }}>
                    {g.tcLabel} · move {Math.floor(g.ply / 2) + 1} · {g.spectators} watching
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="g-body" data-testid="live-games-empty">
          No live games to watch right now.
        </p>
      )}
    </ResponsiveDialog>
  );
}
