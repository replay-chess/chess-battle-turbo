"use client";

// A player bar directly above or below the board (plan 4.2, 4.4): avatar, name, rating, the sub line (state,
// material), the result tag, the opponent's grace ring and the clock. The bar whose clock runs carries the ink rule.

import { Avatar } from "@/components/ui/avatar";
import type { BarView } from "@repo/game-core/client/viewState";
import type { Side } from "@repo/game-core/machine/types";
import { ClockChip } from "../clock/ClockChip";
import { colorName, copyCtx, subText } from "../copy";
import { DisconnectRing } from "./DisconnectRing";
import { useGame, useView } from "./GameContext";

const TAG_TONE = { WON: "win", LOST: "loss", DRAW: "draw" } as const;

export function PlayerBar({ who, pos }: { who: "me" | "opp"; pos: "top" | "bottom" }) {
  const view = useView();
  const bar: BarView = view.bars[who];
  const side: Side = bar.side;
  const player = useGame((g) => g.state.players[side]);
  const ctx = copyCtx(useGame((g) => g.state));

  if (bar.state === "skel") {
    return (
      <div className="g-pchip" data-pos={pos} aria-busy="true" data-testid={`player-bar-${pos}`}>
        <span className="g-sk" style={{ width: 32, height: 32, flex: "none" }} />
        <span style={{ flex: "1 1 auto", display: "flex", flexDirection: "column", gap: 6 }}>
          <span className="g-sk" style={{ height: 10, width: "40%" }} />
          <span className="g-sk" style={{ height: 8, width: "25%" }} />
        </span>
        <span className="g-sk" style={{ width: 80, height: 30, flex: "none" }} />
      </div>
    );
  }

  const sub = subText(bar, ctx);
  const pulse = bar.state === "thinking" || bar.state === "waiting" || bar.state === "reconnecting";
  const warn = bar.state === "disconnected" || bar.state === "reconnecting";
  const ring = who === "opp" && view.zone === "disc" && player.graceEndsAt !== null && !player.online;
  return (
    <div
      className="g-pchip"
      data-pos={pos}
      data-active={view.tick === side ? "" : undefined}
      data-dim={bar.state === "disconnected" ? "" : undefined}
      aria-label={`${player.displayName}, ${colorName(side)}${ring ? ", disconnected" : ""}`}
      data-testid={`player-bar-${pos}`}
      data-side={side}
      data-state={bar.state || undefined}
    >
      <Avatar name={player.displayName} src={player.avatarUrl} size={32} decorative />
      <span className="g-nm">
        <span style={{ fontSize: "0.875rem" }}>
          {player.displayName}
          {player.rating && !(player.isBot && player.displayName.includes(String(player.rating))) ? (
            <span className="g-mono g-soft" style={{ fontSize: "0.75rem" }}>
              {" "}
              {player.isBot ? `≈${player.rating}` : player.rating}
            </span>
          ) : null}
        </span>
        <span className="g-sub g-mono" data-tone={warn ? "warn" : undefined} data-testid={`player-sub-${pos}`}>
          {pulse ? <span className="g-dotp" aria-hidden="true" /> : null}
          {sub}
        </span>
      </span>
      {bar.tag ? (
        <span className="g-tag" data-tone={TAG_TONE[bar.tag]}>
          {bar.tag}
        </span>
      ) : null}
      {ring ? <DisconnectRing name={player.displayName} graceEndsAt={player.graceEndsAt!} /> : null}
      <ClockChip side={side} name={player.displayName} />
    </div>
  );
}
